// POST /functions/v1/house with the player's sign-in token. Body: { action, ... }
//   round: { game, ...RoundReq }        paid table round, dealt here     -> { outcome, wager, returned, balance }
//   bet:   { legs, stake, mode, flex, chaos }  priced here, stake taken  -> { ids, tickets, balance }
//   leg:   { betId, legId }             free round for a casino leg      -> { round, note, legs, status, payout, balance }
import { createClient } from 'npm:@supabase/supabase-js@2'
import { dealRound, espnBoard, grade, playLeg, priceTickets } from '../_shared/house.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const fail = (error: string, status = 400) => json({ error }, status)
const nice = (e: { message?: string } | null) => (e?.message?.includes('insufficient_balance') ? 'Not enough balance' : e?.message?.includes('bet_changed') || e?.message?.includes('duplicate') ? 'That leg was already played' : 'Something went wrong')

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const board = () => espnBoard(async url => { const r = await fetch(url); if (!r.ok) throw new Error(String(r.status)); return r.json() })

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

  return fail('Unknown action')
})
