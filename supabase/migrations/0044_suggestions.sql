-- 0044_suggestions.sql — الاقتراحات تُختار لا تُخمَّن
--
-- كانت النافذة تعرض أول اثني عشر صنفاً من المعجنات مع كل مشروب، أياً كانت.
-- فيُقترح على شارب القهوة ما لا يناسبها، وتغييرُ الاقتراح يحتاج تعديل الكود.
--
-- الآن: المدير يؤشّر الأصناف التي تُقترح، ومفتاح واحد يوقف الاقتراحات كلها.

alter table public.menu_items add column if not exists suggest boolean not null default false;
grant select (suggest) on public.menu_items to authenticated;

insert into public.app_settings(key, value) values ('suggestions_on', 1)
  on conflict (key) do nothing;

drop view if exists public.public_settings;
create view public.public_settings as
  select key, value, value_text from public.app_settings
  where key in ('delivery_fee', 'screensaver_after_sec', 'screensaver_media', 'suggestions_on');
grant select on public.public_settings to anon, authenticated;

drop view if exists public.menu_public;
create view public.menu_public as
  select mi.id, mi.category_id, mi.name_ar, mi.description_ar, mi.image_url,
         mi.price, mi.flavors, mi.sort,
         mi.sold_by, coalesce(mi.unit_label, case when mi.sold_by = 'weight' then 'كغم' else 'قطعة' end) as unit_label,
         mi.plu, mi.barcode, mi.suggest,
         c.name_ar as category_name, c.image_url as category_image, c.sort as category_sort,
         s.slug as station_slug
  from public.menu_items mi
  join public.categories c on c.id = mi.category_id
  left join public.stations s on s.id = c.station_id
  where mi.is_active and c.is_active;
grant select on public.menu_public to anon, authenticated;
