create table if not exists public.staff_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'hq_admin', 'kiosk_admin', 'operator')),
  kiosk_id uuid references public.kiosks (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_profiles_role_scope_check check (
    (role in ('owner', 'hq_admin') and kiosk_id is null)
    or (role in ('kiosk_admin', 'operator') and kiosk_id is not null)
  )
);

create table if not exists public.kiosk_settings (
  kiosk_id uuid primary key references public.kiosks (id) on delete cascade,
  price integer not null check (price >= 0),
  qris_time integer not null check (qris_time between 1 and 300),
  updated_at timestamptz not null default now()
);

insert into public.kiosk_settings (kiosk_id, price, qris_time)
select k.id, coalesce(c.price, 50000), coalesce(c.qris_time, 180)
from public.kiosks k
left join lateral (
  select price, qris_time
  from public.app_config
  order by id asc
  limit 1
) c on true
on conflict (kiosk_id) do nothing;

create or replace function public.seed_kiosk_settings()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.kiosk_settings (kiosk_id, price, qris_time)
  select new.id, coalesce(price, 50000), coalesce(qris_time, 180)
  from public.app_config
  order by id asc
  limit 1
  on conflict (kiosk_id) do nothing;

  if not found then
    insert into public.kiosk_settings (kiosk_id, price, qris_time)
    values (new.id, 50000, 180)
    on conflict (kiosk_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists kiosks_seed_settings on public.kiosks;
create trigger kiosks_seed_settings
after insert on public.kiosks
for each row execute function public.seed_kiosk_settings();

create or replace function public.current_staff_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.staff_profiles where user_id = auth.uid();
$$;

create or replace function public.current_staff_kiosk_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select kiosk_id from public.staff_profiles where user_id = auth.uid();
$$;

create or replace function public.is_head_office_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.current_staff_role() in ('owner', 'hq_admin'), false);
$$;

alter table public.staff_profiles enable row level security;
alter table public.kiosk_settings enable row level security;
alter table public.kiosks enable row level security;
alter table public.app_config enable row level security;
alter table public.kiosk_transactions enable row level security;

drop policy if exists "Public Read Access" on public.app_config;
drop policy if exists "Public Update Access" on public.app_config;
drop policy if exists "Allow Public Read Kiosks" on public.kiosks;
drop policy if exists "Public full access to kiosks" on public.kiosks;

drop policy if exists "Allow Public Delete kiosk-media" on storage.objects;
drop policy if exists "Allow Public Update to kiosk-videos" on storage.objects;
drop policy if exists "Allow Public Update to qris-images" on storage.objects;
drop policy if exists "Allow Public Update/Delete Images" on storage.objects;
drop policy if exists "Allow Public Update/Delete kiosk-videos" on storage.objects;
drop policy if exists "Allow Public Upload Images" on storage.objects;
drop policy if exists "Allow Public Upload kiosk-media" on storage.objects;
drop policy if exists "Allow Public Upload to kiosk-videos" on storage.objects;
drop policy if exists "Allow Public Upload to qris-images" on storage.objects;

revoke all on public.staff_profiles, public.kiosk_settings from anon, authenticated;
grant select on public.staff_profiles to authenticated;
grant select, insert, update, delete on public.kiosk_settings to authenticated;

revoke all on public.kiosks from anon, authenticated;
grant select (id, kiosk_code, kiosk_name, package_type, location, is_active, created_at)
  on public.kiosks to authenticated;
grant insert (kiosk_code, kiosk_name, password, package_type, location, is_active)
  on public.kiosks to authenticated;
grant update (kiosk_code, kiosk_name, password, package_type, location, is_active)
  on public.kiosks to authenticated;
grant delete on public.kiosks to authenticated;

revoke all on public.app_config from anon, authenticated;
grant select, insert, update on public.app_config to authenticated;
grant select on public.kiosk_transactions to authenticated;

drop policy if exists "staff can read own profile" on public.staff_profiles;
create policy "staff can read own profile"
  on public.staff_profiles for select to authenticated
  using (user_id = auth.uid() or public.is_head_office_admin());

drop policy if exists "head office can manage all kiosks" on public.kiosks;
create policy "head office can manage all kiosks"
  on public.kiosks for all to authenticated
  using (public.is_head_office_admin())
  with check (public.is_head_office_admin());

drop policy if exists "kiosk admins can read own kiosk" on public.kiosks;
create policy "kiosk admins can read own kiosk"
  on public.kiosks for select to authenticated
  using (
    public.current_staff_role() = 'kiosk_admin'
    and id = public.current_staff_kiosk_id()
  );

drop policy if exists "head office can manage kiosk settings" on public.kiosk_settings;
create policy "head office can manage kiosk settings"
  on public.kiosk_settings for all to authenticated
  using (public.is_head_office_admin())
  with check (public.is_head_office_admin());

drop policy if exists "kiosk admins can read own settings" on public.kiosk_settings;
create policy "kiosk admins can read own settings"
  on public.kiosk_settings for select to authenticated
  using (
    public.current_staff_role() = 'kiosk_admin'
    and kiosk_id = public.current_staff_kiosk_id()
  );

drop policy if exists "kiosk admins can update own settings" on public.kiosk_settings;
create policy "kiosk admins can update own settings"
  on public.kiosk_settings for update to authenticated
  using (
    public.current_staff_role() = 'kiosk_admin'
    and kiosk_id = public.current_staff_kiosk_id()
  )
  with check (
    public.current_staff_role() = 'kiosk_admin'
    and kiosk_id = public.current_staff_kiosk_id()
  );

drop policy if exists "staff can read global app config" on public.app_config;
create policy "staff can read global app config"
  on public.app_config for select to authenticated
  using (public.current_staff_role() in ('owner', 'hq_admin', 'kiosk_admin'));

drop policy if exists "head office can manage global app config" on public.app_config;
create policy "head office can manage global app config"
  on public.app_config for all to authenticated
  using (public.is_head_office_admin())
  with check (public.is_head_office_admin());

drop policy if exists "head office can read all transactions" on public.kiosk_transactions;
create policy "head office can read all transactions"
  on public.kiosk_transactions for select to authenticated
  using (public.is_head_office_admin());

drop policy if exists "kiosk admins can read own transactions" on public.kiosk_transactions;
create policy "kiosk admins can read own transactions"
  on public.kiosk_transactions for select to authenticated
  using (
    public.current_staff_role() = 'kiosk_admin'
    and kiosk_id = public.current_staff_kiosk_id()
  );

drop policy if exists "head office can upload kiosk media" on storage.objects;
create policy "head office can upload kiosk media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('qris-images', 'kiosk-videos')
    and public.is_head_office_admin()
  );

drop policy if exists "head office can update kiosk media" on storage.objects;
create policy "head office can update kiosk media"
  on storage.objects for update to authenticated
  using (
    bucket_id in ('qris-images', 'kiosk-videos')
    and public.is_head_office_admin()
  )
  with check (
    bucket_id in ('qris-images', 'kiosk-videos')
    and public.is_head_office_admin()
  );

drop policy if exists "head office can delete kiosk media" on storage.objects;
create policy "head office can delete kiosk media"
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('qris-images', 'kiosk-videos')
    and public.is_head_office_admin()
  );

insert into public.staff_profiles (user_id, role, kiosk_id)
select id, 'owner', null
from auth.users
where lower(email) = lower('erwingnrd@gmail.com')
  and email_confirmed_at is not null
on conflict (user_id) do update
set role = 'owner', kiosk_id = null, updated_at = now();

create or replace function public.assign_bootstrap_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.email_confirmed_at is not null
    and lower(new.email) = lower('erwingnrd@gmail.com') then
    insert into public.staff_profiles (user_id, role, kiosk_id)
    values (new.id, 'owner', null)
    on conflict (user_id) do update
    set role = 'owner', kiosk_id = null, updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists auth_user_assign_bootstrap_owner on auth.users;
create trigger auth_user_assign_bootstrap_owner
after insert or update of email, email_confirmed_at on auth.users
for each row execute function public.assign_bootstrap_owner();
