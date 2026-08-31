/**
 * The HAIL catalog — the single source of truth for stations, categories and
 * items. Transcribed from the owner's Adobe XD design file (design/xd/).
 *
 * Everything else derives from this: DEMO_MENU (demo-menu.ts), the local JSON
 * store seed (local-db.ts) and the SQL seed (scripts/generate-menu-seed.mjs →
 * supabase/migrations/0022_hail_menu.sql). Edit here, regenerate, never fork.
 *
 * A category belongs to exactly ONE station; an item inherits its category's
 * station. That inheritance is the whole order-routing mechanism: a mixed
 * order splits into one order per station because its lines resolve to
 * different stations. See splitByStation() in station.ts.
 */

/** Cash-register stations. Separate books, one system. */
export type StationSlug = "pastry" | "cafe";

export const STATIONS: { slug: StationSlug; name_ar: string; short_ar: string; emoji: string; sort: number }[] = [
  { slug: "pastry", name_ar: "المعجنات والمخبوزات", short_ar: "المعجنات", emoji: "🥐", sort: 1 },
  { slug: "cafe", name_ar: "الكافيه", short_ar: "الكافيه", emoji: "☕", sort: 2 },
];

export const stationName = (slug: StationSlug | null | undefined) =>
  STATIONS.find((s) => s.slug === slug)?.name_ar ?? "—";

/**
 * تسمية الطابق.
 *
 * كانت تحمل القسم أيضاً («الأرضي — المعجنات») حين كان كل طابق قسماً وله طابعته.
 * ثم صار المحل يعمل في الأرضي وحده ويبيع فيه القسمين معاً، فسقط الربط: الكافيه
 * يُباع في الأرضي، وتسمية تقول غير ذلك تُضلّل من يقرؤها.
 *
 * الطابق بقي وصفاً للمكان — يُطبع على وصل الطلب ليعرف العامل أين يوصّله.
 */
export const floorLabel = (floor: number): string =>
  floor === 1 ? "الطابق الأرضي" : floor === 2 ? "الطابق العلوي" : `الطابق ${floor}`;

export type HailItem = {
  /** stable slug — also the id in demo/local mode */
  id: string;
  name_ar: string;
  price: number;
  /** priced sizes, e.g. [["صغير", 2500], ["وسط", 3500]] */
  variants?: [string, number][];
  /** free same-price options picked at the counter */
  flavors?: string[];
  /** false → seeded but hidden from the menu (price not set yet) */
  active?: boolean;
  description?: string;
  /** «weight» → السعر أعلاه سعر الكيلو، والكاشير يُدخل الوزن. يُضبط من «إدارة
   *  المنيو» لا من هنا: أي معجّنة قد تتحوّل بين القطعة والوزن حسب الموسم. */
  sold_by?: "piece" | "weight";
  unit_label?: string;
};

export type HailCategory = {
  slug: string;
  name_ar: string;
  station: StationSlug;
  items: HailItem[];
};

// ── المعجنات والمخبوزات ─────────────────────────────────────────────────────
const PASTRY: HailCategory[] = [
  {
    slug: "bread",
    name_ar: "الخبز",
    station: "pastry",
    items: [
      { id: "almond-bread", name_ar: "خبز اللوز", price: 7000 },
      { id: "corn-samoon", name_ar: "صمون الذرة", price: 2500 },
      { id: "brown-samoon", name_ar: "صمون اسمر", price: 2000 },
    ],
  },
  {
    slug: "cakes",
    name_ar: "الكعك",
    station: "pastry",
    items: [
      { id: "choc-chunk-cookie", name_ar: "كوكيز قطعة شوكولاتة", price: 2000 },
      { id: "wrapped-cookie", name_ar: "كوكيز مغلف", price: 1500 },
      { id: "kaab-ghazal", name_ar: "كعب غزال", price: 1000 },
      { id: "fruit-baqsam", name_ar: "بقصم فواكه", price: 500 },
    ],
  },
  {
    slug: "cake",
    name_ar: "الكيك",
    station: "pastry",
    items: [
      { id: "choc-muffin", name_ar: "مافن شوكولاتة مغلف", price: 500 },
      { id: "cake-slice", name_ar: "كيك شريحة مغلف", price: 500 },
      { id: "danish", name_ar: "دنش", price: 500 },
    ],
  },
  {
    slug: "chocolate",
    name_ar: "الشوكولاتة",
    station: "pastry",
    items: [
      { id: "nutella-belgian-white", name_ar: "نستلة بلجيكي ابيض", price: 1000 },
      { id: "nutella-belgian-nut", name_ar: "نستلة بلجيكي جوزي", price: 1000 },
      { id: "formesil-pistachio", name_ar: "كرات فورمسيل بستاشيو", price: 500 },
      { id: "silicone-pistachio", name_ar: "كرات سلكون بستاشيو", price: 500 },
      { id: "silicone-lotus", name_ar: "كرات سلكون لوتس", price: 500 },
      { id: "silicone-nutella", name_ar: "كرات سلكون نوتيلا", price: 500 },
      { id: "silicone-dark", name_ar: "كرات سلكون دارك", price: 500 },
      { id: "drift-nut", name_ar: "دريف جوزي", price: 500 },
    ],
  },
  {
    slug: "turkish-delight",
    name_ar: "الحلقوم",
    station: "pastry",
    items: [
      { id: "delight-mastic", name_ar: "حلقوم مستكي", price: 500 },
      { id: "delight-nuts", name_ar: "حلقوم مكسرات", price: 500 },
    ],
  },
  {
    slug: "pastries",
    name_ar: "المعجنات",
    station: "pastry",
    items: [
      { id: "donut", name_ar: "دونات", price: 1500 },
      // Paired in the «طعم متوازن» combo but absent from the design's price
      // list — price needs the owner's confirmation.
      { id: "cinnamon-roll", name_ar: "سينابون رول", price: 2000 },
    ],
  },
  {
    slug: "baklava",
    name_ar: "البقلاوة",
    station: "pastry",
    items: [
      // The design sheet repeats «دونات 1500» here (a copy-paste placeholder),
      // so there is no real baklava line to transcribe. Seeded inactive.
      { id: "baklava-mixed", name_ar: "بقلاوة مشكّل", price: 0, active: false },
    ],
  },
  {
    slug: "savory",
    name_ar: "الموالح",
    station: "pastry",
    items: [
      { id: "savory-zaatar", name_ar: "اصابع موالح زعتر", price: 500 },
      { id: "savory-nigella", name_ar: "اصابع موالح حبة سودة", price: 500 },
    ],
  },
];

// ── الكافيه ─────────────────────────────────────────────────────────────────
const CAFE: HailCategory[] = [
  {
    slug: "hot-drinks",
    name_ar: "المشروبات الساخنة",
    station: "cafe",
    items: [
      { id: "latte", name_ar: "لاتيه", price: 3500 },
      { id: "caramel-latte", name_ar: "كراميل لاتيه", price: 4000 },
      { id: "vanilla-latte", name_ar: "فانيلا لاتيه", price: 4000 },
      { id: "hazelnut-latte", name_ar: "هيزلنت «بندق» لاتيه", price: 4000 },
      { id: "spanish-latte", name_ar: "سبانش لاتيه", price: 4000 },
      { id: "espresso-single", name_ar: "اسبريسو سنكل", price: 2500 },
      { id: "espresso-double", name_ar: "اسبريسو دبل", price: 3000 },
      { id: "flat-white", name_ar: "فلات وايت", price: 3500 },
      { id: "cortado", name_ar: "كورتادو", price: 3500 },
      { id: "cappuccino", name_ar: "كابتشينو", price: 4000 },
      { id: "nescafe", name_ar: "نيسكافيه", price: 3000 },
      { id: "americano", name_ar: "امريكانو", price: 3500 },
      { id: "espresso-macchiato", name_ar: "اسبريسو مكياتو", price: 3000 },
      { id: "turkish-single", name_ar: "قهوه تركيه سنقل", price: 2500 },
      { id: "turkish-double", name_ar: "قهوه تركيه دبل", price: 4000 },
      { id: "hot-chocolate", name_ar: "هوت شوكليت", price: 3500 },
      { id: "dark-mocha", name_ar: "دارك موكا", price: 4000 },
      { id: "white-mocha", name_ar: "وايت موكا", price: 4000 },
      { id: "karak-tea", name_ar: "شاي كرك", price: 3000 },
      { id: "lemon-tea", name_ar: "شاي ليمون", price: 2000 },
    ],
  },
  {
    slug: "cold-drinks",
    name_ar: "المشروبات الباردة",
    station: "cafe",
    items: [
      { id: "ice-latte", name_ar: "ايس لاتيه", price: 3500 },
      { id: "ice-caramel-latte", name_ar: "ايس كراميل لاتيه", price: 4000 },
      { id: "ice-vanilla-latte", name_ar: "ايس فانيلا لاتيه", price: 4000 },
      { id: "ice-hazelnut-latte", name_ar: "ايس هيزلنت لاتيه", price: 4000 },
      { id: "ice-spanish-latte", name_ar: "ايس سبانش لاتيه", price: 4000 },
      { id: "ice-pistachio-latte", name_ar: "ايس بستاشيو لاتيه", price: 4000 },
      { id: "ice-americano", name_ar: "ايس امريكانو", price: 4000 },
      { id: "ice-caramel-macchiato", name_ar: "ايس كراميل مكياتو", price: 4000 },
      { id: "ice-dark-mocha", name_ar: "ايس دارك موكا", price: 4500 },
      { id: "ice-white-mocha", name_ar: "ايس وايت موكا", price: 4500 },
      { id: "ice-chocolate", name_ar: "ايس تشوكليت", price: 4000 },
      { id: "caramel-frappuccino", name_ar: "كراميل فرابتشينو", price: 5000 },
      { id: "mochaccino-dark", name_ar: "موكاتشينو دارك", price: 5000 },
      { id: "mochaccino-white", name_ar: "موكاتشينو وايت", price: 5000 },
      { id: "frozen-shake-choc", name_ar: "فروزن شيك تشوكلت", price: 5500 },
      { id: "frozen-shake", name_ar: "فروزن شيك", price: 5500 },
    ],
  },
  {
    slug: "mojito",
    name_ar: "الموهيتو",
    station: "cafe",
    items: [
      { id: "mojito-pomegranate", name_ar: "موهيتو رمان", price: 4000 },
      { id: "mojito-strawberry", name_ar: "موهيتو فراوله", price: 4000 },
      { id: "mojito-green-wave", name_ar: "موهيتو جرين ويف", price: 4000 },
      { id: "mojito-peach", name_ar: "موهيتو خوخ", price: 4000 },
      { id: "mojito-berry", name_ar: "موهيتو توت", price: 4000 },
      { id: "mojito-blue-passion", name_ar: "موهيتو بلو باشن", price: 4000 },
      { id: "mojito-blue-wave", name_ar: "موهيتو بلو ويف", price: 4000 },
      { id: "ice-tea-lemon", name_ar: "ايس تي ليمون", price: 4000 },
      { id: "ice-tea-peach", name_ar: "ايس تي خوخ", price: 4000 },
      { id: "ice-tea-kiwi", name_ar: "ايس تي كيوي", price: 4000 },
    ],
  },
  {
    slug: "smoothie",
    name_ar: "السموذي",
    station: "cafe",
    items: [
      { id: "smoothie-mango", name_ar: "سموذي مانجو", price: 5000 },
      { id: "smoothie-pineapple", name_ar: "سموذي اناناس", price: 5000 },
      { id: "smoothie-strawberry", name_ar: "سموذي فراوله", price: 5000 },
      { id: "smoothie-berry", name_ar: "سموذي توت", price: 5000 },
      { id: "smoothie-passion", name_ar: "سموذي باشن فروت", price: 5000 },
    ],
  },
  {
    // Retail bags of specialty beans, transcribed from the two design boards
    // (design/xd/board-2-long.webp and board-1-long.webp).
    //
    // The split is BY BOARD, not by processing method: the infusion board also
    // carries a washed lot (صواع) and three anaerobic-soak ones (روفيرا،
    // ارسيلا، لابراديرا). Deriving the split from the process badge would put
    // four crops on the wrong page.
    //
    // Every board price reads «00.000 IQD», so all are seeded INACTIVE at 0.
    // Price them in «إدارة المنيو» and they appear on the menu.
    //
    // Several crops share a title — «موجيانا برازيلي» appears three times and
    // «تروبيكال» three times — so each name carries its roaster. Two items with
    // the same name_ar would also collide in scripts/import-menu-images.mjs.
    slug: "crops-dried",
    name_ar: "المحاصيل المجففة",
    station: "cafe",
    items: [
      { id: "crop-sidamo-bombe", name_ar: "سيدامو بومبي اثيوبي", price: 0, active: false, description: "محمصة سويل · معالجة مجففة · توت اسود، مانجو، ياسمين" },
      { id: "crop-el-salvador", name_ar: "مارتن — سلفادور", price: 0, active: false, description: "محمصة ممتد · معالجة مجففة · شوكلاته، بندق، جوز، كراميل، فراولة" },
      { id: "crop-shalsheli", name_ar: "شلشلي", price: 0, active: false, description: "محمصة اكتوبر · معالجة مجففة · كرز، خوخ، ياسمين" },
      { id: "crop-mogiana-coda", name_ar: "موجيانا برازيلي — كودا", price: 0, active: false, description: "محمصة كودا · معالجة مجففة · الجوز المحمص، حلاوة قصب السكر" },
      { id: "crop-costa-rica", name_ar: "ريفنسيلا نافينتي — كوستريكي", price: 0, active: false, description: "محمصة دريب اون · معالجة مجففة · الفاكهة الحلوة، البابايا، الفواكه الاستوائية، الاناناس" },
      { id: "crop-mogiana-breehant", name_ar: "موجيانا برازيلي — بريهانت", price: 0, active: false, description: "محمصة بريهانت · معالجة مجففة · فانيلا، كراميل، عسل، بندق" },
      { id: "crop-roaster-project", name_ar: "البيلا اثيوبيا — روستر", price: 0, active: false, description: "محمصة روستر · معالجة مجففة · توت ازرق، فراولة، خوخ، عطريه" },
      { id: "crop-de-frutos", name_ar: "دي فروتس كولمبي كولينا", price: 0, active: false, description: "محمصة نيردز · معالجة مجففة · فراولة، حلاوة، فواكه مجففة" },
      { id: "crop-mogiana-nerds", name_ar: "موجيانا برازيلي — نيردز", price: 0, active: false, description: "محمصة نيردز · معالجة مجففة · مكسرات، كاكو، كراميل" },
      { id: "crop-gomez", name_ar: "قوميز — كولمبي", price: 0, active: false, description: "محمصة اولالا · معالجة مجففة · تفاح، فاكهية، حلاوة واضحة" },
      { id: "crop-exit-13", name_ar: "مخرج 13 — كواتيمالا واثيوبي واندنوسي", price: 0, active: false, description: "محمصة سلالات · معالجة مجففة · كاكو فاخر، عبق الحطب، العود" },
    ],
  },
  {
    slug: "crops-infusion",
    name_ar: "محاصيل انفيوجن",
    station: "cafe",
    items: [
      { id: "crop-colombia-olala", name_ar: "كولمبيا كوكنت — اولالا", price: 0, active: false, description: "محمصة اولالا · معالجة انفيوجن · كوكنت، جوز الهند" },
      { id: "crop-brazil-vimto", name_ar: "برازيل فيمتو", price: 0, active: false, description: "محمصة دريب اون · معالجة انفيوجن · فيمتو" },
      { id: "crop-kof-tropical", name_ar: "تروبيكال — كوف", price: 0, active: false, description: "محمصة كوف · معالجة انفيوز · فواكه استوائية فاخرة" },
      { id: "crop-yemen-indonesia", name_ar: "مزيج يمني واندنوسي", price: 0, active: false, description: "محمصة بيت التحميص · معالجات عديدة · تيراميسو، شوكلاتة داكنة، كاكو" },
      { id: "crop-mirinda", name_ar: "ميرندا", price: 0, active: false, description: "محمصة اويو فاخرة · معالجة انفيوجن · ميرندا، يوسفي، حلاوة، عطري" },
      { id: "crop-tropical-oyo", name_ar: "تروبيكال — اويو", price: 0, active: false, description: "محمصة اويو فاخرة · معالجة انفيوجن · اناناس، حلاوة عسلية" },
      { id: "crop-luka", name_ar: "مزيج لوكا", price: 0, active: false, description: "محمصة اويو فاخرة · معالجة انفيوز · عسل، حلاوة كراميل" },
      { id: "crop-colombia-sawa", name_ar: "كولمبي — صواع", price: 0, active: false, description: "محمصة صواع · معالجة مغسولة · مشمش، توت اسود، زبيب احمر، كراميل" },
      { id: "crop-marvina", name_ar: "مارفينا كوكنت", price: 0, active: false, description: "محمصة سويل مارفينا فاخرة · معالجة انفيوجن · كوكنت جوز الهند" },
      { id: "crop-la-pradera", name_ar: "تروبيكال — لابراديرا", price: 0, active: false, description: "محمصة سويل لابراديرا فاخرة · معالجة تنقيع لا هوائي · عسلية، حلاوة" },
      { id: "crop-rovira", name_ar: "روفيرا", price: 0, active: false, description: "محمصة سويل فاخرة · معالجة تنقيع لا هوائي · توت اسود، عنب، نبيذ" },
      { id: "crop-arsila", name_ar: "ارسيلا", price: 0, active: false, description: "محمصة سويل فاخرة · معالجة تنقيع لا هوائي · موز، حلاوة" },
    ],
  },
];

export const HAIL_MENU: HailCategory[] = [...PASTRY, ...CAFE];

/**
 * «عروض اليوم» — the drink + pastry pairings from the design's «محتار شنو
 * تطلب؟ خلينا نساعدك» screen.
 *
 * A combo spans BOTH registers, so ordering one still splits normally and each
 * station books its own list price. The gap between the combo price and the sum
 * of those list prices is recorded once, centrally, as orders.promo_adjust —
 * the shop carries the marketing decision, not the two sets of books.
 *
 * The price is read from the database at order time (combo_public), never from
 * the client, exactly like item prices.
 */
export const HAIL_COMBOS: { slug: string; title_ar: string; price: number; items: string[] }[] = [
  { slug: "combo-spanish-cake", title_ar: "سبانيش لاتيه ايس + كيك", price: 6000, items: ["ice-spanish-latte", "cake-slice"] },
  { slug: "combo-icechoc-donut", title_ar: "ايس تشوكليت + دونات", price: 7000, items: ["ice-chocolate", "donut"] },
  { slug: "combo-mojito-cinnamon", title_ar: "موهيتو بلو باشن + سينابون رول", price: 8000, items: ["mojito-blue-passion", "cinnamon-roll"] },
  { slug: "combo-americano-cookies", title_ar: "ايس امريكانو + كوكيز", price: 9000, items: ["ice-americano", "choc-chunk-cookie"] },
];

/** item id → its station, resolved through the owning category. */
export const ITEM_STATION: Record<string, StationSlug> = Object.fromEntries(
  HAIL_MENU.flatMap((c) => c.items.map((i) => [i.id, c.station] as const)),
);
