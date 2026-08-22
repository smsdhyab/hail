// Uploads the generated menu photos to Supabase storage and links each one to
// its item.
//
//   node scripts/import-menu-images.mjs           # every p/pN folder present
//   node scripts/import-menu-images.mjs p4        # just one
//
// The link between a picture and an item is its POSITION: folder pN holds the
// items of prompt N, and 1.png…10.png follow that prompt's order. The prompt
// list and this script both read the same catalog, so they cannot disagree.
//
// Two sizes are uploaded per item: the full 800px webp, and a -sm 400px one the
// menu grid loads first (the shop is on an Iraqi connection — the small file is
// what makes the menu feel instant).
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
const active = HAIL_MENU.flatMap((c) => c.items.filter((i) => i.active !== false).map((i) => ({ ...i, cat: c.name_ar })));
const groups = [];
for (let i = 0; i < active.length; i += CHUNK) groups.push(active.slice(i, i + CHUNK));

const only = process.argv[2]?.replace(/^p/, "");
let uploaded = 0;
let skipped = 0;

for (let g = 0; g < groups.length; g++) {
  const folder = join(root, "p", `p${g + 1}`);
  if (only && String(g + 1) !== only) continue;
  if (!existsSync(folder)) continue;

  const files = readdirSync(folder)
    .filter((f) => /^\d+\.(png|jpe?g|webp)$/i.test(f))
    .sort((a, b) => parseInt(a) - parseInt(b));

  if (!files.length) continue;
  if (files.length !== groups[g].length) {
    console.warn(`⚠ p${g + 1}: ${files.length} صورة مقابل ${groups[g].length} صنفاً — أتخطّاه حتى يكتمل`);
    skipped += groups[g].length;
    continue;
  }

  for (let i = 0; i < files.length; i++) {
    const item = groups[g][i];
    const src = join(folder, files[i]);

    // one 800px master + one 400px thumbnail the grid loads first
    const full = await sharp(src).resize(800, 1000, { fit: "cover" }).webp({ quality: 82 }).toBuffer();
    const small = await sharp(src).resize(400, 500, { fit: "cover" }).webp({ quality: 78 }).toBuffer();

    const base = `items/${item.id}`;
    for (const [path, body] of [[`${base}.webp`, full], [`${base}-sm.webp`, small]]) {
      const r = await fetch(`${URL_}/storage/v1/object/${encodeURI(`menu/${path}`)}`, {
        method: "POST",
        headers: { ...H, "Content-Type": "image/webp", "x-upsert": "true" },
        body,
      });
      if (!r.ok) {
        console.error(`✗ ${item.name_ar}: ${r.status} ${(await r.text()).slice(0, 120)}`);
        continue;
      }
    }

    const publicUrl = `${URL_}/storage/v1/object/public/menu/${base}.webp`;
    const patch = await fetch(`${URL_}/rest/v1/menu_items?name_ar=eq.${encodeURIComponent(item.name_ar)}`, {
      method: "PATCH",
      headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ image_url: publicUrl }),
    });
    if (!patch.ok) {
      console.error(`✗ ${item.name_ar}: link ${patch.status} ${(await patch.text()).slice(0, 120)}`);
      continue;
    }
    uploaded++;
    console.log(`✓ p${g + 1}/${files[i]}  →  ${item.name_ar}`);
  }
}

console.log(`\n${uploaded} صورة مرفوعة ومربوطة${skipped ? ` · ${skipped} صنفاً بانتظار صوره` : ""}`);
