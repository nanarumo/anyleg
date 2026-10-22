// The Anyleg server (Supabase). It owns balances, bets and casino outcomes; the app asks and shows what it says.
// The URL and publishable key are public by design: the database only lets a player read their own rows.
import { createClient } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import { SocialLogin } from '@capgo/capacitor-social-login'

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

/**
 * Email a 6-digit code. An anonymous account keeps everything by adding the email to itself ('link');
 * an email that already has an account signs into that account instead ('signin').
 */
export async function sendEmailCode(email: string): Promise<'link' | 'signin'> {
  await signedIn()
  const { data } = await sb.auth.getUser()
  if (data.user?.is_anonymous) {
    const { error } = await sb.auth.updateUser({ email })
    if (!error) return 'link'
    if (!/already|registered|exists/i.test(error.message)) throw error
  }
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })
  if (error) throw error
  return 'signin'
}

/** Check the emailed code; the session is then the email account. */
export async function verifyEmailCode(email: string, token: string, mode: 'link' | 'signin') {
  const { error } = await sb.auth.verifyOtp({ email, token, type: mode === 'link' ? 'email_change' : 'email' })
  if (error) throw error
}

/** Text a 6-digit code to add this phone to the account (it becomes a sign-in too). A number can belong to one account only. */
export async function sendPhoneCode(phone: string) {
  await signedIn()
  const { error } = await sb.auth.updateUser({ phone })
  if (error) throw new Error(/already|registered|exists/i.test(error.message) ? 'That number is already on another Anyleg account' : error.message)
}
export async function verifyPhoneCode(phone: string, token: string) {
  const { error } = await sb.auth.verifyOtp({ phone, token, type: 'phone_change' })
  if (error) throw error
}

// Apple and Google sign-in. These client IDs are public (not secrets); a blank one keeps that button hidden.
const GOOGLE_IOS_CLIENT = '' // Google Cloud > Credentials > OAuth client (iOS, bundle com.anyleg.app)
const GOOGLE_WEB_CLIENT = '' // Google Cloud > Credentials > OAuth client (Web), also pasted into Supabase's Google provider
const APPLE_SERVICES_ID = '' // Apple Developer > Identifiers > Services ID, for the web build (the iPhone app needs none)
const APPLE_ON = false // true once Supabase's Apple provider lists com.anyleg.app (and the Services ID) as client IDs
const NATIVE = Capacitor.isNativePlatform()
export const PROVIDERS = [
  ...(APPLE_ON && (NATIVE || APPLE_SERVICES_ID) ? ['apple' as const] : []),
  ...((NATIVE ? GOOGLE_IOS_CLIENT : GOOGLE_WEB_CLIENT) ? ['google' as const] : []),
]

const sha256 = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('')
let socialReady: Promise<void> | undefined

/** Apple or Google: an anonymous account keeps everything by adding the identity; one already used elsewhere signs into that account. */
export async function socialSignIn(provider: 'apple' | 'google') {
  await (socialReady ??= SocialLogin.initialize({
    apple: { clientId: APPLE_SERVICES_ID, redirectUrl: NATIVE ? '' : location.origin },
    google: { iOSClientId: GOOGLE_IOS_CLIENT, iOSServerClientId: GOOGLE_WEB_CLIENT, webClientId: GOOGLE_WEB_CLIENT },
  }))
  // Apple signs a hash of the nonce and Supabase checks it. Google's iPhone SDK can't take one ("Skip nonce checks" in Supabase).
  const nonce = crypto.randomUUID()
  const res = provider === 'apple'
    ? await SocialLogin.login({ provider, options: { scopes: ['email'], nonce: await sha256(nonce) } })
    : await SocialLogin.login({ provider, options: {} })
  const token = (res.result as { idToken?: string | null }).idToken
  if (!token) throw new Error('Sign-in was cancelled')
  const creds = { provider, token, ...(provider === 'apple' ? { nonce } : {}) }
  await signedIn()
  if ((await sb.auth.getUser()).data.user?.is_anonymous) {
    const { error } = await sb.auth.linkIdentity(creds)
    if (!error) return
    if (!/already|exists|linked/i.test(error.message)) throw error
  }
  const { error } = await sb.auth.signInWithIdToken(creds)
  if (error) throw error
}

/** Erase this device's server account and everything tied to it, then sign out (the next launch starts a fresh account). */
export async function deleteServerAccount() {
  await house({ action: 'delete' })
  await sb.auth.signOut({ scope: 'local' })
  ready = undefined
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
