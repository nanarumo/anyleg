// Swipe Bet: a short-form feed of bets. Up/down browses, right takes it (adds to parlay, places a
// straight bet, or opens a casino table), left passes.
import { leave } from './motion.ts'
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from 'react'
import {
  PROP_STATS, parlayDecimal, fmtOdds, money, toAmerican, toDecimal, type CasinoGame, type Market,
} from './logic.ts'
import { LEAGUES, type Game } from './odds.ts'
import { LIVE_DELAY_S } from './live.ts'
import { DAILY_BOOST, recordOf, noteTaste, cancelBet, getState, placeDailyBoost, placeSingle, removeLeg, today, toggleLeg, updateSettings, useStore, type Leg, type SwipePrefs } from './store.ts'
import { LegIcon } from './LegIcon.tsx'
import { legFromPrice, useProps } from './Sportsbook.tsx'
import { PROP_LEAGUES, propLegs, type Prop } from './props.ts'
import { Art, SPORT_ICON, sportOf } from './LeagueArt.tsx'
import { CASINO_PICKS, GAME_NAMES, ROUND_NAME, casinoLeg } from './Casino.tsx'
import { GameIcon } from './LegIcon.tsx'
import { TileArt } from './TileArt.tsx'
import { readCreatorSlips, type CreatorSlip } from './share.ts'
import { botLegs } from './Squad.tsx'

type Card =
  | { key: string; kind: 'sport'; leg: Leg; g: Game; p?: Prop } // p = a player prop card
  | { key: string; kind: 'casinoLeg'; leg: Leg; game: CasinoGame }
  | { key: string; kind: 'table'; game: CasinoGame }
  | { key: string; kind: 'creator'; slip: CreatorSlip }

// ---- Creator slips: parlays people posted (on this device) plus house creators, tailed with a right swipe ----
// House creators are bots: labeled as such, with no made-up win/loss record.
const CREATORS = [
  { by: 'Sharp Sam', avatar: '🦈', color: '#0ea5e9' },
  { by: 'Parlay Pete', avatar: '🎯', color: '#f97316' },
  { by: 'Casino Queen', avatar: '👑', color: '#d946ef' },
]
function creatorCards(games: Game[], round: number): Card[] {
  const posted = readCreatorSlips().map(c => ({ ...c, record: c.accountId ? recordOf(c.accountId) : c.record }))
  const house = CREATORS.map((c, i) => ({ ...c, id: `house${i}`, at: Date.now(), legs: botLegs(games, 2 + i) })).filter(c => c.legs.length > 1)
  return shuffle([...posted.slice(0, 6), ...house]).map(slip => ({ key: `${round}:creator:${slip.id}`, kind: 'creator' as const, slip }))
}

const GAMES: CasinoGame[] = ['blackjack', 'roulette', 'baccarat', 'poker', 'slots', 'crash', 'mines', 'plinko']
const PICKS = CASINO_PICKS

// ---- Daily Boost: one hand-picked mixed parlay a day (two moneylines + a casino leg), same for everyone that day ----
const BOOST_KEY = 'anyleg-daily-boost'
function dailyBoostLegs(games: Game[]): Leg[] {
  try { const saved = JSON.parse(localStorage.getItem(BOOST_KEY) ?? 'null'); if (saved?.day === today()) return saved.legs } catch {}
  let seed = [...today()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)]
  const ml = games.filter(g => g.state === 'pre').sort((a, b) => a.id.localeCompare(b.id))
    .flatMap(g => g.prices.filter(p => p.market === 'ml' && p.side !== 'draw' && p.odds >= -300 && p.odds <= 200).map(p => legFromPrice(g, p)))
  const legs: Leg[] = []
  while (legs.length < 2 && ml.length) {
    const l = pick(ml)
    if (!legs.some(x => x.sport!.eventId === l.sport!.eventId)) legs.push(l)
    ml.splice(ml.indexOf(l), 1)
  }
  const casino = (Object.keys(PICKS) as CasinoGame[]).flatMap(game => PICKS[game].filter(p => p.odds >= -200 && p.odds <= 300).map(p => ({ game, p })))
  while (legs.length < 3) {
    const { game, p } = pick(casino)
    if (!legs.some(l => l.id === `casino:${game}:${p.pick}`)) legs.push(casinoLeg(game, p.pick)!)
  }
  if (games.length) try { localStorage.setItem(BOOST_KEY, JSON.stringify({ day: today(), legs })) } catch {}
  return legs
}

function DailyBoost({ games, balance }: { games: Game[]; balance: number }) {
  const { boostDay } = useStore()
  const [open, setOpen] = useState(false)
  const [stake, setStake] = useState(25)
  const [msg, setMsg] = useState<string>()
  const legs = useMemo(() => (games.length ? dailyBoostLegs(games) : []), [games.length > 0])
  if (legs.length < 3) return null
  const dec = legs.reduce((m, l) => m * toDecimal(l.odds), 1)
  const boosted = 1 + (dec - 1) * (1 + DAILY_BOOST)
  const done = boostDay === today()
  return <>
    <button className={`sw-daily ${done ? 'done' : ''}`} onClick={() => setOpen(true)}>
      <span>🔥 Daily Boost</span>
      {done ? <span className="muted small">✓ Locked in · new one tomorrow</span>
        : <span><s>{fmtOdds(toAmerican(dec))}</s> <b>{fmtOdds(toAmerican(boosted))}</b> ›</span>}
    </button>
    {open && (
      <div className="sheet-back" onClick={e => leave(e, () => setOpen(false))}>
        <div className="sheet sw-options" onClick={e => e.stopPropagation()}>
          <div className="sheet-head"><b>🔥 Daily Boost · {Math.round(DAILY_BOOST * 100)}% profit boost</b><button className="icon-btn" onClick={e => leave(e, () => setOpen(false))}>×</button></div>
          <p className="muted small">Today's hand-picked mixed parlay. One per day; the casino leg plays free from My Bets.</p>
          <div className="legs chain">
            {legs.map(l => <div key={l.id} className="leg"><LegIcon leg={l} /><div><b>{l.label}</b><div className="muted small">{l.sub}</div></div><b>{fmtOdds(l.odds)}</b></div>)}
          </div>
          <div className="daily-odds"><s>{fmtOdds(toAmerican(dec))}</s> → <b>{fmtOdds(toAmerican(boosted))}</b></div>
          {done ? <p className="muted">You're in for today. Track it in My Bets.</p> : <>
            <div className="quick">{[10, 25, 50, 100].map(v => <button key={v} className={stake === v ? 'on' : ''} disabled={v > balance} onClick={() => setStake(v)}>${v}</button>)}</div>
            {msg && <p className="warn small">{msg}</p>}
            <button className="cta" onClick={async () => { const err = await placeDailyBoost(legs, stake); setMsg(err); if (!err) setTimeout(() => setOpen(false), 900) }}>
              Bet {money(stake)} to win {money(stake * (boosted - 1))}
            </button>
          </>}
        </div>
      </div>
    )}
  </>
}

const shuffle = <T,>(a: T[]) => {
  const b = [...a]
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]] }
  return b
}

/** A fresh random deck from what's on the board right now plus casino options. */
function buildDeck(games: Game[], prefs: SwipePrefs, round: number, props: Prop[] = []): Card[] {
  const sports: Card[] = prefs.casinoOnly ? [] : games
    .filter(g => g.state === 'pre' && prefs.leagues.includes(g.league))
    .flatMap(g => g.prices.filter(p => prefs.markets.includes(p.market)).map(p => ({ key: `${round}:${p.id}`, kind: 'sport' as const, leg: legFromPrice(g, p), g })))
  // Player props: one random side per player line, mixed in at roughly a third of the deck.
  const propCards: Card[] = prefs.casinoOnly || prefs.props === false ? [] : shuffle(props)
    .slice(0, Math.max(8, Math.ceil(sports.length / 2)))
    // one random pick per player line: over, under, or a ladder rung
    .map(p => { const all = propLegs(p), leg = all[Math.floor(Math.random() * all.length)]; return { key: `${round}:${leg.id}`, kind: 'sport' as const, leg, g: p.game, p } })
  sports.push(...propCards)
  let casino: Card[] = []
  const gamesOn = GAMES.filter(g => !prefs.games || prefs.games.includes(g))
  if (prefs.casino || prefs.casinoOnly) {
    casino = prefs.mode === 'parlay'
      ? gamesOn.flatMap(game => PICKS[game].map(p => ({
        key: `${round}:casino:${game}:${p.pick}`, kind: 'casinoLeg' as const, game,
        leg: casinoLeg(game, p.pick)!,
      })))
      : gamesOn.map(game => ({ key: `${round}:table:${game}`, kind: 'table' as const, game }))
    // Keep casino as a sprinkle (about 1 in 4) when there are plenty of sports picks.
    if (sports.length) casino = shuffle(casino).slice(0, Math.max(3, Math.ceil(sports.length / 3)))
  }
  // Smarter Swipe: cards that match what you usually take come up more often (weighted shuffle).
  const taste = getState().taste ?? {}
  const deck = [...sports, ...casino].map(c => ({ c, k: Math.random() ** (1 / affinity(c, taste)) })).sort((a, b) => b.k - a.k).map(x => x.c)
  // A creator slip about every fifth card.
  creatorCards(games, round).forEach((c, i) => deck.splice(Math.min(deck.length, 2 + i * 5), 0, c))
  return deck
}

/** Tags a card is learned by: its league and market, or its casino game. */
const tasteKeys = (c: Card): string[] => (c.kind === 'creator' ? ['creator'] : c.kind === 'sport' ? [`league:${c.g.league}`, `market:${c.leg.sport!.market}`] : ['casino', `game:${c.game}`])
/** How much you like a card: 1 = neutral, up to 5 for your favorites, down to 0.4 for things you always pass. */
const affinity = (c: Card, taste: Record<string, number>) => Math.min(5, Math.max(0.4, Math.exp(0.12 * tasteKeys(c).reduce((t, k) => t + (taste[k] ?? 0), 0))))

export default function Swipe({ games, onPlayGame, openSlip }: { games: Game[]; onPlayGame: (g: CasinoGame) => void; openSlip: () => void }) {
  const { settings, slip, balance } = useStore()
  const prefs = settings.swipe
  const [deck, setDeck] = useState<Card[]>([])
  const [idx, setIdx] = useState(0)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [toast, setToast] = useState<{ text: string; bad?: boolean }>()
  const rounds = useRef(0)
  // What each swipe did, newest last, so Undo can reverse it and bring the card back.
  type Done = { idx: number; kind: 'pass' } | { idx: number; kind: 'tail'; legIds: string[]; label: string } | { idx: number; kind: 'add'; legId: string; label: string } | { idx: number; kind: 'bet'; betId: string; label: string }
  const [history, setHistory] = useState<Done[]>([])

  // Current odds by leg id, so a card always shows the live price even though the deck was built earlier.
  const live = useMemo(() => new Map(games.flatMap(g => g.prices.map(p => [p.id, p.odds] as const))), [games])
  const haveGames = games.length > 0
  // Props for the next few NFL games (each game is a couple of requests, so not the whole slate).
  const propGames = useMemo(() => games.filter(g => PROP_LEAGUES.includes(g.league) && g.state === 'pre' && prefs.leagues.includes(g.league)).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 6), [games, prefs.leagues.join()])
  const propsBy = useProps(propGames, !prefs.casinoOnly && prefs.props !== false)
  const props = useMemo(() => [...propsBy.values()].flat(), [propsBy])
  const prefsKey = JSON.stringify(prefs)
  useEffect(() => {
    if (!haveGames && prefs.leagues.length && !prefs.casinoOnly) return
    rounds.current++
    setDeck(buildDeck(games, prefs, rounds.current, props)); setIdx(0)
  }, [haveGames, prefsKey, props.length > 0])

  // Endless feed: top up with another shuffled deck before running out.
  useEffect(() => {
    if (deck.length && idx >= deck.length - 3) {
      rounds.current++
      setDeck(d => [...d, ...buildDeck(games, prefs, rounds.current, props)]) // props too, or they'd only show in the first deck
    }
  }, [idx, deck.length])

  const card = deck[idx]
  const flash = (text: string, bad = false) => { setToast({ text, bad }); setTimeout(() => setToast(t => (t?.text === text ? undefined : t)), 2200) }

  /** Right swipe. Returns false if the action failed (card stays). */
  const take = (c: Card): boolean => {
    if (c.kind === 'table') { onPlayGame(c.game); return true }
    if (c.kind === 'creator') {
      // Never trust a posted slip's prices: rebuild each leg from the board, the prop feed or the house tables.
      const fresh = c.slip.legs.flatMap((l): Leg[] => {
        if (l.casino) { const x = casinoLeg(l.casino.game, l.casino.pick); return x ? [x] : [] }
        if (l.sport?.prop) { const x = props.flatMap(propLegs).find(x => x.id === l.id); return x ? [x] : [] }
        const g = games.find(x => x.id === l.sport?.eventId && x.state === 'pre')
        const p = g?.prices.find(x => x.id === l.id)
        return g && p ? [legFromPrice(g, p)] : []
      })
      if (!fresh.length) { flash('Those lines are off the board now', true); return true }
      const added = fresh.filter(l => !getState().slip.some(x => x.id === l.id))
      added.forEach(toggleLeg)
      setHistory(h => [...h, { idx, kind: 'tail', legIds: added.map(l => l.id), label: c.slip.by }])
      flash(`Tailed ${c.slip.by}: ${added.length} leg${added.length === 1 ? '' : 's'} added${fresh.length < c.slip.legs.length ? ' (some lines closed)' : ''}`)
      return true
    }
    const odds = c.kind === 'sport' ? live.get(c.leg.id) ?? (c.p ? c.leg.odds : undefined) : c.leg.odds
    if (odds === undefined) { flash('That line just came off the board', true); return true }
    const leg = { ...c.leg, odds }
    if (getState().squadPicking !== undefined) { toggleLeg(leg); return true } // picking a squad leg: it goes to the squad, never a bet
    if (prefs.mode === 'parlay') {
      if (getState().slip.some(l => l.id === leg.id)) { flash('Already in your parlay'); return true }
      toggleLeg(leg)
      setHistory(h => [...h, { idx, kind: 'add', legId: leg.id, label: leg.label }])
      const n = getState().slip.length
      flash(`Added ${leg.label} · ${n}-leg ${n > 1 ? 'parlay' : 'slip'}`)
      return true
    }
    const placed = (err?: string) => {
      if (err) return flash(err, true)
      const bet = getState().bets[0]
      setHistory(h => [...h, { idx, kind: 'bet', betId: bet.id, label: leg.label }])
      flash(`Bet placed: ${money(prefs.stake)} on ${leg.label} ${fmtOdds(bet.legs[0].odds)}`)
    }
    if (leg.id.includes(':live:')) flash(`⏱ Live bet: holding ${LIVE_DELAY_S} seconds to match the ESPN feed…`)
    const err = placeSingle(leg, prefs.stake)
    if (err instanceof Promise) { err.then(placed); return true } // server: the card moves on, a refusal shows as a toast
    if (err) { flash(err, true); return false }
    placed()
    return true
  }

  // ---- gestures ----
  // Drag position lives in a ref and is written straight to the card's style each animation frame,
  // so following the finger never waits on a React re-render (that was the jitter).
  const drag = useRef({ dx: 0, dy: 0 })
  const cardEl = useRef<HTMLDivElement>(null)
  const stampR = useRef<HTMLDivElement>(null)
  const stampL = useRef<HTMLDivElement>(null)
  const frame = useRef(0)
  const paint = () => {
    frame.current = 0
    const { dx, dy } = drag.current
    const el = cardEl.current
    if (!el) return
    el.style.transform = dx || dy ? `translate3d(${dx}px, ${dy}px, 0) rotate(${dx / 18}deg)` : ''
    el.classList.toggle('dragging', !!(dx || dy))
    if (stampR.current) stampR.current.style.opacity = String(Math.max(0, Math.min(1, dx / 90)))
    if (stampL.current) stampL.current.style.opacity = String(Math.max(0, Math.min(1, -dx / 90)))
  }
  const setDrag = (d: { dx: number; dy: number }) => {
    drag.current = d
    if (!frame.current) frame.current = requestAnimationFrame(paint)
  }
  const [exit, setExit] = useState<'left' | 'right' | 'up' | 'down'>()
  const [enter, setEnter] = useState<'up' | 'down'>('up')
  const start = useRef<{ x: number; y: number; axis?: 'x' | 'y' }>(undefined)

  /** Reverse the last swipe: take the leg back out of the slip (or cancel the straight bet) and show that card again. */
  const undo = () => {
    const last = history[history.length - 1]
    if (!last || exit) return
    if (last.kind === 'add') {
      removeLeg(last.legId)
      flash(`Removed ${last.label} from your slip`)
    }
    if (last.kind === 'tail') {
      last.legIds.forEach(removeLeg)
      flash(`Untailed ${last.label}`)
    }
    if (last.kind === 'bet') {
      Promise.resolve(cancelBet(last.betId)).then(ok => ok ? flash(`Bet on ${last.label} cancelled and refunded`)
        : flash('That bet already started settling and can’t be undone', true))
    }
    setHistory(h => h.slice(0, -1))
    setEnter('down')
    setIdx(last.idx)
  }

  const go = (dir: 'left' | 'right' | 'up' | 'down') => {
    if (!card || exit) return
    if (dir === 'down' && idx === 0) return
    if (dir === 'right' && !take(card)) { setDrag({ dx: 0, dy: 0 }); return }
    cancelAnimationFrame(frame.current); frame.current = 0
    cardEl.current?.classList.remove('dragging') // exit animation starts from wherever the finger left the card
    if (dir === 'left') setHistory(h => [...h, { idx, kind: 'pass' }])
    if (dir === 'left' || dir === 'right') noteTaste(tasteKeys(card), dir === 'right' ? 1 : -0.4)
    setExit(dir)
    setTimeout(() => {
      setEnter(dir === 'down' ? 'down' : 'up')
      setIdx(i => (dir === 'down' ? i - 1 : i + 1))
      setExit(undefined); drag.current = { dx: 0, dy: 0 }
    }, 260)
  }

  const onDown = (e: RPointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    start.current = { x: e.clientX, y: e.clientY }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onMove = (e: RPointerEvent) => {
    const s = start.current
    if (!s) return
    const dx = e.clientX - s.x, dy = e.clientY - s.y
    if (!s.axis && Math.hypot(dx, dy) > 8) s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    setDrag(s.axis === 'x' ? { dx, dy: 0 } : s.axis === 'y' ? { dx: 0, dy } : { dx: 0, dy: 0 })
  }
  const onUp = () => {
    const s = start.current
    start.current = undefined
    if (!s) return
    const { dx, dy } = drag.current
    if (dx > 90) go('right')
    else if (dx < -90) go('left')
    else if (dy < -70) go('up')
    else if (dy > 70 && idx > 0) go('down')
    else setDrag({ dx: 0, dy: 0 })
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (optionsOpen || (e.target as HTMLElement).closest('input, select, textarea')) return
      const dir = ({ ArrowRight: 'right', ArrowLeft: 'left', ArrowUp: 'down', ArrowDown: 'up' } as const)[e.key as 'ArrowRight']
      if (dir) { e.preventDefault(); go(dir) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })
  const wheelLock = useRef(0)
  const onWheel = (e: RWheelEvent) => {
    if (Math.abs(e.deltaY) < 25 || Date.now() < wheelLock.current) return
    wheelLock.current = Date.now() + 500
    go(e.deltaY > 0 ? 'up' : 'down')
  }

  const rightWord = !card ? '' : card.kind === 'table' ? 'PLAY' : card.kind === 'creator' ? 'TAIL' : prefs.mode === 'parlay' ? 'ADD' : 'BET'
  const slipDec = parlayDecimal(slip).dec

  return (
    <section className="swipe">
      <div className="sw-head">
        <div>
          <div className="sw-title">Swipe Bet</div>
          <div className="muted small">{prefs.mode === 'parlay' ? 'Parlay mode · swipe right to add a leg' : `Straight mode · swipe right bets ${money(prefs.stake)}`}</div>
        </div>
        <div className="sw-head-btns">
          <button className={`sw-slip ${slip.length ? 'has' : ''}`} onClick={openSlip} aria-label={`Bet slip, ${slip.length} legs`}>
            🎟️{slip.length > 0 && <b>{slip.length}</b>}
          </button>
          <button className={`sw-mode ${prefs.mode}`} onClick={() => updateSettings({ swipe: { ...prefs, mode: prefs.mode === 'parlay' ? 'straight' : 'parlay' } })}>
            {prefs.mode === 'parlay' ? '🔗 Parlay' : '🎯 Straight'}
          </button>
          <button className="sw-opt" onClick={() => setOptionsOpen(true)} aria-label="Swipe options">⚙️ Options</button>
        </div>
      </div>

      <DailyBoost games={games} balance={balance} />

      <div className="sw-stage" onWheel={onWheel}>
        {!card && <div className="sw-empty">{haveGames || !prefs.leagues.length || prefs.casinoOnly ? 'No bets match your options. Turn on more sports or casino in Options.' : 'Loading live lines…'}</div>}
        {card && (
          <div
            key={card.key}
            ref={cardEl}
            className={`sw-card ${exit ? `exit-${exit}` : `enter-${enter}`}`}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          >
            <CardFace card={card} odds={card.kind === 'sport' ? live.get(card.leg.id) ?? (card.p ? card.leg.odds : undefined) : card.kind === 'casinoLeg' ? card.leg.odds : undefined} prefs={prefs} inSlip={(card.kind === 'sport' || card.kind === 'casinoLeg') && slip.some(l => l.id === card.leg.id)} forYou={affinity(card, getState().taste ?? {}) >= 1.5} />
            <div className="stamp right" ref={stampR} style={{ opacity: 0 }}>{rightWord}</div>
            <div className="stamp left" ref={stampL} style={{ opacity: 0 }}>PASS</div>
          </div>
        )}
        {toast && <div className={`sw-toast ${toast.bad ? 'bad' : ''}`}>{toast.text}</div>}
      </div>

      <div className="sw-actions">
        <button className="sw-btn pass" onClick={() => go('left')} aria-label="Pass">✕</button>
        <button className="sw-undo" onClick={undo} disabled={!history.length} aria-label="Undo last swipe">
          <span>↶</span> Undo
        </button>
        <button className="sw-btn take" onClick={() => go('right')} aria-label={rightWord}>{card?.kind === 'table' ? '▶' : prefs.mode === 'parlay' ? '+' : '✓'}</button>
      </div>

      {prefs.mode === 'parlay' && slip.length > 0 && (
        <button className="sw-parlay" onClick={openSlip}>
          <span>{slip.length}-Leg {slip.length > 1 ? 'Parlay' : 'Slip'}</span>
          <b>{fmtOdds(toAmerican(slipDec))}</b>
          <span className="sw-parlay-go">Review & place ›</span>
        </button>
      )}

      {optionsOpen && <Options prefs={prefs} balance={balance} onClose={() => setOptionsOpen(false)} />}
    </section>
  )
}

function CardFace({ card, odds, prefs, inSlip, forYou }: { card: Card; odds?: number; prefs: SwipePrefs; inSlip: boolean; forYou: boolean }) {
  const tag = forYou && <span className="sw-chip for-you">✨ For you</span>
  const payout = odds !== undefined ? prefs.stake * toDecimal(odds) : 0
  if (card.kind === 'sport') {
    const { g, leg } = card
    const sport = sportOf(g.league)
    const league = LEAGUES.find(l => l.key === g.league)!.name
    const when = new Date(g.start).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    return (
      <div className={`sw-face sport s-${sport}`}>
        <svg className="sw-art" viewBox="0 0 600 170" preserveAspectRatio="xMidYMid slice" aria-hidden><Art sport={sport} /></svg>
        <div className="sw-shade" />
        <div className="sw-top"><span className="sw-chip">{SPORT_ICON[sport]} {league}</span>{tag}<span className="sw-chip ghost">{when}</span></div>
        <div className="sw-main center">
          {card.p ? (
            <div className="sw-player">
              <div className="sw-player-face">
                <span className="sw-team-fallback">{card.p.who.team}</span>
                {card.p.who.logo && <img className="sw-player-team" src={card.p.who.logo} alt="" draggable={false} />}
              </div>
              <b className="sw-player-name">{card.p.who.name}</b>
              <span className="sw-team-name">{card.p.who.pos} · {g.away.abbr} @ {g.home.abbr}</span>
            </div>
          ) : (
          /* Matchup: the side you'd be backing is lit up; totals and draws light both teams. */
          <div className="sw-matchup">
            {(['away', 'home'] as const).map((side, i) => {
              const t = g[side]
              const picked = leg.sport!.side === side || !['home', 'away'].includes(leg.sport!.side)
              return (
                <div key={side} className="sw-team-wrap">
                  {i === 1 && <span className="sw-at">@</span>}
                  <div className={`sw-team ${picked ? 'picked' : 'other'}`}>
                    {t.logo ? <img src={t.logo} alt="" draggable={false} /> : <span className="sw-team-fallback">{t.abbr}</span>}
                    <span className="sw-team-name">{t.name}</span>
                  </div>
                </div>
              )
            })}
          </div>
          )}
          <span className="sw-market">{card.p ? PROP_STATS[card.p.stat].name : leg.sub.split(' · ')[1]}</span>
          <div className="sw-label">{card.p ? (leg.id.includes(':alt:') ? `${leg.sport!.line! + 0.5}+` : `${leg.sport!.side === 'over' ? 'Over' : 'Under'} ${card.p.line}`) : leg.label}</div>
          <div className="sw-odds">{odds !== undefined ? fmtOdds(odds) : 'Off board'}</div>
          {prefs.mode === 'straight' && odds !== undefined && <div className="sw-pay">{money(prefs.stake)} pays {money(payout)}</div>}
          {inSlip && <div className="sw-in">✓ In your parlay</div>}
        </div>
      </div>
    )
  }
  if (card.kind === 'creator') {
    const { slip: c } = card
    const rec = c.record && c.record.w + c.record.l ? `${c.record.w}–${c.record.l} · ${Math.round((100 * c.record.w) / (c.record.w + c.record.l))}% cashed` : c.id.startsWith('house') ? '🤖 House bot · random picks' : 'New creator'
    return (
      <div className="sw-face creator">
        <div className="sw-top"><span className="sw-chip">📣 Creator slip</span>{tag}<span className="sw-chip ghost">{c.legs.length}-leg parlay</span></div>
        <div className="cr-body">
          <div className="cr-head">
            <div className="cr-ava" style={{ background: c.color ?? 'var(--brand-grad)' }}>{c.avatar}</div>
            <div><b>{c.by}</b><span className="cr-rec">{rec}</span></div>
          </div>
          <div className="cr-legs">{c.legs.map(l => <div key={l.id} className="cr-leg"><LegIcon leg={l} /><span>{l.label}<small className="muted">{l.sub}</small></span><b>{fmtOdds(l.odds)}</b></div>)}</div>
          <div className="cr-foot"><span className="cr-odds">{fmtOdds(toAmerican(parlayDecimal(c.legs).dec))}</span><span className="muted small">Swipe right to tail</span></div>
        </div>
      </div>
    )
  }
  const game = card.game
  return (
    <div className={`sw-face casino c-${game}`}>
      <div className="sw-art-wrap"><TileArt game={game} /></div>
      <div className="sw-shade" />
      <div className="sw-top"><span className="sw-chip">🎰 Casino</span>{tag}<span className="sw-chip ghost">{GAME_NAMES[game]}</span></div>
      <div className="sw-main center">
        <div className="sw-game-ico"><GameIcon game={game} /></div>
        {card.kind === 'table' ? <>
          <div className="sw-label">Play a {ROUND_NAME[game]} of {GAME_NAMES[game]}</div>
          <div className="sw-sub">Swipe right to sit down at the table</div>
        </> : <>
          <div className="sw-label">{card.leg.label}</div>
          <div className="sw-sub">Parlay leg · you play the next {ROUND_NAME[game]} free from My Bets</div>
          <div className="sw-odds">{fmtOdds(card.leg.odds)}</div>
          {inSlip && <div className="sw-in">✓ In your parlay</div>}
        </>}
      </div>
    </div>
  )
}

function Options({ prefs, balance, onClose }: { prefs: SwipePrefs; balance: number; onClose: () => void }) {
  const set = (p: Partial<SwipePrefs>) => updateSettings({ swipe: { ...prefs, ...p } })
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v])
  const MARKETS: [Market, string][] = [['ml', 'Moneyline'], ['spread', 'Spread'], ['total', 'Totals']]
  return (
    <div className="sheet-back" onClick={e => leave(e, onClose)}>
      <div className="sheet sw-options" onClick={e => e.stopPropagation()}>
        <div className="sheet-head"><b>Swipe options</b><button className="icon-btn" onClick={e => leave(e, onClose)}>×</button></div>

        <div className="field"><span>Bet type</span>
          <div className="seg">
            <button className={prefs.mode === 'parlay' ? 'on' : ''} onClick={() => set({ mode: 'parlay' })}>🔗 Parlay</button>
            <button className={prefs.mode === 'straight' ? 'on' : ''} onClick={() => set({ mode: 'straight' })}>🎯 Straight</button>
          </div>
          <span className="muted small">{prefs.mode === 'parlay' ? 'Swipe right adds the pick to your parlay slip.' : 'Swipe right places a bet right away. Casino cards take you to the table.'}</span>
        </div>

        {prefs.mode === 'straight' && (
          <div className="field"><span>Wager per swipe</span>
            <div className="quick">{[5, 10, 25, 50, 100].map(v => <button key={v} className={prefs.stake === v ? 'on' : ''} onClick={() => set({ stake: v })} disabled={v > balance}>${v}</button>)}</div>
          </div>
        )}

        <div className="field"><span>Show</span>
          <div className="seg">
            <button className={!prefs.casinoOnly && prefs.casino ? 'on' : ''} onClick={() => set({ casinoOnly: false, casino: true })}>Sports + Casino</button>
            <button className={!prefs.casinoOnly && !prefs.casino ? 'on' : ''} onClick={() => set({ casinoOnly: false, casino: false })}>Sports</button>
            <button className={prefs.casinoOnly ? 'on' : ''} onClick={() => set({ casinoOnly: true })}>🎰 Casino</button>
          </div>
          {(prefs.casinoOnly || prefs.casino) && <span className="muted small">{prefs.mode === 'parlay' ? 'Casino cards are legs for the games picked below.' : 'Casino cards take you to a table.'}</span>}
        </div>

        {(prefs.casinoOnly || prefs.casino) && (
          <div className="field"><span>Casino games</span>
            <div className="chips-pick">
              {GAMES.map(g => {
                const on = !prefs.games || prefs.games.includes(g)
                const current = prefs.games ?? GAMES
                // Keep at least one game on, or there would be no casino cards at all.
                return <button key={g} className={on ? 'on' : ''} onClick={() => set({ games: on ? (current.length > 1 ? current.filter(x => x !== g) : current) : [...current, g] })}>{GAME_NAMES[g]}</button>
              })}
            </div>
          </div>
        )}

        {!prefs.casinoOnly && <>
        <div className="field"><span>Sports</span>
          <div className="chips-pick">
            {LEAGUES.map(l => (
              <button key={l.key} className={prefs.leagues.includes(l.key) ? 'on' : ''} onClick={() => set({ leagues: toggle(prefs.leagues, l.key) })}>
                {SPORT_ICON[sportOf(l.key)]} {l.name}
              </button>
            ))}
          </div>
        </div>

        <div className="field"><span>Markets</span>
          <div className="chips-pick">
            {MARKETS.map(([m, name]) => <button key={m} className={prefs.markets.includes(m) ? 'on' : ''} onClick={() => set({ markets: toggle(prefs.markets, m) })}>{name}</button>)}
            <button className={prefs.props !== false ? 'on' : ''} onClick={() => set({ props: prefs.props === false })}>Player props</button>
          </div>
        </div>
        </>}


        <p className="muted small">Player props are real sportsbook lines (NFL, NBA, NHL) for the next few games, priced at a standard -115; ladders are priced from the main line.</p>
        <button className="cta" onClick={e => leave(e, onClose)}>Done</button>
      </div>
    </div>
  )
}
