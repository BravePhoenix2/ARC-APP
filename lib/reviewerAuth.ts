import { normalizeEmail } from "@/lib/emailAuth";

/** Server-side only. Call with an email proven by the authenticated session. */
export function isReviewerEmail(email: string | null | undefined): boolean {
  const verifiedEmail = normalizeEmail(email);
  if (!verifiedEmail) return false;
  // Resolve the allowlist for every request so removing an email revokes access
  // immediately, including access to unpublished artwork through image URLs.
  return (process.env.ARTIQ_ADMIN_EMAILS ?? "")
    .split(",")
    .some((entry) => normalizeEmail(entry) === verifiedEmail);
}
