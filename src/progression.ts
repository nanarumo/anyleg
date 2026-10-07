// XP, levels, ranks and the reward track. Pure: no imports, so `node src/progression.test.ts` can run it.

export const MAX_LEVEL = 50
/** XP needed to go from `level` to `level + 1`. */
export const xpToNext = (level: number) => 300 + 100 * (level - 1)

export function levelOf(xp: number): { level: number; into: number; need: number } {
  let level = 1
  let left = xp
  while (level < MAX_LEVEL && left >= xpToNext(level)) { left -= xpToNext(level); level++ }
  return { level, into: level === MAX_LEVEL ? 0 : left, need: level === MAX_LEVEL ? 0 : xpToNext(level) }
}

// ---- ranks: enlisted chevrons → officer bars → stars → legend ----
export type Rank = { level: number; name: string; tier: 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'legend'; mark: { kind: 'dot' | 'chevron' | 'bar' | 'star' | 'legend'; n: number; rockers?: number } }
export const RANKS: Rank[] = [
  { level: 1, name: 'Recruit', tier: 'bronze', mark: { kind: 'dot', n: 1 } },
  { level: 3, name: 'Private', tier: 'bronze', mark: { kind: 'chevron', n: 1 } },
  { level: 6, name: 'Private First Class', tier: 'bronze', mark: { kind: 'chevron', n: 2 } },
  { level: 9, name: 'Corporal', tier: 'bronze', mark: { kind: 'chevron', n: 3 } },
  { level: 12, name: 'Sergeant', tier: 'silver', mark: { kind: 'chevron', n: 3, rockers: 1 } },
  { level: 15, name: 'Staff Sergeant', tier: 'silver', mark: { kind: 'chevron', n: 3, rockers: 2 } },
  { level: 18, name: 'Master Sergeant', tier: 'silver', mark: { kind: 'chevron', n: 3, rockers: 3 } },
  { level: 21, name: 'Sergeant Major', tier: 'gold', mark: { kind: 'chevron', n: 3, rockers: 4 } },
  { level: 24, name: 'Lieutenant', tier: 'gold', mark: { kind: 'bar', n: 1 } },
  { level: 27, name: 'Captain', tier: 'gold', mark: { kind: 'bar', n: 2 } },
  { level: 30, name: 'Major', tier: 'platinum', mark: { kind: 'bar', n: 3 } },
  { level: 34, name: 'Colonel', tier: 'platinum', mark: { kind: 'star', n: 1 } },
  { level: 38, name: 'Brigadier', tier: 'platinum', mark: { kind: 'star', n: 2 } },
  { level: 42, name: 'General', tier: 'diamond', mark: { kind: 'star', n: 3 } },
  { level: 46, name: 'Commander', tier: 'diamond', mark: { kind: 'star', n: 4 } },
  { level: 50, name: 'Anyleg Legend', tier: 'legend', mark: { kind: 'legend', n: 1 } },
]
export const rankAt = (level: number) => [...RANKS].reverse().find(r => level >= r.level)!
export const nextRank = (level: number) => RANKS.find(r => r.level > level)

// ---- rewards ----
export type Reward =
  | { kind: 'cash'; amount: number }
  | { kind: 'spins'; n: number }
  | { kind: 'boost'; pct: 25 | 50 | 100 }
  | { kind: 'insurance'; n: number }
  | { kind: 'avatar'; emoji: string }
  | { kind: 'frame'; name: string; color: string }

const FIXED: Record<number, Reward[]> = {
  2: [{ kind: 'cash', amount: 250 }],
  3: [{ kind: 'spins', n: 5 }],
  4: [{ kind: 'boost', pct: 25 }],
  5: [{ kind: 'avatar', emoji: '🎖️' }],
  6: [{ kind: 'cash', amount: 500 }],
  7: [{ kind: 'spins', n: 10 }],
  8: [{ kind: 'insurance', n: 1 }],
  9: [{ kind: 'boost', pct: 25 }],
  10: [{ kind: 'frame', name: 'Silver', color: '#c0c7d1' }, { kind: 'cash', amount: 500 }],
  12: [{ kind: 'boost', pct: 50 }],
  15: [{ kind: 'avatar', emoji: '🦁' }, { kind: 'spins', n: 20 }],
  20: [{ kind: 'frame', name: 'Gold', color: '#fbbf24' }, { kind: 'cash', amount: 1500 }],
  25: [{ kind: 'boost', pct: 100 }, { kind: 'avatar', emoji: '🐉' }],
  30: [{ kind: 'frame', name: 'Platinum', color: '#a5f3fc' }, { kind: 'cash', amount: 3000 }],
  35: [{ kind: 'avatar', emoji: '🦄' }, { kind: 'boost', pct: 100 }],
  40: [{ kind: 'frame', name: 'Diamond', color: '#c4b5fd' }, { kind: 'cash', amount: 5000 }],
  45: [{ kind: 'avatar', emoji: '🏆' }, { kind: 'insurance', n: 3 }],
  50: [{ kind: 'frame', name: 'Legend', color: '#f472b6' }, { kind: 'cash', amount: 10000 }, { kind: 'boost', pct: 100 }],
}
/** Levels without a headline reward rotate through the everyday ones, growing with level. */
function baseRewardsAt(level: number): Reward[] {
  if (level < 2) return []
  if (FIXED[level]) return FIXED[level]
  const cycle = level % 4
  if (cycle === 0) return [{ kind: 'insurance', n: 1 }]
  if (cycle === 1) return [{ kind: 'cash', amount: Math.round(level * 50 / 50) * 50 }]
  if (cycle === 2) return [{ kind: 'boost', pct: level >= 20 ? 50 : 25 }]
  return [{ kind: 'spins', n: 5 + Math.floor(level / 5) * 5 }]
}

/**
 * Rewards for reaching `level` in `prestige`. Each prestige pays more: cash and spins grow 50% per prestige,
 * insurance grows every 3 prestiges, and the cosmetics are swapped for that prestige's own avatar and frame
 * (base cosmetics you already own turn into bonus cash).
 */
export function rewardsAt(level: number, prestige = 0): Reward[] {
  return scarce(prestigeRewardsAt(level, prestige))
}
/** Free money is scarce: every cash reward pays a quarter of the amounts in these tables (rounded to $25). */
const CASH_SCALE = 0.25
const scarce = (rs: Reward[]): Reward[] => rs.map(r => (r.kind === 'cash' ? { kind: 'cash', amount: Math.max(25, Math.round((r.amount * CASH_SCALE) / 25) * 25) } : r))
function prestigeRewardsAt(level: number, prestige: number): Reward[] {
  const base = baseRewardsAt(level)
  if (!prestige) return base
  const mult = 1 + prestige * 0.5
  const theme = PRESTIGES[prestige]
  return base.map((r): Reward => {
    switch (r.kind) {
      case 'cash': return { kind: 'cash', amount: Math.round((r.amount * mult) / 50) * 50 }
      case 'spins': return { kind: 'spins', n: Math.round(r.n * mult) }
      case 'insurance': return { kind: 'insurance', n: r.n + Math.floor(prestige / 3) }
      case 'boost': return r
      case 'avatar': return level === 25 ? { kind: 'avatar', emoji: theme.avatar } : { kind: 'cash', amount: 1000 * prestige }
      case 'frame': return level === 50 ? { kind: 'frame', name: `${theme.name} Prestige`, color: theme.color } : { kind: 'cash', amount: 1500 * prestige }
    }
  })
}

// ---- prestige: reset to level 1 for a new emblem set, new rank titles and richer rewards ----
export const MAX_PRESTIGE = 10
export type Shape = 'shield' | 'hex' | 'circle' | 'diamond' | 'star' | 'wings'
export type PrestigeTheme = { n: number; name: string; color: string; color2: string; shape: Shape; avatar: string }
export const PRESTIGES: PrestigeTheme[] = [
  { n: 0, name: '', color: '', color2: '', shape: 'shield', avatar: '' },
  { n: 1, name: 'Ember', color: '#fb923c', color2: '#7c2d12', shape: 'hex', avatar: '☄️' },
  { n: 2, name: 'Frost', color: '#7dd3fc', color2: '#0c4a6e', shape: 'circle', avatar: '❄️' },
  { n: 3, name: 'Venom', color: '#4ade80', color2: '#14532d', shape: 'diamond', avatar: '🐍' },
  { n: 4, name: 'Storm', color: '#a5b4fc', color2: '#312e81', shape: 'star', avatar: '⛈️' },
  { n: 5, name: 'Eclipse', color: '#e5e7eb', color2: '#111827', shape: 'wings', avatar: '🌑' },
  { n: 6, name: 'Inferno', color: '#f87171', color2: '#7f1d1d', shape: 'hex', avatar: '🌋' },
  { n: 7, name: 'Phantom', color: '#c084fc', color2: '#3b0764', shape: 'circle', avatar: '👻' },
  { n: 8, name: 'Titan', color: '#fcd34d', color2: '#78350f', shape: 'diamond', avatar: '🗿' },
  { n: 9, name: 'Nova', color: '#f0abfc', color2: '#701a75', shape: 'star', avatar: '🌟' },
  { n: 10, name: 'Apex', color: '#fde047', color2: '#be185d', shape: 'wings', avatar: '💠' },
]
/** Rank title in a given prestige, e.g. "Frost Sergeant". */
export const rankName = (rank: Rank, prestige: number) =>
  prestige ? `${PRESTIGES[prestige].name} ${rank.name === 'Anyleg Legend' ? 'Legend' : rank.name}` : rank.name
/** What you get the moment you enter a prestige. */
export const prestigeRewards = (p: number): Reward[] => scarce([
  { kind: 'cash', amount: 5000 * p },
  { kind: 'boost', pct: 100 },
  { kind: 'insurance', n: p },
  { kind: 'spins', n: 25 * p },
  { kind: 'avatar', emoji: PRESTIGES[p].avatar },
])

export function rewardLabel(r: Reward): string {
  switch (r.kind) {
    case 'cash': return `$${r.amount.toLocaleString()} Bonus`
    case 'spins': return `${r.n} Free Spins`
    case 'boost': return `${r.pct}% Parlay Boost`
    case 'insurance': return r.n > 1 ? `${r.n}× Parlay Insurance` : 'Parlay Insurance'
    case 'avatar': return `${r.emoji} Avatar`
    case 'frame': return `${r.name} Frame`
  }
}
export const rewardIcon = (r: Reward) =>
  r.kind === 'cash' ? '💵' : r.kind === 'spins' ? '🎰' : r.kind === 'boost' ? '🚀' : r.kind === 'insurance' ? '🛡️' : r.kind === 'avatar' ? r.emoji : '🖼️'

// ---- XP sources ----
/** A winning ticket: more legs and more profit earn more; mixing sports and casino earns a bonus. */
export function xpForTicket(legs: number, profit: number, mixed: boolean): number {
  return 100 + 75 * (legs - 1) + Math.round(Math.min(Math.max(profit, 0), 2000) / 10) + (mixed ? 100 : 0)
}
export const xpForCasinoWin = (profit: number) => 15 + Math.round(Math.min(Math.max(profit, 0), 1000) / 10)
export const XP_PER_LEG_HIT = 25
