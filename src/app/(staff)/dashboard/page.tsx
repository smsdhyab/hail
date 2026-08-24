import { getRangeSummary, getRecentOrders, getGuestEstimate, getTodaySinceReset, getDaySummary, getScopeLabel, type DaySummary, type RecentOrder } from "@/lib/cafe/dashboard-actions";
import { getMonthlyCosts } from "@/lib/cafe/expense-actions";
import { getTotalOutstanding } from "@/lib/cafe/debt-actions";
import { lastNDays, businessDay } from "@/lib/cafe/time";
import { DashboardClient } from "@/components/cafe/DashboardClient";
import { SettingsCard } from "@/components/cafe/SettingsCard";
import { purchasesSpent } from "@/lib/cafe/purchase-actions";
import { formatIqdLabel } from "@/lib/cafe/money";
import { getDeliveryFee } from "@/lib/cafe/pastry-actions";
import { getStaff, homeFor } from "@/lib/cafe/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  // الأرقام للمدير وحده. إخفاء الرابط من القائمة لا يكفي — العنوان يُكتب باليد.
  const me = await getStaff().catch(() => null);
  if (me && me.role !== "admin") redirect(homeFor(me.role));

  const sp = await searchParams;
  const days = sp.days === "30" ? 30 : sp.days === "1" ? 1 : 7;

  let summary: DaySummary[] = [];
  let recent: RecentOrder[] = [];
  let monthlyCosts = 0;
  let guestsToday = 0;
  let guestsRange = 0;
  let todayReset: DaySummary | null = null;
  let outstandingDebts = 0;
  const now = new Date();
  const today = businessDay(now);
  const yesterday = businessDay(new Date(now.getTime() - 86_400_000));
  let yesterdaySummary: DaySummary | null = null;
  let scopeLabel = "";

  // A cashier sees this page too, but only their own register's figures — the
  // management-only calls below simply resolve empty for them instead of
  // failing the whole render.
  const safe = <T,>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);

  const [from, to] = lastNDays(days);
  const [s, r, mc, gt, gr, tr, od, ys, scope] = await Promise.all([
    safe(getRangeSummary(from, to), []),
    safe(getRecentOrders(12), []),
    safe(getMonthlyCosts(), []),
    safe(getGuestEstimate(to, to), 0),
    safe(getGuestEstimate(from, to), 0),
    safe<DaySummary | null>(getTodaySinceReset(), null),
    safe(getTotalOutstanding(), 0),
    safe<DaySummary | null>(getDaySummary(yesterday), null),
    safe(getScopeLabel(), { station: null, label: "" }),
  ]);
  // الإعدادات للمدير وحده — الكاشير لا يغيّر أجرة التوصيل
  const staff = await safe(getStaff(), null);
  const deliveryFee = staff?.role === "admin" ? await safe(getDeliveryFee(), 0) : 0;
  const spent = staff?.role === "admin" ? await safe(purchasesSpent(days), { today: 0, range: 0 }) : { today: 0, range: 0 };
  summary = s;
  recent = r;
  monthlyCosts = mc.reduce((t, c) => t + c.amount, 0);
  guestsToday = gt;
  guestsRange = gr;
  todayReset = tr;
  outstandingDebts = od;
  yesterdaySummary = ys;
  scopeLabel = scope.label;

  return (
    <div className="space-y-4">
      <DashboardClient days={days} summary={summary} recent={recent} monthlyCosts={monthlyCosts} guestsToday={guestsToday} guestsRange={guestsRange} todayReset={todayReset} outstandingDebts={outstandingDebts} todayDate={today} yesterday={yesterday} yesterdaySummary={yesterdaySummary} scopeLabel={scopeLabel} />
      {staff?.role === "admin" && (spent.today > 0 || spent.range > 0) && (
        // نقد خرج على البضاعة — يُعرض منفصلاً عن «المصروفات» لأن كلفته مخصومة
        // أصلاً مع كل بيعة. ضمّه إليها يخصمه مرتين ويُظهر خسارة وهمية.
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="mb-1 font-extrabold text-primary">المشتريات (بضاعة)</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            نقد خرج على البضاعة وقيمته صارت مخزوناً. لا يُخصم من الربح هنا — كلفته تُخصم مع كل بيعة.
          </p>
          <div className="flex flex-wrap gap-6">
            <div>
              <p className="text-xs text-muted-foreground">اليوم</p>
              <p className="text-lg font-extrabold tabular-nums">{formatIqdLabel(spent.today)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">آخر {days} يوم</p>
              <p className="text-lg font-extrabold tabular-nums">{formatIqdLabel(spent.range)}</p>
            </div>
          </div>
        </section>
      )}
      {staff?.role === "admin" && <SettingsCard deliveryFee={deliveryFee} />}
    </div>
  );
}
