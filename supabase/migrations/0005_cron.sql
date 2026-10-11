-- Every 10 minutes the house function settles open sports legs for everyone, so tickets pay while players are away.
-- The job proves itself with a random secret that never leaves the database (Vault); the function asks cron_ok().
create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'house_cron');

create function public.cron_ok(p text) returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'house_cron' and decrypted_secret = p)
$$;
revoke execute on function public.cron_ok from public, anon, authenticated;

select cron.schedule('house-settle', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://mnlloyzjocjsqmowepdo.supabase.co/functions/v1/house',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'house_cron')),
    body := '{"action": "cron"}'::jsonb,
    timeout_milliseconds := 60000)
$$);
