"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@/hooks/useWallet";

function errorMessage(error: NonNullable<ReturnType<typeof useWallet>["error"]>) {
  switch (error.type) {
    case "no-wallet":
      return "No wallet found — install MetaMask to connect.";
    case "rejected":
      return "Wallet request was rejected. Try again when you’re ready.";
    case "wrong-network":
      return "Wrong network — switch to Arc.";
    case "unknown":
      return error.message;
  }
}

export default function ConnectWalletButton() {
  const {
    address,
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
    disconnect,
    error,
    clearError,
  } = useWallet();

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
    if (!error) void switchToArc();
  }, [address, chainId, isConnected, isWrongNetwork, isConnecting, isSwitching, error, switchToArc]);

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
          onClick={connect}
          disabled={isConnecting}
          className="inline-flex items-center justify-center rounded-full border border-[#EF476F] bg-[#EF476F] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#d73c63] disabled:cursor-not-allowed disabled:opacity-60 sm:px-5"
        >
          {isConnecting ? "Connecting…" : "Connect Wallet"}
        </button>

        {error && (
          <div className="absolute right-0 top-full z-40 mt-2 w-60 rounded-xl border border-[var(--border-soft)] bg-[var(--card-bg)] p-3 shadow-lg">
            <p role="alert" className="text-xs leading-5 text-[var(--muted-text)]">{errorMessage(error)}</p>
            {error.type === "no-wallet" && (
              <a
                href="https://metamask.io/download"
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-xs font-semibold text-[#EF476F] hover:text-[#d73c63]"
              >
                Get MetaMask →
              </a>
            )}
            <button
              type="button"
              onClick={clearError}
              className="mt-2 block text-xs font-medium text-[var(--faint-text)] hover:text-[var(--page-text)]"
            >
              Dismiss
            </button>
          </div>
        )}
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
            {error ? errorMessage(error) : "Your wallet is on the wrong network."}
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
