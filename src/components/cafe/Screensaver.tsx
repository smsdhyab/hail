"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HailMark } from "./Logo";
import { SHOP } from "@/lib/cafe/branding";

/**
 * شاشة استراحة المنيو.
 *
 * اللوحي يبقى مفتوحاً طوال الدوام، وبين زبون وآخر يعرض المنيو ساكناً فيبدو
 * معلّقاً أو منسيّاً. بعد سكون يظهر عرض المنتجات بشعار المحل، وأول لمسة تعيد
 * المنيو من حيث تركه الزبون السابق — لا من أوله.
 *
 * لا تظهر والسلة فيها شيء: زبون يقف عند الكاشير وسلته نصف ممتلئة لا يجوز أن
 * تُغطّى شاشته لأنه توقّف ليفكّر.
 */
export function Screensaver({
  mediaUrl,
  afterSec,
  idle,
}: {
  /** صورة أو فيديو mp4 — أو فارغ فتُعرض هوية المحل وحدها */
  mediaUrl: string | null;
  afterSec: number;
  /** true = يجوز أن تظهر (السلة فارغة ولا نافذة مفتوحة) */
  idle: boolean;
}) {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arm = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!idle || afterSec <= 0) return;
    timer.current = setTimeout(() => setOn(true), afterSec * 1000);
  }, [idle, afterSec]);

  useEffect(() => {
    const wake = () => {
      setOn(false);
      arm();
    };
    // pointerdown لا click: اللمسة يجب أن توقظ الشاشة قبل أن تصل إلى ما تحتها،
    // وإلا فتحت اللمسة الأولى صنفاً لم يقصده الزبون
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, wake, { passive: true });
    arm();
    return () => {
      for (const e of events) window.removeEventListener(e, wake);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [arm]);

  // السلة امتلأت أو فُتحت نافذة ← تُخفى فوراً ويُعاد ضبط المؤقّت
  useEffect(() => {
    if (idle) {
      arm();
      return;
    }
    if (timer.current) clearTimeout(timer.current);
  }, [idle, arm]);

  // لا تُعرض والسلة مشغولة، حتى لو كانت ظاهرة لحظة امتلائها
  if (!on || !idle) return null;

  const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(mediaUrl ?? "");

  return (
    <div
      // pointerdown أعلاه يلتقط اللمسة، وهذه الطبقة تمنعها من الوصول للمنيو
      onPointerDown={(e) => e.stopPropagation()}
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center overflow-hidden bg-[#22301a]"
      style={{ animation: "hail-fade-in 600ms ease-out" }}
    >
      {mediaUrl ? (
        isVideo ? (
          <video
            src={mediaUrl}
            autoPlay
            loop
            muted
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        )
      ) : (
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: "radial-gradient(120% 90% at 78% 12%, #f2924c33, transparent 55%), linear-gradient(160deg, #556f42, #22301a)" }}
        />
      )}

      {/* تعتيم متدرّج أسفل الشاشة: الشعار والنصّ يجب أن يُقرآ فوق أي صورة */}
      <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/25" />

      <div className="relative flex flex-col items-center gap-3 px-6 text-center">
        <HailMark className="size-28 drop-shadow-lg sm:size-36" />
        <p className="text-2xl font-extrabold text-[#f6f4ee] drop-shadow sm:text-3xl">{SHOP.name_ar}</p>
      </div>

      <p
        className="absolute bottom-10 text-base font-bold text-[#f6f4ee]/90 drop-shadow sm:text-lg"
        style={{ animation: "hail-pulse 2.4s ease-in-out infinite" }}
      >
        المس الشاشة لعرض المنيو
      </p>
    </div>
  );
}
