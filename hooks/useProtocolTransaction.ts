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
  const contextKey = JSON.stringify([account.identity ?? null, wallet.address?.toLowerCase() ?? null, arcChain.id]);
  const currentContext = useRef(contextKey); currentContext.current = contextKey;
  const active = useRef(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ key: string; error: string; hash: Hash | null }>({ key: contextKey, error: "", hash: null });
  const error = feedback.key === contextKey ? feedback.error : "";
  const hash = feedback.key === contextKey ? feedback.hash : null;
  function setError(value: string) {
    if (currentContext.current === contextKey) setFeedback((current) => ({ key: contextKey, error: value, hash: current.key === contextKey ? current.hash : null }));
  }
  function setHash(value: Hash | null) {
    if (currentContext.current === contextKey) setFeedback((current) => ({ key: contextKey, error: current.key === contextKey ? current.error : "", hash: value }));
  }
  async function run(action: (write: typeof writeContractAsync) => Promise<Hash>, after?: (hash: Hash) => Promise<void>) {
    if (active.current) return;
    setError(""); setHash(null);
    if (!protocol.isTestnet) { setError("These new features are available on Arc Testnet only."); return; }
    if (!wallet.isConnected) { setError("Sign in and select a wallet to continue."); return; }
    if (wallet.isWrongNetwork) { await wallet.switchToArc(); return; }
    if (!client) { setError("Arc is unavailable. Please try again."); return; }
    active.current = true; setPending(true);
    try {
      // Preserve wagmi's generic caller API while forwarding the exact request
      // object through a non-generic boundary for the account-change guard.
      const forwardWrite = writeContractAsync as (parameters: Parameters<typeof writeContractAsync>[0]) => ReturnType<typeof writeContractAsync>;
      const guardedWrite = ((parameters: Parameters<typeof writeContractAsync>[0]) => {
        if (currentContext.current !== contextKey) throw new Error("Your account or wallet changed. Return to the original wallet before continuing.");
        return forwardWrite(parameters);
      }) as typeof writeContractAsync;
      const transaction = await action(guardedWrite);
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
