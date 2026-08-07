-- Training module, phase 3b: mesocycles/sessions/session_exercises/sets.
-- See docs/superpowers/specs/2026-08-06-training-module-design.md §2.
--
-- Exercises are referenced by NAME (matching health/data/exercises.json),
-- not by id — that catalogue is a JSON file, not a table, so there is no FK
-- here to point at.
--
-- Hypertrophy vs fat-loss get no schema difference: same tables, just a
-- different `goal` value and different seeded rep/RIR targets. Anyone
-- proposing separate tables for the two is modelling the label, not the data.

create table if not exists public.mesocycles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null,
  goal       text not null check (goal in ('hypertrophy', 'fatloss')),
  weeks      int not null,
  start_date date not null,
  status     text not null default 'active',
  notes      text,
  created_at timestamptz not null default now()
);

create table if not exists public.sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mesocycle_id  uuid references public.mesocycles(id) on delete cascade,
  week_no       int,
  day_no        int,
  name          text,
  date          date not null,
  status        text not null default 'planned',
  created_at    timestamptz not null default now()
);

create table if not exists public.session_exercises (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.sessions(id) on delete cascade,
  exercise_name   text not null,
  position        int not null,
  target_sets     int,
  target_rep_low  int,
  target_rep_high int,
  target_rir      numeric,
  skipped_reason  text
);

create table if not exists public.sets (
  id                  uuid primary key default gen_random_uuid(),
  session_exercise_id uuid not null references public.session_exercises(id) on delete cascade,
  set_no              int not null,
  weight_kg           numeric,
  reps                int,
  rir                 numeric,
  completed_at        timestamptz not null default now(),
  source              text not null default 'manual',
  source_key          text
);

create index if not exists mesocycles_user_id_idx on public.mesocycles (user_id);
create index if not exists sessions_user_id_idx on public.sessions (user_id);
create index if not exists sessions_mesocycle_id_idx on public.sessions (mesocycle_id);
create index if not exists session_exercises_session_id_idx on public.session_exercises (session_id);
create index if not exists sets_session_exercise_id_idx on public.sets (session_exercise_id);

-- Unlike `sleep`'s full unique index, this is PARTIAL (source_key not null):
-- many manual sets per exercise are the normal case, not a duplicate. It
-- exists so a later watch importer can UPSERT on (source, source_key)
-- without a second migration, the same source/source_key/synced_at-from-day-one
-- pattern as `sleep`.
create unique index if not exists sets_source_key_uk
  on public.sets (source, source_key) where source_key is not null;

alter table public.mesocycles enable row level security;
alter table public.sessions enable row level security;
alter table public.session_exercises enable row level security;
alter table public.sets enable row level security;

drop policy if exists "own_select" on public.mesocycles;
drop policy if exists "own_insert" on public.mesocycles;
drop policy if exists "own_update" on public.mesocycles;
drop policy if exists "own_delete" on public.mesocycles;
create policy "own_select" on public.mesocycles for select using (auth.uid() = user_id);
create policy "own_insert" on public.mesocycles for insert with check (auth.uid() = user_id);
create policy "own_update" on public.mesocycles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.mesocycles for delete using (auth.uid() = user_id);

drop policy if exists "own_select" on public.sessions;
drop policy if exists "own_insert" on public.sessions;
drop policy if exists "own_update" on public.sessions;
drop policy if exists "own_delete" on public.sessions;
create policy "own_select" on public.sessions for select using (auth.uid() = user_id);
create policy "own_insert" on public.sessions for insert with check (auth.uid() = user_id);
create policy "own_update" on public.sessions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.sessions for delete using (auth.uid() = user_id);

-- session_exercises/sets have no user_id column of their own (they hang off
-- sessions/session_exercises respectively) — ownership is checked by walking
-- the FK chain back to a session owned by the caller.
drop policy if exists "own_select" on public.session_exercises;
drop policy if exists "own_insert" on public.session_exercises;
drop policy if exists "own_update" on public.session_exercises;
drop policy if exists "own_delete" on public.session_exercises;
create policy "own_select" on public.session_exercises for select using (
  exists (select 1 from public.sessions s where s.id = session_id and s.user_id = auth.uid())
);
create policy "own_insert" on public.session_exercises for insert with check (
  exists (select 1 from public.sessions s where s.id = session_id and s.user_id = auth.uid())
);
create policy "own_update" on public.session_exercises for update using (
  exists (select 1 from public.sessions s where s.id = session_id and s.user_id = auth.uid())
) with check (
  exists (select 1 from public.sessions s where s.id = session_id and s.user_id = auth.uid())
);
create policy "own_delete" on public.session_exercises for delete using (
  exists (select 1 from public.sessions s where s.id = session_id and s.user_id = auth.uid())
);

drop policy if exists "own_select" on public.sets;
drop policy if exists "own_insert" on public.sets;
drop policy if exists "own_update" on public.sets;
drop policy if exists "own_delete" on public.sets;
create policy "own_select" on public.sets for select using (
  exists (
    select 1 from public.session_exercises se
    join public.sessions s on s.id = se.session_id
    where se.id = session_exercise_id and s.user_id = auth.uid()
  )
);
create policy "own_insert" on public.sets for insert with check (
  exists (
    select 1 from public.session_exercises se
    join public.sessions s on s.id = se.session_id
    where se.id = session_exercise_id and s.user_id = auth.uid()
  )
);
create policy "own_update" on public.sets for update using (
  exists (
    select 1 from public.session_exercises se
    join public.sessions s on s.id = se.session_id
    where se.id = session_exercise_id and s.user_id = auth.uid()
  )
) with check (
  exists (
    select 1 from public.session_exercises se
    join public.sessions s on s.id = se.session_id
    where se.id = session_exercise_id and s.user_id = auth.uid()
  )
);
create policy "own_delete" on public.sets for delete using (
  exists (
    select 1 from public.session_exercises se
    join public.sessions s on s.id = se.session_id
    where se.id = session_exercise_id and s.user_id = auth.uid()
  )
);

-- A table missing from migration 20260805130000's array silently escapes the
-- 2FA gate every other table has. Same restrictive policy, same
-- bootstrap-safe shape as that migration, one per table.
drop policy if exists "aal2_when_mfa_enrolled" on public.mesocycles;
create policy "aal2_when_mfa_enrolled" on public.mesocycles
  as restrictive for all to authenticated
  using (not public.requires_aal2() or (select auth.jwt()->>'aal') = 'aal2')
  with check (not public.requires_aal2() or (select auth.jwt()->>'aal') = 'aal2');

drop policy if exists "aal2_when_mfa_enrolled" on public.sessions;
create policy "aal2_when_mfa_enrolled" on public.sessions
  as restrictive for all to authenticated
  using (not public.requires_aal2() or (select auth.jwt()->>'aal') = 'aal2')
  with check (not public.requires_aal2() or (select auth.jwt()->>'aal') = 'aal2');

drop policy if exists "aal2_when_mfa_enrolled" on public.session_exercises;
create policy "aal2_when_mfa_enrolled" on public.session_exercises
  as restrictive for all to authenticated
  using (not public.requires_aal2() or (select auth.jwt()->>'aal') = 'aal2')
  with check (not public.requires_aal2() or (select auth.jwt()->>'aal') = 'aal2');

drop policy if exists "aal2_when_mfa_enrolled" on public.sets;
create policy "aal2_when_mfa_enrolled" on public.sets
  as restrictive for all to authenticated
  using (not public.requires_aal2() or (select auth.jwt()->>'aal') = 'aal2')
  with check (not public.requires_aal2() or (select auth.jwt()->>'aal') = 'aal2');
