// Generates the «إدارة» (ADMIN) icon variants from the existing PWA icons:
// same brand mark with a dark bottom banner so the management app is
// distinguishable from the customer menu app on the home screen.
//   Usage: node scripts/make-admin-icons.mjs
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "public", "icons");

// Latin "ADMIN" — librsvg renders it reliably (Arabic shaping is unreliable here)
const banner = (size) => {
  const h = Math.round(size * 0.26);
  const y = size - h;
  const fs = Math.round(h * 0.52);
  return Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="${y}" width="${size}" height="${h}" fill="#3c5030" opacity="0.92"/>
      <text x="${size / 2}" y="${y + h / 2 + fs * 0.36}" font-family="Arial, sans-serif" font-size="${fs}" font-weight="800" fill="#ffffff" text-anchor="middle" letter-spacing="${Math.round(fs * 0.18)}">ADMIN</text>
    </svg>`,
  );
};

for (const [src, out, size] of [
  ["icon-512.png", "admin-512.png", 512],
  ["icon-maskable-512.png", "admin-maskable-512.png", 512],
]) {
  await sharp(join(dir, src))
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .composite([{ input: banner(size) }])
    .png()
    .toFile(join(dir, out));
  console.log(`✓ ${out}`);
}
await sharp(join(dir, "admin-512.png")).resize(192, 192).png().toFile(join(dir, "admin-192.png"));
console.log("✓ admin-192.png");
