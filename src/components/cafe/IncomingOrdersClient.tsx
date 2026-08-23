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

function ticketFor(o: PendingOrder, heading?: string): ReceiptData {
  return {
    orderNumber: String(o.group_no).padStart(3, "0"),
    heading,
    station: STATION_AR[o.station] ?? null,
    table: o.table_no,
    floor: o.floor,
    address: o.address,
    geo: o.geo,
    deliverAt: o.deliver_at,
    note: o.note,
    lines: o.items.map((it) => ({ name: it.name_ar, flavor: it.flavor_ar, qty: it.qty, unitPrice: it.unit_price, soldBy: it.sold_by })),
    subtotal: o.subtotal,
    discount: 0,
    deliveryFee: o.delivery_fee,
    // ما يُطبع هو ما يدفعه الزبون: مجموع القسم وحده كان يُسقط أجرة التوصيل
    // وحصة القسم الآخر، فيخرج وصل بمبلغ أقلّ من المقبوض
    total: o.groupTotal,
    dateTime: new Date().toLocaleString("en-GB", { timeZone: "Asia/Baghdad", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }),
  };
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of persisted device settings
    // «0» وحدها تُطفئ — الغياب يعني جهازاً جديداً، وافتراضه التشغيل
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
        const fresh = orders.filter((o) => !seenIds.current!.has(o.id));
        if (fresh.length) {
          setTickets((q) => [
            ...q,
            ...fresh.map((o) => ticketFor(o, "طلب جديد — غير مدفوع")),
          ]);
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

  async function accept(id: string, method: "cash" | "card") {
    setQueueErr(null);
    const o = pending.find((p) => p.id === id);
    const res = await payPendingOrder(id);
    if (!res.ok) setQueueErr(res.error);
    else {
      if (method === "cash") kickDrawer();
      // print the paid receipt for the customer (silent under --kiosk-printing)
      if (o) setTickets((q) => [...q, ticketFor(o)]);
    }
    void refreshPending();
  }
  async function reject(id: string) {
    setQueueErr(null);
    const res = await cancelOrder(id);
    if (!res.ok) setQueueErr(res.error);
    void refreshPending();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <BellRing className="size-5 text-primary" />
          الطلبات الواردة
          {pending.length > 0 && (
            <span className="rounded-full bg-destructive px-2.5 py-0.5 text-sm font-bold text-destructive-foreground">{pending.length}</span>
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

      {pending.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
          <p className="text-lg font-semibold">لا توجد طلبات معلّقة</p>
          <p className="mt-1 text-sm">الطلبات الجديدة من الطاولات تظهر هنا فوراً مع جرس تنبيه.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {pending.map((o) => {
            const age = ageMinutes(o.created_at);
            return (
              <div key={o.id} className="flex flex-col rounded-2xl border border-border bg-card p-4">
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
                {o.groupTotal !== o.subtotal && (
                  // ما يدفعه الزبون يخالف مبلغ هذا القسم — إمّا لأن التذكرة
                  // مشتركة مع القسم الآخر، أو لأن عليها أجرة توصيل أو عرضاً.
                  // الشرط على الفرق نفسه لا على وجود قسم آخر: طلب توصيل من قسم
                  // واحد كان يعرض مبلغه هو، فيُقبض أقلّ من المستحق.
                  <p className="mt-2 rounded-lg border border-accent/60 bg-accent/10 px-2.5 py-1.5 text-xs font-bold">
                    {o.otherStations.length > 0 && `طلب مشترك مع ${o.otherStations.join("، ")} — `}
                    المطلوب من الزبون {formatIqdLabel(o.groupTotal)}
                  </p>
                )}
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
                <ul className="my-3 flex-1 space-y-1 text-sm">
                  {o.items.map((it, i) => (
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
                <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
                  <span className="text-lg font-extrabold">{formatIqdLabel(o.subtotal)}</span>
                  <div className="flex gap-1.5">
                    <button onClick={() => accept(o.id, "cash")} className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
                      💵 نقدي
                    </button>
                    <button onClick={() => accept(o.id, "card")} className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90">
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

      {/* print-only ticket */}
      {tickets[0] && <Receipt data={tickets[0]} />}
    </div>
  );
}
