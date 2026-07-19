# life-os trackers: Meal, Expenses, Workout — Design

**Date:** 2026-07-19
**Status:** Approved (design forks confirmed by user)
**Scope:** Add three personal trackers to the existing life-os PWA, reusing its
module pattern. Future trackers (sleep, calories-burned, music, screen-time,
study/work time, investing/portfolio) are **out of scope** here — they remain
stubbed hub cards for later specs.

## Goal

Let the user log and review, on their phone or laptop, three daily things:

1. **Expenses** — what they spent (fast manual entry, plus the existing receipt scan).
2. **Meals** — what they ate, with calories + macros (photo estimate *or* food search).
3. **Workouts** — what exercise they did, with sets/reps/weight or duration.

Everything stays offline-first, single-user, protected by Supabase Row Level
Security, and lives in `~/life-os` (personal repo, never pushed to any company remote).

## Design forks (decided)

- **Build all three now**, shipped together.
- **Meal logging = photo + search.** Snap a plate → Claude estimates
  calories/macros (reuse the `parse-receipt` edge-function pattern); *or* search
  a bundled food list → pick → quantity.
- **Data bundled offline now.** Ship curated JSON (common foods + exercises).
  Live USDA / Open Food Facts barcode search is a later enhancement, not built now.

## Architecture

Follows the established life-os module pattern exactly:

```
life-os/
  index.html            # hub — enable Health card, keep Finance
  health/    (NEW module dir)
    index.html           # tabs: Meal | Workout
    health.js            # UI wiring for both tabs
    meals-repo.js        # Supabase CRUD for meals
    workouts-repo.js     # Supabase CRUD for workouts
    nutrition.js         # pure logic: daily totals, target compare, portion math
    nutrition.test.js    # unit tests (pure logic only)
    calories-burned.js   # pure logic: MET-based burn estimate
    calories-burned.test.js
    data/
      foods.json         # ~300 curated common foods (name, kcal, P/C/F per 100g/serving)
      exercises.json     # seeded from yuhonas/free-exercise-db (subset, offline)
  finance/
    expenses-repo.js     # NEW: manual expense CRUD
    finance.js           # extend: add "Expenses" tab wiring + monthly summary
    index.html           # extend: add Expenses tab
  supabase/
    schema.sql           # extend: add meals, workouts, expenses tables + RLS
    functions/estimate-meal/index.ts  # NEW edge function (photo → macros via Claude)
```

**Decision — Expenses placement:** Expenses is a *Finance* concern and the
`receipts`/`receipt_items` tables already capture itemized spend. Rather than a
separate top-level module, add a lightweight **"Expenses" tab inside the Finance
module** for fast manual entries (amount, category, note, date) that complements
receipt scanning. Meal + Workout become the new **Health** module (Meal | Workout
tabs), matching the existing "Health (coming soon)" hub card.

Each unit has one purpose and a clear interface:
- `*-repo.js` — the only thing that talks to Supabase for its table; returns/accepts
  plain camelCase objects. Testable by stubbing `getClient()`.
- `nutrition.js` / `calories-burned.js` — pure functions, no I/O, fully unit-tested.
- `health.js` / `finance.js` — DOM wiring only; no business logic beyond glue.

## Data model (Supabase, additive to schema.sql)

All tables carry `user_id uuid default auth.uid()` + the standard four RLS
policies (own_select/insert/update/delete), matching existing tables.

```sql
-- Manual expenses (complements receipts)
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  spent_at date not null,
  amount numeric not null,
  category text not null default 'other',
  note text,
  created_at timestamptz not null default now()
);

-- Meals (one row per logged meal; macros denormalized for simple daily sums)
create table public.meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  eaten_at date not null,
  name text not null,
  source text not null default 'manual',   -- 'photo' | 'search' | 'manual'
  image_path text,                          -- set when logged via photo (reuse a bucket)
  calories numeric, protein_g numeric, carbs_g numeric, fat_g numeric,
  created_at timestamptz not null default now()
);

-- Workouts (one row per logged exercise set-group)
create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  done_at date not null,
  exercise text not null,          -- from exercises.json or free text
  category text,                   -- muscle group / type
  sets int, reps int, weight_kg numeric,
  duration_min numeric,
  calories_burned numeric,         -- estimated (MET-based) or user-entered
  created_at timestamptz not null default now()
);
```

Indexes on `user_id` and the date column for each; RLS enabled; policies mirror
the existing pattern in `schema.sql`.

## Seed data

- `health/data/foods.json` — ~300 common foods (whole foods + common Malaysian/
  Asian dishes since that's the user's context), each `{ name, serving, kcal,
  protein_g, carbs_g, fat_g }`. Derived from USDA public-domain values; hand-curated
  for relevance. Bundled = works offline, no API key.
- `health/data/exercises.json` — subset of `yuhonas/free-exercise-db`
  (public domain): `{ name, category, primaryMuscles, met }`. `met` added per
  exercise to drive the burn estimate. Image URLs optional (raw GitHub), degrade
  gracefully offline.

## Meal photo estimate (edge function)

New `supabase/functions/estimate-meal` mirrors `parse-receipt`:
- Input: `{ storagePath, mediaType }` (photo uploaded to a private bucket first).
- Calls Claude (vision) with a prompt: "Estimate the dish name and total
  calories, protein, carbs, fat for this meal. Return strict JSON."
- Output: `{ name, calories, protein_g, carbs_g, fat_g }` → shown in an editable
  preview (same review-before-save UX as receipts) so the user can correct before saving.
- Reuse the existing `receipts` storage bucket under a `meals/` prefix, or add a
  `meals` bucket with identical folder-scoped policies. **Decision:** add a `meals`
  bucket for clean separation (same policy shape as `receipts`).

## Core flows

**Expenses (Finance tab):** enter amount + category + note + date → save → row in
`expenses` → monthly total + by-category summary (combined view can later merge
receipt spend, but v1 shows manual expenses; receipts stay on the Spending tab).

**Meal — search:** type → filter `foods.json` → pick → set servings → computed
kcal/macros → save to `meals` (`source:'search'`).
**Meal — photo:** snap → upload → `estimate-meal` → editable preview → save
(`source:'photo'`, `image_path` set). Daily total kcal + macros vs an editable
target shown for today.

**Workout:** pick exercise from `exercises.json` (or free text) → enter
sets/reps/weight *or* duration → `calories-burned.js` estimates burn from MET ×
weight × duration (weight from a simple setting; default if unset) → save to
`workouts`. Summary: this-week volume + total burn.

## Error handling & offline

- Signed-out / no Supabase config → same graceful degradation as Finance: pure
  computations (search, portion math, burn estimate) work locally; save actions
  show "needs cloud sync" instead of failing silently (mirrors current receipts).
- Photo estimate failure → fall back to the manual/search editable form (exactly
  like `onScanReceipt`'s catch path).
- Food/exercise JSON are bundled, so search + logging never depend on network.

## Testing

- **Pure logic unit tests** (`npm test`, node --test), matching the repo's existing
  approach:
  - `nutrition.test.js` — daily totals, portion scaling, target comparison, empty/edge inputs.
  - `calories-burned.test.js` — MET formula, missing-weight default, zero-duration.
- **Repo files** and **UI flows** verified manually against the running app
  (`python3 -m http.server 8080`), per the repo's stated convention. A short manual
  checklist goes in the plan.

## Out of scope (future specs)

Sleep, calories-burned auto-import (wearables), music, screen-time, study/work-time,
investing/portfolio; live nutrition APIs + barcode scanning; charts/graphs beyond
simple lists; multi-user. These map onto the existing Career/Learning/Invest hub
stubs and get their own specs later.
