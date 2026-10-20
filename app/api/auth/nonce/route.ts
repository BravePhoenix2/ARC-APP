import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPrivyAppId } from "@/lib/privyAuth";
import {
  createWalletMessage,
  normalizeWalletAddress,
  readAuthBody,
  sameOrigin,
  walletRequestOrigin,
  WALLET_CHALLENGE_SECONDS,
} from "@/lib/walletAuth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "This request must come from Artiq." }, { status: 403, headers });
  }
  if (getPrivyAppId()) {
    return NextResponse.json({ error: "Use the Sign in button to continue with email or your wallet.", code: "USE_PRIVY_LOGIN" }, { status: 409, headers });
  }
  const body = await readAuthBody(request);
  const walletAddress = normalizeWalletAddress(body?.walletAddress);
  if (!walletAddress) {
    return NextResponse.json({ error: "A valid wallet address is required." }, { status: 400, headers });
  }
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + WALLET_CHALLENGE_SECONDS * 1000);
  const nonce = randomBytes(24).toString("hex");
  const message = createWalletMessage({ origin: walletRequestOrigin(request), walletAddress, nonce, issuedAt, expiresAt });
  try {
    await prisma.$transaction([
      prisma.walletChallenge.deleteMany({ where: { expiresAt: { lte: issuedAt } } }),
      prisma.walletChallenge.create({ data: { walletAddress, nonce, message, expiresAt, createdAt: issuedAt } }),
    ]);
    return NextResponse.json({ message, nonce }, { headers });
  } catch {
    return NextResponse.json({ error: "Wallet sign-in is unavailable. Please try again." }, { status: 503, headers });
  }
}
