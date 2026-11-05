import { inflateSync } from "node:zlib";

export type ImageScreeningReport = {
  version: 1;
  status: "FLAGGED" | "REVIEW_REQUIRED";
  signals: Array<{ code: string; label: string }>;
  summary: string;
  checkedAt: string;
  publicImage?: { version: 1; sha256: string; width: number; height: number };
};

/** Only reuse a bounded server-stored metadata report, never a request field. */
export function savedImageScreening(value: unknown): ImageScreeningReport | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const report = value as Partial<ImageScreeningReport>;
  if (report.version !== 1 || !["FLAGGED", "REVIEW_REQUIRED"].includes(report.status ?? "") || typeof report.summary !== "string" || report.summary.length > 500 || typeof report.checkedAt !== "string" || !Number.isFinite(Date.parse(report.checkedAt)) || !Array.isArray(report.signals) || report.signals.length > 32 || report.signals.some((entry) => !entry || typeof entry.code !== "string" || entry.code.length > 80 || typeof entry.label !== "string" || entry.label.length > 300)) return;
  const marker = report.publicImage;
  return {
    version: 1, status: report.status as ImageScreeningReport["status"], signals: report.signals, summary: report.summary, checkedAt: report.checkedAt,
    ...(marker?.version === 1 && /^[a-f0-9]{64}$/.test(marker.sha256) && Number.isSafeInteger(marker.width) && Number.isSafeInteger(marker.height) ? { publicImage: marker } : {}),
  };
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_FIELD_BYTES = 256 * 1024;
const MAX_CHUNKS = 4096;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Server-side metadata screening only. Metadata is editable and removable, so
 * neither an absent signal nor this report establishes an image's authorship.
 * Raw metadata, prompts, and identifying EXIF values are never returned.
 */
export function screenImage(data: Uint8Array, mimeType: string): ImageScreeningReport {
  const signals: ImageScreeningReport["signals"] = [];
  const flaggedCodes = new Set<string>();
  let examinedBytes = 0;
  let processedBytes = 0;
  const signal = (code: string, label: string, flagged = false) => {
    if (!signals.some((entry) => entry.code === code)) signals.push({ code, label });
    if (flagged) flaggedCodes.add(code);
  };
  const notice = (code: string, label: string) => signal(code, label);
  const malformed = () => notice("METADATA_INCOMPLETE", "Some image metadata could not be read; human review required");
  const withinBudget = (size: number) => {
    if (size > MAX_FIELD_BYTES || examinedBytes + size > MAX_METADATA_BYTES) {
      notice("METADATA_LIMIT", "Metadata screening limit reached; human review required");
      return false;
    }
    examinedBytes += size;
    return true;
  };
  const reserveProcessing = (size: number) => {
    if (processedBytes + size > MAX_METADATA_BYTES) {
      notice("METADATA_LIMIT", "Metadata screening limit reached; human review required");
      return false;
    }
    processedBytes += size;
    return true;
  };

  const inspectText = (text: string, provenance = false) => {
    // Require a named source-type field and its exact controlled vocabulary.
    // Product names and ordinary descriptions (including "AI") are not signals.
    const sourceType = /\bdigitalSourceType(?:\s{0,64}["']\s{0,64}:\s{0,64}["']|\s{0,64}=\s{0,64}["']|\s{0,64}>\s{0,64}|\s{1,64}(?:rdf:)?resource\s{0,64}=\s{0,64}["'])(?:https?:\/\/cv\.iptc\.org\/newscodes\/digitalsourcetype\/)?(?:trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia|compositedWithTrainedAlgorithmicMedia)(?=[\s"'<\/]|$)/i;
    if (sourceType.test(text)) {
      signal(provenance ? "C2PA_GENERATION_METADATA" : "AI_SOURCE_TYPE_METADATA",
        provenance ? "Unverified AI-generation provenance metadata detected" : "AI-generation source-type metadata detected", true);
    }
    if (/(?:^|[\s,])Steps:\s*\d+/i.test(text)
      && /(?:^|[\s,])Sampler:\s*[^,\r\n]+/i.test(text)
      && /(?:^|[\s,])CFG scale:\s*\d/i.test(text)
      && /(?:^|[\s,])Seed:\s*\d+/i.test(text)) {
      signal("DIFFUSION_PARAMETERS", "AI-generation parameter metadata detected", true);
    }

    // A ComfyUI graph must contain both generation and text-encoding nodes.
    // Parse JSON rather than treating an artist's mention of a tool as evidence.
    if (text.length && (text.trimStart().startsWith("{") || text.trimStart().startsWith("["))) {
      try {
        const pending: unknown[] = [JSON.parse(text)];
        let sampler = false;
        let textEncoder = false;
        let count = 0;
        while (pending.length && count++ < 10000) {
          const value = pending.pop();
          if (!value || typeof value !== "object") continue;
          const record = value as Record<string, unknown>;
          if (record.class_type === "KSampler" || record.type === "KSampler") sampler = true;
          if (record.class_type === "CLIPTextEncode" || record.type === "CLIPTextEncode") textEncoder = true;
          for (const child of Object.values(record)) if (child && typeof child === "object") pending.push(child);
          if (sampler && textEncoder) break;
        }
        if (sampler && textEncoder) signal("COMFYUI_WORKFLOW", "AI-generation workflow metadata detected", true);
      } catch { /* Most metadata fields are plain text, not JSON. */ }
    }
  };
  const inspectTextBytes = (bytes: Buffer, encoding: "utf8" | "utf16le" | "utf16be" = "utf8", provenance = false) => {
    // Charge work before decoding: EXIF values can overlap or alias each other.
    if (!reserveProcessing(bytes.length)) return;
    const text = encoding === "utf16be" ? new TextDecoder("utf-16be").decode(bytes) : bytes.toString(encoding);
    inspectText(encoding === "utf8" ? text : text.replace(/\0/g, ""), provenance);
  };
  const inspectBytes = (bytes: Buffer, provenance = false) => {
    if (withinBudget(bytes.length)) inspectTextBytes(bytes, "utf8", provenance);
  };

  const inflateText = (bytes: Buffer): Buffer | undefined => {
    if (!withinBudget(bytes.length)) return;
    const outputLimit = Math.min(MAX_FIELD_BYTES, MAX_METADATA_BYTES - processedBytes);
    if (outputLimit <= 0) {
      notice("METADATA_LIMIT", "Metadata screening limit reached; human review required");
      return;
    }
    // Reserve the maximum expansion work even if inflate throws before returning
    // output. Otherwise thousands of tiny failing chunks can bypass the budget.
    processedBytes += outputLimit;
    try {
      const result = inflateSync(bytes, { maxOutputLength: outputLimit });
      processedBytes -= outputLimit - result.length;
      return result;
    } catch {
      notice("COMPRESSED_METADATA_UNREADABLE", "Compressed metadata could not be fully read; human review required");
      if (processedBytes >= MAX_METADATA_BYTES) notice("METADATA_LIMIT", "Metadata screening limit reached; human review required");
    }
  };

  const inspectExif = (bytes: Buffer) => {
    if (!withinBudget(bytes.length)) return;
    if (bytes.subarray(0, 6).equals(Buffer.from("Exif\0\0"))) bytes = bytes.subarray(6);
    if (bytes.length < 8) { malformed(); return; }
    const littleEndian = bytes.toString("ascii", 0, 2) === "II";
    if (!littleEndian && bytes.toString("ascii", 0, 2) !== "MM") { malformed(); return; }
    const u16 = (offset: number) => littleEndian ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset);
    const u32 = (offset: number) => littleEndian ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
    if (u16(2) !== 42) { malformed(); return; }
    const pending = [u32(4)];
    const seen = new Set<number>();
    const inspectedSpans = new Set<string>();
    let entryCount = 0;
    while (pending.length) {
      const offset = pending.pop()!;
      if (offset === 0 || seen.has(offset)) continue;
      seen.add(offset);
      if (offset + 2 > bytes.length) { malformed(); continue; }
      const count = u16(offset);
      if ((entryCount += count) > 1024 || offset + 2 + count * 12 + 4 > bytes.length) { malformed(); continue; }
      for (let index = 0; index < count; index++) {
        const entry = offset + 2 + index * 12;
        const tag = u16(entry);
        const type = u16(entry + 2);
        const length = u32(entry + 4);
        if (tag === 0x8769 && type === 4 && length === 1) { pending.push(u32(entry + 8)); continue; }
        // Read textual metadata fields only, never embedded thumbnail/image bytes.
        if (![0x010e, 0x0131, 0x02bc, 0x9286, 0x9c9b, 0x9c9c].includes(tag)) continue;
        if (![1, 2, 7].includes(type)) continue;
        const start = length <= 4 ? entry + 8 : u32(entry + 8);
        if (length > MAX_FIELD_BYTES || start + length > bytes.length) { malformed(); continue; }
        let value = bytes.subarray(start, start + length);
        let effectiveStart = start;
        let encoding: "utf8" | "utf16le" | "utf16be" = tag === 0x9c9b || tag === 0x9c9c ? "utf16le" : "utf8";
        if (tag === 0x9286 && value.length >= 8) {
          const prefix = value.toString("ascii", 0, 8);
          value = value.subarray(8);
          effectiveStart += 8;
          if (prefix.startsWith("UNICODE")) encoding = littleEndian ? "utf16le" : "utf16be";
        }
        const span = `${effectiveStart}:${value.length}:${encoding}`;
        if (inspectedSpans.has(span)) continue;
        inspectedSpans.add(span);
        inspectTextBytes(value, encoding);
      }
      // Do not follow the thumbnail IFD; the primary and Exif IFDs suffice.
    }
  };

  const inspectJumbf = (bytes: Buffer, depth = 0) => {
    if (depth === 0 && !withinBudget(bytes.length)) return;
    if (depth > 8) { malformed(); return; }
    let offset = 0;
    let count = 0;
    while (offset < bytes.length && count++ < MAX_CHUNKS) {
      if (bytes.length - offset < 8) { malformed(); return; }
      let size = bytes.readUInt32BE(offset);
      const type = bytes.toString("ascii", offset + 4, offset + 8);
      let header = 8;
      if (size === 1) {
        if (bytes.length - offset < 16 || bytes.readUInt32BE(offset + 8) !== 0) { malformed(); return; }
        size = bytes.readUInt32BE(offset + 12); header = 16;
      } else if (size === 0) size = bytes.length - offset;
      if (size < header || size > bytes.length - offset) { malformed(); return; }
      const payload = bytes.subarray(offset + header, offset + size);
      if (type === "jumb") inspectJumbf(payload, depth + 1);
      else if (type === "json" || type === "xml ") inspectTextBytes(payload, "utf8", true);
      offset += size;
    }
    if (offset !== bytes.length) malformed();
  };

  const inspectPng = (bytes: Buffer) => {
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.toString("ascii", 12, 16) !== "IHDR" || bytes.readUInt32BE(8) !== 13) { malformed(); return; }
    let offset = 8;
    let count = 0;
    while (offset < bytes.length && count++ < MAX_CHUNKS) {
      if (bytes.length - offset < 12) { malformed(); return; }
      const length = bytes.readUInt32BE(offset);
      if (length > bytes.length - offset - 12) { malformed(); return; }
      const type = bytes.toString("ascii", offset + 4, offset + 8);
      const payload = bytes.subarray(offset + 8, offset + 8 + length);
      offset += 12 + length;
      if (type === "IEND") { if (length !== 0) malformed(); return; }
      if (!["tEXt", "iTXt", "zTXt", "eXIf", "caBX"].includes(type)) continue;
      if (length > MAX_FIELD_BYTES) { notice("METADATA_LIMIT", "Metadata screening limit reached; human review required"); continue; }
      if (type === "eXIf") { inspectExif(payload); continue; }
      if (type === "caBX") { inspectJumbf(payload); continue; }
      const separator = payload.indexOf(0);
      if (separator < 1 || separator > 79) { malformed(); continue; }
      if (type === "tEXt") { inspectBytes(payload.subarray(separator + 1)); continue; }
      if (type === "zTXt") {
        if (payload[separator + 1] !== 0) { malformed(); continue; }
        const text = inflateText(payload.subarray(separator + 2));
        if (text) inspectBytes(text);
        continue;
      }
      const compressed = payload[separator + 1];
      if ((compressed !== 0 && compressed !== 1) || payload[separator + 2] !== 0) { malformed(); continue; }
      const languageEnd = payload.indexOf(0, separator + 3);
      const translatedEnd = languageEnd < 0 ? -1 : payload.indexOf(0, languageEnd + 1);
      if (languageEnd < 0 || translatedEnd < 0) { malformed(); continue; }
      const text = compressed ? inflateText(payload.subarray(translatedEnd + 1)) : payload.subarray(translatedEnd + 1);
      if (text) inspectBytes(text);
    }
    malformed();
  };

  const inspectJpeg = (bytes: Buffer) => {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) { malformed(); return; }
    let offset = 2;
    let count = 0;
    let stoppedBeforePixels = false;
    const fragments = new Map<number, Array<{ sequence: number; payload: Buffer }>>();
    let fragmentBytes = 0;
    while (offset < bytes.length && count++ < MAX_CHUNKS) {
      if (bytes[offset++] !== 0xff) { malformed(); break; }
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      // Entropy-coded pixels follow SOS. Never scan their bytes as metadata.
      if (marker === 0xda || marker === 0xd9) { stoppedBeforePixels = true; break; }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) { malformed(); break; }
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) { malformed(); break; }
      const payload = bytes.subarray(offset + 2, offset + length);
      offset += length;
      if (marker === 0xfe) inspectBytes(payload);
      else if (marker === 0xe1) {
        if (payload.subarray(0, 6).equals(Buffer.from("Exif\0\0"))) inspectExif(payload);
        else {
          const xmpHeader = Buffer.from("http://ns.adobe.com/xap/1.0/\0");
          if (payload.subarray(0, xmpHeader.length).equals(xmpHeader)) inspectBytes(payload.subarray(xmpHeader.length));
        }
      } else if (marker === 0xeb && payload.length >= 8 && payload.toString("ascii", 0, 2) === "JP") {
        // JPEG XT / C2PA JUMBF can span APP11 segments (En + Z fields).
        const instance = payload.readUInt16BE(2);
        const sequence = payload.readUInt32BE(4);
        const content = payload.subarray(8);
        if (fragmentBytes + content.length > MAX_METADATA_BYTES) { notice("METADATA_LIMIT", "Metadata screening limit reached; human review required"); continue; }
        fragmentBytes += content.length;
        const parts = fragments.get(instance) || [];
        parts.push({ sequence, payload: content });
        fragments.set(instance, parts);
      }
    }
    if (!stoppedBeforePixels) malformed();
    fragments.forEach((parts) => {
      parts.sort((a, b) => a.sequence - b.sequence);
      if (parts.some((part, index) => part.sequence !== index + 1)) { malformed(); return; }
      inspectJumbf(Buffer.concat(parts.map((part) => part.payload)));
    });
  };

  const inspectWebp = (bytes: Buffer) => {
    if (bytes.length < 12 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") { malformed(); return; }
    const end = bytes.readUInt32LE(4) + 8;
    if (end !== bytes.length) { malformed(); return; }
    let offset = 12;
    let count = 0;
    while (offset < end && count++ < MAX_CHUNKS) {
      if (end - offset < 8) { malformed(); return; }
      const type = bytes.toString("ascii", offset, offset + 4);
      const length = bytes.readUInt32LE(offset + 4);
      if (length > end - offset - 8) { malformed(); return; }
      const payload = bytes.subarray(offset + 8, offset + 8 + length);
      if (type === "XMP ") inspectBytes(payload);
      else if (type === "EXIF") inspectExif(payload);
      offset += 8 + length + (length % 2);
    }
    if (offset !== end) malformed();
  };

  try {
    if (data.byteLength > MAX_IMAGE_BYTES) notice("IMAGE_LIMIT", "Image exceeds the screening size limit; human review required");
    else {
      const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      if (mimeType === "image/png") inspectPng(bytes);
      else if (mimeType === "image/jpeg") inspectJpeg(bytes);
      else if (mimeType === "image/webp") inspectWebp(bytes);
      else notice("UNSUPPORTED_METADATA", "This image format requires human review");
    }
  } catch { malformed(); }

  const flagged = flaggedCodes.size > 0;
  return {
    version: 1,
    status: flagged ? "FLAGGED" : "REVIEW_REQUIRED",
    signals,
    summary: flagged ? "AI-generation metadata detected; metadata is unverified and human review is required" : signals.length > 0 ? "Metadata screening was incomplete; human review required" : "No generation metadata found; human review required",
    checkedAt: new Date().toISOString(),
  };
}
