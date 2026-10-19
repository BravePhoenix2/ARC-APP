import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { screenImage } from "../../lib/imageScreening";

const parameters = "A still life\nSteps: 25, Sampler: Euler a, CFG scale: 7, Seed: 12345";
const workflow = JSON.stringify({ "1": { class_type: "KSampler" }, "2": { class_type: "CLIPTextEncode", inputs: { text: "private prompt" } } });
const source = "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";
const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" Iptc4xmpExt:DigitalSourceType="${source}"/></rdf:RDF></x:xmpmeta>`;

function crc32(bytes: Buffer) {
  let value = 0xffffffff;
  for (let index = 0; index < bytes.length; index++) {
    value ^= bytes[index];
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, payload: Buffer) {
  const body = Buffer.concat([Buffer.from(type), payload]);
  const size = Buffer.alloc(4); size.writeUInt32BE(payload.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([size, body, checksum]);
}
function png(chunks: Buffer[] = [], pixelText = "") {
  // A real RGB scanline, stored without compression so fixture words are also
  // present in the encoded pixel payload. They must never count as metadata.
  const pixelBytes = Buffer.alloc(Math.max(3, Math.ceil(pixelText.length / 3) * 3), 255);
  if (pixelText) pixelBytes.write(pixelText);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(pixelBytes.length / 3); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header), ...chunks,
    pngChunk("IDAT", deflateSync(Buffer.concat([Buffer.from([0]), pixelBytes]), { level: 0 })), pngChunk("IEND", Buffer.alloc(0))]);
}
const textChunk = (keyword: string, text: string) => pngChunk("tEXt", Buffer.from(`${keyword}\0${text}`));
const ztextChunk = (text: string) => pngChunk("zTXt", Buffer.concat([Buffer.from("parameters\0\0"), deflateSync(Buffer.from(text))]));
const itextChunk = (text: string, compressed = false) => pngChunk("iTXt", Buffer.concat([Buffer.from("workflow\0"), Buffer.from([compressed ? 1 : 0, 0, 0, 0]), compressed ? deflateSync(Buffer.from(text)) : Buffer.from(text)]));

// One valid 1x1 JPEG with optional metadata inserted after its SOI marker.
const jpegImage = Buffer.from("/9j/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9sAQwACAgICAgIDAgIDBQMDAwUGBQUFBQYIBgYGBgYICggICAgICAoKCgoKCgoKDAwMDAwMDg4ODg4PDw8PDw8PDw8P/9sAQwECAgIEBAQHBAQHEAsJCxAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ/90ABAAB/9oADAMBAAIRAxEAPwD9/KKKKAP/2Q==", "base64");
function jpegSegment(marker: number, payload: Buffer) {
  const header = Buffer.from([0xff, marker, 0, 0]); header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}
const jpeg = (...segments: Buffer[]) => Buffer.concat([jpegImage.subarray(0, 2), ...segments, jpegImage.subarray(2)]);

function exif(tag: number, text: string) {
  const payload = Buffer.from(`${text}\0`);
  const header = Buffer.alloc(26);
  header.write("II"); header.writeUInt16LE(42, 2); header.writeUInt32LE(8, 4);
  header.writeUInt16LE(1, 8); header.writeUInt16LE(tag, 10); header.writeUInt16LE(2, 12);
  header.writeUInt32LE(payload.length, 14); header.writeUInt32LE(26, 18);
  return Buffer.concat([header, payload]);
}
function aliasedExif(distinctOffsets = false) {
  const entries = 1024;
  const valueLength = 240 * 1024;
  const valueStart = 8 + 2 + entries * 12 + 4;
  const bytes = Buffer.alloc(valueStart + valueLength + (distinctOffsets ? entries - 1 : 0));
  bytes.fill(0x78, valueStart);
  bytes.write("II"); bytes.writeUInt16LE(42, 2); bytes.writeUInt32LE(8, 4); bytes.writeUInt16LE(entries, 8);
  for (let index = 0; index < entries; index++) {
    const entry = 10 + index * 12;
    bytes.writeUInt16LE(0x010e, entry); bytes.writeUInt16LE(2, entry + 2);
    bytes.writeUInt32LE(valueLength, entry + 4); bytes.writeUInt32LE(valueStart + (distinctOffsets ? index : 0), entry + 8);
  }
  return bytes;
}
function box(type: string, payload: Buffer) {
  const header = Buffer.alloc(8); header.writeUInt32BE(payload.length + 8); header.write(type, 4);
  return Buffer.concat([header, payload]);
}
function jumbf() {
  return box("jumb", Buffer.concat([box("jumd", Buffer.from("c2pa.actions\0")), box("json", Buffer.from(JSON.stringify({ actions: [{ action: "c2pa.created", digitalSourceType: source }] })))]));
}
function jpegProvenancePart(sequence: number, payload: Buffer) {
  const header = Buffer.from([0x4a, 0x50, 0, 1, 0, 0, 0, 0]); header.writeUInt32BE(sequence, 4);
  return jpegSegment(0xeb, Buffer.concat([header, payload]));
}
function webpChunk(type: string, payload: Buffer) {
  const header = Buffer.alloc(8); header.write(type); header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload, ...(payload.length % 2 ? [Buffer.from([0])] : [])]);
}
function webp(type?: "XMP " | "EXIF", payload = Buffer.alloc(0)) {
  const simpleImage = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");
  if (!type) return simpleImage;
  const extendedHeader = Buffer.alloc(10); extendedHeader[0] = type === "XMP " ? 4 : 8;
  const chunks = Buffer.concat([webpChunk("VP8X", extendedHeader), simpleImage.subarray(12), webpChunk(type, payload)]);
  const header = Buffer.from("RIFF\0\0\0\0WEBP"); header.writeUInt32LE(chunks.length + 4, 4);
  return Buffer.concat([header, chunks]);
}

test("unmarked PNG, JPEG, and WebP always require human review", () => {
  for (const [bytes, mime] of [[png(), "image/png"], [jpeg(), "image/jpeg"], [webp(), "image/webp"]] as const) {
    const report = screenImage(bytes, mime);
    assert.equal(report.version, 1);
    assert.equal(report.status, "REVIEW_REQUIRED");
    assert.deepEqual(report.signals, []);
    assert.equal(report.summary, "No generation metadata found; human review required");
    assert.ok(Number.isFinite(Date.parse(report.checkedAt)));
  }
});

test("PNG parameters and actual ComfyUI graphs produce generation signals", () => {
  for (const chunk of [textChunk("parameters", parameters), ztextChunk(parameters), itextChunk(workflow), itextChunk(workflow, true)]) {
    const report = screenImage(png([chunk]), "image/png");
    assert.equal(report.status, "FLAGGED");
    assert.match(report.signals[0].code, /DIFFUSION_PARAMETERS|COMFYUI_WORKFLOW/);
    assert.doesNotMatch(JSON.stringify(report), /private prompt|still life/);
  }
});

test("strong IPTC metadata is detected in PNG, JPEG, and WebP containers", () => {
  const jpegXmp = jpeg(jpegSegment(0xe1, Buffer.concat([Buffer.from("http://ns.adobe.com/xap/1.0/\0"), Buffer.from(xmp)])));
  for (const [bytes, mime] of [[png([itextChunk(xmp)]), "image/png"], [jpegXmp, "image/jpeg"], [webp("XMP ", Buffer.from(xmp)), "image/webp"]] as const) {
    const report = screenImage(bytes, mime);
    assert.equal(report.status, "FLAGGED");
    assert.ok(report.signals.some((entry) => entry.code === "AI_SOURCE_TYPE_METADATA"));
  }
  for (const vocabulary of ["compositeWithTrainedAlgorithmicMedia", "compositedWithTrainedAlgorithmicMedia"]) {
    assert.equal(screenImage(png([textChunk("XML:com.adobe.xmp", xmp.replace("trainedAlgorithmicMedia", vocabulary))]), "image/png").status, "FLAGGED");
  }
  const resourceXmp = `<Iptc4xmpExt:DigitalSourceType rdf:resource="${source}"/>`;
  assert.equal(screenImage(png([itextChunk(resourceXmp)]), "image/png").status, "FLAGGED");
});

test("EXIF text and JPEG comment generation metadata are screened", () => {
  for (const [bytes, mime] of [
    [png([pngChunk("eXIf", exif(0x010e, parameters))]), "image/png"],
    [jpeg(jpegSegment(0xe1, Buffer.concat([Buffer.from("Exif\0\0"), exif(0x010e, parameters)]))), "image/jpeg"],
    [webp("EXIF", exif(0x010e, parameters)), "image/webp"],
    [jpeg(jpegSegment(0xfe, Buffer.from(workflow))), "image/jpeg"],
  ] as const) assert.equal(screenImage(bytes, mime).status, "FLAGGED");
});

test("C2PA generation declarations are flagged explicitly as unverified", () => {
  const payload = jumbf();
  const midpoint = Math.floor(payload.length / 2);
  for (const [bytes, mime] of [
    [png([pngChunk("caBX", payload)]), "image/png"],
    [jpeg(jpegProvenancePart(2, payload.subarray(midpoint)), jpegProvenancePart(1, payload.subarray(0, midpoint))), "image/jpeg"],
  ] as const) {
    const report = screenImage(bytes, mime);
    assert.equal(report.status, "FLAGGED");
    assert.ok(report.signals.some((entry) => entry.code === "C2PA_GENERATION_METADATA" && /Unverified/.test(entry.label)));
    assert.doesNotMatch(JSON.stringify(report), /cryptographically|validated|verified provenance/i);
  }
  const createdWithoutSource = box("jumb", box("json", Buffer.from('{"actions":[{"action":"c2pa.created"}]}')));
  assert.equal(screenImage(png([pngChunk("caBX", createdWithoutSource)]), "image/png").status, "REVIEW_REQUIRED", "an ordinary provenance creation action is not an AI declaration");
});

test("generation-looking words in actual pixels never count as metadata", () => {
  const bytes = png([], `${parameters} ${workflow} ${xmp}`);
  assert.ok(bytes.includes(Buffer.from(parameters)), "the fixture really includes these literal words in its pixel payload");
  const report = screenImage(bytes, "image/png");
  assert.equal(report.status, "REVIEW_REQUIRED");
  assert.deepEqual(report.signals, []);
});

test("ordinary Photoshop/Lightroom software metadata and artist descriptions are not AI flags", () => {
  for (const chunk of [
    textChunk("Description", "A painting about AI. Inspired by Midjourney, human painted."),
    textChunk("Software", "Adobe Photoshop 2026 / Lightroom"),
    textChunk("workflow", '{"note":"KSampler CLIPTextEncode"}'),
    pngChunk("eXIf", exif(0x0131, "Adobe Photoshop")),
  ]) {
    const report = screenImage(png([chunk]), "image/png");
    assert.equal(report.status, "REVIEW_REQUIRED");
    assert.deepEqual(report.signals, []);
  }
  assert.equal(screenImage(png([textChunk("Description", "digitalSourceType photography")]), "image/png").status, "REVIEW_REQUIRED");
});

test("compressed and total metadata budgets are enforced", () => {
  const bomb = screenImage(png([ztextChunk("x".repeat(300 * 1024))]), "image/png");
  assert.equal(bomb.status, "REVIEW_REQUIRED");
  assert.ok(bomb.signals.some((entry) => entry.code === "COMPRESSED_METADATA_UNREADABLE"));
  const chunks = Array.from({ length: 4 }, () => textChunk("Comment", "x".repeat(256 * 1024 - 10)));
  const overBudget = screenImage(png([...chunks, textChunk("parameters", parameters)]), "image/png");
  // Four fields almost fill the budget; a fifth larger field must be skipped.
  const fullBudget = screenImage(png([...chunks, textChunk("Comment", "y".repeat(1024)), textChunk("parameters", parameters)]), "image/png");
  assert.equal(overBudget.status, "REVIEW_REQUIRED");
  assert.equal(fullBudget.status, "REVIEW_REQUIRED");
  assert.ok(fullBudget.signals.some((entry) => entry.code === "METADATA_LIMIT"));
  assert.equal(screenImage(Buffer.alloc(5 * 1024 * 1024 + 1), "image/png").signals[0].code, "IMAGE_LIMIT");
});

test("aliased EXIF values are deduplicated and overlapping values share the processing budget", () => {
  const repeated = pngChunk("eXIf", aliasedExif());
  const duplicateReport = screenImage(png([repeated, repeated, repeated, repeated]), "image/png");
  assert.equal(duplicateReport.status, "REVIEW_REQUIRED");
  assert.deepEqual(duplicateReport.signals, [], "repeated offsets and encodings are decoded once per container");

  const overlappingReport = screenImage(png([pngChunk("eXIf", aliasedExif(true))]), "image/png");
  assert.equal(overlappingReport.status, "REVIEW_REQUIRED");
  assert.ok(overlappingReport.signals.some((entry) => entry.code === "METADATA_LIMIT"), "distinct overlapping offsets cannot repeatedly decode the same large payload without consuming work budget");
  assert.equal(overlappingReport.summary, "Metadata screening was incomplete; human review required");
});

test("failed compressed chunks consume expansion work even when no output is returned", () => {
  const compressed = ztextChunk("x".repeat(300 * 1024));
  const bytes = png(Array.from({ length: 16 }, () => compressed));
  assert.ok(bytes.length < 16 * 1024, "compressed input is far below the metadata input limit");
  const report = screenImage(bytes, "image/png");
  assert.equal(report.status, "REVIEW_REQUIRED");
  assert.ok(report.signals.some((entry) => entry.code === "COMPRESSED_METADATA_UNREADABLE"));
  assert.ok(report.signals.some((entry) => entry.code === "METADATA_LIMIT"), "failed inflates exhaust the shared processing budget before every chunk can expand");
  assert.equal(report.summary, "Metadata screening was incomplete; human review required");
});

test("malformed containers and unsupported formats safely require review", () => {
  const badChunk = Buffer.alloc(12); badChunk.writeUInt32BE(0xffffffff); badChunk.write("tEXt", 4);
  const badExif = Buffer.from("49492a00ffffffff", "hex");
  const malformedImages = [
    [png().subarray(0, 20), "image/png"],
    [Buffer.concat([png().subarray(0, 33), badChunk]), "image/png"],
    [png([pngChunk("eXIf", badExif)]), "image/png"],
    [png([pngChunk("zTXt", Buffer.from("parameters\0\0not zlib"))]), "image/png"],
    [png([pngChunk("caBX", Buffer.from("bad box"))]), "image/png"],
    [Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]), "image/jpeg"],
    [jpeg(jpegProvenancePart(2, jumbf())), "image/jpeg"],
    [webp().subarray(0, 25), "image/webp"],
    [Buffer.from("GIF89a"), "image/gif"],
  ] as const;
  for (const [bytes, mime] of malformedImages) {
    const report = screenImage(bytes, mime);
    assert.equal(report.status, "REVIEW_REQUIRED");
    assert.ok(report.signals.length, "a partial or unsupported screen includes a review notice");
  }
  // Exercise truncation at every position in a complete metadata-bearing image.
  const bytes = png([textChunk("Description", "human painting")]);
  for (let end = 0; end < bytes.length; end++) assert.doesNotThrow(() => screenImage(bytes.subarray(0, end), "image/png"));
});
