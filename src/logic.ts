// Pure betting + game math. No imports so `node src/logic.test.ts` can run it directly.

export type Result = 'pending' | 'won' | 'lost' | 'push'

// ---- odds ----
export const toDecimal = (am: number) => (am > 0 ? 1 + am / 100 : 1 + 100 / -am)
export const toAmerican = (dec: number) => Math.round(dec >= 2 ? (dec - 1) * 100 : -100 / (dec - 1))
let oddsFormat: 'american' | 'decimal' = 'american'
/** Display preference from Gameplay Settings; math always uses American internally. */
export const setOddsFormat = (f: 'american' | 'decimal') => { oddsFormat = f }
export const fmtOdds = (am: number) => (oddsFormat === 'decimal' ? toDecimal(am).toFixed(2) : am > 0 ? `+${am}` : `${am}`)
export const money = (n: number) => `$${n.toFixed(2)}`

/** "EVEN" → 100, "+400" → 400, "-110" → -110, junk → undefined */
export const parseOdds = (s?: string): number | undefined => {
  if (!s) return
  if (/even/i.test(s)) return 100
  const n = Number(s)
  return Number.isFinite(n) && n !== 0 ? n : undefined
}

/** Grade a parlay. Pushed legs drop out (×1). Any loss loses the ticket. */
export function settle(legs: Result[], stake: number, odds: number[]): { status: Result; payout: number } {
  if (legs.includes('lost')) return { status: 'lost', payout: 0 }
  if (legs.includes('pending')) return { status: 'pending', payout: 0 }
  if (legs.every(r => r === 'push')) return { status: 'push', payout: stake }
  const mult = legs.reduce((m, r, i) => (r === 'won' ? m * toDecimal(odds[i]) : m), 1)
  return { status: 'won', payout: +(stake * mult).toFixed(2) }
}

/**
 * Flex parlay (3+ legs): the stake is split across every (N-1)-leg parlay, so one miss still pays.
 * All hit pays a bit less than the full parlay; two misses lose. Same house edge as any parlay.
 */
export function settleFlex(legs: Result[], stake: number, odds: number[]): { status: Result; payout: number } {
  if (legs.filter(r => r === 'lost').length >= 2) return { status: 'lost', payout: 0 }
  if (legs.includes('pending')) return { status: 'pending', payout: 0 }
  const drop = <T,>(a: T[], i: number) => a.filter((_, j) => j !== i)
  const payout = +legs.reduce((t, _, i) => t + settle(drop(legs, i), stake / legs.length, drop(odds, i)).payout, 0).toFixed(2)
  return { status: payout > stake ? 'won' : payout === stake ? 'push' : 'lost', payout }
}
/** Most a flex ticket can pay (every leg hits). */
export const flexMax = (stake: number, odds: number[]) => settleFlex(odds.map(() => 'won'), stake, odds).payout
export const FLEX_MIN = 3

// ---- same-game parlays ----
/** Legs from one game move together (a QB's yards and his team's total), so a same-game group pays 80% of the straight product's profit. */
export const SGP_KEEP = 0.8
export function parlayDecimal(legs: { odds: number; sport?: { eventId: string } }[]): { dec: number; sgpGames: number } {
  const groups = new Map<string, number[]>()
  let dec = 1
  for (const l of legs) {
    if (l.sport) groups.set(l.sport.eventId, [...(groups.get(l.sport.eventId) ?? []), l.odds])
    else dec *= toDecimal(l.odds)
  }
  let sgpGames = 0
  for (const odds of groups.values()) {
    const g = odds.reduce((m, o) => m * toDecimal(o), 1)
    if (odds.length > 1) sgpGames++
    dec *= odds.length > 1 ? 1 + (g - 1) * SGP_KEEP : g
  }
  return { dec, sgpGames }
}

// ---- sports grading ----
export type Market = 'ml' | 'spread' | 'total' | 'prop'
export type Side = 'home' | 'away' | 'draw' | 'over' | 'under'
/** A game's legs that move together: its side (moneyline or spread), its total, or one player's stat line. One pick each per game. */
export const marketFamily = (s: { market: Market; prop?: unknown }) => {
  const p = s.prop as { athleteId?: unknown; stat?: unknown } | undefined
  return p ? `prop:${p.athleteId}:${p.stat}` : s.market === 'total' ? 'total' : 'side'
}

export function gradeSport(market: Market, side: Side, line: number | undefined, home: number, away: number): Result {
  const cmp = (a: number, b: number): Result => (a > b ? 'won' : a < b ? 'lost' : 'push')
  if (market === 'ml') {
    if (side === 'draw') return home === away ? 'won' : 'lost'
    if (home === away) return 'lost' // 2-way ML in a sport that allows draws
    return side === 'home' ? cmp(home, away) : cmp(away, home)
  }
  if (market === 'spread') return side === 'home' ? cmp(home + line!, away) : cmp(away + line!, home)
  return side === 'over' ? cmp(home + away, line!) : cmp(line!, home + away)
}

// ---- player props ----
/** Prop stats we offer; each is read from ESPN's box score (sum of keys for combos). */
export const PROP_STATS = {
  passYds: { name: 'Passing Yards', keys: ['passingYards'] },
  passTd: { name: 'Passing TDs', keys: ['passingTouchdowns'] },
  completions: { name: 'Completions', keys: ['completions'] },
  rushYds: { name: 'Rushing Yards', keys: ['rushingYards'] },
  carries: { name: 'Carries', keys: ['rushingAttempts'] },
  recYds: { name: 'Receiving Yards', keys: ['receivingYards'] },
  receptions: { name: 'Receptions', keys: ['receptions'] },
  rushRecYds: { name: 'Rush + Rec Yards', keys: ['rushingYards', 'receivingYards'] },
  // NBA
  pts: { name: 'Points', keys: ['points'] },
  reb: { name: 'Rebounds', keys: ['rebounds'] },
  ast: { name: 'Assists', keys: ['assists'] },
  threes: { name: '3-Pointers Made', keys: ['threePointFieldGoalsMade'] },
  pra: { name: 'Pts + Reb + Ast', keys: ['points', 'rebounds', 'assists'] },
  // NHL
  sog: { name: 'Shots on Goal', keys: ['shotsTotal'] },
  hkPts: { name: 'Points', keys: ['goals', 'assists'] },
  saves: { name: 'Saves', keys: ['saves'] },
} as const
export type PropStat = keyof typeof PROP_STATS

/** athlete id → stat key → number, from an ESPN summary's boxscore.players. Paired stats split into both keys:
 * NFL "9/17" (completions/passingAttempts), NBA "1-3" (threePointFieldGoalsMade-…Attempted). Lone values like "-3" stay negative. */
export function boxStats(players: any[]): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>()
  for (const team of players ?? []) for (const cat of team.statistics ?? []) {
    const rawKeys: string[] = cat.keys ?? []
    const keys = rawKeys.flatMap(k => k.split(/[/-]/))
    for (const a of cat.athletes ?? []) {
      const vals: string[] = (a.stats ?? []).flatMap((v: string, i: number) => (/[/-]/.test(rawKeys[i] ?? '') ? String(v).split(/(?<=\d)[/-]/) : [String(v)]))
      const rec = out.get(a.athlete.id) ?? {}
      keys.forEach((k, i) => { const n = Number(vals[i]); if (Number.isFinite(n) && rec[k] === undefined) rec[k] = n })
      out.set(a.athlete.id, rec)
    }
  }
  return out
}

/** Over/under a prop line. A player missing from the final box score didn't play: the leg is void (push), like a book. */
export function gradeProp(stat: PropStat, side: Side, line: number, stats?: Record<string, number>): Result {
  if (!stats) return 'push'
  const v = PROP_STATS[stat].keys.reduce((t, k) => t + (stats[k] ?? 0), 0)
  return v === line ? 'push' : (v > line) === (side === 'over') ? 'won' : 'lost'
}

// ---- blackjack ----
export type Card = { rank: string; suit: string }
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
const SUITS = ['♠', '♥', '♦', '♣']

export function newShoe(decks = 6, rand = Math.random): Card[] {
  const shoe: Card[] = []
  for (let d = 0; d < decks; d++) for (const suit of SUITS) for (const rank of RANKS) shoe.push({ rank, suit })
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[shoe[i], shoe[j]] = [shoe[j], shoe[i]]
  }
  return shoe
}

export function handValue(cards: Card[]): number {
  let total = 0
  let aces = 0
  for (const c of cards) {
    if (c.rank === 'A') { total += 11; aces++ }
    else total += ['J', 'Q', 'K'].includes(c.rank) ? 10 : Number(c.rank)
  }
  while (total > 21 && aces--) total -= 10
  return total
}

export const isBlackjack = (cards: Card[]) => cards.length === 2 && handValue(cards) === 21

/** Dealer stands on all 17s. Mutates shoe/dealer. */
export function playDealer(dealer: Card[], shoe: Card[]) {
  while (handValue(dealer) < 17) dealer.push(shoe.pop()!)
}

/** Returns the player's result and the total amount returned (stake included). */
/** `split`: a two-card 21 on a split hand is just 21, not a blackjack. */
export function bjOutcome(player: Card[], dealer: Card[], bet: number, split = false): { result: Result; returned: number } {
  const p = handValue(player), d = handValue(dealer)
  const pBJ = !split && isBlackjack(player), dBJ = isBlackjack(dealer)
  if (pBJ && dBJ) return { result: 'push', returned: bet }
  if (pBJ) return { result: 'won', returned: bet * 2.5 }
  if (dBJ || p > 21) return { result: 'lost', returned: 0 }
  if (d > 21 || p > d) return { result: 'won', returned: bet * 2 }
  if (p === d) return { result: 'push', returned: bet }
  return { result: 'lost', returned: 0 }
}

// ---- roulette (European, single zero) ----
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36])
export const rouletteColor = (n: number) => (n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black')

/** Pick ids: red black odd even low high d1 d2 d3 c1 c2 c3 n0..n36. Returns decimal payout multiplier (stake included). */
export function roulettePays(pick: string): number {
  if (pick.startsWith('n')) return 36
  if (/^[dc]\d$/.test(pick)) return 3
  return 2
}

export function rouletteWins(pick: string, n: number): boolean {
  if (pick.startsWith('n')) return Number(pick.slice(1)) === n
  if (n === 0) return false
  switch (pick) {
    case 'red': case 'black': return rouletteColor(n) === pick
    case 'odd': return n % 2 === 1
    case 'even': return n % 2 === 0
    case 'low': return n <= 18
    case 'high': return n >= 19
    case 'd1': case 'd2': case 'd3': return Math.ceil(n / 12) === Number(pick[1])
    case 'c1': case 'c2': case 'c3': return ((n - 1) % 3) + 1 === Number(pick[1])
  }
  return false
}

export const PICK_LABEL: Record<string, string> = {
  red: 'Red', black: 'Black', odd: 'Odd', even: 'Even', low: '1–18', high: '19–36',
  d1: '1st 12', d2: '2nd 12', d3: '3rd 12', c1: 'Column 1', c2: 'Column 2', c3: 'Column 3',
}
export const pickLabel = (p: string) => PICK_LABEL[p] ?? `#${p.slice(1)}`

// ---- casino parlay legs ----
export type CasinoGame = 'blackjack' | 'roulette' | 'baccarat' | 'poker' | 'slots' | 'crash' | 'mines' | 'plinko'
export type Round =
  | { roulette: number }
  | { blackjack: { result: Result; playerBJ: boolean; dealerBust: boolean } }
  | { baccarat: { winner: 'player' | 'banker' | 'tie' } }
  | { poker: { pays: number } }
  | { slots: { mult: number } }
  | { crash: { point: number } }
  | { mines: { safe: number } } // safe tiles revealed before a mine (or the goal)
  | { plinko: { mult: number } }

/**
 * Casino leg prices sit a little under fair odds, like a real book. Fair odds come from a 300k-round
 * simulation of these exact games with simple basic strategy (scratchpad legsim, 2026-10-04).
 */
export const BJ_PICKS = [
  { pick: 'win', label: 'Win next hand', odds: 110 }, // fair +111 (push voids)
  { pick: 'dbust', label: 'Dealer busts', odds: 300 }, // fair +338 (22.8%: the dealer doesn't play if you bust)
  { pick: 'bj', label: 'Get blackjack', odds: 1900 }, // fair +2039 (4.7%)
]

/** Grade one casino leg against the round that just finished. */
export function gradeCasino(pick: string, round: Round): Result {
  const yes = (b: boolean): Result => (b ? 'won' : 'lost')
  if ('roulette' in round) return yes(rouletteWins(pick, round.roulette))
  if ('baccarat' in round) {
    const w = round.baccarat.winner
    if (pick === 'tie') return yes(w === 'tie')
    return w === 'tie' ? 'push' : yes(w === pick)
  }
  if ('poker' in round) return yes(round.poker.pays >= (pick === 'trips' ? 3 : 1))
  if ('slots' in round) return yes(round.slots.mult >= (pick === 'big' ? 10 : 0.01))
  if ('crash' in round) return yes(round.crash.point >= CRASH_PICKS.find(p => p.pick === pick)!.at)
  if ('mines' in round) return yes(round.mines.safe >= MINES_PICKS.find(p => p.pick === pick)!.picks)
  if ('plinko' in round) return yes(round.plinko.mult >= PLINKO_PICKS.find(p => p.pick === pick)!.at)
  const h = round.blackjack
  if (pick === 'win') return h.result
  if (pick === 'bj') return h.playerBJ ? 'won' : 'lost'
  if (pick === 'dbust') return h.dealerBust ? 'won' : 'lost'
  return 'lost'
}

// ---- blackjack side bets (pays "to 1"; 0 = loss) ----
const RED_SUITS = new Set(['♥', '♦'])
const rankNum = (r: string) => (r === 'A' ? 14 : r === 'K' ? 13 : r === 'Q' ? 12 : r === 'J' ? 11 : Number(r))

/** Perfect Pairs on the player's first two cards. */
export function perfectPairs([a, b]: Card[]): { name: string; pays: number } {
  if (a.rank !== b.rank) return { name: 'No pair', pays: 0 }
  if (a.suit === b.suit) return { name: 'Perfect Pair', pays: 25 }
  if (RED_SUITS.has(a.suit) === RED_SUITS.has(b.suit)) return { name: 'Colored Pair', pays: 12 }
  return { name: 'Mixed Pair', pays: 6 }
}

/** 21+3: player's first two cards plus the dealer's up card as a 3-card poker hand. */
export function twentyOnePlus3(cards: Card[]): { name: string; pays: number } {
  const v = cards.map(c => rankNum(c.rank)).sort((x, y) => x - y)
  const flush = cards.every(c => c.suit === cards[0].suit)
  const trips = v[0] === v[2]
  const straight = (v[1] === v[0] + 1 && v[2] === v[1] + 1) || (v[0] === 2 && v[1] === 3 && v[2] === 14) // A-2-3
  if (trips && flush) return { name: 'Suited Trips', pays: 100 }
  if (straight && flush) return { name: 'Straight Flush', pays: 40 }
  if (trips) return { name: 'Three of a Kind', pays: 30 }
  if (straight) return { name: 'Straight', pays: 10 }
  if (flush) return { name: 'Flush', pays: 5 }
  return { name: 'No hand', pays: 0 }
}

/** Lucky Ladies: player's first two cards total 20. */
export function luckyLadies([a, b]: Card[], dealerBJ: boolean): { name: string; pays: number } {
  if (handValue([a, b]) !== 20) return { name: 'No 20', pays: 0 }
  const qh = (c: Card) => c.rank === 'Q' && c.suit === '♥'
  if (qh(a) && qh(b)) return dealerBJ ? { name: 'Queens + Dealer BJ', pays: 1000 } : { name: 'Pair of Q♥', pays: 200 }
  if (a.rank === b.rank && a.suit === b.suit) return { name: 'Matched 20', pays: 25 }
  if (a.suit === b.suit) return { name: 'Suited 20', pays: 10 }
  return { name: 'Any 20', pays: 4 }
}

/** Buster Blackjack: dealer busts; the more cards it took, the bigger the pay. */
export function buster(dealer: Card[]): { name: string; pays: number } {
  if (handValue(dealer) <= 21) return { name: 'No bust', pays: 0 }
  const n = dealer.length
  const pays = n <= 3 ? 1 : n === 4 ? 2 : n === 5 ? 9 : n === 6 ? 50 : n === 7 ? 100 : 250
  return { name: `${n}-card bust`, pays }
}

// ---- baccarat (punto banco) ----
export const bacValue = (cards: Card[]) =>
  cards.reduce((t, c) => t + (c.rank === 'A' ? 1 : ['10', 'J', 'Q', 'K'].includes(c.rank) ? 0 : Number(c.rank)), 0) % 10

/** Plays out a coup with the standard tableau. Mutates `shoe`; returns both hands and the winner. */
export function playBaccarat(shoe: Card[]) {
  const player = [shoe.pop()!, shoe.pop()!]
  const banker = [shoe.pop()!, shoe.pop()!]
  const natural = bacValue(player) >= 8 || bacValue(banker) >= 8
  if (!natural) {
    let p3: number | undefined
    if (bacValue(player) <= 5) {
      const c = shoe.pop()!
      player.push(c)
      p3 = bacValue([c])
    }
    const b = bacValue(banker)
    const bankerDraws = p3 === undefined ? b <= 5
      : b <= 2 || (b === 3 && p3 !== 8) || (b === 4 && p3 >= 2 && p3 <= 7) || (b === 5 && p3 >= 4 && p3 <= 7) || (b === 6 && (p3 === 6 || p3 === 7))
    if (bankerDraws) banker.push(shoe.pop()!)
  }
  const p = bacValue(player), b = bacValue(banker)
  const winner: 'player' | 'banker' | 'tie' = p > b ? 'player' : b > p ? 'banker' : 'tie'
  return { player, banker, winner }
}

/** Amount returned (stake included) for each baccarat bet. Player/Banker push on a tie. */
export function bacReturn(spot: string, amt: number, r: { player: Card[]; banker: Card[]; winner: string }): number {
  const pair = (h: Card[]) => h[0].rank === h[1].rank
  switch (spot) {
    case 'player': return r.winner === 'player' ? amt * 2 : r.winner === 'tie' ? amt : 0
    case 'banker': return r.winner === 'banker' ? amt * 1.95 : r.winner === 'tie' ? amt : 0
    case 'tie': return r.winner === 'tie' ? amt * 9 : 0
    case 'ppair': return pair(r.player) ? amt * 12 : 0
    case 'bpair': return pair(r.banker) ? amt * 12 : 0
  }
  return 0
}

// ---- video poker: Jacks or Better 9/6, pays "for 1" (stake included) ----
export function pokerHand(cards: Card[]): { name: string; pays: number } {
  const v = cards.map(c => rankNum(c.rank)).sort((a, b) => a - b)
  const counts = Object.values(v.reduce<Record<number, number>>((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {})).sort((a, b) => b - a)
  const flush = cards.every(c => c.suit === cards[0].suit)
  const uniq = new Set(v).size === 5
  const straight = uniq && (v[4] - v[0] === 4 || v.join() === '2,3,4,5,14')
  if (straight && flush) return v[0] === 10 ? { name: 'Royal Flush', pays: 250 } : { name: 'Straight Flush', pays: 50 }
  if (counts[0] === 4) return { name: 'Four of a Kind', pays: 25 }
  if (counts[0] === 3 && counts[1] === 2) return { name: 'Full House', pays: 9 }
  if (flush) return { name: 'Flush', pays: 6 }
  if (straight) return { name: 'Straight', pays: 4 }
  if (counts[0] === 3) return { name: 'Three of a Kind', pays: 3 }
  if (counts[0] === 2 && counts[1] === 2) return { name: 'Two Pair', pays: 2 }
  if (counts[0] === 2) {
    const pairRank = v.find((x, i) => v.indexOf(x) !== i)!
    if (pairRank >= 11) return { name: 'Jacks or Better', pays: 1 }
  }
  return { name: 'No win', pays: 0 }
}
export const POKER_PAYTABLE = [
  ['Royal Flush', 250], ['Straight Flush', 50], ['Four of a Kind', 25], ['Full House', 9], ['Flush', 6],
  ['Straight', 4], ['Three of a Kind', 3], ['Two Pair', 2], ['Jacks or Better', 1],
] as const

// ---- slots: 3 reels, middle payline, multiplier of the bet ----
export const SLOT_SYMBOLS = ['🍒', '🍋', '🍉', '🔔', '⭐', '7', '💎'] as const
const SLOT_WEIGHTS = [8, 7, 6, 5, 3, 2, 1] // reel strip frequency, matches SLOT_SYMBOLS
const SLOT_3OAK: Record<string, number> = { '💎': 150, '7': 75, '⭐': 40, '🔔': 20, '🍉': 12, '🍋': 8, '🍒': 6 } // ~92% RTP (simulated)

export function spinReel(rand = Math.random): string {
  let r = rand() * SLOT_WEIGHTS.reduce((a, b) => a + b, 0)
  for (let i = 0; i < SLOT_WEIGHTS.length; i++) if ((r -= SLOT_WEIGHTS[i]) < 0) return SLOT_SYMBOLS[i]
  return SLOT_SYMBOLS[0]
}

export function slotPays(line: string[]): { name: string; mult: number } {
  if (line[0] === line[1] && line[1] === line[2]) return { name: `Three ${line[0]}`, mult: SLOT_3OAK[line[0]] }
  const cherries = line.filter(s => s === '🍒').length
  if (cherries === 2) return { name: 'Two 🍒', mult: 2.5 }
  if (line[0] === '🍒') return { name: '🍒 on reel 1', mult: 1.25 }
  return { name: 'No win', mult: 0 }
}

/** Parlay leg menus for the newer tables. */
export const BAC_PICKS = [
  { pick: 'player', label: 'Player wins', odds: 100 }, // fair +103 (tie pushes)
  { pick: 'banker', label: 'Banker wins', odds: -105 }, // fair -103; same as the table's 0.95:1
  { pick: 'tie', label: 'Tie', odds: 800 }, // fair +971; same as the table's 8:1
]
export const POKER_PICKS = [
  { pick: 'job', label: 'Jacks or better', odds: 110 }, // fair +116
  { pick: 'trips', label: 'Trips or better', odds: 800 }, // fair ~+940
]
// ---- crash: a multiplier climbs until it crashes; cash out before it does ----
/** Crash point with a 3% edge: P(point ≥ x) = 0.97 / x. Instant 1.00x busts happen 3% of the time. */
export const crashPoint = (rand = Math.random) => Math.max(1, Math.floor((0.97 / (1 - rand())) * 100) / 100)
export const CRASH_PICKS = [
  { pick: 'c2', label: 'Crash reaches 2x', odds: -105, at: 2 }, // fair +106
  { pick: 'c5', label: 'Crash reaches 5x', odds: 380, at: 5 }, // fair +415
  { pick: 'c10', label: 'Crash reaches 10x', odds: 850, at: 10 }, // fair +931
]

// ---- mines: 5×5 grid, reveal gems, avoid mines, cash out any time ----
export const MINES_TILES = 25
const choose = (n: number, k: number) => { let r = 1; for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1); return r }
/** Payout multiplier after `safe` gems with `mines` mines (3% edge). */
export const minesMult = (mines: number, safe: number) => (safe ? Math.floor((0.97 * choose(MINES_TILES, safe) / choose(MINES_TILES - mines, safe)) * 100) / 100 : 1)
export function placeMines(mines: number, rand = Math.random): Set<number> {
  const s = new Set<number>()
  while (s.size < mines) s.add(Math.floor(rand() * MINES_TILES))
  return s
}
export const MINES_PICKS = [
  { pick: 'safe3', label: 'Clear 3 gems (3 mines)', odds: -233, mines: 3, picks: 3 }, // fair -203
  { pick: 'safe5', label: 'Clear 5 gems (5 mines)', odds: 225, mines: 5, picks: 5 }, // fair +243
]

// ---- plinko: 12 rows of pegs, the ball's bucket sets the multiplier ----
export const PLINKO_ROWS = 12
export const PLINKO_RISK = {
  low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
  medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
  high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
} as const
export type PlinkoRisk = keyof typeof PLINKO_RISK
/** Left/right bounce at each row; the bucket is how many went right. */
export const plinkoPath = (rand = Math.random) => Array.from({ length: PLINKO_ROWS }, () => (rand() < 0.5 ? 0 : 1))
export const PLINKO_PICKS = [
  { pick: 'p2', label: 'Plinko 2x+ (medium)', odds: 540, at: 2 }, // fair +585
  { pick: 'p4', label: 'Plinko 4x+ (medium)', odds: 2300, at: 4 }, // fair +2493
]

export const SLOT_PICKS = [
  { pick: 'win', label: 'Any win', odds: 200 }, // fair +214
  { pick: 'big', label: '10x+ win', odds: 7500 }, // fair +8724
]

/** Two cards of equal value can be split (10, J, Q, K all count as 10). */
export const canSplit = (h: Card[]) => h.length === 2 && handValue([h[0]]) === handValue([h[1]])

/**
 * Reward tokens on a ticket. Boost multiplies the profit of a win. Insurance refunds the stake when a
 * ticket misses by exactly one leg; while other legs are still open, that ticket stays pending.
 */
export function applyTokens(results: Result[], base: { status: Result; payout: number }, stake: number, boost?: number, insured?: boolean) {
  let { status, payout } = base
  let refunded = false
  if (status === 'won' && boost) payout = +(stake + (payout - stake) * (1 + boost)).toFixed(2)
  if (status === 'lost' && insured && results.filter(r => r === 'lost').length === 1) {
    if (results.includes('pending')) status = 'pending'
    else { payout = stake; refunded = true }
  }
  return { status, payout, refunded }
}

/**
 * Random id. crypto.randomUUID only exists on https/localhost, so on a phone opening the app over
 * http://<PC IP> it was undefined and creating accounts or placing bets silently failed.
 * getRandomValues works everywhere.
 */
export function uid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}


// ---- auto-dealt rounds: Watch party (and squad bots) deal a leg's round without a table ----
/** Plays one round of `game` with simple house strategy (the same play the leg prices were simulated with). */
export function simRound(game: CasinoGame, pick: string, rand = Math.random): Round {
  const shoe = newShoe(game === 'baccarat' ? 8 : 6, rand)
  switch (game) {
    case 'roulette': return { roulette: Math.floor(rand() * 37) }
    case 'baccarat': return { baccarat: { winner: playBaccarat(shoe).winner } }
    case 'slots': return { slots: { mult: slotPays([spinReel(rand), spinReel(rand), spinReel(rand)]).mult } }
    case 'crash': return { crash: { point: crashPoint(rand) } }
    case 'plinko': return { plinko: { mult: PLINKO_RISK.medium[plinkoPath(rand).reduce<number>((a, b) => a + b, 0)] } }
    case 'mines': {
      const m = MINES_PICKS.find(p => p.pick === pick) ?? MINES_PICKS[0]
      const mines = placeMines(m.mines, rand)
      let safe = 0 // open random tiles until a mine or the goal
      const left = Array.from({ length: MINES_TILES }, (_, i) => i)
      while (safe < m.picks && !mines.has(left.splice(Math.floor(rand() * left.length), 1)[0])) safe++
      return { mines: { safe } }
    }
    case 'poker': {
      const hand = [shoe.pop()!, shoe.pop()!, shoe.pop()!, shoe.pop()!, shoe.pop()!]
      if (pokerHand(hand).pays < 4) { // keep pairs, draw the rest. ponytail: hits trips ~18% vs the +800 price; tune the hold if auto-play matters
        const paired = hand.map(c => hand.filter(x => x.rank === c.rank).length > 1)
        paired.forEach((keep, i) => { if (!keep) hand[i] = shoe.pop()! })
      }
      return { poker: { pays: pokerHand(hand).pays } }
    }
    case 'blackjack': {
      const p = [shoe.pop()!, shoe.pop()!], d = [shoe.pop()!, shoe.pop()!]
      const up = handValue([d[0]])
      if (!isBlackjack(p) && !isBlackjack(d)) {
        while (handValue(p) < 12 || (handValue(p) < 17 && up >= 7)) p.push(shoe.pop()!)
        if (handValue(p) <= 21) playDealer(d, shoe)
      }
      return { blackjack: { result: bjOutcome(p, d, 1).result, playerBJ: isBlackjack(p), dealerBust: handValue(d) > 21 } }
    }
  }
}

/** One line on how a round went, for reveals and replays. */
export function roundText(r: Round): string {
  if ('roulette' in r) return `Ball landed on ${r.roulette} ${rouletteColor(r.roulette)}`
  if ('baccarat' in r) return r.baccarat.winner === 'tie' ? 'Tie hand' : `${r.baccarat.winner === 'player' ? 'Player' : 'Banker'} wins the coup`
  if ('poker' in r) return r.poker.pays ? `${POKER_PAYTABLE.find(([, p]) => p === r.poker.pays)?.[0] ?? 'Winning hand'}` : 'No winning hand'
  if ('slots' in r) return r.slots.mult ? `Reels paid ${r.slots.mult}x` : 'Reels missed'
  if ('crash' in r) return `Rocket crashed at ${r.crash.point.toFixed(2)}x`
  if ('mines' in r) return `${r.mines.safe} gem${r.mines.safe === 1 ? '' : 's'} before the stop`
  if ('plinko' in r) return `Ball dropped in the ${r.plinko.mult}x bucket`
  const b = r.blackjack
  return b.playerBJ ? 'Blackjack!' : b.dealerBust ? 'Dealer busted' : b.result === 'won' ? 'Hand won' : b.result === 'push' ? 'Hand pushed' : 'Hand lost'
}

// ---- every casino leg on offer: the app and the server both price legs from this one table ----
const ROULETTE_PICKS = ['red', 'black', 'odd', 'even', 'low', 'high', 'd1', 'd2', 'd3', 'n0'].map(p => ({
  pick: p, label: p === 'n0' ? 'Green 0' : `Next spin ${pickLabel(p)}`, odds: toAmerican(roulettePays(p)),
}))
export const CASINO_PICKS: Record<CasinoGame, { pick: string; label: string; odds: number }[]> = {
  blackjack: BJ_PICKS, roulette: ROULETTE_PICKS, baccarat: BAC_PICKS, poker: POKER_PICKS, slots: SLOT_PICKS,
  crash: CRASH_PICKS, mines: MINES_PICKS, plinko: PLINKO_PICKS,
}
/** A house pick, or a roulette straight-up number. Undefined = not a leg we offer. */
export const casinoPick = (game: CasinoGame, pick: string) => CASINO_PICKS[game]?.find(x => x.pick === pick)
  ?? (game === 'roulette' && /^n([1-9]|[12]\d|3[0-6])$/.test(pick) ? { pick, label: `#${pick.slice(1)} straight up`, odds: toAmerican(36) } : undefined)

// ---- Chaos leg: a mystery casino leg added after you lock the ticket, for a profit boost ----
export const CHAOS_BOOST = 0.4

// ---- daily login spin: every slice pays at least $100 (per nick: $100 once a day, guaranteed); bigger cash or a bonus token on top is the gamble ----
export const SPIN_PRIZES: { label: string; short?: string; cash?: number; spins?: number; boost?: 'boost25' | 'boost50' | 'boost100'; w: number }[] = [
  { label: '$100', cash: 100, w: 30 }, { label: '$100 + 5 Free Spins', short: '$100+Spins', cash: 100, spins: 5, w: 14 }, { label: '$150', cash: 150, w: 20 },
  { label: '$250', cash: 250, w: 8 }, { label: '$100', cash: 100, w: 14 }, { label: '$100 + 25% Boost', short: '$100+Boost', cash: 100, boost: 'boost25', w: 10 },
  { label: '$200', cash: 200, w: 3 }, { label: '$500', cash: 500, w: 1 },
]
/** Weighted pick of a wheel slice. */
export function spinIndex(rand = Math.random) {
  let r = rand() * SPIN_PRIZES.reduce((t, p) => t + p.w, 0)
  return Math.max(0, SPIN_PRIZES.findIndex(p => (r -= p.w) < 0))
}
