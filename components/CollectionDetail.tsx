"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, LockKeyhole, ShieldCheck } from "lucide-react";
import { isAddress, zeroAddress, type Address, type Hash } from "viem";
import Atmosphere from "@/components/Atmosphere";
import MarketNav from "@/components/MarketNav";
import ReviewerOnly from "@/components/ReviewerOnly";
import CreatorLink from "@/components/CreatorLink";
import WatchlistButton from "@/components/WatchlistButton";
import ShareItemButton from "@/components/ShareItemButton";
import TransactionStatus from "@/components/TransactionStatus";
import CollectionImageGallery, { type GalleryImage } from "@/components/CollectionImageGallery";
import { useProtocolTransaction } from "@/hooks/useProtocolTransaction";
import { useArtiqAccount } from "@/hooks/useArtiqAccount";
import { arcChain } from "@/lib/arcConfig";
import { NFT_KIND_INFO, type NftAttribute, type NftKind } from "@/lib/nftTypes";
import MintAccessPanel from "@/components/MintAccessPanel";
import { useMintAccess } from "@/hooks/useMintAccess";
import { onchainMintConfig, tierNumber } from "@/lib/mintAccess";
import { collectionAbi, displayUsdc, factoryAbi, protocol, usdcAmount } from "@/lib/protocol";

type Item = { imageCount?: number; collectionImages?: GalleryImage[]; id: string; itemType: string; title: string; description: string | null; imageUrl: string | null; nftKind: NftKind | null; metadataUri: string | null; symbol: string | null; maxSupply: number | null; maxPerWallet: number | null; royaltyBps: number | null; mintPriceUsdc: number | null; mintStartTime: string | null; contractAddress: string | null; deploymentFactory?: string | null; attributes: NftAttribute[] | null; creationMethod: string; creator: { id?: string; username: string | null; walletAddress: string | null } };
const button = "gallery-button inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40";

export default function CollectionDetail({ id }: { id: string }) {
  const tx = useProtocolTransaction(); const account = useArtiqAccount();
  const [quantity, setQuantity] = useState("1");
  const identity = account.identity || "guest";
  const itemQuery = useQuery({ queryKey: ["item-detail", id, identity], queryFn: async (): Promise<{ item: Item; isOwner: boolean; metadataUrl: string | null }> => { const response = await fetch(`/api/items/${encodeURIComponent(id)}`, { cache: "no-store", headers: account.headers }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "Collection unavailable."); return body; } });
  const item = itemQuery.data?.item;
  const access = useMintAccess(id, !!itemQuery.data?.isOwner);
  const mintPlan = access.data?.plan;
  const registry = item?.deploymentFactory && isAddress(item.deploymentFactory) ? item.deploymentFactory as Address : protocol.factory;
  const contract = item?.contractAddress && isAddress(item.contractAddress) ? item.contractAddress as Address : null;
  const kind = item?.nftKind || "COLLECTIBLE";
  const chain = useQuery({ queryKey: ["collection-state", contract, tx.address, registry, mintPlan?.root], enabled: !!contract && !!tx.client && !!registry && protocol.isTestnet, refetchInterval: 12_000, queryFn: async () => {
    const client = tx.client!;
    const creator = await client.readContract({ address: registry!, abi: factoryAbi, functionName: "collectionCreator", args: [contract!] });
    if (creator === zeroAddress) throw new Error("This collection was not deployed through the configured Artiq studio factory. In-app minting is unavailable.");
    const [price, start, supply, count, max, minted, owner, proceeds] = await Promise.all([
      client.readContract({ address: contract!, abi: collectionAbi, functionName: "mintPrice" }), client.readContract({ address: contract!, abi: collectionAbi, functionName: "mintStartTime" }),
      client.readContract({ address: contract!, abi: collectionAbi, functionName: "maxSupply" }), client.readContract({ address: contract!, abi: collectionAbi, functionName: "totalMinted" }),
      client.readContract({ address: contract!, abi: collectionAbi, functionName: "maxPerWallet" }), tx.address ? client.readContract({ address: contract!, abi: collectionAbi, functionName: "mintedByWallet", args: [tx.address] }) : BigInt(0),
      client.readContract({ address: contract!, abi: collectionAbi, functionName: "owner" }), client.getBalance({ address: contract! }),
    ]);
    const phase = mintPlan ? await client.readContract({ address: contract!, abi: collectionAbi, functionName: "currentMintPhase" }) : 3;
    const phaseCount = mintPlan && tx.address ? await client.readContract({ address: contract!, abi: collectionAbi, functionName: "phaseMinted", args: [phase, tx.address] }) : BigInt(0);
    const phasePrice = mintPlan && phase < 3 ? usdcAmount(phase === 1 ? mintPlan.config.ultimatePrice : mintPlan.config.fcfsPrice, true) : price;
    const phaseLimit = mintPlan ? BigInt(phase === 1 ? mintPlan.config.ultimateLimit : phase === 2 ? mintPlan.config.fcfsLimit : mintPlan.config.publicLimit) : max;
    const block = await client.getBlock(); return { phase, phaseCount, phasePrice, phaseLimit, price, start, supply, count, max, minted, owner, proceeds, timestamp: block.timestamp };
  } });
  const authHeaders = account.headers;
  async function recordDeployment(txHash: Hash) {
    const response = await fetch(`/api/items/${encodeURIComponent(id)}/deployment`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders }, body: JSON.stringify({ txHash }) });
    const body = await response.json(); if (!response.ok) throw new Error(body.error || "The deployment confirmed, but it could not be attached. Retry using the transaction link below.");
    await itemQuery.refetch();
  }
  function deploy() {
    if (!account.authenticated) { account.login(); return; }
    if (!tx.isConnected || !account.walletAddress) { account.connectWallet(); return; }
    if (!item) return;
    void tx.run(async (write) => {
      if (!protocol.factory) throw new Error("Collection deployment is temporarily unavailable. Please try again later.");
      if ((item.imageCount ?? 1) > 1) {
        const supported = await tx.client?.readContract({ address: protocol.factory, abi: factoryAbi, functionName: "supportsImageSeries" }).catch(() => false);
        if (!supported) throw new Error("Image-series deployment is temporarily unavailable. Please contact the Artiq team for help with your collection.");
      }
      if (!access.data || access.isError || access.isFetching) throw new Error("Wait for mint access settings to finish loading.");
      if (mintPlan && (!mintPlan.root || !mintPlan.frozenAt)) throw new Error("Lock the allowlist before deploying this collection.");
      if (mintPlan && !await tx.client?.readContract({ address: protocol.factory, abi: factoryAbi, functionName: "supportsMintPhases" }).catch(() => false)) throw new Error("Allowlist deployment is temporarily unavailable. Please contact the Artiq team for help with your collection.");
      const uri = itemQuery.data?.metadataUrl;
      if (!uri) throw new Error("Collection metadata is temporarily unavailable. Please try again later.");
      const args = [item.title, item.symbol || "ARTIQ", uri, usdcAmount(String(item.mintPriceUsdc ?? 0), true), BigInt(mintPlan ? Math.floor(Date.parse(mintPlan.config.ultimateStart) / 1000) : item.mintStartTime ? Math.floor(new Date(item.mintStartTime).getTime() / 1000) : 0), BigInt(item.maxSupply || 1), BigInt(item.maxPerWallet || item.maxSupply || 1), BigInt(item.royaltyBps || 0)] as const;
      if (mintPlan?.root) {
        const config = onchainMintConfig(id, mintPlan.root, mintPlan.config);
        return kind === "EDITION" ? write({ address: protocol.factory, abi: factoryAbi, functionName: "createEditionWithPhases", args: [...args, config], chainId: arcChain.id }) : write({ address: protocol.factory, abi: factoryAbi, functionName: "create721WithPhases", args: [...args, kind === "SOULBOUND", config], chainId: arcChain.id });
      }
      return kind === "EDITION" ? write({ address: protocol.factory, abi: factoryAbi, functionName: "createEdition", args, chainId: arcChain.id }) : write({ address: protocol.factory, abi: factoryAbi, functionName: "create721", args: [...args, kind === "SOULBOUND"], chainId: arcChain.id });
    }, recordDeployment);
  }
  function mint(event: FormEvent) {
    event.preventDefault();
    if (!account.authenticated) { account.login(); return; }
    if (!tx.isConnected || !account.walletAddress) { account.connectWallet(); return; }
    void tx.run((write) => {
      if (!chain.data || !contract) throw new Error("Wait for the collection’s on-chain state to load.");
      if (!/^\d+$/.test(quantity) || Number(quantity) < 1 || Number(quantity) > 100) throw new Error("Mint between 1 and 100 tokens per transaction.");
      const amount = BigInt(quantity);
      if (chain.data.timestamp < chain.data.start) throw new Error("This mint has not opened yet.");
      if (chain.data.count + amount > chain.data.supply) throw new Error("There are not enough tokens left in this collection.");
      if (chain.data.minted + amount > chain.data.max) throw new Error("This mint would exceed your wallet’s allocation.");
      if (!access.data || access.isError) throw new Error("Wait for your mint access to load.");
      if (chain.data.phaseCount + amount > chain.data.phaseLimit) throw new Error("This quantity exceeds your remaining allocation for the current phase.");
      if (mintPlan && chain.data.phase < 3) {
        const tier = tierNumber(access.data.entry?.tier || "");
        if (!tier || !access.data.proof || (chain.data.phase === 1 && tier !== 1)) throw new Error("Your wallet does not have access to this mint phase. Wait for your eligible phase or public minting.");
        return write({ address: contract, abi: collectionAbi, functionName: "mintAllowlisted", args: [amount, tier, access.data.proof], value: chain.data.phasePrice * amount, chainId: arcChain.id });
      }
      return write({ address: contract, abi: collectionAbi, functionName: "mint", args: [amount], value: chain.data.price * amount, chainId: arcChain.id });
    }, async () => { await chain.refetch(); await tx.refetchBalance(); });
  }
  const state = chain.data;
  return <main className="gallery-page min-h-screen"><Atmosphere /><MarketNav /><div className="relative mx-auto max-w-6xl px-4 py-10 sm:px-8"><Link href="/nfts" className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--muted-text)]"><ArrowLeft size={14} />All NFT collections</Link>{itemQuery.isLoading ? <p className="mt-10" role="status">Loading collection…</p> : itemQuery.isError || item?.itemType !== "NFT" ? <div className="gallery-card mt-8 p-8"><h1 className="text-2xl">Collection unavailable</h1><p className="mt-3 text-sm text-[var(--muted-text)]">Only approved NFT collections appear here.</p></div> : <><div className="mt-7 grid gap-8 lg:grid-cols-2"><div className="gallery-card relative aspect-square overflow-hidden">{item.imageUrl ? <Image src={item.imageUrl} alt={item.title} fill unoptimized sizes="(min-width:1024px) 50vw,100vw" className="object-cover" /> : <div className="flex h-full items-center justify-center bg-gradient-to-br from-[#b55fbe]/10 to-[#EF476F]/10 text-[#b55fbe]">Artwork coming soon</div>}</div><div><span className="inline-flex items-center gap-2 rounded-full border border-[#b55fbe]/20 bg-[#b55fbe]/5 px-3 py-2 text-[10px] font-semibold text-[#b55fbe]">{kind === "SOULBOUND" && <LockKeyhole size={13} />}{NFT_KIND_INFO[kind].label} · {NFT_KIND_INFO[kind].standard}</span><h1 className="mt-5 break-words text-4xl sm:text-5xl">{item.title}</h1><p className="mt-3 text-xs text-[var(--muted-text)]">By <CreatorLink creator={item.creator} /></p><div className="mt-4 flex flex-wrap gap-3"><WatchlistButton itemId={id} /><ShareItemButton title={item.title} /></div><p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-[var(--muted-text)]">{item.description}</p>{item.creationMethod.startsWith("AI_") && <p className="mt-4 text-xs font-semibold text-[#b55fbe]">{item.creationMethod === "AI_GENERATED" ? "AI-generated NFT" : "AI-assisted NFT"}</p>}<div className="my-6 grid grid-cols-3 gap-3 rounded-2xl border border-[var(--border-soft)] bg-[var(--glass-bg)] p-4">{[["Mint price", `${state ? displayUsdc(state.phasePrice) : item.mintPriceUsdc ?? 0} USDC`], ["Supply", state ? `${state.count} / ${state.supply}` : String(item.maxSupply || 1)], ["Royalty signal", `${(item.royaltyBps || 0) / 100}%`]].map(([label, value]) => <div key={label}><p className="text-[10px] text-[var(--muted-text)]">{label}</p><p className="mt-2 text-sm font-semibold">{value}</p></div>)}</div><p className="text-[11px] leading-6 text-[var(--muted-text)]">{NFT_KIND_INFO[kind].description} {kind === "SOULBOUND" ? "This token cannot be transferred or resold." : "Royalties are advertised through ERC-2981; marketplaces decide whether to honor them."}</p>
      <MintAccessPanel access={access} isOwner={!!itemQuery.data?.isOwner} deployed={!!contract} walletCap={item.maxPerWallet || item.maxSupply || 1} publicPrice={item.mintPriceUsdc ?? 0} onChange={() => void itemQuery.refetch()} />
      {!contract ? <div className="mt-6 rounded-2xl border border-[#b55fbe]/25 bg-[#b55fbe]/5 p-5"><p className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={17} />Approved · awaiting on-chain deployment</p><p className="mt-3 text-xs leading-6 text-[var(--muted-text)]">{itemQuery.data?.isOwner ? "Deploy your approved collection from your connected wallet. The collection will belong to that wallet; deployment costs test USDC gas." : "The creator has not deployed this collection yet. Minting will open here after deployment."}</p>{itemQuery.data?.isOwner && <button className={`${button} mt-4`} disabled={tx.pending || !protocol.factory || !protocol.isTestnet || !access.data || (!!mintPlan && !mintPlan.frozenAt)} onClick={deploy}>Deploy approved collection</button>}{!protocol.factory && <><p className="mt-4 text-xs leading-6 text-[var(--muted-text)]">Collection deployment is temporarily unavailable. Please check back later.</p><ReviewerOnly><Link href="/settings/protocol" className="mt-4 block text-xs font-semibold text-[#b55fbe]">View testnet setup →</Link></ReviewerOnly></>}{tx.hash && tx.error && itemQuery.data?.isOwner && <button className="mt-3 text-xs font-semibold underline" onClick={() => void recordDeployment(tx.hash!).catch((e) => tx.setError(e.message))}>Retry saving confirmed deployment</button>}</div> : <div className="mt-6 rounded-2xl border border-[var(--border-soft)] p-5"><a className="flex items-center gap-2 break-all text-xs font-semibold text-[#b55fbe]" href={`${arcChain.blockExplorers?.default.url}/address/${contract}`} target="_blank" rel="noreferrer">{contract}<ExternalLink size={13} className="shrink-0" /></a>{!protocol.factory && <><p className="mt-4 text-xs leading-6 text-[var(--muted-text)]">Minting is temporarily unavailable. Please check back later.</p><ReviewerOnly><Link href="/settings/protocol" className="mt-4 block text-xs font-semibold text-[#b55fbe]">View testnet setup →</Link></ReviewerOnly></>}{chain.isError ? <p role="alert" className="mt-3 text-xs leading-6 text-rose-500">{chain.error.message}</p> : <form onSubmit={mint} className="mt-4 space-y-3"><p className="text-xs text-[var(--muted-text)]">{state ? state.timestamp < state.start ? `Mint opens ${new Date(Number(state.start) * 1000).toLocaleString()}` : state.count >= state.supply ? "Minted out" : ` ${mintPlan ? ["Not open", "Ultimate", "FCFS", "Public"][state.phase] : "Public"} mint · ${state.max - state.minted < state.phaseLimit - state.phaseCount ? state.max - state.minted : state.phaseLimit - state.phaseCount} remaining for your wallet` : "Checking mint availability…"}</p><label className="block text-xs font-semibold" htmlFor="mint-quantity">Quantity</label><input id="mint-quantity" type="number" min="1" max="100" step="1" required value={quantity} onChange={(e) => setQuantity(e.target.value)} className="w-full rounded-xl border border-[var(--border-soft)] bg-[var(--chip-bg)] px-4 py-3 text-sm" /><button className={`${button} w-full`} disabled={tx.pending || (!!account.walletAddress && (!state || state.count >= state.supply || state.timestamp < state.start))}>{!account.authenticated ? "Sign in to mint" : !account.walletAddress || !tx.isConnected ? "Connect wallet to mint" : "Mint with test USDC"}</button></form>}</div>}{state && state.owner.toLowerCase() === tx.address?.toLowerCase() && state.proceeds > BigInt(0) && <button className={`${button} mt-4`} disabled={tx.pending} onClick={() => void tx.run((write) => write({ address: contract!, abi: collectionAbi, functionName: "withdraw", args: [tx.address!], chainId: arcChain.id }), async () => { await chain.refetch(); await tx.refetchBalance(); })}>Withdraw {displayUsdc(state.proceeds)} USDC mint proceeds</button>}{tx.isWrongNetwork && <button className={`${button} mt-4`} onClick={() => void tx.switchToArc()}>Switch to Arc Testnet</button>}<div className="mt-5"><TransactionStatus pending={tx.pending} error={tx.error} hash={tx.hash} /></div><p className="mt-4 text-[11px] text-[var(--muted-text)]">Arc Testnet only. Test USDC has no monetary value.</p></div></div><CollectionImageGallery images={item.collectionImages} />{!!item.attributes?.length && <section className="mt-10"><h2 className="text-xl">Collection traits</h2><div className="mt-4 grid gap-3 sm:grid-cols-3">{item.attributes.map((a, index) => <div key={index} className="gallery-card p-4"><p className="text-[10px] uppercase tracking-wider text-[#b55fbe]">{a.trait_type}</p><p className="mt-2 break-words text-sm font-semibold">{a.value}</p></div>)}</div></section>}</>}</div></main>;
}
