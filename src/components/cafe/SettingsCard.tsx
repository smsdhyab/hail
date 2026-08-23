"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Truck } from "lucide-react";
import { setDeliveryFee } from "@/lib/cafe/pastry-actions";
import { formatIqdLabel } from "@/lib/cafe/money";
import { PriceInput } from "./PriceInput";

/**
 * إعدادات التشغيل التي تتغيّر بالوقت لا بالبرمجة.
 *
 * أجرة التوصيل أولها: تتغيّر بتغيّر الوقود والمسافة، فمكانها لوحة التحكم لا
 * الكود. الأجرة السارية لحظة الطلب تُثبَّت على الطلب نفسه، فتغييرها اليوم لا
 * يعيد كتابة فواتير الأمس.
 */
export function SettingsCard({ deliveryFee }: { deliveryFee: number }) {
  const router = useRouter();
  const [fee, setFee] = useState(deliveryFee);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    const r = await setDeliveryFee(fee);
    setBusy(false);
    setMsg(r.ok ? "تم الحفظ" : r.error);
    if (r.ok) router.refresh();
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-bold">
        <Truck className="size-5 text-primary" />
        أجرة التوصيل
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        تُضاف إلى طلبات صفحة التوصيل وتظهر للزبون سطراً مستقلاً قبل الطلب. صفر = التوصيل مجاناً.
        لا تُحتسب ضمن مبيعات الكافيه ولا المعجنات — تُقيَّد على المحل.
      </p>

      <PriceInput value={fee} onChange={setFee} />

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={save}
          disabled={busy || fee === deliveryFee}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50"
        >
          حفظ
        </button>
        <span className="text-xs text-muted-foreground">
          {msg ?? `السارية الآن: ${deliveryFee > 0 ? formatIqdLabel(deliveryFee) : "مجاناً"}`}
        </span>
      </div>
    </section>
  );
}
