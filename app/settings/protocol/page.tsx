"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useWalletClient } from "wagmi";
import { Copy, ExternalLink, Rocket, ShieldCheck } from "lucide-react";
import { type Abi, type Hash, type Hex } from "viem";
import Atmosphere from "@/components/Atmosphere";
import MarketNav from "@/components/MarketNav";
import TransactionStatus from "@/components/TransactionStatus";
import { useProtocolTransaction } from "@/hooks/useProtocolTransaction";
import { useArtiqAccount } from "@/hooks/useArtiqAccount";
import { arcChain } from "@/lib/arcConfig";
import { protocol, transactionError } from "@/lib/protocol";
import { deploymentConfiguration, deploymentKeys, readDeploymentDraft, type StudioDeployment } from "@/lib/studioDeployment";

const button = "gallery-button inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40";
const storageKey = "artiq:studio-testnet-deployment:phases-v1";
const labels = { factory: "NFT studio factory", artMarket: "Art checkout", auctions: "Auction and rewards house" };
const initialDraft = (): StudioDeployment => protocol.artMarket ? { artMarket: protocol.artMarket } : {};

export default function ProtocolSetupPage() {
  const tx = useProtocolTransaction();
  const account = useArtiqAccount();
  const { data: walletClient } = useWalletClient();
  const [deployed, setDeployed] = useState<StudioDeployment>(initialDraft);
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [pending, setPending] = useState(false);
  const [hash, setHash] = useState<Hash | null>(null);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [storageWarning, setStorageWarning] = useState("");
  const [copied, setCopied] = useState(false);
  const guard = useRef(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (saved) {
        const draft = { ...initialDraft(), ...readDeploymentDraft(saved) };
        setDeployed(draft); setStarted(true); setHash(draft.pending?.hash || null);
        if (draft.pending) setStage("A deployment transaction was submitted. Resume to check its confirmation before sending another transaction.");
      }
    } catch { setStorageWarning("Browser storage is unavailable. Keep this tab open until deployment finishes."); }
    setReady(true);
  }, []);
  const configText = deploymentConfiguration(deployed);
  const complete = configText !== null;
  const configured = !!(protocol.factory && protocol.artMarket && protocol.auctions);
  async function deploy() {
    if (guard.current || !ready || complete) return;
    setError("");
    // Factory creation is permissionless and signed by the wallet; it does not need an app session.
    if (!tx.isConnected || !tx.address) {
      if (account.authenticated) account.connectWallet(); else account.login();
      return;
    }
    if (!protocol.isTestnet) { setError("Deployment is available on Arc Testnet only."); return; }
    if (tx.isWrongNetwork || tx.chainId !== arcChain.id) { await tx.switchToArc(); return; }
    if (!walletClient || !tx.client) { setError("Your wallet is still connecting. Wait a moment and try again."); return; }
    guard.current = true; setPending(true); setStarted(true); setCopied(false);
    const next = { ...deployed };
    const remember = () => {
      setDeployed({ ...next });
      try { localStorage.setItem(storageKey, JSON.stringify(next)); }
      catch { setStorageWarning("Browser storage is unavailable. Keep this tab open until deployment finishes."); }
    };
    remember();
    try {
      const artifacts = await import("@/lib/contracts/studio-deployments.json");
      for (const key of deploymentKeys) {
        if (next[key]) {
          const code = await tx.client.getCode({ address: next[key]! });
          if (!code || code === "0x") throw new Error(`The saved ${labels[key]} address has no contract on Arc Testnet. Check the address before continuing.`);
          continue;
        }
        let transaction = next.pending?.key === key ? next.pending.hash : undefined;
        if (!transaction) {
          const artifact = artifacts[key === "factory" ? "ArticStudioFactory" : key === "artMarket" ? "ArticArtMarket" : "ArticAuctionHouse"];
          setStage(`Confirm ${labels[key]} deployment in your wallet.`);
          transaction = await walletClient.deployContract({ abi: artifact.abi as Abi, bytecode: artifact.bytecode as Hex, args: key === "auctions" ? [next.factory!, next.artMarket!] : [], account: tx.address, chain: arcChain });
          // Persist the hash before waiting: refreshing or a slow RPC must not deploy a duplicate.
          next.pending = { key, hash: transaction }; remember();
        }
        setHash(transaction);
        setStage(`Waiting for ${labels[key]} to confirm on Arc Testnet…`);
        const receipt = await tx.client.waitForTransactionReceipt({ hash: transaction, onReplaced: ({ transactionReceipt }) => {
          if (next.pending) { next.pending = { key, hash: transactionReceipt.transactionHash }; setHash(transactionReceipt.transactionHash); remember(); }
        } });
        if (receipt.status !== "success" || !receipt.contractAddress) {
          delete next.pending; remember();
          throw new Error(`${labels[key]} deployment did not create a contract. Earlier confirmed deployments are saved; you can retry this step.`);
        }
        next[key] = receipt.contractAddress; delete next.pending; remember();
      }
      setStage("Deployment complete. The full configuration is ready to copy below.");
      await tx.refetchBalance();
    } catch (cause) { setError(transactionError(cause)); }
    finally { setPending(false); guard.current = false; }
  }
  const actionLabel = !tx.isConnected ? account.authenticated ? "Connect wallet to deploy" : "Sign in to deploy" : tx.isWrongNetwork ? "Switch to Arc Testnet" : deployed.pending ? "Resume pending deployment" : started ? "Continue deployment" : configured ? "Deploy updated factory and auction house" : "Deploy missing testnet contracts";
  return <main className="gallery-page min-h-screen"><Atmosphere /><MarketNav />
    <div className="relative mx-auto max-w-4xl px-4 py-12 sm:px-8">
      <Link href="/settings" className="text-xs font-semibold text-[var(--muted-text)]">← Settings</Link>
      <p className="mt-8 text-[10px] font-semibold uppercase tracking-[.18em] text-[#b55fbe]">Project owner · Arc Testnet</p>
      <h1 className="mt-4 text-4xl">Activate the NFT studio.</h1>
      <p className="mt-5 max-w-2xl text-sm leading-7 text-[var(--muted-text)]">Deploy the studio contracts from your wallet. Each missing contract needs a confirmed wallet transaction before its address can appear.</p>
      <section className="gallery-card mt-8 p-6 sm:p-8">
        <div className="flex items-center gap-3"><ShieldCheck size={23} className="text-[#b55fbe]" /><h2 className="text-xl">{configured ? "Current project addresses" : "Testnet setup required"}</h2></div>
        <div className="mt-6 space-y-4">{deploymentKeys.map((key) => <div key={key} className="rounded-xl border border-[var(--border-soft)] p-4"><p className="text-xs font-semibold">{labels[key]}</p>{protocol[key] ? <a href={`${arcChain.blockExplorers?.default.url}/address/${protocol[key]}`} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-2 break-all font-mono text-[11px] text-[#b55fbe]">{protocol[key]}<ExternalLink size={12} className="shrink-0" /></a> : <p className="mt-2 text-xs text-[var(--muted-text)]">Not configured</p>}</div>)}</div>
        {!complete && <div className="mt-6 space-y-4">
          <p className="text-xs leading-6 text-[var(--muted-text)]">{protocol.artMarket ? "Your existing art market will be reused. Confirm the new factory transaction, then the new auction-house transaction in your wallet." : "Confirm the factory, art-market, and auction-house transactions in your wallet."} Deployment uses test USDC for gas. Confirmed steps are saved so you can resume.</p>
          {configured && <p className="text-xs leading-6 text-[var(--muted-text)]">The updated factory supports Ultimate, FCFS, and public mint windows. Before changing the configured factory, run npm run studio:pin-factories. Existing auctions and reward pools remain at the original auction house.</p>}
          <button className={button} disabled={pending || !ready || !protocol.isTestnet} onClick={() => void deploy()}><Rocket size={16} />{pending ? "Deploying…" : actionLabel}</button>
        </div>}
        <div className="mt-4"><TransactionStatus pending={pending} error={error} hash={hash} /></div>
        {stage && <p className="mt-4 text-xs leading-6 text-[var(--muted-text)]" role="status">{stage}</p>}
        {storageWarning && <p role="status" className="mt-4 text-xs">{storageWarning}</p>}
        {(started || complete) && <div className="mt-6 space-y-3 rounded-2xl border border-[var(--border-soft)] bg-[var(--chip-bg)] p-5">
          <h3 className="text-sm font-semibold">{complete ? "All contracts confirmed" : "Deployment progress"}</h3>
          {!complete && <><p className="text-xs leading-6 text-[var(--muted-text)]">The configuration will appear once all contract addresses are confirmed.</p>{deploymentKeys.map((key) => <p key={key} className="break-all text-xs"><strong>{labels[key]}:</strong> {deployed[key] || (deployed.pending?.key === key ? "Submitted · awaiting confirmation" : "Not deployed yet")}</p>)}</>}
          {configText && <><p className="text-xs leading-6 text-[var(--muted-text)]">Save these public addresses in .env.local, then rebuild and restart the app.</p><pre className="overflow-x-auto text-[10px] leading-6">{configText}</pre><button className="inline-flex items-center gap-2 text-xs font-semibold text-[#b55fbe]" onClick={() => void navigator.clipboard.writeText(configText).then(() => setCopied(true)).catch(() => setError("Clipboard unavailable. Select and copy the addresses above."))}><Copy size={13} />{copied ? "Copied" : "Copy complete configuration"}</button></>}
          <button disabled={pending || !!deployed.pending} className="block text-xs text-[var(--muted-text)] underline disabled:opacity-40" onClick={() => { localStorage.removeItem(storageKey); setDeployed(initialDraft()); setStarted(false); setStage(""); setError(""); setHash(null); setCopied(false); }}>Clear local draft</button>
        </div>}
      </section>
      <Link href="/auctions" className="mt-6 inline-block text-sm font-semibold text-[#b55fbe]">View auctions and rewards →</Link>
    </div>
  </main>;
}
