"use client";

import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { Check, LogIn, Minus, Plus, ShoppingCart, Sparkles, X } from "lucide-react";
import type { ComboView, MenuCategoryView, MenuItemView } from "@/lib/cafe/menu-data";
import { CombosSection, OFFERS_CAT } from "./CombosSection";
import { Screensaver } from "./Screensaver";
import { DeliveryForm, deliveryError, emptyDelivery, type DeliveryDetails, type DeliveryField } from "./DeliveryForm";
import { DELIVERY_AREA_AR } from "@/lib/cafe/branding";
import { formatIqdLabel } from "@/lib/cafe/money";
import { formatQty, lineTotal, roundTicket } from "@/lib/cafe/order";
import { submitOrder, type OrderLineInput, type OrderSplitPart } from "@/lib/cafe/order-actions";
import { useCart } from "./use-cart";
import { MenuIcon } from "./MenuIcon";
import { HailMark } from "./Logo";

/** Primary customer menu — full-screen: category rail on the RIGHT, product grid
 *  on the LEFT, cart + checkout, table number, size picker + hot-drink pastry
 *  cross-sell. HAIL palette. */

// HAIL palette — straight from the XD design file: cream paper, olive panels,
// orange CTA. --accent is olive (headings/prices, readable on cream);
// --accent2 is the orange used for the primary call-to-action.
const VARS: Record<string, string> = {
  "--accent": "#556f42", "--accent2": "#f2924c", "--panel": "#e8ebe0", "--panelsoft": "#ffffff",
  "--text": "#22301a", "--muted": "#5e6f51", "--line": "rgba(85,111,66,0.18)", "--active": "#556f42", "--activeink": "#f6f4ee",
};
const GRAD = "radial-gradient(1100px 700px at 88% -8%, rgba(242,146,76,0.13), transparent 55%), linear-gradient(160deg, #f7f5ef, #eae7db)";

/** menu image → CDN path; returns both the light -sm variant and the full one
 *  (admin-uploaded images have no -sm, so we fall back to full then to an icon). */
function imgSrcs(url: string | null): { sm: string; full: string } | null {
  if (!url) return null;
  const m = url.match(/\/storage\/v1\/object\/public\/menu\/(.+)$/);
  const full = m ? `/img/${m[1]}` : url;
  return { sm: full.replace(/\.webp(\?|$)/, "-sm.webp$1"), full };
}
function onImgError(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  const full = img.dataset.full;
  if (full && img.src !== full) img.src = full; // -sm missing → try full
  else img.style.display = "none"; // full missing too → show the icon behind
}

type Effect = "hot" | "cold" | "pastry";
/** Which idle animation the product cards get. Driven by the owning station
 *  first, so every bakery category behaves the same without name matching. */
function effectFor(cat: MenuCategoryView | undefined): Effect {
  if (!cat) return "cold";
  if (cat.station === "pastry") return "pastry";
  return cat.name_ar.includes("الساخنة") ? "hot" : "cold";
}
/** How many bakery items to offer alongside a drink before the strip gets long. */
const CROSS_SELL_LIMIT = 12;
const DROPS = [
  { left: "24%", top: "16%", size: 5, dur: "2.4s", delay: "0s" },
  { left: "62%", top: "12%", size: 4, dur: "3s", delay: "0.6s" },
  { left: "78%", top: "30%", size: 6, dur: "2.6s", delay: "1.1s" },
  { left: "40%", top: "26%", size: 4, dur: "3.2s", delay: "0.3s" },
  { left: "54%", top: "42%", size: 5, dur: "2.8s", delay: "1.5s" },
];

export function TabletMenuClient({
  menu,
  combos = [],
  table = null,
  channel = "qr",
  offers = {},
  screensaver,
  suggestionsOn = true,
  deliveryFee = 0,
}: {
  menu: MenuCategoryView[];
  combos?: ComboView[];
  table?: string | null;
  channel?: "qr" | "kiosk" | "delivery";
  /** item_id → today's offer price (0 = مجاناً) set by management */
  offers?: Record<string, number>;
  /** شاشة الاستراحة — تُعطَّل بوضع afterSec = 0 */
  screensaver?: { url: string | null; afterSec: number; on: boolean };
  /** مفتاح عرض الاقتراحات — يضبطه المدير من لوحة التحكم */
  suggestionsOn?: boolean;
  /** أجرة التوصيل السارية — يضبطها المدير من لوحة التحكم */
  deliveryFee?: number;
}) {
  const [activeCat, setActiveCat] = useState(menu[0]?.name_ar ?? "");
  const mainRef = useRef<HTMLElement>(null);
  const { lines, total, count, dispatch } = useCart();
  const [cartOpen, setCartOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  // combos taken this visit — sent with the order so the server can price them
  const [pickedCombos, setPickedCombos] = useState<string[]>([]);
  // delivery mode: no table, and the driver needs a name, phone and address
  const isDelivery = channel === "delivery";
  const [delivery, setDelivery] = useState<DeliveryDetails>(emptyDelivery);
  const [badField, setBadField] = useState<DeliveryField | null>(null);
  const [confirmed, setConfirmed] = useState<string | null>(null);
  // when an order spans both registers, tell the customer who is preparing what
  const [confirmedParts, setConfirmedParts] = useState<OrderSplitPart[]>([]);
  const [confirmedFloor, setConfirmedFloor] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // product modal (size + cross-sell)
  const [modalItem, setModalItem] = useState<MenuItemView | null>(null);
  const [modalVariant, setModalVariant] = useState<string | null>(null);
  const [crossSel, setCrossSel] = useState<Set<string>>(new Set()); // الاقتراحات المختارة
  // الأصناف الموزونة تُطلب بوزن مختار لا بعدد — نصف كيلو افتراضاً
  const [modalGrams, setModalGrams] = useState(500);

  const showOffers = activeCat === OFFERS_CAT && combos.length > 0;
  const cat = menu.find((c) => c.name_ar === activeCat) ?? menu[0];
  const effect = effectFor(cat);
  // Cross-sell pulls from the OTHER register: order a drink, get offered
  // something from the bakery. Station-driven, so it keeps working when
  // categories are renamed or added.
  // الأصناف المؤشَّرة «تُقترح» في لوحة التحكم — لا أول ما يصادفه من قسم آخر.
  // ومفتاح واحد يوقفها كلها.
  const suggestions = suggestionsOn
    ? menu.flatMap((c) => c.items).filter((i) => i.suggest).slice(0, CROSS_SELL_LIMIT)
    : [];
  const crossSell = suggestions.length > 0;

  function selectCat(name: string) {
    setActiveCat(name);
    mainRef.current?.scrollTo({ top: 0 });
  }
  function add(it: MenuItemView, variantId: string | null, unitPrice: number, qty?: number) {
    const v = it.variants.find((x) => x.id === variantId);
    const key = `${it.id}|${variantId ?? ""}`;
    const name = it.name_ar + (v ? ` — ${v.name_ar}` : "");
    dispatch({ type: "add", line: { key, itemId: it.id, name, variantId, flavor: null, unitPrice, soldBy: it.sold_by, qty } });
  }
  const priceOf = (it: MenuItemView) => offers[it.id] ?? it.price; // apply today's offer if any
  function toggleCross(id: string) {
    setCrossSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function pickCombo(combo: ComboView) {
    const byId = new Map(menu.flatMap((c) => c.items).map((i) => [i.id, i]));
    for (const id of combo.item_ids) {
      const it = byId.get(id);
      if (it) add(it, null, priceOf(it));
    }
    setPickedCombos((c) => [...c, combo.slug]);
  }

  /** يفتح بطاقة الصنف: الاسم كاملاً والمحتويات والأحجام وزرّ الإضافة. */
  function openItem(it: MenuItemView) {
    setModalItem(it);
    setModalVariant(it.variants[0]?.id ?? null);
    setCrossSel(new Set());
    setModalGrams(500);
  }

  function onPlus(it: MenuItemView) {
    // زرّ + للإضافة السريعة. لكن ما يحتاج اختياراً — حجم أو وزن أو إضافات —
    // أو له تفاصيل لا تسعها البطاقة، يُفتح ليقرأه الزبون قبل أن يضيفه.
    if (it.variants.length > 0 || crossSell || it.sold_by === "weight" || it.description) {
      openItem(it);
    } else {
      add(it, null, priceOf(it));
    }
  }
  // A combo only still applies while ALL of its items are in the cart — remove
  // the cake and you are no longer buying the offer, so its price must not be
  // charged. Derived rather than stored, so it can never go stale.
  const inCart = new Set(lines.map((l) => l.itemId));
  const liveCombos = combos.filter(
    (c) => pickedCombos.includes(c.slug) && c.item_ids.every((id) => inCart.has(id)),
  );
  // the gap between the offers' prices and their parts' list prices; the cart
  // must show what the customer will actually be asked to pay
  const comboAdjust = liveCombos.reduce((sum, c) => sum + (c.price - c.list_total), 0);
  // أصناف داخل عرض: سعرها الفردي لا يُعرض، لأن سعر العرض هو الساري عليها
  const comboItemIds = new Set(liveCombos.flatMap((c) => c.item_ids));
  // الأجرة تُضاف لطلبات التوصيل وحدها، وتُعرض سطراً مستقلاً: مبلغ يظهر في
  // الإجمالي بلا اسم يقرؤه الزبون كزيادة مجهولة
  const fee = isDelivery ? Math.max(0, deliveryFee) : 0;
  const rawDue = Math.max(0, total + comboAdjust) + fee;
  const dueTotal = roundTicket(rawDue);

  const modalPrice = modalItem ? (modalItem.variants.find((v) => v.id === modalVariant)?.price ?? priceOf(modalItem)) : 0;
  const crossTotal = [...crossSel].reduce((s, id) => {
    const p = suggestions.find((x) => x.id === id);
    return s + (p ? priceOf(p) : 0);
  }, 0);
  // للموزون، «السعر» هو سعر الكيلو — والمعروض يجب أن يكون ثمن الوزن المختار
  const modalIsWeight = modalItem?.sold_by === "weight";
  const modalLine = modalIsWeight ? lineTotal(modalPrice, modalGrams / 1000, "weight") : modalPrice;
  const grandTotal = modalLine + crossTotal;

  async function checkout() {
    if (!lines.length || busy) return;
    if (isDelivery) {
      const bad = deliveryError(delivery);
      if (bad) {
        setBadField(bad.field);
        return setErr(bad.msg);
      }
    }
    setBusy(true);
    setErr(null);
    setBadField(null);
    const payload: OrderLineInput[] = lines.map((l) => ({ item_id: l.itemId, variant_id: l.variantId, flavor: l.flavor, qty: l.qty }));
    const res = await submitOrder({
      channel,
      table: table ?? null,
      lines: payload,
      name: isDelivery ? delivery.name.trim() : null,
      phone: isDelivery ? delivery.phone.trim() : phone.trim() || null,
      note: note.trim() || null,
      combos: liveCombos.map((c) => c.slug),
      address: isDelivery ? delivery.address : null,
      geo: isDelivery ? delivery.geo : null,
      deliverAt: isDelivery ? delivery.deliverAt : null,
    });
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    dispatch({ type: "clear" });
    setPickedCombos([]);
    setDelivery(emptyDelivery);
    setNote("");
    setPhone("");
    setCartOpen(false);
    setConfirmedParts(res.parts ?? []);
    setConfirmedFloor(res.floor ?? null);
    setConfirmed(res.orderNumber);
  }

  return (
    <div dir="rtl" style={{ ...(VARS as CSSProperties), background: GRAD }} className="flex h-dvh flex-col text-[var(--text)]">
      {screensaver?.on && (
        <Screensaver
          mediaUrl={screensaver.url}
          afterSec={screensaver.afterSec}
          // لا تظهر وسلة الزبون مشغولة أو نافذة مفتوحة — توقُّفه ليفكّر ليس غياباً
          idle={count === 0 && !cartOpen && !modalItem && !confirmed}
        />
      )}
      {/* top bar */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <HailMark className="size-9 shrink-0" />
          <span className="text-lg font-extrabold text-[var(--accent)]">مخبز ومقهى هيل</span>
        </div>
        {isDelivery ? (
          <span className="rounded-full border border-[var(--accent2)] bg-[var(--accent2)]/10 px-4 py-1.5 text-center text-[13px] font-extrabold text-[var(--accent2)]">
            {DELIVERY_AREA_AR}
          </span>
        ) : table ? (
          <span className="rounded-full border border-[var(--accent)] bg-[var(--accent)]/10 px-4 py-1.5 text-sm font-extrabold text-[var(--accent)]">
            طاولة {table}
          </span>
        ) : (
          <h1 className="text-base font-bold text-[var(--muted)]">المنيو</h1>
        )}
        <Link
          href="/sign-in"
          aria-label="دخول الموظفين"
          title="دخول الموظفين"
          className="flex size-10 items-center justify-center rounded-full border border-[var(--line)] text-[var(--accent)] transition hover:bg-[var(--panel)]"
        >
          <LogIn className="size-5" />
        </Link>
      </header>

      <div className="flex min-h-0 flex-1 flex-row-reverse">
        {/* product grid — LEFT */}
        <main ref={mainRef} className="min-w-0 flex-1 overflow-y-auto p-4 pb-24">
          {showOffers ? (
            <CombosSection combos={combos} menu={menu} onPick={pickCombo} />
          ) : (
          <>
          <h2 className="mb-3 px-1 text-xl font-extrabold text-[var(--accent)]">{cat?.name_ar}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
            {(cat?.items ?? []).map((it) => {
              const s = imgSrcs(it.image_url);
              return (
                <article
                  key={it.id}
                  onClick={() => openItem(it)}
                  className="cursor-pointer overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--panelsoft)] transition active:scale-[0.99]"
                >
                  <div className="relative aspect-[4/3] bg-[var(--panel)]" style={effect === "pastry" ? { animation: "hail-float 4s ease-in-out infinite" } : undefined}>
                    <MenuIcon name={it.name_ar} category={cat?.name_ar} className="absolute inset-0 m-auto size-16 text-[var(--accent)] opacity-45" />
                    {s && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.sm} data-full={s.full} alt={it.name_ar} loading="lazy" onError={onImgError} className="absolute inset-0 h-full w-full object-cover" />
                    )}
                    {effect === "hot" && (
                      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[20%] -translate-x-1/2">
                        {[0, 1, 2].map((i) => (
                          <span key={i} className="absolute block h-14 w-2 rounded-full bg-white/55 blur-[5px]" style={{ left: `${(i - 1) * 12}px`, animation: `hail-steam 2.8s ease-out ${i * 0.9}s infinite` }} />
                        ))}
                      </div>
                    )}
                    {effect === "cold" && (
                      <>
                        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(120% 60% at 50% 35%, rgba(170,215,255,0.38), transparent 60%)", animation: "hail-frost 5s ease-in-out infinite" }} />
                        {DROPS.map((d, i) => (
                          <span key={i} aria-hidden className="pointer-events-none absolute rounded-full bg-sky-100/90" style={{ left: d.left, top: d.top, width: d.size, height: d.size * 1.4, filter: "blur(0.5px)", animation: `hail-drip ${d.dur} linear ${d.delay} infinite` }} />
                        ))}
                      </>
                    )}
                    {/* add button floats on the image → keeps the footer clean + identical on all phones */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation(); // البطاقة تفتح التفاصيل، والزرّ يضيف
                        onPlus(it);
                      }}
                      aria-label="أضف للسلة"
                      className="absolute bottom-2 left-2 z-10 flex size-10 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--activeink)] shadow-lg transition active:scale-90"
                    >
                      <Plus className="size-5" />
                    </button>
                  </div>
                  <div className="px-3 py-2.5 text-right">
                    <p className="line-clamp-2 min-h-[2.4em] text-sm font-bold leading-tight sm:text-[15px]">{it.name_ar}</p>
                    {it.description && (
                      // سطر واحد فقط — وجوده يقول إن للصنف تفاصيل تُقرأ بالضغط
                      <p className="line-clamp-1 text-[11px] leading-tight text-[var(--muted)]">{it.description}</p>
                    )}
                    <p className="mt-1 whitespace-nowrap text-lg font-extrabold tabular-nums text-[var(--accent)]">
                      {formatIqdLabel(priceOf(it))}
                      {it.sold_by === "weight" && (
                        <span className="text-xs font-bold"> / {it.unit_label || "كغم"}</span>
                      )}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
          </>
          )}
        </main>

        {/* category rail — RIGHT */}
        <aside className="w-[86px] shrink-0 overflow-y-auto border-l border-[var(--line)] bg-[var(--panelsoft)]/60 py-2 sm:w-[132px] lg:w-[172px]">
          {combos.length > 0 && (
            <button
              aria-label={OFFERS_CAT}
              onClick={() => selectCat(OFFERS_CAT)}
              className={`flex w-full flex-col items-center gap-1 px-1 py-3 text-center text-[var(--activeink)] transition sm:gap-1.5 sm:px-2 sm:py-3.5 ${showOffers ? "bg-[var(--accent)]" : "hail-offers-pulse"}`}
            >
              <Sparkles className="size-6 sm:size-8" />
              <span className="text-[11px] font-extrabold leading-tight sm:text-[13px]">
                <span className="block">عروض</span>
                <span className="block">اليوم</span>
              </span>
            </button>
          )}
          {menu.map((c) => {
            const on = c.name_ar === activeCat;
            return (
              <button key={c.name_ar} aria-label={c.name_ar} onClick={() => selectCat(c.name_ar)} className={`flex w-full flex-col items-center gap-1 px-1 py-3 text-center transition sm:gap-1.5 sm:px-2 sm:py-3.5 ${on ? "bg-[var(--active)] text-[var(--activeink)]" : "text-[var(--muted)] hover:bg-[var(--panel)]"}`}>
                <MenuIcon name={c.name_ar} category={c.name_ar} className={`size-6 sm:size-8 ${on ? "text-[var(--activeink)]" : "text-[var(--accent)]"}`} />
                <span className="text-[11px] font-bold leading-tight sm:text-[13px]">
                  {c.name_ar.split(" ").map((w, i) => (
                    <span key={i} className="block">{w}</span>
                  ))}
                </span>
              </button>
            );
          })}
        </aside>
      </div>

      {/* cart bar */}
      {count > 0 && !cartOpen && !confirmed && !modalItem && (
        <button onClick={() => setCartOpen(true)} className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-5xl items-center justify-between gap-3 bg-[var(--accent2)] px-5 py-4 font-extrabold text-[#22301a] shadow-lg">
          <span className="flex items-center gap-2"><ShoppingCart className="size-5" /> عرض السلة ({count})</span>
          <span className="tabular-nums">{formatIqdLabel(dueTotal)}</span>
        </button>
      )}

      {/* product modal — size + cross-sell */}
      {modalItem && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" onClick={() => setModalItem(null)}>
          <div style={{ ...(VARS as CSSProperties) }} className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-[var(--panelsoft)] p-5 text-[var(--text)] sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            {/* الصورة أولاً: الزبون يشتري بعينه. النافذة كانت تفتح على نصّ،
                فيقرأ وصفاً لصنف لم يره — والصورة موجودة في البطاقة خلفه. */}
            {(() => {
              const s = imgSrcs(modalItem.image_url);
              return (
                <div className="relative -mx-5 -mt-5 mb-4 aspect-[4/3] overflow-hidden bg-[var(--panel)]">
                  <MenuIcon
                    name={modalItem.name_ar}
                    className="absolute inset-0 m-auto size-20 text-[var(--accent)] opacity-40"
                  />
                  {s && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={s.full}
                      alt={modalItem.name_ar}
                      onError={onImgError}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  )}
                  <button
                    onClick={() => setModalItem(null)}
                    aria-label="إغلاق"
                    className="absolute left-3 top-3 rounded-full bg-black/45 p-2 text-white backdrop-blur"
                  >
                    <X className="size-5" />
                  </button>
                  {count > 0 && (
                    <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-black/45 px-2.5 py-1 text-sm font-bold text-white backdrop-blur">
                      <ShoppingCart className="size-4" /> {count}
                    </span>
                  )}
                </div>
              );
            })()}

            <div className="mb-3 flex items-start justify-between gap-2">
              <h2 className="text-lg font-extrabold leading-tight">{modalItem.name_ar}</h2>
              <div className="flex items-center gap-2">
                <span className="whitespace-nowrap text-lg font-extrabold tabular-nums text-[var(--accent)]">
                  {formatIqdLabel(priceOf(modalItem))}
                  {modalItem.sold_by === "weight" && (
                    <span className="text-xs font-bold"> / {modalItem.unit_label || "كغم"}</span>
                  )}
                </span>
              </div>
            </div>

            {/* المحتويات والتفاصيل كاملةً — هذا سبب فتح البطاقة أصلاً */}
            {modalItem.description && (
              <p className="mb-4 whitespace-pre-line rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3 text-sm leading-relaxed text-[var(--text)]">
                {modalItem.description}
              </p>
            )}

            {modalIsWeight && (
              <div className="mb-4">
                <p className="mb-2 text-sm font-bold text-[var(--muted)]">
                  الوزن · {formatIqdLabel(modalPrice)} / {modalItem.unit_label || "كغم"}
                </p>
                <div className="flex flex-wrap gap-2">
                  {[250, 500, 750, 1000, 1500, 2000].map((g) => (
                    <button
                      key={g}
                      onClick={() => setModalGrams(g)}
                      className={`rounded-xl border px-4 py-2.5 font-bold transition ${
                        modalGrams === g ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--activeink)]" : "border-[var(--line)]"
                      }`}
                    >
                      {formatQty(g / 1000, "weight", modalItem.unit_label)}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  الوزن النهائي يُضبط على الميزان عند التحضير، والسعر يُحسب عليه.
                </p>
              </div>
            )}

            {modalItem.variants.length > 0 && (
              <div className="mb-4">
                <h3 className="mb-2 text-sm font-bold text-[var(--muted)]">اختر الحجم</h3>
                <div className="flex flex-wrap gap-2">
                  {modalItem.variants.map((v) => (
                    <button key={v.id} onClick={() => setModalVariant(v.id)} className={`rounded-xl border px-4 py-2.5 font-bold transition ${modalVariant === v.id ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--activeink)]" : "border-[var(--line)]"}`}>
                      {v.name_ar} · <span className="tabular-nums">{formatIqdLabel(v.price)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {crossSell && suggestions.filter((x) => x.id !== modalItem.id).length > 0 && (
              <div className="mb-4">
                <h3 className="mb-2 text-sm font-bold text-[var(--accent)]">🥐 يناسبها مع… (اختياري)</h3>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {suggestions.filter((x) => x.id !== modalItem.id).map((p) => {
                    const ps = imgSrcs(p.image_url);
                    return (
                      <div key={p.id} className="w-28 shrink-0 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)]">
                        <div className="relative aspect-square">
                          <MenuIcon name={p.name_ar} className="absolute inset-0 m-auto size-9 text-[var(--accent)] opacity-45" />
                          {ps && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={ps.sm} data-full={ps.full} alt={p.name_ar} loading="lazy" onError={onImgError} className="absolute inset-0 h-full w-full object-cover" />
                          )}
                        </div>
                        <div className="p-1.5 text-right">
                          <p className="truncate text-[11px] font-bold">{p.name_ar}</p>
                          <div className="mt-0.5 flex items-center justify-between">
                            <button onClick={() => toggleCross(p.id)} aria-label="أضف" className={`flex size-7 items-center justify-center rounded-full transition active:scale-90 ${crossSel.has(p.id) ? "bg-emerald-500 text-white" : "bg-[var(--accent)] text-[var(--activeink)]"}`}>
                              {crossSel.has(p.id) ? <Check className="size-4" /> : <Plus className="size-4" />}
                            </button>
                            {offers[p.id] !== undefined ? (
                              <span className="text-[11px] font-bold tabular-nums">
                                <s className="text-[var(--muted)]">{formatIqdLabel(p.price)}</s>{" "}
                                <b className="text-emerald-400">{offers[p.id] === 0 ? "مجاناً" : formatIqdLabel(offers[p.id])}</b>
                              </span>
                            ) : (
                              <span className="text-[11px] font-bold tabular-nums text-[var(--accent)]">{formatIqdLabel(p.price)}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  الإضافات المختارة: <b className="tabular-nums text-[var(--accent)]">{formatIqdLabel(crossTotal)}</b>
                </p>
              </div>
            )}

            <button
              onClick={() => {
                add(modalItem, modalVariant, modalPrice, modalIsWeight ? modalGrams / 1000 : undefined);
                crossSel.forEach((id) => {
                  const p = suggestions.find((x) => x.id === id);
                  if (p) add(p, null, priceOf(p));
                });
                setModalItem(null);
                setCrossSel(new Set());
              }}
              className="w-full rounded-2xl bg-[var(--accent)] py-4 text-lg font-extrabold text-[var(--activeink)] transition active:scale-[0.99]"
            >
              أضف للسلة · {formatIqdLabel(grandTotal)}
            </button>
          </div>
        </div>
      )}

      {/* cart drawer */}
      {cartOpen && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/60" onClick={() => setCartOpen(false)}>
          <div style={{ ...(VARS as CSSProperties) }} className="max-h-[88dvh] overflow-y-auto rounded-t-3xl bg-[var(--panelsoft)] p-5 text-[var(--text)]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-[var(--accent)]">سلة الطلب {table ? `· طاولة ${table}` : ""}</h2>
              <button onClick={() => setCartOpen(false)} aria-label="إغلاق" className="rounded-full border border-[var(--line)] p-1.5"><X className="size-5" /></button>
            </div>
            <ul className="space-y-2">
              {lines.map((l) => (
                <li key={l.key} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold">{l.name}</p>
                    {comboItemIds.has(l.itemId) ? (
                      <p className="text-sm text-[var(--accent2)]">
                        ضمن عرض اليوم
                        {l.qty > 1 && (
                          <span className="tabular-nums text-[var(--muted)]">
                            {" "}+ {l.qty - 1} إضافي · {formatIqdLabel(l.unitPrice * (l.qty - 1))}
                          </span>
                        )}
                      </p>
                    ) : (
                      <p className="text-sm tabular-nums text-[var(--accent)]">
                        {formatIqdLabel(lineTotal(l.unitPrice, l.qty, l.soldBy))}
                        {l.soldBy === "weight" && (
                          <span className="text-[var(--muted)]"> · {formatIqdLabel(l.unitPrice)}/كغم</span>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button onClick={() => dispatch({ type: "dec", key: l.key })} aria-label="إنقاص" className="rounded-full border border-[var(--line)] p-1.5"><Minus className="size-4" /></button>
                    <span className="min-w-[3.5rem] text-center font-bold tabular-nums">
                      {formatQty(l.qty, l.soldBy)}
                    </span>
                    <button onClick={() => dispatch({ type: "inc", key: l.key })} aria-label="زيادة" className="rounded-full border border-[var(--line)] p-1.5"><Plus className="size-4" /></button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-3 space-y-2">
              {isDelivery ? (
                <DeliveryForm
                  value={delivery}
                  invalid={badField}
                  onChange={(d) => {
                    setDelivery(d);
                    setBadField(null); // التصحيح يزيل الاحمرار فوراً
                    setErr(null);
                  }}
                />
              ) : (
                <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="رقم الهاتف (اختياري — لجمع نقاط الولاء)" dir="ltr" className="w-full rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2.5 text-sm outline-none" />
              )}
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ملاحظة (سكر قليل، بدون ثلج…)" className="w-full rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2.5 text-sm outline-none" />
            </div>
            {err && <p className="mt-2 text-sm font-semibold text-destructive">{err}</p>}
            {liveCombos.length > 0 && (
              // سعر العرض نفسه، لا الفرق عن مجموع القائمة. عرْض «+١٬٥٠٠» كان
              // يقرأ كزيادة على الزبون بينما هو ثمن حصة أكبر — والزبون اختار
              // العرض بسعره المعلن، فهو ما يجب أن يراه.
              <div className="mt-3 space-y-1 border-t border-[var(--line)] pt-3 text-sm">
                {liveCombos.map((c) => (
                  <div key={c.slug} className="flex items-center justify-between gap-2 font-bold text-[var(--accent2)]">
                    <span className="line-clamp-1">عرض اليوم — {c.title_ar}</span>
                    <span className="shrink-0 tabular-nums">{formatIqdLabel(c.price)}</span>
                  </div>
                ))}
              </div>
            )}
            {fee > 0 && (
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--line)] pt-3 text-sm">
                <span className="text-[var(--muted)]">أجرة التوصيل داخل الرمادي</span>
                <span className="shrink-0 font-bold tabular-nums">{formatIqdLabel(fee)}</span>
              </div>
            )}
            <div className="mt-3 flex items-center justify-between border-t border-[var(--line)] pt-3">
              <span className="text-[var(--muted)]">الإجمالي</span>
              <span className="text-xl font-extrabold tabular-nums text-[var(--accent)]">{formatIqdLabel(dueTotal)}</span>
            </div>
            <button onClick={checkout} disabled={busy} className="mt-3 w-full rounded-2xl bg-[var(--accent)] py-4 text-lg font-extrabold text-[var(--activeink)] transition active:scale-[0.99] disabled:opacity-60">
              {busy ? "جارٍ الإرسال…" : "إتمام الطلب"}
            </button>
          </div>
        </div>
      )}

      {/* confirmation */}
      {confirmed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={() => setConfirmed(null)}>
          <div style={{ ...(VARS as CSSProperties) }} className="w-full max-w-sm rounded-3xl bg-[var(--panelsoft)] p-8 text-center text-[var(--text)]" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-[var(--accent)]"><Check className="size-10 text-[var(--activeink)]" /></div>
            <h2 className="mt-4 text-2xl font-extrabold">تم إرسال طلبك ✓</h2>
            <p className="mt-2 text-[var(--muted)]">رقم الطلب</p>
            <p className="text-4xl font-extrabold text-[var(--accent)]">{confirmed}</p>
            {isDelivery && (
              <p className="mt-2 text-sm text-[var(--muted)]">سنتصل بك لتأكيد الطلب والعنوان 🛵</p>
            )}
            {table && (
              <p className="mt-2 text-sm text-[var(--muted)]">
                طاولة {table}{confirmedFloor ? ` — الطابق ${confirmedFloor}` : ""} — سيصلك طلبك قريباً
              </p>
            )}
            {confirmedParts.length > 1 && (
              <div className="mt-4 space-y-1.5 rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-3 text-right text-sm">
                <p className="font-bold text-[var(--accent)]">طلبك يُحضَّر في قسمين — والدفع مرة واحدة</p>
                {confirmedParts.map((p) => (
                  <div key={p.station} className="flex items-center justify-between gap-3">
                    <span>{p.station_ar}</span>
                    <span className="font-bold tabular-nums">{formatIqdLabel(p.subtotal)}</span>
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => setConfirmed(null)} className="mt-5 w-full rounded-2xl border border-[var(--accent)] py-3 font-bold text-[var(--accent)]">طلب آخر</button>
          </div>
        </div>
      )}
    </div>
  );
}
