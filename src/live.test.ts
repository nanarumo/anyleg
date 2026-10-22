import assert from 'node:assert/strict'
import { livePrices, phi, remaining } from './live.ts'

assert.ok(Math.abs(phi(0) - 0.5) < 1e-6)
assert.ok(Math.abs(phi(1.96) - 0.975) < 1e-3)
assert.equal(remaining('nfl', 1, '15:00'), 1)
assert.ok(Math.abs(remaining('nfl', 3, '15:00') - 0.5) < 1e-9)
assert.ok(Math.abs(remaining('nba', 4, '6:00') - 0.125) < 1e-9)
assert.ok(Math.abs(remaining('epl', 2, "67'") - 23 / 90) < 1e-9)

const ml = (ps: ReturnType<typeof livePrices>, side: string) => ps.find(p => p.market === 'ml' && p.side === side)!.odds
// Up 14 in the 4th: past 90% the line comes off the board (a near-lock at 1.01 beats its odds), the dog is a long shot; tied at kickoff with no pregame edge: near pick'em with the hold on both sides.
const up14 = livePrices('a', { league: 'nfl', home: 24, away: 10, period: 4, clock: '5:00', pre: { margin: 0, total: 44 } })
assert.equal(up14.find(p => p.market === 'ml' && p.side === 'home'), undefined)
assert.ok(ml(up14, 'away') > 600)
const even = livePrices('b', { league: 'nfl', home: 0, away: 0, period: 1, clock: '15:00', pre: { margin: 0, total: 44 } })
assert.ok(ml(even, 'home') < -100 && ml(even, 'home') > -120)
const t = even.find(p => p.market === 'total' && p.side === 'over')!
assert.equal(t.line, 44.5)
// Lines are sticky: a tiny clock change keeps the line, the odds move instead.
const later = livePrices('b', { league: 'nfl', home: 0, away: 0, period: 1, clock: '14:30', pre: { margin: 0, total: 44 } })
assert.equal(later.find(p => p.market === 'total' && p.side === 'over')!.line, 44.5)
// Soccer: three-way moneyline, 1-0 up late is a heavy favorite, and the three sides overround above 100%.
const soc = livePrices('c', { league: 'epl', home: 1, away: 0, period: 2, clock: "80'", pre: { margin: 0, total: 2.75 } })
assert.equal(soc.filter(p => p.market === 'ml').length, 3)
assert.ok(ml(soc, 'home') < -300)
const imp = (am: number) => (am > 0 ? 100 / (am + 100) : -am / (-am + 100))
assert.ok(['home', 'draw', 'away'].reduce((t, s) => t + imp(ml(soc, s)), 0) > 1)
console.log('live ok')
{
  const { cashOutValue } = await import('./live.ts')
  // Nothing changed since placing: 80% of stake. One leg already hit at +100 with the other a coin flip at +100: 0.8 × 10 × 2 × 0.5 × 2.
  assert.equal(cashOutValue(10, [{ result: 'pending', odds: 100 }], [undefined]), 8)
  assert.equal(cashOutValue(10, [{ result: 'won', odds: 100 }, { result: 'pending', odds: 100 }], [undefined, 0.5]), 16)
  assert.equal(cashOutValue(10, [{ result: 'lost', odds: 100 }, { result: 'pending', odds: 100 }], [undefined, 0.5]), undefined)
  assert.equal(cashOutValue(10, [{ result: 'won', odds: 100 }], [undefined]), undefined)
}
console.log('cash out ok')
{
  const { ladderProb, ladderOdds } = await import('./live.ts')
  // Rungs get harder as they climb; the rung right at the line is near a coin flip.
  const y = [50, 75, 100, 125].map(m => ladderProb(false, 87.5, m))
  assert.ok(y[0] > y[1] && y[1] > y[2] && y[2] > y[3])
  assert.ok(Math.abs(ladderProb(false, 87.5, 88) - 0.5) < 0.05)
  assert.ok(ladderOdds(y[0]) < -300 && ladderOdds(y[3]) > 200)
  // Poisson: 3+ catches on a 4.5 line is likely, 8+ is a long shot.
  assert.ok(ladderProb(true, 4.5, 3) > 0.7 && ladderProb(true, 4.5, 8) < 0.1)
}
console.log('ladders ok')
