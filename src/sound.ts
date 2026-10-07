// Sound effects synthesized with Web Audio (no audio files to load) and phone haptics.
// Off when Settings → sound is off. iPhones ignore vibrate(); sounds still play there.
import { getState } from './store.ts'

let ctx: AudioContext | undefined
const enabled = () => getState().settings.sound !== false
function audio() {
  if (!enabled()) return
  try { ctx ??= new AudioContext() } catch { return }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

/** One short note: frequency (Hz), length (s), wave, volume, start delay (s), optional slide to another pitch. */
function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.12, delay = 0, to?: number) {
  const a = audio()
  if (!a) return
  const t = a.currentTime + delay
  const o = a.createOscillator(), g = a.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t)
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur)
  g.gain.setValueAtTime(vol, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(a.destination)
  o.start(t)
  o.stop(t + dur + 0.02)
}

/** A burst of filtered noise: card snaps, the roulette ball rattle. */
function noise(dur: number, vol = 0.15, delay = 0, freq = 2500) {
  const a = audio()
  if (!a) return
  const buf = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * dur)), a.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain()
  src.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; g.gain.value = vol
  src.connect(f).connect(g).connect(a.destination)
  src.start(a.currentTime + delay)
}

export const buzz = (pattern: number | number[]) => { if (enabled()) try { navigator.vibrate?.(pattern) } catch {} }

export const sfx = {
  chip: () => { tone(1800, 0.05, 'triangle', 0.08); tone(2600, 0.04, 'triangle', 0.05, 0.02) },
  card: () => noise(0.06, 0.22, 0, 3200),
  click: () => tone(900, 0.04, 'square', 0.04),
  peg: () => tone(1200 + Math.random() * 600, 0.05, 'sine', 0.05),
  rattle: (secs = 2.4) => { for (let i = 0; i < secs * 14; i++) noise(0.025, 0.05 * (1 - i / (secs * 14)) + 0.02, i / 14 + Math.random() * 0.03, 4000) },
  tick: (m: number) => tone(300 + Math.min(m, 20) * 40, 0.03, 'sine', 0.03),
  crash: () => { noise(0.5, 0.3, 0, 300); tone(160, 0.5, 'sawtooth', 0.08, 0, 50) },
  win: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'triangle', 0.1, i * 0.08)); buzz([30, 40, 60]) },
  lose: () => tone(220, 0.3, 'sine', 0.08, 0, 110),
  legHit: () => { [659, 988, 1319].forEach((f, i) => tone(f, 0.22, 'triangle', 0.11, i * 0.09)); buzz([60, 50, 120]) },
}
