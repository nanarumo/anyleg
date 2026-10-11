// node supabase/functions/_shared/house.test.ts
import assert from 'node:assert/strict'
import { closeHand, handView, moveHand, startHand, dealRound, espnBoard, grade, gradeSports, playLeg, priceTickets, type Leg } from './house.ts'

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
// Mines: the board stays hidden until it's over; cashing pays the multiplier.
const mh = startHand({ game: 'mines', wager: 10, mines: 3 }) as any
assert.equal(handView(mh, false).mines, undefined)
const safeTile = [...Array(25).keys()].find(t => !mh.mines.includes(t))!
const m1 = moveHand(mh, { tile: safeTile }, 10) as any
assert.equal(m1.done, false)
const cashed = moveHand(m1.hand, { cash: true }, 10) as any
assert.equal(cashed.done, true); assert.equal(cashed.returned, 11) // 1.10x: 0.97 × 25/22, floored
assert.equal((moveHand(m1.hand, { tile: mh.mines[0] }, 10) as any).returned, 0)
assert.equal(typeof moveHand(m1.hand, { tile: safeTile }, 10), 'string') // same tile twice
assert.equal(closeHand(mh, 10).returned, 10) // untouched board: refund
// Poker: one draw ends the hand; held cards stay.
const ph = startHand({ game: 'poker', wager: 5 }) as any
assert.equal(ph.hand.length, 5); assert.equal(ph.deck.length, 47)
const drawn = moveHand(ph, { hold: [true, true, false, false, false] }, 5) as any
assert.deepEqual(drawn.hand.hand.slice(0, 2), ph.hand.slice(0, 2)); assert.equal(drawn.done, true)
// Blackjack: the hole card stays hidden, chips added mid-hand are charged, and every hand ends graded.
for (let i = 0; i < 300; i++) {
  let h = startHand({ game: 'blackjack', bets: { main: 10, pp: 1, t3: 0, ll: 0, bust: 1 } }) as any
  if (h.phase === 'insurance') h = (moveHand(h, { bj: 'insure' }, 0) as any).hand
  if (h.phase === 'play') {
    assert.equal((handView(h, false) as any).dealer[1].rank, '?')
    const d = moveHand(h, { bj: h.hands[0].cards.length === 2 ? 'double' : 'stand' }, 0) as any
    assert.equal(d.debit, 10)
    h = d.hand
  }
  assert.equal(h.phase, 'done')
  assert.ok(h.hands.every((x: any) => x.result))
  assert.ok(h.returned >= 0 && h.returned <= 20 * 2.5 + 26 + 251 + 15)
}
assert.equal(typeof startHand({ game: 'blackjack', bets: { main: 0 } as any }), 'string')
console.log('house ok')
