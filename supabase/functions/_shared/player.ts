// A player's progress, worked out on the server from their own bets and rounds: XP, level rewards, challenges,
// prestige and weekly prizes. Same rules as the app (src/progression.ts, challenges.ts, season.ts). Pure, so
// `node supabase/functions/_shared/house.test.ts` can check it.
import { MAX_LEVEL, MAX_PRESTIGE, XP_PER_LEG_HIT, levelOf, prestigeRewards, rewardsAt, xpForCasinoWin, xpForTicket, type Reward } from '../../../src/progression.ts'
import { CHALLENGES, challengeBoost, type History } from '../../../src/challenges.ts'
import { PRIZES, SEASON_BOTS, botNet } from '../../../src/season.ts'

export type Inv = { spins: number; boost25: number; boost50: number; boost100: number; insurance: number }
export type BoostKey = 'boost25' | 'boost50' | 'boost100'
/** The progress columns of a profiles row. */
export type Player = {
  inv: Inv; prestige: number; prestige_started_at: string; claimed_levels: string[]; challenges_claimed: string[]
  seasons_claimed: string[]; xp_bonus: number
}
export type BetRow = { legs: any[]; stake: number | string; status: string; payout: number | string; opts: Record<string, any>; placed_at: string }
export type RoundRow = { game: string; wager: number | string; returned: number | string; at: string; note?: string | null; bet_id?: string | null }

/** Bets and paid rounds since `since` (ms), in the shape the challenge rules read. */
export function historyOf(bets: BetRow[], rounds: RoundRow[], since = 0, until = Infinity): History {
  const inRange = (t: number) => t >= since && t < until
  return {
    bets: bets.map(b => ({ ...b.opts, legs: b.legs, stake: Number(b.stake), payout: Number(b.payout), status: b.status, placedAt: Date.parse(b.placed_at) })).filter(b => inRange(b.placedAt)),
    rounds: rounds.filter(r => !r.bet_id && Number(r.wager) > 0).map(r => ({ game: r.game, wager: Number(r.wager), returned: Number(r.returned), at: Date.parse(r.at), note: r.note ?? undefined })).filter(r => inRange(r.at)),
  }
}

/** XP the app would have handed out for this history: winning tickets, casino legs hit inside parlays, casino wins. */
export function xpOf(h: History, bonus = 0): number {
  let xp = bonus
  for (const b of h.bets) {
    const legs = b.legs as { casino?: unknown; sport?: unknown; result?: string; by?: string }[]
    if (b.status === 'won' && !b.cashedOut) xp += xpForTicket(legs.length, b.payout - b.stake, legs.some(l => l.sport) && legs.some(l => l.casino))
    if (legs.length > 1) xp += legs.filter(l => l.casino && l.result === 'won' && !l.by).length * XP_PER_LEG_HIT
  }
  for (const r of h.rounds) if (r.wager > 0 && r.returned > r.wager) xp += xpForCasinoWin(r.returned - r.wager)
  return xp
}

/** Money and tokens in a list of rewards. Cosmetics come back for the app to unlock (they're worth nothing). */
export function grant(rewards: Reward[], inv: Inv) {
  const next = { ...inv }
  let cash = 0
  for (const r of rewards) {
    if (r.kind === 'cash') cash += r.amount
    if (r.kind === 'spins') next.spins += r.n
    if (r.kind === 'boost') next[`boost${r.pct}` as BoostKey]++
    if (r.kind === 'insurance') next.insurance += r.n
  }
  return { cash, inv: next, cosmetics: rewards.filter(r => r.kind === 'avatar' || r.kind === 'frame') }
}

/** Collect every level reward reached and not yet collected. */
export function claimLevels(p: Player, xp: number) {
  const key = (l: number) => `${p.prestige}:${l}`
  const levels = Array.from({ length: levelOf(xp).level - 1 }, (_, i) => i + 2).filter(l => !p.claimed_levels.includes(key(l)))
  const g = grant(levels.flatMap(l => rewardsAt(l, p.prestige)), p.inv)
  return { levels, cash: g.cash, cosmetics: g.cosmetics, player: { ...p, inv: g.inv, claimed_levels: [...p.claimed_levels, ...levels.map(key)] } }
}

/** Collect a finished challenge: its XP and boost token (its skin is unlocked by the app). */
export function claimChallenge(p: Player, h: History, id: string) {
  const c = CHALLENGES.find(x => x.id === id)
  if (!c || (c.minPrestige ?? 0) > p.prestige) return 'Unknown challenge'
  if (p.challenges_claimed.includes(id)) return 'Already claimed'
  if (c.progress(h) < c.goal) return 'Not finished yet'
  const token = challengeBoost(c)
  return { skin: c.skin, xp: c.xp, player: { ...p, xp_bonus: p.xp_bonus + c.xp, challenges_claimed: [...p.challenges_claimed, id], inv: { ...p.inv, [token]: p.inv[token] + 1 } } }
}

/** Start the next prestige: leftover level rewards are collected, then XP and challenges start over. */
export function enterPrestige(p: Player, xp: number, now = Date.now()) {
  if (levelOf(xp).level < MAX_LEVEL) return `Reach level ${MAX_LEVEL} first`
  if (p.prestige >= MAX_PRESTIGE) return 'You are at the highest prestige'
  const left = claimLevels(p, xp)
  const n = p.prestige + 1
  const rewards = prestigeRewards(n)
  const g = grant(rewards, left.player.inv)
  return {
    cash: left.cash + g.cash, rewards, cosmetics: [...left.cosmetics, ...g.cosmetics],
    player: { ...left.player, inv: g.inv, prestige: n, prestige_started_at: new Date(now).toISOString(), xp_bonus: 0, challenges_claimed: [] },
  }
}

/** Where `net` finishes against the season bots for a week (0 = 1st). ponytail: bots only; ranking real players needs a leaderboard query */
export function seasonPlace(week: string, net: number, end: number) {
  return SEASON_BOTS.filter(b => botNet(week, b, end) > net).length
}
export { PRIZES }
