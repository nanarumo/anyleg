// 1v1 Blackjack Duel, pass-and-play: player 1 plays every hand, hands the phone over, player 2 plays the
// exact same cards, then a recap shows where their decisions split.
// ponytail: one device only; online duels need a shared backend (the duel is just a seed + moves, so it will sync easily).
import { useState } from 'react'
import { handValue, isBlackjack, type Card } from './logic.ts'
import { BOTS, MIN_BET, START_STACK, botRun, canDo, deal, finished, newDuel, play, streams, winner, type BotLevel, type Duel, type Move, type Round } from './duel.ts'
import { useAccounts } from './store.ts'
import { CardView } from './Cards.tsx'
import { Chip } from './Casino.tsx'
import { leave } from './motion.ts'

const BETS = [10, 25, 50, 100, 250, 500]
const chips = (n: number) => n.toLocaleString()

export default function DuelScreen({ onExit }: { onExit: () => void }) {
  const [duel, setDuel] = useState<Duel>()
  const [turnOver, setTurnOver] = useState(false) // current player tapped through their last hand
  if (!duel) return <Shell onExit={onExit} title="1v1 Duel"><Setup onStart={d => setDuel(d)} /></Shell>

  const me = duel.players[duel.turn]
  const update = (p: typeof me) => setDuel(d => {
    const players = [...d!.players] as Duel['players']
    players[d!.turn] = p
    // vs a bot it races you live: after each of your hands it plays the same cards (Shark only sees hands already played).
    if (d!.bot) players[1] = botRun(d!.seed, d!.length, d!.bot, p, p.rounds.filter(r => r.over).length)
    return { ...d!, players }
  })

  if (turnOver && duel.turn === 0 && !duel.bot) {
    return (
      <Shell onExit={onExit} title="1v1 Duel">
        <div className="duel-card center">
          <div className="duel-kicker">{me.name} finished with</div>
          <div className="duel-big">{chips(me.stack)} chips</div>
          <p className="muted">Pass the phone to <b>{duel.players[1].name}</b>. They get the exact same cards, so no peeking at the recap until they're done.</p>
          <button className="cta" onClick={() => { setTurnOver(false); setDuel({ ...duel, turn: 1 }) }}>I'm {duel.players[1].name}, start</button>
        </div>
      </Shell>
    )
  }
  if (turnOver) return <Shell onExit={onExit} title="Duel results"><Results duel={duel} onRematch={() => { setTurnOver(false); setDuel(newDuel(duel.players[0].name, duel.players[1].name, duel.length, duel.bot)) }} /></Shell>

  return (
    <Shell onExit={onExit} title={`${me.name}'s turn`}>
      <Table key={duel.turn} duel={duel} onChange={update} onTurnOver={() => {
        // Against a bot, it plays the same cards the moment you finish (the Shark sizes bets off your run).
        if (duel.bot) setDuel({ ...duel, players: [duel.players[0], botRun(duel.seed, duel.length, duel.bot, duel.players[0])] })
        setTurnOver(true)
      }} />
    </Shell>
  )
}

function Shell({ title, onExit, children }: { title: string; onExit: () => void; children: React.ReactNode }) {
  return (
    <div className="game-screen gs-blackjack duel">
      <header className="gs-bar">
        <button className="gs-back" onClick={e => leave(e, onExit)} aria-label="Back to lobby">‹ Lobby</button>
        <div className="gs-title">{title}</div>
        <div className="gs-right" />
      </header>
      <div className="gs-body">{children}</div>
    </div>
  )
}

function Setup({ onStart }: { onStart: (d: Duel) => void }) {
  const { current, list } = useAccounts()
  const mine = list.find(a => a.id === current)?.name ?? ''
  const [a, setA] = useState(mine || 'Player 1')
  const [b, setB] = useState('')
  const [len, setLen] = useState(10)
  const [vs, setVs] = useState<'friend' | 'bot'>('friend')
  const [bot, setBot] = useState<BotLevel>('pro')
  const others = list.filter(x => x.id !== current).map(x => x.name)
  const ok = a.trim() && (vs === 'bot' || (b.trim() && a.trim().toLowerCase() !== b.trim().toLowerCase()))
  return (
    <div className="duel-card">
      <h2>⚔️ 1v1 Blackjack Duel</h2>
      <p className="muted small">Both players start with {chips(START_STACK)} chips and play the <b>same cards</b>, hand for hand. Luck cancels out: your hits, stands, doubles, splits and bet sizes decide it. Most chips at the end wins.</p>
      <label className="field"><span>Player 1</span><input value={a} onChange={e => setA(e.target.value)} maxLength={20} /></label>
      <div className="seg">
        <button className={vs === 'friend' ? 'on' : ''} onClick={() => setVs('friend')}>👥 vs Friend</button>
        <button className={vs === 'bot' ? 'on' : ''} onClick={() => setVs('bot')}>🤖 vs Bot</button>
      </div>
      {vs === 'friend' ? <>
        <label className="field"><span>Player 2</span><input value={b} onChange={e => setB(e.target.value)} maxLength={20} placeholder="Your friend's name" /></label>
        {others.length > 0 && <div className="chips-pick">{others.map(n => <button key={n} className={n === b ? 'on' : ''} onClick={() => setB(n)}>{n}</button>)}</div>}
      </> : (
        <div className="bot-pick">
          {(Object.keys(BOTS) as BotLevel[]).map(k => (
            <button key={k} className={bot === k ? 'on' : ''} onClick={() => setBot(k)}>
              <span className="bot-ico">{BOTS[k].icon}</span><b>{BOTS[k].name}</b><small className="muted">{BOTS[k].blurb}</small>
            </button>
          ))}
        </div>
      )}
      <div className="field"><span>Hands each</span>
        <div className="seg">{[10, 20].map(n => <button key={n} className={len === n ? 'on' : ''} onClick={() => setLen(n)}>{n} hands</button>)}</div>
      </div>
      <button className="cta" disabled={!ok} onClick={() => onStart(vs === 'bot' ? newDuel(a.trim(), BOTS[bot].name, len, bot) : newDuel(a.trim(), b.trim(), len))}>Start duel</button>
      <p className="muted small">vs Friend is pass-and-play on this phone. Online duels against friends on their own phones come with the online backend.</p>
    </div>
  )
}

function Table({ duel, onChange, onTurnOver }: { duel: Duel; onChange: (p: Duel['players'][number]) => void; onTurnOver: () => void }) {
  const me = duel.players[duel.turn]
  const cur = me.rounds.find(r => !r.over)
  const last = me.rounds[me.rounds.length - 1]
  const shown = cur ?? (last?.over ? last : undefined)
  const handNo = me.rounds.filter(r => r.over).length + (cur ? 1 : 0)
  const [bet, setBet] = useState(MIN_BET)
  const [between, setBetween] = useState(false) // showing the last hand's result before betting the next
  const stackNow = me.stack

  const settle = (r: Round) => onChange({ ...me, stack: r.over ? me.stack + r.delta : me.stack, rounds: [...me.rounds.filter(x => x !== cur), r] })
  const start = () => {
    const b = Math.min(bet, stackNow)
    const r = deal(duel.seed, me.rounds.length, b)
    setBetween(r.over)
    settle(r)
  }
  const act = (m: Move) => {
    const r = play(duel.seed, cur!, m, stackNow)
    if (r.over) setBetween(true)
    settle(r)
  }
  const can = cur ? canDo(cur, stackNow) : undefined
  const holeHidden = !!cur
  const visible = shown && (between || cur)

  return (
    <section className="casino">
      <div className="duel-score">
        <span>Hand <b>{Math.min(handNo || 1, duel.length)}</b> / {duel.length}</span>
        <span className="duel-stack"><Chip value={Math.max(stackNow, 1)} size={22} /> {chips(stackNow)}</span>
        <span>{me.name}</span>
      </div>
      {duel.bot && (() => {
        const bot = duel.players[1]
        const br = bot.rounds[bot.rounds.length - 1]
        const lead = stackNow - bot.stack
        return (
          <div className="duel-race">
            <div className="duel-race-score">
              <span>You <b>{chips(stackNow)}</b></span>
              <span className={lead > 0 ? 'pos' : lead < 0 ? 'neg' : ''}>{lead > 0 ? `+${chips(lead)} ahead` : lead < 0 ? `${chips(-lead)} behind` : 'Tied'}</span>
              <span>{BOTS[duel.bot].icon} <b>{chips(bot.stack)}</b></span>
            </div>
            {br && between && !cur && (
              <div className="duel-race-last muted small">
                {BOTS[duel.bot].name}: bet {chips(br.bet)} · {br.moves.length ? br.moves.map(m => MOVE_NAME[m]).join(', ') : 'no decision'} · <b className={br.delta > 0 ? 'pos' : br.delta < 0 ? 'neg' : ''}>{br.delta > 0 ? '+' : br.delta < 0 ? '−' : '±'}{chips(Math.abs(br.delta))}</b>
              </div>
            )}
          </div>
        )
      })()}
      <div className="bj-felt">
        <div className="zone dealer-zone">
          <div className="cards">
            {visible && shown.dealer.map((c, i) => <CardView key={`${shown.n}d${i}`} c={c} i={i} faceDown={holeHidden && i === 1} delay={i < 2 ? i * 0.3 + 0.15 : 0} />)}
          </div>
          {visible && <span className="total">{handValue(holeHidden ? shown.dealer.slice(0, 1) : shown.dealer)}</span>}
        </div>
        <div className={`player-hands ${shown && shown.hands.length > 1 ? 'split' : ''}`}>
          {visible && shown.hands.map((h, hi) => (
            <div key={hi} className={`zone hand-zone ${h.result ?? ''}`}>
              <span className={`total ${handValue(h.cards) > 21 ? 'bust' : ''}`}>{shown.hands.length === 1 && isBlackjack(h.cards) ? 'BJ' : handValue(h.cards)}</span>
              <div className="cards">{h.cards.map((c, i) => <CardView key={`${shown.n}p${hi}${i}`} c={c} i={i} delay={i < 2 && h.cards.length === 2 ? i * 0.3 : 0} />)}</div>
              <span className="hand-wager"><Chip value={h.wager} size={26} />{h.result && <b className={`hr ${h.result}`}>{h.result.toUpperCase()}</b>}</span>
            </div>
          ))}
        </div>
        {between && shown?.over && (
          <div className={`banner ${shown.delta > 0 ? 'won' : shown.delta < 0 ? 'lost' : 'push'}`}>
            {shown.delta > 0 ? `+${chips(shown.delta)}` : shown.delta < 0 ? `−${chips(-shown.delta)}` : 'PUSH'}
          </div>
        )}
      </div>

      <div className="controls">
        {cur && can && (
          <div className="btnrow round">
            <button className="act split" onClick={() => act('split')} disabled={!can.split}><b>⇆</b>Split</button>
            <button className="act double" onClick={() => act('double')} disabled={!can.double}><b>2×</b>Double</button>
            <button className="act hit" onClick={() => act('hit')}><b>+</b>Hit</button>
            <button className="act stand" onClick={() => act('stand')}><b>✋</b>Stand</button>
          </div>
        )}
        {!cur && between && (
          <button className="cta wide-cta" onClick={() => (finished(me, duel.length) ? onTurnOver() : setBetween(false))}>
            {finished(me, duel.length) ? 'See where you finished' : 'Next hand'}
          </button>
        )}
        {!cur && !between && (
          <>
            <div className="duel-bet">Bet <b>{chips(Math.min(bet, stackNow))}</b> of {chips(stackNow)}</div>
            <div className="quick">
              {BETS.map(v => <button key={v} className={bet === v ? 'on' : ''} disabled={v > stackNow} onClick={() => setBet(v)}>{v}</button>)}
              <button className={bet >= stackNow ? 'on' : ''} onClick={() => setBet(stackNow)}>All in</button>
            </div>
            <button className="cta wide-cta" onClick={start}>Deal hand {handNo + 1}</button>
          </>
        )}
      </div>
    </section>
  )
}

const MOVE_NAME: Record<string, string> = { H: 'Hit', S: 'Stand', D: 'Double', P: 'Split' }
const cardText = (cs: Card[]) => cs.map(c => c.rank + c.suit + '︎').join(' ')

function Results({ duel, onRematch }: { duel: Duel; onRematch: () => void }) {
  const w = winner(duel)
  const [a, b] = duel.players
  const rows = Array.from({ length: Math.max(a.rounds.length, b.rounds.length) }, (_, n) => [a.rounds[n], b.rounds[n]] as const)
  const verb = (r?: Round) => (r ? `${chips(r.bet)} · ${r.moves.length ? r.moves.map(m => MOVE_NAME[m]).join(', ') : 'auto'}` : 'out of chips')
  return (
    <div className="duel-results">
      <div className="duel-card center">
        <div className="duel-kicker">{w < 0 ? 'Dead even' : 'Winner'}</div>
        <div className="duel-big">{w === 0 || w === 1 ? `🏆 ${duel.players[w].name}` : "🤝 Tie"}</div>
        <div className="duel-vs">
          {duel.players.map((p, i) => <div key={i} className={i === w ? 'win' : ''}><b>{p.name}</b><span>{chips(p.stack)}</span></div>)}
        </div>
        <button className="cta" onClick={onRematch}>Rematch (new cards)</button>
      </div>
      <h3>Hand by hand</h3>
      <p className="muted small">Same cards each hand. Rows marked ⚡ are where your decisions or bets were different.</p>
      {rows.map(([ra, rb], n) => {
        const split = !ra || !rb || ra.bet !== rb.bet || ra.moves.join() !== rb.moves.join()
        const { p, d } = streams(duel.seed, n)
        return (
          <div key={n} className={`duel-row ${split ? 'diff' : ''}`}>
            <div className="duel-row-head"><b>{split ? '⚡ ' : ''}Hand {n + 1}</b><span className="muted small">You: {cardText([p[0], p[1]])} · Dealer shows {cardText([d[0]])}</span></div>
            {[ra, rb].map((r, i) => (
              <div key={i} className="duel-row-line">
                <span>{duel.players[i].name}</span>
                <span className="muted small">{verb(r)}</span>
                <b className={r ? (r.delta > 0 ? 'pos' : r.delta < 0 ? 'neg' : '') : ''}>{r ? (r.delta > 0 ? '+' : r.delta < 0 ? '−' : '±') + chips(Math.abs(r.delta)) : '—'}</b>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

