// 1v1 duplicate blackjack: both players play the same hands, so luck cancels out and decisions decide it.
// Each hand has two fixed card orders from the duel's seed: one the player draws from, one the dealer draws
// from. Hitting never changes the dealer's cards, so two players who make the same choices get the same result.
import { bjOutcome, canSplit, handValue, isBlackjack, newShoe, type Card, type Result } from './logic.ts'

export const START_STACK = 1000
export const MIN_BET = 10

/** Small seeded PRNG (mulberry32) so a seed always reproduces the same shuffle. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const streams = (seed: number, hand: number) => ({
  p: newShoe(1, rng(seed * 1009 + hand * 2)),
  d: newShoe(1, rng(seed * 1009 + hand * 2 + 1)),
})

export type DHand = { cards: Card[]; wager: number; done: boolean; result?: Result }
export type Round = {
  n: number; bet: number; hands: DHand[]; dealer: Card[]; pi: number; di: number
  moves: string[] // H S D P, for the recap
  over: boolean; delta: number // chips won/lost this hand, once over
}

/** Deal hand `n` for a stake already checked against the stack. */
export function deal(seed: number, n: number, bet: number): Round {
  const { p, d } = streams(seed, n)
  const r: Round = { n, bet, hands: [{ cards: [p[0], p[1]], wager: bet, done: false }], dealer: [d[0], d[1]], pi: 2, di: 2, moves: [], over: false, delta: 0 }
  if (isBlackjack(r.hands[0].cards) || isBlackjack(r.dealer)) return finish(seed, { ...r, hands: [{ ...r.hands[0], done: true }] })
  return r
}

const active = (r: Round) => r.hands.findIndex(h => !h.done)
const committed = (r: Round) => r.hands.reduce((t, h) => t + h.wager, 0)

export type Move = 'hit' | 'stand' | 'double' | 'split'

/** What the player may do now; `stack` is chips not already on the table. */
export function canDo(r: Round, stack: number): Record<Move, boolean> {
  const i = active(r)
  if (r.over || i < 0) return { hit: false, stand: false, double: false, split: false }
  const h = r.hands[i]
  const spare = stack - committed(r)
  return { hit: true, stand: true, double: h.cards.length === 2 && spare >= h.wager, split: r.hands.length === 1 && canSplit(h.cards) && spare >= h.wager }
}

export function play(seed: number, r: Round, move: Move, stack: number): Round {
  if (!canDo(r, stack)[move]) return r
  const { p } = streams(seed, r.n)
  const i = active(r)
  let pi = r.pi
  const draw = () => p[pi++]
  let hands = r.hands.map(h => ({ ...h, cards: [...h.cards] }))
  const h = hands[i]
  if (move === 'hit') { h.cards.push(draw()); h.done = handValue(h.cards) >= 21 }
  if (move === 'stand') h.done = true
  if (move === 'double') { h.cards.push(draw()); h.wager *= 2; h.done = true }
  if (move === 'split') {
    const aces = h.cards[0].rank === 'A'
    hands = [h.cards[0], h.cards[1]].map(c => ({ cards: [c, draw()], wager: h.wager, done: aces }))
    hands.forEach(x => { if (handValue(x.cards) === 21) x.done = true })
  }
  const next: Round = { ...r, hands, pi, moves: [...r.moves, { hit: 'H', stand: 'S', double: 'D', split: 'P' }[move]] }
  return active(next) < 0 ? finish(seed, next) : next
}

function finish(seed: number, r: Round): Round {
  const { d } = streams(seed, r.n)
  const dealer = [...r.dealer]
  let di = r.di
  const split = r.hands.length > 1
  const live = r.hands.some(h => handValue(h.cards) <= 21) && !(!split && isBlackjack(r.hands[0].cards))
  if (live && !isBlackjack(dealer)) while (handValue(dealer) < 17) dealer.push(d[di++])
  let delta = 0
  const hands = r.hands.map(h => {
    const o = bjOutcome(h.cards, dealer, h.wager, split)
    delta += o.returned - h.wager
    return { ...h, done: true, result: o.result }
  })
  return { ...r, hands, dealer, di, over: true, delta }
}

export type PlayerRun = { name: string; stack: number; rounds: Round[] }
export type Duel = { seed: number; length: number; players: [PlayerRun, PlayerRun]; turn: 0 | 1; bot?: BotLevel }

export const newDuel = (a: string, b: string, length: number, bot?: BotLevel, seed = Math.floor(Math.random() * 2 ** 31)): Duel => ({
  seed, length, turn: 0, bot, players: [{ name: a, stack: START_STACK, rounds: [] }, { name: b, stack: START_STACK, rounds: [] }],
})

/** A player is out of hands when they've played them all or can't cover the minimum bet. */
export const finished = (p: PlayerRun, length: number) => p.rounds.filter(r => r.over).length >= length || (p.stack < MIN_BET && !p.rounds.some(r => !r.over))

/** -1 tie, else the winning player's index. */
export const winner = (d: Duel) => (d.players[0].stack === d.players[1].stack ? -1 : d.players[0].stack > d.players[1].stack ? 0 : 1)

// ---- bots ----
export const BOTS = {
  rookie: { name: 'Rookie Bot', icon: '🤖', blurb: 'Plays like the dealer: hits to 17, never doubles or splits. Flat 25s.' },
  pro: { name: 'Pro Bot', icon: '🧠', blurb: 'Perfect basic strategy every hand. Flat 50s.' },
  shark: { name: 'Shark Bot', icon: '🦈', blurb: 'Perfect basic strategy, and sizes bets to chase you down or protect a lead.' },
} as const
export type BotLevel = keyof typeof BOTS

const up = (c: Card) => (c.rank === 'A' ? 11 : ['J', 'Q', 'K'].includes(c.rank) ? 10 : Number(c.rank))

/** Multi-deck basic strategy, dealer stands on soft 17. */
export function basicMove(cards: Card[], dealerUp: Card, can: Record<Move, boolean>): Move {
  const d = up(dealerUp)
  const v = handValue(cards)
  const hard = cards.reduce((t, c) => t + (c.rank === 'A' ? 1 : up(c)), 0)
  const soft = cards.some(c => c.rank === 'A') && hard + 10 === v
  const dbl = (ok: boolean, otherwise: Move): Move => (ok && can.double ? 'double' : otherwise)
  if (can.split && cards.length === 2 && up(cards[0]) === up(cards[1])) {
    const r = up(cards[0])
    const splitIt = r === 11 || r === 8 || (r === 9 && d !== 7 && d <= 9) || (r === 7 && d <= 7) ||
      (r === 6 && d <= 6) || (r === 4 && (d === 5 || d === 6)) || ((r === 3 || r === 2) && d <= 7)
    if (splitIt) return 'split'
  }
  if (soft) {
    if (v >= 19) return 'stand'
    if (v === 18) return d >= 3 && d <= 6 ? dbl(true, 'stand') : d <= 8 ? 'stand' : 'hit'
    if (v === 17) return dbl(d >= 3 && d <= 6, 'hit')
    if (v >= 15) return dbl(d >= 4 && d <= 6, 'hit')
    return dbl(d === 5 || d === 6, 'hit')
  }
  if (v >= 17) return 'stand'
  if (v >= 13) return d <= 6 ? 'stand' : 'hit'
  if (v === 12) return d >= 4 && d <= 6 ? 'stand' : 'hit'
  if (v === 11) return dbl(d <= 10, 'hit')
  if (v === 10) return dbl(d <= 9, 'hit')
  if (v === 9) return dbl(d >= 3 && d <= 6, 'hit')
  return 'hit'
}

/** The bot plays every hand of the duel. Shark watches `rival` (your run) to size its bets. */
/** `upTo` plays only the first hands (live races replay the same prefix each hand, so results never change). */
export function botRun(seed: number, length: number, level: BotLevel, rival?: PlayerRun, upTo = length): PlayerRun {
  const run: PlayerRun = { name: BOTS[level].name, stack: START_STACK, rounds: [] }
  for (let n = 0; n < Math.min(upTo, length) && run.stack >= MIN_BET; n++) {
    let bet = level === 'rookie' ? 25 : 50
    if (level === 'shark' && rival) {
      const theirs = rival.rounds.slice(0, n).reduce((s, r) => s + r.delta, START_STACK)
      const left = length - n
      if (run.stack > theirs) bet = left <= 3 ? MIN_BET : 50
      else if (left <= 3) bet = Math.max(MIN_BET, Math.ceil((theirs - run.stack + 10) / 10) * 10) // swing big to catch up late
    }
    let r = deal(seed, n, Math.min(bet, run.stack))
    while (!r.over) {
      const i = r.hands.findIndex(h => !h.done)
      const can = canDo(r, run.stack)
      const move = level === 'rookie' ? (handValue(r.hands[i].cards) < 17 ? 'hit' : 'stand') : basicMove(r.hands[i].cards, r.dealer[0], can)
      r = play(seed, r, can[move] ? move : 'hit', run.stack)
    }
    run.stack += r.delta
    run.rounds.push(r)
  }
  return run
}
