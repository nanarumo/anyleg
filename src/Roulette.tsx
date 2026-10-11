import { sfx } from './sound.ts'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { gradeCasino, money, pickLabel, rouletteColor, roulettePays, rouletteWins } from './logic.ts'
import { adjustBalance, logRound, serverRound, toggleLeg, useStore } from './store.ts'
import { SERVER } from './server.ts'
import { CasinoLegs, casinoLeg, Chip, ChipRack, StatBar, WinCelebration, LegDoneButtons, legText, type LegPlay } from './Casino.tsx'

const OUTSIDE = ['low', 'even', 'red', 'black', 'odd', 'high']
const DOZENS = ['d1', 'd2', 'd3']
// Board rows top→bottom: 3,6,9… / 2,5,8… / 1,4,7…
const ROWS = [3, 2, 1].map(r => Array.from({ length: 12 }, (_, i) => i * 3 + r))
// European wheel order, clockwise from 0
const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26]
const SEG = 360 / WHEEL.length

type Placed = { pick: string; amount: number }

/** With `leg`, the wheel spins once for free to settle that parlay leg. */
export default function Roulette({ leg }: { leg?: LegPlay }) {
  const { balance } = useStore()
  const [chip, setChip] = useState(5)
  const [placed, setPlaced] = useState<Placed[]>([]) // in order, so Undo pops the last chip
  const [lastPlaced, setLastPlaced] = useState<Placed[]>([])
  const [spin, setSpin] = useState<{ n: number; key: number }>()
  const [spinning, setSpinning] = useState(false)
  const [history, setHistory] = useState<number[]>([])
  const [banner, setBanner] = useState<{ n: number; text: string }>()
  const [lastWin, setLastWin] = useState(0)
  const [party, setParty] = useState<{ amount: number; title: string; sub: string }>()

  const bets = placed.reduce<Record<string, number>>((m, p) => ({ ...m, [p.pick]: (m[p.pick] ?? 0) + p.amount }), {})
  const total = placed.reduce((a, p) => a + p.amount, 0)

  const place = (pick: string) => {
    if (spinning || total + chip > balance) return
    setBanner(undefined)
    setPlaced([...placed, { pick, amount: chip }])
  }

  const paid = useRef(0) // what the server paid this spin
  const start = async () => {
    if (spinning || (!leg && !total)) return
    let n = Math.floor(Math.random() * 37)
    if (SERVER && !leg) { // the server takes the bets and picks the number; the wheel just shows it
      setSpinning(true)
      const r = await serverRound<{ roulette: number }>('roulette', { bets: placed })
      if (typeof r === 'string') { setSpinning(false); return alert(r) }
      n = r.outcome.roulette
      paid.current = r.returned
    } else if (!leg && !adjustBalance(-total)) return
    setBanner(undefined)
    setSpinning(true)
    sfx.rattle()
    setSpin({ n, key: Date.now() })
  }

  // Called by the wheel once the ball has come to rest.
  const landed = (n: number) => {
    setHistory(h => [n, ...h].slice(0, 15))
    setSpinning(false)
    if (leg) {
      leg.onRound({ roulette: n })
      return setBanner({ n, text: legText(gradeCasino(leg.pick, { roulette: n })) })
    }
    const won = SERVER ? paid.current : placed.reduce((sum, p) => sum + (rouletteWins(p.pick, n) ? p.amount * roulettePays(p.pick) : 0), 0)
    if (!SERVER) adjustBalance(won)
    logRound('roulette', total, won, `${n} ${rouletteColor(n)}`)
    setLastWin(won)
    setBanner({ n, text: won ? `WIN ${money(won)}` : 'NO WIN' })
    if (won) setParty({ amount: won, title: won >= total * 10 ? 'BIG WIN!' : 'WINNER!', sub: `${n} ${rouletteColor(n).toUpperCase()}` })
    setLastPlaced(placed)
    setPlaced([])
  }

  const rebet = () => {
    const amt = lastPlaced.reduce((a, p) => a + p.amount, 0)
    if (amt <= balance) setPlaced(lastPlaced)
  }

  const Cell = ({ pick, children, cls = '' }: { pick: string; children: ReactNode; cls?: string }) => (
    <button className={`cell ${cls} ${banner && rouletteWins(pick, banner.n) ? 'hit' : ''}`} onClick={() => place(pick)}>
      {children}
      {bets[pick] && <span className="onboard"><Chip value={bets[pick]} size={26} /></span>}
    </button>
  )

  const reds = history.filter(n => rouletteColor(n) === 'red').length
  const blacks = history.filter(n => rouletteColor(n) === 'black').length

  return (
    <section className="casino">
      <div className="rl-top">
        <Wheel spin={spin} onDone={landed} />
        <div className="rl-side">
          <div className="small muted">RECENT</div>
          <div className="history">
            {history.map((n, i) => <span key={i} className={`ball ${rouletteColor(n)} ${i === 0 ? 'latest' : ''}`}>{n}</span>)}
            {!history.length && <span className="muted small">No spins yet</span>}
          </div>
          {history.length > 0 && (
            <div className="split-bar">
              <span className="red" style={{ flex: reds || 0.001 }}>{reds || ''}</span>
              <span className="black" style={{ flex: blacks || 0.001 }}>{blacks || ''}</span>
            </div>
          )}
          {banner && (
            <div className={`banner inline ${banner.text === 'NO WIN' || banner.text === 'LEG MISSED' ? 'lost' : 'won'}`}>
              <span className={`ball ${rouletteColor(banner.n)}`}>{banner.n}</span> {banner.text}
            </div>
          )}
          {spinning && <div className="muted">No more bets…</div>}
        </div>
      </div>

      {leg && (
        <div className="controls">
          <div className="leg-goal"><span className="chip">PARLAY LEG</span> <b>{leg.label}</b> <span className="muted small">· free spin, no wager</span></div>
          {banner && !spinning
            ? <LegDoneButtons leg={leg} />
            : <button className="cta wide-cta" onClick={start} disabled={spinning}>{spinning ? 'Spinning…' : 'Spin free'}</button>}
        </div>
      )}

      {!leg && <>
      <div className="rl-felt">
        <div className="board">
          <Cell pick="n0" cls="zero">0</Cell>
          <div className="numbers">
            {ROWS.flat().map(n => <Cell key={n} pick={`n${n}`} cls={rouletteColor(n)}>{n}</Cell>)}
          </div>
          <div className="cols">
            {['c3', 'c2', 'c1'].map(c => <Cell key={c} pick={c}>2:1</Cell>)}
          </div>
        </div>
        <div className="dozens">{DOZENS.map(d => <Cell key={d} pick={d}>{pickLabel(d)}</Cell>)}</div>
        <div className="outside">
          {OUTSIDE.map(o => <Cell key={o} pick={o}>{o === 'red' || o === 'black' ? <span className={`diamond ${o}`} /> : pickLabel(o)}</Cell>)}
        </div>
      </div>

      <div className="controls">
        <ChipRack value={chip} onPick={setChip} max={balance} />
        <div className="btnrow">
          <button className="ghost" onClick={() => setPlaced(placed.slice(0, -1))} disabled={spinning || !total}>Undo</button>
          <button className="ghost" onClick={() => setPlaced([])} disabled={spinning || !total}>Clear</button>
          <button className="ghost" onClick={() => setPlaced([...placed, ...placed])} disabled={spinning || !total || total * 2 > balance}>2×</button>
          {!total && lastPlaced.length > 0 && !spinning
            ? <button className="cta" onClick={rebet}>Rebet</button>
            : <button className="cta" onClick={start} disabled={spinning || !total}>{spinning ? 'Spinning…' : 'Spin'}</button>}
        </div>
        <StatBar bet={total} win={lastWin} />
      </div>

      <div className="extras">
      <CasinoLegs
        game="roulette"
        title="Next roulette spin"
        note="Settles on the next spin you make here. Single zero, true odds."
      >
        <select
          className="numpick"
          value=""
          onChange={e => {
            const n = e.target.value
            toggleLeg(casinoLeg('roulette', `n${n}`)!)
          }}
        >
          <option value="" disabled>Any number +3500…</option>
          {Array.from({ length: 36 }, (_, i) => i + 1).map(n => <option key={n} value={n}>#{n}</option>)}
        </select>
      </CasinoLegs>
      </div>
      </>}
      {party && <WinCelebration {...party} onDone={() => setParty(undefined)} />}
    </section>
  )
}

// ---- physical wheel ----
const C = 120
const R_TRACK = 101 // ball orbit on the bowl
const R_POCKET = 67 // ball at rest in a pocket
const T_TOTAL = 7000 // wheel spin-down
const T_ORBIT = 4200 // ball circling the track
const T_SETTLE = 1400 // ball bouncing across frets into its pocket

const polar = (deg: number, r: number): [number, number] => {
  const a = (deg * Math.PI) / 180
  return [C + r * Math.sin(a), C - r * Math.cos(a)] // 0° = top, clockwise
}
const wrap = (d: number) => ((d % 360) + 360) % 360

/**
 * Wheel spins clockwise and decelerates; ball orbits counter-clockwise, slows, drops off the track a few
 * pockets early, bounces across frets with a damped wobble and rides the wheel into the result pocket.
 * The result is chosen before the animation starts; the physics is choreographed to land there.
 */
export function Wheel({ spin, onDone }: { spin?: { n: number; key: number }; onDone: (n: number) => void }) {
  const rotor = useRef<SVGGElement>(null)
  const ball = useRef<SVGGElement>(null)
  const wheelAngle = useRef(0)
  const ballState = useRef({ a: 180, r: R_POCKET })
  const done = useRef(onDone)
  done.current = onDone

  const draw = (w: number, a: number, r: number) => {
    rotor.current?.setAttribute('transform', `rotate(${w} ${C} ${C})`)
    const [x, y] = polar(a, r)
    ball.current?.setAttribute('transform', `translate(${x} ${y})`)
  }

  useEffect(() => draw(wheelAngle.current, ballState.current.a, ballState.current.r), [])

  useEffect(() => {
    if (!spin) return
    const idx = WHEEL.indexOf(spin.n)
    const W0 = wheelAngle.current
    const wTravel = 540 + Math.random() * 180
    const wheelAt = (t: number) => W0 + wTravel * (1 - (1 - Math.min(t / T_TOTAL, 1)) ** 3)
    const pocketAt = (t: number) => wheelAt(t) + idx * SEG

    // Ball leaves the track `lead` degrees before (clockwise of) its pocket, still moving counter-clockwise.
    const lead = 35 + Math.random() * 50
    const B0 = ballState.current.a
    const dropAt = pocketAt(T_ORBIT) + lead
    const bTravel = 360 * 6 + wrap(B0 - dropAt)
    const orbit = (u: number) => (2 * u - 0.6 * u * u) / 1.4 // eases out but keeps speed at the drop

    let raf = 0
    let settled = false
    const t0 = performance.now()
    const frame = (now: number) => {
      const t = now - t0
      let a: number, r: number
      if (t < T_ORBIT) {
        const u = t / T_ORBIT
        a = B0 - bTravel * orbit(u)
        r = R_TRACK - (u > 0.75 ? ((u - 0.75) / 0.25) * 8 : 0) // spirals down the bowl
      } else if (t < T_ORBIT + T_SETTLE) {
        const s = (t - T_ORBIT) / T_SETTLE
        const decay = Math.exp(-3.5 * s)
        a = pocketAt(t) + lead * decay * Math.cos(s * Math.PI * 2.5) // overshoots, rattles back
        r = R_POCKET + (R_TRACK - 8 - R_POCKET) * decay * Math.abs(Math.cos(s * Math.PI * 3))
      } else {
        a = pocketAt(t)
        r = R_POCKET
      }
      const w = wheelAt(t)
      draw(w, a, r)
      if (t < T_TOTAL) raf = requestAnimationFrame(frame)
      else {
        wheelAngle.current = wrap(w)
        ballState.current = { a: wrap(a), r }
        settled = true
        done.current(spin.n)
      }
    }
    raf = requestAnimationFrame(frame)
    // Leaving mid-spin still settles the spin (the result was decided up front).
    return () => { cancelAnimationFrame(raf); if (!settled) done.current(spin.n) }
  }, [spin])

  return (
    <svg viewBox="0 0 240 240" className="wheel">
      <defs>
        <radialGradient id="bowl" cx="50%" cy="50%" r="50%">
          <stop offset="80%" stopColor="#2a1a0c" />
          <stop offset="92%" stopColor="#4a2e14" />
          <stop offset="100%" stopColor="#1a0f06" />
        </radialGradient>
        <radialGradient id="cone" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#c99a4a" />
          <stop offset="100%" stopColor="#5b3a1a" />
        </radialGradient>
        <radialGradient id="ballg" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#fff" />
          <stop offset="100%" stopColor="#b9bec6" />
        </radialGradient>
      </defs>
      {/* wooden rim + ball track (static) */}
      <circle cx={C} cy={C} r={119} fill="#6b4220" stroke="#2a1608" strokeWidth="2" />
      <circle cx={C} cy={C} r={110} fill="url(#bowl)" />
      {Array.from({ length: 8 }, (_, i) => {
        const [x, y] = polar(i * 45 + 22.5, 95)
        return <rect key={i} x={x - 3} y={y - 3} width="6" height="6" fill="#d4af37" transform={`rotate(${i * 45 + 67.5} ${x} ${y})`} />
      })}
      {/* rotor */}
      <g ref={rotor}>
        <circle cx={C} cy={C} r={91} fill="#d4af37" />
        {WHEEL.map((n, i) => {
          const a0 = i * SEG - SEG / 2, a1 = a0 + SEG
          const fill = n === 0 ? '#15803d' : rouletteColor(n) === 'red' ? '#b91c1c' : '#141414'
          const [tx, ty] = polar(i * SEG, 82)
          const seg = (ro: number, ri: number) =>
            `M${polar(a0, ro)} A${ro},${ro} 0 0 1 ${polar(a1, ro)} L${polar(a1, ri)} A${ri},${ri} 0 0 0 ${polar(a0, ri)} Z`
          return (
            <g key={n}>
              <path d={seg(90, 74)} fill={fill} />
              <path d={seg(74, 58)} fill={fill} opacity=".75" />
              <line x1={polar(a0, 74)[0]} y1={polar(a0, 74)[1]} x2={polar(a0, 58)[0]} y2={polar(a0, 58)[1]} stroke="#e8c76a" strokeWidth="1.2" />
              <text x={tx} y={ty} transform={`rotate(${i * SEG} ${tx} ${ty})`} textAnchor="middle" dominantBaseline="central" fontSize="8.5" fontWeight="800" fill="#fff">{n}</text>
            </g>
          )
        })}
        <circle cx={C} cy={C} r={74} fill="none" stroke="#e8c76a" strokeWidth="1" />
        <circle cx={C} cy={C} r={57} fill="url(#cone)" stroke="#d4af37" strokeWidth="2" />
        {[0, 90].map(d => {
          const [x1, y1] = polar(d, 34), [x2, y2] = polar(d + 180, 34)
          return <line key={d} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#e8c76a" strokeWidth="5" strokeLinecap="round" />
        })}
        <circle cx={C} cy={C} r={10} fill="#e8c76a" stroke="#8a6a1c" strokeWidth="2" />
      </g>
      <g ref={ball}>
        <circle r="4.6" fill="url(#ballg)" stroke="#6b7280" strokeWidth=".4" />
      </g>
    </svg>
  )
}
