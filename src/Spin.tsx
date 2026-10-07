// The daily login spin wheel. Pops up once a day on open, and lives in Profile → My Rewards.
import { useState } from 'react'
import { SPIN_PRIZES, spinDaily, spinReady } from './store.ts'
import { leave } from './motion.ts'

const SLICE = 360 / SPIN_PRIZES.length
const COLORS = ['#7c3aed', '#db2777', '#0ea5e9', '#f59e0b', '#16a34a', '#e11d48', '#6366f1', '#ca8a04']

export function DailySpin({ onClose }: { onClose: () => void }) {
  const [angle, setAngle] = useState(0)
  const [won, setWon] = useState<number>()
  const [spinning, setSpinning] = useState(false)
  const ready = spinReady() || spinning
  const spin = () => {
    const i = spinDaily()
    if (i === undefined) return
    setSpinning(true)
    // Land slice i under the pointer at the top, after a few full turns.
    setAngle(360 * 6 + (360 - (i * SLICE + SLICE / 2)) + (Math.random() - 0.5) * SLICE * 0.6)
    setTimeout(() => { setWon(i); setSpinning(false) }, 4200)
  }
  return (
    <div className="modal spin-modal" onClick={e => !spinning && leave(e, onClose)}>
      <div className="spin-card" onClick={e => e.stopPropagation()}>
        <div className="duel-kicker">Daily login spin</div>
        <h2>🎡 Spin to win</h2>
        <div className="spin-wheel-wrap">
          <div className="spin-wheel-pointer" />
          {/* SVG so it's a true circle on every screen, with each prize centered in its own slice. */}
          <svg className="spin-wheel" viewBox="0 0 200 200" style={{ transform: `rotate(${angle}deg)` }} aria-hidden>
            <circle cx="100" cy="100" r="99" fill="#7c2d12" />
            <circle cx="100" cy="100" r="96" fill="#fde047" />
            {SPIN_PRIZES.map((p, i) => {
              const a0 = (i * SLICE * Math.PI) / 180, a1 = ((i + 1) * SLICE * Math.PI) / 180
              const pt = (a: number, r: number) => `${100 + r * Math.sin(a)},${100 - r * Math.cos(a)}`
              const mid = i * SLICE + SLICE / 2
              return (
                <g key={i}>
                  <path d={`M100,100 L${pt(a0, 92)} A92,92 0 0 1 ${pt(a1, 92)} Z`} fill={COLORS[i]} stroke="#fde047" strokeWidth="1.2" />
                  {/* Label sits on the slice's center line; left-half labels are flipped so none read upside down. */}
                  <text x={mid > 180 ? 43 : 157} y="100" transform={`rotate(${mid > 180 ? mid + 90 : mid - 90} 100 100)`} textAnchor="middle" dominantBaseline="central" className="spin-wheel-text">{p.short ?? p.label}</text>
                  <circle cx={pt(a0, 94).split(',')[0]} cy={pt(a0, 94).split(',')[1]} r="2.2" fill="#fff7cc" />
                </g>
              )
            })}
          </svg>
          <div className="spin-wheel-hub">◆</div>
        </div>
        <details className="muted small"><summary>Prize odds</summary>{SPIN_PRIZES.map(p => `${p.label} ${Math.round((p.w / SPIN_PRIZES.reduce((t, x) => t + x.w, 0)) * 100)}%`).join(' · ')}</details>
        {won !== undefined
          ? <><div className="spin-won">You won <b>{SPIN_PRIZES[won].label}</b>!</div><button className="cta" onClick={e => leave(e, onClose)}>Collect</button></>
          : ready
            ? <><button className="cta" onClick={spin} disabled={spinning}>{spinning ? 'Spinning…' : 'Spin'}</button>{!spinning && <button className="link" onClick={e => leave(e, onClose)}>Later</button>}</>
            : <><p className="muted">Come back tomorrow for another free spin.</p><button className="ghost" onClick={e => leave(e, onClose)}>Close</button></>}
      </div>
    </div>
  )
}
