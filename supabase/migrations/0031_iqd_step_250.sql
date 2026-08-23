-- 0031_iqd_step_250.sql — أصغر فئة نقدية عراقية ٢٥٠ ديناراً
--
-- البيع بالوزن يولّد مبالغ لا وجود لها في الواقع: ٣٣٣ غم × ٢٥٬٥٠٠ للكيلو =
-- ٨٬٤٩٢ ديناراً، ولا يستطيع أحد دفعها ولا الكاشير إرجاع فرقها. المبالغ العراقية
-- تمشي على ٢٥٠: ٢٥٠ · ٥٠٠ · ٧٥٠ · ١٬٠٠٠ …
--
-- لذلك سطر الصنف الموزون يُقرَّب إلى أقرب ٢٥٠ ديناراً. أسطر القطعة تُترك كما هي
-- بالضبط: أسعارها مضبوطة أصلاً على ٢٥٠ (شاشة إدخال السعر تفرض ذلك)، وتقريبها
-- «احتياطاً» يعني أن سعراً مثل ١٬٣٠٠ يُخصم منه ١٠٠ في كل بيعة بصمت.
--
-- ولأن العمود محسوب، لا يستطيع قراءة menu_items — فطريقة البيع تُنسخ على السطر
-- وقت الإدخال. وهذا مطلوب أصلاً: وصل قديم يجب أن يبقى معبّراً عن طريقة بيعه
-- يومها حتى لو حُوّل الصنف لاحقاً من الوزن إلى القطعة.

alter table public.order_items add column if not exists sold_by text not null default 'piece';
alter table public.order_items drop constraint if exists order_items_sold_by_chk;
alter table public.order_items add constraint order_items_sold_by_chk check (sold_by in ('piece', 'weight'));

alter table public.order_items drop column if exists line_total;
alter table public.order_items add column line_total int
  generated always as (
    case
      when sold_by <> 'weight' then round(qty * unit_price)::int
      when qty * unit_price <= 0 then 0
      -- وزن ضئيل جداً كان يُقرَّب إلى صفر فيخرج الصنف مجاناً
      else greatest(250, round(qty * unit_price / 250.0) * 250)::int
    end
  ) stored;

grant select (sold_by) on public.order_items to authenticated;

-- place_order ينسخ طريقة البيع على السطر
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
