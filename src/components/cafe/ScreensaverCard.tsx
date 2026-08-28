"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MonitorPlay, Upload } from "lucide-react";
import { setScreensaver, uploadScreensaver, type Screensaver } from "@/lib/cafe/pastry-actions";

const MINUTES = [1, 2, 5, 10];

/**
 * شاشة استراحة المنيو — إعدادها.
 *
 * الوسيط يُرفع لا يُكتب رابطه: من يُدير المحل يملك ملفاً على جهازه، لا رابطاً
 * على خادم. وطلبُ رابط منه يعني أن يرفعه في مكان آخر أولاً.
 */
export function ScreensaverCard({ current }: { current: Screensaver }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function act(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setBusy(true);
    setMsg(null);
    const r = await fn();
    setBusy(false);
    setMsg(r.ok ? okMsg : (r.error ?? "تعذّر الحفظ"));
    if (r.ok) router.refresh();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    await act(() => uploadScreensaver(fd), "تم الرفع ✓");
    if (fileRef.current) fileRef.current.value = "";
  }

  const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(current.url ?? "");

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h2 className="mb-1 flex items-center gap-2 font-extrabold text-primary">
        <MonitorPlay className="size-4" />
        شاشة استراحة المنيو
      </h2>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
        تظهر على اللوحي بعد سكونه، وأول لمسة تعيد المنيو. لا تظهر وسلة الزبون فيها شيء — توقُّفه ليفكّر ليس غياباً.
      </p>

      {current.url && (
        <div className="mb-3 overflow-hidden rounded-xl border border-border">
          {isVideo ? (
            <video src={current.url} muted loop autoPlay playsInline className="h-32 w-full object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current.url} alt="" className="h-32 w-full object-cover" />
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50"
        >
          <Upload className="size-4" />
          {current.url ? "تغيير الصورة أو الفيديو" : "رفع صورة أو فيديو"}
        </button>
        <input ref={fileRef} type="file" accept="image/*,video/mp4,video/webm" onChange={onFile} className="hidden" />
        {current.url && (
          <button
            onClick={() => act(() => setScreensaver({ url: null }), "أُزيل — تُعرض هوية المحل")}
            disabled={busy}
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50"
          >
            إزالة
          </button>
        )}
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        صورة حتى ٨ م.ب أو فيديو mp4 حتى ٤٠ م.ب. الفيديو يُحمَّل على اللوحي عند كل فتح، فالأصغر أسرع.
        {!current.url && " وبلا ملف تُعرض هوية المحل وشعاره."}
      </p>

      <div className="mt-4">
        <p className="mb-1.5 text-xs font-semibold text-muted-foreground">تظهر بعد</p>
        <div className="flex flex-wrap gap-1.5">
          {MINUTES.map((m) => (
            <button
              key={m}
              onClick={() => act(() => setScreensaver({ afterSec: m * 60, on: true }), "تم الحفظ")}
              disabled={busy}
              className={`rounded-lg px-3 py-1.5 text-sm font-bold transition ${
                current.on && current.afterSec === m * 60
                  ? "bg-primary text-primary-foreground"
                  : "border border-border hover:bg-secondary"
              }`}
            >
              {m} دقيقة
            </button>
          ))}
          <button
            onClick={() => act(() => setScreensaver({ on: false }), "أُوقفت")}
            disabled={busy}
            className={`rounded-lg px-3 py-1.5 text-sm font-bold transition ${
              !current.on ? "bg-destructive text-destructive-foreground" : "border border-border hover:bg-secondary"
            }`}
          >
            لا تظهر
          </button>
        </div>
      </div>

      {msg && <p className="mt-3 text-xs font-semibold">{msg}</p>}
    </section>
  );
}
