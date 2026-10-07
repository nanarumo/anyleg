import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  bjOutcome, buster, canSplit, gradeCasino, handValue, isBlackjack, luckyLadies, money, newShoe, perfectPairs,
  playDealer, twentyOnePlus3, type Card, type Result, type Round,
} from './logic.ts'
import { adjustBalance, logRound, useStore } from './store.ts'
import { CasinoLegs, Chip, ChipRack, StatBar, WinCelebration, LegDoneButtons, legText, type LegPlay } from './Casino.tsx'
import { CardView } from './Cards.tsx'

type Phase = 'bet' | 'insurance' | 'play' | 'done'
type Spot = 'main' | 'pp' | 't3' | 'll' | 'bust'
type Bets = Record<Spot, number>
type SideHit = { name: string; pays: number; returned: number }
type Hand = { cards: Card[]; wager: number; done: boolean; result?: Result }
const DEALER_STEP = 0.55 // seconds between dealer draws
const NO_BETS: Bets = { main: 0, pp: 0, t3: 0, ll: 0, bust: 0 }
const sum = (b: Bets) => b.main + b.pp + b.t3 + b.ll + b.bust
const SHOE = { x: 300, y: -260 } // where cards fly in from, relative to their resting spot

// Stable id per dealt card so we can tell which ones have finished landing.
const ids = new WeakMap<Card, number>()
let nextId = 0
const idOf = (c: Card) => ids.get(c) ?? (ids.set(c, ++nextId), nextId)

/** With `leg`, the table plays one free hand to settle that parlay leg. */
export default function Blackjack({ leg }: { leg?: LegPlay }) {
  const { balance } = useStore()
  const shoe = useRef<Card[]>(newShoe())
  const [chip, setChip] = useState(25)
  const [bets, setBets] = useState<Bets>(NO_BETS) // chips on the felt
  const [lastBets, setLastBets] = useState<Bets>(NO_BETS)
  const [hands, setHands] = useState<Hand[]>([])
  const [active, setActive] = useState(0)
  const [insurance, setInsurance] = useState(0)
  const [side, setSide] = useState<Partial<Record<Spot, SideHit>>>({})
  const sideReturned = useRef(0)
  const roundStake = useRef(0) // everything put on the felt this hand, for the profile log
  const [dealer, setDealer] = useState<Card[]>([])
  const [landed, setLanded] = useState<Set<number>>(new Set())
  const [phase, setPhase] = useState<Phase>('bet')
  const [banner, setBanner] = useState<{ result: Result; text: string }>()
  const [party, setParty] = useState<{ amount: number; title: string; sub?: string }>()
  const [lastWin, setLastWin] = useState(0)
  const timer = useRef<number>(undefined)
  const legDue = useRef<() => void>(undefined) // a decided leg result waiting for the reveal; leaving settles it anyway

  const draw = () => {
    if (shoe.current.length < 52) shoe.current = newShoe() // reshuffle when the shoe runs low
    return shoe.current.pop()!
  }
  const land = (c: Card) => setLanded(s => (s.has(idOf(c)) ? s : new Set(s).add(idOf(c))))
  const landedValue = (cards: Card[]) => {
    const seen = cards.filter(c => landed.has(idOf(c)))
    return seen.length ? handValue(seen) : undefined
  }

  const finish = (hs: Hand[], d: Card[], b: Bets = bets) => {
    const before = d.length
    const split = hs.length > 1
    const live = hs.some(h => handValue(h.cards) <= 21) && !(!split && isBlackjack(hs[0].cards))
    // Dealer plays out when any hand is still live, or when a Buster bet needs the dealer's final hand.
    // A "Get blackjack" leg is decided by the first two cards, so the dealer has nothing to play for.
    if (leg?.pick !== 'bj' && (live || (b.bust > 0 && !isBlackjack(d)))) playDealer(d, shoe.current)
    const outcomes = hs.map(h => bjOutcome(h.cards, d, h.wager, split))
    const returned = outcomes.reduce((t, o) => t + o.returned, 0)
    const first = outcomes[0].result
    const round: Round = { blackjack: { result: first, playerBJ: !split && isBlackjack(hs[0].cards), dealerBust: handValue(d) > 21 } }
    let bustHit: SideHit | undefined
    if (b.bust) {
      const r = buster(d)
      if (r.pays) bustHit = { ...r, returned: b.bust * (r.pays + 1) }
    }
    sideReturned.current += bustHit?.returned ?? 0
    if (!leg) {
      adjustBalance(returned + (bustHit?.returned ?? 0))
      logRound('blackjack', roundStake.current, returned + sideReturned.current, split ? 'Split hands' : resultText(first, hs[0].cards))
    }
    setDealer([...d])
    setPhase('done')
    const staked = hs.reduce((t, h) => t + h.wager, 0)
    const paid = returned + sideReturned.current
    if (leg) legDue.current = () => { legDue.current = undefined; leg.onRound(round) }
    // Show results once the dealer's extra cards have landed.
    timer.current = setTimeout(() => {
      setHands(hs.map((h, i) => ({ ...h, result: outcomes[i].result })))
      if (bustHit) setSide(s => ({ ...s, bust: bustHit }))
      if (leg) {
        legDue.current?.() // settle the leg when the result is on screen, not before the dealer finishes
        const r = gradeCasino(leg.pick, round)
        return setBanner({ result: r, text: legText(r) })
      }
      const overall: Result = returned > staked ? 'won' : returned === staked ? 'push' : 'lost'
      setBanner({ result: overall, text: split ? (overall === 'won' ? 'WIN' : overall === 'push' ? 'EVEN' : 'DEALER WINS') : resultText(first, hs[0].cards) })
      setLastWin(paid)
      if (returned > staked || sideReturned.current > 0) {
        const bj = !split && isBlackjack(hs[0].cards)
        setParty({ amount: paid, title: bj ? 'BLACKJACK!' : returned > staked ? 'YOU WIN!' : 'SIDE BET WINS!', sub: celebrationSub(outcomes.map(o => o.result), hs, d) })
      }
    }, ((d.length - before) * DEALER_STEP + 0.9) * 1000)
  }

  /** Mark the active hand finished and move on; when no hands are left, the dealer plays. */
  const advance = (hs: Hand[], from: number) => {
    const next = hs.findIndex((h, i) => i > from && !h.done)
    setHands(hs)
    if (next >= 0) {
      setActive(next)
      if (handValue(hs[next].cards) >= 21) advance(hs.map((h, i) => (i === next ? { ...h, done: true } : h)), next)
    } else finish(hs, [...dealer])
  }

  // Leaving the table mid-hand stands every open hand, so a wager is never lost to navigation.
  const latest = useRef({ phase, hands, dealer, finish })
  latest.current = { phase, hands, dealer, finish }
  useEffect(() => () => {
    clearTimeout(timer.current)
    const l = latest.current
    if (l.phase === 'play' || l.phase === 'insurance') l.finish(l.hands.map(h => ({ ...h, done: true })), [...l.dealer])
    legDue.current?.()
  }, [])

  const deal = (b: Bets = bets) => {
    if (!leg && (!b.main || !adjustBalance(-sum(b)))) return
    roundStake.current = leg ? 0 : sum(b)
    clearTimeout(timer.current)
    const p = [draw(), draw()]
    const d = [draw(), draw()]
    // Side bets on the first cards settle immediately (Buster waits for the dealer).
    const hit = (res: { name: string; pays: number } | undefined, amt: number): SideHit | undefined =>
      res && res.pays ? { ...res, returned: amt * (res.pays + 1) } : undefined
    const s: Partial<Record<Spot, SideHit>> = {
      pp: b.pp ? hit(perfectPairs(p), b.pp) : undefined,
      t3: b.t3 ? hit(twentyOnePlus3([...p, d[0]]), b.t3) : undefined,
      ll: b.ll ? hit(luckyLadies(p, isBlackjack(d)), b.ll) : undefined,
    }
    sideReturned.current = (s.pp?.returned ?? 0) + (s.t3?.returned ?? 0) + (s.ll?.returned ?? 0)
    if (sideReturned.current && !leg) adjustBalance(sideReturned.current)
    const hs: Hand[] = [{ cards: p, wager: b.main, done: false }]
    setSide(s); setInsurance(0); setLanded(new Set())
    setBanner(undefined); setLastBets(b); setBets(b)
    setHands(hs); setActive(0); setDealer(d)
    if (!leg && d[0].rank === 'A' && !isBlackjack(p)) return setPhase('insurance')
    setPhase('play')
    // No blackjack on the deal settles a "Get blackjack" leg, so end the hand instead of making them play it out.
    if (isBlackjack(p) || isBlackjack(d) || leg?.pick === 'bj') finish(hs, d, b)
  }

  const decideInsurance = (take: boolean) => {
    const ins = take ? Math.floor(hands[0].wager / 2) : 0
    if (ins && !adjustBalance(-ins)) return
    roundStake.current += ins
    setInsurance(ins)
    setPhase('play')
    if (isBlackjack(dealer)) {
      if (ins) { adjustBalance(ins * 3); sideReturned.current += ins * 3 } // insurance pays 2 to 1
      finish(hands, [...dealer])
    }
  }

  const hit = () => {
    const h = hands[active]
    const cards = [...h.cards, draw()]
    const bust = handValue(cards) >= 21
    const hs = hands.map((x, i) => (i === active ? { ...x, cards, done: bust } : x))
    if (bust) advance(hs, active)
    else setHands(hs)
  }

  const stand = () => advance(hands.map((x, i) => (i === active ? { ...x, done: true } : x)), active)

  const double = () => {
    const h = hands[active]
    if (!leg && !adjustBalance(-h.wager)) return
    if (!leg) roundStake.current += h.wager
    advance(hands.map((x, i) => (i === active ? { cards: [...x.cards, draw()], wager: x.wager * 2, done: true } : x)), active)
  }

  const split = () => {
    const h = hands[active]
    if (!leg && !adjustBalance(-h.wager)) return
    if (!leg) roundStake.current += h.wager
    const [a, b] = h.cards
    const aces = a.rank === 'A'
    // Split aces get one card each and stand, like a real table.
    const hs: Hand[] = [
      { cards: [a, draw()], wager: h.wager, done: aces },
      { cards: [b, draw()], wager: h.wager, done: aces },
    ]
    setLanded(s => { const n = new Set(s); n.delete(idOf(b)); return n }) // second card slides over to its new hand
    if (aces) return advance(hs, 1)
    setActive(0)
    if (handValue(hs[0].cards) === 21) advance(hs.map((x, i) => (i === 0 ? { ...x, done: true } : x)), 0)
    else setHands(hs)
  }

  // Change bet starts from an empty table: every spot back to $0.
  const newHand = () => { setPhase('bet'); setHands([]); setDealer([]); setBanner(undefined); setSide({}); setInsurance(0); setBets(NO_BETS) }
  const addChip = (spot: Spot) => {
    if (phase !== 'bet') return
    setBets(b => (sum(b) + chip > balance ? b : { ...b, [spot]: b[spot] + chip }))
  }

  const holeHidden = phase === 'play' || phase === 'insurance'
  const dealerShown = holeHidden ? dealer.slice(0, 1) : dealer
  const dealerTotal = landedValue(dealerShown)
  const handWager = hands.reduce((t, h) => t + h.wager, 0)
  const shownBets: Bets = phase === 'bet' ? bets : { ...bets, main: hands[0]?.wager ?? 0 }
  const cur = hands[active]
  const spot = (k: Spot, label: string, sub: string, art: ReactNode) => (
    <SideSpot k={k} label={label} sub={sub} art={art} amount={shownBets[k]} hit={side[k]} live={phase === 'bet'} onClick={() => addChip(k)} />
  )

  return (
    <section className="casino">
      <div className="bj-felt">
        <div className="shoe" aria-hidden />
        <div className="discard" aria-hidden />
        <div className="tray" aria-hidden>{[100, 25, 5, 1, 500, 25, 5, 1].map((v, i) => <span key={i} className={`roll c${v}`} />)}</div>

        <div className="zone dealer-zone">
          <div className="cards">
            {dealer.map((c, i) => (
              <CardView key={idOf(c)} c={c} i={i} from={SHOE} faceDown={holeHidden && i === 1} onLanded={() => land(c)}
                delay={i < 2 ? i * 0.35 + 0.18 : (i - 2) * DEALER_STEP + 0.35} />
            ))}
          </div>
          {dealerTotal !== undefined && <span className="total">{dealerTotal}</span>}
        </div>

        <FeltPrint />

        <div className={`player-hands ${hands.length > 1 ? 'split' : ''}`}>
          {hands.map((h, hi) => {
            const v = landedValue(h.cards)
            const isActive = phase === 'play' && hands.length > 1 && hi === active
            return (
              <div key={hi} className={`zone hand-zone ${isActive ? 'active' : ''} ${h.result ?? ''}`}>
                {v !== undefined && <span className={`total ${v > 21 ? 'bust' : ''}`}>{hands.length === 1 && isBlackjack(h.cards) && landed.has(idOf(h.cards[1])) ? 'BJ' : v}</span>}
                <div className="cards">
                  {h.cards.map((c, i) => (
                    <CardView key={idOf(c)} c={c} i={i} onLanded={() => land(c)}
                      from={hi === 1 && i === 0 ? { x: -110, y: 0 } : { x: SHOE.x, y: SHOE.y - 120 }}
                      delay={phase === 'play' && hands.length === 1 && h.cards.length === 2 && !landed.size ? i * 0.35 : 0} />
                  ))}
                </div>
                {hands.length > 1 && <span className="hand-wager"><Chip value={h.wager} size={26} /> {h.result ? <b className={`hr ${h.result}`}>{h.result.toUpperCase()}</b> : isActive ? 'playing' : ''}</span>}
              </div>
            )
          })}
          {insurance > 0 && <span className="ins-chip"><Chip value={insurance} size={28} /> insured</span>}
        </div>

        {leg ? (
          <div className="spots"><div className="bet-spot leg-spot"><span>PARLAY<br />LEG</span></div></div>
        ) : (
          <div className="spots">
            {spot('pp', 'PERFECT PAIRS', '25 : 1', <ArtPairs />)}
            {spot('t3', '21 + 3', '100 : 1', <ArtThree />)}
            <button className={`bet-spot ${phase === 'bet' ? 'live' : ''}`} onClick={() => addChip('main')}>
              {shownBets.main > 0 ? <Chip value={shownBets.main} size={54} /> : <span>TAP TO<br />BET</span>}
            </button>
            {spot('ll', 'LUCKY LADIES', '1000 : 1', <ArtQueen />)}
            {spot('bust', 'BUSTER', '250 : 1', <ArtBust />)}
          </div>
        )}

        {banner && (banner.result !== 'won' || leg) && <div className={`banner ${banner.result}`}>{banner.text}</div>}
      </div>

      <div className="controls">
        {leg && <div className="leg-goal"><span className="chip">PARLAY LEG</span> <b>{leg.label}</b> <span className="muted small">· free hand, no wager</span></div>}
        {leg && phase === 'bet' && <button className="cta wide-cta" onClick={() => deal(NO_BETS)}>Deal free hand</button>}
        {leg && phase === 'done' && <LegDoneButtons leg={leg} disabled={!banner} />}
        {!leg && phase === 'bet' && <>
          <ChipRack value={chip} onPick={setChip} max={balance} />
          <div className="btnrow">
            <button className="ghost" onClick={() => setBets(NO_BETS)} disabled={!sum(bets)}>Clear</button>
            <button className="ghost" onClick={() => sum(bets) * 2 <= balance && setBets(Object.fromEntries(Object.entries(bets).map(([k, v]) => [k, v * 2])) as Bets)} disabled={!sum(bets)}>2×</button>
            <button className="cta" onClick={() => deal()} disabled={!bets.main || sum(bets) > balance}>{bets.main ? `Deal ${money(sum(bets))}` : 'Bet to deal'}</button>
          </div>
        </>}
        {phase === 'insurance' && (
          <>
            <div className="leg-goal"><b>Dealer shows an Ace.</b> <span className="muted">Insurance?</span></div>
            <div className="btnrow">
              <button className="ghost" onClick={() => decideInsurance(false)}>No thanks</button>
              <button className="cta" onClick={() => decideInsurance(true)} disabled={balance < Math.floor((hands[0]?.wager ?? 0) / 2)}>Insure {money(Math.floor((hands[0]?.wager ?? 0) / 2))}</button>
            </div>
          </>
        )}
        {phase === 'play' && cur && (
          <div className="btnrow round">
            <button className="act split" onClick={split} disabled={hands.length > 1 || !canSplit(cur.cards) || (!leg && balance < cur.wager)}><b>⇆</b>Split</button>
            <button className="act double" onClick={double} disabled={cur.cards.length !== 2 || (!leg && balance < cur.wager)}><b>2×</b>Double</button>
            <button className="act hit" onClick={hit}><b>+</b>Hit</button>
            <button className="act stand" onClick={stand}><b>✋</b>Stand</button>
          </div>
        )}
        {!leg && phase === 'done' && (
          <div className="btnrow">
            <button className="ghost" onClick={newHand} disabled={!banner}>Change bet</button>
            <button className="cta" onClick={() => deal(lastBets)} disabled={!banner || sum(lastBets) > balance}>{banner ? `Rebet ${money(sum(lastBets))}` : 'Dealer playing…'}</button>
          </div>
        )}
        {!leg && <StatBar bet={phase === 'bet' ? sum(bets) : handWager + sum({ ...bets, main: 0 }) + insurance} win={lastWin} />}
      </div>

      <div className="extras">
        {!leg && (
          <details className="paytable" open>
            <summary>Side bet paytable</summary>
            <div className="pay-cols">
              <div><b>Perfect Pairs</b><span>Perfect pair</span><i>25:1</i><span>Colored pair</span><i>12:1</i><span>Mixed pair</span><i>6:1</i></div>
              <div><b>21+3</b><span>Suited trips</span><i>100:1</i><span>Straight flush</span><i>40:1</i><span>Three of a kind</span><i>30:1</i><span>Straight</span><i>10:1</i><span>Flush</span><i>5:1</i></div>
              <div><b>Lucky Ladies</b><span>Q♥ pair + dealer BJ</span><i>1000:1</i><span>Q♥ pair</span><i>200:1</i><span>Matched 20</span><i>25:1</i><span>Suited 20</span><i>10:1</i><span>Any 20</span><i>4:1</i></div>
              <div><b>Buster</b><span>Dealer busts, 8+ cards</span><i>250:1</i><span>7 cards</span><i>100:1</i><span>6 cards</span><i>50:1</i><span>5 cards</span><i>9:1</i><span>4 cards</span><i>2:1</i><span>3 cards</span><i>1:1</i></div>
              <div><b>Insurance</b><span>Dealer has blackjack</span><i>2:1</i></div>
              <div><b>Splitting</b><span>Split any pair once</span><i>✓</i><span>Split aces get one card</span><i>✓</i><span>21 after split pays</span><i>1:1</i></div>
            </div>
          </details>
        )}
        {!leg && <CasinoLegs game="blackjack" title="Next blackjack hand" note="A push voids Win next hand. After a split, your first hand counts." />}
      </div>

      {party && <WinCelebration {...party} onDone={() => setParty(undefined)} />}
    </section>
  )
}

function SideSpot({ k, label, sub, art, amount, hit, live, onClick }: { k: Spot; label: string; sub: string; art: ReactNode; amount: number; hit?: SideHit; live: boolean; onClick: () => void }) {
  return (
    <button className={`side-spot s-${k} ${live ? 'live' : ''} ${hit ? 'won' : ''} ${amount > 0 ? 'has-bet' : ''}`} onClick={onClick}>
      {amount > 0
        ? <><Chip value={amount} size={30} /><span className="side-name">{label}</span></>
        : <span className="side-label"><span className="side-art">{art}</span><span className="side-name">{label}</span><em>{sub}</em></span>}
      {hit && <span className="side-hit">{hit.name} {hit.pays}:1</span>}
    </button>
  )
}

// ---- tiny side bet illustrations ----
const MiniCard = ({ x, r, label, red }: { x: number; r: number; label: string; red?: boolean }) => (
  <g transform={`translate(${x} 4) rotate(${r} 7 20)`}>
    <rect width="14" height="20" rx="2" fill="#fff" stroke="#00000033" />
    <text x="7" y="13" textAnchor="middle" fontSize="8" fontWeight="900" fill={red ? '#c81e1e' : '#111'}>{label}</text>
  </g>
)
const ArtPairs = () => <svg viewBox="0 0 34 28"><MiniCard x={5} r={-12} label="8♠" /><MiniCard x={15} r={10} label="8♠" /></svg>
const ArtThree = () => <svg viewBox="0 0 34 28"><MiniCard x={2} r={-18} label="7" red /><MiniCard x={10} r={0} label="8" red /><MiniCard x={18} r={18} label="9" red /></svg>
const ArtQueen = () => (
  <svg viewBox="0 0 34 28">
    <path d="M7 16 L9 6 L13 12 L17 4 L21 12 L25 6 L27 16 Z" fill="#fbbf24" stroke="#92400e" strokeWidth=".8" />
    <rect x="7" y="16" width="20" height="3" rx="1" fill="#fbbf24" stroke="#92400e" strokeWidth=".8" />
    <path d="M17 27 C10 22 11 19 14 19 C15.5 19 16.5 20 17 21 C17.5 20 18.5 19 20 19 C23 19 24 22 17 27 Z" fill="#e11d48" />
  </svg>
)
const ArtBust = () => (
  <svg viewBox="0 0 34 28">
    <path d="M17 1 L20 9 L28 5 L24 12 L33 14 L24 17 L28 24 L20 20 L17 27 L14 20 L6 24 L10 17 L1 14 L10 12 L6 5 L14 9 Z" fill="#f97316" stroke="#7c2d12" strokeWidth=".8" />
    <text x="17" y="17" textAnchor="middle" fontSize="7" fontWeight="900" fill="#fff">22</text>
  </svg>
)

/** The classic printed layout: insurance band, 3-to-2 arc and the dealer rule, curved along the table edge. */
function FeltPrint() {
  // Gentle "smile" arcs: big circles centred far above the table, `bottom` is where each arc dips lowest.
  const cx = 350, cy = -2000
  const arc = (bottom: number, halfWidth: number) => {
    const r = bottom - cy
    const y = cy + Math.sqrt(r * r - halfWidth * halfWidth)
    return `M${cx - halfWidth},${y} A${r},${r} 0 0 0 ${cx + halfWidth},${y}`
  }
  return (
    <svg className="felt-print" viewBox="0 0 700 130" aria-label="Blackjack pays 3 to 2. Dealer must draw to 16 and stand on all 17s. Insurance pays 2 to 1.">
      <defs>
        <path id="fp-rule" d={arc(30, 300)} />
        <path id="fp-bj" d={arc(68, 320)} />
        <path id="fp-ins" d={arc(106, 330)} />
      </defs>
      <text className="fp-rule"><textPath href="#fp-rule" startOffset="50%" textAnchor="middle">DEALER MUST DRAW TO 16 AND STAND ON ALL 17'S</textPath></text>
      <text className="fp-bj"><textPath href="#fp-bj" startOffset="50%" textAnchor="middle">BLACKJACK PAYS 3 TO 2</textPath></text>
      <path d={arc(85, 330)} className="fp-band" />
      <path d={arc(114, 340)} className="fp-band" />
      <text className="fp-ins"><textPath href="#fp-ins" startOffset="50%" textAnchor="middle">INSURANCE PAYS 2 TO 1</textPath></text>
    </svg>
  )
}

function resultText(r: Result, p: Card[]) {
  if (r === 'push') return 'PUSH'
  if (r === 'lost') return handValue(p) > 21 ? 'BUST' : 'DEALER WINS'
  return isBlackjack(p) ? 'BLACKJACK!' : 'WIN'
}

function celebrationSub(results: Result[], hs: Hand[], d: Card[]) {
  if (hs.length > 1) return `Split hands: ${results.map(r => r.toUpperCase()).join(' · ')}`
  if (results[0] !== 'won') return 'Side bet paid'
  if (isBlackjack(hs[0].cards)) return 'Paid 3 to 2'
  return handValue(d) > 21 ? `Dealer busts with ${handValue(d)}` : `${handValue(hs[0].cards)} beats ${handValue(d)}`
}
