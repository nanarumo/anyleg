import { sfx } from './sound.ts'
import { useEffect, type CSSProperties } from 'react'
import type { Card } from './logic.ts'

/** Small stable tilt per card so a hand looks hand-dealt rather than perfectly aligned. */
const tiltFor = (c: Card, i: number) => {
  const h = [...(c.rank + c.suit)].reduce((a, ch) => a * 31 + ch.charCodeAt(0), i + 7)
  return ((h % 7) - 3) * 0.8
}

/**
 * A playing card that flies in from the shoe (`from` = offset of the shoe from the card's resting spot),
 * spinning and turning face-up mid-flight; face-down cards stay back-up and flip later via `faceDown`.
 */
export function CardView({ c, i = 0, faceDown, delay = 0, from = { x: 260, y: -240 }, sideways, className = '', onClick, onLanded }: {
  c: Card; i?: number; faceDown?: boolean; delay?: number; from?: { x: number; y: number }
  sideways?: boolean; className?: string; onClick?: () => void
  onLanded?: () => void // fires when the deal animation finishes, so totals can update as the card lands
}) {
  const red = c.suit === '♥' || c.suit === '♦'
  useEffect(() => { const t = setTimeout(sfx.card, delay * 1000); return () => clearTimeout(t) }, []) // card snap as it's dealt
  const suit = c.suit + '︎' // text style, so iPhones don't swap in big colour emoji hearts and spades
  const style = {
    '--fx': `${from.x}px`, '--fy': `${from.y}px`, '--tilt': `${tiltFor(c, i) + (sideways ? 90 : 0)}deg`,
    animationDelay: `${delay}s`,
  } as CSSProperties
  return (
    <div className={`card3d ${faceDown ? 'down' : ''} ${sideways ? 'sideways' : ''} ${className}`} style={style} onClick={onClick} onAnimationEnd={onLanded}>
      <div className={`face front ${red ? 'red' : ''}`}>
        <span className="corner">{c.rank}<br />{suit}</span>
        <span className="pip-big">{suit}</span>
        <span className="corner br">{c.rank}<br />{suit}</span>
      </div>
      <div className="face back" />
    </div>
  )
}
