// اختبار متكامل على القاعدة الحيّة — بلا مساس ببيعة حقيقية.
//
// كل طلب يُنشأ بمعرّف عميل ببادئة `e2e-`، ويُحذف في النهاية **بمعرّفه هو**.
// لا `delete from orders` ولا حذف بالتاريخ: المحل يبيع، وأمرٌ واسع يمحو
// مبيعات اليوم. وإن انقطع السكربت في منتصفه، تشغيله ثانيةً ينظّف ما سبق.
//
//   node scripts/e2e-check.mjs
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
const REF = env.NEXT_PUBLIC_SUPABASE_URL.match(/\/\/([a-z0-9]+)\./)[1];
const H = { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" };

/** معرّفات ثابتة: التشغيل الثاني ينظّف ما خلّفه الأول. */
const TAG = "e2e00000-0000-4000-8000-0000000000";
const cid = (n) => `${TAG}${String(n).padStart(2, "0")}`;

async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ query: q }),
  });
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    return { error: t.slice(0, 200) };
  }
}
const one = async (q) => (await sql(q))[0] ?? {};
const err = (r) => (r && r.message) || (r && r.error) || "";

let pass = 0;
let fail = 0;
function check(label, ok, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? " — " + detail : ""}`);
  if (ok) pass++;
  else fail++;
}

// ── تنظيف أي بقايا من تشغيل سابق ─────────────────────────────────────────
async function cleanup(quiet = false) {
  const rows = await sql(`select id from orders where client_id::text like '${TAG}%'`);
  if (!Array.isArray(rows) || !rows.length) {
    if (!quiet) console.log("  (لا بقايا)");
    return 0;
  }
  const ids = rows.map((r) => `'${r.id}'`).join(",");
  await sql(`delete from loyalty_events where order_id in (${ids})`);
  await sql(`delete from order_items where order_id in (${ids})`);
  await sql(`delete from orders where id in (${ids})`);
  if (!quiet) console.log(`  حُذف ${rows.length} صفّاً تجريبياً`);
  return rows.length;
}

const place = (lines, clientId, table = "null", channel = "qr") =>
  sql(
    `select * from place_order('${channel}'::order_channel, ` +
      `jsonb_build_array(${lines}), null, ${table}, null, '[]'::jsonb, null, null, null, '${clientId}'::uuid)`,
  );
const line = (id, qty) => `jsonb_build_object('item_id','${id}','qty',${qty})`;

// ─────────────────────────────────────────────────────────────────────────
console.log("\n════ اختبار متكامل — هيل ════\n");

const before = await one("select count(*) n, coalesce(sum(subtotal),0) s from orders");
console.log(`الطلبات الحقيقية قبل الاختبار: ${before.n} بمبلغ ${before.s}\n`);

console.log("تنظيف بقايا سابقة:");
await cleanup();

const pastry = (await one(`select id from menu_items where name_ar='صمون الذرة'`)).id;
const cafeItem = (await one(`select id from menu_items where name_ar='ايس امريكانو'`)).id;
if (!pastry || !cafeItem) {
  console.error("✗ لم يُعثر على أصناف الاختبار");
  process.exit(1);
}

// ١ — طلب بسيط
console.log("\n١) طلب بسيط");
const r1 = await place(line(pastry, 2), cid(1));
check("يُنشأ ويُقيَّد بقسمه", Array.isArray(r1) && r1[0]?.station_slug === "pastry", err(r1));

// ٢ — طلب مشترك
console.log("\n٢) طلب مشترك بين القسمين");
const r2 = await place(`${line(pastry, 1)},${line(cafeItem, 1)}`, cid(2));
check("ينقسم صفّين", Array.isArray(r2) && r2.length === 2, `عدد الصفوف: ${r2?.length}`);
check("بتذكرة واحدة", Array.isArray(r2) && r2[0]?.group_no === r2[1]?.group_no);

// ٣ — إعادة الإرسال (حماية العمل بلا إنترنت)
console.log("\n٣) إعادة إرسال نفس الطلب");
const dup = await place(line(pastry, 2), cid(1));
const n1 = await one(`select count(*) n from orders where client_id='${cid(1)}'`);
check("لا يُسجَّل مرتين", Number(n1.n) === 1, `الصفوف: ${n1.n}`);
check("يُعاد الطلب الأصلي", Array.isArray(dup) && dup[0]?.group_no === r1[0]?.group_no);

// ٤ — البيع بالوزن
console.log("\n٤) البيع بالوزن");
const w = await one(`select id, price from menu_items where sold_by='weight' limit 1`);
if (w.id) {
  await sql(`update menu_items set is_active=true, price=15000 where id='${w.id}'`);
  await place(line(w.id, 0.04), cid(4));
  const wl = await one(
    `select qty, unit_price, line_total from order_items where order_id in (select id from orders where client_id='${cid(4)}')`,
  );
  check("٤٠ غم × ١٥٬٠٠٠ = ٦٠٠ بالضبط", Number(wl.line_total) === 600, `الناتج: ${wl.line_total}`);
  await sql(`update menu_items set is_active=false, price=${w.price} where id='${w.id}'`);
} else check("صنف موزون متاح", false, "لا يوجد");

// ٥ — التقريب على ٢٥٠
console.log("\n٥) التقريب على ٢٥٠");
const step = await one("select iqd_step() s");
check("أصغر فئة ٢٥٠", Number(step.s) === 250);
const round = await one(
  "with t(raw) as (values (600),(3750),(8492)) select string_agg(raw||'→'||(round(raw::numeric/250)*250)::int, ' · ') r from t",
);
check("الحساب صحيح", String(round.r) === "600→500 · 3750→3750 · 8492→8500", String(round.r));

// ٦ — طاولة مغلقة وغير موجودة
console.log("\n٦) حارس الطاولات");
const closed = await place(line(pastry, 1), cid(6), "'9'");
check("الطاولة المغلقة تُرفض", String(err(closed)).includes("table_closed"), err(closed).slice(0, 40));
const unknown = await place(line(pastry, 1), cid(7), "'99'");
check("الطاولة المجهولة تُرفض", String(err(unknown)).includes("table_unknown"));
const open = await place(line(pastry, 1), cid(8), "'3'");
check("الطاولة المفتوحة تُقبل", Array.isArray(open) && open.length > 0);

// ٧ — التقارير تطابق الطلبات
console.log("\n٧) التقارير");
const mine = await one(
  `select coalesce(sum(subtotal),0) s from orders where client_id::text like '${TAG}%'`,
);
check("مبالغ الاختبار مسجَّلة", Number(mine.s) > 0, `${mine.s} د.ع`);
const cov = await one("select pct from cost_coverage(current_date, current_date)");
check("قياس تغطية الكلفة يعمل", cov.pct !== undefined, `${cov.pct}%`);

// ٨ — لا تسريب للزائر
console.log("\n٨) خصوصية البيانات");
const K = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const anonH = { apikey: K, Authorization: `Bearer ${K}` };
for (const t of ["item_margins", "inventory_view", "app_settings"]) {
  const rr = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${t}?select=*&limit=1`, { headers: anonH });
  let n = 0;
  try {
    const j = await rr.json();
    n = Array.isArray(j) ? j.length : 0;
  } catch { /* محجوب */ }
  check(`${t} محجوب عن الزائر`, n === 0);
}

// ── تنظيف ────────────────────────────────────────────────────────────────
console.log("\n٩) التنظيف");
const removed = await cleanup(true);
console.log(`  حُذف ${removed} صفّاً تجريبياً`);
const after = await one("select count(*) n, coalesce(sum(subtotal),0) s from orders");
check(
  "الطلبات الحقيقية سليمة",
  Number(after.n) === Number(before.n) && Number(after.s) === Number(before.s),
  `${after.n} طلباً بمبلغ ${after.s}`,
);

console.log(`\n════ ${pass} نجح · ${fail} فشل ════\n`);
process.exit(fail ? 1 : 0);
