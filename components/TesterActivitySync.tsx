"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Hash } from "viem";
import { RefreshCw } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { useArtiqAccount } from "@/hooks/useArtiqAccount";
import { queueTesterActivity, readPendingTesterActivities, removePendingTesterActivity, syncTesterActivity, TESTER_ACTIVITY_EVENT, type PendingTesterActivity } from "@/lib/testerActivityQueue";
import { transactionError } from "@/lib/protocol";

export default function TesterActivitySync({ className = "" }: { className?: string }) {
  const wallet = useWallet(); const account = useArtiqAccount();
  const queryClient = useQueryClient();
  const [items, setItems] = useState<PendingTesterActivity[]>([]);
  const [pending, setPending] = useState(false); const [notice, setNotice] = useState(""); const [error, setError] = useState("");
  const [previousHash, setPreviousHash] = useState("");
  const guard = useRef(false);
  const currentIdentity = useRef("");
  const identity = `${account.identity || ""}:${wallet.address?.toLowerCase() || ""}`;
  currentIdentity.current = identity;
  useEffect(() => {
    const refresh = () => setItems(wallet.address ? readPendingTesterActivities(wallet.address) : []);
    refresh(); setNotice(""); setError("");
    window.addEventListener(TESTER_ACTIVITY_EVENT, refresh); window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(TESTER_ACTIVITY_EVENT, refresh); window.removeEventListener("storage", refresh); };
  }, [wallet.address, identity]);

  async function sync() {
    if (guard.current) return;
    setError(""); setNotice("");
    if (!wallet.address || !account.authenticated) { setError("Sign in before syncing activity."); return; }
    const startedIdentity = identity;
    const authHeaders = account.headers;
    guard.current = true; setPending(true);
    try {
      for (const item of items.slice(0, 10)) {
        if (currentIdentity.current !== startedIdentity) throw new Error("Your account changed. Sync again with the current account.");
        const result = await syncTesterActivity(item.txHash, authHeaders);
        if (result.state !== "synced") throw new Error(result.message || "Sign in with the wallet that sent this transaction, then try again.");
      }
      await queryClient.invalidateQueries({ queryKey: ["tester-leaderboard"] });
      await queryClient.invalidateQueries({ queryKey: ["tester-me"] });
      setNotice("Confirmed activity checked. Each milestone earns points once.");
    } catch (cause) { setError(transactionError(cause)); }
    finally { setItems(wallet.address ? readPendingTesterActivities(wallet.address) : []); setPending(false); guard.current = false; }
  }
  return <div className={className}>{items.length > 0 && <div className="rounded-2xl border border-[#b55fbe]/25 bg-[#b55fbe]/5 p-4"><p className="text-sm font-semibold">{items.length} {items.length === 1 ? "transaction" : "transactions"} waiting for a points check</p><p className="mt-2 text-xs leading-6 text-[var(--muted-text)]">Only confirmed, qualifying actions from a wallet linked to your Artiq account can be credited. Each milestone earns points once.</p><ul className="mt-3 space-y-2">{items.slice(0, 10).map((item) => <li key={item.txHash} className="flex items-center justify-between gap-3 text-[10px]"><span className="font-mono">{item.txHash.slice(0, 10)}…{item.txHash.slice(-6)}</span><button type="button" disabled={pending} onClick={() => removePendingTesterActivity(item.txHash)} className="text-[var(--muted-text)] underline" aria-label={`Remove pending transaction ${item.txHash}`}>Remove</button></li>)}</ul><button type="button" disabled={pending || !account.authenticated} onClick={() => void sync()} className="mt-4 inline-flex items-center gap-2 rounded-full border border-[var(--border-soft)] px-4 py-2.5 text-xs font-semibold disabled:opacity-50"><RefreshCw size={14} className={pending ? "animate-spin" : ""} />{pending ? "Verifying activity…" : "Sync confirmed activity"}</button></div>}<details className="mt-3 text-xs"><summary className="w-fit cursor-pointer font-semibold text-[#b55fbe]">Check a previous testnet transaction</summary><form className="mt-3 space-y-3" onSubmit={(event) => { event.preventDefault(); setError(""); if (!wallet.address) { setError("Connect the wallet that sent the transaction."); return; } if (!/^0x[a-fA-F0-9]{64}$/.test(previousHash.trim())) { setError("Enter a complete transaction hash starting with 0x."); return; } queueTesterActivity(previousHash.trim().toLowerCase() as Hash, wallet.address); setItems(readPendingTesterActivities(wallet.address)); setPreviousHash(""); }}><label htmlFor="previous-tester-transaction" className="block text-[11px] text-[var(--muted-text)]">Transaction hash from Arc Testnet</label><input id="previous-tester-transaction" required maxLength={66} value={previousHash} onChange={(event) => setPreviousHash(event.target.value)} placeholder="0x…" className="w-full min-w-0 rounded-xl border border-[var(--border-soft)] bg-[var(--chip-bg)] px-3 py-2.5 font-mono text-xs outline-none focus:border-[#b55fbe]" /><button disabled={pending} type="submit" className="rounded-full border border-[var(--border-soft)] px-4 py-2 text-[11px] font-semibold disabled:opacity-50">Add for verification</button></form></details>{notice && <p className="mt-3 text-xs text-[var(--muted-text)]" role="status">{notice}</p>}{error && <p className="mt-3 text-xs text-rose-600 dark:text-rose-300" role="alert">{error}</p>}</div>;
}
