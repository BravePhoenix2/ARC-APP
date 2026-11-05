import { createHash } from "node:crypto";
import sharp from "sharp";
import { screenImage, type ImageScreeningReport } from "./imageScreening";

export const maxImageBytes = 5 * 1024 * 1024;
export const maxImageDimension = 8192;
export const maxImagePixels = 40_000_000;
export const maxAccountImageBytes = 500 * 1024 * 1024;

/** Sniff supported image containers instead of trusting the uploaded filename. */
export function imageMime(data: Buffer) {
  if (data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (data.length >= 12 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 16 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export class ImageValidationError extends Error {}

/** Screen the original privately, then decode and strip all public metadata. */
export async function prepareUploadedImage(data: Buffer, claimedMime: string) {
  const mimeType = imageMime(data);
  if (!mimeType || mimeType !== claimedMime || data.length === 0 || data.length > maxImageBytes) {
    throw new ImageValidationError("Use a PNG, JPEG, or WebP image up to 5 MB.");
  }
  const screening = screenImage(data, mimeType);
  try {
    const input = sharp(data, { failOn: "warning", limitInputPixels: maxImagePixels });
    const metadata = await input.metadata();
    if (!metadata.width || !metadata.height || metadata.width > maxImageDimension || metadata.height > maxImageDimension || (metadata.pages ?? 1) > 1) {
      throw new ImageValidationError("Use a still image no larger than 8,192 pixels per side and 40 megapixels.");
    }
    // Sharp strips EXIF/GPS/XMP/IPTC by default. Rotation applies orientation
    // before that metadata is discarded; never use keepMetadata/withMetadata.
    const outputImage = input.rotate().timeout({ seconds: 10 });
    if (mimeType === "image/jpeg") outputImage.jpeg({ quality: 100, chromaSubsampling: "4:4:4" });
    if (mimeType === "image/webp") outputImage.webp({ lossless: true });
    const { data: output, info } = await outputImage.toBuffer({ resolveWithObject: true });
    if (output.length > maxImageBytes) throw new ImageValidationError("The processed image exceeds 5 MB. Reduce its dimensions and try again.");
    return {
      data: output, mimeType,
      screening: { ...screening, publicImage: { version: 1 as const, sha256: createHash("sha256").update(output).digest("hex"), width: info.width, height: info.height } },
    };
  } catch (error) {
    if (error instanceof ImageValidationError) throw error;
    throw new ImageValidationError("This image could not be decoded safely. Export a new PNG, JPEG, or WebP and try again.");
  }
}

/** Old DB blobs are sanitized on read too; they never bypass the privacy fix. */
export async function publicImageBytes(data: Uint8Array, mimeType: string, screening: unknown) {
  const bytes = Buffer.from(data);
  const marker = (screening as ImageScreeningReport | null)?.publicImage;
  if (marker?.version === 1 && marker.sha256 === createHash("sha256").update(bytes).digest("hex")) return bytes;
  return (await prepareUploadedImage(bytes, mimeType)).data;
}
