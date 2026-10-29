create table if not exists public.staff_kiosks (
  user_id uuid not null references public.staff_profiles (user_id) on delete cascade,
  kiosk_id uuid not null references public.kiosks (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, kiosk_id)
);

create index if not exists staff_kiosks_kiosk_id_idx
  on public.staff_kiosks (kiosk_id);

insert into public.staff_kiosks (user_id, kiosk_id)
select user_id, kiosk_id
from public.staff_profiles
where role = 'kiosk_admin'
  and kiosk_id is not null
on conflict (user_id, kiosk_id) do nothing;

alter table public.staff_profiles
  drop constraint if exists staff_profiles_role_scope_check,
  drop constraint if exists staff_profiles_kiosk_id_fkey;

alter table public.staff_profiles
  add constraint staff_profiles_role_scope_check
    check (
      (role in ('owner', 'hq_admin') and kiosk_id is null)
      or role = 'kiosk_admin'
    ),
  add constraint staff_profiles_kiosk_id_fkey
    foreign key (kiosk_id) references public.kiosks (id) on delete set null;

create or replace function public.current_staff_kiosk_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select kiosk_id
      from public.staff_profiles
      where user_id = auth.uid()
    ),
    (
      select kiosk_id
      from public.staff_kiosks
      where user_id = auth.uid()
      order by kiosk_id
      limit 1
    )
  );
$$;

create or replace function public.staff_can_access_kiosk(target_kiosk_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_head_office_admin()
    or exists (
      select 1
      from public.staff_profiles profile
      join public.staff_kiosks assignment on assignment.user_id = profile.user_id
      where profile.user_id = auth.uid()
        and profile.role = 'kiosk_admin'
        and assignment.kiosk_id = target_kiosk_id
    );
$$;

alter table public.staff_kiosks enable row level security;
revoke all on public.staff_kiosks from anon, authenticated;
grant select on public.staff_kiosks to authenticated;
grant all on public.staff_kiosks to service_role;

drop policy if exists "staff can read kiosk assignments" on public.staff_kiosks;
create policy "staff can read kiosk assignments"
  on public.staff_kiosks for select to authenticated
  using (user_id = auth.uid() or public.is_head_office_admin());

drop policy if exists "kiosk admins can read own kiosk" on public.kiosks;
create policy "kiosk admins can read own kiosk"
  on public.kiosks for select to authenticated
  using (public.staff_can_access_kiosk(id));

drop policy if exists "kiosk admins can read own settings" on public.kiosk_settings;
create policy "kiosk admins can read own settings"
  on public.kiosk_settings for select to authenticated
  using (public.staff_can_access_kiosk(kiosk_id));

drop policy if exists "kiosk admins can update own settings" on public.kiosk_settings;
create policy "kiosk admins can update own settings"
  on public.kiosk_settings for update to authenticated
  using (public.staff_can_access_kiosk(kiosk_id))
  with check (public.staff_can_access_kiosk(kiosk_id));

drop policy if exists "kiosk admins can insert own settings" on public.kiosk_settings;
create policy "kiosk admins can insert own settings"
  on public.kiosk_settings for insert to authenticated
  with check (public.staff_can_access_kiosk(kiosk_id));

drop policy if exists "kiosk admins can read own transactions" on public.kiosk_transactions;
create policy "kiosk admins can read own transactions"
  on public.kiosk_transactions for select to authenticated
  using (public.staff_can_access_kiosk(kiosk_id));

create or replace function public.set_staff_kiosks(
  target_user_id uuid,
  target_role text,
  target_kiosk_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  selected_count integer := coalesce(cardinality(target_kiosk_ids), 0);
  unique_count integer;
  primary_kiosk_id uuid;
begin
  if exists (
    select 1
    from public.staff_profiles
    where user_id = target_user_id
      and role = 'owner'
  ) then
    raise exception 'Profil Owner tidak dapat diberi penugasan kios.';
  end if;

  if target_role not in ('kiosk_admin', 'hq_admin') then
    raise exception 'Role staf tidak valid untuk pengelolaan kios.';
  end if;

  if target_role = 'kiosk_admin' and selected_count = 0 then
    raise exception 'Pilih setidaknya satu kios untuk Admin Kios.';
  end if;

  if target_role = 'hq_admin' and selected_count > 0 then
    raise exception 'Admin Pusat tidak dapat diberi penugasan kios.';
  end if;

  select count(distinct kiosk_id)::integer
    into unique_count
  from unnest(coalesce(target_kiosk_ids, array[]::uuid[])) as selected(kiosk_id);

  if unique_count <> selected_count then
    raise exception 'Pilihan kios mengandung data duplikat.';
  end if;

  if exists (
    select 1
    from unnest(coalesce(target_kiosk_ids, array[]::uuid[])) as selected(kiosk_id)
    left join public.kiosks kiosk on kiosk.id = selected.kiosk_id
    where kiosk.id is null
  ) then
    raise exception 'Satu atau lebih kios yang dipilih tidak terdaftar.';
  end if;

  if not exists (
    select 1 from public.staff_profiles where user_id = target_user_id
  ) then
    raise exception 'Profil staf tidak ditemukan.';
  end if;

  primary_kiosk_id := target_kiosk_ids[1];

  update public.staff_profiles
  set role = target_role,
      kiosk_id = case when target_role = 'kiosk_admin' then primary_kiosk_id else null end,
      updated_at = now()
  where user_id = target_user_id;

  delete from public.staff_kiosks where user_id = target_user_id;

  if target_role = 'kiosk_admin' then
    insert into public.staff_kiosks (user_id, kiosk_id)
    select target_user_id, selected.kiosk_id
    from unnest(target_kiosk_ids) with ordinality as selected(kiosk_id, position)
    order by selected.position;
  end if;
end;
$$;

revoke all on function public.set_staff_kiosks(uuid, text, uuid[])
  from public, anon, authenticated;
grant execute on function public.set_staff_kiosks(uuid, text, uuid[])
  to service_role;
