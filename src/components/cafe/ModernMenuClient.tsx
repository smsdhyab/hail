"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AtSign, Check, Globe, LogIn, MessageCircle, Minus, Plus, ReceiptText, RefreshCw, ShoppingCart, X } from "lucide-react";
import type { MenuCategoryView, MenuItemView } from "@/lib/cafe/menu-data";
import { formatIqdLabel } from "@/lib/cafe/money";
import { getMyOrders, submitOrder, type OrderLineInput, type PublicOrder } from "@/lib/cafe/order-actions";
import { useCart, type CartLine } from "./use-cart";
import { HailMark } from "./Logo";

/** المنيو التفاعلي — image-led immersive menu: steam over hot drinks, frost and
 *  falling droplets over iced ones, floating pastries. Prices live from the DB. */

type EffectKind = "hot" | "cold" | "pastry";
function effectFor(categoryName: string): EffectKind {
  if (categoryName.includes("الساخنة")) return "hot";
  if (categoryName.includes("معجنات")) return "pastry";
  return "cold";
}

/** Serve product images through the site CDN (/img/* edge proxy) with a 400w
 *  variant for phones/weak connections. */
function imgSrcs(url: string | null) {
  if (!url) return null;
  const m = url.match(/\/storage\/v1\/object\/public\/menu\/(.+)$/);
  const rel = m ? `/img/${m[1]}` : url;
  const small = rel.replace(/\.webp(\?|$)/, "-sm.webp$1");
  return { src: small, srcSet: `${small} 400w, ${rel} 800w` };
}

/** ids of orders placed from THIS device today (the customer's own orders) */
function loadMyOrderIds(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem("hail-my-orders") ?? "[]") as { id: string; day: string }[];
    const today = new Date().toDateString();
    return raw.filter((r) => r.day === today).map((r) => r.id);
  } catch {
    return [];
  }
}
function saveMyOrderId(id: string) {
  try {
    const today = new Date().toDateString();
    const raw = (JSON.parse(localStorage.getItem("hail-my-orders") ?? "[]") as { id: string; day: string }[]).filter(
      (r) => r.day === today,
    );
    raw.push({ id, day: today });
    localStorage.setItem("hail-my-orders", JSON.stringify(raw.slice(-20)));
  } catch {
    /* private mode */
  }
}

const ORDER_STATUS_AR: Record<string, string> = {
  pending: "🕐 قيد التجهيز",
  paid: "✅ مكتمل",
  cancelled: "✖ ملغي",
  refunded: "↩ مسترجع",
};

const DROPS = [
  { left: "20%", top: "42%", delay: "0s", size: 5, dur: "4.2s" },
  { left: "30%", top: "55%", delay: "1.4s", size: 4, dur: "5.1s" },
  { left: "44%", top: "48%", delay: "2.6s", size: 6, dur: "4.6s" },
  { left: "58%", top: "60%", delay: "0.8s", size: 4, dur: "5.6s" },
  { left: "70%", top: "45%", delay: "1.9s", size: 5, dur: "4.4s" },
  { left: "78%", top: "56%", delay: "3.1s", size: 4, dur: "5s" },
];

export function ModernMenuClient({
  menu,
  offers = [],
  table,
  demo,
  preview = false,
  channel = "qr",
}: {
  menu: MenuCategoryView[];
  offers?: { id: string; title: string; description: string | null }[];
  table?: string | null;
  demo: boolean;
  preview?: boolean;
  channel?: "qr" | "kiosk";
}) {
  const [activeCat, setActiveCat] = useState(menu[0]?.name_ar ?? "");
  const { lines, total, count, dispatch } = useCart();
  const [cartOpen, setCartOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [custName, setCustName] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [orderNote, setOrderNote] = useState("");
  const [confirmed, setConfirmed] = useState<{ orderNumber: string; cardSerial: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // customer order tracking («طلباتي»)
  const [myOrderIds, setMyOrderIds] = useState<string[]>([]);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [myOrders, setMyOrders] = useState<PublicOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of device storage
    setMyOrderIds(loadMyOrderIds());
  }, []);
  async function refreshMyOrders(ids: string[]) {
    setOrdersLoading(true);
    try {
      setMyOrders(await getMyOrders(ids));
    } finally {
      setOrdersLoading(false);
    }
  }
  function openMyOrders() {
    setConfirmed(null);
    setOrdersOpen(true);
    void refreshMyOrders(myOrderIds);
  }

  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const pillRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // scrollspy — highlight the category currently on screen (customers scroll
  // through the whole menu; the pills follow along)
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const c = e.target.getAttribute("data-cat");
            if (c) setActiveCat(c);
          }
        }
      },
      { rootMargin: "-35% 0px -55% 0px" },
    );
    Object.values(sectionRefs.current).forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, [menu]);

  // keep the active pill visible inside the scrollable bar
  useEffect(() => {
    pillRefs.current[activeCat]?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [activeCat]);

  function goTo(c: string) {
    setActiveCat(c);
    sectionRefs.current[c]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function onSubmit() {
    if (!lines.length || busy) return;
    setBusy(true);
    setErr(null);
    const payload: OrderLineInput[] = lines.map((l) => ({ item_id: l.itemId, variant_id: l.variantId, flavor: l.flavor, qty: l.qty }));
    const res = await submitOrder({
      channel,
      table: table ?? null,
      lines: payload,
      name: custName.trim() || null,
      phone: custPhone.trim() || null,
      note: orderNote.trim() || null,
    });
    setBusy(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    dispatch({ type: "clear" });
    setOrderNote("");
    setCartOpen(false);
    setConfirmed({ orderNumber: res.orderNumber, cardSerial: res.cardSerial ?? null });
    if (res.orderId) {
      saveMyOrderId(res.orderId);
      setMyOrderIds((ids) => [...ids, res.orderId!]);
    }
  }

  return (
    <div dir="rtl" className="min-h-dvh bg-[#1d2a16] text-[#f2efe4]">
      <div className="mx-auto max-w-5xl">
        {/* header */}
        <header className="sticky top-0 z-20 border-b border-[#f2924c]/20 bg-[#1d2a16]/95 px-4 py-3 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <HailMark className="size-11 shrink-0" />
              <div>
                <h1 className="text-xl font-extrabold text-[#f2924c]">مخبز ومقهى هيل</h1>
                <p className="text-xs text-[#f2efe4]/60">
                  المنيو التفاعلي{table ? ` · طاولة ${table}` : ""}
                  {demo ? " · تجريبي" : ""}
                  {preview ? " · 🧪 معاينة الصور الجديدة" : ""}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {myOrderIds.length > 0 && (
                <button
                  onClick={openMyOrders}
                  className="flex items-center gap-1 rounded-full bg-[#f2924c]/15 px-3 py-1.5 text-xs font-bold text-[#f2924c] transition hover:bg-[#f2924c]/25"
                >
                  <ReceiptText className="size-3.5" />
                  طلباتي ({myOrderIds.length})
                </button>
              )}
              <div className="flex rounded-full border border-[#f2924c]/40 p-0.5 text-xs font-semibold">
                <span className="rounded-full bg-[#f2924c] px-3 py-1 text-[#22301a]">مودرن</span>
                <Link href={`/menu/classic${table ? `?t=${table}` : ""}`} className="rounded-full px-3 py-1 text-[#f2924c] transition hover:bg-[#f2924c]/10">
                  كلاسيكي
                </Link>
              </div>
              <Link
                href="/sign-in"
                aria-label="دخول الموظفين"
                title="دخول الموظفين"
                className="flex items-center gap-1 rounded-full border border-[#f2924c]/40 px-3 py-1.5 text-xs font-bold text-[#f2924c] transition hover:bg-[#f2924c]/10"
              >
                <LogIn className="size-3.5" />
                دخول الموظفين
              </Link>
            </div>
          </div>
          {/* categories — big tappable pills for easy navigation between sections */}
          <nav className="mt-3 -mb-1 flex gap-2 overflow-x-auto pb-1">
            {offers.length > 0 && (
              <button
                onClick={() => document.getElementById("hail-offers")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="whitespace-nowrap rounded-full border-2 border-[#f2924c] bg-[#f2924c]/15 px-5 py-2 text-[15px] font-bold text-[#f2924c] transition hover:bg-[#f2924c]/25"
              >
                🎁 العروض
              </button>
            )}
            {menu.map((c) => (
              <button
                key={c.name_ar}
                ref={(el) => {
                  pillRefs.current[c.name_ar] = el;
                }}
                onClick={() => goTo(c.name_ar)}
                className={`whitespace-nowrap rounded-full px-5 py-2 text-[15px] font-bold transition ${
                  c.name_ar === activeCat
                    ? "bg-[#f2924c] text-[#22301a]"
                    : "border border-[#f2924c]/40 text-[#f2efe4]/85 hover:bg-[#f2924c]/10"
                }`}
              >
                {c.name_ar}
              </button>
            ))}
          </nav>
        </header>

        {/* one continuous scroll through every category */}
        <main className="space-y-8 px-4 py-5 pb-32">
          {/* branded welcome */}
          <section className="flex flex-col items-center gap-2 pt-1 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="مخبز ومقهى هيل" className="size-24 drop-shadow-[0_4px_18px_rgba(242,146,76,0.4)]" />
            <h2 className="text-2xl font-extrabold text-[#f2924c]">أهلاً بك في مخبز ومقهى هيل</h2>
            <p className="text-sm text-[#f2efe4]/70">
              تصفّح المنيو واطلب من طاولتك{table ? ` · طاولة ${table}` : ""}
            </p>
          </section>
          {offers.length > 0 && (
            <section id="hail-offers" className="scroll-mt-36">
              <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-[#f2924c]">🎁 عروض اليوم</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {offers.map((o) => (
                  <div key={o.id} className="rounded-2xl border-2 border-[#f2924c]/50 bg-gradient-to-br from-[#f2924c]/20 to-transparent p-4">
                    <p className="font-extrabold text-[#f2efe4]">{o.title}</p>
                    {o.description && <p className="mt-1 text-sm text-[#f2efe4]/70">{o.description}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}
          {menu.map((c) => {
            const effect = effectFor(c.name_ar);
            return (
              <section
                key={c.name_ar}
                data-cat={c.name_ar}
                ref={(el) => {
                  sectionRefs.current[c.name_ar] = el;
                }}
                className="scroll-mt-36"
              >
                <h2 className="mb-3 text-lg font-bold text-[#f2924c]">{c.name_ar}</h2>
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
                  {c.items.map((it, i) => (
                    <ModernCard key={it.id} item={it} effect={effect} index={i % 8} onAdd={(line) => dispatch({ type: "add", line })} />
                  ))}
                </div>
              </section>
            );
          })}

          {/* حقوق النظام — أزرار تواصل سريع (تظهر في المنيو فقط) */}
          <footer className="mt-6 border-t border-[#f2924c]/15 pt-6 text-center">
            <p className="text-[11px] text-[#f2efe4]/45">نظام الرؤية المتطور لإدارة الكافيهات والمخابز</p>
            <p className="text-[11px] text-[#f2efe4]/45">تصميم وتطوير</p>
            <p className="mb-3 text-sm font-bold text-[#f2924c]">مركز الرؤية للابتكار الرقمي</p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <a
                href="https://wa.me/9647734446636"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="واتساب"
                className="flex items-center gap-1.5 rounded-full bg-[#25D366] px-4 py-2 text-sm font-bold text-white transition hover:opacity-90"
              >
                <MessageCircle className="size-4" />
                واتساب
              </a>
              <a
                href="https://instagram.com/thevision.center"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="انستغرام"
                className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#f58529] via-[#dd2a7b] to-[#8134af] px-4 py-2 text-sm font-bold text-white transition hover:opacity-90"
              >
                <AtSign className="size-4" />
                انستغرام
              </a>
              <a
                href="https://roya-vision.com"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="الموقع الإلكتروني"
                className="flex items-center gap-1.5 rounded-full border border-[#f2924c]/50 px-4 py-2 text-sm font-bold text-[#f2924c] transition hover:bg-[#f2924c]/10"
              >
                <Globe className="size-4" />
                الموقع
              </a>
            </div>
          </footer>
        </main>
      </div>

      {/* cart bar */}
      {count > 0 && !cartOpen && (
        <button
          onClick={() => setCartOpen(true)}
          className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-5xl items-center justify-between gap-3 bg-[#f2924c] px-5 py-4 font-bold text-[#22301a] shadow-lg"
        >
          <span className="flex items-center gap-2">
            <ShoppingCart className="size-5" />
            {count} صنف
          </span>
          <span>عرض السلة · {formatIqdLabel(total)}</span>
        </button>
      )}

      {/* cart sheet */}
      {cartOpen && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/60" onClick={() => setCartOpen(false)}>
          <div
            className="mx-auto max-h-[85dvh] w-full max-w-5xl overflow-y-auto rounded-t-2xl border-t border-[#f2924c]/30 bg-[#2a3a1e] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-bold text-[#f2924c]">سلة الطلب</h3>
              <button onClick={() => setCartOpen(false)} aria-label="إغلاق" className="rounded-full p-1 text-[#f2efe4]/70 hover:bg-white/5">
                <X className="size-5" />
              </button>
            </div>
            <ul className="divide-y divide-[#f2924c]/15">
              {lines.map((l) => (
                <li key={l.key} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{l.name}</p>
                    {l.flavor && <p className="text-xs text-[#f2efe4]/60">{l.flavor}</p>}
                    <p className="text-sm text-[#f2924c]">{formatIqdLabel(l.unitPrice)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => dispatch({ type: "dec", key: l.key })} aria-label="إنقاص" className="rounded-full border border-[#f2924c]/40 p-1.5 hover:bg-white/5">
                      <Minus className="size-4" />
                    </button>
                    <span className="w-6 text-center font-semibold">{l.qty}</span>
                    <button onClick={() => dispatch({ type: "inc", key: l.key })} aria-label="زيادة" className="rounded-full border border-[#f2924c]/40 p-1.5 hover:bg-white/5">
                      <Plus className="size-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {/* customer capture (optional) — builds the loyalty base */}
            <div className="mt-4 space-y-2 rounded-xl bg-black/25 p-3">
              <p className="text-xs font-semibold text-[#f2924c]">🎁 أضف اسمك ورقمك (اختياري) — تُنشأ لك بطاقة ولاء وتجمع نقاطاً مع كل طلب</p>
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={custName}
                  onChange={(e) => setCustName(e.target.value)}
                  placeholder="الاسم"
                  className="w-full rounded-lg border border-[#f2924c]/30 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-[#f2efe4]/40 focus:border-[#f2924c]"
                />
                <input
                  value={custPhone}
                  onChange={(e) => setCustPhone(e.target.value)}
                  placeholder="07XXXXXXXXX"
                  dir="ltr"
                  inputMode="tel"
                  className="w-full rounded-lg border border-[#f2924c]/30 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-[#f2efe4]/40 focus:border-[#f2924c]"
                />
              </div>
            </div>

            {/* order note */}
            <textarea
              value={orderNote}
              onChange={(e) => setOrderNote(e.target.value)}
              placeholder="📝 ملاحظات الطلب (اختياري): سكر قليل، بدون سكر، حليب إضافي…"
              rows={2}
              maxLength={300}
              className="mt-3 w-full resize-none rounded-xl border border-[#f2924c]/30 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-[#f2efe4]/40 focus:border-[#f2924c]"
            />

            {err && <p className="mt-3 text-sm text-red-400">{err}</p>}
            <div className="mt-4 flex items-center justify-between border-t border-[#f2924c]/20 pt-4">
              <span className="text-[#f2efe4]/70">الإجمالي</span>
              <span className="text-lg font-bold text-[#f2924c]">{formatIqdLabel(total)}</span>
            </div>
            <button
              onClick={onSubmit}
              disabled={busy || count === 0}
              className="mt-4 w-full rounded-xl bg-[#f2924c] px-4 py-3 font-bold text-[#22301a] transition hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "جارٍ الإرسال…" : "إرسال الطلب"}
            </button>
          </div>
        </div>
      )}

      {/* my orders — الزبون يراجع طلباته وأسعارها وحالتها ويضيف عليها */}
      {ordersOpen && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/60" onClick={() => setOrdersOpen(false)}>
          <div
            className="mx-auto max-h-[85dvh] w-full max-w-5xl overflow-y-auto rounded-t-2xl border-t border-[#f2924c]/30 bg-[#2a3a1e] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-bold text-[#f2924c]">
                <ReceiptText className="size-5" />
                طلباتي
              </h3>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => refreshMyOrders(myOrderIds)}
                  aria-label="تحديث"
                  className="rounded-full border border-[#f2924c]/40 p-1.5 text-[#f2924c] hover:bg-[#f2924c]/10"
                >
                  <RefreshCw className={`size-4 ${ordersLoading ? "animate-spin" : ""}`} />
                </button>
                <button onClick={() => setOrdersOpen(false)} aria-label="إغلاق" className="rounded-full p-1.5 text-[#f2efe4]/70 hover:bg-white/5">
                  <X className="size-5" />
                </button>
              </div>
            </div>

            {myOrders.length === 0 ? (
              <p className="py-6 text-center text-sm text-[#f2efe4]/60">{ordersLoading ? "جارٍ التحميل…" : "لا توجد طلبات بعد."}</p>
            ) : (
              <div className="space-y-3">
                {myOrders.map((o) => (
                  <div key={o.id} className="rounded-xl border border-[#f2924c]/20 bg-black/25 p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-extrabold text-[#f2924c]">#{String(o.order_seq).padStart(3, "0")}</span>
                      <span className="text-xs font-semibold">{ORDER_STATUS_AR[o.status] ?? o.status}</span>
                    </div>
                    {o.table_no && <p className="mt-0.5 text-xs text-[#f2efe4]/60">طاولة {o.table_no}</p>}
                    <ul className="mt-2 space-y-1 text-sm">
                      {o.items.map((it, i) => (
                        <li key={i} className="flex justify-between gap-2">
                          <span>
                            {it.name_ar}
                            {it.flavor_ar ? ` (${it.flavor_ar})` : ""} ×{it.qty}
                          </span>
                          <span className="text-[#f2efe4]/70">{formatIqdLabel(it.line_total)}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-2 flex justify-between border-t border-[#f2924c]/15 pt-2 text-sm font-bold">
                      <span>الإجمالي</span>
                      <span className="text-[#f2924c]">{formatIqdLabel(Math.max(0, o.subtotal - o.discount))}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => setOrdersOpen(false)}
              className="mt-4 w-full rounded-xl bg-[#f2924c] px-4 py-3 font-bold text-[#22301a] transition hover:opacity-90"
            >
              + أطلب المزيد
            </button>
          </div>
        </div>
      )}

      {/* confirmation */}
      {confirmed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={() => setConfirmed(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-[#f2924c]/30 bg-[#2a3a1e] p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-[#f2924c]/15 text-[#f2924c]">
              <Check className="size-8" />
            </div>
            <h3 className="text-xl font-bold">تم استلام طلبك</h3>
            <p className="mt-1 text-[#f2efe4]/60">رقم الطلب</p>
            <p className="my-2 text-4xl font-extrabold text-[#f2924c]">{confirmed.orderNumber}</p>
            <p className="text-sm text-[#f2efe4]/60">اذكر الرقم عند الكاشير للدفع والاستلام.</p>
            {confirmed.cardSerial && (
              <a
                href={`/card/${confirmed.cardSerial}`}
                target="_blank"
                className="mt-3 block rounded-xl bg-[#f2924c]/15 px-4 py-3 text-sm font-semibold text-[#f2924c] transition hover:bg-[#f2924c]/25"
              >
                🎁 بطاقة ولائك جاهزة — اضغط لفتحها واحفظها في هاتفك لتجمع النقاط
              </a>
            )}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button onClick={openMyOrders} className="flex items-center justify-center gap-1.5 rounded-xl bg-[#f2924c] px-4 py-2.5 font-bold text-[#22301a] hover:opacity-90">
                <ReceiptText className="size-4" />
                متابعة طلبي
              </button>
              <button onClick={() => setConfirmed(null)} className="rounded-xl border border-[#f2924c]/40 px-4 py-2.5 font-semibold text-[#f2924c] hover:bg-[#f2924c]/10">
                طلب جديد
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ModernCard({
  item,
  effect,
  index,
  onAdd,
}: {
  item: MenuItemView;
  effect: EffectKind;
  index: number;
  onAdd: (line: Omit<CartLine, "qty">) => void;
}) {
  const [variantId, setVariantId] = useState<string | null>(item.variants[0]?.id ?? null);
  const [flavor, setFlavor] = useState<string | null>(item.flavors[0] ?? null);
  const variant = item.variants.find((v) => v.id === variantId) ?? null;
  const unitPrice = variant?.price ?? item.price;
  const srcs = imgSrcs(item.image_url);

  function add() {
    onAdd({
      key: `${item.id}|${variantId ?? ""}|${flavor ?? ""}`,
      itemId: item.id,
      name: variant ? `${item.name_ar} - ${variant.name_ar}` : item.name_ar,
      variantId,
      flavor,
      unitPrice,
      soldBy: item.sold_by,
    });
  }

  return (
    <div
      className="relative overflow-hidden rounded-2xl bg-[#2a3a1e] ring-1 ring-[#f2924c]/20"
      style={{ animation: "hail-card-in .5s both", animationDelay: `${index * 70}ms` }}
    >
      {/* image */}
      <div className="relative aspect-[4/5]" style={effect === "pastry" ? { animation: "hail-float 4s ease-in-out infinite" } : undefined}>
        {srcs ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={srcs.src}
            srcSet={srcs.srcSet}
            sizes="(min-width: 1024px) 30vw, 50vw"
            width={800}
            height={1000}
            alt={item.name_ar}
            className="absolute inset-0 size-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-b from-[#22301a] to-[#1d2a16]" />
        )}

        {/* steam (hot) */}
        {effect === "hot" && (
          <div aria-hidden className="pointer-events-none absolute left-1/2 top-[30%] -translate-x-1/2">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="absolute block h-16 w-2.5 rounded-full bg-white/60 blur-[6px]"
                style={{
                  left: `${(i - 1) * 14}px`,
                  animation: `hail-steam 2.8s ease-out ${i * 0.9}s infinite`,
                }}
              />
            ))}
          </div>
        )}

        {/* frost + droplets (cold) */}
        {effect === "cold" && (
          <>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background: "radial-gradient(120% 60% at 50% 35%, rgba(180,220,255,0.35), transparent 60%)",
                animation: "hail-frost 5s ease-in-out infinite",
              }}
            />
            {DROPS.map((d, i) => (
              <span
                key={i}
                aria-hidden
                className="pointer-events-none absolute rounded-full bg-sky-100/80"
                style={{
                  left: d.left,
                  top: d.top,
                  width: d.size,
                  height: d.size * 1.4,
                  filter: "blur(0.5px)",
                  animation: `hail-drip ${d.dur} linear ${d.delay} infinite`,
                }}
              />
            ))}
          </>
        )}

        {/* soft bottom fade into the card body */}
        <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[#2a3a1e] to-transparent" />
      </div>

      {/* info — fully BELOW the image so nothing covers the product */}
      <div className="space-y-1.5 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="font-bold leading-tight">{item.name_ar}</p>
          <p className="whitespace-nowrap text-sm font-extrabold text-[#f2924c]">{formatIqdLabel(unitPrice)}</p>
        </div>
        {(item.variants.length > 0 || item.flavors.length > 0) && (
          <div className="flex flex-wrap gap-1">
            {item.variants.map((v) => (
              <button
                key={v.id}
                onClick={() => setVariantId(v.id)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${
                  v.id === variantId ? "bg-[#f2924c] text-[#22301a]" : "bg-white/10 text-[#f2efe4]/80"
                }`}
              >
                {v.name_ar}
              </button>
            ))}
            {item.flavors.map((f) => (
              <button
                key={f}
                onClick={() => setFlavor(f)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${
                  f === flavor ? "bg-[#f2924c] text-[#22301a]" : "bg-white/10 text-[#f2efe4]/80"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={add}
          className="flex w-full items-center justify-center gap-1 rounded-xl bg-[#f2924c] py-2 text-sm font-bold text-[#22301a] transition active:scale-95"
        >
          <Plus className="size-4" />
          أضف للطلب
        </button>
      </div>
    </div>
  );
}
