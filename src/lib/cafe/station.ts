import { STATIONS, type StationSlug } from "./hail-menu";

/**
 * Order routing + the money split between the two registers.
 *
 * The shop runs ONE system with TWO financially separate registers. A customer
 * places one order and pays ONCE; the order is split into one order per station
 * (routing), and the single payment is split back onto each station's books
 * (accounting). Pure functions only — no DB, no React — so the split can be
 * unit-tested and reused by the server action, the receipt and the reports.
 */

/** Group lines by the station that owns them, in STATIONS order. */
export function splitByStation<T>(
  lines: T[],
  stationOf: (line: T) => StationSlug,
): { station: StationSlug; lines: T[] }[] {
  const buckets = new Map<StationSlug, T[]>();
  for (const line of lines) {
    const s = stationOf(line);
    const arr = buckets.get(s);
    if (arr) arr.push(line);
    else buckets.set(s, [line]);
  }
  return STATIONS.filter((s) => buckets.has(s.slug)).map((s) => ({
    station: s.slug,
    lines: buckets.get(s.slug)!,
  }));
}

/**
 * Split `amount` across `weights` in whole dinars so the parts sum EXACTLY to
 * `amount` — largest-remainder (Hare–Niemeyer). Ties break toward the heavier
 * weight, then the earlier index, so the result is deterministic.
 *
 * With no weight at all (every subtotal zero) the whole amount lands on the
 * first bucket rather than vanishing.
 */
export function prorate(amount: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  if (amount < 0) return prorate(-amount, weights).map((v) => -v);
  if (amount === 0) return weights.map(() => 0);

  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return weights.map((_, i) => (i === 0 ? amount : 0));

  const exact = weights.map((w) => (amount * w) / total);
  const out = exact.map(Math.floor);
  let rest = amount - out.reduce((a, b) => a + b, 0);

  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e), w: weights[i] }))
    .sort((a, b) => b.frac - a.frac || b.w - a.w || a.i - b.i);

  for (let k = 0; rest > 0; k++, rest--) out[order[k].i]++;
  return out;
}

export type PaymentSplit = {
  /** per-station discount share (same order as `subtotals`) */
  discount: number[];
  /** per-station extra/surcharge share */
  extra: number[];
  /** per-station net = subtotal − discount + extra */
  net: number[];
  /** what the customer actually hands over — always equals sum(net) */
  total: number;
};

/**
 * One payment → each station's books. The discount and the surcharge are
 * prorated by each station's subtotal, so:
 *
 *     sum(net) === max(0, sum(subtotals) − discount + extra)
 *
 * holds exactly, with no dinar created or lost to rounding. A discount larger
 * than the bill is capped at the bill (a payment never goes negative).
 */
export function splitPayment(subtotals: number[], discount = 0, extra = 0): PaymentSplit {
  const gross = subtotals.reduce((a, b) => a + b, 0);
  const disc = Math.min(Math.max(0, Math.round(discount)), gross);
  const add = Math.max(0, Math.round(extra));

  const discountShares = prorate(disc, subtotals);
  // A surcharge on a zero-subtotal bill still has to land somewhere: weight it
  // by subtotal when there is one, else let prorate drop it on the first bucket.
  const extraShares = prorate(add, subtotals);

  const net = subtotals.map((s, i) => s - discountShares[i] + extraShares[i]);
  return { discount: discountShares, extra: extraShares, net, total: gross - disc + add };
}
