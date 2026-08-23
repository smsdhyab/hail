"use client";

import { useEffect, useRef, useState } from "react";
import { Clock, MapPin, Phone, User } from "lucide-react";

export type DeliveryDetails = {
  name: string;
  phone: string;
  address: string;
  geo: string;
  deliverAt: string;
};

export const emptyDelivery: DeliveryDetails = { name: "", phone: "", address: "", geo: "", deliverAt: "الآن" };

export type DeliveryField = "name" | "phone" | "address";

/** Phone must be usable by a driver, not merely non-empty. Iraqi mobiles are
 *  11 digits starting 07; also accept +964 / 00964 forms.
 *
 *  Returns WHICH field is wrong, not just the text: the message shows at the
 *  bottom of the cart sheet, and the offending field is often scrolled out of
 *  sight — «اكتب اسمك» beside a note field reads like a bug, not an error. */
export function deliveryError(d: DeliveryDetails): { field: DeliveryField; msg: string } | null {
  if (!d.name.trim()) return { field: "name", msg: "اكتب اسمك." };
  const digits = d.phone.replace(/[^\d]/g, "").replace(/^00964/, "0").replace(/^964/, "0");
  if (!/^07\d{9}$/.test(digits)) return { field: "phone", msg: "رقم الهاتف غير صحيح — مثال: 07701234567" };
  if (d.address.trim().length < 10) return { field: "address", msg: "اكتب العنوان بتفصيل أكثر (الحي، الشارع، أقرب نقطة دالة)." };
  return null;
}

const TIMES = ["الآن", "خلال ساعة", "خلال ساعتين", "أحدد بالاتصال"];

/**
 * Who to deliver to, and where.
 *
 * The address lives on the ORDER, not on the loyalty card: it changes between
 * orders (home, work, family) and storing it on the customer would make each
 * order overwrite the last one's address.
 */
export function DeliveryForm({
  value,
  onChange,
  invalid = null,
}: {
  value: DeliveryDetails;
  onChange: (d: DeliveryDetails) => void;
  /** الحقل الذي رفضه التحقّق — يُلوَّن بالأحمر ويُنقل إليه المؤشّر */
  invalid?: DeliveryField | null;
}) {
  // ثلاثة مراجع منفصلة لا كائن واحد: قراءة مرجع من كائن أثناء الرسم يمنعها ESLint
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (invalid === "name") nameRef.current?.focus();
    else if (invalid === "phone") phoneRef.current?.focus();
    else if (invalid === "address") addressRef.current?.focus();
  }, [invalid]);
  const [locating, setLocating] = useState(false);
  const [locMsg, setLocMsg] = useState<string | null>(null);
  const set = (patch: Partial<DeliveryDetails>) => onChange({ ...value, ...patch });

  function sendLocation() {
    if (!navigator.geolocation) {
      setLocMsg("متصفحك لا يدعم تحديد الموقع — اكتب العنوان بالتفصيل.");
      return;
    }
    setLocating(true);
    setLocMsg(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: la, longitude: lo } = pos.coords;
        set({ geo: `https://maps.google.com/?q=${la.toFixed(6)},${lo.toFixed(6)}` });
        setLocating(false);
        setLocMsg("تم إرفاق موقعك");
      },
      () => {
        setLocating(false);
        setLocMsg("تعذّر تحديد الموقع — اسمح بالإذن أو اكتب العنوان بالتفصيل.");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  const base = "w-full rounded-lg border bg-[var(--panel)] px-3 py-2.5 text-sm outline-none";
  const field = (name: DeliveryField) =>
    `${base} ${invalid === name ? "border-2 border-destructive bg-destructive/5" : "border-[var(--line)]"}`;

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2">
        <User className={`size-4 shrink-0 ${invalid === "name" ? "text-destructive" : "text-[var(--accent)]"}`} />
        <input ref={nameRef} value={value.name} onChange={(e) => set({ name: e.target.value })} placeholder="الاسم" className={field("name")} aria-invalid={invalid === "name"} />
      </label>

      <label className="flex items-center gap-2">
        <Phone className={`size-4 shrink-0 ${invalid === "phone" ? "text-destructive" : "text-[var(--accent)]"}`} />
        <input
          ref={phoneRef}
          value={value.phone}
          onChange={(e) => set({ phone: e.target.value })}
          inputMode="tel"
          dir="ltr"
          placeholder="07701234567"
          className={field("phone")}
          aria-invalid={invalid === "phone"}
        />
      </label>

      <label className="flex items-start gap-2">
        <MapPin className={`mt-3 size-4 shrink-0 ${invalid === "address" ? "text-destructive" : "text-[var(--accent)]"}`} />
        <textarea
          ref={addressRef}
          value={value.address}
          onChange={(e) => set({ address: e.target.value })}
          rows={2}
          placeholder="العنوان: الحي، الشارع، أقرب نقطة دالة"
          className={`${field("address")} resize-none`}
          aria-invalid={invalid === "address"}
        />
      </label>

      <button
        type="button"
        onClick={sendLocation}
        disabled={locating}
        className={`flex w-full items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-bold transition ${
          value.geo
            ? "border-emerald-500 bg-emerald-500/10 text-emerald-600"
            : "border-[var(--accent2)] text-[var(--accent2)]"
        }`}
      >
        <MapPin className="size-4" />
        {locating ? "جارٍ تحديد الموقع…" : value.geo ? "تم إرفاق موقعك" : "أرسل موقعي (يسهّل الوصول)"}
      </button>
      {locMsg && <p className="text-xs text-[var(--muted)]">{locMsg}</p>}

      <div className="flex items-center gap-2">
        <Clock className="size-4 shrink-0 text-[var(--accent)]" />
        <div className="flex flex-1 flex-wrap gap-1.5">
          {TIMES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => set({ deliverAt: t })}
              className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                value.deliverAt === t
                  ? "bg-[var(--accent)] text-[var(--activeink)]"
                  : "border border-[var(--line)] text-[var(--muted)]"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
