import { useEffect, useRef, useState } from 'react'
import { PLINKO_RISK, PLINKO_ROWS, gradeCasino, money, plinkoPath, type PlinkoRisk } from './logic.ts'
import { adjustBalance, logRound, serverRound, useStore } from './store.ts'
import { SERVER } from './server.ts'
import { CasinoLegs, ChipRack, StatBar, WinCelebration, LegDoneButtons, legText, type LegPlay } from './Casino.tsx'
import { sfx } from './sound.ts'

const SEG_MS = 125 // one bounce, peg to peg
const W = 300, TOP = 18, ROW_H = 20, GAP = W / (PLINKO_ROWS + 2), BALL_R = 5, PEG_R = 2.4
type Ball = { id: number; path: number[]; t0: number; stake: number; risk: PlinkoRisk; hop: number[]; seg: number }

const pegY = (r: number) => TOP + (r + 1) * ROW_H - 4
const rightsBefore = (b: Ball, r: number) => b.path.slice(0, r).reduce((t, v) => t + v, 0)
/** Where the ball touches the top of its peg in row r (the ball always lands right on a peg, then kicks left or right). */
const contact = (b: Ball, r: number) => ({ x: W / 2 + (rightsBefore(b, r) - r / 2) * GAP, y: pegY(r) - PEG_R - BALL_R })

/** Ball position `e` ms after the drop: a fall onto the first peg, then one hop per row, then into its bucket.
 * Each hop pops up off the peg and arcs down (y = y0 − A·u + (dy + A)·u²) while drifting half a gap sideways. */
function ballAt(b: Ball, e: number) {
  const s = Math.floor(e / SEG_MS), u = (e % SEG_MS) / SEG_MS
  const from = s === 0 ? { x: W / 2, y: 0 } : contact(b, s - 1)
  const to = s < PLINKO_ROWS ? contact(b, s) : { x: W / 2 + (rightsBefore(b, PLINKO_ROWS) - PLINKO_ROWS / 2) * GAP, y: TOP + PLINKO_ROWS * ROW_H + 13 }
  const A = s === 0 ? 0 : b.hop[s]
  const dy = to.y - from.y
  return { s, u, x: from.x + (to.x - from.x) * u, y: from.y - A * u + (dy + A) * u * u }
}
const color = (m: number) => (m >= 10 ? '#e11d48' : m >= 3 ? '#f97316' : m >= 1.5 ? '#f59e0b' : m >= 1 ? '#84cc16' : '#0ea5e9')

/** Plinko: drop balls through 12 rows of pegs; the bucket sets the multiplier. With `leg`, one free ball on medium risk. */
export default function Plinko({ leg }: { leg?: LegPlay }) {
  const { balance } = useStore()
  const [bet, setBet] = useState(5)
  const [risk, setRisk] = useState<PlinkoRisk>('medium')
  const [balls, setBalls] = useState<Ball[]>([])
  const [hits, setHits] = useState<{ id: number; bucket: number }[]>([])
  const [lastWin, setLastWin] = useState(0)
  const [legResult, setLegResult] = useState<{ text: string; r: string }>()
  const [party, setParty] = useState<{ amount: number; title: string; sub: string }>()
  const nextId = useRef(0)
  // The ref is the source of truth (the animation loop and drop() both write it), so a drop mid-frame is never lost.
  const ballsRef = useRef<Ball[]>([])
  const ballEls = useRef(new Map<number, SVGCircleElement>())
  const svg = useRef<SVGSVGElement>(null)
  const mults = PLINKO_RISK[leg ? 'medium' : risk]

  // Balls still falling when you leave land instantly (their buckets were decided at the drop), free leg ball included.
  useEffect(() => () => { for (const b of ballsRef.current) land(b) }, [])

  const land = (b: Ball) => {
    const bucket = b.path.reduce((t, v) => t + v, 0)
    const m = PLINKO_RISK[b.risk][bucket]
    setHits(h => [{ id: b.id, bucket }, ...h].slice(0, 12))
    if (leg) {
      leg.onRound({ plinko: { mult: m } })
      const g = gradeCasino(leg.pick, { plinko: { mult: m } })
      setLegResult({ text: legText(g), r: g })
      return
    }
    const paid = +(b.stake * m).toFixed(2)
    if (!SERVER) adjustBalance(paid)
    logRound('plinko', b.stake, paid, `${m}x (${b.risk})`)
    setLastWin(paid)
    if (m >= 1) sfx.win(); else sfx.lose()
    if (m >= 10) setParty({ amount: paid, title: m >= 100 ? 'JACKPOT BUCKET!' : 'BIG DROP!', sub: `${m}x on ${b.risk} risk` })
  }

  // One animation loop moves every ball, writing positions straight to the SVG (no React render per frame).
  // It runs while anything is falling, so new drops never restart it.
  const falling = balls.length > 0
  useEffect(() => {
    if (!falling) return
    let raf = 0
    const frame = () => {
      const now = performance.now()
      let landed = false, ping = false
      for (const b of ballsRef.current) {
        const p = ballAt(b, now - b.t0)
        if (p.s > PLINKO_ROWS) { land(b); landed = true; continue }
        // Each new peg contact flashes that peg.
        for (let r = b.seg; r < Math.min(p.s, PLINKO_ROWS); r++) {
          const peg = svg.current?.querySelector(`[data-peg="${r}-${rightsBefore(b, r) + 1}"]`)
          if (peg) { peg.classList.remove('hit'); void (peg as SVGGraphicsElement).getBBox(); peg.classList.add('hit') }
          ping = true
        }
        b.seg = Math.max(b.seg, p.s)
        // squash for a split second as it hits a peg, then stretch back round
        const sq = p.s > 0 && p.u < 0.18 ? 1 - (0.18 - p.u) * 1.4 : 1
        ballEls.current.get(b.id)?.setAttribute('transform', `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) scale(${(2 - sq).toFixed(3)} ${sq.toFixed(3)})`)
      }
      if (ping) sfx.peg()
      if (landed) { ballsRef.current = ballsRef.current.filter(b => performance.now() - b.t0 < SEG_MS * (PLINKO_ROWS + 1)); setBalls(ballsRef.current) }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [falling])

  const drop = async () => {
    let path = plinkoPath()
    if (leg) { if (balls.length || legResult) return }
    else if (!bet) return
    else if (SERVER) { // the server takes the wager and picks the bounces; the board animates them
      const r = await serverRound<{ plinko: { path: (0 | 1)[] } }>('plinko', { wager: bet, risk })
      if (typeof r === 'string') return alert(r)
      path = r.outcome.plinko.path
    } else if (!adjustBalance(-bet)) return
    ballsRef.current = [...ballsRef.current, { id: nextId.current++, path, t0: performance.now(), stake: leg ? 0 : bet, risk: leg ? 'medium' : risk, hop: Array.from({ length: PLINKO_ROWS + 1 }, () => 5 + Math.random() * 6), seg: 0 }]
    setBalls(ballsRef.current)
  }

  const H = TOP + PLINKO_ROWS * ROW_H + 34
  const bucketW = GAP
  const bucketX = (i: number) => W / 2 + (i - PLINKO_ROWS / 2) * bucketW
  const BY = TOP + PLINKO_ROWS * ROW_H
  const lastHit = new Map<number, number>()
  for (const h of [...hits].reverse()) lastHit.set(h.bucket, h.id)
  return (
    <section className="casino">
      <div className="plinko-felt">
        <svg viewBox={`0 0 ${W} ${H}`} className="plinko-board" ref={svg}>
          {Array.from({ length: PLINKO_ROWS }, (_, r) => Array.from({ length: r + 3 }, (_, k) => (
            <circle key={`${r}-${k}`} data-peg={`${r}-${k}`} cx={W / 2 + (k - (r + 2) / 2) * GAP} cy={pegY(r)} r={PEG_R} className="peg" />
          )))}
          {mults.map((m, i) => {
            const x = bucketX(i), hit = lastHit.get(i)
            // re-keyed on each landing so the bounce animation replays
            return (
              <g key={`${i}-${hit}`} className={hit === undefined ? 'bucket' : 'bucket pop'} style={{ transformOrigin: `${x}px ${BY + 16}px` }}>
                <rect x={x - bucketW / 2 + 1} y={TOP + PLINKO_ROWS * ROW_H + 6} width={bucketW - 2} height="20" rx="4" fill={color(m)} />
                <text x={x} y={TOP + PLINKO_ROWS * ROW_H + 19.5} textAnchor="middle" className="bucket-text">{m}</text>
              </g>
            )
          })}
          {hits.slice(0, 4).map(h => (
            <g key={h.id} transform={`translate(${bucketX(h.bucket)} ${BY + 6})`} className="plinko-splash">
              <circle r="9" fill="none" stroke={color(mults[h.bucket])} strokeWidth="2.5" />
              <text y="-8" textAnchor="middle" fill={color(mults[h.bucket])}>{mults[h.bucket]}x</text>
            </g>
          ))}
          {balls.map(b => <circle key={b.id} r={BALL_R} className="plinko-ball" transform={`translate(${W / 2} 0)`} ref={el => { if (el) ballEls.current.set(b.id, el); else ballEls.current.delete(b.id) }} />)}
        </svg>
        <div className="plinko-hits">{hits.map((h, i) => <span key={i} style={{ background: color(mults[h.bucket]) }}>{mults[h.bucket]}x</span>)}</div>
        {legResult && <div className={`banner inline ${legResult.r}`}>{legResult.text}</div>}
      </div>

      <div className="controls">
        {leg && <div className="leg-goal"><span className="chip">PARLAY LEG</span> <b>{leg.label}</b> <span className="muted small">· free ball, no wager</span></div>}
        {leg ? (
          legResult ? <LegDoneButtons leg={leg} /> : <button className="cta wide-cta" onClick={drop} disabled={balls.length > 0}>{balls.length ? 'Dropping…' : 'Drop free ball'}</button>
        ) : <>
          <div className="seg">{(Object.keys(PLINKO_RISK) as PlinkoRisk[]).map(r => <button key={r} className={risk === r ? 'on' : ''} onClick={() => setRisk(r)}>{r[0].toUpperCase() + r.slice(1)} risk</button>)}</div>
          <ChipRack value={bet} onPick={setBet} max={balance} />
          <button className="cta wide-cta" onClick={drop} disabled={bet > balance}>Drop ball {money(bet)}</button>
        </>}
        {!leg && <StatBar bet={bet} win={lastWin} />}
      </div>

      {!leg && <div className="extras"><CasinoLegs game="plinko" title="Next plinko ball" note="Played on medium risk." /></div>}
      {party && <WinCelebration {...party} onDone={() => setParty(undefined)} />}
    </section>
  )
}
