import { randomBytes, randomInt } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { EMAIL_CHALLENGE_SECONDS, hashEmailCode, normalizeEmail } from "@/lib/emailAuth";
import { prisma } from "@/lib/prisma";
import { getPrivyAppId } from "@/lib/privyAuth";
import { isEmailConfigured, sendSignInEmail } from "@/lib/sendEmail";
import { readAuthBody, sameOrigin, walletRequestOrigin } from "@/lib/walletAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const globalForEmail = globalThis as unknown as { artiqEmailDelivery?: { active: number } };
const delivery = globalForEmail.artiqEmailDelivery ?? (globalForEmail.artiqEmailDelivery = { active: 0 });
const headers = { "Cache-Control": "no-store" };

class EmailRateLimit extends Error {
  constructor(readonly retryAfter: number) { super("Too many email sign-in requests."); }
}

export async function GET() {
  return NextResponse.json({ available: !getPrivyAppId() && isEmailConfigured() }, { headers });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "This request must come from Artiq." }, { status: 403, headers });
  }
  if (getPrivyAppId()) {
    return NextResponse.json({ error: "Use the Sign in button to continue with email or your wallet.", code: "USE_PRIVY_LOGIN" }, { status: 409, headers });
  }
  const body = await readAuthBody(request);
  const email = normalizeEmail(body?.email);
  if (!email) return NextResponse.json({ error: "Enter one valid email address." }, { status: 400, headers });
  if (!isEmailConfigured()) {
    return NextResponse.json({ error: "Email sign-in is not configured yet. Please use a wallet for now." }, { status: 503, headers });
  }
  if (delivery.active >= 2) {
    return NextResponse.json({ error: "Email delivery is busy. Please try again shortly." }, { status: 429, headers: { ...headers, "Retry-After": "5" } });
  }

  delivery.active += 1;
  const challengeId = randomBytes(24).toString("hex");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const origin = walletRequestOrigin(request);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + EMAIL_CHALLENGE_SECONDS * 1000);
  let reserved = false;
  try {
    const codeHash = hashEmailCode({ challengeId, email, origin, code });
    await prisma.$transaction(async (tx) => {
      const latest = await tx.emailChallenge.findFirst({ where: { email }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
      const remaining = latest ? Math.ceil((latest.createdAt.getTime() + 60_000 - now.getTime()) / 1000) : 0;
      if (remaining > 0) throw new EmailRateLimit(remaining);
      const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      if (await tx.emailChallenge.count({ where: { email, createdAt: { gt: hourAgo } } }) >= 5) throw new EmailRateLimit(3600);
      if (await tx.emailChallenge.count({ where: { createdAt: { gt: hourAgo } } }) >= 100) throw new EmailRateLimit(3600);
      if (await tx.emailChallenge.count({ where: { createdAt: { gt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } }) >= 300) throw new EmailRateLimit(3600);
      // Failed sends also consume the rate budget; prune only a bounded batch of old records.
      const stale = await tx.emailChallenge.findMany({
        where: { createdAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) }, expiresAt: { lt: now } },
        select: { id: true }, take: 100,
      });
      if (stale.length) await tx.emailChallenge.deleteMany({ where: { id: { in: stale.map((record) => record.id) } } });
      await tx.emailChallenge.create({ data: { id: challengeId, email, origin, codeHash, expiresAt, createdAt: now } });
    });
    reserved = true;
    await sendSignInEmail({ email, code, origin });
    const delivered = await prisma.$transaction(async (tx) => {
      const sentAt = new Date();
      const current = await tx.emailChallenge.updateMany({
        where: { id: challengeId, consumedAt: null, expiresAt: { gt: sentAt } }, data: { delivered: true },
      });
      if (current.count !== 1) return false;
      // A successful resend replaces older codes. A delayed older delivery cannot revoke a newer one.
      await tx.emailChallenge.updateMany({
        where: { email, origin, id: { not: challengeId }, consumedAt: null, createdAt: { lte: now } },
        data: { consumedAt: sentAt },
      });
      return true;
    });
    if (!delivered) throw new Error("Email sign-in request expired.");
    return NextResponse.json({ challengeId, email, expiresAt: expiresAt.toISOString(), resendAfter: 60 }, { headers });
  } catch (error) {
    if (error instanceof EmailRateLimit) {
      return NextResponse.json({ error: "Too many requests. Please wait before sending another code." }, { status: 429, headers: { ...headers, "Retry-After": String(error.retryAfter) } });
    }
    if (reserved) {
      await prisma.emailChallenge.updateMany({ where: { id: challengeId }, data: { delivered: false, consumedAt: new Date() } }).catch(() => undefined);
    }
    return NextResponse.json({ error: "We could not send your code. Please try again later or use a wallet." }, { status: 503, headers });
  } finally {
    delivery.active -= 1;
  }
}
