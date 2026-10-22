import { parseEventLogs, zeroAddress, type Address, type Hash } from "viem";
import { auctionAbi, protocol, usdcAmount } from "@/lib/protocol";
import { deploymentClient } from "@/lib/deploymentVerification";
import { assetAuctionCommitment, assetKindNumber } from "@/lib/assetAuctions";
import type { AssetAuction } from "@/lib/generated/prisma/client";

export class AssetAuctionVerificationError extends Error {}

function marketForAuction(auction: AssetAuction): Address {
  const market = auction.marketAddress.toLowerCase();
  if (!protocol.isTestnet || auction.chainId !== 5042002 || ![protocol.auctions?.toLowerCase(), ...(protocol.legacyAuctions || [])].includes(market as Address)) throw new AssetAuctionVerificationError("This auction house is not configured for Arc Testnet.");
  if (assetAuctionCommitment(auction) !== auction.assetKey) throw new AssetAuctionVerificationError("The saved auction terms do not match their on-chain commitment.");
  return auction.marketAddress as Address;
}

export async function readVerifiedAssetAuction(auction: AssetAuction, id = auction.auctionId) {
  if (!id || !/^\d{1,78}$/.test(id)) throw new AssetAuctionVerificationError("Publish the auction before checking its settlement.");
  const address = marketForAuction(auction);
  const [chainId, asset, state] = await Promise.all([
    deploymentClient.getChainId(),
    deploymentClient.readContract({ address, abi: auctionAbi, functionName: "auctionAssets", args: [BigInt(id)] }),
    deploymentClient.readContract({ address, abi: auctionAbi, functionName: "auctions", args: [BigInt(id)] }),
  ]);
  if (chainId !== 5042002 || asset[0] !== auction.assetKey || asset[1] !== assetKindNumber(auction.kind) ||
    state[0].toLowerCase() !== auction.sellerWallet.toLowerCase() || state[1] !== zeroAddress || state[2] !== BigInt(0) ||
    state[3] !== usdcAmount(auction.reservePrice) || state[6] !== BigInt(Math.floor(auction.endsAt.getTime() / 1000))) {
    throw new AssetAuctionVerificationError("The on-chain asset, seller, price, or closing time does not match this listing.");
  }
  return { seller: state[0], highestBidder: state[4], highestBid: state[5], endsAt: state[6], settled: state[7], cancelled: state[7] && state[5] === BigInt(0) };
}

export async function verifiedAssetAuctionCreation(auction: AssetAuction, hash: Hash) {
  const address = marketForAuction(auction);
  const [chainId, receipt] = await Promise.all([
    deploymentClient.getChainId(), deploymentClient.getTransactionReceipt({ hash }),
  ]);
  if (chainId !== 5042002 || receipt.status !== "success" || receipt.to?.toLowerCase() !== address.toLowerCase()) throw new AssetAuctionVerificationError("Provide a successful creation transaction on the configured Arc Testnet auction house.");
  if (receipt.from.toLowerCase() !== auction.sellerWallet.toLowerCase()) throw new AssetAuctionVerificationError("The transaction wallet must match the auction seller.");
  const logs = parseEventLogs({ abi: auctionAbi, eventName: "AssetAuctionCreated", logs: receipt.logs.filter((log) => log.address.toLowerCase() === address.toLowerCase()), strict: true });
  const matches = logs.filter(({ args }) => args.assetKey === auction.assetKey && args.seller.toLowerCase() === auction.sellerWallet.toLowerCase() && args.assetKind === assetKindNumber(auction.kind) && args.reservePrice === usdcAmount(auction.reservePrice) && args.endsAt === BigInt(Math.floor(auction.endsAt.getTime() / 1000)));
  if (matches.length !== 1) throw new AssetAuctionVerificationError("The creation event must match this asset's seller, kind, reserve price, and closing time.");
  const id = String(matches[0].args.auctionId);
  await readVerifiedAssetAuction(auction, id);
  return id;
}
