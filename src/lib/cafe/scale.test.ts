import { describe, expect, it } from "vitest";
import { parseScaleBarcode } from "./scale";

describe("parseScaleBarcode", () => {
  it("يفكّ باركود ميزان بوزن مضمّن إلى PLU ووزن بالكيلو", () => {
    expect(parseScaleBarcode("2250004002656")).toEqual({ plu: 50004, kg: 0.265 });
    expect(parseScaleBarcode("2250007000406")).toEqual({ plu: 50007, kg: 0.04 });
  });
  it("يتجاهل الفراغات وغير الأرقام", () => {
    expect(parseScaleBarcode("22 50004 00265 6")).toEqual({ plu: 50004, kg: 0.265 });
  });
  it("يرفض ما ليس باركود ميزان", () => {
    expect(parseScaleBarcode("123456789012")).toBeNull(); // ١٢ خانة
    expect(parseScaleBarcode("1234567890123")).toBeNull(); // بادئة ليست 2
    expect(parseScaleBarcode("HAIL-CARD-01")).toBeNull(); // بطاقة ولاء
    expect(parseScaleBarcode("2250004000006")).toBeNull(); // وزن صفر
  });
});
