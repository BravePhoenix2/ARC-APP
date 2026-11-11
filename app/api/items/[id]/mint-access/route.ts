import { protectAccount, withAbuseProtection } from "@/lib/abuseProtection";
import { NextRequest, NextResponse } from "next/server";
import { isAddress, type Hash } from "viem";
import { prisma } from "@/lib/prisma";
import { sameOrigin } from "@/lib/walletAuth";
import { getCreatorSession } from "@/lib/creatorSession";
import { limitedJson } from "@/lib/requestBody";
import { collectionKey, guaranteedUltimateAllocation, MAX_MINT_ALLOWLIST_VERSIONS, mintTree, pendingMintAllowlist, publicMintConfig, stagedMintAllowlists, tierNumber, validateMintConfig, type MintAllowlistWallet, type MintPhaseConfig, type PendingMintAllowlist } from "@/lib/mintAccess";
import { publicItemWhere } from "@/lib/publicCatalog";
import { managedAllowlistState, MintManagementError, verifyAllowlistUpdate, verifyMintManagement } from "@/lib/mintManagement";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
async function handleGET(request: NextRequest, { params: routeParams }: { params: Promise<{ id: string }> }) {
  const params = await routeParams;
  const item = await prisma.item.findFirst({ where: { id: params.id, AND: [publicItemWhere] }, select: { creatorId: true, mintAccessPlan: { include: { entries: true } } } });
  if (!item) return json({ error: "Collection not found." }, 404);
  const session = await getCreatorSession(request);
  const manage = request.nextUrl.searchParams.get("manage") === "1";
  const isOwner = session?.userId === item.creatorId;
  if (manage && !isOwner) return json({ error: "Only the creator can view registrations." }, 403);
  const plan = item.mintAccessPlan;
  if (!plan) return json({ plan: null });
  const entry = plan.entries.find((e) => e.walletAddress === session?.walletAddress?.toLowerCase());
  const config = publicMintConfig(plan.config);
  return json({ plan: { config, root: plan.root, frozenAt: plan.frozenAt, registrations: plan.entries.length, guaranteedAllocation: plan.entries.filter((wallet) => wallet.tier === "ULTIMATE").length * config.ultimateLimit }, entry: entry ? { tier: entry.tier, requestedTier: entry.requestedTier } : null,
    proof: plan.root && entry && tierNumber(entry.tier) ? mintTree(params.id, plan.entries).proof(entry.walletAddress, entry.tier) : null,
    ...(manage ? { entries: plan.entries.map(({ walletAddress, requestedTier, tier }) => ({ walletAddress, requestedTier, tier })), pendingUpdate: pendingMintAllowlist(plan.config) } : {}) });
}
async function handlePOST(request: NextRequest, { params: routeParams }: { params: Promise<{ id: string }> }) {
  const params = await routeParams;
  if (!sameOrigin(request)) return json({ error: "Invalid request origin." }, 403);
  const session = await getCreatorSession(request);
  if (!session) return json({ error: "Sign in first." }, 401);
  const limited = await protectAccount("transaction", session.userId, "items/[id]/mint-access", request);
  if (limited) return limited;
  let body;
  try { body = await limitedJson(request, 150_000); } catch { return json({ error: "Invalid request." }, 400); }
  if (!body || typeof body !== "object" || !("action" in body)) return json({ error: "Choose an action." }, 400);
  const input = body as Record<string, unknown>;
  try {
    // Chain work stays outside database transactions. The write below compares
    // updatedAt before applying any result, so concurrent settings changes win.
    const initial = await prisma.item.findFirst({ where: { id: params.id, AND: [publicItemWhere] }, include: { mintAccessPlan: { include: { entries: true } } } });
    if (!initial || initial.itemType !== "NFT") throw new Error("NFT collection not found.");
    const initialPlan = initial.mintAccessPlan;
    const deployedAction = initial.contractAddress && ["assign", "activate-allowlist", "discard-allowlist", "sync-management"].includes(String(input.action));
    let chainState: Awaited<ReturnType<typeof managedAllowlistState>> | undefined;
    let managementState: Awaited<ReturnType<typeof verifyMintManagement>> | undefined;
    let activatedSnapshot: PendingMintAllowlist | undefined;
    if (deployedAction) {
      if (initial.creatorId !== session.userId) throw new Error("Only the creator can manage mint access.");
      if (!session.walletAddress) throw new MintManagementError("Connect the collection owner wallet to manage this mint.", 403);
      if (input.action === "sync-management") {
        if (typeof input.txHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(input.txHash)) throw new Error("Provide a valid management transaction hash.");
        managementState = await verifyMintManagement(initial, session.walletAddress, input.txHash as Hash);
      } else {
        if (!initialPlan?.root || !initialPlan.frozenAt) throw new Error("This collection does not have a deployed whitelist.");
        if (input.action === "activate-allowlist") {
          const versions = stagedMintAllowlists(initialPlan.config);
          const confirmedHash = (initialPlan.config as { lastAllowlistUpdateTxHash?: string }).lastAllowlistUpdateTxHash;
          if (typeof input.txHash === "string" && confirmedHash === input.txHash.toLowerCase()) return json({ saved: true });
          if (!versions.length) throw new Error("There is no saved whitelist update.");
          if (typeof input.txHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(input.txHash)) throw new Error("Provide a valid whitelist update transaction hash.");
          const verified = await verifyAllowlistUpdate(initial, session.walletAddress, input.txHash as Hash, [initialPlan.root, ...versions.map((draft) => draft.root)], versions);
          chainState = verified;
          activatedSnapshot = verified.snapshot;
        } else {
          chainState = await managedAllowlistState(initial, session.walletAddress);
          if (chainState.root.toLowerCase() !== initialPlan.root.toLowerCase() || chainState.collectionKey !== collectionKey(initial.id)) throw new Error("A whitelist update is already on-chain. Verify its transaction before editing the wallet list again.");
          if (input.action === "assign" && (chainState.closed || chainState.timestamp >= chainState.ultimateStart)) throw new Error("Whitelist editing closes when guaranteed minting starts.");
        }
      }
    }
    await prisma.$transaction(async (tx) => {
      const item = await tx.item.findFirst({ where: { id: params.id, AND: [publicItemWhere] }, include: { mintAccessPlan: { include: { entries: true } } } });
      if (!item || item.itemType !== "NFT") throw new Error("NFT collection not found.");
      const plan = item.mintAccessPlan;
      if (deployedAction) {
        if (item.updatedAt.getTime() !== initial.updatedAt.getTime() || item.contractAddress !== initial.contractAddress || item.creatorId !== session.userId) throw new Error("Collection settings changed while verifying this update. Refresh and retry.");
        // A real write serializes competing updates before changing staged or
        // live rosters, without trusting a client-supplied revision number.
        const updatedAt = new Date(Math.max(Date.now(), initial.updatedAt.getTime() + 1));
        const claimed = await tx.item.updateMany({ where: { id: item.id, updatedAt: initial.updatedAt, contractAddress: initial.contractAddress }, data: { updatedAt } });
        if (claimed.count !== 1) throw new Error("Collection settings changed while verifying this update. Refresh and retry.");
        if (input.action === "sync-management" && managementState) {
          await tx.item.update({ where: { id: item.id }, data: { updatedAt, maxSupply: Number(managementState.maxSupply), mintedCount: Number(managementState.totalMinted), status: managementState.closed ? "CLOSED" : managementState.totalMinted >= managementState.maxSupply ? "MINTED_OUT" : managementState.timestamp < managementState.start ? "UPCOMING" : "LIVE" } });
          return;
        }
        if (!plan) throw new Error("This collection does not have a deployed whitelist.");
        const config = publicMintConfig(plan.config);
        const versions = stagedMintAllowlists(plan.config);
        const lastAllowlistUpdateTxHash = (plan.config as { lastAllowlistUpdateTxHash?: string }).lastAllowlistUpdateTxHash;
        if (input.action === "activate-allowlist") {
          const snapshot = activatedSnapshot && versions.find((draft) => draft.root.toLowerCase() === activatedSnapshot.root.toLowerCase());
          if (!snapshot || chainState?.root.toLowerCase() !== snapshot.root.toLowerCase()) throw new Error("The saved whitelist changed. Refresh and verify its matching transaction.");
          const pending = pendingMintAllowlist(plan.config);
          const latestDraft = pending && pending.root.toLowerCase() !== snapshot.root.toLowerCase() ? pending : null;
          await tx.mintAllowlistEntry.deleteMany({ where: { planId: plan.id } });
          await tx.mintAllowlistEntry.createMany({ data: snapshot.entries.map((entry) => ({ ...entry, planId: plan.id })) });
          await tx.mintAccessPlan.update({ where: { id: plan.id }, data: { root: snapshot.root, config: { ...config, ...(latestDraft ? { pendingAllowlist: latestDraft } : {}), pendingAllowlistHistory: versions.filter((draft) => draft.root.toLowerCase() !== latestDraft?.root.toLowerCase()), lastAllowlistUpdateTxHash: String(input.txHash).toLowerCase() } } });
          return;
        }
        if (input.action === "discard-allowlist") {
          await tx.mintAccessPlan.update({ where: { id: plan.id }, data: { config: { ...config, pendingAllowlistHistory: versions, ...(lastAllowlistUpdateTxHash ? { lastAllowlistUpdateTxHash } : {}) } } });
          return;
        }
        const entries = assignedWallets(input, pendingMintAllowlist(plan.config)?.entries ?? plan.entries);
        const guaranteedAllocation = guaranteedUltimateAllocation(entries, config, Number(chainState!.maxSupply));
        const pendingAllowlist = { root: mintTree(item.id, entries).root, guaranteedAllocation, entries };
        const history = versions.filter((draft) => draft.root.toLowerCase() !== pendingAllowlist.root.toLowerCase());
        if (history.length >= MAX_MINT_ALLOWLIST_VERSIONS) throw new Error(`This collection already retains ${MAX_MINT_ALLOWLIST_VERSIONS} whitelist versions for transaction recovery. No saved version can be removed while its transaction may still confirm. Recover an existing version instead of creating another draft.`);
        await tx.mintAccessPlan.update({ where: { id: plan.id }, data: { config: { ...config, pendingAllowlist, pendingAllowlistHistory: history, ...(lastAllowlistUpdateTxHash ? { lastAllowlistUpdateTxHash } : {}) } } });
        return;
      }
      if (input.action === "unfreeze") {
        if (item.creatorId !== session.userId) throw new Error("Only the creator can unlock mint settings.");
        if (item.contractAddress) throw new Error("A deployed collection's schedule and prices cannot be unlocked.");
        if (!plan) throw new Error("Save mint phase settings before unlocking them.");
        if (!plan.frozenAt) throw new Error("These mint settings are already editable.");
        const updatedAt = new Date(Math.max(Date.now(), item.updatedAt.getTime() + 1));
        const changed = await tx.item.updateMany({ where: { id: item.id, creatorId: session.userId, contractAddress: null, updatedAt: item.updatedAt }, data: { updatedAt } });
        if (changed.count !== 1) throw new Error("Collection settings changed while unlocking. Refresh before trying again.");
        await tx.mintAccessPlan.update({ where: { id: plan.id }, data: { root: null, frozenAt: null } });
        return;
      }
      if (input.action === "reduce-supply") {
        if (item.creatorId !== session.userId) throw new Error("Only the creator can reduce this collection's supply.");
        if (item.contractAddress) throw new Error("Confirm a supply reduction from the collection owner wallet, then verify its transaction.");
        const supply = input.maxSupply;
        if (typeof supply !== "number" || !Number.isInteger(supply) || supply < 1 || supply >= (item.maxSupply || 0) || supply < (item.mintedCount || 0)) throw new Error("Choose a lower whole-number supply that covers every minted token.");
        if (plan) {
          const config = publicMintConfig(plan.config);
          guaranteedUltimateAllocation(plan.entries, config, supply);
          const cap = Math.min(item.maxPerWallet ?? supply, supply);
          // No tokens exist yet. Keep backed guaranteed allocations intact,
          // and cap each unused phase limit at the new collection size.
          const reduced = { ...config, ultimateLimit: Math.min(config.ultimateLimit, cap), fcfsLimit: Math.min(config.fcfsLimit, cap), publicLimit: Math.min(config.publicLimit, cap) };
          await tx.mintAccessPlan.update({ where: { id: plan.id }, data: { config: reduced } });
        }
        // Retain all image rows and imageCount: changing the metadata URI shape
        // or removing rows would break existing numbered token metadata.
        await tx.item.update({ where: { id: item.id }, data: { updatedAt: new Date(Math.max(Date.now(), item.updatedAt.getTime() + 1)), maxSupply: supply, maxPerWallet: Math.min(item.maxPerWallet ?? supply, supply) } });
        return;
      }
      if (item.contractAddress || plan?.frozenAt) throw new Error("Mint access is locked. Prices, registrations, and tier changes cannot be edited.");
      if (input.action === "register") {
        if (!session.walletAddress) throw new Error("Connect a wallet linked to your signed-in account.");
        if (!plan) throw new Error("This collection has not opened registrations.");
        if (Date.parse((plan.config as { ultimateStart: string }).ultimateStart) <= Date.now()) throw new Error("Registration has closed for this schedule.");
        const walletAddress = session.walletAddress.toLowerCase();
        if (plan.entries.length >= 2000 && !plan.entries.some((e) => e.walletAddress === walletAddress)) throw new Error("Registration is full.");
        const requestedTier = input.tier === "ULTIMATE" ? "ULTIMATE" : "FCFS";
        await tx.mintAllowlistEntry.upsert({ where: { planId_walletAddress: { planId: plan.id, walletAddress } }, create: { planId: plan.id, walletAddress, requestedTier }, update: { requestedTier } });
        return;
      }
      if (item.creatorId !== session.userId) throw new Error("Only the creator can manage mint access.");
      // Touch the item inside the same transaction, invalidating in-flight deployment verification.
      await tx.item.update({ where: { id: item.id }, data: { updatedAt: new Date() } });
      if (input.action === "configure") {
        const config = validateMintConfig(input.config, item.maxPerWallet ?? item.maxSupply ?? 1, item.mintPriceUsdc ?? 0);
        await tx.mintAccessPlan.upsert({ where: { itemId: item.id }, create: { itemId: item.id, config }, update: { config } });
        await tx.item.update({ where: { id: item.id }, data: { mintStartTime: new Date(config.ultimateStart), status: "UPCOMING" } });
      } else if (input.action === "price") {
        if (!plan) throw new Error("Save the phase settings first.");
        if (input.tier !== "ULTIMATE" && input.tier !== "FCFS") throw new Error("Choose Ultimate or FCFS to edit its price.");
        const priceKey = input.tier === "ULTIMATE" ? "ultimatePrice" : "fcfsPrice";
        const config = validateMintConfig({ ...(plan.config as MintPhaseConfig), [priceKey]: input.price }, item.maxPerWallet ?? item.maxSupply ?? 1, item.mintPriceUsdc ?? 0);
        await tx.mintAccessPlan.update({ where: { id: plan.id }, data: { config } });
      } else if (input.action === "disable") {
        if (plan) await tx.mintAccessPlan.delete({ where: { id: plan.id } });
      } else if (input.action === "assign") {
        if (!plan) throw new Error("Save the phase settings first.");
        const entries = assignedWallets(input, plan.entries);
        for (const entry of entries) await tx.mintAllowlistEntry.upsert({ where: { planId_walletAddress: { planId: plan.id, walletAddress: entry.walletAddress } }, create: { planId: plan.id, ...entry }, update: { tier: entry.tier } });
      } else if (input.action === "freeze") {
        if (!plan) throw new Error("Save phase settings first.");
        validateMintConfig(plan.config, item.maxPerWallet ?? item.maxSupply ?? 1, item.mintPriceUsdc ?? 0);
        guaranteedUltimateAllocation(plan.entries, plan.config as import("@/lib/mintAccess").MintPhaseConfig, item.maxSupply ?? 0);
        const { root } = mintTree(item.id, plan.entries);
        await tx.mintAccessPlan.update({ where: { id: plan.id }, data: { root, frozenAt: new Date() } });
      } else throw new Error("Unknown mint access action.");
    });
    return json({ saved: true });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Could not update mint access." }, error instanceof MintManagementError ? error.status : 400); }
}

function assignedWallets(input: Record<string, unknown>, entries: MintAllowlistWallet[]): MintAllowlistWallet[] {
  if (!Array.isArray(input.wallets) || !input.wallets.length || input.wallets.length > 2000) throw new Error("Import between 1 and 2,000 wallet addresses.");
  if (!["PENDING", "ULTIMATE", "FCFS"].includes(String(input.tier))) throw new Error("Choose guaranteed, FCFS, or pending.");
  const wallets = Array.from(new Set(input.wallets.map((value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "")));
  if (wallets.some((wallet) => !isAddress(wallet) || /^0x0{40}$/.test(wallet))) throw new Error("Every entry must be a valid nonzero wallet address.");
  const result = new Map(entries.map(({ walletAddress, tier, requestedTier }) => [walletAddress.toLowerCase(), { walletAddress: walletAddress.toLowerCase(), tier, requestedTier }]));
  for (const walletAddress of wallets) result.set(walletAddress, { walletAddress, tier: String(input.tier), requestedTier: result.get(walletAddress)?.requestedTier ?? "FCFS" });
  if (result.size > 2000) throw new Error("The allowlist holds up to 2,000 wallets.");
  return Array.from(result.values());
}

export const GET = withAbuseProtection("GET items/[id]/mint-access", "read", handleGET);
export const POST = withAbuseProtection("POST items/[id]/mint-access", "transaction", handlePOST);
