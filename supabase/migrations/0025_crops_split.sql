-- 0025_crops_split.sql — تقسيم «المحاصيل المتوفرة» إلى قسمين
--
-- التصميم يعرض المحاصيل في لوحتين: «المحاصيل المجففة» و«محاصيل انفيوجن».
-- كانت كلها في قسم واحد.
--
-- التقسيم بحسب اللوحة لا بحسب المعالجة: لوحة الانفيوجن تحوي أيضاً محصولاً
-- مغسولاً (صواع) وثلاثة بتنقيع لا هوائي (روفيرا، ارسيلا، لابراديرا) — فاشتقاقه
-- من شارة المعالجة كان سيضع أربعة محاصيل في القسم الخطأ.
--
-- ويضيف محصولاً فات القراءة الأولى (موجيانا برازيلي — نيردز)، ويميّز الثلاثة
-- المسمّاة «تروبيكال» بمحمصتها: الاسم هو مفتاح ربط الصور في
-- scripts/import-menu-images.mjs، فاسمان متطابقان يعطيان صنفين الصورة نفسها.
--
-- 0022_hail_menu.sql محميّ بـ «إن وُجدت أصناف فارجع» فلا يطبّق شيئاً على قاعدة
-- عاملة — لذلك هذه الهجرة اليدوية. تعمل مرة واحدة وإعادة تشغيلها بلا أثر.

do $$
declare
  v_station uuid;
  v_old uuid;
  v_dried uuid;
  v_infusion uuid;
begin
  select id into v_station from public.stations where slug = 'cafe';

  insert into public.categories(name_ar, sort, station_id)
    select 'المحاصيل المجففة', 13, v_station
    where not exists (select 1 from public.categories where name_ar = 'المحاصيل المجففة');
  insert into public.categories(name_ar, sort, station_id)
    select 'محاصيل انفيوجن', 14, v_station
    where not exists (select 1 from public.categories where name_ar = 'محاصيل انفيوجن');

  select id into v_dried    from public.categories where name_ar = 'المحاصيل المجففة';
  select id into v_infusion from public.categories where name_ar = 'محاصيل انفيوجن';

  -- ── تمييز الأسماء المكرّرة (قبل النقل، فالنقل يطابق بالاسم) ──────────────
  update public.menu_items set name_ar = 'تروبيكال — اويو'      where name_ar = 'تروبيكال';
  update public.menu_items set name_ar = 'تروبيكال — كوف'       where name_ar = 'كوف تروبيكال';
  update public.menu_items set name_ar = 'تروبيكال — لابراديرا' where name_ar = 'لابراديرا';

  -- ── محصول فات القراءة الأولى للوحة المجففة ──────────────────────────────
  insert into public.menu_items(category_id, name_ar, description_ar, price, flavors, sort, is_active)
    select v_dried, 'موجيانا برازيلي — نيردز',
           'محمصة نيردز · معالجة مجففة · مكسرات، كاكو، كراميل',
           0, '{}'::text[], 9, false
    where not exists (select 1 from public.menu_items where name_ar = 'موجيانا برازيلي — نيردز');

  select id into v_old from public.categories where name_ar = 'المحاصيل المتوفرة';
  if v_old is null then return; end if;

  -- ── لوحة الانفيوجن ──────────────────────────────────────────────────────
  update public.menu_items set category_id = v_infusion
    where category_id = v_old
      and name_ar in (
        'كولمبيا كوكنت — اولالا',
        'برازيل فيمتو',
        'تروبيكال — كوف',
        'مزيج يمني واندنوسي',
        'ميرندا',
        'تروبيكال — اويو',
        'مزيج لوكا',
        'كولمبي — صواع',
        'مارفينا كوكنت',
        'تروبيكال — لابراديرا',
        'روفيرا',
        'ارسيلا'
      );

  -- ── الباقي كله للوحة المجففة ────────────────────────────────────────────
  update public.menu_items set category_id = v_dried where category_id = v_old;

  delete from public.categories where id = v_old;
end $$;
