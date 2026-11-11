import { encodeAbiParameters, keccak256, concatHex, isAddress, toHex, type Hex } from "viem";
import { usdcAmount } from "@/lib/protocol";
export type MintPhaseConfig = { ultimateStart: string; fcfsStart: string; publicStart: string; ultimateLimit: number; fcfsLimit: number; publicLimit: number; ultimatePrice: string; fcfsPrice: string };
export type MintTier = "PENDING" | "ULTIMATE" | "FCFS";
export type MintAllowlistWallet = { walletAddress: string; requestedTier: string; tier: string };
export type PendingMintAllowlist = { root: Hex; guaranteedAllocation: number; entries: MintAllowlistWallet[] };
export const MINT_PHASE_INTERVAL_MS = 60 * 60 * 1000;
export const MAX_MINT_ALLOWLIST_VERSIONS = 32;

/** Return only public schedule fields; private staged rosters also live in this JSON column. */
export function publicMintConfig(value: unknown): MintPhaseConfig {
  const c = value as MintPhaseConfig;
  return { ultimateStart: c.ultimateStart, fcfsStart: c.fcfsStart, publicStart: c.publicStart, ultimateLimit: c.ultimateLimit, fcfsLimit: c.fcfsLimit, publicLimit: c.publicLimit, ultimatePrice: c.ultimatePrice, fcfsPrice: c.fcfsPrice };
}

export function pendingMintAllowlist(value: unknown): PendingMintAllowlist | null {
  const pending = (value as { pendingAllowlist?: PendingMintAllowlist } | null)?.pendingAllowlist;
  return pending && typeof pending.root === "string" && /^0x[a-fA-F0-9]{64}$/.test(pending.root) && Number.isSafeInteger(pending.guaranteedAllocation) && Array.isArray(pending.entries) ? pending : null;
}

/** Retain old drafts: a creator may already have submitted one in another tab. */
export function stagedMintAllowlists(value: unknown): PendingMintAllowlist[] {
  const history = (value as { pendingAllowlistHistory?: unknown } | null)?.pendingAllowlistHistory;
  const versions = new Map<string, PendingMintAllowlist>();
  for (const draft of [...(Array.isArray(history) ? history : []), pendingMintAllowlist(value)]) {
    const parsed = pendingMintAllowlist({ pendingAllowlist: draft });
    if (parsed) versions.set(parsed.root.toLowerCase(), parsed);
  }
  return Array.from(versions.values());
}

export function validateMintConfig(value: unknown, cap: number, publicPrice: number): MintPhaseConfig {
  if (!value || typeof value !== "object") throw new Error("Provide mint phase settings.");
  const c = value as MintPhaseConfig;
  const times = [c.ultimateStart, c.fcfsStart, c.publicStart].map((v) => typeof v === "string" ? Date.parse(v) : NaN);
  if (times.some((v) => !Number.isFinite(v)) || times[0] <= Date.now()) throw new Error("Choose a future guaranteed mint opening time.");
  const seconds = times.map((time) => Math.floor(time / 1000));
  if (seconds[1] - seconds[0] !== MINT_PHASE_INTERVAL_MS / 1000 || seconds[2] - seconds[1] !== MINT_PHASE_INTERVAL_MS / 1000) throw new Error("Guaranteed minting lasts one hour, followed by one hour of FCFS, then public minting.");
  for (const limit of [c.ultimateLimit, c.fcfsLimit, c.publicLimit]) if (!Number.isInteger(limit) || limit < 1 || limit > cap) throw new Error(`Each phase limit must be between 1 and the collection wallet cap (${cap}).`);
  if (typeof c.ultimatePrice !== "string" || typeof c.fcfsPrice !== "string") throw new Error("Provide guaranteed and FCFS mint prices.");
  const guaranteed = usdcAmount(c.ultimatePrice, true);
  if (usdcAmount(c.fcfsPrice, true) < guaranteed || usdcAmount(String(publicPrice), true) < guaranteed) throw new Error("FCFS and public prices cannot be lower than the guaranteed price.");
  return { ultimateStart: new Date(times[0]).toISOString(), fcfsStart: new Date(times[1]).toISOString(), publicStart: new Date(times[2]).toISOString(), ultimateLimit: c.ultimateLimit, fcfsLimit: c.fcfsLimit, publicLimit: c.publicLimit, ultimatePrice: c.ultimatePrice, fcfsPrice: c.fcfsPrice };
}
export const collectionKey = (id: string) => keccak256(toHex(id));
export const tierNumber = (tier: string) => tier === "ULTIMATE" ? 1 : tier === "FCFS" ? 2 : 0;
export function mintLeaf(id: string, wallet: string, tier: string): Hex {
  if (!isAddress(wallet) || !tierNumber(tier)) throw new Error("Invalid allowlist entry.");
  return keccak256(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "uint8" }], [collectionKey(id), wallet, tierNumber(tier)])));
}
export function mintTree(id: string, entries: { walletAddress: string; tier: string }[]) {
  const wallets = new Set<string>();
  const leaves = entries.filter((e) => tierNumber(e.tier)).map((e) => { const wallet = e.walletAddress.toLowerCase(); if (wallets.has(wallet)) throw new Error("Duplicate allowlist wallet."); wallets.add(wallet); return mintLeaf(id, wallet, e.tier); }).sort();
  if (!leaves.length) throw new Error("Assign at least one wallet to Ultimate or FCFS before locking the allowlist.");
  const levels: Hex[][] = [leaves];
  while (levels.at(-1)!.length > 1) { const row = levels.at(-1)!; const next: Hex[] = []; for (let i = 0; i < row.length; i += 2) next.push(i + 1 === row.length ? row[i] : hashPair(row[i], row[i + 1])); levels.push(next); }
  return { root: levels.at(-1)![0], proof(wallet: string, tier: string): Hex[] { let index = leaves.indexOf(mintLeaf(id, wallet, tier)); if (index < 0) throw new Error("Wallet is not selected."); const proof: Hex[] = []; for (const row of levels.slice(0, -1)) { if ((index ^ 1) < row.length) proof.push(row[index ^ 1]); index = Math.floor(index / 2); } return proof; } };
}
export function hashPair(a: Hex, b: Hex): Hex { return keccak256(concatHex(a < b ? [a, b] : [b, a])); }
export function onchainMintConfig(id: string, root: Hex, c: MintPhaseConfig) {
  return { root, collectionKey: collectionKey(id), ultimateStart: BigInt(Math.floor(Date.parse(c.ultimateStart) / 1000)), fcfsStart: BigInt(Math.floor(Date.parse(c.fcfsStart) / 1000)), publicStart: BigInt(Math.floor(Date.parse(c.publicStart) / 1000)), ultimateLimit: c.ultimateLimit, fcfsLimit: c.fcfsLimit, publicLimit: c.publicLimit, ultimatePrice: usdcAmount(c.ultimatePrice, true), fcfsPrice: usdcAmount(c.fcfsPrice, true) };
}

/** Each selected Ultimate wallet must be able to claim its entire allocation before FCFS. */
export function guaranteedUltimateAllocation(entries: { tier: string }[], config: MintPhaseConfig, supply: number): number {
  const reserved = entries.filter((entry) => entry.tier === "ULTIMATE").length * config.ultimateLimit;
  if (!Number.isSafeInteger(reserved) || reserved > supply) throw new Error(`Ultimate allocations require ${reserved} tokens, but the collection only has ${supply}. Reduce the Ultimate wallet count or allocation before locking.`);
  return reserved;
}
