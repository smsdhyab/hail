"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Check, Minus, Plus, Printer, QrCode, Trash2 } from "lucide-react";
import type { MenuCategoryView, MenuItemView } from "@/lib/cafe/menu-data";
import { formatIqdLabel } from "@/lib/cafe/money";
import { lineTotal, qtyMin, qtyStep, roundQty, type SoldBy } from "@/lib/cafe/order";
import { cashierCheckout } from "@/lib/cafe/cashier-actions";
import { findCard, redeemReward, type Card } from "@/lib/cafe/loyalty-actions";
import { QrScanner } from "./QrScanner";
import { Receipt, type ReceiptData } from "./Receipt";
import { MenuIcon } from "./MenuIcon";
import { PriceInput } from "./PriceInput";
import { FridayPrayerNotice } from "./FridayPrayerNotice";

type Line = {
  key: string;
  itemId: string;
  name: string;
  variantId: string | null;
  flavor: string | null;
  /** سعر القطعة — أو سعر الكيلو حين soldBy = "weight" */
  unitPrice: number;
  qty: number;
  soldBy: SoldBy;
};
type Cart = Record<string, Line>;
type CartAction =
  | { type: "add"; line: Omit<Line, "qty">; qty?: number }
  | { type: "inc"; key: string }
  | { type: "dec"; key: string }
  | { type: "setQty"; key: string; qty: number }
  | { type: "clear" };

function cartReducer(state: Cart, action: CartAction): Cart {
  switch (action.type) {
    case "add": {
      const ex = state[action.line.key];
      const add = action.qty ?? qtyStep(action.line.soldBy);
      return {
        ...state,
        [action.line.key]: { ...action.line, qty: roundQty((ex?.qty ?? 0) + add, action.line.soldBy) },
      };
    }
    case "inc": {
      const l = state[action.key];
      return l ? { ...state, [action.key]: { ...l, qty: roundQty(l.qty + qtyStep(l.soldBy), l.soldBy) } } : state;
    }
    case "dec": {
      const l = state[action.key];
      if (!l) return state;
      const next = roundQty(l.qty - qtyStep(l.soldBy), l.soldBy);
      if (next < qtyMin(l.soldBy)) {
        const n = { ...state };
        delete n[action.key];
        return n;
      }
      return { ...state, [action.key]: { ...l, qty: next } };
    }
    case "setQty": {
      const l = state[action.key];
      if (!l) return state;
      const qty = roundQty(Math.max(0, action.qty), l.soldBy);
      if (qty < qtyMin(l.soldBy)) {
        const n = { ...state };
        delete n[action.key];
        return n;
      }
      return { ...state, [action.key]: { ...l, qty } };
    }
    case "clear":
      return {};
  }
}

export function CashierClient({ menu, tables }: { menu: MenuCategoryView[]; tables: string[] }) {
  const [activeCat, setActiveCat] = useState(menu[0]?.name_ar ?? "");
  const [cart, dispatch] = useReducer(cartReducer, {});
  const [discount, setDiscount] = useState(0);
  const [customer, setCustomer] = useState<Card | null>(null);
  const [serialInput, setSerialInput] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [loyaltyMsg, setLoyaltyMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [success, setSuccess] = useState<{ orderNumber: string; awarded: number } | null>(null);
  // cash opens the drawer; Qi-card payments happen on the Qi device — no drawer.
  const [payMethod, setPayMethod] = useState<"cash" | "card">("cash");
  // dine-in orders carry a table number → they show on the live tables screen
  const [orderType, setOrderType] = useState<"takeaway" | "dinein">("takeaway");
  const [tableNo, setTableNo] = useState("");
  const [orderNote, setOrderNote] = useState("");
  // itemized surcharges for add-ons the customer requests (extra shot, syrup…)
  const [extras, setExtras] = useState<{ name: string; price: number }[]>([]);
  const [extraPrice, setExtraPrice] = useState(0);

  // cash drawer: device setting managed on the /orders screen (same localStorage key).
  const drawerKickRef = useRef(false);
  const kickBusyRef = useRef(false);
  const checkoutBusyRef = useRef(false);
  useEffect(() => {
    drawerKickRef.current = localStorage.getItem("hail-drawer") === "1";
  }, []);
  function kickDrawer() {
    // guard against a double-open if the pay action ever fires twice in quick succession
    if (!drawerKickRef.current || kickBusyRef.current) return;
    kickBusyRef.current = true;
    setTimeout(() => { kickBusyRef.current = false; }, 2500);
    // localhost is exempt from mixed-content blocking; fire-and-forget
    fetch("http://127.0.0.1:9977/kick", { mode: "no-cors" }).catch(() => {});
  }

  // Auto-print the receipt the moment an order completes. Silent one-click under
  // the «كاشير هيل» shortcut (--kiosk-printing); the manual طباعة button stays
  // as a reprint. The small delay lets the print-only receipt lay out first.
  useEffect(() => {
    if (!receipt) return;
    const id = setTimeout(() => window.print(), 250);
    return () => clearTimeout(id);
  }, [receipt]);

  const lines = Object.values(cart);
  const subtotal = useMemo(() => lines.reduce((s, l) => s + lineTotal(l.unitPrice, l.qty, l.soldBy), 0), [lines]);
  const extraTotal = useMemo(() => extras.reduce((s, x) => s + x.price, 0), [extras]);
  const total = Math.max(0, subtotal - discount + extraTotal);

  function addExtra() {
    // description is verbal at the counter — the cashier only enters the amount
    const price = Math.max(0, Math.round(extraPrice || 0));
    if (price <= 0) return;
    setExtras((xs) => [...xs, { name: "إضافة", price }]);
    setExtraPrice(0);
  }
  const cat = menu.find((c) => c.name_ar === activeCat) ?? menu[0];

  async function lookup(serial: string) {
    const s = serial.trim();
    if (!s) return;
    setLoyaltyMsg(null);
    const card = await findCard(s);
    if (!card) {
      setLoyaltyMsg("بطاقة غير موجودة.");
      return;
    }
    setCustomer(card);
  }

  const onScanned = useCallback((text: string) => {
    setScanOpen(false);
    void lookup(text);
  }, []);

  async function redeem() {
    if (!customer) return;
    setLoyaltyMsg(null);
    const res = await redeemReward(customer.id, total);
    if (!res.ok) {
      setLoyaltyMsg(res.error);
      return;
    }
    // ponytail: redeem deducts points immediately, before payment — a cancelled
    // checkout needs a manual adjust-back. Acceptable v1.
    setDiscount((d) => d + res.discount);
    setCustomer({ ...customer, points: res.balance });
    setLoyaltyMsg(`تم استبدال مكافأة — خصم ${formatIqdLabel(res.discount)}`);
  }

  async function checkout() {
    // checkoutBusyRef is synchronous — `busy` state updates a tick later, so a
    // rapid double-tap would otherwise submit twice (double order + double drawer).
    if (!lines.length || checkoutBusyRef.current || busy) return;
    if (orderType === "dinein" && !tableNo) {
      setErr("اختر رقم الطاولة.");
      return;
    }
    checkoutBusyRef.current = true;
    setBusy(true);
    setErr(null);
    // try/finally so the button ALWAYS unsticks — a thrown action (expired
    // session, network drop) must never freeze the cashier on «جار التنفيذ».
    try {
      const table = orderType === "dinein" ? tableNo : null;
      const extraNote = extras.map((x) => `${x.name} (${formatIqdLabel(x.price)})`).join("، ") || null;
      const payload = lines.map((l) => ({ item_id: l.itemId, variant_id: l.variantId, flavor: l.flavor, qty: l.qty }));
      const res = await cashierCheckout({ lines: payload, discount, extra: extraTotal, extraNote, customerId: customer?.id ?? null, table, note: orderNote.trim() || null });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setReceipt({
        orderNumber: res.orderNumber,
        table,
        // one payment, but the ticket shows what each register earned
        splits: res.perStation,
        note: orderNote.trim() || null,
        lines: lines.map((l) => ({ name: l.name, flavor: l.flavor, qty: l.qty, unitPrice: l.unitPrice, soldBy: l.soldBy })),
        subtotal,
        discount,
        extras,
        total,
        dateTime: new Date().toLocaleString("en-GB", {
          timeZone: "Asia/Baghdad",
          hour: "2-digit",
          minute: "2-digit",
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        }),
      });
      if (payMethod === "cash") kickDrawer();
      setSuccess({ orderNumber: res.orderNumber, awarded: res.awarded });
      dispatch({ type: "clear" });
      setCustomer(null);
      setDiscount(0);
      setExtras([]);
      setSerialInput("");
      setPayMethod("cash");
      setOrderType("takeaway");
      setTableNo("");
      setOrderNote("");
    } catch {
      setErr("تعذّر إتمام الطلب — تأكد من الاتصال بالإنترنت وأعد المحاولة. إن تكرّر، حدّث الصفحة (F5).");
    } finally {
      checkoutBusyRef.current = false;
      setBusy(false);
    }
  }

  return (
    // minmax(0,1fr) + min-w-0: without them the scrollable pills row's intrinsic
    // width blows the grid past narrow POS screens (1024px) → horizontal cut.
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <FridayPrayerNotice />
      {/* items */}
      <section className="min-w-0 space-y-4">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {menu.map((c) => (
            <button
              key={c.name_ar}
              onClick={() => setActiveCat(c.name_ar)}
              className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                c.name_ar === (cat?.name_ar ?? "") ? "bg-primary text-primary-foreground" : "border border-border hover:bg-secondary"
              }`}
            >
              {c.name_ar}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {cat?.items.map((it) => (
            <CashierItem key={it.id} item={it} category={cat?.name_ar} onAdd={(line) => dispatch({ type: "add", line })} />
          ))}
        </div>
      </section>

      {/* order panel */}
      <aside className="h-fit min-w-0 space-y-4 rounded-2xl border border-border bg-card p-4 lg:sticky lg:top-20">
        <h2 className="text-lg font-bold">الطلب الحالي</h2>

        {lines.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            اختر الأصناف من القائمة.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {lines.map((l) => (
              <li key={l.key} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{l.name}</p>
                  {l.flavor && <p className="text-xs text-muted-foreground">{l.flavor}</p>}
                  <p className="text-xs text-muted-foreground">
                    {formatIqdLabel(l.unitPrice)}
                    {l.soldBy === "weight" && " / كغم"}
                    {l.soldBy === "weight" && (
                      <b className="text-foreground"> ← {formatIqdLabel(lineTotal(l.unitPrice, l.qty, l.soldBy))}</b>
                    )}
                  </p>
                </div>
                {l.soldBy === "weight" ? (
                  // الميزان يعطي غرامات — فيُكتب الرقم كما هو بلا حساب ذهني
                  <div className="flex shrink-0 items-center gap-1">
                    <input
                      inputMode="numeric"
                      value={Math.round(l.qty * 1000)}
                      onChange={(e) => dispatch({ type: "setQty", key: l.key, qty: (Number(e.target.value.replace(/[^\d]/g, "")) || 0) / 1000 })}
                      dir="ltr"
                      className="w-16 rounded-lg border border-input bg-background px-2 py-1 text-center text-sm font-bold outline-none focus:ring-2 focus:ring-ring"
                    />
                    <span className="text-xs text-muted-foreground">غم</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => dispatch({ type: "dec", key: l.key })} aria-label="إنقاص" className="rounded-full border border-border p-1 hover:bg-secondary">
                      <Minus className="size-3.5" />
                    </button>
                    <span className="w-5 text-center text-sm font-semibold">{l.qty}</span>
                    <button onClick={() => dispatch({ type: "inc", key: l.key })} aria-label="زيادة" className="rounded-full border border-border p-1 hover:bg-secondary">
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* loyalty */}
        <div className="space-y-2 rounded-xl bg-secondary/60 p-3">
          <p className="text-sm font-semibold">بطاقة الولاء</p>
          {customer ? (
            <div className="flex items-center justify-between gap-2 text-sm">
              <div>
                <p className="font-medium">{customer.name_ar ?? "زبون"}</p>
                <p className="text-xs text-muted-foreground">الرصيد: {customer.points} نقطة</p>
              </div>
              <div className="flex gap-1.5">
                <button onClick={redeem} className="rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-accent-foreground hover:opacity-90">
                  استبدال مكافأة
                </button>
                <button onClick={() => setCustomer(null)} aria-label="إزالة" className="rounded-lg border border-border p-1.5 hover:bg-background">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-1.5">
              <input
                value={serialInput}
                onChange={(e) => setSerialInput(e.target.value)}
                placeholder="رقم البطاقة أو الهاتف"
                dir="ltr"
                className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <button onClick={() => lookup(serialInput)} className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-background">
                بحث
              </button>
              <button onClick={() => setScanOpen(true)} aria-label="مسح QR" className="rounded-lg bg-primary p-2 text-primary-foreground hover:opacity-90">
                <QrCode className="size-4" />
              </button>
            </div>
          )}
          {loyaltyMsg && <p className="text-xs text-muted-foreground">{loyaltyMsg}</p>}
        </div>

        {/* إضافات (surcharges for add-ons) */}
        <div className="space-y-2 rounded-xl bg-secondary/60 p-3">
          <p className="text-sm font-semibold">➕ إضافات على الطلب</p>
          {extras.length > 0 && (
            <ul className="space-y-1">
              {extras.map((x, i) => (
                <li key={i} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">{x.name}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-primary">+{formatIqdLabel(x.price)}</span>
                    <button onClick={() => setExtras((xs) => xs.filter((_, j) => j !== i))} aria-label="حذف" className="rounded-md border border-border p-1 hover:bg-background">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <PriceInput value={extraPrice} onChange={setExtraPrice} />
            <button onClick={addExtra} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
              +
            </button>
          </div>
        </div>

        {/* totals */}
        <div className="space-y-1.5 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">المجموع</span>
            <span>{formatIqdLabel(subtotal)}</span>
          </div>
          {extraTotal > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">الإضافات</span>
              <span className="text-primary">+{formatIqdLabel(extraTotal)}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">الخصم</span>
            <input
              type="number"
              min={0}
              value={discount || ""}
              onChange={(e) => setDiscount(Math.max(0, Math.round(Number(e.target.value) || 0)))}
              className="w-28 rounded-lg border border-input bg-background px-2 py-1 text-left text-sm outline-none focus:ring-2 focus:ring-ring"
              dir="ltr"
            />
          </div>
          <div className="flex items-center justify-between border-t border-border pt-2 text-base font-bold">
            <span>الإجمالي</span>
            <span>{formatIqdLabel(total)}</span>
          </div>
        </div>

        {/* order note */}
        <input
          value={orderNote}
          onChange={(e) => setOrderNote(e.target.value)}
          placeholder="📝 ملاحظات: سكر قليل، بدون سكر…"
          maxLength={300}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />

        {err && <p className="text-sm text-destructive">{err}</p>}

        {/* dine-in / takeaway */}
        <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-secondary/60 p-1.5">
          <button
            onClick={() => {
              setOrderType("takeaway");
              setTableNo("");
            }}
            className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${orderType === "takeaway" ? "bg-primary text-primary-foreground" : "hover:bg-background"}`}
          >
            🥡 خارجي
          </button>
          <button
            onClick={() => setOrderType("dinein")}
            className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${orderType === "dinein" ? "bg-primary text-primary-foreground" : "hover:bg-background"}`}
          >
            🏠 داخل المحل
          </button>
        </div>
        {orderType === "dinein" && (
          <div className="flex flex-wrap gap-1.5">
            {tables.map((n) => (
              <button
                key={n}
                onClick={() => setTableNo(n)}
                className={`min-w-9 whitespace-nowrap rounded-lg border px-2 py-1.5 text-sm font-bold transition ${
                  tableNo === n ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-secondary"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-secondary/60 p-1.5">
          <button
            onClick={() => setPayMethod("cash")}
            className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${payMethod === "cash" ? "bg-primary text-primary-foreground" : "hover:bg-background"}`}
          >
            💵 نقدي
          </button>
          <button
            onClick={() => setPayMethod("card")}
            className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${payMethod === "card" ? "bg-primary text-primary-foreground" : "hover:bg-background"}`}
          >
            💳 كي كارد
          </button>
        </div>
        <button
          onClick={checkout}
          disabled={busy || lines.length === 0}
          className="w-full rounded-xl bg-primary px-4 py-3 font-bold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "جارٍ التنفيذ…" : payMethod === "cash" ? "دفع نقدي وإصدار الطلب" : "دفع كي كارد وإصدار الطلب"}
        </button>
      </aside>

      {/* scanner */}
      {scanOpen && <QrScanner onScan={onScanned} onClose={() => setScanOpen(false)} />}

      {/* success */}
      {success && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={() => setSuccess(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-card p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Check className="size-8" />
            </div>
            <h3 className="text-xl font-bold">تم الدفع</h3>
            <p className="mt-1 text-muted-foreground">رقم الطلب</p>
            <p className="my-2 text-4xl font-extrabold text-primary">{success.orderNumber}</p>
            {success.awarded > 0 && <p className="text-sm text-muted-foreground">أُضيفت {success.awarded} نقطة ولاء.</p>}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button onClick={() => window.print()} className="flex items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 font-semibold text-primary-foreground hover:opacity-90">
                <Printer className="size-4" />
                طباعة
              </button>
              <button onClick={() => setSuccess(null)} className="rounded-xl border border-border px-4 py-2.5 font-semibold hover:bg-secondary">
                طلب جديد
              </button>
            </div>
          </div>
        </div>
      )}

      {/* print-only checkout receipt */}
      {receipt && <Receipt data={receipt} />}
    </div>
  );
}

function CashierItem({ item, category, onAdd }: { item: MenuItemView; category?: string; onAdd: (line: Omit<Line, "qty">) => void }) {
  const [variantId, setVariantId] = useState<string | null>(item.variants[0]?.id ?? null);
  const [flavor, setFlavor] = useState<string | null>(item.flavors[0] ?? null);
  const variant = item.variants.find((v) => v.id === variantId) ?? null;
  const unitPrice = variant?.price ?? item.price;
  const displayName = variant ? `${item.name_ar} - ${variant.name_ar}` : item.name_ar;

  function add() {
    onAdd({
      key: `${item.id}|${variantId ?? ""}|${flavor ?? ""}`,
      itemId: item.id,
      name: displayName,
      variantId,
      flavor,
      unitPrice,
      soldBy: item.sold_by,
    });
  }

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-3">
      <button onClick={add} className="text-right">
        <div className="flex items-center gap-2">
          <MenuIcon name={item.name_ar} category={category} className="size-8 shrink-0 text-primary/80" />
          <p className="font-semibold leading-tight">{item.name_ar}</p>
        </div>
        <p className="mt-0.5 text-sm font-bold text-primary">
          {formatIqdLabel(unitPrice)}
          {item.sold_by === "weight" && <span className="text-xs"> / {item.unit_label || "كغم"}</span>}
        </p>
      </button>
      {item.variants.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {item.variants.map((v) => (
            <button
              key={v.id}
              onClick={() => setVariantId(v.id)}
              className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
                v.id === variantId ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-secondary"
              }`}
            >
              {v.name_ar}
            </button>
          ))}
        </div>
      )}
      {item.flavors.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {item.flavors.map((f) => (
            <button
              key={f}
              onClick={() => setFlavor(f)}
              className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
                f === flavor ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-secondary"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      )}
      <button
        onClick={add}
        className="mt-2 flex items-center justify-center gap-1 rounded-lg bg-primary/10 px-2 py-1.5 text-sm font-semibold text-primary transition hover:bg-primary hover:text-primary-foreground"
      >
        <Plus className="size-4" />
        إضافة
      </button>
    </div>
  );
}
