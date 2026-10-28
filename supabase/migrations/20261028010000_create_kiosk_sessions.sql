create table if not exists public.kiosk_sessions (
  token_hash text primary key,
  kiosk_id uuid not null references public.kiosks (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists kiosk_sessions_expires_at_idx
  on public.kiosk_sessions (expires_at);

alter table public.kiosk_sessions enable row level security;

revoke all on public.kiosk_sessions from anon, authenticated;
grant all on public.kiosk_sessions to service_role;
