-- 0046_cost_coverage.sql — هل رقم الربح صادق؟
--
-- الربح = المبيعات − كلفة البضاعة. وثمانون صنفاً من تسعين كلفتها صفر، فالرقم
-- المعروض يساوي المبيعات تقريباً لا الربح. ورقم خاطئ أسوأ من رقم غائب: قرار
-- تسعير يُبنى عليه يكون مبنياً على وهم.
--
-- هذه الدالة تقيس **نسبة قيمة المبيعات التي تُعرف كلفتها**. حين تبلغ المئة
-- يُعرض الربح، ودونها يُستبدل بتنبيه. ولا إعداد يدوي: الرقم يعود وحده كلما
-- اكتملت الكلف.

create or replace function public.cost_coverage(p_from date, p_to date)
returns table(covered_value bigint, total_value bigint, pct int, missing_items bigint)
language sql security definer set search_path = public as $$
  with sold as (
    select oi.line_total, oi.unit_cost, oi.item_id
    from order_items oi
    join orders o on o.id = oi.order_id
    where o.status = 'paid' and o.business_day between p_from and p_to
  )
  select
    coalesce(sum(line_total) filter (where unit_cost > 0), 0)::bigint,
    coalesce(sum(line_total), 0)::bigint,
    case when coalesce(sum(line_total), 0) = 0 then 100
         else round(100.0 * coalesce(sum(line_total) filter (where unit_cost > 0), 0) / sum(line_total))::int
    end,
    count(distinct item_id) filter (where unit_cost = 0)::bigint
  from sold;
$$;
revoke all on function public.cost_coverage(date, date) from anon, authenticated;
grant execute on function public.cost_coverage(date, date) to service_role;
