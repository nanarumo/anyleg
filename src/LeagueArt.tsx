// Illustrated league banners and per-sport theming for the sportsbook.

export type SportKind = 'football' | 'basketball' | 'baseball' | 'hockey' | 'soccer' | 'all'

export const sportOf = (league: string): SportKind =>
  league === 'nfl' || league === 'ncaaf' ? 'football'
    : league === 'nba' || league === 'wnba' ? 'basketball'
      : league === 'mlb' ? 'baseball'
        : league === 'nhl' ? 'hockey'
          : league === 'epl' || league === 'mls' ? 'soccer' : 'all'

export const SPORT_ICON: Record<SportKind, string> = { football: '🏈', basketball: '🏀', baseball: '⚾', hockey: '🏒', soccer: '⚽', all: '🏟️' }

const TITLES: Record<string, [string, string]> = {
  all: ['Today’s Board', 'Every league, live lines'],
  nfl: ['NFL Football', 'Sunday slate · spreads, totals, moneylines'],
  ncaaf: ['College Football', 'Saturday chaos, priced live'],
  nba: ['NBA Basketball', 'Every tip-off, every line'],
  wnba: ['WNBA Basketball', 'Lines move, you move'],
  mlb: ['MLB Baseball', 'Run lines and totals, pitch by pitch'],
  nhl: ['NHL Hockey', 'Puck lines on ice'],
  epl: ['Premier League', '3-way moneylines incl. the draw'],
  mls: ['MLS Soccer', '3-way moneylines incl. the draw'],
}

export function LeagueHero({ league, count }: { league: string; count: number }) {
  const sport = sportOf(league)
  const [title, sub] = TITLES[league] ?? TITLES.all
  return (
    <div className={`hero hero-${sport}`}>
      <svg className="hero-art" viewBox="0 0 600 170" preserveAspectRatio="xMidYMid slice" aria-hidden>
        <Art sport={sport} />
      </svg>
      <div className="hero-text">
        <div className="hero-kicker">{SPORT_ICON[sport]} LIVE ODDS</div>
        <div className="hero-title">{title}</div>
        <div className="hero-sub">{sub} · {count} game{count === 1 ? '' : 's'}</div>
      </div>
    </div>
  )
}

export function Art({ sport }: { sport: SportKind }) {
  switch (sport) {
    case 'football':
      return (
        <g>
          {Array.from({ length: 12 }, (_, i) => <rect key={i} x={i * 50} y="0" width="50" height="170" fill={i % 2 ? '#2f7d32' : '#348a37'} />)}
          <rect x="0" y="0" width="60" height="170" fill="#1e5a8a" />
          <text x="30" y="95" fill="#fff" fontSize="22" fontWeight="900" textAnchor="middle" transform="rotate(-90 30 88)" opacity=".8">END ZONE</text>
          {Array.from({ length: 11 }, (_, i) => <line key={i} x1={60 + i * 50} y1="0" x2={60 + i * 50} y2="170" stroke="#fff" strokeWidth="2" opacity=".7" />)}
          {[10, 20, 30, 40, 50].map((n, i) => <text key={n} x={110 + i * 100} y="150" fill="#fff" fontSize="22" fontWeight="800" textAnchor="middle" opacity=".55">{n}</text>)}
          {Array.from({ length: 50 }, (_, i) => <line key={i} x1={60 + i * 10} y1="60" x2={60 + i * 10} y2="66" stroke="#fff" strokeWidth="1.5" opacity=".5" />)}
          <g transform="translate(470 60) rotate(-25)">
            <ellipse rx="56" ry="32" fill="#7b3f1d" stroke="#4a230d" strokeWidth="3" />
            <path d="M-38 -14 Q0 -26 38 -14 M-38 14 Q0 26 38 14" stroke="#fff" strokeWidth="3" fill="none" opacity=".9" />
            <line x1="-22" y1="0" x2="22" y2="0" stroke="#fff" strokeWidth="3" />
            {[-15, -7, 1, 9, 17].map(x => <line key={x} x1={x} y1="-6" x2={x} y2="6" stroke="#fff" strokeWidth="3" />)}
          </g>
          <path d="M560 170 V95 M530 95 H590 M530 95 V20 M590 95 V20" stroke="#facc15" strokeWidth="6" fill="none" />
        </g>
      )
    case 'basketball':
      return (
        <g>
          {Array.from({ length: 14 }, (_, i) => <rect key={i} x="0" y={i * 13} width="600" height="13" fill={i % 2 ? '#c98a4b' : '#d39554'} />)}
          {Array.from({ length: 30 }, (_, i) => <line key={i} x1={(i * 97) % 600} y1={Math.floor(i / 2.2) * 13} x2={(i * 97) % 600} y2={Math.floor(i / 2.2) * 13 + 13} stroke="#a86f38" strokeWidth="1" />)}
          <rect x="380" y="35" width="220" height="100" fill="#1d4ed8" opacity=".55" />
          <path d="M600 -10 A190 190 0 0 0 600 180" stroke="#fff" strokeWidth="4" fill="none" opacity=".85" />
          <circle cx="380" cy="85" r="50" stroke="#fff" strokeWidth="4" fill="none" opacity=".85" />
          <line x1="380" y1="35" x2="600" y2="35" stroke="#fff" strokeWidth="4" opacity=".85" />
          <line x1="380" y1="135" x2="600" y2="135" stroke="#fff" strokeWidth="4" opacity=".85" />
          <g transform="translate(480 70)">
            <circle r="44" fill="#ea580c" stroke="#7c2d12" strokeWidth="3" />
            <path d="M-44 0 H44 M0 -44 V44 M-31 -31 Q0 0 -31 31 M31 -31 Q0 0 31 31" stroke="#1c1917" strokeWidth="3" fill="none" />
          </g>
        </g>
      )
    case 'baseball':
      return (
        <g>
          {Array.from({ length: 12 }, (_, i) => <rect key={i} x={i * 50} y="0" width="50" height="170" fill={i % 2 ? '#2e7d32' : '#388e3c'} />)}
          <path d="M440 170 L520 90 L600 170 Z" fill="#b7793f" />
          <path d="M455 170 L520 105 L585 170 Z" fill="#3a8f3e" />
          {[[520, 92], [598, 168], [442, 168]].map(([x, y], i) => <rect key={i} x={x - 7} y={y - 7} width="14" height="14" fill="#fff" transform={`rotate(45 ${x} ${y})`} />)}
          <circle cx="520" cy="140" r="12" fill="#b7793f" />
          <path d="M0 40 Q300 -10 600 40" stroke="#fff" strokeWidth="3" fill="none" opacity=".35" />
          <g transform="translate(330 80)">
            <circle r="38" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="2" />
            <path d="M-22 -30 Q-8 0 -22 30 M22 -30 Q8 0 22 30" stroke="#dc2626" strokeWidth="2.5" fill="none" strokeDasharray="4 3" />
          </g>
        </g>
      )
    case 'hockey':
      return (
        <g>
          <rect width="600" height="170" fill="#e8f1f8" />
          <line x1="300" y1="0" x2="300" y2="170" stroke="#dc2626" strokeWidth="8" />
          <line x1="190" y1="0" x2="190" y2="170" stroke="#2563eb" strokeWidth="8" />
          <line x1="410" y1="0" x2="410" y2="170" stroke="#2563eb" strokeWidth="8" />
          <circle cx="300" cy="85" r="45" stroke="#2563eb" strokeWidth="3" fill="none" />
          <circle cx="500" cy="85" r="40" stroke="#dc2626" strokeWidth="3" fill="none" />
          <circle cx="500" cy="85" r="4" fill="#dc2626" />
          <ellipse cx="460" cy="120" rx="26" ry="9" fill="#111" />
          <rect x="434" y="111" width="52" height="9" fill="#111" />
          <ellipse cx="460" cy="111" rx="26" ry="9" fill="#333" />
          <path d="M540 20 L520 120 Q518 132 535 132 H580" stroke="#7c4a1d" strokeWidth="9" fill="none" strokeLinecap="round" />
        </g>
      )
    case 'soccer':
      return (
        <g>
          {Array.from({ length: 12 }, (_, i) => <rect key={i} x={i * 50} y="0" width="50" height="170" fill={i % 2 ? '#15803d' : '#16a34a'} />)}
          <line x1="300" y1="0" x2="300" y2="170" stroke="#fff" strokeWidth="3" opacity=".8" />
          <circle cx="300" cy="85" r="50" stroke="#fff" strokeWidth="3" fill="none" opacity=".8" />
          <rect x="520" y="35" width="80" height="100" stroke="#fff" strokeWidth="3" fill="none" opacity=".8" />
          <g transform="translate(450 85)">
            <circle r="36" fill="#fff" stroke="#111" strokeWidth="2" />
            <polygon points="0,-12 11,-4 7,10 -7,10 -11,-4" fill="#111" />
            {[0, 72, 144, 216, 288].map(a => <polygon key={a} points="0,-36 8,-26 -8,-26" fill="#111" transform={`rotate(${a})`} />)}
          </g>
        </g>
      )
    default:
      return (
        <g>
          <rect width="600" height="170" fill="#0b1530" />
          {[80, 230, 380, 530].map((x, i) => (
            <g key={x}>
              <polygon points={`${x - 6},20 ${x + 6},20 ${x + 90 * (i % 2 ? -1 : 1)},170 ${x - 60 * (i % 2 ? -1 : 1)},170`} fill="#fef3c7" opacity=".08" />
              <rect x={x - 16} y="8" width="32" height="14" rx="3" fill="#fde68a" />
            </g>
          ))}
          <path d="M0 150 Q300 110 600 150 V170 H0 Z" fill="#14532d" />
        </g>
      )
  }
}
