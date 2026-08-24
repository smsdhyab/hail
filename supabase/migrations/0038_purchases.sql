-- 0038_purchases.sql — المشتريات: تربط ما تدفعه بما تبيعه
--
-- «كيلو الحلقوم بكم اشتريته وبكم تبيعه، وكم بقي منه، وكم ربحت.»
--
-- الشراء يفعل ثلاثة أشياء دفعة واحدة:
--   ١) يزيد المخزون بالكمية المشتراة
--   ٢) يحدّث كلفة الوحدة (سعر الشراء الأخير) — وهي ما يُحسب به الربح
--   ٣) يُقيَّد في سجلّ المشتريات ليُعرف النقد الخارج على البضاعة
--
-- **ولا يُسجَّل مصروفاً.** النظام يحسب:
--     الربح  = المبيعات − كلفة البضاعة المباعة
--     الصافي = الربح − المصروفات
-- فكلفة البضاعة مخصومة أصلاً مع كل بيعة. وإضافة الشراء إلى «المصروفات» تخصمه
-- مرة ثانية، فيظهر المحل خاسراً يوم الشراء ورابحاً بلا كلفة بقية الأيام.
-- المصروفات تبقى لما لا بضاعة له: إيجار، رواتب، كهرباء، صيانة.

create table if not exists public.purchases (
  id           uuid primary key default gen_random_uuid(),
  business_day date not null default (now() at time zone 'Asia/Baghdad')::date,
  item_id      uuid not null references public.menu_items(id) on delete restrict,
  -- كسرية: تُشترى الأصناف الموزونة بالكيلو وغيرها بالقطعة
  qty          numeric(10,3) not null check (qty > 0),
  total_cost   int not null check (total_cost >= 0),
  -- كلفة الوحدة محسوبة لا مُدخَلة: البائع يعطيك المبلغ الكلي والكمية
  unit_cost    int generated always as (round(total_cost / qty)::int) stored,
  supplier     text,
  note         text,
  created_by   uuid references public.employees(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists purchases_day_idx  on public.purchases(business_day);
create index if not exists purchases_item_idx on public.purchases(item_id);

alter table public.purchases enable row level security;
drop policy if exists purchases_staff_read on public.purchases;
create policy purchases_staff_read on public.purchases for select using (public.is_staff());
grant select on public.purchases to authenticated;

-- ── تسجيل شراء ─────────────────────────────────────────────────────────────
create or replace function public.record_purchase(
  p_item uuid, p_qty numeric, p_total int,
  p_supplier text default null, p_note text default null, p_day date default null
) returns table(unit_cost int, stock numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid;
  v_unit int;
  v_stock numeric;
  v_day date := coalesce(p_day, (now() at time zone 'Asia/Baghdad')::date);
begin
  if not is_staff() then raise exception 'not authorized'; end if;
  if coalesce(p_qty, 0) <= 0 then raise exception 'quantity must be greater than zero'; end if;

  select e.id into v_emp from employees e where e.auth_user_id = auth.uid() limit 1;

  insert into purchases(business_day, item_id, qty, total_cost, supplier, note, created_by)
    values (v_day, p_item, round(p_qty, 3), greatest(0, p_total),
            nullif(trim(coalesce(p_supplier, '')), ''), nullif(trim(coalesce(p_note, '')), ''), v_emp)
    returning purchases.unit_cost into v_unit;

  -- كلفة الوحدة = آخر سعر شراء. المتوسط المرجّح أدقّ لكنه يجعل صاحب المحل
  -- يرى رقماً لا يطابق أي فاتورة بيده — وهذا يُفقده الثقة بالأرقام كلها.
  update menu_items set cost = v_unit where id = p_item;

  insert into inventory(item_id, qty) values (p_item, round(p_qty, 3))
    on conflict (item_id) do update set qty = inventory.qty + round(p_qty, 3), updated_at = now()
    returning inventory.qty into v_stock;

  return query select v_unit, v_stock;
end $$;
revoke execute on function public.record_purchase(uuid, numeric, int, text, text, date) from anon;

-- ── حدّ التنبيه لكل صنف ─────────────────────────────────────────────────────
create or replace function public.set_low_at(p_item uuid, p_low numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare v numeric;
begin
  if not is_staff() then raise exception 'not authorized'; end if;
  insert into inventory(item_id, qty, low_at) values (p_item, 0, greatest(0, p_low))
    on conflict (item_id) do update set low_at = greatest(0, p_low), updated_at = now()
    returning inventory.low_at into v;
  return v;
end $$;
revoke execute on function public.set_low_at(uuid, numeric) from anon;

-- ── تقرير: كم أنفقت على البضاعة، وكم ربحت منها ─────────────────────────────
create or replace function public.purchases_summary(p_from date, p_to date)
returns table(spent bigint, lines bigint)
language sql security definer set search_path = public as $$
  select coalesce(sum(total_cost), 0)::bigint, count(*)::bigint
  from purchases where business_day between p_from and p_to;
$$;
revoke all on function public.purchases_summary(date, date) from anon, authenticated;
grant execute on function public.purchases_summary(date, date) to service_role;

-- ربح كل صنف: كم بِيع منه، وبكم، وكلفته — لمعرفة أي صنف يستحق الرفّ
drop view if exists public.item_margins;
create view public.item_margins as
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
grant select on public.item_margins to authenticated;
