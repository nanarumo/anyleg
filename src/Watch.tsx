// Replay card (settled ticket): a story-style recap of how each leg went, shareable.
import { useEffect, useState } from 'react'
import { fmtOdds, money, toAmerican, toDecimal } from './logic.ts'
import type { Game } from './odds.ts'
import { myName, useStore, type Bet, type Leg } from './store.ts'
import { LegIcon } from './LegIcon.tsx'
import { ROUND_NAME } from './Casino.tsx'
import { shareLink, tailLink } from './share.ts'
import { sfx } from './sound.ts'
import { leave } from './motion.ts'

export function legStatus(l: Leg, games: Map<string, Game>): string {
  if (l.result !== 'pending') return l.result === 'push' ? 'Push, leg voided' : l.result === 'won' ? 'Hit' : 'Missed'
  if (l.casino) return l.by ? `${l.by}'s leg: only they play this ${ROUND_NAME[l.casino.game]}` : `Ready: play your free ${ROUND_NAME[l.casino.game]}`
  const g = games.get(l.sport!.eventId)
  if (!g) return 'Waiting for result'
  if (g.state === 'pre') return `Starts ${new Date(g.start).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`
  return `${g.state === 'in' ? 'LIVE · ' : ''}${g.away.abbr} ${g.away.score ?? 0} – ${g.home.abbr} ${g.home.score ?? 0} · ${g.detail}`
}

const ticketOdds = (b: Bet) => toAmerican(b.legs.reduce((m, l) => m * toDecimal(l.odds), 1) * (b.sgpMult ?? 1))

export default function Watch({ betId, onClose }: { betId: string; onClose: () => void }) {
  const bet = useStore().bets.find(b => b.id === betId)!
  const order = bet.legs.map(l => l.id)
  const [step, setStep] = useState(0) // order.length = the summary card
  const leg = bet.legs.find(l => l.id === order[step])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])
  useEffect(() => {
    if (!leg) return
    if (leg.result === 'won') sfx.legHit()
    else if (leg.result === 'lost') sfx.lose()
    const t = setTimeout(() => setStep(s => s + 1), 2300)
    return () => clearTimeout(t)
  }, [step])

  const hits = bet.legs.filter(l => l.result === 'won').length
  const share = () => {
    const lines = order.map(id => bet.legs.find(l => l.id === id)!).map(l => `${l.result === 'won' ? '✅' : l.result === 'lost' ? '❌' : l.result === 'push' ? '↺' : '⏳'} ${l.label}`)
    const end = bet.status === 'won' ? `Cashed ${money(bet.payout)} on ${money(bet.stake)} 💰` : `${hits} of ${bet.legs.length} hit. So close.`
    shareLink(tailLink(bet.legs, myName()), `My ${bet.legs.length}-leg Anyleg parlay ${fmtOdds(ticketOdds(bet))}\n${lines.join('\n')}\n${end}`)
  }

  return (
    <div className="game-screen watch">
      <div className="story-bars">
        {[...order, 'end'].map((id, i) => <span key={id} className={i < step ? 'done' : i === step ? 'now' : ''} style={i === step && step < order.length ? { animationDuration: '2.3s' } : undefined} />)}
      </div>
      <header className="watch-head">
        <span className="watch-kicker">🎬 Replay · {bet.legs.length}-leg parlay {fmtOdds(ticketOdds(bet))}</span>
        <button className="icon-btn" onClick={e => leave(e, onClose)} aria-label="Close">✕</button>
      </header>

      <div className="watch-stage" onClick={e => {
        if ((e.target as HTMLElement).closest('button')) return
        const left = e.clientX < window.innerWidth / 3
        setStep(s => Math.max(0, Math.min(order.length, s + (left ? -1 : 1))))
      }}>
        {leg ? (
          <div key={leg.id + step} className={`watch-card ${leg.result}`}>
            <div className="watch-step">LEG {step + 1} OF {order.length}</div>
            <div className="watch-icon"><LegIcon leg={leg} /></div>
            <div className="watch-label">{leg.label}{leg.chaos && <span className="tk-tag boost">🎲 CHAOS</span>}</div>
            <div className="muted small">{leg.sub} · {fmtOdds(leg.odds)}</div>
            <div className="watch-result">
              {leg.result === 'pending' ? <span className="watch-wait">{bet.cashedOut ? 'Cashed out before this finished' : 'Not needed, ticket already settled'}</span>
                : <><span className={`watch-stamp ${leg.result}`}>{leg.result === 'won' ? 'HIT ✓' : leg.result === 'lost' ? 'MISSED ✕' : 'PUSH'}</span>{leg.note && <span className="muted">{leg.note}</span>}</>}
            </div>
          </div>
        ) : (
          <div className={`watch-card summary ${bet.status}`}>
            <div className="watch-step">HOW IT ENDED</div>
            <div className="watch-big">{bet.status === 'won' ? `+${money(bet.payout)}` : bet.status === 'lost' ? 'BUSTED' : 'PUSH'}</div>
            <div className="muted">{hits} of {bet.legs.length} legs hit · {money(bet.stake)} at {fmtOdds(ticketOdds(bet))}</div>
            <div className="watch-dots">{order.map(id => { const l = bet.legs.find(x => x.id === id)!; return <span key={id} className={l.result} title={l.label}><LegIcon leg={l} /></span> })}</div>
            <div className="btnrow">
              <button className="ghost" onClick={() => setStep(0)}>↻ Watch again</button>
              <button className="cta" onClick={share}>📤 Share recap</button>
            </div>
          </div>
        )}
      </div>
      <div className="watch-tracker">
        {order.map((id, i) => { const l = bet.legs.find(x => x.id === id)!; return <span key={id} className={`${l.result} ${i === step ? 'now' : ''}`} /> })}
      </div>
    </div>
  )
}
