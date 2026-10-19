import { NextRequest, NextResponse } from "next/server";
import {
  EMAIL_MAX_ATTEMPTS, EMAIL_SESSION_COOKIE, EMAIL_SESSION_SECONDS,
  emailCodeMatches, normalizeEmail, setEmailSessionCookie,
} from "@/lib/emailAuth";
import { prisma } from "@/lib/prisma";
import { isEmailConfigured } from "@/lib/sendEmail";
import {
  clearWalletSessionCookie, hashSessionToken, newAuthToken, readAuthBody,
  sameOrigin, walletRequestOrigin, WALLET_SESSION_COOKIE,
} from "@/lib/walletAuth";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
const invalidMessage = "This code is incorrect, expired, or already used. Request a new code if needed.";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "This request must come from Artiq." }, { status: 403, headers });
  }
  const body = await readAuthBody(request);
  const email = normalizeEmail(body?.email);
  const challengeId = body?.challengeId;
  const code = body?.code;
  if (!email || typeof challengeId !== "string" || !/^[a-z0-9]{20,64}$/.test(challengeId) || typeof code !== "string" || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Enter your email address and the six-digit code." }, { status: 400, headers });
  }
  if (!isEmailConfigured()) {
    return NextResponse.json({ error: "Email sign-in is unavailable. Please use a wallet for now." }, { status: 503, headers });
  }

  const origin = walletRequestOrigin(request);
  const token = newAuthToken();
  const oldToken = request.cookies.get(EMAIL_SESSION_COOKIE)?.value;
  const walletToken = request.cookies.get(WALLET_SESSION_COOKIE)?.value;
  try {
    const user = await prisma.$transaction(async (tx) => {
      const now = new Date();
      // Claim an attempt before comparing the code. Parallel guesses share the same five-attempt budget.
      const attempted = await tx.emailChallenge.updateMany({
        where: { id: challengeId, email, origin, delivered: true, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: EMAIL_MAX_ATTEMPTS } },
        data: { attempts: { increment: 1 } },
      });
      if (attempted.count !== 1) return null;
      const challenge = await tx.emailChallenge.findUnique({ where: { id: challengeId } });
      if (!challenge || !emailCodeMatches(challenge.codeHash, { challengeId, email, origin, code })) return null;
      const consumed = await tx.emailChallenge.updateMany({
        where: { id: challengeId, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now },
      });
      if (consumed.count !== 1) return null;
      const account = await tx.user.upsert({
        where: { email },
        create: { email, emailVerifiedAt: now },
        update: { emailVerifiedAt: now },
        select: { id: true, email: true },
      });
      if (oldToken && /^[a-f0-9]{64}$/.test(oldToken)) {
        await tx.emailSession.deleteMany({ where: { tokenHash: hashSessionToken(oldToken) } });
      }
      if (walletToken && /^[a-f0-9]{64}$/.test(walletToken)) {
        await tx.walletSession.deleteMany({ where: { tokenHash: hashSessionToken(walletToken) } });
      }
      await tx.emailSession.create({
        data: { userId: account.id, tokenHash: hashSessionToken(token), expiresAt: new Date(now.getTime() + EMAIL_SESSION_SECONDS * 1000) },
      });
      return account;
    });
    if (!user) return NextResponse.json({ error: invalidMessage }, { status: 400, headers });
    const response = NextResponse.json({ user, isAuthenticated: true }, { headers });
    setEmailSessionCookie(response, token);
    clearWalletSessionCookie(response);
    return response;
  } catch {
    return NextResponse.json({ error: "Email sign-in is unavailable. Please try again." }, { status: 503, headers });
  }
}
