import { zeroAddress, type Address, type Hash } from "viem";
import { assetAuctionCommitment, type AssetAuctionDTO } from "@/lib/assetAuctions";
import { minimumUsdcBid, usdcAmount } from "@/lib/protocol";

export type AssetAuctionState = {
  id: bigint;
  seller: Address;
  bidder: Address;
  reserve: bigint;
  bid: bigint;
  ends: number;
  settled: boolean;
};

export type PendingAssetAuction = { id: string; marketAddress: Address; sellerWallet: Address; chainId: number; txHash: Hash };

/** Reject mismatched off-chain metadata before a wallet can bid on it. */
export function verifiedAssetAuction(
  listing: AssetAuctionDTO,
  auction: readonly [Address, Address, bigint, bigint, Address, bigint, bigint, boolean, boolean],
  asset: readonly [`0x${string}`, number],
): AssetAuctionState {
  const commitment = assetAuctionCommitment({ ...listing, endsAt: new Date(listing.endsAt) });
  if (!listing.auctionId || commitment !== listing.assetKey || auction[0].toLowerCase() !== listing.sellerWallet.toLowerCase()
    || auction[1] !== zeroAddress || auction[2] !== BigInt(0)
    || auction[3] !== usdcAmount(listing.reservePrice)
    || Number(auction[6]) !== Math.floor(new Date(listing.endsAt).getTime() / 1000)
    || asset[0].toLowerCase() !== listing.assetKey.toLowerCase()
    || asset[1] !== (listing.kind === "DIGITAL" ? 1 : 2)) {
    throw new Error("The on-chain auction does not match this asset. Bidding is unavailable.");
  }
  return { id: BigInt(listing.auctionId), seller: auction[0], reserve: auction[3], bidder: auction[4], bid: auction[5], ends: Number(auction[6]), settled: auction[7] };
}

/** Use chain time, then advance it monotonically while the next block is loading. */
export function assetAuctionNow(sample: { timestamp: number; observedAt: number } | undefined, wallTime: number): number {
  return sample ? sample.timestamp + Math.max(0, Math.floor((wallTime - sample.observedAt) / 1000)) : 0;
}

export function assertAssetBid(auction: AssetAuctionState, value: bigint, now: number, wallet: string) {
  if (!now || now >= auction.ends || auction.settled) throw new Error("The auction timer has ended. Bidding is closed.");
  if (auction.seller.toLowerCase() === wallet.toLowerCase()) throw new Error("You cannot bid on your own auction.");
  if (value < minimumUsdcBid(auction.bid, auction.reserve)) throw new Error("Enter at least the minimum bid. Each increase must be at least 5%.");
}

export function pendingAssetAuctionKey(accountId: string, wallet: string) {
  return `artiq:asset-auctions:${accountId}:${wallet.toLowerCase()}`;
}

/** Store only public draft references and hashes, never delivery links or addresses. */
export function readPendingAssetAuctions(value: string | null, wallet: string, chainId: number): PendingAssetAuction[] {
  try {
    const parsed: unknown = JSON.parse(value || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is PendingAssetAuction => !!entry && typeof entry.id === "string"
      && /^0x[a-fA-F0-9]{40}$/.test(entry.marketAddress)
      && typeof entry.sellerWallet === "string" && entry.sellerWallet.toLowerCase() === wallet.toLowerCase()
      && entry.chainId === chainId && /^0x[a-fA-F0-9]{64}$/.test(entry.txHash)).map(({ id, marketAddress, sellerWallet, chainId: idChain, txHash }) => ({ id, marketAddress, sellerWallet, chainId: idChain, txHash }));
  } catch { return []; }
}
