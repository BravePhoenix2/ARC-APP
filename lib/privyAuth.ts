import { createHash } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { getAddress, isAddress } from "viem";
import { prisma } from "@/lib/prisma";

export const PRIVY_SESSION_COOKIE = "artiq_privy_session";
export const PRIVY_SESSION_SECONDS = 60 * 60;

export type VerifiedPrivyIdentity = {
  privyDid: string;
  email: string | null;
  verifiedEmails: string[];
  walletAddresses: string[];
  expiresAt: Date;
};
export type PrivySession = {
  userId: string;
  privyDid: string;
  email: string | null;
  walletAddresses: string[];
  expiresAt: Date;
};

const verificationKeys = new Map<string, JWTVerifyGetKey>();
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function getPrivyAppId(): string | null {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  return appId && /^[a-zA-Z0-9_-]{8,128}$/.test(appId) ? appId : null;
}

function walletAddress(value: unknown): string | null {
  return typeof value === "string" && value.length === 42 && isAddress(value)
    ? getAddress(value).toLowerCase() : null;
}

// Keep this module independent of the legacy auth helpers: walletAuth also reads Privy sessions.
function emailAddress(value: unknown): string | null {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || /\s/.test(email)) return null;
  const parts = email.split("@");
  if (parts.length !== 2) return null;
  const [local, domain] = parts;
  if (!local || local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..") ||
      !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return null;
  const labels = domain.split(".");
  return labels.length >= 2 && labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ? email : null;
}

/** Only Privy's fixed HTTPS JWKS origin can supply verification keys. No token-controlled URLs. */
function privyKeys(appId: string): JWTVerifyGetKey {
  let keys = verificationKeys.get(appId);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${appId}/jwks.json`), {
      timeoutDuration: 5_000,
      cooldownDuration: 60_000,
      cacheMaxAge: 60 * 60 * 1_000,
    });
    verificationKeys.set(appId, keys);
  }
  return keys;
}

/** A signed access token authenticates the DID; a separately signed identity token proves linked accounts. */
export async function verifyPrivyTokens(
  input: { accessToken: string; identityToken: string },
  verificationKey?: JWTVerifyGetKey,
): Promise<VerifiedPrivyIdentity> {
  const appId = getPrivyAppId();
  if (!appId) throw new Error("PRIVY_NOT_CONFIGURED");
  if (typeof input.accessToken !== "string" || typeof input.identityToken !== "string" ||
      !input.accessToken || !input.identityToken || input.accessToken.length > 16_000 || input.identityToken.length > 24_000) {
    throw new Error("INVALID_PRIVY_TOKEN");
  }
  const keys = verificationKey ?? privyKeys(appId);
  const options = {
    algorithms: ["ES256"], issuer: "privy.io", audience: appId,
    requiredClaims: ["iss", "aud", "sub", "iat", "exp"],
  };
  const [access, identity] = await Promise.all([
    jwtVerify(input.accessToken, keys, options),
    jwtVerify(input.identityToken, keys, options),
  ]);
  const now = Math.floor(Date.now() / 1_000);
  for (const { payload } of [access, identity]) {
    if (typeof payload.sub !== "string" || !/^did:privy:[a-zA-Z0-9:_-]{1,160}$/.test(payload.sub) ||
        !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) ||
        payload.iat! > now + 30 || payload.exp! <= payload.iat!) throw new Error("INVALID_PRIVY_TOKEN");
  }
  if (access.payload.sub !== identity.payload.sub || typeof access.payload.sid !== "string" || !access.payload.sid ||
      typeof identity.payload.linked_accounts !== "string") throw new Error("INVALID_PRIVY_TOKEN");
  const accounts: unknown = JSON.parse(identity.payload.linked_accounts);
  if (!Array.isArray(accounts) || accounts.length > 100) throw new Error("INVALID_PRIVY_TOKEN");
  const emails: string[] = [];
  const wallets: string[] = [];
  for (const account of accounts) {
    if (!account || typeof account !== "object" || Array.isArray(account)) continue;
    const linked = account as Record<string, unknown>;
    // Identity tokens use `lv`; the full linked-account representation uses `verified_at`.
    const verifiedAt = linked.lv ?? linked.verified_at;
    if (typeof verifiedAt !== "number" || !Number.isFinite(verifiedAt) || verifiedAt <= 0 || verifiedAt > now + 30) continue;
    if (linked.type === "email") {
      const email = emailAddress(linked.address);
      if (email && !emails.includes(email)) emails.push(email);
    }
    if (linked.type === "wallet" && linked.chain_type === "ethereum" && linked.user_can_sign !== false) {
      const wallet = walletAddress(linked.address);
      if (wallet && !wallets.includes(wallet)) wallets.push(wallet);
    }
  }
  if (!emails.length && !wallets.length) throw new Error("PRIVY_IDENTITY_REQUIRED");
  return {
    privyDid: identity.payload.sub!, email: emails[0] ?? null, verifiedEmails: emails, walletAddresses: wallets,
    expiresAt: new Date(Math.min(access.payload.exp!, identity.payload.exp!, now + PRIVY_SESSION_SECONDS) * 1_000),
  };
}

export async function getPrivySession(request: NextRequest): Promise<PrivySession | null> {
  const token = request.cookies.get(PRIVY_SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session = await prisma.privySession.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      userId: true, privyDid: true, verifiedEmail: true, walletAddresses: true, expiresAt: true,
      user: { select: { privyId: true } },
    },
  });
  if (!session || session.expiresAt <= new Date() || session.user.privyId !== session.privyDid || !Array.isArray(session.walletAddresses)) return null;
  const wallets = session.walletAddresses.flatMap((value) => { const wallet = walletAddress(value); return wallet ? [wallet] : []; });
  return {
    userId: session.userId, privyDid: session.privyDid, email: session.verifiedEmail,
    walletAddresses: Array.from(new Set(wallets)), expiresAt: session.expiresAt,
  };
}

/** An active wallet is accepted only when present in the signed identity snapshot. */
export function selectPrivyWallet(request: NextRequest, session: PrivySession): string | null {
  const requested = request.headers.get("x-wallet-address");
  if (requested !== null) {
    const wallet = walletAddress(requested);
    return wallet && session.walletAddresses.includes(wallet) ? wallet : null;
  }
  return session.walletAddresses[0] ?? null;
}

export async function revokePrivySession(request: NextRequest): Promise<void> {
  const token = request.cookies.get(PRIVY_SESSION_COOKIE)?.value;
  if (token && /^[a-f0-9]{64}$/.test(token)) await prisma.privySession.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export function setPrivySessionCookie(response: NextResponse, token: string, expiresAt: Date): void {
  response.cookies.set(PRIVY_SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/",
    expires: expiresAt, maxAge: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1_000)),
  });
}

export function clearPrivySessionCookie(response: NextResponse): void {
  response.cookies.set(PRIVY_SESSION_COOKIE, "", {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0,
  });
}
