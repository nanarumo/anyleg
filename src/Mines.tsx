import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { MINES_PICKS, MINES_TILES, gradeCasino, minesMult, money, placeMines } from './logic.ts'
import { adjustBalance, logRound, serverHand, useStore } from './store.ts'
import { SERVER } from './server.ts'

type View = { opened: number[]; safe: number; boom: boolean; mines?: number[] }
import { CasinoLegs, ChipRack, StatBar, WinCelebration, LegDoneButtons, legText, type LegPlay } from './Casino.tsx'
import { sfx } from './sound.ts'

const MINE_COUNTS = [1, 3, 5, 10]

/** Mines: a 5×5 grid hides gems and mines. Each gem raises the multiplier; cash out before you hit a mine.
 * With `leg`, a free board with the leg's mine count: clear its target number of gems to hit the leg. */
export default function Mines({ leg }: { leg?: LegPlay }) {
  const { balance } = useStore()
  const legPick = leg && MINES_PICKS.find(p => p.pick === leg.pick)
  const [bet, setBet] = useState(10)
  const [mines, setMines] = useState(legPick?.mines ?? 3)
  const [board, setBoard] = useState<Set<number>>()
  const [open, setOpen] = useState<number[]>([])
  const [phase, setPhase] = useState<'bet' | 'play' | 'boom' | 'cashed'>('bet')
  const [lastWin, setLastWin] = useState(0)
  const [legResult, setLegResult] = useState<{ text: string; r: string }>()
  const [party, setParty] = useState<{ amount: number; title: string; sub: string }>()
  const live = useRef<{ stake: number; safe: number; mines: number; handId?: string }>(undefined)
  const busy = useRef(false)
  const server = SERVER && !leg // the mines stay hidden on the server; each tap asks it
  const [boomAt, setBoomAt] = useState<number>()
  // Explosion: every tile flies away from the mine you hit, nearer ones first. Random spin/distance picked once per blast.
  const blast = useMemo(() => {
    if (boomAt === undefined) return []
    const mc = boomAt % 5, mr = Math.floor(boomAt / 5)
    return Array.from({ length: MINES_TILES }, (_, i) => {
      const dx = (i % 5) - mc, dy = Math.floor(i / 5) - mr, d = Math.hypot(dx, dy) || 0.4
      const push = 140 + Math.random() * 120
      const a = d < 0.5 ? Math.random() * Math.PI * 2 : Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.6
      return { '--dx': `${Math.cos(a) * push}px`, '--dy': `${Math.sin(a) * push - 60}px`, '--rot': `${(Math.random() - 0.5) * 720}deg`, '--delay': `${d * 45}ms` } as CSSProperties
    })
  }, [boomAt])

  // Leaving with gems showing banks them, like pressing Cash out.
  useEffect(() => () => {
    const r = live.current
    if (!r) return
    if (leg) leg.onRound({ mines: { safe: r.safe } }) // stopping early is a miss unless the target was already cleared
    else if (r.handId) serverHand({ action: 'close', handId: r.handId }) // the server banks the gems (or refunds an untouched board)
    else if (r.safe > 0) { const paid = +(r.stake * minesMult(r.mines, r.safe)).toFixed(2); adjustBalance(paid); logRound('mines', r.stake, paid, `Left the table · ${r.safe} gems`) }
    else adjustBalance(r.stake) // no tile picked yet, nothing was risked: refund
  }, [])

  const safe = open.filter(i => !board?.has(i)).length
  const mult = minesMult(mines, safe)
  const nextMult = minesMult(mines, safe + 1)

  const start = async () => {
    let handId: string | undefined
    if (server) {
      if (!bet || busy.current) return
      busy.current = true
      const r = await serverHand<View>({ action: 'start', game: 'mines', wager: bet, mines })
      busy.current = false
      if (typeof r === 'string') return alert(r)
      handId = r.handId
    } else if (!leg && (!bet || !adjustBalance(-bet))) return
    setBoard(server ? new Set() : placeMines(mines)); setOpen([]); setPhase('play'); setLegResult(undefined); setBoomAt(undefined)
    live.current = { stake: leg ? 0 : bet, safe: 0, mines, handId }
  }

  const finishLeg = (gems: number) => {
    if (!leg || !legPick) return
    live.current = undefined
    leg.onRound({ mines: { safe: gems } })
    const g = gradeCasino(leg.pick, { mines: { safe: gems } })
    setLegResult({ text: legText(g), r: g })
  }

  const reveal = async (i: number) => {
    if (phase !== 'play' || !board || open.includes(i)) return
    if (server) {
      const r0 = live.current
      if (!r0?.handId || busy.current) return
      busy.current = true
      const r = await serverHand<View>({ action: 'move', handId: r0.handId, tile: i })
      busy.current = false
      if (typeof r === 'string') return alert(r)
      setOpen(r.view.opened)
      if (r.view.mines) setBoard(new Set(r.view.mines))
      if (r.view.boom) { sfx.crash(); setPhase('boom'); setBoomAt(i); logRound('mines', r0.stake, 0, `Mine after ${safe} gems`); live.current = undefined; return }
      sfx.chip()
      live.current = { ...r0, safe: r.view.safe }
      if (r.done) cashed(r.view.safe, r.returned ?? 0)
      return
    }
    const next = [...open, i]
    setOpen(next)
    if (board.has(i)) {
      sfx.crash()
      setPhase('boom'); setBoomAt(i)
      if (leg) finishLeg(safe)
      else { logRound('mines', live.current!.stake, 0, `Mine after ${safe} gems`); live.current = undefined }
      return
    }
    sfx.chip()
    const gems = safe + 1
    live.current = { ...live.current!, safe: gems }
    if (leg && legPick && gems >= legPick.picks) { setPhase('cashed'); finishLeg(gems) }
    else if (gems === MINES_TILES - mines) cash(gems)
  }

  const cash = async (gems = safe) => {
    const r = live.current
    if (!r || leg || !gems) return
    if (server) {
      if (busy.current) return
      busy.current = true
      const s = await serverHand<View>({ action: 'move', handId: r.handId, cash: true })
      busy.current = false
      if (typeof s === 'string') return alert(s)
      if (s.view.mines) setBoard(new Set(s.view.mines))
      return cashed(gems, s.returned ?? 0)
    }
    adjustBalance(+(r.stake * minesMult(mines, gems)).toFixed(2))
    cashed(gems, +(r.stake * minesMult(mines, gems)).toFixed(2))
  }

  const cashed = (gems: number, paid: number) => {
    const r = live.current!
    live.current = undefined
    const m = minesMult(mines, gems)
    logRound('mines', r.stake, paid, `${gems} gems · ${m}x`)
    setPhase('cashed'); setLastWin(paid); sfx.win()
    if (m >= 5) setParty({ amount: paid, title: 'GEM HUNTER!', sub: `${gems} gems with ${mines} mines · ${m}x` })
  }

  const over = phase === 'boom' || phase === 'cashed'
  return (
    <section className="casino">
      <div className={boomAt !== undefined ? 'mines-felt shake' : 'mines-felt'} key={boomAt}>
        <div className="mines-head">
          <span>💣 {mines} mine{mines === 1 ? '' : 's'}</span>
          <span>💎 {safe} gem{safe === 1 ? '' : 's'}</span>
          <b>{mult.toFixed(2)}x</b>
        </div>
        <div className={boomAt !== undefined ? 'mines-grid blast' : 'mines-grid'}>
          {boomAt !== undefined && <div className="mines-boom" style={{ left: `${(boomAt % 5 + 0.5) * 20}%`, top: `${(Math.floor(boomAt / 5) + 0.5) * 20}%` }}><i /><b>💥</b></div>}
          {Array.from({ length: MINES_TILES }, (_, i) => {
            const shown = open.includes(i) || (over && !!board)
            const isMine = board?.has(i)
            return (
              <button key={i} style={blast[i]} className={`mine-tile ${i === boomAt ? 'hit' : ''} ${shown ? (isMine ? 'mine' : 'gem') : ''} ${open.includes(i) ? 'picked' : ''}`} disabled={phase !== 'play' || open.includes(i)} onClick={() => reveal(i)}>
                {shown ? (isMine ? '💣' : '💎') : ''}
              </button>
            )
          })}
        </div>
        {phase === 'boom' && !leg && <div className="banner inline lost">BOOM · lost {money(bet)}</div>}
        {legResult && <div className={`banner inline ${legResult.r}`}>{legResult.text}</div>}
      </div>

      <div className="controls">
        {leg && <div className="leg-goal"><span className="chip">PARLAY LEG</span> <b>{leg.label}</b> <span className="muted small">· free board, no wager</span></div>}
        {leg ? (
          legResult ? <LegDoneButtons leg={leg} /> : phase === 'play'
            ? <div className="muted">Pick tiles: {safe} of {legPick?.picks} gems found</div>
            : <button className="cta wide-cta" onClick={start}>Start free board</button>
        ) : phase === 'play' ? (
          <div className="btnrow">
            <span className="muted small mines-next">Next gem: {nextMult.toFixed(2)}x</span>
            <button className="cta" onClick={() => cash()} disabled={!safe}>{safe ? `Cash out ${money(bet * mult)}` : 'Pick a tile'}</button>
          </div>
        ) : <>
          <div className="seg">{MINE_COUNTS.map(n => <button key={n} className={mines === n ? 'on' : ''} onClick={() => setMines(n)}>{n} 💣</button>)}</div>
          <ChipRack value={bet} onPick={setBet} max={balance} />
          <button className="cta wide-cta" onClick={start} disabled={bet > balance}>{over ? 'Play again' : 'Start'} {money(bet)}</button>
        </>}
        {!leg && <StatBar bet={bet} win={lastWin} />}
      </div>

      {!leg && <div className="extras"><CasinoLegs game="mines" title="Next mines board" note="You play a free board with that many mines and pick the tiles yourself." /></div>}
      {party && <WinCelebration {...party} onDone={() => setParty(undefined)} />}
    </section>
  )
}
