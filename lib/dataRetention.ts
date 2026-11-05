import type { PrismaClient } from "./generated/prisma/client";
import { removeUploadObject } from "./uploadStorage";

const DAY = 24 * 60 * 60 * 1000;
const BATCH = 100;
const SCAN_LIMIT = 5000;
type Database = Pick<PrismaClient, "uploadedImage" | "item" | "submission" | "collectionImage" | "assetAuction" | "privySession" | "emailSession" | "walletSession" | "emailChallenge" | "walletChallenge">;
type Orphan = { id: string; byteSize: number; storageKey: string | null };

async function referencedUploads(db: Database, urls: string[]) {
  const where = { imageUrl: { in: urls } };
  // Retain pending/rejected applications and unpublished auction drafts too.
  const records = await Promise.all([
    db.item.findMany({ where, select: { imageUrl: true } }),
    db.submission.findMany({ where, select: { imageUrl: true } }),
    db.collectionImage.findMany({ where, select: { imageUrl: true } }),
    db.assetAuction.findMany({ where, select: { imageUrl: true } }),
  ]);
  return new Set(records.flat().map((record) => record.imageUrl));
}

export async function planDataRetention(db: Database, now = new Date(), sessionsOnly = false) {
  const cutoff = new Date(now.getTime() - 7 * DAY);
  const orphans: Orphan[] = []; let scanned = 0; let cursor: string | undefined;
  if (!sessionsOnly) while (scanned < SCAN_LIMIT && orphans.length < BATCH) {
    const candidates = await db.uploadedImage.findMany({
      where: { createdAt: { lt: cutoff }, ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true, byteSize: true, storageKey: true }, orderBy: { id: "asc" }, take: BATCH,
    });
    if (!candidates.length) break;
    scanned += candidates.length; cursor = candidates[candidates.length - 1].id;
    const referenced = await referencedUploads(db, candidates.map((image) => `/api/uploads/${image.id}`));
    orphans.push(...candidates.filter((image) => !referenced.has(`/api/uploads/${image.id}`)).slice(0, BATCH - orphans.length));
  }
  const expiredWhere = { expiresAt: { lt: cutoff } };
  const sessions = await Promise.all([
    db.privySession.findMany({ where: expiredWhere, select: { id: true }, take: BATCH }),
    db.emailSession.findMany({ where: expiredWhere, select: { id: true }, take: BATCH }),
    db.walletSession.findMany({ where: expiredWhere, select: { id: true }, take: BATCH }),
    db.emailChallenge.findMany({ where: expiredWhere, select: { id: true }, take: BATCH }),
    db.walletChallenge.findMany({ where: expiredWhere, select: { id: true }, take: BATCH }),
  ]);
  return { cutoff, orphans, sessions, scanned, scanLimitReached: scanned >= SCAN_LIMIT };
}

/** Call with all content writers stopped before deleting orphan upload records. */
export async function applyDataRetention(db: Database, plan: Awaited<ReturnType<typeof planDataRetention>>, writesPaused: boolean) {
  if (plan.orphans.length && !writesPaused) throw new Error("Stop all content writers and pass --writes-paused before removing orphan uploads.");
  const expiredWhere = { expiresAt: { lt: plan.cutoff } };
  const expiredIds = plan.sessions.map((rows) => rows.map((row) => row.id));
  const results = await Promise.all([
    db.privySession.deleteMany({ where: { ...expiredWhere, id: { in: expiredIds[0] } } }),
    db.emailSession.deleteMany({ where: { ...expiredWhere, id: { in: expiredIds[1] } } }),
    db.walletSession.deleteMany({ where: { ...expiredWhere, id: { in: expiredIds[2] } } }),
    db.emailChallenge.deleteMany({ where: { ...expiredWhere, id: { in: expiredIds[3] } } }),
    db.walletChallenge.deleteMany({ where: { ...expiredWhere, id: { in: expiredIds[4] } } }),
  ]);
  let removedUploads = 0;
  for (const orphan of plan.orphans) {
    const current = await db.uploadedImage.findUnique({ where: { id: orphan.id }, select: { id: true, createdAt: true, storageKey: true } });
    if (!current || current.createdAt >= plan.cutoff || (await referencedUploads(db, [`/api/uploads/${orphan.id}`])).size) continue;
    // Remove private storage objects first. If storage is unavailable, retain
    // the DB reference so the next maintenance attempt can retry the same key.
    if (current.storageKey) await removeUploadObject(current.storageKey);
    const removed = await db.uploadedImage.deleteMany({ where: { id: current.id, createdAt: { lt: plan.cutoff } } });
    removedUploads += removed.count;
  }
  return { removedUploads, removedExpiredCredentials: results.reduce((sum, result) => sum + result.count, 0) };
}
