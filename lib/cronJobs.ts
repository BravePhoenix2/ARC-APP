import { timingSafeEqual } from "node:crypto";
import type { reconcileCatalogPage } from "@/lib/catalogSync";
import type { planDataRetention, applyDataRetention } from "@/lib/dataRetention";

const headers = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

function authorizationFailure(request: Request): Response | undefined {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return json({ error: "Scheduled jobs are not configured." }, 503);
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(request.headers.get("authorization") || "");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return json({ error: "Unauthorized." }, 401);
}

/** Load job dependencies only after authentication and query validation. */
export function createCatalogCronHandler(loadJob: () => Promise<typeof reconcileCatalogPage>) {
  return async (request: Request): Promise<Response> => {
    const denied = authorizationFailure(request);
    if (denied) return denied;
    const query = new URL(request.url).searchParams;
    const cursors = query.getAll("cursor");
    if (Array.from(query.keys()).some((key) => key !== "cursor") || cursors.length > 1 || (cursors.length && !/^[a-zA-Z0-9_-]{1,191}$/.test(cursors[0]))) return json({ error: "Provide a valid catalog cursor." }, 400);
    try {
      const syncPage = await loadJob();
      const deadline = Date.now() + 45_000;
      let after: string | undefined = cursors[0];
      let checked = 0;
      let failed = 0;
      let incomplete = false;
      do {
        const page = await syncPage({ limit: Math.min(50, 250 - checked), after, deadline });
        checked += page.results.length;
        failed += page.results.filter((result) => !result.ok).length;
        incomplete = page.hasMore;
        const previous: string | undefined = after;
        after = page.nextCursor || undefined;
        if (!incomplete || failed) break;
        // A deadline can expire before a page starts. Return its cursor so the
        // scheduler can resume rather than spin on an empty/nonadvancing page.
        if (!page.results.length || !after || after === previous) break;
      } while (checked < 250 && Date.now() < deadline);
      return json({ checked, failed, incomplete, nextCursor: incomplete ? after || cursors[0] || null : null }, failed ? 503 : 200);
    } catch {
      return json({ error: "Catalog synchronization was unavailable. Retry this request." }, 503);
    }
  };
}

type MaintenanceDependencies = {
  database: Parameters<typeof planDataRetention>[0];
  plan: typeof planDataRetention;
  apply: typeof applyDataRetention;
};

export function createMaintenanceCronHandler(loadJob: () => Promise<MaintenanceDependencies>) {
  return async (request: Request): Promise<Response> => {
    const denied = authorizationFailure(request);
    if (denied) return denied;
    if (new URL(request.url).search) return json({ error: "This job does not accept parameters." }, 400);
    try {
      const { database, plan, apply } = await loadJob();
      // Upload removal requires stopped content writers and stays a manual job.
      const retention = await plan(database, new Date(), true);
      if (retention.orphans.length) throw new Error("UNEXPECTED_UPLOAD_RETENTION_PLAN");
      const result = await apply(database, retention, false);
      return json({ removedExpiredCredentials: result.removedExpiredCredentials });
    } catch {
      return json({ error: "Credential maintenance was unavailable. Retry this request." }, 503);
    }
  };
}
