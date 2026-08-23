-- 0034_fix_pay_ambiguous.sql — «column reference "order_id" is ambiguous»
--
-- الدالة تُرجع TABLE(order_id …)، فاسم order_id صار متغيّراً داخلها. وحين
-- يصل التنفيذ إلى `on conflict (order_id)` في قيد الولاء لا يعرف بوستغرس أيّ
-- order_id يقصد — عمود الجدول أم متغيّر الخرج — فيفشل الدفع كاملاً.
--
-- الخلل كامن منذ البداية ولا يظهر إلا حين تحمل التذكرة بطاقة ولاء بنقاط،
-- فمساره لا يُنفَّذ إلا حينها. ظهر أول مرة عند دفع طلب توصيل باسم وهاتف.
--
-- `#variable_conflict use_column` يحسم الالتباس لصالح عمود الجدول — وهو
-- المقصود في كل موضع هنا.

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
    collected_by_station_id = coalesce(v_till, o.collected_by_station_id),
    customer_id = coalesce(p_customer, o.customer_id)
  from base b, tot t
  where o.id = b.id;

  select o.customer_id into v_cust
    from orders o where o.business_day = v_day and o.group_no = p_group and o.customer_id is not null limit 1;
  if v_cust is not null and coalesce(p_award_points, 0) > 0 then
    insert into loyalty_events(customer_id, order_id, delta, reason)
      select v_cust, o.id, p_award_points, 'earn_order'
      from orders o where o.business_day = v_day and o.group_no = p_group
      order by o.order_seq limit 1
      on conflict (order_id) where reason = 'earn_order' do nothing;
  end if;

  -- أجرة التوصيل تُضاف إلى صافي القسم الذي قُيّدت عليه: هي نقد مقبوض فعلاً،
  -- وبدونها لا يطابق مجموع ما تُرجعه الدالة ما وُضع في الدرج.
  return query
    select o.id, s.slug, (o.subtotal - o.discount + o.extra + o.promo_adjust + o.delivery_fee)
    from orders o join stations s on s.id = o.station_id
    where o.business_day = v_day and o.group_no = p_group
    order by s.sort;
end $$;
revoke all on function public.pay_order_group(int, date, int, int, text, uuid, int, text) from anon;
