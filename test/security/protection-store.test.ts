import assert from "node:assert/strict";
import { test } from "node:test";
import { ProtectionStore } from "../../lib/protectionStore";

test("fixed windows isolate identities and reopen exactly at their boundary", () => {
  const store = new ProtectionStore();
  assert.deepEqual(store.consume("login:alice", 2, 60_000, 1_000), { allowed: true, retryAfter: 0 });
  assert.equal(store.consume("login:alice", 2, 60_000, 1_001).allowed, true);
  assert.deepEqual(store.consume("login:alice", 2, 60_000, 1_002), { allowed: false, retryAfter: 59 });
  assert.equal(store.consume("login:bob", 2, 60_000, 1_002).allowed, true);
  assert.equal(store.consume("upload:alice", 2, 60_000, 1_002).allowed, true);
  assert.deepEqual(store.consume("login:alice", 2, 60_000, 59_999), { allowed: false, retryAfter: 1 });
  assert.deepEqual(store.consume("login:alice", 2, 60_000, 60_000), { allowed: true, retryAfter: 0 });
  assert.equal(store.consume("login:alice", 2, 60_000, 60_001).allowed, true);
  assert.equal(store.consume("login:alice", 2, 60_000, 60_002).allowed, false);
});

test("new identities cannot evict live quotas when the fallback reaches its memory bound", () => {
  const store = new ProtectionStore(2);
  assert.equal(store.consume("first", 2, 60_000, 1_000).allowed, true);
  assert.equal(store.consume("second", 1, 120_000, 1_000).allowed, true);
  for (let index = 0; index < 1_000; index++) {
    assert.equal(store.consume(`flood-${index}`, 10, 60_000, 1_001).allowed, false);
  }
  assert.equal(store.consume("first", 2, 60_000, 1_002).allowed, true, "the original bucket remains present");
  assert.equal(store.consume("first", 2, 60_000, 1_003).allowed, false, "identity churn cannot reset a quota");
  assert.equal(store.consume("new-after-expiration", 1, 60_000, 60_000).allowed, true);
  assert.equal(store.consume("second", 1, 120_000, 60_000).allowed, false, "cleanup retains buckets with a longer live window");
  assert.equal(store.consume("still-full", 1, 60_000, 60_000).allowed, false);
  assert.equal(store.consume("reclaimed-again", 1, 60_000, 120_000).allowed, true);
});

test("metrics retain the current minute and previous 59 minutes and discard older traffic", () => {
  const store = new ProtectionStore();
  const start = 10 * 60_000;
  store.record("login", { requests: 2, errors: 1 }, start);
  store.record("upload", { requests: 3, blocked: 1, rateLimited: 1 }, start + 59 * 60_000);
  const all = store.snapshot(start + 59 * 60_000);
  assert.equal(all.scope, "instance");
  assert.equal(all.windowMinutes, 60);
  assert.deepEqual(all.totals, { requests: 5, blocked: 1, rateLimited: 1, busy: 0, errors: 1, authRejected: 0 });
  assert.deepEqual(all.routes.map(({ route }) => route), ["upload", "login"]);

  const expired = store.snapshot(start + 60 * 60_000);
  assert.deepEqual(expired.totals, { requests: 3, blocked: 1, rateLimited: 1, busy: 0, errors: 0, authRejected: 0 });
  assert.deepEqual(expired.routes.map(({ route }) => route), ["upload"]);
  store.record("new", { requests: 1, busy: 1, blocked: 1 }, start + 120 * 60_000);
  const fresh = store.snapshot(start + 120 * 60_000);
  assert.deepEqual(fresh.routes, [{ route: "new", requests: 1, blocked: 1, rateLimited: 0, busy: 1, errors: 0, authRejected: 0 }]);
});

test("concurrency limits are independent and releasing a slot twice cannot over-admit work", () => {
  const store = new ProtectionStore();
  const first = store.acquire("screening", 2);
  const second = store.acquire("screening", 2);
  const upload = store.acquire("upload", 1);
  assert.ok(first);
  assert.ok(second);
  assert.ok(upload);
  assert.equal(store.acquire("screening", 2), null);
  first();
  const replacement = store.acquire("screening", 2);
  assert.ok(replacement);
  first();
  assert.equal(store.acquire("screening", 2), null, "duplicate release must not release another request's slot");
  second();
  replacement();
  upload();
  const afterAllReleased = store.acquire("screening", 1);
  assert.ok(afterAllReleased);
  afterAllReleased();
});
