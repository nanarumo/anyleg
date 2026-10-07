import assert from 'node:assert/strict'
import { MAX_LEVEL, RANKS, levelOf, rankAt, rewardsAt, xpForTicket, xpToNext } from './progression.ts'

assert.deepEqual(levelOf(0), { level: 1, into: 0, need: 300 })
assert.deepEqual(levelOf(299), { level: 1, into: 299, need: 300 })
assert.deepEqual(levelOf(300), { level: 2, into: 0, need: 400 })
const total = Array.from({ length: MAX_LEVEL - 1 }, (_, i) => xpToNext(i + 1)).reduce((a, b) => a + b, 0)
assert.equal(levelOf(total).level, MAX_LEVEL)
assert.equal(levelOf(total * 10).level, MAX_LEVEL) // capped

assert.equal(rankAt(1).name, 'Recruit')
assert.equal(rankAt(11).name, 'Corporal')
assert.equal(rankAt(50).name, 'Anyleg Legend')
assert.ok(RANKS.every((r, i) => i === 0 || r.level > RANKS[i - 1].level))

for (let l = 2; l <= MAX_LEVEL; l++) assert.ok(rewardsAt(l).length > 0, `level ${l} has a reward`)
assert.equal(rewardsAt(1).length, 0)

assert.equal(xpForTicket(1, 10, false), 101)
assert.equal(xpForTicket(3, 0, true), 350)
console.log('progression ok')

import { PRESTIGES, prestigeRewards, rankName } from './progression.ts'
assert.equal(rewardsAt(2, 0)[0].kind === 'cash' && (rewardsAt(2, 0)[0] as { amount: number }).amount, 75) // cash rewards pay a quarter of the table (scarce play money)
assert.equal((rewardsAt(2, 2)[0] as { amount: number }).amount, 125) // +50% per prestige, then quartered
assert.deepEqual(rewardsAt(25, 3).find(r => r.kind === 'avatar'), { kind: 'avatar', emoji: PRESTIGES[3].avatar })
assert.ok(rewardsAt(10, 1).every(r => r.kind !== 'frame')) // base frames become cash after prestige
assert.equal(rankName(rankAt(12), 2), 'Frost Sergeant')
assert.equal(rankName(rankAt(50), 10), 'Apex Legend')
assert.equal(PRESTIGES.length, 11)
assert.equal(prestigeRewards(4)[0].kind === 'cash' && (prestigeRewards(4)[0] as { amount: number }).amount, 5000)
console.log('prestige ok')
