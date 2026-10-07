import { useEffect, useRef, useState } from 'react'
import { POKER_PAYTABLE, gradeCasino, money, newShoe, pokerHand, type Card } from './logic.ts'
import { adjustBalance, logRound, useStore } from './store.ts'
import { CasinoLegs, ChipRack, StatBar, WinCelebration, LegDoneButtons, legText, type LegPlay } from './Casino.tsx'
import { CardView } from './Cards.tsx'

type Phase = 'bet' | 'hold' | 'done'
const DECK = { x: 0, y: -200 }

/** Jacks or Better, 9/6 pay table. With `leg`, plays one free hand to settle that parlay leg. */
export default function VideoPoker({ leg }: { leg?: LegPlay }) {
  const { balance } = useStore()
  const deck = useRef<Card[]>([])
  const [bet, setBet] = useState(5)
  const [wager, setWager] = useState(0)
  const [hand, setHand] = useState<Card[]>([])
  const [keys, setKeys] = useState<string[]>([]) // new key = card animates in again
  const [held, setHeld] = useState<boolean[]>([false, false, false, false, false])
  const [phase, setPhase] = useState<Phase>('bet')
  const [result, setResult] = useState<{ name: string; pays: number }>()
  const [lastWin, setLastWin] = useState(0)
  const [party, setParty] = useState<{ amount: number; title: string; sub: string }>()
  const deals = useRef(0)

  const latest = useRef({ phase, hand, wager })
  latest.current = { phase, hand, wager }
  // Leaving after the deal scores the hand as dealt, so the wager is never stranded.
  useEffect(() => () => {
    const l = latest.current
    if (l.phase !== 'hold') return
    const r = pokerHand(l.hand)
    if (leg) leg.onRound({ poker: { pays: r.pays } })
    else { adjustBalance(l.wager * r.pays); logRound('poker', l.wager, l.wager * r.pays, `${r.name} (left before draw)`) }
  }, [])

  const deal = () => {
    if (!leg && !adjustBalance(-bet)) return
    deck.current = newShoe(1)
    const h = Array.from({ length: 5 }, () => deck.current.pop()!)
    deals.current++
    setHand(h); setKeys(h.map((_, i) => `${deals.current}-${i}`)); setHeld([false, false, false, false, false])
    setWager(leg ? 0 : bet); setResult(undefined); setPhase('hold')
  }

  const draw = () => {
    const h = hand.map((c, i) => (held[i] ? c : deck.current.pop()!))
    const r = pokerHand(h)
    setHand(h)
    setKeys(keys.map((k, i) => (held[i] ? k : `${k}-d`)))
    setPhase('done')
    if (!leg) {
      adjustBalance(wager * r.pays)
      logRound('poker', wager, wager * r.pays, r.name)
    }
    setTimeout(() => {
      if (leg) leg.onRound({ poker: { pays: r.pays } })
      setResult(r)
      if (!leg) {
        setLastWin(wager * r.pays)
        if (r.pays > 1) setParty({ amount: wager * r.pays, title: r.pays >= 25 ? 'JACKPOT!' : r.name.toUpperCase() + '!', sub: `Pays ${r.pays} for 1` })
      }
    }, 900)
  }

  const current = phase !== 'bet' && hand.length === 5 ? pokerHand(hand) : undefined

  return (
    <section className="casino">
      <div className="vp-cabinet">
        <div className="vp-paytable">
          {POKER_PAYTABLE.map(([name, pays]) => (
            <div key={name} className={result?.name === name ? 'hit' : current?.name === name && phase === 'hold' ? 'live' : ''}>
              <span>{name}</span><b>{pays * (leg ? 1 : bet)}</b>
            </div>
          ))}
        </div>
        <div className="vp-hand">
          {hand.length === 0 && <div className="vp-empty">JACKS OR BETTER</div>}
          {hand.map((c, i) => (
            <div key={keys[i]} className={`vp-slot ${held[i] ? 'held' : ''}`}>
              <CardView c={c} i={i} from={DECK} delay={keys[i]?.endsWith("-d") ? 0.1 + i * 0.08 : i * 0.12}
                onClick={phase === "hold" ? () => setHeld(hs => hs.map((h, j) => (j === i ? !h : h))) : undefined} />
              <span className="held-tag">{held[i] ? 'HELD' : phase === 'hold' ? 'tap to hold' : ''}</span>
            </div>
          ))}
        </div>
        <div className="vp-status">
          {result ? (result.pays ? <b className="win">{result.name} · {leg ? legText(gradeCasino(leg.pick, { poker: { pays: result.pays } })) : `WIN ${money(wager * result.pays)}`}</b> : <span>{leg ? legText(gradeCasino(leg.pick, { poker: { pays: 0 } })) : 'No win'}</span>)
            : phase === 'hold' ? <span>Tap cards to hold, then draw</span> : <span>&nbsp;</span>}
        </div>
      </div>

      <div className="controls">
        {leg && <div className="leg-goal"><span className="chip">PARLAY LEG</span> <b>{leg.label}</b> <span className="muted small">· free hand, no wager</span></div>}
        {!leg && phase !== 'hold' && <ChipRack value={bet} onPick={setBet} max={balance} />}
        <div className="btnrow">
          {phase === 'hold'
            ? <button className="cta" onClick={draw}>Draw</button>
            : leg && phase === 'done'
              ? <LegDoneButtons leg={leg} disabled={!result} />
              : <button className="cta" onClick={deal} disabled={(phase === 'done' && !result) || (!leg && bet > balance)}>{leg ? 'Deal free hand' : `Deal ${money(bet)}`}</button>}
        </div>
        {!leg && <StatBar bet={phase === 'bet' ? bet : wager} win={lastWin} />}
      </div>

      {!leg && <div className="extras"><CasinoLegs game="poker" title="Next video poker hand" note="Your final hand after the draw counts." /></div>}
      {party && <WinCelebration {...party} onDone={() => setParty(undefined)} />}
    </section>
  )
}
