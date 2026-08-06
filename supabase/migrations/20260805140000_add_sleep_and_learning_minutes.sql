-- Sleep tracking, plus a duration field for learning sessions.
--
-- source/source_key/synced_at exist from day one so a later Health Connect
-- import has somewhere to land and can be made idempotent without a second
-- migration. The partial unique index is what makes re-running an importer
-- safe: a manual row (source_key null) is never deduped against, so an import
-- can never overwrite something typed by hand.

create table if not exists public.sleep (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  slept_on     date not null,
  bed_at       timestamptz,
  wake_at      timestamptz,
  duration_min numeric,
  quality      smallint check (quality is null or (quality >= 1 and quality <= 5)),
  note         text,
  source       text not null default 'manual',
  source_key   text,
  synced_at    timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists sleep_user_id_idx on public.sleep (user_id);

-- ONE ROW PER NIGHT, enforced. slept_on is the WAKE date (a 23:00->07:00 night
-- belongs to the morning you woke up), matching how the watch attributes sleep.
--
-- This is deliberately NOT the `where source_key is not null` import-dedup shape
-- copied from migration 20260729064944: that shape leaves manual rows (source_key
-- NULL) unconstrained, so the same night could be logged twice by hand, and a
-- later Health Connect import would add a SECOND row for a night already entered
-- manually — silently skewing every average. The importer must UPSERT on this
-- constraint, updating times/duration while never clobbering a hand-typed
-- quality or note (the watch does not know why the night was bad).
create unique index if not exists sleep_night_uk on public.sleep (user_id, slept_on);

alter table public.sleep enable row level security;

create policy "own_select" on public.sleep for select using (auth.uid() = user_id);
create policy "own_insert" on public.sleep for insert with check (auth.uid() = user_id);
create policy "own_update" on public.sleep for update using (auth.uid() = user_id);
create policy "own_delete" on public.sleep for delete using (auth.uid() = user_id);

-- The 90-day plan budgets learning in hours; learning_sessions had no duration.
alter table public.learning_sessions
  add column if not exists minutes numeric;

-- A new table added without an entry here silently escapes the 2FA gate that
-- every other table has. Same restrictive policy, same bootstrap-safe shape as
-- migration 20260805130000.
drop policy if exists "aal2_when_mfa_enrolled" on public.sleep;
create policy "aal2_when_mfa_enrolled" on public.sleep
  as restrictive for all to authenticated
  using (not public.requires_aal2() or (select auth.jwt()->>'aal') = 'aal2')
  with check (not public.requires_aal2() or (select auth.jwt()->>'aal') = 'aal2');
