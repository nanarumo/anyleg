// Exit animations: fade an overlay (game screen, sheet, modal, phone bet slip) out before it unmounts,
// so closing things doesn't snap. Entry animations are plain CSS (styles.css "motion").
const OVERLAY = '.game-screen, .sheet-back, .modal, .slip.open'

/** Animate the overlay that `from` sits in (a click event, an element, or a selector), then run `done`. */
export function leave(from: { currentTarget: EventTarget | null } | Element | string, done: () => void) {
  const start = typeof from === 'string' ? document.querySelector(from) : from instanceof Element ? from : (from.currentTarget as Element | null)
  const el = start?.closest(OVERLAY)
  if (!el || el.getAttribute('data-leaving') || matchMedia('(prefers-reduced-motion: reduce)').matches) return done()
  el.setAttribute('data-leaving', '1')
  const opts = { duration: 200, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' as const }
  el.animate([{ opacity: 1 }, { opacity: 0 }], opts)
  const panel = el.matches('.slip.open') ? el : el.querySelector('.sheet, .spin-card, .gs-body')
  panel?.animate([{ transform: 'none' }, { transform: el.matches('.slip.open') ? 'translateX(40px)' : el.matches('.sheet-back') ? 'translateY(48px)' : 'scale(.97)' }], opts)
  setTimeout(done, 180)
}
