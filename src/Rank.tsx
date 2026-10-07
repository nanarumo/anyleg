// Rank insignia, the level badge, and the full progression screen with the reward track.
import { leave } from './motion.ts'
import { useEffect, useRef, useState } from 'react'
import {
  MAX_LEVEL, MAX_PRESTIGE, PRESTIGES, RANKS, levelOf, nextRank, prestigeRewards, rankAt, rankName, rewardIcon, rewardLabel, rewardsAt,
  XP_PER_LEG_HIT, type Rank, type Shape,
} from './progression.ts'
import { BOOST_PCT, FREE_SPIN_VALUE, claimAllLevels, claimLevel, enterPrestige, unclaimedLevels, useStore, type BoostKey } from './store.ts'

const TIER_COLOR: Record<Rank['tier'], string> = {
  bronze: '#d08b4c', silver: '#d4d9e1', gold: '#fbbf24', platinum: '#7dd3fc', diamond: '#c4b5fd', legend: '#f472b6',
}

const star = (cx: number, cy: number, r: number) => {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = (Math.PI / 5) * i - Math.PI / 2
    const rr = i % 2 ? r * 0.45 : r
    return `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`
  })
  return <polygon points={pts.join(' ')} />
}

const burst = (() => {
  const pts = Array.from({ length: 16 }, (_, i) => {
    const a = (Math.PI / 8) * i - Math.PI / 2
    const r = i % 2 ? 24 : 31
    return `${(32 + r * Math.cos(a)).toFixed(1)},${(32 + r * Math.sin(a)).toFixed(1)}`
  })
  return `M${pts.join(' L')} Z`
})()
/** Badge outline per prestige: each prestige gets its own emblem shape. */
const SHAPES: Record<Shape, string> = {
  shield: 'M32 2 L58 12 V34 C58 48 46 58 32 62 C18 58 6 48 6 34 V12 Z',
  hex: 'M32 2 L58 17 V47 L32 62 L6 47 V17 Z',
  circle: 'M32 3 A29 29 0 1 1 31.99 3 Z',
  diamond: 'M32 1 L62 32 L32 63 L2 32 Z',
  star: burst,
  wings: 'M32 6 L50 13 V33 C50 45 42 53 32 57 C22 53 14 45 14 33 V13 Z',
}

/**
 * Military-style insignia: chevrons and rockers for enlisted ranks, bars for officers, stars for generals.
 * Each prestige swaps the badge shape and colors and adds a prestige number on top.
 */
export function Insignia({ rank, size = 48, dim, prestige = 0 }: { rank: Rank; size?: number; dim?: boolean; prestige?: number }) {
  const theme = PRESTIGES[prestige]
  const c = prestige ? theme.color : TIER_COLOR[rank.tier]
  const { kind, n, rockers = 0 } = rank.mark
  const id = `ins-${prestige}-${rank.level}`
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={`insignia ${dim ? 'dim' : ''}`} aria-label={rankName(rank, prestige)}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".9" />
          <stop offset=".35" stopColor={c} />
          <stop offset="1" stopColor={c} stopOpacity=".65" />
        </linearGradient>
        <radialGradient id={`${id}-bg`} cx="50%" cy="35%" r="70%">
          <stop offset="0" stopColor={prestige ? theme.color2 : '#241c36'} />
          <stop offset="1" stopColor="#0d0a16" />
        </radialGradient>
      </defs>
      {theme.shape === 'wings' && prestige > 0 && (
        <g fill={`url(#${id})`} opacity=".9">
          <path d="M14 20 C4 18 0 26 1 34 C5 30 9 30 14 31 Z M14 31 C6 32 3 38 4 44 C8 39 11 38 15 38 Z" />
          <path d="M50 20 C60 18 64 26 63 34 C59 30 55 30 50 31 Z M50 31 C58 32 61 38 60 44 C56 39 53 38 49 38 Z" />
        </g>
      )}
      <path d={SHAPES[theme.shape]} fill={`url(#${id}-bg)`} stroke={`url(#${id})`} strokeWidth="3" strokeLinejoin="round" />
      <g fill={`url(#${id})`} stroke="none">
        {kind === 'dot' && <circle cx="32" cy="30" r="8" />}
        {kind === 'chevron' && Array.from({ length: n }, (_, i) => (
          <path key={i} d={`M16 ${18 + i * 8} L32 ${10 + i * 8} L48 ${18 + i * 8} L48 ${23 + i * 8} L32 ${15 + i * 8} L16 ${23 + i * 8} Z`} />
        ))}
        {kind === 'chevron' && Array.from({ length: rockers }, (_, i) => (
          <path key={`r${i}`} d={`M16 ${40 + i * 5} Q32 ${48 + i * 5} 48 ${40 + i * 5} L48 ${43.5 + i * 5} Q32 ${51.5 + i * 5} 16 ${43.5 + i * 5} Z`} />
        ))}
        {kind === 'bar' && Array.from({ length: n }, (_, i) => <rect key={i} x={32 - (n * 10) / 2 + i * 10 + 1} y="16" width="7" height="30" rx="1.5" />)}
        {kind === 'star' && (n === 1 ? star(32, 31, 14)
          : n === 2 ? <>{star(22, 31, 9)}{star(42, 31, 9)}</>
            : n === 3 ? <>{star(32, 21, 8.5)}{star(21, 38, 8.5)}{star(43, 38, 8.5)}</>
              : <>{star(22, 22, 8)}{star(42, 22, 8)}{star(22, 40, 8)}{star(42, 40, 8)}</>)}
        {kind === 'legend' && <>
          {star(32, 30, 15)}
          <path d="M12 26 Q10 44 30 54 Q16 42 16 26 Z M52 26 Q54 44 34 54 Q48 42 48 26 Z" />
        </>}
      </g>
      {prestige > 0 && (
        <g>
          <circle cx="32" cy="5" r="6.5" fill={theme.color2} stroke={c} strokeWidth="1.5" />
          <text x="32" y="8" textAnchor="middle" fontSize="8" fontWeight="900" fill="#fff">{prestige}</text>
        </g>
      )}
    </svg>
  )
}

/** Small level chip for the header avatar and profile. */
export function LevelBadge({ xp }: { xp: number }) {
  const { prestige } = useStore()
  const { level } = levelOf(xp)
  const color = prestige ? PRESTIGES[prestige].color : TIER_COLOR[rankAt(level).tier]
  return <span className="lvl-badge" style={{ ['--tc' as string]: color }}>{prestige ? `P${prestige}·` : ''}{level}</span>
}

export function RankSummary({ xp, onClick }: { xp: number; onClick?: () => void }) {
  const { prestige } = useStore()
  const { level, into, need } = levelOf(xp)
  const rank = rankAt(level)
  return (
    <button className="rank-sum" onClick={onClick}>
      <Insignia rank={rank} size={40} prestige={prestige} />
      <div className="rank-sum-body">
        <div><b>{rankName(rank, prestige)}</b> <span className="muted small">· {prestige ? `Prestige ${prestige} · ` : ''}Level {level}</span></div>
        <div className="xp-bar"><i style={{ width: need ? `${(into / need) * 100}%` : '100%' }} /></div>
        <div className="muted small">{need ? `${into.toLocaleString()} / ${need.toLocaleString()} XP` : 'Max level'}</div>
      </div>
      {onClick && <span className="chev">›</span>}
    </button>
  )
}

export function ProgressionPage() {
  const st = useStore()
  const { xp, inv, prestige, claimedLevels } = st
  const toClaim = unclaimedLevels(st)
  const [confirming, setConfirming] = useState(false)
  const theme = PRESTIGES[prestige]
  const { level, into, need } = levelOf(xp)
  const rank = rankAt(level)
  const nr = nextRank(level)
  const track = useRef<HTMLDivElement>(null)

  // Open the track scrolled to where you are, like the battle-pass screen.
  useEffect(() => {
    const el = track.current?.querySelector<HTMLElement>('.node.current')
    if (el && track.current) track.current.scrollLeft = el.offsetLeft - track.current.clientWidth / 2 + el.clientWidth / 2
  }, [])

  return (
    <div className="prog">
      <div className="prog-hero" style={{ ['--tc' as string]: prestige ? theme.color : TIER_COLOR[rank.tier] }}>
        <Insignia rank={rank} size={120} prestige={prestige} />
        <div className="prog-hero-body">
          <div className="prog-kicker">{prestige ? `PRESTIGE ${prestige} · ${theme.name.toUpperCase()}` : 'CURRENT RANK'}</div>
          <div className="prog-rank">{rankName(rank, prestige)}</div>
          <div className="prog-level">LEVEL {level}<span className="muted"> / {MAX_LEVEL}</span></div>
          <div className="xp-bar big"><i style={{ width: need ? `${(into / need) * 100}%` : '100%' }} /></div>
          <div className="muted small">{need ? `${into.toLocaleString()} / ${need.toLocaleString()} XP to level ${level + 1}` : 'You reached the top of the track.'}{nr ? ` · ${rankName(nr, prestige)} at level ${nr.level}` : ''}</div>
          {level === MAX_LEVEL && prestige < MAX_PRESTIGE && (
            <button className="cta prestige-btn" onClick={() => setConfirming(true)}>⭐ Enter Prestige {prestige + 1} <span className="small">(optional)</span></button>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><b>Prestige</b><span className="muted small">Reach level {MAX_LEVEL} to prestige · {prestige}/{MAX_PRESTIGE}</span></div>
        <div className="prestige-row">
          {PRESTIGES.map(t => (
            <div key={t.n} className={`prestige-tile ${t.n < prestige ? 'done' : t.n === prestige ? 'current' : 'locked'}`} style={{ ['--pc' as string]: t.n ? t.color : '#c4b5fd' }}>
              <Insignia rank={RANKS[RANKS.length - 1]} prestige={t.n} size={58} dim={t.n > prestige} />
              <b>{t.n ? t.name : 'Base'}</b>
              <span className="muted small">{t.n ? `P${t.n}` : 'P0'}</span>
            </div>
          ))}
        </div>
        <p className="muted small">Prestiging is optional. It resets your level to 1 and wipes your cosmetics and challenge progress so you can earn them again; your money and tokens stay. Each prestige brings a new emblem set and rank titles, 50% bigger level rewards, its own avatar and frame, and new challenges.</p>
      </div>

      <div className="panel">
        <div className="panel-head">
          <b>Rank track</b>
          {toClaim.length > 0
            ? <button className="cta claim-all" onClick={claimAllLevels}>🎁 Claim all ({toClaim.length})</button>
            : <span className="muted small">Scroll to see every reward</span>}
        </div>
        <div className="track" ref={track}>
          <div className="track-line"><i style={{ width: `${((level - 1 + (need ? into / need : 0)) / (MAX_LEVEL - 1)) * 100}%` }} /></div>
          {Array.from({ length: MAX_LEVEL }, (_, i) => i + 1).map(lv => {
            const rewards = rewardsAt(lv, prestige)
            const rk = RANKS.find(r => r.level === lv)
            const state = lv < level ? 'done' : lv === level ? 'current' : 'locked'
            const claimed = claimedLevels.includes(`${prestige}:${lv}`)
            const claimable = lv >= 2 && lv <= level && !claimed
            return (
              <div key={lv} className={`node ${state} ${rk ? 'rank-node' : ''} ${claimable ? 'claimable' : ''}`}>
                <div className={`node-rewards ${rewards.length > 2 ? "many" : ""}`}>
                  {rewards.map((r, j) => (
                    <div key={j} className={`reward-card r-${r.kind}`} title={rewardLabel(r)}>
                      <span className="reward-ico">{rewardIcon(r)}</span>
                      <span className="reward-name">{rewardLabel(r)}</span>
                      {claimed && <span className="reward-got">✓</span>}
                    </div>
                  ))}
                </div>
                <div className="node-dot">{lv}</div>
                <div className="node-rank">
                  {claimable && <button className="claim-btn" onClick={() => claimLevel(lv)}>Claim</button>}
                  {rk && <><Insignia rank={rk} size={44} prestige={prestige} dim={state === 'locked'} /><span>{rankName(rk, prestige)}</span></>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-head"><b>Your rewards</b></div>
          <div className="inv">
            {(Object.keys(BOOST_PCT) as BoostKey[]).map(k => (
              <div key={k} className={`inv-item ${inv[k] ? '' : 'empty'}`}><span>🚀</span><div><b>{BOOST_PCT[k]}% Parlay Boost ×{inv[k]}</b><div className="muted small">Boosts a parlay's profit. Pick it in the bet slip.</div></div></div>
            ))}
            <div className={`inv-item ${inv.insurance ? '' : 'empty'}`}><span>🛡️</span><div><b>Parlay Insurance ×{inv.insurance}</b><div className="muted small">On a 4+ leg parlay, miss by one leg and get your stake back.</div></div></div>
            <div className={`inv-item ${inv.spins ? '' : 'empty'}`}><span>🎰</span><div><b>Free Spins ×{inv.spins}</b><div className="muted small">${FREE_SPIN_VALUE} spins on Slots, on the house.</div></div></div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><b>How to earn XP</b></div>
          <div className="earn">
            <div><b>Win a bet</b><span>100 XP</span></div>
            <div><b>Each extra parlay leg</b><span>+75 XP</span></div>
            <div><b>Mixed sports + casino parlay hit</b><span>+100 XP</span></div>
            <div><b>Profit on a winning ticket</b><span>+1 XP per $10</span></div>
            <div><b>Casino leg hit inside a parlay</b><span>{XP_PER_LEG_HIT} XP</span></div>
            <div><b>Winning casino round</b><span>15+ XP</span></div>
            <div><b>Challenges</b><span>200–10,000 XP</span></div>
          </div>
        </div>
      </div>

      {confirming && (
        <div className="sheet-back" onClick={e => leave(e, () => setConfirming(false))}>
          <div className="sheet center" onClick={e => e.stopPropagation()}>
            <Insignia rank={RANKS[0]} prestige={prestige + 1} size={110} />
            <h3>Enter Prestige {prestige + 1}: {PRESTIGES[prestige + 1].name}</h3>
            <p className="muted">Prestiging is optional. You can stay at level {MAX_LEVEL} as long as you like.</p>
            <div className="prestige-terms">
              <div><b>You get</b><span>Level 1 with new {PRESTIGES[prestige + 1].name} emblems and rank titles, 50% bigger level rewards, new prestige challenges, and:</span></div>
              <div className="lose"><b>You lose</b><span>All cosmetics (table felts, card backs, avatars and frames) and your challenge progress. Earn them back by completing challenges again.</span></div>
              <div><b>You keep</b><span>Your balance, open bets, boosts, insurance and free spins.</span></div>
            </div>
            <div className="prestige-gifts">{prestigeRewards(prestige + 1).map((r, i) => <span key={i}>{rewardIcon(r)} {rewardLabel(r)}</span>)}</div>
            <button className="cta" onClick={() => { enterPrestige(); setConfirming(false) }}>Prestige now</button>
            <button className="link" onClick={() => setConfirming(false)}>Not yet</button>
          </div>
        </div>
      )}
    </div>
  )
}
