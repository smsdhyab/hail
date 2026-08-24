"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PackagePlus, TriangleAlert, Boxes } from "lucide-react";
import { addPurchase, setLowAt, setStock, type ItemMargin, type PurchaseRow } from "@/lib/cafe/purchase-actions";
import { formatIqd, formatIqdLabel } from "@/lib/cafe/money";
import { formatQty } from "@/lib/cafe/order";

const qtyText = (m: { stock: number; sold_by: string; unit: string }) =>
  m.sold_by === "weight" ? formatQty(m.stock, "weight", m.unit) : `${m.stock} ${m.unit}`;

/**
 * المشتريات والمخزون.
 *
 * تُدخل الكمية والمبلغ الكلي كما هما في فاتورة المورّد — وكلفة الوحدة تُحسب.
 * طلبُ كلفة الوحدة مباشرةً يجبر صاحب المحل على القسمة في رأسه عند كل فاتورة،
 * وأي خطأ فيها يفسد حساب الربح لكل بيعة تالية.
 */
export function PurchasesClient({ margins, purchases }: { margins: ItemMargin[]; purchases: PurchaseRow[] }) {
  const router = useRouter();
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("");
  const [total, setTotal] = useState("");
  const [supplier, setSupplier] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const item = margins.find((m) => m.item_id === itemId) ?? null;
  const q = Number(qty) || 0;
  const t = Number(total) || 0;
  const unit = q > 0 ? Math.round(t / q) : 0;
  const low = margins.filter((m) => m.is_low);

  async function save() {
    setBusy(true);
    setMsg(null);
    const r = await addPurchase({ item_id: itemId, qty: q, total_cost: t, supplier });
    setBusy(false);
    if (!r.ok) return setMsg(r.error);
    setMsg(`تم — كلفة الوحدة ${formatIqdLabel(r.unit_cost)} · الرصيد ${r.stock}`);
    setQty("");
    setTotal("");
    router.refresh();
  }

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    await fn();
    setBusy(false);
    router.refresh();
  }

  const field = "w-full rounded-lg border border-input bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="space-y-4">
      <h1 className="flex items-center gap-2 text-xl font-bold">
        <Boxes className="size-5 text-primary" />
        المشتريات والمخزون
      </h1>

      {low.length > 0 && (
        <section className="rounded-2xl border-2 border-destructive/50 bg-destructive/5 p-4">
          <h2 className="mb-2 flex items-center gap-2 font-extrabold text-destructive">
            <TriangleAlert className="size-4" />
            نواقص ({low.length})
          </h2>
          <ul className="flex flex-wrap gap-2">
            {low.map((m) => (
              <li key={m.item_id} className="rounded-full border border-destructive/40 bg-background px-3 py-1 text-xs font-bold">
                {m.name_ar} — بقي {qtyText(m)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-1 flex items-center gap-2 font-extrabold text-primary">
          <PackagePlus className="size-4" />
          تسجيل شراء
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          أدخل الكمية والمبلغ الكلي كما في فاتورة المورّد — وكلفة الوحدة تُحسب وحدها.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="text-muted-foreground">الصنف</span>
            <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={field}>
              <option value="">اختر الصنف…</option>
              {margins.map((m) => (
                <option key={m.item_id} value={m.item_id}>
                  {m.name_ar} — {m.category} · الرصيد {qtyText(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">
              الكمية {item ? `(${item.sold_by === "weight" ? item.unit : "قطعة"})` : ""}
            </span>
            <input
              value={qty}
              onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ""))}
              inputMode="decimal"
              dir="ltr"
              placeholder="6"
              className={field}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">المبلغ الكلي (د.ع)</span>
            <input
              value={total}
              onChange={(e) => setTotal(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              dir="ltr"
              placeholder="90000"
              className={field}
            />
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="text-muted-foreground">المورّد (اختياري)</span>
            <input value={supplier} onChange={(e) => setSupplier(e.target.value)} className={field} />
          </label>
        </div>

        {unit > 0 && item && (
          <p className="mt-3 rounded-xl border border-border bg-secondary/40 p-3 text-sm">
            كلفة الوحدة <b className="tabular-nums">{formatIqdLabel(unit)}</b> /{" "}
            {item.sold_by === "weight" ? item.unit : "قطعة"}
            {item.price > 0 && (
              <>
                {" · "}البيع <b className="tabular-nums">{formatIqdLabel(item.price)}</b>
                {" · "}
                <b className={unit < item.price ? "text-emerald-600" : "text-destructive"}>
                  {unit < item.price ? "ربح" : "خسارة"} {formatIqdLabel(Math.abs(item.price - unit))}
                </b>
              </>
            )}
          </p>
        )}

        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={save}
            disabled={busy || !itemId || q <= 0}
            className="rounded-lg bg-primary px-5 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50"
          >
            حفظ الشراء
          </button>
          {msg && <span className="text-xs font-semibold">{msg}</span>}
        </div>
      </section>

      <section className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[720px] text-right text-sm">
          <thead className="border-b border-border bg-secondary/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-semibold">الصنف</th>
              <th className="px-3 py-2 font-semibold">الكلفة</th>
              <th className="px-3 py-2 font-semibold">البيع</th>
              <th className="px-3 py-2 font-semibold">الربح</th>
              <th className="px-3 py-2 font-semibold">الرصيد</th>
              <th className="px-3 py-2 font-semibold">ينبّه عند</th>
              <th className="px-3 py-2 font-semibold">جرد</th>
            </tr>
          </thead>
          <tbody>
            {margins.map((m) => (
              <tr key={m.item_id} className={`border-b border-border/60 last:border-0 ${m.is_low ? "bg-destructive/5" : ""}`}>
                <td className="px-3 py-2">
                  <p className="font-semibold">{m.name_ar}</p>
                  <p className="text-xs text-muted-foreground">{m.category}</p>
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">
                  {m.cost ? formatIqd(m.cost) : "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{m.price ? formatIqd(m.price) : "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                  {m.cost && m.price ? (
                    <span className={m.margin > 0 ? "font-bold text-emerald-600" : "font-bold text-destructive"}>
                      {formatIqd(m.margin)}
                      {m.margin_pct !== null && <span className="text-xs font-normal"> ({m.margin_pct}%)</span>}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className={`whitespace-nowrap px-3 py-2 tabular-nums ${m.is_low ? "font-bold text-destructive" : ""}`}>
                  {qtyText(m)}
                </td>
                <td className="px-3 py-2">
                  <input
                    defaultValue={m.low_at}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v !== m.low_at) void act(() => setLowAt(m.item_id, v));
                    }}
                    inputMode="decimal"
                    dir="ltr"
                    className="w-20 rounded-lg border border-input bg-background px-2 py-1 text-center"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    defaultValue={m.stock}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v !== m.stock) void act(() => setStock(m.item_id, v));
                    }}
                    inputMode="decimal"
                    dir="ltr"
                    className="w-20 rounded-lg border border-input bg-background px-2 py-1 text-center"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {purchases.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="mb-3 font-extrabold text-primary">آخر المشتريات</h2>
          <ul className="space-y-2">
            {purchases.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2 last:border-0">
                <div>
                  <p className="text-sm font-semibold">{p.item_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.business_day} · {p.qty} × {formatIqd(p.unit_cost)}
                    {p.supplier ? ` · ${p.supplier}` : ""}
                  </p>
                </div>
                <span className="font-bold tabular-nums">{formatIqdLabel(p.total_cost)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="rounded-2xl border border-border bg-secondary/30 p-4 text-xs leading-relaxed text-muted-foreground">
        <b className="text-foreground">لماذا لا تظهر المشتريات في «المصروفات»؟</b> النظام يخصم كلفة البضاعة مع كل بيعة
        (الربح = البيع − الكلفة). فلو سُجّل الشراء مصروفاً أيضاً لخُصم مرتين: يظهر المحل خاسراً يوم الشراء ورابحاً بلا
        كلفة بقيّة الأيام. المصروفات تبقى لما لا بضاعة له — إيجار ورواتب وكهرباء.
      </p>
    </div>
  );
}
