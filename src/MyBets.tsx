import { useState } from 'react'
import { flexMax, fmtOdds, money, toAmerican, toDecimal, type Result } from './logic.ts'
import type { Game } from './odds.ts'
import { canRebet, cashOut, getAccounts, loadSlip, myName, useStore, type Bet, type Leg } from './store.ts'
import { cashOutValue, legProb } from './live.ts'
import { publishSlip, shareLink, tailLink } from './share.ts'
import { LegIcon } from './LegIcon.tsx'
import Watch, { legStatus } from './Watch.tsx'
import SquadScreen from './Squad.tsx'

const STATUS: Record<Result, { icon: string; text: string }> = {
  pending: { icon: '', text: 'Open' },
  won: { icon: '✓', text: 'Won' },
  lost: { icon: '✕', text: 'Lost' },
  push: { icon: '↺', text: 'Push' },
}

export default function MyBets({ games, onPlay, onRebet, onPickSquadLeg, squadFirst }: { games: Game[]; onPlay: (bet: Bet, leg: Leg) => void; onRebet: () => void; onPickSquadLeg: () => void; squadFirst?: boolean }) {
  const { bets } = useStore()
  const [view, setView] = useState<'open' | 'settled'>('open')
  const shown = bets.filter(b => (view === 'open') === (b.status === 'pending'))
  const byId = new Map(games.map(g => [g.id, g]))
  const prices = new Map(games.flatMap(g => g.prices.map(p => [p.id, p.odds] as const)))
  const [confirm, setConfirm] = useState<string>() // bet id waiting for a second tap
  const [watching, setWatching] = useState<string>() // bet id in the Watch party / Replay
  const [squadOpen, setSquadOpen] = useState(!!squadFirst)
  const [posted, setPosted] = useState<{ id: string; msg: string }>()
  const post = (b: Bet) => {
    const me = getAccounts().list.find(a => a.id === getAccounts().current)
    setPosted({ id: b.id, msg: publishSlip({ by: me?.name ?? 'Guest', avatar: me?.avatar ?? '🎟️', color: me?.color, accountId: me?.id, legs: b.legs }) })
  }
  const settled = bets.filter(b => b.status !== 'pending')
  const net = settled.reduce((t, b) => t + b.payout - b.stake, 0)

  return (
    <section>
      {watching && <Watch betId={watching} onClose={() => setWatching(undefined)} />}
      {squadOpen && <SquadScreen games={games} onClose={() => setSquadOpen(false)} onPickLeg={onPickSquadLeg} />}
      <button className="squad-entry" onClick={() => setSquadOpen(true)}><span>👥 Squad parlay</span><span className="muted small">Shared bank · everyone adds a leg each week ›</span></button>
      <div className="seg wide">
        <button className={view === 'open' ? 'on' : ''} onClick={() => setView('open')}>Open ({bets.length - settled.length})</button>
        <button className={view === 'settled' ? 'on' : ''} onClick={() => setView('settled')}>Settled ({settled.length})</button>
      </div>
      {view === 'settled' && settled.length > 0 && (
        <div className="record">
          <div><small>RECORD</small><b>{settled.filter(b => b.status === 'won').length}–{settled.filter(b => b.status === 'lost').length}</b></div>
          <div><small>NET</small><b className={net >= 0 ? 'win' : 'neg'}>{net >= 0 ? '+' : '−'}{money(Math.abs(net))}</b></div>
        </div>
      )}
      {!shown.length && <p className="muted">{view === 'open' ? 'No open bets.' : 'Nothing settled yet.'}</p>}
      {shown.map(b => {
        const odds = toAmerican(b.flex ? flexMax(100, b.legs.map(l => l.odds)) / 100 : b.legs.reduce((m, l) => m * toDecimal(l.odds), 1) * (b.sgpMult ?? 1))
        const hits = b.legs.filter(l => l.result === 'won').length
        const st = STATUS[b.status]
        return (
          <div key={b.id} className={`ticket ${b.status}`}>
            <div className="ticket-head">
              <div>
                <div className="tk-type">{b.legs.length > 1 ? `${b.legs.length}-Leg ${b.flex ? 'Flex ' : ''}Parlay` : 'Straight'}</div>
                <div className="tk-odds">{fmtOdds(odds)}</div>
                <div className="tk-tags">
                  {b.sgpMult && <span className="tk-tag sgp">SGP</span>}
                  {b.flex && <span className="tk-tag sgp">FLEX · 1 miss OK</span>}
                  {b.squad && <span className="tk-tag sgp">👥 SQUAD</span>}
                  {b.legs.some(l => l.chaos) && <span className="tk-tag boost">🎲 CHAOS</span>}
                  {b.boost && <span className="tk-tag boost">🚀 {Math.round(b.boost * 100)}% boost</span>}
                  {b.insured && <span className="tk-tag ins">🛡️ {b.refunded ? 'Insurance paid' : 'Insured'}</span>}
                  {b.xp && <span className="tk-tag xp">+{b.xp} XP</span>}
                </div>
              </div>
              <span className={`status ${b.status}`}>{b.cashedOut ? '💰 Cashed out' : <>{st.icon && <i>{st.icon}</i>}{st.text}</>}</span>
            </div>

            {b.legs.length > 1 && (
              <div className="progress" title={`${hits} of ${b.legs.length} legs hit`}>
                {b.legs.map(l => <span key={l.id} className={l.result} />)}
              </div>
            )}

            <div className="tk-legs">
              {b.legs.map(l => (
                <div key={l.id} className={`ticket-leg ${l.result}`}>
                  <span className={`leg-mark ${l.result}`}>{STATUS[l.result!].icon}</span>
                  <LegIcon leg={l} />
                  <span className="tk-leg-body">
                    <span className="tk-leg-label">{l.chaos && '🎲 '}{l.label}</span>
                    <span className="muted small">{l.sub}</span>
                    <span className="leg-live small">{b.status !== 'pending' && l.result === 'pending' ? (b.cashedOut ? 'Cashed out before this finished' : 'Not needed, ticket already settled') : legStatus(l, byId) + (l.note ? ` · ${l.note}` : '')}</span>
                  </span>
                  <span className="leg-right">
                    <b>{fmtOdds(l.odds)}</b>
                    {l.casino && l.result === 'pending' && b.status === 'pending' && (
                      <button className="play-leg" onClick={() => onPlay(b, l)}>{l.by ? `▶ Hand to ${l.by.split(' ')[0]}` : '▶ Play leg'}</button>
                    )}
                  </span>
                </div>
              ))}
            </div>

            <div className="ticket-foot">
              <div><small>WAGER</small><b>{money(b.stake)}</b></div>
              {b.status === 'pending'
                ? <div><small>TO PAY</small><b>{money(b.stake + (b.stake * toDecimal(odds) - b.stake) * (1 + (b.boost ?? 0)))}</b></div>
                : <div className="right"><small>{b.cashedOut ? 'CASHED OUT' : b.status === 'won' ? 'PAID' : b.status === 'push' || b.refunded ? 'REFUNDED' : 'RETURNED'}</small><b className={b.status === 'won' ? 'paid' : ''}>{money(b.payout)}</b></div>}
            </div>
            {b.legs.length > 1 && b.status !== 'pending' && !b.cashedOut && <button className="watch-btn" onClick={() => setWatching(b.id)}>🎬 Replay card</button>}
            {b.status === 'pending' && !b.flex && !b.squad && (() => {
              const value = cashOutValue(b.stake * (b.sgpMult ?? 1), b.legs, b.legs.map(l => chanceNow(l, byId, prices)))
              if (value === undefined) return null
              return confirm === b.id
                ? <div className="btnrow"><button className="ghost" onClick={() => setConfirm(undefined)}>Keep it</button><button className="cashout-btn sure" onClick={() => { cashOut(b.id, value); setConfirm(undefined) }}>Confirm {money(value)}</button></div>
                : <button className="cashout-btn" onClick={() => setConfirm(b.id)}>💰 Cash out {money(value)}</button>
            })()}
            {b.legs.length > 1 && !b.squad && <button className="share-btn" onClick={() => post(b)}>{posted?.id === b.id ? posted.msg : '📣 Post to Swipe for others to tail'}</button>}
            {b.status === 'pending' && <button className="share-btn" onClick={() => shareLink(tailLink(b.legs, myName()), `Tail my ${b.legs.length > 1 ? b.legs.length + '-leg parlay' : 'bet'} on Anyleg`)}>📤 Share to tail</button>}
            {canRebet(b) && (
              <button className="rebet-btn" onClick={() => { loadSlip(b.legs); onRebet() }}>↻ Re-bet these {b.legs.length} legs</button>
            )}
            <div className="tk-date small">{new Date(b.placedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
          </div>
        )
      })}
    </section>
  )
}

/** An open leg's chance of winning right now: live model mid-game, the current price before kickoff, else the price it was placed at. */
function chanceNow(l: Leg, games: Map<string, Game>, prices: Map<string, number>): number | undefined {
  if (l.result !== 'pending' || !l.sport || l.sport.prop) return undefined
  const g = games.get(l.sport.eventId)
  if (g?.live) return legProb(g.live, l.sport.market, l.sport.side, l.sport.line)
  const now = prices.get(l.id)
  return now === undefined ? undefined : 1 / toDecimal(now)
}
