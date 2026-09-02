-- 0045_secure_views.sql — إغلاق تسريب كلفة البضاعة والمخزون
--
-- `item_margins` و`inventory_view` كانا يُقرآن من الإنترنت بلا تسجيل دخول:
-- كلفة ١٣٤ صنفاً وهوامش ربحها وأرصدة مخزنها. أي منافس يفتح الرابط يعرف بكم
-- يشتري المحل كل شيء — «اسبريسو دبل: بيع ٣٠٠٠، كلفة ٤٥٠».
--
-- السبب أن العرض في بوستغرس يعمل افتراضياً بصلاحيات مُنشئه، فيتجاوز RLS
-- الجداول تحته. و`security_invoker` يقلب ذلك: العرض يعمل بصلاحيات قارئه،
-- فترثه سياسات الجداول ولا يرى الزائر شيئاً.
--
-- والسحب من `anon` معه: حزامان لا واحد. سياسة تُكتب خطأً يوماً ما لا تفتح
-- الباب ما دامت الصلاحية نفسها مسحوبة.

-- ── ١) ربح كل صنف — للإدارة وحدها ──────────────────────────────────────────
drop view if exists public.item_margins;
create view public.item_margins with (security_invoker = true) as
  select mi.id as item_id, mi.name_ar, c.name_ar as category,
         mi.sold_by, coalesce(mi.unit_label, 'قطعة') as unit,
         mi.price, mi.cost,
         (mi.price - mi.cost) as margin,
         case when mi.price > 0 then round(((mi.price - mi.cost)::numeric / mi.price) * 100) else null end as margin_pct,
         coalesce(inv.qty, 0) as stock, coalesce(inv.low_at, 0) as low_at,
         (inv.item_id is not null and inv.qty <= inv.low_at) as is_low
  from public.menu_items mi
  join public.categories c on c.id = mi.category_id
  left join public.inventory inv on inv.item_id = mi.id;
revoke all on public.item_margins from anon;
grant select on public.item_margins to authenticated;

-- ── ٢) المخزون — للموظفين وحدهم ────────────────────────────────────────────
drop view if exists public.inventory_view;
create view public.inventory_view with (security_invoker = true) as
  select i.item_id, mi.name_ar, c.name_ar as category_name, s.slug as station_slug,
         i.qty, coalesce(mi.unit_label, case when mi.sold_by = 'weight' then 'كغم' else i.unit end) as unit,
         i.low_at, (i.qty <= i.low_at) as is_low, i.updated_at
  from public.inventory i
  join public.menu_items mi on mi.id = i.item_id
  join public.categories c on c.id = mi.category_id
  left join public.stations s on s.id = c.station_id;
revoke all on public.inventory_view from anon;
grant select on public.inventory_view to authenticated;

-- ── ٣) الإعدادات الخام ليست للزائر ─────────────────────────────────────────
-- الزائر يقرأ `public_settings` وحده، وهو يُظهر ما يخصّ المنيو فقط.
revoke all on public.app_settings from anon;

-- ── ٤) جداول لا سبب لأن يقرأها زائر ────────────────────────────────────────
-- RLS يحجب صفوفها أصلاً، لكن الصلاحية الممنوحة تبقى باباً بلا داعٍ.
revoke all on public.employees      from anon;
revoke all on public.customers      from anon;
revoke all on public.expenses       from anon;
revoke all on public.purchases      from anon;
revoke all on public.inventory      from anon;
revoke all on public.loyalty_events from anon;
revoke all on public.bot_state      from anon;
revoke all on public.roles          from anon;
revoke all on public.order_counters from anon;
