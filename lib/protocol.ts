import { isAddress, parseAbi, parseUnits, formatUnits, zeroAddress, type Address } from "viem";
import { arcChain } from "@/lib/arcConfig";

function configuredAddress(value: string | undefined): Address | null {
  return value && isAddress(value) && value !== zeroAddress ? value as Address : null;
}

export const protocol = {
  factory: configuredAddress(process.env.NEXT_PUBLIC_STUDIO_FACTORY_ADDRESS),
  auctions: configuredAddress(process.env.NEXT_PUBLIC_AUCTION_HOUSE_ADDRESS),
  artMarket: configuredAddress(process.env.NEXT_PUBLIC_ART_MARKET_ADDRESS),
  isTestnet: arcChain.id === 5042002,
};

export const factoryAbi = parseAbi([
  "function supportsImageSeries() pure returns (bool)",
  "function create721(string name_,string symbol_,string metadataURI_,uint256 mintPrice_,uint256 mintStartTime_,uint256 maxSupply_,uint256 maxPerWallet_,uint96 royaltyBps_,bool soulbound_) returns (address)",
  "function createEdition(string name_,string symbol_,string metadataURI_,uint256 mintPrice_,uint256 mintStartTime_,uint256 maxSupply_,uint256 maxPerWallet_,uint96 royaltyBps_) returns (address)",
  "function hasMinted(address) view returns (bool)",
  "function collectionCreator(address) view returns (address)",
  "event CollectionCreated(address indexed creator,address indexed collection,uint8 standard,bool soulbound,string name,string symbol)",
]);

export const collectionAbi = parseAbi([
  "function mint(uint256 quantity) payable",
  "function mintPrice() view returns (uint256)",
  "function mintStartTime() view returns (uint256)",
  "function maxSupply() view returns (uint256)",
  "function maxPerWallet() view returns (uint256)",
  "function totalMinted() view returns (uint256)",
  "function mintedByWallet(address) view returns (uint256)",
  "function metadataURI() view returns (string)",
  "function owner() view returns (address)",
  "function withdraw(address receiver)",
  "function soulbound() view returns (bool)",
  "function ownerOf(uint256) view returns (address)",
  "function locked(uint256) view returns (bool)",
  "function approve(address to,uint256 tokenId)",
]);

export const auctionAbi = parseAbi([
  "function nextAuctionId() view returns (uint256)",
  "function auctions(uint256) view returns (address seller,address nft,uint256 tokenId,uint256 reservePrice,address highestBidder,uint256 highestBid,uint64 endsAt,bool settled,bool nftClaimed)",
  "function createAuction(address nft,uint256 tokenId,uint256 reservePrice,uint64 endsAt) returns (uint256)",
  "function bid(uint256 auctionId) payable",
  "function settle(uint256 auctionId)",
  "function cancelAuction(uint256 auctionId)",
  "function claimNFT(uint256 auctionId,address receiver)",
  "function withdraw(address receiver)",
  "function pendingReturns(address) view returns (uint256)",
  "function nextRewardRoundId() view returns (uint256)",
  "function rewardRounds(uint256) view returns (address sponsor,uint64 closesAt,uint32 maxParticipants,uint32 participantCount,uint256 pool,uint256 sharePerParticipant,bool settled)",
  "function hasJoinedReward(uint256,address) view returns (bool)",
  "function rewardClaimed(uint256,address) view returns (bool)",
  "function isRewardEligible(address) view returns (bool)",
  "function createRewardRound(uint64 closesAt,uint32 maxParticipants) payable returns (uint256)",
  "function joinRewardRound(uint256)",
  "function settleRewardRound(uint256)",
  "function claimReward(uint256,address receiver)",
]);

export const artMarketAbi = parseAbi([
  "function nextListingId() view returns (uint256)",
  "function listings(uint256) view returns (address seller,bytes32 artId,uint256 price,address buyer,bool cancelled)",
  "function createListing(bytes32 artId,uint256 price) returns (uint256)",
  "function buyListing(uint256) payable",
  "function cancelListing(uint256)",
  "function hasPurchasedArt(address) view returns (bool)",
  "function pendingReturns(address) view returns (uint256)",
  "function withdraw(address receiver)",
  "event ArtListed(uint256 indexed listingId,address indexed seller,bytes32 indexed artId,uint256 price)",
  "event ArtPurchased(uint256 indexed listingId,address indexed buyer,uint256 price)",
]);

// Native USDC uses 18 decimals. The optional ERC-20 interface's 6 decimals
// must never be used for these payable contract calls.
export function usdcAmount(value: string, allowZero = false): bigint {
  if (!/^\d{1,7}(\.\d{1,6})?$/.test(value) || Number(value) > 1_000_000 || (!allowZero && Number(value) === 0)) {
    throw new Error(`Enter ${allowZero ? "0 to" : "a positive amount up to"} 1,000,000 USDC, with at most six decimal places.`);
  }
  return parseUnits(value, 18);
}

export function displayUsdc(value: bigint): string {
  if (value > BigInt(0) && value < BigInt("1000000000000")) return formatUnits(value, 18);
  return Number(formatUnits(value, 18)).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

/** Round a protocol minimum up to the six-decimal precision of bid inputs. */
export function minimumUsdcBid(highest: bigint, reserve: bigint): bigint {
  const step = BigInt("1000000000000");
  const minimum = highest === BigInt(0) ? reserve : highest + (highest / BigInt(20) || BigInt(1));
  return ((minimum + step - BigInt(1)) / step) * step;
}

export function transactionError(cause: unknown): string {
  const seen = new Set<unknown>();
  let error = cause;
  while (error && typeof error === "object" && !seen.has(error)) {
    seen.add(error);
    const detail = error as { code?: number; name?: string; shortMessage?: string; cause?: unknown };
    if (detail.code === 4001 || detail.name === "UserRejectedRequestError") return "Transaction cancelled. You can try again when you are ready.";
    if (detail.cause) { error = detail.cause; continue; }
    if (detail.shortMessage) return detail.shortMessage;
    break;
  }
  return cause instanceof Error ? ("shortMessage" in cause ? String(cause.shortMessage) : cause.message) : "The transaction could not be completed. Please try again.";
}
