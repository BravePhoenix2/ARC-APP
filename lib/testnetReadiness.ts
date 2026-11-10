import { isAddress, zeroAddress } from "viem";

/** Static release checks without emitting secrets or contacting providers. */
export function testnetConfigurationIssues(env: Readonly<Record<string, string | undefined>> = process.env): string[] {
  const issues: string[] = [];
  let origin: URL | undefined;
  try { origin = new URL(env.NEXT_PUBLIC_APP_URL || ""); } catch { /* Report below. */ }
  if (!origin || origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || /(?:^localhost$|^127\.|\.trycloudflare\.com$)/.test(origin.hostname)) issues.push("Set NEXT_PUBLIC_APP_URL to the permanent HTTPS app origin (planned: https://articmarket.xyz).");
  if (env.ARTIQ_APP_ORIGIN && env.ARTIQ_APP_ORIGIN.replace(/\/$/, "") !== origin?.origin) issues.push("ARTIQ_APP_ORIGIN must match the public app origin.");
  if (env.NEXT_PUBLIC_ARC_CHAIN_ID !== "5042002") issues.push("The public Testnet release must use Arc Testnet chain 5042002.");
  if (!/^postgres(?:ql)?:\/\//.test(env.DATABASE_URL || "")) issues.push("Configure a managed PostgreSQL DATABASE_URL for the public release.");
  if (!env.NEXT_PUBLIC_PRIVY_APP_ID?.trim()) issues.push("Configure the Privy app ID and allowed origins for the final domain.");
  if (!env.ARTIQ_ADMIN_EMAILS?.trim()) issues.push("Configure at least one verified reviewer email.");
  if (!["cloudflare", "vercel"].includes(env.ARTIQ_TRUSTED_PROXY || "")) issues.push("Configure a supported trusted proxy and restrict direct origin access; verify its actual client-IP header.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.NEXT_PUBLIC_SUPPORT_EMAIL || "")) issues.push("Publish NEXT_PUBLIC_SUPPORT_EMAIL for tester reports and data requests.");
  const feeWallet = env.FEE_RECIPIENT_ADDRESS?.trim() || env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT?.trim() || "";
  if (!isAddress(feeWallet) || feeWallet.toLowerCase() === zeroAddress) issues.push("Configure a valid collection creation fee wallet in FEE_RECIPIENT_ADDRESS or NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT.");
  const redis = [env.ARTIQ_SECURITY_REDIS_URL, env.ARTIQ_SECURITY_REDIS_TOKEN, env.ARTIQ_RATE_LIMIT_SECRET];
  if (redis.some(Boolean) && (!redis.every(Boolean) || (redis[2]?.length || 0) < 32)) issues.push("Complete all shared rate-limit settings with a secret of at least 32 characters, or leave all unset for one process.");
  if (env.VERCEL === "1" && !redis.some(Boolean)) issues.push("Configure the shared rate-limit store and secret for Vercel's independently scaled functions.");
  if (env.VERCEL === "1" && (env.CRON_SECRET?.length || 0) < 32) issues.push("Set a server-only CRON_SECRET of at least 32 characters for scheduled jobs.");
  if (env.VERCEL === "1" && env.ARTIQ_TRUSTED_PROXY !== "vercel") issues.push("Set ARTIQ_TRUSTED_PROXY=vercel for the Vercel deployment.");
  if (env.ARTIQ_AI_PIXEL_SCREENING === "true" && ![env.SIGHTENGINE_API_USER, env.SIGHTENGINE_API_SECRET].every((value) => value?.trim())) issues.push("Complete both server-only Sightengine credentials, or disable optional pixel screening.");
  if (env.ARTIQ_UPLOAD_STORAGE === "supabase" && ![env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, env.ARTIQ_SUPABASE_STORAGE_BUCKET].every(Boolean)) issues.push("Complete the private Supabase bucket configuration.");
  if (env.ARTIQ_LOCAL_HTTP_ORIGIN || env.ARTIQ_LOCAL_PREVIEW === "true" || env.ARTIQ_PREVIEW_ORIGIN) issues.push("Remove local/temporary preview overrides from the public release environment.");
  return issues;
}
