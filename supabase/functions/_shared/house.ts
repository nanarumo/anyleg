// The house: deals casino rounds, prices tickets and grades casino legs on the server, with the app's own
// game math (src/logic.ts) so odds and payouts match the app exactly. Pure: no Supabase, no Deno, so
// `node supabase/functions/_shared/house.test.ts` can check it.
import {
  CASINO_PICKS, CHAOS_BOOST, FLEX_MIN, PLINKO_RISK, applyTokens, bacReturn, boxStats, casinoPick, crashPoint, gradeCasino, gradeProp,
  gradeSport, minesMult, MINES_TILES, newShoe, placeMines, pokerHand, parlayDecimal, parseOdds, playBaccarat, plinkoPath, roulettePays, rouletteWins, roundText, settle, settleFlex,
  simRound, slotPays, spinReel, toDecimal, type Card, type CasinoGame, type Market, type PropStat, type Result, type Round, type Side,
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
      const windows = [0, 1, 2].map(() => [spinReel(rand), spinReel(rand), spinReel(rand)]) // 3 visible symbols per reel
      const { mult, name } = slotPays(windows.map(w => w[1])) // middle payline
      return { wager: req.wager, returned: +(req.wager * mult).toFixed(2), outcome: { slots: { windows, mult, name } } }
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

// ---- tables that take several taps: the board or deck stays on the server between them ----
export type MinesHand = { game: 'mines'; count: number; mines: number[]; opened: number[] }
export type PokerHand = { game: 'poker'; hand: Card[]; deck: Card[] }
export type Hand = MinesHand | PokerHand
export type Move = { tile?: number; cash?: boolean; hold?: boolean[] }
export type Moved = { hand: Hand; done: boolean; returned: number }

export function startHand(req: { game: string; wager: number; mines?: number }, rand = rng): Hand | string {
  if (!cents(req?.wager)) return 'Bad wager'
  if (req.game === 'mines') {
    const n = req.mines ?? 0
    if (!Number.isInteger(n) || n < 1 || n >= MINES_TILES) return 'Bad mine count'
    return { game: 'mines', count: n, mines: [...placeMines(n, rand)], opened: [] }
  }
  if (req.game === 'poker') {
    const deck = newShoe(1, rand)
    return { game: 'poker', hand: deck.splice(-5).reverse(), deck }
  }
  return 'Unknown game'
}

const minesSafe = (h: MinesHand) => h.opened.filter(t => !h.mines.includes(t)).length
const minesPaid = (h: MinesHand, wager: number) => (h.opened.some(t => h.mines.includes(t)) ? 0 : +(wager * minesMult(h.count, minesSafe(h))).toFixed(2))

/** One tap. Mines: { tile } or { cash }. Poker: { hold } draws once and ends the hand. */
export function moveHand(h: Hand, move: Move, wager: number): Moved | string {
  if (h.game === 'mines') {
    if (move?.cash) return minesSafe(h) ? { hand: h, done: true, returned: minesPaid(h, wager) } : 'Pick a tile first'
    const t = move?.tile
    if (!Number.isInteger(t) || t! < 0 || t! >= MINES_TILES || h.opened.includes(t!)) return 'Bad tile'
    const hand = { ...h, opened: [...h.opened, t!] }
    const done = h.mines.includes(t!) || minesSafe(hand) === MINES_TILES - h.count
    return { hand, done, returned: done ? minesPaid(hand, wager) : 0 }
  }
  const hold = move?.hold
  if (!Array.isArray(hold) || hold.length !== 5) return 'Pick cards to hold'
  const deck = [...h.deck]
  const hand = { ...h, hand: h.hand.map((c, i) => (hold[i] ? c : deck.pop()!)), deck }
  return { hand, done: true, returned: +(wager * pokerHand(hand.hand).pays).toFixed(2) }
}

/** A hand the player walked away from: mines banks the gems showing (or refunds an untouched board), poker stands on the deal. */
export function closeHand(h: Hand, wager: number): number {
  if (h.game === 'mines') return h.opened.length ? minesPaid(h, wager) : wager
  return +(wager * pokerHand(h.hand).pays).toFixed(2)
}

/** What the player may see. Mine spots only once the board is over; never the deck. */
export function handView(h: Hand, done: boolean) {
  if (h.game === 'poker') return { hand: h.hand }
  return { count: h.count, opened: h.opened, safe: minesSafe(h), boom: h.opened.some(t => h.mines.includes(t)), ...(done ? { mines: h.mines } : {}) }
}

// ---- tickets ----
export type Leg = {
  id: string; label: string; sub: string; odds: number; result?: Result; note?: string; chaos?: boolean
  sport?: { path: string; eventId: string; market: Market; side: Side; line?: number; prop?: unknown }
  casino?: { game: CasinoGame; pick: string }
  [k: string]: unknown
}
export type Ticket = { legs: Leg[]; stake: number; opts: { flex?: boolean; sgpMult?: number; boost?: number; chaos?: boolean } }
export type BetReq = { legs: Leg[]; stake: number; mode?: 'parlay' | 'singles'; flex?: boolean; chaos?: boolean; daily?: boolean }
const DAILY_BOOST = 0.3 // same as the app's store.ts
// ponytail: the server doesn't check these are the day's seeded Daily Boost picks, only one boosted 3-leg parlay per day
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
  if (req.daily && (mode !== 'parlay' || legs.length !== 3 || req.chaos || req.flex)) return 'The Daily Boost is one 3-leg parlay'
  const groups = mode === 'parlay' ? [legs] : legs.map(l => [l])
  return groups.map(g => {
    const { dec } = parlayDecimal(g)
    const straight = g.reduce((m, l) => m * toDecimal(l.odds), 1)
    return {
      legs: g, stake: req.stake,
      opts: { ...(dec < straight - 1e-9 ? { sgpMult: dec / straight } : {}), ...(req.flex ? { flex: true } : {}), ...(req.chaos ? { chaos: true, boost: CHAOS_BOOST } : {}), ...(req.daily ? { daily: true, boost: DAILY_BOOST } : {}) },
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

/** Grade open sports legs whose games are final, from ESPN's summary feed. Undefined = nothing changed. */
export async function gradeSports(legs: Leg[], fetchJson: (url: string) => Promise<any>, cache = new Map<string, Promise<any>>()): Promise<Leg[] | undefined> {
  let changed = false
  const out: Leg[] = []
  for (const l of legs) {
    const s = l.sport
    if (!s || l.result !== 'pending' || !/^[a-z-]+\/[a-z0-9.-]+$/.test(s.path) || !/^\d+$/.test(s.eventId)) { out.push(l); continue }
    const url = `https://site.api.espn.com/apis/site/v2/sports/${s.path}/summary?event=${s.eventId}`
    if (!cache.has(url)) cache.set(url, fetchJson(url).catch(() => undefined))
    const sum = await cache.get(url)
    const comp = sum?.header?.competitions?.[0]
    if (!comp?.status?.type?.completed) { out.push(l); continue }
    const score = (ha: string) => Number(comp.competitors.find((c: any) => c.homeAway === ha)?.score)
    const p = s.prop as { athleteId: string; stat: PropStat } | undefined
    const result = p ? gradeProp(p.stat, s.side, s.line!, boxStats(sum.boxscore?.players).get(p.athleteId)) : gradeSport(s.market, s.side, s.line, score('home'), score('away'))
    changed = true
    out.push({ ...l, result })
  }
  return changed ? out : undefined
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
