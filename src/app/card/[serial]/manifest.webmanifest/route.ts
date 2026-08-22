import { NextResponse } from "next/server";

// Per-card PWA manifest: start_url points at THIS customer's card, so the
// browser's install prompt turns the card into a home-screen app that opens
// straight on their QR + points.
export async function GET(_req: Request, ctx: { params: Promise<{ serial: string }> }) {
  const { serial } = await ctx.params;
  return NextResponse.json(
    {
      name: "بطاقة هيل",
      short_name: "بطاقة هيل",
      description: "بطاقة ولاء مخبز ومقهى هيل — نقاطك ورمز QR دائماً معك",
      start_url: `/card/${serial}`,
      scope: `/card/${serial}`,
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
    },
    { headers: { "Content-Type": "application/manifest+json" } },
  );
}
