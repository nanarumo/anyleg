import assert from 'node:assert/strict'
import { deal, play, streams, canDo, newDuel, winner, finished } from './duel.ts'

// Same seed + same hand number → identical cards, every time.
assert.deepEqual(streams(42, 3), streams(42, 3))
assert.notDeepEqual(streams(42, 3).p, streams(42, 4).p)

// Hitting doesn't change the dealer's cards: stand vs hit-then-stand see the same dealer hand (unless the hitter busts).
for (let n = 0; n < 200; n++) {
  const a = deal(7, n, 10)
  if (a.over) continue
  const stood = play(7, a, 'stand', 1000)
  let hit = play(7, a, 'hit', 1000)
  if (!hit.over) hit = play(7, hit, 'stand', 1000)
  assert.ok(stood.over && hit.over)
  if (hit.hands[0].result !== 'lost' || hit.dealer.length > 2) assert.deepEqual(hit.dealer, stood.dealer)
}

// Double costs a second stake and needs the chips for it.
{
  let n = 0, r = deal(1, n, 600)
  while (r.over || r.hands[0].cards.length !== 2) r = deal(1, ++n, 600)
  assert.equal(canDo(r, 1000).double, false) // 600 + 600 > 1000
  assert.equal(canDo(r, 1200).double, true)
  const d = play(1, r, 'double', 1200)
  assert.ok(d.over)
  assert.equal(d.hands[0].wager, 1200)
  assert.equal(d.hands[0].cards.length, 3)
}

// Winner / finished
{
  const d = newDuel('A', 'B', 2, undefined, 5)
  assert.equal(winner(d), -1)
  d.players[0].stack = 1100
  assert.equal(winner(d), 0)
  assert.equal(finished(d.players[1], 2), false)
}
console.log('duel ok')

// Basic strategy spot checks
{
  const { basicMove, botRun } = await import('./duel.ts')
  const C = (r: string) => ({ rank: r, suit: '♠' })
  const all = { hit: true, stand: true, double: true, split: true }
  assert.equal(basicMove([C('8'), C('8')], C('10'), all), 'split')
  assert.equal(basicMove([C('10'), C('10')], C('6'), all), 'stand')
  assert.equal(basicMove([C('6'), C('5')], C('10'), all), 'double')
  assert.equal(basicMove([C('10'), C('6')], C('7'), all), 'hit')
  assert.equal(basicMove([C('10'), C('3')], C('4'), all), 'stand')
  assert.equal(basicMove([C('A'), C('7')], C('9'), all), 'hit')
  assert.equal(basicMove([C('A'), C('7')], C('2'), all), 'stand')
  assert.equal(basicMove([C('A'), C('6')], C('4'), { ...all, double: false }), 'hit')
  // Over many duels the Pro bot (basic strategy) beats the Rookie on the same cards.
  let pro = 0, rookie = 0
  for (let s = 1; s <= 300; s++) { pro += botRun(s, 20, 'pro').stack; rookie += botRun(s, 20, 'rookie').stack * 2 - 1000 } // rookie bets half as much: scale its swings
  assert.ok(pro > rookie, `pro ${pro} vs rookie ${rookie}`)
}
console.log('bots ok')
