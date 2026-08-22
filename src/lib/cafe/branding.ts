/**
 * Product identity, in one place.
 *
 * SHOP is the customer-facing business (the sign, the receipt, the menu).
 * SYSTEM is the software itself and its author — shown in the staff footer,
 * the help screen and the receipt's fine print, never in the customer's face.
 */

export const SHOP = {
  name_ar: "مخبز ومقهى هيل",
  name_en: "HAIL Bakery & Cafe",
  short_ar: "هيل",
  city_ar: "الرمادي — العراق",
} as const;

export const SYSTEM = {
  name_ar: "نظام الرؤية المتطور لإدارة الكافيهات والمخابز",
  short_ar: "نظام الرؤية المتطور",
  vendor_ar: "مركز الرؤية للابتكار الرقمي",
  vendor_en: "Roya Vision — Digital Innovation Center",
  site: "https://roya-vision.com",
  whatsapp: "https://wa.me/9647734446636",
  instagram: "https://instagram.com/thevision.center",
} as const;

/** «© 2026 مركز الرؤية للابتكار الرقمي» — year resolved by the caller so a
 *  server component never bakes a stale one into a static page. */
export const copyright = (year: number) => `© ${year} ${SYSTEM.vendor_ar}`;
