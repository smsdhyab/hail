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

/**
 * How each order channel reads on screen and on the ticket.
 *
 * There used to be four separate copies of this map (cashier queue, dashboard,
 * and both bots) which drifted — adding a channel meant remembering all four.
 * The bots keep their own copy because they run on Deno/Node outside the app
 * bundle, but everything inside the app imports this one.
 */
export const CHANNEL_AR: Record<string, string> = {
  qr: "موبايل QR",
  kiosk: "لوحي",
  cashier: "كاشير",
  delivery: "توصيل",
} as const;

export const channelName = (c: string) => CHANNEL_AR[c] ?? c;

/**
 * نطاق المحل.
 *
 * النظام يبني روابطه من ترويسة الطلب فيتبع النطاق الذي يُفتح عليه — وهذا ما
 * جعل نقله من `workers.dev` إلى `hail.cafe` يمسّ ثلاثة مواضع لا ثلاثين.
 * وهذه الثابتة لما لا ترويسة له: قيمة احتياطية، ونصّ يُعرض للمنصِّب، وتحويل
 * الرابط القديم. مكان واحد يُغيَّر إن تغيّر النطاق ثانيةً.
 */
export const SITE_DOMAIN = "hail.cafe";
export const SITE_URL = `https://${SITE_DOMAIN}`;

/** التوصيل داخل الرمادي فقط — يظهر أعلى صفحة الطلب. */
export const DELIVERY_AREA_AR = "التوصيل متاح داخل مدينة الرمادي";
