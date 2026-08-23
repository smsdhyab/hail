/**
 * Pure cart/order math for client-side display. The server (place_order rpc) is
 * the authority — it recomputes every price from the DB — so these are for the
 * live cart total only, never trusted for billing.
 */

/** كيف يُباع الصنف: بالقطعة أو بالوزن (والسعر حينها سعر الكيلو). */
export type SoldBy = "piece" | "weight";

export type CartLine = { unitPrice: number; qty: number; soldBy?: SoldBy };

/**
 * أصغر فئة نقدية عراقية متداولة. لا وجود لـ٢٬٣٥٦ ديناراً: المبالغ تمشي على
 * ٢٥٠ · ٥٠٠ · ٧٥٠ · ١٬٠٠٠ …
 */
export const IQD_STEP = 250;

/** أقرب مضاعف لـ٢٥٠. */
export function roundToStep(amount: number): number {
  return Math.round(amount / IQD_STEP) * IQD_STEP;
}

/**
 * مجموع السطر — نسخة طبق الأصل من العمود المحسوب في قاعدة البيانات
 * (`order_items.line_total`). أي اختلاف بينهما يعني رقماً في السلة غير الذي
 * يُطبع على الوصل.
 *
 * `qty` كسرية للأصناف الموزونة (٠٫٣٥ = ٣٥٠ غم) وصحيحة لغيرها، و`unitPrice`
 * صحيح دائماً — سعر القطعة أو سعر الكيلو.
 *
 * الموزون يُقرَّب إلى أقرب ٢٥٠ لأن ناتج الضرب مبلغ لا يمكن دفعه غالباً.
 * وأسطر القطعة تُترك بالضبط: أسعارها مضبوطة على ٢٥٠ أصلاً، وتقريبها
 * «احتياطاً» يخصم من سعر مثل ١٬٣٠٠ مئة دينار في كل بيعة بصمت.
 */
export function lineTotal(unitPrice: number, qty: number, soldBy: SoldBy = "piece"): number {
  const raw = Math.max(0, Math.round(unitPrice)) * Math.max(0, qty);
  if (soldBy !== "weight") return Math.round(raw);
  if (raw <= 0) return 0;
  // وزن ضئيل جداً يُقرَّب إلى صفر — فيخرج الصنف مجاناً
  return Math.max(IQD_STEP, roundToStep(raw));
}

export function orderSubtotal(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + lineTotal(l.unitPrice, l.qty, l.soldBy), 0);
}

/** Subtotal minus a discount, floored at zero. */
export function orderTotal(lines: CartLine[], discount = 0): number {
  return Math.max(0, orderSubtotal(lines) - Math.max(0, Math.round(discount)));
}

/** خطوة الزيادة/الإنقاص: ربع كيلو للموزون، قطعة لغيره. */
export const STEP_G = 250;
export function qtyStep(soldBy: SoldBy): number {
  return soldBy === "weight" ? STEP_G / 1000 : 1;
}

/** أصغر كمية تبقي السطر في السلة (غرام واحد للموزون، قطعة لغيره). */
export function qtyMin(soldBy: SoldBy): number {
  return soldBy === "weight" ? 0.001 : 1;
}

/** تُصحَّح إلى ٣ منازل حتى لا يتسرّب خطأ الفاصلة العائمة إلى قاعدة البيانات. */
export function roundQty(qty: number, soldBy: SoldBy): number {
  return soldBy === "weight" ? Math.round(qty * 1000) / 1000 : Math.round(qty);
}

/** «٣٥٠ غم» · «١٫٥ كغم» · «٢» — ما يُكتب بجانب الصنف في السلة والوصل. */
export function formatQty(qty: number, soldBy: SoldBy = "piece", unitLabel?: string | null): string {
  if (soldBy !== "weight") return String(Math.round(qty));
  const grams = Math.round(qty * 1000);
  if (grams < 1000) return `${grams} غم`;
  const kg = grams / 1000;
  return `${Number.isInteger(kg) ? kg : kg.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} ${unitLabel || "كغم"}`;
}
