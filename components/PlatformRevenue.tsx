"use client";

import { useQuery } from "@tanstack/react-query";
import { formatUnits, type Address } from "viem";
import TransactionStatus from "@/components/TransactionStatus";
import { useProtocolTransaction } from "@/hooks/useProtocolTransaction";
import { arcChain } from "@/lib/arcConfig";
import { factoryAbi, platformFeeAbi, protocol } from "@/lib/protocol";
import { readPlatformFeeTerms } from "@/lib/platformFeeRead";

type Transaction = ReturnType<typeof useProtocolTransaction>;
type Revenue = { legacy: true } | { legacy: false; recipient: Address; bps: bigint; mintSurchargeBps?: bigint; pending: bigint; total: bigint };
const sources = [
  { key: "factory", label: "NFT mint fees", mintFees: true },
  { key: "artMarket", label: "Art sale fees" },
  { key: "auctions", label: "Auction sale fees" },
] as const;
const button = "gallery-button px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40";

function RevenueSource({ label, address, tx, mintFees = false }: { label: string; address: Address | null; tx: Transaction; mintFees?: boolean }) {
  const query = useQuery({
    queryKey: ["platform-revenue", arcChain.id, address],
    enabled: !!address && !!tx.client && protocol.isTestnet,
    retry: false,
    refetchInterval: 15_000,
    queryFn: async (): Promise<Revenue> => {
      const client = tx.client!;
      const terms = await readPlatformFeeTerms(client, address!);
      if (terms.legacy) return { legacy: true };
      if (!terms.recipient) throw new Error("The contract did not return a fee recipient.");
      const blockNumber = await client.getBlockNumber();
      let mintSurchargeBps: bigint | undefined;
      if (mintFees) {
        const supported = await client.readContract({ address: address!, abi: factoryAbi, functionName: "supportsMintSurcharge", blockNumber }).catch(() => false);
        if (supported) mintSurchargeBps = await client.readContract({ address: address!, abi: factoryAbi, functionName: "mintSurchargeBps", blockNumber });
      }
      const [pending, total] = await Promise.all([
        client.readContract({ address: address!, abi: platformFeeAbi, functionName: "pendingPlatformFees", blockNumber }),
        client.readContract({ address: address!, abi: platformFeeAbi, functionName: "totalPlatformFees", blockNumber }),
      ]);
      return { legacy: false, recipient: terms.recipient, bps: terms.bps, mintSurchargeBps, pending, total };
    },
  });
  const revenue = query.data && !query.data.legacy ? query.data : null;
  const recipientConnected = !!revenue && !!tx.address && tx.address.toLowerCase() === revenue.recipient.toLowerCase();
  const canWithdraw = protocol.isTestnet && tx.isConnected && tx.chainId === arcChain.id && !tx.isWrongNetwork && !tx.pending && !query.isError && recipientConnected && !!revenue && revenue.pending > BigInt(0);

  async function withdraw() {
    if (!canWithdraw || !address || !tx.address || !tx.client) return;
    const receiver = tx.address;
    const client = tx.client;
    await tx.run(async (write) => {
      const terms = await readPlatformFeeTerms(client, address);
      if (terms.legacy || !terms.recipient || terms.recipient.toLowerCase() !== receiver.toLowerCase()) {
        throw new Error("Connect the contract's current fee recipient wallet to withdraw.");
      }
      const pending = await client.readContract({ address, abi: platformFeeAbi, functionName: "pendingPlatformFees" });
      if (pending <= BigInt(0)) throw new Error("There are no platform fees available to withdraw.");
      return write({ address, abi: platformFeeAbi, functionName: "withdrawPlatformFees", args: [receiver], account: receiver, chainId: arcChain.id });
    }, async () => { await Promise.all([query.refetch(), tx.refetchBalance()]); });
  }

  return <article className="rounded-2xl border border-[var(--border-soft)] p-5">
    <h3 className="text-sm font-semibold">{label}</h3>
    {address && <a href={`${arcChain.blockExplorers?.default.url}/address/${address}`} target="_blank" rel="noreferrer" className="mt-2 block break-all font-mono text-[10px] text-[#b55fbe] underline">{address} ↗</a>}
    {!address ? <p className="mt-3 text-xs leading-6 text-[var(--muted-text)]">Contract not configured. Deploy and configure a fee-enabled contract to begin collecting fees.</p>
      : !protocol.isTestnet ? <p className="mt-3 text-xs text-[var(--muted-text)]">Fee reporting is available on Arc Testnet.</p>
      : !tx.client ? <p role="status" className="mt-3 text-xs text-[var(--muted-text)]">Connecting to Arc to read fee accounting…</p>
      : query.isError ? <div className="mt-3 space-y-2"><p role="alert" className="text-xs leading-6 text-rose-600 dark:text-rose-300">Fee accounting could not be read from Arc. Retry to check this contract.</p><button type="button" className="text-xs font-semibold text-[#b55fbe] underline" disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? "Retrying…" : "Retry fee accounting"}</button></div>
      : query.isPending ? <p role="status" className="mt-3 text-xs text-[var(--muted-text)]">Loading on-chain fee accounting…</p>
      : query.data?.legacy ? <p className="mt-3 text-xs leading-6 text-[var(--muted-text)]">This legacy deployment has no on-chain commission ledger. Collection creation fees are separate and are paid directly to the platform wallet.</p>
      : revenue && <>
        {mintFees ? <div className="mt-4 space-y-1 text-xs text-[var(--muted-text)]">
          <p>Creator mint fee <strong className="text-[var(--text)]">{formatUnits(revenue.bps, 2)}%</strong></p>
          {revenue.mintSurchargeBps !== undefined ? <><p>Collector mint surcharge <strong className="text-[var(--text)]">{formatUnits(revenue.mintSurchargeBps, 2)}%</strong></p><p>Combined mint platform rate <strong className="text-[var(--text)]">{formatUnits(revenue.bps + revenue.mintSurchargeBps, 2)}%</strong></p></> : <p>This deployment does not add a collector mint surcharge.</p>}
        </div> : <p className="mt-4 text-xs text-[var(--muted-text)]">Platform rate <strong className="text-[var(--text)]">{formatUnits(revenue.bps, 2)}%</strong></p>}
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div><dt className="text-[11px] text-[var(--muted-text)]">Total fees accrued</dt><dd className="mt-1 break-words text-lg font-semibold">{formatUnits(revenue.total, 18)} <span className="text-xs">test USDC</span></dd></div>
          <div><dt className="text-[11px] text-[var(--muted-text)]">Available to withdraw</dt><dd className="mt-1 break-words text-lg font-semibold">{formatUnits(revenue.pending, 18)} <span className="text-xs">test USDC</span></dd></div>
        </dl>
        <p className="mt-4 text-[11px] text-[var(--muted-text)]">On-chain fee recipient</p>
        <a href={`${arcChain.blockExplorers?.default.url}/address/${revenue.recipient}`} target="_blank" rel="noreferrer" className="mt-1 block break-all font-mono text-[10px] text-[#b55fbe] underline">{revenue.recipient} ↗</a>
        {recipientConnected && tx.isConnected ? <button type="button" className={`${button} mt-4`} disabled={!canWithdraw} onClick={() => void withdraw()}>Withdraw platform fees</button> : <p className="mt-4 text-xs leading-6 text-[var(--muted-text)]">Connect this fee recipient wallet to withdraw its fees.</p>}
      </>}
  </article>;
}

export default function PlatformRevenue() {
  const tx = useProtocolTransaction();
  const previousHouses = (protocol.legacyAuctions || []).filter((address, index, addresses) => address.toLowerCase() !== protocol.auctions?.toLowerCase() && addresses.findIndex((entry) => entry.toLowerCase() === address.toLowerCase()) === index);
  return <section className="gallery-card mt-8 p-6 sm:p-8" aria-labelledby="platform-revenue-title">
    <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-[#b55fbe]">Arc Testnet</p>
    <h2 id="platform-revenue-title" className="mt-2 text-xl">Platform revenue</h2>
    <p className="mt-3 text-xs leading-6 text-[var(--muted-text)]">Fees recorded by the configured contracts appear below. Test USDC has no monetary value. Withdrawals go to the connected fee recipient wallet.</p>
    <p className="mt-3 text-xs leading-6 text-[var(--muted-text)]">Each creator pays the 5 test USDC collection creation fee directly to the platform wallet. These payments are already in that wallet and are separate from the contract balances below.</p>
    <div className="mt-5 space-y-4">{sources.map((source) => <RevenueSource key={source.key} label={source.label} address={protocol[source.key]} tx={tx} mintFees={"mintFees" in source && source.mintFees} />)}</div>
    {previousHouses.length > 0 && <div className="mt-5 space-y-4">{previousHouses.map((address) => <RevenueSource key={address} label="Previous auction house fees" address={address} tx={tx} />)}</div>}
    {tx.isWrongNetwork && <button type="button" className={`${button} mt-5`} disabled={tx.pending} onClick={() => void tx.switchToArc()}>Switch to Arc Testnet</button>}
    <div className="mt-4"><TransactionStatus pending={tx.pending} error={tx.error} hash={tx.hash} /></div>
  </section>;
}
