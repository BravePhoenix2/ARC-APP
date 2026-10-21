"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useWalletClient } from "wagmi";
import { Copy, ExternalLink, Rocket, ShieldCheck } from "lucide-react";
import { isAddress, type Abi, type Address, type Hex } from "viem";
import Atmosphere from "@/components/Atmosphere";
import MarketNav from "@/components/MarketNav";
import TransactionStatus from "@/components/TransactionStatus";
import { useProtocolTransaction } from "@/hooks/useProtocolTransaction";
import { arcChain } from "@/lib/arcConfig";
import { protocol, transactionError } from "@/lib/protocol";

type Deployment = { factory?: Address; artMarket?: Address; auctions?: Address };
const button = "gallery-button inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40";
const storageKey = "artiq:studio-testnet-deployment:phases-v1";

export default function ProtocolSetupPage() {
  const tx = useProtocolTransaction();
  const { data: walletClient } = useWalletClient();
  const [deployed, setDeployed] = useState<Deployment>({});
  const [pending, setPending] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [upgrading, setUpgrading] = useState(false);
  const [copied, setCopied] = useState(false);
  const guard = useRef(false);
  useEffect(() => {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || "{}");
      setDeployed(Object.fromEntries(["factory", "artMarket", "auctions"].flatMap((key) => typeof value[key] === "string" && isAddress(value[key]) ? [[key, value[key]]] : [])));
    } catch { /* A malformed local draft does not affect deployed contracts. */ }
  }, []);
  const complete = !!(deployed.factory && deployed.artMarket && deployed.auctions);
  const configured = !!(protocol.factory && protocol.artMarket && protocol.auctions);
  const configText = `NEXT_PUBLIC_STUDIO_FACTORY_ADDRESS=${deployed.factory || ""}\nNEXT_PUBLIC_ART_MARKET_ADDRESS=${deployed.artMarket || ""}\nNEXT_PUBLIC_AUCTION_HOUSE_ADDRESS=${deployed.auctions || ""}`;
  async function deploy() {
    if (guard.current) return;
    setError("");
    if (!protocol.isTestnet || tx.chainId !== 5042002 || !tx.address || !walletClient || !tx.client) { setError("Connect a funded Arc Testnet wallet before deploying."); return; }
    guard.current = true; setPending(true);
    const next = { ...deployed };
    try {
      const artifacts = await import("@/lib/contracts/studio-deployments.json");
      const remember = () => { setDeployed({ ...next }); localStorage.setItem(storageKey, JSON.stringify(next)); };
      for (const key of ["factory", "artMarket", "auctions"] as const) {
        if (next[key]) {
          if (!(await tx.client.getCode({ address: next[key]! }))) throw new Error(`The saved ${key} address has no contract on Arc Testnet. Clear the local draft and try again.`);
          continue;
        }
        const artifact = artifacts[key === "factory" ? "ArticStudioFactory" : key === "artMarket" ? "ArticArtMarket" : "ArticAuctionHouse"];
        setStage(`Confirm ${key === "factory" ? "NFT studio factory" : key === "artMarket" ? "art checkout" : "auction and rewards house"} deployment in your wallet.`);
        const hash = await walletClient.deployContract({ abi: artifact.abi as Abi, bytecode: artifact.bytecode as Hex, args: key === "auctions" ? [next.factory!, next.artMarket!] : [], account: tx.address, chain: arcChain });
        setStage("Waiting for the deployment to confirm on Arc Testnet…");
        const receipt = await tx.client.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("Deployment reverted. Completed earlier steps are saved for retry.");
        next[key] = receipt.contractAddress; remember();
      }
      setStage("All three testnet contracts are deployed. Save the public configuration below, then rebuild and restart Artiq.");
      await tx.refetchBalance();
    } catch (cause) { setError(transactionError(cause)); }
    finally { setPending(false); guard.current = false; }
  }
  return <main className="gallery-page min-h-screen"><Atmosphere /><MarketNav /><div className="relative mx-auto max-w-4xl px-4 py-12 sm:px-8"><Link href="/settings" className="text-xs font-semibold text-[var(--muted-text)]">← Settings</Link><p className="mt-8 text-[10px] font-semibold uppercase tracking-[.18em] text-[#b55fbe]">Project owner · Arc Testnet</p><h1 className="mt-4 text-4xl">Activate the NFT studio.</h1><p className="mt-5 max-w-2xl text-sm leading-7 text-[var(--muted-text)]">Deploy the collection factory, art checkout, and auction house from your wallet. This is project setup; collectors do not need to deploy these contracts themselves.</p><section className="gallery-card mt-8 p-6 sm:p-8"><div className="flex items-center gap-3"><ShieldCheck size={23} className="text-[#b55fbe]" /><h2 className="text-xl">{configured ? "Public addresses configured" : "Testnet setup required"}</h2></div><div className="mt-6 space-y-4">{[["NFT studio factory", protocol.factory], ["Art checkout", protocol.artMarket], ["Auctions & rewards", protocol.auctions]].map(([label, address]) => <div key={label} className="rounded-xl border border-[var(--border-soft)] p-4"><p className="text-xs font-semibold">{label}</p>{address ? <a href={`${arcChain.blockExplorers?.default.url}/address/${address}`} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-2 break-all font-mono text-[11px] text-[#b55fbe]">{address}<ExternalLink size={12} className="shrink-0" /></a> : <p className="mt-2 text-xs text-[var(--muted-text)]">Not configured</p>}</div>)}</div>{configured && !upgrading && <div className="mt-6 space-y-3"><p className="text-xs leading-6 text-[var(--muted-text)]">Older factories do not support allowlist mint phases. The updated factory supports Ultimate, FCFS, and public windows for new collections. Existing collections keep their deployed rules. Before changing factory addresses, run npm run studio:pin-factories to preserve existing collection links. Existing auctions and reward rounds remain at the original auction house.</p><button className={button} disabled={pending} onClick={() => { setUpgrading(true); setDeployed(protocol.artMarket ? { artMarket: protocol.artMarket } : {}); localStorage.removeItem(storageKey); }}>Prepare updated factory and auction house</button></div>}{(!configured || upgrading) && <><p className="mt-6 text-xs leading-6 text-[var(--muted-text)]">You’ll confirm up to three deployments and pay network gas in test USDC. No funds are sent to a reward pool during setup. Completed steps are saved in this browser so you can resume.</p>{tx.isWrongNetwork ? <button className={`${button} mt-5`} onClick={() => void tx.switchToArc()}>Switch to Arc Testnet</button> : <button className={`${button} mt-5`} disabled={pending || !tx.isConnected || !protocol.isTestnet || complete} onClick={() => void deploy()}><Rocket size={16} />{pending ? "Deploying…" : complete ? "Contracts deployed" : !tx.isConnected ? "Connect a wallet to deploy" : "Deploy testnet contracts"}</button>}<TransactionStatus pending={pending} error={error} hash={null} />{stage && <p className="mt-4 text-xs leading-6 text-[var(--muted-text)]" role="status">{stage}</p>}</>}{Object.keys(deployed).length > 0 && <div className="mt-6 rounded-2xl border border-[var(--border-soft)] bg-[var(--chip-bg)] p-5"><h3 className="text-sm font-semibold">Your deployment configuration</h3><p className="mt-2 text-xs leading-6 text-[var(--muted-text)]">Save these public addresses in your project’s .env.local file, then rebuild and restart the app. They are contract addresses, not private keys.</p><pre className="mt-4 overflow-x-auto text-[10px] leading-6">{configText}</pre><div className="mt-4 flex flex-wrap gap-4"><button className="inline-flex items-center gap-2 text-xs font-semibold text-[#b55fbe]" onClick={() => void navigator.clipboard.writeText(configText).then(() => setCopied(true)).catch(() => setError("Clipboard unavailable. Select and copy the addresses above."))}><Copy size={13} />{copied ? "Copied" : "Copy configuration"}</button><button disabled={pending} className="text-xs text-[var(--muted-text)] underline" onClick={() => { localStorage.removeItem(storageKey); setDeployed({}); setStage(""); }}>Clear local draft</button></div></div>}</section><Link href="/auctions" className="mt-6 inline-block text-sm font-semibold text-[#b55fbe]">View auctions and rewards →</Link></div></main>;
}
