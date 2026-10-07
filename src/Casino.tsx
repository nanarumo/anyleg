import { sfx } from './sound.ts'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  BAC_PICKS, BJ_PICKS, CRASH_PICKS, MINES_PICKS, PLINKO_PICKS, POKER_PICKS, SLOT_PICKS, fmtOdds, money, pickLabel, roulettePays, toAmerican,
  type CasinoGame, type Result, type Round,
} from './logic.ts'
import { toggleLeg, useStore, type Leg } from './store.ts'
import { leave } from './motion.ts'

/** Set when a table is opened to play a parlay leg: one free round, no wager. */
export type LegPlay = {
  label: string; pick: string; onRound: (r: Round) => void; onClose: () => void
  next?: { label: string; go: () => void } // the ticket's next unplayed casino leg, offered once this one is done
  rebet?: () => void // ticket lost and is all casino legs: load the same legs into the slip
}

/** Shown after a free leg round: jump straight to the ticket's next casino leg, or go back to My Bets. */
export function LegDoneButtons({ leg, disabled }: { leg: LegPlay; disabled?: boolean }) {
  return (
    <div className="btnrow leg-done">
      <button className={leg.next || leg.rebet ? 'ghost' : 'cta'} onClick={e => leave(e, leg.onClose)} disabled={disabled}>Back to My Bets</button>
      {leg.next && <button className="cta" onClick={e => leave(e, leg.next!.go)} disabled={disabled}>Next leg: {leg.next.label} ▶</button>}
      {leg.rebet && <button className="cta" onClick={e => leave(e, leg.rebet!)} disabled={disabled}>↻ Re-bet these legs</button>}
    </div>
  )
}
export const legText = (r: Result) => (r === 'won' ? 'LEG HIT ✓' : r === 'push' ? 'PUSH · LEG VOID' : 'LEG MISSED')

export const GAME_NAMES: Record<CasinoGame, string> = { blackjack: 'Blackjack', roulette: 'Roulette', baccarat: 'Baccarat', poker: 'Video Poker', slots: 'Slots', crash: 'Crash', mines: 'Mines', plinko: 'Plinko' }

// ---- chips ----
export const CHIP_VALUES = [1, 5, 25, 100, 500]

/** Casino chip; picks the color of the largest denomination it covers. */
export function Chip({ value, size = 44, on, onClick }: { value: number; size?: number; on?: boolean; onClick?: () => void }) {
  const v = [...CHIP_VALUES].reverse().find(c => value >= c) ?? 1
  const label = value >= 1000 ? `${+(value / 1000).toFixed(1)}K` : value
  const Tag = onClick ? 'button' : 'div'
  const click = onClick && (() => { sfx.chip(); onClick() })
  return (
    <Tag className={`pchip c${v} ${on ? 'on' : ''}`} style={{ width: size, height: size, fontSize: size * 0.3 }} onClick={click}>
      <span>{label}</span>
    </Tag>
  )
}

export function ChipRack({ value, onPick, max }: { value: number; onPick: (v: number) => void; max: number }) {
  return (
    <div className="rack">
      {CHIP_VALUES.map(v => <Chip key={v} value={v} size={48} on={v === value} onClick={v <= max ? () => onPick(v) : undefined} />)}
    </div>
  )
}

/** Bottom bar shared by the tables, like the DK/FD live-casino footers. */
export function StatBar({ bet, win }: { bet: number; win: number }) {
  const { balance } = useStore()
  return (
    <div className="statbar">
      <div><small>BALANCE</small><b>{money(balance)}</b></div>
      <div><small>TOTAL BET</small><b>{money(bet)}</b></div>
      <div><small>LAST WIN</small><b className={win > 0 ? 'win' : ''}>{money(win)}</b></div>
    </div>
  )
}

// ---- parlay legs ----
type Pick = { pick: string; label: string; odds: number }

const ROULETTE_PICKS = ['red', 'black', 'odd', 'even', 'low', 'high', 'd1', 'd2', 'd3', 'n0'].map(p => ({
  pick: p, label: p === 'n0' ? 'Green 0' : `Next spin ${pickLabel(p)}`, odds: toAmerican(roulettePays(p)),
}))
/** Every casino leg on offer, by game (the lobby quick-add, the tables and Swipe all use this). */
export const CASINO_PICKS: Record<CasinoGame, Pick[]> = {
  blackjack: BJ_PICKS, roulette: ROULETTE_PICKS, baccarat: BAC_PICKS, poker: POKER_PICKS, slots: SLOT_PICKS,
  crash: CRASH_PICKS, mines: MINES_PICKS, plinko: PLINKO_PICKS,
}

export const ROUND_NAME: Record<CasinoGame, string> = { blackjack: 'hand', roulette: 'spin', baccarat: 'coup', poker: 'hand', slots: 'spin', crash: 'round', mines: 'board', plinko: 'ball' }

/** The slip leg for a house pick (or a roulette straight-up number). Every place that adds a casino leg builds it here,
 * so the same leg reads the same everywhere and a shared link can't smuggle in its own label or price. */
export function casinoLeg(game: CasinoGame, pick: string): Leg | undefined {
  const p = CASINO_PICKS[game]?.find(x => x.pick === pick)
    ?? (game === 'roulette' && /^n([1-9]|[12]d|3[0-6])$/.test(pick) ? { pick, label: `#${pick.slice(1)} straight up`, odds: toAmerican(36) } : undefined)
  return p && { id: `casino:${game}:${pick}`, label: p.label, sub: `${GAME_NAMES[game]} · next ${ROUND_NAME[game]}`, odds: p.odds, casino: { game, pick } }
}

/** One button per pick; tap toggles it in the slip. */
function LegButtons({ game, children }: { game: CasinoGame; children?: ReactNode }) {
  const { slip } = useStore()
  return (
    <div className="leg-btns">
      {CASINO_PICKS[game].map(p => (
        <button key={p.pick} className={`odds wide ${slip.some(l => l.id === `casino:${game}:${p.pick}`) ? 'sel' : ''}`} onClick={() => toggleLeg(casinoLeg(game, p.pick)!)}>
          <small>{p.label}</small><span>{fmtOdds(p.odds)}</span>
        </button>
      ))}
      {children}
    </div>
  )
}

/** Casino lobby panel: add any casino leg to your parlay in one tap, without opening a table. */
export function QuickLegs() {
  const { slip } = useStore()
  const [game, setGame] = useState<CasinoGame>('blackjack')
  const inSlip = slip.filter(l => l.casino).length
  return (
    <div className="quick-legs">
      <div className="ql-head">
        <b>🎯 Add a casino leg to your parlay</b>
        {inSlip > 0 && <span className="chip">{inSlip} in slip</span>}
      </div>
      <div className="chips-pick ql-games">
        {(Object.keys(CASINO_PICKS) as CasinoGame[]).map(g => (
          <button key={g} className={g === game ? 'on' : ''} onClick={() => setGame(g)}>
            {GAME_NAMES[g]}{slip.some(l => l.casino?.game === g) ? ' ✓' : ''}
          </button>
        ))}
      </div>
      <LegButtons game={game} />
      <div className="muted small">Casino legs ride inside parlays with any sports pick or other casino legs. Once placed, play each one free from My Bets.</div>
    </div>
  )
}

/** A table's parlay panel: drop its next result into the bet slip so it can be parlayed with anything. */
export function CasinoLegs({ game, title, note, children }: { game: CasinoGame; title: string; note: string; children?: ReactNode }) {
  return (
    <div className="casino-legs">
      <div className="cl-head"><span className="chip">PARLAY</span> <b>{title}</b></div>
      <LegButtons game={game}>{children}</LegButtons>
      <div className="muted small">{note} Once it is in a placed parlay, play it free from My Bets.</div>
    </div>
  )
}

// ---- win celebration ----
const CONFETTI_COLORS = ['#f5c242', '#53d337', '#ef4444', '#3b82f6', '#a855f7', '#fff']

/** Full-screen win takeover: light rays, confetti, falling coins and a counting-up payout. Tap to dismiss. */
export function WinCelebration({ amount, big, title, sub, emblem, onDone }: { amount?: number; big?: string; title: string; sub?: string; emblem?: ReactNode; onDone: () => void }) {
  useEffect(() => { sfx.win() }, [])
  const [shown, setShown] = useState(0)
  const pieces = useMemo(() => Array.from({ length: 70 }, (_, i) => ({
    left: Math.random() * 100, delay: Math.random() * 0.6, dur: 2 + Math.random() * 1.6,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length], spin: Math.random() * 720 - 360, w: 6 + Math.random() * 6, coin: i % 6 === 0,
  })), [])

  useEffect(() => {
    const start = Date.now()
    const tick = setInterval(() => {
      const u = Math.min((Date.now() - start) / 1300, 1)
      setShown((amount ?? 0) * (1 - (1 - u) ** 3))
      if (u === 1) clearInterval(tick)
    }, 30)
    const close = setTimeout(leave, 4200)
    return () => { clearInterval(tick); clearTimeout(close) }
  }, [amount])

  // Tap or timeout plays the exit animation first, then removes the overlay.
  const [leaving, setLeaving] = useState(false)
  const done = useRef(onDone)
  done.current = onDone
  function leave() {
    setLeaving(true)
    setTimeout(() => done.current(), 450)
  }

  return (
    <div className={`celebrate ${leaving ? 'leaving' : ''}`} onClick={() => !leaving && leave()} role="alert">
      <div className="rays" />
      {pieces.map((p, i) => p.coin
        ? <span key={i} className="coin" style={{ left: `${p.left}%`, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s` }}>$</span>
        : <span key={i} className="confetti" style={{ left: `${p.left}%`, background: p.color, width: p.w, height: p.w * 1.6, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, ['--spin' as string]: `${p.spin}deg` }} />)}
      <div className="win-card">
        {emblem && <div className="win-emblem">{emblem}</div>}
        <div className="win-title">{title}</div>
        {amount !== undefined ? <div className="win-amount">+{money(shown)}</div> : big && <div className="win-amount leg-alive">{big}</div>}
        {sub && <div className="win-sub">{sub}</div>}
        <div className="win-tap">{amount !== undefined ? 'tap to collect' : 'tap to continue'}</div>
      </div>
    </div>
  )
}
