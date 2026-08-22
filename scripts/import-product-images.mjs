// Imports the AI-designed product photos into Supabase Storage and links them to
// menu items (menu_items.image_url). Re-runnable: same paths are overwritten, so
// when the designer delivers the clean (no-text) set with the SAME numbering,
// just run it again.
//   Usage: node scripts/import-product-images.mjs [sourceDir]
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";
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
  } catch { /* env */ }
}
loadEnv();

// --staging: upload to products-v2/ WITHOUT touching the live menu (preview at
// /menu/modern?preview=v2). Approve later by re-running WITHOUT --staging.
// --only=NN: import a single numbered image (e.g. a newly added product) without
// touching the rest.
const args = process.argv.slice(2);
const STAGING = args.includes("--staging");
const ONLY = args.find((a) => a.startsWith("--only="))?.slice(7) ?? null;
const SRC = args.find((a) => !a.startsWith("--")) ?? "C:/Users/al3r1/Documents/Codex/2026-07-22/referenced-chatgpt-conversation-this-is-untrusted/outputs/HAIL-All-Products";

// image number (01-36) → exact menu_items.name_ar
const MAP = {
  "01": "إسبريسو", "02": "دبل إسبريسو", "03": "أمريكانو", "04": "لاتيه",
  "05": "لاتيه منكّه", "06": "سبانش لاتيه", "07": "كراميل ماكياتو", "08": "موكا",
  "09": "قهوة تركية", "10": "قهوة بالشوكولاتة", "11": "هوت شوكليت", "12": "شاي كرك",
  "13": "آيس أمريكانو", "14": "آيس لاتيه", "15": "آيس لاتيه منكّه", "16": "آيس سبانش لاتيه",
  "17": "آيس كراميل ماكياتو", "18": "آيس موكا", "19": "آيس تي ليمون", "20": "آيس تي توت",
  "21": "موهيتو كلاسيك", "22": "موهيتو صودا", "23": "موهيتو طاقة",
  "24": "ميلك شيك كوكيز", "25": "ميلك شيك أوريو", "26": "ميلك شيك نوتيلا", "27": "ميلك شيك لوتس",
  "28": "سموذي فراولة", "29": "سموذي أناناس", "30": "سموذي مانجو", "31": "سموذي رمان",
  "32": "فرابيه كراميل", "33": "فرابيه فانيلا",
  "34": "كرواسون", "35": "دونات", "36": "كوكيز",
  "37": "قهوة متخصصة V60",
};

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let ok = 0, missing = 0, failed = 0;
for (const [num, name] of Object.entries(MAP)) {
  if (ONLY && num !== ONLY.padStart(2, "0")) continue;
  // designer set first (clean), current promo set as fallback
  const candidates = [`HAIL-Item-${num}.png`, `HAIL-Product-${num}.png`, `HAIL-Item-${num}.jpg`, `HAIL-Product-${num}.jpg`];
  const file = candidates.map((f) => join(SRC, f)).find(existsSync);
  if (!file) { console.log(`✗ ${num} ${name}: no file`); missing++; continue; }

  try {
    // The interim HAIL-Product promo posters have the name/price baked into the top
    // ~33% — crop it out (720×900 = clean 4:5 around the product). The designer's
    // clean HAIL-Item set has no text and is used as-is.
    const isPromo = file.includes("HAIL-Product-");
    let img = sharp(file);
    if (isPromo) {
      const meta = await img.metadata();
      const top = Math.round(meta.height * 0.335);
      const height = meta.height - top;
      const width = Math.min(meta.width, Math.round(height * 0.8));
      const left = Math.round((meta.width - width) / 2);
      img = img.extract({ left, top, width, height });
    }
    // two sizes: 800w main + 400w for phones/weak connections (srcset)
    const [webp, webpSm] = await Promise.all([
      img.clone().resize(800, 1000, { fit: "cover" }).webp({ quality: 80 }).toBuffer(),
      img.clone().resize(400, 500, { fit: "cover" }).webp({ quality: 70 }).toBuffer(),
    ]);
    const prefix = STAGING ? "products-v2" : "products";
    const path = `${prefix}/${num}.webp`;
    const { error: upErr } = await supabase.storage.from("menu").upload(path, webp, { contentType: "image/webp", upsert: true });
    if (upErr) throw new Error(upErr.message);
    const { error: upSmErr } = await supabase.storage.from("menu").upload(`${prefix}/${num}-sm.webp`, webpSm, { contentType: "image/webp", upsert: true });
    if (upSmErr) throw new Error(upSmErr.message);
    if (STAGING) {
      console.log(`✓ ${num} ${name} (staged)`);
      ok++;
      continue;
    }
    const { data: pub } = supabase.storage.from("menu").getPublicUrl(path);
    // cache-bust so replaced images show immediately
    const url = `${pub.publicUrl}?v=${Date.now()}`;
    const { error: dbErr, count } = await supabase.from("menu_items").update({ image_url: url }, { count: "exact" }).eq("name_ar", name);
    if (dbErr) throw new Error(dbErr.message);
    if (!count) { console.log(`✗ ${num}: item «${name}» not found in DB`); failed++; continue; }
    console.log(`✓ ${num} ${name}`);
    ok++;
  } catch (e) {
    console.log(`✗ ${num} ${name}: ${e.message}`);
    failed++;
  }
}
console.log(`\nDone: ${ok} linked, ${missing} missing files, ${failed} failed.`);
