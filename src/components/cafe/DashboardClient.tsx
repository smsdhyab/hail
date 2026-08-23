"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { resetDailyAccount, getDaySummary } from "@/lib/cafe/dashboard-actions";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DaySummary, RecentOrder } from "@/lib/cafe/dashboard-actions";
import { formatIqd, formatIqdLabel } from "@/lib/cafe/money";
import { CHANNEL_AR } from "@/lib/cafe/branding";

const STATUS_AR: Record<string, string> = { pending: "معلّق", paid: "مدفوع", cancelled: "ملغي", refunded: "مسترجع" };
const STATUS_CLASS: Record<string, string> = {
  pending: "bg-accent text-accent-foreground",
  paid: "bg-primary/10 text-primary",
  cancelled: "bg-muted text-muted-foreground",
  refunded: "bg-destructive/10 text-destructive",
};

export function DashboardClient({
  days,
  summary,
  recent,
  monthlyCosts,
  guestsToday,
  guestsRange,
  todayReset = null,
  outstandingDebts = 0,
  todayDate,
  yesterday,
  yesterdaySummary = null,
  scopeLabel = "",
}: {
  days: number;
  summary: DaySummary[];
  recent: RecentOrder[];
  monthlyCosts: number;
  guestsToday: number;
  guestsRange: number;
  todayReset?: DaySummary | null;
  outstandingDebts?: number;
  todayDate: string;
  yesterday: string;
  yesterdaySummary?: DaySummary | null;
  /** which register these figures cover — «كل الأقسام» for the manager */
  scopeLabel?: string;
}) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  // «مبيعات يوم محدّد» — reconcile the drawer for a day that already rolled over.
  const [lookupDay, setLookupDay] = useState(yesterday);
  const [dayLookup, setDayLookup] = useState<DaySummary | null>(yesterdaySummary);
  const [loadingDay, setLoadingDay] = useState(false);
  async function onPickDay(d: string) {
    if (!d) return;
    setLookupDay(d);
    setLoadingDay(true);
    try {
      setDayLookup(await getDaySummary(d));
    } finally {
      setLoadingDay(false);
    }
  }
  // TODAY card reflects the shift-settlement reset; the range/charts + bot stay full.
  const today = todayReset ?? summary[summary.length - 1];

  async function doReset() {
    if (!window.confirm("تصفير الحساب اليومي؟\nسيبدأ عرض «اليوم» من الصفر (للتحاسب مع الموظفين). لا يؤثر على التقارير أو بوت التليجرام.")) return;
    setResetting(true);
    await resetDailyAccount();
    setResetting(false);
    router.refresh();
  }
  const totals = summary.reduce(
    (t, d) => ({
      sales: t.sales + d.sales,
      orders: t.orders + d.orders_count,
      profit: t.profit + d.profit,
      expenses: t.expenses + d.expenses,
      net: t.net + d.net,
    }),
    { sales: 0, orders: 0, profit: 0, expenses: 0, net: 0 },
  );
  const chartData = summary.map((d) => ({ ...d, label: d.day.slice(5) }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">لوحة التحكم</h1>
          {scopeLabel && <p className="text-sm font-semibold text-accent">{scopeLabel}</p>}
        </div>
        <div className="flex gap-1 rounded-lg border border-border p-1">
          {[
            { d: 1, label: "اليوم" },
            { d: 7, label: "٧ أيام" },
            { d: 30, label: "٣٠ يوم" },
          ].map((o) => (
            <Link
              key={o.d}
              href={`/dashboard?days=${o.d}`}
              className={`rounded-md px-3 py-1 text-sm font-medium transition ${
                days === o.d ? "bg-primary text-primary-foreground" : "hover:bg-secondary"
              }`}
            >
              {o.label}
            </Link>
          ))}
        </div>
      </div>

      {summary.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
          لا توجد بيانات بعد — اضبط اتصال قاعدة البيانات أو سجّل أول طلب.
        </div>
      ) : (
        <>
          {/* today KPIs */}
          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-muted-foreground">اليوم ({today?.day})</h2>
              <button
                onClick={doReset}
                disabled={resetting}
                title="يصفّر عرض «اليوم» فقط — للتحاسب مع الموظفين. لا يؤثر على التقارير أو البوت."
                className="rounded-lg border border-destructive/40 px-3 py-1.5 text-xs font-semibold text-destructive transition hover:bg-destructive/10 disabled:opacity-50"
              >
                {resetting ? "…" : "تصفير الحساب اليومي"}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Kpi label="المبيعات" value={formatIqdLabel(today?.sales ?? 0)} />
              <Kpi label="عدد الطلبات" value={String(today?.orders_count ?? 0)} />
              <Kpi label="عدد الزبائن" value={String(guestsToday)} />
              <Kpi label="الأرباح" value={formatIqdLabel(today?.profit ?? 0)} />
              <Kpi label="المصروفات" value={formatIqdLabel(today?.expenses ?? 0)} />
              <Kpi label="الصافي" value={formatIqdLabel(today?.net ?? 0)} highlight />
            </div>
          </section>

          {/* «مبيعات يوم محدّد» — closing total for any past day, to reconcile the
              cash drawer after the café stays open past midnight. Admin-only page. */}
          <section className="space-y-2 rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-muted-foreground">
                مبيعات يوم محدّد — لمطابقة الصندوق
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onPickDay(yesterday)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition hover:bg-secondary"
                >
                  مبيعات أمس
                </button>
                <input
                  type="date"
                  value={lookupDay}
                  max={todayDate}
                  onChange={(e) => onPickDay(e.target.value)}
                  className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                  dir="ltr"
                  aria-label="اختر تاريخاً"
                />
              </div>
            </div>
            <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 ${loadingDay ? "opacity-50" : ""}`}>
              <Kpi label="المبيعات" value={formatIqdLabel(dayLookup?.sales ?? 0)} />
              <Kpi label="عدد الطلبات" value={String(dayLookup?.orders_count ?? 0)} />
              <Kpi label="الأرباح" value={formatIqdLabel(dayLookup?.profit ?? 0)} />
              <Kpi label="المصروفات" value={formatIqdLabel(dayLookup?.expenses ?? 0)} />
              <Kpi label="الصافي" value={formatIqdLabel(dayLookup?.net ?? 0)} highlight />
            </div>
            <p className="text-xs text-muted-foreground">
              مبيعات اليوم المختار كاملةً — تبقى ثابتة حتى بعد منتصف الليل، فتُطابق الصندوق مع مبيعات أمس بدقّة.
            </p>
          </section>

          {/* outstanding debts — money owed to the shop, not yet collected */}
          {outstandingDebts > 0 && (
            <Link
              href="/debts"
              className="flex items-center justify-between rounded-xl border border-destructive/40 bg-destructive/5 p-4 transition hover:border-destructive/70"
            >
              <span className="text-sm font-semibold text-muted-foreground">💳 الديون المستحقة (غير محصّلة)</span>
              <span className="text-xl font-extrabold tabular-nums text-destructive">{formatIqdLabel(outstandingDebts)}</span>
            </Link>
          )}

          {/* range totals + chart */}
          {days > 1 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">
                إجمالي آخر {days === 7 ? "٧ أيام" : "٣٠ يوماً"}
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Kpi label="المبيعات" value={formatIqdLabel(totals.sales)} />
                <Kpi label="عدد الطلبات" value={String(totals.orders)} />
                <Kpi label="عدد الزبائن" value={String(guestsRange)} />
                <Kpi label="الأرباح" value={formatIqdLabel(totals.profit)} />
                <Kpi label="المصروفات" value={formatIqdLabel(totals.expenses)} />
                <Kpi label="الصافي" value={formatIqdLabel(totals.net)} highlight />
              </div>
              <div className="rounded-xl border border-border bg-card p-4" dir="ltr">
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="sales" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8a6d3b" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#8a6d3b" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#8884" />
                    <XAxis dataKey="label" fontSize={11} tickLine={false} />
                    <YAxis fontSize={11} tickLine={false} width={52} tickFormatter={(v: number) => formatIqd(v)} />
                    <Tooltip
                      formatter={(v) => formatIqdLabel(Number(v))}
                      labelFormatter={(l) => `اليوم ${l}`}
                    />
                    <Area type="monotone" dataKey="sales" name="المبيعات" stroke="#8a6d3b" fill="url(#sales)" strokeWidth={2} />
                    <Area type="monotone" dataKey="profit" name="الأرباح" stroke="#4f7a5a" fill="none" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {/* monthly summary incl. fixed monthly costs */}
          {days === 30 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">الملخص الشهري (بعد المصاريف الثابتة)</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Kpi label="أرباح التشغيل" value={formatIqdLabel(totals.profit)} />
                <Kpi label="المصاريف المتغيرة" value={formatIqdLabel(totals.expenses)} />
                <Kpi label="المصاريف الشهرية الثابتة" value={formatIqdLabel(monthlyCosts)} />
                <Kpi label="الصافي بعد الثابتة" value={formatIqdLabel(totals.net - monthlyCosts)} highlight />
              </div>
              <p className="text-xs text-muted-foreground">
                الصافي بعد الثابتة = الأرباح − المصاريف المتغيرة − المصاريف الشهرية الثابتة (الإيجار والكهرباء والمولد والمياه). تُضبط الثابتة من صفحة المصروفات.
              </p>
            </section>
          )}

          {/* recent orders */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground">أحدث الطلبات</h2>
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-right text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">رقم</th>
                    <th className="px-4 py-2.5 font-medium">القناة</th>
                    <th className="px-4 py-2.5 font-medium">الطاولة</th>
                    <th className="px-4 py-2.5 font-medium">الحالة</th>
                    <th className="px-4 py-2.5 font-medium">المبلغ</th>
                    <th className="px-4 py-2.5 font-medium">الوقت</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                        لا توجد طلبات بعد.
                      </td>
                    </tr>
                  )}
                  {recent.map((o) => (
                    <Fragment key={o.id}>
                      <tr
                        onClick={() => setExpandedId(expandedId === o.id ? null : o.id)}
                        className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-secondary/40"
                        title="اضغط لعرض تفاصيل الطلب"
                      >
                        <td className="px-4 py-2.5 font-semibold">{String(o.order_seq).padStart(3, "0")}</td>
                        <td className="px-4 py-2.5">{CHANNEL_AR[o.channel] ?? o.channel}</td>
                        <td className="px-4 py-2.5">{o.table_no ? `طاولة ${o.table_no}` : "—"}</td>
                        <td className="px-4 py-2.5">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS[o.status] ?? ""}`}>
                            {STATUS_AR[o.status] ?? o.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">{formatIqdLabel(o.subtotal)}</td>
                        <td className="px-4 py-2.5 text-muted-foreground" dir="ltr">
                          {new Date(o.created_at).toLocaleString("en-GB", {
                            timeZone: "Asia/Baghdad",
                            hour: "2-digit",
                            minute: "2-digit",
                            day: "2-digit",
                            month: "2-digit",
                          })}
                        </td>
                      </tr>
                      {expandedId === o.id && (
                        <tr className="border-b border-border/60 bg-secondary/30">
                          <td colSpan={6} className="px-6 py-3">
                            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">تفاصيل الطلب:</p>
                            <ul className="space-y-0.5 text-sm">
                              {o.items.map((it, i) => (
                                <li key={i} className="flex justify-between">
                                  <span>
                                    {it.name_ar}
                                    {it.flavor_ar ? ` (${it.flavor_ar})` : ""} ×{it.qty}
                                  </span>
                                  <span className="text-muted-foreground">{formatIqdLabel(it.line_total)}</span>
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border border-border p-4 ${highlight ? "bg-primary text-primary-foreground" : "bg-card"}`}>
      <p className={`text-xs ${highlight ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
    </div>
  );
}
