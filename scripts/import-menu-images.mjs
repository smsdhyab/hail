// Uploads the generated menu photos to Supabase storage and links each one to
// its item.
//
//   node scripts/import-menu-images.mjs                        # every p/pN folder
//   node scripts/import-menu-images.mjs p4                     # just one folder
//   node scripts/import-menu-images.mjs --item "كعب غزال" x.png  # replace one item
//
// The link between a picture and an item is its POSITION: folder pN holds the
// items of prompt N, and 1.png…10.png follow that prompt's order. The prompt
// list and this script both read the same catalog, so they cannot disagree —
// and an incomplete folder is refused rather than shifted, because one missing
// picture would silently label every item after it with the wrong photo.
//
// Two sizes go up per item: the full 800px webp, and a -sm 400px one the menu
// grid loads first (the shop is on an Iraqi connection — the small file is what
// makes the menu feel instant).
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { HAIL_MENU } from "../src/lib/cafe/hail-menu.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) {
      const v = m[2].trim().replace(/^["']|["']$/g, "");
      if (v) process.env[m[1]] = v;
    }
  }
}
loadEnv();

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SVC) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const H = { apikey: SVC, Authorization: `Bearer ${SVC}` };

// same chunking as scripts/make-image-prompts.mjs — prompt N ⇢ folder pN
const CHUNK = 10;
const active = HAIL_MENU.flatMap((c) =>
  c.items.filter((i) => i.active !== false).map((i) => ({ ...i, cat: c.name_ar })),
);
const groups = [];
for (let i = 0; i < active.length; i += CHUNK) groups.push(active.slice(i, i + CHUNK));

/** Upload one picture in both sizes and point the item at it. */
async function publish(item, src) {
  const full = await sharp(src).resize(800, 1000, { fit: "cover" }).webp({ quality: 82 }).toBuffer();
  const small = await sharp(src).resize(400, 500, { fit: "cover" }).webp({ quality: 78 }).toBuffer();
  const base = `items/${item.id}`;

  for (const [path, body] of [
    [`${base}.webp`, full],
    [`${base}-sm.webp`, small],
  ]) {
    const r = await fetch(`${URL_}/storage/v1/object/${encodeURI(`menu/${path}`)}`, {
      method: "POST",
      headers: { ...H, "Content-Type": "image/webp", "x-upsert": "true" },
      body,
    });
    if (!r.ok) throw new Error(`upload ${r.status}: ${(await r.text()).slice(0, 120)}`);
  }

  // Cache-bust on replacement: the CDN and every open tablet still hold the old
  // picture at the same path, so the URL has to change for them to refetch.
  const url = `${URL_}/storage/v1/object/public/menu/${base}.webp?v=${Date.now()}`;
  const patch = await fetch(`${URL_}/rest/v1/menu_items?name_ar=eq.${encodeURIComponent(item.name_ar)}`, {
    method: "PATCH",
    headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ image_url: url }),
  });
  if (!patch.ok) throw new Error(`link ${patch.status}: ${(await patch.text()).slice(0, 120)}`);
}

// ── single item: fix one photo without touching its folder ────────────────
if (process.argv[2] === "--item") {
  const [, , , name, file] = process.argv;
  const item = active.find((i) => i.name_ar === name || i.id === name);
  if (!item) {
    console.error(`لا يوجد صنف باسم «${name}».`);
    process.exit(1);
  }
  if (!file || !existsSync(file)) {
    console.error(`الملف غير موجود: ${file}`);
    process.exit(1);
  }
  await publish(item, file);
  console.log(`✓ ${item.name_ar} ← ${file}`);
  process.exit(0);
}

// ── whole folders ─────────────────────────────────────────────────────────
const only = process.argv[2]?.replace(/^p/, "");
let uploaded = 0;
let waiting = 0;

for (let g = 0; g < groups.length; g++) {
  if (only && String(g + 1) !== only) continue;
  const folder = join(root, "p", `p${g + 1}`);
  if (!existsSync(folder)) continue;

  const files = readdirSync(folder)
    .filter((f) => /^\d+\.(png|jpe?g|webp)$/i.test(f))
    .sort((a, b) => parseInt(a) - parseInt(b));
  if (!files.length) continue;

  if (files.length !== groups[g].length) {
    console.warn(`⚠ p${g + 1}: ${files.length} صورة مقابل ${groups[g].length} صنفاً — أتخطّاه حتى يكتمل`);
    waiting += groups[g].length;
    continue;
  }

  for (let i = 0; i < files.length; i++) {
    const item = groups[g][i];
    try {
      await publish(item, join(folder, files[i]));
      uploaded++;
      console.log(`✓ p${g + 1}/${files[i]}  →  ${item.name_ar}`);
    } catch (e) {
      console.error(`✗ ${item.name_ar}: ${e.message}`);
    }
  }
}

console.log(`\n${uploaded} صورة مرفوعة ومربوطة${waiting ? ` · ${waiting} صنفاً بانتظار اكتمال مجلده` : ""}`);
