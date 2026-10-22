import { protectAccount, withAbuseProtection } from "@/lib/abuseProtection";
import { NextRequest, NextResponse } from "next/server";
import { getAddress, parseAbi, parseEventLogs, verifyMessage, zeroAddress, type Address, type Hash, type TransactionReceipt } from "viem";
import { arcChain } from "@/lib/arcConfig";
import { getCreatorSession } from "@/lib/creatorSession";
import { deploymentClient } from "@/lib/deploymentVerification";
import { prisma } from "@/lib/prisma";
import { factoryAbi, protocol } from "@/lib/protocol";
import { limitedJson } from "@/lib/requestBody";
import { awardTesterMilestone, ensureTesterProfile, getTesterEntry } from "@/lib/testerLeaderboard";
import { isTesterMilestoneKind, testerActivityMessage, type TesterMilestoneKind } from "@/lib/testerPoints";
import { sameOrigin } from "@/lib/walletAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const mint721Abi = parseAbi(["event Minted(address indexed to,uint256 quantity,uint256 firstTokenId,uint256 totalPaid)"]);
const mint1155Abi = parseAbi(["event Minted(address indexed to,uint256 quantity,uint256 totalPaid)"]);
const artAbi = parseAbi(["event ArtPurchased(uint256 indexed listingId,address indexed buyer,uint256 price)"]);
const auctionEvents = parseAbi([
  "event BidPlaced(uint256 indexed auctionId,address indexed bidder,uint256 amount)",
  "event RewardJoined(uint256 indexed roundId,address indexed participant,uint32 position)",
  "event RewardClaimed(uint256 indexed roundId,address indexed participant,address indexed receiver,uint256 amount)",
]);
const matches = (first: string | null | undefined, second: string | null | undefined) => !!first && !!second && first.toLowerCase() === second.toLowerCase();

async function inferMilestone(receipt: TransactionReceipt): Promise<TesterMilestoneKind | null> {
  const ownLogs = (address: string) => receipt.logs.filter((log) => matches(log.address, address));
  if (protocol.factory && matches(receipt.to, protocol.factory)) {
    const events = parseEventLogs({ abi: factoryAbi, eventName: "CollectionCreated", logs: ownLogs(protocol.factory), strict: true });
    if (events.some(({ args }) => matches(args.creator, receipt.from) && !matches(args.collection, zeroAddress))) return "DEPLOY_COLLECTION";
  }
  if (protocol.artMarket && matches(receipt.to, protocol.artMarket)) {
    const events = parseEventLogs({ abi: artAbi, eventName: "ArtPurchased", logs: ownLogs(protocol.artMarket), strict: true });
    if (events.some(({ args }) => matches(args.buyer, receipt.from) && args.price > BigInt(0))) return "BUY_ART";
  }
  if (protocol.auctions && matches(receipt.to, protocol.auctions)) {
    const events = parseEventLogs({ abi: auctionEvents, logs: ownLogs(protocol.auctions), strict: true });
    for (const event of events) {
      if (event.eventName === "BidPlaced" && matches(event.args.bidder, receipt.from) && event.args.amount > BigInt(0)) return "PLACE_BID";
      if (event.eventName === "RewardJoined" && matches(event.args.participant, receipt.from) && event.args.position > 0) return "JOIN_REWARD";
      if (event.eventName === "RewardClaimed" && matches(event.args.participant, receipt.from) && event.args.amount > BigInt(0)) return "CLAIM_REWARD";
    }
  }
  if (!protocol.factory || !receipt.to) return null;
  const collection = await prisma.item.findFirst({
    where: { itemType: "NFT", contractAddress: { in: [receipt.to, receipt.to.toLowerCase(), getAddress(receipt.to)] } },
    select: { contractAddress: true, deploymentFactory: true },
  });
  if (!collection?.contractAddress) return null;
  const logs = ownLogs(collection.contractAddress);
  const mint721 = parseEventLogs({ abi: mint721Abi, eventName: "Minted", logs, strict: true });
  const mint1155 = parseEventLogs({ abi: mint1155Abi, eventName: "Minted", logs, strict: true });
  if (![...mint721, ...mint1155].some(({ args }) => matches(args.to, receipt.from) && args.quantity > BigInt(0))) return null;
  const creator = await deploymentClient.readContract({ address: (collection.deploymentFactory || protocol.factory) as Address, abi: factoryAbi, functionName: "collectionCreator", args: [receipt.to] });
  return creator !== zeroAddress ? "MINT_NFT" : null;
}

async function handlePOST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers });
  try {
    const session = await getCreatorSession(request);
    if (!session) return NextResponse.json({ error: "Sign in to record your tester activity." }, { status: 401, headers });
  const limited = await protectAccount("transaction", session.userId, "tester/activity", request);
  if (limited) return limited;
    let body;
    try { body = await limitedJson(request, 4096); } catch { return NextResponse.json({ error: "Provide a valid activity request." }, { status: 400, headers }); }
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Provide a transaction hash." }, { status: 400, headers });
    const { txHash, kind, walletSignature } = body as { txHash?: unknown; kind?: unknown; walletSignature?: unknown };
    if (typeof txHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(txHash) ||
        (kind !== undefined && (!isTesterMilestoneKind(kind) || kind === "SIGN_IN" || kind === "APPROVED_CREATOR"))) {
      return NextResponse.json({ error: "Provide a valid Arc Testnet transaction and activity type." }, { status: 400, headers });
    }
    if (!protocol.isTestnet || arcChain.id !== 5042002 || (!protocol.factory && !protocol.artMarket && !protocol.auctions)) {
      return NextResponse.json({ error: "Onchain tester milestones are not configured for Arc Testnet yet." }, { status: 503, headers });
    }
    if (session.authMethod === "EMAIL" && (typeof walletSignature !== "string" || !/^0x(?:[a-fA-F0-9]{128}|[a-fA-F0-9]{130})$/.test(walletSignature))) {
      return NextResponse.json({ error: "Sign a message with the transaction wallet to credit this email account.", code: "WALLET_PROOF_REQUIRED" }, { status: 403, headers });
    }
    const hash = txHash.toLowerCase() as Hash;
    if (await deploymentClient.getChainId() !== 5042002) return NextResponse.json({ error: "The activity verifier must use Arc Testnet." }, { status: 503, headers });
    const receipt = await deploymentClient.getTransactionReceipt({ hash });
    if (receipt.status !== "success") return NextResponse.json({ error: "Only a successful, confirmed transaction can earn points." }, { status: 400, headers });
    if (session.authMethod === "WALLET") {
      if (!matches(session.walletAddress, receipt.from)) return NextResponse.json({ error: "This transaction belongs to a different wallet." }, { status: 403, headers });
    } else if (session.authMethod === "PRIVY") {
      if (!session.walletAddresses?.some((address) => matches(address, receipt.from))) {
        return NextResponse.json({ error: "This transaction belongs to a wallet that is not linked to your account." }, { status: 403, headers });
      }
    } else {
      let verified = false;
      try { verified = await verifyMessage({ address: receipt.from, message: testerActivityMessage(session.userId, hash), signature: walletSignature as Hash }); } catch { /* Invalid proof is a forbidden claim. */ }
      if (!verified) return NextResponse.json({ error: "The signature must come from the wallet that made this transaction." }, { status: 403, headers });
    }
    const milestone = await inferMilestone(receipt);
    if (!milestone) return NextResponse.json({ recorded: false, reason: "This transaction does not complete a supported Artiq tester milestone." }, { headers });
    if (kind !== undefined && kind !== milestone) return NextResponse.json({ error: "The transaction does not match that tester activity." }, { status: 400, headers });
    const awarded = await prisma.$transaction(async (tx) => {
      const used = await tx.testerMilestone.findUnique({ where: { chainId_txHash: { chainId: 5042002, txHash: hash } }, select: { profile: { select: { userId: true } } } });
      if (used && used.profile.userId !== session.userId) throw new Error("TRANSACTION_ALREADY_CREDITED");
      await ensureTesterProfile(tx, session.userId);
      return awardTesterMilestone(tx, session.userId, milestone, { chainId: 5042002, txHash: hash });
    });
    return NextResponse.json({ recorded: awarded.awarded, kind: milestone, ...(awarded.awarded ? {} : { reason: "You already earned this milestone. Each task scores once." }), tester: await getTesterEntry(session.userId) }, { headers });
  } catch (error) {
    if (error instanceof Error && (error.message === "TRANSACTION_ALREADY_CREDITED" || ("code" in error && error.code === "P2002"))) {
      return NextResponse.json({ error: "This transaction has already been credited to a tester account." }, { status: 409, headers });
    }
    return NextResponse.json({ error: "The activity could not be verified on Arc. Wait for confirmation and try again." }, { status: 503, headers });
  }
}

export const POST = withAbuseProtection("POST tester/activity", "transaction", handlePOST);
