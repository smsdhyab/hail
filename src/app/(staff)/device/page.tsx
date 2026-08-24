import QRCode from "qrcode";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getStaff, homeFor } from "@/lib/cafe/auth";
import { DeviceSetupClient } from "@/components/cafe/DeviceSetupClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "الأجهزة والفحص — مخبز ومقهى هيل" };

const RAW = "https://raw.githubusercontent.com/smsdhyab/hail/main/scripts/setup-pos.ps1";

/**
 * صفحة التركيب والفحص داخل النظام — للمطوّر وحده.
 *
 * الصفحة العامة `/setup` تبقى: تُفتح على جهاز جديد **قبل** أن يملك أحد جلسة،
 * وهو ما يجعلها بلا تسجيل دخول وبلا كلمات مرور. أما هذه فتفحص الجهاز من داخل
 * النظام: تسأل وكيل الطباعة المحلي عن الطابعات وتعرض روابط الشاشات جاهزة.
 */
export default async function DevicePage() {
  const staff = await getStaff().catch(() => null);
  if (!staff) redirect("/sign-in");
  if (!staff.isDeveloper) redirect(homeFor(staff.role));

  const h = await headers();
  const host = h.get("host") ?? "hail.sms-dhyab.workers.dev";
  const site = `${h.get("x-forwarded-proto") ?? "https"}://${host}`;

  const screens = [
    { label: "منيو الزبون", hint: "اللوحي على الطاولة أو ملصق QR", url: `${site}/menu` },
    { label: "صفحة التوصيل", hint: "الرابط المنشور على حسابات التواصل", url: `${site}/delivery` },
    { label: "شاشة الطلبات الواردة", hint: "شاشة العمل اليومية للكاشير", url: `${site}/orders` },
    { label: "صفحة التركيب العامة", hint: "تُفتح على جهاز جديد قبل تسجيل الدخول", url: `${site}/setup` },
  ];
  const qr = await Promise.all(
    screens.map(async (s) => ({ ...s, png: await QRCode.toDataURL(s.url, { margin: 1, width: 256 }) })),
  );

  const installCmd = `irm ${RAW} -OutFile "$env:TEMP\hail-setup.ps1"; powershell -ExecutionPolicy Bypass -File "$env:TEMP\hail-setup.ps1" -Station both`;

  return <DeviceSetupClient site={site} installCmd={installCmd} qr={qr} />;
}
