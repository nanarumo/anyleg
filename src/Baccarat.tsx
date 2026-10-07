import { useEffect, useRef, useState } from 'react'
import { bacReturn, bacValue, gradeCasino, money, newShoe, playBaccarat, type Card } from './logic.ts'
import { adjustBalance, logRound, useStore } from './store.ts'
import { CasinoLegs, Chip, ChipRack, StatBar, WinCelebration, LegDoneButtons, legText, type LegPlay } from './Casino.tsx'
import { CardView } from './Cards.tsx'

type Spot = 'ppair' | 'player' | 'tie' | 'banker' | 'bpair'
type Coup = ReturnType<typeof playBaccarat>
const SPOTS: { k: Spot; label: string; pays: string }[] = [
  { k: 'ppair', label: 'P PAIR', pays: '11:1' },
  { k: 'player', label: 'PLAYER', pays: '1:1' },
  { k: 'tie', label: 'TIE', pays: '8:1' },
  { k: 'banker', label: 'BANKER', pays: '0.95:1' },
  { k: 'bpair', label: 'B PAIR', pays: '11:1' },
]
const NO_BETS: Record<Spot, number> = { ppair: 0, player: 0, tie: 0, banker: 0, bpair: 0 }
const sum = (b: Record<Spot, number>) => Object.values(b).reduce((a, x) => a + x, 0)
// Deal order P, B, P, B, then third cards. Delay (s) for each card position.
const DELAYS = { player: [0, 0.7, 1.7], banker: [0.35, 1.05, 2.4] }
const SHOE = { x: 0, y: -260 }

/** Punto banco. With `leg`, deals one free coup to settle that parlay leg. */
export default function Baccarat({ leg }: { leg?: LegPlay }) {
  const { balance } = useStore()
  const shoe = useRef<Card[]>(newShoe(8))
  const [chip, setChip] = useState(25)
  const [bets, setBets] = useState(NO_BETS)
  const [lastBets, setLastBets] = useState(NO_BETS)
  const [coup, setCoup] = useState<Coup>()
  const [revealed, setRevealed] = useState(false)
  const [road, setRoad] = useState<Coup['winner'][]>([])
  const [lastWin, setLastWin] = useState(0)
  const [party, setParty] = useState<{ amount: number; title: string; sub: string }>()
  const [legResult, setLegResult] = useState<{ text: string; r: string }>()
  const timer = useRef<number>(undefined)

  // Leaving mid-coup still pays out: the result exists as soon as the cards are drawn.
  const pending = useRef<() => void>(undefined)
  useEffect(() => () => { clearTimeout(timer.current); pending.current?.() }, [])

  const deal = (b = bets) => {
    if (coup && !revealed) return
    if (!leg && (!sum(b) || !adjustBalance(-sum(b)))) return
    if (shoe.current.length < 60) shoe.current = newShoe(8)
    const c = playBaccarat(shoe.current)
    setCoup(c); setRevealed(false); setLastBets(b); setLegResult(undefined)
    const returned = (Object.keys(b) as Spot[]).reduce((t, k) => t + bacReturn(k, b[k], c), 0)
    const settle = () => {
      pending.current = undefined
      if (leg) {
        leg.onRound({ baccarat: { winner: c.winner } })
        const r = gradeCasino(leg.pick, { baccarat: { winner: c.winner } })
        setLegResult({ text: legText(r), r })
      } else {
        adjustBalance(returned)
        logRound('baccarat', sum(b), returned, `${c.winner === 'tie' ? 'Tie' : c.winner === 'player' ? 'Player' : 'Banker'} ${bacValue(c.player)}–${bacValue(c.banker)}`)
      }
    }
    pending.current = settle
    const last = Math.max(DELAYS.player[c.player.length - 1], DELAYS.banker[c.banker.length - 1])
    timer.current = setTimeout(() => {
      settle()
      setRevealed(true)
      setRoad(r => [...r, c.winner].slice(-48))
      if (!leg) {
        setLastWin(returned)
        if (returned > sum(b)) setParty({ amount: returned, title: c.winner === 'tie' ? 'TIE PAYS 8:1!' : 'WINNER!', sub: `${c.winner === 'tie' ? 'Tie' : c.winner === 'player' ? 'Player' : 'Banker'} ${bacValue(c.player)} – ${bacValue(c.banker)}` })
      }
    }, (last + 0.9) * 1000)
  }

  const add = (k: Spot) => {
    if (coup && !revealed) return
    if (revealed) { setCoup(undefined); setRevealed(false) }
    setBets(b => (sum(b) + chip > balance ? b : { ...b, [k]: b[k] + chip }))
  }

  const busy = !!coup && !revealed
  const hand = (side: 'player' | 'banker') => (
    <div className={`bac-hand ${side} ${revealed && coup?.winner === side ? 'winner' : ''}`}>
      <div className="bac-title">{side.toUpperCase()} {coup && revealed && <b className="total">{bacValue(coup[side])}</b>}</div>
      <div className="cards">
        {coup?.[side].map((c, i) => (
          <CardView key={i} c={c} i={i} from={{ x: side === 'player' ? 120 : -120, y: SHOE.y }} delay={DELAYS[side][i]} sideways={i === 2} />
        ))}
      </div>
    </div>
  )

  return (
    <section className="casino">
      <div className="bac-felt">
        <div className="shoe" aria-hidden />
        <div className="bac-hands">{hand('player')}{hand('banker')}</div>
        {revealed && coup && <div className={`banner inline bac-result ${coup.winner}`}>{coup.winner === 'tie' ? 'TIE' : `${coup.winner.toUpperCase()} WINS`} {bacValue(coup.player)} – {bacValue(coup.banker)}</div>}
        {/* Inline under the coup result, so the two never stack on top of each other. */}
        {legResult && <div className={`banner inline ${legResult.r}`}>{legResult.text}</div>}
        {leg ? (
          <div className="leg-goal"><span className="chip">PARLAY LEG</span> <b>{leg.label}</b> <span className="muted small">· free coup, no wager</span></div>
        ) : (
          <div className="bac-spots">
            {SPOTS.map(s => (
              <button key={s.k} className={`bac-spot ${s.k} ${revealed && coup && bacReturn(s.k, 1, coup) > 1 ? 'hit' : ''}`} onClick={() => add(s.k)} disabled={busy}>
                <span className="bs-label">{s.label}</span><span className="bs-pays">{s.pays}</span>
                {bets[s.k] > 0 && <span className="onboard"><Chip value={bets[s.k]} size={34} /></span>}
              </button>
            ))}
          </div>
        )}
        {/* A free parlay-leg coup is one hand, so it gets no bead road. */}
        {!leg && (
          <div className="road" aria-label="Bead road">
            {road.map((w, i) => <span key={i} className={`bead ${w}`}>{w[0].toUpperCase()}</span>)}
            {!road.length && <span className="muted small">Bead road: results appear here</span>}
          </div>
        )}
      </div>

      <div className="controls">
        {leg ? (
          legResult
            ? <LegDoneButtons leg={leg} />
            : <button className="cta wide-cta" onClick={() => deal(NO_BETS)} disabled={busy}>{busy ? 'Dealing…' : 'Deal free coup'}</button>
        ) : <>
          <ChipRack value={chip} onPick={setChip} max={balance} />
          <div className="btnrow">
            <button className="ghost" onClick={() => setBets(NO_BETS)} disabled={busy || !sum(bets)}>Clear</button>
            <button className="ghost" onClick={() => { setBets(lastBets) }} disabled={busy || !sum(lastBets) || sum(lastBets) > balance}>Rebet</button>
            <button className="cta" onClick={() => deal()} disabled={busy || !sum(bets) || sum(bets) > balance}>{busy ? 'Dealing…' : `Deal ${money(sum(bets))}`}</button>
          </div>
        </>}
        {!leg && <StatBar bet={sum(bets)} win={lastWin} />}
      </div>

      {!leg && <div className="extras"><CasinoLegs game="baccarat" title="Next baccarat coup" note="Player/Banker legs push on a tie." /></div>}
      {party && <WinCelebration {...party} onDone={() => setParty(undefined)} />}
    </section>
  )
}
