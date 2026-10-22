// node supabase/functions/_shared/house.test.ts
import assert from 'node:assert/strict'
import { recheckLive, cashOutQuote, closeHand, handView, moveHand, startHand, dealRound, espnBoard, grade, gradeSports, playLeg, priceTickets, type Board, type Leg } from './house.ts'

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

// ---- exploits (2026-10-22 audit) ----
// Penny stakes: rounding a $0.01 payout up to $0.02 made -110 bets and banker pay better than their odds.
assert.equal(await priceTickets({ legs: [ml, red], stake: 0.5 }, board), 'Stakes start at $1')
assert.equal(typeof dealRound({ game: 'baccarat', bets: [{ spot: 'banker', amount: 0.01 }] }), 'string')
// A boost name that only exists on Object.prototype ("constructor") slipped past the token check.
assert.equal(await priceTickets({ legs: [ml, red], stake: 10, boost: 'constructor' as any }, board), 'A boost goes on one ticket')
// Two copies of one casino leg (different ids from the app) would leave a leg that can never be played.
assert.equal(await priceTickets({ legs: [ml, red, { ...red, id: 'other' }], stake: 10 }, board), 'Same leg twice')
// Same-game stacks that hit together: ML + spread of one team, or a prop with its own ladder rung.
const any: Board = async l => ({ odds: -115, line: l.sport!.line })
const spread: Leg = { ...ml, id: 'nfl:1:spread:home', sport: { ...ml.sport!, market: 'spread', line: -3.5 } }
const total: Leg = { ...ml, id: 'nfl:1:total:over', sport: { ...ml.sport!, market: 'total', side: 'over', line: 44.5 } }
const prop = (id: string, line: number): Leg => ({ ...ml, id, sport: { ...ml.sport!, market: 'prop', side: 'over', line, prop: { athleteId: '7', stat: 'passYds' } } })
assert.match(await priceTickets({ legs: [ml, spread], stake: 10 }, any) as string, /one side/)
assert.match(await priceTickets({ legs: [prop('p:over', 250.5), prop('p:alt:275', 274.5)], stake: 10 }, any) as string, /one side/)
assert.equal((await priceTickets({ legs: [ml, total, prop('p:over', 250.5)], stake: 10 }, any) as any)[0].legs.length, 3) // a side, a total and a prop still stack
// Live near-locks: a 40-0 lead with a minute left was offered at 1.01, a sure +1%.
const liveFeed = { events: [{ id: '2', status: { type: { state: 'in' }, period: 4, displayClock: '1:00' }, competitions: [{ competitors: [{ homeAway: 'home', score: '40' }, { homeAway: 'away', score: '0' }] }] }] }
const lock: Leg = { ...ml, id: 'nfl:2:live:ml:home', sport: { ...ml.sport!, eventId: '2' } }
assert.match(await priceTickets({ legs: [lock], stake: 10 }, espnBoard(async () => liveFeed)) as string, /off the board/)
// Live delay: after the wait the leg is re-priced; a score that shortened the price (bet placed off the broadcast,
// ahead of the feed) refuses the ticket, a price that held or lengthened goes in at the accepted odds.
const tied = (home: string) => ({ events: [{ id: '2', status: { type: { state: 'in' }, period: 2, displayClock: '5:00' }, competitions: [{ competitors: [{ homeAway: 'home', score: home }, { homeAway: 'away', score: '0' }] }] }] })
const liveHome: Leg = { ...lock, label: 'Home ML' }
const accepted = await priceTickets({ legs: [liveHome], stake: 10 }, espnBoard(async () => tied('0'))) as any
assert.equal(typeof accepted, 'object')
assert.equal(await recheckLive(accepted, espnBoard(async () => tied('0'))), undefined)
assert.match(await recheckLive(accepted, espnBoard(async () => tied('7'))) as string, /moved during the live delay/)
assert.equal(await recheckLive(accepted, espnBoard(async () => ({ events: [{ ...tied('0').events[0], competitions: [{ competitors: [{ homeAway: 'home', score: '0' }, { homeAway: 'away', score: '7' }] }] }] }))), undefined)
assert.equal(await recheckLive(t, board), undefined) // pregame tickets aren't held
// Pregame lines close at the scheduled start, even if the feed still says "pre".
const late = { events: [{ ...feed.events[0], date: new Date(Date.now() - 6e4).toISOString() }] }
assert.match(await priceTickets({ legs: [ml, red], stake: 10 }, espnBoard(async () => late)) as string, /off the board/)
// Cash out: a leg whose game just ended (not graded yet) used to sell at its pregame odds.
const over = { events: [{ id: '1', status: { type: { state: 'post' } }, competitions: [{}] }] }
assert.match(await cashOutQuote([{ ...ml, odds: -150, result: 'pending' }, { ...red, odds: 100, result: 'won' }], 10, {}, espnBoard(async () => over)) as string, /can't be cashed out/)
assert.equal(typeof await cashOutQuote([{ ...ml, odds: -150, result: 'pending' }], 10, {}, board), 'number')
// A cancelled game pushes instead of staying open forever.
const cancelled = async () => ({ header: { competitions: [{ status: { type: { name: 'STATUS_CANCELED', completed: false } } }] } })
assert.equal((await gradeSports([{ ...ml, result: 'pending' }], cancelled))![0].result, 'push')
console.log('house ok')

// ---- player progress ----
const { xpOf, historyOf, claimLevels, claimChallenge, enterPrestige, seasonPlace } = await import('./player.ts')
const inv = { spins: 0, boost25: 0, boost50: 0, boost100: 0, insurance: 0 }
const player = { inv, prestige: 0, prestige_started_at: new Date(0).toISOString(), claimed_levels: [] as string[], challenges_claimed: [] as string[], seasons_claimed: [] as string[], xp_bonus: 0 }
const at = new Date().toISOString()
const hist = historyOf(
  [{ legs: [{ casino: {}, result: 'won' }, { sport: {}, result: 'won' }], stake: 10, status: 'won', payout: 40, opts: {}, placed_at: at }],
  [{ game: 'roulette', wager: 10, returned: 20, at, note: '1 red' }, { game: 'slots', wager: 0, returned: 5, at }, { game: 'roulette', wager: 0, returned: 0, at, bet_id: 'x' }],
)
assert.equal(hist.rounds.length, 1) // free spins and leg rounds don't count
assert.equal(xpOf(hist), (100 + 75 + 3 + 100) + 25 + (15 + 1)) // ticket + casino leg hit + roulette win
const lv = claimLevels(player, 5000)
assert.ok(lv.levels.length > 3 && lv.cash > 0)
assert.equal(claimLevels(lv.player, 5000).levels.length, 0) // can't claim twice
assert.equal(claimChallenge(player, hist, 'parlay5'), 'Not finished yet')
assert.equal(enterPrestige(player, 100), 'Reach level 50 first')
assert.equal(typeof seasonPlace('2026-10-05', 1e9, Date.now()), 'number')
console.log('player ok')
