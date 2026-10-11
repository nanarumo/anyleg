-- Everything else worth money moves to the server: reward tokens, level and challenge claims, prestige,
-- the squad bank and referrals. XP is never stored: the house function adds it up from bets and rounds.

alter table public.profiles
  add column inv jsonb not null default '{"spins": 0, "boost25": 0, "boost50": 0, "boost100": 0, "insurance": 0}',
  add column prestige int not null default 0,
  add column prestige_started_at timestamptz not null default now(),
  add column claimed_levels text[] not null default '{}',     -- "<prestige>:<level>"
  add column challenges_claimed text[] not null default '{}', -- this prestige
  add column seasons_claimed text[] not null default '{}',    -- week ids
  add column xp_bonus int not null default 0,                 -- XP not from play (challenges, referrals), this prestige
  add column squad_bank numeric(14, 2) not null default 0 check (squad_bank >= 0),
  add column referred_by uuid references public.profiles on delete set null,
  add column code text generated always as (upper(substr(replace(id::text, '-', ''), 1, 8))) stored unique,
  add column pver int not null default 0; -- each change to the columns above names the version it read
update public.profiles set prestige_started_at = created_at;

-- Round notes ("BLACKJACK!", "Royal Flush") count toward challenges.
alter table public.rounds add column note text;

drop function public.record_round(uuid, text, numeric, numeric, jsonb);
create function public.record_round(p_user uuid, p_game text, p_wager numeric, p_returned numeric, p_outcome jsonb, p_note text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare rid uuid := gen_random_uuid(); bal numeric;
begin
  if p_wager > 0 then bal := wallet_apply(p_user, -p_wager, 'round', rid::text); end if;
  insert into rounds (id, user_id, game, wager, returned, outcome, note) values (rid, p_user, p_game, p_wager, p_returned, p_outcome, p_note);
  if p_returned > 0 then bal := wallet_apply(p_user, p_returned, 'payout', rid::text); end if;
  return coalesce(bal, (select balance from profiles where id = p_user));
end $$;

drop function public.close_hand(uuid, uuid, int, jsonb, numeric, jsonb, numeric);
create function public.close_hand(p_user uuid, p_hand uuid, p_version int, p_state jsonb, p_returned numeric, p_outcome jsonb, p_debit numeric default 0, p_note text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare w numeric; g text;
begin
  update hands set open = false, state = p_state, version = version + 1, wager = wager + p_debit
    where id = p_hand and user_id = p_user and open and version = p_version
    returning wager, game into w, g;
  if w is null then raise exception 'hand_changed'; end if;
  if p_debit > 0 then perform wallet_apply(p_user, -p_debit, 'round', p_hand::text); end if;
  insert into rounds (id, user_id, game, wager, returned, outcome, note) values (p_hand, p_user, g, w, p_returned, p_outcome, p_note);
  if p_returned > 0 then return wallet_apply(p_user, p_returned, 'payout', p_hand::text); end if;
  return (select balance from profiles where id = p_user);
end $$;

-- The squad bank: money moved out of the wallet to stake the weekly squad parlay, and where its payout lands.
create function public.squad_apply(p_user uuid, p_delta numeric, p_kind text, p_ref text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare bank numeric;
begin
  update profiles set squad_bank = squad_bank + p_delta where id = p_user and squad_bank + p_delta >= 0 returning squad_bank into bank;
  if bank is null then raise exception 'insufficient_squad_bank'; end if;
  insert into ledger (user_id, delta, kind, ref, balance_after) values (p_user, p_delta, 'squad:' || p_kind, p_ref, bank);
  return bank;
end $$;

-- Squad tickets stake from the bank and pay into it.
create or replace function public.place_tickets(p_user uuid, p_tickets jsonb)
returns setof uuid language plpgsql security definer set search_path = public as $$
declare t jsonb; bid uuid;
begin
  for t in select * from jsonb_array_elements(p_tickets) loop
    insert into bets (user_id, legs, stake, opts) values (p_user, t -> 'legs', (t ->> 'stake')::numeric, coalesce(t -> 'opts', '{}'))
      returning id into bid;
    if (t -> 'opts' ->> 'squad') = 'true' then perform squad_apply(p_user, -(t ->> 'stake')::numeric, 'bet', bid::text);
    else perform wallet_apply(p_user, -(t ->> 'stake')::numeric, 'bet', bid::text); end if;
    return next bid;
  end loop;
end $$;

create or replace function public.update_bet(p_user uuid, p_bet uuid, p_old jsonb, p_legs jsonb, p_status text, p_payout numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare squad boolean;
begin
  update bets set legs = p_legs, status = p_status, payout = p_payout,
      settled_at = case when p_status <> 'pending' then now() end
    where id = p_bet and user_id = p_user and status = 'pending' and legs = p_old
    returning (opts ->> 'squad') = 'true' into squad;
  if not found then raise exception 'bet_changed'; end if;
  if p_status <> 'pending' and p_payout > 0 then
    if squad then perform squad_apply(p_user, p_payout, 'payout', p_bet::text);
    else return wallet_apply(p_user, p_payout, 'payout', p_bet::text); end if;
  end if;
  return (select balance from profiles where id = p_user);
end $$;

-- Cash out: sell an open ticket for a price the house function worked out.
create function public.cash_out(p_user uuid, p_bet uuid, p_old jsonb, p_amount numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare st numeric; squad boolean;
begin
  update bets set status = case when p_amount > stake then 'won' when p_amount < stake then 'lost' else 'push' end,
      payout = p_amount, settled_at = now(), opts = opts || '{"cashedOut": true}'
    where id = p_bet and user_id = p_user and status = 'pending' and legs = p_old
    returning stake, (opts ->> 'squad') = 'true' into st, squad;
  if st is null then raise exception 'bet_changed'; end if;
  if squad then perform squad_apply(p_user, p_amount, 'cashout', p_bet::text); return (select balance from profiles where id = p_user); end if;
  return wallet_apply(p_user, p_amount, 'cashout', p_bet::text);
end $$;

revoke execute on function public.record_round, public.close_hand, public.squad_apply, public.place_tickets, public.update_bet, public.cash_out
  from public, anon, authenticated;
-- Players still may only rename themselves.
revoke update on public.profiles from authenticated;
grant update (name) on public.profiles to authenticated;
