import { useMemo, useReducer } from "react";
import { lineTotal, qtyMin, qtyStep, roundQty, type SoldBy } from "@/lib/cafe/order";

/** Shared client cart (المنيو التفاعلي). Server recomputes all prices on submit. */
export type CartLine = {
  key: string;
  itemId: string;
  name: string;
  variantId: string | null;
  flavor: string | null;
  /** سعر القطعة — أو سعر الكيلو حين soldBy = "weight" */
  unitPrice: number;
  qty: number;
  soldBy: SoldBy;
};
type Cart = Record<string, CartLine>;
type Action =
  | { type: "add"; line: Omit<CartLine, "qty" | "soldBy"> & { soldBy?: SoldBy; qty?: number } }
  | { type: "inc"; key: string }
  | { type: "dec"; key: string }
  | { type: "setQty"; key: string; qty: number }
  | { type: "clear" };

function reducer(state: Cart, action: Action): Cart {
  switch (action.type) {
    case "add": {
      const ex = state[action.line.key];
      const soldBy = action.line.soldBy ?? "piece";
      // إضافة صنف موزون بلا وزن محدّد تعني خطوة واحدة (ربع كيلو)
      const add = action.line.qty ?? qtyStep(soldBy);
      const qty = roundQty((ex?.qty ?? 0) + add, soldBy);
      return { ...state, [action.line.key]: { ...action.line, soldBy, qty } };
    }
    case "inc": {
      const l = state[action.key];
      return l ? { ...state, [action.key]: { ...l, qty: roundQty(l.qty + qtyStep(l.soldBy), l.soldBy) } } : state;
    }
    case "dec": {
      const l = state[action.key];
      if (!l) return state;
      const next = roundQty(l.qty - qtyStep(l.soldBy), l.soldBy);
      if (next < qtyMin(l.soldBy)) {
        const n = { ...state };
        delete n[action.key];
        return n;
      }
      return { ...state, [action.key]: { ...l, qty: next } };
    }
    case "setQty": {
      const l = state[action.key];
      if (!l) return state;
      const qty = roundQty(Math.max(0, action.qty), l.soldBy);
      if (qty < qtyMin(l.soldBy)) {
        const n = { ...state };
        delete n[action.key];
        return n;
      }
      return { ...state, [action.key]: { ...l, qty } };
    }
    case "clear":
      return {};
  }
}

export function useCart() {
  const [cart, dispatch] = useReducer(reducer, {});
  const lines = useMemo(() => Object.values(cart), [cart]);
  const total = useMemo(() => lines.reduce((s, l) => s + lineTotal(l.unitPrice, l.qty, l.soldBy), 0), [lines]);
  // بيعة بالوزن تُعدّ صنفاً واحداً في العدّاد — ٠٫٣٥ لا معنى لها كعدد أصناف
  const count = useMemo(() => lines.reduce((s, l) => s + (l.soldBy === "weight" ? 1 : l.qty), 0), [lines]);
  return { lines, total, count, dispatch };
}
