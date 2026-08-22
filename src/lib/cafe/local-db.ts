import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { HAIL_MENU, STATIONS, type StationSlug } from "./hail-menu";
import { splitByStation, splitPayment } from "./station";
import { businessDay } from "./time";

/**
 * Local JSON store — lets the whole two-register flow run with NO database
 * while the real one is being decided. One file, `node:fs`, no dependency.
 *
 * It is a stand-in for Supabase, not a replacement: single-process, no
 * concurrency control, plain-text staff PINs. It only switches on when BOTH
 * `HAIL_LOCAL_DB=1` is set AND no Supabase URL is configured, so it can never
 * be the active path on a real deployment.
 *
 * ponytail: read-modify-write of the whole file under a single dev server.
 * Swap for the Supabase RPCs (supabase/migrations/0021_stations.sql implements
 * the same rules in SQL) the moment a database exists.
 */

/** httpOnly cookie holding `<employeeId>:<station>` for the local session. */
export const LOCAL_STAFF_COOKIE = "hail-local";

export function isLocalDb(): boolean {
  return process.env.HAIL_LOCAL_DB === "1" && !process.env.NEXT_PUBLIC_SUPABASE_URL;
}

// ── shapes ─────────────────────────────────────────────────────────────────
export type LocalEmployee = {
  id: string;
  login: string;
  pin: string;
  name_ar: string;
  role: "admin" | "cashier";
  /** null = admin, may act for either register */
  station: StationSlug | null;
  active: boolean;
};

export type LocalOrderItem = {
  id: string;
  order_id: string;
  item_id: string;
  variant_id: string | null;
  name_ar: string;
  flavor_ar: string | null;
  qty: number;
  unit_price: number;
};

export type LocalOrder = {
  id: string;
  business_day: string;
  /** the number the CUSTOMER sees — shared by both halves of a split order */
  group_no: number;
  station: StationSlug;
  /** each register's own daily sequence, for its receipts and books */
  station_seq: number;
  channel: "qr" | "kiosk" | "cashier";
  status: "pending" | "paid" | "cancelled";
  subtotal: number;
  discount: number;
  extra: number;
  extra_note: string | null;
  table_no: string | null;
  floor: number | null;
  note: string | null;
  /** which register physically took the cash (may differ from `station`) */
  collected_by: StationSlug | null;
  cashier_id: string | null;
  paid_at: string | null;
  created_at: string;
};

export type LocalTable = {
  name: string;
  kind: "indoor" | "outdoor";
  floor: number;
  active: boolean;
  x: number;
  y: number;
  sort: number;
};

type DB = {
  employees: LocalEmployee[];
  orders: LocalOrder[];
  order_items: LocalOrderItem[];
  tables: LocalTable[];
  /** business_day → { group, pastry, cafe } running counters */
  counters: Record<string, Record<string, number>>;
};

// ── storage ────────────────────────────────────────────────────────────────
// HAIL_DATA_DIR lets tests point at a throwaway directory instead of the
// working store the dev server is using.
const DIR = process.env.HAIL_DATA_DIR || join(process.cwd(), ".data");
const FILE = join(DIR, "hail.json");

function seed(): DB {
  const tables: LocalTable[] = [];
  // 6 tables per floor, two floors, plus two outdoor. The floor is delivery
  // information only — the menu is the same everywhere.
  for (let floor = 1; floor <= 2; floor++) {
    for (let n = 1; n <= 6; n++) {
      const idx = (floor - 1) * 6 + n;
      tables.push({
        name: String(idx),
        kind: "indoor",
        floor,
        active: true,
        x: 18 + ((n - 1) % 3) * 32,
        y: 25 + Math.floor((n - 1) / 3) * 40,
        sort: idx,
      });
    }
  }
  tables.push({ name: "خارجي 1", kind: "outdoor", floor: 1, active: true, x: 25, y: 85, sort: 13 });
  tables.push({ name: "خارجي 2", kind: "outdoor", floor: 1, active: true, x: 70, y: 85, sort: 14 });

  return {
    employees: [
      { id: randomUUID(), login: "admin", pin: "1234", name_ar: "المدير", role: "admin", station: null, active: true },
      { id: randomUUID(), login: "pastry", pin: "1111", name_ar: "كاشير المعجنات", role: "cashier", station: "pastry", active: true },
      { id: randomUUID(), login: "cafe", pin: "2222", name_ar: "كاشير الكافيه", role: "cashier", station: "cafe", active: true },
    ],
    orders: [],
    order_items: [],
    tables,
    counters: {},
  };
}

let cache: DB | null = null;

function load(): DB {
  if (cache) return cache;
  if (existsSync(FILE)) {
    try {
      cache = JSON.parse(readFileSync(FILE, "utf8")) as DB;
      return cache;
    } catch {
      // corrupt file → start clean rather than crash the dev server
    }
  }
  cache = seed();
  save();
  return cache;
}

function save(): void {
  if (!cache) return;
  mkdirSync(DIR, { recursive: true });
  // write-then-rename so a crash mid-write cannot truncate the store
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache, null, 2), "utf8");
  renameSync(tmp, FILE);
}

/** Test/dev helper — drops the store back to seed state. */
export function resetLocalDb(): void {
  cache = seed();
  save();
}

function nextSeq(db: DB, day: string, key: string): number {
  const row = (db.counters[day] ??= {});
  row[key] = (row[key] ?? 0) + 1;
  return row[key];
}

// ── auth ───────────────────────────────────────────────────────────────────
export function findEmployee(login: string, pin: string): LocalEmployee | null {
  const db = load();
  const l = login.trim().toLowerCase();
  return db.employees.find((e) => e.active && e.login.toLowerCase() === l && e.pin === pin.trim()) ?? null;
}

export function employeeById(id: string): LocalEmployee | null {
  return load().employees.find((e) => e.active && e.id === id) ?? null;
}

// ── menu lookup ────────────────────────────────────────────────────────────
const CATALOG = new Map(
  HAIL_MENU.flatMap((c) =>
    c.items.map((i) => [i.id, { ...i, station: c.station, category: c.name_ar }] as const),
  ),
);

/** Price + display name for a line, honouring the chosen size variant. */
function resolveLine(itemId: string, variantId: string | null | undefined) {
  const item = CATALOG.get(itemId);
  if (!item || item.active === false) return null;
  let price = item.price;
  let name = item.name_ar;
  if (variantId) {
    const v = (item.variants ?? []).find(([n, p]) => `${itemId}-${p}` === variantId || n === variantId);
    if (!v) return null;
    price = v[1];
    name = `${item.name_ar} - ${v[0]}`;
  }
  return { price, name, station: item.station };
}

export type LocalLineInput = { item_id: string; variant_id?: string | null; flavor?: string | null; qty: number };

// ── orders ─────────────────────────────────────────────────────────────────
export type PlacedGroup = { group_no: number; orders: LocalOrder[] };

/**
 * Place one customer order. Lines are grouped by the station that owns them,
 * producing ONE order row per station, all sharing the customer-facing
 * `group_no`. This is the routing rule, and the SQL `place_order` in
 * 0021_stations.sql mirrors it exactly.
 */
export function placeOrderLocal(input: {
  channel: LocalOrder["channel"];
  lines: LocalLineInput[];
  table?: string | null;
  note?: string | null;
  cashierId?: string | null;
}): PlacedGroup | { error: string } {
  const db = load();
  const resolved = input.lines
    .map((l) => {
      const r = resolveLine(l.item_id, l.variant_id);
      return r ? { ...l, ...r, qty: Math.max(1, Math.round(l.qty || 1)) } : null;
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);
  if (!resolved.length) return { error: "لا توجد أصناف صالحة في الطلب." };

  const day = businessDay();
  const groupNo = nextSeq(db, day, "group");
  const tableNo = input.table?.trim() || null;
  const floor = tableNo ? (db.tables.find((t) => t.name === tableNo)?.floor ?? null) : null;
  const now = new Date().toISOString();

  const orders: LocalOrder[] = [];
  for (const bucket of splitByStation(resolved, (l) => l.station)) {
    const orderId = randomUUID();
    let subtotal = 0;
    for (const l of bucket.lines) {
      subtotal += l.price * l.qty;
      db.order_items.push({
        id: randomUUID(),
        order_id: orderId,
        item_id: l.item_id,
        variant_id: l.variant_id ?? null,
        name_ar: l.name,
        flavor_ar: l.flavor?.trim() || null,
        qty: l.qty,
        unit_price: l.price,
      });
    }
    const order: LocalOrder = {
      id: orderId,
      business_day: day,
      group_no: groupNo,
      station: bucket.station,
      station_seq: nextSeq(db, day, bucket.station),
      channel: input.channel,
      status: "pending",
      subtotal,
      discount: 0,
      extra: 0,
      extra_note: null,
      table_no: tableNo,
      floor,
      note: input.note?.trim().slice(0, 300) || null,
      collected_by: null,
      cashier_id: input.cashierId ?? null,
      paid_at: null,
      created_at: now,
    };
    db.orders.push(order);
    orders.push(order);
  }
  save();
  return { group_no: groupNo, orders };
}

export function orderItems(orderId: string): LocalOrderItem[] {
  return load().order_items.filter((i) => i.order_id === orderId);
}

/** Pending orders, newest last. `station` null = every register (admin view). */
export function listPendingLocal(station: StationSlug | null): LocalOrder[] {
  return load()
    .orders.filter((o) => o.status === "pending" && (station === null || o.station === station))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Recent orders for one register (or all), newest first. */
export function listOrdersLocal(station: StationSlug | null, limit = 20): LocalOrder[] {
  return load()
    .orders.filter((o) => station === null || o.station === station)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
}

/** Every order in a customer-facing group, in STATIONS order. */
export function orderGroup(groupNo: number, day = businessDay()): LocalOrder[] {
  const rank = (s: StationSlug) => STATIONS.findIndex((x) => x.slug === s);
  return load()
    .orders.filter((o) => o.group_no === groupNo && o.business_day === day)
    .sort((a, b) => rank(a.station) - rank(b.station));
}

export type PaidGroup = { group_no: number; total: number; perStation: { station: StationSlug; net: number }[] };

/**
 * ONE payment for a whole group. The discount and any surcharge are prorated
 * across the stations by subtotal, so each register's books get exactly its
 * share and the parts add back up to what the customer handed over.
 * `collectedBy` records which drawer the cash physically went into.
 */
export function payGroupLocal(
  groupNo: number,
  opts: { discount?: number; extra?: number; extraNote?: string | null; collectedBy: StationSlug; cashierId?: string | null } ,
): PaidGroup | { error: string } {
  const db = load();
  const day = businessDay();
  const group = db.orders.filter((o) => o.group_no === groupNo && o.business_day === day && o.status === "pending");
  if (!group.length) return { error: "الطلب غير موجود أو مدفوع مسبقاً." };

  const split = splitPayment(group.map((o) => o.subtotal), opts.discount ?? 0, opts.extra ?? 0);
  const now = new Date().toISOString();
  group.forEach((o, i) => {
    o.discount = split.discount[i];
    o.extra = split.extra[i];
    o.extra_note = opts.extraNote?.trim() || null;
    o.status = "paid";
    o.collected_by = opts.collectedBy;
    o.cashier_id = opts.cashierId ?? o.cashier_id;
    o.paid_at = now;
  });
  save();
  return {
    group_no: groupNo,
    total: split.total,
    perStation: group.map((o, i) => ({ station: o.station, net: split.net[i] })),
  };
}

export function cancelGroupLocal(groupNo: number): { ok: boolean } {
  const db = load();
  const day = businessDay();
  let ok = false;
  for (const o of db.orders) {
    if (o.group_no === groupNo && o.business_day === day && o.status === "pending") {
      o.status = "cancelled";
      ok = true;
    }
  }
  if (ok) save();
  return { ok };
}

// ── reporting ──────────────────────────────────────────────────────────────
export type LocalDaySummary = { day: string; sales: number; orders_count: number; station: StationSlug | null };

/** Paid totals per day for one register (or the whole shop when null). */
export function summaryLocal(from: string, to: string, station: StationSlug | null): LocalDaySummary[] {
  const db = load();
  const days: LocalDaySummary[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); businessDay(d, "UTC") <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = businessDay(d, "UTC");
    // one group = one customer order, however many registers it touched
    const rows = db.orders.filter(
      (o) => o.business_day === day && o.status === "paid" && (station === null || o.station === station),
    );
    days.push({
      day,
      sales: rows.reduce((s, o) => s + o.subtotal - o.discount + o.extra, 0),
      orders_count: new Set(rows.map((o) => o.group_no)).size,
      station,
    });
  }
  return days;
}

export function listTablesLocal(): LocalTable[] {
  return load().tables.filter((t) => t.active).sort((a, b) => a.sort - b.sort);
}

/** Replace the whole floor plan. */
export function saveTablesLocal(tables: LocalTable[]): void {
  const db = load();
  db.tables = tables;
  save();
}

/** Which floor a table sits on — delivery info shown on the ticket. */
export function tableFloor(name: string | null): number | null {
  if (!name) return null;
  return load().tables.find((t) => t.name === name)?.floor ?? null;
}
