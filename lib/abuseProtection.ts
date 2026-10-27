import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { limitedBody } from "@/lib/requestBody";
import { NextRequest, NextResponse } from "next/server";
import { ProtectionStore, emptyCounts, type RateDecision, type SecurityCounts } from "@/lib/protectionStore";

const MINUTE = 60_000;
export const protectionPolicies = {
  read: { limit: 600, windowMs: MINUTE, concurrent: 128, accountLimit: 600 },
  session: { limit: 1200, windowMs: MINUTE, concurrent: 64, accountLimit: 240 },
  interaction: { limit: 600, windowMs: MINUTE, concurrent: 32, accountLimit: 120 },
  login: { limit: 120, windowMs: MINUTE, concurrent: 24, accountLimit: 30 },
  challenge: { limit: 60, windowMs: MINUTE, concurrent: 16, accountLimit: 30 },
  email: { limit: 30, windowMs: MINUTE, concurrent: 8, accountLimit: 10 },
  upload: { limit: 600, windowMs: MINUTE, concurrent: 8, accountLimit: 240 },
  submission: { limit: 120, windowMs: MINUTE, concurrent: 4, accountLimit: 20 },
  transaction: { limit: 120, windowMs: MINUTE, concurrent: 16, accountLimit: 30 },
  screening: { limit: 30, windowMs: MINUTE, concurrent: 2, accountLimit: 10 },
} as const;
export type ProtectionPolicy = keyof typeof protectionPolicies;
type ProtectionState = {
  store: ProtectionStore; ratePools: Map<string, ProtectionStore>; salt: string; redisFailedUntil: number;
  pendingMetrics: Map<number, Map<string, SecurityCounts>>;
  flushTimer?: ReturnType<typeof setTimeout>; flushing?: Promise<void>;
};
const globals = globalThis as unknown as { artiqProtection?: ProtectionState };
const state: ProtectionState = globals.artiqProtection ?? (globals.artiqProtection = {
  store: new ProtectionStore(), ratePools: new Map(), salt: randomBytes(32).toString("hex"),
  redisFailedUntil: 0, pendingMetrics: new Map(),
});

/** Do not trust user-controlled forwarding headers without a restricted ingress. */
export function protectionClientIp(request: NextRequest): string | null {
  const proxy = process.env.ARTIQ_TRUSTED_PROXY;
  // Node route adapters do not supply an IP, and Next 15 removed this property.
  // Older/custom server adapters may still supply trusted request metadata.
  const directIp = (request as NextRequest & { readonly ip?: string }).ip;
  const candidate = proxy === "cloudflare" ? request.headers.get("cf-connecting-ip")
    : proxy === "vercel" ? request.headers.get("x-vercel-forwarded-for") : directIp;
  if (!candidate || candidate.length > 64 || !isIP(candidate)) return null;
  if (isIP(candidate) === 4) return candidate;
  // URL canonicalization prevents alternate IPv6 spellings creating new quotas.
  let normalized: string;
  try { normalized = new URL(`http://[${candidate}]`).hostname.slice(1, -1); }
  catch { return null; }
  if (normalized.startsWith("::ffff:")) {
    const parts = normalized.slice(7).split(":");
    if (parts.length === 2) return `${parseInt(parts[0], 16) >> 8}.${parseInt(parts[0], 16) & 255}.${parseInt(parts[1], 16) >> 8}.${parseInt(parts[1], 16) & 255}`;
  }
  return normalized;
}

function redisConfig() {
  const url = process.env.ARTIQ_SECURITY_REDIS_URL;
  const token = process.env.ARTIQ_SECURITY_REDIS_TOKEN;
  const secret = process.env.ARTIQ_RATE_LIMIT_SECRET;
  if (!url || !token || !secret || secret.length < 32 || state.redisFailedUntil > Date.now()) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    return { url: parsed.href.replace(/\/$/, ""), token, secret };
  } catch { return null; }
}
function fingerprint(subject: string) {
  const secret = process.env.ARTIQ_RATE_LIMIT_SECRET;
  return createHmac("sha256", secret && secret.length >= 32 ? secret : state.salt).update(subject).digest("hex");
}

async function redisCommand(command: unknown[]): Promise<unknown> {
  const config = redisConfig();
  if (!config) throw new Error("SECURITY_STORE_UNAVAILABLE");
  try {
    const response = await fetch(config.url, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(300),
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" }, body: JSON.stringify(command),
    });
    if (!response.ok) throw new Error();
    const result = JSON.parse(new TextDecoder().decode(await limitedBody(response as unknown as Request, 1_048_576, { idleMs: 300, totalMs: 300 })));
    if (result.error || !("result" in result)) throw new Error();
    return result.result;
  } catch {
    // Store outages do not turn into a login outage or repeat a long wait on every request.
    state.redisFailedUntil = Date.now() + 15_000;
    throw new Error("SECURITY_STORE_UNAVAILABLE");
  }
}
const rateScript = `local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
return {count <= tonumber(ARGV[1]) and 1 or 0, math.max(1, math.ceil(redis.call('PTTL', KEYS[1]) / 1000))}`;

async function consume(policy: ProtectionPolicy, subject: string, account: boolean, operation: string = policy): Promise<RateDecision> {
  const rule = protectionPolicies[policy];
  const now = Date.now();
  const limit = account ? rule.accountLimit : rule.limit;
  const key = `${policy}:${account ? `account:${operation}` : "ip"}:${fingerprint(subject)}`;
  // Keep a warm local fallback even while the shared store is healthy.
  const poolName = `${policy}:${account ? "account" : "ip"}`;
  const pool = state.ratePools.get(poolName) ?? new ProtectionStore(5_000);
  state.ratePools.set(poolName, pool);
  const local = pool.consume(key, limit, rule.windowMs, now);
  if ((!local.allowed && !local.capacity) || !redisConfig()) return local;
  try {
    const keyWithWindow = `artiq:security:v1:rate:${key}:${Math.floor(now / rule.windowMs)}`;
    const result = await redisCommand(["EVAL", rateScript, 1, keyWithWindow, limit, rule.windowMs - now % rule.windowMs]) as number[];
    if (!Array.isArray(result) || result.length !== 2 || !result.every(Number.isFinite) || ![0, 1].includes(result[0]) || result[1] < 1) throw new Error();
    return { allowed: result[0] === 1, retryAfter: result[0] === 1 ? 0 : Math.max(1, result[1]) };
  } catch { state.redisFailedUntil = Date.now() + 15_000; return local; }
}

const metricsScript = `for i = 1, #ARGV, 3 do
redis.call('HINCRBY', KEYS[tonumber(ARGV[i])], ARGV[i + 1], ARGV[i + 2]) end
for i, key in ipairs(KEYS) do redis.call('EXPIRE', key, 7200) end
return 1`;

async function flushMetrics(): Promise<void> {
  if (state.flushing) return state.flushing;
  if (!redisConfig() || !state.pendingMetrics.size) return;
  const pending = state.pendingMetrics;
  state.pendingMetrics = new Map();
  const task = (async () => {
    const keys: string[] = [];
    const args: (string | number)[] = [];
    for (const [minute, routes] of Array.from(pending)) {
      keys.push(`artiq:security:v1:metrics:${minute}`);
      for (const [route, counts] of Array.from(routes)) {
        for (const [field, count] of Object.entries(counts)) if (count) args.push(keys.length, `${route}|${field}`, count);
      }
    }
    try {
      const result = await redisCommand(["EVAL", metricsScript, keys.length, ...keys, ...args]);
      if (result !== 1) throw new Error("SECURITY_STORE_UNAVAILABLE");
    } catch { state.redisFailedUntil = Date.now() + 15_000; }
  })();
  state.flushing = task;
  try { await task; } finally { if (state.flushing === task) state.flushing = undefined; }
}

function record(route: string, delta: Partial<SecurityCounts>) {
  state.store.record(route, delta);
  if (!redisConfig()) return;
  const minute = Math.floor(Date.now() / MINUTE);
  for (const key of Array.from(state.pendingMetrics.keys())) if (key < minute - 1) state.pendingMetrics.delete(key);
  const routes = state.pendingMetrics.get(minute) ?? new Map<string, SecurityCounts>();
  const counts = routes.get(route) ?? emptyCounts();
  for (const field of Object.keys(counts) as (keyof SecurityCounts)[]) counts[field] += delta[field] ?? 0;
  routes.set(route, counts);
  state.pendingMetrics.set(minute, routes);
  if (!state.flushTimer) {
    state.flushTimer = setTimeout(() => {
      state.flushTimer = undefined;
      void flushMetrics();
    }, 1_000);
    state.flushTimer.unref?.();
  }
}

function rejected(retryAfter: number, busy = false) {
  return NextResponse.json({
    error: busy ? "This service is busy. Please try again shortly." : "Too many requests. Please wait a moment before trying again.",
    code: busy ? "REQUEST_CAPACITY_REACHED" : "RATE_LIMITED",
  }, { status: 429, headers: { "Cache-Control": "private, no-store", "Retry-After": String(retryAfter) } });
}

const accountLeases = new WeakMap<NextRequest, Array<() => void>>();
const accountBusy = new WeakSet<NextRequest>();
const accountConcurrency: Record<ProtectionPolicy, number> = {
  read: 16, session: 16, interaction: 4, login: 2, challenge: 2, email: 1,
  upload: 2, submission: 1, transaction: 2, screening: 1,
};

/** Call only after authenticating the account; never pass a client-supplied ID. */
export async function protectAccount(policy: ProtectionPolicy, userId: string, operation: string = policy, request?: NextRequest): Promise<NextResponse | null> {
  const result = await consume(policy, userId, true, operation);
  if (!result.allowed) return rejected(result.retryAfter);
  const leases = request ? accountLeases.get(request) : undefined;
  if (request && leases) {
    const release = state.store.acquire(`account:${policy}:${operation}:${fingerprint(userId)}`, accountConcurrency[policy]);
    if (!release) { accountBusy.add(request); return rejected(2, true); }
    leases.push(release);
  }
  return null;
}

const ipConcurrency: Record<ProtectionPolicy, number> = {
  read: 32, session: 24, interaction: 12, login: 8, challenge: 6, email: 2,
  upload: 4, submission: 2, transaction: 4, screening: 1,
};

/** Fixed labels ensure metrics never contain item IDs, emails, wallets or IPs. */
export function withAbuseProtection<Args extends unknown[]>(route: string, policy: ProtectionPolicy,
  handler: (request: NextRequest, ...args: Args) => Promise<Response>) {
  return async (request: NextRequest, ...args: Args): Promise<Response> => {
    // Unidentified clients share a bounded budget. Header churn must never
    // create new identities or turn off request and concurrency protection.
    const networkIdentity = protectionClientIp(request) ?? "unidentified-client";
    // A single slow client must not fill every slot before its body/token can be checked.
    const releaseIp = state.store.acquire(`ip:${policy}:${fingerprint(networkIdentity)}`, ipConcurrency[policy]);
    if (!releaseIp) {
      record(route, { requests: 1, blocked: 1, busy: 1 });
      return rejected(2, true);
    }
    const release = state.store.acquire(policy, protectionPolicies[policy].concurrent);
    if (!release) {
      releaseIp();
      record(route, { requests: 1, blocked: 1, busy: 1 });
      return rejected(2, true);
    }
    let status = 500;
    try {
      const rate = await consume(policy, networkIdentity, false);
      if (!rate.allowed) {
        status = 429;
        return rejected(rate.retryAfter);
      }
      accountLeases.set(request, []);
      const response = await handler(request, ...args);
      status = response.status;
      if (status === 429) {
        response.headers.set("Cache-Control", "private, no-store");
        if (!response.headers.has("Retry-After")) response.headers.set("Retry-After", "30");
      }
      return response;
    } finally {
      release();
      releaseIp();
      for (const free of accountLeases.get(request) ?? []) free();
      accountLeases.delete(request);
      const busy = accountBusy.has(request);
      accountBusy.delete(request);
      record(route, { requests: 1, ...(status === 429 ? { blocked: 1, ...(busy ? { busy: 1 } : { rateLimited: 1 }) } : {}), ...(status >= 500 ? { errors: 1 } : {}), ...(status === 401 || status === 403 ? { authRejected: 1 } : {}) });
    }
  };
}

const snapshotScript = `local rows = {}
for i, key in ipairs(KEYS) do rows[i] = redis.call('HGETALL', key) end
return rows`;
export async function securitySnapshot() {
  const local = state.store.snapshot();
  const configured = Boolean(process.env.ARTIQ_SECURITY_REDIS_URL);
  if (redisConfig()) {
    try {
      await flushMetrics();
      const minute = Math.floor(Date.now() / MINUTE);
      const keys = Array.from({ length: 60 }, (_, index) => `artiq:security:v1:metrics:${minute - index}`);
      const rows = await redisCommand(["EVAL", snapshotScript, keys.length, ...keys]) as string[][];
      if (!Array.isArray(rows) || rows.length !== 60) throw new Error();
      const grouped = new Map<string, SecurityCounts>();
      for (const row of rows) for (let i = 0; i < row.length; i += 2) {
        const [route, field] = row[i].split("|");
        if (!Object.prototype.hasOwnProperty.call(emptyCounts(), field)) continue;
        const counts = grouped.get(route) ?? emptyCounts();
        counts[field as keyof SecurityCounts] += Number(row[i + 1]) || 0;
        grouped.set(route, counts);
      }
      const totals = emptyCounts();
      const routes = Array.from(grouped, ([route, counts]) => ({ route, ...counts })).sort((a, b) => b.requests - a.requests);
      for (const row of routes) for (const field of Object.keys(totals) as (keyof SecurityCounts)[]) totals[field] += row[field];
      return { ...local, scope: "shared" as const, totals, routes, degraded: false, trustedProxy: process.env.ARTIQ_TRUSTED_PROXY || "none" };
    } catch { state.redisFailedUntil = Date.now() + 15_000; }
  }
  return { ...local, degraded: configured, trustedProxy: process.env.ARTIQ_TRUSTED_PROXY || "none" };
}
