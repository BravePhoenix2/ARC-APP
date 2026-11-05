import { screenImage, type ImageScreeningReport } from "@/lib/imageScreening";

export type ArtworkScreeningReport = ImageScreeningReport & {
  provider: {
    name: "sightengine";
    status: "COMPLETED" | "NOT_CONFIGURED" | "ERROR";
    score?: number;
  };
};

/** External pixel analysis is opt-in and never replaces human review. */
export async function screenArtwork(data: Uint8Array, mimeType: string, originalMetadata?: ImageScreeningReport): Promise<ArtworkScreeningReport> {
  // Public bytes have been stripped of metadata. Preserve the report captured
  // from the original upload so stripping cannot clear a generation flag.
  const local = originalMetadata ?? screenImage(data, mimeType);
  const apiUser = process.env.SIGHTENGINE_API_USER;
  const apiSecret = process.env.SIGHTENGINE_API_SECRET;
  if (process.env.ARTIQ_AI_PIXEL_SCREENING !== "true" || !apiUser || !apiSecret) {
    return { ...local, provider: { name: "sightengine", status: "NOT_CONFIGURED" } };
  }
  try {
    const form = new FormData();
    form.set("media", new Blob([new Uint8Array(data)], { type: mimeType }), "artwork");
    form.set("models", "genai");
    form.set("api_user", apiUser);
    form.set("api_secret", apiSecret);
    const response = await fetch("https://api.sightengine.com/1.0/check.json", {
      method: "POST", body: form, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("SCREENING_UNAVAILABLE");
    const body = await response.json();
    const score: unknown = body?.type?.ai_generated;
    if (body?.status !== "success" || typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) throw new Error("INVALID_SCREENING_RESULT");
    // A conservative flag is a request for review, never an automatic accusation.
    const threshold = 0.8;
    const flagged = score >= threshold;
    return {
      ...local,
      status: flagged || local.status === "FLAGGED" ? "FLAGGED" : "REVIEW_REQUIRED",
      signals: [...local.signals, ...(flagged ? [{ code: "PIXEL_MODEL_FLAG", label: "Pixel model indicates possible AI-generated or AI-edited content." }] : [])],
      summary: flagged ? "Possible AI-generation signals found. Review the creator's evidence before deciding." : local.summary,
      provider: { name: "sightengine", status: "COMPLETED", score },
    };
  } catch {
    // Do not expose provider responses, credentials, or a fabricated confidence.
    return { ...local, summary: local.status === "FLAGGED" ? local.summary : "Pixel screening was unavailable. Human review is required.", provider: { name: "sightengine", status: "ERROR" } };
  }
}
