import { createPublicClient, http, parseEventLogs, parseAbi, type Address, type Hash } from "viem";
import { arcChain } from "@/lib/arcConfig";
import { collectionAbi, factoryAbi, usdcAmount } from "@/lib/protocol";
import { prisma } from "@/lib/prisma";
import { onchainMintConfig, type MintPhaseConfig } from "@/lib/mintAccess";
import { itemMetadataUri } from "@/lib/itemMetadata";
import type { Item } from "@/lib/generated/prisma/client";
import { readMintSurchargeBps } from "@/lib/platformFeeRead";

// A normal viem client, exported so integration tests can replace its network
// methods in their isolated process without introducing a production bypass.
export const deploymentClient = createPublicClient({ chain: arcChain, transport: http(undefined, { timeout: 15_000, retryCount: 0 }) });
const verificationAbi = parseAbi([
  "function royaltyInfo(uint256 tokenId,uint256 salePrice) view returns (address receiver,uint256 royaltyAmount)",
  "function collectionCreator(address) view returns (address)",
  "function supportsImageSeries() pure returns (bool)",
  "function supportsMintSurcharge() pure returns (bool)",
]);

export class DeploymentVerificationError extends Error {}

export async function verifiedCollection(item: Item, hash: Hash, factory: Address): Promise<{ address: Address; creator: Address }> {
  if (await deploymentClient.getChainId() !== arcChain.id) throw new DeploymentVerificationError("The deployment must be verified on Arc Testnet.");
  const factoryMintSurcharge = await readMintSurchargeBps(deploymentClient, factory);
  if (item.imageCount > 1 && !await deploymentClient.readContract({ address: factory, abi: verificationAbi, functionName: "supportsImageSeries" })) throw new DeploymentVerificationError("The configured factory does not support image series.");
  const receipt = await deploymentClient.getTransactionReceipt({ hash });
  if (receipt.status !== "success" || receipt.to?.toLowerCase() !== factory.toLowerCase()) throw new DeploymentVerificationError("The transaction must successfully create a collection through the configured Artiq factory.");
  const logs = parseEventLogs({ abi: factoryAbi, eventName: "CollectionCreated", logs: receipt.logs.filter((log) => log.address.toLowerCase() === factory.toLowerCase()), strict: true });
  const expectedStandard = item.nftKind === "EDITION" ? 2 : 1;
  const expectedSoulbound = item.nftKind === "SOULBOUND";
  const events = logs.filter(({ args }) => args.name === item.title && args.symbol === (item.symbol || "ARTIQ") && args.standard === expectedStandard && args.soulbound === expectedSoulbound && args.creator.toLowerCase() === receipt.from.toLowerCase());
  if (events.length !== 1) throw new DeploymentVerificationError("The deployed NFT type, name, symbol, or creator does not match this collection.");
  const { collection: address, creator } = events[0].args;
  const [registeredCreator, owner, price, start, supply, limit, uri, royalty, mintSurcharge] = await Promise.all([
    deploymentClient.readContract({ address: factory, abi: verificationAbi, functionName: "collectionCreator", args: [address] }),
    deploymentClient.readContract({ address, abi: collectionAbi, functionName: "owner" }),
    deploymentClient.readContract({ address, abi: collectionAbi, functionName: "mintPrice" }),
    deploymentClient.readContract({ address, abi: collectionAbi, functionName: "mintStartTime" }),
    deploymentClient.readContract({ address, abi: collectionAbi, functionName: "maxSupply" }),
    deploymentClient.readContract({ address, abi: collectionAbi, functionName: "maxPerWallet" }),
    deploymentClient.readContract({ address, abi: collectionAbi, functionName: "metadataURI" }),
    deploymentClient.readContract({ address, abi: verificationAbi, functionName: "royaltyInfo", args: [BigInt(1), BigInt(10_000)] }),
    readMintSurchargeBps(deploymentClient, address),
  ]);
  const expectedPrice = usdcAmount(String(item.mintPriceUsdc ?? 0), true);
  if (registeredCreator.toLowerCase() !== creator.toLowerCase() || owner.toLowerCase() !== creator.toLowerCase() ||
    price !== expectedPrice || start !== BigInt(item.mintStartTime ? Math.floor(item.mintStartTime.getTime() / 1000) : 0) ||
    supply !== BigInt(item.maxSupply ?? 0) || limit !== BigInt(item.maxPerWallet ?? item.maxSupply ?? 0) ||
    uri !== itemMetadataUri(item) || royalty[0].toLowerCase() !== creator.toLowerCase() || royalty[1] !== BigInt(item.royaltyBps ?? 0) || mintSurcharge !== factoryMintSurcharge) {
    throw new DeploymentVerificationError("The deployed mint price, schedule, supply, wallet limit, royalties, owner, or metadata does not match the collection settings.");
  }
  const plan = await prisma.mintAccessPlan.findUnique({ where: { itemId: item.id } });
  const supportsPhases = await deploymentClient.readContract({ address: factory, abi: factoryAbi, functionName: "supportsMintPhases" }).catch(() => false);
  if (plan) {
    if (!plan.frozenAt || !plan.root || !supportsPhases) throw new DeploymentVerificationError("Lock the allowlist and use a factory supporting mint phases before deploying.");
    const enabled = await deploymentClient.readContract({ address, abi: collectionAbi, functionName: "phasesEnabled" });
    const actual = await deploymentClient.readContract({ address, abi: collectionAbi, functionName: "mintPhases" });
    const expected = onchainMintConfig(item.id, plan.root as `0x${string}`, plan.config as MintPhaseConfig);
    if (!enabled || Object.values(expected).some((v, i) => String(v).toLowerCase() !== String(actual[i]).toLowerCase())) throw new DeploymentVerificationError("The deployed allowlist or phase settings do not match the locked collection.");
  } else if (supportsPhases && await deploymentClient.readContract({ address, abi: collectionAbi, functionName: "phasesEnabled" })) throw new DeploymentVerificationError("This collection was configured for public minting without phases.");
  return { address, creator };
}
