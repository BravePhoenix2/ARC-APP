"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { LoaderCircle, LogOut, UserRound } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { usePrivySession } from "@/hooks/usePrivySession";
import { walletErrorMessage } from "@/components/WalletPicker";

/** Privy sign-in becomes a profile immediately; private actions still require server verification. */
export default function ConnectWalletButton() {
  const session = usePrivySession();
  const wallet = useWallet();
  const { address, chainId, isConnected, isWrongNetwork, isConnecting, isSwitching, error: walletError, ensureArc } = wallet;
  const [open, setOpen] = useState(false);
  const [menuLeft, setMenuLeft] = useState<number>();
  const [signingOut, setSigningOut] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const attemptedNetwork = useRef<string | null>(null);
  const user = session.user;
  const signedIn = session.sdkAuthenticated || Boolean(user);
  const email = user?.email || session.profile?.email;
  const accountAddress = user?.walletAddress || session.profile?.walletAddress;
  const shortAddress = accountAddress ? `${accountAddress.slice(0, 6)}…${accountAddress.slice(-4)}` : null;
  const label = email || shortAddress || "My profile";
  const initial = email?.slice(0, 1).toUpperCase();
  const accountWallet = Boolean(address && user?.walletAddresses.some((linked) => linked.toLowerCase() === address.toLowerCase()));
  const loading = session.configured && !session.ready;
  const loggingOut = signingOut || session.authenticationState === "signing-out";
  const balance = wallet.isBalanceLoading ? "Loading USDC…" : wallet.isBalanceError || wallet.usdcBalance === null ? "USDC unavailable" : `${wallet.usdcBalance} USDC`;

  useEffect(() => {
    if (!session.authenticated || !accountWallet || !isConnected || !isWrongNetwork) { attemptedNetwork.current = null; return; }
    if (isConnecting || isSwitching) return;
    const key = `${address}:${chainId}`;
    if (attemptedNetwork.current === key) return;
    attemptedNetwork.current = key;
    if (!walletError) void ensureArc();
  }, [session.authenticated, accountWallet, address, chainId, isConnected, isWrongNetwork, isConnecting, isSwitching, walletError, ensureArc]);

  useEffect(() => {
    const outside = (event: MouseEvent) => { if (root.current && !root.current.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); root.current?.querySelector("button")?.focus(); } };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape); };
  }, []);
  useEffect(() => { if (session.pendingAccounts.length || (signedIn && session.error)) setOpen(true); }, [session.pendingAccounts.length, signedIn, session.error]);

  useEffect(() => {
    if (!open) return;
    const alignMenu = () => {
      const bounds = root.current?.getBoundingClientRect();
      if (!bounds) return;
      const width = Math.min(288, window.innerWidth - 32);
      const left = Math.max(16, Math.min(bounds.right - width, window.innerWidth - width - 16));
      setMenuLeft(left - bounds.left);
    };
    alignMenu();
    window.addEventListener("resize", alignMenu);
    return () => window.removeEventListener("resize", alignMenu);
  }, [open, label, signedIn]);

  function signOut() {
    setSigningOut(true);
    void session.logout().then((success) => { if (success) setOpen(false); }).finally(() => setSigningOut(false));
  }

  return <div ref={root} className="relative flex min-w-0 max-w-full items-center gap-3">
    {signedIn && user && accountWallet && <span className="hidden text-right text-xs md:block"><span className="block font-semibold">{balance}</span><span className="mt-0.5 block font-mono text-[10px] text-[var(--muted-text)]">{wallet.truncatedAddress}</span></span>}
    <button type="button" aria-label={signedIn ? "Open profile menu" : undefined} title={signedIn ? label : undefined} aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => {
      if (signedIn || session.pendingAccounts.length || !session.configured) { setOpen((value) => !value); return; }
      setOpen(true); session.login();
    }} disabled={loggingOut || (!signedIn && loading)} className={signedIn ? "relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#b55fbe]/40 bg-[var(--card-bg)] p-0.5 transition hover:ring-2 hover:ring-[#b55fbe]/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b55fbe] disabled:opacity-60" : "inline-flex max-w-full items-center justify-center gap-2 rounded-full border border-[#EF476F] bg-[#EF476F] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#d73c63] disabled:opacity-60"}>
      {signedIn ? <><span aria-hidden="true" className="flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-[#ee83b7] via-[#b55fbe] to-[#7069b0] text-sm font-bold text-white">{initial || <UserRound size={18} />}</span><span aria-hidden="true" className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--card-bg)] ${session.authenticated ? "bg-[#2FE6A6]" : "bg-amber-400"}`} /></> : <>{loading ? <LoaderCircle size={15} className="shrink-0 animate-spin" aria-hidden="true" /> : <UserRound size={15} className="shrink-0" aria-hidden="true" />}<span>{loading ? "Loading…" : "Sign in"}</span></>}
    </button>
    {open && <div id={menuId} role="region" aria-label="Artiq account" style={{ left: menuLeft }} className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--card-bg)] p-4 shadow-xl">
      {!session.configured ? <p role="status" className="text-sm leading-6 text-[var(--muted-text)]">Sign-in is being set up. Please check back shortly.</p> : <>
        {signedIn && <><p className="break-all text-sm font-semibold">{label}</p>{accountAddress && <p className="mt-2 break-all font-mono text-[11px] text-[var(--muted-text)]">{accountAddress}</p>}</>}
        {session.pendingAccounts.length ? <>
          <h2 className="mt-3 text-sm font-semibold">Choose your existing account</h2>
          <p className="mt-2 text-xs leading-6 text-[var(--muted-text)]">Choose the account whose applications you want to manage.</p>
          {session.pendingAccounts.map((account) => <button key={account.id} type="button" disabled={session.isSyncing} onClick={() => void session.selectAccount(account.id)} className="mt-3 block w-full break-all rounded-xl border border-[var(--border-soft)] px-3 py-2 text-left text-xs hover:bg-[var(--chip-bg)] disabled:opacity-60">{account.label}</button>)}
        </> : user ? <>
          {accountWallet && <p className="mt-2 text-xs text-[var(--muted-text)]">{balance}</p>}
          {accountWallet && wallet.isWrongNetwork && <button type="button" disabled={wallet.isSwitching} onClick={() => void wallet.switchToArc()} className="mt-3 text-xs font-semibold text-[#EF476F]">{wallet.isSwitching ? "Switching…" : "Switch to Arc Testnet"}</button>}
          {accountWallet && wallet.isBalanceError && <button type="button" onClick={() => void wallet.refetchBalance()} className="mt-3 block text-xs font-semibold text-[#b55fbe]">Retry balance</button>}
          <Link href="/apply#my-applications" onClick={() => setOpen(false)} className="mt-4 block border-t border-[var(--border-soft)] pt-3 text-sm hover:text-[#b55fbe]">My applications</Link>
          <Link href="/settings" onClick={() => setOpen(false)} className="mt-3 block text-sm hover:text-[#b55fbe]">Profile & settings</Link>
          {user.isAdmin && user.email && <Link href="/admin/submissions" onClick={() => setOpen(false)} className="mt-3 block text-sm hover:text-[#b55fbe]">Reviewer dashboard</Link>}
          {session.connectedWallets.length > 1 && <label className="mt-3 block text-xs text-[var(--muted-text)]">Active wallet<select aria-label="Active wallet" value={wallet.address?.toLowerCase() ?? ""} onChange={(event) => void session.selectWallet(event.target.value)} className="mt-2 block w-full rounded-lg border border-[var(--border-soft)] bg-[var(--card-bg)] p-2">{session.connectedWallets.map((item) => <option key={item.address} value={item.address.toLowerCase()}>{item.label} · {item.address.slice(0, 6)}…{item.address.slice(-4)}</option>)}</select></label>}
          <button type="button" onClick={() => { setOpen(false); session.connectWallet(); }} className="mt-3 block text-sm hover:text-[#b55fbe]">Add a wallet</button>
        </> : signedIn ? <>
          <p role="status" className="mt-3 text-xs leading-6 text-[var(--muted-text)]">{session.isSyncing ? "Finishing your account setup…" : "Your Privy sign-in is complete. Finish verifying your account to continue."}</p>
          {!session.isSyncing && <button type="button" onClick={() => void session.refresh()} className="mt-3 text-xs font-semibold text-[#b55fbe]">Retry verification</button>}
        </> : <p role="status" className="text-xs leading-6 text-[var(--muted-text)]">Continue with email or your preferred wallet in the sign-in dialog.</p>}
        {session.error && <p role="alert" className="mt-3 text-xs leading-6 text-[#d73c63] dark:text-[#ff8eab]">{session.error}</p>}
        {!signedIn && session.error && !session.pendingAccounts.length && <button type="button" onClick={() => session.login()} className="mt-3 text-xs font-semibold text-[#b55fbe]">Try again</button>}
        {(signedIn || session.error || session.pendingAccounts.length > 0) && <button type="button" disabled={loggingOut} onClick={signOut} className="mt-4 flex items-center gap-2 border-t border-[var(--border-soft)] pt-3 text-sm text-[#EF476F] disabled:opacity-60"><LogOut size={14} aria-hidden="true" />{loggingOut ? "Signing out…" : "Sign out"}</button>}
        {wallet.error && accountWallet && <p role="alert" className="mt-3 text-xs leading-6 text-[#d73c63] dark:text-[#ff8eab]">{walletErrorMessage(wallet.error)}</p>}
      </>}
    </div>}
  </div>;
}
