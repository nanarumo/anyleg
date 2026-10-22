-- Founders reward: players who verify an email before real-money play exists reserve promo credit
-- ($15, plus $5 for each friend who joins with their code and verifies too). Nothing here is money or is paid out:
-- it's the record of who joined early and who they brought, read by the house function and by the reports below.

alter table public.profiles add column founder_at timestamptz; -- when this player first verified an email

-- An email counts once it's confirmed: an anonymous account linking one, or a fresh email sign-in.
-- Named to sort after on_signup, so on an insert the profile row already exists.
create function public.on_verified() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update profiles set founder_at = now() where id = new.id and founder_at is null;
  return new;
end $$;
create trigger on_verified after insert or update of email, email_confirmed_at on auth.users
  for each row when (new.email is not null and new.email_confirmed_at is not null) execute function public.on_verified();
revoke execute on function public.on_verified from public, anon, authenticated;

update public.profiles p set founder_at = u.email_confirmed_at
  from auth.users u where u.id = p.id and u.email is not null and u.email_confirmed_at is not null and p.founder_at is null;

-- For nick, in the dashboard (Table Editor > schema "reports"). Not exposed to the app: only the public schema is.
-- Amounts here match FOUNDER in supabase/functions/house/index.ts.
create schema reports;
revoke all on schema reports from public, anon, authenticated;

create view reports.founders as
select p.name, u.email, p.code, p.founder_at, p.created_at, r.code as joined_with_code,
  f.verified_friends, f.all_friends,
  case when p.founder_at is null then 0 else 15 + 5 * f.verified_friends end as reserved_usd
from public.profiles p
join auth.users u on u.id = p.id
left join public.profiles r on r.id = p.referred_by
cross join lateral (
  select count(*) filter (where x.founder_at is not null) as verified_friends, count(*) as all_friends
  from public.profiles x where x.referred_by = p.id
) f
where p.founder_at is not null or f.all_friends > 0
order by reserved_usd desc, p.founder_at;

create view reports.founder_totals as
select count(*) filter (where founder_at is not null) as founders,
  coalesce(sum(verified_friends) filter (where founder_at is not null), 0) as verified_referrals,
  coalesce(sum(reserved_usd), 0) as reserved_usd
from reports.founders;

revoke all on all tables in schema reports from public, anon, authenticated;
