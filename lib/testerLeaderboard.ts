import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeWalletAddress } from "@/lib/walletAuth";
import {
  TESTER_POINT_RULES, isTesterMilestoneKind, testerMilestonePoints,
  type TesterEntry, type TesterLeaderboardResponse, type TesterMilestoneKind,
} from "@/lib/testerPoints";

type Transaction = Prisma.TransactionClient;
type AwardOptions = { txHash?: string; chainId?: number; now?: Date };

/** Called inside the successful sign-in transaction, after the proof is consumed. */
export async function ensureTesterProfile(tx: Transaction, userId: string, options: { now?: Date; joinedAt?: Date } = {}) {
  const now = options.now ?? new Date();
  const profile = await tx.testerProfile.upsert({
    where: { userId },
    create: { userId, joinedAt: options.joinedAt ?? now, lastActiveAt: now },
    update: {},
  });
  await tx.testerProfile.updateMany({ where: { id: profile.id, lastActiveAt: { lt: now } }, data: { lastActiveAt: now } });
  await tx.testerMilestone.upsert({
    where: { profileId_kind: { profileId: profile.id, kind: "SIGN_IN" } },
    create: { profileId: profile.id, kind: "SIGN_IN", createdAt: options.joinedAt ?? now }, update: {},
  });
  return profile;
}

/** No client supplied score is accepted. A milestone can be earned once per account. */
export async function awardTesterMilestone(tx: Transaction, userId: string, kind: TesterMilestoneKind, options: AwardOptions = {}) {
  if (!isTesterMilestoneKind(kind)) throw new Error("INVALID_TESTER_MILESTONE");
  const profile = await tx.testerProfile.findUnique({ where: { userId } });
  // Approval of an old seeded creator alone must not count as a tester sign-in.
  if (!profile) return { awarded: false, profileId: null };
  const existing = await tx.testerMilestone.findUnique({ where: { profileId_kind: { profileId: profile.id, kind } } });
  if (existing) return { awarded: false, profileId: profile.id };
  await tx.testerMilestone.create({ data: {
    profileId: profile.id, kind, createdAt: options.now ?? new Date(),
    ...(options.txHash ? { txHash: options.txHash.toLowerCase(), chainId: options.chainId } : {}),
  } });
  const activeAt = options.now ?? new Date();
  await tx.testerProfile.updateMany({ where: { id: profile.id, lastActiveAt: { lt: activeAt } }, data: { lastActiveAt: activeAt } });
  return { awarded: true, profileId: profile.id };
}

// SQL computes scores from the fixed rules; the database never accepts arbitrary points.
const weightedScore = Prisma.sql`COALESCE(SUM(CASE m."kind" ${Prisma.join(TESTER_POINT_RULES.map((rule) => Prisma.sql`WHEN ${rule.kind} THEN ${rule.points}`), " ")} ELSE 0 END), 0)`;
const rankedTesters = Prisma.sql`
  WITH scores AS (
    SELECT p."id", p."userId", p."joinedAt", ${weightedScore} AS points
    FROM "TesterProfile" p LEFT JOIN "TesterMilestone" m ON m."profileId" = p."id"
    GROUP BY p."id"
  ), ranked AS (
    SELECT "id", "userId", points,
      ROW_NUMBER() OVER (ORDER BY points DESC, "joinedAt" ASC, "id" ASC) AS rank
    FROM scores
  )`;

type RankedTester = { id: string; points: bigint | number; rank: bigint | number };

async function publicEntries(ranked: RankedTester[], db: Transaction = prisma): Promise<TesterEntry[]> {
  if (!ranked.length) return [];
  const profiles = await db.testerProfile.findMany({
    where: { id: { in: ranked.map((entry) => entry.id) } },
    select: { id: true, joinedAt: true, lastActiveAt: true, milestones: { select: { kind: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { kind: "asc" }] } },
  });
  return ranked.flatMap((ranking) => {
    const profile = profiles.find((entry) => entry.id === ranking.id);
    if (!profile) return [];
    return [{
      id: profile.id, rank: Number(ranking.rank), displayName: `Tester ${profile.id.slice(-8).toUpperCase()}`,
      points: Number(ranking.points),
      milestones: profile.milestones.flatMap((milestone) => isTesterMilestoneKind(milestone.kind) ? [{ kind: milestone.kind, points: testerMilestonePoints(milestone.kind), earnedAt: milestone.createdAt.toISOString() }] : []),
      joinedAt: profile.joinedAt.toISOString(), lastActiveAt: profile.lastActiveAt.toISOString(),
    }];
  });
}

export async function getTesterLeaderboard(options: { page?: number; pageSize?: number } = {}): Promise<TesterLeaderboardResponse> {
  const page = Number.isInteger(options.page) && Number(options.page) > 0 ? Math.min(Number(options.page), 1_000_000) : 1;
  const pageSize = Number.isInteger(options.pageSize) && Number(options.pageSize) > 0 ? Math.min(Number(options.pageSize), 50) : 20;
  return prisma.$transaction(async (tx) => {
    const [totalUsers, activeTesters7d, milestoneCounts, ranked] = await Promise.all([
      tx.testerProfile.count(),
      tx.testerProfile.count({ where: { lastActiveAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } }),
      tx.testerMilestone.groupBy({ by: ["kind"], _count: { kind: true } }),
      tx.$queryRaw<RankedTester[]>(Prisma.sql`${rankedTesters} SELECT "id", points, rank FROM ranked ORDER BY rank ASC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
    ]);
    const entries = await publicEntries(ranked, tx);
    return {
      stats: { totalUsers, activeTesters7d, totalPoints: milestoneCounts.reduce((sum, count) => sum + testerMilestonePoints(count.kind) * count._count.kind, 0) },
      entries, pagination: { page, pageSize, totalPages: Math.ceil(totalUsers / pageSize), totalEntries: totalUsers },
      rules: TESTER_POINT_RULES,
    };
  });
}

export async function getTesterEntry(userId: string): Promise<TesterEntry | null> {
  return prisma.$transaction(async (tx) => {
    const ranked = await tx.$queryRaw<RankedTester[]>(Prisma.sql`${rankedTesters} SELECT "id", points, rank FROM ranked WHERE "userId" = ${userId} LIMIT 1`);
    return (await publicEntries(ranked, tx))[0] ?? null;
  });
}

/** Explicit, idempotent migration of real verified accounts, never seeded sample users. */
export async function backfillVerifiedTesters() {
  let imported = 0;
  // Older wallet sign-ins persisted their proof before creating a User row.
  // Start with those records so a tester who never applied as a creator is included.
  const sessions = await prisma.walletSession.groupBy({ by: ["walletAddress"], _min: { createdAt: true }, _max: { createdAt: true } });
  const walletProofs = new Map<string, { first: Date; last: Date }>();
  for (const session of sessions) {
    const address = normalizeWalletAddress(session.walletAddress);
    if (!address || !session._min.createdAt || !session._max.createdAt) continue;
    const previous = walletProofs.get(address);
    walletProofs.set(address, {
      first: previous && previous.first < session._min.createdAt ? previous.first : session._min.createdAt,
      last: previous && previous.last > session._max.createdAt ? previous.last : session._max.createdAt,
    });
  }
  for (const [walletAddress] of Array.from(walletProofs.entries())) {
    await prisma.user.upsert({ where: { walletAddress }, create: { walletAddress }, update: {}, select: { id: true } });
  }
  const users = await prisma.user.findMany({
    where: { OR: [{ emailVerifiedAt: { not: null } }, { walletAddress: { not: null } }] },
    select: { id: true, walletAddress: true, emailVerifiedAt: true },
  });
  for (const user of users) {
    const address = normalizeWalletAddress(user.walletAddress);
    const walletProof = address ? walletProofs.get(address) : undefined;
    // Submissions prove the application went through the authenticated API.
    // Seeded marketplace users have no wallet sessions or submissions.
    const submissionProof = user.walletAddress ? await prisma.submission.findFirst({ where: { creatorId: user.id }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }) : null;
    const verifiedAt = user.emailVerifiedAt ?? walletProof?.first ?? submissionProof?.createdAt;
    if (!verifiedAt) continue;
    await prisma.$transaction(async (tx) => {
      const existed = await tx.testerProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
      await ensureTesterProfile(tx, user.id, { joinedAt: verifiedAt, now: user.emailVerifiedAt ?? walletProof?.last ?? verifiedAt });
      const approval = await tx.submission.findFirst({ where: { creatorId: user.id, status: "APPROVED", itemId: { not: null } }, orderBy: { reviewedAt: "asc" }, select: { reviewedAt: true } });
      if (approval) await awardTesterMilestone(tx, user.id, "APPROVED_CREATOR", { now: approval.reviewedAt ?? verifiedAt });
      if (!existed) imported += 1;
    });
  }
  return { imported };
}
