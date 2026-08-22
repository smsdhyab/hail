import { getRangeSummary, getRecentOrders, getGuestEstimate, getTodaySinceReset, getDaySummary, getScopeLabel, type DaySummary, type RecentOrder } from "@/lib/cafe/dashboard-actions";
import { getMonthlyCosts } from "@/lib/cafe/expense-actions";
import { getTotalOutstanding } from "@/lib/cafe/debt-actions";
import { lastNDays, businessDay } from "@/lib/cafe/time";
import { DashboardClient } from "@/components/cafe/DashboardClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
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
  summary = s;
  recent = r;
  monthlyCosts = mc.reduce((t, c) => t + c.amount, 0);
  guestsToday = gt;
  guestsRange = gr;
  todayReset = tr;
  outstandingDebts = od;
  yesterdaySummary = ys;
  scopeLabel = scope.label;

  return <DashboardClient days={days} summary={summary} recent={recent} monthlyCosts={monthlyCosts} guestsToday={guestsToday} guestsRange={guestsRange} todayReset={todayReset} outstandingDebts={outstandingDebts} todayDate={today} yesterday={yesterday} yesterdaySummary={yesterdaySummary} scopeLabel={scopeLabel} />;
}
