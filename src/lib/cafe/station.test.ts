import { describe, expect, it } from "vitest";
import { prorate, splitByStation, splitPayment } from "./station";
import { HAIL_MENU, ITEM_STATION, type StationSlug } from "./hail-menu";

describe("splitByStation", () => {
  it("routes a mixed order to both registers", () => {
    // بقلاوة/كيك → المعجنات، كافيه → الكافيه
    const lines = ["cake-slice", "donut", "ice-latte"];
    const out = splitByStation(lines, (id) => ITEM_STATION[id]);
    expect(out.map((b) => b.station)).toEqual(["pastry", "cafe"]);
    expect(out[0].lines).toEqual(["cake-slice", "donut"]);
    expect(out[1].lines).toEqual(["ice-latte"]);
  });

  it("keeps a single-station order as one bucket", () => {
    const out = splitByStation(["latte", "americano"], (id) => ITEM_STATION[id]);
    expect(out).toHaveLength(1);
    expect(out[0].station).toBe("cafe");
  });

  it("gives every catalog item exactly one station", () => {
    for (const c of HAIL_MENU) for (const i of c.items) expect(ITEM_STATION[i.id]).toBe(c.station);
  });

  it("has no duplicate item ids across the catalog", () => {
    const ids = HAIL_MENU.flatMap((c) => c.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has no duplicate item NAMES either", () => {
    // scripts/import-menu-images.mjs links a photo to its item by name_ar —
    // two items sharing a name would both be given the same picture. Three
    // crops are titled «موجيانا برازيلي» on the design board, so each name
    // carries its roaster.
    const names = HAIL_MENU.flatMap((c) => c.items.map((i) => i.name_ar));
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });
});

describe("prorate", () => {
  it("always sums back to the amount", () => {
    const cases: [number, number[]][] = [
      [1000, [3333, 6667]],
      [1, [1, 1, 1]],
      [7, [1, 1, 1]],
      [500, [1500, 1500, 1500]],
      [999, [1, 999999]],
      [250, [0, 0]],
      [0, [100, 200]],
      [12345, [7, 11, 13, 17]],
    ];
    for (const [amount, weights] of cases) {
      const parts = prorate(amount, weights);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(amount);
      expect(parts.every((p) => Number.isInteger(p))).toBe(true);
    }
  });

  it("never hands a bucket more than the amount", () => {
    for (const p of prorate(1000, [3333, 6667])) expect(p).toBeLessThanOrEqual(1000);
  });

  it("puts the whole amount on the first bucket when there is no weight", () => {
    expect(prorate(750, [0, 0, 0])).toEqual([750, 0, 0]);
  });

  it("is deterministic on ties", () => {
    expect(prorate(1, [500, 500])).toEqual(prorate(1, [500, 500]));
    expect(prorate(1, [500, 500]).reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe("splitPayment", () => {
  it("balances the books on a fractional discount", () => {
    // بقلاوة 3,333 (معجنات) + كافيه 6,667، خصم 1,000
    const s = splitPayment([3333, 6667], 1000, 0);
    expect(s.net.reduce((a, b) => a + b, 0)).toBe(s.total);
    expect(s.total).toBe(3333 + 6667 - 1000);
  });

  it("balances with both a discount and a surcharge", () => {
    const s = splitPayment([2500, 4000, 1500], 700, 333);
    expect(s.net.reduce((a, b) => a + b, 0)).toBe(s.total);
    expect(s.total).toBe(8000 - 700 + 333);
  });

  it("caps a discount larger than the bill instead of going negative", () => {
    const s = splitPayment([1000, 500], 9999, 0);
    expect(s.total).toBe(0);
    expect(s.net.reduce((a, b) => a + b, 0)).toBe(0);
    expect(s.net.every((n) => n >= 0)).toBe(true);
  });

  it("leaves each station's net non-negative for any discount up to the bill", () => {
    const subtotals = [4500, 500, 12000];
    for (let d = 0; d <= 17000; d += 137) {
      const s = splitPayment(subtotals, d, 0);
      expect(s.net.every((n) => n >= 0)).toBe(true);
      expect(s.net.reduce((a, b) => a + b, 0)).toBe(s.total);
    }
  });

  it("is a no-op split when nothing is discounted or added", () => {
    const s = splitPayment([3000, 7000]);
    expect(s.net).toEqual([3000, 7000]);
    expect(s.total).toBe(10000);
  });

  it("does not lose the surcharge on a zero bill", () => {
    const s = splitPayment([0, 0], 0, 2000);
    expect(s.net.reduce((a, b) => a + b, 0)).toBe(2000);
    expect(s.total).toBe(2000);
  });
});

describe("catalog sanity", () => {
  it("prices every active item", () => {
    for (const c of HAIL_MENU) {
      for (const i of c.items) {
        if (i.active === false) continue;
        expect(i.price, `${c.name_ar} → ${i.name_ar}`).toBeGreaterThan(0);
      }
    }
  });

  it("covers both stations", () => {
    const stations = new Set<StationSlug>(HAIL_MENU.map((c) => c.station));
    expect(stations).toEqual(new Set(["pastry", "cafe"]));
  });
});
