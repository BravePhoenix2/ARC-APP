// Regression for the original unverified NFT import finding.
// Run from the repository root. The test creates and removes a disposable DB.
import { execFileSync } from "node:child_process";

execFileSync(process.execPath, [
  "--import", "tsx", "--test", "test/security/nft-import.test.ts",
], { cwd: process.cwd(), env: process.env, stdio: "inherit" });
