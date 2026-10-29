create or replace function public.enforce_unique_staff_email()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  normalized_email text;
  conflicting_user_id uuid;
begin
  select lower(btrim(email))
    into normalized_email
    from auth.users
    where id = new.user_id;

  if normalized_email is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(normalized_email, 0));

  select profile.user_id
    into conflicting_user_id
    from public.staff_profiles as profile
    join auth.users as auth_user on auth_user.id = profile.user_id
    where lower(btrim(auth_user.email)) = normalized_email
      and profile.user_id <> new.user_id
    limit 1;

  if conflicting_user_id is not null then
    raise exception using
      errcode = '23505',
      message = 'Email sudah digunakan oleh akun staf lain.';
  end if;

  return new;
end;
$$;

drop trigger if exists staff_profiles_unique_email on public.staff_profiles;
create trigger staff_profiles_unique_email
  before insert or update of user_id on public.staff_profiles
  for each row execute function public.enforce_unique_staff_email();
