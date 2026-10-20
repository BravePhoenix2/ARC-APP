"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, LoaderCircle, LogOut, UserRound } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { usePrivySession } from "@/hooks/usePrivySession";
import { walletErrorMessage } from "@/components/WalletPicker";

/** One entry point for email, external wallets, and embedded wallets. */
export default function ConnectWalletButton() {
  const session = usePrivySession();
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const [menuLeft, setMenuLeft] = useState<number>();
  const [signingOut, setSigningOut] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const attemptedNetwork = useRef<string | null>(null);

  useEffect(() => {
    if (!session.authenticated || !wallet.isConnected || !wallet.isWrongNetwork) { attemptedNetwork.current = null; return; }
    if (wallet.isConnecting || wallet.isSwitching) return;
    const key = `${wallet.address}:${wallet.chainId}`;
    if (attemptedNetwork.current === key) return;
    attemptedNetwork.current = key;
    if (!wallet.error) void wallet.ensureArc();
  }, [session.authenticated, wallet.address, wallet.chainId, wallet.isConnected, wallet.isWrongNetwork, wallet.isConnecting, wallet.isSwitching, wallet.error, wallet.ensureArc]);

  useEffect(() => {
    const outside = (event: MouseEvent) => { if (root.current && !root.current.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); root.current?.querySelector("button")?.focus(); } };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape); };
  }, []);
  useEffect(() => { if (session.pendingAccounts.length) setOpen(true); }, [session.pendingAccounts.length]);

  const user = session.user;
  const label = wallet.truncatedAddress || user?.email || (user?.walletAddress ? `${user.walletAddress.slice(0, 6)}…${user.walletAddress.slice(-4)}` : "My account");
  const loading = session.configured && (!session.ready || session.isSyncing);
  const balance = wallet.isBalanceLoading ? "Loading USDC…" : wallet.isBalanceError || wallet.usdcBalance === null ? "USDC unavailable" : `${wallet.usdcBalance} USDC`;

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
  }, [open, label]);

  return <div ref={root} className="relative min-w-0 max-w-full">
    <button type="button" aria-expanded={open} aria-haspopup="true" onClick={() => {
      if (user || session.pendingAccounts.length || !session.configured) { setOpen((value) => !value); return; }
      setOpen(true); session.login();
    }} disabled={loading} className={`inline-flex max-w-full items-center justify-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition disabled:opacity-60 ${user ? "border-[var(--border-soft)] bg-[var(--chip-bg)] hover:bg-[var(--border-soft)]" : "border-[#EF476F] bg-[#EF476F] text-white hover:bg-[#d73c63]"}`}>
      {loading ? <LoaderCircle size={15} className="shrink-0 animate-spin" aria-hidden="true" /> : <UserRound size={15} className="shrink-0" aria-hidden="true" />}
      <span className="max-w-[130px] truncate sm:max-w-[190px]">{loading ? "Signing in…" : user ? label : "Sign in"}</span>
      {user && <><span className="hidden text-xs text-[var(--muted-text)] md:inline">{wallet.isConnected ? balance : "Account"}</span><ChevronDown size={13} className="shrink-0" aria-hidden="true" /></>}
    </button>
    {open && <div role="region" aria-label="Artiq account" style={{ left: menuLeft }} className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--card-bg)] p-4 shadow-xl">
      {!session.configured ? <p role="status" className="text-sm leading-6 text-[var(--muted-text)]">Sign-in is being set up. Please check back shortly.</p> : user ? <>
        <p className="break-all text-sm font-semibold">{user.email || label}</p>
        {wallet.address && <p className="mt-2 break-all font-mono text-[11px] text-[var(--muted-text)]">{wallet.address}</p>}
        {wallet.isConnected && <p className="mt-2 text-xs text-[var(--muted-text)]">{balance}</p>}
        {wallet.isWrongNetwork && <button type="button" disabled={wallet.isSwitching} onClick={() => void wallet.switchToArc()} className="mt-3 text-xs font-semibold text-[#EF476F]">{wallet.isSwitching ? "Switching…" : "Switch to Arc Testnet"}</button>}
        {wallet.isBalanceError && <button type="button" onClick={() => void wallet.refetchBalance()} className="mt-3 block text-xs font-semibold text-[#b55fbe]">Retry balance</button>}
        <Link href="/apply#my-applications" onClick={() => setOpen(false)} className="mt-4 block border-t border-[var(--border-soft)] pt-3 text-sm hover:text-[#b55fbe]">My applications</Link>
        {session.connectedWallets.length > 1 && <label className="mt-3 block text-xs text-[var(--muted-text)]">Active wallet<select aria-label="Active wallet" value={wallet.address?.toLowerCase() ?? ""} onChange={(event) => void session.selectWallet(event.target.value)} className="mt-2 block w-full rounded-lg border border-[var(--border-soft)] bg-[var(--card-bg)] p-2">{session.connectedWallets.map((item) => <option key={item.address} value={item.address.toLowerCase()}>{item.label} · {item.address.slice(0, 6)}…{item.address.slice(-4)}</option>)}</select></label>}
        <button type="button" onClick={() => { setOpen(false); session.connectWallet(); }} className="mt-3 block text-sm hover:text-[#b55fbe]">Add a wallet</button>
        <button type="button" disabled={signingOut} onClick={() => { setSigningOut(true); void session.logout().then((success) => { if (success) setOpen(false); }).finally(() => setSigningOut(false)); }} className="mt-3 flex items-center gap-2 text-sm text-[#EF476F] disabled:opacity-60"><LogOut size={14} aria-hidden="true" />{signingOut ? "Signing out…" : "Sign out"}</button>
      </> : session.pendingAccounts.length ? <>
        <h2 className="text-sm font-semibold">Choose your existing account</h2>
        <p className="mt-2 text-xs leading-6 text-[var(--muted-text)]">We found more than one account you own. Choose which account to use for this sign-in.</p>
        {session.pendingAccounts.map((account) => <button key={account.id} type="button" disabled={session.isSyncing} onClick={() => void session.selectAccount(account.id)} className="mt-3 block w-full break-all rounded-xl border border-[var(--border-soft)] px-3 py-2 text-left text-xs hover:bg-[var(--chip-bg)] disabled:opacity-60">{account.label}</button>)}
      </> : <p role="status" className="text-xs leading-6 text-[var(--muted-text)]">{session.isSyncing ? "Verifying your sign-in…" : "Continue with email or your preferred wallet in the sign-in dialog."}</p>}
      {session.error && <p role="alert" className="mt-3 text-xs leading-6 text-[#d73c63] dark:text-[#ff8eab]">{session.error}</p>}
      {session.error && session.configured && !session.pendingAccounts.length && <button type="button" onClick={() => { if (user) void session.refresh(); else session.login(); }} className="mt-3 text-xs font-semibold text-[#b55fbe]">Try again</button>}
      {!user && session.configured && (session.error || session.pendingAccounts.length > 0) && <button type="button" disabled={signingOut} onClick={() => { setSigningOut(true); void session.logout().then((success) => { if (success) setOpen(false); }).finally(() => setSigningOut(false)); }} className="mt-3 block text-xs font-semibold text-[var(--muted-text)] disabled:opacity-60">{signingOut ? "Signing out…" : "Sign out and start again"}</button>}
      {wallet.error && user && <p role="alert" className="mt-3 text-xs leading-6 text-[#d73c63] dark:text-[#ff8eab]">{walletErrorMessage(wallet.error)}</p>}
    </div>}
  </div>;
}
