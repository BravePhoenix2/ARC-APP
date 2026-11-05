import { config } from "dotenv";
import { spawnSync } from "node:child_process";
config({ path: ".env.local", quiet: true });
if (!/^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL || "")) throw new Error("db:migrate is for PostgreSQL. For local SQLite use db:push after a backup.");
const result = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { stdio: "inherit", env: process.env });
process.exitCode = result.status ?? 1;
