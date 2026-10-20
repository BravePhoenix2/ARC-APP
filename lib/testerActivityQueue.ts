import { isAddress, type Address, type Hash } from "viem";

export const TESTER_ACTIVITY_EVENT = "artiq:tester-activity-changed";
const key = "artiq:pending-tester-activity:v1";
const maxAge = 30 * 24 * 60 * 60 * 1000;
export type PendingTesterActivity = { txHash: Hash; walletAddress: Address; createdAt: number };

export function readPendingTesterActivities(walletAddress?: string): PendingTesterActivity[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw || raw.length > 100_000) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PendingTesterActivity => !!item && typeof item === "object" &&
      typeof item.txHash === "string" && /^0x[a-f0-9]{64}$/.test(item.txHash) &&
      typeof item.walletAddress === "string" && isAddress(item.walletAddress) &&
      typeof item.createdAt === "number" && Number.isFinite(item.createdAt) && item.createdAt > Date.now() - maxAge &&
      (!walletAddress || item.walletAddress.toLowerCase() === walletAddress.toLowerCase())).slice(-50);
  } catch { return []; }
}

function save(items: PendingTesterActivity[]) {
  try { window.localStorage.setItem(key, JSON.stringify(items.slice(-50))); }
  catch { /* Blocked storage does not change a confirmed transaction. */ }
  window.dispatchEvent(new Event(TESTER_ACTIVITY_EVENT));
}

export function queueTesterActivity(txHash: Hash, walletAddress: Address) {
  if (typeof window === "undefined") return;
  const hash = txHash.toLowerCase() as Hash;
  const items = readPendingTesterActivities();
  if (!items.some((item) => item.txHash === hash)) save([...items, { txHash: hash, walletAddress, createdAt: Date.now() }]);
}

export function removePendingTesterActivity(txHash: Hash) {
  if (typeof window !== "undefined") save(readPendingTesterActivities().filter((item) => item.txHash !== txHash.toLowerCase()));
}

export type TesterSyncResult = { state: "synced" | "proof-required" | "sign-in-required" | "retry"; message?: string };
const pendingRequests = new Map<string, Promise<TesterSyncResult>>();

export function syncTesterActivity(txHash: Hash, authHeaders: Record<string, string>, walletSignature?: Hash): Promise<TesterSyncResult> {
  const requestKey = `${authHeaders["X-Artiq-Account-ID"] || authHeaders["X-Wallet-Address"]}:${txHash}:${!!walletSignature}`;
  const pending = pendingRequests.get(requestKey);
  if (pending) return pending;
  const request = (async (): Promise<TesterSyncResult> => {
    try {
      const response = await fetch("/api/tester/activity", {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ txHash, ...(walletSignature ? { walletSignature } : {}) }), signal: AbortSignal.timeout(15_000),
      });
      const body = await response.json().catch(() => null);
      if (response.ok) {
        removePendingTesterActivity(txHash);
        return { state: "synced" };
      }
      if (body?.code === "WALLET_PROOF_REQUIRED") return { state: "proof-required" };
      if (response.status === 401) return { state: "sign-in-required" };
      return { state: "retry", message: typeof body?.error === "string" ? body.error : "Activity could not be verified. Try syncing again." };
    } catch { return { state: "retry", message: "Activity sync is temporarily unavailable. Your transaction is still confirmed." }; }
  })();
  pendingRequests.set(requestKey, request);
  void request.finally(() => pendingRequests.delete(requestKey));
  return request;
}
