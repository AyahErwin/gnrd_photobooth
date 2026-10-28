create table if not exists public.kiosk_transactions (
  id uuid primary key default gen_random_uuid(),
  kiosk_id uuid not null references public.kiosks (id) on delete restrict,
  amount integer not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index if not exists kiosk_transactions_created_at_idx
  on public.kiosk_transactions (created_at);

create index if not exists kiosk_transactions_kiosk_id_created_at_idx
  on public.kiosk_transactions (kiosk_id, created_at);

alter table public.kiosk_transactions enable row level security;

revoke all on public.kiosk_transactions from anon, authenticated;
grant all on public.kiosk_transactions to service_role;

create or replace function public.get_kiosk_revenue(
  report_start timestamptz,
  report_end timestamptz
)
returns table (
  id uuid,
  kiosk_code text,
  kiosk_name text,
  location text,
  revenue bigint,
  transaction_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    k.id,
    k.kiosk_code,
    k.kiosk_name,
    k.location,
    coalesce(sum(t.amount), 0)::bigint as revenue,
    count(t.id)::bigint as transaction_count
  from public.kiosks k
  left join public.kiosk_transactions t
    on t.kiosk_id = k.id
    and t.created_at >= report_start
    and t.created_at < report_end
  group by k.id, k.kiosk_code, k.kiosk_name, k.location;
$$;

revoke all on function public.get_kiosk_revenue(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_kiosk_revenue(timestamptz, timestamptz)
  to service_role;
