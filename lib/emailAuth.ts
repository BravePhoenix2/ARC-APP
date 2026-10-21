import { secureSessionCookie } from "@/lib/sessionCookie";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashSessionToken } from "@/lib/walletAuth";

export const EMAIL_SESSION_COOKIE = "artiq_email_session";
export const EMAIL_SESSION_SECONDS = 24 * 60 * 60;
export const EMAIL_CHALLENGE_SECONDS = 10 * 60;
export const EMAIL_MAX_ATTEMPTS = 5;

export type EmailSession = { userId: string; email: string };

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || /\s/.test(email)) return null;
  const parts = email.split("@");
  if (parts.length !== 2) return null;
  const [local, domain] = parts;
  if (!local || local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..") ||
      !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return null;
  const labels = domain.split(".");
  if (labels.length < 2 || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
  return email;
}

export function hashEmailCode(input: { challengeId: string; email: string; origin: string; code: string }): string {
  const secret = process.env.ARTIQ_EMAIL_CODE_SECRET;
  if (!secret || secret.length < 32) throw new Error("Email sign-in is not configured.");
  return createHmac("sha256", secret)
    .update([input.challengeId, input.email, input.origin, input.code].join("\0"))
    .digest("hex");
}

export function emailCodeMatches(expectedHash: string, input: Parameters<typeof hashEmailCode>[0]): boolean {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  return timingSafeEqual(Buffer.from(expectedHash, "hex"), Buffer.from(hashEmailCode(input), "hex"));
}

export async function getEmailSession(request: NextRequest): Promise<EmailSession | null> {
  const token = request.cookies.get(EMAIL_SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session = await prisma.emailSession.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    select: { expiresAt: true, user: { select: { id: true, email: true, emailVerifiedAt: true } } },
  });
  if (!session || session.expiresAt <= new Date() || !session.user.email || !session.user.emailVerifiedAt) return null;
  return { userId: session.user.id, email: session.user.email };
}

export async function revokeEmailSession(request: NextRequest): Promise<void> {
  const token = request.cookies.get(EMAIL_SESSION_COOKIE)?.value;
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    await prisma.emailSession.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
  }
}

export function setEmailSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(EMAIL_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureSessionCookie(),
    path: "/",
    maxAge: EMAIL_SESSION_SECONDS,
  });
}

export function clearEmailSessionCookie(response: NextResponse): void {
  response.cookies.set(EMAIL_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: secureSessionCookie(),
    path: "/",
    maxAge: 0,
  });
}
