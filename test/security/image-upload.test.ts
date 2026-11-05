import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { ImageValidationError, prepareUploadedImage, publicImageBytes } from "../../lib/imageUpload";
import { savedImageScreening } from "../../lib/imageScreening";
import { screenArtwork } from "../../lib/artworkScreening";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWOwr9jyHwAE0AJrq3udBQAAAABJRU5ErkJggg==", "base64");
function pngChunk(type: string, payload: Buffer) {
  const body = Buffer.concat([Buffer.from(type), payload]); let crc = 0xffffffff;
  for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
  const length = Buffer.alloc(4); length.writeUInt32BE(payload.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, body, checksum]);
}

test("uploaded JPEG metadata is stripped while orientation is applied", async () => {
  const original = await sharp({ create: { width: 2, height: 3, channels: 3, background: "red" } })
    .withExif({ IFD0: { Artist: "Private artist identity" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "6/1 30/1 0/1" } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  assert.ok((await sharp(original).metadata()).exif);
  const prepared = await prepareUploadedImage(original, "image/jpeg");
  const metadata = await sharp(prepared.data).metadata();
  assert.equal(metadata.exif, undefined); assert.equal(metadata.xmp, undefined); assert.equal(metadata.iptc, undefined);
  assert.equal(prepared.data.includes(Buffer.from("Private artist identity")), false);
  assert.equal(metadata.orientation, undefined);
  assert.deepEqual([metadata.width, metadata.height], [3, 2]);
  assert.equal(prepared.screening.publicImage.version, 1);
});

test("sanitizing a PNG cannot clear its original generation evidence during later ART screening", async () => {
  const parameters = "Private prompt\nSteps: 20, Sampler: Euler, CFG scale: 7, Seed: 1234";
  const original = Buffer.concat([png.subarray(0, -12), pngChunk("tEXt", Buffer.from(`parameters\0${parameters}`)), png.subarray(-12)]);
  const prepared = await prepareUploadedImage(original, "image/png");
  assert.equal(prepared.data.includes(Buffer.from("Private prompt")), false);
  assert.equal(prepared.screening.status, "FLAGGED");
  assert.ok(prepared.screening.signals.some((signal) => signal.code === "DIFFUSION_PARAMETERS"));
  const previous = process.env.ARTIQ_AI_PIXEL_SCREENING; process.env.ARTIQ_AI_PIXEL_SCREENING = "false";
  try {
    const report = await screenArtwork(prepared.data, prepared.mimeType, savedImageScreening(prepared.screening));
    assert.equal(report.status, "FLAGGED");
    assert.ok(report.signals.some((signal) => signal.code === "DIFFUSION_PARAMETERS"));
    assert.doesNotMatch(JSON.stringify(report), /Private prompt/);
  } finally { if (previous === undefined) delete process.env.ARTIQ_AI_PIXEL_SCREENING; else process.env.ARTIQ_AI_PIXEL_SCREENING = previous; }
});

test("corrupt, spoofed, oversized-dimension and animated uploads are rejected before publication", async () => {
  const hugeHeader = Buffer.from(png.subarray(16, 29)); hugeHeader.writeUInt32BE(8193, 0);
  const huge = Buffer.concat([png.subarray(0, 8), pngChunk("IHDR", hugeHeader), png.subarray(33)]);
  for (const [data, mime] of [[png.subarray(0, 26), "image/png"], [png, "image/jpeg"], [Buffer.from("<svg></svg>"), "image/svg+xml"], [huge, "image/png"]] as const) {
    await assert.rejects(prepareUploadedImage(data, mime), ImageValidationError);
  }
  // A valid animated WebP advertises two pages; it must not silently publish
  // only one frame while implying the complete animation was retained.
  const animated = Buffer.from([...Array.from({ length: 4 }, () => [255, 0, 0]).flat(), ...Array.from({ length: 4 }, () => [0, 0, 255]).flat()]);
  const webp = await sharp(animated, { raw: { width: 2, height: 4, channels: 3, pageHeight: 2 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
  assert.equal((await sharp(webp).metadata()).pages, 2);
  await assert.rejects(prepareUploadedImage(webp, "image/webp"), ImageValidationError);
});

test("legacy image bytes are sanitized even when their DB screening predates the privacy marker", async () => {
  const original = await sharp(png).withExif({ IFD0: { Artist: "Old private artist" } }).png().toBuffer();
  const publicBytes = await publicImageBytes(original, "image/png", null);
  assert.equal((await sharp(publicBytes).metadata()).exif, undefined);
  const prepared = await prepareUploadedImage(png, "image/png");
  assert.deepEqual(await publicImageBytes(prepared.data, "image/png", prepared.screening), prepared.data);
  const changedBytes = await sharp(png).withExif({ IFD0: { Artist: "Changed private artist" } }).png().toBuffer();
  assert.equal((await sharp(await publicImageBytes(changedBytes, "image/png", prepared.screening)).metadata()).exif, undefined, "a marker for different bytes cannot skip sanitization");
});
