import QRCode from "qrcode";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SITE_DOMAIN } from "@/lib/cafe/branding";
import { getStaff, homeFor } from "@/lib/cafe/auth";
import { DeviceSetupClient } from "@/components/cafe/DeviceSetupClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "الأجهزة والفحص — مخبز ومقهى هيل" };

/**
 * صفحة التركيب والفحص داخل النظام — للمطوّر وحده.
 *
 * حلّت محلّ صفحة `/setup` العامة وحُذفت. تلك كانت مفتوحة لأي زائر تعرض عليه
 * أمر التركيب وعنوان النظام بلا داعٍ — ومن يركّب جهازاً هو المطوّر نفسه،
 * وبيده حساب يفتح به هذه الصفحة على الجهاز الذي يركّبه.
 */
export default async function DevicePage() {
  const staff = await getStaff().catch(() => null);
  if (!staff) redirect("/sign-in");
  if (!staff.isDeveloper) redirect(homeFor(staff.role));

  const h = await headers();
  const host = h.get("host") ?? SITE_DOMAIN;
  const site = `${h.get("x-forwarded-proto") ?? "https"}://${host}`;

  const screens = [
    { label: "منيو الزبون", hint: "اللوحي على الطاولة أو ملصق QR", url: `${site}/menu` },
    { label: "صفحة التوصيل", hint: "الرابط المنشور على حسابات التواصل", url: `${site}/delivery` },
    { label: "شاشة الطلبات الواردة", hint: "شاشة العمل اليومية للكاشير", url: `${site}/orders` },
  ];
  const qr = await Promise.all(
    screens.map(async (s) => ({ ...s, png: await QRCode.toDataURL(s.url, { margin: 1, width: 256 }) })),
  );

  // السكربت يُقدَّم من النظام نفسه لا من GitHub: النسخة التي تُنزَّل هي نسخة
  // النظام المنشور بالضبط، وتتبع نطاقه — لا نسخة قد تتأخر عن النشر.
  const installCmd = `irm ${site}/setup-pos.ps1 -OutFile "$env:TEMP/hail-setup.ps1"; powershell -ExecutionPolicy Bypass -File "$env:TEMP/hail-setup.ps1" -Station both`;

  return <DeviceSetupClient site={site} installCmd={installCmd} qr={qr} />;
}
