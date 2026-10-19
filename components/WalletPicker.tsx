"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, Check, LoaderCircle, Wallet, X } from "lucide-react";
import type { Connector } from "wagmi";
import type { WalletError } from "@/hooks/useWallet";
import { getWalletOptions } from "@/lib/walletOptions";

const walletDetails: Record<string, { name: string; url: string; color: string; symbol: string }> = {
  metaMask: { name: "MetaMask", url: "https://metamask.io/download", color: "#e2761b", symbol: "M" },
  "io.metamask": { name: "MetaMask", url: "https://metamask.io/download", color: "#e2761b", symbol: "M" },
  rabby: { name: "Rabby", url: "https://rabby.io", color: "#8697ef", symbol: "R" },
  "io.rabby": { name: "Rabby", url: "https://rabby.io", color: "#8697ef", symbol: "R" },
  coinbaseWallet: { name: "Coinbase Wallet", url: "https://www.coinbase.com/wallet/downloads", color: "#1652f0", symbol: "C" },
  "com.coinbase.wallet": { name: "Coinbase Wallet", url: "https://www.coinbase.com/wallet/downloads", color: "#1652f0", symbol: "C" },
  "com.coinbase": { name: "Coinbase Wallet", url: "https://www.coinbase.com/wallet/downloads", color: "#1652f0", symbol: "C" },
  trustWallet: { name: "Trust Wallet", url: "https://trustwallet.com/download", color: "#3375bb", symbol: "T" },
  "com.trustwallet": { name: "Trust Wallet", url: "https://trustwallet.com/download", color: "#3375bb", symbol: "T" },
  "com.trustwallet.app": { name: "Trust Wallet", url: "https://trustwallet.com/download", color: "#3375bb", symbol: "T" },
  phantom: { name: "Phantom", url: "https://phantom.com/download", color: "#9474d7", symbol: "P" },
  "app.phantom": { name: "Phantom", url: "https://phantom.com/download", color: "#9474d7", symbol: "P" },
};

type Choice = { connector: Connector; provider: unknown; available: boolean };
type Props = {
  open: boolean;
  onClose: () => void;
  connectors: readonly Connector[];
  connect: (connector?: Connector) => Promise<boolean>;
  isConnecting: boolean;
  error: WalletError | null;
  clearError: () => void;
};

export function walletErrorMessage(error: WalletError) {
  if (error.type === "no-wallet") return "This wallet wasn't detected. Install it or choose another wallet.";
  if (error.type === "rejected") return "Request cancelled. Choose a wallet to try again.";
  if (error.type === "wrong-network") return "Switch your wallet to Arc to continue.";
  return error.message;
}

export default function WalletPicker({ open, onClose, connectors, connect, isConnecting, error, clearError }: Props) {
  const headingId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [isDetecting, setIsDetecting] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const onCloseRef = useRef(onClose);
  const connectingRef = useRef(isConnecting);
  onCloseRef.current = onClose;
  connectingRef.current = isConnecting;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setIsDetecting(true);
    void Promise.all(getWalletOptions(connectors).map(async (connector) => {
      try {
        const provider = await connector.getProvider();
        return { connector, provider, available: Boolean(provider) };
      } catch { return { connector, provider: undefined, available: false }; }
    })).then((found) => {
      if (cancelled) return;
      const seen = new Set<unknown>();
      // Prefer announced providers. Some extensions also expose isMetaMask,
      // so their exact identity must win over a legacy MetaMask fallback.
      const priority = (id: string) => id.includes(".") ? 0 : id === "injected" ? 3 : id === "metaMask" ? 2 : 1;
      const ordered = [...found].sort((a, b) => priority(a.connector.id) - priority(b.connector.id));
      const unique = ordered.filter((choice) => {
        if (!choice.available) return choice.connector.id !== "injected";
        if (seen.has(choice.provider)) return false;
        seen.add(choice.provider);
        return true;
      });
      setChoices(unique.sort((a, b) => Number(b.available) - Number(a.available)));
      setIsDetecting(false);
    });
    return () => { cancelled = true; };
  }, [open, connectors]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !connectingRef.current) {
        event.preventDefault();
        onCloseRef.current();
      }
      if (event.key !== "Tab") return;
      const elements = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]');
      if (!elements?.length) { event.preventDefault(); return; }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
        event.preventDefault(); first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;
  const hasInstalledWallet = choices.some((choice) => choice.available);

  async function choose(connector: Connector) {
    if (isConnecting || selected) return;
    setSelected(connector.uid);
    clearError();
    try {
      if (await connect(connector)) onClose();
    } finally { setSelected(null); }
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#121020]/60 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !isConnecting) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={headingId} aria-describedby={descriptionId} tabIndex={-1} className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-3xl border border-[var(--border-soft)] bg-[var(--card-bg)] p-6 text-[var(--page-text)] shadow-2xl outline-none sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--faint-text)]">Your wallet. Your choice.</p><h2 id={headingId} className="mt-2 text-2xl">Connect a wallet</h2></div>
          <button type="button" aria-label="Close wallet picker" onClick={onClose} disabled={isConnecting} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border-soft)] hover:bg-[var(--chip-bg)] disabled:opacity-50"><X size={16} aria-hidden="true" /></button>
        </div>
        <p id={descriptionId} className="mt-3 text-sm leading-6 text-[var(--muted-text)]">Choose an installed wallet to connect to Arc.</p>
        {isDetecting ? <p role="status" className="mt-6 flex items-center gap-2 text-sm"><LoaderCircle size={16} className="animate-spin" />Finding your wallets…</p> : (
          <>
            {!hasInstalledWallet && <p className="mt-5 rounded-xl bg-[var(--chip-bg)] p-3 text-xs leading-5 text-[var(--muted-text)]">No wallet detected. Install one below, then refresh this page. On mobile, open Artiq inside your wallet’s browser.</p>}
            <div className="mt-5 space-y-2">
              {choices.map(({ connector, available }) => {
                const detail = walletDetails[connector.id];
                const name = detail?.name ?? (connector.id === "injected" ? "Browser wallet" : connector.name);
                const icon = <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-base font-bold text-white" style={{ backgroundColor: detail?.color ?? "#8b6bf2" }}>{detail?.symbol ?? <Wallet size={20} />}</span>;
                const contents = <>{icon}<span className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-semibold">{name}</span><span className="mt-0.5 block text-[11px] text-[var(--muted-text)]">{selected === connector.uid ? "Check your wallet…" : available ? "Detected in this browser" : "Get wallet"}</span></span>{selected === connector.uid ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" /> : available ? <Check size={16} className="text-[#20b88a]" aria-hidden="true" /> : <ArrowUpRight size={16} aria-hidden="true" />}</>;
                const className = "flex w-full items-center gap-3 rounded-2xl border border-[var(--border-soft)] px-4 py-3 transition hover:border-[#b55fbe]/50 hover:bg-[var(--chip-bg)] disabled:cursor-wait disabled:opacity-50";
                return available ? <button key={connector.uid} type="button" onClick={() => void choose(connector)} disabled={isConnecting || selected !== null} className={className} aria-label={`Connect ${name}`}>{contents}</button> : detail ? <a key={connector.uid} href={detail.url} target="_blank" rel="noreferrer" className={className} aria-label={`Get ${name}`}>{contents}</a> : null;
              })}
            </div>
          </>
        )}
        {error && <p role="alert" className="mt-4 rounded-xl bg-[#EF476F]/10 p-3 text-xs leading-5 text-[var(--page-text)]">{walletErrorMessage(error)}</p>}
        <p className="mt-5 border-t border-[var(--border-soft)] pt-4 text-[11px] leading-5 text-[var(--faint-text)]">Connecting is free. You approve any signature or transaction in the wallet you choose.</p>
      </div>
    </div>, document.body,
  );
}
