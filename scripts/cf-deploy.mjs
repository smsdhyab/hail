// Builds and deploys the app to Cloudflare Workers, then pushes the runtime
// secrets from .env.local so they never live in a committed file.
//
//   node scripts/cf-deploy.mjs
//
// Needs CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID (or CF_* in .env.local),
// and the account must already have a workers.dev subdomain registered — that
// is a one-time choice of a public name, made in the Cloudflare dashboard.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const env = {};
try {
  for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {
  /* rely on the real environment */
}

const token = process.env.CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) {
  console.error("Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (in .env.local or the environment).");
  process.exit(1);
}
const childEnv = { ...process.env, CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account };
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: root, stdio: "inherit", env: childEnv, shell: true, ...opts });

// What the server reads at request time. NEXT_PUBLIC_* are public by design but
// are still uploaded as secrets so the repo never carries a value.
const RUNTIME_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "POINTS_PER_IQD",
  "POINTS_PER_REWARD",
  "REWARD_VALUE_IQD",
  "WEB_PUSH_PUBLIC_KEY",
  "WEB_PUSH_PRIVATE_KEY",
  "MODERN_ONLY",
];

console.log("→ building…");
run("npx", ["opennextjs-cloudflare", "build"]);

console.log("→ deploying…");
run("npx", ["opennextjs-cloudflare", "deploy"]);

const secrets = Object.fromEntries(RUNTIME_KEYS.filter((k) => env[k]).map((k) => [k, env[k]]));
if (Object.keys(secrets).length) {
  console.log(`→ uploading ${Object.keys(secrets).length} runtime secrets…`);
  run("npx", ["wrangler", "secret", "bulk"], { input: JSON.stringify(secrets), stdio: ["pipe", "inherit", "inherit"] });
}
console.log("✓ done");
