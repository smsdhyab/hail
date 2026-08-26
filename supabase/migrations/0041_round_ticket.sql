-- 0041_round_ticket.sql — التقريب على إجمالي التذكرة لا على كل سطر
--
-- الدينار العراقي أصغر فئاته ٢٥٠، والبيع بالوزن يولّد مبالغ لا تُدفع:
-- ٤٠ غم برازق × ١٥٬٠٠٠ للكيلو = ٦٠٠ ديناراً.
--
-- كان كل سطر موزون يُقرَّب وحده. وتذكرة فيها ثلاثة أصناف موزونة تخسر ثلاث
-- مرات. الآن يُقرَّب **ما يدفعه الزبون مرة واحدة**: الأسطر تبقى بأرقامها
-- الحقيقية على الوصل، والفرق يظهر سطراً واحداً صريحاً في آخره.
--
-- والفرق يُقيَّد مركزياً كالعروض لا يُوزَّع على القسمين: مئتا دينار تقريب لا
-- تخصّ الكافيه ولا المعجنات، وتوزيعها يلوّث دفتريهما بما لم يبيعاه.

-- ــ ١) السطر يعود دقيقاً ــــــــــــــــــــــــــــــــــــــــــــــــــــــ
alter table public.order_items drop column if exists line_total;
alter table public.order_items add column line_total int
  generated always as (round(qty * unit_price)::int) stored;

-- ــ ٢) عمود فرق التقريب ــــــــــــــــــــــــــــــــــــــــــــــــــــــ
alter table public.orders add column if not exists round_adjust int not null default 0;
grant select (round_adjust) on public.orders to authenticated;

-- ــ ٣) أصغر فئة، في مكان واحد يعرفه الجميع ــــــــــــــــــــــــــــــــــ
create or replace function public.iqd_step() returns int
  language sql immutable as $$ select 250 $$;
grant execute on function public.iqd_step() to anon, authenticated;

-- ــ ٤) الدفع يقرّب الإجمالي ويقيّد الفرق ــــــــــــــــــــــــــــــــــــ
create or replace function public.pay_order_group(
  p_group int, p_day date default null, p_discount int default 0,
  p_extra int default 0, p_extra_note text default null,
  p_customer uuid default null, p_award_points int default 0,
  p_collected_by text default null
) returns table(order_id uuid, station_slug text, net int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_day date := coalesce(p_day, (now() at time zone 'Asia/Baghdad')::date);
  v_gross bigint;
  v_disc int;
  v_extra int := greatest(0, coalesce(p_extra, 0));
  v_note text := nullif(trim(coalesce(p_extra_note, '')), '');
  v_till uuid;
  v_cust uuid;
  v_raw bigint;
  v_round int;
  v_first uuid;
  v_step int := iqd_step();
begin
  if not is_staff() then raise exception 'not authorized'; end if;

  select coalesce(sum(subtotal), 0) into v_gross
    from orders where business_day = v_day and group_no = p_group and status = 'pending';
  if not found or v_gross is null then raise exception 'order not pending'; end if;

  v_disc := least(greatest(0, coalesce(p_discount, 0)), v_gross);
  select id into v_till from stations where slug = p_collected_by;

  with base as (
    select o.id, o.subtotal,
           case when v_gross > 0 then (v_disc::bigint  * o.subtotal) / v_gross else 0 end as d_floor,
           case when v_gross > 0 then (v_extra::bigint * o.subtotal) / v_gross else 0 end as e_floor,
           row_number() over (order by o.subtotal desc, o.id) as rnk
    from orders o
    where o.business_day = v_day and o.group_no = p_group and o.status = 'pending'
  ), tot as (
    select coalesce(sum(d_floor), 0) sd, coalesce(sum(e_floor), 0) se from base
  )
  update orders o set
    discount = (b.d_floor + case when b.rnk = 1 then v_disc  - t.sd else 0 end)::int,
    extra    = (b.e_floor + case when b.rnk = 1 then v_extra - t.se else 0 end)::int,
    extra_note = v_note,
    status = 'paid',
    paid_at = now(),
    collected_by_station_id = coalesce(v_till, o.station_id),
    customer_id = coalesce(p_customer, o.customer_id)
  from base b, tot t
  where o.id = b.id;

  -- ما يدفعه الزبون قبل التقريب، ثم أقرب مضاعف لـ٢٥٠
  select coalesce(sum(o.subtotal - o.discount + o.extra + o.promo_adjust + o.delivery_fee), 0)
    into v_raw
    from orders o where o.business_day = v_day and o.group_no = p_group;

  v_round := (round(v_raw::numeric / v_step) * v_step - v_raw)::int;
  -- مبلغ ضئيل لا يُقرَّب إلى صفر فتخرج البضاعة مجاناً
  if v_raw > 0 and v_raw + v_round <= 0 then v_round := v_step - v_raw; end if;

  if v_round <> 0 then
    select o.id into v_first
      from orders o join stations s on s.id = o.station_id
      where o.business_day = v_day and o.group_no = p_group
      order by s.sort limit 1;
    update orders set round_adjust = v_round where id = v_first;
  end if;

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
    select o.id, s.slug,
           (o.subtotal - o.discount + o.extra + o.promo_adjust + o.delivery_fee + o.round_adjust)
    from orders o join stations s on s.id = o.station_id
    where o.business_day = v_day and o.group_no = p_group
    order by s.sort;
end $$;
revoke all on function public.pay_order_group(int, date, int, int, text, uuid, int, text) from anon;

-- ــ ٥) التقارير: المقبوض يشمل فرق التقريب ــــــــــــــــــــــــــــــــــ
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
           sum(o.promo_adjust + o.round_adjust)::bigint promo
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
