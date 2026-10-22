// POST /functions/v1/house with the player's sign-in token. Body: { action, ... }
//   me:     {}                                    balance, XP, tokens, claims, squad bank, referral code, email, founders reward
//   round:  { game, ...RoundReq }                 paid table round (slots { free } spends a Free Spin) -> { outcome, wager, returned, note, balance }
//   bet:    { legs, stake, mode, flex, chaos, daily, boost, insure, squad }  priced here -> { ids, tickets, balance, inv }
//   leg:    { betId, legId }                      free round for a casino leg      -> { round, note, legs, status, payout, balance }
//   cancel: { betId }                             undo a ticket within a minute    -> { balance }
//   cashout:{ betId }                             sell an open ticket              -> { amount, balance }
//   start:  { game: mines|poker|blackjack, wager | bets, mines? }  a hand that takes several taps -> { handId, view, balance }
//   move:   { handId, tile | cash | hold | bj }   one tap                          -> { view, done, returned, balance? }
//   close:  { handId }                            walk away from a hand            -> { view, returned, balance }
//   spin:   {}                                    the daily login wheel, once per 24h -> { prize (slice index), balance }
//   claimLevels | claimChallenge { id } | prestige | claimSeason { week } | redeem { code } | squad { op: fund|withdraw, amount }
//   settle: {}                                    grade open sports legs from finals -> { balance }
// Sports legs settle when the app asks (it polls every 30s) and every 10 minutes from pg_cron (0005_cron.sql).
// Deployed with --no-verify-jwt: the cron call carries no sign-in, and every other action checks the token itself.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { SPIN_PRIZES, spinIndex } from '../../../src/logic.ts'
import { CHALLENGES } from '../../../src/challenges.ts'
import {
  cashOutQuote, closeHand, rng, dealRound, espnBoard, grade, gradeSports, handNote, handOver, handView, handWager, moveHand, playLeg,
  priceTickets, startHand, type Hand,
} from '../_shared/house.ts'
import { PRIZES, claimChallenge, claimLevels, enterPrestige, historyOf, seasonPlace, xpOf, type BetRow, type Player, type RoundRow } from '../_shared/player.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const fail = (error: string, status = 400) => json({ error }, status)
const nice = (e: { message?: string } | null) =>
  e?.message?.includes('insufficient_squad_bank') ? 'The squad bank can’t cover that'
    : e?.message?.includes('insufficient_balance') ? 'Not enough balance'
      : e?.message?.includes('bet_changed') || e?.message?.includes('duplicate') ? 'That ticket just changed. Try again.' : 'Something went wrong'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const getJson = async (url: string) => { const r = await fetch(url); if (!r.ok) throw new Error(String(r.status)); return r.json() }
const board = () => espnBoard(getJson)
/** Founders reward, in promo dollars reserved for real-money play (if it launches). Matches reports.founders in 0006_founders.sql. */
const FOUNDER = { base: 20, perFriend: 5 }
const pay = (user: string, amount: number, kind: string, ref?: string) =>
  admin.rpc('wallet_apply', { p_user: user, p_delta: amount, p_kind: kind, p_ref: ref ?? null })

// ---- player progress: the profiles row is versioned (pver) so two requests can't both spend the same token ----
const PLAYER = 'balance, squad_bank, inv, prestige, prestige_started_at, claimed_levels, challenges_claimed, seasons_claimed, xp_bonus, pver, code, referred_by, created_at, founder_at'
type Row = Player & { balance: number; squad_bank: number; pver: number; code: string; referred_by: string | null; created_at: string; founder_at: string | null }
const loadPlayer = async (id: string) => (await admin.from('profiles').select(PLAYER).eq('id', id).single()).data as Row
/** Save progress columns if nobody changed them since `row` was read. */
async function savePlayer(id: string, row: Row, next: Partial<Player>) {
  const { data } = await admin.from('profiles').update({ ...next, pver: row.pver + 1 }).eq('id', id).eq('pver', row.pver).select('id')
  return !!data?.length
}
/** Read, change, save; retried when another request got there first. */
async function update<T>(id: string, change: (row: Row) => { next: Partial<Player>; out: T } | string): Promise<T | string> {
  for (let i = 0; i < 4; i++) {
    const row = await loadPlayer(id)
    const c = change(row)
    if (typeof c === 'string') return c
    if (await savePlayer(id, row, c.next)) return c.out
  }
  return 'Busy, try again'
}
/** Bets and paid rounds since `since` (ISO). ponytail: first 1000 rows of each; page if a player outgrows it */
async function historyRows(id: string, since: string, until?: string) {
  let b = admin.from('bets').select('legs, stake, status, payout, opts, placed_at').eq('user_id', id).gte('placed_at', since)
  let r = admin.from('rounds').select('game, wager, returned, at, note, bet_id').eq('user_id', id).gte('at', since)
  if (until) { b = b.lt('placed_at', until); r = r.lt('at', until) }
  const [bets, rounds] = await Promise.all([b.limit(1000), r.limit(1000)])
  return { bets: (bets.data ?? []) as BetRow[], rounds: (rounds.data ?? []) as RoundRow[] }
}
async function progress(id: string, row: Row) {
  const { bets, rounds } = await historyRows(id, row.prestige_started_at)
  const h = historyOf(bets, rounds)
  return { h, xp: xpOf(h, row.xp_bonus) }
}

type HandRow = { id: string; game: string; wager: number; state: Hand; version: number }
/** Finish a hand: log the round and pay what it returned. */
async function finish(user: string, row: HandRow, state: Hand, returned: number, debit = 0) {
  const view = handView(state, true)
  const { data: balance, error } = await admin.rpc('close_hand', {
    p_user: user, p_hand: row.id, p_version: row.version, p_state: state, p_returned: returned, p_outcome: { [row.game]: view }, p_debit: debit, p_note: handNote(state),
  })
  return error ? fail(error.message.includes('hand_changed') ? 'That hand already finished' : nice(error)) : json({ view, done: true, returned, balance })
}

/** Grade one player's open sports legs from final scores. */
async function settleSports(user: string) {
  const { data: bets } = await admin.from('bets').select('*').eq('user_id', user).eq('status', 'pending')
  const cache = new Map()
  for (const bet of bets ?? []) {
    const legs = await gradeSports(bet.legs, getJson, cache)
    if (!legs) continue
    const { status, payout } = grade(legs, Number(bet.stake), bet.opts)
    await admin.rpc('update_bet', { p_user: user, p_bet: bet.id, p_old: bet.legs, p_legs: legs, p_status: status, p_payout: payout })
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
  const body = await req.json().catch(() => ({}))

  // The schedule (pg_cron) settles everyone's open sports legs, so tickets pay while players are away.
  if (body.action === 'cron') {
    const { data: ok } = await admin.rpc('cron_ok', { p: req.headers.get('x-cron') ?? '' })
    if (!ok) return fail('Not allowed', 401)
    const { data } = await admin.from('bets').select('user_id').eq('status', 'pending')
    for (const u of new Set((data ?? []).map(r => r.user_id as string))) await settleSports(u)
    return json({ ok: true })
  }

  const { data: { user } } = await admin.auth.getUser(token)
  if (!user) return fail('Sign in first', 401)
  const me = user.id

  // In-app account deletion (App Store 5.1.1(v)): removing the auth user cascades to profile, ledger, bets, rounds and hands.
  if (body.action === 'delete') {
    const { error } = await admin.auth.admin.deleteUser(me)
    return error ? fail("Couldn't delete the account. Try again.") : json({ ok: true, balance: 0 })
  }

  if (body.action === 'me') {
    const row = await loadPlayer(me)
    const { h, xp } = await progress(me, row)
    const [{ count }, { count: verified }] = await Promise.all([
      admin.from('profiles').select('id', { count: 'exact', head: true }).eq('referred_by', me),
      admin.from('profiles').select('id', { count: 'exact', head: true }).eq('referred_by', me).not('founder_at', 'is', null),
    ])
    return json({
      balance: row.balance, squadBank: row.squad_bank, inv: row.inv, xp, prestige: row.prestige, prestigeStartedAt: row.prestige_started_at,
      claimedLevels: row.claimed_levels, challengesClaimed: row.challenges_claimed, seasonsClaimed: row.seasons_claimed,
      challengesDone: CHALLENGES.filter(c => (c.minPrestige ?? 0) <= row.prestige && c.progress(h) >= c.goal).map(c => c.id),
      code: row.code, referredBy: row.referred_by, referrals: count ?? 0, createdAt: row.created_at,
      email: user.email ?? null, founder: { at: row.founder_at, friends: verified ?? 0, ...FOUNDER },
    })
  }

  if (body.action === 'round') {
    const d = dealRound(body)
    if (typeof d === 'string') return fail(d)
    if (body.game === 'slots' && body.free) { // spend a Free Spin token first
      const ok = await update(me, row => (row.inv.spins < 1 ? 'No free spins left' : { next: { inv: { ...row.inv, spins: row.inv.spins - 1 } }, out: true }))
      if (typeof ok === 'string') return fail(ok)
    }
    const { data: balance, error } = await admin.rpc('record_round', { p_user: me, p_game: body.game, p_wager: d.wager, p_returned: d.returned, p_outcome: d.outcome, p_note: d.note })
    return error ? fail(nice(error)) : json({ ...d, balance })
  }

  if (body.action === 'bet') {
    if (body.daily) { // one Daily Boost per (UTC) day
      const { count } = await admin.from('bets').select('id', { count: 'exact', head: true }).eq('user_id', me).eq('opts->>daily', 'true').gte('placed_at', new Date().toISOString().slice(0, 10))
      if (count) return fail('Already bet today. A new boost drops tomorrow.')
    }
    const tickets = await priceTickets(body, board())
    if (typeof tickets === 'string') return fail(tickets)
    // Boost and insurance tokens are spent before the ticket goes in, and given back if it doesn't.
    const spend = (row: Row, dir: 1 | -1) => ({ ...row.inv, ...(body.boost ? { [body.boost]: row.inv[body.boost as 'boost25'] + dir } : {}), ...(body.insure ? { insurance: row.inv.insurance + dir } : {}) })
    if (body.boost || body.insure) {
      const ok = await update(me, row => ((body.boost && row.inv[body.boost as 'boost25'] < 1) || (body.insure && row.inv.insurance < 1) ? 'You are out of that token' : { next: { inv: spend(row, -1) }, out: true }))
      if (typeof ok === 'string') return fail(ok)
    }
    const { data: ids, error } = await admin.rpc('place_tickets', { p_user: me, p_tickets: tickets })
    if (error) {
      if (body.boost || body.insure) await update(me, row => ({ next: { inv: spend(row, 1) }, out: true }))
      return fail(nice(error))
    }
    const row = await loadPlayer(me)
    return json({ ids, tickets, balance: row.balance, squadBank: row.squad_bank, inv: row.inv })
  }

  if (body.action === 'leg') {
    const { data: bet } = await admin.from('bets').select('*').eq('id', body.betId).eq('user_id', me).single()
    if (!bet || bet.status !== 'pending') return fail('Ticket is closed')
    const played = playLeg(bet.legs, body.legId)
    if (typeof played === 'string') return fail(played)
    const { status, payout } = grade(played.legs, Number(bet.stake), bet.opts)
    const leg = played.legs.find(l => l.id === body.legId)!
    const { data: balance, error } = await admin.rpc('settle_leg', {
      p_user: me, p_bet: bet.id, p_leg: leg.id, p_game: leg.casino!.game, p_outcome: played.round,
      p_old: bet.legs, p_legs: played.legs, p_status: status, p_payout: payout,
    })
    return error ? fail(nice(error)) : json({ round: played.round, note: leg.note, legs: played.legs, status, payout, balance })
  }

  if (body.action === 'cashout') {
    const { data: bet } = await admin.from('bets').select('*').eq('id', body.betId).eq('user_id', me).single()
    if (!bet || bet.status !== 'pending') return fail('Ticket is closed')
    const amount = await cashOutQuote(bet.legs, Number(bet.stake), bet.opts, board())
    if (typeof amount === 'string') return fail(amount)
    const { data: balance, error } = await admin.rpc('cash_out', { p_user: me, p_bet: bet.id, p_old: bet.legs, p_amount: amount })
    return error ? fail(nice(error)) : json({ amount, balance })
  }

  if (body.action === 'start') {
    const hand = startHand(body)
    if (typeof hand === 'string') return fail(hand)
    // A hand left open on this table closes first, as if the player had walked away from it.
    const { data: left } = await admin.from('hands').select('*').eq('user_id', me).eq('game', hand.game).eq('open', true)
    for (const row of (left ?? []) as HandRow[]) { const c = closeHand(row.state, Number(row.wager)); await finish(me, row, c.hand, c.returned) }
    const wager = handWager(hand, body)
    const { data: handId, error } = await admin.rpc('open_hand', { p_user: me, p_game: hand.game, p_wager: wager, p_state: hand })
    if (error) return fail(nice(error))
    if (handOver(hand)) { const res = await finish(me, { id: handId, game: hand.game, wager, state: hand, version: 0 }, hand, (hand as { returned: number }).returned); const j = await res.json(); return json({ ...j, handId }, res.status) }
    const { data: p } = await admin.from('profiles').select('balance').eq('id', me).single()
    return json({ handId, view: handView(hand, false), balance: p?.balance })
  }

  if (body.action === 'move' || body.action === 'close') {
    const { data: row } = await admin.from('hands').select('*').eq('id', body.handId).eq('user_id', me).eq('open', true).single()
    if (!row) return fail('That hand already finished')
    const r = row as HandRow
    if (body.action === 'close') { const c = closeHand(r.state, Number(r.wager)); return finish(me, r, c.hand, c.returned) }
    const m = moveHand(r.state, body, Number(r.wager))
    if (typeof m === 'string') return fail(m)
    if (m.done) return finish(me, r, m.hand, m.returned, m.debit)
    if (m.debit) { // insurance, double or split: more chips on the felt
      const { data: balance, error } = await admin.rpc('hand_debit', { p_user: me, p_hand: r.id, p_version: r.version, p_state: m.hand, p_debit: m.debit })
      return error ? fail(nice(error)) : json({ view: handView(m.hand, false), done: false, returned: 0, balance })
    }
    const { data: saved } = await admin.from('hands').update({ state: m.hand, version: r.version + 1 }).eq('id', r.id).eq('version', r.version).select('id')
    return saved?.length ? json({ view: handView(m.hand, false), done: false, returned: 0 }) : fail('Too fast, try again')
  }

  if (body.action === 'spin') {
    // ponytail: check-then-pay, so two spins sent in the same instant could both pay; a unique daily key would close it
    const { count } = await admin.from('ledger').select('id', { count: 'exact', head: true }).eq('user_id', me).eq('kind', 'spin').gte('at', new Date(Date.now() - 864e5).toISOString())
    if (count) return fail('Your next spin unlocks 24 hours after the last one')
    const prize = spinIndex(rng)
    const p = SPIN_PRIZES[prize]
    if (p.spins || p.boost) await update(me, row => ({ next: { inv: { ...row.inv, spins: row.inv.spins + (p.spins ?? 0), ...(p.boost ? { [p.boost]: row.inv[p.boost] + 1 } : {}) } }, out: true }))
    const { data: balance, error } = await pay(me, p.cash ?? 0, 'spin', String(prize))
    return error ? fail(nice(error)) : json({ prize, balance })
  }

  if (body.action === 'claimLevels') {
    const row0 = await loadPlayer(me)
    const { xp } = await progress(me, row0)
    const r = await update(me, row => { const c = claimLevels(row, xp); return c.levels.length ? { next: c.player, out: c } : 'Nothing to claim' })
    if (typeof r === 'string') return fail(r)
    const { data: balance } = r.cash ? await pay(me, r.cash, 'level') : { data: row0.balance }
    return json({ levels: r.levels, cosmetics: r.cosmetics, cash: r.cash, inv: r.player.inv, balance })
  }

  if (body.action === 'claimChallenge') {
    const row0 = await loadPlayer(me)
    const { h } = await progress(me, row0)
    const r = await update(me, row => { const c = claimChallenge(row, h, String(body.id)); return typeof c === 'string' ? c : { next: c.player, out: c } })
    return typeof r === 'string' ? fail(r) : json({ skin: r.skin, xp: r.xp, inv: r.player.inv })
  }

  if (body.action === 'prestige') {
    const row0 = await loadPlayer(me)
    const { xp } = await progress(me, row0)
    const r = await update(me, row => { const c = enterPrestige(row, xp); return typeof c === 'string' ? c : { next: c.player, out: c } })
    if (typeof r === 'string') return fail(r)
    const { data: balance } = r.cash ? await pay(me, r.cash, 'prestige') : { data: row0.balance }
    return json({ prestige: r.player.prestige, prestigeStartedAt: r.player.prestige_started_at, rewards: r.rewards, cosmetics: r.cosmetics, inv: r.player.inv, balance })
  }

  if (body.action === 'claimSeason') {
    // Weeks run Monday to Monday in UTC on the server. ponytail: the app's weeks are local time, so a bet near midnight can land in a different week
    const week = String(body.week)
    const start = Date.parse(week + 'T00:00:00Z'), end = start + 7 * 864e5
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || !(end <= Date.now())) return fail('That week is not over yet')
    const { bets, rounds } = await historyRows(me, new Date(start).toISOString(), new Date(end).toISOString())
    const h = historyOf(bets, rounds)
    const settled = h.bets.filter(b => b.status !== 'pending')
    if (!settled.length && !h.rounds.length) return fail('No play that week')
    const net = settled.reduce((t, b) => t + b.payout - b.stake, 0) + h.rounds.reduce((t, x) => t + x.returned - x.wager, 0)
    const place = seasonPlace(week, net, end)
    const prize = PRIZES[place]
    if (!prize) return fail('No prize that week')
    const r = await update(me, row => (row.seasons_claimed.includes(week) ? 'Already claimed' : { next: { seasons_claimed: [...row.seasons_claimed, week] }, out: true }))
    if (typeof r === 'string') return fail(r)
    const { data: balance } = await pay(me, prize.cash, 'season', week)
    return json({ place, skin: prize.skin, cash: prize.cash, balance })
  }

  if (body.action === 'redeem') {
    // A friend's code, once, in your first 7 days: you get $100 + a 50% boost; they get $250 + 500 XP (+ more at 3 and 5 friends).
    const code = String(body.code ?? '').trim().toUpperCase()
    const { data: ref } = await admin.from('profiles').select('id').eq('code', code).maybeSingle()
    if (!ref) return fail('That code was not found')
    if (ref.id === me) return fail("You can't use your own code")
    const r = await update(me, row =>
      row.referred_by ? 'You already used a referral code'
        : Date.now() - Date.parse(row.created_at) > 7 * 864e5 ? 'Codes can only be used in your first 7 days'
          : { next: { referred_by: ref.id, inv: { ...row.inv, boost50: row.inv.boost50 + 1 } } as Partial<Player>, out: true })
    if (typeof r === 'string') return fail(r)
    const { data: balance } = await pay(me, 100, 'referral', ref.id)
    const count = (await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('referred_by', ref.id)).count ?? 0
    await update(ref.id, row => ({ next: { xp_bonus: row.xp_bonus + 500, inv: count === 3 ? { ...row.inv, boost100: row.inv.boost100 + 1 } : row.inv }, out: true }))
    await pay(ref.id, 250 + (count === 5 ? 1000 : 0), 'referral', me)
    return json({ balance })
  }

  if (body.action === 'squad') {
    const amount = Number(body.amount)
    if (!(amount > 0) || Math.round(amount * 100) !== amount * 100) return fail('Pick an amount')
    if (body.op === 'fund') {
      const { error } = await pay(me, -amount, 'squad', 'fund')
      if (error) return fail(nice(error))
      await admin.rpc('squad_apply', { p_user: me, p_delta: amount, p_kind: 'fund' })
    } else {
      const { error } = await admin.rpc('squad_apply', { p_user: me, p_delta: -amount, p_kind: 'withdraw' })
      if (error) return fail(nice(error))
      await pay(me, amount, 'squad', 'withdraw')
    }
    const row = await loadPlayer(me)
    return json({ balance: row.balance, squadBank: row.squad_bank })
  }

  if (body.action === 'cancel') {
    const { data: balance, error } = await admin.rpc('cancel_bet', { p_user: me, p_bet: body.betId })
    return error ? fail("That bet can't be cancelled anymore") : json({ balance })
  }

  if (body.action === 'settle') {
    await settleSports(me)
    const { data: p } = await admin.from('profiles').select('balance').eq('id', me).single()
    return json({ balance: p?.balance })
  }

  return fail('Unknown action')
})
