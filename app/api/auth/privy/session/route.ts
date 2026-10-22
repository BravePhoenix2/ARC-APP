import { protectAccount, withAbuseProtection } from "@/lib/abuseProtection";
import { NextRequest, NextResponse } from "next/server";
import { getAddress } from "viem";
import { EMAIL_SESSION_COOKIE, clearEmailSessionCookie, getEmailSession } from "@/lib/emailAuth";
import {
  PRIVY_SESSION_COOKIE, clearPrivySessionCookie, getPrivyAppId, getPrivySession,
  privyVerificationDiagnostic, privyVerificationFailureCode, selectPrivyWallet, setPrivySessionCookie, verifyPrivyTokens,
  type PrivySession, type VerifiedPrivyIdentity,
} from "@/lib/privyAuth";
import { prisma } from "@/lib/prisma";
import { limitedJson } from "@/lib/requestBody";
import { ensureTesterProfile } from "@/lib/testerLeaderboard";
import { isReviewerEmail } from "@/lib/reviewerAuth";
import {
  WALLET_SESSION_COOKIE, clearWalletSessionCookie, getWalletSession, hashSessionToken,
  newAuthToken, sameOrigin,
} from "@/lib/walletAuth";
import type { Prisma } from "@/lib/generated/prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
type Candidate = { id: string; email: string | null; emailVerifiedAt: Date | null; walletAddress: string | null; privyId: string | null };
const selectCandidate = { id: true, email: true, emailVerifiedAt: true, walletAddress: true, privyId: true } as const;

class LoginThrottled extends Error {
  constructor(readonly response: NextResponse) { super("LOGIN_THROTTLED"); }
}

class AccountSelection extends Error {
  constructor(public accounts: Array<{ id: string; label: string }>) { super("ACCOUNT_SELECTION_REQUIRED"); }
}

function sessionBody(request: NextRequest, session: PrivySession) {
  const wallet = selectPrivyWallet(request, session);
  return {
    user: {
      id: session.userId, email: session.email, walletAddress: wallet,
      walletAddresses: session.walletAddresses, authMethod: "PRIVY" as const,
      isAdmin: isReviewerEmail(session.email),
    },
    expiresAt: session.expiresAt.toISOString(),
  };
}

function label(account: Candidate): string {
  if (account.email && account.emailVerifiedAt) return "Email account";
  return account.walletAddress ? `${account.walletAddress.slice(0, 6)}…${account.walletAddress.slice(-4)}` : "Artiq account";
}

/** Existing records stay separate. A signed linked identity can select one account, never combine their data. */
async function resolveAccount(
  tx: Prisma.TransactionClient,
  identity: VerifiedPrivyIdentity,
  currentLegacyAccountId: string | null,
  preferredAccountId: string | undefined,
) {
  const bound = await tx.user.findUnique({ where: { privyId: identity.privyDid }, select: selectCandidate });
  if (bound) {
    if (preferredAccountId && preferredAccountId !== bound.id) throw new Error("PRIVY_ACCOUNT_ALREADY_BOUND");
    return bound;
  }
  const walletVariants = Array.from(new Set(identity.walletAddresses.flatMap((address) => [address, getAddress(address)])));
  const candidates = await tx.user.findMany({
    where: { OR: [
      ...(identity.verifiedEmails.length ? [{ email: { in: identity.verifiedEmails }, emailVerifiedAt: { not: null } }] : []),
      ...(walletVariants.length ? [{ walletAddress: { in: walletVariants } }] : []),
    ] },
    select: selectCandidate,
  });
  let selected: Candidate | undefined;
  if (preferredAccountId) {
    selected = candidates.find((candidate) => candidate.id === preferredAccountId);
    if (!selected) throw new Error("INVALID_ACCOUNT_SELECTION");
  } else if (candidates.length > 1) {
    selected = candidates.find((candidate) => candidate.id === currentLegacyAccountId);
    if (!selected) throw new AccountSelection(candidates.map((account) => ({ id: account.id, label: label(account) })));
  } else {
    selected = candidates[0];
  }
  if (selected) {
    if (selected.privyId && selected.privyId !== identity.privyDid) throw new Error("PRIVY_ACCOUNT_ALREADY_BOUND");
    // A conditional write ensures parallel first sign-ins cannot attach two Privy DIDs to the same account.
    const claimed = await tx.user.updateMany({
      where: { id: selected.id, privyId: null }, data: { privyId: identity.privyDid },
    });
    if (claimed.count !== 1) throw new Error("PRIVY_ACCOUNT_ALREADY_BOUND");
    return { ...selected, privyId: identity.privyDid };
  }
  // An unverified contact email never grants ownership of an older account.
  // If it occupies the unique field, keep this new account's verified email in its signed session instead.
  const emailOwner = identity.email ? await tx.user.findUnique({ where: { email: identity.email }, select: { id: true } }) : null;
  const wallet = identity.walletAddresses[0] ?? null;
  const walletOwner = wallet ? await tx.user.findFirst({ where: { walletAddress: { in: [wallet, getAddress(wallet)] } }, select: { id: true } }) : null;
  return tx.user.create({
    data: {
      privyId: identity.privyDid,
      ...(!emailOwner && identity.email ? { email: identity.email, emailVerifiedAt: new Date() } : {}),
      ...(!walletOwner && wallet ? { walletAddress: wallet } : {}),
    },
    select: selectCandidate,
  });
}

async function oldLegacyAccount(request: NextRequest, identity: VerifiedPrivyIdentity): Promise<string | null> {
  const email = await getEmailSession(request);
  if (email && identity.verifiedEmails.includes(email.email)) return email.userId;
  const wallet = await getWalletSession(request);
  if (wallet && identity.walletAddresses.includes(wallet.walletAddress.toLowerCase())) {
    return (await prisma.user.findUnique({ where: { walletAddress: wallet.walletAddress }, select: { id: true } }))?.id ?? null;
  }
  return null;
}

async function revokeRequestSessions(tx: Prisma.TransactionClient, request: NextRequest): Promise<void> {
  // Each model has the same tokenHash filter; keep calls distinct for Prisma's model-specific overloads.
  for (const cookie of [PRIVY_SESSION_COOKIE, EMAIL_SESSION_COOKIE, WALLET_SESSION_COOKIE]) {
    const token = request.cookies.get(cookie)?.value;
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      const where = { tokenHash: hashSessionToken(token) };
      if (cookie === PRIVY_SESSION_COOKIE) await tx.privySession.deleteMany({ where });
      else if (cookie === EMAIL_SESSION_COOKIE) await tx.emailSession.deleteMany({ where });
      else await tx.walletSession.deleteMany({ where });
    }
  }
}

async function handleGET(request: NextRequest) {
  try {
    const session = await getPrivySession(request);
    // Wallet reconnection and embedded-wallet creation can race a signed identity
    // refresh. This endpoint restores the verified account, not wallet ownership:
    // an unrelated wallet selection must not erase a valid email session.
    if (session) {
      return NextResponse.json(sessionBody(request, session), { headers });
    }
    const response = NextResponse.json({ error: "Sign in to continue." }, { status: 401, headers });
    clearPrivySessionCookie(response);
    return response;
  } catch {
    console.warn("[artiq-auth]", { event: "privy_session_read_failed", code: "PRIVY_SESSION_READ_FAILED" });
    return NextResponse.json({ error: "Sign-in is unavailable. Please try again." }, { status: 503, headers });
  }
}

async function handlePOST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "This request must come from Artiq." }, { status: 403, headers });
  if (!getPrivyAppId()) return NextResponse.json({ error: "Privy sign-in needs to be configured for this app.", code: "PRIVY_NOT_CONFIGURED" }, { status: 503, headers });
  let body: unknown;
  try { body = await limitedJson(request, 32_768, { totalMs: 10_000 }); } catch {
    return NextResponse.json({ error: "Provide a valid sign-in request." }, { status: 400, headers });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Provide a valid sign-in request." }, { status: 400, headers });
  const { accessToken, identityToken, preferredAccountId } = body as Record<string, unknown>;
  if (typeof accessToken !== "string" || !accessToken ||
      (preferredAccountId !== undefined && (typeof preferredAccountId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(preferredAccountId)))) {
    return NextResponse.json({ error: "Provide your current Privy sign-in tokens." }, { status: 400, headers });
  }
  if (identityToken !== undefined && identityToken !== null && typeof identityToken !== "string") return NextResponse.json({ error: "Provide your current Privy sign-in tokens." }, { status: 400, headers });
  let identity: VerifiedPrivyIdentity;
  const verificationStartedAt = Date.now();
  try {
    identity = await verifyPrivyTokens({ accessToken, identityToken }, undefined, async (did) => {
      const limited = await protectAccount("login", did, "auth/privy/session", request);
      if (limited) throw new LoginThrottled(limited);
    });
  } catch (cause) {
    if (cause instanceof LoginThrottled) return cause.response;
    const code = privyVerificationFailureCode(cause);
    console.warn("[artiq-auth]", { event: "privy_session_verification_failed", code, ...privyVerificationDiagnostic(cause), elapsedMs: Date.now() - verificationStartedAt });
    if (code === "PRIVY_VERIFICATION_UNAVAILABLE") {
      return NextResponse.json({ error: "Sign-in verification is temporarily unavailable. Please retry in a moment.", code }, { status: 503, headers });
    }
    return NextResponse.json({ error: "Your sign-in could not be verified. Sign in again and try once more.", code }, { status: 401, headers });
  }
  const requestedWallet = request.headers.get("x-wallet-address");
  // Retain the validated active wallet first for cookie-only ownership reads.
  // An unlinked/transient selection is ignored during session bootstrap. Private
  // wallet operations still require a wallet in this signed identity snapshot.
  const activeWallet = requestedWallet && identity.walletAddresses.includes(requestedWallet.toLowerCase())
    ? requestedWallet.toLowerCase() : null;
  const sessionWallets = activeWallet
    ? [activeWallet, ...identity.walletAddresses.filter((wallet) => wallet !== activeWallet)]
    : identity.walletAddresses;
  try {
    const currentLegacyAccountId = await oldLegacyAccount(request, identity);
    const token = newAuthToken();
    const user = await prisma.$transaction(async (tx) => {
      const account = await resolveAccount(tx, identity, currentLegacyAccountId, preferredAccountId as string | undefined);
      await revokeRequestSessions(tx, request);
      await tx.privySession.create({ data: {
        tokenHash: hashSessionToken(token), userId: account.id, privyDid: identity.privyDid,
        verifiedEmail: identity.email, walletAddresses: sessionWallets, expiresAt: identity.expiresAt,
      } });
      await ensureTesterProfile(tx, account.id);
      return account;
    });
    const session: PrivySession = { userId: user.id, privyDid: identity.privyDid, email: identity.email, walletAddresses: sessionWallets, expiresAt: identity.expiresAt };
    const response = NextResponse.json(sessionBody(request, session), { headers });
    setPrivySessionCookie(response, token, identity.expiresAt);
    clearEmailSessionCookie(response);
    clearWalletSessionCookie(response);
    return response;
  } catch (error) {
    if (error instanceof AccountSelection) return NextResponse.json({ error: "Choose the existing Artiq account you want to keep using.", code: error.message, accounts: error.accounts }, { status: 409, headers });
    if (error instanceof Error && ["PRIVY_ACCOUNT_ALREADY_BOUND", "INVALID_ACCOUNT_SELECTION"].includes(error.message)) {
      return NextResponse.json({ error: "That account cannot be linked to this sign-in. Use its existing sign-in method.", code: error.message }, { status: 409, headers });
    }
    // Unique conflicts may be two simultaneous first sign-ins. Retrying will resolve the newly bound account.
    console.warn("[artiq-auth]", { event: "privy_session_write_failed", code: "PRIVY_SESSION_WRITE_FAILED" });
    return NextResponse.json({ error: "Your account could not be opened. Please try again." }, { status: 503, headers });
  }
}

async function handleDELETE(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "This request must come from Artiq." }, { status: 403, headers });
  try {
    // Anonymous visits also call DELETE to clear stale browser cookies. Avoid
    // opening a write transaction when no revocable token was supplied.
    const hasSessionToken = [PRIVY_SESSION_COOKIE, EMAIL_SESSION_COOKIE, WALLET_SESSION_COOKIE]
      .some((name) => /^[a-f0-9]{64}$/.test(request.cookies.get(name)?.value ?? ""));
    if (hasSessionToken) await prisma.$transaction((tx) => revokeRequestSessions(tx, request));
    const response = NextResponse.json({ ok: true }, { headers });
    clearPrivySessionCookie(response);
    clearEmailSessionCookie(response);
    clearWalletSessionCookie(response);
    return response;
  } catch {
    return NextResponse.json({ error: "Could not sign out. Please try again." }, { status: 503, headers });
  }
}

export const GET = withAbuseProtection("GET auth/privy/session", "session", handleGET);
export const POST = withAbuseProtection("POST auth/privy/session", "login", handlePOST);
export const DELETE = withAbuseProtection("DELETE auth/privy/session", "session", handleDELETE);
