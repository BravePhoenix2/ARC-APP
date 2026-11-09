import { secureSessionCookie } from "@/lib/sessionCookie";
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
type VerifiedAccounts = Pick<VerifiedPrivyIdentity, "email" | "verifiedEmails" | "walletAddresses">;
type ProfileLookup = { promise: Promise<VerifiedAccounts>; cacheable: boolean };
const profileCache = new Map<string, { accounts: VerifiedAccounts; expiresAt: number }>();
const profileLookups = new Map<string, ProfileLookup>();
const PROFILE_CACHE_MS = 30_000;
const PROFILE_CACHE_LIMIT = 256;

function privyClientId(): string | undefined {
  const value = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID?.trim();
  return value && /^[a-zA-Z0-9_-]{8,128}$/.test(value) ? value : undefined;
}

function copyVerifiedAccounts(accounts: VerifiedAccounts): VerifiedAccounts {
  return { email: accounts.email, verifiedEmails: [...accounts.verifiedEmails], walletAddresses: [...accounts.walletAddresses] };
}

function profileKey(accessToken: string, appId: string, subject: string, clientId = privyClientId()): string {
  return JSON.stringify([appId, clientId ?? "", subject, hashToken(accessToken)]);
}

function invalidateProfile(key: string): void {
  profileCache.delete(key);
  // A lookup started before a link/unlink must not repopulate a stale snapshot.
  const previous = profileLookups.get(key);
  if (previous) previous.cacheable = false;
  profileLookups.delete(key);
}

type VerificationDiagnostic = {
  stage: "jwks" | "access-token" | "identity-token" | "current-user";
  reason: "key-lookup" | "invalid-token" | "network" | "timeout" | "http-status" | "oversized" | "missing-body" | "invalid-json" | "invalid-profile";
  upstreamStatus?: number;
  retryAfterSeconds?: number;
  networkCode?: string;
};

class PrivyVerificationUnavailable extends Error {
  constructor(readonly diagnostic: VerificationDiagnostic) { super("PRIVY_VERIFICATION_UNAVAILABLE"); }
}

const NETWORK_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT", "CERT_HAS_EXPIRED"]);
function networkDiagnostic(error: unknown): Pick<VerificationDiagnostic, "reason" | "networkCode"> {
  const value = error && typeof error === "object" ? error as { name?: unknown; cause?: { code?: unknown } } : null;
  const code = value?.cause?.code;
  return {
    reason: value?.name === "TimeoutError" || value?.name === "AbortError" || value?.name === "JWKSTimeout" ? "timeout" : "network",
    ...(typeof code === "string" && NETWORK_CODES.has(code) ? { networkCode: code } : {}),
  };
}

/** Only metadata constructed here is logged; never serialize a provider error or response. */
export function privyVerificationDiagnostic(error: unknown): VerificationDiagnostic {
  if (error instanceof PrivyVerificationUnavailable) return error.diagnostic;
  return { stage: "access-token", reason: "invalid-token" };
}

/** Safe diagnostic codes; never return or log the JWT, linked accounts, or provider error text. */
export function privyVerificationFailureCode(error: unknown): "PRIVY_NOT_CONFIGURED" | "PRIVY_VERIFICATION_UNAVAILABLE" | "INVALID_PRIVY_TOKEN" {
  if (error instanceof Error && error.message === "PRIVY_NOT_CONFIGURED") return "PRIVY_NOT_CONFIGURED";
  if (error instanceof Error && error.message === "PRIVY_VERIFICATION_UNAVAILABLE") return "PRIVY_VERIFICATION_UNAVAILABLE";
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  // A timeout, invalid/unavailable JWKS response, or failed HTTPS fetch is an
  // upstream verification problem, rather than proof that the user's JWT is bad.
  if (typeof code === "string" && ["ERR_JWKS_TIMEOUT", "ERR_JWKS_INVALID", "ERR_JOSE_GENERIC"].includes(code)) return "PRIVY_VERIFICATION_UNAVAILABLE";
  if (error instanceof TypeError && error.message === "fetch failed") return "PRIVY_VERIFICATION_UNAVAILABLE";
  return "INVALID_PRIVY_TOKEN";
}

/**
 * This is the fixed RefreshUser endpoint used by @privy-io/js-sdk-core. It
 * authenticates the user's access token, without an app secret or dashboard
 * identity-token flag. No client-supplied user object or URL is accepted.
 */
async function currentPrivyAccounts(accessToken: string, appId: string, subject: string, clientId?: string): Promise<unknown[]> {
  let response: Response;
  try {
    response = await fetch("https://auth.privy.io/api/v1/users/me", {
      method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8_000),
      headers: {
        Authorization: `Bearer ${accessToken}`, "privy-app-id": appId, Accept: "application/json",
        ...(clientId ? { "privy-client-id": clientId } : {}),
      },
    });
  } catch (error) {
    throw new PrivyVerificationUnavailable({ stage: "current-user", ...networkDiagnostic(error) });
  }
  if (response.status === 401 || response.status === 403) throw new Error("INVALID_PRIVY_TOKEN");
  if (!response.ok) {
    const retryAfter = response.headers.get("retry-after");
    const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter)
      : retryAfter ? Math.ceil((Date.parse(retryAfter) - Date.now()) / 1000) : NaN;
    await response.body?.cancel();
    throw new PrivyVerificationUnavailable({
      stage: "current-user", reason: "http-status", upstreamStatus: response.status,
      ...(response.status === 429 ? { retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? Math.min(300, seconds) : 30 } : {}),
    });
  }
  // Bound both advertised and streamed JSON before parsing the upstream profile.
  const limit = 65_536;
  if (Number(response.headers.get("content-length")) > limit || !response.body) {
    await response.body?.cancel();
    throw new PrivyVerificationUnavailable({ stage: "current-user", reason: response.body ? "oversized" : "missing-body" });
  }
  const reader = response.body.getReader();
  let profile: unknown;
  try {
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new PrivyVerificationUnavailable({ stage: "current-user", reason: "oversized" });
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    profile = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof PrivyVerificationUnavailable) throw error;
    throw new PrivyVerificationUnavailable({ stage: "current-user", ...(error instanceof SyntaxError ? { reason: "invalid-json" as const } : networkDiagnostic(error)) });
  } finally { reader.releaseLock(); }
  if (!profile || typeof profile !== "object" || Array.isArray(profile) || !("user" in profile)) throw new PrivyVerificationUnavailable({ stage: "current-user", reason: "invalid-profile" });
  const user = profile.user;
  if (!user || typeof user !== "object" || Array.isArray(user) || !("id" in user) || user.id !== subject || !("linked_accounts" in user) || !Array.isArray(user.linked_accounts)) {
    throw new Error("INVALID_PRIVY_TOKEN");
  }
  return user.linked_accounts;
}

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

function verifiedAccounts(accounts: unknown): VerifiedAccounts {
  if (!Array.isArray(accounts) || accounts.length > 100) throw new Error("INVALID_PRIVY_TOKEN");
  const now = Math.floor(Date.now() / 1_000);
  const emails: string[] = [];
  const wallets: string[] = [];
  for (const account of accounts) {
    if (!account || typeof account !== "object" || Array.isArray(account)) continue;
    const linked = account as Record<string, unknown>;
    // Identity tokens use `lv`; the full linked-account representation uses `verified_at`.
    const verifiedAt = linked.lv ?? linked.latest_verified_at ?? linked.verified_at;
    if (typeof verifiedAt !== "number" || !Number.isSafeInteger(verifiedAt) || verifiedAt <= 0 || verifiedAt > now + 30) continue;
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
  return { email: emails[0] ?? null, verifiedEmails: emails, walletAddresses: wallets };
}

/** Called only after access-token verification; cached claims never authenticate a JWT. */
async function currentPrivyIdentity(accessToken: string, appId: string, subject: string, tokenExpiresAt: number, forceRefresh: boolean): Promise<VerifiedAccounts> {
  const clientId = privyClientId();
  const key = profileKey(accessToken, appId, subject, clientId);
  const now = Date.now();
  for (const [cachedKey, entry] of profileCache) {
    if (entry.expiresAt <= now) profileCache.delete(cachedKey);
  }
  if (forceRefresh) {
    invalidateProfile(key);
  } else {
    const cached = profileCache.get(key);
    if (cached) return copyVerifiedAccounts(cached.accounts);
    const pending = profileLookups.get(key);
    if (pending) return copyVerifiedAccounts(await pending.promise);
  }
  const load = async () => {
    const accounts = verifiedAccounts(await currentPrivyAccounts(accessToken, appId, subject, clientId));
    if (tokenExpiresAt <= Date.now()) throw new Error("INVALID_PRIVY_TOKEN");
    return accounts;
  };
  // Keep retained memory bounded even under many distinct valid-token requests.
  if (!profileLookups.has(key) && profileLookups.size >= PROFILE_CACHE_LIMIT) return load();
  const lookup: ProfileLookup = { promise: Promise.resolve().then(load), cacheable: true };
  profileLookups.set(key, lookup);
  try {
    const accounts = await lookup.promise;
    if (lookup.cacheable && profileLookups.get(key) === lookup) {
      while (profileCache.size >= PROFILE_CACHE_LIMIT) profileCache.delete(profileCache.keys().next().value!);
      profileCache.set(key, { accounts: copyVerifiedAccounts(accounts), expiresAt: Math.min(Date.now() + PROFILE_CACHE_MS, tokenExpiresAt) });
    }
    return copyVerifiedAccounts(accounts);
  } finally {
    if (profileLookups.get(key) === lookup) profileLookups.delete(key);
  }
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

/** A signed access token authenticates the DID; signed identity claims or Privy's authenticated API prove linked accounts. */
export async function verifyPrivyTokens(
  input: { accessToken: string; identityToken?: string | null; forceProfileRefresh?: boolean },
  verificationKey?: JWTVerifyGetKey,
  onVerifiedSubject?: (privyDid: string) => Promise<void>,
): Promise<VerifiedPrivyIdentity> {
  const appId = getPrivyAppId();
  if (!appId) throw new Error("PRIVY_NOT_CONFIGURED");
  if (typeof input.accessToken !== "string" || !input.accessToken || input.accessToken.length > 16_000 ||
      (input.identityToken !== undefined && input.identityToken !== null && (typeof input.identityToken !== "string" || input.identityToken.length > 24_000))) {
    throw new Error("INVALID_PRIVY_TOKEN");
  }
  const keys = verificationKey ?? privyKeys(appId);
  const options = {
    algorithms: ["ES256"], issuer: "privy.io", audience: appId,
    requiredClaims: ["iss", "aud", "sub", "iat", "exp"],
  };
  // Verify before making the profile request: forged tokens must never reach
  // the upstream API or authorize a linked email supplied by the browser.
  const verifyToken = async (token: string) => {
    try { return await jwtVerify(token, keys, options); }
    catch (error) {
      if (privyVerificationFailureCode(error) === "PRIVY_VERIFICATION_UNAVAILABLE") {
        throw new PrivyVerificationUnavailable({ stage: "jwks", ...networkDiagnostic(error) });
      }
      // Token failures keep their existing classification; diagnostics contain no claims.
      throw error;
    }
  };
  const access = await verifyToken(input.accessToken);
  const now = Math.floor(Date.now() / 1_000);
  const validateClaims = ({ payload }: typeof access) => {
    if (typeof payload.sub !== "string" || !/^did:privy:[a-zA-Z0-9:_-]{1,160}$/.test(payload.sub) ||
        !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) ||
        payload.iat! > now + 30 || payload.exp! <= payload.iat!) throw new Error("INVALID_PRIVY_TOKEN");
  };
  validateClaims(access);
  if (typeof access.payload.sid !== "string" || !access.payload.sid) throw new Error("INVALID_PRIVY_TOKEN");
  // A verified DID can acquire its abuse budget before any provider profile read.
  await onVerifiedSubject?.(access.payload.sub!);
  let accounts: VerifiedAccounts;
  let identityExpiresAt = access.payload.exp!;
  if (input.identityToken) {
    // A supplied but invalid identity token cannot be hidden by an API fallback.
    const identity = await verifyToken(input.identityToken);
    validateClaims(identity);
    if (access.payload.sub !== identity.payload.sub || typeof identity.payload.linked_accounts !== "string") throw new Error("INVALID_PRIVY_TOKEN");
    accounts = verifiedAccounts(JSON.parse(identity.payload.linked_accounts));
    identityExpiresAt = identity.payload.exp!;
    if (input.forceProfileRefresh === true) invalidateProfile(profileKey(input.accessToken, appId, access.payload.sub!));
  } else {
    accounts = await currentPrivyIdentity(input.accessToken, appId, access.payload.sub!, access.payload.exp! * 1_000, input.forceProfileRefresh === true);
  }
  const expiresAt = new Date(Math.min(access.payload.exp!, identityExpiresAt, now + PRIVY_SESSION_SECONDS) * 1_000);
  if (expiresAt.getTime() <= Date.now()) throw new Error("INVALID_PRIVY_TOKEN");
  return {
    privyDid: access.payload.sub!, ...accounts,
    expiresAt,
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

/** An active wallet is accepted only when present in the verified Privy identity snapshot. */
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
    httpOnly: true, sameSite: "lax", secure: secureSessionCookie(), path: "/",
    expires: expiresAt, maxAge: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1_000)),
  });
}

export function clearPrivySessionCookie(response: NextResponse): void {
  response.cookies.set(PRIVY_SESSION_COOKIE, "", {
    httpOnly: true, sameSite: "lax", secure: secureSessionCookie(), path: "/", maxAge: 0,
  });
}
