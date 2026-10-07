import assert from 'node:assert/strict'
import { botNet, nextReset, seasonNo, SEASON_BOTS, weekId, weekStart } from './season.ts'

const wed = new Date(2026, 9, 7, 15, 0).getTime() // Wed Oct 7 2026
assert.equal(new Date(weekStart(wed)).getDay(), 1) // Monday
assert.equal(weekId(wed), '2026-10-05')
assert.equal(weekId(new Date(2026, 9, 11, 23, 59).getTime()), '2026-10-05') // Sunday night: same week
assert.equal(weekId(new Date(2026, 9, 12, 0, 1).getTime()), '2026-10-12')
assert.equal(seasonNo(new Date(2026, 9, 5).getTime()), 1)
assert.equal(seasonNo(new Date(2026, 9, 14).getTime()), 2)
assert.equal(nextReset(wed), new Date(2026, 9, 12).getTime())
// Bots: same week → same number; grows from 0 at the reset to the full result at week's end.
const shark = SEASON_BOTS[0]
assert.equal(botNet('2026-10-05', shark, wed), botNet('2026-10-05', shark, wed))
assert.equal(botNet('2026-10-05', shark, new Date(2026, 9, 5).getTime()), 0)
assert.notEqual(botNet('2026-10-05', shark, nextReset(wed)), botNet('2026-10-12', shark, nextReset(new Date(2026, 9, 12).getTime())))
console.log('season ok')
