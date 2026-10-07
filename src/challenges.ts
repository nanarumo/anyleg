// Challenges: goals measured from your bet and casino history. Pure, so `node src/challenges.test.ts` runs it.

type LegLite = { casino?: unknown; sport?: { prop?: unknown }; result?: string; odds?: number; chaos?: boolean }
type BetLite = { status: string; legs: LegLite[]; stake: number; payout: number; placedAt: number; flex?: boolean; squad?: boolean; daily?: boolean; sgpMult?: number; cashedOut?: boolean }
type RoundLite = { game: string; wager: number; returned: number; at: number; note?: string }
export type History = { bets: BetLite[]; rounds: RoundLite[] }

/** Cosmetics a challenge can unlock. Felts restyle the blackjack/baccarat/roulette tables; backs restyle card backs. */
export const SKINS = {
  classic: { name: 'Classic Green', kind: 'felt' },
  royal: { name: 'Royal Blue', kind: 'felt' },
  crimson: { name: 'Crimson', kind: 'felt' },
  midnight: { name: 'Midnight Gold', kind: 'felt' },
  purple: { name: 'Purple Haze', kind: 'felt' },
  red: { name: 'Classic Red', kind: 'back' },
  gold: { name: 'Gold Foil', kind: 'back' },
  diamond: { name: 'Diamond', kind: 'back' },
  neon: { name: 'Neon Anyleg', kind: 'back' },
  obsidian: { name: 'Obsidian', kind: 'felt' },
  ember: { name: 'Ember', kind: 'felt' },
  holo: { name: 'Holographic', kind: 'back' },
  apex: { name: 'Apex Gold', kind: 'back' },
  champion: { name: 'Champion', kind: 'felt' }, // weekly leaderboard prizes
  silver: { name: 'Silver Crown', kind: 'back' },
  bronze: { name: 'Bronze Laurel', kind: 'back' },
} as const
export type SkinId = keyof typeof SKINS

export type Challenge = {
  id: string; icon: string; name: string; desc: string; goal: number; xp: number; skin?: SkinId
  minPrestige?: number // hidden until you reach this prestige
  progress: (h: History) => number
}

const wonTickets = (h: History) => h.bets.filter(b => b.status === 'won')
const roundsOf = (h: History, game: string) => h.rounds.filter(r => r.game === game)
const roundWins = (h: History, game: string) => roundsOf(h, game).filter(r => r.returned > r.wager).length

/** Longest run of consecutive winning bets/rounds, oldest to newest. */
export function bestStreak(h: History): number {
  const events = [
    ...h.bets.filter(b => b.status === 'won' || b.status === 'lost').map(b => ({ at: b.placedAt, win: b.status === 'won' })),
    ...h.rounds.filter(r => r.returned !== r.wager).map(r => ({ at: r.at, win: r.returned > r.wager })),
  ].sort((a, b) => a.at - b.at)
  let best = 0, run = 0
  for (const e of events) { run = e.win ? run + 1 : 0; best = Math.max(best, run) }
  return best
}

export const CHALLENGES: Challenge[] = [
  { id: 'natural', icon: '🂡', name: 'Natural', desc: 'Get dealt a blackjack', goal: 1, xp: 250, skin: 'royal',
    progress: h => roundsOf(h, 'blackjack').filter(r => r.note === 'BLACKJACK!').length },
  { id: 'split', icon: '⇆', name: 'Split Decision', desc: 'Split a hand in blackjack', goal: 1, xp: 200,
    progress: h => roundsOf(h, 'blackjack').filter(r => r.note === 'Split hands').length },
  { id: 'bj5', icon: '🃏', name: 'Card Shark', desc: 'Get 5 blackjacks', goal: 5, xp: 750, skin: 'crimson',
    progress: h => roundsOf(h, 'blackjack').filter(r => r.note === 'BLACKJACK!').length },
  { id: 'parlay3', icon: '🔗', name: "Three's Company", desc: 'Win a 3+ leg parlay', goal: 1, xp: 400,
    progress: h => wonTickets(h).filter(b => b.legs.length >= 3).length },
  { id: 'parlay5', icon: '🏆', name: 'Five-Leg Hero', desc: 'Win a 5+ leg parlay', goal: 1, xp: 1000, skin: 'midnight',
    progress: h => wonTickets(h).filter(b => b.legs.length >= 5).length },
  { id: 'mixed', icon: '🧬', name: 'Anyleg Original', desc: 'Win a parlay mixing sports and casino legs', goal: 1, xp: 600, skin: 'neon',
    progress: h => wonTickets(h).filter(b => b.legs.some(l => l.sport) && b.legs.some(l => l.casino)).length },
  { id: 'legs10', icon: '🎲', name: 'Leg Day', desc: 'Hit 10 casino parlay legs', goal: 10, xp: 400,
    progress: h => h.bets.reduce((t, b) => t + b.legs.filter(l => l.casino && l.result === 'won').length, 0) },
  { id: 'sports3', icon: '🏈', name: 'Sports Fan', desc: 'Win 3 sports bets', goal: 3, xp: 300,
    progress: h => wonTickets(h).filter(b => b.legs.every(l => l.sport)).length },
  { id: 'roulette10', icon: '🎡', name: 'Spin Doctor', desc: 'Win 10 roulette spins', goal: 10, xp: 300,
    progress: h => roundWins(h, 'roulette') },
  { id: 'baccarat5', icon: '🎴', name: "Banker's Friend", desc: 'Win 5 baccarat coups', goal: 5, xp: 300,
    progress: h => roundWins(h, 'baccarat') },
  { id: 'flush', icon: '♠', name: 'Suited Up', desc: 'Make a flush or better in video poker', goal: 1, xp: 400, skin: 'red',
    progress: h => roundsOf(h, 'poker').filter(r => r.wager > 0 && r.returned / r.wager >= 6).length },
  { id: 'slots10x', icon: '7️⃣', name: 'Jackpot Hunter', desc: 'Hit a 10x+ win on slots', goal: 1, xp: 500,
    progress: h => roundsOf(h, 'slots').filter(r => r.returned >= r.wager * 10).length },
  { id: 'highroller', icon: '💰', name: 'High Roller', desc: 'Put $500+ on a single bet or hand', goal: 1, xp: 300,
    progress: h => [...h.bets.map(b => b.stake), ...h.rounds.map(r => r.wager)].filter(w => w >= 500).length },
  { id: 'streak3', icon: '🔥', name: 'Heater', desc: 'Win 3 in a row', goal: 3, xp: 400, skin: 'gold',
    progress: bestStreak },
  { id: 'payday', icon: '💎', name: 'Big Payday', desc: 'Win $1,000+ profit on one ticket', goal: 1, xp: 800, skin: 'diamond',
    progress: h => wonTickets(h).filter(b => b.payout - b.stake >= 1000).length },
  { id: 'grinder', icon: '⏱️', name: 'Grinder', desc: 'Play 50 casino rounds', goal: 50, xp: 500, skin: 'purple',
    progress: h => h.rounds.length },
  { id: 'regular', icon: '🎟️', name: 'Regular', desc: 'Place 25 bets', goal: 25, xp: 300,
    progress: h => h.bets.length },
  { id: 'sports10', icon: '🏟️', name: 'Season Ticket', desc: 'Win 10 sports bets', goal: 10, xp: 600,
    progress: h => wonTickets(h).filter(b => b.legs.every(l => l.sport)).length },
  { id: 'propstar', icon: '🎯', name: 'Prop Star', desc: 'Win a ticket with a player prop', goal: 1, xp: 300,
    progress: h => wonTickets(h).filter(b => b.legs.some(l => l.sport?.prop)).length },
  { id: 'sgp', icon: '🧩', name: 'Same Game Specialist', desc: 'Win a same-game parlay', goal: 1, xp: 500,
    progress: h => wonTickets(h).filter(b => b.sgpMult).length },
  { id: 'underdog', icon: '🐶', name: 'Underdog', desc: 'Win a straight bet at +300 or longer', goal: 1, xp: 400,
    progress: h => wonTickets(h).filter(b => b.legs.length === 1 && (b.legs[0].odds ?? 0) >= 300).length },
  { id: 'longshot', icon: '🌠', name: 'Long Shot', desc: 'Win a ticket that pays 20x or more', goal: 1, xp: 800,
    progress: h => wonTickets(h).filter(b => !b.cashedOut && b.payout >= b.stake * 20).length },
  { id: 'cashout', icon: '💵', name: 'Cash Is King', desc: 'Cash out a ticket for a profit', goal: 1, xp: 250,
    progress: h => h.bets.filter(b => b.cashedOut && b.payout > b.stake).length },
  { id: 'flex', icon: '🧘', name: 'Flex Appeal', desc: 'Win a flex parlay', goal: 1, xp: 400,
    progress: h => wonTickets(h).filter(b => b.flex).length },
  { id: 'chaos', icon: '🎲', name: 'Agent of Chaos', desc: 'Win a parlay with a chaos leg', goal: 1, xp: 600,
    progress: h => wonTickets(h).filter(b => b.legs.some(l => l.chaos)).length },
  { id: 'squad', icon: '👥', name: 'Squad Goals', desc: 'Win a squad parlay', goal: 1, xp: 600,
    progress: h => wonTickets(h).filter(b => b.squad).length },
  { id: 'daily3', icon: '🔥', name: 'Boosted', desc: 'Win 3 Daily Boosts', goal: 3, xp: 700,
    progress: h => wonTickets(h).filter(b => b.daily).length },
  { id: 'legs50', icon: '🎰', name: 'Leg Legend', desc: 'Hit 50 casino parlay legs', goal: 50, xp: 1200,
    progress: h => h.bets.reduce((t, b) => t + b.legs.filter(l => l.casino && l.result === 'won').length, 0) },
  { id: 'moon', icon: '🚀', name: 'To the Moon', desc: 'Cash out a Crash round at 10x+', goal: 1, xp: 500,
    progress: h => roundsOf(h, 'crash').filter(r => r.returned >= r.wager * 10).length },
  { id: 'sweeper', icon: '💣', name: 'Minesweeper', desc: 'Win 10 Mines rounds', goal: 10, xp: 400,
    progress: h => roundWins(h, 'mines') },
  { id: 'edge', icon: '🔴', name: 'Edge Lord', desc: 'Hit an 8x+ Plinko bucket', goal: 1, xp: 400,
    progress: h => roundsOf(h, 'plinko').filter(r => r.returned >= r.wager * 8).length },
  { id: 'poker10', icon: '🂮', name: 'Poker Face', desc: 'Win 10 video poker hands', goal: 10, xp: 400,
    progress: h => roundWins(h, 'poker') },
  { id: 'grinder2', icon: '⌛', name: 'Night Shift', desc: 'Play 200 casino rounds', goal: 200, xp: 1200,
    progress: h => h.rounds.length },

  // ---- prestige challenges: unlock as you prestige ----
  { id: 'p1-seven', icon: '7️⃣', name: 'Seventh Heaven', desc: 'Win a 7+ leg parlay', goal: 1, xp: 2000, minPrestige: 1, skin: 'ember',
    progress: h => wonTickets(h).filter(b => b.legs.length >= 7).length },
  { id: 'p1-bj25', icon: '🂡', name: 'Card Counter', desc: 'Get 25 blackjacks', goal: 25, xp: 1500, minPrestige: 1,
    progress: h => roundsOf(h, 'blackjack').filter(r => r.note === 'BLACKJACK!').length },
  { id: 'p2-mixed5', icon: '🧬', name: 'Mixologist', desc: 'Win 5 mixed sports + casino parlays', goal: 5, xp: 2500, minPrestige: 2, skin: 'holo',
    progress: h => wonTickets(h).filter(b => b.legs.some(l => l.sport) && b.legs.some(l => l.casino)).length },
  { id: 'p2-wheel50', icon: '🎡', name: 'Wheel Master', desc: 'Win 50 roulette spins', goal: 50, xp: 1500, minPrestige: 2,
    progress: h => roundWins(h, 'roulette') },
  { id: 'p3-whale', icon: '🐋', name: 'Whale', desc: 'Put $2,500+ on a single bet or hand', goal: 1, xp: 2000, minPrestige: 3,
    progress: h => [...h.bets.map(b => b.stake), ...h.rounds.map(r => r.wager)].filter(w => w >= 2500).length },
  { id: 'p3-jackpot', icon: '💎', name: 'Mega Jackpot', desc: 'Hit 50x+ on slots', goal: 1, xp: 2500, minPrestige: 3,
    progress: h => roundsOf(h, 'slots').filter(r => r.returned >= r.wager * 50).length },
  { id: 'p4-ten', icon: '🔟', name: 'Ten-Legger', desc: 'Win a 10+ leg parlay', goal: 1, xp: 4000, minPrestige: 4, skin: 'obsidian',
    progress: h => wonTickets(h).filter(b => b.legs.length >= 10).length },
  { id: 'p5-heater', icon: '🔥', name: 'On Fire', desc: 'Win 7 in a row', goal: 7, xp: 3500, minPrestige: 5,
    progress: bestStreak },
  { id: 'p5-grind', icon: '⏳', name: 'Marathon', desc: 'Play 500 casino rounds', goal: 500, xp: 3000, minPrestige: 5,
    progress: h => h.rounds.length },
  { id: 'p7-royal', icon: '👑', name: 'Royal Flush', desc: 'Make a royal flush in video poker', goal: 1, xp: 5000, minPrestige: 7,
    progress: h => roundsOf(h, 'poker').filter(r => r.note === 'Royal Flush').length },
  { id: 'p10-payday', icon: '🏦', name: 'Bank Breaker', desc: 'Win $25,000+ profit on one ticket', goal: 1, xp: 10000, minPrestige: 10, skin: 'apex',
    progress: h => wonTickets(h).filter(b => b.payout - b.stake >= 25000).length },
]

/** Challenges whose goal is met but are not yet marked done. */
export const newlyCompleted = (h: History, done: string[], prestige = 0) =>
  CHALLENGES.filter(c => (c.minPrestige ?? 0) <= prestige && !done.includes(c.id) && c.progress(h) >= c.goal)
