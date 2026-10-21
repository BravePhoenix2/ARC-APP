/** Only the loopback-only local preview command opts out of HTTPS cookies. */
export function localHttpSessionOrigin(): string | null {
  const value = process.env.ARTIQ_LOCAL_HTTP_ORIGIN;
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin === value && url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ? value : null;
  } catch { return null; }
}

export function secureSessionCookie(): boolean {
  return process.env.NODE_ENV === "production" && !localHttpSessionOrigin();
}
