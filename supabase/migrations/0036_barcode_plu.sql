-- 0036_barcode_plu.sql — ربط الصنف بملصق الميزان وبباركود المصنع
--
-- ملصق الميزان لا يحمل اسم الصنف ولا سعره — يحمل رقماً فقط. فُكّ ترميز ملصق
-- حقيقي من ميزان ACLAS في المحل:
--
--   2250007000406  =  22 | 50007 | 00040 | 6
--                     └┬┘  └──┬──┘ └──┬──┘ └ رقم تحقّق EAN-13
--                 بادئة   رمز الصنف  الوزن بالغرام
--
-- أي أن الباركود يحمل **الوزن لا السعر**. وهذا في مصلحتنا: السعر يبقى في
-- النظام وحده، فتغييره من إدارة المنيو يسري فوراً بلا إعادة برمجة الميزان،
-- ولا يمكن أن يخالف رقمٌ مطبوع على الكيس ما يظهر على الوصل.
--
-- plu     = الرمز داخل الميزان (50007 لبرازق)
-- barcode = باركود المصنع للمنتجات الجاهزة (قنينة ماء مثلاً) — بلا وزن

alter table public.menu_items add column if not exists plu     int;
alter table public.menu_items add column if not exists barcode text;

-- رمزان متطابقان يعنيان أن الملصق يضيف الصنف الخطأ، فيُمنع التكرار.
-- جزئي: الفراغ مسموح ومتكرّر — أغلب الأصناف بلا رمز ميزان.
create unique index if not exists menu_items_plu_key     on public.menu_items(plu)     where plu is not null;
create unique index if not exists menu_items_barcode_key on public.menu_items(barcode) where barcode is not null;

grant select (plu, barcode) on public.menu_items to authenticated;

-- المنيو العام لا يحتاجهما (الزبون لا يمسح باركوداً)، لكن شاشة الكاشير تحتاج
-- المطابقة — وهي تقرأ menu_public نفسه.
drop view if exists public.menu_public;
create view public.menu_public as
  select mi.id, mi.category_id, mi.name_ar, mi.description_ar, mi.image_url,
         mi.price, mi.flavors, mi.sort,
         mi.sold_by, coalesce(mi.unit_label, case when mi.sold_by = 'weight' then 'كغم' else 'قطعة' end) as unit_label,
         mi.plu, mi.barcode,
         c.name_ar as category_name, c.image_url as category_image, c.sort as category_sort,
         s.slug as station_slug
  from public.menu_items mi
  join public.categories c on c.id = mi.category_id
  left join public.stations s on s.id = c.station_id
  where mi.is_active and c.is_active;
grant select on public.menu_public to anon, authenticated;
