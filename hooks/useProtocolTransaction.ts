"use client";

import { useRef, useState } from "react";
import { usePublicClient, useWriteContract } from "wagmi";
import { type Hash } from "viem";
import { arcChain } from "@/lib/arcConfig";
import { protocol, transactionError } from "@/lib/protocol";
import { useWallet } from "@/hooks/useWallet";
import { useArtiqAccount } from "@/hooks/useArtiqAccount";
import { queueTesterActivity, syncTesterActivity } from "@/lib/testerActivityQueue";

export function useProtocolTransaction() {
  const wallet = useWallet();
  const account = useArtiqAccount();
  const client = usePublicClient({ chainId: arcChain.id });
  const { writeContractAsync } = useWriteContract();
  const active = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [hash, setHash] = useState<Hash | null>(null);
  async function run(action: (write: typeof writeContractAsync) => Promise<Hash>, after?: (hash: Hash) => Promise<void>) {
    if (active.current) return;
    setError(""); setHash(null);
    if (!protocol.isTestnet) { setError("These new features are available on Arc Testnet only."); return; }
    if (!wallet.isConnected) { setError("Sign in and select a wallet to continue."); return; }
    if (wallet.isWrongNetwork) { await wallet.switchToArc(); return; }
    if (!client) { setError("Arc is unavailable. Please try again."); return; }
    active.current = true; setPending(true);
    try {
      const transaction = await action(writeContractAsync);
      setHash(transaction);
      const receipt = await client.waitForTransactionReceipt({ hash: transaction, confirmations: 1 });
      if (receipt.status !== "success") throw new Error("The transaction reverted. No action was recorded.");
      // Score only after confirmation. Points sync is independent of the
      // transaction result and can be retried from the leaderboard.
      queueTesterActivity(transaction, receipt.from);
      if (account.authenticated) void syncTesterActivity(transaction, account.headers);
      await after?.(transaction);
    } catch (cause) { setError(transactionError(cause)); }
    finally { active.current = false; setPending(false); }
  }
  return { ...wallet, client, run, pending, error, hash, setError };
}
