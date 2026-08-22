-- 0024_fix_group_proration.sql — إصلاح توزيع الخصم بين الكاشيرين
--
-- الخلل: كانت الدالة توزّع الخصم داخل حلقة، وتضيف «الباقي» إلى أول صف قبل أن
-- تكون قد طرحت أنصبة بقية الصفوف — فيخرج الباقي أكبر مما يجب.
--   مثال حقيقي: فاتورة 10,500 بخصم 1,000
--     المعجنات 7,000 → أخذت خصم 1,000  (والصحيح 667)
--     الكافيه  3,500 → أخذت خصم 333
--     المجموع 1,333 بدل 1,000 → صافي الأقسام 9,167 والزبون دفع 9,500. فرق 333.
--
-- الإصلاح: جملة UPDATE واحدة. تُحسب الأنصبة الصحيحة (floor) لكل الصفوف، ثم
-- يُجمع ما نقص عن المبلغ ويُضاف كاملاً إلى الصف صاحب المجموع الأكبر. صحيحة
-- بالبناء: مجموع الأنصبة = المبلغ دائماً، بلا حلقة وبلا حالة متراكمة.
--
-- نفس منطق prorate() في src/lib/cafe/station.ts المغطّى باختبارات.

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
begin
  if not is_staff() then raise exception 'not authorized'; end if;

  select coalesce(sum(subtotal), 0) into v_gross
    from orders where business_day = v_day and group_no = p_group and status = 'pending';
  if not found or v_gross is null then raise exception 'order not pending'; end if;

  -- a discount never takes the payment below zero
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
    -- the biggest bill absorbs whatever the flooring left over, so the parts
    -- always add back up to exactly what the customer handed over
    discount = (b.d_floor + case when b.rnk = 1 then v_disc  - t.sd else 0 end)::int,
    extra    = (b.e_floor + case when b.rnk = 1 then v_extra - t.se else 0 end)::int,
    extra_note = v_note,
    status = 'paid',
    paid_at = now(),
    collected_by_station_id = coalesce(v_till, o.collected_by_station_id),
    customer_id = coalesce(p_customer, o.customer_id)
  from base b, tot t
  where o.id = b.id;

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
