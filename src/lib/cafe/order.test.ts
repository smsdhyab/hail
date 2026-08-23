import { describe, expect, it } from "vitest";
import { formatQty, lineTotal, orderSubtotal, qtyStep, roundQty } from "./order";

describe("البيع بالوزن", () => {
  it("٣٥٠ غم بسعر ٢٥٬٠٠٠ للكيلو = ٨٬٧٥٠", () => {
    expect(lineTotal(25000, 0.35, "weight")).toBe(8750);
  });

  it("الموزون يُقرَّب إلى أقرب ٢٥٠ — أصغر فئة عراقية", () => {
    expect(lineTotal(25500, 0.333, "weight")).toBe(8500); // 8491.5 لا تُدفع
    expect(lineTotal(25000, 0.999, "weight")).toBe(25000); // 24975
    expect(lineTotal(25000, 0.35, "weight")).toBe(8750); // مضبوط أصلاً
  });

  it("لا يخرج وزن ضئيل مجاناً بالتقريب", () => {
    expect(lineTotal(25000, 0.001, "weight")).toBe(250); // 25 → أدنى فئة
    expect(lineTotal(0, 0.5, "weight")).toBe(0); // صنف بلا سعر يبقى صفراً
  });

  it("أسطر القطعة لا تُقرَّب — سعر ١٬٣٠٠ يبقى ١٬٣٠٠", () => {
    expect(lineTotal(1300, 2)).toBe(2600);
  });

  it("أصناف القطعة لم تتأثر", () => {
    expect(lineTotal(1500, 2)).toBe(3000);
    expect(lineTotal(2500, 1)).toBe(2500);
    expect(lineTotal(2500, 0)).toBe(0);
  });

  it("لا سعر سالباً ولا كمية سالبة", () => {
    expect(lineTotal(-5000, 2, "weight")).toBe(0);
    expect(lineTotal(5000, -2, "weight")).toBe(0);
  });

  it("مجموع سلة مختلطة = وزن + قطعة", () => {
    expect(orderSubtotal([{ unitPrice: 25000, qty: 0.35, soldBy: "weight" }, { unitPrice: 1500, qty: 2 }])).toBe(11750);
  });

  it("الخطوة ربع كيلو للموزون وقطعة لغيره", () => {
    expect(qtyStep("weight")).toBe(0.25);
    expect(qtyStep("piece")).toBe(1);
  });

  it("الكمية تُثبَّت على ٣ منازل فلا يتسرّب خطأ الفاصلة العائمة", () => {
    expect(roundQty(0.1 + 0.2, "weight")).toBe(0.3); // 0.30000000000000004
    expect(roundQty(2.7, "piece")).toBe(3);
  });

  it("العرض: غرامات دون الكيلو وكيلوات فوقه", () => {
    expect(formatQty(0.35, "weight")).toBe("350 غم");
    expect(formatQty(1, "weight")).toBe("1 كغم");
    expect(formatQty(1.5, "weight")).toBe("1.5 كغم");
    expect(formatQty(2, "piece")).toBe("2");
  });
});
