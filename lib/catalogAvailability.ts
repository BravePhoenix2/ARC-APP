import type { Prisma } from "@/lib/generated/prisma/client";

type ScheduledItem = { itemType: string; status: string | null; contractAddress?: string | null; mintStartTime?: Date | string | null };

/** A deployed, scheduled collection opens without requiring a visitor to mint first. */
export function catalogAvailability<T extends ScheduledItem>(item: T, now = new Date()): T {
  if (item.itemType !== "NFT" || !item.contractAddress || item.status !== "UPCOMING") return item;
  const opens = item.mintStartTime ? new Date(item.mintStartTime).getTime() : 0;
  return opens <= now.getTime() ? { ...item, status: "LIVE" } : item;
}

/** Keep server status filters consistent with the time-derived public badge. */
export function catalogStatusWhere(status: string, now = new Date()): Prisma.ItemWhereInput {
  const opened = { status: "UPCOMING", contractAddress: { not: null }, OR: [{ mintStartTime: null }, { mintStartTime: { lte: now } }] } satisfies Prisma.ItemWhereInput;
  if (status === "LIVE") return { OR: [{ status: "LIVE" }, opened] };
  if (status === "UPCOMING") return { status: "UPCOMING", OR: [{ contractAddress: null }, { mintStartTime: { gt: now } }] };
  return { status: status as "MINTED_OUT" | "CLOSED" | "LISTED" };
}
