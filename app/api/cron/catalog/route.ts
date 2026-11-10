import { createCatalogCronHandler } from "@/lib/cronJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = createCatalogCronHandler(async () => {
  const { reconcileCatalogPage } = await import("@/lib/catalogSync");
  return reconcileCatalogPage;
});
