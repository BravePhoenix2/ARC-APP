"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import ArticLogo from "@/components/ArticLogo";
import Atmosphere from "@/components/Atmosphere";
import ConnectWalletButton from "@/components/ConnectWalletButton";
import ThemeToggle from "@/components/ThemeToggle";
import { usePrivySession } from "@/hooks/usePrivySession";

type Counters = {
  requests: number;
  blocked: number;
  rateLimited: number;
  busy: number;
  errors: number;
  authRejected?: number;
};

type SecurityMetrics = {
  windowMinutes: number;
  scope: "instance" | "shared";
  degraded: boolean;
  trustedProxy: "cloudflare" | "vercel" | "none";
  startedAt: string;
  totals: Counters;
  routes: (Counters & { route: string })[];
};

class MetricsError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "MetricsError";
  }
}

const secondaryButton = "inline-flex items-center justify-center gap-2 rounded-full border border-[var(--border-soft)] px-4 py-2 text-sm font-semibold transition hover:bg-[var(--chip-bg)] disabled:cursor-not-allowed disabled:opacity-50";
const metrics: { key: keyof Counters; label: string; description: string }[] = [
  { key: "requests", label: "Total requests", description: "Origin requests reaching protected routes." },
  { key: "blocked", label: "Blocked requests", description: "Rate limited and capacity busy requests combined." },
  { key: "rateLimited", label: "Rate limited", description: "Requests above the allowed pace." },
  { key: "busy", label: "Capacity busy", description: "Requests rejected while a route was at capacity." },
  { key: "errors", label: "Server errors", description: "Server failures returned by route handlers." },
  { key: "authRejected", label: "Access denied", description: "Requests refused with a 401 or 403 response. These do not identify bots." },
];

function dateTime(value: string | number) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unavailable" : date.toLocaleString();
}

export default function SecurityPage() {
  const session = usePrivySession();
  const queryClient = useQueryClient();
  const accountId = session.user?.id;
  const authorized = Boolean(session.authenticated && session.user?.isAdmin && session.user.email);

  useEffect(() => {
    if (!session.isLoading && !authorized) queryClient.removeQueries({ queryKey: ["admin-security"] });
  }, [authorized, queryClient, session.isLoading]);

  const query = useQuery<SecurityMetrics, MetricsError>({
    queryKey: ["admin-security", accountId],
    enabled: authorized,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
    queryFn: async ({ signal }) => {
      if (!authorized || !accountId) throw new MetricsError("Sign in with an approved reviewer email to continue.", 403);
      const response = await fetch("/api/admin/security", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { "X-Artiq-Account-ID": accountId },
        signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new MetricsError(typeof body?.error === "string" ? body.error : "Request metrics could not be loaded. Please try again.", response.status);
      }
      return response.json();
    },
  });

  const accessDenied = query.error?.status === 401 || query.error?.status === 403;

  return (
    <main className="gallery-page min-h-screen text-[var(--page-text)]">
      <Atmosphere />
      <header className="gallery-nav z-30 border-b border-[var(--border-soft)] px-6 py-4 sm:px-10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <Link href="/" aria-label="Artiq home"><ArticLogo className="text-2xl" /></Link>
          <div className="flex flex-wrap items-center justify-end gap-3"><Link href="/admin/submissions" className="hidden items-center gap-2 text-sm font-semibold sm:flex"><ArrowLeft size={15} aria-hidden="true" /> Review queue</Link><ThemeToggle /><ConnectWalletButton /></div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-6 py-10 sm:px-10 sm:py-14">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--faint-text)]"><ShieldCheck size={14} aria-hidden="true" /> The curator’s desk</p>
            <h1 className="mt-3 text-4xl font-semibold sm:text-5xl">Request <span className="hero-word">protection.</span></h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-[var(--muted-text)]">Monitor protected API traffic and requests stopped by traffic limits. Counts show requests, not unique people or confirmed bots.</p>
          </div>
          {authorized && <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching} className={secondaryButton}><RefreshCw size={15} className={query.isFetching ? "animate-spin" : ""} aria-hidden="true" />{query.isFetching ? "Refreshing…" : "Refresh metrics"}</button>}
        </div>

        {session.isLoading ? (
          <div role="status" className="gallery-card mt-10 flex items-center gap-3 p-7 text-sm text-[var(--muted-text)]"><LoaderCircle size={18} className="animate-spin" aria-hidden="true" /> Checking reviewer access…</div>
        ) : session.sdkAuthenticated && !session.authenticated ? (
          <section className="gallery-card mx-auto mt-10 max-w-xl p-7 sm:p-9">
            <ShieldCheck size={28} className="text-[#b55fbe]" aria-hidden="true" />
            <h2 className="mt-5 text-2xl">Finish verifying your account</h2>
            <p className="mt-3 text-sm leading-6 text-[var(--muted-text)]">Finish verifying your account to open request metrics.</p>
            {session.pendingAccounts.length > 0 && <div className="mt-5 space-y-3"><p className="text-sm font-semibold">Choose your existing Artiq account</p>{session.pendingAccounts.map((account) => <button key={account.id} type="button" disabled={session.isSyncing} onClick={() => void session.selectAccount(account.id)} className="block w-full break-all rounded-xl border border-[var(--border-soft)] px-4 py-3 text-left text-sm hover:bg-[var(--chip-bg)] disabled:opacity-60">{account.label}</button>)}</div>}
            {!session.pendingAccounts.length && <button type="button" onClick={() => void session.refresh()} disabled={session.isSyncing} className={`${secondaryButton} mt-6`}>{session.isSyncing ? "Verifying…" : "Retry verification"}</button>}
            {session.error && <p role="alert" className="mt-4 text-sm leading-6 text-[#EF476F]">{session.error}</p>}
          </section>
        ) : !session.authenticated ? (
          <section className="gallery-card mx-auto mt-10 max-w-xl p-7 sm:p-9">
            <ShieldCheck size={28} className="text-[#b55fbe]" aria-hidden="true" />
            <h2 className="mt-5 text-2xl">Sign in to view request metrics</h2>
            <p className="mt-3 text-sm leading-6 text-[var(--muted-text)]">Use your approved reviewer email to view traffic and protection activity.</p>
            <button type="button" onClick={() => session.login({ loginMethods: ["email"] })} disabled={!session.configured || !session.ready || session.isSyncing} className="gallery-button mt-6 rounded-full px-5 py-3 text-sm font-semibold text-white disabled:opacity-60">Continue with email</button>
            {!session.configured && <p role="status" className="mt-3 text-sm text-[var(--muted-text)]">Sign-in is being set up. Please check back shortly.</p>}
            {session.error && <p role="alert" className="mt-4 text-sm leading-6 text-[#EF476F]">{session.error}</p>}
          </section>
        ) : !authorized || accessDenied ? (
          <section className="gallery-card mx-auto mt-10 max-w-xl p-7 sm:p-9">
            <ShieldCheck size={28} className="text-[#b55fbe]" aria-hidden="true" />
            <h2 className="mt-5 text-2xl">Reviewer access required</h2>
            <p className="mt-3 text-sm leading-6 text-[var(--muted-text)]">Request metrics are available to approved reviewers. {accessDenied ? "Your access could not be verified. Refresh your session or sign in with an approved reviewer email." : "Sign in with an approved reviewer email to continue."}</p>
            <div className="mt-6 flex flex-wrap gap-3">{accessDenied && <button type="button" disabled={session.isSyncing} onClick={() => void session.refresh().then((verified) => { if (verified) void query.refetch(); })} className={secondaryButton}>{session.isSyncing ? "Verifying…" : "Refresh session"}</button>}<button type="button" onClick={() => void session.logout()} className={secondaryButton}>Sign out to change email</button><Link href="/marketplace" className={secondaryButton}>Marketplace</Link></div>
            {session.error && <p role="alert" className="mt-4 text-sm leading-6 text-[#EF476F]">{session.error}</p>}
          </section>
        ) : query.isPending ? (
          <div role="status" className="gallery-card mt-10 flex items-center gap-3 p-7 text-sm text-[var(--muted-text)]"><LoaderCircle size={18} className="animate-spin" aria-hidden="true" /> Loading request metrics…</div>
        ) : query.isError && !query.data ? (
          <section role="alert" className="gallery-card mt-10 p-7"><h2 className="text-xl">Request metrics are unavailable</h2><p className="mt-3 text-sm leading-6 text-[var(--muted-text)]">{query.error.message}</p><button type="button" disabled={query.isFetching} onClick={() => void query.refetch()} className={`${secondaryButton} mt-5`}>Try again</button></section>
        ) : query.data ? (
          <section className="mt-10" aria-label="Request protection metrics">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs leading-5 text-[var(--muted-text)]">
              <p>Last {query.data.windowMinutes} minutes · Updates every 30 seconds</p>
              <p>Updated {dateTime(query.dataUpdatedAt)}</p>
            </div>
            {query.isError && <p role="alert" className="mt-4 rounded-xl border border-[var(--border-soft)] bg-[var(--chip-bg)] p-4 text-sm leading-6">The latest refresh failed. Showing metrics from {dateTime(query.dataUpdatedAt)}. {query.error.message}</p>}
            {query.data.degraded && <p role="alert" className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm leading-6">Shared protection storage is unavailable. This server is using temporary local limits and counters; protection is not coordinated across servers.</p>}
            {query.data.trustedProxy === "none" && <p role="status" className="mt-4 rounded-xl border border-[var(--border-soft)] bg-[var(--chip-bg)] p-4 text-sm leading-6">Anonymous IP quotas require trusted ingress configuration. Verified account limits and route capacity controls remain active.</p>}
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              {metrics.map((metric) => <article key={metric.key} className="gallery-card p-5"><h2 className="text-sm text-[var(--muted-text)]">{metric.label}</h2><p className="mt-3 break-words text-3xl font-semibold tabular-nums">{(query.data.totals[metric.key] ?? 0).toLocaleString()}</p><p className="mt-3 text-xs leading-5 text-[var(--faint-text)]">{metric.description}</p></article>)}
            </div>
            <div className="gallery-card mt-6 overflow-hidden">
              <div className="border-b border-[var(--border-soft)] p-5 sm:p-6"><h2 className="text-xl">Activity by route</h2><p className="mt-2 text-sm leading-6 text-[var(--muted-text)]">Rate limited and capacity busy requests are included in blocked requests. Server errors are reported separately.</p></div>
              {query.data.routes.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Protected API request counters for the last {query.data.windowMinutes} minutes</caption><thead className="bg-[var(--chip-bg)] text-xs text-[var(--muted-text)]"><tr><th scope="col" className="px-5 py-4 font-semibold">Route</th>{metrics.map((metric) => <th scope="col" key={metric.key} className="whitespace-nowrap px-4 py-4 text-right font-semibold">{metric.label}</th>)}</tr></thead><tbody>{query.data.routes.map((route) => <tr key={route.route} className="border-t border-[var(--border-soft)]"><th scope="row" className="whitespace-nowrap px-5 py-4 font-mono text-xs font-normal">{route.route}</th>{metrics.map((metric) => <td key={metric.key} className="px-4 py-4 text-right tabular-nums">{(route[metric.key] ?? 0).toLocaleString()}</td>)}</tr>)}</tbody></table></div> : <p className="p-6 text-sm leading-6 text-[var(--muted-text)]">No protected requests were recorded during this window.</p>}
            </div>
            <div className="mt-5 space-y-2 text-xs leading-5 text-[var(--muted-text)]">
              <p>{query.data.scope === "shared" ? "Scope: shared counters across application servers." : "Scope: this server instance. Counters reset when this server restarts."}</p>
              <p>{query.data.scope === "shared" ? "Current server started" : "Monitor started"}: {dateTime(query.data.startedAt)}.</p>
              <p>This dashboard contains aggregate counts. It does not display visitor IP addresses or account details.</p>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
