export const MAX_COLLECTION_IMAGES = 100;
export type CollectionImageInput = { imageUrl: string; filename: string };
export function parseCollectionImages(value: unknown): CollectionImageInput[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_COLLECTION_IMAGES) throw new Error(`Upload at most ${MAX_COLLECTION_IMAGES} images per collection.`);
  const seen = new Set<string>();
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Invalid collection image.");
    const { imageUrl, filename } = entry as Record<string, unknown>;
    if (typeof imageUrl !== "string" || !/^\/api\/uploads\/[a-z0-9]{20,40}$/.test(imageUrl) || seen.has(imageUrl)) throw new Error("Each collection image must be a different uploaded image.");
    if (typeof filename !== "string" || !filename.trim() || filename.length > 200 || /[\u0000-\u001f\u007f/\\]/.test(filename)) throw new Error("Invalid collection image filename.");
    seen.add(imageUrl);
    return { imageUrl, filename: filename.trim() };
  });
}
