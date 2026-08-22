import { NextResponse } from "next/server";

// Management PWA: installs as a separate «إدارة هيل» app (distinct id from
// the customer menu app) that opens straight on the dashboard. Public path —
// browsers fetch manifests credential-less, so it must bypass the auth gate
// (the pages it opens still require sign-in).
export function GET() {
  return NextResponse.json(
    {
      id: "/dashboard",
      name: "إدارة مخبز ومقهى هيل",
      short_name: "إدارة هيل",
      description: "لوحة إدارة مخبز ومقهى هيل — الطلبات والطاولات والتقارير",
      // start at the root: the proxy sends signed-in staff to the dashboard.
      // Robust even if iOS picks the customer manifest for a same-scope PWA.
      // the cashier's daily screen — signed out, this still lands on sign-in
      start_url: "/orders",
      scope: "/",
      display: "standalone",
      dir: "rtl",
      lang: "ar",
      background_color: "#ffffff",
      theme_color: "#22301a",
      icons: [
        { src: "/icons/admin-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icons/admin-512.png", sizes: "512x512", type: "image/png" },
        { src: "/icons/admin-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json" } },
  );
}
