-- 0032_settings_delivery_fee.sql — إعدادات يضبطها المدير، وأولها أجرة التوصيل
--
-- الأجرة لا تُكتب في الكود: تتغيّر بتغيّر الوقود والمسافة، وتغييرها يجب أن يكون
-- ضغطة في لوحة التحكم لا نشرة برمجية جديدة.
--
-- أين تُقيَّد؟ ليست مبيعات كافيه ولا مبيعات معجنات — الزبون يدفعها مقابل
-- التوصيل لا مقابل بضاعة. فتُسجَّل مركزياً على المجموعة كما يُسجَّل فرق العرض
-- (promo_adjust)، ولا تدخل في «مبيعات القسم». وإلا ظهر دفتر المعجنات منتفخاً
-- بأجرة سائق لم يبع شيئاً مقابلها.
--
-- فتصير معادلة ما يدفعه الزبون:
--   Σ(أسطر الأقسام) + فرق العروض + أجرة التوصيل − الخصم + الإضافة

create table if not exists public.app_settings (
  key        text primary key,
  value      int  not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.app_settings(key, value) values ('delivery_fee', 0)
  on conflict (key) do nothing;

alter table public.app_settings enable row level security;

-- صفحة التوصيل عامة (بلا تسجيل دخول) وتحتاج قراءة الأجرة لتعرضها قبل الطلب.
-- القراءة مقصورة على المفاتيح العامة صراحةً، فإضافة مفتاح حسّاس لاحقاً لا
-- تنكشف تلقائياً للعالم.
drop policy if exists app_settings_public_read on public.app_settings;
create policy app_settings_public_read on public.app_settings
  for select using (key in ('delivery_fee'));
grant select on public.app_settings to anon, authenticated;

-- ── الأجرة على الطلب ────────────────────────────────────────────────────────
-- تُخزَّن على الطلب لا تُقرأ من الإعداد وقت التقرير: تغيير الأجرة غداً يجب ألا
-- يعيد كتابة تاريخ طلبات الأمس.
alter table public.orders add column if not exists delivery_fee int not null default 0;
grant select (delivery_fee) on public.orders to authenticated;

create or replace function public.set_setting(p_key text, p_value int)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'not authorized'; end if;
  insert into app_settings(key, value, updated_at) values (p_key, greatest(0, p_value), now())
    on conflict (key) do update set value = greatest(0, p_value), updated_at = now();
  return greatest(0, p_value);
end $$;
revoke execute on function public.set_setting(text, int) from anon;

-- ── التقارير تفصل الأجرة عن المبيعات ────────────────────────────────────────
drop function if exists public.range_summary(date, date, text);
create or replace function public.range_summary(p_from date, p_to date, p_station text default null)
returns table(day date, sales bigint, orders_count bigint, profit bigint,
              expenses bigint, net bigint, promo bigint, delivery bigint, collected bigint)
language sql security definer set search_path = public as $$
  with st as (select id from stations where p_station is null or slug = p_station),
  s as (
    select o.business_day d,
           sum(o.subtotal - o.discount + o.extra)::bigint sales,
           count(distinct o.group_no)::bigint cnt,
           sum(o.subtotal - o.discount + o.extra - o.cost_total)::bigint profit,
           sum(o.promo_adjust)::bigint promo,
           sum(o.delivery_fee)::bigint delivery
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
         coalesce(s.promo, 0), coalesce(s.delivery, 0),
         coalesce(s.sales, 0) + coalesce(s.promo, 0) + coalesce(s.delivery, 0)
  from generate_series(p_from, p_to, interval '1 day') g
  left join s on s.d = g::date
  left join e on e.d = g::date
  order by g;
$$;
revoke all on function public.range_summary(date, date, text) from public;
grant execute on function public.range_summary(date, date, text) to service_role;

create or replace function public.group_delivery_fee(p_group int, p_day date default null)
returns int language sql security definer set search_path = public as $$
  select coalesce(sum(delivery_fee), 0)::int from orders
  where group_no = p_group
    and business_day = coalesce(p_day, (now() at time zone 'Asia/Baghdad')::date);
$$;
revoke execute on function public.group_delivery_fee(int, date) from anon;

-- ── place_order يقيّد الأجرة على طلبات التوصيل ─────────────────────────────
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
  v_fee int := 0;
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

    insert into order_items(order_id, item_id, variant_id, name_ar, flavor_ar, qty, unit_price, unit_cost, sold_by)
      values (v_order, v_item.id, v_variant.id, v_name, v_flavor, v_qty, v_price, v_cost, v_item.sold_by);
  end loop;

  update orders o set
    subtotal   = (select coalesce(sum(line_total), 0) from order_items where order_id = o.id),
    cost_total = (select coalesce(round(sum(qty * unit_cost)), 0)::int from order_items where order_id = o.id)
    where o.business_day = v_day and o.group_no = v_group;

  -- أول قسم ترتيباً يحمل المبالغ المركزية، فيبقى جمعها في التقارير بلا ازدواج
  select o.id into v_first
    from orders o join stations s on s.id = o.station_id
    where o.business_day = v_day and o.group_no = v_group
    order by s.sort limit 1;

  if p_combos is not null and jsonb_array_length(p_combos) > 0 then
    select coalesce(sum(cp.price - cp.list_total), 0) into v_promo
      from combo_public cp
      where cp.slug in (select jsonb_array_elements_text(p_combos));
    if v_promo <> 0 then
      update orders set promo_adjust = v_promo where id = v_first;
    end if;
  end if;

  if p_channel = 'delivery' then
    -- الأجرة السارية لحظة الطلب، وتبقى مثبّتة عليه بعدها
    select coalesce(value, 0) into v_fee from app_settings where key = 'delivery_fee';
    if coalesce(v_fee, 0) > 0 then
      update orders set delivery_fee = v_fee where id = v_first;
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
