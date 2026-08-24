-- 0037_developer.sql — علامة المطوّر
--
-- المطوّر مديرٌ ومعه صفحة الأجهزة والفحص. جُعلت **علامة** لا دوراً ثالثاً عمداً:
-- الدور يُفحص في خمسة عشر موضعاً في النظام، وإضافة دور جديد تعني مراجعتها كلها
-- وترك واحد منها بلا تحديث يعني باباً مفتوحاً أو مغلقاً بالخطأ. أما العلامة
-- فتُضاف بلا أن يتغيّر شيء مما هو قائم.

alter table public.employees add column if not exists is_developer boolean not null default false;
grant select (is_developer) on public.employees to authenticated;
