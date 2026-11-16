"use client";

import { useEffect, useState, type FormEvent } from "react";
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
import RegistrationRecovery from "@/components/RegistrationRecovery";
import CollectionCreationPayment from "@/components/CollectionCreationPayment";
import { useCollectionCreationPayment } from "@/hooks/useCollectionCreationPayment";
import PlatformFeeBreakdown from "@/components/PlatformFeeBreakdown";
import { usePlatformFees } from "@/hooks/usePlatformFees";
import { readMintSurchargeBps } from "@/lib/platformFeeRead";
import CollectionImageGallery, { type GalleryImage } from "@/components/CollectionImageGallery";
import { useProtocolTransaction } from "@/hooks/useProtocolTransaction";
import { useArtiqAccount } from "@/hooks/useArtiqAccount";
import { useTransactionRecovery } from "@/hooks/useTransactionRecovery";
import { registrationReceipt } from "@/lib/transactionRecovery";
import { arcChain } from "@/lib/arcConfig";
import { NFT_KIND_INFO, type NftAttribute, type NftKind } from "@/lib/nftTypes";
import MintAccessPanel from "@/components/MintAccessPanel";
import CreatorMintControls from "@/components/CreatorMintControls";
import { useImageRetry } from "@/hooks/useImageRetry";
import { useMintAccess } from "@/hooks/useMintAccess";
import { guaranteedUltimateAllocation, onchainMintConfig, tierNumber } from "@/lib/mintAccess";
import { addPlatformFee, collectionAbi, displayUsdc, factoryAbi, protocol, usdcAmount } from "@/lib/protocol";

type Item = { imageCount?: number; collectionImages?: GalleryImage[]; id: string; itemType: string; title: string; description: string | null; imageUrl: string | null; nftKind: NftKind | null; metadataUri: string | null; symbol: string | null; maxSupply: number | null; maxPerWallet: number | null; royaltyBps: number | null; mintPriceUsdc: number | null; mintStartTime: string | null; contractAddress: string | null; deploymentFactory?: string | null; attributes: NftAttribute[] | null; creationMethod: string; creator: { id?: string; username: string | null; walletAddress: string | null } };
const button = "gallery-button inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40";

export default function CollectionDetail({ id }: { id: string }) {
  const tx = useProtocolTransaction(); const account = useArtiqAccount();
  const [quantity, setQuantity] = useState("1");
  const [registering, setRegistering] = useState(false);
  const [savingManagement, setSavingManagement] = useState(false);
  const recovery = useTransactionRecovery(account.authenticated && account.identity && account.walletAddress ? { accountId: account.identity, walletAddress: account.walletAddress, chainId: arcChain.id, itemId: id, operation: "collection-deployment" } : null);
  const managementScope = account.authenticated && account.identity && account.walletAddress ? { accountId: account.identity, walletAddress: account.walletAddress, chainId: arcChain.id, itemId: id } : null;
  const managementRecovery = useTransactionRecovery(managementScope ? { ...managementScope, operation: "collection-management" } : null);
  const allowlistRecovery = useTransactionRecovery(managementScope ? { ...managementScope, operation: "collection-allowlist" } : null);
  useEffect(() => { setRegistering(false); }, [recovery.key]);
  const identity = account.identity || "guest";
  const itemQuery = useQuery({ queryKey: ["item-detail", id, identity], queryFn: async (): Promise<{ item: Item; isOwner: boolean; metadataUrl: string | null }> => { const response = await fetch(`/api/items/${encodeURIComponent(id)}`, { cache: "no-store", headers: account.headers }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "Collection unavailable."); return body; } });
  const item = itemQuery.data?.item;
  const coverImage = useImageRetry(item?.imageUrl);
  const access = useMintAccess(id, !!itemQuery.data?.isOwner);
  const mintPlan = access.data?.plan;
  const registry = item?.deploymentFactory && isAddress(item.deploymentFactory) ? item.deploymentFactory as Address : protocol.factory;
  const contract = item?.contractAddress && isAddress(item.contractAddress) ? item.contractAddress as Address : null;
  const clearRecovery = recovery.clear;
  useEffect(() => { if (contract && itemQuery.data?.isOwner) clearRecovery(); }, [contract, itemQuery.data?.isOwner, clearRecovery]);
  const fees = usePlatformFees(tx.client, contract || protocol.factory);
  const factoryMintSurcharge = useQuery({ queryKey: ["factory-mint-surcharge", protocol.factory], enabled: !contract && !!tx.client && !!protocol.factory && protocol.isTestnet,
    queryFn: () => readMintSurchargeBps(tx.client!, protocol.factory!),
  });
  const factoryManagement = useQuery({ queryKey: ["factory-mint-management", protocol.factory], enabled: !contract && !!tx.client && !!protocol.factory && protocol.isTestnet,
    queryFn: () => tx.client!.readContract({ address: protocol.factory!, abi: factoryAbi, functionName: "supportsMintManagement" }).catch(() => false),
  });
  const creationPayment = useCollectionCreationPayment(id, !!itemQuery.data?.isOwner && !contract, tx.client, tx.isConnected, tx.isWrongNetwork);
  const kind = item?.nftKind || "COLLECTIBLE";
  const chain = useQuery({ queryKey: ["collection-state", contract, tx.address, registry, mintPlan?.root], enabled: !!contract && !!tx.client && !!registry && protocol.isTestnet, refetchInterval: 12_000, queryFn: async () => {
    const client = tx.client!;
    const creator = await client.readContract({ address: registry!, abi: factoryAbi, functionName: "collectionCreator", args: [contract!] });
    if (creator === zeroAddress) throw new Error("This collection was not deployed through the configured Artiq studio factory. In-app minting is unavailable.");
    const [price, start, supply, count, max, minted, owner, proceeds, mintSurcharge, managed] = await Promise.all([
      client.readContract({ address: contract!, abi: collectionAbi, functionName: "mintPrice" }), client.readContract({ address: contract!, abi: collectionAbi, functionName: "mintStartTime" }),
      client.readContract({ address: contract!, abi: collectionAbi, functionName: "maxSupply" }), client.readContract({ address: contract!, abi: collectionAbi, functionName: "totalMinted" }),
      client.readContract({ address: contract!, abi: collectionAbi, functionName: "maxPerWallet" }), tx.address ? client.readContract({ address: contract!, abi: collectionAbi, functionName: "mintedByWallet", args: [tx.address] }) : BigInt(0),
      client.readContract({ address: contract!, abi: collectionAbi, functionName: "owner" }), client.getBalance({ address: contract! }), client.readContract({ address: contract!, abi: collectionAbi, functionName: "supportsMintSurcharge" }).catch(() => false),
      client.readContract({ address: contract!, abi: collectionAbi, functionName: "supportsMintManagement" }).catch(() => false),
    ]);
    const phase = mintPlan ? await client.readContract({ address: contract!, abi: collectionAbi, functionName: "currentMintPhase" }) : 3;
    const phaseCount = mintPlan && tx.address ? await client.readContract({ address: contract!, abi: collectionAbi, functionName: "phaseMinted", args: [phase, tx.address] }) : BigInt(0);
    const phasePrice = mintPlan && phase < 3 ? usdcAmount(phase === 1 ? mintPlan.config.ultimatePrice : mintPlan.config.fcfsPrice, true) : price;
    const phaseLimit = mintPlan ? BigInt(phase === 1 ? mintPlan.config.ultimateLimit : phase === 2 ? mintPlan.config.fcfsLimit : mintPlan.config.publicLimit) : max;
    const mintSurchargeBps = mintSurcharge ? await client.readContract({ address: contract!, abi: collectionAbi, functionName: "mintSurchargeBps" }) : undefined;
    const [closed, reserved, guaranteedMinted] = managed === true ? await Promise.all([
      client.readContract({ address: contract!, abi: collectionAbi, functionName: "mintClosed" }),
      client.readContract({ address: contract!, abi: collectionAbi, functionName: "guaranteedAllocation" }),
      client.readContract({ address: contract!, abi: collectionAbi, functionName: "guaranteedMinted" }),
    ]) : [false, BigInt(0), BigInt(0)];
    const block = await client.getBlock(); return { phase, phaseCount, phasePrice, phaseLimit, price, start, supply, count, max, minted, owner, proceeds, mintSurchargeBps, timestamp: block.timestamp, managed: managed === true, closed, reserved, guaranteedMinted };
  } });
  const authHeaders = account.headers;
  async function recordDeployment(txHash: Hash) {
    const response = await fetch(`/api/items/${encodeURIComponent(id)}/deployment`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders }, body: JSON.stringify({ txHash }), signal: AbortSignal.timeout(30_000) });
    const body = await response.json(); if (!response.ok) throw new Error(body.error || "The deployment confirmed, but it could not be attached. Retry using the transaction link below.");
    if (protocol.factory) recovery.capture(txHash, protocol.factory);
    await itemQuery.refetch();
  }
  async function recoverDeployment(value: string) {
    if (registering || tx.pending) return;
    tx.setError("");
    try {
      if (!/^0x[a-fA-F0-9]{64}$/.test(value)) throw new Error("Enter the complete collection deployment transaction hash.");
      if (!itemQuery.data?.isOwner || !account.walletAddress || !tx.client || !protocol.factory || tx.isWrongNetwork) throw new Error("Sign in with the creator wallet on Arc Testnet to recover this deployment.");
      setRegistering(true);
      const hash = value as Hash;
      if (recovery.record && recovery.record.hash.toLowerCase() !== hash.toLowerCase()) throw new Error("Verify the saved deployment transaction before recovering a different transaction.");
      const target = recovery.record?.hash.toLowerCase() === hash.toLowerCase() ? recovery.record.contractAddress : protocol.factory;
      const receipt = await registrationReceipt(tx.client, hash, account.walletAddress, target);
      if (receipt.status !== "success") { recovery.clear(hash); throw new Error("This deployment transaction reverted. You can deploy the collection again."); }
      await recordDeployment(hash);
    } catch (error) {
      if (recovery.isCurrent()) tx.setError(error instanceof Error ? error.message : "The transaction could not be verified. Keep its hash and try recovery again; do not deploy again.");
    }
    finally { if (recovery.isCurrent()) setRegistering(false); }
  }
  function deploy() {
    if (!account.authenticated) { account.login(); return; }
    if (!tx.isConnected || !account.walletAddress) { account.connectWallet(); return; }
    if (!item) return;
    try { recovery.assertCanStart(); } catch (error) { tx.setError((error as Error).message); return; }
    void tx.run(async (write) => {
      recovery.assertCanStart();
      if (!protocol.factory) throw new Error("Collection deployment is temporarily unavailable. Please try again later.");
      if (!fees.data || fees.isError) throw new Error("Wait for the platform fee check before deploying.");
      if (factoryMintSurcharge.isError || typeof factoryMintSurcharge.data !== "bigint") throw new Error("Wait for the mint payment check before deploying.");
      if (!creationPayment.paid || creationPayment.isError) throw new Error("Pay and verify the 5 test USDC creation fee before creating your collection.");
      if ((item.imageCount ?? 1) > 1) {
        const supported = await tx.client?.readContract({ address: protocol.factory, abi: factoryAbi, functionName: "supportsImageSeries" }).catch(() => false);
        if (!supported) throw new Error("Image-series deployment is temporarily unavailable. Please contact the Artiq team for help with your collection.");
      }
      if (!access.data || access.isError || access.isFetching) throw new Error("Wait for mint access settings to finish loading.");
      if (mintPlan && (!mintPlan.root || !mintPlan.frozenAt)) throw new Error("Lock the allowlist before deploying this collection.");
      if (mintPlan && !await tx.client?.readContract({ address: protocol.factory, abi: factoryAbi, functionName: "supportsMintPhases" }).catch(() => false)) throw new Error("Allowlist deployment is temporarily unavailable. Please contact the Artiq team for help with your collection.");
      if (mintPlan && factoryManagement.data !== true) throw new Error("These whitelist phases need the updated mint controls. Please contact the Artiq team before creating this collection.");
      const uri = itemQuery.data?.metadataUrl;
      if (!uri) throw new Error("Collection metadata is temporarily unavailable. Please try again later.");
      const args = [item.title, item.symbol || "ARTIQ", uri, usdcAmount(String(item.mintPriceUsdc ?? 0), true), BigInt(mintPlan ? Math.floor(Date.parse(mintPlan.config.ultimateStart) / 1000) : item.mintStartTime ? Math.floor(new Date(item.mintStartTime).getTime() / 1000) : 0), BigInt(item.maxSupply || 1), BigInt(item.maxPerWallet || item.maxSupply || 1), BigInt(item.royaltyBps || 0)] as const;
      let hash: Hash;
      if (mintPlan?.root) {
        const config = onchainMintConfig(id, mintPlan.root, mintPlan.config);
        const allocation = BigInt(mintPlan.guaranteedAllocation ?? guaranteedUltimateAllocation(access.data.entries ?? [], mintPlan.config, item.maxSupply || 1));
        hash = kind === "EDITION" ? await write({ address: protocol.factory, abi: factoryAbi, functionName: "createEditionWithManagedPhases", args: [...args, config, allocation], chainId: arcChain.id }) : await write({ address: protocol.factory, abi: factoryAbi, functionName: "create721WithManagedPhases", args: [...args, kind === "SOULBOUND", config, allocation], chainId: arcChain.id });
      } else {
        hash = kind === "EDITION" ? await write({ address: protocol.factory, abi: factoryAbi, functionName: "createEdition", args, chainId: arcChain.id }) : await write({ address: protocol.factory, abi: factoryAbi, functionName: "create721", args: [...args, kind === "SOULBOUND"], chainId: arcChain.id });
      }
      recovery.capture(hash, protocol.factory);
      return hash;
    }, recordDeployment);
  }
  function mint(event: FormEvent) {
    event.preventDefault();
    if (!account.authenticated) { account.login(); return; }
    if (!tx.isConnected || !account.walletAddress) { account.connectWallet(); return; }
    void tx.run((write) => {
      if (!chain.data || !contract) throw new Error("Wait for the collection’s on-chain state to load.");
      if (chain.data.closed) throw new Error("The creator has permanently closed minting for this collection.");
      if (!fees.data || fees.isError) throw new Error("Wait for the platform fee check before minting.");
      if (!/^\d+$/.test(quantity) || Number(quantity) < 1 || Number(quantity) > 100) throw new Error("Mint between 1 and 100 tokens per transaction.");
      const amount = BigInt(quantity);
      if (chain.data.timestamp < chain.data.start) throw new Error("This mint has not opened yet.");
      if (chain.data.count + amount > chain.data.supply) throw new Error("There are not enough tokens left in this collection.");
      if (chain.data.minted + amount > chain.data.max) throw new Error("This mint would exceed your wallet’s allocation.");
      if (!access.data || access.isError) throw new Error("Wait for your mint access to load.");
      if (chain.data.phaseCount + amount > chain.data.phaseLimit) throw new Error("This quantity exceeds your remaining allocation for the current phase.");
      if (mintPlan && chain.data.phase < 3) {
        const tier = tierNumber(access.data.entry?.tier || "");
        if (!tier || !access.data.proof || (chain.data.phase === 1 && tier !== 1) || (chain.data.managed && chain.data.phase === 2 && tier !== 2)) throw new Error("Your wallet does not have access to this mint phase. Wait for your eligible phase or public minting.");
        const base = chain.data.phasePrice * amount;
        const value = chain.data.mintSurchargeBps !== undefined ? addPlatformFee(base, chain.data.mintSurchargeBps).total : base;
        return write({ address: contract, abi: collectionAbi, functionName: "mintAllowlisted", args: [amount, tier, access.data.proof], value, chainId: arcChain.id });
      }
      const base = chain.data.price * amount;
      const value = chain.data.mintSurchargeBps !== undefined ? addPlatformFee(base, chain.data.mintSurchargeBps).total : base;
      return write({ address: contract, abi: collectionAbi, functionName: "mint", args: [amount], value, chainId: arcChain.id });
    }, async (hash) => {
      await chain.refetch(); await tx.refetchBalance();
      try {
        const response = await fetch(`/api/items/${encodeURIComponent(id)}/sync`, { method: "POST", headers: { "Content-Type": "application/json", ...account.headers }, body: JSON.stringify({ txHash: hash }), signal: AbortSignal.timeout(20_000) });
        if (response.ok) await itemQuery.refetch();
        else tx.setError("Your mint is confirmed. The catalog update is delayed; do not mint again to retry this update.");
      } catch { tx.setError("Your mint is confirmed. The catalog update is delayed; do not mint again to retry this update."); }
    });
  }
  async function saveMintUpdate(hash: Hash, allowlist = false) {
    await access.saveAsync({ action: allowlist ? "activate-allowlist" : "sync-management", txHash: hash });
    (allowlist ? allowlistRecovery : managementRecovery).clear(hash);
    await Promise.all([itemQuery.refetch(), chain.refetch(), access.refetch()]);
  }
  async function recoverMintUpdate(value: string, allowlist = false) {
    if (tx.pending || savingManagement) return;
    const saved = allowlist ? allowlistRecovery : managementRecovery;
    tx.setError(""); setSavingManagement(true);
    try {
      if (!/^0x[a-fA-F0-9]{64}$/.test(value)) throw new Error("Enter the complete mint update transaction hash.");
      if (!contract || !tx.client || !account.walletAddress || !itemQuery.data?.isOwner || tx.isWrongNetwork) throw new Error("Select the creator wallet on Arc Testnet to verify this update.");
      const hash = value as Hash;
      if (saved.record && saved.record.hash.toLowerCase() !== hash.toLowerCase()) throw new Error("Verify the saved transaction before recovering a different update.");
      const receipt = await registrationReceipt(tx.client, hash, account.walletAddress, contract);
      if (receipt.status !== "success") { saved.clear(hash); throw new Error("This update reverted. You can submit it again."); }
      await saveMintUpdate(hash, allowlist);
    } catch (cause) { if (saved.isCurrent()) tx.setError(cause instanceof Error ? cause.message : "The confirmed update could not be saved. Keep its hash and retry verification."); }
    finally { setSavingManagement(false); }
  }
  async function publishAllowlist(pending: { root: `0x${string}`; guaranteedAllocation: number }) {
    if (!contract || !chain.data?.managed || !itemQuery.data?.isOwner) throw new Error("This collection does not support creator whitelist updates.");
    allowlistRecovery.assertCanStart();
    await tx.run(async (write) => {
      allowlistRecovery.assertCanStart();
      if (chain.data!.owner.toLowerCase() !== account.walletAddress?.toLowerCase()) throw new Error("Select the wallet that owns this collection.");
      const hash = await write({ address: contract, abi: collectionAbi, functionName: "updateAllowlistRoot", args: [pending.root, BigInt(pending.guaranteedAllocation)], chainId: arcChain.id });
      allowlistRecovery.capture(hash, contract); return hash;
    }, (hash) => saveMintUpdate(hash, true));
  }
  async function reduceSupply(next: number) {
    if (!contract) {
      await access.saveAsync({ action: "reduce-supply", maxSupply: next });
      await itemQuery.refetch(); return;
    }
    managementRecovery.assertCanStart();
    await tx.run(async (write) => {
      managementRecovery.assertCanStart();
      if (!chain.data?.managed || chain.data.owner.toLowerCase() !== account.walletAddress?.toLowerCase()) throw new Error("Select the wallet that owns this collection.");
      const hash = await write({ address: contract, abi: collectionAbi, functionName: "reduceMaxSupply", args: [BigInt(next)], chainId: arcChain.id });
      managementRecovery.capture(hash, contract); return hash;
    }, (hash) => saveMintUpdate(hash));
  }
  async function closeMinting() {
    if (!contract || !chain.data?.managed) return;
    managementRecovery.assertCanStart();
    await tx.run(async (write) => {
      managementRecovery.assertCanStart();
      if (chain.data!.owner.toLowerCase() !== account.walletAddress?.toLowerCase()) throw new Error("Select the wallet that owns this collection.");
      const hash = await write({ address: contract, abi: collectionAbi, functionName: "closeMinting", chainId: arcChain.id });
      managementRecovery.capture(hash, contract); return hash;
    }, (hash) => saveMintUpdate(hash));
  }
  const state = chain.data;
  const minimumSupply = state ? Number(state.count + (mintPlan && state.phase < 2 && state.reserved > state.guaranteedMinted ? state.reserved - state.guaranteedMinted : BigInt(0))) : mintPlan ? mintPlan.guaranteedAllocation ?? 1 : 1;
  const validQuantity = /^\d+$/.test(quantity) && BigInt(quantity) >= BigInt(1) && BigInt(quantity) <= BigInt(100);
  const mintTotal = state && validQuantity ? state.phasePrice * BigInt(quantity) : undefined;
  return <main className="gallery-page min-h-screen"><Atmosphere /><MarketNav /><div className="relative mx-auto max-w-6xl px-4 py-10 sm:px-8"><Link href="/nfts" className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--muted-text)]"><ArrowLeft size={14} />All NFT collections</Link>{itemQuery.isLoading ? <p className="mt-10" role="status">Loading collection…</p> : itemQuery.isError || item?.itemType !== "NFT" ? <div className="gallery-card mt-8 p-8"><h1 className="text-2xl">Collection unavailable</h1><p className="mt-3 text-sm text-[var(--muted-text)]">Only published NFT collections appear here.</p></div> : <><div className="mt-7 grid gap-8 lg:grid-cols-2"><div className="gallery-card relative aspect-square overflow-hidden">{item.imageUrl && !coverImage.failed ? <Image key={coverImage.imageKey} src={coverImage.src} alt={item.title} fill unoptimized sizes="(min-width:1024px) 50vw,100vw" className="object-cover" onError={coverImage.onError} onLoad={coverImage.onLoad} /> : <div className="flex h-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-[#b55fbe]/10 to-[#EF476F]/10 p-6 text-center text-[#b55fbe]"><p className="text-sm">{item.imageUrl ? coverImage.retrying ? "Loading artwork…" : "This image could not be loaded." : "Artwork coming soon"}</p>{item.imageUrl && !coverImage.retrying && <button type="button" className="rounded-full border border-current px-4 py-2 text-xs font-semibold" onClick={coverImage.retry}>Retry image</button>}</div>}</div><div><span className="inline-flex items-center gap-2 rounded-full border border-[#b55fbe]/20 bg-[#b55fbe]/5 px-3 py-2 text-[10px] font-semibold text-[#b55fbe]">{kind === "SOULBOUND" && <LockKeyhole size={13} />}{NFT_KIND_INFO[kind].label} · {NFT_KIND_INFO[kind].standard}</span><h1 className="mt-5 break-words text-4xl sm:text-5xl">{item.title}</h1><p className="mt-3 text-xs text-[var(--muted-text)]">By <CreatorLink creator={item.creator} /></p><div className="mt-4 flex flex-wrap gap-3"><WatchlistButton itemId={id} /><ShareItemButton title={item.title} /></div><p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-[var(--muted-text)]">{item.description}</p>{item.creationMethod.startsWith("AI_") && <p className="mt-4 text-xs font-semibold text-[#b55fbe]">{item.creationMethod === "AI_GENERATED" ? "AI-generated NFT" : "AI-assisted NFT"}</p>}<div className="my-6 grid grid-cols-3 gap-3 rounded-2xl border border-[var(--border-soft)] bg-[var(--glass-bg)] p-4">{[["Mint price", `${state ? displayUsdc(state.phasePrice) : item.mintPriceUsdc ?? 0} USDC`], ["Supply", state ? `${state.count} / ${state.supply}` : String(item.maxSupply || 1)], ["Royalty signal", `${(item.royaltyBps || 0) / 100}%`]].map(([label, value]) => <div key={label}><p className="text-[10px] text-[var(--muted-text)]">{label}</p><p className="mt-2 text-sm font-semibold">{value}</p></div>)}</div><p className="text-[11px] leading-6 text-[var(--muted-text)]">{NFT_KIND_INFO[kind].description} {kind === "SOULBOUND" ? "This token cannot be transferred or resold." : "Royalties are advertised through ERC-2981; marketplaces decide whether to honor them."}</p>
      <MintAccessPanel access={access} isOwner={!!itemQuery.data?.isOwner} deployed={!!contract} walletCap={item.maxPerWallet || item.maxSupply || 1} publicPrice={item.mintPriceUsdc ?? 0} onChange={() => void itemQuery.refetch()} supportsManagement={state?.managed} managementBusy={tx.pending || savingManagement || !!allowlistRecovery.record} deploymentPending={!recovery.ready || registering || tx.pending || !!recovery.record} onPublishAllowlist={publishAllowlist} />
      {itemQuery.data?.isOwner && (!contract || state) && <CreatorMintControls deployed={!!contract} supported={!contract || !!state?.managed} supply={Number(state?.supply ?? item.maxSupply ?? 1)} minted={Number(state?.count ?? 0)} minimumSupply={Math.max(1, minimumSupply)} closed={!!state?.closed} canClose={!!state && state.timestamp >= state.start && (!mintPlan || state.phase === 3)} busy={tx.pending || access.saving || savingManagement || (!!contract && (!managementRecovery.ready || !!managementRecovery.record))} onReduce={reduceSupply} onClose={closeMinting} />}
      {itemQuery.data?.isOwner && contract && <><RegistrationRecovery operation="mint update" hash={managementRecovery.record?.hash || null} busy={savingManagement || tx.pending} disabled={!account.authenticated || !account.walletAddress || tx.isWrongNetwork} storageUnavailable={managementRecovery.storageUnavailable} onRecover={(hash) => recoverMintUpdate(hash)} />{(mintPlan || allowlistRecovery.record) && <RegistrationRecovery operation="whitelist update" hash={allowlistRecovery.record?.hash || null} busy={savingManagement || tx.pending} disabled={!account.authenticated || !account.walletAddress || tx.isWrongNetwork} storageUnavailable={allowlistRecovery.storageUnavailable} onRecover={(hash) => recoverMintUpdate(hash, true)} />}</>}
      {!contract ? <div className="mt-6 rounded-2xl border border-[#b55fbe]/25 bg-[#b55fbe]/5 p-5"><p className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={17} />Ready to create · no approval required</p><p className="mt-3 text-xs leading-6 text-[var(--muted-text)]">{itemQuery.data?.isOwner ? "Set up any whitelist phases above, then create your collection from your connected wallet. Pay the one-time 5 test USDC creation fee directly to the platform wallet, then create your collection. Network gas is separate." : "The creator has not created this collection on-chain yet. Minting will open here after creation."}</p>{itemQuery.data?.isOwner && mintPlan && factoryManagement.data === false && <p role="alert" className="mt-4 text-xs leading-6 text-[var(--muted-text)]">These whitelist phases need the updated mint controls. Creation is paused until the platform enables them.</p>}{itemQuery.data?.isOwner && <CollectionCreationPayment key={creationPayment.recovery.key || "guest"} payment={creationPayment} disabled={tx.pending || registering || !protocol.factory || !protocol.isTestnet || !fees.data || fees.isError || factoryMintSurcharge.isError || typeof factoryMintSurcharge.data !== "bigint" || !access.data || (!!mintPlan && (!mintPlan.frozenAt || factoryManagement.data !== true))} />}{itemQuery.data?.isOwner && (factoryMintSurcharge.isError ? <p role="alert" className="mt-4 text-xs text-rose-500">Mint payment terms could not be verified. <button type="button" className="font-semibold underline" onClick={() => void factoryMintSurcharge.refetch()}>Retry payment check</button></p> : factoryMintSurcharge.data === undefined ? <p role="status" className="mt-4 text-xs text-[var(--muted-text)]">Checking mint payment terms…</p> : <PlatformFeeBreakdown terms={fees.data} gross={usdcAmount(String(item.mintPriceUsdc ?? 0), true)} baseLabel="Public mint price per token" proceedsLabel="Creator receives per token" totalLabel="Collector pays per token" mintSurchargeBps={factoryMintSurcharge.data} isError={fees.isError} onRetry={() => void fees.refetch()} />)}{itemQuery.data?.isOwner && <button className={`${button} mt-4`} disabled={tx.pending || registering || !recovery.ready || !!recovery.record || !protocol.factory || !protocol.isTestnet || !fees.data || fees.isError || factoryMintSurcharge.isError || typeof factoryMintSurcharge.data !== "bigint" || creationPayment.busy || creationPayment.isError || !creationPayment.paid || !access.data || (!!mintPlan && (!mintPlan.frozenAt || factoryManagement.data !== true))} onClick={deploy}>Create collection</button>}{!protocol.factory && <><p className="mt-4 text-xs leading-6 text-[var(--muted-text)]">Collection deployment is temporarily unavailable. Please check back later.</p><ReviewerOnly><Link href="/settings/protocol" className="mt-4 block text-xs font-semibold text-[#b55fbe]">View testnet setup →</Link></ReviewerOnly></>}{itemQuery.data?.isOwner && <RegistrationRecovery key={recovery.key || "guest"} operation="deployment" hash={recovery.record?.hash || null} busy={registering || tx.pending} disabled={!account.authenticated || !account.walletAddress || !tx.isConnected || tx.isWrongNetwork || !recovery.ready} storageUnavailable={recovery.storageUnavailable} onRecover={recoverDeployment} />}</div> : <div className="mt-6 rounded-2xl border border-[var(--border-soft)] p-5"><a className="flex items-center gap-2 break-all text-xs font-semibold text-[#b55fbe]" href={`${arcChain.blockExplorers?.default.url}/address/${contract}`} target="_blank" rel="noreferrer">{contract}<ExternalLink size={13} className="shrink-0" /></a>{!protocol.factory && <><p className="mt-4 text-xs leading-6 text-[var(--muted-text)]">Minting is temporarily unavailable. Please check back later.</p><ReviewerOnly><Link href="/settings/protocol" className="mt-4 block text-xs font-semibold text-[#b55fbe]">View testnet setup →</Link></ReviewerOnly></>}{chain.isError ? <p role="alert" className="mt-3 text-xs leading-6 text-rose-500">{chain.error.message}</p> : <form onSubmit={mint} className="mt-4 space-y-3"><p className="text-xs text-[var(--muted-text)]">{state ? state.closed ? "Minting closed by the creator" : state.timestamp < state.start ? `Mint opens ${new Date(Number(state.start) * 1000).toLocaleString()}` : state.count >= state.supply ? "Minted out" : ` ${mintPlan ? ["Not open", "Guaranteed", "FCFS", "Public"][state.phase] : "Public"} mint · ${state.max - state.minted < state.phaseLimit - state.phaseCount ? state.max - state.minted : state.phaseLimit - state.phaseCount} remaining for your wallet` : "Checking mint availability…"}</p><label className="block text-xs font-semibold" htmlFor="mint-quantity">Quantity</label><input id="mint-quantity" type="number" min="1" max="100" step="1" required value={quantity} onChange={(e) => setQuantity(e.target.value)} className="w-full rounded-xl border border-[var(--border-soft)] bg-[var(--chip-bg)] px-4 py-3 text-sm" />{state ? <PlatformFeeBreakdown terms={fees.data} gross={mintTotal} mintSurchargeBps={state.mintSurchargeBps} isError={fees.isError} onRetry={() => void fees.refetch()} /> : <p role="status" className="text-xs text-[var(--muted-text)]">Checking mint payment terms…</p>}<button className={`${button} w-full`} disabled={tx.pending || (!!account.walletAddress && (!state || !fees.data || fees.isError || !validQuantity || state.closed || state.count >= state.supply || state.timestamp < state.start))}>{!account.authenticated ? "Sign in to mint" : !account.walletAddress || !tx.isConnected ? "Connect wallet to mint" : "Mint with test USDC"}</button></form>}</div>}{state && state.owner.toLowerCase() === tx.address?.toLowerCase() && state.proceeds > BigInt(0) && <button className={`${button} mt-4`} disabled={tx.pending} onClick={() => void tx.run((write) => write({ address: contract!, abi: collectionAbi, functionName: "withdraw", args: [tx.address!], chainId: arcChain.id }), async () => { await chain.refetch(); await tx.refetchBalance(); })}>Withdraw {displayUsdc(state.proceeds)} USDC mint proceeds</button>}{tx.isWrongNetwork && <button className={`${button} mt-4`} onClick={() => void tx.switchToArc()}>Switch to Arc Testnet</button>}<div className="mt-5"><TransactionStatus pending={tx.pending} error={tx.error} hash={tx.hash} /></div><p className="mt-4 text-[11px] text-[var(--muted-text)]">Arc Testnet only. Test USDC has no monetary value.</p></div></div><CollectionImageGallery images={item.collectionImages} />{!!item.attributes?.length && <section className="mt-10"><h2 className="text-xl">Collection traits</h2><div className="mt-4 grid gap-3 sm:grid-cols-3">{item.attributes.map((a, index) => <div key={index} className="gallery-card p-4"><p className="text-[10px] uppercase tracking-wider text-[#b55fbe]">{a.trait_type}</p><p className="mt-2 break-words text-sm font-semibold">{a.value}</p></div>)}</div></section>}</>}</div></main>;
}
