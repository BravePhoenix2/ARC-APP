import { createPublicClient, http, isAddress, keccak256, parseAbi, parseEventLogs, toHex, zeroAddress, type Address, type Hash } from "viem";
import { arcChain } from "@/lib/arcConfig";
import { prisma } from "@/lib/prisma";
import { artMarketAbi, artMarketForItem, collectionAbi, factoryAbi, protocol, usdcAmount } from "@/lib/protocol";
import { publicItemWhere } from "@/lib/publicCatalog";
import type { Item } from "@/lib/generated/prisma/client";

// Public catalog reads never fan out into RPC calls. Explicit confirmed actions
// and the bounded scheduled reconciler share this short, non-retrying client.
export const catalogSyncClient = createPublicClient({ chain: arcChain, transport: http(undefined, { timeout: 5_000, retryCount: 0, batch: true }) });
const mint721Abi = parseAbi(["event Minted(address indexed to,uint256 quantity,uint256 firstTokenId,uint256 totalPaid)"]);
const mint1155Abi = parseAbi(["event Minted(address indexed to,uint256 quantity,uint256 totalPaid)"]);
export class CatalogSyncError extends Error {}
export class CatalogSyncBusyError extends CatalogSyncError {}

type Snapshot = { blockNumber: bigint; mintedCount: number; status: "UPCOMING" | "LIVE" | "MINTED_OUT" } | { blockNumber: bigint; sold: boolean; cancelled: boolean };
type Cached = { expires: number; snapshot: Snapshot };
const CACHE_MS = 30_000;
const MAX_CACHE = 500;
const globals = globalThis as unknown as { artiqCatalogSync?: { cache: Map<string, Cached>; inflight: Map<string, Promise<Snapshot>> } };
const state = globals.artiqCatalogSync ?? (globals.artiqCatalogSync = { cache: new Map(), inflight: new Map() });
const keyFor = (item: Item) => `${item.id}:${item.contractAddress || ""}:${item.deploymentFactory || ""}:${item.artMarketAddress || ""}:${item.artListingId || ""}`;

function collectionFor(item: Item): { address: Address; factory: Address } {
  const factory = item.deploymentFactory || protocol.factory;
  if (!item.contractAddress || !isAddress(item.contractAddress) || !factory || !isAddress(factory)) throw new CatalogSyncError("This collection does not have a verified deployment.");
  return { address: item.contractAddress, factory };
}

async function readSnapshot(item: Item, minimumBlockNumber?: bigint): Promise<Snapshot> {
  const [chainId, block] = await Promise.all([catalogSyncClient.getChainId(), catalogSyncClient.getBlock()]);
  if (!protocol.isTestnet || chainId !== 5042002) throw new CatalogSyncError("Catalog verification requires Arc Testnet.");
  if (block.number === null || (minimumBlockNumber !== undefined && block.number < minimumBlockNumber)) throw new CatalogSyncError("The RPC has not caught up with this confirmed transaction. Retry the catalog check.");
  const blockNumber = block.number;
  if (item.itemType === "NFT") {
    const { address, factory } = collectionFor(item);
    const [registeredCreator, registry, totalMinted, maxSupply, starts] = await Promise.all([
      catalogSyncClient.readContract({ address: factory, abi: factoryAbi, functionName: "collectionCreator", args: [address], blockNumber }),
      catalogSyncClient.readContract({ address, abi: collectionAbi, functionName: "registry", blockNumber }),
      catalogSyncClient.readContract({ address, abi: collectionAbi, functionName: "totalMinted", blockNumber }),
      catalogSyncClient.readContract({ address, abi: collectionAbi, functionName: "maxSupply", blockNumber }),
      catalogSyncClient.readContract({ address, abi: collectionAbi, functionName: "mintStartTime", blockNumber }),
    ]);
    if (registeredCreator === zeroAddress || registry.toLowerCase() !== factory.toLowerCase() || maxSupply !== BigInt(item.maxSupply || 0) || maxSupply < BigInt(1) || totalMinted > maxSupply || totalMinted < BigInt(0) || maxSupply > BigInt(1_000_000)) throw new CatalogSyncError("The collection does not match its verified catalog deployment.");
    const status = totalMinted >= maxSupply ? "MINTED_OUT" : block.timestamp < starts ? "UPCOMING" : "LIVE";
    return { blockNumber, mintedCount: Number(totalMinted), status };
  }
  const market = artMarketForItem(item);
  if (!market || !item.artListingId || !/^\d+$/.test(item.artListingId) || !item.artListingSeller || item.priceUsdc === null) throw new CatalogSyncError("This artwork does not have a verified checkout listing.");
  const listing = await catalogSyncClient.readContract({ address: market, abi: artMarketAbi, functionName: "listings", args: [BigInt(item.artListingId)], blockNumber });
  if (listing[0].toLowerCase() !== item.artListingSeller.toLowerCase() || listing[1] !== keccak256(toHex(item.id)) || listing[2] !== usdcAmount(String(item.priceUsdc))) throw new CatalogSyncError("The checkout listing does not match the approved artwork.");
  return { blockNumber, sold: listing[3] !== zeroAddress, cancelled: listing[4] };
}

async function snapshotFor(item: Item, minimumBlockNumber?: bigint): Promise<Snapshot> {
  const key = keyFor(item);
  const cached = state.cache.get(key);
  if (cached && cached.expires > Date.now() && (minimumBlockNumber === undefined || cached.snapshot.blockNumber >= minimumBlockNumber)) return cached.snapshot;
  const existing = state.inflight.get(key);
  if (existing) {
    const snapshot = await existing;
    if (minimumBlockNumber === undefined || snapshot.blockNumber >= minimumBlockNumber) return snapshot;
    return snapshotFor(item, minimumBlockNumber);
  }
  // A burst of sync requests cannot create an unbounded RPC queue.
  if (state.inflight.size >= 4) throw new CatalogSyncBusyError("Catalog verification is busy. Retry shortly.");
  const pending = readSnapshot(item, minimumBlockNumber);
  state.inflight.set(key, pending);
  try {
    const snapshot = await pending;
    for (const [cacheKey, value] of Array.from(state.cache)) if (value.expires <= Date.now()) state.cache.delete(cacheKey);
    if (state.cache.size >= MAX_CACHE) state.cache.delete(state.cache.keys().next().value!);
    state.cache.set(key, { expires: Date.now() + CACHE_MS, snapshot });
    return snapshot;
  } finally { if (state.inflight.get(key) === pending) state.inflight.delete(key); }
}

/** Only verified chain values are persisted; clients never supply availability. */
export async function reconcileCatalogItem(item: Item, minimumBlockNumber?: bigint) {
  const snapshot = await snapshotFor(item, minimumBlockNumber);
  if ("mintedCount" in snapshot) {
    await prisma.item.updateMany({
      where: { id: item.id, contractAddress: item.contractAddress, deploymentFactory: item.deploymentFactory, maxSupply: item.maxSupply, OR: [{ mintedCount: null }, { mintedCount: { lte: snapshot.mintedCount } }], ...(snapshot.status === "UPCOMING" ? { AND: [{ OR: [{ status: null }, { status: { notIn: ["LIVE", "MINTED_OUT"] } }] }] } : {}) },
      data: { mintedCount: snapshot.mintedCount, status: snapshot.status },
    });
  } else if (snapshot.sold || snapshot.cancelled) {
    // Purchase state is independent of delivery/order saving. A stale pre-sale
    // snapshot must never make a confirmed sale available again.
    await prisma.item.updateMany({
      where: { id: item.id, artListingId: item.artListingId, artMarketAddress: item.artMarketAddress, artListingSeller: item.artListingSeller, priceUsdc: item.priceUsdc, sold: false },
      data: { sold: snapshot.sold, quantityAvailable: 0 },
    });
  }
  return prisma.item.findUniqueOrThrow({ where: { id: item.id }, select: { id: true, itemType: true, status: true, mintedCount: true, sold: true, quantityAvailable: true } });
}

/** A caller may refresh a public item only using its own successful matching receipt. */
export async function syncConfirmedCatalogAction(item: Item, txHash: Hash, wallet: Address) {
  if (!protocol.isTestnet || await catalogSyncClient.getChainId() !== 5042002) throw new CatalogSyncError("Catalog verification requires Arc Testnet.");
  const receipt = await catalogSyncClient.getTransactionReceipt({ hash: txHash });
  const target = item.itemType === "NFT" ? collectionFor(item).address : artMarketForItem(item);
  if (receipt.status !== "success" || !target || receipt.to?.toLowerCase() !== target.toLowerCase() || receipt.from.toLowerCase() !== wallet.toLowerCase()) throw new CatalogSyncError("Provide your successful transaction for this catalog item.");
  const logs = receipt.logs.filter((log) => log.address.toLowerCase() === target.toLowerCase());
  let matches = false;
  if (item.itemType === "NFT") {
    matches = item.nftKind === "EDITION"
      ? parseEventLogs({ abi: mint1155Abi, eventName: "Minted", logs, strict: true }).some(({ args }) => args.to.toLowerCase() === wallet.toLowerCase() && args.quantity > BigInt(0))
      : parseEventLogs({ abi: mint721Abi, eventName: "Minted", logs, strict: true }).some(({ args }) => args.to.toLowerCase() === wallet.toLowerCase() && args.quantity > BigInt(0));
  } else if (item.artListingId) {
    matches = parseEventLogs({ abi: artMarketAbi, eventName: "ArtPurchased", logs, strict: true }).some(({ args }) => String(args.listingId) === item.artListingId && args.buyer.toLowerCase() === wallet.toLowerCase() && args.price === usdcAmount(String(item.priceUsdc)));
  }
  if (!matches) throw new CatalogSyncError("The receipt does not contain a matching mint or art purchase.");
  return reconcileCatalogItem(item, receipt.blockNumber);
}

/** Bounded maintenance page; repeat with nextCursor to cover a large catalog. */
export async function reconcileCatalogPage({ limit = 50, after, deadline }: { limit?: number; after?: string; deadline?: number } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new CatalogSyncError("Choose a catalog sync page size from 1 to 100.");
  const items = await prisma.item.findMany({ where: { AND: [publicItemWhere], OR: [{ itemType: "NFT", contractAddress: { not: null } }, { itemType: "WEB2_ART", artListingId: { not: null } }], ...(after ? { id: { gt: after } } : {}) }, orderBy: { id: "asc" }, take: limit + 1 });
  const page = items.slice(0, limit);
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  // Two workers limit scheduled-provider load. HTTP syncs share the global cap.
  let next = 0;
  await Promise.all([0, 1].map(async () => { while (next < page.length && (deadline === undefined || Date.now() < deadline)) { const index = next++; const item = page[index]; try { await reconcileCatalogItem(item); results[index] = { id: item.id, ok: true }; } catch (error) { results[index] = { id: item.id, ok: false, error: error instanceof CatalogSyncError ? error.message : "Chain or database verification unavailable." }; } } }));
  const hasMore = next < page.length || items.length > limit;
  return { results, hasMore, nextCursor: hasMore ? (next ? page[next - 1].id : after || null) : null };
}
