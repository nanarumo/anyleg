import assert from 'node:assert/strict'
import { simRound, roundText, bacReturn, bacValue, buster, gradeCasino, luckyLadies, newShoe, perfectPairs, playBaccarat, pokerHand, slotPays, twentyOnePlus3, toDecimal, toAmerican, settle, gradeSport, handValue, bjOutcome, rouletteWins, parseOdds, boxStats, gradeProp, parlayDecimal, settleFlex, flexMax } from './logic.ts'

const c = (...ranks: string[]) => ranks.map(rank => ({ rank, suit: '♠' }))

assert.equal(toDecimal(150), 2.5)
assert.equal(toDecimal(-200), 1.5)
assert.equal(toAmerican(2.5), 150)
assert.equal(toAmerican(1.5), -200)
assert.equal(parseOdds('EVEN'), 100)
assert.equal(parseOdds('OFF'), undefined)

// parlay: +100 and +100 → 4x; a push leg drops out; a loss kills it
assert.deepEqual(settle(['won', 'won'], 10, [100, 100]), { status: 'won', payout: 40 })
assert.deepEqual(settle(['won', 'push'], 10, [100, -110]), { status: 'won', payout: 20 })
assert.deepEqual(settle(['won', 'lost', 'pending'], 10, [100, 100, 100]), { status: 'lost', payout: 0 })
assert.deepEqual(settle(['won', 'pending'], 10, [100, 100]).status, 'pending')
assert.deepEqual(settle(['push'], 10, [100]), { status: 'push', payout: 10 })

// sports grading
assert.equal(gradeSport('ml', 'home', undefined, 24, 17), 'won')
assert.equal(gradeSport('spread', 'home', -7, 24, 17), 'push')
assert.equal(gradeSport('spread', 'away', 7.5, 24, 17), 'won')
assert.equal(gradeSport('total', 'over', 41.5, 24, 17), 'lost')
assert.equal(gradeSport('ml', 'draw', undefined, 1, 1), 'won')

// blackjack
assert.equal(handValue(c('A', 'K')), 21)
assert.equal(handValue(c('A', 'A', '9')), 21)
assert.equal(handValue(c('K', 'Q', '5')), 25)
assert.deepEqual(bjOutcome(c('A', 'K'), c('10', '7'), 10), { result: 'won', returned: 25 })
assert.deepEqual(bjOutcome(c('10', '8'), c('10', '8'), 10), { result: 'push', returned: 10 })
assert.deepEqual(bjOutcome(c('10', '8'), c('10', '6', '9'), 10), { result: 'won', returned: 20 })

// roulette
assert.ok(rouletteWins('red', 1) && !rouletteWins('red', 2) && !rouletteWins('even', 0))
assert.ok(rouletteWins('d3', 36) && rouletteWins('c1', 34) && rouletteWins('n0', 0))

console.log('logic ok')

assert.equal(gradeCasino('red', { roulette: 1 }), 'won')
assert.equal(gradeCasino('n0', { roulette: 0 }), 'won')
assert.equal(gradeCasino('win', { blackjack: { result: 'push', playerBJ: false, dealerBust: false } }), 'push')
assert.equal(gradeCasino('dbust', { blackjack: { result: 'won', playerBJ: false, dealerBust: true } }), 'won')
assert.equal(gradeCasino('bj', { blackjack: { result: 'won', playerBJ: false, dealerBust: true } }), 'lost')
console.log('casino legs ok')

// side bets
const k = (rank: string, suit: string) => ({ rank, suit })
assert.equal(perfectPairs([k('8', '♠'), k('8', '♠')]).pays, 25)
assert.equal(perfectPairs([k('8', '♥'), k('8', '♦')]).pays, 12)
assert.equal(perfectPairs([k('8', '♥'), k('8', '♣')]).pays, 6)
assert.equal(perfectPairs([k('8', '♥'), k('9', '♥')]).pays, 0)
assert.equal(twentyOnePlus3([k('7', '♠'), k('7', '♠'), k('7', '♠')]).pays, 100)
assert.equal(twentyOnePlus3([k('Q', '♥'), k('K', '♥'), k('A', '♥')]).pays, 40)
assert.equal(twentyOnePlus3([k('A', '♣'), k('2', '♥'), k('3', '♥')]).pays, 10)
assert.equal(twentyOnePlus3([k('2', '♥'), k('9', '♥'), k('K', '♥')]).pays, 5)
assert.equal(twentyOnePlus3([k('K', '♣'), k('A', '♥'), k('2', '♥')]).pays, 0) // no wraparound
console.log('side bets ok')

// new tables
assert.equal(bacValue([k('9', '♠'), k('8', '♥')]), 7)
assert.equal(bacValue([k('K', '♠'), k('A', '♥')]), 1)
for (let i = 0; i < 2000; i++) { // tableau sanity: hands are 2–3 cards and winner matches totals
  const r = playBaccarat(newShoe())
  assert.ok(r.player.length >= 2 && r.player.length <= 3 && r.banker.length >= 2 && r.banker.length <= 3)
  const p = bacValue(r.player), b = bacValue(r.banker)
  assert.equal(r.winner, p > b ? 'player' : b > p ? 'banker' : 'tie')
  if (bacValue(r.player.slice(0, 2)) >= 8) assert.equal(r.banker.length, 2)
}
assert.equal(bacReturn('banker', 10, { player: [k('2', '♠'), k('3', '♠')], banker: [k('4', '♠'), k('5', '♠')], winner: 'banker' }), 19.5)
assert.equal(bacReturn('player', 10, { player: [k('2', '♠'), k('3', '♠')], banker: [k('2', '♥'), k('3', '♥')], winner: 'tie' }), 10)
assert.equal(pokerHand([k('10', '♠'), k('J', '♠'), k('Q', '♠'), k('K', '♠'), k('A', '♠')]).pays, 250)
assert.equal(pokerHand([k('A', '♠'), k('2', '♥'), k('3', '♠'), k('4', '♠'), k('5', '♠')]).pays, 4)
assert.equal(pokerHand([k('J', '♠'), k('J', '♥'), k('3', '♠'), k('4', '♠'), k('9', '♣')]).pays, 1)
assert.equal(pokerHand([k('10', '♠'), k('10', '♥'), k('3', '♠'), k('4', '♠'), k('9', '♣')]).pays, 0)
assert.equal(pokerHand([k('9', '♠'), k('9', '♥'), k('9', '♣'), k('4', '♠'), k('4', '♣')]).pays, 9)
assert.equal(slotPays(['💎', '💎', '💎']).mult, 150)
assert.equal(slotPays(['🍒', '🍒', '🍋']).mult, 2.5)
assert.equal(slotPays(['🍋', '🍒', '🍉']).mult, 0)
assert.equal(luckyLadies([k('K', '♠'), k('Q', '♠')], false).pays, 10)
assert.equal(buster([k('6', '♠'), k('5', '♥'), k('4', '♠'), k('9', '♠')]).pays, 2)
assert.equal(gradeCasino('banker', { baccarat: { winner: 'tie' } }), 'push')
assert.equal(gradeCasino('trips', { poker: { pays: 2 } }), 'lost')
console.log('new tables ok')

import { canSplit } from './logic.ts'
assert.deepEqual(bjOutcome(c('A', 'K'), c('10', '9'), 10, true), { result: 'won', returned: 20 }) // split 21 pays even money
assert.ok(canSplit(c('K', '10')) && canSplit(c('8', '8')) && !canSplit(c('8', '9')))
console.log('split ok')

import { applyTokens } from './logic.ts'
assert.deepEqual(applyTokens(['won', 'won'], { status: 'won', payout: 40 }, 10, 0.5), { status: 'won', payout: 55, refunded: false }) // +50% of $30 profit
assert.deepEqual(applyTokens(['won', 'lost', 'won', 'won'], { status: 'lost', payout: 0 }, 10, undefined, true), { status: 'lost', payout: 10, refunded: true })
assert.deepEqual(applyTokens(['lost', 'pending', 'won', 'won'], { status: 'lost', payout: 0 }, 10, undefined, true), { status: 'pending', payout: 0, refunded: false })
assert.deepEqual(applyTokens(['lost', 'lost', 'won', 'won'], { status: 'lost', payout: 0 }, 10, undefined, true), { status: 'lost', payout: 0, refunded: false })
console.log('tokens ok')

import { uid } from './logic.ts'
{ // the fallback path (no randomUUID, as on http:// phones) still makes valid unique v4 ids
  const real = crypto.randomUUID
  ;(crypto as { randomUUID?: unknown }).randomUUID = undefined
  const ids = new Set(Array.from({ length: 500 }, uid))
  ;(crypto as { randomUUID?: unknown }).randomUUID = real
  assert.equal(ids.size, 500)
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  console.log('uid ok')
}

// player props: box score in ESPN's shape, "9/17" splits into completions/attempts
{
  const box = boxStats([{ statistics: [
    { keys: ['completions/passingAttempts', 'passingYards', 'passingTouchdowns'], athletes: [{ athlete: { id: 'qb' }, stats: ['9/17', '85', '0'] }] },
    { keys: ['rushingAttempts', 'rushingYards'], athletes: [{ athlete: { id: 'rb' }, stats: ['9', '100'] }] },
    { keys: ['receptions', 'receivingYards'], athletes: [{ athlete: { id: 'rb' }, stats: ['2', '13'] }] },
  ] }])
  assert.equal(box.get('qb')!.completions, 9)
  assert.equal(box.get('qb')!.passingAttempts, 17)
  assert.equal(gradeProp('passYds', 'over', 84.5, box.get('qb')), 'won')
  assert.equal(gradeProp('passYds', 'under', 84.5, box.get('qb')), 'lost')
  assert.equal(gradeProp('rushRecYds', 'over', 112.5, box.get('rb')), 'won') // 100 + 13
  assert.equal(gradeProp('receptions', 'under', 2, box.get('rb')), 'push')
  assert.equal(gradeProp('recYds', 'over', 20.5, box.get('nobody')), 'push') // didn't play: void
}
console.log('props ok')

// same-game parlays: two +100 legs from one game pay 1 + 3×0.8 = 3.4, not 4; different games stay 4
assert.ok(Math.abs(parlayDecimal([{ odds: 100, sport: { eventId: 'g' } }, { odds: 100, sport: { eventId: 'g' } }]).dec - 3.4) < 1e-9)
assert.equal(parlayDecimal([{ odds: 100, sport: { eventId: 'g' } }, { odds: 100, sport: { eventId: 'h' } }]).dec, 4)
assert.equal(parlayDecimal([{ odds: 100, sport: { eventId: 'g' } }, { odds: 100, sport: { eventId: 'g' } }, { odds: 100 }]).sgpGames, 1)
console.log('sgp ok')

// NBA box: "1-3" splits into made/attempted, plus-minus "-3" stays a negative number
{
  const box = boxStats([{ statistics: [{ keys: ['points', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'rebounds', 'assists', 'plusMinus'], athletes: [{ athlete: { id: 'g' }, stats: ['24', '4-9', '6', '7', '-3'] }] }] }])
  const g = box.get('g')!
  assert.equal(g.threePointFieldGoalsMade, 4)
  assert.equal(g.threePointFieldGoalsAttempted, 9)
  assert.equal(g.plusMinus, -3)
  assert.equal(gradeProp('pra', 'over', 36.5, g), 'won') // 24 + 6 + 7 = 37
  assert.equal(gradeProp('threes', 'under', 3.5, g), 'lost')
}
console.log('nba box ok')

// flex: 3 legs at +100, $30 → $10 on each 2-leg parlay (pays $40)
assert.deepEqual(settleFlex(['won', 'won', 'won'], 30, [100, 100, 100]), { status: 'won', payout: 120 })
assert.deepEqual(settleFlex(['won', 'lost', 'won'], 30, [100, 100, 100]), { status: 'won', payout: 40 })
assert.deepEqual(settleFlex(['lost', 'pending', 'lost'], 30, [100, 100, 100]), { status: 'lost', payout: 0 })
assert.deepEqual(settleFlex(['won', 'pending', 'lost'], 30, [100, 100, 100]), { status: 'pending', payout: 0 })
assert.equal(settleFlex(['lost', 'won', 'won', 'won'], 40, [-300, -300, -300, -300]).status, 'lost') // short odds: one miss returns less than the stake
assert.equal(flexMax(30, [100, 100, 100]), 120)
console.log('flex ok')

// auto-dealt rounds grade like table rounds and hit about as often as their prices say
{
  let seed = 42
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  const rate = (game: Parameters<typeof simRound>[0], pick: string, n = 20000) => {
    let w = 0
    for (let i = 0; i < n; i++) if (gradeCasino(pick, simRound(game, pick, rand)) === 'won') w++
    return w / n
  }
  assert.ok(Math.abs(rate('roulette', 'red') - 18 / 37) < 0.02)
  assert.ok(Math.abs(rate('crash', 'c2') - 0.485) < 0.02)
  assert.ok(Math.abs(rate('mines', 'safe3') - 0.67) < 0.03) // fair -203
  assert.ok(Math.abs(rate('blackjack', 'dbust') - 0.228) < 0.03)
  assert.ok(Math.abs(rate('poker', 'job') - 0.49) < 0.03)
  assert.ok(rate('plinko', 'p2', 5000) > 0.1)
  assert.match(roundText({ roulette: 17 }), /17 black/)
}
console.log('anyleg extras ok')
