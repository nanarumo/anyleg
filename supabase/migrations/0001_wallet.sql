-- Server-authoritative wallet. The app can READ its own rows but never write money, bets or rounds:
-- only the edge functions (service role) can, through wallet_apply().

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null default 'Player' check (length(name) between 1 and 24),
  balance numeric(14, 2) not null default 0 check (balance >= 0),
  created_at timestamptz not null default now()
);

-- Every balance change, so a balance can always be explained.
create table public.ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles on delete cascade,
  delta numeric(14, 2) not null,
  kind text not null, -- signup | bet | payout | refund | round | spin | ...
  ref text,           -- bet id / round id
  balance_after numeric(14, 2) not null,
  at timestamptz not null default now()
);
create index on public.ledger (user_id, at desc);

create table public.bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  legs jsonb not null,  -- Leg[] as the app uses it, with odds as priced by the server
  stake numeric(14, 2) not null check (stake > 0),
  status text not null default 'pending' check (status in ('pending', 'won', 'lost', 'push')),
  payout numeric(14, 2) not null default 0,
  opts jsonb not null default '{}', -- boost, insured, flex, sgpMult, daily
  placed_at timestamptz not null default now(),
  settled_at timestamptz
);
create index on public.bets (user_id, placed_at desc);
create index on public.bets (status) where status = 'pending';

-- Casino rounds dealt by the server: paid table rounds, and free rounds that settle a parlay leg.
create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  game text not null,
  wager numeric(14, 2) not null default 0,
  returned numeric(14, 2) not null default 0,
  outcome jsonb not null,
  bet_id uuid references public.bets on delete cascade,
  leg_id text,
  at timestamptz not null default now(),
  unique (bet_id, leg_id) -- a parlay leg gets exactly one round: no re-rolling
);
create index on public.rounds (user_id, at desc);

alter table public.profiles enable row level security;
alter table public.ledger enable row level security;
alter table public.bets enable row level security;
alter table public.rounds enable row level security;

create policy "own profile" on public.profiles for select using (id = auth.uid());
create policy "rename self" on public.profiles for update using (id = auth.uid());
create policy "own ledger" on public.ledger for select using (user_id = auth.uid());
create policy "own bets" on public.bets for select using (user_id = auth.uid());
create policy "own rounds" on public.rounds for select using (user_id = auth.uid());

-- The app may only change its display name.
revoke insert, update, delete on public.profiles, public.ledger, public.bets, public.rounds from anon, authenticated;
grant update (name) on public.profiles to authenticated;

-- The one place money moves. Atomic: the row lock stops two requests from spending the same dollars.
create function public.wallet_apply(p_user uuid, p_delta numeric, p_kind text, p_ref text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare bal numeric;
begin
  update profiles set balance = balance + p_delta
    where id = p_user and balance + p_delta >= 0
    returning balance into bal;
  if bal is null then raise exception 'insufficient_balance'; end if;
  insert into ledger (user_id, delta, kind, ref, balance_after) values (p_user, p_delta, p_kind, p_ref, bal);
  return bal;
end $$;
revoke execute on function public.wallet_apply from public, anon, authenticated;

-- New sign-ups start with $500 of play money (per nick: scarce money, no deposits).
create function public.on_signup() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, name) values (new.id, coalesce(left(new.raw_user_meta_data ->> 'name', 24), 'Player'));
  perform wallet_apply(new.id, 500, 'signup');
  return new;
end $$;
create trigger on_signup after insert on auth.users for each row execute function public.on_signup();

-- ---- what the edge functions call: each is one transaction, so money and records never disagree ----

-- A paid table round: take the wager, log the round, pay what it returned.
create function public.record_round(p_user uuid, p_game text, p_wager numeric, p_returned numeric, p_outcome jsonb)
returns numeric language plpgsql security definer set search_path = public as $$
declare rid uuid := gen_random_uuid(); bal numeric;
begin
  bal := wallet_apply(p_user, -p_wager, 'round', rid::text);
  insert into rounds (id, user_id, game, wager, returned, outcome) values (rid, p_user, p_game, p_wager, p_returned, p_outcome);
  if p_returned > 0 then bal := wallet_apply(p_user, p_returned, 'payout', rid::text); end if;
  return bal;
end $$;

-- Tickets priced by the server: [{legs, stake, opts}]. All or nothing.
create function public.place_tickets(p_user uuid, p_tickets jsonb)
returns setof uuid language plpgsql security definer set search_path = public as $$
declare t jsonb; bid uuid;
begin
  for t in select * from jsonb_array_elements(p_tickets) loop
    insert into bets (user_id, legs, stake, opts) values (p_user, t -> 'legs', (t ->> 'stake')::numeric, coalesce(t -> 'opts', '{}'))
      returning id into bid;
    perform wallet_apply(p_user, -(t ->> 'stake')::numeric, 'bet', bid::text);
    return next bid;
  end loop;
end $$;

-- A casino leg's free round. The unique (bet_id, leg_id) on rounds means each leg is dealt once, and the
-- legs = p_old check rejects a write based on a stale copy of the ticket (two legs played at once).
create function public.settle_leg(p_user uuid, p_bet uuid, p_leg text, p_game text, p_outcome jsonb,
  p_old jsonb, p_legs jsonb, p_status text, p_payout numeric)
returns numeric language plpgsql security definer set search_path = public as $$
begin
  insert into rounds (user_id, game, outcome, bet_id, leg_id) values (p_user, p_game, p_outcome, p_bet, p_leg);
  update bets set legs = p_legs, status = p_status, payout = p_payout,
      settled_at = case when p_status <> 'pending' then now() end
    where id = p_bet and user_id = p_user and status = 'pending' and legs = p_old;
  if not found then raise exception 'bet_changed'; end if;
  if p_status <> 'pending' and p_payout > 0 then return wallet_apply(p_user, p_payout, 'payout', p_bet::text); end if;
  return (select balance from profiles where id = p_user);
end $$;

revoke execute on function public.record_round, public.place_tickets, public.settle_leg, public.on_signup from public, anon, authenticated;
