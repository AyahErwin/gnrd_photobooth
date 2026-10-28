delete from public.staff_profiles
where role = 'operator';

alter table public.staff_profiles
  drop constraint if exists staff_profiles_role_check,
  drop constraint if exists staff_profiles_role_scope_check;

alter table public.staff_profiles
  add constraint staff_profiles_role_check
    check (role in ('owner', 'hq_admin', 'kiosk_admin')),
  add constraint staff_profiles_role_scope_check
    check (
      (role in ('owner', 'hq_admin') and kiosk_id is null)
      or (role = 'kiosk_admin' and kiosk_id is not null)
    );
