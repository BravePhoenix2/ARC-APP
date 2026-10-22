import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Build once before sharing so page visits never trigger development compilation.
let origin;
try {
  const url = new URL(process.argv[2] || "");
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error();
  origin = url.origin;
} catch {
  console.error("Usage: npm run preview:share -- https://your-preview-host");
  process.exit(1);
}
const previewEnv = { ...process.env, ARTIQ_APP_ORIGIN: origin, NEXT_PUBLIC_APP_URL: origin };
previewEnv.ARTIQ_LOCAL_HTTP_ORIGIN = "";
previewEnv.ARTIQ_LOCAL_PREVIEW = "false";
previewEnv.ARTIQ_SHARED_BUILD = "true";
// This command binds loopback behind the Cloudflare tunnel. Do not use this
// trust mode when the origin can also be reached directly from the internet.
if (new URL(origin).hostname.endsWith(".trycloudflare.com")) previewEnv.ARTIQ_TRUSTED_PROXY = "cloudflare";
const next = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
let child;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child?.kill(signal));
function run(args) {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, [next, ...args], { env: previewEnv, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
const built = await run(["build"]);
if (built !== 0) process.exit(built);
console.log(`Serving production preview for ${origin}`);
process.exit(await run(["start", "--hostname", "127.0.0.1", "--port", "3000"]));
