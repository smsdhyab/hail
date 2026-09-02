// ماذا يستطيع أي زائر على الإنترنت قراءته؟
//
// يُشغَّل بعد كل هجرة تمسّ عرضاً أو صلاحية. عرضٌ في بوستغرس يعمل افتراضياً
// بصلاحيات مُنشئه فيتجاوز RLS الجداول تحته — وهكذا تسرّبت كلفة ١٣٤ صنفاً
// وهوامش ربحها للإنترنت دون أن يظهر ذلك في أي تنبيه.
//
//   node scripts/anon-audit.mjs        → يخرج بـ1 إن تسرّب شيء
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Za-z_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

/** ما يجب أن يقرأه الزائر — المنيو وما يلزم للطلب. */
const PUBLIC = [
  "menu_public",
  "variant_public",
  "combo_public",
  "combos",
  "combo_items",
  "categories",
  "stations",
  "active_tables",
  "active_offers",
  "active_item_offers",
  "public_settings",
];

/** ما لا يجوز أن يراه — كلفة، أرباح، مخزون، زبائن، موظفون، مال. */
const PRIVATE = [
  "item_margins",
  "inventory_view",
  "inventory",
  "purchases",
  "expenses",
  "employees",
  "customers",
  "loyalty_events",
  "orders",
  "order_items",
  "menu_items",
  "app_settings",
  "bot_state",
  "roles",
  "order_counters",
  "register_closures",
  "monthly_costs",
  "debt_entries",
];

async function rows(table) {
  const r = await fetch(`${URL_}/rest/v1/${table}?select=*&limit=2`, { headers: H });
  if (!r.ok) return { blocked: true, n: 0 };
  try {
    const j = await r.json();
    return { blocked: false, n: Array.isArray(j) ? j.length : 0 };
  } catch {
    return { blocked: true, n: 0 };
  }
}

let leaked = 0;
let broken = 0;

console.log("\n── يجب أن يبقى مفتوحاً (المنيو يعتمد عليه) ──");
for (const t of PUBLIC) {
  const { blocked } = await rows(t);
  // الفارغ مقبول (لا عروض اليوم مثلاً) — المرفوض وحده خلل
  if (blocked) {
    console.log(`  ✗ ${t} — محجوب، والمنيو يحتاجه`);
    broken++;
  } else {
    console.log(`  ✓ ${t}`);
  }
}

console.log("\n── يجب أن يكون محجوباً ──");
for (const t of PRIVATE) {
  const { blocked, n } = await rows(t);
  if (!blocked && n > 0) {
    console.log(`  ⚠ ${t} — مكشوف (${n}+ صفوف)`);
    leaked++;
  } else {
    console.log(`  ✓ ${t}`);
  }
}

console.log("");
if (leaked || broken) {
  console.error(`✗ ${leaked} تسريباً · ${broken} عطلاً في المنيو`);
  process.exit(1);
}
console.log("✓ لا تسريب — والمنيو يعمل.");
