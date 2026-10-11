// POST /functions/v1/house with the player's sign-in token. Body: { action, ... }
//   round: { game, ...RoundReq }        paid table round, dealt here     -> { outcome, wager, returned, balance }
//   bet:   { legs, stake, mode, flex, chaos }  priced here, stake taken  -> { ids, tickets, balance }
//   leg:   { betId, legId }             free round for a casino leg      -> { round, note, legs, status, payout, balance }
//   cancel: { betId }                  undo a ticket within a minute, before anything is graded -> { balance }
//   start: { game: mines|poker|blackjack, wager | bets, mines? }  a hand that takes several taps -> { handId, view, balance }
//   move:  { handId, tile | cash | hold | bj }  one tap                  -> { view, done, returned, balance? }
//   close: { handId }                           walk away from a hand    -> { view, returned, balance }
//   settle: {}                          grade open sports legs from finals -> { balance }
// ponytail: settle runs when the app asks (it polls every 30s); a cron would settle tickets for players who are away
import { createClient } from 'npm:@supabase/supabase-js@2'
import { closeHand, dealRound, espnBoard, grade, gradeSports, handOver, handView, handWager, moveHand, playLeg, priceTickets, startHand, type Hand } from '../_shared/house.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const fail = (error: string, status = 400) => json({ error }, status)
const nice = (e: { message?: string } | null) => (e?.message?.includes('insufficient_balance') ? 'Not enough balance' : e?.message?.includes('bet_changed') || e?.message?.includes('duplicate') ? 'That leg was already played' : 'Something went wrong')

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const getJson = async (url: string) => { const r = await fetch(url); if (!r.ok) throw new Error(String(r.status)); return r.json() }
const board = () => espnBoard(getJson)

type HandRow = { id: string; game: string; wager: number; state: Hand; version: number }
/** Finish a hand: log the round and pay what it returned. */
async function finish(user: string, row: HandRow, state: Hand, returned: number, debit = 0) {
  const view = handView(state, true)
  const { data: balance, error } = await admin.rpc('close_hand', { p_user: user, p_hand: row.id, p_version: row.version, p_state: state, p_returned: returned, p_outcome: { [row.game]: view }, p_debit: debit })
  return error ? fail(error.message.includes('hand_changed') ? 'That hand already finished' : 'Something went wrong') : json({ view, done: true, returned, balance })
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
  const { data: { user } } = await admin.auth.getUser(token)
  if (!user) return fail('Sign in first', 401)
  const body = await req.json().catch(() => ({}))

  if (body.action === 'round') {
    const d = dealRound(body)
    if (typeof d === 'string') return fail(d)
    const { data: balance, error } = await admin.rpc('record_round', { p_user: user.id, p_game: body.game, p_wager: d.wager, p_returned: d.returned, p_outcome: d.outcome })
    return error ? fail(nice(error)) : json({ ...d, balance })
  }

  if (body.action === 'bet') {
    if (body.daily) { // one Daily Boost per (UTC) day
      const { count } = await admin.from('bets').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('opts->>daily', 'true').gte('placed_at', new Date().toISOString().slice(0, 10))
      if (count) return fail('Already bet today. A new boost drops tomorrow.')
    }
    const tickets = await priceTickets(body, board())
    if (typeof tickets === 'string') return fail(tickets)
    const { data: ids, error } = await admin.rpc('place_tickets', { p_user: user.id, p_tickets: tickets })
    if (error) return fail(nice(error))
    const { data: p } = await admin.from('profiles').select('balance').eq('id', user.id).single()
    return json({ ids, tickets, balance: p?.balance })
  }

  if (body.action === 'leg') {
    const { data: bet } = await admin.from('bets').select('*').eq('id', body.betId).eq('user_id', user.id).single()
    if (!bet || bet.status !== 'pending') return fail('Ticket is closed')
    const played = playLeg(bet.legs, body.legId)
    if (typeof played === 'string') return fail(played)
    const { status, payout } = grade(played.legs, Number(bet.stake), bet.opts)
    const leg = played.legs.find(l => l.id === body.legId)!
    const { data: balance, error } = await admin.rpc('settle_leg', {
      p_user: user.id, p_bet: bet.id, p_leg: leg.id, p_game: leg.casino!.game, p_outcome: played.round,
      p_old: bet.legs, p_legs: played.legs, p_status: status, p_payout: payout,
    })
    return error ? fail(nice(error)) : json({ round: played.round, note: leg.note, legs: played.legs, status, payout, balance })
  }

  if (body.action === 'start') {
    const hand = startHand(body)
    if (typeof hand === 'string') return fail(hand)
    // A hand left open on this table closes first, as if the player had walked away from it.
    const { data: left } = await admin.from('hands').select('*').eq('user_id', user.id).eq('game', hand.game).eq('open', true)
    for (const row of (left ?? []) as HandRow[]) { const c = closeHand(row.state, Number(row.wager)); await finish(user.id, row, c.hand, c.returned) }
    const wager = handWager(hand, body)
    const { data: handId, error } = await admin.rpc('open_hand', { p_user: user.id, p_game: hand.game, p_wager: wager, p_state: hand })
    if (error) return fail(nice(error))
    if (handOver(hand)) { const res = await finish(user.id, { id: handId, game: hand.game, wager, state: hand, version: 0 }, hand, (hand as { returned: number }).returned); const j = await res.json(); return json({ ...j, handId }, res.status) }
    const { data: p } = await admin.from('profiles').select('balance').eq('id', user.id).single()
    return json({ handId, view: handView(hand, false), balance: p?.balance })
  }

  if (body.action === 'move' || body.action === 'close') {
    const { data: row } = await admin.from('hands').select('*').eq('id', body.handId).eq('user_id', user.id).eq('open', true).single()
    if (!row) return fail('That hand already finished')
    const r = row as HandRow
    if (body.action === 'close') { const c = closeHand(r.state, Number(r.wager)); return finish(user.id, r, c.hand, c.returned) }
    const m = moveHand(r.state, body, Number(r.wager))
    if (typeof m === 'string') return fail(m)
    if (m.done) return finish(user.id, r, m.hand, m.returned, m.debit)
    if (m.debit) { // insurance, double or split: more chips on the felt
      const { data: balance, error } = await admin.rpc('hand_debit', { p_user: user.id, p_hand: r.id, p_version: r.version, p_state: m.hand, p_debit: m.debit })
      return error ? fail(nice(error)) : json({ view: handView(m.hand, false), done: false, returned: 0, balance })
    }
    const { data: saved } = await admin.from('hands').update({ state: m.hand, version: r.version + 1 }).eq('id', r.id).eq('version', r.version).select('id')
    return saved?.length ? json({ view: handView(m.hand, false), done: false, returned: 0 }) : fail('Too fast, try again')
  }

  if (body.action === 'cancel') {
    const { data: balance, error } = await admin.rpc('cancel_bet', { p_user: user.id, p_bet: body.betId })
    return error ? fail("That bet can't be cancelled anymore") : json({ balance })
  }

  if (body.action === 'settle') {
    const { data: bets } = await admin.from('bets').select('*').eq('user_id', user.id).eq('status', 'pending')
    const cache = new Map()
    for (const bet of bets ?? []) {
      const legs = await gradeSports(bet.legs, getJson, cache)
      if (!legs) continue
      const { status, payout } = grade(legs, Number(bet.stake), bet.opts)
      await admin.rpc('update_bet', { p_user: user.id, p_bet: bet.id, p_old: bet.legs, p_legs: legs, p_status: status, p_payout: payout })
    }
    const { data: p } = await admin.from('profiles').select('balance').eq('id', user.id).single()
    return json({ balance: p?.balance })
  }

  return fail('Unknown action')
})
