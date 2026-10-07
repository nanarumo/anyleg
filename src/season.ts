// Weekly seasons: profit rankings reset every Monday. Bots sit on the board so there's always someone to chase.
// Pure, so `node src/season.test.ts` runs it.

const WEEK = 7 * 86_400_000
const SEASON_ONE = new Date(2026, 9, 5).getTime() // the Monday seasons launched, so the first one reads "Season 1"

/** Local Monday 00:00 of the week containing `t`. */
export function weekStart(t = Date.now()) {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.getTime()
}
export const weekId = (t = Date.now()) => new Date(weekStart(t)).toLocaleDateString('en-CA')
export const seasonNo = (t = Date.now()) => Math.round((weekStart(t) - SEASON_ONE) / WEEK) + 1
export const nextReset = (t = Date.now()) => { const d = new Date(weekStart(t)); d.setDate(d.getDate() + 7); return d.getTime() }

export const PRIZES = [
  { cash: 1000, skin: 'champion', label: '$1,000 + Champion felt' },
  { cash: 500, skin: 'silver', label: '$500 + Silver card back' },
  { cash: 250, skin: 'bronze', label: '$250 + Bronze card back' },
] as const

export const SEASON_BOTS = [
  { id: 'bot:shark', name: 'Shark Bot', avatar: '🦈', mean: 1500, sd: 1400 },
  { id: 'bot:pro', name: 'Pro Bot', avatar: '🧠', mean: 600, sd: 900 },
  { id: 'bot:rookie', name: 'Rookie Bot', avatar: '🤖', mean: -150, sd: 700 },
]

/** A bot's profit so far this week: a seeded weekly result, earned steadily across the week. */
export function botNet(week: string, bot: (typeof SEASON_BOTS)[number], t = Date.now()) {
  let h = [...week + bot.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 17)
  const r = () => ((h = (h * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  const z = Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r()) // standard normal
  const done = Math.min(1, Math.max(0, (t - new Date(week + 'T00:00:00').getTime()) / WEEK))
  return Math.round((bot.mean + z * bot.sd) * done)
}
