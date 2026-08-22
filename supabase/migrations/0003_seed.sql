-- 0003_seed.sql — roles only.
-- The HAIL menu lives in 0022_hail_menu.sql, generated from the app's catalog
-- (src/lib/cafe/hail-menu.ts) so the two can never drift apart. It runs after
-- 0021_stations.sql, which is what adds the stations table this shop needs.
insert into public.roles(name_ar, name_en)
  select 'مدير', 'admin' where not exists (select 1 from public.roles where name_en = 'admin');
insert into public.roles(name_ar, name_en)
  select 'كاشير', 'cashier' where not exists (select 1 from public.roles where name_en = 'cashier');
