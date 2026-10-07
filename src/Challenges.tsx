// Challenges list, the skin locker, and the slide-in "challenge complete" toasts.
import { useEffect, useRef, useState } from 'react'
import { CHALLENGES, SKINS, type SkinId } from './challenges.ts'
import { BOOST_PCT, challengeBoost, challengeHistory, claimAllChallenges, claimChallenge, setSkin, unclaimedChallenges, useAccounts, useStore } from './store.ts'

const unlockedBy = (id: SkinId) => CHALLENGES.find(c => c.skin === id)

export function ChallengesPage() {
  const st = useStore()
  const { challengesDone, challengesClaimed, prestige } = st
  const toClaim = unclaimedChallenges(st)
  const h = challengeHistory(st) // progress resets with each prestige
  const done = CHALLENGES.filter(c => challengesDone.includes(c.id)).length

  return (
    <div className="prog">
      <div className="panel">
        <div className="panel-head">
          <b>Challenges</b>
          {toClaim.length > 0
            ? <button className="cta claim-all" onClick={claimAllChallenges}>🎁 Claim all ({toClaim.length})</button>
            : <span className="muted small">{done} / {CHALLENGES.length} complete · prestige to unlock more</span>}
        </div>
        <div className="ch-list">
          {CHALLENGES.map(c => {
            const isDone = challengesDone.includes(c.id)
            const p = Math.min(c.progress(h), c.goal)
            const locked = (c.minPrestige ?? 0) > prestige
            if (locked) return (
              <div key={c.id} className="ch locked">
                <span className="ch-ico">🔒</span>
                <div className="ch-body"><div className="ch-top"><b>{c.name}</b><span className="ch-lock">Prestige {c.minPrestige}</span></div><div className="muted small">{c.desc}</div></div>
                <div className="ch-rewards"><span className="ch-xp">+{c.xp} XP</span><span className="ch-boost">🚀 {BOOST_PCT[challengeBoost(c)]}% Boost</span>{c.skin && <span className="ch-skin"><Swatch id={c.skin} /> {SKINS[c.skin].name}</span>}</div>
              </div>
            )
            return (
              <div key={c.id} className={`ch ${isDone ? 'done' : ''} ${c.minPrestige ? 'prestige' : ''}`}>
                <span className="ch-ico">{c.icon}</span>
                <div className="ch-body">
                  <div className="ch-top"><b>{c.name}</b>{isDone && challengesClaimed.includes(c.id) && <span className="ch-check">✓ Claimed</span>}</div>
                  <div className="muted small">{c.desc}</div>
                  <div className="ch-bar"><i style={{ width: `${(p / c.goal) * 100}%` }} /><span>{p} / {c.goal}</span></div>
                </div>
                <div className="ch-rewards">
                  {isDone && !challengesClaimed.includes(c.id) && <button className="claim-btn" onClick={() => claimChallenge(c.id)}>Claim</button>}
                  <span className="ch-xp">+{c.xp} XP</span>
                  {c.skin && <span className="ch-skin" title={SKINS[c.skin].name}><Swatch id={c.skin} /> {SKINS[c.skin].name}</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <Locker />
    </div>
  )
}

/** Table felts + card backs: equip what you own; locked ones say how to unlock. */
export function Locker() {
  const { unlocked, tableSkin, cardBack } = useStore()
  const owned = (id: SkinId) => id === 'classic' || id === 'red' || unlocked.includes(`skin:${id}`)
  return (
  <div className="panel">
    <div className="panel-head"><b>Locker</b><span className="muted small">Unlock styles by completing challenges</span></div>
    <div className="small muted locker-h">TABLE FELT</div>
    <div className="locker">
      {(Object.keys(SKINS) as SkinId[]).filter(k => SKINS[k].kind === 'felt').map(k => (
        <button key={k} className={`skin-tile ${tableSkin === k ? 'on' : ''}`} disabled={!owned(k)} onClick={() => setSkin({ tableSkin: k })}>
          <Swatch id={k} big />
          <b>{SKINS[k].name}</b>
          <span className="muted small">{owned(k) ? (tableSkin === k ? 'Equipped' : 'Tap to equip') : `🔒 ${unlockedBy(k)?.name ?? "Weekly top 3"}${unlockedBy(k)?.minPrestige ? ` (P${unlockedBy(k)?.minPrestige})` : ''}`}</span>
        </button>
      ))}
    </div>
    <div className="small muted locker-h">CARD BACKS</div>
    <div className="locker">
      {(Object.keys(SKINS) as SkinId[]).filter(k => SKINS[k].kind === 'back').map(k => (
        <button key={k} className={`skin-tile ${cardBack === k ? 'on' : ''}`} disabled={!owned(k)} onClick={() => setSkin({ cardBack: k })}>
          <Swatch id={k} big />
          <b>{SKINS[k].name}</b>
          <span className="muted small">{owned(k) ? (cardBack === k ? 'Equipped' : 'Tap to equip') : `🔒 ${unlockedBy(k)?.name ?? "Weekly top 3"}${unlockedBy(k)?.minPrestige ? ` (P${unlockedBy(k)?.minPrestige})` : ''}`}</span>
        </button>
      ))}
    </div>
  </div>
  )
}

function Swatch({ id, big }: { id: SkinId; big?: boolean }) {
  return <span className={`swatch-skin sw-${id} ${SKINS[id].kind} ${big ? 'big' : ''}`} />
}

/** Watches for newly completed challenges and slides a card in from the right edge for each. */
export function ChallengeToasts({ onOpen }: { onOpen: () => void }) {
  const { challengeLog } = useStore()
  const { current } = useAccounts()
  const seen = useRef<{ acct?: string; at: number }>({ acct: current, at: challengeLog[0]?.at ?? 0 })
  const [toasts, setToasts] = useState<{ key: string; id: string }[]>([])

  useEffect(() => {
    if (seen.current.acct !== current) { seen.current = { acct: current, at: challengeLog[0]?.at ?? 0 }; return }
    const fresh = challengeLog.filter(e => e.at > seen.current.at)
    if (!fresh.length) return
    seen.current.at = fresh[0].at
    const add = fresh.slice(0, 4).map(e => ({ key: `${e.id}-${e.at}`, id: e.id }))
    setToasts(t => [...t, ...add])
    for (const a of add) setTimeout(() => setToasts(t => t.filter(x => x.key !== a.key)), 4600)
  }, [challengeLog, current])

  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t, i) => {
        const c = CHALLENGES.find(x => x.id === t.id)!
        return (
          <div key={t.key} className="ch-toast" style={{ animationDelay: `${i * 0.25}s` }} role="button" tabIndex={0} onClick={() => { setToasts([]); onOpen() }}>
            <span className="ch-toast-ico">{c.icon}</span>
            <div>
              <div className="ch-toast-kicker">CHALLENGE COMPLETE</div>
              <b>{c.name}</b>
              <div className="small">+{c.xp} XP + {BOOST_PCT[challengeBoost(c)]}% Boost{c.skin ? ` + ${SKINS[c.skin].name}` : ''} ready to claim</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
