create table if not exists public.active_device_sessions (
  account_key text primary key,
  session_id uuid not null,
  last_seen_at timestamptz not null default now()
);

alter table public.active_device_sessions enable row level security;
revoke all on public.active_device_sessions from public, anon, authenticated;
grant all on public.active_device_sessions to service_role;

create or replace function public.claim_active_device_session(
  p_account_key text,
  p_session_id uuid,
  p_takeover boolean default false,
  p_stale_after_seconds integer default 45
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_session public.active_device_sessions%rowtype;
begin
  if p_account_key is null or length(p_account_key) > 100 or p_session_id is null then
    raise exception 'Invalid session claim.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_account_key, 0));
  select * into current_session
  from public.active_device_sessions
  where account_key = p_account_key;

  if not found
    or current_session.last_seen_at <
      now() - make_interval(secs => greatest(15, least(p_stale_after_seconds, 300)))
  then
    insert into public.active_device_sessions (account_key, session_id, last_seen_at)
    values (p_account_key, p_session_id, now())
    on conflict (account_key) do update
      set session_id = excluded.session_id, last_seen_at = excluded.last_seen_at;
    return 'claimed';
  end if;

  if current_session.session_id = p_session_id then
    update public.active_device_sessions
    set last_seen_at = now()
    where account_key = p_account_key;
    return 'active';
  end if;

  if p_takeover then
    update public.active_device_sessions
    set session_id = p_session_id, last_seen_at = now()
    where account_key = p_account_key;
    return 'taken_over';
  end if;

  return 'conflict';
end;
$$;

create or replace function public.release_active_device_session(
  p_account_key text,
  p_session_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.active_device_sessions
  where account_key = p_account_key and session_id = p_session_id;
  get diagnostics deleted_count = row_count;
  return deleted_count > 0;
end;
$$;

revoke all on function public.claim_active_device_session(text, uuid, boolean, integer)
  from public, anon, authenticated;
revoke all on function public.release_active_device_session(text, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_active_device_session(text, uuid, boolean, integer)
  to service_role;
grant execute on function public.release_active_device_session(text, uuid)
  to service_role;
