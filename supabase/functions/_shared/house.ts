// The house: deals casino rounds, prices tickets and grades casino legs on the server, with the app's own
// game math (src/logic.ts) so odds and payouts match the app exactly. Pure: no Supabase, no Deno, so
// `node supabase/functions/_shared/house.test.ts` can check it.
import {
  CASINO_PICKS, CHAOS_BOOST, FLEX_MIN, PLINKO_RISK, applyTokens, bacReturn, casinoPick, crashPoint, gradeCasino, newShoe,
  parlayDecimal, parseOdds, playBaccarat, plinkoPath, roulettePays, rouletteWins, roundText, settle, settleFlex, simRound,
  slotPays, spinReel, toDecimal, type CasinoGame, type Market, type Result, type Round, type Side,
} from '../../../src/logic.ts'

/** Uniform [0, 1) from the OS's crypto RNG. Players can't see or steer it. */
export const rng = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32

const cents = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 1e7 && Math.round(n * 100) === n * 100
const sum = (xs: { amount: number }[]) => +xs.reduce((t, x) => t + x.amount, 0).toFixed(2)

// ---- paid table rounds the server deals in one shot ----
export type RoundReq =
  | { game: 'roulette'; bets: { pick: string; amount: number }[] }
  | { game: 'baccarat'; bets: { spot: string; amount: number }[] }
  | { game: 'slots'; wager: number }
  | { game: 'plinko'; wager: number; risk: keyof typeof PLINKO_RISK }
  | { game: 'crash'; wager: number; cashAt: number } // ponytail: auto cash-out target; tap-to-cash-out needs server time (step 4)
export type Dealt = { wager: number; returned: number; outcome: Record<string, unknown> }

const ROULETTE_SPOT = /^(red|black|odd|even|low|high|[dc][123]|n([0-9]|[12]\d|3[0-6]))$/
const BAC_SPOTS = ['player', 'banker', 'tie', 'ppair', 'bpair']

/** Deal one paid round. Returns an error string for a bad request. */
export function dealRound(req: RoundReq, rand = rng): Dealt | string {
  switch (req?.game) {
    case 'roulette': {
      if (!Array.isArray(req.bets) || !req.bets.length || req.bets.length > 50) return 'Place a bet'
      if (req.bets.some(b => !ROULETTE_SPOT.test(b?.pick) || !cents(b.amount))) return 'Bad roulette bet'
      const n = Math.floor(rand() * 37)
      const returned = +req.bets.reduce((t, b) => t + (rouletteWins(b.pick, n) ? b.amount * roulettePays(b.pick) : 0), 0).toFixed(2)
      return { wager: sum(req.bets), returned, outcome: { roulette: n } }
    }
    case 'baccarat': {
      if (!Array.isArray(req.bets) || !req.bets.length || req.bets.some(b => !BAC_SPOTS.includes(b?.spot) || !cents(b.amount))) return 'Bad baccarat bet'
      const coup = playBaccarat(newShoe(8, rand))
      const returned = +req.bets.reduce((t, b) => t + bacReturn(b.spot, b.amount, coup), 0).toFixed(2)
      return { wager: sum(req.bets), returned, outcome: { baccarat: coup } }
    }
    case 'slots': {
      if (!cents(req.wager)) return 'Bad wager'
      const line = [spinReel(rand), spinReel(rand), spinReel(rand)]
      const { mult, name } = slotPays(line)
      return { wager: req.wager, returned: +(req.wager * mult).toFixed(2), outcome: { slots: { line, mult, name } } }
    }
    case 'plinko': {
      if (!cents(req.wager) || !(req.risk in PLINKO_RISK)) return 'Bad wager'
      const path = plinkoPath(rand)
      const mult = PLINKO_RISK[req.risk][path.reduce<number>((a, b) => a + b, 0)]
      return { wager: req.wager, returned: +(req.wager * mult).toFixed(2), outcome: { plinko: { path, mult, risk: req.risk } } }
    }
    case 'crash': {
      if (!cents(req.wager) || !(req.cashAt >= 1.01 && req.cashAt <= 1000)) return 'Bad wager'
      const point = crashPoint(rand)
      return { wager: req.wager, returned: point >= req.cashAt ? +(req.wager * req.cashAt).toFixed(2) : 0, outcome: { crash: { point, cashAt: req.cashAt } } }
    }
  }
  return 'Unknown game'
}

// ---- tickets ----
export type Leg = {
  id: string; label: string; sub: string; odds: number; result?: Result; note?: string; chaos?: boolean
  sport?: { path: string; eventId: string; market: Market; side: Side; line?: number; prop?: unknown }
  casino?: { game: CasinoGame; pick: string }
  [k: string]: unknown
}
export type Ticket = { legs: Leg[]; stake: number; opts: { flex?: boolean; sgpMult?: number; boost?: number; chaos?: boolean } }
export type BetReq = { legs: Leg[]; stake: number; mode?: 'parlay' | 'singles'; flex?: boolean; chaos?: boolean }
/** Pregame price for a market id like "nfl:401872974:spread:home", from the live feed. */
export type Board = (leg: Leg) => Promise<{ odds: number; line?: number } | undefined>

const MAX_LEGS = 15
const sameLine = (a?: number, b?: number) => a === b || (a !== undefined && b !== undefined && Math.abs(a - b) < 1e-9)

/** Re-price every leg from the house's own numbers, never the app's, and build the tickets. */
export async function priceTickets(req: BetReq, board: Board, rand = rng): Promise<Ticket[] | string> {
  if (!Array.isArray(req?.legs) || !req.legs.length) return 'Add a pick first'
  if (req.legs.length > MAX_LEGS) return `Max ${MAX_LEGS} legs`
  if (!cents(req.stake)) return 'Enter a stake'
  if (new Set(req.legs.map(l => l.id)).size !== req.legs.length) return 'Same leg twice'
  const legs: Leg[] = []
  for (const l of req.legs) {
    if (l.casino) {
      const p = casinoPick(l.casino.game, l.casino.pick)
      if (!p) return 'That casino leg is not on offer'
      legs.push({ id: `casino:${l.casino.game}:${l.casino.pick}`, label: p.label, sub: String(l.sub ?? ''), odds: p.odds, casino: { game: l.casino.game, pick: l.casino.pick }, result: 'pending' })
    } else if (l.sport) {
      const price = await board(l)
      if (!price) return `${l.label} is off the board`
      if (!sameLine(price.line, l.sport.line)) return `${l.label}: the line moved`
      legs.push({ ...l, odds: price.odds, result: 'pending' })
    } else return 'Unknown leg'
  }
  const mode = req.chaos ? 'parlay' : req.mode ?? 'parlay'
  if (req.chaos) {
    if (req.flex) return 'The chaos leg rides on one parlay ticket'
    const pool = (Object.keys(CASINO_PICKS) as CasinoGame[]).flatMap(g => CASINO_PICKS[g].filter(p => p.odds >= 100 && p.odds <= 800).map(p => ({ g, p })))
      .filter(({ g, p }) => !legs.some(l => l.id === `casino:${g}:${p.pick}`))
    const { g, p } = pool[Math.floor(rand() * pool.length)]
    legs.push({ id: `casino:${g}:${p.pick}`, label: p.label, sub: 'Chaos leg', odds: p.odds, casino: { game: g, pick: p.pick }, chaos: true, result: 'pending' })
  }
  // A casino leg is a free round, so it can only ride inside a parlay; on its own it would be a free bet.
  if (legs.some(l => l.casino) && (mode === 'singles' || legs.length < 2)) return 'Casino legs only count inside a parlay. Add another leg.'
  if (req.flex && (mode !== 'parlay' || legs.length < FLEX_MIN || parlayDecimal(legs).sgpGames)) return `Flex needs ${FLEX_MIN}+ legs from different games`
  const groups = mode === 'parlay' ? [legs] : legs.map(l => [l])
  return groups.map(g => {
    const { dec } = parlayDecimal(g)
    const straight = g.reduce((m, l) => m * toDecimal(l.odds), 1)
    return {
      legs: g, stake: req.stake,
      opts: { ...(dec < straight - 1e-9 ? { sgpMult: dec / straight } : {}), ...(req.flex ? { flex: true } : {}), ...(req.chaos ? { chaos: true, boost: CHAOS_BOOST } : {}) },
    }
  })
}

/** Same grading the app does in gradeLegs, for one ticket. */
export function grade(legs: Leg[], stake: number, opts: Ticket['opts'] & { insured?: boolean }) {
  const results = legs.map(l => l.result ?? 'pending')
  const base = (opts.flex ? settleFlex : settle)(results, stake, legs.map(l => l.odds))
  if (base.status === 'won' && opts.sgpMult) base.payout = Math.max(stake, +(base.payout * opts.sgpMult).toFixed(2))
  return applyTokens(results, base, stake, opts.boost, opts.insured)
}

/** Deal the free round that settles one casino leg, with the house strategy its price was simulated on. */
export function playLeg(legs: Leg[], legId: string, rand = rng): { legs: Leg[]; round: Round } | string {
  const leg = legs.find(l => l.id === legId)
  if (!leg?.casino) return 'Not a casino leg'
  if (leg.result !== 'pending') return 'Leg already played'
  // ponytail: blackjack/mines/poker legs are auto-played; letting the player make the calls needs server-held hands (step 4)
  const round = simRound(leg.casino.game, leg.casino.pick, rand)
  return { round, legs: legs.map(l => (l.id === legId ? { ...l, result: gradeCasino(leg.casino!.pick, round), note: roundText(round) } : l)) }
}

// ---- the live feed, for pricing pregame sports legs ----
const num = (s?: string) => (s == null ? undefined : Number(String(s).replace(/^[ou]/, '')))

/** Pregame prices from the same ESPN scoreboard feed the app shows. Props and live legs are refused until step 3 prices them here. */
export function espnBoard(fetchJson: (url: string) => Promise<any>): Board {
  const feeds = new Map<string, Promise<any>>()
  return async leg => {
    const s = leg.sport!
    if (s.prop || leg.id.includes(':live:') || !/^[a-z-]+\/[a-z0-9.-]+$/.test(s.path)) return undefined
    if (!feeds.has(s.path)) feeds.set(s.path, fetchJson(`https://site.api.espn.com/apis/site/v2/sports/${s.path}/scoreboard`).catch(() => undefined))
    const e = (await feeds.get(s.path))?.events?.find((x: any) => x.id === s.eventId)
    if (e?.status?.type?.state !== 'pre') return undefined
    const o = e.competitions?.[0]?.odds?.[0]
    const close = s.market === 'ml' ? o?.moneyline?.[s.side]?.close : s.market === 'spread' ? o?.pointSpread?.[s.side]?.close : s.market === 'total' ? o?.total?.[s.side]?.close : undefined
    const odds = parseOdds(close?.odds)
    if (odds === undefined || leg.id !== `${leg.id.split(':')[0]}:${s.eventId}:${s.market}:${s.side}`) return undefined
    return { odds, line: s.market === 'ml' ? undefined : num(close?.line) }
  }
}
