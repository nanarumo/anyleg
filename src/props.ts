// Player props (NFL, NBA, NHL): DraftKings lines from ESPN's core odds API (no key, CORS open). The feed carries
// the lines but not the prices, so main over/unders are priced at a standard -115 and ladder rungs ("75+") are
// priced from the main line (live.ts ladderProb).
// ponytail: NBA/NHL prop names are matched by pattern because DraftKings posts them on game day; NFL names are exact.
import { PROP_STATS, type PropStat } from './logic.ts'
import type { Game } from './odds.ts'
import type { Leg } from './store.ts'
import { ladderOdds, ladderProb } from './live.ts'

export const PROP_ODDS = -115
export const STALE_MS = 5 * 60_000

const TYPES: Record<string, PropStat> = {
  'Total Passing Yards (incl. overtime)': 'passYds',
  'Total Passing Touchdowns (incl. overtime)': 'passTd',
  'Total Pass Completions (incl. overtime)': 'completions',
  'Total Rushing Yards (incl. overtime)': 'rushYds',
  'Total Carries (incl. overtime)': 'carries',
  'Total Receiving Yards (incl. overtime)': 'recYds',
  'Total Receptions (incl. overtime)': 'receptions',
  'Total Rushing Plus Receiving Yards (incl. overtime)': 'rushRecYds',
}
const LADDERS: Record<string, PropStat> = {
  'Passing Yards Milestones': 'passYds',
  'Passing Touchdown Milestones': 'passTd',
  'Passing Completions Milestones': 'completions',
  'Rushing Yards Milestones': 'rushYds',
  'Rushing Attempts Milestones': 'carries',
  'Receiving Yards Milestones': 'recYds',
  'Receptions Milestones': 'receptions',
  'Rushing + Receiving Yards Milestones': 'rushRecYds',
}
/** NBA/NHL prop types by name pattern; checked in order, so combos come before their parts. Main lines start "Total". */
const PATTERNS: Record<string, [RegExp, PropStat][]> = {
  nba: [[/points.*rebounds.*assists/i, 'pra'], [/three|3-?pointers|3pt/i, 'threes'], [/rebounds/i, 'reb'], [/assists/i, 'ast'], [/points/i, 'pts']],
  nhl: [[/shots on goal/i, 'sog'], [/saves/i, 'saves'], [/points/i, 'hkPts']],
}
export const PROP_LEAGUES = ['nfl', 'nba', 'nhl']
/** Which stat a prop type is, and whether it's a main line or a ladder rung ("Milestones"). */
function classify(league: string, name = ''): { stat?: PropStat; ladder?: boolean } {
  if (league === 'nfl') return TYPES[name] ? { stat: TYPES[name] } : LADDERS[name] ? { stat: LADDERS[name], ladder: true } : {}
  const ladder = /milestone/i.test(name)
  if (!ladder && !/^total /i.test(name)) return {} // skip scorer markets and the like
  if (/team|period|quarter|half/i.test(name)) return {} // team totals and partial-game lines aren't player props
  const hit = PATTERNS[league]?.find(([re]) => re.test(name))
  return hit ? { stat: hit[1], ladder } : {}
}
const COUNTS = new Set<PropStat>(['passTd', 'completions', 'carries', 'receptions', 'reb', 'ast', 'threes', 'sog', 'hkPts', 'saves'])
const SD: Partial<Record<PropStat, (line: number) => number>> = { pts: l => 0.22 * l + 3, pra: l => 0.2 * l + 4 } // basketball scoring is tighter than yardage
const ORDER = Object.keys(PROP_STATS) as PropStat[]

// No headshots: player photos are copyrighted and carry likeness rights. Names + stats are fine.
type Athlete = { name: string; short: string; pos: string; team: string; logo?: string }
export type Rung = { at: number; odds: number } // "at or more", e.g. 75 = 75+
export type Prop = { key: string; game: Game; athleteId: string; who: Athlete; stat: PropStat; line: number; ladder: Rung[] }

const json = async (url: string) => {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.json()
}

const rosters = new Map<string, Promise<Map<string, Athlete>>>()
function roster(path: string, teamId: string, team: Game['home']) {
  const id = `${path}:${teamId}`
  if (!rosters.has(id)) {
    rosters.set(id, json(`https://site.api.espn.com/apis/site/v2/sports/${path}/teams/${teamId}/roster`).then(r =>
      // NFL and NHL rosters come grouped by position (items); the NBA roster is a flat list
      new Map<string, Athlete>((r.athletes ?? []).flatMap((grp: any) => grp.items ?? [grp]).map((a: any): [string, Athlete] => [String(a.id), {
        name: a.displayName ?? a.fullName, short: a.shortName ?? a.displayName, pos: a.position?.abbreviation ?? '',
        team: team.abbr, logo: team.logo,
      }])),
    ).catch(e => { rosters.delete(id); throw e }))
  }
  return rosters.get(id)!
}

const cache = new Map<string, { at: number; props: Promise<Prop[]> }>()

/** One game's player prop lines, cached for a few minutes. Players we can't name (not on a roster) are skipped. */
export function fetchProps(g: Game): Promise<Prop[]> {
  if (!PROP_LEAGUES.includes(g.league) || g.state !== 'pre' || !g.home.id || !g.away.id) return Promise.resolve([])
  const hit = cache.get(g.id)
  if (hit && Date.now() - hit.at < STALE_MS) return hit.props
  const props = (async () => {
    const [sport, league] = g.path.split('/')
    const url = `https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${league}/events/${g.id}/competitions/${g.id}/odds/100/propBets?limit=1000`
    const first = await json(url)
    const rest = await Promise.all(Array.from({ length: Math.max(0, (first.pageCount ?? 1) - 1) }, (_, i) => json(`${url}&page=${i + 2}`)))
    const people = new Map([...await roster(g.path, g.away.id!, g.away), ...await roster(g.path, g.home.id!, g.home)])
    const seen = new Map<string, Prop>()
    const rungs = new Map<string, Set<number>>()
    for (const it of [first, ...rest].flatMap(p => p.items ?? [])) {
      const { stat: kind, ladder: isRung } = classify(g.league, it.type?.name)
      const stat = isRung ? undefined : kind, ladder = isRung ? kind : undefined
      const line = it.current?.target?.value
      const athleteId = String(it.athlete?.$ref ?? '').match(/athletes\/(\d+)/)?.[1]
      const who = athleteId && people.get(athleteId)
      if ((!stat && !ladder) || typeof line !== 'number' || !who) continue
      const key = `${g.league}:${g.id}:prop:${athleteId}:${stat ?? ladder}`
      if (ladder) rungs.set(key, (rungs.get(key) ?? new Set()).add(line))
      else if (!seen.has(key)) seen.set(key, { key, game: g, athleteId: athleteId!, who, stat: stat!, line, ladder: [] })
    }
    // Ladder rungs need the main line to price from; keep the ones that aren't near-locks or lottery tickets.
    for (const p of seen.values()) {
      p.ladder = [...(rungs.get(p.key) ?? [])].sort((a, b) => a - b)
        .map(at => ({ at, odds: ladderOdds(ladderProb(COUNTS.has(p.stat), p.line, at, SD[p.stat]?.(p.line))) }))
        .filter(r => r.odds >= -700 && r.odds <= 800 && r.at !== Math.ceil(p.line)) // the rung at the line is just the over
      if (p.ladder.length > 6) p.ladder = Array.from({ length: 6 }, (_, i) => p.ladder[Math.round((i * (p.ladder.length - 1)) / 5)])
    }
    return [...seen.values()].sort((a, b) => ORDER.indexOf(a.stat) - ORDER.indexOf(b.stat) || b.line - a.line)
  })()
  cache.set(g.id, { at: Date.now(), props })
  props.catch(() => cache.delete(g.id))
  return props
}

export const propLeg = (p: Prop, side: 'over' | 'under'): Leg => ({
  id: `${p.key}:${side}`,
  label: `${p.who.name} ${side === 'over' ? 'Over' : 'Under'} ${p.line} ${PROP_STATS[p.stat].name}`,
  sub: `${p.game.away.abbr} @ ${p.game.home.abbr} · Player prop`,
  odds: PROP_ODDS,
  sport: { path: p.game.path, eventId: p.game.id, market: 'prop', side, line: p.line, prop: { athleteId: p.athleteId, stat: p.stat } },
  icon: p.who.logo,
})

/** A ladder rung as a leg: "Bijan Robinson 75+ Rushing Yards" = over 74.5. */
export const rungLeg = (p: Prop, r: Rung): Leg => ({
  id: `${p.key}:alt:${r.at}`,
  label: `${p.who.name} ${r.at}+ ${PROP_STATS[p.stat].name}`,
  sub: `${p.game.away.abbr} @ ${p.game.home.abbr} · Player prop`,
  odds: r.odds,
  sport: { path: p.game.path, eventId: p.game.id, market: 'prop', side: 'over', line: r.at - 0.5, prop: { athleteId: p.athleteId, stat: p.stat } },
  icon: p.who.logo,
})

/** Every leg a prop offers (both sides of the main line + each rung), e.g. to re-price a shared slip. */
export const propLegs = (p: Prop): Leg[] => [propLeg(p, 'over'), propLeg(p, 'under'), ...p.ladder.map(r => rungLeg(p, r))]
