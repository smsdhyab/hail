// Schedules (or re-schedules) the nightly Telegram report inside Supabase:
// pg_cron calls the telegram-bot edge function at 20:59 UTC = 23:59 Baghdad.
// Secrets come from .env.local at runtime — nothing sensitive lives in this file.
// Run: node scripts/schedule-nightly-cron.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8")
    .split(/\r?\n/).map((l) => l.match(/^([A-Za-z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]),
);
for (const k of ["SUPABASE_DB_URL", "NEXT_PUBLIC_SUPABASE_URL", "TG_WEBHOOK_SECRET"]) {
  if (!env[k]) { console.error(`${k} missing in .env.local`); process.exit(1); }
}

const sql = `
do $do$ begin perform cron.unschedule('hail-nightly-report'); exception when others then null; end $do$;
select cron.schedule(
  'hail-nightly-report',
  '59 20 * * *',
  $job$select net.http_post(
    url := '${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/telegram-bot?job=daily',
    headers := '{"x-job-secret": "${env.TG_WEBHOOK_SECRET}", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  )$job$
);`;

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query(sql);
const jobs = await c.query("select jobname, schedule, active from cron.job");
console.log("✓ cron jobs:", JSON.stringify(jobs.rows));
await c.end();
