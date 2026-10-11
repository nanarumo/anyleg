-- Grading a ticket (sports legs from final scores, or a casino leg's round) goes through one function.
-- The legs = p_old check rejects a write based on a stale copy of the ticket.
create function public.update_bet(p_user uuid, p_bet uuid, p_old jsonb, p_legs jsonb, p_status text, p_payout numeric)
returns numeric language plpgsql security definer set search_path = public as $$
begin
  update bets set legs = p_legs, status = p_status, payout = p_payout,
      settled_at = case when p_status <> 'pending' then now() end
    where id = p_bet and user_id = p_user and status = 'pending' and legs = p_old;
  if not found then raise exception 'bet_changed'; end if;
  if p_status <> 'pending' and p_payout > 0 then return wallet_apply(p_user, p_payout, 'payout', p_bet::text); end if;
  return (select balance from profiles where id = p_user);
end $$;

create or replace function public.settle_leg(p_user uuid, p_bet uuid, p_leg text, p_game text, p_outcome jsonb,
  p_old jsonb, p_legs jsonb, p_status text, p_payout numeric)
returns numeric language plpgsql security definer set search_path = public as $$
begin
  insert into rounds (user_id, game, outcome, bet_id, leg_id) values (p_user, p_game, p_outcome, p_bet, p_leg);
  return update_bet(p_user, p_bet, p_old, p_legs, p_status, p_payout);
end $$;

revoke execute on function public.update_bet from public, anon, authenticated;

-- Undo a ticket (Swipe's undo): only within a minute of placing it and before any leg is graded.
create function public.cancel_bet(p_user uuid, p_bet uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare s numeric;
begin
  delete from bets where id = p_bet and user_id = p_user and status = 'pending' and placed_at > now() - interval '60 seconds'
      and not exists (select 1 from jsonb_array_elements(legs) l where l ->> 'result' <> 'pending')
    returning stake into s;
  if s is null then raise exception 'not_cancellable'; end if;
  return wallet_apply(p_user, s, 'refund', p_bet::text);
end $$;
revoke execute on function public.cancel_bet from public, anon, authenticated;
