import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { NextRequest } from "next/server";
import { getCreatorSession } from "@/lib/creatorSession";
import { PRIVY_SESSION_COOKIE } from "@/lib/privyAuth";
import { EMAIL_SESSION_COOKIE } from "@/lib/emailAuth";

/** Page permission comes from the HttpOnly session and current reviewer allowlist. */
export async function requireReviewerPage() {
  const jar = cookies();
  if (!jar.get(PRIVY_SESSION_COOKIE)?.value && !jar.get(EMAIL_SESSION_COOKIE)?.value) notFound();
  // This request is only an adapter for existing cookie verification; no HTTP
  // request is sent and no browser account/role headers are trusted.
  const request = new NextRequest("https://artiq.internal/reviewer", { headers: { Cookie: jar.toString() } });
  const session = await getCreatorSession(request, false);
  if (!session?.isAdmin || !session.email) notFound();
  return session;
}
