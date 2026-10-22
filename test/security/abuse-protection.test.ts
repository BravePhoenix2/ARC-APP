import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { protectAccount, protectionClientIp, securitySnapshot, withAbuseProtection } from "../../lib/abuseProtection";

const fixedNow = 1_900_000_020_001;
const envKeys = ["ARTIQ_TRUSTED_PROXY", "ARTIQ_SECURITY_REDIS_URL", "ARTIQ_SECURITY_REDIS_TOKEN", "ARTIQ_RATE_LIMIT_SECRET"] as const;
type SecurityEnvironment = Partial<Record<(typeof envKeys)[number], string>>;

async function environment<T>(values: SecurityEnvironment, run: () => Promise<T>): Promise<T> {
  const saved = envKeys.map((key) => [key, process.env[key]] as const);
  for (const key of envKeys) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try { return await run(); }
  finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function request(ip?: string, path = "/api/test", extra: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: { ...(ip ? { "cf-connecting-ip": ip } : {}), ...extra },
  });
}

test("only configured ingress headers are trusted and IPv6 aliases share a canonical identity", async () => {
  await environment({}, async () => {
    assert.equal(protectionClientIp(request(undefined, "/", {
      "x-forwarded-for": "203.0.113.1", "cf-connecting-ip": "203.0.113.2", "x-vercel-forwarded-for": "203.0.113.3",
    })), null);
    assert.equal(protectionClientIp(new NextRequest("http://localhost/", {
      ip: "192.0.2.10", headers: { "x-forwarded-for": "203.0.113.99" },
    })), "192.0.2.10");
  });
  await environment({ ARTIQ_TRUSTED_PROXY: "cloudflare" }, async () => {
    for (const [input, expected] of [
      ["2001:0DB8:0000:0000:0000:0000:0000:0001", "2001:db8::1"],
      ["2001:db8::1", "2001:db8::1"],
      ["::ffff:192.0.2.8", "192.0.2.8"],
      ["::FFFF:c000:0208", "192.0.2.8"],
      ["192.0.2.8", "192.0.2.8"],
    ]) assert.equal(protectionClientIp(request(input)), expected);
    for (const value of ["not-an-ip", "203.0.113.1, 203.0.113.2", "fe80::1%eth0", "x".repeat(65), ""]) {
      assert.equal(protectionClientIp(request(value)), null);
    }
    assert.equal(protectionClientIp(request("203.0.113.8", "/", { "x-forwarded-for": "203.0.113.99" })), "203.0.113.8");
  });
  await environment({ ARTIQ_TRUSTED_PROXY: "vercel" }, async () => {
    assert.equal(protectionClientIp(request("203.0.113.8", "/", {
      "x-vercel-forwarded-for": "203.0.113.9", "x-forwarded-for": "203.0.113.99",
    })), "203.0.113.9");
  });
});

test("rate-limited traffic stops before the handler, discloses cooldown, and leaves another user available", async (t) => {
  t.mock.method(Date, "now", () => fixedNow);
  await environment({ ARTIQ_TRUSTED_PROXY: "cloudflare" }, async () => {
    let calls = 0;
    const handler = withAbuseProtection("test.screening.rate", "screening", async () => {
      calls++;
      return Response.json({ success: true });
    });
    for (let index = 0; index < 30; index++) {
      const response = await handler(request("203.0.113.20", "/api/screening", { "x-forwarded-for": `192.0.2.${index}` }));
      assert.equal(response.status, 200);
    }
    const blocked = await handler(request("203.0.113.20", "/api/screening", { "x-forwarded-for": "198.51.100.200" }));
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).code, "RATE_LIMITED");
    assert.match(blocked.headers.get("cache-control") ?? "", /no-store/);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    assert.equal(calls, 30);
    assert.equal((await handler(request("203.0.113.21"))).status, 200);
    assert.equal(calls, 31);
    const row = (await securitySnapshot()).routes.find(({ route }) => route === "test.screening.rate");
    assert.deepEqual(row, { route: "test.screening.rate", requests: 32, blocked: 1, rateLimited: 1, busy: 0, errors: 0, authRejected: 0 });
  });
});

test("verified account quotas are separate from IP quotas and other accounts", async (t) => {
  t.mock.method(Date, "now", () => fixedNow);
  await environment({ ARTIQ_TRUSTED_PROXY: "cloudflare" }, async () => {
    for (let index = 0; index < 10; index++) assert.equal(await protectAccount("screening", "203.0.113.22"), null);
    const limited = await protectAccount("screening", "203.0.113.22");
    assert.ok(limited);
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).code, "RATE_LIMITED");
    assert.equal(await protectAccount("screening", "another-verified-account"), null);
    const handler = withAbuseProtection("test.screening.account-isolation", "screening", async () => new Response(null, { status: 204 }));
    assert.equal((await handler(request("203.0.113.22"))).status, 204, "an account ID matching an IP must not consume that IP's separate quota");
  });
});

test("busy services reject excess work and release capacity even when a handler throws", async (t) => {
  t.mock.method(Date, "now", () => fixedNow);
  await environment({ ARTIQ_TRUSTED_PROXY: "cloudflare" }, async () => {
    let fail!: () => void;
    let finish!: () => void;
    const failGate = new Promise<void>((resolve) => { fail = resolve; });
    const finishGate = new Promise<void>((resolve) => { finish = resolve; });
    let calls = 0;
    const handler = withAbuseProtection("test.screening.concurrency", "screening", async (input) => {
      calls++;
      if (input.nextUrl.pathname.endsWith("/error")) { await failGate; throw new Error("screening failure"); }
      if (input.nextUrl.pathname.endsWith("/hold")) await finishGate;
      return new Response(null, { status: 204 });
    });
    const failing = handler(request("203.0.113.100", "/error"));
    const holding = handler(request("203.0.113.101", "/hold"));
    try {
      const busy = await handler(request("203.0.113.102", "/extra"));
      assert.equal(busy.status, 429);
      assert.equal((await busy.json()).code, "REQUEST_CAPACITY_REACHED");
      assert.equal(busy.headers.get("retry-after"), "2");
      assert.match(busy.headers.get("cache-control") ?? "", /no-store/);
      assert.equal(calls, 2);
      fail();
      await assert.rejects(failing, /screening failure/);
      assert.equal((await handler(request("203.0.113.102", "/after-error"))).status, 204, "global saturation must also release the rejected request's IP lease");
    } finally {
      fail();
      finish();
      await Promise.allSettled([failing, holding]);
    }
    assert.equal((await holding).status, 204);
    const row = (await securitySnapshot()).routes.find(({ route }) => route === "test.screening.concurrency");
    assert.deepEqual(row, { route: "test.screening.concurrency", requests: 4, blocked: 1, rateLimited: 0, busy: 1, errors: 1, authRejected: 0 });
  });
});

test("one IP cannot fill all login slots and its slots release on success and failure", async (t) => {
  t.mock.method(Date, "now", () => fixedNow);
  await environment({ ARTIQ_TRUSTED_PROXY: "cloudflare" }, async () => {
    const releases: Array<() => void> = [];
    const signalStarted: Array<() => void> = [];
    const gates = Array.from({ length: 8 }, (_, index) => new Promise<void>((resolve) => { releases[index] = resolve; }));
    const started = Array.from({ length: 8 }, (_, index) => new Promise<void>((resolve) => { signalStarted[index] = resolve; }));
    let admitted = 0;
    type Work = { wait?: Promise<void>; ready?: () => void; fail?: boolean };
    const login = withAbuseProtection("test.login.ip-capacity", "login", async (_input, work: Work) => {
      admitted++;
      work.ready?.();
      await work.wait;
      if (work.fail) throw new Error("login token validation failed");
      return new Response(null, { status: 204 });
    });
    const pending = gates.map((wait, index) => login(request("203.0.113.110"), {
      wait, ready: signalStarted[index], fail: index === 1,
    }));
    try {
      await Promise.all(started);
      const blocked = await login(request("203.0.113.110"), {});
      assert.equal(blocked.status, 429);
      assert.equal((await blocked.json()).code, "REQUEST_CAPACITY_REACHED");
      assert.equal(blocked.headers.get("retry-after"), "2");
      assert.equal(admitted, 8, "the ninth request must stop before body or token processing");
      assert.equal((await login(request("203.0.113.111"), {})).status, 204, "a different network retains login capacity");
      releases[0]();
      assert.equal((await pending[0]).status, 204);
      assert.equal((await login(request("203.0.113.110"), {})).status, 204, "successful login releases its IP slot");
      releases[1]();
      await assert.rejects(pending[1], /login token validation failed/);
      assert.equal((await login(request("203.0.113.110"), {})).status, 204, "a thrown validation error releases its IP slot");
    } finally {
      releases.forEach((release) => release());
      await Promise.allSettled(pending);
    }
    assert.equal(admitted, 11);
    const snapshot = await securitySnapshot();
    assert.deepEqual(snapshot.routes.find(({ route }) => route === "test.login.ip-capacity"), {
      route: "test.login.ip-capacity", requests: 12, blocked: 1, rateLimited: 0, busy: 1, errors: 1, authRejected: 0,
    });
  });
});

test("per-account upload capacity isolates a busy creator and releases leases on success and exceptions", async (t) => {
  t.mock.method(Date, "now", () => fixedNow);
  await environment({ ARTIQ_TRUSTED_PROXY: "cloudflare" }, async () => {
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    let firstReady!: () => void;
    let secondReady!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const firstStarted = new Promise<void>((resolve) => { firstReady = resolve; });
    const secondStarted = new Promise<void>((resolve) => { secondReady = resolve; });
    let admitted = 0;
    type Work = { wait?: Promise<void>; ready?: () => void; fail?: boolean };
    const upload = withAbuseProtection("test.upload.account-capacity", "upload", async (input, work: Work) => {
      const limited = await protectAccount("upload", "verified-busy-creator", "test-account-cap", input);
      if (limited) return limited;
      admitted++;
      work.ready?.();
      await work.wait;
      if (work.fail) throw new Error("upload processing failed");
      return new Response(null, { status: 201 });
    });
    const otherCreator = withAbuseProtection("test.upload.other-account-capacity", "upload", async (input) => {
      const limited = await protectAccount("upload", "verified-other-creator", "test-account-cap", input);
      return limited ?? new Response(null, { status: 201 });
    });
    const first = upload(request("203.0.113.25"), { wait: firstGate, ready: firstReady });
    const second = upload(request("203.0.113.25"), { wait: secondGate, ready: secondReady });
    try {
      await Promise.all([firstStarted, secondStarted]);
      const blocked = await upload(request("203.0.113.25"), {});
      assert.equal(blocked.status, 429);
      assert.equal((await blocked.json()).code, "REQUEST_CAPACITY_REACHED");
      assert.equal(blocked.headers.get("retry-after"), "2");
      assert.equal(admitted, 2, "the rejected upload must not start expensive work");
      assert.equal((await otherCreator(request("203.0.113.25"))).status, 201, "another verified creator on the same network retains capacity");
      releaseFirst();
      assert.equal((await first).status, 201);
      assert.equal((await upload(request("203.0.113.25"), {})).status, 201, "successful completion releases the creator's slot");
      await assert.rejects(upload(request("203.0.113.25"), { fail: true }), /upload processing failed/);
      assert.equal((await upload(request("203.0.113.25"), {})).status, 201, "an exception also releases the creator's slot");
    } finally {
      releaseFirst();
      releaseSecond();
      await Promise.allSettled([first, second]);
    }
    assert.equal((await second).status, 201);
    assert.equal(admitted, 5);
    const snapshot = await securitySnapshot();
    assert.deepEqual(snapshot.routes.find(({ route }) => route === "test.upload.account-capacity"), {
      route: "test.upload.account-capacity", requests: 6, blocked: 1, rateLimited: 0, busy: 1, errors: 1, authRejected: 0,
    });
  });
});

test("a normal batch of 100 sequential image uploads fits both IP and verified account quotas", async (t) => {
  t.mock.method(Date, "now", () => fixedNow);
  await environment({ ARTIQ_TRUSTED_PROXY: "cloudflare" }, async () => {
    let accepted = 0;
    const upload = withAbuseProtection("test.upload.normal-batch", "upload", async (input) => {
      const limited = await protectAccount("upload", "verified-100-image-creator", "test-normal-batch", input);
      if (limited) return limited;
      accepted++;
      return new Response(null, { status: 201 });
    });
    for (let index = 0; index < 100; index++) assert.equal((await upload(request("203.0.113.23"))).status, 201);
    assert.equal(accepted, 100);
    const row = (await securitySnapshot()).routes.find(({ route }) => route === "test.upload.normal-batch");
    assert.equal(row?.requests, 100);
    assert.equal(row?.blocked, 0);
  });
});

test("authentication denials retain route parameters and are counted without exposing their values", async (t) => {
  t.mock.method(Date, "now", () => fixedNow);
  await environment({ ARTIQ_TRUSTED_PROXY: "cloudflare" }, async () => {
    const handler = withAbuseProtection("test.auth.denied", "login", async (_request, context: { params: { id: string }; status: number }) => {
      return Response.json({ error: context.params.id }, { status: context.status });
    });
    for (const status of [401, 403]) {
      const response = await handler(request("203.0.113.24"), { params: { id: "private-account-value" }, status });
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { error: "private-account-value" });
    }
    const snapshot = await securitySnapshot();
    assert.deepEqual(snapshot.routes.find(({ route }) => route === "test.auth.denied"), {
      route: "test.auth.denied", requests: 2, blocked: 0, rateLimited: 0, busy: 0, errors: 0, authRejected: 2,
    });
    assert.equal(JSON.stringify(snapshot).includes("private-account-value"), false);
  });
});

const redisEnvironment: SecurityEnvironment = {
  ARTIQ_TRUSTED_PROXY: "cloudflare",
  ARTIQ_SECURITY_REDIS_URL: "https://security-cache.example",
  ARTIQ_SECURITY_REDIS_TOKEN: "synthetic-test-token",
  ARTIQ_RATE_LIMIT_SECRET: "synthetic-rate-limit-secret-of-at-least-32-characters",
};

test("shared Redis quotas use atomic expiring commands and report aggregate metrics without identities", async (t) => {
  t.mock.method(Date, "now", () => fixedNow + 60_000);
  const commands: unknown[][] = [];
  const counts = new Map<string, number>();
  const metrics = new Map<string, Map<string, number>>();
  t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    assert.equal(url, "https://security-cache.example");
    assert.equal(init?.method, "POST");
    assert.equal(init?.cache, "no-store");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-test-token");
    const command = JSON.parse(String(init?.body)) as unknown[];
    commands.push(command);
    assert.equal(command[0], "EVAL");
    const script = String(command[1]);
    let result: unknown;
    if (script.includes("redis.call('INCR',")) {
      assert.ok(script.includes("PEXPIRE"), "quota creation and expiry must occur in the same atomic script");
      assert.equal(command[2], 1);
      assert.equal(command[4], 30);
      assert.ok(Number(command[5]) > 0 && Number(command[5]) <= 60_000);
      const key = String(command[3]);
      const count = (counts.get(key) ?? 29) + 1;
      counts.set(key, count);
      result = [count <= Number(command[4]) ? 1 : 0, 17];
    } else if (script.includes("HINCRBY")) {
      const keyCount = Number(command[2]);
      const argumentsStart = 3 + keyCount;
      assert.equal((command.length - argumentsStart) % 3, 0);
      for (let index = argumentsStart; index < command.length; index += 3) {
        const keyIndex = Number(command[index]);
        assert.ok(keyIndex >= 1 && keyIndex <= keyCount);
        const key = String(command[2 + keyIndex]);
        const bucket = metrics.get(key) ?? new Map<string, number>();
        const field = String(command[index + 1]);
        bucket.set(field, (bucket.get(field) ?? 0) + Number(command[index + 2]));
        metrics.set(key, bucket);
      }
      result = 1;
    } else {
      assert.ok(script.includes("HGETALL"));
      assert.equal(command[2], 60);
      result = command.slice(3).map((key) => Array.from(metrics.get(String(key)) ?? [], ([field, value]) => [field, String(value)]).flat());
    }
    return Response.json({ result });
  });
  await environment(redisEnvironment, async () => {
    let calls = 0;
    const handler = withAbuseProtection("test.redis.aggregate", "screening", async () => { calls++; return new Response(null, { status: 204 }); });
    assert.equal((await handler(request("198.51.100.40"))).status, 204);
    const limited = await handler(request("198.51.100.40"));
    assert.equal(limited.status, 429, "a shared quota must override a fresh local bucket");
    assert.equal(limited.headers.get("retry-after"), "17");
    assert.equal(calls, 1);
    const snapshot = await securitySnapshot();
    assert.equal(snapshot.scope, "shared");
    assert.equal(snapshot.degraded, false);
    assert.deepEqual(snapshot.totals, { requests: 2, blocked: 1, rateLimited: 1, busy: 0, errors: 0, authRejected: 0 });
    assert.deepEqual(snapshot.routes, [{ route: "test.redis.aggregate", ...snapshot.totals }]);
    assert.equal(JSON.stringify(commands).includes("198.51.100.40"), false, "Redis keys must hash IP identities");
    assert.equal(JSON.stringify(snapshot).includes("198.51.100.40"), false);
    assert.equal(counts.size, 1);
    assert.equal(commands.filter((command) => String(command[1]).includes("HINCRBY")).length, 1, "both requests share one aggregated metrics write");
  });
});

test("malformed Redis decisions cannot disable the warm local quota", async (t) => {
  t.mock.method(Date, "now", () => fixedNow + 120_000);
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const command = JSON.parse(String(init?.body)) as unknown[];
    return Response.json({ result: String(command[1]).includes("HINCRBY") ? 1 : { invalid: true } });
  });
  await environment(redisEnvironment, async () => {
    let calls = 0;
    const handler = withAbuseProtection("test.redis.invalid", "screening", async () => { calls++; return new Response(null, { status: 204 }); });
    for (let index = 0; index < 30; index++) assert.equal((await handler(request("198.51.100.41"))).status, 204);
    assert.equal((await handler(request("198.51.100.41"))).status, 429);
    assert.equal(calls, 30);
    assert.equal((await securitySnapshot()).degraded, true);
  });
});

test("a shared-store outage keeps local protection and logins available, backs off, then recovers", async (t) => {
  let now = fixedNow + 180_000;
  let healthy = false;
  let fetches = 0;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    fetches++;
    if (!healthy) throw new Error("synthetic network outage");
    const command = JSON.parse(String(init?.body)) as unknown[];
    const script = String(command[1]);
    const result = script.includes("HGETALL") ? Array.from({ length: 60 }, () => []) : script.includes("HINCRBY") ? 1 : [1, 60];
    return Response.json({ result });
  });
  await environment(redisEnvironment, async () => {
    let calls = 0;
    const handler = withAbuseProtection("test.redis.outage", "screening", async () => { calls++; return new Response(null, { status: 204 }); });
    for (let index = 0; index < 30; index++) assert.equal((await handler(request("198.51.100.42"))).status, 204);
    assert.equal((await handler(request("198.51.100.42"))).status, 429);
    assert.equal((await handler(request("198.51.100.43"))).status, 204);
    const snapshot = await securitySnapshot();
    assert.equal(snapshot.scope, "instance");
    assert.equal(snapshot.degraded, true);
    assert.equal(fetches, 1, "a failed store must not add a network wait to each subsequent user request");
    assert.deepEqual(snapshot.routes.find(({ route }) => route === "test.redis.outage"), {
      route: "test.redis.outage", requests: 32, blocked: 1, rateLimited: 1, busy: 0, errors: 0, authRejected: 0,
    });
    healthy = true;
    now += 15_001;
    assert.equal((await handler(request("198.51.100.44"))).status, 204);
    const recovered = await securitySnapshot();
    assert.equal(recovered.scope, "shared");
    assert.equal(recovered.degraded, false);
    assert.equal(calls, 32);
    assert.ok(fetches > 1);
  });
});

test("full fallback pools remain isolated by policy and identity class while healthy Redis stays authoritative", async (t) => {
  t.mock.method(Date, "now", () => fixedNow + 240_000);
  await environment({ ARTIQ_TRUSTED_PROXY: "cloudflare" }, async () => {
    for (let index = 0; index < 5_000; index++) {
      assert.equal(await protectAccount("upload", `bounded-creator-${index}`, "test-full-pool"), null);
    }
    const rejected = await protectAccount("upload", "overflow-creator", "test-full-pool");
    assert.equal(rejected?.status, 429);
    assert.equal(await protectAccount("upload", "bounded-creator-0", "test-full-pool"), null, "identity churn cannot evict an existing account quota");
    assert.equal(await protectAccount("transaction", "unrelated-buyer", "test-full-pool"), null, "upload saturation cannot consume another policy's storage");
    const handler = withAbuseProtection("test.upload.pool-isolation", "upload", async () => new Response(null, { status: 204 }));
    assert.equal((await handler(request("203.0.113.26"))).status, 204, "account pool saturation cannot consume the IP pool's storage");
  });
  let sharedRequests = 0;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const command = JSON.parse(String(init?.body)) as unknown[];
    assert.ok(String(command[1]).includes("redis.call('INCR',"));
    sharedRequests++;
    return Response.json({ result: [1, 60] });
  });
  await environment(redisEnvironment, async () => {
    assert.equal(await protectAccount("upload", "shared-creator-after-local-capacity", "test-full-pool"), null);
    assert.equal(sharedRequests, 1, "shared storage can admit an identity even when its bounded local fallback pool is full");
  });
});
