import assert from 'node:assert/strict'
import { CHALLENGES, bestStreak, newlyCompleted } from './challenges.ts'

const round = (game: string, wager: number, returned: number, at: number, note?: string) => ({ game, wager, returned, at, note })
const bet = (status: string, legs: object[], at: number, stake = 10, payout = 0) => ({ status, legs, stake, payout, placedAt: at })

assert.equal(bestStreak({ bets: [], rounds: [round('slots', 5, 10, 1), round('slots', 5, 10, 2), round('slots', 5, 0, 3), round('slots', 5, 10, 4)] }), 2)
assert.equal(bestStreak({ bets: [], rounds: [round('slots', 5, 5, 1)] }), 0) // pushes don't count

const h = {
  rounds: [round('blackjack', 10, 25, 1, 'BLACKJACK!')],
  bets: [bet('won', [{ sport: {}, result: 'won' }, { casino: {}, result: 'won' }, { casino: {}, result: 'won' }], 2, 10, 80)],
}
const ids = newlyCompleted(h, []).map(c => c.id)
assert.ok(ids.includes('natural') && ids.includes('parlay3') && ids.includes('mixed'))
assert.ok(!ids.includes('parlay5') && !ids.includes('bj5'))
assert.equal(newlyCompleted(h, ['natural', 'parlay3', 'mixed']).length, 0)
assert.equal(new Set(CHALLENGES.map(c => c.id)).size, CHALLENGES.length)
const h2 = { rounds: [], bets: [bet('won', [{ casino: {}, result: 'won', chaos: true }, { sport: { prop: {} }, result: 'won' }], 3, 10, 300)] }
const ids2 = newlyCompleted(h2, []).map(c => c.id)
assert.ok(ids2.includes('chaos') && ids2.includes('propstar') && ids2.includes('longshot') && !ids2.includes('squad'))
console.log('challenges ok')
