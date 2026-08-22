"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/types";
import { requireStaff, stationScope } from "./auth";
import { loyaltyConfig } from "./config";
import { earnPoints } from "./points";
import { stationName, type StationSlug } from "./hail-menu";
import {
  cancelGroupLocal,
  isLocalDb,
  listPendingLocal,
  orderGroup,
  orderItems,
  payGroupLocal,
  placeOrderLocal,
} from "./local-db";
import type { OrderLineInput } from "./order-actions";

export type PendingItem = { name_ar: string; flavor_ar: string | null; qty: number; unit_price: number; line_total: number };

/**
 * One register's view of a customer order. `items`/`subtotal` are THIS
 * station's share; `groupTotal` is what the customer actually owes across both
 * registers, because they pay once. `otherStations` names the counters also
 * working on the same ticket.
 */
export type PendingOrder = {
  id: string;
  /** the number the customer was given — shared across the split */
  group_no: number;
  /** this register's own daily sequence */
  station_seq: number;
  station: StationSlug;
  channel: string;
  subtotal: number;
  groupTotal: number;
  otherStations: string[];
  table_no: string | null;
  floor: number | null;
  note: string | null;
  created_at: string;
  items: PendingItem[];
};

/** Self-orders awaiting the counter, oldest first, scoped to the caller's register. */
export async function listPendingOrders(): Promise<PendingOrder[]> {
  const staff = await requireStaff();
  const scope = stationScope(staff);

  if (isLocalDb()) {
    return listPendingLocal(scope).map((o) => {
      const group = orderGroup(o.group_no, o.business_day).filter((g) => g.status === "pending");
      return {
        id: o.id,
        group_no: o.group_no,
        station_seq: o.station_seq,
        station: o.station,
        channel: o.channel,
        subtotal: o.subtotal,
        groupTotal: group.reduce((s, g) => s + g.subtotal, 0),
        otherStations: group.filter((g) => g.station !== o.station).map((g) => stationName(g.station)),
        table_no: o.table_no,
        floor: o.floor,
        note: o.note,
        created_at: o.created_at,
        items: orderItems(o.id).map((i) => ({
          name_ar: i.name_ar,
          flavor_ar: i.flavor_ar,
          qty: i.qty,
          unit_price: i.unit_price,
          line_total: i.qty * i.unit_price,
        })),
      };
    });
  }

  const supabase = await createSupabaseServerClient();
  const { data: stationRows } = await supabase.from("stations").select("id, slug");
  const slugOf = new Map((stationRows ?? []).map((s) => [s.id, s.slug as StationSlug]));
  const idOf = new Map((stationRows ?? []).map((s) => [s.slug as StationSlug, s.id]));

  let q = supabase
    .from("orders")
    .select("id, order_seq, group_no, station_id, channel, subtotal, table_no, floor, note, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  const scopeId = scope ? idOf.get(scope) : undefined;
  if (scopeId) q = q.eq("station_id", scopeId);
  const { data: orders } = await q;
  if (!orders?.length) return [];

  const ids = orders.map((o) => o.id);
  const { data: items } = await supabase
    .from("order_items")
    .select("order_id, name_ar, flavor_ar, qty, unit_price, line_total")
    .in("order_id", ids);

  const byOrder = new Map<string, PendingItem[]>();
  for (const it of items ?? []) {
    const arr = byOrder.get(it.order_id) ?? [];
    arr.push({ name_ar: it.name_ar, flavor_ar: it.flavor_ar, qty: it.qty, unit_price: it.unit_price, line_total: it.line_total });
    byOrder.set(it.order_id, arr);
  }
  // group totals so the cashier collects the FULL ticket, not just their half
  const totalByGroup = new Map<number, number>();
  for (const o of orders) totalByGroup.set(o.group_no, (totalByGroup.get(o.group_no) ?? 0) + o.subtotal);

  return orders.map((o) => {
    const slug = slugOf.get(o.station_id)!;
    return {
      id: o.id,
      group_no: o.group_no,
      station_seq: o.order_seq,
      station: slug,
      channel: o.channel,
      subtotal: o.subtotal,
      groupTotal: totalByGroup.get(o.group_no) ?? o.subtotal,
      otherStations: orders
        .filter((x) => x.group_no === o.group_no && x.id !== o.id)
        .map((x) => stationName(slugOf.get(x.station_id))),
      table_no: o.table_no,
      floor: o.floor,
      note: o.note,
      created_at: o.created_at,
      items: byOrder.get(o.id) ?? [],
    };
  });
}

export type CheckoutResult =
  | { ok: true; orderNumber: string; total: number; awarded: number; perStation: { station_ar: string; net: number }[] }
  | { ok: false; error: string };

/**
 * Cashier: create an order and take the payment in one step.
 *
 * The lines may span both registers — the order splits, but the customer pays
 * ONCE at this counter. The money is then prorated back onto each register's
 * books, and `collected_by` records which drawer holds the cash.
 */
export async function cashierCheckout(input: {
  lines: OrderLineInput[];
  discount?: number;
  extra?: number;
  extraNote?: string | null;
  customerId?: string | null;
  table?: string | null;
  note?: string | null;
}): Promise<CheckoutResult> {
  const staff = await requireStaff();
  if (!input.lines?.length) return { ok: false, error: "لا توجد أصناف في الطلب." };
  const till = staff.station;
  if (!till) return { ok: false, error: "اختر الكاشير الذي تعمل عليه أولاً." };

  if (isLocalDb()) {
    const placed = placeOrderLocal({ channel: "cashier", lines: input.lines, table: input.table, note: input.note, cashierId: staff.employeeId });
    if ("error" in placed) return { ok: false, error: placed.error };
    const paid = payGroupLocal(placed.group_no, {
      discount: input.discount,
      extra: input.extra,
      extraNote: input.extraNote,
      collectedBy: till,
      cashierId: staff.employeeId,
    });
    if ("error" in paid) return { ok: false, error: paid.error };
    revalidatePath("/cashier");
    revalidatePath("/dashboard");
    return {
      ok: true,
      orderNumber: String(placed.group_no).padStart(3, "0"),
      total: paid.total,
      awarded: 0,
      perStation: paid.perStation.map((p) => ({ station_ar: stationName(p.station), net: p.net })),
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data: placed, error } = await supabase.rpc("place_order", {
    p_channel: "cashier",
    p_lines: input.lines as unknown as Json,
    p_customer: input.customerId ?? null,
    p_table: input.table?.trim() || null,
    p_note: input.note?.trim() || null,
  });
  if (error || !placed?.[0]) return { ok: false, error: error?.message ?? "تعذّر إنشاء الطلب." };

  return payGroup(placed[0].group_no, till, {
    discount: input.discount ?? 0,
    extra: input.extra ?? 0,
    extraNote: input.extraNote ?? null,
    customerId: input.customerId ?? null,
  });
}

/** Accept & pay an existing pending order — settles the WHOLE ticket. */
export async function payPendingOrder(orderId: string, discount = 0, customerId: string | null = null) {
  const staff = await requireStaff();
  const till = staff.station;
  if (!till) return { ok: false as const, error: "اختر الكاشير الذي تعمل عليه أولاً." };

  if (isLocalDb()) {
    const order = listPendingLocal(null).find((o) => o.id === orderId);
    if (!order) return { ok: false as const, error: "الطلب غير موجود." };
    const paid = payGroupLocal(order.group_no, { discount, collectedBy: till, cashierId: staff.employeeId });
    if ("error" in paid) return { ok: false as const, error: paid.error };
    revalidatePath("/orders");
    revalidatePath("/dashboard");
    return { ok: true as const, awarded: 0, total: paid.total };
  }

  const supabase = await createSupabaseServerClient();
  const { data: row } = await supabase.from("orders").select("group_no").eq("id", orderId).maybeSingle();
  if (!row) return { ok: false as const, error: "الطلب غير موجود." };
  const res = await payGroup(row.group_no, till, { discount, extra: 0, extraNote: null, customerId });
  return res.ok ? { ok: true as const, awarded: res.awarded, total: res.total } : res;
}

/** Shared Supabase path: settle one group and prorate it across the registers. */
async function payGroup(
  groupNo: number,
  collectedBy: StationSlug,
  opts: { discount: number; extra: number; extraNote: string | null; customerId: string | null },
): Promise<CheckoutResult> {
  const supabase = await createSupabaseServerClient();
  const { data: rows } = await supabase.from("orders").select("subtotal, customer_id").eq("group_no", groupNo).eq("status", "pending");
  const gross = (rows ?? []).reduce((s, r) => s + r.subtotal, 0);
  const disc = Math.min(Math.max(0, Math.round(opts.discount)), gross);
  const ext = Math.max(0, Math.round(opts.extra));
  const net = gross - disc + ext;

  const cfg = loyaltyConfig();
  const beneficiary = opts.customerId ?? rows?.find((r) => r.customer_id)?.customer_id ?? null;
  const award = beneficiary ? earnPoints(net, cfg.pointsPerIqd) : 0;

  const { data, error } = await supabase.rpc("pay_order_group", {
    p_group: groupNo,
    p_discount: disc,
    p_extra: ext,
    p_extra_note: opts.extraNote?.trim() || null,
    p_customer: opts.customerId,
    p_award_points: award,
    p_collected_by: collectedBy,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/cashier");
  revalidatePath("/orders");
  revalidatePath("/dashboard");
  return {
    ok: true,
    orderNumber: String(groupNo).padStart(3, "0"),
    total: net,
    awarded: award,
    perStation: (data ?? []).map((d) => ({ station_ar: stationName(d.station_slug), net: d.net })),
  };
}

export async function cancelOrder(orderId: string) {
  const staff = await requireStaff();

  if (isLocalDb()) {
    const order = listPendingLocal(null).find((o) => o.id === orderId);
    if (!order) return { ok: false as const, error: "الطلب غير موجود." };
    // one ticket, one decision — cancelling drops both halves
    cancelGroupLocal(order.group_no);
    revalidatePath("/orders");
    return { ok: true as const };
  }

  void staff;
  const supabase = await createSupabaseServerClient();
  const { data: row } = await supabase.from("orders").select("group_no").eq("id", orderId).maybeSingle();
  if (!row) return { ok: false as const, error: "الطلب غير موجود." };
  const { error } = await supabase.rpc("cancel_order_group", { p_group: row.group_no });
  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/orders");
  revalidatePath("/cashier");
  return { ok: true as const };
}
