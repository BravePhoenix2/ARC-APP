/** Bound uploads/JSON before buffering, including requests without Content-Length. */
export async function limitedBody(request: Request, limit: number, budget: { idleMs?: number; totalMs?: number } = {}): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length")) > limit) throw new Error("BODY_TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const deadline = Date.now() + (budget.totalMs ?? 60_000);
  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("BODY_READ_TIMEOUT");
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error("BODY_READ_TIMEOUT"));
          void reader.cancel().catch(() => undefined);
        }, Math.min(budget.idleMs ?? 15_000, remaining));
      });
      const { done, value } = await Promise.race([reader.read(), timeout]).finally(() => clearTimeout(timer));
      if (done) break;
      length += value.byteLength;
      if (length > limit) { void reader.cancel().catch(() => undefined); throw new Error("BODY_TOO_LARGE"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

export async function limitedJson(request: Request, limit = 20_000, budget: { idleMs?: number; totalMs?: number } = {}): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await limitedBody(request, limit, budget)));
}
