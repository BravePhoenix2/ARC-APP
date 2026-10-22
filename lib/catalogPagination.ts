/** Keyset pagination keeps database work independent of the requested page depth. */
export function catalogPagination(params: URLSearchParams) {
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? 48 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("limit must be an integer from 1 to 100.");
  const cursor = params.get("cursor");
  if (!cursor) return { limit, after: null };
  if (cursor.length > 512) throw new Error("Invalid catalog cursor.");
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof value.id !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(value.id) || typeof value.createdAt !== "string") throw new Error();
    const createdAt = new Date(value.createdAt);
    if (!Number.isFinite(createdAt.getTime())) throw new Error();
    return { limit, after: { id: value.id as string, createdAt } };
  } catch { throw new Error("Invalid catalog cursor."); }
}

export function catalogCursor(item: { id: string; createdAt: Date }) {
  return Buffer.from(JSON.stringify({ id: item.id, createdAt: item.createdAt.toISOString() })).toString("base64url");
}
