"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import ArticLogo from "@/components/ArticLogo";
import { usePrivySession } from "@/hooks/usePrivySession";

const actionClass = "gallery-button inline-flex items-center justify-center gap-2 border border-[#EF476F] bg-[#EF476F] px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-[#d73c63] disabled:opacity-60 sm:px-8 sm:py-4 sm:text-base";

function SignInStatus() {
  const session = usePrivySession();
  if (!session.pendingAccounts.length && !session.sdkAuthenticated && !session.error) return null;
  return <div className="mt-4 max-w-md space-y-3 text-sm leading-6">
    {session.pendingAccounts.length > 0 ? <>
      <p>Choose the account you want to continue with.</p>
      {session.pendingAccounts.map((account) => <button key={account.id} type="button" disabled={session.isSyncing} onClick={() => void session.selectAccount(account.id)} className="block w-full break-all rounded-xl border border-[var(--border-soft)] px-3 py-2 text-left hover:bg-[var(--chip-bg)] disabled:opacity-60">{account.label}</button>)}
    </> : session.sdkAuthenticated && <>
      <p role="status" className="text-[var(--muted-text)]">{session.isSyncing || session.authenticationState === "verifying" ? "Finishing your sign-in…" : "Verify your account to continue."}</p>
      {!session.isSyncing && session.authenticationState === "verification-error" && <button type="button" onClick={() => void session.refresh()} className="font-semibold text-[#EF476F]">Retry verification</button>}
    </>}
    {session.error && <p role="alert" className="text-[#d73c63] dark:text-[#ff8eab]">{session.error}</p>}
    {(session.sdkAuthenticated || session.pendingAccounts.length > 0) && <button type="button" disabled={session.authenticationState === "signing-out"} onClick={() => void session.logout()} className="block text-[var(--muted-text)] underline disabled:opacity-60">{session.authenticationState === "signing-out" ? "Signing out…" : "Sign out"}</button>}
  </div>;
}

export function LaunchAppButton() {
  const session = usePrivySession();
  const router = useRouter();
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    if (!requested || !session.authenticated) return;
    setRequested(false);
    router.push("/nfts");
  }, [requested, router, session.authenticated]);

  function launch() {
    setRequested(true);
    if (!session.authenticated && !session.pendingAccounts.length) session.login();
  }

  return <div className="max-w-full">
    <button type="button" onClick={launch} disabled={!session.ready || (!session.authenticated && session.isSyncing) || session.authenticationState === "signing-out"} className={actionClass}>
      Launch App <span aria-hidden="true">↗</span>
    </button>
    {requested && !session.authenticated && <SignInStatus />}
  </div>;
}

/** Keep app pages unmounted until Privy sign-in is verified by the server. */
export function AppAccessGate({ children }: { children: ReactNode }) {
  const session = usePrivySession();
  const pathname = usePathname();
  const router = useRouter();
  const attemptedPath = useRef<string | null>(null);
  const wasBlocked = useRef(false);
  const publicPage = pathname === "/";
  const login = session.login;

  // A direct visit may have rendered a server permission check before login.
  // Reload that server content using the newly verified session cookie.
  useEffect(() => {
    if (publicPage) { wasBlocked.current = false; return; }
    if (!session.authenticated) { wasBlocked.current = true; return; }
    if (wasBlocked.current) {
      wasBlocked.current = false;
      router.refresh();
    }
  }, [publicPage, router, session.authenticated]);

  useEffect(() => {
    if (publicPage || !session.ready || session.authenticated || session.sdkAuthenticated || session.pendingAccounts.length || !session.configured || session.authenticationState !== "signed-out") return;
    if (attemptedPath.current === pathname) return;
    attemptedPath.current = pathname;
    login();
  }, [login, pathname, publicPage, session.authenticated, session.authenticationState, session.configured, session.pendingAccounts.length, session.ready, session.sdkAuthenticated]);

  if (publicPage || session.authenticated) return <>{children}</>;

  return <main className="gallery-page flex min-h-screen items-center justify-center px-6 py-16 text-[var(--page-text)]">
    <div className="w-full max-w-md">
      <Link href="/" aria-label="Artiq home"><ArticLogo className="text-2xl" /></Link>
      <h1 className="mt-8 text-2xl font-bold">Sign in to enter Artiq</h1>
      <p role="status" className="mb-6 mt-3 text-sm leading-6 text-[var(--muted-text)]">{!session.ready ? "Loading sign-in…" : "Continue with email or your wallet to access the app."}</p>
      {!session.sdkAuthenticated && !session.pendingAccounts.length && <button type="button" className={actionClass} disabled={!session.ready || session.authenticationState === "signing-out"} onClick={() => session.login()}>Sign in to continue</button>}
      <SignInStatus />
      <Link href="/" className="mt-6 inline-block text-sm text-[var(--muted-text)] underline">Back to home</Link>
    </div>
  </main>;
}
