-- 0026_combos.sql — عروض اليوم (مشروب + معجّنة بسعر واحد)
--
-- العرض يمتدّ على الكاشيرين: المشروب من الكافيه والمعجّنة من المعجنات. القرار
-- التشغيلي: **كل قسم يقيّد سعر قائمته كاملاً، والفرق يُسجَّل على المحل** — فلا
-- يتأثر دفتر أي قسم بقرار تسويقي لم يتخذه.
--
-- الفرق يُخزَّن في orders.promo_adjust ويقبل الإشارتين:
--   سالب = العرض أرخص من مجموع القائمة (خصم يتحمّله المحل)
--   موجب = العرض أغلى (حصة أكبر مثلاً) — وهو حال أسعار التصميم الحالية
--
-- فتصير المعادلة:
--   المقبوض = Σ(صافي الأقسام) + promo_adjust
-- وتبقى «مبيعات القسم» هي سعر قائمته، غير ملوّثة بالعرض.
--
-- promo_adjust يُكتب على صف واحد من المجموعة (أول قسم ترتيباً) لا على كل صف،
-- حتى يبقى جمعه في التقارير صحيحاً بلا ازدواج.

create table if not exists public.combos (
  id       uuid primary key default gen_random_uuid(),
  slug     text not null unique,
  title_ar text not null,
  price    int  not null check (price >= 0),
  is_active boolean not null default true,
  sort     int  not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.combo_items (
  combo_id uuid not null references public.combos(id) on delete cascade,
  item_id  uuid not null references public.menu_items(id) on delete cascade,
  primary key (combo_id, item_id)
);

alter table public.combos      enable row level security;
alter table public.combo_items enable row level security;
drop policy if exists combos_public_read on public.combos;
create policy combos_public_read on public.combos for select using (is_active);
drop policy if exists combo_items_public_read on public.combo_items;
create policy combo_items_public_read on public.combo_items for select using (true);
grant select on public.combos, public.combo_items to anon, authenticated;

alter table public.orders add column if not exists promo_adjust int not null default 0;
grant select (promo_adjust) on public.orders to authenticated;

-- ما يقرأه المنيو: العرض وأصنافه ومجموع أسعار القائمة
drop view if exists public.combo_public;
create view public.combo_public as
  select c.id, c.slug, c.title_ar, c.price, c.sort,
         array_agg(mi.id order by mi.id)      as item_ids,
         array_agg(mi.name_ar order by mi.id) as item_names,
         sum(mi.price)::int                   as list_total
  from public.combos c
  join public.combo_items ci on ci.combo_id = c.id
  join public.menu_items mi on mi.id = ci.item_id and mi.is_active
  where c.is_active
  group by c.id, c.slug, c.title_ar, c.price, c.sort;
grant select on public.combo_public to anon, authenticated;

-- ── place_order يقبل قائمة العروض ───────────────────────────────────────────
-- تُحذف النسخة القديمة أولاً وإلا واجه PostgREST توقيعين متطابقين.
drop function if exists public.place_order(public.order_channel, jsonb, uuid, text, text);

create or replace function public.place_order(
  p_channel public.order_channel,
  p_lines jsonb,
  p_customer uuid default null,
  p_table text default null,
  p_note text default null,
  p_combos jsonb default '[]'::jsonb
) returns table(order_id uuid, order_seq int, group_no int, station_slug text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_day date := (now() at time zone 'Asia/Baghdad')::date;
  v_group int;
  v_cashier uuid;
  v_table text := nullif(trim(coalesce(p_table, '')), '');
  v_note text := nullif(left(trim(coalesce(p_note, '')), 300), '');
  v_floor int;
  v_line jsonb;
  v_item public.menu_items;
  v_variant public.item_variants;
  v_station uuid;
  v_qty int;
  v_price int;
  v_cost int;
  v_name text;
  v_flavor text;
  v_order uuid;
  v_seq int;
  v_slug text;
  v_orders jsonb := '{}'::jsonb;
  v_promo int := 0;
  v_first uuid;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'empty order';
  end if;

  select e.id into v_cashier from employees e
    where e.auth_user_id = auth.uid() and e.is_active limit 1;

  select t.floor into v_floor from cafe_tables t where t.name = v_table;

  insert into order_counters(business_day, scope, last_seq) values (v_day, 'group', 1)
    on conflict (business_day, scope) do update set last_seq = order_counters.last_seq + 1
    returning last_seq into v_group;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_variant := null;
    v_qty := greatest(1, coalesce((v_line->>'qty')::int, 1));

    select * into v_item from menu_items where id = (v_line->>'item_id')::uuid and is_active;
    if not found then raise exception 'item not available: %', v_line->>'item_id'; end if;

    if nullif(v_line->>'variant_id', '') is not null then
      select * into v_variant from item_variants
        where id = (v_line->>'variant_id')::uuid and item_id = v_item.id and is_active;
      if not found then raise exception 'variant not available'; end if;
    end if;

    select c.station_id into v_station from categories c where c.id = v_item.category_id;
    if v_station is null then
      select id into v_station from stations where slug = 'cafe';
    end if;

    if not (v_orders ? v_station::text) then
      select s.slug into v_slug from stations s where s.id = v_station;
      insert into order_counters(business_day, scope, last_seq) values (v_day, v_slug, 1)
        on conflict (business_day, scope) do update set last_seq = order_counters.last_seq + 1
        returning last_seq into v_seq;

      insert into orders(business_day, order_seq, group_no, station_id, channel, status,
                         customer_id, cashier_id, table_no, floor, note)
        values (v_day, v_seq, v_group, v_station, p_channel, 'pending',
                p_customer, v_cashier, v_table, v_floor, v_note)
        returning id into v_order;

      v_orders := v_orders || jsonb_build_object(v_station::text, v_order::text);
    else
      v_order := (v_orders->>v_station::text)::uuid;
    end if;

    v_price := coalesce(v_variant.price_override, v_item.price);
    v_cost  := coalesce(v_variant.cost_override, v_item.cost);
    v_name  := v_item.name_ar || case when v_variant.id is not null then ' - ' || v_variant.name_ar else '' end;
    v_flavor := nullif(v_line->>'flavor', '');
    if v_flavor is not null and not (v_flavor = any(v_item.flavors)) then
      v_flavor := null;
    end if;

    insert into order_items(order_id, item_id, variant_id, name_ar, flavor_ar, qty, unit_price, unit_cost)
      values (v_order, v_item.id, v_variant.id, v_name, v_flavor, v_qty, v_price, v_cost);
  end loop;

  update orders o set
    subtotal   = (select coalesce(sum(line_total), 0) from order_items where order_id = o.id),
    cost_total = (select coalesce(sum(qty * unit_cost), 0) from order_items where order_id = o.id)
    where o.business_day = v_day and o.group_no = v_group;

  -- ── العروض ───────────────────────────────────────────────────────────────
  -- الفرق بين سعر العرض ومجموع أسعار القائمة، للعروض المفعّلة فقط. السعر
  -- يُقرأ من قاعدة البيانات لا من العميل، تماماً كأسعار الأصناف.
  if p_combos is not null and jsonb_array_length(p_combos) > 0 then
    select coalesce(sum(cp.price - cp.list_total), 0) into v_promo
      from combo_public cp
      where cp.slug in (select jsonb_array_elements_text(p_combos));

    if v_promo <> 0 then
      select o.id into v_first
        from orders o join stations s on s.id = o.station_id
        where o.business_day = v_day and o.group_no = v_group
        order by s.sort limit 1;
      update orders set promo_adjust = v_promo where id = v_first;
    end if;
  end if;

  return query
    select o.id, o.order_seq, o.group_no, s.slug
    from orders o join stations s on s.id = o.station_id
    where o.business_day = v_day and o.group_no = v_group
    order by s.sort;
end $$;

revoke execute on function public.place_order(public.order_channel, jsonb, uuid, text, text, jsonb) from public;
grant execute on function public.place_order(public.order_channel, jsonb, uuid, text, text, jsonb) to anon, authenticated;

-- ── التقارير: «المبيعات» تبقى إيراد الأقسام، و«المقبوض» يضيف العروض ────────
drop function if exists public.range_summary(date, date, text);
create or replace function public.range_summary(p_from date, p_to date, p_station text default null)
returns table(day date, sales bigint, orders_count bigint, profit bigint,
              expenses bigint, net bigint, promo bigint, collected bigint)
language sql security definer set search_path = public as $$
  with st as (select id from stations where p_station is null or slug = p_station),
  s as (
    select o.business_day d,
           sum(o.subtotal - o.discount + o.extra)::bigint sales,
           count(distinct o.group_no)::bigint cnt,
           sum(o.subtotal - o.discount + o.extra - o.cost_total)::bigint profit,
           sum(o.promo_adjust)::bigint promo
    from orders o
    where o.status = 'paid' and o.business_day between p_from and p_to
      and (p_station is null or o.station_id in (select id from st))
    group by o.business_day
  ), e as (
    select business_day d, sum(amount)::bigint expenses
    from expenses
    where business_day between p_from and p_to
      and (p_station is null or station_id in (select id from st))
    group by business_day
  )
  select g::date,
         coalesce(s.sales, 0), coalesce(s.cnt, 0), coalesce(s.profit, 0),
         coalesce(e.expenses, 0), coalesce(s.profit, 0) - coalesce(e.expenses, 0),
         coalesce(s.promo, 0), coalesce(s.sales, 0) + coalesce(s.promo, 0)
  from generate_series(p_from, p_to, interval '1 day') g
  left join s on s.d = g::date
  left join e on e.d = g::date
  order by g;
$$;
revoke all on function public.range_summary(date, date, text) from public;
grant execute on function public.range_summary(date, date, text) to service_role;

-- ── pay_order_group يُرجع المقبوض شاملاً العرض ─────────────────────────────
-- الخصم والإضافة يُوزَّعان على الأقسام كما هما؛ العرض لا يُوزَّع لأنه على المحل.
create or replace function public.group_promo(p_group int, p_day date default null)
returns int language sql security definer set search_path = public as $$
  select coalesce(sum(promo_adjust), 0)::int from orders
  where group_no = p_group
    and business_day = coalesce(p_day, (now() at time zone 'Asia/Baghdad')::date);
$$;
revoke execute on function public.group_promo(int, date) from anon;
