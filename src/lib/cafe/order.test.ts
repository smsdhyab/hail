import { describe, expect, it } from "vitest";
import { formatQty, lineTotal, orderSubtotal, qtyStep, roundQty, roundTicket } from "./order";

describe("البيع بالوزن", () => {
  it("٣٥٠ غم بسعر ٢٥٬٠٠٠ للكيلو = ٨٬٧٥٠", () => {
    expect(lineTotal(25000, 0.35, "weight")).toBe(8750);
  });

  it("السطر دقيق بلا تقريب — التقريب على الإجمالي وحده", () => {
    expect(lineTotal(15000, 0.04, "weight")).toBe(600); // لا 500
    expect(lineTotal(25500, 0.333, "weight")).toBe(8492);
    expect(lineTotal(25000, 0.35, "weight")).toBe(8750);
  });

  it("إجمالي التذكرة يُقرَّب إلى أقرب ٢٥٠", () => {
    expect(roundTicket(600)).toBe(500);
    expect(roundTicket(3750)).toBe(3750);
    expect(roundTicket(8492)).toBe(8500);
    expect(roundTicket(4375)).toBe(4500);
    expect(roundTicket(0)).toBe(0);
  });

  it("مبلغ ضئيل لا يخرج مجاناً بالتقريب", () => {
    expect(roundTicket(25)).toBe(250);
    expect(roundTicket(125)).toBe(250);
  });

  it("التقريب مرة واحدة يخسر أقلّ من التقريب سطراً سطراً", () => {
    const qs = [0.04, 0.12, 0.09];
    const lines = qs.map((q) => lineTotal(15000, q, "weight"));
    expect(lines).toEqual([600, 1800, 1350]);
    expect(roundTicket(lines.reduce((a, b) => a + b, 0))).toBe(3750);
    // لو قُرّب كل سطر وحده: 500 + 1750 + 1250 = 3500 — أي ٢٥٠ أقلّ
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
