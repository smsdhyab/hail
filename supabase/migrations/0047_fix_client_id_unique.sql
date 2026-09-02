-- 0047_fix_client_id_unique.sql — إصلاح: الطلب المشترك كان يفشل دائماً
--
-- حماية العمل بلا إنترنت تعطي كل طلب معرّفاً من الجهاز، ويمنع فهرس فريد تكراره
-- فلا تُسجَّل البيعة مرتين. لكن الفهرس وُضع على `client_id` وحده — والطلب
-- المشترك **صفّان** في `orders` (واحد لكل قسم) يحملان المعرّف نفسه.
--
-- فكانت النتيجة: أي طلب فيه معجّنة ومشروب معاً يُرفض بخطأ
-- `duplicate key value violates unique constraint`. الطلب من قسم واحد يمرّ،
-- والمشترك يسقط — وهو نصف بيع المحل.
--
-- الصواب: التفرّد على (المعرّف، القسم). صفّ واحد لكل قسم من التذكرة الواحدة:
-- الانقسام مسموح، وإعادة إرسال نفس التذكرة ما تزال مرفوضة.

drop index if exists public.orders_client_id_key;
create unique index if not exists orders_client_id_station_key
  on public.orders(client_id, station_id) where client_id is not null;

-- فهرس عادي للبحث السريع في حارس التكرار داخل place_order
create index if not exists orders_client_id_idx
  on public.orders(client_id) where client_id is not null;
