import { withAbuseProtection } from "@/lib/abuseProtection";
import { NextRequest, NextResponse } from "next/server";
import { localPreviewRequestAllowed } from "@/lib/localPreview";
import { limitedBody } from "@/lib/requestBody";
import { imageMime, maxImageBytes } from "@/lib/imageUpload";
import { screenImage } from "@/lib/imageScreening";
import { screenArtwork } from "@/lib/artworkScreening";

export const runtime = "nodejs";
const privateHeaders = { "Cache-Control": "private, no-store" };
const recentChecks: number[] = [];
let inFlight = 0;

async function handlePOST(request: NextRequest) {
  // No wallet authentication is bypassed: this local tool only returns a report.
  // It never saves an upload, creates an application, or publishes a listing.
  if (!localPreviewRequestAllowed(request)) return NextResponse.json({ error: "Not found." }, { status: 404, headers: privateHeaders });
  const now = Date.now();
  while (recentChecks.length && recentChecks[0] < now - 60 * 60 * 1000) recentChecks.shift();
  if (recentChecks.length >= 20 || inFlight >= 2) return NextResponse.json({ error: "Preview screening limit reached. Try again later." }, { status: 429, headers: privateHeaders });
  ++inFlight;
  try {
    const bytes = await limitedBody(request, maxImageBytes + 16_384);
    const form = await new Response(bytes as BodyInit, { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
    const itemType = form.get("itemType");
    if (itemType !== "NFT" && itemType !== "WEB2_ART") return NextResponse.json({ error: "Choose NFT or Art." }, { status: 400, headers: privateHeaders });
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0 || file.size > maxImageBytes) return NextResponse.json({ error: "Upload an image up to 4 MB." }, { status: 400, headers: privateHeaders });
    const data = Buffer.from(await file.arrayBuffer());
    const mimeType = imageMime(data);
    if (!mimeType || file.type !== mimeType) return NextResponse.json({ error: "Use a PNG, JPEG, or WebP image." }, { status: 400, headers: privateHeaders });
    recentChecks.push(now);
    const screening = itemType === "WEB2_ART" ? await screenArtwork(data, mimeType) : screenImage(data, mimeType);
    return NextResponse.json({ screening }, { headers: privateHeaders });
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "BODY_TOO_LARGE";
    return NextResponse.json({ error: tooLarge ? "Image must be 4 MB or smaller." : "Choose a valid image and try again." }, { status: tooLarge ? 413 : 400, headers: privateHeaders });
  } finally {
    --inFlight;
  }
}

export const POST = withAbuseProtection("POST preview/screen", "screening", handlePOST);
