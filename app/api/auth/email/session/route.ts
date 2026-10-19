import { NextRequest, NextResponse } from "next/server";
import { clearEmailSessionCookie, getEmailSession, revokeEmailSession } from "@/lib/emailAuth";
import { sameOrigin } from "@/lib/walletAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  try {
    const session = await getEmailSession(request);
    if (session) return NextResponse.json({ user: { id: session.userId, email: session.email } }, { headers });
    const response = NextResponse.json({ error: "Sign in with your email to continue." }, { status: 401, headers });
    clearEmailSessionCookie(response);
    return response;
  } catch {
    return NextResponse.json({ error: "Email sign-in is unavailable. Please try again." }, { status: 503, headers });
  }
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "This request must come from Artiq." }, { status: 403, headers });
  }
  try {
    await revokeEmailSession(request);
    const response = NextResponse.json({ ok: true }, { headers });
    clearEmailSessionCookie(response);
    return response;
  } catch {
    return NextResponse.json({ error: "Could not sign out. Please try again." }, { status: 503, headers });
  }
}
