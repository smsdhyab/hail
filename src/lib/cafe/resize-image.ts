/**
 * Browser-side image resize, done before the photo ever leaves the device.
 *
 * Two reasons this belongs in the browser rather than on the server:
 *  • the shop uploads over an Iraqi connection — shrinking a 4 MB phone photo
 *    to ~120 KB first is the difference between a slow upload and an instant one;
 *  • it removes the `sharp` native module from the server path, so the app can
 *    run on edge runtimes (Cloudflare Workers) that cannot load native addons.
 */

const MAX_EDGE = 800;
const QUALITY = 0.82;

export async function resizeToWebp(file: File, maxEdge = MAX_EDGE): Promise<File> {
  // Anything we cannot decode (HEIC on some browsers, SVG) goes through as-is —
  // the server still validates type and size.
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", QUALITY));
  // If webp encoding is unavailable, or the "optimised" file came out bigger,
  // keep the original rather than making things worse.
  if (!blob || blob.size >= file.size) return file;

  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", { type: "image/webp" });
}
