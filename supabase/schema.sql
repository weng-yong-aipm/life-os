-- Run this once in your NEW life-os Supabase project:
--   Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Creates every Finance-module table with Row Level Security so each
-- account can only see and edit its own rows, plus a private Storage
-- bucket for receipt photos.

create table if not exists public.receipts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  image_path    text,
  merchant      text,
  purchased_at  date,
  raw_json      jsonb,
  created_at    timestamptz not null default now()
);

create table if not exists public.receipt_items (
  id              uuid primary key default gen_random_uuid(),
  receipt_id      uuid not null references public.receipts(id) on delete cascade,
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name            text not null,
  price           numeric,
  category        text,
  calories        numeric,
  protein_g       numeric,
  carbs_g         numeric,
  fat_g           numeric,
  edited_by_user  boolean not null default false
);

create or replace function public.check_receipt_item_ownership()
returns trigger as $$
begin
  if not exists (
    select 1 from public.receipts
    where id = new.receipt_id and user_id = new.user_id
  ) then
    raise exception 'receipt_id % does not belong to user_id %', new.receipt_id, new.user_id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists check_receipt_item_ownership_trigger on public.receipt_items;
create trigger check_receipt_item_ownership_trigger
  before insert or update on public.receipt_items
  for each row execute function public.check_receipt_item_ownership();

create table if not exists public.pay_settings (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  base_hourly_rate    numeric not null default 0,
  weekend_multiplier  numeric not null default 1.5,
  holiday_multiplier  numeric not null default 2.0,
  currency            text not null default 'MYR'
);

create table if not exists public.work_hours (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  work_date      date not null,
  hours          numeric not null,
  day_type       text not null,
  computed_pay   numeric not null,
  created_at     timestamptz not null default now()
);

create index if not exists receipts_user_id_idx on public.receipts (user_id);
create index if not exists receipt_items_receipt_id_idx on public.receipt_items (receipt_id);
create index if not exists receipt_items_user_id_idx on public.receipt_items (user_id);
create index if not exists work_hours_user_id_idx on public.work_hours (user_id);

alter table public.receipts enable row level security;
alter table public.receipt_items enable row level security;
alter table public.pay_settings enable row level security;
alter table public.work_hours enable row level security;

drop policy if exists "own_select" on public.receipts;
drop policy if exists "own_insert" on public.receipts;
drop policy if exists "own_update" on public.receipts;
drop policy if exists "own_delete" on public.receipts;
create policy "own_select" on public.receipts for select using (auth.uid() = user_id);
create policy "own_insert" on public.receipts for insert with check (auth.uid() = user_id);
create policy "own_update" on public.receipts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.receipts for delete using (auth.uid() = user_id);

drop policy if exists "own_select" on public.receipt_items;
drop policy if exists "own_insert" on public.receipt_items;
drop policy if exists "own_update" on public.receipt_items;
drop policy if exists "own_delete" on public.receipt_items;
create policy "own_select" on public.receipt_items for select using (auth.uid() = user_id);
create policy "own_insert" on public.receipt_items for insert with check (auth.uid() = user_id);
create policy "own_update" on public.receipt_items for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.receipt_items for delete using (auth.uid() = user_id);

drop policy if exists "own_select" on public.pay_settings;
drop policy if exists "own_insert" on public.pay_settings;
drop policy if exists "own_update" on public.pay_settings;
create policy "own_select" on public.pay_settings for select using (auth.uid() = user_id);
create policy "own_insert" on public.pay_settings for insert with check (auth.uid() = user_id);
create policy "own_update" on public.pay_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own_select" on public.work_hours;
drop policy if exists "own_insert" on public.work_hours;
drop policy if exists "own_update" on public.work_hours;
drop policy if exists "own_delete" on public.work_hours;
create policy "own_select" on public.work_hours for select using (auth.uid() = user_id);
create policy "own_insert" on public.work_hours for insert with check (auth.uid() = user_id);
create policy "own_update" on public.work_hours for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.work_hours for delete using (auth.uid() = user_id);

-- Private bucket for receipt photos. Objects are stored as "<user_id>/<file>",
-- and the policies below only allow a user to touch objects under their own folder.
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

drop policy if exists "own_receipt_photos_select" on storage.objects;
drop policy if exists "own_receipt_photos_insert" on storage.objects;
drop policy if exists "own_receipt_photos_update" on storage.objects;
drop policy if exists "own_receipt_photos_delete" on storage.objects;
create policy "own_receipt_photos_select" on storage.objects
  for select using (bucket_id = 'receipts' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "own_receipt_photos_insert" on storage.objects
  for insert with check (bucket_id = 'receipts' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "own_receipt_photos_update" on storage.objects
  for update using (bucket_id = 'receipts' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "own_receipt_photos_delete" on storage.objects
  for delete using (bucket_id = 'receipts' and auth.uid()::text = (storage.foldername(name))[1]);

-- ============ Trackers: expenses / meals / workouts ============

create table if not exists public.expenses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  spent_at    date not null,
  amount      numeric not null,
  category    text not null default 'other',
  note        text,
  created_at  timestamptz not null default now()
);

create table if not exists public.meals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  eaten_at    date not null,
  name        text not null,
  source      text not null default 'manual',
  image_path  text,
  calories    numeric, protein_g numeric, carbs_g numeric, fat_g numeric,
  created_at  timestamptz not null default now()
);

create table if not exists public.workouts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  done_at         date not null,
  exercise        text not null,
  category        text,
  sets            int, reps int, weight_kg numeric,
  duration_min    numeric,
  calories_burned numeric,
  created_at      timestamptz not null default now()
);

create index if not exists expenses_user_id_idx on public.expenses (user_id);
create index if not exists expenses_spent_at_idx on public.expenses (spent_at);
create index if not exists meals_user_id_idx on public.meals (user_id);
create index if not exists meals_eaten_at_idx on public.meals (eaten_at);
create index if not exists workouts_user_id_idx on public.workouts (user_id);
create index if not exists workouts_done_at_idx on public.workouts (done_at);

alter table public.expenses enable row level security;
alter table public.meals enable row level security;
alter table public.workouts enable row level security;

drop policy if exists "own_select" on public.expenses;
drop policy if exists "own_insert" on public.expenses;
drop policy if exists "own_update" on public.expenses;
drop policy if exists "own_delete" on public.expenses;
create policy "own_select" on public.expenses for select using (auth.uid() = user_id);
create policy "own_insert" on public.expenses for insert with check (auth.uid() = user_id);
create policy "own_update" on public.expenses for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.expenses for delete using (auth.uid() = user_id);

drop policy if exists "own_select" on public.meals;
drop policy if exists "own_insert" on public.meals;
drop policy if exists "own_update" on public.meals;
drop policy if exists "own_delete" on public.meals;
create policy "own_select" on public.meals for select using (auth.uid() = user_id);
create policy "own_insert" on public.meals for insert with check (auth.uid() = user_id);
create policy "own_update" on public.meals for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.meals for delete using (auth.uid() = user_id);

drop policy if exists "own_select" on public.workouts;
drop policy if exists "own_insert" on public.workouts;
drop policy if exists "own_update" on public.workouts;
drop policy if exists "own_delete" on public.workouts;
create policy "own_select" on public.workouts for select using (auth.uid() = user_id);
create policy "own_insert" on public.workouts for insert with check (auth.uid() = user_id);
create policy "own_update" on public.workouts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.workouts for delete using (auth.uid() = user_id);

insert into storage.buckets (id, name, public) values ('meals', 'meals', false)
on conflict (id) do nothing;

drop policy if exists "own_meal_photos_select" on storage.objects;
drop policy if exists "own_meal_photos_insert" on storage.objects;
drop policy if exists "own_meal_photos_update" on storage.objects;
drop policy if exists "own_meal_photos_delete" on storage.objects;
create policy "own_meal_photos_select" on storage.objects
  for select using (bucket_id = 'meals' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "own_meal_photos_insert" on storage.objects
  for insert with check (bucket_id = 'meals' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "own_meal_photos_update" on storage.objects
  for update using (bucket_id = 'meals' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "own_meal_photos_delete" on storage.objects
  for delete using (bucket_id = 'meals' and auth.uid()::text = (storage.foldername(name))[1]);

-- ============ Learning Log (learning-os slice 1) ============

create table if not exists public.learning_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  learned_on    date not null,
  source        text not null default 'douyin',   -- douyin | instagram | other
  link          text,
  title         text not null,
  summary       text,                              -- what I learned
  project       text,                              -- which of my projects it maps to
  verdict       text not null default 'considering', -- applied | rejected | considering
  applied_note  text,                              -- what got applied, or why rejected
  tags          text[],
  created_at    timestamptz not null default now()
);

create index if not exists learning_user_id_idx on public.learning_sessions (user_id);
create index if not exists learning_learned_on_idx on public.learning_sessions (learned_on);

alter table public.learning_sessions enable row level security;

drop policy if exists "own_select" on public.learning_sessions;
drop policy if exists "own_insert" on public.learning_sessions;
drop policy if exists "own_update" on public.learning_sessions;
drop policy if exists "own_delete" on public.learning_sessions;
create policy "own_select" on public.learning_sessions for select using (auth.uid() = user_id);
create policy "own_insert" on public.learning_sessions for insert with check (auth.uid() = user_id);
create policy "own_update" on public.learning_sessions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.learning_sessions for delete using (auth.uid() = user_id);

-- ============ Goals & Certs (learning-os slice 2) ============

create table if not exists public.career_goals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title        text not null,
  category     text not null default 'skill',   -- role | income | cert | course | skill
  status       text not null default 'planned', -- planned | active | done
  progress     int  not null default 0,         -- 0..100
  target_date  date,
  note         text,
  created_at   timestamptz not null default now()
);

create index if not exists career_goals_user_id_idx on public.career_goals (user_id);

alter table public.career_goals enable row level security;

drop policy if exists "own_select" on public.career_goals;
drop policy if exists "own_insert" on public.career_goals;
drop policy if exists "own_update" on public.career_goals;
drop policy if exists "own_delete" on public.career_goals;
create policy "own_select" on public.career_goals for select using (auth.uid() = user_id);
create policy "own_insert" on public.career_goals for insert with check (auth.uid() = user_id);
create policy "own_update" on public.career_goals for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.career_goals for delete using (auth.uid() = user_id);

-- ── Added 2026-08-07: schema.sql is what README points a new deployer at,
-- so it must stay a complete picture, not just the tables that predate the
-- migrations folder. Mirrored verbatim from the migrations.

-- Sleep tracking, plus a duration field for learning sessions.
--
-- source/source_key/synced_at exist from day one so a later Health Connect
-- import has somewhere to land and can be made idempotent without a second
-- migration. See the unique index below for the dedup shape and why a
-- partial index (source_key not null) was rejected in favor of a full one.

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

-- Public bucket for CC-licensed exercise demo images (training module, phase
-- 3a). Unlike receipts/meals, this is not personal data — it's a mirror of
-- licence-clean wger.de images, filtered to CC0/CC-BY-4/CC-BY-SA-3 by
-- tools/mirror-exercise-images.mjs — so the bucket is public and there is no
-- per-user folder scoping. Only that script (service role, bypassing RLS)
-- writes to it; no insert/update/delete policy is granted to anon/authenticated
-- so the public grant below is read-only. No new public.* table is added here,
-- so no aal2 array entry is needed (same as the receipts/meals buckets, which
-- also aren't in that array — the aal2 gate covers public.* tables, not
-- storage buckets). Attribution metadata lives in health/data/exercise-media.json.
insert into storage.buckets (id, name, public) values ('exercise-media', 'exercise-media', true)
on conflict (id) do nothing;

drop policy if exists "public_exercise_media_select" on storage.objects;
create policy "public_exercise_media_select" on storage.objects
  for select using (bucket_id = 'exercise-media');

-- ── Added 2026-08-07: training module phase 3b (mesocycles/sessions/
-- session_exercises/sets). Mirrored verbatim from migration
-- 20260807100000_add_training.sql — see that file's comments for the design
-- rationale (exercises referenced by name not id, partial unique index on
-- sets, hypertrophy/fatloss needing no schema difference).

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

-- Partial (source_key not null), unlike sleep's full unique index: many
-- manual sets per exercise are the normal case, not a duplicate.
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

-- session_exercises/sets have no user_id column — ownership is checked by
-- walking the FK chain back to a session owned by the caller.
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
