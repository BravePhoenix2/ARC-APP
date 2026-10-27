import { protectAccount, withAbuseProtection } from "@/lib/abuseProtection";
import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { prisma } from "@/lib/prisma";
import { sameOrigin } from "@/lib/walletAuth";
import { getCreatorSession } from "@/lib/creatorSession";
import { limitedJson } from "@/lib/requestBody";
import { guaranteedUltimateAllocation, mintTree, tierNumber, validateMintConfig, type MintPhaseConfig } from "@/lib/mintAccess";
import { publicItemWhere } from "@/lib/publicCatalog";
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
  return json({ plan: { config: plan.config, root: plan.root, frozenAt: plan.frozenAt, registrations: plan.entries.length }, entry: entry ? { tier: entry.tier, requestedTier: entry.requestedTier } : null,
    proof: plan.root && entry && tierNumber(entry.tier) ? mintTree(params.id, plan.entries).proof(entry.walletAddress, entry.tier) : null,
    ...(manage ? { entries: plan.entries.map(({ walletAddress, requestedTier, tier }) => ({ walletAddress, requestedTier, tier })) } : {}) });
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
    await prisma.$transaction(async (tx) => {
      const item = await tx.item.findFirst({ where: { id: params.id, AND: [publicItemWhere] }, include: { mintAccessPlan: { include: { entries: true } } } });
      if (!item || item.itemType !== "NFT") throw new Error("NFT collection not found.");
      const plan = item.mintAccessPlan;
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
        if (!Array.isArray(input.wallets) || !input.wallets.length || input.wallets.length > 2000) throw new Error("Import between 1 and 2,000 wallet addresses.");
        if (!["PENDING", "ULTIMATE", "FCFS"].includes(String(input.tier))) throw new Error("Choose Ultimate, FCFS, or pending.");
        const wallets = Array.from(new Set(input.wallets.map((v: unknown) => typeof v === "string" ? v.trim().toLowerCase() : "")));
        if (wallets.some((w) => !isAddress(w) || /^0x0{40}$/.test(w))) throw new Error("Every entry must be a valid nonzero wallet address.");
        if (new Set([...plan.entries.map((e) => e.walletAddress), ...wallets]).size > 2000) throw new Error("The allowlist holds up to 2,000 wallets.");
        for (const walletAddress of wallets) await tx.mintAllowlistEntry.upsert({ where: { planId_walletAddress: { planId: plan.id, walletAddress } }, create: { planId: plan.id, walletAddress, tier: String(input.tier) }, update: { tier: String(input.tier) } });
      } else if (input.action === "freeze") {
        if (!plan) throw new Error("Save phase settings first.");
        validateMintConfig(plan.config, item.maxPerWallet ?? item.maxSupply ?? 1, item.mintPriceUsdc ?? 0);
        guaranteedUltimateAllocation(plan.entries, plan.config as import("@/lib/mintAccess").MintPhaseConfig, item.maxSupply ?? 0);
        const { root } = mintTree(item.id, plan.entries);
        await tx.mintAccessPlan.update({ where: { id: plan.id }, data: { root, frozenAt: new Date() } });
      } else throw new Error("Unknown mint access action.");
    });
    return json({ saved: true });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Could not update mint access." }, 400); }
}

export const GET = withAbuseProtection("GET items/[id]/mint-access", "read", handleGET);
export const POST = withAbuseProtection("POST items/[id]/mint-access", "transaction", handlePOST);
