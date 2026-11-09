import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";

// Synthetic JWTs and provider responses only. No real account or provider is used.
const directory = mkdtempSync(join(tmpdir(), "artiq-privy-profile-cache-"));
process.env.DATABASE_URL = `file:${join(directory, "unused.db")}`;
const appId = "clartiqprofilecache0000000001";
let signingKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let resolver: JWTVerifyGetKey;
let auth: typeof import("../../lib/privyAuth");
let originalFetch: typeof fetch;
let provider: () => Promise<Response>;
const reads: Headers[] = [];

const subject = () => `did:privy:${randomBytes(12).toString("hex")}`;
const nowSeconds = () => Math.floor(Date.now() / 1000);
function profile(did: string, email = "verified@example.com") {
  return { user: { id: did, linked_accounts: [{ type: "email", address: email, latest_verified_at: nowSeconds() - 1 }] } };
}
async function token(did = subject(), options: { app?: string; expiresIn?: number; sid?: string } = {}) {
  return new SignJWT({ sid: options.sid ?? randomBytes(8).toString("hex") })
    .setProtectedHeader({ alg: "ES256", kid: "profile-cache-fixture" })
    .setIssuer("privy.io").setAudience(options.app ?? appId).setSubject(did)
    .setIssuedAt(nowSeconds()).setExpirationTime(nowSeconds() + (options.expiresIn ?? 3600)).sign(signingKey);
}

before(async () => {
  const pair = await generateKeyPair("ES256");
  signingKey = pair.privateKey;
  resolver = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: "profile-cache-fixture", alg: "ES256" }] });
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    assert.equal(url, "https://auth.privy.io/api/v1/users/me", "only the local provider fixture may be read");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal instanceof AbortSignal);
    reads.push(new Headers(init?.headers));
    return provider();
  };
  auth = await import("../../lib/privyAuth");
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_PRIVY_APP_ID = appId;
  delete process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID;
  reads.length = 0;
  provider = async () => { throw new Error("Unexpected provider fixture read"); };
});

after(async () => {
  globalThis.fetch = originalFetch;
  await (await import("../../lib/prisma")).prisma.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});

test("concurrent verified-token requests share one profile lookup and receive independent snapshots", async () => {
  const did = subject();
  const accessToken = await token(did);
  let finish!: (response: Response) => void;
  let started!: () => void;
  const requested = new Promise<void>((resolve) => { started = resolve; });
  provider = () => { started(); return new Promise<Response>((resolve) => { finish = resolve; }); };
  const pending = Promise.all(Array.from({ length: 12 }, () => auth.verifyPrivyTokens({ accessToken }, resolver)));
  await requested;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(reads.length, 1);
  finish(Response.json(profile(did)));
  const identities = await pending;
  assert.equal(reads.length, 1);
  assert.ok(identities.every((identity) => identity.privyDid === did && identity.email === "verified@example.com"));
  identities[0].verifiedEmails.push("injected@example.com");
  assert.deepEqual(identities[1].verifiedEmails, ["verified@example.com"]);
  const replay = await auth.verifyPrivyTokens({ accessToken }, resolver);
  assert.deepEqual(replay.verifiedEmails, ["verified@example.com"]);
  assert.equal(reads.length, 1);
});

test("cached profiles expire after 30 seconds and never survive their access token", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_900_000_000_000 });
  const did = subject();
  const accessToken = await token(did);
  let email = "before@example.com";
  provider = async () => Response.json(profile(did, email));
  assert.equal((await auth.verifyPrivyTokens({ accessToken }, resolver)).email, email);
  email = "after@example.com";
  t.mock.timers.tick(29_999);
  assert.equal((await auth.verifyPrivyTokens({ accessToken }, resolver)).email, "before@example.com");
  t.mock.timers.tick(1);
  assert.equal((await auth.verifyPrivyTokens({ accessToken }, resolver)).email, email);
  assert.equal(reads.length, 2);

  const shortToken = await token(did, { expiresIn: 10 });
  await auth.verifyPrivyTokens({ accessToken: shortToken }, resolver);
  t.mock.timers.tick(10_000);
  await assert.rejects(auth.verifyPrivyTokens({ accessToken: shortToken }, resolver));
  assert.equal(reads.length, 3, "expired credentials cannot use a still-young cached profile");
});

test("profile cache is isolated by exact token, app, client and subject", async () => {
  const did = subject();
  provider = async () => Response.json(profile(did));
  const first = await token(did);
  const second = await token(did);
  await auth.verifyPrivyTokens({ accessToken: first }, resolver);
  await auth.verifyPrivyTokens({ accessToken: second }, resolver);
  assert.equal(reads.length, 2, "a new access token needs its own verified profile");
  const otherApp = "clartiqprofilecacheotherapp1";
  process.env.NEXT_PUBLIC_PRIVY_APP_ID = otherApp;
  const foreign = await token(did, { app: otherApp });
  await auth.verifyPrivyTokens({ accessToken: foreign }, resolver);
  assert.equal(reads.length, 3);
  await assert.rejects(auth.verifyPrivyTokens({ accessToken: first }, resolver));
  assert.equal(reads.length, 3, "a cached profile cannot bypass audience verification");
  process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID = "fixture_client_01";
  await auth.verifyPrivyTokens({ accessToken: foreign }, resolver);
  assert.equal(reads.length, 4);
  assert.equal(reads[3].get("privy-client-id"), "fixture_client_01");
  const otherDid = subject();
  provider = async () => Response.json(profile(otherDid, "other@example.com"));
  const other = await auth.verifyPrivyTokens({ accessToken: await token(otherDid, { app: otherApp }) }, resolver);
  assert.equal(other.email, "other@example.com");
  assert.equal(reads.length, 5);
});

test("cached profiles cannot authorize forged access tokens or an invalid supplied identity token", async () => {
  const did = subject();
  const accessToken = await token(did);
  provider = async () => Response.json(profile(did));
  await auth.verifyPrivyTokens({ accessToken }, resolver);
  const [header, payload] = accessToken.split(".");
  const forged = `${header}.${payload}.${Buffer.alloc(64).toString("base64url")}`;
  await assert.rejects(auth.verifyPrivyTokens({ accessToken: forged }, resolver));
  await assert.rejects(auth.verifyPrivyTokens({ accessToken, identityToken: "invalid-identity", forceProfileRefresh: true }, resolver));
  await auth.verifyPrivyTokens({ accessToken }, resolver);
  assert.equal(reads.length, 1);
});

test("provider failures and profiles with no verified identity are never cached", async () => {
  const did = subject();
  const accessToken = await token(did);
  const responses = [
    new Response(null, { status: 429, headers: { "Retry-After": "45" } }),
    new Response(null, { status: 503 }),
    Response.json({ user: { id: did, linked_accounts: [{ type: "email", address: "unverified@example.com" }] } }),
    Response.json(profile(subject())),
    Response.json(profile(did)),
  ];
  provider = async () => responses.shift()!;
  for (let attempt = 0; attempt < 4; attempt++) await assert.rejects(auth.verifyPrivyTokens({ accessToken }, resolver));
  assert.equal((await auth.verifyPrivyTokens({ accessToken }, resolver)).email, "verified@example.com");
  assert.equal(reads.length, 5);
  await auth.verifyPrivyTokens({ accessToken }, resolver);
  assert.equal(reads.length, 5);
});

test("explicit linked-account refresh bypasses the cache and prevents older lookups from restoring stale claims", async () => {
  const did = subject();
  const accessToken = await token(did);
  let finishOld!: (response: Response) => void;
  let started!: () => void;
  const requested = new Promise<void>((resolve) => { started = resolve; });
  provider = () => { started(); return new Promise<Response>((resolve) => { finishOld = resolve; }); };
  const old = auth.verifyPrivyTokens({ accessToken }, resolver);
  await requested;
  provider = async () => Response.json(profile(did, "new@example.com"));
  const fresh = await auth.verifyPrivyTokens({ accessToken, forceProfileRefresh: true }, resolver);
  assert.equal(fresh.email, "new@example.com");
  finishOld(Response.json(profile(did, "old@example.com")));
  await old;
  assert.equal((await auth.verifyPrivyTokens({ accessToken }, resolver)).email, "new@example.com");
  assert.equal(reads.length, 2, "the earlier lookup cannot overwrite the fresh cache entry");
  provider = async () => Response.json(profile(did, "latest@example.com"));
  assert.equal((await auth.verifyPrivyTokens({ accessToken, forceProfileRefresh: true }, resolver)).email, "latest@example.com");
  assert.equal(reads.length, 3, "an explicit refresh also bypasses a completed cached profile");
});

test("retained profile snapshots have a bounded capacity", async () => {
  const did = subject();
  provider = async () => Response.json(profile(did));
  const first = await token(did);
  await auth.verifyPrivyTokens({ accessToken: first }, resolver);
  for (let index = 0; index < 256; index++) {
    await auth.verifyPrivyTokens({ accessToken: await token(did, { sid: `bounded-${index}` }) }, resolver);
  }
  assert.equal(reads.length, 257);
  await auth.verifyPrivyTokens({ accessToken: first }, resolver);
  assert.equal(reads.length, 258, "the oldest snapshot was evicted instead of growing memory without a bound");
});

test("a verified signed link update invalidates an earlier profile snapshot without another provider call", async () => {
  const did = subject();
  const accessToken = await token(did);
  provider = async () => Response.json(profile(did, "old@example.com"));
  await auth.verifyPrivyTokens({ accessToken }, resolver);
  const identityToken = await new SignJWT({ linked_accounts: JSON.stringify([{ type: "email", address: "new@example.com", lv: nowSeconds() - 1 }]) })
    .setProtectedHeader({ alg: "ES256", kid: "profile-cache-fixture" })
    .setIssuer("privy.io").setAudience(appId).setSubject(did)
    .setIssuedAt(nowSeconds()).setExpirationTime(nowSeconds() + 3600).sign(signingKey);
  const updated = await auth.verifyPrivyTokens({ accessToken, identityToken, forceProfileRefresh: true }, resolver);
  assert.equal(updated.email, "new@example.com");
  assert.equal(reads.length, 1, "verified signed claims do not need a provider lookup");
  provider = async () => Response.json(profile(did, "new@example.com"));
  assert.equal((await auth.verifyPrivyTokens({ accessToken }, resolver)).email, "new@example.com");
  assert.equal(reads.length, 2, "a later access-only request cannot restore the old cached link");
});
