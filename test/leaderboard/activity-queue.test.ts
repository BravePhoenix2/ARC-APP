import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { queueTesterActivity, readPendingTesterActivities, syncTesterActivity } from "../../lib/testerActivityQueue";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalFetch = globalThis.fetch;
const store = new Map<string, string>();
const storageKey = "artiq:pending-tester-activity:v1";
const wallet = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const hash = `0x${"a".repeat(64)}` as const;
const secondHash = `0x${"b".repeat(64)}` as const;

beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, "window", { configurable: true, value: Object.assign(new EventTarget(), {
    localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } },
  }) });
});
after(() => { globalThis.fetch = originalFetch; if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window"); });

test("pending activity survives reload without mixing wallets or duplicate transaction hashes", () => {
  queueTesterActivity(hash, wallet); queueTesterActivity(hash, wallet); queueTesterActivity(secondHash, other);
  assert.equal(readPendingTesterActivities().length, 2);
  assert.deepEqual(readPendingTesterActivities(wallet).map((item) => item.txHash), [hash]);
  assert.deepEqual(readPendingTesterActivities(other).map((item) => item.txHash), [secondHash]);
});

test("malformed and expired local entries cannot crash activity sync", () => {
  store.set(storageKey, "invalid JSON"); assert.deepEqual(readPendingTesterActivities(), []);
  store.set(storageKey, JSON.stringify([{ txHash: hash, walletAddress: wallet, createdAt: Date.now() - 31 * 86400000 }, { txHash: "0x1", walletAddress: wallet, createdAt: Date.now() }, { txHash: secondHash, walletAddress: other, createdAt: Date.now() }]));
  assert.deepEqual(readPendingTesterActivities().map((item) => item.txHash), [secondHash]);
});

test("email ownership proof and temporary failures keep activity available for retry", async () => {
  queueTesterActivity(hash, wallet);
  globalThis.fetch = async () => Response.json({ error: "Sign with your wallet", code: "WALLET_PROOF_REQUIRED" }, { status: 403 });
  assert.equal((await syncTesterActivity(hash, { "X-Artiq-Account-ID": "private-account" })).state, "proof-required");
  assert.equal(readPendingTesterActivities(wallet).length, 1);
  globalThis.fetch = async () => Response.json({ error: "RPC unavailable" }, { status: 503 });
  assert.equal((await syncTesterActivity(hash, { "X-Artiq-Account-ID": "private-account" }, "0x123")).state, "retry");
  assert.equal(readPendingTesterActivities(wallet).length, 1);
  globalThis.fetch = async (_url, init) => {
    assert.equal(new Headers(init?.headers).get("X-Artiq-Account-ID"), "private-account");
    assert.deepEqual(JSON.parse(String(init?.body)), { txHash: hash, walletSignature: "0x456" });
    return Response.json({ recorded: true });
  };
  assert.equal((await syncTesterActivity(hash, { "X-Artiq-Account-ID": "private-account" }, "0x456")).state, "synced");
  assert.equal(readPendingTesterActivities(wallet).length, 0);
});

test("concurrent attempts share verification and only the checked transaction is removed", async () => {
  queueTesterActivity(hash, wallet); queueTesterActivity(secondHash, other);
  let requests = 0;
  globalThis.fetch = async () => { requests += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return Response.json({ recorded: false, reason: "Already earned" }); };
  const [first, second] = await Promise.all([syncTesterActivity(hash, { "X-Wallet-Address": wallet }), syncTesterActivity(hash, { "X-Wallet-Address": wallet })]);
  assert.equal(first.state, "synced"); assert.equal(second.state, "synced"); assert.equal(requests, 1);
  assert.deepEqual(readPendingTesterActivities().map((item) => item.txHash), [secondHash]);
});

test("blocked local storage does not turn a confirmed wallet transaction into an error", () => {
  Object.defineProperty(window, "localStorage", { value: { getItem() { throw new Error("Storage blocked"); }, setItem() { throw new Error("Storage blocked"); } } });
  assert.doesNotThrow(() => queueTesterActivity(hash, wallet));
  assert.deepEqual(readPendingTesterActivities(), []);
});
