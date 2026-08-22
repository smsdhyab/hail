# HAIL — مخبز ومقهى هيل ☕🥐

نظام إدارة طلبات لمخبز ومقهى هيل (الرمادي، العراق): منيو رقمي عربي RTL، طلب عبر QR من الطاولة، **كاشيران بحسابين منفصلين مالياً وإدارياً على نظام واحد**، نقاط ولاء، ولوحة مبيعات لكل قسم.

A two-register cafe/bakery POS on one system: Arabic-first digital menu, QR/kiosk self-ordering, **automatic order routing between the bakery and the cafe counter**, one payment split back onto each register's books, thermal receipts, loyalty, and a per-station sales dashboard.

## Stack
Next.js 16 · React 19 · TypeScript · Tailwind v4 · Supabase (Postgres + Auth + Storage) · Vitest

---

## الفكرة الأساسية — كاشيران، نظام واحد

المحل يعمل بقسمين لهما حسابات منفصلة تماماً:

| الكاشير | الأقسام |
|---|---|
| 🥐 **المعجنات والمخبوزات** | الخبز · الكعك · الكيك · الشوكولاتة · الحلقوم · المعجنات · البقلاوة · الموالح |
| ☕ **الكافيه** | المشروبات الساخنة · الباردة · الموهيتو · السموذي · المحاصيل المتوفرة |

**القاعدة كلها في سطر واحد:** كل *قسم* في المنيو مربوط بكاشير، وكل *صنف* يرث كاشير قسمه.

فإذا طلب الزبون بقلاوة + كيك + كافيه:

1. المنيو يعرض كل الأصناف معاً — الزبون لا يرى أي انقسام.
2. عند الإرسال ينقسم الطلب إلى **طلبين**: واحد لكل كاشير، يحملان **نفس رقم الطلب** الذي أُعطي للزبون (`group_no`).
3. كل شاشة كاشير تعرض أصنافها فقط، مع تنبيه «🔗 طلب مشترك» يوضّح **المبلغ الكامل** المطلوب من الزبون.
4. الزبون **يدفع مرة واحدة** عند أي كاشير. المبلغ (والخصم والإضافات) يُوزَّع بالتناسب على حساب كل قسم، بحساب صحيح بالدينار بحيث يتحقق دائماً:
   `مجموع صافي الأقسام = المبلغ المدفوع`
5. `collected_by_station_id` يسجّل **أي درج** استلم الكاش — وهو سؤال مختلف عن **أي قسم** ربح المبلغ.

**الطابق** معلومة توصيل فقط: كل طاولة لها رقم طابق ثابت، يظهر على الوصل وشاشة الطلبات وملصق QR. لا يؤثر على المنيو ولا على التوزيع.

الكود المسؤول:
- `src/lib/cafe/hail-menu.ts` — الكتالوج: الأقسام والأصناف والأسعار والكاشير المالك (مصدر واحد للحقيقة)
- `src/lib/cafe/station.ts` — التوجيه وتوزيع المبلغ (دوال نقية + اختبارات)
- `supabase/migrations/0021_stations.sql` — نفس القواعد في SQL

---

## التشغيل / Setup

### محلياً بدون قاعدة بيانات (الوضع الحالي)

```bash
npm install
npm run dev
```

`.env.local` فيه `HAIL_LOCAL_DB=1` ولا مفاتيح Supabase، فيعمل النظام بالكامل على **مخزن محلي بملف JSON** في `.data/hail.json`. حسابات التجربة:

| الحساب | كلمة المرور | الكاشير |
|---|---|---|
| `admin` | `1234` | الاثنان (مدير) |
| `pastry` | `1111` | المعجنات والمخبوزات |
| `cafe` | `2222` | الكافيه |

المخزن المحلي مؤقت: عملية واحدة، بلا قفل تزامن، وكلمات المرور نصية. لا يعمل إطلاقاً إلا بوجود `HAIL_LOCAL_DB=1` **و** غياب مفاتيح Supabase.

### مع قاعدة بيانات Supabase

```bash
cp .env.example .env.local     # املأ مفاتيح Supabase واحذف HAIL_LOCAL_DB
for f in supabase/migrations/*.sql; do npm run db:apply "$f"; done
node scripts/create-admin.mjs  # ينشئ حساب المالك من ADMIN_EMAIL/ADMIN_PASSWORD
npm run dev
```

الترحيلات تُطبَّق بالترتيب: `0021_stations.sql` ينشئ الكاشيرين، و`0022_hail_menu.sql` يزرع المنيو.

**تعديل المنيو:** حرّر `src/lib/cafe/hail-menu.ts` ثم `node scripts/generate-menu-seed.mjs` — يعيد توليد `0022_hail_menu.sql` من نفس المصدر، فلا يفترقان أبداً.

### Environment (.env.local)
| Var | Purpose |
|---|---|
| `HAIL_LOCAL_DB` | `1` → مخزن JSON محلي بدل Supabase (تطوير فقط) |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public client config |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only; the ONLY path to cost/profit + loyalty rpc |
| `SUPABASE_DB_URL` | Postgres connection (use the **session pooler** URL) for `npm run db:apply` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | one-time owner account creation |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_OWNER_CHAT_IDS` | stats bot (`npm run bot`) |
| `POINTS_PER_IQD` / `POINTS_PER_REWARD` / `REWARD_VALUE_IQD` | loyalty tuning |

## الصفحات / Routes
- `/menu` · `/kiosk` — منيو الزبائن والطلب الذاتي (عام، `?t=N` لرقم الطاولة)
- `/sign-in` — اختيار الكاشير ثم تسجيل الدخول
- `/orders` — طلبات قسمك الواردة · `/cashier` — إصدار طلب ودفع وفاتورة 80mm
- `/dashboard` — مبيعات قسمك (المدير: القسمين معاً)
- `/tables` — خريطة الطاولات بطابق لكل خريطة · `/qr` — ملصقات QR
- `/menu-admin` — إدارة الأصناف والأسعار **وربط كل قسم بكاشيره**
- `/loyalty` · `/expenses` · `/pastries` · `/debts` · `/employees` · `/help`

## الأمان / Security model
- Cost & profit **never traverse PostgREST**: revoked from `anon`+`authenticated`; only the service-role client reads them, server-side. A cashier's dashboard has them stripped again in `dashboard-actions.ts`.
- Every station-scoped query goes through `stationScope(staff)` — a cashier cannot see the other register's numbers, and cannot sign into its till.
- Orders go through the `place_order` SECURITY DEFINER rpc — prices recomputed server-side, atomic per-station daily numbers, snapshots.
- Loyalty points are a ledger (`loyalty_events`) with DB-enforced idempotency (no double-award).

## Design source
اللوحة اللونية والأصناف مستخرجة من ملف Adobe XD الخاص بالمالك — الصور المرجعية في `design/xd/`.
الألوان: زيتوني `#556f42` · برتقالي `#f2924c` · ورقي `#f4f2ec` · بني الشعار `#4a2c1e`.

## Commands
`npm run dev` · `npm run check` (lint+types+build) · `npm test` · `npm run db:apply <file>` · `npm run seed:menu` · `npm run bot`
