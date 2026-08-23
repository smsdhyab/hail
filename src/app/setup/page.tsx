import { headers } from "next/headers";
import { HailMark } from "@/components/cafe/Logo";
import { CopyBox } from "@/components/cafe/CopyBox";
import { SYSTEM } from "@/lib/cafe/branding";

export const dynamic = "force-dynamic";
export const metadata = { title: "تركيب أجهزة الكاشير — مخبز ومقهى هيل" };

const RAW = "https://raw.githubusercontent.com/smsdhyab/hail/main/scripts/setup-pos.ps1";

/** The one-liner that downloads and runs the installer for one register. */
const installCmd = (station: "pastry" | "cafe") =>
  `irm ${RAW} -OutFile "$env:TEMP\\hail-setup.ps1"; powershell -ExecutionPolicy Bypass -File "$env:TEMP\\hail-setup.ps1" -Station ${station}`;

/**
 * Public setup page, opened ON the cashier machine during installation — before
 * anyone can sign in, which is why it sits outside the (staff) group and needs
 * no session. Its whole job is to let the installer copy three exact strings
 * without retyping them.
 */
export default async function SetupPage() {
  const h = await headers();
  const host = h.get("host") ?? "hail.sms-dhyab.workers.dev";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const site = `${proto}://${host}`;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-5 p-5">
      <header className="space-y-2 text-center">
        <HailMark className="mx-auto size-20" />
        <h1 className="text-2xl font-extrabold text-primary">تركيب أجهزة الكاشير</h1>
        <p className="text-sm text-muted-foreground">مخبز ومقهى هيل</p>
      </header>

      <ol className="space-y-1.5 rounded-2xl border border-border bg-secondary/30 p-4 text-sm leading-relaxed">
        <li>
          <b>١)</b> زر ابدأ ← اكتب <code dir="ltr" className="rounded bg-foreground/10 px-1.5 py-0.5">powershell</code> ← كليك
          يمين ← <b>Run as administrator</b>
        </li>
        <li>
          <b>٢)</b> انسخ أمر هذا الجهاز من الأسفل والصقه ← <b>Enter</b>
        </li>
        <li>
          <b>٣)</b> عندما يطلب الرابط، الصق رابط النظام (البطاقة الثالثة)
        </li>
        <li className="pt-1 text-accent">
          <b>⚠</b> قبل كل شيء: كيبل RJ11 من الطابعة إلى الجرارة في منفذ <b>DK</b> أو <b>CASH DRAWER</b> — لا في منفذ الشبكة.
        </li>
      </ol>

      <CopyBox
        title="🥐 جهاز كاشير المعجنات"
        hint="شغّله على جهاز المعجنات فقط"
        value={installCmd("pastry")}
      />

      <CopyBox
        title="☕ جهاز كاشير الكافيه"
        hint="شغّله على جهاز الكافيه فقط"
        value={installCmd("cafe")}
        tone="accent"
      />

      <CopyBox title="🔗 رابط النظام" hint="الصقه عندما يطلبه المثبّت" value={site} />

      <section className="rounded-2xl border border-border bg-card p-4 text-sm leading-relaxed">
        <h2 className="mb-2 font-extrabold text-primary">بعد انتهاء التثبيت</h2>
        <p className="text-muted-foreground">
          يجب أن <b className="text-foreground">تنفتح الجرارة</b> عند السطر{" "}
          <code dir="ltr" className="rounded bg-foreground/10 px-1 text-[12px]">TEST PULSE SENT</code>. ثم افتح الاختصار
          الجديد من سطح المكتب، سجّل الدخول، وفعّل داخل الشاشة: <b className="text-foreground">الطباعة التلقائية</b> و
          <b className="text-foreground"> فتح القاصة عند الدفع</b>.
        </p>
      </section>

      <footer className="pb-6 text-center text-[11px] leading-relaxed text-muted-foreground">
        <p className="font-semibold">{SYSTEM.name_ar}</p>
        <p>
          تطوير{" "}
          <a href={SYSTEM.site} target="_blank" rel="noopener noreferrer" className="font-bold text-primary hover:underline">
            {SYSTEM.vendor_ar}
          </a>
        </p>
      </footer>
    </main>
  );
}
