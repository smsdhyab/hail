import type { MetadataRoute } from "next";

// Installable PWA. Icons come from scripts/make-pwa-icons.mjs (placeholder brand
// mark — regenerate when the owner supplies a real logo). The manifest must stay
// public — src/proxy.ts's matcher excludes it from the auth gate.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/menu",
    name: "مخبز ومقهى هيل — HAIL Bakery & Cafe",
    short_name: "هيل",
    description: "منيو وطلبات وولاء مخبز ومقهى هيل",
    // start at the root: the proxy routes it by session — customers → /menu,
    // signed-in staff → dashboard. Robust even if iOS confuses the two PWAs.
    start_url: "/",
    display: "standalone",
    dir: "rtl",
    lang: "ar",
    background_color: "#ffffff",
    theme_color: "#556f42",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
