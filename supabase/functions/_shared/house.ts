// The house: deals casino rounds, prices tickets and grades casino legs on the server, with the app's own
// game math (src/logic.ts) so odds and payouts match the app exactly. Pure: no Supabase, no Deno, so
// `node supabase/functions/_shared/house.test.ts` can check it.
import {
  CASINO_PICKS, CHAOS_BOOST, bjOutcome, buster, canSplit, handValue, isBlackjack, luckyLadies, perfectPairs, playDealer, twentyOnePlus3, FLEX_MIN, PLINKO_RISK, applyTokens, bacReturn, bacValue, boxStats, rouletteColor, casinoPick, crashPoint, gradeCasino, gradeProp,
  gradeSport, minesMult, MINES_TILES, newShoe, placeMines, pokerHand, parlayDecimal, parseOdds, playBaccarat, plinkoPath, roulettePays, rouletteWins, roundText, settle, settleFlex,
  simRound, slotPays, spinReel, toDecimal, type Card, type CasinoGame, type Market, type PropStat, type Result, type Round, type Side,
} from '../../../src/logic.ts'
import { cashOutValue, legProb, priceOf, type LiveInput } from '../../../src/live.ts'
import { PROP_ODDS, fetchProps } from '../../../src/props.ts'

/** Uniform [0, 1) from the OS's crypto RNG. Players can't see or steer it. */
export const rng = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32

export const FREE_SPIN_VALUE = 5 // same as the app's store.ts
const cents = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 1e7 && Math.round(n * 100) === n * 100
const sum = (xs: { amount: number }[]) => +xs.reduce((t, x) => t + x.amount, 0).toFixed(2)

// ---- paid table rounds the server deals in one shot ----
export type RoundReq =
  | { game: 'roulette'; bets: { pick: string; amount: number }[] }
  | { game: 'baccarat'; bets: { spot: string; amount: number }[] }
  | { game: 'slots'; wager: number; free?: boolean } // free: spends a Free Spin token, played at FREE_SPIN_VALUE
  | { game: 'plinko'; wager: number; risk: keyof typeof PLINKO_RISK }
  | { game: 'crash'; wager: number; cashAt: number } // ponytail: auto cash-out target; tap-to-cash-out needs server time (step 4)
/** note: the same one-liner the app logs for the round (challenges read some, like "BLACKJACK!"). */
export type Dealt = { wager: number; returned: number; outcome: Record<string, unknown>; note: string }

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
      return { wager: sum(req.bets), returned, outcome: { roulette: n }, note: `${n} ${rouletteColor(n)}` }
    }
    case 'baccarat': {
      if (!Array.isArray(req.bets) || !req.bets.length || req.bets.some(b => !BAC_SPOTS.includes(b?.spot) || !cents(b.amount))) return 'Bad baccarat bet'
      const coup = playBaccarat(newShoe(8, rand))
      const returned = +req.bets.reduce((t, b) => t + bacReturn(b.spot, b.amount, coup), 0).toFixed(2)
      return { wager: sum(req.bets), returned, outcome: { baccarat: coup }, note: `${coup.winner === 'tie' ? 'Tie' : coup.winner === 'player' ? 'Player' : 'Banker'} ${bacValue(coup.player)}–${bacValue(coup.banker)}` }
    }
    case 'slots': {
      if (!req.free && !cents(req.wager)) return 'Bad wager'
      const stake = req.free ? FREE_SPIN_VALUE : req.wager
      const windows = [0, 1, 2].map(() => [spinReel(rand), spinReel(rand), spinReel(rand)]) // 3 visible symbols per reel
      const { mult, name } = slotPays(windows.map(w => w[1])) // middle payline
      return { wager: req.free ? 0 : stake, returned: +(stake * mult).toFixed(2), outcome: { slots: { windows, mult, name } }, note: name }
    }
    case 'plinko': {
      if (!cents(req.wager) || !(req.risk in PLINKO_RISK)) return 'Bad wager'
      const path = plinkoPath(rand)
      const mult = PLINKO_RISK[req.risk][path.reduce<number>((a, b) => a + b, 0)]
      return { wager: req.wager, returned: +(req.wager * mult).toFixed(2), outcome: { plinko: { path, mult, risk: req.risk } }, note: `${mult}x (${req.risk})` }
    }
    case 'crash': {
      if (!cents(req.wager) || !(req.cashAt >= 1.01 && req.cashAt <= 1000)) return 'Bad wager'
      const point = crashPoint(rand)
      return { wager: req.wager, returned: point >= req.cashAt ? +(req.wager * req.cashAt).toFixed(2) : 0, outcome: { crash: { point, cashAt: req.cashAt } }, note: point >= req.cashAt ? `Cashed out ${req.cashAt.toFixed(2)}x` : `Crashed at ${point.toFixed(2)}x` }
    }
  }
  return 'Unknown game'
}

// ---- tables that take several taps: the board or deck stays on the server between them ----
export type MinesHand = { game: 'mines'; count: number; mines: number[]; opened: number[] }
export type PokerHand = { game: 'poker'; hand: Card[]; deck: Card[] }
export type BjSpot = 'main' | 'pp' | 't3' | 'll' | 'bust'
export type SideHit = { name: string; pays: number; returned: number }
export type BjHand = {
  game: 'blackjack'; shoe: Card[]; bets: Record<BjSpot, number>; phase: 'insurance' | 'play' | 'done'
  hands: { cards: Card[]; wager: number; done: boolean; result?: Result }[]; active: number; dealer: Card[]
  insurance: number; side: Partial<Record<BjSpot, SideHit>>; returned: number
}
export type Hand = MinesHand | PokerHand | BjHand
export type Move = { tile?: number; cash?: boolean; hold?: boolean[]; bj?: 'hit' | 'stand' | 'double' | 'split' | 'insure' | 'noInsure' }
/** debit: extra chips this move put on the felt (insurance, double, split). */
export type Moved = { hand: Hand; done: boolean; returned: number; debit?: number }

export function startHand(req: { game: string; wager?: number; mines?: number; bets?: Record<BjSpot, number> }, rand = rng): Hand | string {
  if (req?.game === 'blackjack') return bjStart(req.bets, rand)
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
  if (h.game === 'blackjack') return bjMove(h, move ?? {})
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
export function closeHand(h: Hand, wager: number): { hand: Hand; returned: number } {
  if (h.game === 'blackjack') { const done = bjClose(h); return { hand: done, returned: done.returned } }
  if (h.game === 'mines') return { hand: h, returned: h.opened.length ? minesPaid(h, wager) : wager }
  return { hand: h, returned: +(wager * pokerHand(h.hand).pays).toFixed(2) }
}
/** A blackjack deal can end the hand on the spot (a blackjack on either side). */
export const handOver = (h: Hand) => h.game === 'blackjack' && h.phase === 'done'
/** What the player stakes to start a hand. */
export const handWager = (h: Hand, req: { wager?: number }) => (h.game === 'blackjack' ? bjWager(h.bets) : Number(req.wager))

/** The one-liner the app logs for a finished hand. */
export function handNote(h: Hand): string {
  if (h.game === 'poker') return pokerHand(h.hand).name
  if (h.game === 'mines') {
    const safe = minesSafe(h)
    return h.opened.some(t => h.mines.includes(t)) ? `Mine after ${safe} gems` : `${safe} gems · ${minesMult(h.count, safe)}x`
  }
  if (h.hands.length > 1) return 'Split hands'
  const { cards, result } = h.hands[0]
  return result === 'push' ? 'PUSH' : result === 'lost' ? (handValue(cards) > 21 ? 'BUST' : 'DEALER WINS') : isBlackjack(cards) ? 'BLACKJACK!' : 'WIN'
}

/** What the player may see. Mine spots only once the board is over; never the deck. */
export function handView(h: Hand, done: boolean) {
  if (h.game === 'blackjack') {
    const { shoe, ...seen } = h
    return h.phase === 'done' ? seen : { ...seen, dealer: [h.dealer[0], { rank: '?', suit: '?' }] } // hole card stays face down
  }
  if (h.game === 'poker') return { hand: h.hand }
  return { count: h.count, opened: h.opened, safe: minesSafe(h), boom: h.opened.some(t => h.mines.includes(t)), ...(done ? { mines: h.mines } : {}) }
}

// ---- blackjack: the same rules as Blackjack.tsx (dealer stands on 17, 3:2, split once, split aces get one card) ----
const BJ_SPOTS: BjSpot[] = ['main', 'pp', 't3', 'll', 'bust']
/** Everything on the felt when the hand is dealt (main + side bets). */
export const bjWager = (b: Record<BjSpot, number>) => +BJ_SPOTS.reduce((t, k) => t + b[k], 0).toFixed(2)

function bjStart(bets: Record<BjSpot, number> | undefined, rand: () => number): BjHand | string {
  if (!bets || !cents(bets.main) || BJ_SPOTS.some(k => (bets[k] ?? 0) !== 0 && !cents(bets[k]))) return 'Bad bet'
  const b = Object.fromEntries(BJ_SPOTS.map(k => [k, bets[k] ?? 0])) as Record<BjSpot, number>
  const shoe = newShoe(6, rand)
  const p = [shoe.pop()!, shoe.pop()!], d = [shoe.pop()!, shoe.pop()!]
  const hit = (r: { name: string; pays: number }, amt: number): SideHit | undefined => (amt && r.pays ? { ...r, returned: amt * (r.pays + 1) } : undefined)
  const side = { pp: hit(perfectPairs(p), b.pp), t3: hit(twentyOnePlus3([...p, d[0]]), b.t3), ll: hit(luckyLadies(p, isBlackjack(d)), b.ll) }
  const h: BjHand = { game: 'blackjack', shoe, bets: b, phase: 'play', hands: [{ cards: p, wager: b.main, done: false }], active: 0, dealer: d, insurance: 0, side, returned: 0 }
  if (d[0].rank === 'A' && !isBlackjack(p)) return { ...h, phase: 'insurance' }
  return isBlackjack(p) || isBlackjack(d) ? bjFinish(h) : h
}

/** The dealer plays, every hand is graded and the side bets are paid. */
function bjFinish(h: BjHand): BjHand {
  const shoe = [...h.shoe], d = [...h.dealer]
  const split = h.hands.length > 1
  const live = h.hands.some(x => handValue(x.cards) <= 21) && !(!split && isBlackjack(h.hands[0].cards))
  if (live || (h.bets.bust > 0 && !isBlackjack(d))) playDealer(d, shoe)
  const outcomes = h.hands.map(x => bjOutcome(x.cards, d, x.wager, split))
  const side = { ...h.side }
  const b = buster(d)
  if (h.bets.bust && b.pays) side.bust = { ...b, returned: h.bets.bust * (b.pays + 1) }
  const sides = Object.values(side).reduce((t, s) => t + (s?.returned ?? 0), 0)
  const insurance = isBlackjack(d) ? h.insurance * 3 : 0 // insurance pays 2 to 1
  const returned = +(outcomes.reduce((t, o) => t + o.returned, 0) + sides + insurance).toFixed(2)
  return { ...h, shoe, dealer: d, side, phase: 'done', hands: h.hands.map((x, i) => ({ ...x, done: true, result: outcomes[i].result })), returned }
}

/** Walking away: no insurance, every open hand stands. */
const bjClose = (h: BjHand) => bjFinish({ ...h, hands: h.hands.map(x => ({ ...x, done: true })) })

/** Move to the next unfinished hand, or let the dealer play. */
function bjAdvance(h: BjHand): BjHand {
  const next = h.hands.findIndex(x => !x.done)
  if (next < 0) return bjFinish(h)
  if (handValue(h.hands[next].cards) >= 21) return bjAdvance({ ...h, hands: h.hands.map((x, i) => (i === next ? { ...x, done: true } : x)) })
  return { ...h, active: next }
}

function bjMove(h: BjHand, move: Move): Moved | string {
  const out = (hand: BjHand, debit = 0): Moved => ({ hand, done: hand.phase === 'done', returned: hand.phase === 'done' ? hand.returned : 0, debit })
  if (h.phase === 'insurance') {
    if (move.bj !== 'insure' && move.bj !== 'noInsure') return 'Take or skip insurance'
    const ins = move.bj === 'insure' ? Math.floor(h.hands[0].wager / 2) : 0
    const next: BjHand = { ...h, insurance: ins, phase: 'play' }
    return out(isBlackjack(h.dealer) ? bjFinish(next) : next, ins)
  }
  if (h.phase !== 'play') return 'Hand is over'
  const shoe = [...h.shoe], cur = h.hands[h.active]
  const set = (x: Partial<BjHand['hands'][number]>) => h.hands.map((y, i) => (i === h.active ? { ...y, ...x } : y))
  switch (move.bj) {
    case 'hit': {
      const cards = [...cur.cards, shoe.pop()!]
      const next = { ...h, shoe, hands: set({ cards, done: handValue(cards) >= 21 }) }
      return out(handValue(cards) >= 21 ? bjAdvance(next) : next)
    }
    case 'stand': return out(bjAdvance({ ...h, hands: set({ done: true }) }))
    case 'double':
      if (cur.cards.length !== 2) return 'Double on your first two cards'
      return out(bjAdvance({ ...h, shoe, hands: set({ cards: [...cur.cards, shoe.pop()!], wager: cur.wager * 2, done: true }) }), cur.wager)
    case 'split': {
      if (h.hands.length > 1 || !canSplit(cur.cards)) return 'That hand can not be split'
      const [a, b] = cur.cards, aces = a.rank === 'A'
      const hands = [{ cards: [a, shoe.pop()!], wager: cur.wager, done: aces }, { cards: [b, shoe.pop()!], wager: cur.wager, done: aces }]
      return out(bjAdvance({ ...h, shoe, hands, active: 0 }), cur.wager)
    }
  }
  return 'Unknown move'
}

// ---- tickets ----
export type Leg = {
  id: string; label: string; sub: string; odds: number; result?: Result; note?: string; chaos?: boolean
  sport?: { path: string; eventId: string; market: Market; side: Side; line?: number; prop?: unknown }
  casino?: { game: CasinoGame; pick: string }
  [k: string]: unknown
}
export type Ticket = { legs: Leg[]; stake: number; opts: { flex?: boolean; sgpMult?: number; boost?: number; chaos?: boolean; insured?: boolean; squad?: boolean; daily?: boolean } }
/** boost / insure spend the player's reward tokens (the caller takes them); squad stakes from the squad bank. */
export type BetReq = { legs: Leg[]; stake: number; mode?: 'parlay' | 'singles'; flex?: boolean; chaos?: boolean; daily?: boolean; boost?: 'boost25' | 'boost50' | 'boost100'; insure?: boolean; squad?: boolean }
const BOOST_PCT = { boost25: 0.25, boost50: 0.5, boost100: 1 }
const DAILY_BOOST = 0.3 // same as the app's store.ts
// ponytail: the server doesn't check these are the day's seeded Daily Boost picks, only one boosted 3-leg parlay per day
/** The house's price for a sports leg right now, and (live games) the model's fair chance it wins. Undefined = off the board. */
export type Board = (leg: Leg) => Promise<{ odds: number; line?: number; prob?: number } | undefined>

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
      legs.push({ id: `casino:${l.casino.game}:${l.casino.pick}`, label: p.label, sub: String(l.sub ?? ''), odds: p.odds, casino: { game: l.casino.game, pick: l.casino.pick }, result: 'pending', ...(req.squad && typeof l.by === 'string' ? { by: l.by.slice(0, 40) } : {}) })
    } else if (l.sport) {
      const price = await board(l)
      if (!price) return `${l.label} is off the board`
      if (!sameLine(price.line, l.sport.line)) return `${l.label}: the line moved`
      const s = l.sport, p = s.prop as { athleteId?: unknown; stat?: unknown } | undefined
      const str = (x: unknown, n: number) => (typeof x === 'string' ? x.slice(0, n) : '')
      legs.push({ // only the fields the app needs: nothing else from the request rides along
        id: str(l.id, 120), label: str(l.label, 120), sub: str(l.sub, 120), odds: price.odds, result: 'pending',
        ...(typeof l.icon === 'string' && l.icon.startsWith('data:image/svg+xml,') ? { icon: l.icon.slice(0, 2000) } : {}),
        ...(typeof l.icon2 === 'string' && l.icon2.startsWith('data:image/svg+xml,') ? { icon2: l.icon2.slice(0, 2000) } : {}),
        sport: { path: s.path, eventId: s.eventId, market: s.market, side: s.side, ...(s.line === undefined ? {} : { line: s.line }), ...(p ? { prop: { athleteId: String(p.athleteId), stat: String(p.stat) } } : {}) },
        ...(req.squad && typeof l.by === 'string' ? { by: l.by.slice(0, 40) } : {}),
      })
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
  if (req.boost && (!(req.boost in BOOST_PCT) || groups.length !== 1 || req.flex || req.daily || req.squad)) return 'A boost goes on one ticket'
  if (req.insure && (mode !== 'parlay' || legs.length < 4 || req.flex || req.squad)) return 'Insurance covers parlays of 4+ legs'
  if (req.squad && mode !== 'parlay') return 'The squad bets one parlay'
  const boost = (req.boost ? BOOST_PCT[req.boost] : 0) + (req.chaos ? CHAOS_BOOST : 0) + (req.daily ? DAILY_BOOST : 0)
  return groups.map(g => {
    const { dec } = parlayDecimal(g)
    const straight = g.reduce((m, l) => m * toDecimal(l.odds), 1)
    return {
      legs: g, stake: req.stake,
      opts: { ...(dec < straight - 1e-9 ? { sgpMult: dec / straight } : {}), ...(req.flex ? { flex: true } : {}), ...(req.chaos ? { chaos: true } : {}), ...(req.daily ? { daily: true } : {}), ...(boost ? { boost } : {}), ...(req.insure ? { insured: true } : {}), ...(req.squad ? { squad: true } : {}) },
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

// ---- the live feed: pregame lines, player props and live in-game prices, from the same ESPN feeds the app shows ----
const num = (s?: string) => (s == null ? undefined : Number(String(s).replace(/^[ou]/, '')))
const PATH = /^[a-z-]+\/[a-z0-9.-]+$/

export function espnBoard(fetchJson: (url: string) => Promise<any>): Board {
  const feeds = new Map<string, Promise<any>>()
  const get = (url: string) => { if (!feeds.has(url)) feeds.set(url, fetchJson(url).catch(() => undefined)); return feeds.get(url)! }
  return async leg => {
    const s = leg.sport!
    const league = leg.id.split(':')[0]
    if (!PATH.test(s.path) || !/^\d+$/.test(s.eventId)) return undefined
    const e = (await get(`https://site.api.espn.com/apis/site/v2/sports/${s.path}/scoreboard`))?.events?.find((x: any) => x.id === s.eventId)
    const state = e?.status?.type?.state
    const comp = e?.competitions?.[0]
    if (leg.id.includes(':live:')) {
      // Live: the model's price for the leg's line, from the score, the clock and the pregame line.
      if (state !== 'in' || s.prop || leg.id !== `${league}:${s.eventId}:live:${s.market}:${s.side}${s.line === undefined ? '' : ':' + s.line}`) return undefined
      const sum = await get(`https://site.api.espn.com/apis/site/v2/sports/${s.path}/summary?event=${s.eventId}`)
      const pc = sum?.pickcenter?.[0]
      const score = (ha: string) => Number(comp.competitors.find((c: any) => c.homeAway === ha)?.score) || 0
      const g: LiveInput = { league, home: score('home'), away: score('away'), period: e.status.period ?? 1, clock: e.status.displayClock ?? '',
        pre: { margin: pc?.spread === undefined ? undefined : -Number(pc.spread), total: pc?.overUnder === undefined ? undefined : Number(pc.overUnder) } }
      const prob = legProb(g, s.market, s.side, s.line)
      return { odds: priceOf(prob), line: s.line, prob }
    }
    if (state !== 'pre') return undefined
    if (s.prop) {
      if (!comp?.competitors) return undefined
      // Props: the main over/under at the standard price, or a ladder rung priced from the main line.
      const p = s.prop as { athleteId: string; stat: string }
      const teams = (ha: string) => { const t = comp.competitors.find((c: any) => c.homeAway === ha); return { id: t?.team?.id, name: '', abbr: t?.team?.abbreviation ?? '' } }
      const game = { id: s.eventId, league, path: s.path, state: 'pre', home: teams('home'), away: teams('away') } as unknown as Parameters<typeof fetchProps>[0]
      const prop = (await fetchProps(game).catch(() => [])).find(x => x.athleteId === p.athleteId && x.stat === p.stat)
      if (!prop) return undefined
      if (leg.id === `${prop.key}:${s.side}` && s.line === prop.line && (s.side === 'over' || s.side === 'under')) return { odds: PROP_ODDS, line: prop.line }
      const rung = prop.ladder.find(r => leg.id === `${prop.key}:alt:${r.at}`)
      return rung && s.side === 'over' ? { odds: rung.odds, line: rung.at - 0.5 } : undefined
    }
    const o = comp?.odds?.[0]
    const close = s.market === 'ml' ? o?.moneyline?.[s.side]?.close : s.market === 'spread' ? o?.pointSpread?.[s.side]?.close : s.market === 'total' ? o?.total?.[s.side]?.close : undefined
    const odds = parseOdds(close?.odds)
    if (odds === undefined || leg.id !== `${league}:${s.eventId}:${s.market}:${s.side}`) return undefined
    return { odds, line: s.market === 'ml' ? undefined : num(close?.line) }
  }
}

/** What an open ticket sells for now (the app's cash-out rule), or a reason it can't. */
export async function cashOutQuote(legs: Leg[], stake: number, opts: Ticket['opts'], board: Board): Promise<number | string> {
  if (opts.flex) return 'Flex tickets ride to the end'
  const probs = await Promise.all(legs.map(async l => {
    if (l.result !== 'pending' || !l.sport) return undefined
    const live = await board({ ...l, id: l.id }) // a pregame leg's current price, or a live game's model chance
    if (l.id.includes(':live:') || !live) {
      if (live?.prob !== undefined) return live.prob
      // A pregame leg whose game has started: price it live from the model.
      const s = l.sport, league = l.id.split(':')[0]
      const asLive = await board({ ...l, id: `${league}:${s.eventId}:live:${s.market}:${s.side}${s.line === undefined ? '' : ':' + s.line}` })
      return s.prop ? undefined : asLive?.prob
    }
    return 1 / toDecimal(live.odds)
  }))
  const v = cashOutValue(stake * (opts.sgpMult ?? 1), legs, probs)
  return v ?? 'Nothing to cash out'
}
