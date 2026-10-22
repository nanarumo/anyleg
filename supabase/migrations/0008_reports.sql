-- Owner reports, for nick in the dashboard (Table Editor > schema "reports"). Same rules as 0006: the app can't
-- see this schema (only public is exposed, and every grant is revoked below). Read-only views, safe to re-run.
-- Days are US Eastern. House net = what players lost: wagered - paid out. Positive = the house is up.
--
-- Sportsbook products come from each ticket's legs: any live leg = Live, else any player prop = Props, else one leg
-- = Straight, else a parlay (split by whether it has casino legs). Only settled tickets count toward net; open
-- tickets show as open_stake. Casino = paid table rounds by game. Free "Play leg" rounds aren't wagers (the parlay
-- ticket they belong to carries the money), and undone tickets are deleted, so neither shows here.

create schema if not exists reports;
revoke all on schema reports from public, anon, authenticated;

drop view if exists reports.totals, reports.daily, reports.house_pnl, reports.players, reports.promos, reports.activity;

-- Every product line, one row per ticket or round.
create view reports.activity as
select 'Sportsbook' as section,
  case
    when exists (select 1 from jsonb_array_elements(b.legs) l where l ->> 'id' like '%:live:%') then 'Live bets'
    when exists (select 1 from jsonb_array_elements(b.legs) l where l -> 'sport' ? 'prop') then 'Player props'
    when jsonb_array_length(b.legs) = 1 then 'Straight bets'
    when not exists (select 1 from jsonb_array_elements(b.legs) l where l ? 'casino') then 'Parlays (sports only)'
    when not exists (select 1 from jsonb_array_elements(b.legs) l where l ? 'sport') then 'Parlays (casino only)'
    else 'Parlays (sports + casino)'
  end as product,
  b.user_id, b.placed_at as at, b.status <> 'pending' as settled, b.stake as wagered, b.payout as paid_out
from public.bets b
union all
select 'Casino', r.game, r.user_id, r.at, true, r.wager, r.returned
from public.rounds r where r.wager > 0;

create view reports.house_pnl as
select section, product,
  count(*) filter (where settled) as settled,
  sum(wagered) filter (where settled) as wagered,
  sum(paid_out) filter (where settled) as paid_out,
  coalesce(sum(wagered - paid_out) filter (where settled), 0) as house_net,
  round(100 * sum(wagered - paid_out) filter (where settled) / nullif(sum(wagered) filter (where settled), 0), 1) as hold_pct,
  coalesce(sum(wagered) filter (where not settled), 0) as open_stake,
  count(distinct user_id) as players
from reports.activity
group by section, product
order by section desc, house_net desc;

-- Free money the house handed out: sign-up, spins, level/season/referral rewards and anything else that isn't a bet.
create view reports.promos as
select kind, count(*) as times, sum(delta) as given, count(distinct user_id) as players
from public.ledger
where delta > 0 and kind not in ('payout', 'refund', 'cashout') and kind not like 'squad:%'
group by kind
order by given desc;

create view reports.daily as
with days as (select generate_series(
  ((select min(created_at) from public.profiles) at time zone 'America/New_York')::date,
  (now() at time zone 'America/New_York')::date, '1 day')::date as day)
select d.day,
  (select count(*) from public.profiles p where (p.created_at at time zone 'America/New_York')::date = d.day) as signups,
  (select count(*) from public.profiles p where (p.created_at at time zone 'America/New_York')::date <= d.day) as total_players,
  (select count(distinct user_id) from public.ledger l where kind <> 'signup' and (l.at at time zone 'America/New_York')::date = d.day) as active_players,
  coalesce(a.sb_wagered, 0) as sportsbook_wagered, coalesce(a.sb_net, 0) as sportsbook_net,
  coalesce(a.casino_wagered, 0) as casino_wagered, coalesce(a.casino_net, 0) as casino_net,
  coalesce(a.sb_net, 0) + coalesce(a.casino_net, 0) as house_net,
  (select coalesce(sum(delta), 0) from public.ledger l where delta > 0 and kind not in ('payout', 'refund', 'cashout')
     and kind not like 'squad:%' and (l.at at time zone 'America/New_York')::date = d.day) as promos_given
from days d
left join (
  -- by the day the ticket was placed or the round was played
  select (at at time zone 'America/New_York')::date as day,
    sum(wagered) filter (where section = 'Sportsbook') as sb_wagered,
    sum(wagered - paid_out) filter (where section = 'Sportsbook' and settled) as sb_net,
    sum(wagered) filter (where section = 'Casino') as casino_wagered,
    sum(wagered - paid_out) filter (where section = 'Casino') as casino_net
  from reports.activity group by 1
) a on a.day = d.day
order by d.day desc;

create view reports.players as
select p.name, u.email, u.phone, coalesce(u.is_anonymous, false) as anonymous, p.created_at as signed_up,
  p.balance, a.tickets, a.rounds, a.wagered, a.house_net, l.last_active
from public.profiles p
join auth.users u on u.id = p.id
left join (
  select user_id, count(*) filter (where section = 'Sportsbook') as tickets, count(*) filter (where section = 'Casino') as rounds,
    sum(wagered) as wagered, sum(wagered - paid_out) filter (where settled) as house_net
  from reports.activity group by user_id
) a on a.user_id = p.id
left join (select user_id, max(at) as last_active from public.ledger where kind <> 'signup' group by user_id) l on l.user_id = p.id
order by l.last_active desc nulls last;

-- One row: the headline numbers.
create view reports.totals as
select
  (select count(*) from public.profiles) as players,
  (select count(*) from auth.users where not coalesce(is_anonymous, false)) as signed_in_players,
  (select count(*) from public.profiles where created_at > now() - interval '1 day') as signups_24h,
  (select count(distinct user_id) from public.ledger where kind <> 'signup' and at > now() - interval '1 day') as active_24h,
  (select count(distinct user_id) from public.ledger where kind <> 'signup' and at > now() - interval '7 days') as active_7d,
  (select count(distinct user_id) from public.ledger where kind <> 'signup' and at > now() - interval '30 days') as active_30d,
  (select sum(house_net) from reports.house_pnl where section = 'Sportsbook') as sportsbook_net,
  (select sum(house_net) from reports.house_pnl where section = 'Casino') as casino_net,
  (select sum(house_net) from reports.house_pnl) as house_net,
  (select sum(given) from reports.promos) as promos_given,
  (select sum(balance) from public.profiles) as player_balances;

revoke all on all tables in schema reports from public, anon, authenticated;
