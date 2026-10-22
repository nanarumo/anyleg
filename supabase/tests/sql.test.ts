// node supabase/tests/sql.test.ts — runs the real migrations in an in-memory Postgres (PGlite) with Supabase's
// default grants, then attacks them: players writing their own money, double spends, replays and reused phones.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
// What Supabase gives every project: the API roles with full default grants (so the migrations' revokes are what
// protect the money), auth.users, auth.uid() and pgcrypto's digest. Cron (0005) needs pg_cron and Vault, so it's skipped.
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  create schema auth; create schema extensions;
  grant usage on schema auth, extensions to anon, authenticated;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, phone text, email_confirmed_at timestamptz,
    phone_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function extensions.digest(t text, alg text) returns bytea language sql immutable as $$ select sha256(convert_to(t, 'UTF8')) $$;
`)
for (const f of ['0001_wallet', '0002_settle', '0003_hands', '0004_player', '0006_founders', '0007_exploits'])
  await db.exec(readFileSync(new URL(`../migrations/${f}.sql`, import.meta.url), 'utf8'))

const one = async (sql: string, params: unknown[] = []) => (await db.query<any>(sql, params)).rows[0]
const fails = async (sql: string, params: unknown[], re: RegExp) => { await assert.rejects(db.query(sql, params), re) }
const signUp = async (meta = {}) => (await one('insert into auth.users (raw_user_meta_data) values ($1) returning id', [meta])).id as string
const balance = async (id: string) => Number((await one('select balance from profiles where id = $1', [id])).balance)
/** Run as a signed-in player through the API roles, the way PostgREST does. */
async function asPlayer<T>(id: string, fn: () => Promise<T>) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${id}', false)`)
  try { return await fn() } finally { await db.exec('reset role') }
}

// Sign-up: $500, and a blank name no longer breaks it.
const a = await signUp({ name: '  ' }), b = await signUp()
assert.equal(await balance(a), 500)
assert.equal((await one('select name from profiles where id = $1', [a])).name, 'Player')

// RLS: a player sees only their own rows and can change nothing but their name.
await asPlayer(a, async () => {
  assert.equal((await db.query('select id from profiles')).rows.length, 1)
  await db.query("update profiles set name = 'Ace' where id = $1", [a])
  for (const sql of [
    `update profiles set balance = 1e9 where id = '${a}'`, `update profiles set inv = '{}' where id = '${a}'`,
    `update profiles set founder_at = now(), ref_paid = true where id = '${a}'`, `update profiles set squad_bank = 1e6 where id = '${a}'`,
    `insert into ledger (user_id, delta, kind, balance_after) values ('${a}', 1e6, 'x', 1e6)`,
    `insert into bets (user_id, legs, stake) values ('${a}', '[]', 1)`, `delete from bets`,
    `select * from hands`, `insert into founder_phones (hash) values ('x')`,
    `select wallet_apply('${a}', 1e6, 'gift')`, `select cash_out('${a}', gen_random_uuid(), '[]', 1e6)`,
    `select record_round('${a}', 'slots', 0, 1e6, '{}')`, `select squad_apply('${a}', 1e6, 'x')`,
    `select place_tickets('${a}', '[]')`, `select cancel_bet('${a}', gen_random_uuid())`,
  ]) await assert.rejects(db.query(sql), /permission denied|row-level security/, sql)
  assert.equal((await db.query(`select id from profiles where id = '${b}'`)).rows.length, 0)
  assert.equal((await db.query('select * from founder_phones')).rows.length, 0) // RLS, no policies: invisible
})
assert.equal((await one('select name from profiles where id = $1', [a])).name, 'Ace')

// Money can't go below zero, and a stake comes out of the wallet once.
await fails('select wallet_apply($1, -501, $2)', [a, 'x'], /insufficient_balance/)
const ticket = (opts = {}, legs: unknown[] = [{ id: 'nfl:1:ml:home', result: 'pending' }]) => JSON.stringify([{ legs, stake: 10, opts }])
const placed = async (opts = {}, legs?: unknown[]) => (await one('select place_tickets($1, $2) as id', [a, ticket(opts, legs)])).id as string
const bet = await placed()
assert.equal(await balance(a), 490)

// Grading: a stale copy of the ticket is refused, so a payout can't be replayed.
const old = JSON.stringify([{ id: 'nfl:1:ml:home', result: 'pending' }]), won = JSON.stringify([{ id: 'nfl:1:ml:home', result: 'won' }])
await db.query('select update_bet($1, $2, $3, $4, $5, $6)', [a, bet, old, won, 'won', 20])
await fails('select update_bet($1, $2, $3, $4, $5, $6)', [a, bet, old, won, 'won', 20], /bet_changed/)
assert.equal(await balance(a), 510)
await fails('select cash_out($1, $2, $3, $4)', [a, bet, won, 5], /bet_changed/) // settled tickets can't be sold

// Cash out sells once.
const bet2 = await placed()
await db.query('select cash_out($1, $2, $3, $4)', [a, bet2, old, 8])
await fails('select cash_out($1, $2, $3, $4)', [a, bet2, old, 8], /bet_changed/)
assert.equal(await balance(a), 508)

// A casino leg is dealt once: the second round for the same leg is refused.
const casino = [{ id: 'casino:roulette:red', result: 'pending' }, { id: 'nfl:1:ml:home', result: 'pending' }]
const bet3 = await placed({}, casino)
const after = JSON.stringify([{ ...casino[0], result: 'won' }, casino[1]])
await db.query('select settle_leg($1, $2, $3, $4, $5, $6, $7, $8, $9)', [a, bet3, 'casino:roulette:red', 'roulette', '{}', JSON.stringify(casino), after, 'pending', 0])
await fails('select settle_leg($1, $2, $3, $4, $5, $6, $7, $8, $9)', [a, bet3, 'casino:roulette:red', 'roulette', '{}', after, after, 'pending', 0], /duplicate key/)

// Undo: fine for a fresh pregame ticket, refused once a leg is graded, on live legs and on chaos tickets.
let bal = await balance(a)
await db.query('select cancel_bet($1, $2)', [a, await placed()])
assert.equal(await balance(a), bal)
await fails('select cancel_bet($1, $2)', [a, bet3], /not_cancellable/)
await fails('select cancel_bet($1, $2)', [a, await placed({}, [{ id: 'nba:9:live:ml:home', result: 'pending' }])], /not_cancellable/)
await fails('select cancel_bet($1, $2)', [a, await placed({ chaos: true }, casino)], /not_cancellable/)

// One chaos ticket and one Daily Boost a day.
await fails('select place_tickets($1, $2)', [a, ticket({ chaos: true }, casino)], /chaos_used/)
await placed({ daily: true })
await fails('select place_tickets($1, $2)', [a, ticket({ daily: true })], /daily_used/)
await placed({ chaos: true }, casino).then(() => assert.fail('second chaos ticket'), () => {})

// Hands: each tap names the version it saw, so two taps can't both cash the same board.
const hand = (await one(`select open_hand($1, 'mines', 10, '{}') as id`, [a])).id
await db.query(`select close_hand($1, $2, 0, '{}', 20, '{}')`, [a, hand])
await fails(`select close_hand($1, $2, 0, '{}', 20, '{}')`, [a, hand], /hand_changed/)

// Founders: one reward per phone number, ever: not for a second account, and not after deleting the first.
const verify = (id: string, phone: string) => db.query('update auth.users set phone = $2, phone_confirmed_at = now() where id = $1', [id, phone])
const founder = async (id: string) => (await one('select founder_at from profiles where id = $1', [id])).founder_at !== null
await verify(a, '15550001111')
assert.equal(await founder(a), true)
await verify(b, '15550001111')
assert.equal(await founder(b), false)
await db.query('delete from auth.users where id = $1', [a])
const c = await signUp()
await verify(c, '15550001111')
assert.equal(await founder(c), false)

console.log('sql ok')
