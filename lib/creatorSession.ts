import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { EMAIL_SESSION_COOKIE, getEmailSession } from "@/lib/emailAuth";
import { getWalletSession, isAdminWallet } from "@/lib/walletAuth";
import { matchesRequestWallet } from "@/lib/requestWallet";
import { PRIVY_SESSION_COOKIE, getPrivySession, selectPrivyWallet } from "@/lib/privyAuth";

export type CreatorSession = {
  userId: string;
  authMethod: "EMAIL" | "WALLET" | "PRIVY";
  email: string | null;
  walletAddress: string | null;
  walletAddresses?: string[];
  isAdmin: boolean;
};

/** Resolve ownership to an account ID, never to an email supplied by the client. */
export async function getCreatorSession(request: NextRequest, bindRequest = true): Promise<CreatorSession | null> {
  if (request.cookies.get(PRIVY_SESSION_COOKIE)) {
    const session = await getPrivySession(request);
    if (!session || (bindRequest && request.headers.get("x-artiq-account-id") !== session.userId)) return null;
    const wallet = selectPrivyWallet(request, session);
    if (request.headers.get("x-wallet-address") !== null && !wallet) return null;
    return {
      userId: session.userId, authMethod: "PRIVY", email: session.email,
      walletAddress: wallet, walletAddresses: session.walletAddresses,
      isAdmin: Boolean(wallet && isAdminWallet(wallet)),
    };
  }
  if (request.cookies.get(EMAIL_SESSION_COOKIE)?.value) {
    const email = await getEmailSession(request);
    if (!email || (bindRequest && request.headers.get("x-artiq-account-id") !== email.userId)) return null;
    return { ...email, authMethod: "EMAIL", walletAddress: null, isAdmin: false };
  }
  const wallet = await getWalletSession(request);
  if (!wallet || (bindRequest && !matchesRequestWallet(request, wallet))) return null;
  // Existing wallet sessions predate account IDs. Keep their data and identity.
  const user = await prisma.user.upsert({
    where: { walletAddress: wallet.walletAddress }, update: {},
    create: { walletAddress: wallet.walletAddress }, select: { id: true },
  });
  return { userId: user.id, authMethod: "WALLET", email: null, walletAddress: wallet.walletAddress, isAdmin: wallet.isAdmin };
}
