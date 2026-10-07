import { useSyncExternalStore } from 'react'
import { CHAOS_BOOST, simRound, applyTokens, gradeCasino, roundText, parlayDecimal, settleFlex, FLEX_MIN, toDecimal, uid, setOddsFormat, settle, type CasinoGame, type Market, type PropStat, type Result, type Round, type Side } from './logic.ts'
import { CHALLENGES, newlyCompleted, type SkinId } from './challenges.ts'
import { PRIZES, weekId } from './season.ts'
import { MAX_LEVEL, MAX_PRESTIGE, XP_PER_LEG_HIT, levelOf, prestigeRewards, rewardsAt, xpForCasinoWin, xpForTicket, type Reward } from './progression.ts'

export type Leg = {
  id: string // unique market key, e.g. "nfl:401872974:ml:home" or "casino:roulette:red"
  label: string // "Vikings ML"
  sub: string // "MIA @ MIN · Moneyline"
  odds: number // American
  moved?: 'up' | 'down' // set when live odds change while the leg sits in the slip
  result?: Result
  sport?: { path: string; eventId: string; market: Market; side: Side; line?: number; prop?: { athleteId: string; stat: PropStat } }
  casino?: { game: CasinoGame; pick: string }
  icon?: string // team logo (or first team for totals)
  icon2?: string // second logo, for totals/draws that involve both teams
  note?: string // how its casino round went ("Rocket crashed at 3.10x"), for replays
  chaos?: boolean // the mystery leg added after locking (Chaos leg)
  by?: string // squad leg added by a squadmate: only they play it (bots play theirs automatically)
}

export type Bet = {
  id: string; legs: Leg[]; stake: number; placedAt: number; status: Result; payout: number
  boost?: number // profit boost from a reward token, e.g. 0.5 = +50% profit
  insured?: boolean // parlay insurance: losing by exactly one leg refunds the stake
  refunded?: boolean
  daily?: boolean // the Daily Boost parlay
  sgpMult?: number // same-game parlay pricing: pays this share of the straight product (set at placement)
  cashedOut?: boolean // sold early: payout is the cash-out amount, open legs stay ungraded
  xp?: number // XP this ticket earned
  flex?: boolean // flex parlay: one leg can miss (logic.ts settleFlex)
  squad?: boolean // the squad's weekly parlay: staked from and paid into the squad bank
}

/** A squad: a shared bank and one weekly parlay where every member adds one leg. ponytail: lives on this device; real multi-phone squads need the backend. */
export type SquadMember = { name: string; avatar: string; bot?: boolean }
export type Squad = { name: string; members: SquadMember[]; bank: number; week: string; picks: (Leg | null)[]; betId?: string }

/** Reward tokens earned from leveling up. */
export type Inventory = { spins: number; boost25: number; boost50: number; boost100: number; insurance: number }
export type BoostKey = 'boost25' | 'boost50' | 'boost100'
export const BOOST_PCT: Record<BoostKey, number> = { boost25: 25, boost50: 50, boost100: 100 }
export const FREE_SPIN_VALUE = 5
const NO_INV: Inventory = { spins: 0, boost25: 0, boost50: 0, boost100: 0, insurance: 0 }

/** One paid casino round (parlay legs played for free are tickets, not rounds). */
export type CasinoRound = { id: string; game: CasinoGame; wager: number; returned: number; at: number; note?: string }

/** Wallet movements that are not bets: bonuses and rewards ('deposit', 'withdraw', 'rewards' only appear in old history). */
export type Txn = { id: string; type: 'deposit' | 'withdraw' | 'bonus' | 'rewards' | 'level' | 'referral'; amount: number; at: number }

export type Settings = {
  oddsFormat: 'american' | 'decimal'
  defaultStake: number
  notify: { settled: boolean; bonus: boolean; legs: boolean }
  sessionReminderMin: number // 0 = off
  coolOffUntil?: number // "take a break": no betting until this time
  dailyLimit?: number // most you can wager per day (0/undefined = no limit)
  limitRaise?: { value: number; at: number } // a looser limit waits 24h before it applies
  sound?: boolean // sound effects + phone buzzes (undefined = on)
  swipe: SwipePrefs
}

/** Swipe Bet preferences, set from the Swipe options sheet. */
export type SwipePrefs = {
  mode: 'parlay' | 'straight' // right swipe adds to the slip, or places a straight bet at `stake`
  stake: number
  leagues: string[] // league keys from odds.ts LEAGUES
  markets: Market[]
  casino: boolean // include casino legs (parlay mode) / tables (straight mode)
  props?: boolean // player props in the deck (undefined = on)
  games?: CasinoGame[] // which casino games deal cards (undefined = all)
  casinoOnly?: boolean // casino cards only, no sports
}
export const DEFAULT_SETTINGS: Settings = {
  oddsFormat: 'american', defaultStake: 10, notify: { settled: true, bonus: true, legs: true }, sessionReminderMin: 0,
  swipe: { mode: 'parlay', stake: 10, leagues: ['nfl', 'ncaaf', 'nba', 'wnba', 'mlb', 'nhl', 'epl', 'mls'], markets: ['ml', 'spread', 'total'], casino: true },
}

type State = {
  balance: number; slip: Leg[]; bets: Bet[]; rounds: CasinoRound[]; lastBonus?: number
  boostDay?: string // local date the Daily Boost was bet
  spent?: { day: string; amt: number } // wagered today, for the daily limit
  taste?: Record<string, number> // Swipe: what you swipe right on (league:nfl, market:prop, game:crash…), learned over time
  txns: Txn[]; settings: Settings; seenNotesAt: number
  xp: number; inv: Inventory; unlocked: string[]; frame?: string
  levelUp?: { level: number; at: number; rewards: Reward[] } // newest level-up, for the celebration
  challengesDone: string[]
  challengeLog: { id: string; at: number }[] // completions, newest first, for the slide-in toast
  tableSkin: SkinId; cardBack: SkinId
  prestige: number
  claimedLevels: string[] // "<prestige>:<level>" level rewards already collected
  challengesClaimed: string[] // completed challenges whose XP/skin was collected
  seasonsClaimed?: string[] // weekly leaderboard prizes collected, by week id
  prestigeStartedAt?: number // challenges only count play since this moment
  prestigeUp?: { prestige: number; at: number; rewards: Reward[] } // newest prestige, for the celebration
  squad?: Squad
  squadPicking?: number // member whose squad leg the next tapped line becomes (instead of going in the slip)
}

/** Local profile. Each account has its own wallet and history on this device (no server yet, so no password). */
export type Account = {
  id: string; name: string; avatar: string; color: string; createdAt: number; lastLogin?: number; prevLogin?: number
  referredBy?: string // account id whose code this account joined with
  friends?: string[] // account ids
}
type Accounts = { current?: string; list: Account[] }

const GUEST_KEY = 'parlay-anything-v1' // pre-accounts storage; now the guest wallet
const ACCOUNTS_KEY = 'anyleg-accounts'
const keyFor = (id?: string) => (id ? `anyleg-state-${id}` : GUEST_KEY)
const START_BALANCE = 500 // play money is meant to be scarce: no deposits, small free top-ups
export const BONUS_EVERY_MS = 24 * 60 * 60 * 1000
export const SESSION_START = Date.now()

const read = <T,>(key: string): T | undefined => {
  try { return JSON.parse(localStorage.getItem(key) ?? '') } catch { return undefined }
}
const write = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)) } catch {} }

let accounts: Accounts = stampLogin(read<Accounts>(ACCOUNTS_KEY) ?? { list: [] })

/** Remember the previous login so the profile can show "Last login". */
function stampLogin(a: Accounts): Accounts {
  const list = a.list.map(x => (x.id === a.current ? { ...x, prevLogin: x.lastLogin, lastLogin: Date.now() } : x))
  write(ACCOUNTS_KEY, { ...a, list })
  return { ...a, list }
}
let state: State = load(accounts.current)
const listeners = new Set<() => void>()

function load(id?: string): State {
  const s = read<Partial<State>>(keyFor(id))
  const base: State = {
    balance: START_BALANCE, slip: [], bets: [], rounds: [], txns: [], settings: DEFAULT_SETTINGS, seenNotesAt: 0,
    xp: 0, inv: NO_INV, unlocked: [], challengesDone: [], challengeLog: [], tableSkin: 'classic', cardBack: 'red', prestige: 0, claimedLevels: [], challengesClaimed: [],
  }
  const out: State = s && typeof s.balance === 'number'
    ? { ...base, ...s, settings: { ...DEFAULT_SETTINGS, ...s.settings }, inv: { ...NO_INV, ...s.inv } }
    : base
  // Saves from before rewards had to be claimed were already paid out: count those as claimed.
  if (s && !s.claimedLevels) {
    const lv = levelOf(out.xp).level
    out.claimedLevels = Array.from({ length: lv }, (_, i) => `${out.prestige}:${i + 1}`)
  }
  if (s && !s.challengesClaimed) out.challengesClaimed = [...out.challengesDone]
  setOddsFormat(out.settings.oddsFormat)
  return out
}

function set(next: Partial<State>) {
  state = { ...state, ...next }
  // Any challenge this change completed is marked done; its XP and skin wait to be claimed.
  // Challenges only read bets and rounds, so slip taps, swipes and settings skip the scan.
  const fresh = !('bets' in next || 'rounds' in next || 'prestige' in next) ? [] : newlyCompleted(challengeHistory(state), state.challengesDone, state.prestige)
  if (fresh.length) {
    const at = Date.now()
    state = {
      ...state,
      challengesDone: [...state.challengesDone, ...fresh.map(c => c.id)],
      challengeLog: [...fresh.map(c => ({ id: c.id, at })), ...state.challengeLog].slice(0, 50),
    }
  }
  write(keyFor(accounts.current), state)
  listeners.forEach(l => l())
}

/** Adds XP to a pending patch. Level rewards are not paid here; they wait on the track to be claimed. */
function withXp(patch: Partial<State>, gained: number): Partial<State> {
  if (gained <= 0) return patch
  const before = levelOf(state.xp).level
  const xp = state.xp + gained
  const after = levelOf(xp).level
  if (after === before) return { ...patch, xp }
  const got: Reward[] = []
  for (let lv = before + 1; lv <= after; lv++) got.push(...rewardsAt(lv, state.prestige))
  return { ...patch, xp, levelUp: { level: after, at: Date.now(), rewards: got } }
}

// ---- claiming ----
const levelKey = (level: number) => `${state.prestige}:${level}`
/** Levels reached in this prestige whose rewards haven't been collected. */
export const unclaimedLevels = (s: State = state) => {
  const lv = levelOf(s.xp).level
  return Array.from({ length: lv - 1 }, (_, i) => i + 2).filter(l => !s.claimedLevels.includes(`${s.prestige}:${l}`))
}
export const unclaimedChallenges = (s: State = state) => s.challengesDone.filter(id => !s.challengesClaimed.includes(id))

export function claimLevel(level: number) {
  if (level > levelOf(state.xp).level || state.claimedLevels.includes(levelKey(level))) return
  const granted = grant(rewardsAt(level, state.prestige), state.balance, { ...state.inv }, [...state.unlocked], [...state.txns])
  set({ ...granted, claimedLevels: [...state.claimedLevels, levelKey(level)] })
}
export function claimAllLevels() {
  const levels = unclaimedLevels()
  if (!levels.length) return
  const granted = grant(levels.flatMap(l => rewardsAt(l, state.prestige)), state.balance, { ...state.inv }, [...state.unlocked], [...state.txns])
  set({ ...granted, claimedLevels: [...state.claimedLevels, ...levels.map(levelKey)] })
}
/** Every challenge also pays an odds boost token: 50% for the big ones (600+ XP), 25% otherwise. */
export const challengeBoost = (c: { xp: number }): BoostKey => (c.xp >= 600 ? 'boost50' : 'boost25')
/** Collect a finished challenge: its XP (which may level you up), its skin and its boost token. */
export function claimChallenge(id: string) {
  const c = CHALLENGES.find(x => x.id === id)
  if (!c || !state.challengesDone.includes(id) || state.challengesClaimed.includes(id)) return
  const unlocked = c.skin && !state.unlocked.includes(`skin:${c.skin}`) ? [...state.unlocked, `skin:${c.skin}`] : state.unlocked
  const token = challengeBoost(c)
  set(withXp({ challengesClaimed: [...state.challengesClaimed, id], unlocked, inv: { ...state.inv, [token]: state.inv[token] + 1 } }, c.xp))
}
export function claimAllChallenges() {
  for (const id of unclaimedChallenges()) claimChallenge(id)
}

/** Apply a list of rewards to wallet, inventory and unlocks. */
function grant(rewards: Reward[], balance: number, inv: Inventory, unlocked: string[], txns: Txn[]) {
  for (const r of rewards) {
    if (r.kind === 'cash') { balance += r.amount; txns.unshift({ id: uid(), type: 'level', amount: r.amount, at: Date.now() }) }
    if (r.kind === 'spins') inv.spins += r.n
    if (r.kind === 'boost') inv[`boost${r.pct}` as BoostKey]++
    if (r.kind === 'insurance') inv.insurance += r.n
    if (r.kind === 'avatar' && !unlocked.includes(r.emoji)) unlocked.push(r.emoji)
    if (r.kind === 'frame' && !unlocked.includes(`frame:${r.name}:${r.color}`)) unlocked.push(`frame:${r.name}:${r.color}`)
  }
  return { balance: +balance.toFixed(2), inv, unlocked, txns }
}

/** Bets and rounds that count toward challenges: only what happened since the current prestige began. */
export const challengeHistory = (s: { bets: Bet[]; rounds: CasinoRound[]; prestigeStartedAt?: number }) => {
  const since = s.prestigeStartedAt ?? 0
  return { bets: s.bets.filter(b => b.placedAt >= since), rounds: s.rounds.filter(r => r.at >= since) }
}

/**
 * Optional. At max level, start the next prestige: level resets to 1 and every cosmetic (skins, card backs,
 * avatars, frames) and all challenge progress is wiped, to be earned again through challenges in the new
 * prestige. Money and reward tokens are kept. The prestige's own avatar comes with the entry pack.
 */
export function enterPrestige(): string | undefined {
  if (levelOf(state.xp).level < MAX_LEVEL) return `Reach level ${MAX_LEVEL} first`
  if (state.prestige >= MAX_PRESTIGE) return 'You are at the highest prestige'
  claimAllLevels() // don't leave this prestige's track rewards behind
  const p = state.prestige + 1
  const rewards = prestigeRewards(p)
  const granted = grant(rewards, state.balance, { ...state.inv }, [], [...state.txns])
  // An avatar that came from an unlock goes back to the default.
  const me = accounts.list.find(a => a.id === accounts.current)
  if (me && !BASE_AVATARS.includes(me.avatar)) {
    accounts = { ...accounts, list: accounts.list.map(a => (a.id === me.id ? { ...a, avatar: BASE_AVATARS[0] } : a)) }
    write(ACCOUNTS_KEY, accounts)
  }
  set({
    ...granted, prestige: p, xp: 0, prestigeStartedAt: Date.now(), prestigeUp: { prestige: p, at: Date.now(), rewards },
    challengesDone: [], challengesClaimed: [], tableSkin: 'classic', cardBack: 'red', frame: undefined,
  })
}
/** Avatars every account has without unlocking anything. Profile's picker shows these plus unlocks. */
export const BASE_AVATARS = ['⚡', '🦈', '🐐', '🔥', '🎯', '👑', '🃏', '🏈', '🏀', '🎰', '🦅', '💎']
export const setFrame = (frame?: string) => set({ frame })
export const setSkin = (patch: Partial<Pick<State, 'tableSkin' | 'cardBack'>>) => set(patch)

/** Spend one free slot spin. Returns false if none are left. */
export function useFreeSpin(): boolean {
  if (state.inv.spins < 1) return false
  set({ inv: { ...state.inv, spins: state.inv.spins - 1 } })
  return true
}

const subscribe = (cb: () => void) => (listeners.add(cb), () => listeners.delete(cb))
export const useStore = () => useSyncExternalStore(subscribe, () => state)
export const useAccounts = () => useSyncExternalStore(subscribe, () => accounts)
export const getAccounts = () => accounts
export const myName = () => accounts.list.find(a => a.id === accounts.current)?.name ?? 'A friend'

export const getState = () => state

// ---- accounts ----
function setAccounts(next: Accounts) {
  accounts = next
  write(ACCOUNTS_KEY, accounts)
  state = load(accounts.current)
  listeners.forEach(l => l())
}

/** Creating your first account keeps whatever you did as a guest; later accounts start fresh at $500. */
export function createAccount(name: string, avatar: string, color: string, referral = ''): string | undefined {
  const clean = name.trim()
  if (clean.length < 3) return 'Username needs at least 3 characters'
  if (!/^[\w .-]+$/.test(clean)) return 'Use letters, numbers, spaces, . - or _'
  if (accounts.list.some(a => a.name.toLowerCase() === clean.toLowerCase())) return 'That username is taken on this device'
  const referrer = referral.trim() ? findByCode(referral) : undefined
  if (referral.trim() && !referrer) return 'That referral code was not found'
  const acct: Account = { id: uid(), name: clean, avatar, color, createdAt: Date.now() }
  if (!accounts.current && accounts.list.length === 0) write(keyFor(acct.id), state)
  setAccounts({ current: acct.id, list: [...accounts.list, acct] })
  if (referrer) applyReferral(referrer)
}

// ---- referrals + friends ----
// Accounts live on this device, so codes and friends connect accounts here; cross-device needs a server.
export const REFERRAL = { referrerCash: 250, referrerXp: 500, newCash: 100 }
export const REFERRAL_MILESTONES = [
  { count: 3, label: '100% Parlay Boost' },
  { count: 5, label: 'Recruiter frame + $1,000' },
]
/** Stable, readable code: name letters + a slice of the id, e.g. NICK-4F2A. */
export const codeOf = (a: Account) => `${a.name.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6) || 'ANY'}-${a.id.replace(/-/g, '').slice(0, 4).toUpperCase()}`
const findByCode = (code: string) => accounts.list.find(a => codeOf(a) === code.trim().toUpperCase())
export const referralsOf = (id: string) => accounts.list.filter(a => a.referredBy === id)

/** Change another account's saved wallet (it isn't loaded right now). */
function creditOther(id: string, apply: (s: State) => State) {
  const s = read<State>(keyFor(id))
  if (s) write(keyFor(id), apply({ ...s, txns: s.txns ?? [], inv: { ...NO_INV, ...s.inv }, unlocked: s.unlocked ?? [] }))
}

/** The signed-in account joins with `referrer`'s code: both get rewards and become friends. */
function applyReferral(referrer: Account) {
  const me = accounts.list.find(a => a.id === accounts.current)!
  accounts = {
    ...accounts,
    list: accounts.list.map(a =>
      a.id === me.id ? { ...a, referredBy: referrer.id, friends: [...new Set([...(a.friends ?? []), referrer.id])] }
        : a.id === referrer.id ? { ...a, friends: [...new Set([...(a.friends ?? []), me.id])] } : a),
  }
  write(ACCOUNTS_KEY, accounts)
  const count = referralsOf(referrer.id).length
  creditOther(referrer.id, r => {
    const inv = { ...r.inv }
    const unlocked = [...r.unlocked]
    let balance = r.balance + REFERRAL.referrerCash
    if (count === 3) inv.boost100++
    if (count === 5) { balance += 1000; if (!unlocked.includes('frame:Recruiter:#22d3ee')) unlocked.push('frame:Recruiter:#22d3ee') }
    return {
      ...r, balance: +balance.toFixed(2), inv, unlocked, xp: (r.xp ?? 0) + REFERRAL.referrerXp,
      txns: [{ id: uid(), type: 'referral', amount: REFERRAL.referrerCash + (count === 5 ? 1000 : 0), at: Date.now() }, ...r.txns],
    }
  })
  set({
    balance: +(state.balance + REFERRAL.newCash).toFixed(2), inv: { ...state.inv, boost50: state.inv.boost50 + 1 },
    txns: [{ id: uid(), type: 'referral', amount: REFERRAL.newCash, at: Date.now() }, ...state.txns],
  })
}

/** Enter a friend's code after signing up (once, within 7 days of creating the account). */
export function redeemReferral(code: string): string | undefined {
  const me = accounts.list.find(a => a.id === accounts.current)
  if (!me) return 'Create an account first'
  if (me.referredBy) return 'You already used a referral code'
  if (Date.now() - me.createdAt > 7 * 86_400_000) return 'Codes can only be used in your first 7 days'
  const ref = findByCode(code)
  if (!ref) return 'That code was not found'
  if (ref.id === me.id) return "You can't use your own code"
  applyReferral(ref)
}

export function addFriend(code: string): string | undefined {
  const me = accounts.list.find(a => a.id === accounts.current)
  if (!me) return 'Create an account first'
  const them = findByCode(code)
  if (!them) return 'No account with that code'
  if (them.id === me.id) return "That's your own code"
  if (me.friends?.includes(them.id)) return `${them.name} is already your friend`
  setAccounts({
    ...accounts,
    list: accounts.list.map(a => a.id === me.id ? { ...a, friends: [...(a.friends ?? []), them.id] }
      : a.id === them.id ? { ...a, friends: [...(a.friends ?? []), me.id] } : a),
  })
}
export function removeFriend(id: string) {
  setAccounts({
    ...accounts,
    list: accounts.list.map(a => a.id === accounts.current ? { ...a, friends: (a.friends ?? []).filter(x => x !== id) }
      : a.id === id ? { ...a, friends: (a.friends ?? []).filter(x => x !== accounts.current) } : a),
  })
}
/** A friend's public stats, read from their saved account on this device. */
export function friendStats(id: string) {
  const s = read<State>(keyFor(id))
  const bets = (s?.bets ?? []).filter(b => b.status !== 'pending')
  const rounds = s?.rounds ?? []
  const { net } = netBetween(id, 0, Infinity)
  const wins = bets.filter(b => b.status === 'won').length + rounds.filter(r => r.returned > r.wager).length
  const losses = bets.filter(b => b.status === 'lost').length + rounds.filter(r => r.returned < r.wager).length
  return { xp: s?.xp ?? 0, prestige: s?.prestige ?? 0, net, wins, losses, balance: s?.balance ?? 0 }
}
/** Net profit (and how many bets/rounds) for any account on this device in [from, to). */
export function netBetween(id: string, from: number, to: number) {
  const s = id === accounts.current ? state : read<State>(keyFor(id))
  const bets = (s?.bets ?? []).filter(b => b.status !== 'pending' && b.placedAt >= from && b.placedAt < to)
  const rounds = (s?.rounds ?? []).filter(r => r.at >= from && r.at < to)
  return { net: bets.reduce((t, b) => t + b.payout - b.stake, 0) + rounds.reduce((t, r) => t + r.returned - r.wager, 0), played: bets.length + rounds.length }
}

/** Collect a weekly leaderboard prize (place 0 = 1st). */
export function claimSeason(week: string, place: number) {
  const prize = PRIZES[place]
  if (!prize || state.seasonsClaimed?.includes(week)) return
  const unlocked = state.unlocked.includes(`skin:${prize.skin}`) ? state.unlocked : [...state.unlocked, `skin:${prize.skin}`]
  set({ balance: +(state.balance + prize.cash).toFixed(2), unlocked, seasonsClaimed: [...(state.seasonsClaimed ?? []), week], txns: [txn('bonus', prize.cash), ...state.txns] })
}

export const switchAccount = (id?: string) => setAccounts(stampLogin({ ...accounts, current: id }))
/** Permanently erase the signed-in account: its saved wallet, bets and history, and its spot in friends' lists. */
export function deleteAccount() {
  const id = accounts.current
  if (!id) return
  try { localStorage.removeItem(keyFor(id)) } catch {}
  setAccounts({ current: undefined, list: accounts.list.filter(a => a.id !== id).map(a => ({ ...a, friends: a.friends?.filter(x => x !== id) })) })
}
export const updateAccount = (patch: Partial<Pick<Account, 'avatar' | 'color' | 'name'>>) =>
  setAccounts({ ...accounts, list: accounts.list.map(a => (a.id === accounts.current ? { ...a, ...patch } : a)) })

// ---- casino log + daily bonus ----
export function logRound(game: CasinoGame, wager: number, returned: number, note?: string) {
  if (!wager) return
  const r: CasinoRound = { id: uid(), game, wager, returned: +returned.toFixed(2), at: Date.now(), note }
  const patch = { rounds: [r, ...state.rounds].slice(0, 500) }
  set(withXp(patch, returned > wager ? xpForCasinoWin(returned - wager) : 0))
}
const txn = (type: Txn['type'], amount: number): Txn => ({ id: uid(), type, amount: +amount.toFixed(2), at: Date.now() })

/** Daily login spin: a free wheel spin every 24 hours, so the play-money bankroll never runs dry. */
/** Daily spin: every slice pays at least $100 (per nick: $100 once a day, guaranteed); bigger cash or a bonus token on top is the gamble. */
export const SPIN_PRIZES: { label: string; short?: string; cash?: number; spins?: number; boost?: BoostKey; w: number }[] = [
  { label: '$100', cash: 100, w: 30 }, { label: '$100 + 5 Free Spins', short: '$100+Spins', cash: 100, spins: 5, w: 14 }, { label: '$150', cash: 150, w: 20 },
  { label: '$250', cash: 250, w: 8 }, { label: '$100', cash: 100, w: 14 }, { label: '$100 + 25% Boost', short: '$100+Boost', cash: 100, boost: 'boost25', w: 10 },
  { label: '$200', cash: 200, w: 3 }, { label: '$500', cash: 500, w: 1 },
]
export const spinReady = () => !state.lastBonus || Date.now() - state.lastBonus >= BONUS_EVERY_MS
/** Spins the wheel and pays the prize. Returns the winning slice, or undefined if it isn't ready. */
export function spinDaily(rand = Math.random): number | undefined {
  if (!spinReady()) return undefined
  let r = rand() * SPIN_PRIZES.reduce((t, p) => t + p.w, 0)
  const i = SPIN_PRIZES.findIndex(p => (r -= p.w) < 0)
  const p = SPIN_PRIZES[i]
  const inv = { ...state.inv }
  if (p.spins) inv.spins += p.spins
  if (p.boost) inv[p.boost]++
  set({ balance: +(state.balance + (p.cash ?? 0)).toFixed(2), inv, lastBonus: Date.now(), txns: p.cash ? [txn('bonus', p.cash), ...state.txns] : state.txns })
  return i
}

export function updateSettings(patch: Partial<Settings>) {
  const settings = { ...state.settings, ...patch }
  setOddsFormat(settings.oddsFormat)
  set({ settings })
}
export const markNotesSeen = () => set({ seenNotesAt: Date.now() })
export const isCoolingOff = () => !!state.settings.coolOffUntil && state.settings.coolOffUntil > Date.now()

/** Daily play limit. Lowering it applies now; raising or removing it waits 24 hours (standard sportsbook rule). */
export function setDailyLimit(value: number) {
  const cur = state.settings.dailyLimit || Infinity
  if ((value || Infinity) <= cur) updateSettings({ dailyLimit: value, limitRaise: undefined })
  else updateSettings({ limitRaise: { value, at: Date.now() + BONUS_EVERY_MS } })
}
export const spentToday = () => (state.spent?.day === today() ? state.spent.amt : 0)
/** Error text if `amount` would break the daily limit. Also applies a pending raise once its 24h are up. */
function overLimit(amount: number): string | undefined {
  const r = state.settings.limitRaise
  if (r && r.at <= Date.now()) updateSettings({ dailyLimit: r.value, limitRaise: undefined })
  const lim = state.settings.dailyLimit
  if (lim && spentToday() + amount > lim + 1e-9) return `Daily play limit reached: $${Math.max(0, lim - spentToday()).toFixed(2)} of $${lim} left today. Change it in My Budget and Controls.`
}
const spend = (amount: number) => ({ spent: { day: today(), amt: +(spentToday() + amount).toFixed(2) } })

// ---- wallet ----
/** Returns false (and does nothing) if the balance can't cover a debit. */
export function adjustBalance(delta: number): boolean {
  if (state.balance + delta < 0) return false
  const limit = delta < 0 && overLimit(-delta)
  if (limit) { if (typeof alert === 'function') alert(limit); return false } // ponytail: plain alert; casino tables have no shared toast
  set({ balance: +(state.balance + delta).toFixed(2), ...(delta < 0 ? spend(-delta) : {}) })
  return true
}

// ---- slip ----
/** Same id toggles off; another side of the same market replaces it. */
export const MAX_LEGS = 15

const marketOf = (l: Leg) => {
  const s = l.sport!
  return `${s.eventId}:${l.id.includes(':live:') ? 'live:' : ''}${s.market}:${s.prop ? s.prop.athleteId + ':' + s.prop.stat : ''}`
}
export function toggleLeg(leg: Leg) {
  if (state.squadPicking !== undefined && state.squad) { const i = state.squadPicking; set({ squadPicking: undefined }); return setSquadPick(i, leg) }
  if (state.slip.some(l => l.id === leg.id)) return set({ slip: state.slip.filter(l => l.id !== leg.id) })
  // One pick per market: the other side of the same line (or a different line) replaces it. Different markets
  // and different players' props from one game can stack into a same-game parlay.
  const slip = leg.sport ? state.slip.filter(l => !l.sport || marketOf(l) !== marketOf(leg)) : state.slip
  if (slip.length >= MAX_LEGS) return
  set({ slip: [...slip, leg] })
}
export const removeLeg = (id: string) => set({ slip: state.slip.filter(l => l.id !== id) })
export const clearSlip = () => set({ slip: [] })
/** Put a past ticket's legs back in the slip (fresh, unplayed) so it can be bet again at any stake. */
export const loadSlip = (legs: Leg[]) => set({ slip: legs.slice(0, MAX_LEGS).map(({ result, moved, ...l }) => l) })
/** A lost ticket made only of casino legs can be re-bet: those markets never close. */
export const canRebet = (b: Bet) => b.status === 'lost' && b.legs.every(l => l.casino)

/** Push fresh odds into slip legs, marking which moved. Legs for games that are on the board but no longer priced (kicked off) are dropped. */
export function refreshSlipOdds(current: Map<string, number>, boardIds: Set<string>, startedIds = new Set<string>()) {
  let changed = false
  const slip = state.slip.flatMap(l => {
    // Player props aren't on the board feed: they stay until their game kicks off.
    if (l.sport?.prop) { if (startedIds.has(l.sport.eventId)) { changed = true; return [] } return l }
    const now = current.get(l.id)
    if (now === undefined && l.sport && boardIds.has(l.sport.eventId)) { changed = true; return [] }
    if (now === undefined || now === l.odds) return l
    changed = true
    return { ...l, odds: now, moved: (now > l.odds ? 'up' : 'down') as Leg['moved'] }
  })
  if (changed) set({ slip })
}

/** Straight bet on one sports leg without touching the slip (Swipe Bet's straight mode). */
export function placeSingle(leg: Leg, stake: number): string | undefined {
  if (isCoolingOff()) return 'You are on a break. Betting is paused.'
  if (leg.casino) return 'Casino legs only count inside a parlay.'
  if (!(stake > 0)) return 'Set a wager in Swipe options'
  if (stake > state.balance) return 'Not enough balance'
  const limit = overLimit(stake); if (limit) return limit
  const { moved, ...l } = leg
  const bet: Bet = { id: uid(), legs: [{ ...l, result: 'pending' }], stake, placedAt: Date.now(), status: 'pending', payout: 0 }
  set({ balance: +(state.balance - stake).toFixed(2), bets: [bet, ...state.bets], ...spend(stake) })
}

/** Swipe learns your taste: a right swipe nudges its tags up, a pass nudges them down a little. */
export function noteTaste(keys: string[], delta: number) {
  const taste = { ...state.taste }
  for (const k of keys) taste[k] = Math.max(-10, Math.min(30, (taste[k] ?? 0) + delta))
  set({ taste })
}

/** The Daily Boost: a set parlay with a profit boost, once per day. */
export const DAILY_BOOST = 0.3
export const today = () => new Date().toLocaleDateString('en-CA')
export function placeDailyBoost(legs: Leg[], stake: number): string | undefined {
  if (isCoolingOff()) return 'You are on a break. Betting is paused.'
  if (state.boostDay === today()) return 'Already bet today. A new boost drops tomorrow.'
  if (!(stake > 0)) return 'Pick a wager'
  if (stake > state.balance) return 'Not enough balance'
  const limit = overLimit(stake); if (limit) return limit
  const bet: Bet = { id: uid(), legs: legs.map(({ moved, ...l }) => ({ ...l, result: 'pending' })), stake, placedAt: Date.now(), status: 'pending', payout: 0, boost: DAILY_BOOST, daily: true }
  set({ balance: +(state.balance - stake).toFixed(2), bets: [bet, ...state.bets], boostDay: today(), ...spend(stake) })
}

/** Take back a bet that hasn't started settling: refund the stake. */
export function cancelBet(id: string): boolean {
  const b = state.bets.find(x => x.id === id)
  if (!b || b.status !== 'pending' || b.legs.some(l => l.result !== 'pending')) return false
  set({
    bets: state.bets.filter(x => x.id !== id),
    balance: +(state.balance + b.stake).toFixed(2),
  })
  return true
}

/** Parlay: one ticket with every slip leg. Singles: one ticket per leg at `stake` each. Tokens apply to parlays only. */
export function placeBet(stake: number, mode: 'parlay' | 'singles' = 'parlay', opts: { boost?: BoostKey; insure?: boolean; flex?: boolean; chaos?: Leg } = {}): string | undefined {
  if (isCoolingOff()) return 'You are on a break. Betting is paused.'
  if (!state.slip.length) return 'Add a pick first'
  if (opts.chaos && (opts.flex || mode === 'singles' && state.slip.length > 1)) return 'The chaos leg rides on one parlay ticket'
  // Chaos leg: a mystery casino leg joins the ticket once it's locked (the caller rolls it), for a profit boost.
  const slip = opts.chaos ? [...state.slip, { ...opts.chaos, chaos: true }] : state.slip
  if (opts.chaos) mode = 'parlay'
  if (!(stake > 0)) return 'Enter a stake'
  // A casino leg is a free round, so it can only ride inside a parlay; on its own it would just be a free bet.
  if (slip.some(l => l.casino) && (mode === 'singles' || slip.length < 2)) return 'Casino legs only count inside a parlay. Add another leg.'
  const groups = mode === 'parlay' ? [slip] : slip.map(l => [l])
  const cost = stake * groups.length
  if (cost > state.balance) return 'Not enough balance'
  const limit = overLimit(cost); if (limit) return limit
  const parlay = mode === 'parlay' && slip.length > 1
  const flex = parlay && opts.flex
  if (flex && (slip.length < FLEX_MIN || parlayDecimal(slip).sgpGames)) return `Flex needs ${FLEX_MIN}+ legs from different games`
  if (flex && (opts.boost || opts.insure)) return "Boosts and insurance don't stack with Flex"
  const boost = groups.length === 1 && opts.boost && state.inv[opts.boost] > 0 ? opts.boost : undefined // parlays and single straight bets
  const insure = parlay && opts.insure && slip.length >= 4 && state.inv.insurance > 0
  const tickets: Bet[] = groups.map(legs => {
    const { dec } = parlayDecimal(legs)
    const straight = legs.reduce((m, l) => m * toDecimal(l.odds), 1)
    return {
    id: uid(),
    legs: legs.map(({ moved, ...l }) => ({ ...l, result: 'pending' })),
    stake, placedAt: Date.now(), status: 'pending', payout: 0,
    ...(boost ? { boost: BOOST_PCT[boost] / 100 } : {}), ...(insure ? { insured: true } : {}),
    ...(dec < straight - 1e-9 ? { sgpMult: dec / straight } : {}),
    ...(flex ? { flex: true } : {}),
    ...(opts.chaos ? { boost: (boost ? BOOST_PCT[boost] / 100 : 0) + CHAOS_BOOST } : {}),
  }})
  const inv = { ...state.inv }
  if (boost) inv[boost]--
  if (insure) inv.insurance--
  set({ balance: +(state.balance - cost).toFixed(2), slip: [], bets: [...tickets, ...state.bets], inv, ...spend(cost) })
}

/** Sell an open ticket for `amount` (computed from live chances by the caller). */
export function cashOut(betId: string, amount: number) {
  const b = state.bets.find(x => x.id === betId)
  if (!b || b.status !== 'pending' || !(amount > 0)) return
  const status: Result = amount > b.stake ? 'won' : amount < b.stake ? 'lost' : 'push'
  set({ balance: +(state.balance + amount).toFixed(2), bets: state.bets.map(x => (x.id === betId ? { ...x, status, payout: amount, cashedOut: true } : x)) })
}

// ---- settlement ----
/** Grade pending legs with `grade` (return undefined to leave pending), then pay out finished tickets. */
export function gradeLegs(grade: (leg: Leg, bet: Bet) => Result | undefined) {
  let credit = 0, squadCredit = 0
  let touched = false
  let xp = 0
  const bets = state.bets.map(b => {
    if (b.status !== 'pending') return b
    const legs = b.legs.map(l => {
      if (l.result !== 'pending') return l
      const r = grade(l, b)
      if (!r) return l
      touched = true
      if (r === 'won' && l.casino && b.legs.length > 1 && !l.by) xp += XP_PER_LEG_HIT // a squadmate's hit isn't your XP
      return { ...l, result: r }
    })
    const results = legs.map(l => l.result!)
    const base = (b.flex ? settleFlex : settle)(results, b.stake, legs.map(l => l.odds))
    if (base.status === 'won' && b.sgpMult) base.payout = Math.max(b.stake, +(base.payout * b.sgpMult).toFixed(2))
    const { status, payout, refunded } = applyTokens(results, base, b.stake, b.boost, b.insured)
    let ticketXp = 0
    if (status === 'won') {
      ticketXp = xpForTicket(legs.length, payout - b.stake, legs.some(l => l.sport) && legs.some(l => l.casino))
      xp += ticketXp
    }
    if (b.squad && state.squad) squadCredit += payout; else credit += payout // left the squad: the payout comes to you
    return { ...b, legs, status, payout, ...(refunded ? { refunded } : {}), ...(ticketXp ? { xp: ticketXp } : {}) }
  })
  const squad = state.squad && squadCredit ? { ...state.squad, bank: +(state.squad.bank + squadCredit).toFixed(2) } : state.squad
  if (touched) set(withXp({ bets, balance: +(state.balance + credit).toFixed(2), squad }, xp))
}

/** A casino leg is settled by its own free round, played from My Bets. */
export function resolveLeg(betId: string, legId: string, round: Round) {
  gradeLegs((l, b) => (b.id === betId && l.id === legId && l.casino ? gradeCasino(l.casino.pick, round) : undefined))
  set({ bets: state.bets.map(b => (b.id === betId ? { ...b, legs: b.legs.map(l => (l.id === legId ? { ...l, note: roundText(round) } : l)) } : b)) })
}

/** Won–lost record of settled tickets for any account on this device (Creator slips show it). */
export function recordOf(id: string) {
  const s = id === accounts.current ? state : read<State>(keyFor(id))
  const b = (s?.bets ?? []).filter(x => x.status !== 'pending' && !x.cashedOut)
  return { w: b.filter(x => x.status === 'won').length, l: b.filter(x => x.status === 'lost').length }
}

// ---- squads ----
export function createSquad(name: string, members: SquadMember[]): string | undefined {
  if (name.trim().length < 2) return 'Name your squad'
  if (members.length < 2) return 'Add at least one squadmate'
  set({ squad: { name: name.trim().slice(0, 24), members, bank: 0, week: weekId(), picks: members.map(() => null) } })
}
/** Clear the picks for a fresh squad parlay: every Monday, or any time once the last one has settled. */
export function squadNewWeek(force = false) {
  const q = state.squad
  const last = q?.betId && state.bets.find(b => b.id === q.betId)
  if (q && (q.week !== weekId() || (force && (!last || last.status !== 'pending')))) set({ squad: { ...q, week: weekId(), picks: q.members.map(() => null), betId: undefined } })
}
export function fundSquad(amount: number): string | undefined {
  const q = state.squad
  if (!q || !(amount > 0)) return 'Pick an amount'
  if (!adjustBalance(-amount)) return 'Not enough balance'
  set({ squad: { ...q, bank: +(q.bank + amount).toFixed(2) } })
}
export function withdrawSquad(amount: number) {
  const q = state.squad
  if (!q || !(amount > 0) || amount > q.bank) return
  set({ squad: { ...q, bank: +(q.bank - amount).toFixed(2) }, balance: +(state.balance + amount).toFixed(2) })
}
export const pickForSquad = (i?: number) => set({ squadPicking: i })
export function setSquadPick(i: number, leg: Leg | null) {
  const q = state.squad
  if (!q || q.betId) return
  set({ squad: { ...q, picks: q.picks.map((p, j) => (j === i ? leg && (({ moved, result, ...l }) => l)(leg) : p)) } })
}
/** Lock the weekly parlay: staked from the bank, and its payout goes back into the bank. */
export function placeSquad(stake: number): string | undefined {
  const q = state.squad
  if (!q) return
  if (isCoolingOff()) return 'You are on a break. Betting is paused.'
  if (q.betId) return 'The squad parlay is already in'
  const legs = q.picks.filter(Boolean) as Leg[]
  if (legs.length < q.members.length) return 'Every member needs a leg first'
  if (new Set(legs.map(l => l.id)).size < legs.length) return 'Two members picked the same leg'
  if (!(stake > 0) || stake > q.bank) return 'The squad bank can’t cover that'
  const { dec } = parlayDecimal(legs)
  const straight = legs.reduce((m, l) => m * toDecimal(l.odds), 1)
  // Each leg remembers who added it (you're member 0). Only they play it; bots deal theirs right away.
  const tagged = q.picks.map((l, i) => ({ ...l!, result: 'pending' as Result, ...(i ? { by: q.members[i].name } : {}) }))
  const bet: Bet = { id: uid(), legs: tagged, stake, placedAt: Date.now(), status: 'pending', payout: 0, squad: true, ...(dec < straight - 1e-9 ? { sgpMult: dec / straight } : {}) }
  set({ bets: [bet, ...state.bets], squad: { ...q, bank: +(q.bank - stake).toFixed(2), betId: bet.id } })
  q.picks.forEach((l, i) => { if (q.members[i].bot && l?.casino) resolveLeg(bet.id, l.id, simRound(l.casino.game, l.casino.pick)) })
}
/** Leave the squad: whatever is in the bank comes back to you. */
export function leaveSquad() {
  const q = state.squad
  if (q) set({ squad: undefined, squadPicking: undefined, balance: +(state.balance + q.bank).toFixed(2) })
}
