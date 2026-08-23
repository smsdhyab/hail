import { headers } from "next/headers";
import { HailMark } from "@/components/cafe/Logo";
import { CopyBox } from "@/components/cafe/CopyBox";
import { SYSTEM } from "@/lib/cafe/branding";

export const dynamic = "force-dynamic";
export const metadata = { title: "تركيب جهاز الكاشير — مخبز ومقهى هيل" };

const RAW = "https://raw.githubusercontent.com/smsdhyab/hail/main/scripts/setup-pos.ps1";

/** The one-liner that downloads and runs the installer for one register. */
const installCmd = (station: "both" | "pastry" | "cafe") =>
  `irm ${RAW} -OutFile "$env:TEMP\\hail-setup.ps1"; powershell -ExecutionPolicy Bypass -File "$env:TEMP\\hail-setup.ps1" -Station ${station}`;

/**
 * Public setup page, opened ON the cashier machine during installation — before
 * anyone can sign in, which is why it sits outside the (staff) group and needs
 * no session.
 *
 * Because it is public it carries NO passwords: printing the till's login on a
 * page anyone can open would hand the register to the internet. It names the
 * account only, and the manager brings the password to the machine.
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
        <h1 className="text-2xl font-extrabold text-primary">تركيب جهاز الكاشير</h1>
        <p className="text-sm text-muted-foreground">مخبز ومقهى هيل</p>
      </header>

      {/* ── قبل البدء ── */}
      <section className="rounded-2xl border-2 border-accent/50 bg-accent/5 p-4 text-sm leading-relaxed">
        <h2 className="mb-2 font-extrabold text-primary">قبل أي شيء — توصيل الجرارة</h2>
        <p className="text-muted-foreground">
          كيبل الجرارة (يشبه كيبل الهاتف) يدخل في مؤخرة <b className="text-foreground">الطابعة</b> في المنفذ المكتوب
          عليه <b className="text-foreground">DK</b> أو <b className="text-foreground">CASH DRAWER</b> — وليس في منفذ
          الشبكة ولا في الحاسبة. الطابعة هي التي تفتح الجرارة، فبدون هذا الكيبل لن تفتح مهما فعلنا في البرنامج.
        </p>
      </section>

      {/* ── الخطوات ── */}
      <ol className="space-y-2 rounded-2xl border border-border bg-secondary/30 p-4 text-sm leading-relaxed">
        <li>
          <b>١)</b> وصّل الطابعة بالحاسبة وشغّلها، وتأكّد أن فيها ورقاً.
        </li>
        <li>
          <b>٢)</b> زر ابدأ ← اكتب <code dir="ltr" className="rounded bg-foreground/10 px-1.5 py-0.5">powershell</code> ← كليك
          يمين ← <b>Run as administrator</b>
        </li>
        <li>
          <b>٣)</b> انسخ الأمر من البطاقة الأولى والصقه ← <b>Enter</b>
        </li>
        <li>
          <b>٤)</b> عندما يطلب الرابط، الصق رابط النظام من البطاقة الثانية.
        </li>
      </ol>

      <CopyBox
        title="١ · أمر التثبيت"
        hint="جهاز واحد يبيع الكافيه والمعجنات معاً"
        value={installCmd("both")}
      />

      <CopyBox title="٢ · رابط النظام" hint="الصقه عندما يطلبه المثبّت" value={site} tone="accent" />

      {/* ── بعد التثبيت ── */}
      <section className="rounded-2xl border border-border bg-card p-4 text-sm leading-relaxed">
        <h2 className="mb-2 font-extrabold text-primary">بعد انتهاء التثبيت</h2>
        <ol className="space-y-1.5 text-muted-foreground">
          <li>
            <b className="text-foreground">١)</b> يجب أن تنفتح الجرارة عند السطر{" "}
            <code dir="ltr" className="rounded bg-foreground/10 px-1 text-[12px]">TEST PULSE SENT</code>. إن لم تنفتح
            فالمشكلة في كيبل الجرارة لا في البرنامج.
          </li>
          <li>
            <b className="text-foreground">٢)</b> افتح اختصار <b>«كاشير هيل»</b> من سطح المكتب.
          </li>
          <li>
            <b className="text-foreground">٣)</b> في شاشة اختيار الصندوق اختر{" "}
            <b className="text-foreground">«الكل — الكافيه والمعجنات»</b>.
          </li>
          <li>
            <b className="text-foreground">٤)</b> سجّل الدخول بحساب الكاشير{" "}
            <code dir="ltr" className="rounded bg-foreground/10 px-1 text-[12px]">hail</code> — كلمة المرور مع المدير.
          </li>
          <li>
            <b className="text-foreground">٥)</b> من أعلى شاشة «الطلبات الواردة» فعّل:{" "}
            <b className="text-foreground">الطباعة التلقائية</b> و<b className="text-foreground">فتح القاصة عند الدفع</b>.
          </li>
        </ol>
      </section>

      {/* ── أسماء الطابعات: يحتاجها توجيه الطباعة بين الطابقين ── */}
      <section className="rounded-2xl border border-border bg-card p-4 text-sm leading-relaxed">
        <h2 className="mb-2 font-extrabold text-primary">معرفة أسماء الطابعات</h2>
        <p className="mb-3 text-muted-foreground">
          لازمة عندما يكون في المحل طابعتان (واحدة للمعجنات وأخرى للكافيه) — بها يعرف النظام أيّهما يطبع ماذا.
        </p>
        <ol className="mb-3 space-y-1.5 text-muted-foreground">
          <li>
            <b className="text-foreground">١)</b> زر ابدأ ← اكتب{" "}
            <code dir="ltr" className="rounded bg-foreground/10 px-1.5 py-0.5">powershell</code> ← اضغط Enter (بلا
            صلاحيات مدير هذه المرة).
          </li>
          <li>
            <b className="text-foreground">٢)</b> انسخ الأمر أدناه والصقه ← Enter.
          </li>
          <li>
            <b className="text-foreground">٣)</b> صوّر الجدول الذي يظهر وأرسله.
          </li>
        </ol>
        <CopyBox
          title="أمر عرض الطابعات"
          hint="ينسخ أسماء الطابعات وحالتها"
          value="Get-Printer | Select-Object Name, PortName, Default | Format-Table -AutoSize"
        />
        <p className="mt-3 text-xs text-muted-foreground">
          إن ظهر اسمان متطابقان (نفس الموديل)، أعد تسميتهما ليتميّزا: لوحة التحكم ← الأجهزة والطابعات ← كليك يمين على
          الطابعة ← <b className="text-foreground">Printer properties</b> ← غيّر الاسم إلى{" "}
          <code dir="ltr" className="rounded bg-foreground/10 px-1 text-[12px]">HAIL-Pastry</code> و
          <code dir="ltr" className="rounded bg-foreground/10 px-1 text-[12px]">HAIL-Cafe</code>.
        </p>
      </section>

      {/* ── حالة الجهازين، إن رجعتم إليها ── */}
      <details className="rounded-2xl border border-border bg-card p-4 text-sm">
        <summary className="cursor-pointer font-extrabold text-primary">إن أردت جهازين منفصلين لاحقاً</summary>
        <p className="mb-3 mt-2 text-muted-foreground">
          كل جهاز يأخذ أمره الخاص، ويسجّل دخوله بحساب قسمه — ولا يستطيع فتح صندوق القسم الآخر.
        </p>
        <div className="space-y-3">
          <CopyBox title="جهاز المعجنات" hint="على جهاز المعجنات فقط" value={installCmd("pastry")} />
          <CopyBox title="جهاز الكافيه" hint="على جهاز الكافيه فقط" value={installCmd("cafe")} tone="accent" />
        </div>
      </details>

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
