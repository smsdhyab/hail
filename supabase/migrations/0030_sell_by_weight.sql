-- 0030_sell_by_weight.sql — البيع بالوزن
--
-- بعض المعجنات تُباع بالكيلو لا بالقطعة. النموذج:
--   qty        = الكمية، وتصير كسرية: ٠٫٣٥٠ تعني ٣٥٠ غراماً
--   unit_price = يبقى صحيحاً، ومعناه لصنف موزون **سعر الكيلو**
--   line_total = round(qty × unit_price)
--
-- ٣٥٠ غم × ٢٥٬٠٠٠ للكيلو ← round(0.350 × 25000) = ٨٬٧٥٠ دينار.
-- وأصناف القطعة لا تتأثر: 2.000 × 1500 = 3000 كما كانت.
--
-- رُفض البديل «خزّن سعر الغرام صحيحاً»: سعر كيلو لا يقبل القسمة على ١٠٠٠
-- (٢٥٬٥٠٠ مثلاً) يخسر حتى ٩٩٩ ديناراً في الكيلو صامتاً عند كل بيعة.
--
-- التوقيت مقصود: `order_items` فارغ الآن، فتحويل نوع عمود الكمية بلا أي خطر
-- على بيانات قائمة. تأجيلها حتى تمتلئ الجداول يجعلها هجرة محفوفة.

-- ── ١) كيف يُباع الصنف ──────────────────────────────────────────────────────
alter table public.menu_items add column if not exists sold_by text not null default 'piece';
alter table public.menu_items drop constraint if exists menu_items_sold_by_chk;
alter table public.menu_items add constraint menu_items_sold_by_chk check (sold_by in ('piece', 'weight'));
-- وحدة العرض على الشاشة والوصل؛ «كغم» افتراضاً للموزون
alter table public.menu_items add column if not exists unit_label text;

-- المنيو العام يحتاج معرفة ذلك ليكتب «السعر/كغم» ويطلب وزناً بدل عدد
drop view if exists public.menu_public;
create view public.menu_public as
  select mi.id, mi.category_id, mi.name_ar, mi.description_ar, mi.image_url,
         mi.price, mi.flavors, mi.sort,
         mi.sold_by, coalesce(mi.unit_label, case when mi.sold_by = 'weight' then 'كغم' else 'قطعة' end) as unit_label,
         c.name_ar as category_name, c.image_url as category_image, c.sort as category_sort,
         s.slug as station_slug
  from public.menu_items mi
  join public.categories c on c.id = mi.category_id
  left join public.stations s on s.id = c.station_id
  where mi.is_active and c.is_active;
grant select on public.menu_public to anon, authenticated;

-- ── ٢) الكمية تصير كسرية ────────────────────────────────────────────────────
-- line_total عمود محسوب، فلا يمكن تغيير نوع qty تحته — يُسقَط ويُعاد بناؤه
-- بالتقريب، وإلا صار مجموع السطر كسرياً والدينار العراقي لا كسور فيه.
alter table public.order_items drop column if exists line_total;
alter table public.order_items alter column qty type numeric(10,3);
alter table public.order_items alter column qty set default 1;
alter table public.order_items add column line_total int
  generated always as (round(qty * unit_price)::int) stored;

-- ── ٣) المخزون بالوزن أيضاً ─────────────────────────────────────────────────
-- خصم ٣٥٠ غراماً من رصيد صحيح كان يقرّبها إلى صفر: الرصيد لا ينقص أبداً
-- ويبقى الصنف «متوفراً» بعد نفاده.
-- العرض يقرأ العمودين، وبوستغرس يرفض تغيير نوع عمود يعتمد عليه عرض
drop view if exists public.inventory_view;
alter table public.inventory alter column qty type numeric(10,3);
alter table public.inventory alter column low_at type numeric(10,3);
create view public.inventory_view as
  select i.item_id, mi.name_ar, c.name_ar as category_name, s.slug as station_slug,
         i.qty, coalesce(mi.unit_label, case when mi.sold_by = 'weight' then 'كغم' else i.unit end) as unit,
         i.low_at, (i.qty <= i.low_at) as is_low, i.updated_at
  from public.inventory i
  join public.menu_items mi on mi.id = i.item_id
  join public.categories c on c.id = mi.category_id
  left join public.stations s on s.id = c.station_id;
grant select on public.inventory_view to authenticated;

create or replace function public.deduct_inventory_on_paid()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    update inventory inv set
      qty = greatest(0, inv.qty - agg.sold),
      updated_at = now()
    from (
      select item_id, sum(qty) sold          -- بلا ::int: الوزن يُخصم كما هو
      from order_items where order_id = new.id and item_id is not null
      group by item_id
    ) agg
    where inv.item_id = agg.item_id;
  end if;
  return new;
end $$;

drop function if exists public.adjust_stock(uuid, int, int);
create or replace function public.adjust_stock(p_item uuid, p_delta numeric default null, p_set numeric default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_qty numeric;
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
revoke execute on function public.adjust_stock(uuid, numeric, numeric) from anon;

-- «القطع المباعة» ≈ عدد الزبائن. بيعة بالوزن تُعدّ بيعة واحدة، فـ٣٥٠ غراماً
-- بجمعها الخام تساوي صفراً بعد التقريب — أي زبون لا يُحسب.
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
    select ord.business_day d,
           sum(case when mi.sold_by = 'weight' then 1 else oi.qty end)::bigint pieces
    from order_items oi
    join orders ord on ord.id = oi.order_id
    left join menu_items mi on mi.id = oi.item_id
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

create or replace function public.table_popularity(p_from date, p_to date)
returns table(table_no text, tickets bigint, sales bigint, guests bigint)
language sql security definer set search_path = public as $$
  select o.table_no,
         count(distinct o.group_no)::bigint,
         sum(o.subtotal - o.discount + o.extra)::bigint,
         coalesce((select sum(case when mi.sold_by = 'weight' then 1 else oi.qty end)
                   from order_items oi
                   join orders o2 on o2.id = oi.order_id
                   left join menu_items mi on mi.id = oi.item_id
                   where o2.table_no = o.table_no and o2.status = 'paid'
                     and o2.business_day between p_from and p_to), 0)::bigint
  from orders o
  where o.status = 'paid' and o.table_no is not null
    and o.business_day between p_from and p_to
  group by o.table_no
  order by 2 desc, 3 desc;
$$;
revoke all on function public.table_popularity(date, date) from anon, authenticated;

-- ── ٤) place_order يقبل كمية كسرية ──────────────────────────────────────────
-- الحدّ الأدنى ١ غرام لا قطعة واحدة، وإلا رُفع كل وزن أقل من كيلو إلى كيلو.
create or replace function public.place_order(
  p_channel public.order_channel,
  p_lines jsonb,
  p_customer uuid default null,
  p_table text default null,
  p_note text default null,
  p_combos jsonb default '[]'::jsonb,
  p_address text default null,
  p_geo text default null,
  p_deliver_at text default null
) returns table(order_id uuid, order_seq int, group_no int, station_slug text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_day date := (now() at time zone 'Asia/Baghdad')::date;
  v_group int;
  v_cashier uuid;
  v_table text := nullif(trim(coalesce(p_table, '')), '');
  v_note text := nullif(left(trim(coalesce(p_note, '')), 300), '');
  v_address text := nullif(left(trim(coalesce(p_address, '')), 300), '');
  v_geo text := nullif(left(trim(coalesce(p_geo, '')), 300), '');
  v_deliver text := nullif(left(trim(coalesce(p_deliver_at, '')), 60), '');
  v_floor int;
  v_line jsonb;
  v_item public.menu_items;
  v_variant public.item_variants;
  v_station uuid;
  v_qty numeric;
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

  if p_channel = 'delivery' then v_table := null; end if;

  select e.id into v_cashier from employees e
    where e.auth_user_id = auth.uid() and e.is_active limit 1;

  select t.floor into v_floor from cafe_tables t where t.name = v_table;

  insert into order_counters(business_day, scope, last_seq) values (v_day, 'group', 1)
    on conflict (business_day, scope) do update set last_seq = order_counters.last_seq + 1
    returning last_seq into v_group;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_variant := null;

    select * into v_item from menu_items where id = (v_line->>'item_id')::uuid and is_active;
    if not found then raise exception 'item not available: %', v_line->>'item_id'; end if;

    -- صنف القطعة يبقى بأعداد صحيحة مهما أُرسل، والموزون يقبل الكسر
    v_qty := coalesce((v_line->>'qty')::numeric, 1);
    if v_item.sold_by = 'weight' then
      v_qty := greatest(0.001, round(v_qty, 3));
    else
      v_qty := greatest(1, round(v_qty));
    end if;

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
                         customer_id, cashier_id, table_no, floor, note,
                         address, geo, deliver_at)
        values (v_day, v_seq, v_group, v_station, p_channel, 'pending',
                p_customer, v_cashier, v_table, v_floor, v_note,
                v_address, v_geo, v_deliver);
      select id into v_order from orders
        where business_day = v_day and group_no = v_group and station_id = v_station;

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
    -- الكلفة تُقرَّب مرة واحدة على الطلب لا على كل سطر
    cost_total = (select coalesce(round(sum(qty * unit_cost)), 0)::int from order_items where order_id = o.id)
    where o.business_day = v_day and o.group_no = v_group;

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

revoke execute on function public.place_order(public.order_channel, jsonb, uuid, text, text, jsonb, text, text, text) from public;
grant execute on function public.place_order(public.order_channel, jsonb, uuid, text, text, jsonb, text, text, text) to anon, authenticated;
