-- 0001_init.sql — HAIL cafe schema: enums, tables, indexes, points trigger.
-- Idempotent: safe to re-run. Money is integer IQD (no minor unit); SUM() promotes
-- to bigint. business_day = Asia/Baghdad calendar day.
-- Apply with: npm run db:apply supabase/migrations/0001_init.sql

create extension if not exists pgcrypto;

-- ── enums ──────────────────────────────────────────────────────────────────
do $$ begin
  create type public.order_channel as enum ('qr','kiosk','cashier');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_status as enum ('pending','paid','cancelled','refunded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.variant_kind as enum ('size','flavor');
exception when duplicate_object then null; end $$;

-- ── staff / auth ───────────────────────────────────────────────────────────
create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null,
  name_en text not null,                 -- 'admin' | 'cashier' (resolved by is_admin())
  created_at timestamptz not null default now()
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null,
  role_id uuid references public.roles(id) on delete set null,
  auth_user_id uuid references auth.users(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists employees_auth_user_id_idx on public.employees(auth_user_id);

-- ── menu ───────────────────────────────────────────────────────────────────
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null,
  image_url text,
  sort int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete restrict,
  name_ar text not null,
  description_ar text,
  image_url text,
  price int not null default 0 check (price >= 0),      -- SELL price (base, when no size variant)
  cost int not null default 0 check (cost >= 0),        -- SENSITIVE: never granted to anon/authenticated
  flavors text[] not null default '{}',                 -- free same-price options e.g. {كراميل,فانيلا,بندق}
  is_active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists menu_items_category_id_idx on public.menu_items(category_id);

create table if not exists public.item_variants (       -- PRICED options only (sizes صغير/وسط)
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.menu_items(id) on delete cascade,
  kind public.variant_kind not null default 'size',
  name_ar text not null,                                -- 'صغير' / 'وسط'
  price_override int check (price_override >= 0),        -- null ⇒ inherit item.price
  cost_override int check (cost_override >= 0),          -- SENSITIVE; null ⇒ inherit item.cost
  is_active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists item_variants_item_id_idx on public.item_variants(item_id);

-- ── loyalty customers (referenced by orders) ───────────────────────────────
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  card_serial text not null unique default encode(gen_random_bytes(8), 'hex'), -- unguessable QR payload
  phone text unique,                                    -- PII
  name_ar text,
  points int not null default 0,                        -- DENORMALIZED cache; ledger is source of truth
  created_at timestamptz not null default now()
);

-- ── orders ─────────────────────────────────────────────────────────────────
create table if not exists public.order_counters (     -- daily order-number sequence
  business_day date primary key,
  last_seq int not null default 0
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  business_day date not null default (now() at time zone 'Asia/Baghdad')::date,
  order_seq int not null,                               -- 1..N per business_day; UI shows lpad(_,3,'0')
  channel public.order_channel not null,
  status public.order_status not null default 'pending',
  subtotal int not null default 0,                      -- snapshot Σ line_total (sell)
  cost_total int not null default 0,                    -- SENSITIVE snapshot Σ qty*unit_cost
  discount int not null default 0 check (discount >= 0),
  table_no text,
  note text,
  customer_id uuid references public.customers(id) on delete set null,
  cashier_id uuid references public.employees(id) on delete set null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_day, order_seq)
);
create index if not exists orders_business_day_idx on public.orders(business_day);
create index if not exists orders_status_idx on public.orders(status);
create index if not exists orders_customer_id_idx on public.orders(customer_id);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  item_id uuid references public.menu_items(id) on delete set null,
  variant_id uuid references public.item_variants(id) on delete set null,
  name_ar text not null,                                -- snapshot of item(+size) name at sale
  flavor_ar text,                                       -- chosen free flavor snapshot
  qty int not null check (qty > 0),
  unit_price int not null check (unit_price >= 0),      -- snapshot effective sell
  unit_cost int not null default 0,                     -- SENSITIVE snapshot
  line_total int generated always as (qty * unit_price) stored,
  created_at timestamptz not null default now()
);
create index if not exists order_items_order_id_idx on public.order_items(order_id);

-- ── expenses ───────────────────────────────────────────────────────────────
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  business_day date not null default (now() at time zone 'Asia/Baghdad')::date,
  amount int not null check (amount >= 0),
  category text,                                        -- free text: 'إيجار','مشتريات','رواتب'…
  note text,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists expenses_business_day_idx on public.expenses(business_day);

-- ── loyalty ledger (source of truth for points) ────────────────────────────
create table if not exists public.loyalty_events (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  delta int not null,                                   -- +earn / -redeem
  reason text not null,                                 -- 'earn_order' | 'redeem_reward' | 'manual_adjust'
  order_id uuid references public.orders(id) on delete set null,
  idempotency_key text,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists loyalty_events_customer_id_idx on public.loyalty_events(customer_id);
-- idempotency guards: at most one earn per order, and unique manual idempotency keys.
create unique index if not exists loyalty_earn_once_per_order
  on public.loyalty_events(order_id) where reason = 'earn_order';
create unique index if not exists loyalty_idem_key
  on public.loyalty_events(idempotency_key) where idempotency_key is not null;

-- ── points cache sync (ledger → customers.points) ──────────────────────────
create or replace function public.sync_points() returns trigger
  language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update public.customers set points = points + new.delta where id = new.customer_id;
  elsif tg_op = 'DELETE' then
    update public.customers set points = points - old.delta where id = old.customer_id;
  end if;
  return null;
end $$;

drop trigger if exists trg_sync_points on public.loyalty_events;
create trigger trg_sync_points
  after insert or delete on public.loyalty_events
  for each row execute function public.sync_points();
