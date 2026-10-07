import assert from 'node:assert/strict'
import { crashPoint, gradeCasino, minesMult, placeMines, PLINKO_RISK, PLINKO_ROWS, CRASH_PICKS, MINES_PICKS, PLINKO_PICKS, toDecimal } from './logic.ts'

// Crash: P(point >= x) ≈ 0.97 / x
let r = 1; const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647)
const pts = Array.from({ length: 200000 }, () => crashPoint(rand))
const share = (x: number) => pts.filter(p => p >= x).length / pts.length
assert.ok(Math.abs(share(2) - 0.485) < 0.01, `2x share ${share(2)}`)
assert.ok(Math.abs(share(10) - 0.097) < 0.005)
assert.equal(gradeCasino('c2', { crash: { point: 2 } }), 'won')
assert.equal(gradeCasino('c5', { crash: { point: 4.99 } }), 'lost')

// Mines: the multiplier is 0.97 / P(surviving), and placements are distinct.
assert.equal(minesMult(3, 0), 1)
assert.ok(Math.abs(minesMult(1, 1) - 1.01) < 0.01) // 24/25 safe → 0.97 × 25/24
assert.equal(placeMines(10).size, 10)
assert.equal(gradeCasino('safe3', { mines: { safe: 3 } }), 'won')
assert.equal(gradeCasino('safe5', { mines: { safe: 4 } }), 'lost')

// Plinko: every risk level returns 96–100% on average (binomial buckets).
const C = (n: number, k: number) => { let x = 1; for (let i = 0; i < k; i++) x = (x * (n - i)) / (i + 1); return x }
for (const [risk, mults] of Object.entries(PLINKO_RISK)) {
  const rtp = mults.reduce((t, m, k) => t + m * C(PLINKO_ROWS, k) / 2 ** PLINKO_ROWS, 0)
  assert.ok(rtp > 0.96 && rtp < 1, `${risk} rtp ${rtp}`)
}
assert.equal(gradeCasino('p2', { plinko: { mult: 2 } }), 'won')

// Every leg price is under fair (the house keeps an edge).
const fair = { c2: 0.97 / 2, c5: 0.97 / 5, c10: 0.97 / 10, safe3: C(22, 3) / C(25, 3), safe5: C(20, 5) / C(25, 5), p2: 598 / 4096, p4: 158 / 4096 }
for (const p of [...CRASH_PICKS, ...MINES_PICKS, ...PLINKO_PICKS]) assert.ok(1 / toDecimal(p.odds) > fair[p.pick as keyof typeof fair], p.pick)
console.log('crash mines plinko ok')
