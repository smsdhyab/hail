"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Gift, Plus, Trash2, X } from "lucide-react";
import { saveCombo, toggleCombo, deleteCombo, type ComboAdmin } from "@/lib/cafe/pastry-actions";
import { formatIqdLabel } from "@/lib/cafe/money";
import { PriceInput } from "./PriceInput";

type PickerGroup = { category: string; items: { id: string; name_ar: string; price: number }[] };

/**
 * صانع العروض — «عرض اليوم».
 *
 * يجمع صنفين أو أكثر بسعر واحد. الأصناف تأتي من القسمين معاً، فالعرض المعتاد
 * مشروب من الكافيه مع معجّنة من المخبز.
 *
 * الفرق بين سعر العرض ومجموع أسعار القائمة يُعرض هنا صراحةً لأنه هو ما يتحمّله
 * المحل (أو يكسبه): كل قسم يبقى يقيّد سعر قائمته كاملاً في دفتره.
 */
export function CombosAdmin({ combos, groups }: { combos: ComboAdmin[]; groups: PickerGroup[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const byId = new Map(groups.flatMap((g) => g.items).map((i) => [i.id, i]));
  const pickedItems = picked.map((id) => byId.get(id)).filter(Boolean) as { id: string; name_ar: string; price: number }[];
  const listTotal = pickedItems.reduce((s, i) => s + i.price, 0);
  const gap = price - listTotal;

  function reset() {
    setEditing(null);
    setTitle("");
    setPrice(0);
    setPicked([]);
  }

  function edit(c: ComboAdmin) {
    setEditing(c.id);
    setTitle(c.title_ar);
    setPrice(c.price);
    setPicked(c.items.map((i) => i.id));
    setMsg(null);
  }

  function add(id: string) {
    if (!id || picked.includes(id)) return;
    const next = [...picked, id];
    setPicked(next);
    // عنوان مقترح من أسماء الأصناف — يبقى قابلاً للتعديل
    if (!editing) setTitle(next.map((i) => byId.get(i)?.name_ar).filter(Boolean).join(" + "));
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    const r = await saveCombo({ id: editing ?? undefined, title_ar: title, price, item_ids: picked });
    setBusy(false);
    setMsg(r.ok ? "تم حفظ العرض" : r.error);
    if (r.ok) {
      reset();
      router.refresh();
    }
  }

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    await fn();
    setBusy(false);
    router.refresh();
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-bold">
        <Gift className="size-5 text-[var(--accent)]" />
        صانع العروض — عرض اليوم
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        اجمع صنفين أو أكثر بسعر واحد. يظهر في قسم «عروض اليوم» المثبّت أعلى المنيو.
      </p>

      {/* ── المنتقي ── */}
      <div className="space-y-2.5 rounded-xl border border-dashed border-border p-3">
        <select
          value=""
          onChange={(e) => add(e.target.value)}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">أضف صنفاً إلى العرض…</option>
          {groups.map((g) => (
            <optgroup key={g.category} label={g.category}>
              {g.items.map((i) => (
                <option key={i.id} value={i.id} disabled={picked.includes(i.id)}>
                  {i.name_ar} — {formatIqdLabel(i.price)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        {pickedItems.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {pickedItems.map((i) => (
              <span key={i.id} className="flex items-center gap-1.5 rounded-full border border-[var(--accent)]/50 bg-[var(--accent)]/10 py-1 pe-2 ps-3 text-xs font-semibold">
                {i.name_ar}
                <span className="tabular-nums text-muted-foreground">{formatIqdLabel(i.price)}</span>
                <button onClick={() => setPicked(picked.filter((p) => p !== i.id))} aria-label="إزالة">
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="عنوان العرض (مثال: قهوة + كرواسون)"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />

        <div>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">سعر العرض</p>
          <PriceInput value={price} onChange={setPrice} />
        </div>

        {pickedItems.length >= 2 && (
          <p className="text-xs tabular-nums text-muted-foreground">
            مجموع القائمة {formatIqdLabel(listTotal)} ← سعر العرض {formatIqdLabel(price)}
            {gap !== 0 && (
              <span className={gap < 0 ? "text-emerald-600" : "text-amber-600"}>
                {" "}· {gap < 0 ? "يوفّر للزبون" : "أعلى بـ"} {formatIqdLabel(Math.abs(gap))}
              </span>
            )}
          </p>
        )}

        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={busy || picked.length < 2 || !title.trim()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-bold text-[var(--activeink)] disabled:opacity-50"
          >
            <Plus className="size-4" />
            {editing ? "حفظ التعديل" : "أضف العرض"}
          </button>
          {editing && (
            <button onClick={reset} className="rounded-lg border border-border px-4 py-2.5 text-sm font-bold">
              إلغاء
            </button>
          )}
        </div>

        {msg && <p className="text-xs font-semibold">{msg}</p>}
      </div>

      {/* ── العروض الحالية ── */}
      {combos.length > 0 && (
        <ul className="mt-3 space-y-2">
          {combos.map((c) => (
            <li key={c.id} className={`rounded-xl border p-3 ${c.is_active ? "border-[var(--accent)]/50" : "border-border opacity-60"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{c.title_ar}</p>
                  <p className="truncate text-xs text-muted-foreground">{c.items.map((i) => i.name_ar).join(" + ") || "— لا أصناف"}</p>
                  <p className="mt-0.5 text-sm font-extrabold tabular-nums text-[var(--accent)]">
                    {formatIqdLabel(c.price)}
                    <span className="ms-2 text-xs font-normal text-muted-foreground">
                      (مجموع القائمة {formatIqdLabel(c.list_total)})
                    </span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button onClick={() => edit(c)} className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold">
                    تعديل
                  </button>
                  <button
                    onClick={() => act(() => toggleCombo(c.id, !c.is_active))}
                    className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold"
                  >
                    {c.is_active ? "إيقاف" : "تفعيل"}
                  </button>
                  <button onClick={() => act(() => deleteCombo(c.id))} className="rounded-lg p-1.5 text-destructive" aria-label="حذف">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
