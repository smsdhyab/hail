# برومبت المصمم (ذكاء اصطناعي) — صور منتجات هيل كافيه النظيفة

الهدف: 36 صورة منتج **بدون أي نصوص أو أسعار** (الأسعار تأتي حيّة من قاعدة البيانات،
والتطبيق يضيف الاسم والسعر والأنيميشن فوق الصورة برمجياً).

## المواصفات الإلزامية (تُلصق مع كل دفعة)

```
Ultra-realistic professional product photography for the Iraqi coffee brand "HAIL Coffee".

SCENE: [PRODUCT] on a dark black marble cafe counter. Moody cinematic warm lighting,
deep dark espresso-brown background (#2b1a10) with softly blurred cafe elements,
golden-caramel rim light (#d18b4a). The cup/glass may carry a small round dark-brown
sticker with a golden coffee-cup logo only (no readable letters).

COMPOSITION: vertical 4:5, 1080x1350 px. Product centered in the LOWER-MIDDLE third.
Generous empty dark space in the TOP third (reserved for app overlays and animation).
Eye-level camera, slight 10° downward tilt, 85mm lens look, f/2.8 shallow depth of field.
No hands, no people.

ABSOLUTELY NO TEXT of any kind: no words, no numbers, no prices, no titles,
no watermarks, no captions — anywhere in the image.

CONSISTENCY: identical lighting, palette, counter and camera across the entire series.
```

إضافات حسب النوع:
- **الساخنة (01–12):** `gentle subtle natural steam rising from the drink, warm cozy glow` (بخار خفيف فقط — التطبيق يضيف بخاراً متحركاً فوقه)
- **الباردة (13–33):** `glass covered in realistic condensation droplets, visible ice, fresh frosty look`
- **المعجنات (34–36):** `warm golden baked texture, a few crumbs, soft warm light`

## التسمية — مهم جداً
احفظ كل صورة بالاسم: `HAIL-Item-01.png` … `HAIL-Item-36.png` بنفس الترقيم أدناه.
ضع الملفات في مجلد واحد، ثم في المشروع:
`node scripts/import-product-images.mjs <مسار المجلد>` — يستبدل الصور القديمة تلقائياً.

## الدفعات والقائمة (36 صورة)

### دفعة 1 — المشروبات الساخنة (01–12)
| # | المنتج | وصف المشهد بالإنجليزية |
|---|---|---|
| 01 | إسبريسو | small white ceramic espresso cup on saucer, rich dark crema |
| 02 | دبل إسبريسو | double espresso in a slightly larger cup, thick crema |
| 03 | أمريكانو | black americano in a tall glass mug |
| 04 | لاتيه | latte glass with layered milk and a latte-art heart |
| 05 | لاتيه منكّه | latte with caramel drizzle; vanilla pods and hazelnuts beside |
| 06 | سبانش لاتيه | layered spanish latte (condensed milk) in clear glass |
| 07 | كراميل ماكياتو | branded paper cup, caramel crosshatch on milk foam top |
| 08 | موكا | dark chocolate mocha dusted with cocoa, chocolate chunks beside |
| 09 | قهوة تركية | traditional turkish coffee cup with copper cezve beside |
| 10 | قهوة بالشوكولاتة | glass mug of chocolate coffee with a whipped swirl |
| 11 | هوت شوكليت | thick hot chocolate mug topped with marshmallows |
| 12 | شاي كرك | istikan glass of spiced karak tea, cardamom pods scattered |

### دفعة 2 — المشروبات الباردة (13–18)
| 13 | آيس أمريكانو | tall clear cup, black coffee over large ice cubes |
| 14 | آيس لاتيه | tall iced latte, milk and espresso swirl over ice |
| 15 | آيس لاتيه منكّه | iced latte with caramel drizzle inside the cup walls |
| 16 | آيس سبانش لاتيه | creamy layered iced spanish latte |
| 17 | آيس كراميل ماكياتو | layered milk, espresso and caramel over ice |
| 18 | آيس موكا | iced chocolate coffee with chocolate drizzle |

### دفعة 3 — آيس تي + موهيتو (19–23)
| 19 | آيس تي ليمون | tall amber iced tea, lemon slices, mint, ice |
| 20 | آيس تي توت | tall red berry iced tea, fresh berries, ice |
| 21 | موهيتو كلاسيك | mojito glass, lime wedges, mint leaves, crushed ice |
| 22 | موهيتو صودا | fizzy soda mojito with rising bubbles, lime and mint |
| 23 | موهيتو طاقة | vibrant electric-blue energy mojito over ice |

### دفعة 4 — ميلك شيك (24–27)
| 24 | ميلك شيك كوكيز | milkshake with whipped cream, cookie crumbs, cookie on rim |
| 25 | ميلك شيك أوريو | oreo milkshake, oreo on top |
| 26 | ميلك شيك نوتيلا | chocolate-hazelnut shake with nutella drizzle |
| 27 | ميلك شيك لوتس | lotus biscoff shake, biscuit on top, caramel crumbs |

### دفعة 5 — سموذي (28–31)
| 28 | سموذي فراولة | pink strawberry smoothie, fresh strawberries beside |
| 29 | سموذي أناناس | yellow pineapple smoothie, pineapple wedge on rim |
| 30 | سموذي مانجو | mango smoothie, fresh mango cubes |
| 31 | سموذي رمان | deep red pomegranate smoothie, pomegranate seeds |

### دفعة 6 — فرابيه + معجنات (32–36)
| 32 | فرابيه كراميل | blended caramel frappe, whipped cream, caramel drizzle |
| 33 | فرابيه فانيلا | vanilla frappe, whipped cream, vanilla pod |
| 34 | كرواسون | golden flaky butter croissant on a small dark plate |
| 35 | دونات | glazed chocolate donut with golden-caramel glaze |
| 36 | كوكيز | stack of chocolate-chip cookies with melted chips |

## اختياري (يُطلب لاحقاً إذا رغبت)
- 8 صور «أبطال أقسام» أفقية 16:9 لواجهات العرض/الشاشات.
- صورة غلاف عامة للمنيو التفاعلي.
