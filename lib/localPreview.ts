/** One explicitly configured HTTPS origin for a temporary remote preview. */
function remotePreviewOrigin() {
  const value = process.env.ARTIQ_PREVIEW_ORIGIN;
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** A temporary development preview, enabled only by the preview run command. */
export function localPreviewEnabled(host: string | null) {
  if (process.env.NODE_ENV !== "development" || process.env.ARTIQ_LOCAL_PREVIEW !== "true" || !host) return false;
  if (/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host)) return true;
  const remote = remotePreviewOrigin();
  return remote !== null && new URL(remote).host === host.toLowerCase();
}

export function localPreviewRequestAllowed(request: Request) {
  if (!localPreviewEnabled(request.headers.get("host"))) return false;
  const remote = remotePreviewOrigin();
  if (remote && new URL(remote).host === request.headers.get("host")?.toLowerCase()) {
    // Use only the configured origin and actual Host. A tunnel may forward to
    // internal HTTP; forwarded headers never grant access to another origin.
    return request.headers.get("origin") === remote;
  }
  const url = new URL(request.url);
  return url.host.toLowerCase() === request.headers.get("host")?.toLowerCase()
    && request.headers.get("origin") === url.origin;
}
