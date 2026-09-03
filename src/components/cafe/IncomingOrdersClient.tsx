"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing } from "lucide-react";
import { formatIqdLabel } from "@/lib/cafe/money";
import { CHANNEL_AR } from "@/lib/cafe/branding";
import {
  listPendingOrders,
  payPendingOrder,
  cancelOrder,
  type PendingOrder,
} from "@/lib/cafe/cashier-actions";
import { Receipt, type ReceiptData } from "./Receipt";
import { formatQty } from "@/lib/cafe/order";


function ageMinutes(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}

const STATION_AR: Record<string, string> = { pastry: "قسم المعجنات والمخبوزات", cafe: "قسم الكافيه" };

function ticketFor(t: Ticket, heading?: string, mode: "customer" | "prep" = "customer"): ReceiptData {
  const rows = t.rows;
  const o = rows[0];
  return {
    orderNumber: String(o.group_no).padStart(3, "0"),
    heading,
    mode,
    // تذكرة مشتركة لا تخصّ قسماً بعينه، فلا يُكتب اسم قسم عليها
    station: rows.length > 1 ? null : (STATION_AR[o.station] ?? null),
    table: o.table_no,
    floor: o.floor,
    address: o.address,
    geo: o.geo,
    deliverAt: o.deliver_at,
    note: o.note,
    // أصناف التذكرة كاملةً — لا نصفها
    lines: rows.flatMap((r) =>
      r.items.map((it) => ({ name: it.name_ar, flavor: it.flavor_ar, qty: it.qty, unitPrice: it.unit_price, soldBy: it.sold_by })),
    ),
    subtotal: rows.reduce((sum, r) => sum + r.subtotal, 0),
    discount: 0,
    deliveryFee: rows.reduce((sum, r) => sum + r.delivery_fee, 0),
    // ما يُطبع هو ما يدفعه الزبون: مجموع القسم وحده كان يُسقط أجرة التوصيل
    // وحصة القسم الآخر، فيخرج وصل بمبلغ أقلّ من المقبوض
    total: o.groupTotal,
    dateTime: new Date().toLocaleString("en-GB", { timeZone: "Asia/Baghdad", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }),
  };
}

/**
 * تذكرة الزبون: نصفا الطلب مجموعين.
 *
 * الطلب المشترك صفّان في القاعدة (نصف للمعجنات ونصف للكافيه) — وهذا صحيح
 * محاسبياً ويبقى. لكن الكاشير الموحّد كان يرى **بطاقتين للطلب الواحد**، بزرَّي
 * دفع وبمبلغين مختلفين، والطباعة التلقائية تطبع وصلاً لكل نصف — فيستلم الزبون
 * وصلين لطلب واحد، كلٌّ بنصف المبلغ.
 *
 * الزبون واحد ويدفع مرة واحدة، فالبطاقة واحدة والوصل واحد.
 */
type Ticket = {
  group_no: number;
  /** نصف لكل قسم، مرتّبة كما تُرتّب الأقسام */
  rows: PendingOrder[];
  /** ما يدفعه الزبون فعلاً — يشمل النصف الآخر والعروض وأجرة التوصيل */
  total: number;
};

function groupTickets(orders: PendingOrder[]): Ticket[] {
  const by = new Map<number, PendingOrder[]>();
  for (const o of orders) {
    const arr = by.get(o.group_no) ?? [];
    arr.push(o);
    by.set(o.group_no, arr);
  }
  return [...by.entries()].map(([group_no, rows]) => ({
    group_no,
    rows,
    // groupTotal محسوب على المجموعة كاملة، فأي صف منها يحمله
    total: rows[0].groupTotal,
  }));
}

/** Dedicated incoming-orders screen: the counter's live queue of table
 *  self-orders, with auto-print and cash-drawer device toggles. */
export function IncomingOrdersClient() {
  const [pending, setPending] = useState<PendingOrder[]>([]);
  const [queueErr, setQueueErr] = useState<string | null>(null);

  // device settings (shared with the cashier screen via the same localStorage keys)
  // الطباعة التلقائية تبدأ **مفعّلة**: هي وضع التشغيل الطبيعي لأي كاشير، وكان
  // بدؤها مطفأة يعني أن كل جهاز جديد لا يطبع شيئاً حتى ينتبه أحدهم للمفتاح.
  // على الآيباد تُطفأ يدوياً لأن iOS يفتح نافذة طباعة لا تُغلق نفسها.
  const [autoPrint, setAutoPrint] = useState(true);
  const [drawerKick, setDrawerKick] = useState(true);
  const autoPrintRef = useRef(false);
  const drawerKickRef = useRef(false);
  const kickBusyRef = useRef(false);
  useEffect(() => {
    // «0» وحدها تُطفئ — الغياب يعني جهازاً جديداً، وافتراضه التشغيل
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of persisted device settings
    setAutoPrint(localStorage.getItem("hail-autoprint") !== "0");
     
    setDrawerKick(localStorage.getItem("hail-drawer") !== "0");
  }, []);
  useEffect(() => {
    autoPrintRef.current = autoPrint;
    localStorage.setItem("hail-autoprint", autoPrint ? "1" : "0");
  }, [autoPrint]);
  useEffect(() => {
    drawerKickRef.current = drawerKick;
    localStorage.setItem("hail-drawer", drawerKick ? "1" : "0");
  }, [drawerKick]);
  function kickDrawer() {
    // guard against a double-open if the pay action fires twice in quick succession
    if (!drawerKickRef.current || kickBusyRef.current) return;
    kickBusyRef.current = true;
    setTimeout(() => { kickBusyRef.current = false; }, 2500);
    fetch("http://127.0.0.1:9977/kick", { mode: "no-cors" }).catch(() => {});
  }

  // print queued tickets one by one
  const [tickets, setTickets] = useState<ReceiptData[]>([]);
  const seenIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!tickets.length) return;
    const t = setTimeout(() => {
      window.print();
      setTickets((q) => q.slice(1));
    }, 400);
    return () => clearTimeout(t);
  }, [tickets]);

  // ponytail: 5s poll — swap to Supabase realtime if volume grows.
  const refreshPending = useCallback(async () => {
    try {
      const orders = await listPendingOrders();
      setPending(orders);
      if (seenIds.current && autoPrintRef.current) {
        // الجدّة تُقاس بالتذكرة لا بالصف: طلب مشترك صفّان، وطباعة كل صف
        // تُخرج للزبون وصلين لطلب واحد كلٌّ بنصف المبلغ
        const seen = seenIds.current;
        const fresh = groupTickets(orders).filter((t) => t.rows.some((r) => !seen.has(r.id)));
        if (fresh.length) {
          setTickets((q) => [...q, ...fresh.map((t) => ticketFor(t, "طلب جديد — غير مدفوع", "prep"))]);
        }
      }
      seenIds.current = new Set(orders.map((o) => o.id));
    } catch {
      /* ignore transient errors */
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- polling an external system; state is set after an await
    refreshPending();
    const t = setInterval(refreshPending, 5000);
    return () => clearInterval(t);
  }, [refreshPending]);

  // الدفع يسوّي التذكرة كاملةً في القاعدة أصلاً — فالوصل المطبوع يجب أن
  // يكون كاملاً مثله
  async function accept(t: Ticket, method: "cash" | "card") {
    setQueueErr(null);
    const res = await payPendingOrder(t.rows[0].id);
    if (!res.ok) setQueueErr(res.error);
    else {
      if (method === "cash") kickDrawer();
      // print the paid receipt for the customer (silent under --kiosk-printing)
      setTickets((q) => [...q, ticketFor(t)]);
    }
    void refreshPending();
  }
  async function reject(id: string) {
    setQueueErr(null);
    const res = await cancelOrder(id);
    if (!res.ok) setQueueErr(res.error);
    void refreshPending();
  }

  // بطاقة لكل تذكرة لا لكل نصف — الزبون واحد ويدفع مرة واحدة
  const tickets2 = groupTickets(pending);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <BellRing className="size-5 text-primary" />
          الطلبات الواردة
          {tickets2.length > 0 && (
            <span className="rounded-full bg-destructive px-2.5 py-0.5 text-sm font-bold text-destructive-foreground">{tickets2.length}</span>
          )}
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <input type="checkbox" checked={autoPrint} onChange={(e) => setAutoPrint(e.target.checked)} className="accent-[#556f42]" />
            🖨️ طباعة تلقائية للطلبات الواردة
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <input type="checkbox" checked={drawerKick} onChange={(e) => setDrawerKick(e.target.checked)} className="accent-[#556f42]" />
            💰 فتح القاصة عند الدفع
          </label>
        </div>
      </div>

      {queueErr && <p className="text-sm text-destructive">{queueErr}</p>}

      {tickets2.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
          <p className="text-lg font-semibold">لا توجد طلبات معلّقة</p>
          <p className="mt-1 text-sm">الطلبات الجديدة من الطاولات تظهر هنا فوراً مع جرس تنبيه.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {tickets2.map((t) => {
            const o = t.rows[0];
            const age = ageMinutes(o.created_at);
            const shared = t.rows.length > 1;
            // كاشير مربوط بقسم يرى نصفه فقط، فالمبلغ الظاهر أكبر مما يقابله من
            // أصناف — وبلا سطر يفسّره يبدو رقماً بلا سبب.
            const shown = t.rows.reduce((sum, r) => sum + r.subtotal, 0);
            const hidden = t.total !== shown;
            return (
              <div key={t.group_no} className="flex flex-col rounded-2xl border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-2xl font-extrabold text-primary">#{String(o.group_no).padStart(3, "0")}</span>
                  {o.address ? (
                    <span className="rounded-full bg-accent px-3 py-1 text-sm font-bold text-accent-foreground">توصيل</span>
                  ) : o.table_no ? (
                    <span className="rounded-full bg-primary px-3 py-1 text-sm font-bold text-primary-foreground">
                      طاولة {o.table_no}{o.floor ? ` · طابق ${o.floor}` : ""}
                    </span>
                  ) : null}
                </div>
                {shared ? (
                  <p className="mt-2 rounded-lg border border-accent/60 bg-accent/10 px-2.5 py-1.5 text-xs font-bold">
                    طلب مشترك بين القسمين — يُحضَّر في مكانين ويُدفع مرة واحدة
                  </p>
                ) : hidden ? (
                  <p className="mt-2 rounded-lg border border-accent/60 bg-accent/10 px-2.5 py-1.5 text-xs font-bold">
                    {o.otherStations.length > 0 && `طلب مشترك مع ${o.otherStations.join("، ")} — `}
                    المطلوب من الزبون {formatIqdLabel(t.total)}
                  </p>
                ) : null}
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  {!o.address && <span>{CHANNEL_AR[o.channel] ?? o.channel}</span>}
                  <span>·</span>
                  <span className={age >= 10 ? "font-bold text-destructive" : ""}>{age === 0 ? "الآن" : `منذ ${age} د`}</span>
                </div>
                {o.address && (
                  <div className="mt-2 rounded-lg border border-accent/60 bg-accent/10 px-2.5 py-1.5 text-sm">
                    <p className="font-bold">📍 {o.address}</p>
                    {o.deliver_at && <p className="text-xs text-muted-foreground">الوقت: {o.deliver_at}</p>}
                    {o.geo && (
                      <a href={o.geo} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-primary underline">
                        فتح الموقع على الخريطة ↗
                      </a>
                    )}
                  </div>
                )}
                {o.note && (
                  <p className="mt-2 rounded-lg border border-amber-500/50 bg-amber-500/10 px-2.5 py-1.5 text-sm font-bold">📝 {o.note}</p>
                )}
                <div className="my-3 flex-1 space-y-2">
                  {t.rows.map((r) => (
                    <div key={r.id}>
                      {shared && (
                        // القسم يُكتب فقط حين تكون التذكرة مشتركة — وإلا فهو
                        // تكرار لما تقوله الشاشة أصلاً
                        <p className="mb-0.5 text-[11px] font-bold text-primary">{STATION_AR[r.station] ?? r.station}</p>
                      )}
                      <ul className="space-y-1 text-sm">
                        {r.items.map((it, i) => (
                          <li key={i} className="flex items-center justify-between gap-2">
                            <span>
                              {it.name_ar}
                              {it.flavor_ar ? ` (${it.flavor_ar})` : ""}
                            </span>
                            <span className="font-semibold text-muted-foreground">
                              {it.sold_by === "weight" ? formatQty(it.qty, "weight") : `×${it.qty}`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
                  <span className="text-lg font-extrabold">{formatIqdLabel(t.total)}</span>
                  <div className="flex gap-1.5">
                    <button onClick={() => accept(t, "cash")} className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
                      💵 نقدي
                    </button>
                    <button onClick={() => accept(t, "card")} className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90">
                      💳 كي كارد
                    </button>
                    <button onClick={() => reject(o.id)} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-destructive hover:bg-secondary">
                      إلغاء
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* print-only: وصل الزبون المدفوع يخرج ومعه نسخة تحضير؛ تنبيه الطلب
          الجديد (mode=prep) يخرج قصاصةً واحدة للمطبخ. الغلاف يرفعها خارج
          التدفّق فلا يدفعها المحتوى المخفي أسفل الصفحات فتضيع أصنافها. */}
      {tickets[0] && (
        <div className="receipt-sheet hidden print:block">
          <Receipt data={tickets[0]} />
          {tickets[0].mode !== "prep" && <Receipt data={{ ...tickets[0], mode: "prep" }} />}
        </div>
      )}
    </div>
  );
}
