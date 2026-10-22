export type SecurityCounts = { requests: number; blocked: number; rateLimited: number; busy: number; errors: number; authRejected: number };
export const emptyCounts = (): SecurityCounts => ({ requests: 0, blocked: 0, rateLimited: 0, busy: 0, errors: 0, authRejected: 0 });
export type RateDecision = { allowed: boolean; retryAfter: number; capacity?: true };

/** Bounded process-local fallback. Never evict live quotas to admit new identities. */
export class ProtectionStore {
  private buckets = new Map<string, { count: number; end: number }>();
  private minutes = new Map<number, Map<string, SecurityCounts>>();
  private nextPruneAt = 0;
  private active = new Map<string, number>();
  readonly startedAt = new Date().toISOString();
  constructor(readonly maxBuckets = 10_000) {}

  consume(key: string, limit: number, windowMs: number, now = Date.now()): RateDecision {
    const end = (Math.floor(now / windowMs) + 1) * windowMs;
    let bucket = this.buckets.get(key);
    if (bucket && bucket.end <= now) { this.buckets.delete(key); bucket = undefined; }
    if (!bucket) {
      if (this.buckets.size >= this.maxBuckets && now >= this.nextPruneAt) {
        for (const [id, entry] of Array.from(this.buckets)) if (entry.end <= now) this.buckets.delete(id);
        this.nextPruneAt = now + 1_000;
      }
      if (this.buckets.size >= this.maxBuckets) return { allowed: false, retryAfter: 1, capacity: true };
      bucket = { count: 0, end };
      this.buckets.set(key, bucket);
    }
    if (bucket.count >= limit) return { allowed: false, retryAfter: Math.max(1, Math.ceil((bucket.end - now) / 1000)) };
    bucket.count++;
    return { allowed: true, retryAfter: 0 };
  }

  acquire(route: string, limit: number): (() => void) | null {
    const count = this.active.get(route) ?? 0;
    if (count >= limit) return null;
    this.active.set(route, count + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (this.active.get(route) ?? 1) - 1;
      if (remaining) this.active.set(route, remaining);
      else this.active.delete(route);
    };
  }

  record(route: string, delta: Partial<SecurityCounts>, now = Date.now()) {
    const minute = Math.floor(now / 60_000);
    for (const key of Array.from(this.minutes.keys())) if (key < minute - 59) this.minutes.delete(key);
    const routes = this.minutes.get(minute) ?? new Map<string, SecurityCounts>();
    const counts = routes.get(route) ?? emptyCounts();
    for (const field of Object.keys(counts) as (keyof SecurityCounts)[]) counts[field] += delta[field] ?? 0;
    routes.set(route, counts);
    this.minutes.set(minute, routes);
  }

  snapshot(now = Date.now()) {
    const routes = new Map<string, SecurityCounts>();
    const minute = Math.floor(now / 60_000);
    for (const [time, entries] of Array.from(this.minutes)) {
      if (time < minute - 59) { this.minutes.delete(time); continue; }
      for (const [route, value] of Array.from(entries)) {
        const counts = routes.get(route) ?? emptyCounts();
        for (const field of Object.keys(counts) as (keyof SecurityCounts)[]) counts[field] += value[field];
        routes.set(route, counts);
      }
    }
    const totals = emptyCounts();
    const rows = Array.from(routes, ([route, counts]) => ({ route, ...counts })).sort((a, b) => b.requests - a.requests);
    for (const row of rows) for (const field of Object.keys(totals) as (keyof SecurityCounts)[]) totals[field] += row[field];
    return { windowMinutes: 60, scope: "instance" as const, startedAt: this.startedAt, totals, routes: rows };
  }
}
