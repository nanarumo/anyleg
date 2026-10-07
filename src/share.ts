// Bet sharing: a slip travels inside a link (#tail=…), so a friend opening it gets the same legs in one tap.
import type { Leg } from './store.ts'

const enc = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const dec = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))

export function tailLink(legs: Leg[], from: string) {
  const clean = legs.map(({ result, moved, ...l }) => l)
  return `${location.origin}${location.pathname}#tail=${enc(JSON.stringify({ from, legs: clean }))}`
}

/** A shared slip in the current URL, if any (and clears it so a refresh doesn't re-load it). */
export function readTail(): { from: string; legs: Leg[] } | undefined {
  const m = location.hash.match(/tail=([\w-]+)/)
  if (!m) return
  history.replaceState(null, '', location.pathname + location.search)
  try { const t = JSON.parse(dec(m[1])); return Array.isArray(t.legs) ? t : undefined } catch { return }
}

/** Copy text. The Clipboard API only exists on https, and the app runs over plain http on your Wi-Fi,
 * so use the old select-and-copy trick first (runs inside the tap). iPhones won't select a readonly box,
 * so the box is editable and selected with a range as well; the Clipboard API is the fallback. */
export function copyText(text: string): boolean {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.contentEditable = 'true'
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;font-size:16px'
  document.body.appendChild(ta)
  const range = document.createRange()
  range.selectNodeContents(ta)
  const sel = getSelection()
  sel?.removeAllRanges(); sel?.addRange(range)
  ta.focus({ preventScroll: true })
  ta.setSelectionRange(0, text.length)
  let ok = false
  try { ok = document.execCommand('copy') } catch {}
  ta.remove(); sel?.removeAllRanges()
  if (!ok && window.isSecureContext && navigator.clipboard) { navigator.clipboard.writeText(text).catch(() => {}); return true }
  return ok
}

/** Phone share sheet when available; otherwise clipboard; otherwise a box to copy from (plain http has neither). */
export async function shareLink(url: string, text: string): Promise<string> {
  try { if (navigator.share) { await navigator.share({ title: 'Anyleg', text, url }); return 'Shared' } } catch (e) { if ((e as Error).name === 'AbortError') return '' }
  if (copyText(url)) return 'Link copied'
  window.prompt('Copy this link and send it:', url)
  return ''
}

// ---- Creator slips: parlays people post to the Swipe feed for others to tail ----
// ponytail: stored on this device (every account here sees them) plus share links; a backend makes the feed global.
export type CreatorSlip = { id: string; by: string; avatar: string; color?: string; accountId?: string; legs: Leg[]; at: number; record?: { w: number; l: number } }
const CREATOR_KEY = 'anyleg-creator-slips'
export const readCreatorSlips = (): CreatorSlip[] => { try { return JSON.parse(localStorage.getItem(CREATOR_KEY) ?? '[]') } catch { return [] } }
export function publishSlip(slip: Omit<CreatorSlip, 'id' | 'at'>): string {
  const all = readCreatorSlips()
  const legs = slip.legs.map(({ result, moved, note, chaos, ...l }) => l)
  const key = legs.map(l => l.id).sort().join()
  if (all.some(c => c.accountId === slip.accountId && c.legs.map(l => l.id).sort().join() === key)) return 'Already posted'
  const entry = { ...slip, legs, id: `${Date.now()}`, at: Date.now() }
  try { localStorage.setItem(CREATOR_KEY, JSON.stringify([entry, ...all].slice(0, 40))) } catch {}
  return 'Posted to Swipe'
}
