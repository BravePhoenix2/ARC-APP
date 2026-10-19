"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Mail } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { useEmailSession } from "@/hooks/useEmailSession";
import WalletPicker, { walletErrorMessage } from "@/components/WalletPicker";

function EmailAccountButton() {
  const session = useEmailSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function closeOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setMenuOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) { if (event.key === "Escape") setMenuOpen(false); }
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  if (!session.user) return <Link href="/apply?auth=email" aria-label="Continue with email" className="inline-flex items-center justify-center gap-2 rounded-full border border-[var(--border-soft)] px-3 py-2 text-sm font-semibold transition hover:bg-[var(--chip-bg)]"><Mail size={15} aria-hidden="true" /><span>Email</span></Link>;
  const email = session.user.email;
  const label = email.length > 23 ? `${email.slice(0, 12)}…${email.slice(-8)}` : email;
  return (
    <div ref={rootRef} className="relative">
      <button type="button" aria-expanded={menuOpen} aria-label={`Email account: ${email}`} onClick={() => setMenuOpen((open) => !open)} className="inline-flex max-w-[200px] items-center gap-2 rounded-full border border-[var(--border-soft)] bg-[var(--chip-bg)] px-3 py-2 text-sm font-semibold transition hover:bg-[var(--border-soft)]"><Mail size={15} className="shrink-0 text-[#b55fbe]" aria-hidden="true" /><span className="truncate">{label}</span></button>
      {menuOpen && <div className="absolute right-0 top-full z-40 mt-2 w-64 overflow-hidden rounded-xl border border-[var(--border-soft)] bg-[var(--card-bg)] shadow-lg"><p className="break-all border-b border-[var(--border-soft)] px-4 py-3 text-xs text-[var(--muted-text)]">Signed in as {email}</p><Link href="/apply#my-applications" onClick={() => setMenuOpen(false)} className="block px-4 py-3 text-sm hover:bg-[var(--chip-bg)]">My applications</Link><button type="button" onClick={() => void session.signOut().then((success) => { if (success) setMenuOpen(false); })} disabled={session.isSigningOut} className="block w-full px-4 py-3 text-left text-sm hover:bg-[var(--chip-bg)] disabled:opacity-60">{session.isSigningOut ? "Signing out…" : "Sign out of email"}</button>{session.error && <p role="alert" className="px-4 pb-3 text-xs leading-5 text-[#d73c63] dark:text-[#ff8eab]">{session.error}</p>}</div>}
    </div>
  );
}

export default function ConnectWalletButton({ walletOnly = false }: { walletOnly?: boolean }) {
  return <div className="flex flex-wrap items-center justify-end gap-2">{!walletOnly && <EmailAccountButton />}<WalletConnectionButton /></div>;
}

function WalletConnectionButton() {
  const {
    address,
    connectors,
    activeConnector,
    chainId,
    isConnected,
    isConnecting,
    isWrongNetwork,
    isSwitching,
    truncatedAddress,
    usdcBalance,
    isBalanceLoading,
    isBalanceError,
    refetchBalance,
    connect,
    switchToArc,
    ensureArc,
    disconnect,
    error,
    clearError,
  } = useWallet();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const attemptedNetwork = useRef<string | null>(null);

  useEffect(() => {
    if (!isConnected || !isWrongNetwork) {
      attemptedNetwork.current = null;
      return;
    }
    if (isConnecting || isSwitching) return;
    const key = `${address}:${chainId}`;
    if (attemptedNetwork.current === key) return;
    attemptedNetwork.current = key;
    // Ask once per account/network change, including restored sessions.
    // A rejected request stays visible until the user retries.
    if (!error) void ensureArc();
  }, [address, chainId, isConnected, isWrongNetwork, isConnecting, isSwitching, error, ensureArc]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  if (!isConnected) {
    return (
      <div ref={rootRef} className="relative">
        <button
          type="button"
          onClick={() => { clearError(); setPickerOpen(true); }}
          aria-haspopup="dialog"
          aria-expanded={pickerOpen}
          disabled={isConnecting}
          className="inline-flex items-center justify-center rounded-full border border-[#EF476F] bg-[#EF476F] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#d73c63] disabled:cursor-not-allowed disabled:opacity-60 sm:px-5"
        >
          {isConnecting ? "Connecting…" : "Connect Wallet"}
        </button>

        <WalletPicker open={pickerOpen} onClose={() => setPickerOpen(false)} connectors={connectors} connect={connect} isConnecting={isConnecting} error={error} clearError={clearError} />
      </div>
    );
  }

  if (isWrongNetwork) {
    return (
      <div ref={rootRef} className="relative">
        <button
          type="button"
          onClick={switchToArc}
          disabled={isSwitching || isConnecting}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-[#EF476F] px-4 py-2 text-sm font-semibold text-[#EF476F] disabled:opacity-60"
        >
          {isSwitching || isConnecting ? "Switching…" : "Switch to Arc"}
        </button>
        <div className="absolute right-0 top-full z-40 mt-2 w-64 rounded-xl border border-[var(--border-soft)] bg-[var(--card-bg)] p-3 shadow-lg">
          <p role="status" className="text-xs text-[var(--muted-text)]">
            {error ? walletErrorMessage(error) : "Your wallet is on the wrong network."}
          </p>
          <p className="mt-2 text-xs text-[var(--muted-text)]">{truncatedAddress}</p>
          <button type="button" onClick={disconnect} className="mt-2 text-xs font-semibold text-[#EF476F]">Disconnect</button>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-expanded={menuOpen}
        className="inline-flex items-center gap-2 rounded-full border border-[var(--border-soft)] bg-[var(--chip-bg)] px-4 py-2 text-sm font-semibold text-[var(--page-text)] transition hover:bg-[var(--border-soft)]"
      >
        <span className="h-2 w-2 rounded-full bg-[#2FE6A6]" />
        {isBalanceLoading ? "Loading USDC…" : isBalanceError || usdcBalance === null ? "USDC unavailable" : `${usdcBalance} USDC`}
        <span className="text-[var(--muted-text)]">{truncatedAddress}</span>
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-full z-40 mt-2 w-44 overflow-hidden rounded-xl border border-[var(--border-soft)] bg-[var(--card-bg)] shadow-lg">
          <p className="border-b border-[var(--border-soft)] px-4 py-3 text-xs text-[var(--muted-text)]">{activeConnector?.name ?? "Wallet"}</p>
          {isBalanceError && (
            <button type="button" onClick={() => void refetchBalance()} className="block w-full px-4 py-3 text-left text-sm text-[var(--page-text)]">
              Retry balance
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              disconnect();
              setMenuOpen(false);
              setPickerOpen(true);
            }}
            className="block w-full px-4 py-3 text-left text-sm text-[var(--page-text)] transition hover:bg-[var(--chip-bg)]"
          >
            Change wallet
          </button>
          <button
            type="button"
            onClick={() => {
              disconnect();
              setMenuOpen(false);
            }}
            className="block w-full px-4 py-3 text-left text-sm text-[var(--page-text)] transition hover:bg-[var(--chip-bg)]"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
