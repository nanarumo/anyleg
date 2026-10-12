// The Anyleg server (Supabase). It owns balances, bets and casino outcomes; the app asks and shows what it says.
// The URL and publishable key are public by design: the database only lets a player read their own rows.
import { createClient } from '@supabase/supabase-js'

const URL = 'https://mnlloyzjocjsqmowepdo.supabase.co'
const KEY = 'sb_publishable_-VQQcZiD7gSacK1bnDNf0A_0HLqQ7DK'

/** Server mode is on for everyone. localStorage anyleg-server = '0' runs the old on-device wallet (testing only: it can be edited). */
export const SERVER = (() => { try { return localStorage.getItem('anyleg-server') !== '0' } catch { return true } })()

export const sb = createClient(URL, KEY)

let ready: Promise<boolean> | undefined
/** Signs this device in (an anonymous server account, kept in localStorage). False when the server can't be reached. */
export const signedIn = (name?: string) => (ready ??= (async () => {
  if ((await sb.auth.getSession()).data.session) return true
  const { error } = await sb.auth.signInAnonymously({ options: { data: { name } } })
  if (error) { ready = undefined; return false }
  return true
})())

/** Call the house function. Throws an Error with the server's message ("Not enough balance"). */
export async function house<T>(body: Record<string, unknown>): Promise<T & { balance: number }> {
  if (!(await signedIn())) throw new Error("Can't reach the server. Check your connection.")
  const { data, error } = await sb.functions.invoke('house', { body })
  if (error) {
    let msg = "Can't reach the server. Try again."
    try { msg = (await (error as { context: Response }).context.json()).error ?? msg } catch {}
    throw new Error(msg)
  }
  return { ...data, balance: Number(data.balance) }
}

export type ServerBet = { id: string; legs: any[]; stake: number; status: string; payout: number; opts: Record<string, unknown>; placed_at: string }

/** The player's balance and recent tickets, straight from the database. */
export async function pull(): Promise<{ balance: number; bets: ServerBet[] } | undefined> {
  if (!(await signedIn())) return
  const [p, b] = await Promise.all([
    sb.from('profiles').select('balance').single(),
    sb.from('bets').select('*').order('placed_at', { ascending: false }).limit(200),
  ])
  if (p.error || b.error) return
  return { balance: Number(p.data.balance), bets: b.data as ServerBet[] }
}
