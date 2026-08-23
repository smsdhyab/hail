"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import {
  addCategory,
  setCategoryStation,
  addVariant,
  deleteItem,
  deleteVariant,
  toggleItem,
  upsertItem,
  uploadItemImage,
  type AdminCategory,
  type AdminItem,
} from "@/lib/cafe/menu-admin-actions";
import { formatIqdLabel } from "@/lib/cafe/money";
import { STATIONS, type StationSlug } from "@/lib/cafe/hail-menu";
import { MenuIcon } from "./MenuIcon";
import { PriceInput } from "./PriceInput";
import { resizeToWebp } from "@/lib/cafe/resize-image";

type Editing = { item: AdminItem | null; categoryId: string };

export function MenuAdminClient({ categories }: { categories: AdminCategory[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [newCat, setNewCat] = useState("");
  const [newCatStation, setNewCatStation] = useState<StationSlug>("pastry");
  const [msg, setMsg] = useState<string | null>(null);

  async function onToggle(item: AdminItem) {
    await toggleItem(item.id, !item.is_active);
    router.refresh();
  }

  async function onDelete(item: AdminItem) {
    if (!window.confirm(`حذف «${item.name_ar}» نهائياً؟ (يمكنك تعطيله بدلاً من حذفه)`)) return;
    const res = await deleteItem(item.id);
    if (!res.ok) setMsg(res.error);
    router.refresh();
  }

  async function onAddCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newCat.trim()) return;
    const res = await addCategory(newCat, newCatStation, categories.length + 1);
    if (!res.ok) {
      setMsg(res.error);
      return;
    }
    setNewCat("");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">إدارة المنيو</h1>
        <form onSubmit={onAddCategory} className="flex gap-1.5">
          <input
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
            placeholder="قسم جديد…"
            className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          {/* a category MUST name its register — that is what routes its orders */}
          <select
            value={newCatStation}
            onChange={(e) => setNewCatStation(e.target.value as StationSlug)}
            aria-label="كاشير القسم"
            className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            {STATIONS.map((st) => (
              <option key={st.slug} value={st.slug}>{st.emoji} {st.short_ar}</option>
            ))}
          </select>
          <button type="submit" className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold hover:bg-secondary">
            + قسم
          </button>
        </form>
      </div>

      {msg && <p className="text-sm text-destructive">{msg}</p>}

      {categories.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
          لا توجد بيانات — تأكد من الاتصال بقاعدة البيانات وصلاحية المدير.
        </div>
      )}

      {categories.map((cat) => (
        <section key={cat.id} className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-bold">
              {cat.name_ar} <span className="text-sm font-normal text-muted-foreground">({cat.items.length})</span>
              {/* which register gets these items — changing it re-routes the whole category */}
              <select
                value={cat.station_slug ?? "cafe"}
                onChange={async (e) => {
                  const res = await setCategoryStation(cat.id, e.target.value as StationSlug);
                  if (!res.ok) setMsg(res.error);
                  router.refresh();
                }}
                aria-label={`كاشير ${cat.name_ar}`}
                className="rounded-full border border-border bg-secondary px-2 py-0.5 text-xs font-semibold outline-none focus:ring-2 focus:ring-ring"
              >
                {STATIONS.map((st) => (
                  <option key={st.slug} value={st.slug}>{st.emoji} {st.short_ar}</option>
                ))}
              </select>
            </h2>
            <button
              onClick={() => setEditing({ item: null, categoryId: cat.id })}
              className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              <Plus className="size-4" />
              صنف جديد
            </button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-right text-muted-foreground">
                  <th className="px-3 py-2 font-medium">الصنف</th>
                  <th className="px-3 py-2 font-medium">السعر</th>
                  <th className="px-3 py-2 font-medium">الكلفة</th>
                  <th className="px-3 py-2 font-medium">الحالة</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {cat.items.map((it) => (
                  <tr key={it.id} className={`border-b border-border/60 last:border-0 ${it.is_active ? "" : "opacity-50"}`}>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2.5">
                        {it.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={it.image_url} alt="" className="size-10 rounded-lg object-cover" />
                        ) : (
                          <span className="flex size-10 items-center justify-center rounded-lg bg-secondary text-primary/70">
                            <MenuIcon name={it.name_ar} category={cat.name_ar} className="size-7" />
                          </span>
                        )}
                        <div>
                          <p className="font-medium">{it.name_ar}</p>
                          {(it.variants.length > 0 || it.flavors.length > 0) && (
                            <p className="text-xs text-muted-foreground">
                              {[...it.variants.map((v) => v.name_ar), ...it.flavors].join(" · ")}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {formatIqdLabel(it.price)}
                      {it.sold_by === "weight" && (
                        <span className="text-xs font-bold text-primary"> / {it.unit_label || "كغم"}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatIqdLabel(it.cost)}</td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => onToggle(it)}
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition ${
                          it.is_active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {it.is_active ? "مفعّل" : "معطّل"}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => setEditing({ item: it, categoryId: cat.id })} aria-label="تعديل" className="rounded-lg border border-border p-1.5 hover:bg-secondary">
                          <Pencil className="size-3.5" />
                        </button>
                        <button onClick={() => onDelete(it)} aria-label="حذف" className="rounded-lg border border-border p-1.5 text-destructive hover:bg-secondary">
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {editing && (
        <ItemForm
          key={editing.item?.id ?? "new"}
          editing={editing}
          categories={categories}
          onClose={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function ItemForm({ editing, categories, onClose }: { editing: Editing; categories: AdminCategory[]; onClose: () => void }) {
  const it = editing.item;
  const [name, setName] = useState(it?.name_ar ?? "");
  const [categoryId, setCategoryId] = useState(editing.categoryId);
  const [price, setPrice] = useState<number>(it?.price ?? 0);
  const [soldBy, setSoldBy] = useState<"piece" | "weight">(it?.sold_by ?? "piece");
  const [unitLabel, setUnitLabel] = useState(it?.unit_label ?? "");
  const [cost, setCost] = useState(String(it?.cost ?? ""));
  const [flavors, setFlavors] = useState((it?.flavors ?? []).join("، "));
  const [description, setDescription] = useState(it?.description_ar ?? "");
  const [sort, setSort] = useState(String(it?.sort ?? 0));
  const [imageUrl, setImageUrl] = useState(it?.image_url ?? "");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [variants, setVariants] = useState(it?.variants ?? []);
  const [vName, setVName] = useState("");
  const [vPrice, setVPrice] = useState("");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    setMsg(null);
    const fd = new FormData();
    // shrink on the device: a phone photo goes up as ~120 KB, not 4 MB
    fd.append("file", await resizeToWebp(f));
    const res = await uploadItemImage(fd);
    setUploading(false);
    if (!res.ok) {
      setMsg(res.error);
      return;
    }
    setImageUrl(res.url);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await upsertItem({
      id: it?.id,
      category_id: categoryId,
      name_ar: name,
      description_ar: description || null,
      image_url: imageUrl || null,
      price: Number(price) || 0,
      sold_by: soldBy,
      unit_label: unitLabel,
      cost: Number(cost) || 0,
      flavors: flavors.split(/[،,]/).map((s) => s.trim()).filter(Boolean),
      is_active: it?.is_active ?? true,
      sort: Number(sort) || 0,
    });
    setBusy(false);
    if (!res.ok) {
      setMsg(res.error);
      return;
    }
    onClose();
  }

  async function onAddVariant() {
    if (!it) return;
    const p = Number(vPrice) || 0;
    const res = await addVariant(it.id, vName, p);
    if (!res.ok) {
      setMsg(res.error);
      return;
    }
    setVariants([...variants, { id: `tmp-${vName}-${p}`, name_ar: vName, price_override: p, kind: "size", sort: variants.length }]);
    setVName("");
    setVPrice("");
  }

  async function onDeleteVariant(id: string) {
    await deleteVariant(id);
    setVariants(variants.filter((v) => v.id !== id));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-lg space-y-4 rounded-2xl bg-card p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">{it ? `تعديل: ${it.name_ar}` : "صنف جديد"}</h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1 hover:bg-secondary">
            <X className="size-5" />
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="text-muted-foreground">اسم الصنف *</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">القسم</span>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring">
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name_ar}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">الترتيب</span>
            <input type="number" value={sort} onChange={(e) => setSort(e.target.value)} dir="ltr" className="w-full rounded-lg border border-input bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring" />
          </label>
          <div className="space-y-1 text-sm sm:col-span-2">
            <span className="text-muted-foreground">طريقة البيع</span>
            <div className="flex gap-2">
              {([["piece", "بالقطعة"], ["weight", "بالوزن"]] as const).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setSoldBy(v)}
                  className={`flex-1 rounded-lg border px-3 py-2 font-bold transition ${
                    soldBy === v ? "border-primary bg-primary/10 text-primary" : "border-input text-muted-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {soldBy === "weight" && (
              <p className="text-xs text-muted-foreground">
                السعر أدناه يصير <b>سعر الكيلو</b>، والكاشير يُدخل الوزن بالغرام عند البيع.
              </p>
            )}
          </div>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">{soldBy === "weight" ? "سعر الكيلو (د.ع) *" : "سعر البيع (د.ع) *"}</span>
            <PriceInput value={price} onChange={setPrice} />
          </label>
          {soldBy === "weight" && (
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">الوحدة (افتراضياً كغم)</span>
              <input value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)} placeholder="كغم" className="w-full rounded-lg border border-input bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring" />
            </label>
          )}
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">{soldBy === "weight" ? "كلفة الكيلو (د.ع) — لحساب الأرباح" : "الكلفة (د.ع) — لحساب الأرباح"}</span>
            <input type="number" min={0} value={cost} onChange={(e) => setCost(e.target.value)} dir="ltr" className="w-full rounded-lg border border-input bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring" />
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="text-muted-foreground">النكهات (افصل بفاصلة): كراميل، فانيلا…</span>
            <input value={flavors} onChange={(e) => setFlavors(e.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring" />
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="text-muted-foreground">وصف (اختياري)</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring" />
          </label>

          {/* image */}
          <div className="flex items-center gap-3 sm:col-span-2">
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="" className="size-16 rounded-lg border border-border object-cover" />
            ) : (
              <span className="flex size-16 items-center justify-center rounded-lg bg-secondary text-primary/70">
                <MenuIcon name={name || "صنف"} className="size-10" />
              </span>
            )}
            <label className="cursor-pointer rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-secondary">
              {uploading ? "جارٍ الرفع…" : "رفع صورة"}
              <input type="file" accept="image/*" onChange={onFile} className="hidden" />
            </label>
            {imageUrl && (
              <button onClick={() => setImageUrl("")} className="text-sm text-destructive underline">
                إزالة الصورة
              </button>
            )}
          </div>
        </div>

        {/* variants */}
        <div className="space-y-2 rounded-xl bg-secondary/60 p-3">
          <p className="text-sm font-semibold">الأحجام (اختياري)</p>
          {it ? (
            <>
              {variants.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {variants.map((v) => (
                    <li key={v.id} className="flex items-center justify-between rounded-lg bg-background px-3 py-1.5">
                      <span>
                        {v.name_ar} — {formatIqdLabel(v.price_override ?? (Number(price) || 0))}
                      </span>
                      <button onClick={() => onDeleteVariant(v.id)} aria-label="حذف الحجم" className="text-destructive">
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-1.5">
                <input value={vName} onChange={(e) => setVName(e.target.value)} placeholder="مثال: وسط" className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
                <input type="number" min={0} value={vPrice} onChange={(e) => setVPrice(e.target.value)} placeholder="السعر" dir="ltr" className="w-28 rounded-lg border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
                <button onClick={onAddVariant} className="whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-sm font-semibold hover:bg-background">
                  + حجم
                </button>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">احفظ الصنف أولاً ثم عدّله لإضافة الأحجام.</p>
          )}
        </div>

        {msg && <p className="text-sm text-destructive">{msg}</p>}

        <div className="flex gap-2">
          <button onClick={save} disabled={busy || uploading} className="flex-1 rounded-xl bg-primary px-4 py-2.5 font-bold text-primary-foreground transition hover:opacity-90 disabled:opacity-50">
            {busy ? "جارٍ الحفظ…" : "حفظ"}
          </button>
          <button onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 font-semibold hover:bg-secondary">
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
