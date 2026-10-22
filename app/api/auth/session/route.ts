import { withAbuseProtection } from "@/lib/abuseProtection";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  clearWalletSessionCookie,
  getWalletSession,
  hashSessionToken,
  sameOrigin,
  WALLET_SESSION_COOKIE,
} from "@/lib/walletAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(request: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const session = await getWalletSession(request);
    if (session) return NextResponse.json(session, { headers });
    const response = NextResponse.json({ error: "Sign in with your wallet to continue." }, { status: 401, headers });
    clearWalletSessionCookie(response);
    return response;
  } catch {
    return NextResponse.json({ error: "Wallet sign-in is unavailable. Please try again." }, { status: 503, headers });
  }
}

async function handleDELETE(request: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "This request must come from Artiq." }, { status: 403, headers });
  }
  try {
    const token = request.cookies.get(WALLET_SESSION_COOKIE)?.value;
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      await prisma.walletSession.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
    }
    const response = NextResponse.json({ ok: true }, { headers });
    clearWalletSessionCookie(response);
    return response;
  } catch {
    return NextResponse.json({ error: "Could not sign out. Please try again." }, { status: 503, headers });
  }
}

export const GET = withAbuseProtection("GET auth/session", "session", handleGET);
export const DELETE = withAbuseProtection("DELETE auth/session", "session", handleDELETE);
