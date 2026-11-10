import { isAddress, parseAbi, parseEventLogs, zeroAddress, type Address, type Hash } from "viem";
import { arcChain } from "@/lib/arcConfig";
import { deploymentClient } from "@/lib/deploymentVerification";
import { protocol } from "@/lib/protocol";
import type { Item } from "@/lib/generated/prisma/client";
import type { PendingMintAllowlist } from "@/lib/mintAccess";

const managementAbi = parseAbi([
  "function supportsMintManagement() pure returns (bool)",
  "function owner() view returns (address)",
  "function registry() view returns (address)",
  "function collectionCreator(address) view returns (address)",
  "function maxSupply() view returns (uint256)",
  "function totalMinted() view returns (uint256)",
  "function mintStartTime() view returns (uint256)",
  "function mintClosed() view returns (bool)",
  "function mintPhases() view returns (bytes32 root,bytes32 collectionKey,uint64 ultimateStart,uint64 fcfsStart,uint64 publicStart,uint32 ultimateLimit,uint32 fcfsLimit,uint32 publicLimit,uint256 ultimatePrice,uint256 fcfsPrice)",
  "function guaranteedAllocation() view returns (uint256)",
  "event AllowlistRootUpdated(bytes32 indexed previousRoot,bytes32 indexed root,uint256 guaranteedAllocation)",
  "event MaxSupplyReduced(uint256 previousSupply,uint256 maxSupply)",
  "event MintingClosed()",
]);

export class MintManagementError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

/** Every read uses one block and the collection's original verified factory. */
export async function managedCollectionState(item: Item, wallet: string) {
  const address = item.contractAddress;
  const factory = item.deploymentFactory || protocol.factory;
  if (!address || !isAddress(address) || !factory || !isAddress(factory)) throw new MintManagementError("This collection does not have a verified deployment.");
  try {
    const [chainId, block] = await Promise.all([deploymentClient.getChainId(), deploymentClient.getBlock()]);
    if (!protocol.isTestnet || chainId !== arcChain.id) throw new MintManagementError("Mint management requires Arc Testnet.");
    if (block.number === null) throw new MintManagementError("The chain state is not ready. Retry shortly.", 503);
    const read = <T extends "supportsMintManagement" | "owner" | "registry" | "maxSupply" | "totalMinted" | "mintStartTime" | "mintClosed">(functionName: T) => deploymentClient.readContract({ address, abi: managementAbi, functionName, blockNumber: block.number! });
    const supported = await read("supportsMintManagement").catch(() => false);
    if (supported !== true) throw new MintManagementError("This older collection cannot change its whitelist or supply, or close minting. Create a collection using the updated factory to use these controls.");
    const [owner, registry, registered, maxSupply, totalMinted, start, closed] = await Promise.all([
      read("owner"), read("registry"),
      deploymentClient.readContract({ address: factory, abi: managementAbi, functionName: "collectionCreator", args: [address], blockNumber: block.number }),
      read("maxSupply"), read("totalMinted"), read("mintStartTime"), read("mintClosed"),
    ]);
    if (typeof owner !== "string" || owner.toLowerCase() !== wallet.toLowerCase()) throw new MintManagementError("Connect the collection owner wallet to manage this mint.", 403);
    if (typeof registry !== "string" || registry.toLowerCase() !== factory.toLowerCase() || registered === zeroAddress) throw new MintManagementError("This collection does not match its original verified factory.");
    if (typeof maxSupply !== "bigint" || typeof totalMinted !== "bigint" || typeof start !== "bigint" || typeof closed !== "boolean" || maxSupply < BigInt(1) || maxSupply > BigInt(item.maxSupply || 0) || totalMinted < BigInt(item.mintedCount || 0) || totalMinted > maxSupply) throw new MintManagementError("The collection state does not match its verified catalog record.");
    return { address: address as Address, blockNumber: block.number, timestamp: block.timestamp, maxSupply, totalMinted, start, closed };
  } catch (error) {
    if (error instanceof MintManagementError) throw error;
    throw new MintManagementError("The collection could not be verified on Arc. Wait for confirmation and retry.", 503);
  }
}

export async function managedAllowlistState(item: Item, wallet: string) {
  const state = await managedCollectionState(item, wallet);
  try {
    const [phases, allocation] = await Promise.all([
      deploymentClient.readContract({ address: state.address, abi: managementAbi, functionName: "mintPhases", blockNumber: state.blockNumber }),
      deploymentClient.readContract({ address: state.address, abi: managementAbi, functionName: "guaranteedAllocation", blockNumber: state.blockNumber }),
    ]);
    return { ...state, root: phases[0], collectionKey: phases[1], ultimateStart: phases[2], allocation };
  } catch {
    throw new MintManagementError("The collection whitelist could not be verified on Arc. Retry shortly.", 503);
  }
}

async function managementReceipt(state: Awaited<ReturnType<typeof managedCollectionState>>, hash: Hash, wallet: string) {
  try {
    const receipt = await deploymentClient.getTransactionReceipt({ hash });
    if (receipt.status !== "success" || receipt.to?.toLowerCase() !== state.address.toLowerCase() || receipt.from.toLowerCase() !== wallet.toLowerCase()) throw new MintManagementError("Provide the collection owner's successful transaction for this collection.");
    if (receipt.blockNumber > state.blockNumber) throw new MintManagementError("The chain state has not caught up with this transaction. Retry shortly.", 503);
    return receipt.logs.filter((log) => log.address.toLowerCase() === state.address.toLowerCase());
  } catch (error) {
    if (error instanceof MintManagementError) throw error;
    throw new MintManagementError("The management transaction is not available yet. Wait for confirmation and retry.", 503);
  }
}

export async function verifyAllowlistUpdate(item: Item, wallet: string, hash: Hash, previousRoot: string, pending: PendingMintAllowlist) {
  const state = await managedAllowlistState(item, wallet);
  const logs = await managementReceipt(state, hash, wallet);
  const changes = parseEventLogs({ abi: managementAbi, eventName: "AllowlistRootUpdated", logs, strict: true });
  if (!changes.some(({ args }) => args.previousRoot.toLowerCase() === previousRoot.toLowerCase() && args.root.toLowerCase() === pending.root.toLowerCase() && args.guaranteedAllocation === BigInt(pending.guaranteedAllocation)) || state.root.toLowerCase() !== pending.root.toLowerCase() || state.allocation !== BigInt(pending.guaranteedAllocation)) throw new MintManagementError("The confirmed whitelist does not match the pending wallet list. Keep the transaction hash and retry the matching update.");
  return state;
}

export async function verifyMintManagement(item: Item, wallet: string, hash: Hash) {
  const state = await managedCollectionState(item, wallet);
  const logs = await managementReceipt(state, hash, wallet);
  const reductions = parseEventLogs({ abi: managementAbi, eventName: "MaxSupplyReduced", logs, strict: true });
  const closed = parseEventLogs({ abi: managementAbi, eventName: "MintingClosed", logs, strict: true });
  if (!reductions.some(({ args }) => args.maxSupply === state.maxSupply && args.previousSupply > args.maxSupply) && !(closed.length > 0 && state.closed)) throw new MintManagementError("This transaction did not confirm a supply reduction or close minting for this collection.");
  return state;
}
