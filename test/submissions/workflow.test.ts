import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";

const directory = mkdtempSync(join(tmpdir(), "artiq-submissions-"));
process.env.DATABASE_URL = `file:${join(directory, "test.db")}`;
process.env.ARTIQ_AI_PIXEL_SCREENING = "false";
const owner = "0x1111111111111111111111111111111111111111";
const reviewer = "0x2222222222222222222222222222222222222222";
const reviewerEmail = "reviewer@example.com";
const other = "0x3333333333333333333333333333333333333333";
process.env.ARTIQ_ADMIN_WALLETS = reviewer;
process.env.ARTIQ_ADMIN_EMAILS = reviewerEmail;
delete process.env.NEXT_PUBLIC_PRIVY_APP_ID;
delete process.env.PRIVY_APP_ID;
const origin = "http://localhost:3000";
let db: (typeof import("../../lib/prisma"))["prisma"];
let submissions: typeof import("../../app/api/submissions/route");
let review: typeof import("../../app/api/admin/submissions/[id]/route");
let catalog: typeof import("../../app/api/items/route");
let uploads: typeof import("../../app/api/uploads/route");
let imageRoute: typeof import("../../app/api/uploads/[id]/route");
let adminQueue: typeof import("../../app/api/admin/submissions/route");
let itemStatus: typeof import("../../app/api/items/[id]/status/route");
let ownerCookie: string;
let reviewerCookie: string;
let reviewerId: string;
let otherCookie: string;

async function cookie(walletAddress: string) {
  const token = randomBytes(32).toString("hex");
  await db.walletSession.create({ data: { walletAddress, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 10 * 60_000) } });
  return `artiq_wallet_session=${token}`;
}
async function emailReviewerCookie() {
  const user = await db.user.create({ data: { email: reviewerEmail, emailVerifiedAt: new Date() } });
  reviewerId = user.id;
  const token = randomBytes(32).toString("hex");
  await db.emailSession.create({ data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 10 * 60_000) } });
  return `artiq_email_session=${token}`;
}
function request(path: string, method = "GET", body?: unknown, session?: string, requestOrigin = origin) {
  return new NextRequest(`${origin}${path}`, { method, headers: {
    ...(method !== "GET" ? { Origin: requestOrigin, "Content-Type": "application/json" } : {}),
    ...(session ? { Cookie: session, ...(session === reviewerCookie ? { "X-Artiq-Account-ID": reviewerId } : { "X-Wallet-Address": session === ownerCookie ? owner : other }) } : {}),
  }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
const application = { itemType: "NFT", creationMethod: "AI_GENERATED", creatorName: "Test creator", contactEmail: "creator@example.com", title: "Study No. 1", description: "An AI-generated NFT collection.", imageUrl: "https://example.com/art.png", priceUsdc: "25.5", maxSupply: 100 };

before(async () => {
  writeFileSync(join(directory, "test.db"), "");
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push"], { env: process.env, stdio: "pipe" });
  ({ prisma: db } = await import("../../lib/prisma"));
  submissions = await import("../../app/api/submissions/route");
  review = await import("../../app/api/admin/submissions/[id]/route");
  catalog = await import("../../app/api/items/route");
  uploads = await import("../../app/api/uploads/route");
  imageRoute = await import("../../app/api/uploads/[id]/route");
  adminQueue = await import("../../app/api/admin/submissions/route");
  itemStatus = await import("../../app/api/items/[id]/status/route");
  ownerCookie = await cookie(owner); reviewerCookie = await emailReviewerCookie(); otherCookie = await cookie(other);
});
after(async () => { await db?.$disconnect(); rmSync(directory, { recursive: true, force: true }); });

test("a folder series stays private until review and publishes distinct ordered token images", async () => {
  const images = [];
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWOwr9jyHwAE0AJrq3udBQAAAABJRU5ErkJggg==", "base64");
  for (let index = 1; index <= 3; index++) {
    const form = new FormData(); form.set("file", new File([png], `${index}.png`, { type: "image/png" })); form.set("itemType", "NFT");
    const uploaded = await uploads.POST(new NextRequest(`${origin}/api/uploads`, { method: "POST", headers: { Origin: origin, Cookie: ownerCookie, "X-Wallet-Address": owner }, body: form }));
    assert.equal(uploaded.status, 201);
    images.push({ imageUrl: (await uploaded.json()).url as string, filename: `${index}.png` });
  }
  const body = { ...application, maxSupply: 3, images, imageUrl: images[0].imageUrl };
  assert.equal((await submissions.POST(request("/api/submissions", "POST", body, otherCookie))).status, 400);
  const created = await submissions.POST(request("/api/submissions", "POST", body, ownerCookie));
  assert.equal(created.status, 201); const { submission } = await created.json();
  assert.equal(submission.imageCount, 3);
  const finalImageId = images[2].imageUrl.split("/").pop()!;
  assert.equal((await imageRoute.GET(request(images[2].imageUrl), { params: Promise.resolve({ id: finalImageId }) })).status, 404);
  const queue = await adminQueue.GET(request("/api/admin/submissions", "GET", undefined, reviewerCookie));
  const queued = (await queue.json()).submissions.find((entry: { id: string }) => entry.id === submission.id);
  assert.deepEqual(queued.collectionImages.map((image: { filename: string }) => image.filename), ["1.png", "2.png", "3.png"]);
  const result = await review.PATCH(request("/api/admin/submissions/review", "PATCH", { decision: "APPROVED" }, reviewerCookie), { params: Promise.resolve({ id: submission.id }) });
  assert.equal(result.status, 200); const itemId = (await result.json()).submission.itemId;
  const published = await imageRoute.GET(request(images[2].imageUrl), { params: Promise.resolve({ id: finalImageId }) });
  assert.equal(published.status, 200); assert.match(published.headers.get("cache-control")!, /public/);
  const { itemMetadataUri } = await import("../../lib/itemMetadata");
  assert.match(itemMetadataUri(await db.item.findUniqueOrThrow({ where: { id: itemId } })), /\/metadata\/$/);
  const tokenMetadata = await import("../../app/api/items/[id]/metadata/[tokenId]/route");
  for (let index = 1; index <= 3; index++) {
    const metadata = await tokenMetadata.GET(request(`/api/items/${itemId}/metadata/${index}`), { params: Promise.resolve({ id: itemId, tokenId: String(index) }) });
    assert.equal(metadata.status, 200); const json = await metadata.json();
    assert.equal(new URL(json.image).pathname, images[index - 1].imageUrl); assert.equal(json.name, `${application.title} #${index}`);
  }
  for (const tokenId of ["0", "4", "-1", "foo"]) assert.equal((await tokenMetadata.GET(request("/metadata"), { params: Promise.resolve({ id: itemId, tokenId }) })).status, 404);
  // Remove this fixture so later legacy count assertions keep their original scope.
  await db.collectionImage.deleteMany({ where: { OR: [{ itemId }, { submissionId: submission.id }] } });
  await db.submission.delete({ where: { id: submission.id } }); await db.item.delete({ where: { id: itemId } });
});

test("watchlists are private, account-bound and idempotent; creator pages expose published work only", async () => {
  const list = await import("../../app/api/watchlist/route");
  const toggle = await import("../../app/api/watchlist/[id]/route");
  const profile = await import("../../app/api/creators/[id]/route");
  const creator = await db.user.findUniqueOrThrow({ where: { walletAddress: owner } });
  await db.user.update({ where: { id: creator.id }, data: { bio: "Public artist biography", email: "private-contact@example.com" } });
  const item = await db.item.create({ data: { creatorId: creator.id, title: "Watchlist fixture", itemType: "NFT", mintPriceUsdc: 5 } });
  const params = { params: Promise.resolve({ id: item.id }) };
  assert.equal((await list.GET(request("/api/watchlist"))).status, 401);
  assert.equal((await toggle.PUT(request("/api/watchlist/x", "PUT"), params)).status, 401);
  assert.equal((await toggle.PUT(request("/api/watchlist/x", "PUT", undefined, ownerCookie, "https://evil.example"), params)).status, 403);
  const mismatch = request("/api/watchlist/x", "PUT", undefined, ownerCookie); mismatch.headers.set("X-Wallet-Address", other);
  assert.equal((await toggle.PUT(mismatch, params)).status, 401);
  assert.equal((await toggle.PUT(request("/api/watchlist/missing", "PUT", undefined, ownerCookie), { params: Promise.resolve({ id: "missing" }) })).status, 404);
  for (let index = 0; index < 2; index++) assert.equal((await toggle.PUT(request("/api/watchlist/x", "PUT", { userId: "spoofed" }, ownerCookie), params)).status, 200);
  assert.equal(await db.watchlistEntry.count({ where: { itemId: item.id } }), 1);
  const saved = await list.GET(request("/api/watchlist", "GET", undefined, ownerCookie));
  assert.equal(saved.headers.get("cache-control"), "private, no-store");
  const body = await saved.json(); assert.deepEqual(body.ids, [item.id]);
  assert.ok(!JSON.stringify(body).includes("private-contact@example.com"));
  assert.deepEqual((await (await list.GET(request(`/api/watchlist?userId=${creator.id}`, "GET", undefined, otherCookie))).json()).ids, []);
  assert.equal((await toggle.PUT(request("/api/watchlist/x", "PUT", undefined, otherCookie), params)).status, 200);
  for (let index = 0; index < 2; index++) assert.equal((await toggle.DELETE(request("/api/watchlist/x", "DELETE", undefined, ownerCookie), params)).status, 200);
  assert.equal(await db.watchlistEntry.count({ where: { itemId: item.id } }), 1, "removal never affects another account");
  const response = await profile.GET(request(`/api/creators/${creator.id}`), { params: Promise.resolve({ id: creator.id }) });
  assert.equal(response.status, 200); const publicCreator = (await response.json()).creator;
  assert.equal(publicCreator.bio, "Public artist biography");
  assert.ok(publicCreator.items.some((entry: { id: string }) => entry.id === item.id));
  assert.equal(publicCreator.email, undefined); assert.equal(publicCreator.submissions, undefined);
  assert.equal(publicCreator.items[0].creator.email, undefined);
  const unpublished = await db.user.create({ data: { email: "not-public@example.com" } });
  assert.equal((await profile.GET(request("/creator"), { params: Promise.resolve({ id: unpublished.id }) })).status, 404);
  // Restore fixtures for the original catalog assertions that follow.
  await db.watchlistEntry.deleteMany({ where: { itemId: item.id } }); await db.item.delete({ where: { id: item.id } });
});

test("submission authentication, AI policy, privacy, approval, rejection, and image workflow", async () => {
  assert.equal((await submissions.POST(request("/api/submissions", "POST", application))).status, 401);
  assert.equal((await submissions.POST(request("/api/submissions", "POST", application, ownerCookie, "https://evil.example"))).status, 403);
  const changedWallet = request("/api/submissions", "POST", application, ownerCookie);
  changedWallet.headers.set("x-wallet-address", other);
  assert.equal((await submissions.POST(changedWallet)).status, 401, "cross-tab session changes cannot misattribute applications");
  assert.equal((await submissions.POST(request("/api/submissions", "POST", { ...application, priceUsdc: "-2" }, ownerCookie))).status, 400);
  assert.equal((await submissions.POST(request("/api/submissions", "POST", { ...application, imageUrl: "javascript:alert(1)" }, ownerCookie))).status, 400);
  assert.equal((await catalog.POST(request("/api/items", "POST"))).status, 405, "legacy creation cannot bypass review");

  const created = await submissions.POST(request("/api/submissions", "POST", { ...application, creatorWalletAddress: other }, ownerCookie));
  assert.equal(created.status, 201);
  const { submission } = await created.json();
  assert.equal(submission.status, "PENDING");
  assert.equal(submission.creationMethod, "AI_GENERATED", "AI-generated NFTs are accepted");
  assert.equal(await db.item.count(), 0, "pending applications are not public listings");
  const ownerRecord = await db.user.findUniqueOrThrow({ where: { id: submission.creatorId } });
  assert.equal(ownerRecord.walletAddress, owner, "a spoofed creator address is ignored");
  const privateList = await submissions.GET(request("/api/submissions", "GET", undefined, otherCookie));
  assert.deepEqual((await privateList.json()).submissions, [], "other wallets cannot view an application");
  assert.equal((await adminQueue.GET(request("/api/admin/submissions", "GET", undefined, ownerCookie))).status, 403);
  assert.equal((await review.PATCH(request("/api/admin/submissions/x", "PATCH", { decision: "APPROVED" }, ownerCookie), { params: Promise.resolve({ id: submission.id }) })).status, 403);

  const approved = await review.PATCH(request("/api/admin/submissions/x", "PATCH", { decision: "APPROVED" }, reviewerCookie), { params: Promise.resolve({ id: submission.id }) });
  assert.equal(approved.status, 200);
  const approvedSubmission = (await approved.json()).submission;
  assert.equal(approvedSubmission.status, "APPROVED");
  assert.equal((await db.submission.findUniqueOrThrow({ where: { id: submission.id } })).reviewedBy, `user:${reviewerId}`);
  assert.ok(approvedSubmission.itemId);
  const publicCatalog = await catalog.GET(request("/api/items?itemType=NFT"));
  const items = (await publicCatalog.json()).items;
  assert.equal(items.length, 1);
  assert.equal(items[0].title, application.title);
  assert.equal(items[0].creationMethod, "AI_GENERATED", "NFT publication preserves the declared creation method");
  assert.equal(items[0].status, "UPCOMING", "approval does not claim an NFT is minting");
  assert.equal(items[0].contactEmail, undefined, "private contact information is not published");
  assert.equal((await review.PATCH(request("/api/admin/submissions/x", "PATCH", { decision: "APPROVED" }, reviewerCookie), { params: Promise.resolve({ id: submission.id }) })).status, 409);
  assert.equal(await db.item.count(), 1, "repeat approvals cannot create duplicate items");

  const form = new FormData();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWOwr9jyHwAE0AJrq3udBQAAAABJRU5ErkJggg==", "base64");
  form.set("file", new File([png], "art.png", { type: "image/png" }));
  const imageRequest = new NextRequest(`${origin}/api/uploads`, { method: "POST", headers: { Origin: origin, Cookie: ownerCookie, "X-Wallet-Address": owner }, body: form });
  const uploaded = await uploads.POST(imageRequest);
  assert.equal(uploaded.status, 201);
  const uploadResult = await uploaded.json();
  const imageUrl = uploadResult.url;
  assert.equal(uploadResult.screening.status, "REVIEW_REQUIRED", "an image without AI metadata still requires human review");
  assert.notEqual(uploadResult.screening.provider?.status, "COMPLETED", "metadata screening does not claim pixel analysis");
  assert.equal(uploadResult.screening.provider?.score, undefined, "metadata screening never fabricates a pixel score");
  assert.equal((await imageRoute.GET(request(imageUrl), { params: Promise.resolve({ id: imageUrl.split("/").pop() }) })).status, 404, "pending uploads are private");
  const image = await imageRoute.GET(request(imageUrl, "GET", undefined, ownerCookie), { params: Promise.resolve({ id: imageUrl.split("/").pop() }) });
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.equal(image.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  assert.equal((await submissions.POST(request("/api/submissions", "POST", { ...application, imageUrl }, otherCookie))).status, 400, "wallets cannot claim someone else's upload");

  const artApplication = {
    ...application,
    itemType: "WEB2_ART",
    creationMethod: "HUMAN",
    humanMadeDeclaration: true,
    creationProcess: "I painted this study by hand using acrylic paint on cotton canvas, with pencil sketches and progress photos documenting each stage.",
    description: "A handmade study in color and texture.",
    category: "PAINTING",
    title: "Physical painting",
    imageUrl,
  };
  for (const [label, body] of [
    ["missing human-made declaration", { ...artApplication, humanMadeDeclaration: undefined }],
    ["AI-generated ART BAZZAR", { ...artApplication, creationMethod: "AI_GENERATED" }],
    ["AI-assisted ART BAZZAR", { ...artApplication, creationMethod: "AI_ASSISTED" }],
    ["insufficient creation process", { ...artApplication, creationProcess: "Painted by hand." }],
    ["external Art image URL", { ...artApplication, imageUrl: "https://example.com/art.png" }],
  ] as const) {
    const response = await submissions.POST(request("/api/submissions", "POST", body, ownerCookie));
    assert.equal(response.status, 400, label);
  }
  assert.equal(await db.submission.count(), 1, "invalid Art applications do not create review-queue entries");

  const spoofedScreening = { version: 1, status: "VERIFIED_HUMAN", signals: [], summary: "Client claims verified human", provider: { name: "sightengine", status: "COMPLETED", score: 0.99 } };
  const art = await submissions.POST(request("/api/submissions", "POST", { ...artApplication, screening: spoofedScreening }, ownerCookie));
  assert.equal(art.status, 201);
  const submittedArt = (await art.json()).submission;
  const artId = submittedArt.id;
  assert.equal(submittedArt.creationMethod, "HUMAN");
  assert.equal(submittedArt.humanMadeDeclaration, true);
  assert.equal(submittedArt.creationProcess, artApplication.creationProcess);
  assert.equal(submittedArt.screening.status, "REVIEW_REQUIRED", "client screening claims are replaced with a server report");
  assert.equal(submittedArt.screening.provider.status, "NOT_CONFIGURED");
  assert.equal(submittedArt.screening.provider.score, undefined, "a spoofed pixel score is never persisted");
  assert.notEqual(submittedArt.screening.summary, spoofedScreening.summary);
  assert.equal((await review.PATCH(request("/api/admin/submissions/x", "PATCH", { decision: "REJECTED" }, reviewerCookie), { params: Promise.resolve({ id: artId }) })).status, 400);
  assert.equal((await review.PATCH(request("/api/admin/submissions/x", "PATCH", { decision: "REJECTED", reviewNote: "Please send a clearer photo." }, reviewerCookie), { params: Promise.resolve({ id: artId }) })).status, 200);
  assert.equal(await db.item.count(), 1, "rejection never publishes an item");

  const legacyArt = await db.submission.create({ data: {
    creatorId: ownerRecord.id, itemType: "WEB2_ART", creatorName: "Legacy creator", title: "Legacy unverified Art",
    description: "Submitted before authorship evidence was required.", imageUrl: "https://example.com/legacy.png", priceUsdc: 5, category: "PAINTING",
  } });
  assert.equal((await review.PATCH(request("/api/admin/submissions/x", "PATCH", {
    decision: "APPROVED", artReviewConfirmed: true, reviewNote: "I reviewed the supplied creation details.",
  }, reviewerCookie), { params: Promise.resolve({ id: legacyArt.id }) })).status, 409, "legacy unverified Art cannot bypass evidence requirements");
  const unchangedLegacy = await db.submission.findUniqueOrThrow({ where: { id: legacyArt.id } });
  assert.equal(unchangedLegacy.status, "PENDING");
  assert.equal(unchangedLegacy.itemId, null);
  assert.equal(unchangedLegacy.reviewedAt, null);

  const physicalArt = await submissions.POST(request("/api/submissions", "POST", { ...artApplication, category: "RUG", title: "Woven study" }, ownerCookie));
  assert.equal(physicalArt.status, 201);
  const physicalId = (await physicalArt.json()).submission.id;
  const approvalNote = "Reviewed the hand-making process and supporting authorship details.";
  for (const [label, body] of [
    ["missing confirmation and note", { decision: "APPROVED" }],
    ["confirmation without a note", { decision: "APPROVED", artReviewConfirmed: true }],
    ["note without confirmation", { decision: "APPROVED", reviewNote: approvalNote }],
    ["short approval note", { decision: "APPROVED", artReviewConfirmed: true, reviewNote: "Too short." }],
  ] as const) {
    assert.equal((await review.PATCH(request("/api/admin/submissions/x", "PATCH", body, reviewerCookie), { params: Promise.resolve({ id: physicalId }) })).status, 400, label);
  }
  const unchangedArt = await db.submission.findUniqueOrThrow({ where: { id: physicalId } });
  assert.equal(unchangedArt.status, "PENDING", "failed reviews roll back without changing status");
  assert.equal(unchangedArt.reviewedAt, null);
  assert.equal(unchangedArt.itemId, null);
  assert.equal(await db.item.count(), 1, "no item is published before an Art review is complete");
  const artApproval = { decision: "APPROVED", artReviewConfirmed: true, reviewNote: approvalNote };
  const approvedArt = await review.PATCH(request("/api/admin/submissions/x", "PATCH", artApproval, reviewerCookie), { params: Promise.resolve({ id: physicalId }) });
  assert.equal(approvedArt.status, 200);
  assert.equal((await approvedArt.json()).submission.artReviewConfirmed, true);
  const physicalCatalog = await catalog.GET(request("/api/items?itemType=WEB2_ART"));
  const physicalItems = (await physicalCatalog.json()).items;
  assert.equal(physicalItems.length, 1);
  assert.equal(physicalItems[0].category, "RUG");
  assert.equal(physicalItems[0].priceUsdc, 25.5);
  assert.equal(physicalItems[0].creationMethod, "HUMAN");
  assert.equal(physicalItems[0].contactEmail, undefined);
  assert.equal(physicalItems[0].creationProcess, undefined, "private creation evidence is not published");
  assert.equal((await imageRoute.GET(request(imageUrl), { params: Promise.resolve({ id: imageUrl.split("/").pop() }) })).status, 200, "approved artwork images become public");
  assert.equal((await review.PATCH(request("/api/admin/submissions/x", "PATCH", artApproval, reviewerCookie), { params: Promise.resolve({ id: physicalId }) })).status, 409);
  assert.equal(await db.item.count(), 2, "repeat Art approvals cannot duplicate publication");
});

test("NFT types survive private review, filter publicly, and block soulbound resale", async () => {
  const published = new Map<string, string>();
  for (const nftKind of ["COLLECTIBLE", "EDITION", "SOULBOUND", "MEMBERSHIP"] as const) {
    const settings = {
      ...application, title: `${nftKind} study`, nftKind, priceUsdc: "0", symbol: "STUDY", maxPerWallet: 2,
      royaltyBps: nftKind === "SOULBOUND" ? 0 : 500, metadataUri: "ipfs://bafyexample/metadata.json",
      attributes: [{ trait_type: "Palette", value: "Blue" }, { trait_type: "Year", value: 2026 }],
    };
    const created = await submissions.POST(request("/api/submissions", "POST", settings, ownerCookie));
    assert.equal(created.status, 201);
    const { submission } = await created.json();
    assert.equal(submission.nftKind, nftKind);
    const beforeApproval = await catalog.GET(request(`/api/items?itemType=NFT&nftKind=${nftKind}`));
    assert.ok(!(await beforeApproval.json()).items.some((item: { title: string }) => item.title === settings.title));
    const approved = await review.PATCH(request("/api/admin/submissions/x", "PATCH", { decision: "APPROVED" }, reviewerCookie), { params: Promise.resolve({ id: submission.id }) });
    assert.equal(approved.status, 200);
    const itemId = (await approved.json()).submission.itemId;
    published.set(nftKind, itemId);
    const response = await catalog.GET(request(`/api/items?itemType=NFT&nftKind=${nftKind}`));
    assert.equal(response.status, 200);
    const publicItem = (await response.json()).items.find((item: { id: string }) => item.id === itemId);
    assert.ok(publicItem);
    for (const key of ["nftKind", "symbol", "maxPerWallet", "royaltyBps", "metadataUri", "attributes"] as const) assert.deepEqual(publicItem[key], settings[key]);
    assert.equal(publicItem.mintPriceUsdc, 0);
    assert.equal(publicItem.status, "UPCOMING", "review approval does not simulate contract deployment");
  }
  assert.equal((await catalog.GET(request("/api/items?nftKind=UNKNOWN"))).status, 400);
  assert.equal((await catalog.GET(request("/api/items?itemType=WEB2_ART&nftKind=SOULBOUND"))).status, 400);
  assert.equal((await catalog.GET(request("/api/items?status=INVALID"))).status, 400);
  const soulboundId = published.get("SOULBOUND")!;
  const soulboundResale = await itemStatus.PATCH(request(`/api/items/${soulboundId}/status`, "PATCH", { status: "LISTED" }, ownerCookie), { params: Promise.resolve({ id: soulboundId }) });
  assert.equal(soulboundResale.status, 400);
  assert.match((await soulboundResale.json()).error, /non-transferable/);
  assert.equal((await db.item.findUniqueOrThrow({ where: { id: soulboundId } })).status, "UPCOMING");
  const editionId = published.get("EDITION")!;
  assert.equal((await itemStatus.PATCH(request(`/api/items/${editionId}/status`, "PATCH", { status: "LISTED" }, ownerCookie), { params: Promise.resolve({ id: editionId }) })).status, 200);
});

test("catalog pages stay bounded with tied timestamps, deletions, and newer inserts", async () => {
  const creator = await db.user.create({ data: { username: "Pagination fixture" } });
  const createdAt = new Date("2020-01-01T00:00:00.000Z");
  const wallet = "0x5555555555555555555555555555555555555555";
  await db.user.update({ where: { id: creator.id }, data: { walletAddress: wallet } });
  for (const id of ["page-a", "page-b", "page-c", "page-d", "page-e"]) {
    await db.item.create({ data: { id, creatorId: creator.id, itemType: "NFT", title: id, createdAt } });
  }
  const path = `/api/items?creator=${wallet}&limit=2`;
  const first = await (await catalog.GET(request(path))).json();
  assert.deepEqual(first.items.map((item: { id: string }) => item.id), ["page-e", "page-d"]);
  await db.item.delete({ where: { id: "page-d" } });
  await db.item.create({ data: { id: "page-new", creatorId: creator.id, itemType: "NFT", title: "Newer" } });
  const second = await (await catalog.GET(request(`${path}&cursor=${first.nextCursor}`))).json();
  assert.deepEqual(second.items.map((item: { id: string }) => item.id), ["page-c", "page-b"]);
  const third = await (await catalog.GET(request(`${path}&cursor=${second.nextCursor}`))).json();
  assert.deepEqual(third.items.map((item: { id: string }) => item.id), ["page-a"]);
  assert.equal(third.nextCursor, null);
  for (const query of ["limit=0", "limit=101", "cursor=invalid"]) {
    assert.equal((await catalog.GET(request(`/api/items?${query}`))).status, 400);
  }
});

test("landing trending drops select four published NFTs and advance at the next hour", async () => {
  const { GET } = await import("../../app/api/trending/route");
  const originalNow = Date.now;
  const creator = await db.user.create({ data: { username: "Hourly trending fixture" } });
  try {
    Date.now = () => Date.parse("2030-01-01T12:30:00.000Z");
    for (let index = 0; index < 5; index++) {
      await db.item.create({ data: { id: `trending-${index}`, title: `Published ${index}`, itemType: "NFT", creatorId: creator.id, createdAt: new Date(`2030-01-01T11:5${index}:00.000Z`) } });
    }
    await db.item.create({ data: { id: "trending-next", title: "Published this hour", itemType: "NFT", creatorId: creator.id, createdAt: new Date("2030-01-01T12:10:00.000Z") } });
    await db.item.create({ data: { id: "trending-art", title: "Physical art", itemType: "WEB2_ART", creatorId: creator.id, createdAt: new Date("2030-01-01T11:59:00.000Z") } });
    const response = await GET(request("/api/trending"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "public, max-age=0, s-maxage=1800");
    const first = await response.json();
    assert.deepEqual(first.items.map((item: { id: string }) => item.id), ["trending-4", "trending-3", "trending-2", "trending-1"]);
    assert.equal(first.nextAt, "2030-01-01T13:00:00.000Z");
    assert.deepEqual(Object.keys(first.items[0]).sort(), ["id", "imageUrl", "status", "title"]);
    Date.now = () => Date.parse("2030-01-01T12:59:59.000Z");
    assert.deepEqual((await (await GET(request("/api/trending"))).json()).items, first.items);
    Date.now = () => Date.parse("2030-01-01T13:00:00.000Z");
    const next = await (await GET(request("/api/trending"))).json();
    assert.deepEqual(next.items.map((item: { id: string }) => item.id), ["trending-next", "trending-4", "trending-3", "trending-2"]);
    assert.equal(next.nextAt, "2030-01-01T14:00:00.000Z");
    await db.item.deleteMany({ where: { creatorId: creator.id } });
    Date.now = () => Date.parse("2000-01-01T00:00:00.000Z");
    assert.deepEqual((await (await GET(request("/api/trending"))).json()).items, []);
  } finally {
    Date.now = originalNow;
    await db.item.deleteMany({ where: { creatorId: creator.id } });
    await db.user.delete({ where: { id: creator.id } });
  }
});
