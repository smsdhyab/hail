-- 0042_screensaver.sql — شاشة استراحة المنيو
--
-- اللوحي يبقى مفتوحاً طوال الدوام. بين زبون وآخر يعرض المنيو ساكناً، فيبدو
-- الجهاز معلّقاً أو منسيّاً. شاشة الاستراحة تعرض صورة أو فيديو المنتجات بشعار
-- المحل، وأول لمسة تعيد المنيو.
--
-- app_settings كان يخزّن أرقاماً فقط (أجرة التوصيل)، ورابط الوسيط نصّ — فأُضيف
-- عمود نصّي بدل جدول ثانٍ: نفس المفتاح ونفس الصلاحيات ونفس مكان البحث.

alter table public.app_settings add column if not exists value_text text;

insert into public.app_settings(key, value, value_text) values
  ('screensaver_after_sec', 120, null)   -- دقيقتان قبل ظهورها
  on conflict (key) do nothing;
insert into public.app_settings(key, value, value_text) values
  ('screensaver_media', 1, null)         -- value=1 مفعّلة، value_text=الرابط
  on conflict (key) do nothing;

create or replace function public.set_setting_text(p_key text, p_value text)
returns text language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if not is_staff() then raise exception 'not authorized'; end if;
  insert into app_settings(key, value_text) values (p_key, p_value)
    on conflict (key) do update set value_text = excluded.value_text, updated_at = now()
    returning app_settings.value_text into v;
  return v;
end $$;
revoke execute on function public.set_setting_text(text, text) from anon;

-- المنيو عام، فالزائر يقرأ الإعدادات المعروضة له وحدها
drop view if exists public.public_settings;
create view public.public_settings as
  select key, value, value_text from public.app_settings
  where key in ('delivery_fee', 'screensaver_after_sec', 'screensaver_media');
grant select on public.public_settings to anon, authenticated;
