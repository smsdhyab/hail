// Applies .sql migrations to the project's Postgres database.
//
// Two routes, whichever is configured:
//   1. SUPABASE_DB_URL   → direct Postgres connection (needs the DB password)
//   2. SUPABASE_ACCESS_TOKEN → Supabase Management API (no password needed)
//
// Usage:
//   node scripts/db-apply.mjs supabase/migrations/0001_init.sql   # one file
//   node scripts/db-apply.mjs --all                               # every migration, in order
// Migrations are idempotent, so re-running is safe.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Minimal .env.local loader (no dotenv dependency).
function loadEnv() {
  try {
    const raw = readFileSync(join(root, ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (v) process.env[m[1]] = v;
      }
    }
  } catch {
    /* no .env.local — rely on the real environment */
  }
}
loadEnv();

const arg = process.argv[2];
if (!arg) {
  console.error("usage: node scripts/db-apply.mjs <path-to.sql> | --all");
  process.exit(1);
}

const files =
  arg === "--all"
    ? readdirSync(join(root, "supabase", "migrations"))
        .filter((f) => f.endsWith(".sql"))
        .sort()
        .map((f) => `supabase/migrations/${f}`)
    : [arg];

/** Route 2: the Management API runs SQL without the database password. */
async function applyViaApi(sql, file) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  if (!ref) throw new Error("NEXT_PUBLIC_SUPABASE_URL is missing or malformed");
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 400)}`);
  return `${file} (api)`;
}

/** Route 1: a direct connection, when the DB URL is available. */
async function applyViaPg(sql, file) {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
  return `${file} (pg)`;
}

const useApi = !process.env.SUPABASE_DB_URL && process.env.SUPABASE_ACCESS_TOKEN;
if (!process.env.SUPABASE_DB_URL && !process.env.SUPABASE_ACCESS_TOKEN) {
  console.error("Set SUPABASE_DB_URL or SUPABASE_ACCESS_TOKEN in .env.local.");
  process.exit(1);
}

for (const file of files) {
  const sql = readFileSync(join(root, file), "utf8");
  try {
    console.log(`✓ applied ${await (useApi ? applyViaApi(sql, file) : applyViaPg(sql, file))}`);
  } catch (error) {
    console.error(`✗ failed to apply ${file}: ${error.message}`);
    process.exit(1);
  }
}
