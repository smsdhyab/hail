"use client";

import { useMemo, useReducer, useState } from "react";
import Link from "next/link";
import { Minus, Plus, ShoppingCart, X, Check, Sparkles } from "lucide-react";
import type { MenuCategoryView, MenuItemView } from "@/lib/cafe/menu-data";
import { MenuIcon } from "./MenuIcon";
import { HailMark } from "./Logo";
import { formatIqdLabel } from "@/lib/cafe/money";
import { submitOrder, type OrderLineInput } from "@/lib/cafe/order-actions";

type Line = {
  key: string;
  itemId: string;
  name: string;
  variantId: string | null;
  flavor: string | null;
  unitPrice: number;
  qty: number;
};
type Cart = Record<string, Line>;
type CartAction =
  | { type: "add"; line: Omit<Line, "qty"> }
  | { type: "inc"; key: string }
  | { type: "dec"; key: string }
  | { type: "clear" };

function cartReducer(state: Cart, action: CartAction): Cart {
  switch (action.type) {
    case "add": {
      const existing = state[action.line.key];
      return { ...state, [action.line.key]: { ...action.line, qty: (existing?.qty ?? 0) + 1 } };
    }
    case "inc": {
      const l = state[action.key];
      return l ? { ...state, [action.key]: { ...l, qty: l.qty + 1 } } : state;
    }
    case "dec": {
      const l = state[action.key];
      if (!l) return state;
      if (l.qty <= 1) {
        const next = { ...state };
        delete next[action.key];
        return next;
      }
      return { ...state, [action.key]: { ...l, qty: l.qty - 1 } };
    }
    case "clear":
      return {};
  }
}

export function MenuOrderClient({
  menu,
  channel,
  table,
  demo,
}: {
  menu: MenuCategoryView[];
  channel: "qr" | "kiosk";
  table?: string | null;
  demo: boolean;
}) {
  const [cart, dispatch] = useReducer(cartReducer, {});
  const [cartOpen, setCartOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [custName, setCustName] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [confirmed, setConfirmed] = useState<{ orderNumber: string; cardSerial: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lines = Object.values(cart);
  const total = useMemo(() => lines.reduce((s, l) => s + l.unitPrice * l.qty, 0), [lines]);
  const count = lines.reduce((s, l) => s + l.qty, 0);

  async function onSubmit() {
    setSubmitting(true);
    setError(null);
    const payload: OrderLineInput[] = lines.map((l) => ({
      item_id: l.itemId,
      variant_id: l.variantId,
      flavor: l.flavor,
      qty: l.qty,
    }));
    const res = await submitOrder({
      channel,
      table: table ?? null,
      lines: payload,
      name: custName.trim() || null,
      phone: custPhone.trim() || null,
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    dispatch({ type: "clear" });
    setCartOpen(false);
    setConfirmed({ orderNumber: res.orderNumber, cardSerial: res.cardSerial ?? null });
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
      {/* header */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <HailMark className="size-11 shrink-0" />
            <div>
              <h1 className="text-xl font-extrabold text-primary">مخبز ومقهى هيل</h1>
              <p className="text-xs text-muted-foreground">
                {channel === "kiosk" ? "الطلب من الجهاز اللوحي" : "المنيو الرقمي"}
                {table ? ` · طاولة ${table}` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {demo && (
              <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-accent-foreground">
                وضع تجريبي
              </span>
            )}
            {channel === "qr" && (
              <Link
                href={`/menu${table ? `?t=${table}` : ""}`}
                className="flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground transition hover:opacity-90"
              >
                <Sparkles className="size-3.5" />
                المنيو المودرن
              </Link>
            )}
          </div>
        </div>
        {/* category quick-nav */}
        <nav className="mt-3 -mb-1 flex gap-2 overflow-x-auto pb-1">
          {menu.map((c) => (
            <a
              key={c.name_ar}
              href={`#cat-${c.name_ar}`}
              className="whitespace-nowrap rounded-full border border-border px-3 py-1 text-sm text-foreground/80 transition hover:bg-secondary"
            >
              {c.name_ar}
            </a>
          ))}
        </nav>
      </header>

      {/* menu */}
      <main className="flex-1 space-y-8 px-4 py-5 pb-28">
        {menu.map((c) => (
          <section key={c.name_ar} id={`cat-${c.name_ar}`} className="scroll-mt-32 space-y-3">
            <h2 className="text-lg font-bold text-foreground">{c.name_ar}</h2>
            <div className="grid gap-3">
              {c.items.map((it) => (
                <ItemCard key={it.id} item={it} category={c.name_ar} onAdd={(line) => dispatch({ type: "add", line })} />
              ))}
            </div>
          </section>
        ))}
      </main>

      {/* sticky cart bar */}
      {count > 0 && !cartOpen && (
        <button
          onClick={() => setCartOpen(true)}
          className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-2xl items-center justify-between gap-3 bg-primary px-5 py-4 font-semibold text-primary-foreground shadow-lg"
        >
          <span className="flex items-center gap-2">
            <ShoppingCart className="size-5" />
            <span>{count} صنف</span>
          </span>
          <span>عرض السلة · {formatIqdLabel(total)}</span>
        </button>
      )}

      {/* cart sheet */}
      {cartOpen && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/40" onClick={() => setCartOpen(false)}>
          <div
            className="mx-auto max-h-[85dvh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-card p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-bold">سلة الطلب</h3>
              <button onClick={() => setCartOpen(false)} aria-label="إغلاق" className="rounded-full p-1 hover:bg-secondary">
                <X className="size-5" />
              </button>
            </div>

            <ul className="divide-y divide-border">
              {lines.map((l) => (
                <li key={l.key} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{l.name}</p>
                    {l.flavor && <p className="text-xs text-muted-foreground">{l.flavor}</p>}
                    <p className="text-sm text-muted-foreground">{formatIqdLabel(l.unitPrice)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => dispatch({ type: "dec", key: l.key })} aria-label="إنقاص" className="rounded-full border border-border p-1.5 hover:bg-secondary">
                      <Minus className="size-4" />
                    </button>
                    <span className="w-6 text-center font-semibold">{l.qty}</span>
                    <button onClick={() => dispatch({ type: "inc", key: l.key })} aria-label="زيادة" className="rounded-full border border-border p-1.5 hover:bg-secondary">
                      <Plus className="size-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            {/* customer capture (optional) */}
            <div className="mt-4 space-y-2 rounded-xl bg-secondary/60 p-3">
              <p className="text-xs font-semibold text-primary">🎁 أضف اسمك ورقمك (اختياري) — بطاقة ولاء ونقاط مع كل طلب</p>
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={custName}
                  onChange={(e) => setCustName(e.target.value)}
                  placeholder="الاسم"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <input
                  value={custPhone}
                  onChange={(e) => setCustPhone(e.target.value)}
                  placeholder="07XXXXXXXXX"
                  dir="ltr"
                  inputMode="tel"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>

            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

            <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
              <span className="text-muted-foreground">الإجمالي</span>
              <span className="text-lg font-bold">{formatIqdLabel(total)}</span>
            </div>
            <button
              onClick={onSubmit}
              disabled={submitting || count === 0}
              className="mt-4 w-full rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? "جارٍ الإرسال…" : "إرسال الطلب"}
            </button>
          </div>
        </div>
      )}

      {/* confirmation */}
      {confirmed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={() => setConfirmed(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-card p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Check className="size-8" />
            </div>
            <h3 className="text-xl font-bold">تم استلام طلبك</h3>
            <p className="mt-1 text-muted-foreground">رقم الطلب</p>
            <p className="my-2 text-4xl font-extrabold text-primary">{confirmed.orderNumber}</p>
            <p className="text-sm text-muted-foreground">اذكر الرقم عند الكاشير للدفع والاستلام.</p>
            {confirmed.cardSerial && (
              <a
                href={`/card/${confirmed.cardSerial}`}
                target="_blank"
                className="mt-3 block rounded-xl bg-primary/10 px-4 py-3 text-sm font-semibold text-primary transition hover:bg-primary/20"
              >
                🎁 بطاقة ولائك جاهزة — اضغط لفتحها واحفظها في هاتفك
              </a>
            )}
            <button onClick={() => setConfirmed(null)} className="mt-5 w-full rounded-xl border border-border px-4 py-2.5 font-semibold hover:bg-secondary">
              طلب جديد
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ItemCard({ item, category, onAdd }: { item: MenuItemView; category?: string; onAdd: (line: Omit<Line, "qty">) => void }) {
  const [variantId, setVariantId] = useState<string | null>(item.variants[0]?.id ?? null);
  const [flavor, setFlavor] = useState<string | null>(item.flavors[0] ?? null);

  const variant = item.variants.find((v) => v.id === variantId) ?? null;
  const unitPrice = variant?.price ?? item.price;
  const displayName = variant ? `${item.name_ar} - ${variant.name_ar}` : item.name_ar;

  function add() {
    const key = `${item.id}|${variantId ?? ""}|${flavor ?? ""}`;
    onAdd({ key, itemId: item.id, name: displayName, variantId, flavor, unitPrice });
  }

  return (
    <div className="flex gap-3 rounded-xl border border-border bg-card p-3">
      <div className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-secondary to-accent/25 text-primary">
        {item.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.image_url} alt={item.name_ar} className="size-full rounded-lg object-cover" loading="lazy" />
        ) : (
          <MenuIcon name={item.name_ar} category={category} className="size-10" />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold">{item.name_ar}</p>
          <p className="whitespace-nowrap font-bold text-primary">{formatIqdLabel(unitPrice)}</p>
        </div>

        {item.variants.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {item.variants.map((v) => (
              <button
                key={v.id}
                onClick={() => setVariantId(v.id)}
                className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                  v.id === variantId ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-secondary"
                }`}
              >
                {v.name_ar}
              </button>
            ))}
          </div>
        )}

        {item.flavors.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {item.flavors.map((f) => (
              <button
                key={f}
                onClick={() => setFlavor(f)}
                className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                  f === flavor ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-secondary"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        )}

        <div className="mt-auto flex justify-end pt-2">
          <button
            onClick={add}
            className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          >
            <Plus className="size-4" />
            أضف
          </button>
        </div>
      </div>
    </div>
  );
}
