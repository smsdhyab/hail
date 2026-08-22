// Generates the PWA / favicon icon set + the UI logo from the OFFICIAL logo
// bitmap at public/icons/logo.png (transparent PNG). Falls back to the vector
// redraw if the bitmap is missing. Run: node scripts/make-pwa-icons.mjs
import sharp from "sharp";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "icons");
mkdirSync(out, { recursive: true });

const DARK = "#3c5030";   // HAIL olive
const logoPng = join(out, "logo.png");

/** Vector fallback mark (used only when public/icons/logo.png is absent). */
function brandSvg({ radius, scale }) {
  const s = scale;
  const t = (512 - 512 * s) / 2;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${radius}" fill="${DARK}"/>
  <g transform="translate(${t} ${t}) scale(${s})" fill="none" stroke="#f2924c" stroke-width="22" stroke-linecap="round">
    <path d="M292 92c-26 30 16 46-8 78"/>
    <path d="M336 106c-20 24 12 38-6 62"/>
    <path d="M118 234h236c4 66-50 112-118 112s-120-46-118-112z" fill="#f2924c" stroke="none"/>
    <path d="M368 322V150" stroke-width="24"/>
    <path d="M368 158h26a48 48 0 0 1 0 96h-26" stroke-width="24"/>
    <path d="M96 372c52 34 262 32 322-16" stroke-width="20"/>
  </g>
</svg>`);
}

async function onDark(size, logoBuf, contentRatio) {
  const inner = Math.round(size * contentRatio);
  const logo = await sharp(logoBuf).resize(inner, inner, { fit: "inside" }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: DARK } })
    .composite([{ input: logo, gravity: "center" }])
    .png();
}

if (existsSync(logoPng)) {
  // trim transparent padding so the disc fills the icon canvas
  const trimmed = await sharp(logoPng).trim().png().toBuffer();
  await sharp(trimmed).resize(192, 192, { fit: "inside" }).png({ palette: true }).toFile(join(out, "icon-192.png"));
  await sharp(trimmed).resize(512, 512, { fit: "inside" }).png({ palette: true }).toFile(join(out, "icon-512.png"));
  await (await onDark(512, trimmed, 0.78)).toFile(join(out, "icon-maskable-512.png"));
  await (await onDark(180, trimmed, 0.86)).toFile(join(out, "apple-touch-icon.png"));
  await sharp(trimmed).resize(512, 512, { fit: "inside" }).png({ palette: true }).toFile(join(root, "src", "app", "icon.png"));
  // crisp small version for in-app headers (HailMark)
  await sharp(trimmed).resize(256, 256, { fit: "inside" }).png({ palette: true }).toFile(join(out, "logo-ui.png"));
  console.log("✓ icons generated from the OFFICIAL logo (public/icons/logo.png)");
} else {
  const normal = brandSvg({ radius: 100, scale: 1 });
  await sharp(normal).resize(192, 192).png({ palette: true }).toFile(join(out, "icon-192.png"));
  await sharp(normal).resize(512, 512).png({ palette: true }).toFile(join(out, "icon-512.png"));
  await sharp(brandSvg({ radius: 0, scale: 0.72 })).resize(512, 512).png({ palette: true }).toFile(join(out, "icon-maskable-512.png"));
  await sharp(brandSvg({ radius: 0, scale: 0.9 })).resize(180, 180).png({ palette: true }).toFile(join(out, "apple-touch-icon.png"));
  await sharp(normal).resize(512, 512).png({ palette: true }).toFile(join(root, "src", "app", "icon.png"));
  await sharp(normal).resize(256, 256).png({ palette: true }).toFile(join(out, "logo-ui.png"));
  console.log("✓ icons generated from the vector fallback (no public/icons/logo.png)");
}
