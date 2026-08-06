-- Enforce MFA at the database, not just the client. A prompt in app.js can
-- always be routed around (a direct API call, a stolen aal1 session token
-- from before 2FA was enrolled) — RLS is the layer that can't be bypassed.
--
-- Bootstrap-safe by design: aal2 is required ONLY for a user who has a
-- VERIFIED totp factor. A user with no factor enrolled (or one who never
-- finished enrollment — abandoned factors stay 'unverified') keeps normal
-- aal1 access, so nobody can be locked out of their own data before they've
-- had the chance to turn 2FA on in the first place.
--
-- security definer + explicit search_path: auth.mfa_factors is not exposed
-- to the `authenticated` role directly, so the check must run as the
-- function owner (postgres), and search_path is pinned so a caller can't
-- shadow `auth`/`public` with an object of their own to spoof the result.
create or replace function public.requires_aal2()
returns boolean
language sql
security definer
set search_path = auth, public
stable
as $$
  select exists (
    select 1 from auth.mfa_factors
    where user_id = auth.uid() and status = 'verified'
  );
$$;

revoke all on function public.requires_aal2() from public;
grant execute on function public.requires_aal2() to authenticated;

-- One RESTRICTIVE policy per table, `for all` (select/insert/update/delete
-- alike). Restrictive policies AND against the existing permissive
-- "own_select"/"own_insert"/... policies rather than replacing them, so the
-- net effect is: (this row is mine) AND (no factor enrolled OR aal2 reached).
-- Ownership is still enforced exactly as before; this only adds the 2FA gate
-- on top of it.
do $$
declare
  t text;
begin
  foreach t in array array[
    'receipts', 'receipt_items', 'pay_settings', 'work_hours',
    'expenses', 'meals', 'workouts',
    'learning_sessions', 'learning_materials', 'career_goals',
    'feed_items', 'improvements', 'capture_queue', 'sleep'
  ]
  loop
    -- 'sleep' is added here before the migration that creates it
    -- (20260805140000) — an in-order replay from the baseline schema would
    -- otherwise abort with "relation does not exist". Skip tables that don't
    -- exist yet; the table's own migration ships the same policy once it does.
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format(
      'drop policy if exists "aal2_when_mfa_enrolled" on public.%I', t
    );
    execute format(
      'create policy "aal2_when_mfa_enrolled" on public.%I ' ||
      'as restrictive for all to authenticated ' ||
      'using (not public.requires_aal2() or (select auth.jwt()->>''aal'') = ''aal2'') ' ||
      'with check (not public.requires_aal2() or (select auth.jwt()->>''aal'') = ''aal2'')',
      t
    );
  end loop;
end $$;
