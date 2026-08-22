"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { requireStaff } from "./auth";
import { isLocalDb, listOrdersLocal, listTablesLocal, orderItems, saveTablesLocal } from "./local-db";
import { deriveTableStatuses, DEFAULT_TABLES, type CafeTable, type TableStatus } from "./tables";

/** The configured floor plan (all tables, ordered). Empty → not configured. */
export async function getTables(): Promise<CafeTable[]> {
  await requireStaff();

  if (isLocalDb()) {
    return listTablesLocal().map((t) => ({ name: t.name, kind: t.kind, active: t.active, x: t.x, y: t.y, floor: t.floor }));
  }

  const svc = createSupabaseServiceClient();
  const { data } = await svc.from("cafe_tables").select("name, kind, floor, active, pos_x, pos_y, sort").order("sort");
  return (data ?? []).map((t) => ({
    name: t.name,
    kind: t.kind === "outdoor" ? "outdoor" : "indoor",
    active: t.active,
    x: t.pos_x,
    y: t.pos_y,
    floor: t.floor,
  }));
}

/** Active table names for ordering surfaces (cashier chips, QR stickers).
 *  Falls back to the default layout only when NOTHING is configured — an owner
 *  who deactivates every table (takeaway-only) gets an empty list, not the
 *  phantom defaults. */
export async function getActiveTableNames(): Promise<string[]> {
  const all = await getTables();
  if (!all.length) return DEFAULT_TABLES;
  return all.filter((t) => t.active).map((t) => t.name);
}

/** Replace the whole floor plan atomically. Staff-editable (the cashier can
 *  rearrange too). The save_cafe_tables RPC does delete+insert in one
 *  transaction, so a failed insert rolls back and never leaves an empty plan. */
export async function saveTables(tables: CafeTable[]): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireStaff();
  const rows = tables
    .map((t, i) => ({
      name: t.name.trim(),
      kind: t.kind === "outdoor" ? "outdoor" : "indoor",
      active: t.active,
      floor: Math.max(1, Math.round(t.floor ?? 1)),
      pos_x: clamp(t.x),
      pos_y: clamp(t.y),
      sort: i,
    }))
    .filter((r) => r.name);
  if (!rows.length) return { ok: false, error: "لا توجد طاولات." };

  if (isLocalDb()) {
    saveTablesLocal(
      rows.map((r) => ({
        name: r.name,
        kind: r.kind === "outdoor" ? ("outdoor" as const) : ("indoor" as const),
        floor: r.floor,
        active: r.active,
        x: r.pos_x,
        y: r.pos_y,
        sort: r.sort,
      })),
    );
    revalidatePath("/tables");
    revalidatePath("/cashier");
    revalidatePath("/qr");
    return { ok: true };
  }

  const svc = createSupabaseServiceClient();
  const { error } = await svc.rpc("save_cafe_tables", { p_tables: rows });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/tables");
  revalidatePath("/cashier");
  revalidatePath("/qr");
  return { ok: true };
}
function clamp(n: number) {
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 50;
}

/** Live occupancy of every table + the layout, derived from the last 12h of
 *  orders. Guests per table = number of items on the current order. */
export async function listTableStatus(): Promise<{ tables: TableStatus[]; layout: CafeTable[] }> {
  await requireStaff();
  const layout = await getTables();
  const names = layout.filter((t) => t.active).map((t) => t.name);

  if (isLocalDb()) {
    // both registers share the floor, so occupancy is never station-scoped
    const rows = listOrdersLocal(null, 400)
      .filter((o) => o.table_no && (o.status === "pending" || o.status === "paid"))
      .map((o) => ({
        order_seq: o.group_no,
        status: o.status,
        table_no: o.table_no,
        paid_at: o.paid_at,
        created_at: o.created_at,
        subtotal: o.subtotal,
        guests: orderItems(o.id).reduce((n, i) => n + i.qty, 0),
      }));
    return { tables: deriveTableStatuses(rows, Date.now(), layout.length ? names : DEFAULT_TABLES), layout };
  }

  const svc = createSupabaseServiceClient();
  const since = new Date(Date.now() - 12 * 3600_000).toISOString();
  const { data: orders } = await svc
    .from("orders")
    .select("id, order_seq, status, table_no, paid_at, created_at, subtotal")
    .not("table_no", "is", null)
    .gte("created_at", since)
    .in("status", ["pending", "paid"])
    .order("created_at", { ascending: false })
    .limit(400);

  // guests = total item quantity per order
  const ids = (orders ?? []).map((o) => o.id);
  const guestByOrder = new Map<string, number>();
  if (ids.length) {
    const { data: items } = await svc.from("order_items").select("order_id, qty").in("order_id", ids);
    for (const it of items ?? []) guestByOrder.set(it.order_id, (guestByOrder.get(it.order_id) ?? 0) + it.qty);
  }
  const rows = (orders ?? []).map((o) => ({ ...o, guests: guestByOrder.get(o.id) ?? 0 }));

  // layout has rows but all inactive → empty active list (dine-in off), not defaults
  return { tables: deriveTableStatuses(rows, Date.now(), layout.length ? names : DEFAULT_TABLES), layout };
}
