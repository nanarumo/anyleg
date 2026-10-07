import { useRef, useState } from 'react'
import { CHAOS_BOOST, FLEX_MIN, flexMax, fmtOdds, money, parlayDecimal, settleFlex, toAmerican, toDecimal } from './logic.ts'
import { BOOST_PCT, MAX_LEGS, clearSlip, getState, myName, placeBet, removeLeg, useAccounts, useStore, type BoostKey, type Leg } from './store.ts'
import type { CasinoGame } from './logic.ts'
import { CASINO_PICKS, casinoLeg } from './Casino.tsx'
import { LegIcon } from './LegIcon.tsx'
import { publishSlip, shareLink, tailLink } from './share.ts'
import { leave } from './motion.ts'

export default function BetSlip({ onClose }: { onClose: () => void }) {
  const { slip, balance, inv } = useStore()
  const [boost, setBoost] = useState<BoostKey>()
  const [insure, setInsure] = useState(false)
  const [flexOn, setFlex] = useState(false)
  const [chaosOn, setChaos] = useState(false)
  const accts = useAccounts()
  const [mode, setMode] = useState<'parlay' | 'singles'>('parlay')
  const [stake, setStake] = useState(() => String(getState().settings.defaultStake))
  const [msg, setMsg] = useState<string>()
  const s = Number(stake) > 0 ? Number(stake) : 0
  const stakeInput = useRef<HTMLInputElement>(null)
  const casinoIn = slip.some(l => l.casino)
  const isParlay = (mode === 'parlay' || casinoIn) && slip.length > 1
  const maxStake = Math.floor(isParlay ? balance : balance / Math.max(1, slip.length))
  const { dec, sgpGames } = parlayDecimal(slip) // same-game legs are priced together
  const cost = isParlay ? s : s * slip.length
  const canFlex = isParlay && slip.length >= FLEX_MIN && !sgpGames
  const flex = canFlex && flexOn
  const odds = slip.map(l => l.odds)
  // One miss pays the parlay of the other legs; missing the longest shot pays least.
  const oneMiss = flex ? odds.map((_, i) => settleFlex(odds.map((_, j) => (j === i ? 'lost' : 'won')), s, odds).payout) : []
  const canChaos = !flex && (isParlay || slip.length === 1)
  const chaos = canChaos && chaosOn
  const boostable = (isParlay && !flex) || slip.length === 1 // a boost token goes on one ticket: a parlay or a single straight bet
  const useBoost = boostable && boost && inv[boost] > 0 ? boost : undefined
  const useInsure = isParlay && !flex && insure && slip.length >= 4 && inv.insurance > 0
  const boostMult = useBoost ? 1 + BOOST_PCT[useBoost] / 100 : 1
  const toWin = flex ? flexMax(s, odds) - s : boostable ? (s * dec - s) * boostMult : slip.reduce((t, l) => t + s * (toDecimal(l.odds) - 1), 0)
  const boosts = (Object.keys(BOOST_PCT) as BoostKey[]).filter(k => inv[k] > 0)
  const sports = slip.filter(l => l.sport).length
  const casino = slip.length - sports

  const place = () => {
    const mystery = chaos ? rollChaos(slip) : undefined
    const err = placeBet(s, isParlay || chaos ? 'parlay' : 'singles', { boost: useBoost, insure: useInsure, flex, chaos: mystery })
    if (!err) { setBoost(undefined); setInsure(false); setFlex(false); setChaos(false) }
    const ok = mystery ? `🎲 Chaos leg revealed: ${mystery.label} (${fmtOdds(mystery.odds)}). ${slip.length + 1}-leg parlay locked!`
      : (isParlay ? `${slip.length}-leg ${flex ? 'flex ' : ''}parlay placed!` : 'Bets placed!') + (casino ? ' Play your casino legs free from My Bets.' : '')
    setMsg(err ?? ok)
    if (!err) {
      setTimeout(() => leave('.slip.open', onClose), mystery ? 2600 : 1200) // flash the confirmation, then get the empty slip out of the way
      setTimeout(() => setMsg(undefined), 4000)
    }
  }

  return (
    <div className="slip-inner">
      <div className="slip-head">
        <h3>Bet Slip <span className="count">{slip.length}</span></h3>
        {slip.length > 1 && <button className="slip-share" onClick={() => { const me = accts.list.find(a => a.id === accts.current); setMsg(publishSlip({ by: me?.name ?? 'Guest', avatar: me?.avatar ?? '🎟️', color: me?.color, accountId: me?.id, legs: slip })) }} aria-label="Post slip to Swipe">📣 Post</button>}
        {slip.length > 0 && <button className="slip-share" onClick={async () => setMsg(await shareLink(tailLink(slip, myName()), `Tail my ${slip.length}-leg slip on Anyleg`) || undefined)} aria-label="Share slip">📤 Share</button>}
        <button className="slip-close mobile-only" onClick={e => leave(e, onClose)} aria-label="Close bet slip">✕ Close</button>
      </div>

      {slip.length > 1 && (
        <div className="seg">
          <button className={mode === 'parlay' ? 'on' : ''} onClick={() => setMode('parlay')}>Parlay</button>
          <button className={mode === 'singles' ? 'on' : ''} onClick={() => setMode('singles')} disabled={casino > 0} title={casino ? 'Casino legs only count inside a parlay' : undefined}>Singles</button>
        </div>
      )}
      {casino > 0 && slip.length < 2 && <p className="warn small">Casino legs only count inside a parlay. Add another leg to place it.</p>}

      {!slip.length && (
        <div className="empty">
          <b>Parlay anything.</b>
          <p className="muted small">Tap odds in the Sportsbook, then add legs from the Casino tables, like Dealer busts or Next spin Red. They all stack into one ticket.</p>
        </div>
      )}

      {isParlay && (
        <div className="parlay-banner">
          <div>
            <b>{slip.length}-Leg {sgpGames && slip.length === sports && sgpGames === 1 ? 'Same Game ' : sports && casino ? 'Mixed ' : ''}Parlay</b>
            <div className="small">{sgpGames > 0 && <span className="sgp-tag">SGP</span>}{sports > 0 && `${sports} sports`}{sports > 0 && casino > 0 && ' · '}{casino > 0 && `${casino} casino`}</div>
          </div>
          <b className="big-odds">{fmtOdds(toAmerican(flex ? flexMax(100, odds) / 100 : dec))}</b>
        </div>
      )}

      <div className={isParlay ? 'legs chain' : 'legs'}>
        {slip.map(l => (
          <div key={l.id} className={`leg ${l.casino ? 'is-casino' : ''}`}>
            <LegIcon leg={l} />
            <div className="leg-body">
              <div className="leg-label">{l.label}</div>
              <div className="muted small">{l.sub}</div>
            </div>
            <div className={`leg-odds ${l.moved ?? ''}`}>{l.moved === 'up' ? '▲ ' : l.moved === 'down' ? '▼ ' : ''}{fmtOdds(l.odds)}</div>
            <button className="x" onClick={() => removeLeg(l.id)} aria-label="Remove">×</button>
          </div>
        ))}
      </div>

      {slip.length >= MAX_LEGS && <p className="warn small">Max {MAX_LEGS} legs per parlay.</p>}

      {slip.length > 0 && (
        <>
          {slip.some(l => l.moved) && <p className="warn small">Odds changed. Placing accepts the new prices.</p>}
          <label className="row">
            <span>{isParlay ? 'Wager' : slip.length > 1 ? 'Wager per bet' : 'Wager'}</span>
            <input ref={stakeInput} type="number" inputMode="decimal" min="0" step="1" value={stake} onChange={e => setStake(e.target.value)} />
          </label>
          <div className="quick">
            {/* Chips add to the wager (tap $100 twice = $200), capped at what you can afford. */}
            {[5, 10, 25, 100].map(v => <button key={v} onClick={() => setStake(String(Math.min(maxStake, +((Number(stake) || 0) + v).toFixed(2))))}>+${v}</button>)}
            <button onClick={() => setStake(String(maxStake))}>Max</button>
            <button onClick={() => { setStake(''); stakeInput.current?.focus() }}>Custom</button>
          </div>
          {canFlex && (
            <label className="set-row toggle-row flex-row">
              <div><b>Flex</b><div className="muted small">One leg can miss and you still get paid. All hits pays a little less.</div></div>
              <input type="checkbox" className="switch" checked={flexOn} onChange={e => setFlex(e.target.checked)} />
            </label>
          )}
          {canChaos && (
            <label className={`set-row toggle-row flex-row chaos-row ${chaos ? 'on' : ''}`}>
              <div><b>🎲 Chaos leg</b><div className="muted small">A mystery casino leg (+100 to +800) joins the ticket when you lock it. +{Math.round(CHAOS_BOOST * 100)}% profit boost.</div></div>
              <input type="checkbox" className="switch" checked={chaosOn} onChange={e => setChaos(e.target.checked)} />
            </label>
          )}
          {((boostable && boosts.length > 0) || (isParlay && inv.insurance > 0)) && (
            <div className="tokens">
              {boostable && boosts.map(k => (
                <button key={k} className={`token ${boost === k ? 'on' : ''}`} onClick={() => setBoost(boost === k ? undefined : k)}>
                  🚀 {BOOST_PCT[k]}% Boost <span className="muted small">×{inv[k]}</span>
                </button>
              ))}
              {isParlay && inv.insurance > 0 && (
                <button className={`token ${useInsure ? 'on' : ''}`} disabled={slip.length < 4} title="Refunds your stake if you miss by exactly one leg (4+ legs)" onClick={() => setInsure(!insure)}>
                  🛡️ Insurance <span className="muted small">{slip.length < 4 ? '4+ legs' : `×${inv.insurance}`}</span>
                </button>
              )}
            </div>
          )}
          <div className="row"><span>Total wager</span><b>{money(cost)}</b></div>
          {flex && s > 0 && <div className="row"><span>1 leg misses</span><b>{money(Math.min(...oneMiss))}–{money(Math.max(...oneMiss))}</b></div>}
          <div className="row"><span>{flex ? 'All hit, to win' : chaos ? 'To win before the chaos leg' : 'To win'}{useBoost ? ` (+${BOOST_PCT[useBoost]}% boost)` : ''}</span><b className="win">{money(toWin)}</b></div>
          <button className="primary" onClick={place} disabled={!s || cost > balance || (casino > 0 && slip.length < 2 && !chaos)}>
            {chaos ? `🎲 Lock it · reveal the chaos leg` : isParlay ? `Place parlay · pays ${money(s + toWin)}` : `Place ${slip.length > 1 ? `${slip.length} bets` : 'bet'} · ${money(cost)}`}
          </button>
          <button className="link" onClick={e => leave(e, () => { clearSlip(); onClose() })}>Clear slip</button>
        </>
      )}
      {msg && <p className="toast">{msg}</p>}
    </div>
  )
}

/** A random casino leg priced +100 to +800 that isn't already on the ticket. */
function rollChaos(slip: Leg[]): Leg {
  const pool = (Object.keys(CASINO_PICKS) as CasinoGame[])
    .flatMap(g => CASINO_PICKS[g].filter(p => p.odds >= 100 && p.odds <= 800).map(p => casinoLeg(g, p.pick)!))
    .filter(l => !slip.some(x => x.id === l.id))
  return pool[Math.floor(Math.random() * pool.length)]
}
