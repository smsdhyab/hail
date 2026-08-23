// يضيف أصناف الميزان الناقصة إلى المنيو — موزونة، بلا سعر، معطّلة حتى تُسعَّر.
// الرمز (plu) يبقى فارغاً حتى يتأكّد نمط الترميز من ملصقين إضافيين.
import { readFileSync } from "node:fs";

const e = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Za-z_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
);
const URL_ = e.NEXT_PUBLIC_SUPABASE_URL;
const H = { apikey: e.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${e.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };

// [الاسم, القسم, مفتاح الميزان] — المفتاح من صورة لوحة الميزان
const ITEMS = [
  ["برازق", "الكعك", 7],
  ["كليجة", "الكعك", 32],
  ["كعك طماطة", "الكعك", 19],
  ["تونست محمص تركي", "الكعك", 20],
  ["سابليه تركي جلقات", "الكعك", 12],

  ["بقلاوة تركي فستق عنتاب", "البقلاوة", 9],
  ["زلابية فستق", "البقلاوة", 10],
  ["زلابية حب سودة", "البقلاوة", 11],
  ["شكر لمة", "البقلاوة", 38],
  ["من السما", "البقلاوة", 25],
  ["ميماس", "البقلاوة", 26],
  ["برازيلي", "المعجنات", 33],
  ["اصابع سمسم", "المعجنات", 34],

  ["جكليت هزار", "الشوكولاتة", 21],
  ["رافيلو", "الشوكولاتة", 22],
  ["يم يم", "الشوكولاتة", 23],
  ["جكليت حليب", "الشوكولاتة", 28],
  ["جكليت انكليزي", "الشوكولاتة", 31],
  ["مربعات فضي وذهبي", "الشوكولاتة", 29],
  ["قمر الدين", "الشوكولاتة", 27],

  ["حلقوم جوز", "الحلقوم", 35],
];

const get = async (path) => (await fetch(`${URL_}/rest/v1/${path}`, { headers: H })).json();

const cats = await get("categories?select=id,name_ar");
const byName = new Map(cats.map((c) => [c.name_ar, c.id]));
const existing = new Set((await get("menu_items?select=name_ar")).map((i) => i.name_ar));

const rows = [];
for (const [name_ar, cat, key] of ITEMS) {
  if (existing.has(name_ar)) {
    console.log(`= موجود مسبقاً: ${name_ar}`);
    continue;
  }
  const category_id = byName.get(cat);
  if (!category_id) {
    console.error(`✗ لا يوجد قسم «${cat}»`);
    process.exit(1);
  }
  rows.push({
    category_id,
    name_ar,
    price: 0,
    cost: 0,
    is_active: false, // سعره صفر — تفعيله قبل تسعيره يعني بيعه مجاناً
    sold_by: "weight",
    unit_label: "كغم",
    sort: 100 + key,
  });
}

if (!rows.length) {
  console.log("لا جديد.");
  process.exit(0);
}

const r = await fetch(`${URL_}/rest/v1/menu_items`, { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(rows) });
if (!r.ok) {
  console.error(`✗ ${r.status}: ${(await r.text()).slice(0, 300)}`);
  process.exit(1);
}
const made = await r.json();
for (const m of made) console.log(`✓ ${m.name_ar}`);
console.log(`\n${made.length} صنفاً موزوناً أُضيف — كلها معطّلة بسعر صفر حتى تُسعَّر من إدارة المنيو.`);
