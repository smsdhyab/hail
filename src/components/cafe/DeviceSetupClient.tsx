"use client";

import { useCallback, useEffect, useState } from "react";
import { Monitor, Printer, QrCode, RefreshCw, ClipboardCheck, Wrench } from "lucide-react";
import { CopyBox } from "./CopyBox";

const AGENT = "http://127.0.0.1:9977";

type AgentPrinter = { name: string; port: string; shared: boolean; share: string | null; default: boolean };
type AgentStatus = { agent: string; version: number; host: string; share: string; printers: AgentPrinter[] };

/**
 * صفحة الأجهزة والفحص — للمطوّر.
 *
 * الفحص يجري **من داخل النظام على الجهاز نفسه**: الصفحة تسأل وكيل الطباعة
 * المحلي عن الطابعات بدل أن يفتح أحدهم PowerShell ويكتب أمراً وينسخ الناتج.
 * وهو الفرق العملي: الصفحة تُفتح على الجهاز المقصود فتخبرك بحاله هو، لا بحال
 * جهاز آخر.
 *
 * الوكيل يستمع على 127.0.0.1 وحده، فلا يراه إلا الجهاز الذي هو عليه — وهذا
 * بالضبط ما يجعل الفحص صادقاً: «لا يستجيب» تعني «هذا ليس جهاز الكاشير».
 */
export function DeviceSetupClient({
  site,
  installCmd,
  qr,
}: {
  site: string;
  installCmd: string;
  qr: { label: string; hint: string; url: string; png: string }[];
}) {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [probing, setProbing] = useState(true);
  const [screen, setScreen] = useState("—");
  const [touch, setTouch] = useState("—");

  const probe = useCallback(async () => {
    setProbing(true);
    try {
      // مهلة قصيرة: جهاز بلا وكيل يجب أن يقول ذلك بسرعة لا أن يعلّق الصفحة
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 2500);
      const r = await fetch(`${AGENT}/status`, { signal: ctl.signal });
      clearTimeout(t);
      setStatus(r.ok ? ((await r.json()) as AgentStatus) : null);
    } catch {
      setStatus(null);
    } finally {
      setProbing(false);
    }
  }, []);

  useEffect(() => {
    // قياس الشاشة واللمس يُقرآن من المتصفح، فلا يُعرفان قبل الرسم الأول
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the host device, not React state
    setScreen(`${window.screen.width} × ${window.screen.height}`);
     
    setTouch(navigator.maxTouchPoints > 0 ? "نعم — شاشة لمس" : "لا — جهاز بلوحة مفاتيح");
    void probe();
  }, [probe]);

  const printers = status?.printers ?? [];
  const unnamed = printers.filter((p) => !/pastry|cafe|هيل/i.test(p.name));

  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Wrench className="size-5 text-primary" />
          الأجهزة والفحص
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          افتح هذه الصفحة <b className="text-foreground">على الجهاز الذي تفحصه</b> — النتائج تخصّه هو.
        </p>
      </header>

      {/* ١ — هذا الجهاز */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-3 flex items-center gap-2 font-extrabold text-primary">
          <Monitor className="size-4" />
          هذا الجهاز
        </h2>
        <dl className="grid gap-2 sm:grid-cols-2">
          <Row label="قياس الشاشة" value={screen} />
          <Row label="اللمس" value={touch} />
          <Row label="عنوان النظام" value={site} ltr />
          <Row
            label="وكيل الطباعة"
            value={probing ? "جارٍ الفحص…" : status ? `يستجيب · ${status.host}` : "غير موجود — هذا ليس جهاز الكاشير"}
            tone={probing ? undefined : status ? "ok" : "warn"}
          />
        </dl>
      </section>

      {/* ٢ — تركيب جهاز الكاشير */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-2 font-extrabold text-primary">١ · تركيب جهاز الكاشير</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          على جهاز الكاشير فقط. افتح <b className="text-foreground">PowerShell كمسؤول</b>، الصق السطر، اضغط Enter.
          اللوحي وشاشات العرض لا تحتاج هذه الخطوة.
        </p>
        <CopyBox title="أمر التركيب" hint="ينسخ السطر كاملاً" value={installCmd} />
        <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
          <li>• يكتشف طابعة الفواتير ويشاركها ويجعلها الافتراضية</li>
          <li>• ينزّل وكيل الطباعة والقاصة ويشغّله مع إقلاع الجهاز</li>
          <li>• يختبر فتح الدرج ويصنع اختصار «كاشير هيل»</li>
        </ul>
      </section>

      {/* ٣ — الطابعات */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-extrabold text-primary">
            <Printer className="size-4" />
            ٢ · الطابعات على هذا الجهاز
          </h2>
          <button
            onClick={probe}
            disabled={probing}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-secondary disabled:opacity-50"
          >
            <RefreshCw className={`size-3.5 ${probing ? "animate-spin" : ""}`} />
            إعادة الفحص
          </button>
        </div>

        {!status ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {probing ? "جارٍ الفحص…" : "وكيل الطباعة لا يستجيب على هذا الجهاز — نفّذ الخطوة ١ أولاً."}
          </p>
        ) : printers.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            لا توجد طابعات مثبّتة على هذا الجهاز.
          </p>
        ) : (
          <>
            <ul className="space-y-2">
              {printers.map((p) => (
                <li key={p.name} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold" dir="ltr">
                      {p.name}
                    </p>
                    <p className="text-xs text-muted-foreground" dir="ltr">
                      {p.port}
                      {p.shared && p.share ? ` · \\\\${status.host}\\${p.share}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    {p.default && <Tag tone="ok">الافتراضية</Tag>}
                    {!p.shared && <Tag tone="warn">غير مشاركة</Tag>}
                  </div>
                </li>
              ))}
            </ul>
            {unnamed.length > 1 && (
              <p className="mt-3 rounded-xl border border-accent/50 bg-accent/5 p-3 text-xs leading-relaxed">
                ⚠ يوجد أكثر من طابعة بأسماء متشابهة. أعد تسميتهما ليتميّزا (لوحة التحكم ← الأجهزة والطابعات ← كليك يمين
                ← Printer properties) إلى <code dir="ltr">HAIL-Pastry</code> و<code dir="ltr">HAIL-Cafe</code>.
              </p>
            )}
          </>
        )}
      </section>

      {/* ٤ — ماذا يُطبع */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-2 font-extrabold text-primary">٣ · ماذا يُطبع</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          المحل صندوق واحد وطابعة واحدة، فكل شيء يخرج من طابعة الكاشير.
        </p>
        <ul className="space-y-2 text-sm">
          <li className="rounded-xl border border-border p-3">
            <p className="font-bold">وصل الزبون</p>
            <p className="text-xs text-muted-foreground">بالأسعار والإجمالي — يُسلَّم للزبون</p>
          </li>
          <li className="rounded-xl border border-border p-3">
            <p className="font-bold">وصل التحضير</p>
            <p className="text-xs text-muted-foreground">بالأصناف بلا أسعار — يذهب لمن يحضّر</p>
          </li>
        </ul>
        <p className="mt-3 rounded-xl border border-dashed border-border p-3 text-xs leading-relaxed text-muted-foreground">
          عند فتح الطابق الثاني وإضافة طابعة ثانية، يُوجَّه وصل كل قسم إلى طابعته — ولا يحتاج ذلك اليوم.
        </p>
      </section>

      {/* ٥ — الشاشات */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-3 flex items-center gap-2 font-extrabold text-primary">
          <QrCode className="size-4" />
          ٤ · الشاشات والروابط
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {qr.map((q) => (
            <div key={q.url} className="rounded-xl border border-border p-3">
              <p className="font-bold">{q.label}</p>
              <p className="mb-2 text-xs text-muted-foreground">{q.hint}</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={q.png} alt="" className="mx-auto size-32" />
              <CopyBox title="" value={q.url} />
            </div>
          ))}
        </div>
      </section>

      {/* ٦ — الفحص */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-2 flex items-center gap-2 font-extrabold text-primary">
          <ClipboardCheck className="size-4" />
          ٥ · الفحص قبل التسليم
        </h2>
        <p className="mb-2 text-xs text-muted-foreground">اطلب طلباً مشتركاً (معجّنة + مشروب) وتحقّق:</p>
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          {[
            "وصل الزبون خرج — والعربية متصلة غير مقطّعة",
            "وصل المعجنات خرج على طابعة المعجنات، بلا أسعار",
            "وصل الكافيه خرج على طابعة الكافيه، بلا أسعار",
            "الدرج انفتح عند الدفع — الدرج الصحيح لا الآخر",
            "الطلب من اللوحي يُطبع عند إرساله بلا لمس جهاز الكاشير",
            "أطفئ الإنترنت دقيقتين ← الكاشير يستمر ثم ترتفع الطلبات وحدها",
          ].map((line) => (
            <li key={line} className="flex gap-2">
              <span className="text-primary">✓</span>
              {line}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Row({ label, value, ltr, tone }: { label: string; value: string; ltr?: boolean; tone?: "ok" | "warn" }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd
        dir={ltr ? "ltr" : undefined}
        className={`truncate text-sm font-semibold ${tone === "ok" ? "text-emerald-600" : tone === "warn" ? "text-destructive" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone: "ok" | "warn" }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
        tone === "ok" ? "bg-emerald-500/10 text-emerald-600" : "bg-accent/15 text-accent"
      }`}
    >
      {children}
    </span>
  );
}
