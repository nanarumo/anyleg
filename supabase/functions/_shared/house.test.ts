// node supabase/functions/_shared/house.test.ts
import assert from 'node:assert/strict'
import { dealRound, espnBoard, grade, gradeSports, playLeg, priceTickets, type Leg } from './house.ts'

const fixed = (x: number) => () => x

// Rounds: the server's numbers decide, bad requests are refused.
const r = dealRound({ game: 'roulette', bets: [{ pick: 'red', amount: 10 }, { pick: 'n1', amount: 1 }] }, fixed(1 / 37 + 1e-9)) as any
assert.equal(r.outcome.roulette, 1) // 1 is red
assert.equal(r.wager, 11)
assert.equal(r.returned, 56) // 10*2 + 1*36
assert.equal(typeof dealRound({ game: 'roulette', bets: [{ pick: 'n37', amount: 1 }] }), 'string')
assert.equal(typeof dealRound({ game: 'slots', wager: -5 }), 'string')
assert.equal(typeof dealRound({ game: 'slots', wager: 0.001 }), 'string')
assert.equal((dealRound({ game: 'crash', wager: 10, cashAt: 2 }, fixed(0.6)) as any).returned, 20) // point 2.42
assert.equal((dealRound({ game: 'crash', wager: 10, cashAt: 3 }, fixed(0.6)) as any).returned, 0)

// Pricing: the app's odds are ignored; the house's are used.
const ml: Leg = { id: 'nfl:1:ml:home', label: 'Home ML', sub: '', odds: 5000, sport: { path: 'football/nfl', eventId: '1', market: 'ml', side: 'home' } }
const red: Leg = { id: 'casino:roulette:red', label: 'x', sub: '', odds: 9999, casino: { game: 'roulette', pick: 'red' } }
const feed = { events: [{ id: '1', status: { type: { state: 'pre' } }, competitions: [{ odds: [{ moneyline: { home: { close: { odds: '-150' } } } }] }] }] }
const board = espnBoard(async () => feed)
const t = await priceTickets({ legs: [ml, red], stake: 10 }, board) as any
assert.deepEqual(t[0].legs.map((l: Leg) => l.odds), [-150, 100])
assert.equal(await priceTickets({ legs: [red], stake: 10 }, board), 'Casino legs only count inside a parlay. Add another leg.')
assert.equal(await priceTickets({ legs: [{ ...red, casino: { game: 'roulette', pick: 'n99' } }, ml], stake: 10 }, board), 'That casino leg is not on offer')
assert.match(await priceTickets({ legs: [{ ...ml, sport: { ...ml.sport!, prop: {} } }], stake: 10 }, board) as string, /off the board/)
const chaos = await priceTickets({ legs: [ml], stake: 10, chaos: true }, board, fixed(0)) as any
assert.equal(chaos.length, 1); assert.equal(chaos[0].legs.length, 2); assert.equal(chaos[0].opts.boost, 0.4)

// Casino legs: dealt once, graded, ticket paid.
const legs = t[0].legs as Leg[]
const p = playLeg(legs, red.id, fixed(1 / 37 + 1e-9)) as any // lands on 1 red
assert.equal(p.legs[1].result, 'won')
assert.equal(playLeg(p.legs, red.id), 'Leg already played')
assert.equal(grade(p.legs, 10, {}).status, 'pending') // ML still open
const done = grade(p.legs.map((l: Leg) => ({ ...l, result: 'won' })), 10, {})
assert.equal(done.payout, +(10 * (1 + 100 / 150) * 2).toFixed(2))
// Sports legs grade from the final score, and only once the game is final.
const summary = (completed: boolean) => async () => ({ header: { competitions: [{ status: { type: { completed } }, competitors: [{ homeAway: 'home', score: '24' }, { homeAway: 'away', score: '17' }] }] } })
assert.equal(await gradeSports(legs, summary(false)), undefined)
const graded = await gradeSports(legs, summary(true))
assert.equal(graded![0].result, 'won'); assert.equal(graded![1].result, 'pending') // casino leg untouched
console.log('house ok')
