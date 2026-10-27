"use client";

import Link from "next/link";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import type { Address } from "viem";
import MarketNav from "@/components/MarketNav";
import Atmosphere from "@/components/Atmosphere";
import ConnectWalletButton from "@/components/ConnectWalletButton";
import { useWallet } from "@/hooks/useWallet";
import { arcChain } from "@/lib/arcConfig";
import { loadMyNfts, mintedNftAbi } from "@/lib/myNfts";

export default function MyNftsPage() {
  const wallet = useWallet();
  const client = usePublicClient({ chainId: arcChain.id });
  const query = useQuery({
    queryKey: ["my-nfts", arcChain.id, wallet.address],
    enabled: !!wallet.address && !!client && wallet.isConnected,
    staleTime: 15_000,
    retry: 1,
    queryFn: async ({ signal }) => {
      const blockNumber = await client!.getBlockNumber();
      return loadMyNfts(wallet.address!, async (cursor) => {
        const params = new URLSearchParams({ itemType: "NFT", limit: "100" });
        if (cursor) params.set("cursor", cursor);
        const response = await fetch(`/api/items?${params}`, { signal });
        if (!response.ok) throw new Error("Your NFT collections could not be loaded. Please try again.");
        return response.json();
      }, async (item, address) => {
        signal.throwIfAborted();
        const contract = item.contractAddress as Address;
        const [minted, balance] = await Promise.all([
          client!.readContract({ address: contract, abi: mintedNftAbi, functionName: "mintedByWallet", args: [address], blockNumber }),
          item.nftKind === "EDITION"
            ? client!.readContract({ address: contract, abi: mintedNftAbi, functionName: "balanceOf", args: [address, BigInt(1)], blockNumber })
            : client!.readContract({ address: contract, abi: mintedNftAbi, functionName: "balanceOf", args: [address], blockNumber }),
        ]);
        return { minted, balance };
      });
    },
  });
  const items = query.data?.items || [];
  return <main className="gallery-page min-h-screen"><Atmosphere /><MarketNav /><div className="mx-auto max-w-7xl px-5 py-12 sm:px-10">
    <p className="text-xs uppercase tracking-widest text-[#b55fbe]">Your collection</p><h1 className="mt-3 text-4xl">My NFTs</h1>
    <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--muted-text)]">All NFTs you minted on Artiq, grouped by collection. Mint history stays here after a transfer; the wallet balance shows how many you hold now. Arc Testnet only.</p>
    {!wallet.isConnected || !wallet.address ? <section className="gallery-card mt-8 space-y-4 p-8"><h2 className="text-xl">Connect the wallet you used to mint</h2><p className="text-sm text-[var(--muted-text)]">Your NFTs will appear after you select your wallet.</p><ConnectWalletButton /></section> : <>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-4"><p className="break-all font-mono text-xs text-[var(--muted-text)]">{wallet.address}</p><button type="button" disabled={query.isFetching} onClick={() => void query.refetch()} className="gallery-button px-5 py-3 text-xs text-white disabled:opacity-50">{query.isFetching ? "Checking your NFTs…" : "Refresh NFTs"}</button></div>
      {query.isPending ? <p role="status" className="mt-8">Checking your on-chain mint history…</p> : query.isError ? <p role="alert" className="mt-8 text-sm text-rose-500">Your NFTs could not be loaded. Use Refresh NFTs to try again.</p> : <>
        {!!query.data?.failed.length && <p role="alert" className="mt-6 text-sm text-rose-500">{query.data.failed.length} collections could not be checked. Your list may be incomplete. Refresh to retry.</p>}
        {items.length ? <><p role="status" className="mt-6 text-sm text-[var(--muted-text)]">{items.reduce((total, item) => total + item.minted, BigInt(0)).toString()} minted across {items.length} {items.length === 1 ? "collection" : "collections"}</p><div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{items.map((item) => <article key={item.id} className="gallery-card overflow-hidden"><Link href={`/nfts/${item.id}`}><div className="relative aspect-square bg-[var(--chip-bg)]">{item.imageUrl && <Image src={item.imageUrl} alt={item.title} fill unoptimized sizes="320px" className="object-cover" />}</div><div className="p-5"><h2 className="font-semibold">{item.title}</h2><dl className="mt-4 flex justify-between gap-4 text-sm"><div><dt className="text-xs text-[var(--muted-text)]">You minted</dt><dd className="mt-1 font-semibold">{item.minted.toString()}</dd></div><div><dt className="text-xs text-[var(--muted-text)]">In your wallet</dt><dd className="mt-1 font-semibold">{item.balance.toString()}</dd></div></dl><p className="mt-5 text-xs font-semibold text-[#b55fbe]">View collection →</p></div></Link><a className="mx-5 mb-5 block text-xs text-[var(--muted-text)] underline" href={`${arcChain.blockExplorers?.default.url}/address/${item.contractAddress}`} target="_blank" rel="noreferrer">View contract on explorer ↗</a></article>)}</div></> : <section className="gallery-card mt-8 p-8"><h2 className="text-xl">{query.data?.failed.length ? "No mints found in the collections checked" : "You haven’t minted an Artiq NFT with this wallet yet"}</h2><p className="mt-3 text-sm text-[var(--muted-text)]">If you minted with another wallet, select it using the wallet menu.</p><Link href="/nfts" className="mt-5 inline-block text-sm font-semibold text-[#b55fbe]">Explore NFTs →</Link></section>}
      </>}
    </>}
  </div></main>;
}
