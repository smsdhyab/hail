"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { requireAdmin, requireStaff, stationScope, type Staff } from "./auth";
import { stationName, type StationSlug } from "./hail-menu";
import { isLocalDb, listOrdersLocal, orderItems, summaryLocal } from "./local-db";
import { businessDay } from "./time";

export type DaySummary = {
  day: string;
  sales: number;
  orders_count: number;
  profit: number;
  expenses: number;
  net: number;
};

const EMPTY = (day: string): DaySummary => ({ day, sales: 0, orders_count: 0, profit: 0, expenses: 0, net: 0 });

/**
 * Cost and profit stay management-only — the DB revokes those columns from
 * everyone but the service role, and this strips them again for a cashier who
 * legitimately sees their own register's sales.
 */
function forViewer(rows: DaySummary[], staff: Staff): DaySummary[] {
  if (staff.role === "admin") return rows;
  return rows.map((r) => ({ ...r, profit: 0, expenses: 0, net: 0 }));
}

/** Which register the figures cover, for the screen's heading. */
export async function getScopeLabel(): Promise<{ station: StationSlug | null; label: string }> {
  const staff = await requireStaff();
  const scope = stationScope(staff);
  return { station: scope, label: scope ? stationName(scope) : "كل الأقسام" };
}

/**
 * Daily rollup over a range, scoped to the caller's register. A cashier sees
 * only their own books; the manager sees the whole shop. This is what keeps
 * the two sets of accounts separate on one system.
 */
export async function getRangeSummary(from: string, to: string): Promise<DaySummary[]> {
  const staff = await requireStaff();
  const scope = stationScope(staff);

  if (isLocalDb()) {
    return forViewer(
      summaryLocal(from, to, scope).map((d) => ({ ...d, profit: 0, expenses: 0, net: 0 })),
      staff,
    );
  }

  const svc = createSupabaseServiceClient();
  const { data, error } = await svc.rpc("range_summary", { p_from: from, p_to: to, p_station: scope });
  if (error) throw new Error(error.message);
  return forViewer((data ?? []) as DaySummary[], staff);
}

/** Full rollup for a single business day — used to reconcile the drawer after
 *  midnight, when `business_day` has already rolled over. */
export async function getDaySummary(day: string): Promise<DaySummary> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("تاريخ غير صالح");
  return (await getRangeSummary(day, day))[0] ?? EMPTY(day);
}

// Baghdad is UTC+3 year-round (Iraq has no DST).
function baghdadDayStart(): string {
  return `${businessDay()}T00:00:00+03:00`;
}

/** «تصفير الحساب اليومي» — record a reset point for internal shift settlement.
 *  Non-destructive: no order is deleted; only the dashboard's TODAY view starts
 *  counting again from now. The Telegram bot is unaffected (full day). Admin only. */
export async function resetDailyAccount(): Promise<{ ok: true }> {
  await requireAdmin();
  if (isLocalDb()) return { ok: true };
  const svc = createSupabaseServiceClient();
  await svc.from("daily_resets").insert({});
  revalidatePath("/dashboard");
  return { ok: true };
}

/** Today's rollup counting only orders/expenses AFTER the latest reset (or day
 *  start if none), scoped to the caller's register. */
export async function getTodaySinceReset(): Promise<DaySummary> {
  const staff = await requireStaff();
  const scope = stationScope(staff);
  const day = businessDay();

  if (isLocalDb()) {
    return forViewer([{ ...(summaryLocal(day, day, scope)[0] ?? EMPTY(day)), profit: 0, expenses: 0, net: 0 }], staff)[0];
  }

  const svc = createSupabaseServiceClient();
  const dayStart = baghdadDayStart();
  const { data: resets } = await svc
    .from("daily_resets")
    .select("reset_at")
    .gte("reset_at", dayStart)
    .order("reset_at", { ascending: false })
    .limit(1);
  const cutoff = resets?.[0]?.reset_at ?? dayStart;

  const stationId = scope ? await stationIdOf(scope) : null;
  let q = svc.from("orders").select("subtotal, cost_total, discount, extra, group_no").eq("status", "paid").gte("paid_at", cutoff);
  if (stationId) q = q.eq("station_id", stationId);
  const { data: orders } = await q;

  const sales = (orders ?? []).reduce((s, o) => s + (o.subtotal ?? 0) - (o.discount ?? 0) + (o.extra ?? 0), 0);
  const cost = (orders ?? []).reduce((s, o) => s + (o.cost_total ?? 0), 0);
  // one customer ticket = one order, however many registers it touched
  const orders_count = new Set((orders ?? []).map((o) => o.group_no)).size;

  let eq = svc.from("expenses").select("amount").gte("created_at", cutoff);
  if (stationId) eq = eq.eq("station_id", stationId);
  const { data: exps } = await eq;
  const expenses = (exps ?? []).reduce((s, e) => s + (e.amount ?? 0), 0);

  const profit = sales - cost;
  return forViewer([{ day, sales, orders_count, profit, expenses, net: profit - expenses }], staff)[0];
}

async function stationIdOf(slug: StationSlug): Promise<string | null> {
  const svc = createSupabaseServiceClient();
  const { data } = await svc.from("stations").select("id").eq("slug", slug).maybeSingle();
  return data?.id ?? null;
}

/** Estimated guest count over a range = total item quantity on paid orders
 *  (one item ≈ one guest). Aggregated server-side so PostgREST's 1000-row cap
 *  can't silently truncate it. Admin only. */
export async function getGuestEstimate(from: string, to: string): Promise<number> {
  await requireAdmin();
  if (isLocalDb()) return 0;
  const svc = createSupabaseServiceClient();
  const { data } = await svc.rpc("guest_estimate", { p_from: from, p_to: to });
  return Number(data) || 0;
}

export type RecentOrderItem = { name_ar: string; flavor_ar: string | null; qty: number; line_total: number };
export type RecentOrder = {
  id: string;
  order_seq: number;
  channel: string;
  status: string;
  subtotal: number;
  table_no: string | null;
  created_at: string;
  items: RecentOrderItem[];
};

/** Recent orders WITH their stored line items, scoped to the caller's register. */
export async function getRecentOrders(limit = 15): Promise<RecentOrder[]> {
  const staff = await requireStaff();
  const scope = stationScope(staff);

  if (isLocalDb()) {
    return listOrdersLocal(scope, limit).map((o) => ({
      id: o.id,
      order_seq: o.group_no,
      channel: o.channel,
      status: o.status,
      subtotal: o.subtotal - o.discount + o.extra,
      table_no: o.table_no,
      created_at: o.created_at,
      items: orderItems(o.id).map((i) => ({
        name_ar: i.name_ar,
        flavor_ar: i.flavor_ar,
        qty: i.qty,
        line_total: i.qty * i.unit_price,
      })),
    }));
  }

  const svc = createSupabaseServiceClient();
  const stationId = scope ? await stationIdOf(scope) : null;
  let q = svc
    .from("orders")
    .select("id, group_no, channel, status, subtotal, table_no, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (stationId) q = q.eq("station_id", stationId);
  const { data: orders } = await q;
  if (!orders?.length) return [];

  const ids = orders.map((o) => o.id);
  const { data: items } = await svc
    .from("order_items")
    .select("order_id, name_ar, flavor_ar, qty, line_total")
    .in("order_id", ids);
  const byOrder = new Map<string, RecentOrderItem[]>();
  for (const it of items ?? []) {
    const arr = byOrder.get(it.order_id) ?? [];
    arr.push({ name_ar: it.name_ar, flavor_ar: it.flavor_ar, qty: it.qty, line_total: it.line_total });
    byOrder.set(it.order_id, arr);
  }
  return orders.map((o) => ({
    id: o.id,
    order_seq: o.group_no,
    channel: o.channel,
    status: o.status,
    subtotal: o.subtotal,
    table_no: o.table_no,
    created_at: o.created_at,
    items: byOrder.get(o.id) ?? [],
  }));
}
