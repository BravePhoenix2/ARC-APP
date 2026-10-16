"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Check, Copy, ExternalLink, Monitor, Moon, Sun, Wallet, Palette, Network } from "lucide-react";
import Atmosphere from "@/components/Atmosphere";
import ArticLogo from "@/components/ArticLogo";
import { useTheme, type ThemePreference } from "@/hooks/useTheme";
import { useWallet } from "@/hooks/useWallet";
import { arcChain } from "@/lib/arcConfig";

const appearances = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;
const panel = "gallery-card p-6 sm:p-8";
const secondaryButton = "rounded-full border border-[var(--border-soft)] px-4 py-2 text-sm font-semibold transition hover:bg-[var(--chip-bg)] disabled:opacity-50";

export default function SettingsPage() {
  const { preference, setPreference } = useTheme();
  const wallet = useWallet();
  const [notice, setNotice] = useState("");
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  function changeAppearance(next: ThemePreference) {
    const saved = setPreference(next);
    setNotice(saved ? "Appearance saved on this device." : "Your browser blocked saving this preference. Enable local storage and try again.");
  }

  async function copyAddress() {
    if (!wallet.address) return;
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopiedAddress(wallet.address);
      setNotice("Wallet address copied.");
    } catch {
      setNotice("Couldn't copy the address. Select and copy it below.");
    }
  }

  const errorText = wallet.error?.type === "no-wallet" ? "No wallet found. Install MetaMask to connect."
    : wallet.error?.type === "rejected" ? "Wallet request declined. You can try again."
    : wallet.error?.type === "unknown" ? wallet.error.message
    : wallet.error ? "Switch to Arc to continue." : null;

  return (
    <main className="gallery-page min-h-screen text-[var(--page-text)]">
      <Atmosphere />
      <header className="gallery-nav border-b border-[var(--border-soft)] px-6 py-5 sm:px-10">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <Link href="/" aria-label="Artiq home"><ArticLogo className="text-2xl" /></Link>
          <Link href="/marketplace" className="flex items-center gap-2 text-sm font-semibold"><ArrowLeft size={16} /> Marketplace</Link>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-6 py-10 sm:px-10 sm:py-14">
        <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--faint-text)]">Make yourself at home</p>
        <h1 className="mt-3 text-4xl font-semibold sm:text-5xl">Your <span className="hero-word">settings.</span></h1>
        <p className="mt-4 text-sm leading-6 text-[var(--muted-text)]">Manage your appearance, connected wallet, and network.</p>
        <p role="status" aria-live="polite" className="mt-4 min-h-6 text-sm text-[var(--muted-text)]">{notice}</p>

        <div className="mt-6 grid gap-6">
          <section className={panel} aria-labelledby="appearance-heading">
            <div className="flex items-center gap-3"><Palette size={20} className="text-[#b55fbe]" /><h2 id="appearance-heading" className="text-lg">Appearance</h2></div>
            <p className="mt-2 text-sm text-[var(--muted-text)]">Choose your canvas. System follows your device’s theme.</p>
            <div role="group" aria-label="Appearance" className="mt-6 grid grid-cols-3 gap-3">
              {appearances.map(({ value, label, Icon }) => (
                <button key={value} type="button" aria-pressed={preference === value} onClick={() => changeAppearance(value)} className={`flex flex-col items-center gap-3 rounded-xl border px-3 py-5 text-sm font-semibold transition ${preference === value ? "border-[#b55fbe] bg-[#b55fbe]/10" : "border-[var(--border-soft)] hover:bg-[var(--chip-bg)]"}`}>
                  <Icon size={22} aria-hidden="true" />{label}
                </button>
              ))}
            </div>
            <p className="mt-4 text-xs text-[var(--faint-text)]">Saved on this browser. Motion follows your device’s accessibility preferences.</p>
          </section>

          <section className={panel} aria-labelledby="wallet-heading">
            <div className="flex items-center gap-3"><Wallet size={20} className="text-[#b55fbe]" /><h2 id="wallet-heading" className="text-lg">Connected wallet</h2></div>
            {wallet.isConnected ? (
              <>
                <p className="mt-4 break-all rounded-xl bg-[var(--chip-bg)] p-4 font-mono text-sm">{wallet.address}</p>
                <p className="mt-4 text-sm text-[var(--muted-text)]">Arc balance: <strong className="text-[var(--page-text)]">{wallet.isBalanceLoading ? "Loading…" : wallet.isBalanceError || wallet.usdcBalance === null ? "Unavailable" : `${wallet.usdcBalance} USDC`}</strong></p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button type="button" onClick={copyAddress} className={`${secondaryButton} flex items-center gap-2`}>{copiedAddress === wallet.address ? <Check size={14} /> : <Copy size={14} />} Copy address</button>
                  <a href={`${arcChain.blockExplorers!.default.url}/address/${wallet.address}`} target="_blank" rel="noreferrer" className={`${secondaryButton} flex items-center gap-2`}>View on explorer <ExternalLink size={14} /></a>
                  {wallet.isBalanceError && <button type="button" onClick={() => void wallet.refetchBalance()} className={secondaryButton}>Retry balance</button>}
                  <button type="button" onClick={() => { wallet.disconnect(); setCopiedAddress(null); setNotice("Wallet disconnected."); }} className={`${secondaryButton} text-[#EF476F]`}>Disconnect</button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-3 text-sm text-[var(--muted-text)]">Connect your wallet to see your address and USDC balance.</p>
                <button type="button" onClick={() => void wallet.connect()} disabled={wallet.isConnecting} className="gallery-button mt-5 inline-flex px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{wallet.isConnecting ? "Connecting…" : "Connect wallet"}</button>
              </>
            )}
            {errorText && <p role="alert" className="mt-4 text-sm text-[#EF476F]">{errorText}</p>}
            {wallet.error?.type === "no-wallet" && <a className="mt-3 inline-block text-sm underline" href="https://metamask.io/download" target="_blank" rel="noreferrer">Get MetaMask</a>}
          </section>

          <section className={panel} aria-labelledby="network-heading">
            <div className="flex items-center gap-3"><Network size={20} className="text-[#b55fbe]" /><h2 id="network-heading" className="text-lg">Network</h2></div>
            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
              <dt className="text-[var(--muted-text)]">Network</dt><dd>{arcChain.name} {arcChain.testnet && <span className="ml-1 rounded-full bg-[#b55fbe]/15 px-2 py-1 text-xs">Testnet</span>}</dd>
              <dt className="text-[var(--muted-text)]">Chain ID</dt><dd className="break-all">{arcChain.id}</dd>
              <dt className="text-[var(--muted-text)]">Gas currency</dt><dd>USDC</dd>
              <dt className="text-[var(--muted-text)]">Wallet status</dt><dd>{wallet.isConnected ? wallet.isWrongNetwork ? "Wrong network" : "Connected to Arc" : "Not connected"}</dd>
            </dl>
            {arcChain.testnet && <div className="mt-5 rounded-xl border border-[#b55fbe]/25 bg-[#b55fbe]/10 p-4"><p className="text-xs leading-5 text-[var(--muted-text)]">You’re using Arc Testnet. Testnet USDC has no monetary value.</p><a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold">Get test USDC <ExternalLink size={14} /></a></div>}
            {wallet.isWrongNetwork && <button type="button" onClick={() => void wallet.switchToArc()} disabled={wallet.isSwitching || wallet.isConnecting} className={`${secondaryButton} mt-5`}>{wallet.isSwitching ? "Switching…" : "Switch to Arc"}</button>}
          </section>
        </div>
      </div>
    </main>
  );
}
