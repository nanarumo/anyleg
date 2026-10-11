// Squads: a shared bank and one weekly group parlay where every member adds one leg.
// ponytail: squadmates are bots or friends playing on this phone; real multi-phone squads come with the backend.
import { useEffect, useState } from 'react'
import { fmtOdds, money, parlayDecimal, toAmerican, type CasinoGame, type Result } from './logic.ts'
import type { Game } from './odds.ts'
import { pickForSquad, createSquad, fundSquad, getAccounts, getState, leaveSquad, placeSquad, setSquadPick, squadNewWeek, useStore, withdrawSquad, type Leg, type SquadMember } from './store.ts'
import { legFromPrice } from './Sportsbook.tsx'
import { CASINO_PICKS, casinoLeg } from './Casino.tsx'
import { LegIcon } from './LegIcon.tsx'
import { leave } from './motion.ts'

/** `n` random, sensible legs (board moneylines/spreads and casino legs, one per game) for bots to pick. */
export function botLegs(games: Game[], n: number, avoid: string[] = []): Leg[] {
  const sports = games.filter(g => g.state === 'pre').flatMap(g => g.prices.filter(p => (p.market === 'ml' || p.market === 'spread') && p.side !== 'draw' && p.odds >= -250 && p.odds <= 200).map(p => legFromPrice(g, p)))
  const casino = (Object.keys(CASINO_PICKS) as CasinoGame[]).flatMap(g => CASINO_PICKS[g].filter(p => p.odds >= -250 && p.odds <= 300).map(p => casinoLeg(g, p.pick)!))
  const out: Leg[] = []
  const used = new Set(avoid)
  for (let tries = 0; out.length < n && tries < 200; tries++) {
    const pool = sports.length && Math.random() < 0.6 ? sports : casino
    const l = pool[Math.floor(Math.random() * pool.length)]
    const key = l.sport ? l.sport.eventId : l.id
    if (!used.has(key) && !used.has(l.id)) { used.add(key); used.add(l.id); out.push(l) }
  }
  return out
}

export const SQUAD_BOTS: SquadMember[] = [
  { name: 'Lucky Lou', avatar: '🍀', bot: true }, { name: 'Sharp Sam', avatar: '🦈', bot: true }, { name: 'Parlay Pete', avatar: '🎯', bot: true },
  { name: 'Casino Queen', avatar: '👑', bot: true }, { name: 'Hedge Hank', avatar: '🦔', bot: true },
]

/** `onPickLeg`: leave to the Sportsbook so the next line/leg tapped anywhere becomes that member's squad leg. */
export default function SquadScreen({ games, onClose, onPickLeg }: { games: Game[]; onClose: () => void; onPickLeg: () => void }) {
  const { squad } = useStore()
  useEffect(() => { squadNewWeek() }, [])
  return (
    <div className="game-screen duel squad-screen">
      <header className="gs-bar">
        <button className="gs-back" onClick={e => leave(e, onClose)}>‹ My Bets</button>
        <div className="gs-title">👥 {squad?.name ?? 'Squads'}</div>
        <div className="gs-right" />
      </header>
      <div className="gs-body">{squad ? <SquadHome games={games} onClose={onClose} onPickLeg={onPickLeg} /> : <CreateSquad />}</div>
    </div>
  )
}

function CreateSquad() {
  const { list, current } = getAccounts()
  const me = list.find(a => a.id === current)
  const you: SquadMember = { name: me?.name ?? 'You', avatar: me?.avatar ?? '⚡' }
  const options: SquadMember[] = [...list.filter(a => a.id !== current).map(a => ({ name: a.name, avatar: a.avatar })), ...SQUAD_BOTS]
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<string[]>(['Lucky Lou', 'Sharp Sam'])
  const [err, setErr] = useState<string>()
  return (
    <div className="duel-card">
      <h2>👥 Start a squad</h2>
      <p className="muted small">Pool money into a shared bank. Each week every member adds one leg to the squad parlay, the bank stakes it, and wins go back into the bank.</p>
      <label className="field"><span>Squad name</span><input value={name} onChange={e => setName(e.target.value)} maxLength={24} placeholder="The Degens" /></label>
      <div className="field"><span>Squadmates (up to 4)</span>
        <div className="chips-pick">
          {options.map(m => <button key={m.name} className={picked.includes(m.name) ? 'on' : ''} onClick={() => setPicked(p => (p.includes(m.name) ? p.filter(x => x !== m.name) : p.length < 4 ? [...p, m.name] : p))}>{m.avatar} {m.name}{m.bot ? ' 🤖' : ''}</button>)}
        </div>
        <span className="muted small">Bots pick their own legs. Friends on this phone pick theirs from the bet slip.</span>
      </div>
      {err && <p className="warn small">{err}</p>}
      <button className="cta" onClick={() => setErr(createSquad(name, [you, ...options.filter(m => picked.includes(m.name))]))}>Create squad</button>
    </div>
  )
}

function SquadHome({ games, onClose, onPickLeg }: { games: Game[]; onClose: () => void; onPickLeg: () => void }) {
  const { squad, balance, bets } = useStore()
  const q = squad!
  const [stake, setStake] = useState(25)
  const [msg, setMsg] = useState<string>()
  const [custom, setCustom] = useState('')
  const [fundMsg, setFundMsg] = useState<string>()
  const addCustom = async () => { const v = Math.round(Number(custom) * 100) / 100; const err = await fundSquad(v); setFundMsg(err); if (!err) setCustom('') }
  const bet = q.betId ? bets.find(b => b.id === q.betId) : undefined
  // Bots fill their spot as soon as there are lines to pick from.
  useEffect(() => {
    if (q.betId) return
    q.members.forEach((m, i) => {
      if (!m.bot || q.picks[i]) return
      const [l] = botLegs(games, 1, getState().squad!.picks.flatMap(p => (p ? [p.id, p.sport?.eventId ?? p.id] : [])))
      if (l) setSquadPick(i, l)
    })
  }, [games.length, q.week, q.betId])
  const legs = q.picks.filter(Boolean) as Leg[]
  const odds = legs.length > 1 ? fmtOdds(toAmerican(parlayDecimal(legs).dec)) : '—'
  const ready = legs.length === q.members.length

  return (
    <div className="squad">
      <div className="duel-card">
        <div className="squad-members">{q.members.map(m => <span key={m.name} title={m.name}>{m.avatar}<small>{m.name.split(' ')[0]}</small></span>)}</div>
        <div className="squad-bank"><small>SQUAD BANK</small><b>{money(q.bank)}</b></div>
        <div className="quick">
          {[25, 100, 250].map(v => <button key={v} disabled={v > balance} onClick={async () => setFundMsg(await fundSquad(v))}>+${v}</button>)}
          <button disabled={!q.bank} onClick={() => withdrawSquad(q.bank)}>Withdraw all</button>
        </div>
        <form className="squad-custom" onSubmit={e => { e.preventDefault(); addCustom() }}>
          <span>$</span>
          <input type="number" inputMode="decimal" min="1" step="1" placeholder="Custom amount" value={custom} onChange={e => { setCustom(e.target.value); setFundMsg(undefined) }} />
          <button className="cta" disabled={!(Number(custom) > 0) || Number(custom) > balance}>Add to bank</button>
        </form>
        {fundMsg && <p className="warn small">{fundMsg}</p>}
      </div>

      <div className="duel-card">
        <div className="squad-week"><b>This week's squad parlay</b><span className="big-odds">{odds}</span></div>
        {q.members.map((m, i) => {
          const l = q.picks[i]
          const settled = bet?.legs.find(x => x.id === l?.id)
          return (
            <div key={m.name} className="squad-pick">
              <span className="squad-ava">{m.avatar}</span>
              {l ? <><LegIcon leg={l} /><div className="squad-leg"><b>{l.label}</b><span className="muted small">{m.name} · {l.sub}</span></div><b className={settled?.result}>{settled && settled.result !== 'pending' ? (settled.result === 'won' ? '✓' : settled.result === 'lost' ? '✕' : '↺') : fmtOdds(l.odds)}</b></>
                : <div className="squad-leg"><b>{m.name}</b><span className="muted small">{m.bot ? 'Picking…' : 'Needs a leg'}</span></div>}
              {!q.betId && !m.bot && <button className="ghost small-btn" onClick={() => { pickForSquad(i); onPickLeg() }}>{l ? 'Change' : 'Add leg'}</button>}
            </div>
          )
        })}
        {bet ? <>
          <p className="muted">Locked: {money(bet.stake)} from the bank · {bet.status === 'pending' ? 'play your own casino legs in My Bets (each squadmate plays the legs they added)' : bet.status === 'won' ? `won ${money(bet.payout)} into the bank 🎉` : bet.status === 'lost' ? 'it missed.' : bet.status}</p>
          {bet.status !== 'pending' && <button className="cta" onClick={() => squadNewWeek(true)}>🔁 Build the next squad parlay</button>}
        </> : <>
          <div className="quick">{[10, 25, 50, 100].map(v => <button key={v} className={stake === v ? 'on' : ''} disabled={v > q.bank} onClick={() => setStake(v)}>${v}</button>)}</div>
          <button className="cta" disabled={!ready || stake > q.bank} onClick={async () => setMsg((await placeSquad(stake)) ?? 'Squad parlay locked! It’s in My Bets.')}>
            {ready ? `Lock it · ${money(stake)} from the bank` : `Waiting on ${q.members.length - legs.length} leg${q.members.length - legs.length > 1 ? 's' : ''}`}
          </button>
          {stake > q.bank && <p className="muted small">Add money to the squad bank to stake this.</p>}
        </>}
        {msg && <p className="toast">{msg}</p>}
      </div>
      <button className="link" onClick={e => { if (confirm('Leave the squad? The bank comes back to your balance.')) leave(e, () => { leaveSquad(); onClose() }) }}>Leave squad</button>
    </div>
  )
}

// ---- squadmates watch a squad leg being played ----
const CHEERS: Record<Result, string[]> = {
  pending: ['👀', '🤞', '🙏', '😬', '🍿'],
  won: ["🔥 LET'S GO", '🙌 Clutch!', '💰 Money', '🐐 Goat', '🎉 Yesss'],
  lost: ['💀 Brutal', '😩 Nooo', '🫠 Pain', '🤦 Ugh', '😭 Robbed'],
  push: ['😐 Push', '🤷 Meh'],
}
const pickFor = (name: string, list: string[]) => list[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % list.length]

/** Strip on the table while a squad leg is played: who's watching, and how they react to the result. */
export function SquadWatch({ watchers, player, result }: { watchers: SquadMember[]; player: string; result?: Result }) {
  return (
    <div className="squad-watch">
      <span className="muted small">👥 Squad watching {player}</span>
      <div className="squad-watchers">
        {watchers.map(m => (
          <span key={m.name} className="watcher" title={m.name}>
            <span className="w-ava">{m.avatar}</span>
            <span key={result ?? 'live'} className={`w-bubble ${result ?? ''}`}>{pickFor(m.name, CHEERS[result ?? 'pending'])}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
