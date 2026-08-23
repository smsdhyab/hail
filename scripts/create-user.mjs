// Creates a staff login: auth user + linked employees row with a role.
// Logins without "@" become <login>@hail.iq — this is how phone-number and
// username sign-in works (the sign-in form applies the same mapping).
// A CASHIER must be tied to a register (pastry|cafe) — that is what scopes their
// order queue, their receipts and their sales figures. An admin may omit it and
// works either till.
//   Usage: node scripts/create-user.mjs <login> <password> <name_ar> <admin|cashier> [pastry|cafe]
//   e.g.:  node scripts/create-user.mjs 07802525022 Secret123 "الإدارة" admin
//          node scripts/create-user.mjs 07701234567 Secret123 "أبو أحمد" cashier pastry
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function loadEnv() {
  try {
    const raw = readFileSync(join(root, ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m && process.env[m[1]] === undefined) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        process.env[m[1]] = v;
      }
    }
  } catch { /* rely on env */ }
}
loadEnv();

const [login, password, name, roleName, stationSlug] = process.argv.slice(2);
if (!login || !password || !name || !["admin", "cashier"].includes(roleName)) {
  console.error("usage: node scripts/create-user.mjs <login> <password> <name_ar> <admin|cashier> [pastry|cafe]");
  process.exit(1);
}
if (stationSlug && !["pastry", "cafe", "both"].includes(stationSlug)) {
  console.error("✗ station must be «pastry», «cafe» or «both»");
  process.exit(1);
}
if (roleName === "cashier" && !stationSlug) {
  console.error("✗ a cashier needs a register: add «pastry», «cafe» or «both» as the 5th argument");
  process.exit(1);
}
const email = login.includes("@") ? login : `${login}@hail.iq`;

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// 1) auth user (find-or-create, then force the given password)
let userId;
{
  const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  userId = data?.user?.id;
  if (!userId) {
    if (error && !/registered|exists/i.test(error.message)) {
      console.error(`✗ createUser: ${error.message}`);
      process.exit(1);
    }
    const { data: list } = await supabase.auth.admin.listUsers();
    userId = list?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
    if (userId) await supabase.auth.admin.updateUserById(userId, { password });
  }
}
if (!userId) { console.error("✗ could not resolve auth user"); process.exit(1); }

// 2) role
const { data: role } = await supabase.from("roles").select("id").eq("name_en", roleName).single();
if (!role) { console.error(`✗ role ${roleName} not found`); process.exit(1); }

// 3) register (cashiers only)
// «both» يُخزَّن قسماً فارغاً: كاشير موحَّد يبيع القسمين من صندوق واحد.
// الدفتران يبقيان منفصلين لأن الفصل يتم بالصنف لا بالحساب.
let stationId = null;
if (stationSlug && stationSlug !== "both") {
  const { data: st } = await supabase.from("stations").select("id").eq("slug", stationSlug).maybeSingle();
  if (!st) { console.error(`✗ station ${stationSlug} not found — apply 0021_stations.sql first`); process.exit(1); }
  stationId = st.id;
}

// 4) employee row linked to the auth user
const row = { name_ar: name, role_id: role.id, station_id: stationId, is_active: true };
const { data: existing } = await supabase.from("employees").select("id").eq("auth_user_id", userId).maybeSingle();
if (existing) {
  await supabase.from("employees").update(row).eq("id", existing.id);
} else {
  const { error } = await supabase.from("employees").insert({ ...row, auth_user_id: userId });
  if (error) { console.error(`✗ employee insert: ${error.message}`); process.exit(1); }
}
console.log(`✓ ${roleName}${stationSlug ? ` (${stationSlug})` : ""} ready: ${login} (${email})`);
