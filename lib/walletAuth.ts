import { createHash, randomBytes } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { arcChain } from "@/lib/arcConfig";
import { prisma } from "@/lib/prisma";
import { PRIVY_SESSION_COOKIE, getPrivySession, selectPrivyWallet } from "@/lib/privyAuth";

export const WALLET_SESSION_COOKIE = "artiq_wallet_session";
export const WALLET_SESSION_SECONDS = 24 * 60 * 60;
export const WALLET_CHALLENGE_SECONDS = 5 * 60;

export type WalletSession = { walletAddress: string; isAdmin: boolean };

function parseHttpOrigin(value: string | null | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

export function walletRequestOrigin(request: NextRequest): string {
  // Next may normalize a loopback address in its Request URL.
  // Only explicit app configuration or local development aliases may differ.
  const actual = new URL(request.url);
  const browser = parseHttpOrigin(request.headers.get("origin"));
  if (!browser) return actual.origin;
  const configured = parseHttpOrigin(process.env.ARTIQ_APP_ORIGIN || process.env.NEXT_PUBLIC_APP_URL);
  if (browser.origin === actual.origin || browser.origin === configured?.origin) return browser.origin;
  const isLoopback = (url: URL) => ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (process.env.NODE_ENV !== "production" && isLoopback(actual) && isLoopback(browser) &&
      actual.protocol === browser.protocol && actual.port === browser.port) {
    return browser.origin;
  }
  return actual.origin;
}

/** Require the actual or explicitly configured app origin; never trust Host headers. */
export function sameOrigin(request: NextRequest): boolean {
  const origin = parseHttpOrigin(request.headers.get("origin"));
  return Boolean(origin && origin.origin === walletRequestOrigin(request));
}

export function normalizeWalletAddress(value: unknown): string | null {
  return typeof value === "string" && value.length === 42 && isAddress(value)
    ? getAddress(value).toLowerCase()
    : null;
}

export function isAdminWallet(walletAddress: string): boolean {
  const address = normalizeWalletAddress(walletAddress);
  if (!address) return false;
  return (process.env.ARTIQ_ADMIN_WALLETS ?? "")
    .split(",")
    .some((value) => normalizeWalletAddress(value.trim()) === address);
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newAuthToken(): string {
  return randomBytes(32).toString("hex");
}

export function createWalletMessage(input: {
  origin: string;
  walletAddress: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}): string {
  const origin = new URL(input.origin);
  return [
    `${origin.host} wants you to sign in with your Ethereum account:`,
    getAddress(input.walletAddress),
    "",
    "Sign in to Artiq to submit your artwork and manage your applications. This signature does not send a transaction or cost gas.",
    "",
    `URI: ${origin.origin}`,
    "Version: 1",
    `Chain ID: ${arcChain.id}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt.toISOString()}`,
    `Expiration Time: ${input.expiresAt.toISOString()}`,
  ].join("\n");
}

export async function getWalletSession(request: NextRequest): Promise<WalletSession | null> {
  // A Privy session is authoritative. An invalid session must never fall back to a legacy wallet cookie.
  if (request.cookies.get(PRIVY_SESSION_COOKIE)) {
    const session = await getPrivySession(request);
    if (!session || request.headers.get("x-artiq-account-id") !== session.userId) return null;
    const wallet = selectPrivyWallet(request, session);
    return wallet ? { walletAddress: wallet, isAdmin: isAdminWallet(wallet) } : null;
  }
  const token = request.cookies.get(WALLET_SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session = await prisma.walletSession.findUnique({
    where: { tokenHash: hashSessionToken(token) },
  });
  if (!session || session.expiresAt <= new Date()) return null;
  return { walletAddress: session.walletAddress, isAdmin: isAdminWallet(session.walletAddress) };
}

export const authorizeWallet = getWalletSession;

export function setWalletSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(WALLET_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: WALLET_SESSION_SECONDS,
  });
}

export function clearWalletSessionCookie(response: NextResponse): void {
  response.cookies.set(WALLET_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

/** Bound reads as well as parsed fields so malformed requests cannot fill memory. */
export async function readAuthBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  const limit = 4096;
  if (Number(request.headers.get("content-length")) > limit || !request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}
