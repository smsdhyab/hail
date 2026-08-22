import QRCode from "qrcode";
import { headers } from "next/headers";
import { PrintButton } from "@/components/cafe/PrintButton";
import { NfcWriter } from "@/components/cafe/NfcWriter";
import { tableLabel, DEFAULT_TABLES } from "@/lib/cafe/tables";
import { getTables } from "@/lib/cafe/table-actions";

export const dynamic = "force-dynamic";

/** Printable QR stickers: the general menu QR + one per table (?t=N).
 *  Defaults to the current origin; pass ?base=https://your-domain after deploy. */
export default async function QrPage({
  searchParams,
}: {
  searchParams: Promise<{ base?: string; path?: string }>;
}) {
  const sp = await searchParams;
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const base = typeof sp.base === "string" && sp.base.startsWith("http") ? sp.base.replace(/\/$/, "") : `${proto}://${host}`;
  // المودرن هو الأساسي على /menu — ?path=classic لملصقات الكلاسيكي.
  const menuPath = sp.path === "classic" ? "/menu/classic" : "/menu";

  const opts = { margin: 1, color: { dark: "#42301f", light: "#ffffff" } };
  const menuQr = await QRCode.toDataURL(`${base}${menuPath}`, { ...opts, width: 380 });
  const layout = await getTables().catch(() => []);
  const activeTables = layout.length
    ? layout.filter((t) => t.active).map((t) => ({ name: t.name, floor: t.floor ?? 1 }))
    : DEFAULT_TABLES.map((name) => ({ name, floor: 1 }));
  const multiFloor = new Set(activeTables.map((t) => t.floor)).size > 1;
  const tables = await Promise.all(
    activeTables.map(async ({ name: n, floor }) => {
      const url = `${base}${menuPath}?t=${encodeURIComponent(n)}`;
      return { n, floor, label: tableLabel(n), url, qr: await QRCode.toDataURL(url, { ...opts, width: 300 }) };
    }),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-bold">رموز QR و NFC</h1>
          <p className="text-sm text-muted-foreground" dir="ltr">
            {base}/menu
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            بعد النشر أضف <code dir="ltr">?base=https://رابطك</code> للرابط النهائي. لكتابة NFC: افتح هذه الصفحة من هاتف أندرويد (Chrome)، اضغط «اكتب NFC» وقرّب البطاقة. على الآيفون انسخ الرابط واكتبه بتطبيق «NFC Tools».
          </p>
        </div>
        <PrintButton label="طباعة الملصقات" />
      </div>

      {/* main menu sticker */}
      <div className="mx-auto w-fit rounded-3xl border-2 border-primary bg-card p-6 text-center">
        <h2 className="text-2xl font-extrabold text-primary">مخبز ومقهى هيل</h2>
        <p className="mb-3 text-sm text-muted-foreground">امسح الرمز لتصفّح المنيو والطلب</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={menuQr} alt="منيو QR" className="mx-auto size-72" />
      </div>

      {/* table stickers */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3">
        {tables.map((t) => (
          <div key={t.n} className="break-inside-avoid rounded-2xl border-2 border-primary bg-card p-4 text-center">
            <p className="font-extrabold text-primary">مخبز ومقهى هيل</p>
            <p className="mb-2 text-lg font-bold">
              {t.label}
              {multiFloor && <span className="block text-xs font-semibold text-muted-foreground">الطابق {t.floor}</span>}
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={t.qr} alt={t.label} className="mx-auto size-40" />
            <p className="mt-1.5 text-xs text-muted-foreground">امسح للطلب من طاولتك</p>
            <div className="print:hidden">
              <NfcWriter url={t.url} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
