import { sfx } from './sound.ts'
import { useEffect, useRef, useState } from 'react'
import { SLOT_SYMBOLS, gradeCasino, money, slotPays, spinReel } from './logic.ts'
import { FREE_SPIN_VALUE, adjustBalance, logRound, useFreeSpin, useStore } from './store.ts'
import { CasinoLegs, ChipRack, StatBar, WinCelebration, LegDoneButtons, legText, type LegPlay } from './Casino.tsx'

const FILLER = 18 // blurred symbols that whiz past before the reel stops
const STOP_MS = [1300, 1800, 2400] // reels stop left to right
const PAYS: [string, string][] = [['💎 💎 💎', '150x'], ['7 7 7', '75x'], ['⭐ ⭐ ⭐', '40x'], ['🔔 🔔 🔔', '20x'], ['🍉 🍉 🍉', '12x'], ['🍋 🍋 🍋', '8x'], ['🍒 🍒 🍒', '6x'], ['any two 🍒', '2.5x'], ['🍒 on reel 1', '1.25x']]

/** 3-reel classic slot, middle payline. With `leg`, one free spin settles that parlay leg. */
export default function Slots({ leg }: { leg?: LegPlay }) {
  const { balance, inv } = useStore()
  const [lastStake, setLastStake] = useState(0)
  const [bet, setBet] = useState(5)
  // Each reel shows 3 symbols; `strips` holds the full strip animated for the current spin.
  const [windows, setWindows] = useState<string[][]>(() => [0, 1, 2].map(() => [spinReel(), spinReel(), spinReel()]))
  const [strips, setStrips] = useState<string[][]>()
  const [spinId, setSpinId] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const [win, setWin] = useState<{ name: string; mult: number }>()
  const [legResult, setLegResult] = useState<string>()
  const [lastWin, setLastWin] = useState(0)
  const [party, setParty] = useState<{ amount: number; title: string; sub: string }>()
  const pending = useRef<() => void>(undefined)
  const timer = useRef<number>(undefined)
  useEffect(() => () => { clearTimeout(timer.current); pending.current?.() }, [])

  /** `free` spends a Free Spin reward: plays at a fixed $${FREE_SPIN_VALUE} with no charge. */
  const spin = (free = false) => {
    if (spinning) return
    if (!leg && (free ? !useFreeSpin() : !adjustBalance(-bet))) return
    const next = [0, 1, 2].map(() => [spinReel(), spinReel(), spinReel()])
    setStrips(windows.map((w, i) => [...w, ...Array.from({ length: FILLER + i * 6 }, () => SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]), ...next[i]]))
    setSpinId(id => id + 1)
    setSpinning(true); setWin(undefined); setLegResult(undefined); sfx.rattle(STOP_MS[2] / 1000)
    const line = next.map(w => w[1])
    const r = slotPays(line)
    const wager = leg ? 0 : free ? FREE_SPIN_VALUE : bet
    setLastStake(wager)
    const settle = () => {
      pending.current = undefined
      if (leg) leg.onRound({ slots: { mult: r.mult } })
      else {
        adjustBalance(wager * r.mult)
        if (!free) logRound('slots', wager, wager * r.mult, r.name)
      }
    }
    pending.current = settle
    timer.current = setTimeout(() => {
      settle()
      setWindows(next); setStrips(undefined); setSpinning(false); setWin(r)
      if (leg) return setLegResult(legText(gradeCasino(leg.pick, { slots: { mult: r.mult } })))
      setLastWin(wager * r.mult)
      if (r.mult > 1) setParty({ amount: wager * r.mult, title: r.mult >= 50 ? 'MEGA WIN!' : r.mult >= 10 ? 'BIG WIN!' : 'WINNER!', sub: `${free ? 'Free spin · ' : ''}${r.name} · ${r.mult}x` })
    }, STOP_MS[2] + 250)
  }

  return (
    <section className="casino">
      <div className="slot-cabinet">
        <div className="slot-marquee">★ LUCKY SEVENS ★</div>
        <div className="slot-window">
          {[0, 1, 2].map(i => {
            const strip = strips?.[i] ?? windows[i]
            return (
              <div key={i} className="reel">
                <div
                  key={`${spinId}-${i}`}
                  className={`strip ${strips ? 'spinning' : ''}`}
                  style={strips ? { ['--rows' as string]: strip.length - 3, animationDuration: `${STOP_MS[i]}ms` } : undefined}
                >
                  {strip.map((s, j) => <div key={j} className={`sym ${s === '7' ? 'seven' : ''}`}>{s}</div>)}
                </div>
              </div>
            )
          })}
          <div className={`payline ${win && win.mult ? 'hit' : ''}`} />
        </div>
        <div className="slot-status">
          {legResult ?? (win
            ? (win.mult ? <b className="win">{win.name} · {win.mult}x{leg ? '' : ` · ${money(lastStake * win.mult)}`}</b> : 'No win')
            : spinning ? 'Good luck…' : 'Match symbols on the center line')}
        </div>
      </div>

      <div className="controls">
        {leg && <div className="leg-goal"><span className="chip">PARLAY LEG</span> <b>{leg.label}</b> <span className="muted small">· free spin, no wager</span></div>}
        {!leg && <ChipRack value={bet} onPick={setBet} max={balance} />}
        <div className="btnrow">
          {leg && legResult
            ? <LegDoneButtons leg={leg} />
            : <>
              {!leg && inv.spins > 0 && <button className="ghost free-spin" onClick={() => spin(true)} disabled={spinning}>🎰 Free spin <b>×{inv.spins}</b></button>}
              <button className="cta spin-btn" onClick={() => spin()} disabled={spinning || (!leg && bet > balance)}>{spinning ? 'Spinning…' : leg ? 'Spin free' : `Spin ${money(bet)}`}</button>
            </>}
        </div>
        {!leg && <StatBar bet={bet} win={lastWin} />}
      </div>

      {!leg && (
        <div className="extras">
        <details className="paytable" open>
          <summary>Paytable</summary>
          <div className="slot-pays">{PAYS.map(([s, m]) => <div key={s}><span>{s}</span><b>{m}</b></div>)}</div>
        </details>
        <CasinoLegs game="slots" title="Next slot spin" note="Any paying line counts as a win." />
        </div>
      )}
      {party && <WinCelebration {...party} onDone={() => setParty(undefined)} />}
    </section>
  )
}
