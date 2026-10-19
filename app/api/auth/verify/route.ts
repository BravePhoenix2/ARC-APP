import { NextRequest, NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { prisma } from "@/lib/prisma";
import { EMAIL_SESSION_COOKIE, clearEmailSessionCookie } from "@/lib/emailAuth";
import {
  createWalletMessage,
  hashSessionToken,
  isAdminWallet,
  newAuthToken,
  normalizeWalletAddress,
  readAuthBody,
  sameOrigin,
  setWalletSessionCookie,
  walletRequestOrigin,
  WALLET_SESSION_COOKIE,
  WALLET_SESSION_SECONDS,
} from "@/lib/walletAuth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "This request must come from Artiq." }, { status: 403, headers });
  }
  const body = await readAuthBody(request);
  const walletAddress = normalizeWalletAddress(body?.walletAddress);
  const nonce = body?.nonce;
  const signature = body?.signature;
  if (!walletAddress || typeof nonce !== "string" || !/^[a-f0-9]{48}$/.test(nonce) ||
      typeof signature !== "string" || !/^0x(?:[a-fA-F0-9]{128}|[a-fA-F0-9]{130})$/.test(signature)) {
    return NextResponse.json({ error: "A valid wallet, nonce, and signature are required." }, { status: 400, headers });
  }

  try {
    const challenge = await prisma.walletChallenge.findUnique({ where: { nonce } });
    if (!challenge || challenge.walletAddress !== walletAddress || challenge.expiresAt <= new Date() ||
        challenge.message !== createWalletMessage({
          origin: walletRequestOrigin(request),
          walletAddress,
          nonce,
          issuedAt: challenge.createdAt,
          expiresAt: challenge.expiresAt,
        })) {
      return NextResponse.json({ error: "This sign-in request expired or was already used. Sign in again." }, { status: 401, headers });
    }

    let valid = false;
    try {
      valid = await verifyMessage({ address: walletAddress as `0x${string}`, message: challenge.message, signature: signature as `0x${string}` });
    } catch {
      // A malformed EOA signature should be a failed sign-in, not a server error.
    }
    if (!valid) {
      return NextResponse.json({ error: "This signature does not match the connected wallet." }, { status: 401, headers });
    }

    const token = newAuthToken();
    const oldToken = request.cookies.get(WALLET_SESSION_COOKIE)?.value;
    const oldEmailToken = request.cookies.get(EMAIL_SESSION_COOKIE)?.value;
    const now = new Date();
    const created = await prisma.$transaction(async (tx) => {
      // Conditional deletion is the nonce lock: only one racing verification wins.
      const consumed = await tx.walletChallenge.deleteMany({ where: { id: challenge.id, expiresAt: { gt: now } } });
      if (consumed.count !== 1) return false;
      if (oldToken && /^[a-f0-9]{64}$/.test(oldToken)) {
        await tx.walletSession.deleteMany({ where: { tokenHash: hashSessionToken(oldToken) } });
      }
      if (oldEmailToken && /^[a-f0-9]{64}$/.test(oldEmailToken)) {
        await tx.emailSession.deleteMany({ where: { tokenHash: hashSessionToken(oldEmailToken) } });
      }
      await tx.walletSession.deleteMany({ where: { expiresAt: { lte: now } } });
      await tx.walletSession.create({
        data: { walletAddress, tokenHash: hashSessionToken(token), expiresAt: new Date(now.getTime() + WALLET_SESSION_SECONDS * 1000) },
      });
      return true;
    });
    if (!created) {
      return NextResponse.json({ error: "This sign-in request was already used. Sign in again." }, { status: 401, headers });
    }
    const response = NextResponse.json({ walletAddress, isAdmin: isAdminWallet(walletAddress) }, { headers });
    setWalletSessionCookie(response, token);
    clearEmailSessionCookie(response);
    return response;
  } catch {
    return NextResponse.json({ error: "Wallet sign-in is unavailable. Please try again." }, { status: 503, headers });
  }
}
