// Live in-game lines. ESPN's feed drops DraftKings' odds once a game starts, so live prices are modeled:
// the pregame line + the score + time left give an expected final margin/total, priced with a normal model
// (Poisson for soccer, which can draw). Lines stay put until the projection drifts 1.5+ away, so slip legs don't vanish every refresh;
// the odds move instead. ponytail: model prices, not a book's; swap in a live odds feed if one shows up.
import { toAmerican, toDecimal, type Market, type Side } from './logic.ts'

// Full-game scoring spread (std dev of final margin), default total, and game length in periods × minutes.
const SPORT: Record<string, { sd: number; total: number; periods: number; minutes: number }> = {
  nfl: { sd: 13.5, total: 44, periods: 4, minutes: 15 },
  ncaaf: { sd: 16, total: 52, periods: 4, minutes: 15 },
  nba: { sd: 12, total: 228, periods: 4, minutes: 12 },
  wnba: { sd: 11, total: 165, periods: 4, minutes: 10 },
  nhl: { sd: 2.4, total: 6, periods: 3, minutes: 20 },
  mlb: { sd: 4.2, total: 8.5, periods: 9, minutes: 0 },
  epl: { sd: 1.7, total: 2.75, periods: 2, minutes: 45 },
  mls: { sd: 1.7, total: 2.75, periods: 2, minutes: 45 },
}

const HOLD = 1.045 // ~4.5% book margin across both sides
const clamp = (p: number) => Math.min(0.97, Math.max(0.03, p))
/** Live lines come off the board past a 90% chance: the clamp and the 1.01 floor would pay a near-lock better than its odds. */
export const liveOpen = (p: number) => p <= 0.9
export const priceOf = (p: number) => toAmerican(1 / (clamp(p) * HOLD) < 1.01 ? 1.01 : 1 / (clamp(p) * HOLD))

/** Standard normal CDF (Abramowitz-Stegun 7.1.26). */
export function phi(x: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2)
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2)
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2
}

/** Share of the game still to play, from ESPN's period + clock ("7:32", soccer "67'"). */
export function remaining(league: string, period: number, clock: string): number {
  const s = SPORT[league]
  if (!s) return 0.5
  if (league === 'mlb') return Math.max(0.02, (9 - Math.max(1, period) + 0.5) / 9)
  if (s.periods === 2) { // soccer clock counts up
    const min = parseInt(clock) || (period - 1) * 45
    return Math.max(0.02, (90 - Math.min(90, min)) / 90)
  }
  const [m, sec] = clock.split(':').map(Number)
  const left = (Math.max(0, s.periods - period) * s.minutes + (m || 0) + (sec || 0) / 60) / (s.periods * s.minutes)
  return Math.max(0.02, Math.min(1, left))
}

export type LiveInput = {
  league: string; home: number; away: number; period: number; clock: string
  pre?: { margin?: number; total?: number } // pregame expected home margin and total
}
export type LivePrice = { market: Market; side: Side; odds: number; line?: number }

const sticky = new Map<string, number>() // game:market → posted line
const isSoccer = (league: string) => league === 'epl' || league === 'mls'

/** Expected final margin/total and their spread, given the score and time left. */
function project(g: LiveInput) {
  const s = SPORT[g.league]
  const rem = remaining(g.league, g.period, g.clock)
  const preMargin = g.pre?.margin ?? 0, preTotal = g.pre?.total ?? s.total
  const sd = s.sd * Math.sqrt(rem)
  return { rem, preMargin, preTotal, sd, sdTotal: sd * 1.1, margin: g.home - g.away + preMargin * rem, total: g.home + g.away + preTotal * rem }
}

/** Soccer: Poisson goals for the rest of the match, split by the pregame edge → P(home), P(draw). */
function soccer3way(g: LiveInput) {
  const { rem, preMargin, preTotal } = project(g)
  const lam = preTotal * rem
  const lh = Math.max(0.05, lam / 2 + preMargin * rem / 2), la = Math.max(0.05, lam - lh)
  const pmf = (l: number, k: number) => Math.exp(-l) * l ** k / [1, 1, 2, 6, 24, 120, 720, 5040, 40320][k]
  let home = 0, draw = 0
  for (let a = 0; a <= 8; a++) for (let b = 0; b <= 8; b++) {
    const p = pmf(lh, a) * pmf(la, b), d = g.home + a - (g.away + b)
    if (d > 0) home += p; else if (d === 0) draw += p
  }
  return { home, draw, away: 1 - home - draw }
}

/** Chance a full-game pick wins from here (used for live prices and cash-out values). */
export function legProb(g: LiveInput, market: Market, side: Side, line = 0): number {
  if (!SPORT[g.league]) return 0.5
  const p = project(g)
  if (market === 'ml') {
    if (isSoccer(g.league)) return soccer3way(g)[side as 'home' | 'draw' | 'away'] ?? 0
    const ph = phi(p.margin / p.sd)
    return side === 'home' ? ph : side === 'away' ? 1 - ph : 0
  }
  if (market === 'spread') return phi((side === 'home' ? p.margin + line : line - p.margin) / p.sd)
  if (market === 'total') return side === 'over' ? phi((p.total - line) / p.sdTotal) : 1 - phi((p.total - line) / p.sdTotal)
  return 0.5
}

/** Live prices for one in-progress game. `key` keeps each game's posted lines stable between refreshes. */
export function livePrices(key: string, g: LiveInput): LivePrice[] {
  if (!SPORT[g.league]) return []
  const p = project(g)
  const post = (market: 'spread' | 'total', proj: number) => {
    const k = `${key}:${market}`
    const half = Math.round(proj * 2) / 2
    const line = Math.abs((sticky.get(k) ?? Infinity) - proj) < 1.5 ? sticky.get(k)! : half % 1 ? half : half + 0.5
    sticky.set(k, line)
    return line
  }
  const sides: Side[] = isSoccer(g.league) ? ['home', 'draw', 'away'] : ['home', 'away']
  const out: LivePrice[] = sides.map(side => ({ market: 'ml', side, odds: priceOf(legProb(g, 'ml', side)) }))
  if (!isSoccer(g.league)) {
    const sl = post('spread', -p.margin) // home spread, e.g. -3.5 when home is projected to win by ~3
    out.push({ market: 'spread', side: 'home', line: sl, odds: priceOf(legProb(g, 'spread', 'home', sl)) },
      { market: 'spread', side: 'away', line: -sl, odds: priceOf(legProb(g, 'spread', 'away', -sl)) })
  }
  const tl = post('total', p.total)
  out.push({ market: 'total', side: 'over', line: tl, odds: priceOf(legProb(g, 'total', 'over', tl)) },
    { market: 'total', side: 'under', line: tl, odds: priceOf(legProb(g, 'total', 'under', tl)) })
  return out.filter(x => liveOpen(legProb(g, x.market, x.side, x.line)))
}

// ---- cash out ----
export const CASHOUT_KEEP = 0.8 // the book keeps 20% of a ticket's fair value, so riding it out pays better

/** What an open ticket is worth now: stake × hit legs' odds × each open leg's win chance × its odds, less the book's cut. */
export function cashOutValue(stake: number, legs: { result?: string; odds: number }[], probs: (number | undefined)[]): number | undefined {
  if (legs.some(l => l.result === 'lost') || !legs.some(l => l.result === 'pending')) return undefined
  const fair = legs.reduce((v, l, i) =>
    l.result === 'won' ? v * toDecimal(l.odds) : l.result === 'pending' ? v * (probs[i] ?? 1 / toDecimal(l.odds)) * toDecimal(l.odds) : v, stake)
  return Math.max(0.01, +(fair * CASHOUT_KEEP).toFixed(2))
}

// ---- prop ladders ("75+ rushing yards") ----
// The feed gives DraftKings' rungs but no prices, so each rung is priced from the player's main O/U line:
// yards ~ normal around the line, counts (catches, TDs, carries, completions) ~ Poisson with the line as the mean.
const LADDER_HOLD = 1.07
/** Chance a player reaches `m` or more, given their main over/under line. */
export function ladderProb(count: boolean, line: number, m: number, sdOverride?: number) {
  if (count) {
    let p = 0, term = Math.exp(-line)
    for (let k = 0; k < m; k++) { p += term; term *= line / (k + 1) }
    return 1 - p
  }
  const sd = sdOverride ?? 0.35 * line + 10
  return 1 - phi((m - 0.5 - line) / sd)
}
export const ladderOdds = (p: number) => toAmerican(Math.max(1.01, 1 / (Math.min(0.95, Math.max(0.03, p)) * LADDER_HOLD)))
