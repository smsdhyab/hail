// Builds the ChatGPT image-generation prompts from the live catalog, so the
// prompt list and the menu can never drift apart.
//   node scripts/make-image-prompts.mjs   →  design/prompts-الصور.md
//
// Every prompt repeats the same identity block: one shop, one look. The items
// change; the background, lighting, framing and palette never do.
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { HAIL_MENU } from "../src/lib/cafe/hail-menu.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Arabic item name → a plain English description an image model understands. */
const EN = {
  "خبز اللوز": "an almond bread loaf, sliced almonds on top, dusted with powdered sugar",
  "صمون الذرة": "a golden corn bread roll (samoon), soft crumb, rustic crust",
  "صمون اسمر": "a brown whole-wheat bread roll (samoon), seeded crust",
  "كوكيز قطعة شوكولاتة": "a thick chocolate-chunk cookie, gooey centre, chunks visible",
  "كوكيز مغلف": "a round butter cookie in a clear cellophane wrapper",
  // NOT the Moroccan crescent — the Iraqi kaab el ghazal is a coconut macaroon.
  "كعب غزال": "two or three Iraqi coconut macaroons piled together, piped rounds with craggy ridged peaks, deep caramelised golden-brown crust, visible shredded coconut texture, crisp outside and soft inside",
  "بقصم فواكه": "a small crunchy fruit biscotti with candied fruit pieces",
  "مافن شوكولاتة مغلف": "a chocolate muffin in a paper cup, domed cracked top",
  "كيك شريحة مغلف": "a single slice of layered vanilla sponge cake with cream",
  "دنش": "a Danish pastry with a fruit-and-cream centre, flaky glazed layers",
  "نستلة بلجيكي ابيض": "a white Belgian chocolate praline, glossy dome",
  "نستلة بلجيكي جوزي": "a hazelnut Belgian chocolate praline, whole hazelnut on top",
  "كرات فورمسيل بستاشيو": "a pistachio truffle ball rolled in crushed pistachios",
  "كرات سلكون بستاشيو": "a pistachio-filled chocolate sphere, cracked open to show the filling",
  "كرات سلكون لوتس": "a caramelised-biscuit chocolate sphere with biscuit crumbs on top",
  "كرات سلكون نوتيلا": "a hazelnut-spread filled chocolate sphere, oozing centre",
  "كرات سلكون دارك": "a dark chocolate sphere with a glossy tempered shell",
  "دريف جوزي": "a walnut chocolate bark piece, thick and rustic",
  "حلقوم مستكي": "mastic Turkish delight cubes dusted with powdered sugar",
  "حلقوم مكسرات": "nut-filled Turkish delight, sliced to show pistachios inside",
  "دونات": "a glazed doughnut with chocolate drizzle and chopped nuts",
  "سينابون رول": "a cinnamon roll with cream-cheese icing, warm and spiralled",
  "اصابع موالح زعتر": "savoury zaatar breadsticks, thin and crisp",
  "اصابع موالح حبة سودة": "savoury nigella-seed breadsticks, thin and crisp",

  "لاتيه": "a hot latte in a ceramic cup, smooth microfoam and simple latte art",
  "كراميل لاتيه": "a hot caramel latte, caramel drizzle spiralled on the foam",
  "فانيلا لاتيه": "a hot vanilla latte, pale golden foam, vanilla pod resting beside",
  "هيزلنت «بندق» لاتيه": "a hot hazelnut latte, whole hazelnuts beside the cup",
  "سبانش لاتيه": "a hot Spanish latte, condensed-milk layers visible in a glass",
  "اسبريسو سنكل": "a single espresso shot in a small demitasse, thick crema",
  "اسبريسو دبل": "a double espresso in a wide demitasse, deep crema",
  "فلات وايت": "a flat white in a small ceramic cup, velvety thin foam",
  "كورتادو": "a cortado in a short clear glass, equal espresso and milk layers",
  "كابتشينو": "a cappuccino with a tall foam cap, light cocoa dusting",
  "نيسكافيه": "a creamy instant coffee in a ceramic mug, soft foam top",
  "امريكانو": "a hot americano in a clear glass, dark with a thin crema ring",
  "اسبريسو مكياتو": "an espresso macchiato, a single spoon of foam on the shot",
  "قهوه تركيه سنقل": "a single Turkish coffee in a small cup beside a copper pot",
  "قهوه تركيه دبل": "a double Turkish coffee in a cup with thick foam, copper pot behind",
  "هوت شوكليت": "a hot chocolate in a mug topped with whipped cream and cocoa",
  "دارك موكا": "a hot dark mocha, chocolate and espresso layers, cream on top",
  "وايت موكا": "a hot white mocha, pale cream layers, white chocolate curls",
  "شاي كرك": "karak chai in a small glass, milky spiced tea, cardamom pods beside",
  "شاي ليمون": "hot lemon tea in a clear glass with a lemon slice",

  "ايس لاتيه": "an iced latte in a tall glass, espresso swirling into cold milk over ice",
  "ايس كراميل لاتيه": "an iced caramel latte, caramel ribbons down the glass",
  "ايس فانيلا لاتيه": "an iced vanilla latte, pale layers over ice",
  "ايس هيزلنت لاتيه": "an iced hazelnut latte, hazelnuts scattered beside the glass",
  "ايس سبانش لاتيه": "an iced Spanish latte, sharp condensed-milk layers over ice",
  "ايس بستاشيو لاتيه": "an iced pistachio latte, soft green tint, crushed pistachios on top",
  "ايس امريكانو": "an iced americano, clear dark coffee over large ice cubes",
  "ايس كراميل مكياتو": "an iced caramel macchiato, distinct layers and caramel crosshatch",
  "ايس دارك موكا": "an iced dark mocha with whipped cream and chocolate drizzle",
  "ايس وايت موكا": "an iced white mocha with whipped cream and white chocolate curls",
  "ايس تشوكليت": "an iced chocolate drink, thick and dark, cream on top",
  "كراميل فرابتشينو": "a blended caramel frappuccino, whipped cream and caramel drizzle",
  "موكاتشينو دارك": "a blended dark mochaccino, cream swirl and cocoa dusting",
  "موكاتشينو وايت": "a blended white mochaccino, cream swirl and white chocolate shavings",
  "فروزن شيك تشوكلت": "a thick frozen chocolate shake in a tall glass, cream and chocolate shards",
  "فروزن شيك": "a thick frozen vanilla shake in a tall glass, tall cream swirl",

  "موهيتو رمان": "a pomegranate mojito, deep red, mint leaves and pomegranate seeds",
  "موهيتو فراوله": "a strawberry mojito, pink, fresh strawberry and mint",
  "موهيتو جرين ويف": "a bright green mojito with mint leaves and a lime wheel",
  "موهيتو خوخ": "a peach mojito, warm orange tone, peach slice and mint",
  "موهيتو توت": "a mixed-berry mojito, deep purple, berries and mint",
  "موهيتو بلو باشن": "a vivid blue passion-fruit mojito, lime wheel, mint, crushed ice",
  "موهيتو بلو ويف": "a layered blue-and-green wave mojito, mint and lime",
  "ايس تي ليمون": "an iced lemon tea in a tall glass, lemon wheels and ice",
  "ايس تي خوخ": "an iced peach tea in a tall glass, peach slices and ice",
  "ايس تي كيوي": "an iced kiwi tea in a tall glass, kiwi slices against the glass",

  "سموذي مانجو": "a thick mango smoothie in a tall glass, fresh mango cheek beside",
  "سموذي اناناس": "a thick pineapple smoothie, pineapple wedge on the rim",
  "سموذي فراوله": "a thick strawberry smoothie, fresh strawberry on the rim",
  "سموذي توت": "a thick mixed-berry smoothie, deep purple, berries on top",
  "سموذي باشن فروت": "a thick passion-fruit smoothie, halved passion fruit beside",
};

const IDENTITY = `HAIL Bakery & Cafe — product photography set.

STYLE (identical in every image, this is one coherent set):
• Square-ish PORTRAIT crop, aspect ratio 4:5.
• One single product, centred, filling most of the frame.
• Shot slightly above eye level, about a 30-degree angle.
• Background: a smooth warm olive-green surface (#556f42) fading to deeper
  olive at the edges, with a soft warm-orange (#f2924c) light bloom in the
  upper right corner. Plain — no patterns, no props clutter, no table edges.
• Lighting: soft warm daylight from the upper right, gentle shadow to the
  lower left, no harsh reflections.
• Palette must stay inside: olive green #556f42, warm orange #f2924c,
  cream #f4f2ec, deep coffee brown #4a2c1e.
• Photorealistic, appetising, clean, premium cafe menu quality.

STRICT RULES:
• NO text of any kind. No words, no letters, no Arabic, no English.
• NO prices, NO item names, NO labels, NO menu cards, NO signage.
• NO logos, NO watermarks, NO brand marks.
• NO hands, NO people, NO faces.
• NO borders or frames around the image.
• NO numbers drawn anywhere on the picture.
• NEVER put more than one item in a picture. No grids, no collages, no contact
  sheets, no multi-panel layouts, no side-by-side comparisons. ONE product per
  picture, always.

OUTPUT: give me 10 SEPARATE pictures — one picture per item, generated one at a
time, in the order listed below. Do not merge them. Do not label them.`;

const active = HAIL_MENU.flatMap((c) => c.items.filter((i) => i.active !== false).map((i) => ({ ...i, cat: c.name_ar })));
const missing = active.filter((i) => !EN[i.name_ar]);
if (missing.length) {
  console.error("No English description for:", missing.map((m) => m.name_ar).join(", "));
  process.exit(1);
}

const CHUNK = 10;
const groups = [];
for (let i = 0; i < active.length; i += CHUNK) groups.push(active.slice(i, i + CHUNK));

const out = [
  "# برومبتات صور المنيو — مخبز ومقهى هيل",
  "",
  `${groups.length} برومبت · ${active.length} صنفاً · ١٠ صور لكل برومبت (آخر برومبت ${groups[groups.length - 1].length}).`,
  "",
  "## كيف تستخدمها",
  "",
  "١. افتح ChatGPT واطلب توليد الصور بلصق البرومبت كاملاً كما هو.",
  "٢. **بلوك الهوية في أعلى كل برومبت ثابت لا يتغيّر** — هو ما يجعل الصور تبدو طقماً واحداً.",
  "   لا تحذفه ولا تختصره عند التكرار على حساب آخر.",
  "٣. احفظ الصور **بترتيب توليدها** باسم 1.png، 2.png … 10.png داخل مجلد باسم البرومبت.",
  "   الترتيب هو الرابط الوحيد بين الصورة وصنفها — لا تبدّله.",
  "٤. أرسل لي المجلدات وأنا أربط كل صورة بصنفها وأرفعها للنظام.",
  "",
  "### إذا جمعها في صورة واحدة (شبكة مرقّمة)",
  "",
  "أحياناً يجمع ChatGPT الأصناف العشرة في لوحة واحدة بأرقام مرسومة. لا تقبلها —",
  "الأرقام تُحرق داخل الصورة والدقة تنخفض. أرسل له:",
  "",
  "```",
  "لا. أعد التوليد: صورة منفصلة لكل صنف، واحدة تلو الأخرى، بنفس الستايل تماماً.",
  "ممنوع تجميعها في شبكة أو لوحة واحدة، وممنوع رسم أي رقم أو كتابة على الصورة.",
  "ابدأ بالصنف الأول فقط وانتظرني أقول «التالي».",
  "```",
  "",
  "ثم اكتب «التالي» بعد كل صورة. هذه الطريقة أبطأ لكنها لا تفشل أبداً.",
  "",
  "**التوزيع على ٣ حسابات:** " +
    groups.map((_, i) => `برومبت ${i + 1}`).reduce((acc, n, i) => {
      const a = i % 3;
      acc[a] = acc[a] ? `${acc[a]}، ${n}` : n;
      return acc;
    }, []).map((s, i) => `الحساب ${i + 1} → ${s}`).join(" · "),
  "",
  "> **ملاحظة عن الشعار:** لم أطلب من الذكاء الاصطناعي رسم شعار هيل عمداً —",
  "> فهو يخرج مشوّهاً دائماً. الصور تأتي بألوان الهوية فقط، وأنا أضيف الشعار",
  "> الحقيقي على الصور برمجياً بعد استلامها إن أردت.",
  "",
  "---",
  "",
];

groups.forEach((g, gi) => {
  const cats = [...new Set(g.map((i) => i.cat))].join(" · ");
  out.push(`## برومبت ${gi + 1} — ${cats}`, "", "```", IDENTITY, "");
  g.forEach((item, i) => out.push(`${i + 1}. ${EN[item.name_ar]}`));
  out.push("```", "", `<sub>الأصناف: ${g.map((i) => i.name_ar).join(" · ")}</sub>`, "", "---", "");
});

mkdirSync(join(root, "design"), { recursive: true });
const file = join(root, "design", "prompts-الصور.md");
writeFileSync(file, out.join("\n"), "utf8");
console.log(`✓ ${file}\n  ${groups.length} prompts · ${active.length} items`);
