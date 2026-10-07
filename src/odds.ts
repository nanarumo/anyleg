// Live lines from ESPN's public scoreboard API, which carries DraftKings odds. No key needed, CORS open.
import { useEffect, useState } from 'react'
import { boxStats, gradeProp, gradeSport, parseOdds, type Market, type Side } from './logic.ts'
import { getState, gradeLegs, refreshSlipOdds } from './store.ts'
import { livePrices, type LiveInput } from './live.ts'

export const LEAGUES = [
  { key: 'nfl', name: 'NFL', path: 'football/nfl' },
  { key: 'ncaaf', name: 'NCAAF', path: 'football/college-football' },
  { key: 'nba', name: 'NBA', path: 'basketball/nba' },
  { key: 'wnba', name: 'WNBA', path: 'basketball/wnba' },
  { key: 'mlb', name: 'MLB', path: 'baseball/mlb' },
  { key: 'nhl', name: 'NHL', path: 'hockey/nhl' },
  { key: 'epl', name: 'EPL', path: 'soccer/eng.1' },
  { key: 'mls', name: 'MLS', path: 'soccer/usa.1' },
]

const POLL_MS = 30_000

export type Team = { id?: string; name: string; abbr: string; logo?: string; score?: number }
export type Price = { id: string; odds: number; line?: number; market: Market; side: Side; live?: boolean }
export type Game = {
  id: string
  league: string
  path: string
  start: string
  state: 'pre' | 'in' | 'post'
  detail: string
  home: Team
  away: Team
  prices: Price[]
  live?: LiveInput // score + clock + pregame line while in progress (live pricing, cash out)
}

const PREGAME_KEY = 'anyleg-pregame'
const pregame: Record<string, { margin?: number; total?: number }> = (() => { try { return JSON.parse(localStorage.getItem(PREGAME_KEY) ?? '{}') } catch { return {} } })()
const savePregame = () => { try { localStorage.setItem(PREGAME_KEY, JSON.stringify(Object.fromEntries(Object.entries(pregame).slice(-300)))) } catch {} }

/** Team-colored abbreviation badge (an SVG data URI) shown instead of team logos, which are league trademarks. */
export function badge(abbr = '', color?: string) {
  const fill = /^[0-9a-f]{6}$/i.test(color ?? '') ? `#${color}` : '#475569'
  const txt = abbr.replace(/[^A-Za-z0-9]/g, '').slice(0, 4)
  return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18.5" fill="${fill}" stroke="#fff" stroke-opacity=".7" stroke-width="2"/><text x="20" y="24.5" font-family="system-ui,sans-serif" font-size="${txt.length > 3 ? 10 : 12.5}" font-weight="800" text-anchor="middle" fill="#fff" stroke="#000" stroke-opacity=".45" stroke-width="1.5" paint-order="stroke">${txt}</text></svg>`)
}

const num = (s?: string) => (s == null ? undefined : Number(String(s).replace(/^[ou]/, '')))

function parseGame(league: (typeof LEAGUES)[number], e: any): Game {
  const comp = e.competitions[0]
  const team = (ha: string): Team => {
    const t = comp.competitors.find((c: any) => c.homeAway === ha)
    return { id: t.team.id, name: t.team.shortDisplayName ?? t.team.name, abbr: t.team.abbreviation, logo: badge(t.team.abbreviation, t.team.color), score: t.score == null ? undefined : Number(t.score) }
  }
  const prices: Price[] = []
  const o = comp.odds?.[0]
  const add = (market: Market, side: Side, odds?: string, line?: string) => {
    const am = parseOdds(odds)
    const ln = num(line)
    if (am === undefined || (market !== 'ml' && !Number.isFinite(ln))) return
    prices.push({ id: `${league.key}:${e.id}:${market}:${side}`, odds: am, line: ln, market, side })
  }
  const state = e.status.type.state
  let live: LiveInput | undefined
  // Remember each game's pregame line: live prices start from it once the book's odds drop off the feed.
  const preHome = num(o?.pointSpread?.home?.close?.line), preTotal = num(o?.total?.over?.close?.line)
  if (state === 'pre' && (preHome !== undefined || preTotal !== undefined)) pregame[e.id] = { margin: preHome === undefined ? undefined : -preHome, total: preTotal }
  if (state === 'in') {
    const sc = (ha: string) => Number(comp.competitors.find((c: any) => c.homeAway === ha).score) || 0
    const pre = pregame[e.id] ?? { margin: preHome === undefined ? undefined : -preHome, total: preTotal }
    live = { league: league.key, home: sc('home'), away: sc('away'), period: e.status.period ?? 1, clock: e.status.displayClock ?? '', pre }
    for (const p of livePrices(`${league.key}:${e.id}`, live)) {
      prices.push({ id: `${league.key}:${e.id}:live:${p.market}:${p.side}${p.line === undefined ? '' : ':' + p.line}`, ...p, live: true })
    }
  }
  if (o && state === 'pre') {
    add('spread', 'away', o.pointSpread?.away?.close?.odds, o.pointSpread?.away?.close?.line)
    add('spread', 'home', o.pointSpread?.home?.close?.odds, o.pointSpread?.home?.close?.line)
    add('total', 'over', o.total?.over?.close?.odds, o.total?.over?.close?.line)
    add('total', 'under', o.total?.under?.close?.odds, o.total?.under?.close?.line)
    add('ml', 'away', o.moneyline?.away?.close?.odds)
    add('ml', 'home', o.moneyline?.home?.close?.odds)
    add('ml', 'draw', o.moneyline?.draw?.close?.odds)
  }
  return {
    id: e.id, league: league.key, path: league.path, start: e.date,
    state: e.status.type.state, detail: e.status.type.shortDetail,
    home: team('home'), away: team('away'), prices, live,
  }
}

async function fetchJson(url: string) {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.json()
}

async function fetchAll(): Promise<Game[]> {
  const feeds = await Promise.allSettled(
    LEAGUES.map(async l => (await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/${l.path}/scoreboard`)).events.map((e: any) => parseGame(l, e))),
  )
  savePregame()
  return feeds.flatMap(f => (f.status === 'fulfilled' ? f.value : []))
}

/** Grade every pending sports leg whose game is final. Games not on today's board are looked up individually. */
async function settleSports(games: Game[]) {
  const pending = getState().bets.filter(b => b.status === 'pending').flatMap(b => b.legs).filter(l => l.sport && l.result === 'pending')
  if (!pending.length) return
  const finals = new Map(games.filter(g => g.state === 'post').map(g => [g.id, g]))
  const onBoard = new Set(games.map(g => g.id))
  // Games off today's board need their score, and finished games with player props need the box score.
  const lookup = [...new Map(pending.filter(l => !onBoard.has(l.sport!.eventId) || (l.sport!.prop && finals.has(l.sport!.eventId)))
    .map(l => [l.sport!.eventId, l.sport!])).values()]
  const boxes = new Map<string, ReturnType<typeof boxStats>>()
  await Promise.allSettled(lookup.map(async s => {
    const sum = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/${s.path}/summary?event=${s.eventId}`)
    const comp = sum.header.competitions[0]
    if (!comp.status.type.completed) return
    const score = (ha: string) => Number(comp.competitors.find((c: any) => c.homeAway === ha).score)
    if (!finals.has(s.eventId)) finals.set(s.eventId, { home: { score: score('home') }, away: { score: score('away') } } as Game)
    boxes.set(s.eventId, boxStats(sum.boxscore?.players))
  }))
  gradeLegs(l => {
    const s = l.sport
    const g = s && finals.get(s.eventId)
    if (!g) return undefined
    if (s.prop) { const box = boxes.get(s.eventId); return box ? gradeProp(s.prop.stat, s.side, s.line!, box.get(s.prop.athleteId)) : undefined }
    return gradeSport(s.market, s.side, s.line, g.home.score!, g.away.score!)
  })
}

/** Polls every 30s. Keeps the previous odds so the UI can flash line moves. */
export function useLiveGames() {
  const [games, setGames] = useState<Game[]>([])
  const [prev, setPrev] = useState<Map<string, number>>(new Map())
  const [updated, setUpdated] = useState<Date>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    let alive = true
    let last = new Map<string, number>()
    const tick = async () => {
      try {
        const g = await fetchAll()
        if (!alive) return
        const current = new Map(g.flatMap(x => x.prices.map(p => [p.id, p.odds] as const)))
        setPrev(last)
        last = current
        setGames(g)
        setUpdated(new Date())
        setError(g.length ? undefined : 'No games returned')
        refreshSlipOdds(current, new Set(g.map(x => x.id)), new Set(g.filter(x => x.state !== 'pre').map(x => x.id)))
        settleSports(g)
      } catch (e) {
        if (alive) setError(String(e))
      }
    }
    tick()
    // Don't poll while the app is in the background; catch up the moment it's back.
    const t = setInterval(() => { if (!document.hidden) tick() }, POLL_MS)
    const wake = () => { if (!document.hidden) tick() }
    document.addEventListener('visibilitychange', wake)
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', wake) }
  }, [])

  return { games, prev, updated, error }
}
