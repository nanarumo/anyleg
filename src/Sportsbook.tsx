import { useState } from 'react'
import { PROP_STATS, fmtOdds, type PropStat } from './logic.ts'
import { PROP_LEAGUES, PROP_ODDS, propLeg, rungLeg, useProps } from './props.ts'
import { LEAGUES, type Game, type Price } from './odds.ts'
import { toggleLeg, useStore, type Leg } from './store.ts'
import { LeagueHero, SPORT_ICON, sportOf } from './LeagueArt.tsx'

type Props = { games: Game[]; prev: Map<string, number>; updated?: Date; error?: string }

const ORDER = { in: 0, pre: 1, post: 2 } // live games on top
const MARKET_NAME = { ml: 'Moneyline', spread: 'Spread', total: 'Total', prop: 'Player prop' }

export default function Sportsbook({ games, prev, updated, error }: Props) {
  const [league, setLeague] = useState('all')
  const shown = games
    .filter(g => league === 'all' || g.league === league)
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.start.localeCompare(b.start))
  const counts = new Map(LEAGUES.map(l => [l.key, games.filter(g => g.league === l.key).length]))

  return (
    <section className={`book theme-${sportOf(league)}`}>
      <LeagueHero league={league} count={shown.length} />
      <div className="leagues">
        <button className={league === 'all' ? 'on' : ''} onClick={() => setLeague('all')}>All</button>
        {LEAGUES.filter(l => counts.get(l.key)).map(l => (
          <button key={l.key} className={league === l.key ? 'on' : ''} onClick={() => setLeague(l.key)}>{SPORT_ICON[sportOf(l.key)]} {l.name}</button>
        ))}
      </div>
      <p className="muted small">
        <span className="dot" /> Live lines via ESPN, refreshing every 30s
        {updated && ` · updated ${updated.toLocaleTimeString()}`}
        {error && <span className="warn"> · {error}</span>}
      </p>
      {!games.length && !error && <p className="muted">Loading odds…</p>}
      {shown.map(g => <GameCard key={`${g.league}${g.id}`} g={g} prev={prev} />)}
    </section>
  )
}

function GameCard({ g, prev }: { g: Game; prev: Map<string, number> }) {
  const p = (market: string, side: string) => g.prices.find(x => x.market === market && x.side === side)
  const time = g.state === 'pre'
    ? new Date(g.start).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    : g.detail
  const leagueName = LEAGUES.find(l => l.key === g.league)!.name
  const [showProps, setShowProps] = useState(false)

  return (
    <div className={`game sport-${sportOf(g.league)}`} data-icon={SPORT_ICON[sportOf(g.league)]}>
      <div className="game-meta">
        <span>{leagueName} · {time}</span>
        {g.state === 'in' && <span className="live">LIVE</span>}
      </div>
      {g.prices.length > 0 && (
        <div className="grid-head"><span /><span>Spread</span><span>Total</span><span>Money</span></div>
      )}
      {(['away', 'home'] as const).map(side => (
        <div key={side} className={g.prices.length ? 'grid-row' : 'score-row'}>
          <div className="team">
            {g[side].logo && <img src={g[side].logo} alt="" />}
            <span>{g[side].name}</span>
            {g.state !== 'pre' && <b className="score">{g[side].score}</b>}
          </div>
          {g.prices.length > 0 && <>
            <OddsBtn g={g} price={p('spread', side)} prev={prev} />
            <OddsBtn g={g} price={p('total', side === 'away' ? 'over' : 'under')} prev={prev} />
            <OddsBtn g={g} price={p('ml', side)} prev={prev} />
          </>}
        </div>
      ))}
      {p('ml', 'draw') && (
        <div className="grid-row">
          <div className="team"><span>Draw</span></div><span /><span />
          <OddsBtn g={g} price={p('ml', 'draw')} prev={prev} />
        </div>
      )}
      {!g.prices.length && <div className="muted small">{g.state === 'pre' ? 'Odds not posted yet' : 'Off the board'}</div>}
      {PROP_LEAGUES.includes(g.league) && g.state === 'pre' && <>
        <button className="props-toggle" onClick={() => setShowProps(v => !v)}>{SPORT_ICON[sportOf(g.league)]} Player props {showProps ? '▴' : '▾'}</button>
        {showProps && <PlayerProps g={g} />}
      </>}
    </div>
  )
}

/** Sportsbook player prop lines for one game, grouped by stat. */
function PlayerProps({ g }: { g: Game }) {
  const props = useProps([g]).get(g.id)
  const { slip } = useStore()
  const stats = [...new Set(props?.map(p => p.stat))]
  const [pick, setPick] = useState<PropStat>()
  const stat = pick && stats.includes(pick) ? pick : stats[0]
  if (!props) return <p className="muted small">Loading props…</p>
  if (!props.length) return <p className="muted small">No player props posted for this game yet.</p>
  return (
    <div className="props">
      <div className="chips-pick">
        {stats.map(s => <button key={s} className={s === stat ? 'on' : ''} onClick={() => setPick(s)}>{PROP_STATS[s].name}</button>)}
      </div>
      {props.filter(p => p.stat === stat).map(p => (
        <div key={p.key} className="prop-block">
        <div className="prop-row">
          <img className="prop-face" src={p.who.logo} alt="" />
          <div className="prop-who"><b>{p.who.name}</b><small className="muted">{p.who.pos} · {p.who.team}</small></div>
          {(['over', 'under'] as const).map(side => {
            const leg = propLeg(p, side)
            return (
              <button key={side} className={`odds ${slip.some(l => l.id === leg.id) ? 'sel' : ''}`} onClick={() => toggleLeg(leg)}>
                <small>{side === 'over' ? 'O' : 'U'} {p.line}</small><span>{fmtOdds(PROP_ODDS)}</span>
              </button>
            )
          })}
        </div>
        {p.ladder.length > 0 && (
          <div className="prop-ladder">
            {p.ladder.map(r => {
              const leg = rungLeg(p, r)
              return (
                <button key={r.at} className={`odds ${slip.some(l => l.id === leg.id) ? 'sel' : ''}`} onClick={() => toggleLeg(leg)}>
                  <small>{r.at}+</small><span>{fmtOdds(r.odds)}</span>
                </button>
              )
            })}
          </div>
        )}
        </div>
      ))}
    </div>
  )
}

function OddsBtn({ g, price, prev }: { g: Game; price?: Price; prev: Map<string, number> }) {
  const { slip } = useStore()
  if (!price) return <button className="odds" disabled>—</button>
  const before = prev.get(price.id)
  const move = before === undefined || before === price.odds ? '' : price.odds > before ? 'up' : 'down'
  const line = price.market === 'spread' ? spreadText(price.line!) : price.market === 'total' ? `${price.side === 'over' ? 'O' : 'U'} ${price.line}` : ''

  return (
    <button
      // key on odds so the flash animation replays on every move
      key={price.odds}
      className={`odds ${slip.some(l => l.id === price.id) ? 'sel' : ''} ${move}`}
      onClick={() => toggleLeg(legFromPrice(g, price))}
    >
      {line && <small>{line}</small>}
      <span>{fmtOdds(price.odds)}</span>
    </button>
  )
}

const spreadText = (line: number) => (line > 0 ? `+${line}` : `${line}`)

/** The slip leg for one priced outcome. Shared by the sportsbook board and the Swipe feed. */
export function legFromPrice(g: Game, price: Price): Leg {
  const team = price.side === 'home' ? g.home : price.side === 'away' ? g.away : undefined
  const label = price.market === 'total' ? `${price.side === 'over' ? 'Over' : 'Under'} ${price.line}`
    : price.side === 'draw' ? 'Draw' : `${team!.name} ${price.market === 'ml' ? 'ML' : spreadText(price.line!)}`
  return {
    id: price.id, label, odds: price.odds,
    sub: `${g.away.abbr} @ ${g.home.abbr} · ${price.live ? 'Live ' : ''}${MARKET_NAME[price.market]}`,
    sport: { path: g.path, eventId: g.id, market: price.market, side: price.side, line: price.line },
    // Team picks show that team's logo; totals and draws show both teams.
    icon: team ? team.logo : g.away.logo, icon2: team ? undefined : g.home.logo,
  }
}
