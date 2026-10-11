-- Tables that take several taps (mines, video poker): the board or deck waits here between taps.
-- No select policy: players never read a hand's hidden state, only what the house function shows them.
create table public.hands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  game text not null,
  wager numeric(14, 2) not null check (wager > 0),
  state jsonb not null,
  version int not null default 0, -- each tap must name the version it saw, so two taps can't race
  open boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.hands (user_id) where open;
alter table public.hands enable row level security;
revoke all on public.hands from anon, authenticated;

create function public.open_hand(p_user uuid, p_game text, p_wager numeric, p_state jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  insert into hands (user_id, game, wager, state) values (p_user, p_game, p_wager, p_state) returning id into hid;
  perform wallet_apply(p_user, -p_wager, 'round', hid::text);
  return hid;
end $$;

create function public.close_hand(p_user uuid, p_hand uuid, p_version int, p_state jsonb, p_returned numeric, p_outcome jsonb)
returns numeric language plpgsql security definer set search_path = public as $$
declare w numeric; g text;
begin
  update hands set open = false, state = p_state, version = version + 1
    where id = p_hand and user_id = p_user and open and version = p_version
    returning wager, game into w, g;
  if w is null then raise exception 'hand_changed'; end if;
  insert into rounds (id, user_id, game, wager, returned, outcome) values (p_hand, p_user, g, w, p_returned, p_outcome);
  if p_returned > 0 then return wallet_apply(p_user, p_returned, 'payout', p_hand::text); end if;
  return (select balance from profiles where id = p_user);
end $$;
revoke execute on function public.open_hand, public.close_hand from public, anon, authenticated;
