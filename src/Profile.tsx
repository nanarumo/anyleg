import { copyText } from './share.ts'
import { useEffect, useMemo, useState, type ReactNode, type FormEvent } from 'react'
import { fmtOdds, money, toAmerican, toDecimal, type CasinoGame } from './logic.ts'
import {
  claimSeason, getAccounts, netBetween,
  BASE_AVATARS, BONUS_EVERY_MS, SESSION_START, createAccount, markNotesSeen,
  REFERRAL, REFERRAL_MILESTONES, addFriend, codeOf, friendStats, redeemReferral, referralCount, removeFriend, setDailyLimit, setFrame, spentToday, unclaimedChallenges, unclaimedLevels, switchAccount, deleteAccount, updateAccount, updateSettings, useAccounts, useStore,
  type Account, type Bet, type CasinoRound, type Txn,
} from './store.ts'
import { GAME_NAMES } from './Casino.tsx'
import { LegIcon } from './LegIcon.tsx'
import { Insignia, ProgressionPage, RankSummary } from './Rank.tsx'
import { levelOf, rankAt, rankName } from './progression.ts'
import { ChallengesPage, Locker } from './Challenges.tsx'
import { DailySpin } from './Spin.tsx'
import { CHALLENGES } from './challenges.ts'
import { PRIZES, SEASON_BOTS, botNet, nextReset, seasonNo, weekId, weekStart } from './season.ts'

const AVATARS = BASE_AVATARS
const COLORS = ['#8b5cf6', '#d946ef', '#2dd4bf', '#f59e0b', '#ef4444', '#3b82f6']
const TIERS = [
  { name: 'Bronze', at: 0, color: '#cd7f32' },
  { name: 'Silver', at: 1000, color: '#c0c7d1' },
  { name: 'Gold', at: 5000, color: '#fbbf24' },
  { name: 'Platinum', at: 20000, color: '#a5f3fc' },
  { name: 'Diamond', at: 50000, color: '#c4b5fd' },
]
const VERSION = '1.0.0'

type Page =
  | 'home' | 'progress' | 'challenges' | 'weekly' | 'history' | 'stats' | 'refer' | 'rewards' | 'gameplay' | 'customize' | 'personal' | 'security' | 'notifications' | 'budget'
  | 'howto' | 'casino101' | 'parlays' | 'terms' | 'privacy' | 'rules'

/** One row of history: a settled ticket, a paid casino round, or a wallet movement. */
type Event = { id: string; at: number; kind: 'sports' | 'casino' | 'wallet'; area: string; title: string; detail: string; wager: number; returned: number }

const isSportsTicket = (b: Bet) => b.legs.every(l => l.sport)
const ticketOdds = (b: Bet) => fmtOdds(toAmerican(b.legs.reduce((m, l) => m * toDecimal(l.odds), 1)))
const when = (t: number) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function toEvents(bets: Bet[], rounds: CasinoRound[]): Event[] {
  const tickets: Event[] = bets.filter(b => b.status !== 'pending').map(b => ({
    id: b.id, at: b.placedAt, kind: isSportsTicket(b) ? 'sports' : 'casino',
    area: isSportsTicket(b) ? 'Sportsbook' : 'Parlay',
    title: b.legs.length > 1 ? `${b.legs.length}-leg parlay ${ticketOdds(b)}` : `${b.legs[0].label} ${ticketOdds(b)}`,
    detail: b.status === 'push' ? 'Push' : b.status === 'won' ? 'Won' : 'Lost', wager: b.stake, returned: b.payout,
  }))
  const casino: Event[] = rounds.map(r => ({
    id: r.id, at: r.at, kind: 'casino', area: GAME_NAMES[r.game], title: GAME_NAMES[r.game], detail: r.note ?? '', wager: r.wager, returned: r.returned,
  }))
  return [...tickets, ...casino].sort((a, b) => b.at - a.at)
}
const TXN_LABEL: Record<Txn['type'], string> = { deposit: 'Deposit', withdraw: 'Withdrawal', bonus: 'Daily bonus', rewards: 'Rewards Cash redeemed', level: 'Level-up reward', referral: 'Referral reward' }
const txnEvents = (txns: Txn[]): Event[] => txns.map(t => ({
  id: t.id, at: t.at, kind: 'wallet', area: 'Wallet', title: TXN_LABEL[t.type], detail: '',
  wager: t.type === 'withdraw' ? t.amount : 0, returned: t.type === 'withdraw' ? 0 : t.amount,
}))

export default function Profile({ onBack, openMyBets, startPage = 'home' }: { onBack: () => void; openMyBets: () => void; startPage?: Page }) {
  const { current, list } = useAccounts()
  const me = list.find(a => a.id === current)
  const [page, setPage] = useState<Page>(startPage)
  if (!me) return <SignUp others={list} onBack={onBack} />
  if (page === 'home') return <Home me={me} go={setPage} onBack={onBack} openMyBets={openMyBets} />
  return <SubPage page={page} me={me} back={() => setPage('home')} />
}

// ---------------------------------------------------------------- home

function Home({ me, go, onBack, openMyBets }: { me: Account; go: (p: Page) => void; onBack: () => void; openMyBets: () => void }) {
  const st = useStore()
  const { balance, bets, lastBonus, seenNotesAt, settings, xp, frame, challengesDone } = st
  const [bell, setBell] = useState(false)
  const now = useNow()
  const atRisk = bets.filter(b => b.status === 'pending').reduce((t, b) => t + b.stake, 0)

  const notes = useMemo(() => {
    const out: { at: number; text: string; icon: string }[] = []
    if (settings.notify.settled) for (const b of bets.filter(b => b.status !== 'pending').slice(0, 15)) {
      out.push({ at: b.placedAt, icon: b.status === 'won' ? '✅' : b.status === 'push' ? '↺' : '❌', text: `${b.legs.length > 1 ? `${b.legs.length}-leg parlay` : b.legs[0].label} ${b.status === 'won' ? `won ${money(b.payout)}` : b.status === 'push' ? 'pushed' : 'lost'}` })
    }
    if (settings.notify.legs) for (const b of bets.filter(b => b.status === 'pending')) {
      const ready = b.legs.filter(l => l.casino && l.result === 'pending').length
      if (ready) out.push({ at: b.placedAt, icon: '🎲', text: `${ready} casino leg${ready > 1 ? 's' : ''} ready to play in My Bets` })
    }
    if (settings.notify.bonus && (!lastBonus || now - lastBonus >= BONUS_EVERY_MS)) out.push({ at: (lastBonus ?? 0) + BONUS_EVERY_MS, icon: '🎁', text: 'Your daily spin is ready' })
    return out.sort((a, b) => b.at - a.at)
  }, [bets, lastBonus, settings.notify, now])
  const unseen = notes.filter(n => n.at > seenNotesAt).length

  return (
    <section className="pf">
      <div className="pf-top">
        <button className="icon-btn" onClick={onBack} aria-label="Back">←</button>
        <div className="pf-center">
          <div className="avatar xl" style={{ background: me.color, ...frameStyle(frame) }}>{me.avatar}</div>
          <div className="pf-name">{me.name.toUpperCase()}</div>
          <RankSummary xp={xp} onClick={() => go('progress')} />
        </div>
        <button className="icon-btn bell" onClick={() => { setBell(!bell); markNotesSeen() }} aria-label="Notifications">
          🔔{unseen > 0 && <b className="bell-count">{unseen}</b>}
        </button>
        {bell && (
          <div className="bell-panel">
            <b>Notifications</b>
            {!notes.length && <p className="muted small">You're all caught up.</p>}
            {notes.slice(0, 12).map((n, i) => <div key={i} className="note"><span>{n.icon}</span><div>{n.text}<div className="muted small">{when(n.at)}</div></div></div>)}
          </div>
        )}
      </div>

      <div className="session-card">
        <div><b>Last Login:</b> {me.prevLogin ? new Date(me.prevLogin).toLocaleString([], { month: '2-digit', day: '2-digit', year: '2-digit', hour: 'numeric', minute: '2-digit' }) : 'First visit'}</div>
        <div><b>Session Time:</b> {fmtClock(now - SESSION_START)}</div>
      </div>

      <h3 className="pf-h">Balances</h3>
      <div className="list">
        <div className="bal-row">
          <div><div className="muted small">Betting Balance</div><div className="bal-amt">{money(balance)}</div></div>
          <button className="pill" onClick={() => go('history')}>Details</button>
        </div>
        <div className="bal-row">
          <div><div className="muted small">Open Bets</div><div className="bal-amt">{money(atRisk)}</div></div>
          <button className="pill" onClick={openMyBets}>Details</button>
        </div>
      </div>

      <div className="list">
        <Row icon="🎨" label="Customize" onClick={() => go('customize')} />
        <Row icon="🎖️" label="Rank & Rewards" onClick={() => go('progress')} badge={unclaimedLevels(st).length} />
        <Row icon="🎯" label={`Challenges · ${challengesDone.length}/${CHALLENGES.length}`} onClick={() => go('challenges')} badge={unclaimedChallenges(st).length} />
        <Row icon="🏆" label={`Weekly Leaderboard · Season ${seasonNo()}`} onClick={() => go('weekly')} badge={lastWeekPrize(me, st.seasonsClaimed) !== undefined ? 1 : 0} />
        <Row icon="☰" label="Transaction History" onClick={() => go('history')} />
        <Row icon="📊" label="My Stat Sheet" onClick={() => go('stats')} />
        <Row icon="👥" label="Friends & Referrals" onClick={() => go('refer')} />
        <Row icon="🎁" label="My Rewards" onClick={() => go('rewards')} />
      </div>

      <h3 className="pf-h">General</h3>
      <div className="list">
        <Row icon="⚙️" label="Gameplay Settings" onClick={() => go('gameplay')} />
        <Row icon="👤" label="Personal Information" onClick={() => go('personal')} />
        <Row icon="🔒" label="Login & Security" onClick={() => go('security')} />
        <Row icon="🔔" label="Notification Preferences" onClick={() => go('notifications')} />
        <Row icon={<span className="rg">RG</span>} label="My Budget and Controls" onClick={() => go('budget')} />
      </div>
      <p className="muted small rg-line">If you or someone you know has a gambling problem and wants help, call <a href="tel:18004264537">1-800-GAMBLER</a>.</p>

      <h3 className="pf-h">Help Center</h3>
      <div className="list">
        <Row icon="ⓘ" label="How to Bet 101" onClick={() => go('howto')} />
        <Row icon="ⓘ" label="Casino Games 101" onClick={() => go('casino101')} />
        <Row icon="ⓘ" label="How Anyleg Parlays Work" onClick={() => go('parlays')} />
      </div>

      <h3 className="pf-h">Terms & Policies</h3>
      <div className="list">
        <Row icon="📄" label="Terms of Use" onClick={() => go('terms')} />
        <Row icon="🛡️" label="Privacy Policy" onClick={() => go('privacy')} />
        <Row icon="📖" label="House Rules" onClick={() => go('rules')} />
      </div>

      <div className="pf-foot"><span>PLAY MONEY ONLY</span><span>VERSION {VERSION}</span></div>
      <button className="pill big logout" onClick={() => switchAccount(undefined)}>Log Out</button>

    </section>
  )
}

function Row({ icon, label, onClick, badge }: { icon: ReactNode; label: string; onClick: () => void; badge?: number }) {
  return (
    <button className="row-btn" onClick={onClick}>
      <span className="row-ico">{icon}</span><span className="row-label">{label}{badge ? <b className="claim-count">{badge} to claim</b> : null}</span><span className="chev">›</span>
    </button>
  )
}

// ---------------------------------------------------------------- sub-pages

const TITLES: Record<Exclude<Page, 'home'>, string> = {
  progress: 'Rank & Rewards', challenges: 'Challenges', weekly: 'Weekly Leaderboard', history: 'Transaction History', stats: 'My Stat Sheet', refer: 'Friends & Referrals', rewards: 'My Rewards', gameplay: 'Gameplay Settings', customize: 'Customize',
  personal: 'Personal Information', security: 'Login & Security', notifications: 'Notification Preferences', budget: 'My Budget and Controls',
  howto: 'How to Bet 101', casino101: 'Casino Games 101', parlays: 'How Anyleg Parlays Work', terms: 'Terms of Use', privacy: 'Privacy Policy', rules: 'House Rules',
}

function SubPage({ page, me, back }: { page: Exclude<Page, 'home'>; me: Account; back: () => void }) {
  return (
    <section className="pf">
      <div className="sub-top"><button className="icon-btn" onClick={back} aria-label="Back">←</button><b>{TITLES[page]}</b><span /></div>
      {page === 'progress' && <ProgressionPage />}
      {page === 'challenges' && <ChallengesPage />}
      {page === 'weekly' && <Weekly me={me} />}
      {page === 'history' && <History />}
      {page === 'stats' && <StatSheet />}
      {page === 'refer' && <Refer me={me} />}
      {page === 'rewards' && <Rewards />}
      {page === 'gameplay' && <Gameplay />}
      {page === 'customize' && <Customize me={me} />}
      {page === 'personal' && <Personal me={me} />}
      {page === 'security' && <Security me={me} />}
      {page === 'notifications' && <Notifications />}
      {page === 'budget' && <Budget />}
      {page in DOCS && <div className="panel doc">{DOCS[page]}</div>}
    </section>
  )
}

/** Last week's finish for `me` among friends + bots, if it's a prize spot that hasn't been claimed. */
function lastWeekPrize(me: Account, claimed: string[] = []) {
  const prev = weekStart() - 1
  if (claimed.includes(weekId(prev))) return undefined
  const board = weeklyBoard(me, prev)
  const place = board.findIndex(r => r.id === me.id)
  return place >= 0 && board[place].played > 0 && place < PRIZES.length ? place : undefined
}

/** Everyone's profit for the week containing `t`: you, your friends on this device, and the season bots. */
function weeklyBoard(me: Account, t = Date.now()) {
  const from = weekStart(t), to = nextReset(t), week = weekId(t)
  const { list } = getAccounts()
  const friends = (me.friends ?? []).map(id => list.find(a => a.id === id)).filter((a): a is Account => !!a)
  return [
    ...[me, ...friends].map(a => ({ id: a.id, name: a.name, avatar: a.avatar, color: a.color, ...netBetween(a.id, from, to), bot: false })),
    ...SEASON_BOTS.map(b => ({ id: b.id, name: b.name, avatar: b.avatar, color: '#334155', net: botNet(week, b, Math.min(Date.now(), to)), played: 1, bot: true })),
  ].sort((x, y) => y.net - x.net)
}

function Weekly({ me }: { me: Account }) {
  const { seasonsClaimed } = useStore()
  const board = weeklyBoard(me)
  const prize = lastWeekPrize(me, seasonsClaimed)
  const left = nextReset() - Date.now()
  const days = Math.floor(left / 86_400_000), hours = Math.floor(left / 3_600_000) % 24
  return (
    <>
      {prize !== undefined && (
        <div className="panel center season-prize">
          <div className="duel-kicker">Season {seasonNo(weekStart() - 1)} final</div>
          <h3>You finished {['🥇 1st', '🥈 2nd', '🥉 3rd'][prize]}!</h3>
          <p className="muted">{PRIZES[prize].label}</p>
          <button className="cta" onClick={() => claimSeason(weekId(weekStart() - 1), prize)}>Claim prize</button>
        </div>
      )}
      <div className="panel">
        <div className="panel-head"><b>Season {seasonNo()}</b><span className="muted small">Resets in {days}d {hours}h</span></div>
        <p className="muted small">Net profit on bets and casino play this week (Mon–Sun). Top 3 when it resets win a play-money prize. Free to enter; full rules in Terms. Apple is not a sponsor.</p>
        <div className="board">
          {board.map((r, i) => (
            <div key={r.id} className={`friend ${r.id === me.id ? 'me' : ''}`}>
              <span className="board-pos">{i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</span>
              <span className="avatar" style={{ background: r.color }}>{r.avatar}</span>
              <div className="friend-body"><b>{r.name}{r.id === me.id ? ' (you)' : ''}</b>{r.bot && <span className="muted small">Season bot</span>}</div>
              <b className={r.net >= 0 ? 'win' : 'neg'}>{r.net >= 0 ? '+' : '−'}{money(Math.abs(r.net))}</b>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><b>Prizes</b></div>
        {PRIZES.map((p, i) => <div key={i} className="prize-row"><span>{['🥇', '🥈', '🥉'][i]}</span><span>{p.label}</span></div>)}
        <p className="muted small">Add friends in Friends & Referrals to race them too.</p>
      </div>
    </>
  )
}

function History() {
  const { bets, rounds, txns } = useStore()
  const [filter, setFilter] = useState<'all' | 'sports' | 'casino' | 'wallet'>('all')
  const events = useMemo(() => [...toEvents(bets, rounds), ...txnEvents(txns)].sort((a, b) => b.at - a.at), [bets, rounds, txns])
  const shown = events.filter(e => filter === 'all' || e.kind === filter).slice(0, 100)
  return (
    <div className="panel">
      <div className="seg mini wide">
        {(['all', 'sports', 'casino', 'wallet'] as const).map(f => <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)}</button>)}
      </div>
      {!shown.length && <p className="muted small">Nothing here yet.</p>}
      <div className="history-list">
        {shown.map(e => {
          const d = e.returned - e.wager
          return (
            <div key={e.id} className="h-row">
              <span className={`h-dot ${d > 0 ? 'w' : d < 0 ? 'l' : 'p'}`} />
              <div className="h-main">
                <div className="h-title">{e.title}</div>
                <div className="muted small">{e.area}{e.detail ? ` · ${e.detail}` : ''} · {when(e.at)}</div>
              </div>
              <div className="h-money">
                <b className={d > 0 ? 'win' : d < 0 ? 'neg' : ''}>{d > 0 ? '+' : d < 0 ? '−' : ''}{money(Math.abs(d))}</b>
                {e.kind !== 'wallet' && <span className="muted small">bet {money(e.wager)}</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function useTotals() {
  const { bets, rounds } = useStore()
  const events = useMemo(() => toEvents(bets, rounds), [bets, rounds])
  const wagered = events.reduce((t, e) => t + e.wager, 0)
  const net = events.reduce((t, e) => t + e.returned - e.wager, 0)
  return { bets, rounds, events, wagered, net }
}

function StatSheet() {
  const { balance } = useStore()
  const { bets, events, wagered, net } = useTotals()
  const wins = events.filter(e => e.returned > e.wager).length
  const losses = events.filter(e => e.returned < e.wager).length
  const biggest = events.reduce((m, e) => Math.max(m, e.returned - e.wager), 0)
  const bestParlay = bets.filter(b => b.status === 'won' && b.legs.length > 1).sort((a, b) => b.payout / b.stake - a.payout / a.stake)[0]
  const decided = events.filter(e => e.returned !== e.wager)
  const streak = decided.length ? (() => {
    const w = decided[0].returned > decided[0].wager
    const n = decided.findIndex(e => (e.returned > e.wager) !== w)
    return `${w ? 'W' : 'L'}${n < 0 ? decided.length : n}`
  })() : ''
  const byArea = new Map<string, { n: number; wagered: number; net: number; w?: number; l?: number }>()
  for (const e of events) {
    const a = byArea.get(e.area) ?? { n: 0, wagered: 0, net: 0 }
    byArea.set(e.area, { n: a.n + 1, wagered: a.wagered + e.wager, net: a.net + e.returned - e.wager, w: (a.w ?? 0) + (e.returned > e.wager ? 1 : 0), l: (a.l ?? 0) + (e.returned < e.wager ? 1 : 0) })
  }
  // Every graded leg across all tickets: hit rate by sport league / casino game, plus best hits and toughest misses.
  const legs = bets.flatMap(b => b.legs).filter(l => l.result === 'won' || l.result === 'lost')
  const groupOf = (l: Bet['legs'][number]) => (l.casino ? GAME_NAMES[l.casino.game] : `${(l.id.split(':')[0] ?? '').toUpperCase()}${l.sport?.prop ? ' props' : ''}`)
  const byGroup = new Map<string, { w: number; l: number }>()
  for (const l of legs) { const g = byGroup.get(groupOf(l)) ?? { w: 0, l: 0 }; l.result === 'won' ? g.w++ : g.l++; byGroup.set(groupOf(l), g) }
  const bestHits = legs.filter(l => l.result === 'won').sort((a, b) => b.odds - a.odds).slice(0, 3)
  const badMisses = legs.filter(l => l.result === 'lost').sort((a, b) => a.odds - b.odds).slice(0, 3)
  return (
    <>
      <div className="tiles-stats">
        <Stat label="Balance" value={money(balance)} cls="gold" />
        <Stat label="Net profit" value={`${net >= 0 ? '+' : '−'}${money(Math.abs(net))}`} cls={net >= 0 ? 'win' : 'neg'} />
        <Stat label="Total wagered" value={money(wagered)} />
        <Stat label="Win rate" value={wins + losses ? `${Math.round((wins / (wins + losses)) * 100)}%` : '—'} sub={`${wins}–${losses}`} />
        <Stat label="Biggest win" value={biggest ? `+${money(biggest)}` : '—'} cls={biggest ? 'win' : ''} />
        <Stat label="Best parlay" value={bestParlay ? ticketOdds(bestParlay) : '—'} sub={bestParlay ? `${bestParlay.legs.length} legs` : 'none hit yet'} />
        <Stat label="Streak" value={streak || '—'} cls={streak.startsWith('W') ? 'win' : streak ? 'neg' : ''} />
        <Stat label="Bets & rounds" value={String(events.length)} />
      </div>
      <div className="panel">
        <div className="panel-head"><b>Profit over time</b><span className="muted small">{events.length} settled</span></div>
        <PnlChart events={events} />
      </div>
      <div className="panel">
        <div className="panel-head"><b>By game</b></div>
        {byArea.size === 0 ? <p className="muted small">Play a hand or place a bet to see your breakdown.</p> : (
          <table className="breakdown">
            <thead><tr><th>Game</th><th>Bets</th><th>Win %</th><th>Wagered</th><th>Net</th></tr></thead>
            <tbody>
              {[...byArea].sort((a, b) => b[1].wagered - a[1].wagered).map(([area, a]) => (
                <tr key={area}><td>{area}</td><td>{a.n}</td><td>{(a.w ?? 0) + (a.l ?? 0) ? `${Math.round(((a.w ?? 0) / ((a.w ?? 0) + (a.l ?? 0))) * 100)}%` : '—'}</td><td>{money(a.wagered)}</td><td className={a.net >= 0 ? 'win' : 'neg'}>{a.net >= 0 ? '+' : '−'}{money(Math.abs(a.net))}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="panel">
        <div className="panel-head"><b>Legs hit by sport and game</b><span className="muted small">{legs.length} graded legs</span></div>
        {byGroup.size === 0 ? <p className="muted small">Your parlay and straight legs show up here once they settle.</p> : (
          <div className="hit-bars">
            {[...byGroup].sort((a, b) => b[1].w + b[1].l - (a[1].w + a[1].l)).map(([g, r]) => {
              const pct = Math.round((r.w / (r.w + r.l)) * 100)
              return (
                <div key={g} className="hit-bar">
                  <span>{g}</span>
                  <span className="hit-track"><i style={{ width: `${pct}%` }} /></span>
                  <b>{pct}%</b><span className="muted small">{r.w}–{r.l}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
      {(bestHits.length > 0 || badMisses.length > 0) && (
        <div className="panel">
          <div className="panel-head"><b>Best hits</b><span className="muted small">Longest odds you've cashed</span></div>
          {bestHits.map((l, i) => <div key={i} className="leg-stat"><LegIcon leg={l} /><span>{l.label}</span><b className="win">{fmtOdds(l.odds)}</b></div>)}
          <div className="panel-head" style={{ marginTop: 12 }}><b>Toughest misses</b><span className="muted small">Biggest favorites that let you down</span></div>
          {badMisses.map((l, i) => <div key={i} className="leg-stat"><LegIcon leg={l} /><span>{l.label}</span><b className="neg">{fmtOdds(l.odds)}</b></div>)}
        </div>
      )}
    </>
  )
}

function Rewards() {
  const { lastBonus } = useStore()
  const { bets, rounds, events, wagered, net } = useTotals()
  const now = useNow()
  const tierIdx = TIERS.filter(t => wagered >= t.at).length - 1
  const tier = TIERS[tierIdx], next = TIERS[tierIdx + 1]
  const bonusIn = lastBonus ? lastBonus + BONUS_EVERY_MS - now : 0
  const [spin, setSpin] = useState(false)
  const myBadges = badges(bets, rounds, events, net)
  return (
    <>
      <div className="panel tier-panel" style={{ ['--tier' as string]: tier.color }}>
        <div className="tier-big">◆ {tier.name}</div>
        {next ? <>
          <span className="tier-bar wide"><i style={{ width: `${Math.min(100, ((wagered - tier.at) / (next.at - tier.at)) * 100)}%`, background: tier.color }} /></span>
          <div className="muted small">{money(next.at - wagered)} more wagered to reach {next.name}</div>
        </> : <div className="muted small">You're at the top tier.</div>}
      </div>
      <div className="bonus">
        <div><b>🎡 Daily spin</b><div className="muted small">A free wheel spin every 24 hours: at least $100 every day, up to $500</div></div>
        <button className="cta" onClick={() => setSpin(true)} disabled={bonusIn > 0}>{bonusIn > 0 ? `Next in ${fmtDuration(bonusIn)}` : 'Spin'}</button>
      </div>
      {spin && <DailySpin onClose={() => setSpin(false)} />}
      <div className="panel">
        <div className="panel-head"><b>Badges</b><span className="muted small">{myBadges.filter(b => b.got).length} / {myBadges.length}</span></div>
        <div className="badges">
          {myBadges.map(b => (
            <div key={b.name} className={`badge-tile ${b.got ? 'got' : ''}`} title={b.how}>
              <span className="badge-ico">{b.icon}</span><span className="badge-name">{b.name}</span><span className="badge-how">{b.how}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

function Refer({ me }: { me: Account }) {
  const { list } = useAccounts()
  const code = codeOf(me)
  const [copied, setCopied] = useState(false)
  const [redeem, setRedeem] = useState('')
  const [friendCode, setFriendCode] = useState('')
  const [msg, setMsg] = useState<{ text: string; bad?: boolean }>()
  const referred = referralCount(me.id)
  const canRedeem = !me.referredBy && Date.now() - me.createdAt < 7 * 86_400_000
  const friends = (me.friends ?? []).map(id => list.find(a => a.id === id)).filter((a): a is Account => !!a)
  // Leaderboard: you and your friends by net profit.
  const board = [me, ...friends].map(a => ({ a, s: friendStats(a.id) })).sort((x, y) => y.s.net - x.s.net)
  const share = async () => {
    const text = `Join me on Anyleg and use my code ${code} for a $${REFERRAL.newCash} bonus + 50% Parlay Boost.`
    try { if (navigator.share) return await navigator.share({ title: 'Anyleg', text }) } catch {}
    setCopied(copyText(code))
  }
  const result = (err?: string, ok?: string) => setMsg(err ? { text: err, bad: true } : { text: ok! })

  return (
    <>
      <div className="panel center refer-hero">
        <div className="refer-art">👥</div>
        <h3>Invite friends, both of you win</h3>
        <p className="muted">Friends who sign up with your code get <b>${REFERRAL.newCash} + a 50% Parlay Boost</b>. You get <b>${REFERRAL.referrerCash.toLocaleString()} + {REFERRAL.referrerXp} XP</b> for each one.</p>
        <div className="code-box">{code}</div>
        <div className="btnrow">
          <button className="ghost" onClick={() => { if (copyText(code)) setCopied(true); else window.prompt('Copy your code:', code) }}>{copied ? 'Copied!' : 'Copy code'}</button>
          <button className="cta" onClick={share}>Share invite</button>
        </div>
        <div className="ref-ladder">
          <div className={`rung ${referred >= 1 ? 'got' : ''}`}><b>1</b><span>${REFERRAL.referrerCash.toLocaleString()} + {REFERRAL.referrerXp} XP each</span></div>
          {REFERRAL_MILESTONES.map(m => <div key={m.count} className={`rung ${referred >= m.count ? 'got' : ''}`}><b>{m.count}</b><span>{m.label}</span></div>)}
        </div>
        <div className="muted small">{referred} friend{referred === 1 ? '' : 's'} joined with your code</div>
      </div>

      {canRedeem && (
        <div className="panel">
          <div className="panel-head"><b>Got a friend's code?</b><span className="muted small">Within 7 days of signing up</span></div>
          <div className="inline-form">
            <input value={redeem} onChange={e => setRedeem(e.target.value)} placeholder="e.g. NICK-4F2A" />
            <button className="cta" onClick={async () => result(await redeemReferral(redeem), `Code applied: +$${REFERRAL.newCash} and a 50% Parlay Boost`)}>Redeem</button>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head"><b>Friends</b><span className="muted small">{friends.length} friend{friends.length === 1 ? '' : 's'}</span></div>
        <div className="inline-form">
          <input value={friendCode} onChange={e => setFriendCode(e.target.value)} placeholder="Add a friend by their code" />
          <button className="ghost" onClick={() => { result(addFriend(friendCode), 'Friend added'); setFriendCode('') }}>Add</button>
        </div>
        {msg && <p className={`small ${msg.bad ? 'warn' : 'win'}`}>{msg.text}</p>}
        {friends.length === 0 && <p className="muted small">No friends yet. Share your code, or add someone by theirs.</p>}
        {friends.length > 0 && (
          <div className="board">
            <div className="small muted board-h">LEADERBOARD · NET PROFIT</div>
            {board.map(({ a, s }, i) => {
              const lv = levelOf(s.xp).level
              const rank = rankAt(lv)
              return (
                <div key={a.id} className={`friend ${a.id === me.id ? 'me' : ''}`}>
                  <span className="board-pos">{i + 1}</span>
                  <span className="avatar" style={{ background: a.color }}>{a.avatar}</span>
                  <div className="friend-body">
                    <b>{a.name}{a.id === me.id ? ' (you)' : ''}</b>
                    <span className="muted small"><Insignia rank={rank} prestige={s.prestige} size={16} /> {rankName(rank, s.prestige)} · Lv {lv} · {s.wins}–{s.losses}</span>
                  </div>
                  <b className={s.net >= 0 ? 'win' : 'neg'}>{s.net >= 0 ? '+' : '−'}{money(Math.abs(s.net))}</b>
                  {a.id !== me.id && <button className="link" onClick={() => removeFriend(a.id)} aria-label={`Remove ${a.name}`}>×</button>}
                </div>
              )
            })}
          </div>
        )}
        <p className="muted small">Friends and codes connect accounts on this device for now. Cross-device friends arrive with online accounts.</p>
      </div>
    </>
  )
}

function Gameplay() {
  const { settings } = useStore()
  return (
    <div className="panel">
      <div className="set-row">
        <div><b>Odds format</b><div className="muted small">How odds appear everywhere in the app.</div></div>
        <div className="seg mini">
          {(['american', 'decimal'] as const).map(f => <button key={f} className={settings.oddsFormat === f ? 'on' : ''} onClick={() => updateSettings({ oddsFormat: f })}>{f === 'american' ? '+150' : '2.50'}</button>)}
        </div>
      </div>
      <div className="set-row">
        <div><b>Default wager</b><div className="muted small">Pre-filled in the bet slip.</div></div>
        <div className="quick">{[5, 10, 25, 50].map(v => <button key={v} className={settings.defaultStake === v ? 'on' : ''} onClick={() => updateSettings({ defaultStake: v })}>${v}</button>)}</div>
      </div>
      <label className="set-row toggle-row">
        <div><b>Sound and vibration</b><div className="muted small">Chip clicks, card snaps, the roulette rattle, and a buzz when a leg hits.</div></div>
        <input type="checkbox" className="switch" checked={settings.sound !== false} onChange={e => updateSettings({ sound: e.target.checked })} />
      </label>
    </div>
  )
}

/** Frames come from rank rewards and are stored as "frame:<name>:<color>". */
export const frameStyle = (frame?: string) => (frame ? { boxShadow: `0 0 0 4px ${frame.split(':')[2]}, 0 0 22px ${frame.split(':')[2]}` } : {})

function Personal({ me }: { me: Account }) {
  const { frame } = useStore()
  return (
    <div className="panel">
      <div className="center"><div className="avatar xl" style={{ background: me.color, ...frameStyle(frame) }}>{me.avatar}</div></div>
      <div className="set-row"><div><b>Username</b><div className="muted small">{me.name}</div></div></div>
      <div className="set-row"><div><b>Member since</b><div className="muted small">{new Date(me.createdAt).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}</div></div></div>
    </div>
  )
}

/** Every cosmetic in one place: avatar, frame, color, table felt, card back. */
function Customize({ me }: { me: Account }) {
  const { unlocked, frame } = useStore()
  const avatars = [...AVATARS, ...unlocked.filter(u => !u.startsWith('frame:') && !u.startsWith('skin:'))]
  const frames = unlocked.filter(u => u.startsWith('frame:'))
  return (
    <div className="prog">
      <div className="panel">
        <div className="center"><div className="avatar xl" style={{ background: me.color, ...frameStyle(frame) }}>{me.avatar}</div></div>
        <div className="field"><span>Avatar</span><div className="pick">{avatars.map(a => <button key={a} className={a === me.avatar ? 'on' : ''} onClick={() => updateAccount({ avatar: a })}>{a}</button>)}</div></div>
        <div className="field">
          <span>Frame {frames.length === 0 && <span className="muted small">· unlock frames by ranking up</span>}</span>
          <div className="pick">
            <button className={!frame ? 'on' : ''} onClick={() => setFrame(undefined)}>∅</button>
            {frames.map(fr => <button key={fr} className={fr === frame ? 'on' : ''} title={fr.split(':')[1]} onClick={() => setFrame(fr)}><span className="frame-dot" style={{ background: fr.split(':')[2] }} /></button>)}
          </div>
        </div>
        <div className="field"><span>Color</span><div className="pick">{COLORS.map(c => <button key={c} className={`swatch ${c === me.color ? 'on' : ''}`} style={{ background: c }} onClick={() => updateAccount({ color: c })} aria-label={c} />)}</div></div>
      </div>
      <Locker />
    </div>
  )
}

function Security({ me }: { me: Account }) {
  const { list } = useAccounts()
  return (
    <div className="panel">
      <p className="muted small">Accounts are stored in this browser on this device. Anyleg uses play money only, so there are no passwords yet.</p>
      <b>Accounts on this device</b>
      <div className="acct-list">
        {list.map(a => (
          <button key={a.id} className={`acct ${a.id === me.id ? 'on' : ''}`} onClick={() => switchAccount(a.id)}>
            <span className="avatar" style={{ background: a.color }}>{a.avatar}</span>{a.name}{a.id === me.id && <span className="muted small"> · signed in</span>}
          </button>
        ))}
      </div>
      <div className="set-row"><div><b>Add another account</b><div className="muted small">Signs you out so someone else can create one.</div></div><button className="pill" onClick={() => switchAccount(undefined)}>Add account</button></div>
      <div className="set-row"><div><b>Delete account</b><div className="muted small">Permanently erases {me.name} and all of its bets, history and rewards from this device and our server. This can't be undone.</div></div>
        <button className="pill danger" onClick={() => confirm(`Delete ${me.name} for good? Its balance, bets and history will be erased.`) && deleteAccount().catch(e => alert(e.message))}>Delete</button></div>
    </div>
  )
}

function Notifications() {
  const { settings } = useStore()
  const opts: [keyof typeof settings.notify, string, string][] = [
    ['settled', 'Bet results', 'When a ticket wins, loses or pushes'],
    ['legs', 'Casino legs ready', 'When a parlay has casino legs waiting to be played'],
    ['bonus', 'Daily bonus', 'When your free daily bonus is ready'],
  ]
  return (
    <div className="panel">
      {opts.map(([k, label, sub]) => (
        <label key={k} className="set-row toggle-row">
          <div><b>{label}</b><div className="muted small">{sub}</div></div>
          <input type="checkbox" className="switch" checked={settings.notify[k]} onChange={e => updateSettings({ notify: { ...settings.notify, [k]: e.target.checked } })} />
        </label>
      ))}
    </div>
  )
}

function Budget() {
  const { settings } = useStore()
  const [limit, setLimit] = useState(String(settings.dailyLimit || ''))
  const now = useNow()
  const cooling = settings.coolOffUntil && settings.coolOffUntil > now
  return (
    <>
      <div className="panel">
        <div className="set-row">
          <div><b>Session reminder</b><div className="muted small">A nudge after you've been playing a while.</div></div>
          <select value={settings.sessionReminderMin} onChange={e => updateSettings({ sessionReminderMin: Number(e.target.value) })}>
            {[0, 15, 30, 60, 120].map(v => <option key={v} value={v}>{v ? `Every ${v} min` : 'Off'}</option>)}
          </select>
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><b>Daily play limit</b></div>
        <p className="muted small">The most you can wager each day across sports and casino. Lowering it works right away; raising or removing it takes 24 hours.</p>
        <p className="small">Wagered today: <b>{money(spentToday())}</b>{settings.dailyLimit ? <> of <b>{money(settings.dailyLimit)}</b></> : ' (no limit)'}</p>
        {settings.limitRaise && <p className="muted small">Changes to {settings.limitRaise.value ? money(settings.limitRaise.value) : 'no limit'} on {new Date(settings.limitRaise.at).toLocaleString()}.</p>}
        <div className="quick">
          <input type="number" inputMode="decimal" min="0" placeholder="No limit" value={limit} onChange={e => setLimit(e.target.value)} />
          <button onClick={() => setDailyLimit(Math.max(0, Number(limit) || 0))}>Save</button>
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><b>Take a break</b></div>
        {cooling ? (
          <p>Betting is paused until <b>{new Date(settings.coolOffUntil!).toLocaleString()}</b>. Breaks can't be ended early.</p>
        ) : (
          <>
            <p className="muted small">Pause all sports betting and casino play. You can still view your account.</p>
            <div className="quick">
              {[[1, '24 hours'], [7, '7 days'], [30, '30 days'], [182, '6 months'], [365, '1 year']].map(([d, label]) => (
                <button key={label} onClick={() => confirm(`Pause betting for ${label}? This can't be undone early.`) && updateSettings({ coolOffUntil: Date.now() + Number(d) * 86_400_000 })}>{label}</button>
              ))}
            </div>
          </>
        )}
      </div>
      <p className="muted small rg-line">If you or someone you know has a gambling problem and wants help, call <a href="tel:18004264537">1-800-GAMBLER</a>.</p>
    </>
  )
}

const DOCS: Partial<Record<Page, ReactNode>> = {
  howto: <>
    <h4>Moneyline</h4><p>Pick the winner. Negative odds (−150) are favorites: bet $150 to win $100. Positive odds (+130) are underdogs: bet $100 to win $130.</p>
    <h4>Spread</h4><p>The favorite must win by more than the line (−3.5 must win by 4+). The underdog (+3.5) wins the bet by winning outright or losing by 3 or fewer.</p>
    <h4>Total (Over/Under)</h4><p>Bet whether both teams' combined score lands over or under the number.</p>
    <h4>Parlays</h4><p>Combine legs into one ticket. Every leg must hit, and the odds multiply. A pushed leg drops out instead of losing the ticket.</p>
  </>,
  casino101: <>
    <h4>Blackjack</h4><p>Get closer to 21 than the dealer without going over. Blackjack pays 3 to 2; the dealer stands on all 17s. You can hit, stand, double, split pairs and take insurance against an Ace.</p>
    <h4>Roulette</h4><p>European single-zero wheel. Red/Black, Odd/Even and 1–18/19–36 pay even money; dozens and columns pay 2 to 1; a single number pays 35 to 1.</p>
    <h4>Baccarat</h4><p>Bet on Player, Banker or Tie. Cards are dealt by fixed rules. Banker pays 0.95 to 1, Tie pays 8 to 1, and pairs pay 11 to 1.</p>
    <h4>Video Poker</h4><p>Jacks or Better: hold the cards you want, draw the rest. A pair of Jacks or better returns your bet; a Royal Flush pays 250 for 1.</p>
    <h4>Slots</h4><p>Line up symbols on the middle line. Three diamonds pay 150x.</p>
  </>,
  parlays: <>
    <p>Anyleg's twist: any outcome can be a parlay leg. Mix an NFL spread with "Dealer busts" and "Next spin Red" on one ticket.</p>
    <h4>Casino legs</h4><p>Add them from any table's Parlay legs panel. After you place the ticket, open My Bets and tap Play leg to play that round for free. Only that free round decides the leg.</p>
    <h4>Sports legs</h4><p>Lines come live from a major US sportsbook via ESPN and update every 30 seconds. Legs settle automatically when the game goes final.</p>
  </>,
  terms: <><p>Anyleg is a free-to-play entertainment app for adults 18+. It uses play money only: there is no real-money gambling, and nothing here can be bought, deposited, withdrawn or exchanged for real money, prizes or anything of value. Leaderboard prizes and rewards are all play money or cosmetics. Odds are shown for entertainment and may lag the real market. Success here does not mean future success at real-money gambling.</p>
    <h4>Not affiliated</h4><p>Anyleg is not affiliated with, endorsed or sponsored by any sports league, team, player, sportsbook or casino. League, team and player names belong to their owners and appear only to identify real games and stats. Anyleg does not use league or team logos or player photos.</p>
    <h4>Play money</h4><p>Play money and rewards have no cash value. They can't be bought, sold, transferred between accounts or redeemed for anything. Selling or trading accounts or play money outside the app is not allowed, and Anyleg may reset any account involved.</p>
    <h4>Bots</h4><p>Season leaderboard bots, squad bots and house creators are computer players, and they're labeled as bots.</p>
    <h4>Sports data</h4><p>Scores, schedules and lines come from public ESPN feeds. They can be delayed or wrong, and a feed outage can delay settlement.</p>
    <h4>Your controls</h4><p>Set a daily play limit, session reminders or a break of up to a year in My Budget and Controls. If gambling stops being fun, call 1-800-GAMBLER.</p>
    <h4>Weekly leaderboard rules</h4><p>Free to enter; no purchase is possible. Rankings are net play-money profit from Monday 00:00 to Sunday 23:59 (device time), among you, friends on this device and labeled bots. The top 3 can claim play-money prizes and cosmetic skins in the app, once per week. Prizes have no cash value and can't be exchanged. Apple is not a sponsor of, and is not involved in, the leaderboard or its prizes.</p>
    <h4>License</h4><p>If you got Anyleg from the App Store, your use is governed by <a href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/" target="_blank" rel="noreferrer">Apple's Standard License Agreement (EULA)</a>; these terms are the game's rules on top of it. Anyleg, not Apple, is responsible for the app, its content, support and any claims about it.</p>
    <h4>Contact</h4><p>Questions or problems: <a href="mailto:anylegsupport@gmail.com">anylegsupport@gmail.com</a></p></>,
  privacy: <>
    <p>Anyleg never asks for your real name, email, phone, location or payment details, and never sells or shares your data. There are no ads, no analytics and no tracking.</p>
    <h4>What is stored</h4><p>Your device gets an anonymous account on our server (hosted by Supabase). It holds your username, play-money balance, bets, casino rounds, rewards and referral code, used only to run the game. Your avatar and settings stay on this device.</p>
    <h4>Network requests</h4><p>The app downloads public sports scores and odds from ESPN. Those requests carry no account information.</p>
    <h4>Deleting your data</h4><p>Go to Login &amp; Security and tap Delete account to erase the account and everything tied to it from our server and this device.</p>
    <h4>Contact</h4><p>Privacy questions: <a href="mailto:anylegsupport@gmail.com">anylegsupport@gmail.com</a></p>
  </>,
  rules: <>
    <h4>Settlement</h4><p>Sports bets settle on the official final score. Pushed legs are removed from parlays and the odds recalculate.</p>
    <h4>Odds changes</h4><p>If a price moves while a leg is in your slip, the new price is shown and placing the bet accepts it.</p>
    <h4>Started games</h4><p>Pre-game lines come off the board at kickoff and are removed from your slip.</p>
    <h4>Casino legs</h4><p>A casino leg is decided by one free round played from My Bets. Leaving a paid table mid-round settles it automatically.</p>
  </>,
}

// ---------------------------------------------------------------- sign up

function SignUp({ others, onBack }: { others: Account[]; onBack: () => void }) {
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState(AVATARS[0])
  const [color, setColor] = useState(COLORS[0])
  const [ref, setRef] = useState('')
  const [err, setErr] = useState<string>()
  const [mode, setMode] = useState<'in' | 'up'>(others.length ? 'in' : 'up')
  const [who, setWho] = useState('')
  const signIn = (e: FormEvent) => {
    e.preventDefault()
    const a = others.find(x => x.name.toLowerCase() === who.trim().toLowerCase())
    a ? switchAccount(a.id) : setErr(`No account named "${who.trim()}" on this device`)
  }
  const tabs = (
    <div className="seg">
      <button className={mode === 'in' ? 'on' : ''} onClick={() => { setMode('in'); setErr(undefined) }}>Sign in</button>
      <button className={mode === 'up' ? 'on' : ''} onClick={() => { setMode('up'); setErr(undefined) }}>Create account</button>
    </div>
  )
  if (mode === 'in') return (
    <section className="pf">
      <div className="sub-top"><button className="icon-btn" onClick={onBack} aria-label="Back">←</button><b>Account</b><span /></div>
      <div className="signup">
        {tabs}
        <h2>Sign in to Anyleg</h2>
        <form onSubmit={signIn}>
          <label className="field"><span>Username</span><input value={who} onChange={e => setWho(e.target.value)} maxLength={20} placeholder="Your username" autoFocus /></label>
          {err && <p className="warn small">{err}</p>}
          <button className="cta" type="submit">Sign in</button>
        </form>
        {others.length > 0 && <>
          <p className="muted small">Or tap an account on this device:</p>
          <div className="acct-list">
            {others.map(a => <button key={a.id} className="acct" onClick={() => switchAccount(a.id)}><span className="avatar" style={{ background: a.color }}>{a.avatar}</span>{a.name}</button>)}
          </div>
        </>}
        <p className="muted small">Accounts live on this device only, so an account made on your PC won't show up on your phone yet.</p>
      </div>
    </section>
  )
  return (
    <section className="pf">
      <div className="sub-top"><button className="icon-btn" onClick={onBack} aria-label="Back">←</button><b>Account</b><span /></div>
      <div className="signup">
        {tabs}
        <div className="avatar xl" style={{ background: color }}>{avatar}</div>
        <h2>Create your Anyleg account</h2>
        <p className="muted">Track your record, profit, streaks and badges. You keep the balance and bets you made as a guest.</p>
        <form onSubmit={e => { e.preventDefault(); setErr(createAccount(name, avatar, color, ref)) }}>
          <label className="field"><span>Username</span><input value={name} onChange={e => setName(e.target.value)} maxLength={20} placeholder="e.g. ParlayKing" autoFocus /></label>
          <label className="field"><span>Referral code <span className="muted">(optional · +${REFERRAL.newCash} and a 50% Parlay Boost)</span></span><input value={ref} onChange={e => setRef(e.target.value)} placeholder="e.g. NICK-4F2A" /></label>
          <div className="field"><span>Avatar</span><div className="pick">{AVATARS.map(a => <button type="button" key={a} className={a === avatar ? 'on' : ''} onClick={() => setAvatar(a)}>{a}</button>)}</div></div>
          <div className="field"><span>Color</span><div className="pick">{COLORS.map(c => <button type="button" key={c} className={`swatch ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />)}</div></div>
          {err && <p className="warn small">{err}</p>}
          <button className="cta" type="submit">Create account</button>
        </form>
        <p className="muted small">Accounts live on this device only. It is all play money, so there is no password.</p>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- bits

function Stat({ label, value, sub, cls = '' }: { label: string; value: string; sub?: string; cls?: string }) {
  return <div className="stat"><small>{label}</small><b className={cls}>{value}</b>{sub && <span className="muted small">{sub}</span>}</div>
}

function badges(bets: Bet[], rounds: CasinoRound[], events: Event[], net: number) {
  const wonParlays = bets.filter(b => b.status === 'won' && b.legs.length > 1)
  const roundWith = (g: CasinoGame, test: (r: CasinoRound) => boolean) => rounds.some(r => r.game === g && test(r))
  return [
    { icon: '🎟️', name: 'First Ticket', how: 'Place your first bet', got: events.length > 0 || bets.length > 0 },
    { icon: '🔗', name: 'Parlay Pro', how: 'Hit a 3+ leg parlay', got: wonParlays.some(b => b.legs.length >= 3) },
    { icon: '🧬', name: 'Anyleg Original', how: 'Hit a parlay mixing sports and casino', got: wonParlays.some(b => b.legs.some(l => l.sport) && b.legs.some(l => l.casino)) },
    { icon: '🂡', name: 'Natural', how: 'Get dealt a blackjack', got: roundWith('blackjack', r => r.note === 'BLACKJACK!') },
    { icon: '💰', name: 'High Roller', how: 'Bet $500+ at once', got: events.some(e => e.wager >= 500) },
    { icon: '🚀', name: 'Moonshot', how: 'Win 10x your bet', got: events.some(e => e.returned >= e.wager * 10) },
    { icon: '7️⃣', name: 'Jackpot', how: 'Hit 50x+ on slots', got: roundWith('slots', r => r.returned >= r.wager * 50) },
    { icon: '👑', name: 'Royalty', how: 'Make a royal flush', got: roundWith('poker', r => r.note === 'Royal Flush') },
    { icon: '⏱️', name: 'Grinder', how: 'Play 100 casino rounds', got: rounds.length >= 100 },
    { icon: '📈', name: 'In the Green', how: 'Be up overall after 20+ bets', got: events.length >= 20 && net > 0 },
  ]
}

/** Cumulative profit line with a crosshair tooltip. One series, so no legend; zero is drawn as the baseline. */
function PnlChart({ events }: { events: Event[] }) {
  const [hover, setHover] = useState<number>()
  const pts = useMemo(() => {
    let run = 0
    return [...events].reverse().map(e => ({ at: e.at, v: (run += e.returned - e.wager) }))
  }, [events])
  if (pts.length < 2) return <p className="muted small">Your profit line appears after a couple of settled bets.</p>

  const W = 640, H = 200, P = { l: 56, r: 12, t: 12, b: 24 }
  const vals = [0, ...pts.map(p => p.v)]
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const pad = (hi - lo || 1) * 0.08
  const y = (v: number) => P.t + (1 - (v - (lo - pad)) / (hi + pad - (lo - pad))) * (H - P.t - P.b)
  const x = (i: number) => P.l + (i / (pts.length - 1)) * (W - P.l - P.r)
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('')
  const ticks = [lo - pad, (lo + hi) / 2, hi + pad]
  const last = pts[pts.length - 1].v
  const h = hover !== undefined ? pts[hover] : undefined

  return (
    <div className="pnl">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Cumulative profit, now ${money(last)}`}
        onMouseLeave={() => setHover(undefined)}
        onMouseMove={e => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const px = ((e.clientX - r.left) / r.width) * W
          setHover(Math.max(0, Math.min(pts.length - 1, Math.round(((px - P.l) / (W - P.l - P.r)) * (pts.length - 1)))))
        }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={P.l - 8} y={y(t)} className="axis" textAnchor="end" dominantBaseline="middle">{t < 0 ? '−' : ''}${Math.abs(Math.round(t))}</text>
          </g>
        ))}
        <line x1={P.l} x2={W - P.r} y1={y(0)} y2={y(0)} className="zero" />
        <path d={`${path}L${x(pts.length - 1)},${y(0)}L${x(0)},${y(0)}Z`} className="area" />
        <path d={path} className="line" />
        <circle cx={x(pts.length - 1)} cy={y(last)} r="4" className="end" />
        {h && <g><line x1={x(hover!)} x2={x(hover!)} y1={P.t} y2={H - P.b} className="cross" /><circle cx={x(hover!)} cy={y(h.v)} r="5" className="end" /></g>}
      </svg>
      {h && (
        <div className="pnl-tip" style={{ left: `${(x(hover!) / W) * 100}%` }}>
          <b>{h.v >= 0 ? '+' : '−'}{money(Math.abs(h.v))}</b><span>{when(h.at)}</span>
        </div>
      )}
    </div>
  )
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return now
}
const fmtClock = (ms: number) => {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(sec).padStart(2, '0')}`
}
function fmtDuration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h ? `${h}h ${m}m` : `${m}m ${s % 60}s`
}
