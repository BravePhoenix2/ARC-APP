"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useWalletClient } from "wagmi";
import { Copy, ExternalLink, Rocket, ShieldCheck } from "lucide-react";
import { type Abi, type Hash, type Hex } from "viem";
import Atmosphere from "@/components/Atmosphere";
import MarketNav from "@/components/MarketNav";
import TransactionStatus from "@/components/TransactionStatus";
import PlatformRevenue from "@/components/PlatformRevenue";
import { useProtocolTransaction } from "@/hooks/useProtocolTransaction";
import { useArtiqAccount } from "@/hooks/useArtiqAccount";
import { arcChain } from "@/lib/arcConfig";
import { auctionAbi, platformFeeAbi, protocol, transactionError } from "@/lib/protocol";
import { feePresets, percentToBps, readFeeTerms } from "@/lib/monetization";
import { deploymentConfiguration, deploymentKeys, readDeploymentDraft, type StudioDeployment } from "@/lib/studioDeployment";

const button = "gallery-button inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40";
const storageKey = "artiq:studio-testnet-deployment:asset-auctions-v1";
const labels = { factory: "NFT studio factory", artMarket: "Art checkout", auctions: "Auction and rewards house" };
const initialDraft = (): StudioDeployment => ({});

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
  const [feeRecipient, setFeeRecipient] = useState(process.env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT || "");
  const [mintPercent, setMintPercent] = useState("2.5");
  const [salePercent, setSalePercent] = useState("2.5");
  const guard = useRef(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (saved) {
        const draft = { ...initialDraft(), ...readDeploymentDraft(saved) };
        setDeployed(draft); setStarted(true); setHash(draft.pending?.hash || null);
        if (draft.fees) { setFeeRecipient(draft.fees.feeRecipient); setMintPercent(String(draft.fees.mintFeeBps / 100)); setSalePercent(String(draft.fees.marketplaceFeeBps / 100)); }
        if (draft.pending) setStage("A deployment transaction was submitted. Resume to check its confirmation before sending another transaction.");
      }
    } catch { setStorageWarning("Browser storage is unavailable. Keep this tab open until deployment finishes."); }
    setReady(true);
  }, []);
  const previousAuctions = [...(protocol.legacyAuctions || []), ...(protocol.auctions ? [protocol.auctions] : [])];
  const configText = deploymentConfiguration(deployed, previousAuctions);
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
    let fees = deployed.fees;
    try {
      fees ||= readFeeTerms({ feeRecipient: feeRecipient.trim(), mintFeeBps: percentToBps(mintPercent), marketplaceFeeBps: percentToBps(salePercent) }) || undefined;
      if (!fees) throw new Error("Enter a valid, nonzero public wallet address for platform fees.");
    } catch (cause) { setError(transactionError(cause)); return; }
    guard.current = true; setPending(true); setStarted(true); setCopied(false);
    const next = { ...deployed, fees };
    const remember = () => {
      setDeployed({ ...next });
      try { localStorage.setItem(storageKey, JSON.stringify(next)); }
      catch { setStorageWarning("Browser storage is unavailable. Keep this tab open until deployment finishes."); }
    };
    remember();
    try {
      const artifacts = await import("@/lib/contracts/studio-deployments.json");
      for (const key of deploymentKeys) {
        const verifyTerms = async (address: NonNullable<StudioDeployment[typeof key]>) => {
          const [recipient, bps] = await Promise.all([
            tx.client!.readContract({ address, abi: platformFeeAbi, functionName: "feeRecipient" }),
            tx.client!.readContract({ address, abi: platformFeeAbi, functionName: "platformFeeBps" }),
          ]);
          if (recipient.toLowerCase() !== fees.feeRecipient.toLowerCase() || Number(bps) !== (key === "factory" ? fees.mintFeeBps : fees.marketplaceFeeBps)) throw new Error(`The ${labels[key]} fee terms do not match this deployment. Check the saved draft.`);
          if (key === "auctions" && await tx.client!.readContract({ address, abi: auctionAbi, functionName: "supportsAssetAuctions" }) !== true) throw new Error("This auction house does not support digital and physical asset auctions. Deploy the updated contracts.");
        };
        if (next[key]) {
          const code = await tx.client.getCode({ address: next[key]! });
          if (!code || code === "0x") throw new Error(`The saved ${labels[key]} address has no contract on Arc Testnet. Check the address before continuing.`);
          await verifyTerms(next[key]!);
          continue;
        }
        let transaction = next.pending?.key === key ? next.pending.hash : undefined;
        if (!transaction) {
          const artifact = artifacts[key === "factory" ? "ArticStudioFactory" : key === "artMarket" ? "ArticArtMarket" : "ArticAuctionHouse"];
          setStage(`Confirm ${labels[key]} deployment in your wallet.`);
          const feeArgs = [fees.feeRecipient, BigInt(key === "factory" ? fees.mintFeeBps : fees.marketplaceFeeBps)];
          transaction = await walletClient.deployContract({ abi: artifact.abi as Abi, bytecode: artifact.bytecode as Hex, args: key === "auctions" ? [next.factory!, next.artMarket!, ...feeArgs] : feeArgs, account: tx.address, chain: arcChain });
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
        await verifyTerms(receipt.contractAddress);
        next[key] = receipt.contractAddress; delete next.pending; remember();
      }
      setStage("Deployment complete. The full configuration is ready to copy below.");
      await tx.refetchBalance();
    } catch (cause) { setError(transactionError(cause)); }
    finally { setPending(false); guard.current = false; }
  }
  const actionLabel = !tx.isConnected ? account.authenticated ? "Connect wallet to deploy" : "Sign in to deploy" : tx.isWrongNetwork ? "Switch to Arc Testnet" : deployed.pending ? "Resume pending deployment" : started ? "Continue deployment" : "Deploy contracts with asset auctions";
  return <main className="gallery-page min-h-screen"><Atmosphere /><MarketNav />
    <div className="relative mx-auto max-w-4xl px-4 py-12 sm:px-8">
      <Link href="/settings" className="text-xs font-semibold text-[var(--muted-text)]">← Settings</Link>
      <p className="mt-8 text-[10px] font-semibold uppercase tracking-[.18em] text-[#b55fbe]">Project owner · Arc Testnet</p>
      <h1 className="mt-4 text-4xl">Set up marketplace revenue.</h1>
      <p className="mt-5 max-w-2xl text-sm leading-7 text-[var(--muted-text)]">Choose your commission and fee wallet, then deploy the studio, art checkout, and auction contracts. The updated auction house supports timed digital and physical asset listings as well as NFTs. Fees are included in the displayed price and deducted from proceeds.</p>
      <section className="gallery-card mt-8 p-6 sm:p-8">
        <div className="flex items-center gap-3"><ShieldCheck size={23} className="text-[#b55fbe]" /><h2 className="text-xl">{configured ? "Current project addresses" : "Testnet setup required"}</h2></div>
        <div className="mt-6 space-y-4">{deploymentKeys.map((key) => <div key={key} className="rounded-xl border border-[var(--border-soft)] p-4"><p className="text-xs font-semibold">{labels[key]}</p>{protocol[key] ? <a href={`${arcChain.blockExplorers?.default.url}/address/${protocol[key]}`} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-2 break-all font-mono text-[11px] text-[#b55fbe]">{protocol[key]}<ExternalLink size={12} className="shrink-0" /></a> : <p className="mt-2 text-xs text-[var(--muted-text)]">Not configured</p>}</div>)}</div>
        {!complete && <div className="mt-6 space-y-4">
          <fieldset disabled={pending || !!deployed.fees} className="space-y-4 disabled:opacity-70">
            <legend className="text-sm font-semibold">Commission terms</legend>
            <div className="flex flex-wrap gap-3">{Object.entries(feePresets).map(([key, preset]) => <button key={key} type="button" className="rounded-full border border-[var(--border-soft)] px-4 py-2 text-xs font-semibold" onClick={() => { setMintPercent(String(preset.mintFeeBps / 100)); setSalePercent(String(preset.marketplaceFeeBps / 100)); }}>{key === "standard" ? "2.5% on every sale" : "OpenSea: 1% sales / 10% mints"}</button>)}</div>
            <label className="block text-xs font-semibold">Platform fee wallet<input aria-label="Platform fee wallet" value={feeRecipient} onChange={(event) => setFeeRecipient(event.target.value)} placeholder="0x…" className="mt-2 block w-full rounded-xl border border-[var(--border-soft)] bg-[var(--chip-bg)] px-4 py-3 font-mono text-xs" /></label>
            <div className="grid gap-4 sm:grid-cols-2"><label className="block text-xs font-semibold">Primary mint fee (%)<input aria-label="Primary mint fee (%)" type="number" min="0" max="10" step="0.01" value={mintPercent} onChange={(event) => setMintPercent(event.target.value)} className="mt-2 block w-full rounded-xl border border-[var(--border-soft)] bg-[var(--chip-bg)] px-4 py-3 text-sm" /></label><label className="block text-xs font-semibold">Art and auction fee (%)<input aria-label="Art and auction fee (%)" type="number" min="0" max="10" step="0.01" value={salePercent} onChange={(event) => setSalePercent(event.target.value)} className="mt-2 block w-full rounded-xl border border-[var(--border-soft)] bg-[var(--chip-bg)] px-4 py-3 text-sm" /></label></div>
          </fieldset>
          <p className="text-xs leading-6 text-[var(--muted-text)]">Choose one preset or set custom rates up to 10%. Terms are fixed in these contracts after deployment. A 100 USDC sale at 2.5% credits 2.50 USDC to the platform and 97.50 USDC to the seller before any creator royalty. Gas is paid separately. Free mints, refunds, and reward pools have no platform fee. <a className="underline" href="https://support.opensea.io/en/articles/8867091-what-fees-do-i-pay-on-opensea" target="_blank" rel="noreferrer">OpenSea fee reference</a>.</p>
          <p className="text-xs leading-6 text-[var(--muted-text)]">Confirm three new contract deployments using test USDC for gas. Confirmed steps and fee terms are saved so you can resume. Test USDC has no monetary value.</p>
          {configured && <p className="text-xs leading-6 text-[var(--muted-text)]">Before replacing the configured addresses, back up the database, apply the additive schema update, and run npm run studio:pin-factories with the original addresses. Existing collections and art listings retain their original contracts and fee terms. Keep the original auction-house address for existing auctions, refunds, and reward claims.</p>}
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
      <PlatformRevenue />
      <Link href="/auctions" className="mt-6 inline-block text-sm font-semibold text-[#b55fbe]">View auctions and rewards →</Link>
    </div>
  </main>;
}
