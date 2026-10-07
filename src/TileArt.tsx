// Full-bleed table illustrations for the casino lobby tiles (shown faded behind the tile text).
import type { CasinoGame } from './logic.ts'
import { Wheel } from './Roulette.tsx'

const noop = () => {}

const Card = ({ x, y, r, rank, suit, w = 46 }: { x: number; y: number; r: number; rank: string; suit: string; w?: number }) => {
  const red = suit === '♥' || suit === '♦'
  const h = w * 1.42
  return (
    <g transform={`translate(${x} ${y}) rotate(${r})`}>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={w * 0.09} fill="#fdfbf7" stroke="#0003" />
      <text x={-w / 2 + 5} y={-h / 2 + w * 0.32} fontSize={w * 0.3} fontWeight="900" fill={red ? '#c81e1e' : '#111'}>{rank}</text>
      <text x="0" y={w * 0.18} fontSize={w * 0.55} textAnchor="middle" fill={red ? '#c81e1e' : '#111'}>{suit}</text>
    </g>
  )
}
const Back = ({ x, y, r, w = 46 }: { x: number; y: number; r: number; w?: number }) => (
  <g transform={`translate(${x} ${y}) rotate(${r})`}>
    <rect x={-w / 2} y={-w * 0.71} width={w} height={w * 1.42} rx={w * 0.09} fill="#be123c" stroke="#fff" strokeWidth="3" />
    <rect x={-w / 2 + 6} y={-w * 0.71 + 6} width={w - 12} height={w * 1.42 - 12} rx="3" fill="none" stroke="#fda4af" strokeDasharray="3 3" />
  </g>
)
const ChipStack = ({ x, y, color, n = 4 }: { x: number; y: number; color: string; n?: number }) => (
  <g transform={`translate(${x} ${y})`}>
    {Array.from({ length: n }, (_, i) => (
      <g key={i} transform={`translate(0 ${-i * 5})`}>
        <ellipse rx="18" ry="7" fill={color} stroke="#0006" />
        <ellipse rx="18" ry="7" fill="none" stroke="#fff" strokeWidth="2" strokeDasharray="5 6" />
      </g>
    ))}
  </g>
)

export function TileArt({ game }: { game: CasinoGame }) {
  if (game === 'roulette') return <div className="tile-img wheel-img"><Wheel onDone={noop} /></div>
  return (
    <svg className="tile-img" viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" aria-hidden>
      {game === 'blackjack' && (
        <g>
          <rect width="400" height="260" fill="#0a3d26" />
          <path d="M-20 -10 H420 V120 A230 150 0 0 1 -20 120 Z" fill="#14794a" stroke="#c08a3e" strokeWidth="10" />
          <path d="M40 120 A170 110 0 0 0 360 120" fill="none" stroke="#fbbf24" strokeWidth="2" opacity=".7" />
          <path id="ta-arc" d="M60 100 A150 100 0 0 0 340 100" fill="none" />
          <text fontSize="17" fontWeight="900" fill="#fbbf24" letterSpacing="3"><textPath href="#ta-arc" startOffset="50%" textAnchor="middle">BLACKJACK PAYS 3 TO 2</textPath></text>
          <Card x={175} y={58} r={-6} rank="A" suit="♠" />
          <Card x={215} y={60} r={7} rank="K" suit="♥" />
          <Back x={300} y={48} r={12} />
          <ChipStack x={120} y={200} color="#16a34a" />
          <ChipStack x={200} y={215} color="#111827" n={6} />
          <ChipStack x={280} y={200} color="#dc2626" />
        </g>
      )}
      {game === 'baccarat' && (
        <g>
          <rect width="400" height="260" fill="#0f3a63" />
          <rect x="30" y="30" width="160" height="110" rx="14" fill="none" stroke="#60a5fa" strokeWidth="4" />
          <rect x="210" y="30" width="160" height="110" rx="14" fill="none" stroke="#f87171" strokeWidth="4" />
          <text x="110" y="60" textAnchor="middle" fill="#93c5fd" fontWeight="900" fontSize="16" letterSpacing="3">PLAYER</text>
          <text x="290" y="60" textAnchor="middle" fill="#fca5a5" fontWeight="900" fontSize="16" letterSpacing="3">BANKER</text>
          <Card x={92} y={100} r={-5} rank="9" suit="♦" w={38} />
          <Card x={128} y={100} r={5} rank="K" suit="♣" w={38} />
          <Card x={272} y={100} r={-5} rank="6" suit="♠" w={38} />
          <Card x={308} y={100} r={5} rank="Q" suit="♥" w={38} />
          <rect x="30" y="170" width="340" height="60" rx="12" fill="none" stroke="#4ade80" strokeWidth="3" />
          <text x="200" y="208" textAnchor="middle" fill="#86efac" fontWeight="900" fontSize="18" letterSpacing="4">TIE PAYS 8 TO 1</text>
        </g>
      )}
      {game === 'poker' && (
        <g>
          <rect width="400" height="260" fill="#16106b" />
          <rect x="20" y="20" width="360" height="220" rx="16" fill="none" stroke="#c9a227" strokeWidth="6" />
          {['ROYAL FLUSH 250', 'STRAIGHT FLUSH 50', 'FOUR OF A KIND 25'].map((t, i) => (
            <text key={t} x="200" y={52 + i * 20} textAnchor="middle" fontFamily="Courier New, monospace" fontWeight="900" fontSize="14" fill="#fde047">{t}</text>
          ))}
          {[['10', '♠'], ['J', '♠'], ['Q', '♠'], ['K', '♠'], ['A', '♠']].map(([r, s], i) => (
            <Card key={r} x={110 + i * 45} y={170} r={(i - 2) * 6} rank={r} suit={s} w={50} />
          ))}
        </g>
      )}
      {game === 'slots' && (
        <g>
          <rect width="400" height="260" fill="#450a0a" />
          <rect x="70" y="20" width="260" height="220" rx="24" fill="#7f1d1d" stroke="#d4af37" strokeWidth="8" />
          <rect x="110" y="30" width="180" height="26" rx="13" fill="#1c0606" stroke="#fde68a" strokeDasharray="4 4" />
          <text x="200" y="49" textAnchor="middle" fill="#fde68a" fontWeight="900" fontSize="14" letterSpacing="3">LUCKY 7s</text>
          {[0, 1, 2].map(i => (
            <g key={i}>
              <rect x={95 + i * 72} y="72" width="64" height="120" rx="8" fill="#fff" stroke="#111" strokeWidth="3" />
              <text x={127 + i * 72} y="148" textAnchor="middle" fontSize="54" fontWeight="900" fontStyle="italic" fill="#dc2626">7</text>
            </g>
          ))}
          <line x1="88" x2="312" y1="132" y2="132" stroke="#fde047" strokeWidth="3" />
          <path d="M335 90 V60" stroke="#ccc" strokeWidth="6" strokeLinecap="round" />
          <circle cx="335" cy="56" r="11" fill="#dc2626" />
        </g>
      )}
      {game === 'crash' && (
        <g>
          <rect width="400" height="260" fill="#0b1026" />
          {[40, 90, 140, 190].map(y => <line key={y} x1="0" x2="400" y1={y} y2={y} stroke="#1e293b" />)}
          <path d="M20 230 Q 200 225 300 120 T 370 30 L370 230 Z" fill="#22c55e33" />
          <path d="M20 230 Q 200 225 300 120 T 370 30" fill="none" stroke="#22c55e" strokeWidth="6" strokeLinecap="round" />
          <text x="372" y="40" fontSize="44" textAnchor="middle">🚀</text>
          <text x="140" y="120" fontSize="58" fontWeight="900" fill="#fff">4.20x</text>
        </g>
      )}
      {game === 'mines' && (
        <g>
          <rect width="400" height="260" fill="#0f172a" />
          {Array.from({ length: 15 }, (_, i) => {
            const x = 70 + (i % 5) * 54, y = 30 + Math.floor(i / 5) * 70
            const kind = [2, 8].includes(i) ? '💣' : [0, 4, 6, 11, 13].includes(i) ? '💎' : ''
            return (
              <g key={i}>
                <rect x={x} y={y} width="46" height="58" rx="8" fill={kind === '💣' ? '#7f1d1d' : kind ? '#064e3b' : '#334155'} />
                {kind && <text x={x + 23} y={y + 39} fontSize="26" textAnchor="middle">{kind}</text>}
              </g>
            )
          })}
        </g>
      )}
      {game === 'plinko' && (
        <g>
          <rect width="400" height="260" fill="#1e1036" />
          {Array.from({ length: 8 }, (_, r) => Array.from({ length: r + 3 }, (_, k) => (
            <circle key={`${r}-${k}`} cx={200 + (k - (r + 2) / 2) * 34} cy={24 + r * 26} r="4.5" fill="#e9d5ff" />
          )))}
          {[33, 11, 4, 2, 0.6, 2, 4, 11, 33].map((m, i) => (
            <g key={i}>
              <rect x={49 + i * 34} y="230" width="30" height="24" rx="5" fill={m >= 10 ? '#e11d48' : m >= 3 ? '#f97316' : m >= 1.5 ? '#f59e0b' : '#0ea5e9'} />
            </g>
          ))}
          <circle cx="217" cy="118" r="9" fill="#f472b6" />
        </g>
      )}
    </svg>
  )
}
