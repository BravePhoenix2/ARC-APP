import { formatUnits, keccak256, toHex } from "viem";
import { usdcAmount } from "@/lib/protocol";

export type AssetAuctionKind = "DIGITAL" | "PHYSICAL";
export type AssetAuctionDTO = {
  id: string;
  kind: AssetAuctionKind;
  title: string;
  description: string;
  imageUrl: string;
  deliveryTerms: string;
  reservePrice: string;
  endsAt: string;
  assetKey: `0x${string}`;
  marketAddress: `0x${string}`;
  chainId: number;
  auctionId: string | null;
  activationTxHash: string | null;
  sellerWallet: string;
  createdAt: string;
  seller: { username: string | null; avatarUrl: string | null };
  isOwner?: boolean;
};

/** An explicit allowlist keeps all account and fulfillment fields out of browse responses. */
export const assetAuctionPublicSelect = {
  id: true, kind: true, title: true, description: true, imageUrl: true,
  deliveryTerms: true, reservePrice: true, endsAt: true, assetKey: true,
  marketAddress: true, chainId: true, auctionId: true, activationTxHash: true,
  sellerWallet: true, createdAt: true,
  seller: { select: { username: true, avatarUrl: true } },
} as const;

type PublicAuction = Omit<AssetAuctionDTO, "kind" | "assetKey" | "marketAddress" | "endsAt" | "createdAt"> & {
  kind: string; assetKey: string; marketAddress: string; endsAt: Date; createdAt: Date;
};

export function publicAssetAuction(auction: PublicAuction, isOwner?: boolean): AssetAuctionDTO {
  return {
    id: auction.id, kind: auction.kind as AssetAuctionKind, title: auction.title,
    description: auction.description, imageUrl: auction.imageUrl,
    deliveryTerms: auction.deliveryTerms, reservePrice: auction.reservePrice,
    endsAt: auction.endsAt.toISOString(), assetKey: auction.assetKey as `0x${string}`,
    marketAddress: auction.marketAddress as `0x${string}`, chainId: auction.chainId,
    auctionId: auction.auctionId, activationTxHash: auction.activationTxHash,
    sellerWallet: auction.sellerWallet, createdAt: auction.createdAt.toISOString(),
    seller: { username: auction.seller.username, avatarUrl: auction.seller.avatarUrl },
    ...(isOwner === undefined ? {} : { isOwner }),
  };
}

function text(input: Record<string, unknown>, key: string, minimum: number, maximum: number, label: string): string {
  const value = input[key];
  if (typeof value !== "string" || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error(`${label} is invalid.`);
  const trimmed = value.trim();
  if (trimmed.length < minimum || trimmed.length > maximum) throw new Error(`${label} must contain ${minimum} to ${maximum} characters.`);
  return trimmed;
}

export function validateAssetAuction(input: unknown, now = Date.now()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Enter the asset's auction details.");
  const body = input as Record<string, unknown>;
  if (body.kind !== "DIGITAL" && body.kind !== "PHYSICAL") throw new Error("Choose a digital or physical asset.");
  const kind: AssetAuctionKind = body.kind;
  const title = text(body, "title", 3, 120, "Title");
  const description = text(body, "description", 10, 4000, "Description");
  const deliveryTerms = text(body, "deliveryTerms", 10, 2000, "Delivery terms");
  const imageUrl = text(body, "imageUrl", 14, 150, "Cover image");
  if (!/^\/api\/uploads\/[a-zA-Z0-9_-]{1,100}$/.test(imageUrl)) throw new Error("Upload your own cover image before creating the auction.");
  if (typeof body.reservePrice !== "string") throw new Error("Enter a reserve price in USDC.");
  const reservePrice = formatUnits(usdcAmount(body.reservePrice.trim()), 18);
  if (typeof body.endsAt !== "string" || body.endsAt.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(body.endsAt)) throw new Error("Choose a valid auction closing time.");
  const endsAt = new Date(Math.floor(new Date(body.endsAt).getTime() / 1000) * 1000);
  if (!Number.isFinite(endsAt.getTime()) || endsAt.getTime() < now + 60_000 || endsAt.getTime() > now + 30 * 24 * 60 * 60 * 1000) throw new Error("The auction must end between one minute and 30 days from now.");
  let digitalDeliveryUrl: string | null = null;
  if (kind === "DIGITAL") {
    digitalDeliveryUrl = text(body, "digitalDeliveryUrl", 10, 2048, "Private download URL");
    let url: URL;
    try { url = new URL(digitalDeliveryUrl); } catch { throw new Error("Enter a valid HTTPS download URL."); }
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || /\s/.test(digitalDeliveryUrl)) throw new Error("Use an HTTPS download URL without login credentials.");
  }
  return { kind, title, description, imageUrl, deliveryTerms, reservePrice, endsAt, digitalDeliveryUrl };
}

export function assetKindNumber(kind: string): 1 | 2 { return kind === "DIGITAL" ? 1 : 2; }

/** Versioned, ordered fields bind each on-chain auction to its immutable public terms. */
export function assetAuctionCommitment(auction: {
  id: string; sellerWallet: string; kind: string; title: string; description: string;
  imageUrl: string; deliveryTerms: string; reservePrice: string; endsAt: Date; marketAddress: string; chainId: number;
}): `0x${string}` {
  return keccak256(toHex(JSON.stringify([
    "artiq-asset-auction-v1", auction.id, auction.sellerWallet.toLowerCase(), auction.kind,
    auction.title, auction.description, auction.imageUrl, auction.deliveryTerms,
    auction.reservePrice, Math.floor(auction.endsAt.getTime() / 1000), auction.marketAddress.toLowerCase(), auction.chainId,
  ])));
}
