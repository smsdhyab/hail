-- 0023_inventory.sql — تتبّع المخزون الحقيقي
--
-- حتى الآن كان النظام يعرف «الصنف مفعّل أو معطّل» فقط. هذا الجدول يضيف كمية
-- فعلية لكل صنف، تُخصم تلقائياً عند **الدفع** (لا عند الطلب، حتى لا يخصم طلب
-- مُلغى)، مع حدّ تنبيه لكل صنف يغذّي زر «النواقص» في البوت.
--
-- الأصناف التي لا يُتتبّع مخزونها (المشروبات المحضّرة مثلاً) ببساطة لا يكون لها
-- صف هنا — لا شيء يُخصم ولا شيء يظهر في النواقص.

create table if not exists public.inventory (
  item_id    uuid primary key references public.menu_items(id) on delete cascade,
  qty        int  not null default 0,
  unit       text not null default 'قطعة',
  -- عند أو تحت هذا الرقم يظهر الصنف في «النواقص»
  low_at     int  not null default 5,
  updated_at timestamptz not null default now()
);

alter table public.inventory enable row level security;
drop policy if exists inventory_staff_read on public.inventory;
create policy inventory_staff_read on public.inventory for select using (public.is_staff());
grant select on public.inventory to authenticated;

-- ── الخصم التلقائي عند الدفع ────────────────────────────────────────────────
-- يعمل مرة واحدة لكل طلب: الشرط `old.status is distinct from 'paid'` يمنع
-- الخصم مرتين لو حُدِّث الطلب لاحقاً وهو مدفوع أصلاً.
create or replace function public.deduct_inventory_on_paid()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    update inventory inv set
      qty = greatest(0, inv.qty - agg.sold),
      updated_at = now()
    from (
      select item_id, sum(qty)::int sold
      from order_items where order_id = new.id and item_id is not null
      group by item_id
    ) agg
    where inv.item_id = agg.item_id;
  end if;
  return new;
end $$;

drop trigger if exists orders_deduct_inventory on public.orders;
create trigger orders_deduct_inventory
  after update of status on public.orders
  for each row execute function public.deduct_inventory_on_paid();

-- ── العرض الذي يقرأه البوت ──────────────────────────────────────────────────
-- كمية كل صنف مع اسمه وقسمه وكاشيره، وعلامة «ناقص».
drop view if exists public.inventory_view;
create view public.inventory_view as
  select i.item_id, mi.name_ar, c.name_ar as category_name, s.slug as station_slug,
         i.qty, i.unit, i.low_at, (i.qty <= i.low_at) as is_low, i.updated_at
  from public.inventory i
  join public.menu_items mi on mi.id = i.item_id
  join public.categories c on c.id = mi.category_id
  left join public.stations s on s.id = c.station_id;
grant select on public.inventory_view to authenticated;

-- ── تعديل الكمية (إدخال بضاعة أو جرد) ───────────────────────────────────────
-- p_delta موجب = إدخال، سالب = إخراج. p_set يضبط الكمية مباشرة (للجرد).
create or replace function public.adjust_stock(p_item uuid, p_delta int default null, p_set int default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_qty int;
begin
  if not is_staff() then raise exception 'not authorized'; end if;
  insert into inventory(item_id, qty) values (p_item, 0) on conflict (item_id) do nothing;
  update inventory set
    qty = greatest(0, case when p_set is not null then p_set else qty + coalesce(p_delta, 0) end),
    updated_at = now()
    where item_id = p_item
    returning qty into v_qty;
  return v_qty;
end $$;
revoke execute on function public.adjust_stock(uuid, int, int) from anon;

-- ── أكثر الطاولات طلباً ─────────────────────────────────────────────────────
-- تُحسب بالتذاكر (group_no) لا بصفوف الطلبات، وإلا عُدّ الطلب المشترك مرتين.
create or replace function public.table_popularity(p_from date, p_to date)
returns table(table_no text, tickets bigint, sales bigint, guests bigint)
language sql security definer set search_path = public as $$
  select o.table_no,
         count(distinct o.group_no)::bigint,
         sum(o.subtotal - o.discount + o.extra)::bigint,
         coalesce((select sum(oi.qty) from order_items oi
                   join orders o2 on o2.id = oi.order_id
                   where o2.table_no = o.table_no and o2.status = 'paid'
                     and o2.business_day between p_from and p_to), 0)::bigint
  from orders o
  where o.status = 'paid' and o.table_no is not null
    and o.business_day between p_from and p_to
  group by o.table_no
  order by 2 desc, 3 desc;
$$;
revoke all on function public.table_popularity(date, date) from anon, authenticated;

-- ── تقرير العدد اليومي ──────────────────────────────────────────────────────
-- صف لكل يوم: التذاكر، القطع المباعة (≈ الزبائن)، والمبيعات.
-- المبيعات والقطع تُجمَّعان في CTE منفصلين — الربط المباشر بين الطلبات
-- وأسطرها يضاعف مجموع المبيعات بعدد الأسطر.
create or replace function public.daily_counts(p_from date, p_to date)
returns table(day date, tickets bigint, pieces bigint, sales bigint)
language sql security definer set search_path = public as $$
  with o as (
    select business_day d,
           count(distinct group_no)::bigint tickets,
           sum(subtotal - discount + extra)::bigint sales
    from orders
    where status = 'paid' and business_day between p_from and p_to
    group by business_day
  ), it as (
    select ord.business_day d, sum(oi.qty)::bigint pieces
    from order_items oi
    join orders ord on ord.id = oi.order_id
    where ord.status = 'paid' and ord.business_day between p_from and p_to
    group by ord.business_day
  )
  select g::date, coalesce(o.tickets, 0), coalesce(it.pieces, 0), coalesce(o.sales, 0)
  from generate_series(p_from, p_to, interval '1 day') g
  left join o  on o.d  = g::date
  left join it on it.d = g::date
  order by g;
$$;
revoke all on function public.daily_counts(date, date) from anon, authenticated;
