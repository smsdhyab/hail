import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// point the store at a throwaway dir BEFORE the module reads the env
const dir = mkdtempSync(join(tmpdir(), "hail-test-"));
process.env.HAIL_DATA_DIR = dir;

const mod = await import("./local-db");
const { cancelGroupLocal, orderGroup, orderItems, payGroupLocal, placeOrderLocal, resetLocalDb, summaryLocal } = mod;

beforeAll(() => resetLocalDb());
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** بقلاوة/كيك للمعجنات + كافيه للكافيه — the headline scenario. */
function mixedOrder() {
  const placed = placeOrderLocal({
    channel: "qr",
    table: "8",
    lines: [
      { item_id: "cake-slice", qty: 2 }, // 500 × 2  → المعجنات
      { item_id: "donut", qty: 1 }, //      1500     → المعجنات
      { item_id: "ice-latte", qty: 1 }, //  3500     → الكافيه
    ],
  });
  if ("error" in placed) throw new Error(placed.error);
  return placed;
}

describe("placeOrderLocal", () => {
  it("splits one customer order into one order per register", () => {
    const placed = mixedOrder();
    expect(placed.orders).toHaveLength(2);
    expect(placed.orders.map((o) => o.station)).toEqual(["pastry", "cafe"]);
    // both halves carry the SAME customer-facing number
    expect(new Set(placed.orders.map((o) => o.group_no)).size).toBe(1);
    // …but each register keeps its own daily sequence
    expect(placed.orders.every((o) => o.station_seq >= 1)).toBe(true);
  });

  it("puts each line on its owning register with the right subtotal", () => {
    const placed = mixedOrder();
    const pastry = placed.orders.find((o) => o.station === "pastry")!;
    const cafe = placed.orders.find((o) => o.station === "cafe")!;
    expect(pastry.subtotal).toBe(500 * 2 + 1500);
    expect(cafe.subtotal).toBe(3500);
    expect(orderItems(pastry.id).map((i) => i.name_ar).sort()).toEqual(["دونات", "كيك شريحة مغلف"]);
    expect(orderItems(cafe.id).map((i) => i.name_ar)).toEqual(["ايس لاتيه"]);
  });

  it("resolves the table's floor automatically", () => {
    const placed = mixedOrder();
    // table «8» is seeded on floor 2
    expect(placed.orders.every((o) => o.floor === 2)).toBe(true);
  });

  it("rejects an order with no sellable line", () => {
    // «بقلاوة مشكّل» is seeded inactive (no price in the design yet)
    const res = placeOrderLocal({ channel: "qr", lines: [{ item_id: "baklava-mixed", qty: 1 }] });
    expect("error" in res).toBe(true);
  });
});

describe("payGroupLocal", () => {
  it("settles both registers from one payment and splits a fractional discount", () => {
    const placed = mixedOrder();
    const paid = payGroupLocal(placed.group_no, { discount: 1000, collectedBy: "cafe" });
    if ("error" in paid) throw new Error(paid.error);

    const gross = placed.orders.reduce((s, o) => s + o.subtotal, 0);
    expect(paid.total).toBe(gross - 1000);
    // no dinar created or lost between the two sets of books
    expect(paid.perStation.reduce((s, p) => s + p.net, 0)).toBe(paid.total);

    const group = orderGroup(placed.group_no);
    expect(group.every((o) => o.status === "paid")).toBe(true);
    // revenue stays with each register; only the cash location is the payer's
    expect(group.every((o) => o.collected_by === "cafe")).toBe(true);
  });

  it("refuses to settle the same ticket twice", () => {
    const placed = mixedOrder();
    payGroupLocal(placed.group_no, { collectedBy: "pastry" });
    expect(payGroupLocal(placed.group_no, { collectedBy: "pastry" })).toHaveProperty("error");
  });
});

describe("cancelGroupLocal", () => {
  it("cancels both halves of a ticket together", () => {
    const placed = mixedOrder();
    expect(cancelGroupLocal(placed.group_no).ok).toBe(true);
    expect(orderGroup(placed.group_no).every((o) => o.status === "cancelled")).toBe(true);
  });
});

describe("summaryLocal", () => {
  it("reports each register separately and the two add up to the shop", () => {
    resetLocalDb();
    const placed = mixedOrder();
    const paid = payGroupLocal(placed.group_no, { discount: 777, collectedBy: "pastry" });
    if ("error" in paid) throw new Error(paid.error);

    const day = placed.orders[0].business_day;
    const pastry = summaryLocal(day, day, "pastry")[0];
    const cafe = summaryLocal(day, day, "cafe")[0];
    const all = summaryLocal(day, day, null)[0];

    expect(pastry.sales + cafe.sales).toBe(all.sales);
    expect(all.sales).toBe(paid.total);
    // one customer order, however many registers it touched
    expect(all.orders_count).toBe(1);
  });
});
