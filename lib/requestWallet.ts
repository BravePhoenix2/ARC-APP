import type { NextRequest } from "next/server";
import type { WalletSession } from "@/lib/walletAuth";

/** A session cookie can change in another tab; bind requests to the visible wallet. */
export function matchesRequestWallet(request: NextRequest, session: WalletSession): boolean {
  return request.headers.get("x-wallet-address")?.toLowerCase() === session.walletAddress.toLowerCase();
}
