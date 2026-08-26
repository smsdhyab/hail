-- 0039_usage_stats.sql — قياس الاستهلاك مقابل حدود الخطة
--
-- الخطة المجانية لها سقوف، وتجاوزها يوقف المحل بلا إنذار. هذه الدالة تقيس ما
-- يمكن قياسه من داخل القاعدة، ليُنبَّه صاحب المحل **قبل** الوصول إلى السقف.

create or replace function public.usage_stats()
returns table(db_mb numeric, connections int, max_connections int, tables_rows bigint)
language sql security definer set search_path = public as $$
  select
    round(pg_database_size(current_database()) / 1048576.0, 1),
    (select count(*)::int from pg_stat_activity),
    current_setting('max_connections')::int,
    (select coalesce(sum(n_live_tup), 0)::bigint from pg_stat_user_tables);
$$;
revoke all on function public.usage_stats() from anon, authenticated;
grant execute on function public.usage_stats() to service_role;
