-- 0021_stations.sql — TWO CASH REGISTERS ON ONE SYSTEM
--
-- هيل runs a bakery counter and a cafe counter with completely separate books
-- and separate staff, sharing one menu, one database and one deployment.
--
-- The model:
--   • a CATEGORY belongs to a STATION, and an item inherits its category's
--     station — that inheritance is the entire routing rule;
--   • one customer order SPLITS into one `orders` row per station, all sharing
--     `group_no` (the number the customer is given);
--   • the customer pays ONCE: `pay_order_group` settles the whole group and
--     prorates the discount/surcharge across the stations by subtotal, so the
--     parts always add back up to what was handed over;
--   • `collected_by_station_id` records which DRAWER took the cash, which is a
--     different question from which station EARNED the money.
--
-- Mirrors src/lib/cafe/station.ts and src/lib/cafe/local-db.ts. Idempotent.

-- ── stations ────────────────────────────────────────────────────────────────
create table if not exists public.stations (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug in ('pastry', 'cafe')),
  name_ar    text not null,
  sort       int not null default 0,
  created_at timestamptz not null default now()
);

insert into public.stations (slug, name_ar, sort) values
  ('pastry', 'المعجنات والمخبوزات', 1),
  ('cafe',   'الكافيه',            2)
on conflict (slug) do update set name_ar = excluded.name_ar, sort = excluded.sort;

alter table public.stations enable row level security;
drop policy if exists stations_read on public.stations;
create policy stations_read on public.stations for select using (true);
grant select on public.stations to anon, authenticated;

-- ── ownership columns ───────────────────────────────────────────────────────
alter table public.categories        add column if not exists station_id uuid references public.stations(id);
alter table public.employees         add column if not exists station_id uuid references public.stations(id);
alter table public.expenses          add column if not exists station_id uuid references public.stations(id);
alter table public.register_closures add column if not exists station_id uuid references public.stations(id);
alter table public.cafe_tables       add column if not exists floor int not null default 1;

alter table public.orders add column if not exists station_id uuid references public.stations(id);
alter table public.orders add column if not exists collected_by_station_id uuid references public.stations(id);
alter table public.orders add column if not exists group_no int;
-- the floor is delivery information, snapshotted from the table at order time
alter table public.orders add column if not exists floor int;

-- Existing single-register data predates the split: park it all on the cafe
-- side and give each old order its own group so nothing looks merged.
update public.categories set station_id = (select id from public.stations where slug = 'cafe') where station_id is null;
update public.orders      set station_id = (select id from public.stations where slug = 'cafe') where station_id is null;
update public.orders      set group_no = order_seq where group_no is null;

alter table public.orders alter column station_id set not null;
alter table public.orders alter column group_no  set not null;

-- The daily sequence used to be unique per DAY. It is now unique per DAY *and
-- REGISTER*, because each register numbers its own receipts from 1 — without
-- this swap the second station's order #1 collides with the first station's.
alter table public.orders drop constraint if exists orders_business_day_order_seq_key;
create unique index if not exists orders_day_station_seq_key
  on public.orders (business_day, station_id, order_seq);
-- one row per register per ticket
create unique index if not exists orders_day_group_station_key
  on public.orders (business_day, group_no, station_id);

create index if not exists orders_station_day_idx on public.orders (station_id, business_day, status);
create index if not exists orders_group_day_idx   on public.orders (business_day, group_no);

grant select (station_id, group_no, collected_by_station_id, floor) on public.orders to authenticated;
grant select (station_id) on public.categories to anon, authenticated;

-- ── per-station daily numbering ─────────────────────────────────────────────
-- One counter row per (day, scope): 'group' for the customer-facing ticket
-- number, and one per station slug for that register's own receipt sequence.
alter table public.order_counters add column if not exists scope text not null default 'group';
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'order_counters_pkey' and conrelid = 'public.order_counters'::regclass
  ) then
    alter table public.order_counters drop constraint order_counters_pkey;
  end if;
end $$;
alter table public.order_counters add primary key (business_day, scope);

-- ── menu_public gains the station slug ──────────────────────────────────────
drop view if exists public.menu_public;
create view public.menu_public as
  select mi.id, mi.category_id, mi.name_ar, mi.description_ar, mi.image_url,
         mi.price, mi.flavors, mi.sort,
         c.name_ar as category_name, c.image_url as category_image, c.sort as category_sort,
         s.slug as station_slug
  from public.menu_items mi
  join public.categories c on c.id = mi.category_id
  left join public.stations s on s.id = c.station_id
  where mi.is_active and c.is_active;
grant select on public.menu_public to anon, authenticated;

-- ── place_order: split the lines across the registers ───────────────────────
drop function if exists public.place_order(public.order_channel, jsonb, uuid, text, text);

create or replace function public.place_order(
  p_channel public.order_channel,
  p_lines jsonb,
  p_customer uuid default null,
  p_table text default null,
  p_note text default null
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
  -- station_id → the order row already opened for it on this ticket
  v_orders jsonb := '{}'::jsonb;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'empty order';
  end if;

  select e.id into v_cashier from employees e
    where e.auth_user_id = auth.uid() and e.is_active limit 1;  -- null for anon self-orders

  select t.floor into v_floor from cafe_tables t where t.name = v_table;

  -- the number the customer is given, shared by every register on this ticket
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

    -- the item's register, inherited from its category
    select c.station_id into v_station from categories c where c.id = v_item.category_id;
    if v_station is null then
      select id into v_station from stations where slug = 'cafe';
    end if;

    -- open this register's order for the ticket the first time it is needed
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

  return query
    select o.id, o.order_seq, o.group_no, s.slug
    from orders o join stations s on s.id = o.station_id
    where o.business_day = v_day and o.group_no = v_group
    order by s.sort;
end $$;

revoke execute on function public.place_order(public.order_channel, jsonb, uuid, text, text) from public;
grant execute on function public.place_order(public.order_channel, jsonb, uuid, text, text) to anon, authenticated;

-- ── pay_order_group: ONE payment, prorated onto both sets of books ──────────
create or replace function public.pay_order_group(
  p_group int,
  p_day date default null,
  p_discount int default 0,
  p_extra int default 0,
  p_extra_note text default null,
  p_customer uuid default null,
  p_award_points int default 0,
  p_collected_by text default null
) returns table(order_id uuid, station_slug text, net int)
language plpgsql security definer set search_path = public as $$
declare
  v_day date := coalesce(p_day, (now() at time zone 'Asia/Baghdad')::date);
  v_gross bigint;
  v_disc int;
  v_extra int := greatest(0, coalesce(p_extra, 0));
  v_note text := nullif(trim(coalesce(p_extra_note, '')), '');
  v_till uuid;
  v_cust uuid;
  v_rest_disc int;
  v_rest_extra int;
  r record;
begin
  if not is_staff() then raise exception 'not authorized'; end if;

  select coalesce(sum(subtotal), 0) into v_gross
    from orders where business_day = v_day and group_no = p_group and status = 'pending';
  if v_gross is null then raise exception 'order not pending'; end if;

  -- a discount never takes the payment below zero
  v_disc := least(greatest(0, coalesce(p_discount, 0)), v_gross);
  select id into v_till from stations where slug = p_collected_by;

  -- Largest-remainder proration: floor each share, then hand the leftover
  -- dinars to the biggest subtotals. Guarantees sum(parts) = the amount, so
  -- the two registers' books always reconcile against the cash taken.
  v_rest_disc := v_disc;
  v_rest_extra := v_extra;

  for r in
    select o.id, o.subtotal,
           case when v_gross > 0 then (v_disc::bigint  * o.subtotal) / v_gross else 0 end as d_floor,
           case when v_gross > 0 then (v_extra::bigint * o.subtotal) / v_gross else 0 end as e_floor,
           row_number() over (order by o.subtotal desc, o.id) as rank
    from orders o
    where o.business_day = v_day and o.group_no = p_group and o.status = 'pending'
    order by o.subtotal desc, o.id
  loop
    v_rest_disc  := v_rest_disc  - r.d_floor;
    v_rest_extra := v_rest_extra - r.e_floor;
    update orders set
      discount = r.d_floor,
      extra    = r.e_floor,
      extra_note = v_note,
      status = 'paid',
      paid_at = now(),
      collected_by_station_id = coalesce(v_till, collected_by_station_id),
      customer_id = coalesce(p_customer, customer_id)
      where id = r.id;
    -- the first (largest) row absorbs whatever the flooring left over
    if r.rank = 1 then
      update orders set discount = discount + v_rest_disc, extra = extra + v_rest_extra where id = r.id;
      v_rest_disc := 0;
      v_rest_extra := 0;
    end if;
  end loop;

  -- loyalty is shop-wide (one card, one customer), awarded once per ticket
  select o.customer_id into v_cust
    from orders o where o.business_day = v_day and o.group_no = p_group and o.customer_id is not null limit 1;
  if v_cust is not null and coalesce(p_award_points, 0) > 0 then
    insert into loyalty_events(customer_id, order_id, delta, reason)
      select v_cust, o.id, p_award_points, 'earn_order'
      from orders o where o.business_day = v_day and o.group_no = p_group
      order by o.order_seq limit 1
      on conflict (order_id) where reason = 'earn_order' do nothing;
  end if;

  return query
    select o.id, s.slug, (o.subtotal - o.discount + o.extra)
    from orders o join stations s on s.id = o.station_id
    where o.business_day = v_day and o.group_no = p_group
    order by s.sort;
end $$;
revoke execute on function public.pay_order_group(int, date, int, int, text, uuid, int, text) from anon;

-- ── cancel the whole ticket ─────────────────────────────────────────────────
create or replace function public.cancel_order_group(p_group int, p_day date default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_day date := coalesce(p_day, (now() at time zone 'Asia/Baghdad')::date);
begin
  if not is_staff() then raise exception 'not authorized'; end if;
  update orders set status = 'cancelled'
    where business_day = v_day and group_no = p_group and status = 'pending';
end $$;
revoke execute on function public.cancel_order_group(int, date) from anon;

-- ── range_summary gains a station filter ────────────────────────────────────
-- Null = the whole shop (manager). A slug = that register's books only.
-- orders_count counts TICKETS, not order rows, so a split order isn't double
-- counted in the shop-wide view.
drop function if exists public.range_summary(date, date);
create or replace function public.range_summary(p_from date, p_to date, p_station text default null)
returns table(day date, sales bigint, orders_count bigint, profit bigint, expenses bigint, net bigint)
language sql security definer set search_path = public as $$
  with st as (select id from stations where p_station is null or slug = p_station),
  s as (
    select o.business_day d,
           sum(o.subtotal - o.discount + o.extra)::bigint sales,
           count(distinct o.group_no)::bigint cnt,
           sum(o.subtotal - o.discount + o.extra - o.cost_total)::bigint profit
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
         coalesce(e.expenses, 0), coalesce(s.profit, 0) - coalesce(e.expenses, 0)
  from generate_series(p_from, p_to, interval '1 day') g
  left join s on s.d = g::date
  left join e on e.d = g::date
  order by g;
$$;
revoke all on function public.range_summary(date, date, text) from public;
grant execute on function public.range_summary(date, date, text) to service_role;

-- ── the floor plan carries the storey ───────────────────────────────────────
create or replace function public.save_cafe_tables(p_tables jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from cafe_tables where true;  -- explicit WHERE: pooler blocks unqualified DELETE
  insert into cafe_tables(name, kind, floor, active, pos_x, pos_y, sort)
  select distinct on (trim(x->>'name'))
    trim(x->>'name'),
    case when x->>'kind' = 'outdoor' then 'outdoor' else 'indoor' end,
    greatest(1, coalesce(nullif(x->>'floor','')::int, 1)),
    coalesce((x->>'active')::boolean, true),
    greatest(0, least(100, coalesce(nullif(x->>'pos_x','')::real, 50))),
    greatest(0, least(100, coalesce(nullif(x->>'pos_y','')::real, 50))),
    coalesce(nullif(x->>'sort','')::int, 0)
  from jsonb_array_elements(p_tables) x
  where coalesce(trim(x->>'name'), '') <> ''
  order by trim(x->>'name'), coalesce(nullif(x->>'sort','')::int, 0);
end $$;
revoke all on function public.save_cafe_tables(jsonb) from anon, authenticated;
