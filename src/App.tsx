import { sfx } from './sound.ts'
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { fmtOdds, gradeCasino, money, uid, toAmerican, type CasinoGame, type Result, type Round } from './logic.ts'
import { SquadWatch } from './Squad.tsx'
import { useLiveGames } from './odds.ts'
import { pickForSquad, SESSION_START, unclaimedChallenges, unclaimedLevels, canRebet, getState, isCoolingOff, loadSlip, spinReady, resolveLeg, useAccounts, useStore, type Bet, type Leg } from './store.ts'
import Sportsbook, { legFromPrice } from './Sportsbook.tsx'
import Swipe from './Swipe.tsx'
import Roulette from './Roulette.tsx'
import MyBets from './MyBets.tsx'
import Profile from './Profile.tsx'
import { TileArt } from './TileArt.tsx'
import BetSlip from './BetSlip.tsx'
import { DailySpin } from './Spin.tsx'
import { readTail } from './share.ts'
import { fetchProps, propLegs } from './props.ts'
import { Insignia, LevelBadge } from './Rank.tsx'
import { ChallengeToasts } from './Challenges.tsx'
import { frameStyle } from './Profile.tsx'
import { PRESTIGES, RANKS, rankAt, rankName, rewardLabel } from './progression.ts'
import { GAME_NAMES, QuickLegs, WinCelebration, casinoLeg, type LegPlay } from './Casino.tsx'
import { leave } from './motion.ts'
const DuelScreen = lazy(() => import('./Duel.tsx'))
const Plinko = lazy(() => import('./Plinko.tsx'))
const Mines = lazy(() => import('./Mines.tsx'))
const Crash = lazy(() => import('./Crash.tsx'))
const Slots = lazy(() => import('./Slots.tsx'))
const VideoPoker = lazy(() => import('./VideoPoker.tsx'))
const Baccarat = lazy(() => import('./Baccarat.tsx'))
const Blackjack = lazy(() => import('./Blackjack.tsx'))

const TABS = ['Sportsbook', 'Swipe', 'Casino', 'My Bets'] as const
const ICONS = { Sportsbook: '🏈', Swipe: '👆', Casino: '🎰', 'My Bets': '🎟️' }
type View = (typeof TABS)[number] | 'Profile'
const GAMES: { key: CasinoGame; blurb: string; legs: string; art: string; tag?: string }[] = [
  { key: 'blackjack', blurb: '3:2 · 6-deck shoe · 4 side bets', legs: 'Win, Dealer busts, Blackjack', art: '🃏', tag: 'POPULAR' },
  { key: 'roulette', blurb: 'Single zero · live wheel', legs: 'Red/Black, Dozens, Any number', art: '🎡' },
  { key: 'baccarat', blurb: 'Punto banco · bead road', legs: 'Player, Banker, Tie', art: '🎴', tag: 'NEW' },
  { key: 'poker', blurb: 'Jacks or Better 9/6', legs: 'Jacks or better, Trips+', art: '🂮', tag: 'NEW' },
  { key: 'slots', blurb: 'Classic 3-reel · 150x top win', legs: 'Any win, 10x+ win', art: '🎰' },
  { key: 'crash', blurb: 'Ride the rocket · cash out before it crashes', legs: 'Reaches 2x, 5x, 10x', art: '🚀', tag: 'NEW' },
  { key: 'mines', blurb: '5×5 grid · find gems, dodge mines', legs: 'Clear 3 gems, Clear 5 gems', art: '💣', tag: 'NEW' },
  { key: 'plinko', blurb: '12 rows · up to 170x', legs: '2x+, 4x+ bucket', art: '🔴', tag: 'NEW' },
]

/** Renders a table; with `leg` it plays one free round for that parlay leg. */
function Table({ game, leg }: { game: CasinoGame; leg?: LegPlay }) {
  switch (game) {
    case 'blackjack': return <Blackjack leg={leg} />
    case 'roulette': return <Roulette leg={leg} />
    case 'baccarat': return <Baccarat leg={leg} />
    case 'poker': return <VideoPoker leg={leg} />
    case 'slots': return <Slots leg={leg} />
    case 'crash': return <Crash leg={leg} />
    case 'mines': return <Mines leg={leg} />
    case 'plinko': return <Plinko leg={leg} />
  }
}

/** A casino game takes over the whole screen, with its own bar for the lobby, balance, slip and parlay legs. */
function GameScreen({ game, leg, onExit, watch }: { game: CasinoGame; leg?: LegPlay; onExit?: () => void; watch?: ReactNode }) {
  const { balance, slip } = useStore()
  const [panel, setPanel] = useState<'slip' | 'extras'>()
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])
  const toggle = (p: 'slip' | 'extras') => setPanel(cur => (cur === p ? undefined : p))
  return (
    <div className={`game-screen gs-${game} ${panel ? `show-${panel}` : ''}`}>
      <header className="gs-bar">
        {onExit ? <button className="gs-back" onClick={e => leave(e, onExit)} aria-label="Back to lobby">‹ Lobby</button> : <span className="chip">PARLAY LEG</span>}
        <div className="gs-title">{GAME_NAMES[game]}</div>
        <div className="gs-right">
          <span className="gs-balance">{money(balance)}</span>
          {!leg && <button className={`gs-btn ${panel === 'extras' ? 'on' : ''}`} onClick={() => toggle('extras')}>🎯 <span className="hide-sm">Parlay legs</span><span className="show-sm">+ Leg</span></button>}
          {!leg && <button className={`gs-btn ${panel === 'slip' ? 'on' : ''}`} onClick={() => toggle('slip')}>🎟️ <span className="hide-sm">Slip</span>{slip.length > 0 && <b className="count">{slip.length}</b>}</button>}
        </div>
      </header>
      {watch}
      <div className="gs-body" onClick={e => panel && !(e.target as HTMLElement).closest('.extras') && setPanel(undefined)}>
        <Suspense fallback={<p className="muted">Loading table…</p>}><Table game={game} leg={leg} /></Suspense>
      </div>
      {!leg && <aside className="gs-slip"><BetSlip onClose={() => setPanel(undefined)} /></aside>}
    </div>
  )
}

const AGE_KEY = 'anyleg-age-ok'

/** First-launch notice: free-to-play, play money only, 18+. A neutral birth-year screen (not a "yes I'm 18" button);
 *  an under-18 answer sticks so it can't just be retried. */
function AgeGate({ onOk }: { onOk: () => void }) {
  const [year, setYear] = useState('')
  const [under, setUnder] = useState(() => { try { return localStorage.getItem(AGE_KEY) === 'under' } catch { return false } })
  const thisYear = new Date().getFullYear()
  const go = () => {
    // Born in (thisYear - 18) might not be 18 yet; only clear it when certainly 18+.
    if (thisYear - Number(year) > 18) return onOk()
    try { localStorage.setItem(AGE_KEY, 'under') } catch {}
    setUnder(true)
  }
  if (under) return <div className="modal age-gate"><div className="modal-body"><h2>Sorry</h2><p>Anyleg is only for adults 18 and older.</p></div></div>
  return (
    <div className="modal age-gate">
      <div className="modal-body">
        <h2>Welcome to Anyleg</h2>
        <p><b>Free to play. Play money only.</b> Anyleg is a simulated sportsbook and casino for entertainment. There is no real-money gambling: you can't buy, deposit, withdraw or win real money, prizes or anything of value.</p>
        <label className="field"><span>What year were you born?</span>
          <select value={year} onChange={e => setYear(e.target.value)}>
            <option value="">Select year</option>
            {Array.from({ length: 100 }, (_, i) => thisYear - i).map(y => <option key={y}>{y}</option>)}
          </select>
        </label>
        <button className="cta big" disabled={!year} onClick={go}>Continue</button>
        <p className="muted small">Not affiliated with any league, team, sportsbook or casino. Team and league names belong to their owners.</p>
        <p className="muted small">If you or someone you know has a gambling problem, call <a href="tel:18004264537">1-800-GAMBLER</a>.</p>
      </div>
    </div>
  )
}

export default function App() {
  const [tab, setTabRaw] = useState<View>('Sportsbook')
  const [prevTab, setPrevTab] = useState<View>('Sportsbook')
  const [duelOpen, setDuelOpen] = useState(false)
  const [spinOpen, setSpinOpen] = useState(spinReady) // pops up once a day on open
  const [ageOk, setAgeOk] = useState(() => { try { return localStorage.getItem(AGE_KEY) === '1' } catch { return false } })
  const [toChallenges, setToChallenges] = useState(false) // a tapped challenge toast opens Profile on Challenges
  const setTab = (t: View) => { if (t === 'Profile' && tab !== 'Profile') setPrevTab(tab); setTabRaw(t); window.scrollTo(0, 0) }
  const [game, setGame] = useState<CasinoGame>()
  const [slipOpen, setSlipOpen] = useState(false)
  const [playing, setPlaying] = useState<{ bet: Bet; leg: Leg }>() // casino parlay leg being played for free
  const [legDone, setLegDone] = useState<{ id: string; result: Result }>() // the played leg's result, for squad reactions
  const { balance, slip, bets, settings, xp, frame, levelUp, tableSkin, cardBack, prestige, prestigeUp, squad, squadPicking } = useStore()
  // Squad "Add leg": the next line tapped anywhere becomes that member's leg, then you land back on the squad.
  const [openSquad, setOpenSquad] = useState(false)
  const picking = useRef(squadPicking)
  const backToSquad = () => { setGame(undefined); setDuelOpen(false); setPlaying(undefined); setSlipOpen(false); setOpenSquad(true); setTab('My Bets') }
  useEffect(() => {
    if (picking.current !== undefined && squadPicking === undefined) backToSquad()
    picking.current = squadPicking
  }, [squadPicking])
  const accts = useAccounts()
  const me = accts.list.find(a => a.id === accts.current)
  const live = useLiveGames() // mounted here so odds refresh + settlement run on every tab
  // Opened a friend's shared slip: load their legs and show the slip, ready to tail.
  const [tailFrom, setTailFrom] = useState<string>()
  const tail = useRef(readTail())
  useEffect(() => {
    const t = tail.current
    if (!t || !live.games.length) return
    tail.current = undefined
    // Never trust anything inside a link: rebuild every leg from the live board, prop feed or house tables, drop unknowns.
    Promise.all(t.legs.map(async (l: Leg): Promise<Leg[]> => {
      if (l.casino) { const leg = casinoLeg(l.casino.game, l.casino.pick); return leg ? [leg] : [] }
      const g = live.games.find(x => x.id === l.sport?.eventId)
      if (!g) return []
      if (l.sport?.prop) {
        const leg = (await fetchProps(g)).flatMap(propLegs).find(x => x.id === l.id)
        return leg ? [leg] : []
      }
      const p = g.prices.find(x => x.id === l.id)
      return p ? [legFromPrice(g, p)] : []
    })).then(rs => {
      const legs = rs.flat()
      if (!legs.length) return
      loadSlip(legs)
      setTailFrom(String(t.from || 'A friend').slice(0, 20))
      setSlipOpen(true)
      setTimeout(() => setTailFrom(undefined), 5000)
    })
  }, [live.games])
  const open = bets.filter(b => b.status === 'pending').length

  // Celebrate tickets that turn into winners while the app is open (not ones already won on load).
  const seenWon = useRef<Set<string>>(undefined)
  const seenFor = useRef<string | undefined>(undefined)
  // Pop-ups queue up so a parlay win and the level-up it caused both get their moment.
  type Party = { amount?: number; big?: string; title: string; sub: string; id?: string; emblem?: ReactNode }
  const [queue, setQueue] = useState<Party[]>([])
  const party = queue[0]
  const setParty = (p: Party) => setQueue(q => [...q, { ...p, id: uid() }])

  // Level-up takeover, once per new level-up event (not on load or account switch).
  const seenLevelAt = useRef<number | undefined>(levelUp?.at)
  const levelFor = useRef(accts.current)
  useEffect(() => {
    if (levelFor.current !== accts.current) { levelFor.current = accts.current; seenLevelAt.current = levelUp?.at; return }
    if (!levelUp || levelUp.at === seenLevelAt.current) return
    seenLevelAt.current = levelUp.at
    const rank = rankAt(levelUp.level)
    const ranked = rank.level === levelUp.level
    setTimeout(() => setParty({
      title: ranked ? 'RANK UP!' : 'LEVEL UP!',
      emblem: <div className={`emblem-wrap ${ranked ? 'new-rank' : ''}`}><Insignia rank={rank} prestige={prestige} size={ranked ? 150 : 110} />{ranked && <span className="emblem-tag">NEW RANK</span>}</div>,
      big: `LEVEL ${levelUp.level}${ranked ? ` · ${rankName(rank, prestige).toUpperCase()}` : ''}`,
      sub: levelUp.rewards.length ? `Claim in Rank & Rewards: ${levelUp.rewards.map(rewardLabel).join(', ')}` : rankName(rank, prestige),
    }), 1800) // after any win pop-up for the bet that earned the XP
  }, [levelUp, accts.current])

  // Prestige takeover: the new emblem set, its name and the reward pack.
  const seenPrestigeAt = useRef<number | undefined>(prestigeUp?.at)
  const prestigeFor = useRef(accts.current)
  useEffect(() => {
    if (prestigeFor.current !== accts.current) { prestigeFor.current = accts.current; seenPrestigeAt.current = prestigeUp?.at; return }
    if (!prestigeUp || prestigeUp.at === seenPrestigeAt.current) return
    seenPrestigeAt.current = prestigeUp.at
    const t = PRESTIGES[prestigeUp.prestige]
    setParty({
      title: `PRESTIGE ${prestigeUp.prestige}!`,
      big: `${t.name.toUpperCase()} UNLOCKED`,
      sub: `New emblems & ranks · ${prestigeUp.rewards.map(rewardLabel).join(', ')}`,
      emblem: <div className="emblem-wrap new-rank"><Insignia rank={RANKS[RANKS.length - 1]} prestige={prestigeUp.prestige} size={160} /><span className="emblem-tag">PRESTIGE {prestigeUp.prestige}</span></div>,
    })
  }, [prestigeUp, accts.current])

  // Session reminder from Budget and Controls.
  const [reminder, setReminder] = useState<number>()
  const startBal = useRef(balance) // reality check shows the result since the app opened
  useEffect(() => {
    if (!settings.sessionReminderMin) return
    const every = settings.sessionReminderMin * 60_000
    let shown = Math.floor((Date.now() - SESSION_START) / every)
    const t = setInterval(() => {
      const n = Math.floor((Date.now() - SESSION_START) / every)
      if (n > shown) { shown = n; setReminder(n * settings.sessionReminderMin) }
    }, 15_000)
    return () => clearInterval(t)
  }, [settings.sessionReminderMin])
  const onBreak = isCoolingOff()

  // While playing a free leg, find the same ticket's next unplayed casino leg (only if the ticket is still alive).
  const liveBet = playing && bets.find(b => b.id === playing.bet.id)
  const nextLeg = liveBet?.status === 'pending'
    ? liveBet.legs.find(l => l.casino && l.result === 'pending' && l.id !== playing!.leg.id)
    : undefined
  useEffect(() => {
    const won = bets.filter(b => b.status === 'won' && !b.cashedOut)
    // First load or a different account: remember what is already won instead of celebrating it.
    if (!seenWon.current || seenFor.current !== accts.current) { seenWon.current = new Set(won.map(b => b.id)); seenFor.current = accts.current; return }
    const fresh = won.filter(b => !seenWon.current!.has(b.id))
    fresh.forEach(b => seenWon.current!.add(b.id))
    if (!fresh.length) return
    const b = fresh[0]
    const odds = fmtOdds(toAmerican(b.payout / b.stake))
    setParty({
      amount: fresh.reduce((t, x) => t + x.payout, 0),
      title: b.legs.length > 1 ? 'PARLAY HIT!' : 'BET WON!',
      sub: b.legs.length > 1 ? `${b.legs.length}-leg parlay cashed at ${odds}` : `${b.legs[0].label} ${odds}`,
    })
  }, [bets, accts.current])

  return (
    <div className={`app skin-${tableSkin} back-${cardBack}`}>
      {!ageOk && <AgeGate onOk={() => { try { localStorage.setItem(AGE_KEY, '1') } catch {} setAgeOk(true) }} />}
      {ageOk && spinOpen && !isCoolingOff() && <DailySpin onClose={() => setSpinOpen(false)} />}
      <ChallengeToasts onOpen={() => { setTab('Profile'); setGame(undefined); setPlaying(undefined); setSlipOpen(false); setToChallenges(true) }} />
      <header className="top">
        <div className="brand"><span className="mark">A</span><span>ANY<em>LEG</em></span></div>
        <div className="top-right">
          <span className="balance">{money(balance)}</span>
          <button className={`me-btn ${tab === 'Profile' ? 'on' : ''}`} onClick={() => { setTab('Profile'); setGame(undefined); setToChallenges(false) }} aria-label="Profile and account">
            {me ? <span className="avatar" style={{ background: me.color, ...frameStyle(frame) }}>{me.avatar}<LevelBadge xp={xp} />{unclaimedLevels(getState()).length + unclaimedChallenges(getState()).length > 0 && <span className="claim-dot" title="Rewards to claim" />}</span> : <span className="avatar guest" aria-hidden><svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="4.2" /><path d="M3.5 21c1.2-4.4 4.6-6.6 8.5-6.6s7.3 2.2 8.5 6.6z" /></svg></span>}
          </button>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map(t => (
          <button key={t} className={t === tab ? 'on' : ''} onClick={() => { setTab(t); setGame(undefined); setDuelOpen(false); setOpenSquad(false) /* casino always reopens on the lobby */ }}>
            <span className="ico">{ICONS[t]}</span>{t}{t === 'My Bets' && open ? ` (${open})` : ''}
          </button>
        ))}
      </nav>

      <div className={`layout ${tab === 'Swipe' ? 'solo' : ''}`}>
        <main>
          {onBreak && (tab === 'Sportsbook' || tab === 'Casino' || tab === 'Swipe') && (
            <div className="panel break-panel">
              <h2>You're taking a break</h2>
              <p className="muted">Betting is paused until {new Date(settings.coolOffUntil!).toLocaleString()}. You can still check My Bets and your profile.</p>
            </div>
          )}
          {!onBreak && tab === 'Sportsbook' && <Sportsbook {...live} />}
          {!onBreak && tab === 'Swipe' && <Swipe games={live.games} onPlayGame={g => { setTabRaw('Casino'); setGame(g) }} openSlip={() => setSlipOpen(true)} />}
          {!onBreak && tab === 'Casino' && !game && (
            <section className="lobby">
              <h2>Casino</h2>
              <p className="muted">Every table doubles as a parlay leg. Add its next result to your slip next to any sports pick.</p>
              <QuickLegs />
              <div className="tiles">
                {GAMES.map(g => (
                  <button key={g.key} className={`tile ${g.key}`} onClick={() => setGame(g.key)}>
                    {g.tag && <span className="tile-tag">{g.tag}</span>}
                    <TileArt game={g.key} />
                    <span className="tile-name">{GAME_NAMES[g.key]}</span>
                    <span className="small">{g.blurb}</span>
                    <span className="tile-legs small"><span className="chip">PARLAY</span> {g.legs}</span>
                  </button>
                ))}
                <button className="tile duel" onClick={() => setDuelOpen(true)}>
                  <span className="tile-tag">NEW</span>
                  <span className="tile-duel-art" aria-hidden>⚔️</span>
                  <span className="tile-name">1v1 Blackjack Duel</span>
                  <span className="small">You and a friend play the exact same cards. Luck cancels out, so the better player wins.</span>
                  <span className="tile-legs small"><span className="chip">SKILL</span> Pass-and-play · 10 or 20 hands</span>
                </button>
              </div>
            </section>
          )}
          <Suspense fallback={null}>
            {!onBreak && tab === 'Casino' && duelOpen && <DuelScreen onExit={() => setDuelOpen(false)} />}
          </Suspense>
          {tab === 'Profile' && <Profile key={String(toChallenges)} startPage={toChallenges ? 'challenges' : 'home'} onBack={() => setTab(prevTab)} openMyBets={() => setTab('My Bets')} />}
          {tab === 'My Bets' && <MyBets squadFirst={openSquad} onPickSquadLeg={() => { setOpenSquad(false); setTab('Sportsbook') }} games={live.games} onPlay={(bet, leg) => setPlaying({ bet, leg })} onRebet={() => setSlipOpen(true)} />}
        </main>
        {squadPicking !== undefined && squad && (
          <div className="tail-toast squad-pick-banner">
            <span className="spb-ico">👥</span>
            <span className="spb-text"><b>Pick {squadPicking ? `${squad.members[squadPicking]?.name.split(' ')[0]}'s` : 'your'} squad leg</b><small>Tap any line or casino leg</small></span>
            <button onClick={() => pickForSquad(undefined)}>Cancel</button>
          </div>
        )}
        {tailFrom && <div className="tail-toast">🎟️ Tailing {tailFrom}'s slip. Set your stake and place it.</div>}
        <aside className={`slip ${slipOpen ? 'open' : ''}`}>
          <BetSlip onClose={() => setSlipOpen(false)} />
        </aside>
      </div>

      {!onBreak && tab === 'Casino' && game && !playing && <GameScreen game={game} onExit={() => setGame(undefined)} />}

      {playing && (
        <GameScreen
          key={playing.leg.id + playing.bet.id} // fresh table for each leg
          game={playing.leg.casino!.game}
          watch={playing.bet.squad && squad && (() => {
            const player = playing.leg.by ?? squad.members[0].name
            return <SquadWatch player={playing.leg.by ?? 'you'} watchers={squad.members.filter(m => m.name !== player)} result={legDone?.id === playing.bet.id + playing.leg.id ? legDone.result : undefined} />
          })()}
          leg={{
            next: nextLeg && { label: nextLeg.label, go: () => setPlaying({ bet: liveBet!, leg: nextLeg }) },
            rebet: liveBet && canRebet(liveBet) ? () => { loadSlip(liveBet.legs); setPlaying(undefined); setSlipOpen(true) } : undefined,
            label: playing.leg.label,
            pick: playing.leg.casino!.pick,
            onRound: (r: Round) => {
              resolveLeg(playing.bet.id, playing.leg.id, r)
              setLegDone({ id: playing.bet.id + playing.leg.id, result: gradeCasino(playing.leg.casino!.pick, r) })
              // A hit leg gets its own pop-up, unless it just cashed the whole ticket (that shows PARLAY HIT!).
              const bet = getState().bets.find(b => b.id === playing.bet.id)
              if (gradeCasino(playing.leg.casino!.pick, r) === 'won' && bet && bet.status !== 'won') {
                const hit = bet.legs.filter(l => l.result === 'won').length
                sfx.legHit()
                setParty({ title: 'LEG WON!', big: 'PARLAY STILL ALIVE', sub: `${playing.leg.label} ✓ · ${hit} of ${bet.legs.length} legs hit` })
              }
            },
            onClose: () => setPlaying(undefined),
          }}
        />
      )}

      {party && <WinCelebration key={party.id} {...party} onDone={() => setQueue(q => q.slice(1))} />}

      {reminder && (
        <div className="sheet-back" onClick={e => leave(e, () => setReminder(undefined))}>
          <div className="sheet center" onClick={e => e.stopPropagation()}>
            <div className="refer-art">⏰</div>
            <h3>You've been playing for {reminder} minutes</h3>
            <p className="muted">Quick check-in. You're {balance >= startBal.current ? 'up' : 'down'} <b>{money(Math.abs(balance - startBal.current))}</b> since you opened the app. Balance: {money(balance)}.</p>
            <p className="muted small">Limits and breaks are in Profile → My Budget and Controls.</p>
            <button className="cta" onClick={() => setReminder(undefined)}>Keep playing</button>
          </div>
        </div>
      )}

      {slip.length > 0 && !slipOpen && tab !== 'Swipe' && (
        <button className="slip-fab" onClick={() => setSlipOpen(true)}>
          {slip.length > 1 ? `${slip.length}-Leg Parlay` : 'Bet Slip'} <b>{slip.length}</b>
        </button>
      )}
    </div>
  )
}
