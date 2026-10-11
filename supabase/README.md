# Anyleg server (Supabase)

The server owns the money. The app can read its own balance, bets and rounds, but every change goes
through the `house` edge function, which deals casino rounds with a crypto RNG and prices every leg itself.

- `migrations/0001_wallet.sql` – tables, read-only access for players, and the transactional money functions.
- `functions/house/index.ts` – the endpoint the app calls (`round`, `bet`, `leg`).
- `functions/_shared/house.ts` – game dealing, ticket pricing and grading, built on `src/logic.ts`. Tested by `npm test`.

## Setup (once the project exists)

1. Supabase dashboard › SQL Editor: run `migrations/0001_wallet.sql`.
2. Authentication › Providers: Email on (or Apple, for the App Store build).
3. Deploy the function: `npx supabase login`, then `npx supabase functions deploy house --project-ref <ref>`.
4. Put the Project URL and anon key in `.env` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (and in Netlify's environment variables).

## Still to move to the server

- Settle sports legs on a schedule from final scores (today the app grades them).
- Price props and live legs here (refused by the server for now).
- Blackjack, mines and video poker played hand by hand with the deck held on the server (their parlay legs are auto-dealt for now).
- Boost and insurance tokens, the daily spin, XP and rewards.
