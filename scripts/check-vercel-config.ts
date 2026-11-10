import { config } from "dotenv";
import { testnetConfigurationIssues } from "../lib/testnetReadiness";

config({ path: ".env.local", quiet: true });
const issues = testnetConfigurationIssues({ ...process.env, VERCEL: "1" });
if (issues.length) {
  for (const issue of issues) console.error(`- ${issue}`);
  console.error("Vercel configuration is incomplete. No provider calls or data changes were performed.");
  process.exitCode = 1;
} else {
  console.log("Vercel environment checks passed. Migrations and hosted acceptance still require verification.");
}
