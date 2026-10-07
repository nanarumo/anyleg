// The little picture next to each leg: team logo(s) for sports picks, a game symbol for casino picks.
import type { CasinoGame } from './logic.ts'
import type { Leg } from './store.ts'
import { SPORT_ICON, sportOf } from './LeagueArt.tsx'

export function LegIcon({ leg: l }: { leg: Leg }) {
  // Only our own badges; tickets saved before the switch may still point at hosted team logos.
  const own = (s?: string) => (s?.startsWith('data:') ? s : undefined)
  const leg = { ...l, icon: own(l.icon), icon2: own(l.icon2) }
  if (leg.casino) return <span className={`leg-icon game-icon g-${leg.casino.game}`}><GameIcon game={leg.casino.game} /></span>
  if (leg.icon && leg.icon2) {
    return (
      <span className="leg-icon pair">
        <img src={leg.icon} alt="" /><img src={leg.icon2} alt="" />
      </span>
    )
  }
  if (leg.icon) return <span className="leg-icon"><img src={leg.icon} alt="" /></span>
  return <span className="leg-icon">{SPORT_ICON[sportOf(leg.id.split(':')[0])]}</span>
}

export function GameIcon({ game }: { game: CasinoGame }) {
  switch (game) {
    case 'blackjack':
      return (
        <svg viewBox="0 0 32 32">
          <rect x="4" y="6" width="15" height="21" rx="2" fill="#fff" stroke="#0004" transform="rotate(-12 11 16)" />
          <rect x="13" y="5" width="15" height="21" rx="2" fill="#fff" stroke="#0004" transform="rotate(10 20 15)" />
          <text x="20" y="18" fontSize="9" fontWeight="900" textAnchor="middle" fill="#111" transform="rotate(10 20 15)">A♠</text>
        </svg>
      )
    case 'roulette':
      return (
        <svg viewBox="0 0 32 32">
          <circle cx="16" cy="16" r="14" fill="#5b3a1a" />
          {Array.from({ length: 12 }, (_, i) => (
            <path key={i} d="M16 16 L16 3 A13 13 0 0 1 22.5 4.7 Z" fill={i === 0 ? '#15803d' : i % 2 ? '#b91c1c' : '#111'} transform={`rotate(${i * 30} 16 16)`} />
          ))}
          <circle cx="16" cy="16" r="6" fill="#c99a4a" stroke="#d4af37" />
          <circle cx="22" cy="9" r="2" fill="#fff" />
        </svg>
      )
    case 'baccarat':
      return (
        <svg viewBox="0 0 32 32">
          <rect x="2" y="7" width="13" height="18" rx="2" fill="#2563eb" />
          <rect x="17" y="7" width="13" height="18" rx="2" fill="#dc2626" />
          <text x="8.5" y="20" fontSize="9" fontWeight="900" textAnchor="middle" fill="#fff">P</text>
          <text x="23.5" y="20" fontSize="9" fontWeight="900" textAnchor="middle" fill="#fff">B</text>
        </svg>
      )
    case 'poker':
      return (
        <svg viewBox="0 0 32 32">
          {[-20, -7, 6, 19].map((r, i) => <rect key={r} x="10" y="5" width="12" height="18" rx="2" fill="#fff" stroke="#0004" transform={`rotate(${r} 16 26)`} opacity={0.75 + i * 0.08} />)}
          <text x="16" y="17" fontSize="8" fontWeight="900" textAnchor="middle" fill="#c81e1e" transform="rotate(19 16 26)">K♥</text>
        </svg>
      )
    case 'slots':
      return (
        <svg viewBox="0 0 32 32">
          <rect x="2" y="5" width="28" height="22" rx="4" fill="#7f1d1d" stroke="#d4af37" strokeWidth="2" />
          {[0, 1, 2].map(i => <rect key={i} x={5 + i * 8} y="9" width="6.5" height="14" rx="1.5" fill="#fff" />)}
          {[0, 1, 2].map(i => <text key={i} x={8.25 + i * 8} y="20" fontSize="9" fontWeight="900" fontStyle="italic" textAnchor="middle" fill="#dc2626">7</text>)}
        </svg>
      )
    case 'crash':
      return (
        <svg viewBox="0 0 32 32">
          <rect x="2" y="2" width="28" height="28" rx="6" fill="#0b1026" />
          <path d="M5 26 Q 18 25 22 14 T 27 6" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" />
          <text x="25" y="11" fontSize="9" textAnchor="middle">🚀</text>
        </svg>
      )
    case 'mines':
      return (
        <svg viewBox="0 0 32 32">
          {[0, 1, 2, 3].map(i => <rect key={i} x={3 + (i % 2) * 14} y={3 + Math.floor(i / 2) * 14} width="12" height="12" rx="3" fill={i === 1 ? '#7f1d1d' : '#064e3b'} />)}
          <text x="24" y="14" fontSize="9" textAnchor="middle">💣</text>
          <text x="10" y="28" fontSize="9" textAnchor="middle">💎</text>
        </svg>
      )
    case 'plinko':
      return (
        <svg viewBox="0 0 32 32">
          <rect x="2" y="2" width="28" height="28" rx="6" fill="#1e1036" />
          {[[16, 8], [11, 14], [21, 14], [6, 20], [16, 20], [26, 20]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.8" fill="#e9d5ff" />)}
          <circle cx="13.5" cy="11" r="2.6" fill="#f472b6" />
          <rect x="4" y="25" width="24" height="3" rx="1.5" fill="#f97316" />
        </svg>
      )
  }
}
