import { createMaintenanceCronHandler } from "@/lib/cronJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = createMaintenanceCronHandler(async () => {
  const [{ prisma }, { planDataRetention, applyDataRetention }] = await Promise.all([
    import("@/lib/prisma"),
    import("@/lib/dataRetention"),
  ]);
  return { database: prisma, plan: planDataRetention, apply: applyDataRetention };
});
