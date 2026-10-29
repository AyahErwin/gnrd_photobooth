-- Trigger to automatically synchronize changes on app_config to all kiosk_settings
create or replace function public.sync_app_config_to_kiosks()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (old.price is distinct from new.price) or (old.qris_time is distinct from new.qris_time) then
    update public.kiosk_settings
    set price = new.price,
        qris_time = new.qris_time,
        updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists trigger_sync_app_config on public.app_config;
create trigger trigger_sync_app_config
after update on public.app_config
for each row execute function public.sync_app_config_to_kiosks();

-- ============================================================
-- STORAGE POLICIES FOR MEDIA UPLOADS (QRIS & VIDEO PROMO)
-- ============================================================

-- Pastikan bucket qris-images dan kiosk-videos ada dan publik
insert into storage.buckets (id, name, public, file_size_limit)
values
  ('qris-images', 'qris-images', true, 52428800),
  ('kiosk-videos', 'kiosk-videos', true, 52428800)
on conflict (id) do update
set public = true,
    file_size_limit = 52428800;

-- 1. Kebijakan SELECT (Wajib agar file bisa dibaca dan upload RETURNING tidak gagal)
drop policy if exists "anyone can read kiosk media" on storage.objects;
drop policy if exists "Public Access to kiosk-videos" on storage.objects;
drop policy if exists "Public Access to qris-images" on storage.objects;

create policy "anyone can read kiosk media"
  on storage.objects for select
  using (bucket_id in ('qris-images', 'kiosk-videos'));

-- 2. Kebijakan INSERT untuk Admin Pusat (Owner & HQ Admin)
drop policy if exists "head office can upload kiosk media" on storage.objects;
create policy "head office can upload kiosk media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('qris-images', 'kiosk-videos')
    and (
      public.is_head_office_admin()
      or exists (
        select 1 from public.staff_profiles
        where user_id = auth.uid() and role in ('owner', 'hq_admin')
      )
    )
  );

-- 3. Kebijakan UPDATE untuk Admin Pusat
drop policy if exists "head office can update kiosk media" on storage.objects;
create policy "head office can update kiosk media"
  on storage.objects for update to authenticated
  using (
    bucket_id in ('qris-images', 'kiosk-videos')
    and (
      public.is_head_office_admin()
      or exists (
        select 1 from public.staff_profiles
        where user_id = auth.uid() and role in ('owner', 'hq_admin')
      )
    )
  )
  with check (
    bucket_id in ('qris-images', 'kiosk-videos')
    and (
      public.is_head_office_admin()
      or exists (
        select 1 from public.staff_profiles
        where user_id = auth.uid() and role in ('owner', 'hq_admin')
      )
    )
  );

-- 4. Kebijakan DELETE untuk Admin Pusat
drop policy if exists "head office can delete kiosk media" on storage.objects;
create policy "head office can delete kiosk media"
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('qris-images', 'kiosk-videos')
    and (
      public.is_head_office_admin()
      or exists (
        select 1 from public.staff_profiles
        where user_id = auth.uid() and role in ('owner', 'hq_admin')
      )
    )
  );
