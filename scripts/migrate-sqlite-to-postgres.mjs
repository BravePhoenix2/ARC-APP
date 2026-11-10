import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import pg from "pg";
import { config } from "dotenv";
import { sqliteMigrationRows } from "./sqlite-migration-rows.mjs";

config({ path: ".env.local", quiet: true });
const apply = process.argv.includes("--apply");
const sourcePath = process.env.ARTIQ_SQLITE_SOURCE;
const targetUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!sourcePath || !/^postgres(?:ql)?:\/\//.test(targetUrl || "")) {
  throw new Error("Set ARTIQ_SQLITE_SOURCE to a SQLite backup path and DIRECT_URL (or DATABASE_URL) to the new PostgreSQL database. Preview is the default.");
}
if (apply && !process.argv.includes("--writes-paused")) throw new Error("Pause application writes, take a fresh SQLite backup, then pass --apply --writes-paused. The target must be empty.");
const source = new Database(resolve(sourcePath.replace(/^file:/, "")), { readonly: true, fileMustExist: true });
let url;
try { url = new URL(targetUrl); }
catch { throw new Error("The target PostgreSQL connection string is invalid; check it privately."); }
const namespace = url.searchParams.get("schema") || "public";
if (!/^[a-z_][a-z0-9_]*$/.test(namespace)) throw new Error("Invalid target schema identifier; use lowercase.");
url.searchParams.delete("schema");
const target = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 5000, statement_timeout: 30_000 });
const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const enumTypes = new Set(Array.from(schema.matchAll(/^enum (\w+) \{/gm), (match) => match[1]));
const scalarTypes = new Set(["String", "Int", "BigInt", "Float", "Decimal", "Boolean", "DateTime", "Json", "Bytes", ...enumTypes]);
const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
const models = Array.from(schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm), (match) => ({
  name: match[1], fields: Array.from(match[2].matchAll(/^\s*(\w+)\s+(\w+)(\?|\[\])?/gm), (field) => ({ name: field[1], type: field[2], list: field[3] === "[]" })).filter((field) => scalarTypes.has(field.type) && !field.list),
}));

function convert(value, type) {
  if (value === null || value === undefined) return null;
  if (type === "DateTime") {
    const numeric = typeof value === "number" || typeof value === "bigint" || /^\d{12,}$/.test(String(value));
    const date = new Date(numeric ? Number(value) : value);
    if (!Number.isFinite(date.getTime())) throw new Error("A source timestamp is invalid; no target changes will be committed.");
    return date;
  }
  if (type === "Boolean") {
    if (![0, 1, false, true].includes(value)) throw new Error("A source boolean is invalid.");
    return Boolean(value);
  }
  if (type === "Json") return JSON.stringify(typeof value === "string" ? JSON.parse(value) : value);
  if (type === "Bytes") return Buffer.from(value);
  return value;
}

let transaction = false;
try {
  if (source.pragma("quick_check", { simple: true }) !== "ok") throw new Error("Source integrity check failed.");
  source.exec("BEGIN");
  const counts = [];
  for (const model of models) {
    const exists = source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(model.name);
    if (!exists) throw new Error(`Missing source table ${model.name}; upgrade a backed-up copy before migration.`);
    const columns = new Set(source.prepare(`PRAGMA table_info(${quote(model.name)})`).all().map((column) => column.name));
    model.fields = model.fields.filter((field) => columns.has(field.name));
    counts.push({ table: model.name, rows: source.prepare(`SELECT COUNT(*) AS total FROM ${quote(model.name)}`).get().total });
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : "preview", sourceIntegrity: "ok", tables: counts }, null, 2));
  if (apply) {
    await target.connect();
    await target.query("BEGIN"); transaction = true;
    await target.query(`SET LOCAL search_path TO ${quote(namespace)}`);
    // The target is a new database. No overwrite, truncate, delete or upsert occurs.
    await target.query(`LOCK TABLE ${models.map((model) => `${quote(namespace)}.${quote(model.name)}`).join(", ")} IN ACCESS EXCLUSIVE MODE`);
    for (const model of models) {
      const { rows } = await target.query(`SELECT COUNT(*)::integer AS total FROM ${quote(model.name)}`);
      if (rows[0].total !== 0) throw new Error(`Target ${model.name} is not empty; refusing to overwrite data.`);
    }
    for (const model of models) {
      const columns = model.fields.map((field) => quote(field.name)).join(", ");
      const parameters = model.fields.map((_, index) => `$${index + 1}`).join(", ");
      let copied = 0;
      for (const row of sqliteMigrationRows(source, model.name, model.fields.map((field) => field.name))) {
        await target.query(`INSERT INTO ${quote(model.name)} (${columns}) VALUES (${parameters})`, model.fields.map((field) => convert(row[field.name], field.type)));
        copied++;
      }
      const { rows } = await target.query(`SELECT COUNT(*)::integer AS total FROM ${quote(model.name)}`);
      if (rows[0].total !== copied) throw new Error(`Count verification failed for ${model.name}.`);
    }
    // Verify the largest payloads without printing any private data.
    const sourceBytes = source.prepare('SELECT COALESCE(SUM(length("data")),0) AS total FROM "UploadedImage"').get().total;
    const { rows } = await target.query('SELECT COALESCE(SUM(octet_length("data")),0)::bigint AS total FROM "UploadedImage"');
    if (BigInt(sourceBytes) !== BigInt(rows[0].total)) throw new Error("Uploaded image byte verification failed.");
    await target.query("COMMIT"); transaction = false;
    console.log("Copy committed. Row counts and uploaded image byte totals match. Source remains unchanged. Verify sign-in/catalog/private uploads before changing application configuration.");
  } else {
    console.log("Preview only: source opened read-only; no target connection or writes. Apply only to an empty, migrated PostgreSQL database after pausing writes and backing up.");
  }
} catch (error) {
  if (transaction) await target.query("ROLLBACK");
  // Avoid printing database URLs, credentials, row contents, or provider errors.
  console.error(error instanceof Error && /^(Missing source|Target |Count verification|Uploaded image|Source integrity|A source)/.test(error.message) ? error.message : "Migration did not complete; all uncommitted target changes were rolled back. Check the schema, connectivity and source backup privately.");
  process.exitCode = 1;
} finally {
  source.close();
  await target.end();
}
