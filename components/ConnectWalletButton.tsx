"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@/hooks/useWallet";

function errorMessage(error: NonNullable<ReturnType<typeof useWallet>["error"]>) {
  switch (error.type) {
    case "no-wallet":
      return "No wallet found — install MetaMask to connect.";
    case "rejected":
      return "Connection request was rejected.";
    case "wrong-network":
      return "Wrong network — switch to Arc.";
    case "unknown":
      return error.message;
  }
}

export default function ConnectWalletButton() {
  const {
    isConnected,
    isConnecting,
    isWrongNetwork,
    isSwitching,
    truncatedAddress,
    usdcBalance,
    isBalanceLoading,
    connect,
    switchToArc,
    disconnect,
    error,
    clearError,
  } = useWallet();

  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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
            <p className="text-xs leading-5 text-[var(--muted-text)]">{errorMessage(error)}</p>
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
      <button
        type="button"
        onClick={switchToArc}
        disabled={isSwitching}
        className="inline-flex items-center justify-center gap-2 rounded-full border border-[#EF476F] bg-transparent px-4 py-2 text-sm font-semibold text-[#EF476F] transition hover:bg-[#EF476F]/10 disabled:cursor-not-allowed disabled:opacity-60 sm:px-5"
      >
        <span className="h-2 w-2 rounded-full bg-[#EF476F]" />
        {isSwitching ? "Switching…" : "Wrong network — Switch to Arc"}
      </button>
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
        {isBalanceLoading ? "…" : `${usdcBalance} USDC`}
        <span className="text-[var(--muted-text)]">{truncatedAddress}</span>
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-full z-40 mt-2 w-44 overflow-hidden rounded-xl border border-[var(--border-soft)] bg-[var(--card-bg)] shadow-lg">
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
