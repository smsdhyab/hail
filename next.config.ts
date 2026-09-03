import { SITE_URL } from "./src/lib/cafe/branding";
import type { NextConfig } from "next";

// Managed hosts (Netlify / Vercel) emit their own serverless output, so we must
// NOT produce a standalone server there. The Docker/VPS path (`node server.js`)
// still needs standalone.
const isManagedHost =
  process.env.NETLIFY === "true" || process.env.VERCEL === "1" || process.env.RENDER === "true";

const nextConfig: NextConfig = {
  ...(isManagedHost ? {} : { output: "standalone" }),
  devIndicators: false,
  // Root routing for MODERN_ONLY moved to src/proxy.ts so it can see the session
  // (config redirects run before the proxy and would send logged-in staff who
  // open the bare domain to /menu instead of their dashboard).
  // ── الرابط القديم يقود إلى الجديد ──────────────────────────────────────
  //
  // انتقل المحل إلى hail.cafe، وعلى الطاولات ملصقات QR مطبوعة بالرابط القديم
  // وعلى حسابات التواصل منشورات تحمله. والـWorker نفسه يخدم النطاقين، فيلزم
  // شرط على المضيف لا تحويل عام.
  //
  // «‎:path*‎» يحفظ المسار، و Next يمرّر الاستعلام وحده، فـ
  // ‎…workers.dev/menu?t=3 ينتهي إلى hail.cafe/menu?t=3 — الطاولة نفسها لا
  // الصفحة الرئيسية، وإلا جلس زبون الطاولة ٣ يطلب بلا رقم طاولة.
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: ".*\\.workers\\.dev" }],
        destination: `${SITE_URL}/:path*`,
        permanent: true,
      },
    ];
  },
  // /img/* → storage (same path the netlify.toml edge proxy serves in prod);
  // this rewrite covers local dev and any Node host.
  async rewrites() {
    const supa = process.env.NEXT_PUBLIC_SUPABASE_URL;
    return supa
      ? [{ source: "/img/:path*", destination: `${supa}/storage/v1/object/public/menu/:path*` }]
      : [];
  },
};

export default nextConfig;
