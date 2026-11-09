"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSendTransaction } from "wagmi";
import { isAddress, zeroAddress, type Address, type Hash, type Hex, type PublicClient } from "viem";
import { arcChain } from "@/lib/arcConfig";
import { collectionCreationFeeData } from "@/lib/collectionCreationFee";
import { COLLECTION_CREATION_FEE, transactionError } from "@/lib/protocol";
import { useArtiqAccount } from "@/hooks/useArtiqAccount";
import { useTransactionRecovery } from "@/hooks/useTransactionRecovery";

export type CollectionCreationPaymentStatus = {
  paid: boolean;
  amount: string;
  recipient: Address | null;
  chainId: number;
  paymentData: Hex;
  payment: { txHash: Hash; payerWallet: string; recipientWallet: string; amount: string; chainId: number; paidAt: string } | null;
};
type Client = Pick<PublicClient, "estimateGas" | "getTransactionReceipt" | "waitForTransactionReceipt">;

function pendingRequest(key: string | null): boolean {
  if (!key) return false;
  try { return localStorage.getItem(key) === "pending"; } catch { return false; }
}

const LOCAL_WALLET_FAILURES = new Set(["UserRejectedRequestError", "ConnectorNotConnectedError", "ConnectorAccountNotFoundError", "ConnectorChainMismatchError", "ConnectorUnavailableReconnectingError", "ChainNotConfiguredError", "AccountNotFoundError", "AccountTypeNotSupportedError", "InvalidAddressError", "ChainMismatchError"]);
function notBroadcast(error: unknown): boolean {
  const seen = new Set<unknown>();
  while (error && typeof error === "object" && !seen.has(error)) {
    seen.add(error);
    const value = error as { code?: unknown; name?: unknown; cause?: unknown };
    if (value.code === 4001 || typeof value.name === "string" && LOCAL_WALLET_FAILURES.has(value.name)) return true;
    error = value.cause;
  }
  return false;
}

function paymentStatus(value: unknown, itemId: string): CollectionCreationPaymentStatus {
  const status = value as CollectionCreationPaymentStatus | null;
  if (!status || typeof status.paid !== "boolean" || status.amount !== COLLECTION_CREATION_FEE.toString() ||
    status.chainId !== arcChain.id || status.paymentData !== collectionCreationFeeData(itemId) ||
    (!status.paid && (!status.recipient || !isAddress(status.recipient) || status.recipient.toLowerCase() === zeroAddress))) {
    throw new Error("The collection creation fee could not be verified. Please retry the fee check.");
  }
  return status;
}

/** A confirmed direct treasury payment remains credit for this collection after a failed deployment. */
export function useCollectionCreationPayment(itemId: string, enabled: boolean, client: Client | undefined, connected: boolean, wrongNetwork: boolean) {
  const account = useArtiqAccount();
  const queryClient = useQueryClient();
  const { sendTransactionAsync } = useSendTransaction();
  const recovery = useTransactionRecovery(enabled && account.authenticated && account.identity && account.walletAddress ? {
    accountId: account.identity, walletAddress: account.walletAddress, chainId: arcChain.id, itemId, operation: "collection-creation-fee",
  } : null);
  const scope = JSON.stringify([enabled, account.identity, account.walletAddress?.toLowerCase(), itemId]);
  const currentScope = useRef(scope); currentScope.current = scope;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const active = useRef(false);
  const [busy, setBusy] = useState(false);
  const requestKey = recovery.key ? `${recovery.key}:payment-request` : null;
  const [request, setRequest] = useState({ key: null as string | null, pending: false, storageUnavailable: false });
  useEffect(() => {
    const load = () => setRequest({ key: requestKey, pending: pendingRequest(requestKey), storageUnavailable: false });
    load();
    if (typeof window === "undefined") return;
    const onStorage = (event: StorageEvent) => { if (event.key === requestKey || event.key === null) load(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [requestKey]);
  const [feedback, setFeedback] = useState({ scope, busy: false, error: "", hash: null as Hash | null });
  const queryKey = ["collection-creation-payment", arcChain.id, itemId, account.identity, account.walletAddress] as const;
  const query = useQuery({
    queryKey,
    enabled: enabled && account.authenticated,
    retry: false,
    queryFn: async () => {
      const response = await fetch(`/api/items/${encodeURIComponent(itemId)}/creation-fee`, { headers: account.headers, cache: "no-store", signal: AbortSignal.timeout(20_000) });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "The collection creation fee could not be loaded.");
      return paymentStatus(body, itemId);
    },
  });
  const isCurrent = () => mounted.current && currentScope.current === scope;
  function markRequest(pending: boolean) {
    let storageUnavailable = false;
    if (requestKey) {
      try { if (pending) localStorage.setItem(requestKey, "pending"); else localStorage.removeItem(requestKey); }
      catch { storageUnavailable = true; }
    }
    if (isCurrent()) setRequest({ key: requestKey, pending, storageUnavailable });
  }
  const setError = (error: string) => { if (isCurrent()) setFeedback((previous) => ({ scope, busy: previous.scope === scope && previous.busy, error, hash: previous.scope === scope ? previous.hash : null })); };
  const clearRecovery = recovery.clear;
  useEffect(() => {
    if (!query.data?.paid) return;
    clearRecovery();
    if (requestKey) { try { localStorage.removeItem(requestKey); } catch { /* Retain the server's confirmed credit. */ } }
    setRequest({ key: requestKey, pending: false, storageUnavailable: false });
  }, [query.data?.paid, clearRecovery, requestKey]);

  async function save(hash: Hash) {
    if (!isCurrent()) throw new Error("Return to the account and wallet that submitted the creation fee.");
    const response = await fetch(`/api/items/${encodeURIComponent(itemId)}/creation-fee`, {
      method: "POST", headers: { ...account.headers, "Content-Type": "application/json" }, body: JSON.stringify({ txHash: hash }), signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Your payment needs verification. Keep its transaction hash and retry verification without paying again.");
    const result = paymentStatus(body, itemId);
    if (!result.paid) throw new Error("Your creation fee has not been confirmed. Retry verification without paying again.");
    markRequest(false);
    if (isCurrent()) { queryClient.setQueryData(queryKey, result); recovery.clear(hash); }
  }

  async function recover(value: string) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    if (isCurrent()) setFeedback({ scope, busy: true, error: "", hash: null });
    try {
      if (!/^0x[a-fA-F0-9]{64}$/.test(value)) throw new Error("Enter the complete creation fee transaction hash.");
      if (!account.walletAddress || !client || !connected || wrongNetwork) throw new Error("Select the wallet that paid the creation fee on Arc Testnet.");
      const hash = value as Hash;
      if (recovery.record && recovery.record.hash.toLowerCase() !== hash.toLowerCase()) throw new Error("Verify the saved creation fee before entering a different transaction.");
      const receipt = await client.getTransactionReceipt({ hash });
      if (receipt.from.toLowerCase() !== account.walletAddress.toLowerCase()) throw new Error("This creation fee transaction belongs to a different wallet.");
      if (recovery.record && receipt.to?.toLowerCase() !== recovery.record.contractAddress.toLowerCase()) throw new Error("This transaction was sent to a different wallet. Verify the saved creation fee transaction.");
      if (receipt.status === "reverted") {
        recovery.clear(hash);
        markRequest(false);
        throw new Error("The creation fee payment reverted. You can pay again; the reverted transaction did not transfer the fee.");
      }
      await save(hash);
    } catch (error) { setError(error instanceof Error ? error.message : "The fee could not be verified. Keep its transaction hash and retry verification."); }
    finally { active.current = false; if (mounted.current) setBusy(false); if (isCurrent()) setFeedback((previous) => ({ ...previous, busy: false })); }
  }

  async function pay() {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    if (isCurrent()) setFeedback({ scope, busy: true, error: "", hash: null });
    try {
      if (!account.authenticated) { account.login(); return; }
      if (!connected || !account.walletAddress) { account.connectWallet(); return; }
      if (!client || wrongNetwork || !enabled) throw new Error("Connect the creator wallet on Arc Testnet before paying the creation fee.");
      recovery.assertCanStart();
      // A fresh server read prevents cached unpaid state from requesting a
      // second transfer after payment in another tab or on another wallet.
      const checked = await query.refetch();
      if (checked.isError || !checked.data) throw new Error("The creation fee could not be checked. Retry the fee check before paying.");
      const status = paymentStatus(checked.data, itemId);
      if (status.paid) { markRequest(false); return; }
      if (!isCurrent()) throw new Error("Your account or wallet changed. Return to the original wallet before paying.");
      recovery.assertCanStart();
      if (pendingRequest(requestKey) || (request.key === requestKey && request.pending)) throw new Error("A creation fee request needs verification. Enter its transaction hash below before paying again.");
      // Estimate before marking a wallet request: low funds or a rejecting
      // recipient can then be corrected safely without an unknown-submission
      // lock, since this read-only call cannot broadcast a payment.
      await client.estimateGas({ account: account.walletAddress as Address, to: status.recipient!, value: COLLECTION_CREATION_FEE, data: status.paymentData });
      if (!isCurrent()) throw new Error("Your account or wallet changed. Return to the original wallet before paying.");
      recovery.assertCanStart();
      if (pendingRequest(requestKey)) throw new Error("A creation fee request needs verification. Enter its transaction hash below before paying again.");
      markRequest(true);
      let hash: Hash;
      try {
        hash = await sendTransactionAsync({
          to: status.recipient!, value: COLLECTION_CREATION_FEE, data: status.paymentData,
          account: account.walletAddress as Address, chainId: arcChain.id,
        });
      } catch (error) {
        // A transport failure can happen after broadcast. Only an explicit
        // wallet rejection proves that this prompt did not submit a transfer.
        if (notBroadcast(error)) markRequest(false);
        throw error;
      }
      // Store immediately, before confirmation or API verification. Saving uses
      // the original scope even if the user switches accounts during the prompt.
      recovery.capture(hash, status.recipient!);
      markRequest(false);
      if (isCurrent()) setFeedback({ scope, busy: true, error: "", hash });
      let currentHash = hash;
      let cancelledHash: Hash | null = null;
      const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1, onReplaced: ({ reason, transaction, transactionReceipt }) => {
        if (reason === "cancelled" && transaction.from.toLowerCase() === account.walletAddress!.toLowerCase() &&
          transaction.to?.toLowerCase() === account.walletAddress!.toLowerCase() && transaction.value === BigInt(0) &&
          transactionReceipt.from.toLowerCase() === account.walletAddress!.toLowerCase() &&
          transactionReceipt.to?.toLowerCase() === account.walletAddress!.toLowerCase() &&
          transactionReceipt.transactionHash.toLowerCase() === transaction.hash.toLowerCase()) {
          // This confirmed zero-value self-transfer consumed the original
          // payment's nonce. Clear the saved payment before a reload can leave
          // the cancellation transaction mistaken for an unpaid treasury fee.
          cancelledHash = transactionReceipt.transactionHash;
          recovery.clear(currentHash);
          markRequest(false);
          return;
        }
        currentHash = transactionReceipt.transactionHash;
        recovery.capture(currentHash, status.recipient!);
      } });
      if (cancelledHash === receipt.transactionHash) throw new Error("The creation fee payment was cancelled. No creation fee was transferred; you can pay when ready.");
      if (receipt.from.toLowerCase() !== account.walletAddress.toLowerCase() || receipt.to?.toLowerCase() !== status.recipient!.toLowerCase()) throw new Error("This transaction does not match the creation fee payment. Keep its hash and verify it before paying again.");
      if (receipt.status === "reverted") {
        recovery.clear(receipt.transactionHash);
        throw new Error("The creation fee payment reverted. No creation fee was transferred.");
      }
      await save(receipt.transactionHash);
    } catch (error) { setError(transactionError(error)); }
    finally { active.current = false; if (mounted.current) setBusy(false); if (isCurrent()) setFeedback((previous) => ({ ...previous, busy: false })); }
  }

  return {
    ...query, paid: query.data?.paid === true,
    busy,
    error: feedback.scope === scope ? feedback.error : "",
    hash: feedback.scope === scope ? feedback.hash : null,
    requestPending: request.key === requestKey && request.pending,
    requestStorageUnavailable: request.key === requestKey && request.storageUnavailable,
    recovery, pay, recover,
  };
}
