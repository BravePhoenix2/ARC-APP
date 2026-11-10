import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createCatalogCronHandler, createMaintenanceCronHandler } from "../../lib/cronJobs";
import type { planDataRetention } from "../../lib/dataRetention";
import { GET as catalogRoute } from "../../app/api/cron/catalog/route";
import { GET as maintenanceRoute } from "../../app/api/cron/maintenance/route";

const secret = "synthetic-cron-secret-of-at-least-32-characters";
let previousSecret: string | undefined;
beforeEach(() => { previousSecret = process.env.CRON_SECRET; process.env.CRON_SECRET = secret; });
afterEach(() => { if (previousSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previousSecret; });
const request = (path = "/api/cron/catalog", token = `Bearer ${secret}`) => new Request(`https://artiq.example${path}`, { headers: { authorization: token } });

test("both scheduler routes fail closed without a strong secret or exact bearer authorization", async () => {
  for (const handler of [catalogRoute, maintenanceRoute]) {
    for (const configured of [undefined, "", "too-short"]) {
      if (configured === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = configured;
      const response = await handler(request());
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
    process.env.CRON_SECRET = secret;
    for (const token of ["", secret, `Bearer ${secret}wrong`, `Bearer ${secret.slice(1)}x`]) {
      const response = await handler(request(undefined, token));
      assert.equal(response.status, 401);
      assert.doesNotMatch(await response.text(), /synthetic-cron-secret/);
    }
  }
});

test("invalid queries and unauthorized requests never load scheduled job dependencies", async () => {
  let loaded = 0;
  const catalog = createCatalogCronHandler(async () => { loaded++; throw new Error("must not load"); });
  const maintenance = createMaintenanceCronHandler(async () => { loaded++; throw new Error("must not load"); });
  assert.equal((await catalog(request(undefined, "Bearer wrong"))).status, 401);
  assert.equal((await maintenance(request(undefined, "Bearer wrong"))).status, 401);
  for (const query of ["cursor=", "cursor=a&cursor=b", "cursor=bad%20cursor", "limit=100000", `cursor=${"x".repeat(192)}`]) assert.equal((await catalog(request(`/api/cron/catalog?${query}`))).status, 400);
  assert.equal((await maintenance(request("/api/cron/maintenance?uploads=true"))).status, 400);
  assert.equal(loaded, 0);
});

test("catalog scheduler follows pages and reports only aggregate results", async () => {
  const seen: Array<string | undefined> = [];
  const handler = createCatalogCronHandler(async () => async (options = {}) => {
    seen.push(options.after);
    assert.equal(options.limit, 50);
    assert.ok(options.deadline! > Date.now());
    return options.after === "start" ? { results: [{ id: "item-a", ok: true }], hasMore: true, nextCursor: "item-a" } : { results: [{ id: "item-b", ok: true }], hasMore: false, nextCursor: null };
  });
  const response = await handler(request("/api/cron/catalog?cursor=start"));
  assert.equal(response.status, 200);
  assert.deepEqual(seen, ["start", "item-a"]);
  assert.deepEqual(await response.json(), { checked: 2, failed: 0, incomplete: false, nextCursor: null });
});

test("catalog scheduler bounds a large run and exposes a resume cursor", async () => {
  let checked = 0;
  const handler = createCatalogCronHandler(async () => async (options = {}) => {
    const results = Array.from({ length: options.limit! }, () => ({ id: `item-${++checked}`, ok: true }));
    return { results, hasMore: true, nextCursor: `item-${checked}` };
  });
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal(checked, 250);
  assert.deepEqual(await response.json(), { checked: 250, failed: 0, incomplete: true, nextCursor: "item-250" });
});

test("catalog scheduler returns a cursor when its time budget ends", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_900_000_000_000 });
  let calls = 0;
  const handler = createCatalogCronHandler(async () => async () => {
    calls++;
    t.mock.timers.tick(45_000);
    return { results: [{ id: "item-a", ok: true }], hasMore: true, nextCursor: "item-a" };
  });
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(await response.json(), { checked: 1, failed: 0, incomplete: true, nextCursor: "item-a" });
});

test("catalog verification failures and provider exceptions are observable without leaking details", async () => {
  const failingPage = createCatalogCronHandler(async () => async () => ({ results: [{ id: "item-a", ok: false, error: "private-provider-error" }], hasMore: false, nextCursor: null }));
  const failed = await failingPage(request());
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { checked: 1, failed: 1, incomplete: false, nextCursor: null });
  const unavailable = createCatalogCronHandler(async () => { throw new Error(`private-provider-error ${secret}`); });
  const response = await unavailable(request());
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.doesNotMatch(body, /private-provider-error|synthetic-cron-secret/);
});

test("maintenance plans only expired credentials and never requests upload deletion", async () => {
  const database = {} as Parameters<typeof planDataRetention>[0];
  const plan: Awaited<ReturnType<typeof planDataRetention>> = { cutoff: new Date(0), orphans: [], sessions: [[], [], [], [], []], scanned: 0, scanLimitReached: false };
  let planned = false;
  let applied = false;
  const handler = createMaintenanceCronHandler(async () => ({
    database,
    plan: async (db, now, sessionsOnly) => { assert.equal(db, database); assert.ok(now instanceof Date); assert.equal(sessionsOnly, true); planned = true; return plan; },
    apply: async (db, value, writesPaused) => { assert.equal(db, database); assert.equal(value, plan); assert.equal(writesPaused, false); applied = true; return { removedUploads: 0, removedExpiredCredentials: 3 }; },
  }));
  const response = await handler(request("/api/cron/maintenance"));
  assert.equal(response.status, 200);
  assert.equal(planned, true);
  assert.equal(applied, true);
  assert.deepEqual(await response.json(), { removedExpiredCredentials: 3 });
});

test("maintenance rejects an unexpected upload plan and hides dependency errors", async () => {
  let applied = false;
  const database = {} as Parameters<typeof planDataRetention>[0];
  const handler = createMaintenanceCronHandler(async () => ({
    database,
    plan: async () => ({ cutoff: new Date(0), orphans: [{ id: "private-upload", byteSize: 1, storageKey: null }], sessions: [[], [], [], [], []], scanned: 1, scanLimitReached: false }),
    apply: async () => { applied = true; return { removedUploads: 1, removedExpiredCredentials: 0 }; },
  }));
  assert.equal((await handler(request("/api/cron/maintenance"))).status, 503);
  assert.equal(applied, false);
  const unavailable = createMaintenanceCronHandler(async () => { throw new Error(`private-database-url ${secret}`); });
  const response = await unavailable(request("/api/cron/maintenance"));
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private-database-url|synthetic-cron-secret/);
});
