-- Persists what used to be hardcoded `value` attributes in health/index.html
-- (meal target, bodyweight) so a workout's calorie-burn estimate is no longer
-- silently computed at a fixed 70kg every time the page reloads. Same
-- single-row-per-user shape as pay_settings.

create table if not exists public.user_settings (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  daily_kcal_target      numeric not null default 2000,
  daily_protein_target_g numeric not null default 120,
  body_weight_kg         numeric not null default 70,
  sleep_target_min       numeric not null default 480,
  hidden_modules         text[] not null default '{}',
  updated_at             timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop policy if exists "own_select" on public.user_settings;
drop policy if exists "own_insert" on public.user_settings;
drop policy if exists "own_update" on public.user_settings;
drop policy if exists "own_delete" on public.user_settings;
create policy "own_select" on public.user_settings for select using (auth.uid() = user_id);
create policy "own_insert" on public.user_settings for insert with check (auth.uid() = user_id);
create policy "own_update" on public.user_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.user_settings for delete using (auth.uid() = user_id);

-- A new table added without an entry in migration 20260805130000's array
-- silently escapes the 2FA gate that every other table has. Same restrictive
-- policy, same bootstrap-safe shape as that migration.
drop policy if exists "aal2_when_mfa_enrolled" on public.user_settings;
create policy "aal2_when_mfa_enrolled" on public.user_settings
  as restrictive for all to authenticated
  using (not public.requires_aal2() or (select auth.jwt()->>'aal') = 'aal2')
  with check (not public.requires_aal2() or (select auth.jwt()->>'aal') = 'aal2');
