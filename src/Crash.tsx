import { useEffect, useRef, useState } from 'react'
import { CRASH_PICKS, crashPoint, gradeCasino, money } from './logic.ts'
import { adjustBalance, logRound, serverRound, useStore } from './store.ts'
import { SERVER } from './server.ts'
import { CasinoLegs, ChipRack, StatBar, WinCelebration, LegDoneButtons, legText, type LegPlay } from './Casino.tsx'
import { sfx } from './sound.ts'

const GROWTH = 0.00011 // multiplier = e^(GROWTH × ms): 2x after ~6s, 10x after ~21s
const at = (ms: number, speed = 1) => Math.floor(Math.exp(GROWTH * ms * speed) * 100) / 100

/** Crash: a multiplier climbs until it crashes. Cash out (or auto cash out) before it does. With `leg`, one free round settles the leg. */
export default function Crash({ leg }: { leg?: LegPlay }) {
  const { balance } = useStore()
  const [bet, setBet] = useState(10)
  const [auto, setAuto] = useState('2.00')
  const [mult, setMult] = useState(1)
  const [phase, setPhase] = useState<'bet' | 'flying' | 'done'>('bet')
  const [cashed, setCashed] = useState<number>()
  const [crashed, setCrashed] = useState<number>()
  const [history, setHistory] = useState<number[]>([])
  const [lastWin, setLastWin] = useState(0)
  const [legResult, setLegResult] = useState<{ text: string; r: string }>()
  const [party, setParty] = useState<{ amount: number; title: string; sub: string }>()
  const raf = useRef(0)
  const round = useRef<{ point: number; start: number; stake: number; cashed?: number; auto?: number }>(undefined)
  const speed = leg ? 2.5 : 1 // free leg rounds run faster

  useEffect(() => () => {
    clearInterval(raf.current)
    // Leaving mid-flight counts as pressing Cash out at the multiplier showing when you left (the rocket hadn't crashed yet).
    // A free parlay leg can't be dodged: it settles on where this round crashes.
    const r = round.current
    if (!r || r.cashed) return
    if (leg) { leg.onRound({ crash: { point: r.point } }); return }
    const m = Math.min(at(performance.now() - r.start), r.point)
    const paid = m < r.point ? +(r.stake * m).toFixed(2) : 0
    if (paid && !SERVER) adjustBalance(paid)
    logRound('crash', r.stake, paid, paid ? `Left the table · cashed out ${m.toFixed(2)}x` : `Crashed at ${r.point.toFixed(2)}x`)
  }, [])

  const cashOut = (m: number) => {
    const r = round.current
    if (!r || r.cashed || m > r.point) return
    r.cashed = m
    const paid = +(r.stake * m).toFixed(2)
    if (!SERVER) adjustBalance(paid) // server rounds were paid when dealt
    logRound('crash', r.stake, paid, `Cashed out ${m.toFixed(2)}x`)
    setCashed(m); setLastWin(paid); sfx.win()
    if (m >= 5) setParty({ amount: paid, title: m >= 20 ? 'MOONSHOT!' : 'BIG CASH OUT!', sub: `Cashed out at ${m.toFixed(2)}x` })
  }

  const launching = useRef(false)
  const launch = async () => {
    if (phase === 'flying' || launching.current) return
    const autoAt = Number(auto) >= 1.01 ? Math.round(Number(auto) * 100) / 100 : undefined
    let point = crashPoint()
    if (!leg && !bet) return
    if (SERVER && !leg) { // ponytail: server rounds cash out at the auto target; tap-to-cash-out needs a server clock (step 4)
      if (!autoAt) return alert('Set an auto cash out of 1.01x or more')
      launching.current = true
      const r = await serverRound<{ crash: { point: number } }>('crash', { wager: bet, cashAt: autoAt })
      launching.current = false
      if (typeof r === 'string') return alert(r)
      point = r.outcome.crash.point
    } else if (!leg && !adjustBalance(-bet)) return
    round.current = { point, start: performance.now(), stake: leg ? 0 : bet, auto: leg ? undefined : autoAt }
    setPhase('flying'); setCashed(undefined); setCrashed(undefined); setMult(1); setLegResult(undefined)
    let lastTick = 1
    const frame = () => {
      const r = round.current!
      const m = Math.min(at(performance.now() - r.start, speed), r.point)
      setMult(m)
      if (m - lastTick >= 0.25) { sfx.tick(m); lastTick = m }
      if (r.auto && !r.cashed && m >= r.auto) cashOut(r.auto)
      if (m >= r.point) {
        setCrashed(r.point); setPhase('done'); setHistory(h => [r.point, ...h].slice(0, 14))
        sfx.crash()
        if (leg) {
          leg.onRound({ crash: { point: r.point } })
          const g = gradeCasino(leg.pick, { crash: { point: r.point } })
          setLegResult({ text: legText(g), r: g })
        } else if (!r.cashed) logRound('crash', r.stake, 0, `Crashed at ${r.point.toFixed(2)}x`)
        round.current = undefined
        clearInterval(raf.current)
      }
    }
    raf.current = window.setInterval(frame, 50) // 20 fps; intervals keep ticking where animation frames get throttled
  }

  // The climb, drawn as a curve in a plot that rescales as it goes (x = seconds, y = multiplier).
  const X0 = 34, X1 = 312, Y0 = 186, Y1 = 22
  const elapsed = Math.log(Math.max(mult, 1)) / GROWTH / speed
  const T = Math.max(elapsed * 1.15, 6000 / speed), M = Math.max(mult * 1.2, 2)
  const px = (t: number) => X0 + (t / T) * (X1 - X0)
  const py = (m: number) => Y0 - ((m - 1) / (M - 1)) * (Y0 - Y1)
  const pts = Array.from({ length: 61 }, (_, i) => { const t = (elapsed * i) / 60; return [px(t), py(at(t, speed))] as const })
  const [rx, ry] = pts[pts.length - 1]
  const [qx, qy] = pts[pts.length - 4]
  const angle = phase === 'bet' ? -35 : (Math.atan2(ry - qy, rx - qx) * 180) / Math.PI
  const yTicks = [1, 1.5, 2, 3, 5, 10, 20, 50, 100, 250, 500, 1000].filter(m => m <= M).slice(-5)
  const secs = T * speed / 1000 // real seconds on screen
  const step = [1, 2, 5, 10, 20, 30, 60].find(s => secs / s <= 5) ?? 60
  const xTicks = Array.from({ length: Math.floor(secs / step) }, (_, i) => (i + 1) * step)
  const target = leg ? CRASH_PICKS.find(p => p.pick === leg.pick)?.at : undefined
  const cashT = cashed ? Math.log(cashed) / GROWTH / speed : undefined
  // the multiplier heats up as it climbs
  const heat = crashed ? '#ef4444' : cashed ? '#22c55e' : mult >= 10 ? '#f472b6' : mult >= 3 ? '#fbbf24' : mult >= 1.5 ? '#a3e635' : '#e5e7eb'

  return (
    <section className="casino">
      <div className={`crash-stage ${crashed ? 'boom' : ''} ${phase === 'flying' && !crashed ? 'flying' : ''}`} style={{ ['--warp' as string]: `${Math.max(0.6, 6 / Math.sqrt(mult))}s` }}>
        <div className="crash-stars" aria-hidden />
        <div className="crash-history">{history.map((p, i) => <span key={i} className={p >= 2 ? 'hi' : ''}>{p.toFixed(2)}x</span>)}</div>
        <svg viewBox="0 0 320 200" className="crash-graph" aria-hidden>
          <defs>
            <linearGradient id="crashLine" x1="0" x2="1" y1="1" y2="0"><stop offset="0" stopColor="#8b5cf6" /><stop offset=".6" stopColor="#ec4899" /><stop offset="1" stopColor="#fbbf24" /></linearGradient>
            <linearGradient id="crashFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#ec4899" stopOpacity=".35" /><stop offset="1" stopColor="#8b5cf6" stopOpacity="0" /></linearGradient>
            <radialGradient id="crashFlame"><stop offset="0" stopColor="#fff7ad" /><stop offset=".45" stopColor="#fb923c" /><stop offset="1" stopColor="#ef4444" stopOpacity="0" /></radialGradient>
            <filter id="crashGlow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>
          {yTicks.map(m => <g key={m} className="crash-grid"><line x1={X0} x2={X1} y1={py(m)} y2={py(m)} /><text x={X0 - 5} y={py(m)} textAnchor="end" dominantBaseline="central">{m}x</text></g>)}
          {xTicks.map(t => <text key={t} className="crash-xtick" x={px((t * 1000) / speed)} y={Y0 + 11} textAnchor="middle">{t}s</text>)}
          {target && <g className="crash-target"><line x1={X0} x2={X1} y1={py(target)} y2={py(target)} /><text x={X1} y={py(target) - 4} textAnchor="end">LEG {target}x</text></g>}
          {phase !== 'bet' && <>
            <path d={`M${X0},${Y0} ${pts.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} L${rx.toFixed(1)},${Y0} Z`} fill={crashed ? '#ef444422' : 'url(#crashFill)'} />
            <path d={`M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L')}`} className="crash-line" stroke={crashed ? '#ef4444' : 'url(#crashLine)'} filter="url(#crashGlow)" />
            {!crashed && pts.slice(-22, -2).filter((_, i) => i % 3 === 0).map(([x, y], i, arr) => <circle key={i} cx={x} cy={y} r={2 + (arr.length - i) * 0.9} className="crash-smoke" opacity={0.08 + (i / arr.length) * 0.25} />)}
            {cashT !== undefined && <g className="crash-flag"><circle cx={px(cashT)} cy={py(cashed!)} r="4" /><text x={px(cashT)} y={py(cashed!) - 9} textAnchor="middle">+{money(bet * cashed!)}</text></g>}
          </>}
          {crashed ? (
            <g transform={`translate(${rx} ${ry})`} className="crash-boom">
              <circle r="10" className="boom-ring" />
              <circle r="14" className="boom-core" />
              {Array.from({ length: 12 }, (_, i) => <circle key={i} r="2.2" className="boom-bit" style={{ ['--a' as string]: `${i * 30}deg`, ['--d' as string]: `${26 + (i % 3) * 10}px` }} />)}
            </g>
          ) : (
            <g transform={`translate(${phase === 'bet' ? X0 + 14 : rx} ${phase === 'bet' ? Y0 - 12 : ry}) rotate(${angle})`}>
              <g className={phase === 'bet' ? 'crash-rocket idle' : 'crash-rocket'}>
                <ellipse cx="-17" rx={phase === 'flying' ? 11 : 5} ry="4.5" fill="url(#crashFlame)" className="crash-flame" />
                <path d="M-12,-6 L-17,-12 L-5,-6 Z M-12,6 L-17,12 L-5,6 Z" fill="#ec4899" />
                <path d="M-13,-5.5 L6,-5.5 Q15,-5.5 20,0 Q15,5.5 6,5.5 L-13,5.5 Z" fill="#f1f5f9" stroke="#94a3b8" strokeWidth=".6" />
                <rect x="-8" y="-5.5" width="3" height="11" fill="#8b5cf6" />
                <circle cx="7" r="2.8" fill="#38bdf8" stroke="#334155" strokeWidth=".8" />
              </g>
            </g>
          )}
        </svg>
        <div className={`crash-mult ${crashed ? 'dead' : cashed ? 'safe' : ''}`} style={{ color: heat }}>
          {mult.toFixed(2)}x
          {crashed && <small>CRASHED</small>}
          {cashed && !crashed && <small>Cashed out at {cashed.toFixed(2)}x</small>}
          {phase === 'bet' && <small>READY FOR LAUNCH</small>}
        </div>
        {legResult && <div className={`banner inline ${legResult.r}`}>{legResult.text}</div>}
      </div>

      <div className="controls">
        {leg && <div className="leg-goal"><span className="chip">PARLAY LEG</span> <b>{leg.label}</b> <span className="muted small">· free round, no wager</span></div>}
        {leg ? (
          legResult ? <LegDoneButtons leg={leg} /> : <button className="cta wide-cta" onClick={launch} disabled={phase === 'flying'}>{phase === 'flying' ? 'Flying…' : 'Launch free round'}</button>
        ) : phase === 'flying' && !cashed && !SERVER ? (
          <button className="cta wide-cta crash-cash" onClick={() => round.current && cashOut(Math.min(at(performance.now() - round.current.start), round.current.point))}>
            Cash out {money(bet * mult)}
          </button>
        ) : <>
          <ChipRack value={bet} onPick={setBet} max={balance} />
          <div className="btnrow">
            <label className="crash-auto"><span className="muted small">Auto cash out</span><input type="number" inputMode="decimal" min="1.01" step="0.1" value={auto} onChange={e => setAuto(e.target.value)} /></label>
            <button className="cta" onClick={launch} disabled={phase === 'flying' || bet > balance}>{phase === 'flying' ? 'Flying…' : `Launch ${money(bet)}`}</button>
          </div>
        </>}
        {!leg && <StatBar bet={bet} win={lastWin} />}
      </div>

      {!leg && <div className="extras"><CasinoLegs game="crash" title="Next crash round" note="Graded on where the round crashes, whether or not anyone cashed out." /></div>}
      {party && <WinCelebration {...party} onDone={() => setParty(undefined)} />}
    </section>
  )
}
