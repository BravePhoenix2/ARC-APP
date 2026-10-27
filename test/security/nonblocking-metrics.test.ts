import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { securitySnapshot, withAbuseProtection } from "../../lib/abuseProtection";

async function settleAsyncWork() {
  for (let index = 0; index < 16; index++) await Promise.resolve();
}

test("a stalled metrics batch does not delay responses and requests aggregate before the next flush", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_900_000_000_000 });
  const values = {
    ARTIQ_TRUSTED_PROXY: "cloudflare",
    ARTIQ_SECURITY_REDIS_URL: "https://security-cache.example",
    ARTIQ_SECURITY_REDIS_TOKEN: "synthetic-test-token",
    ARTIQ_RATE_LIMIT_SECRET: "synthetic-rate-limit-secret-of-at-least-32-characters",
  };
  const saved = Object.keys(values).map((key) => [key, process.env[key]] as const);
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  let releaseBatch!: (response: Response) => void;
  let metricsRequests = 0;
  const batch = new Promise<Response>((resolve) => { releaseBatch = resolve; });
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const command = JSON.parse(String(init?.body)) as unknown[];
    if (String(command[1]).includes("HINCRBY")) {
      metricsRequests++;
      return batch;
    }
    if (String(command[1]).includes("redis.call('INCR',")) return Response.json({ result: [1, 60] });
    assert.ok(String(command[1]).includes("HGETALL"));
    return Response.json({ result: Array.from({ length: 60 }, () => []) });
  });
  let handlerCalls = 0;
  const handler = withAbuseProtection("test.metrics.nonblocking", "read", async () => {
    handlerCalls++;
    return new Response(null, { status: 204 });
  });
  let firstFinished = false;
  let secondFinished = false;
  const first = handler(new NextRequest("http://localhost/api/test")).then((response) => {
    firstFinished = true;
    return response;
  });
  let second: Promise<Response> | undefined;
  try {
    await settleAsyncWork();
    assert.equal(firstFinished, true, "the first response completes before a metrics batch is sent");
    assert.equal(metricsRequests, 0);
    t.mock.timers.tick(1_000);
    await settleAsyncWork();
    assert.equal(metricsRequests, 1);
    second = handler(new NextRequest("http://localhost/api/test")).then((response) => {
      secondFinished = true;
      return response;
    });
    await settleAsyncWork();
    assert.equal(secondFinished, true, "another user receives a response while the metrics write is still pending");
    assert.equal(handlerCalls, 2);
    t.mock.timers.tick(1_000);
    await settleAsyncWork();
    assert.equal(metricsRequests, 1, "a second request cannot start overlapping metrics writes");
  } finally {
    releaseBatch(Response.json({ result: 1 }));
    await Promise.allSettled([first, ...(second ? [second] : [])]);
    await securitySnapshot();
  }
  assert.equal((await first).status, 204);
  assert.equal((await second)?.status, 204);
});
