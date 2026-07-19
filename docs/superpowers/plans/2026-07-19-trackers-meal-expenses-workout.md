# Meal / Expenses / Workout Trackers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three personal trackers — manual Expenses (in Finance), and Meal + Workout (new Health module) — to the life-os PWA, reusing its module pattern.

**Architecture:** Vanilla ES-module front-end, no build step. Each feature is a folder with an `index.html`, a UI-glue `.js`, one `*-repo.js` per Supabase table (all going through the shared `db.js` `getClient()`), and pure-logic files with node `--test` unit tests. Data (foods, exercises) is bundled JSON for offline use. Photo meal-estimate reuses the `parse-receipt` Supabase edge-function pattern.

**Tech Stack:** HTML/CSS/vanilla JS (ES modules via `esm.sh`), Supabase (Postgres + RLS + Storage + Edge Functions/Deno), node built-in test runner.

## Global Constraints

- No build step; browser-native ES modules only. Import Supabase via `https://esm.sh/@supabase/supabase-js@2` (already used in `db.js`).
- Every repo file imports `getClient`/`cloudEnabled` from `../db.js` — never creates its own client.
- All new tables: `user_id uuid not null default auth.uid() references auth.users(id) on delete cascade`, RLS enabled, four policies `own_select/own_insert/own_update/own_delete` matching `supabase/schema.sql` exactly.
- Repo files return/accept **camelCase** objects; DB columns are **snake_case**; the repo does the mapping (see `receipts-repo.js`).
- Graceful degradation: pure computation works signed-out; save actions show a "needs cloud sync" message instead of throwing silently (mirror `finance.js`).
- Unit tests cover **pure logic only** (`node --test`); repos + UI flows verified manually against `python3 -m http.server 8080`.
- Styling: reuse `../ui.css`. Do not add a CSS framework.
- Currency default `MYR`; user context is Malaysia/Asia (relevant to curated foods).
- This repo is personal — commit locally, never push to a company remote.

---

## File Structure

```
health/
  index.html            # tabs: Meal | Workout
  health.js             # DOM wiring for both tabs
  meals-repo.js         # meals table CRUD  (camelCase <-> snake_case)
  workouts-repo.js      # workouts table CRUD
  nutrition.js          # PURE: portionScale, dailyTotals, compareToTarget
  nutrition.test.js
  calories-burned.js    # PURE: estimateBurn (MET × weight × duration)
  calories-burned.test.js
  data/
    foods.json          # 30 curated foods {name,serving,kcal,protein_g,carbs_g,fat_g}
    exercises.json      # subset of free-exercise-db {name,category,primaryMuscles,met}
finance/
  expenses-repo.js      # NEW: expenses table CRUD + monthlySummary
  finance.js            # MODIFY: add Expenses tab wiring
  index.html            # MODIFY: add Expenses tab + panel
supabase/
  schema.sql            # MODIFY: append expenses, meals, workouts tables + meals bucket
  functions/estimate-meal/index.ts   # NEW: photo -> macros via Claude
index.html              # MODIFY: enable Health hub card
```

Task order: schema first (everything depends on it), then pure logic (no deps), then data, then repos, then UI, then edge function + hub wiring.

---

### Task 1: Extend schema with expenses, meals, workouts tables

**Files:**
- Modify: `supabase/schema.sql` (append at end)

**Interfaces:**
- Produces: tables `public.expenses`, `public.meals`, `public.workouts`; storage bucket `meals`. Columns as defined below — later repo tasks depend on these exact names.

- [ ] **Step 1: Append the three tables, indexes, RLS, policies, and meals bucket**

Append to `supabase/schema.sql`:

```sql
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

-- expenses policies
drop policy if exists "own_select" on public.expenses;
drop policy if exists "own_insert" on public.expenses;
drop policy if exists "own_update" on public.expenses;
drop policy if exists "own_delete" on public.expenses;
create policy "own_select" on public.expenses for select using (auth.uid() = user_id);
create policy "own_insert" on public.expenses for insert with check (auth.uid() = user_id);
create policy "own_update" on public.expenses for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.expenses for delete using (auth.uid() = user_id);

-- meals policies
drop policy if exists "own_select" on public.meals;
drop policy if exists "own_insert" on public.meals;
drop policy if exists "own_update" on public.meals;
drop policy if exists "own_delete" on public.meals;
create policy "own_select" on public.meals for select using (auth.uid() = user_id);
create policy "own_insert" on public.meals for insert with check (auth.uid() = user_id);
create policy "own_update" on public.meals for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.meals for delete using (auth.uid() = user_id);

-- workouts policies
drop policy if exists "own_select" on public.workouts;
drop policy if exists "own_insert" on public.workouts;
drop policy if exists "own_update" on public.workouts;
drop policy if exists "own_delete" on public.workouts;
create policy "own_select" on public.workouts for select using (auth.uid() = user_id);
create policy "own_insert" on public.workouts for insert with check (auth.uid() = user_id);
create policy "own_update" on public.workouts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.workouts for delete using (auth.uid() = user_id);

-- meals photo bucket (folder-scoped like receipts)
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
```

- [ ] **Step 2: Sanity-check SQL syntax locally (no DB needed)**

Run: `grep -c "create table if not exists" supabase/schema.sql`
Expected: `5` (2 original + 3 new). This is a static check; the SQL is applied manually in the Supabase SQL Editor by the user (README step 4), not by tests.

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "Add expenses/meals/workouts tables + meals bucket to schema"
```

---

### Task 2: Pure nutrition logic + tests

**Files:**
- Create: `health/nutrition.js`
- Test: `health/nutrition.test.js`

**Interfaces:**
- Produces:
  - `portionScale(food, servings)` → `{ calories, proteinG, carbsG, fatG }` (food is `{kcal, protein_g, carbs_g, fat_g}` per one serving; scales by `servings`).
  - `dailyTotals(meals)` → `{ calories, proteinG, carbsG, fatG }` summing an array of `{calories, proteinG, carbsG, fatG}` (nullish treated as 0).
  - `compareToTarget(totals, targetCalories)` → `{ consumed, target, remaining, pct }`.

- [ ] **Step 1: Write the failing tests**

Create `health/nutrition.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portionScale, dailyTotals, compareToTarget } from './nutrition.js';

test('portionScale scales all macros by servings', () => {
  const food = { kcal: 200, protein_g: 10, carbs_g: 20, fat_g: 5 };
  assert.deepEqual(portionScale(food, 1.5), { calories: 300, proteinG: 15, carbsG: 30, fatG: 7.5 });
});

test('portionScale treats missing macros as 0', () => {
  assert.deepEqual(portionScale({ kcal: 100 }, 2), { calories: 200, proteinG: 0, carbsG: 0, fatG: 0 });
});

test('dailyTotals sums entries and ignores nullish', () => {
  const meals = [
    { calories: 300, proteinG: 15, carbsG: 30, fatG: 7 },
    { calories: 200, proteinG: null, carbsG: 10, fatG: undefined },
  ];
  assert.deepEqual(dailyTotals(meals), { calories: 500, proteinG: 15, carbsG: 40, fatG: 7 });
});

test('dailyTotals of empty list is all zeros', () => {
  assert.deepEqual(dailyTotals([]), { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
});

test('compareToTarget computes remaining and pct', () => {
  const r = compareToTarget({ calories: 500 }, 2000);
  assert.equal(r.remaining, 1500);
  assert.equal(r.pct, 25);
});

test('compareToTarget with zero/absent target yields null pct, no divide-by-zero', () => {
  const r = compareToTarget({ calories: 500 }, 0);
  assert.equal(r.pct, null);
  assert.equal(r.remaining, -500);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test health/nutrition.test.js`
Expected: FAIL — cannot find module `./nutrition.js`.

- [ ] **Step 3: Write minimal implementation**

Create `health/nutrition.js`:

```javascript
/* Pure nutrition math — no I/O. */
const n = (v) => Number(v) || 0;

export function portionScale(food, servings) {
  const s = n(servings);
  return {
    calories: n(food.kcal) * s,
    proteinG: n(food.protein_g) * s,
    carbsG: n(food.carbs_g) * s,
    fatG: n(food.fat_g) * s,
  };
}

export function dailyTotals(meals) {
  return meals.reduce(
    (t, m) => ({
      calories: t.calories + n(m.calories),
      proteinG: t.proteinG + n(m.proteinG),
      carbsG: t.carbsG + n(m.carbsG),
      fatG: t.fatG + n(m.fatG),
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
}

export function compareToTarget(totals, targetCalories) {
  const consumed = n(totals.calories);
  const target = n(targetCalories);
  return {
    consumed,
    target,
    remaining: target - consumed,
    pct: target > 0 ? Math.round((consumed / target) * 100) : null,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test health/nutrition.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add health/nutrition.js health/nutrition.test.js
git commit -m "Add pure nutrition logic (portion scale, daily totals, target compare)"
```

---

### Task 3: Pure calories-burned logic + tests

**Files:**
- Create: `health/calories-burned.js`
- Test: `health/calories-burned.test.js`

**Interfaces:**
- Produces: `estimateBurn({ met, weightKg, durationMin })` → number (kcal), using `kcal = MET × weightKg × hours`. Defaults: `weightKg` falls back to `70` when nullish; returns `0` when `durationMin` or `met` is nullish/0.

- [ ] **Step 1: Write the failing tests**

Create `health/calories-burned.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateBurn } from './calories-burned.js';

test('estimateBurn = MET * weight * hours', () => {
  // 8 MET, 70kg, 30min (0.5h) => 280
  assert.equal(estimateBurn({ met: 8, weightKg: 70, durationMin: 30 }), 280);
});

test('estimateBurn defaults weight to 70kg when missing', () => {
  assert.equal(estimateBurn({ met: 6, durationMin: 60 }), 420);
});

test('estimateBurn returns 0 when duration missing', () => {
  assert.equal(estimateBurn({ met: 8, weightKg: 80 }), 0);
});

test('estimateBurn returns 0 when met missing', () => {
  assert.equal(estimateBurn({ weightKg: 80, durationMin: 30 }), 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test health/calories-burned.test.js`
Expected: FAIL — cannot find module `./calories-burned.js`.

- [ ] **Step 3: Write minimal implementation**

Create `health/calories-burned.js`:

```javascript
/* Pure MET-based calorie-burn estimate — no I/O.
 * kcal = MET × bodyweight(kg) × duration(hours) */
export function estimateBurn({ met, weightKg, durationMin } = {}) {
  const m = Number(met) || 0;
  const w = Number(weightKg) || 70;
  const mins = Number(durationMin) || 0;
  if (!m || !mins) return 0;
  return m * w * (mins / 60);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test health/calories-burned.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add health/calories-burned.js health/calories-burned.test.js
git commit -m "Add pure MET-based calories-burned estimate"
```

---

### Task 4: Bundle seed data (foods.json + exercises.json)

**Files:**
- Create: `health/data/exercises.json` (generated from free-exercise-db)
- Create: `health/data/foods.json` (hand-curated)

**Interfaces:**
- Produces:
  - `exercises.json`: array of `{ name, category, primaryMuscles: string[], met: number }`.
  - `foods.json`: array of `{ name, serving, kcal, protein_g, carbs_g, fat_g }`.
  These shapes are consumed by `health.js` (search) and the pure-logic functions.

- [ ] **Step 1: Generate exercises.json from the public-domain source**

Run this one-off script (writes the file; MET assigned per category since the source lacks MET):

```bash
node -e '
const https = require("https");
https.get("https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json", (r) => {
  let s = ""; r.on("data", d => s += d); r.on("end", () => {
    const MET = { strength:5, stretching:2.3, plyometrics:8, strongman:6, powerlifting:6, cardio:7, "olympic weightlifting":6 };
    const out = JSON.parse(s).map(e => ({
      name: e.name, category: e.category,
      primaryMuscles: e.primaryMuscles || [],
      met: MET[e.category] ?? 4,
    }));
    require("fs").writeFileSync("health/data/exercises.json", JSON.stringify(out));
    console.log("wrote", out.length, "exercises");
  });
});
'
```

Expected: `wrote 873 exercises`.

- [ ] **Step 2: Verify exercises.json shape**

Run: `node -e 'const d=require("./health/data/exercises.json"); console.log(d.length, JSON.stringify(d[0]))'`
Expected: `873 {"name":"3/4 Sit-Up","category":"strength","primaryMuscles":["abdominals"],"met":5}`

- [ ] **Step 3: Create curated foods.json**

Create `health/data/foods.json` with these 30 common whole/Asian foods (per one serving; kcal/macros are standard reference values; user can edit any in the app):

```json
[
  { "name": "White rice (cooked, 1 cup)", "serving": "1 cup (158g)", "kcal": 205, "protein_g": 4.3, "carbs_g": 45, "fat_g": 0.4 },
  { "name": "Chicken breast (cooked, 100g)", "serving": "100g", "kcal": 165, "protein_g": 31, "carbs_g": 0, "fat_g": 3.6 },
  { "name": "Egg (large, boiled)", "serving": "1 egg (50g)", "kcal": 78, "protein_g": 6.3, "carbs_g": 0.6, "fat_g": 5.3 },
  { "name": "Nasi lemak (plain plate)", "serving": "1 plate", "kcal": 490, "protein_g": 11, "carbs_g": 60, "fat_g": 23 },
  { "name": "Chicken rice", "serving": "1 plate", "kcal": 600, "protein_g": 34, "carbs_g": 75, "fat_g": 18 },
  { "name": "Roti canai (plain)", "serving": "1 piece", "kcal": 300, "protein_g": 6, "carbs_g": 38, "fat_g": 14 },
  { "name": "Char kuey teow", "serving": "1 plate", "kcal": 745, "protein_g": 22, "carbs_g": 76, "fat_g": 38 },
  { "name": "Banana", "serving": "1 medium (118g)", "kcal": 105, "protein_g": 1.3, "carbs_g": 27, "fat_g": 0.4 },
  { "name": "Apple", "serving": "1 medium (182g)", "kcal": 95, "protein_g": 0.5, "carbs_g": 25, "fat_g": 0.3 },
  { "name": "Oats (dry, 40g)", "serving": "40g", "kcal": 150, "protein_g": 5, "carbs_g": 27, "fat_g": 3 },
  { "name": "Whole milk (1 cup)", "serving": "240ml", "kcal": 149, "protein_g": 8, "carbs_g": 12, "fat_g": 8 },
  { "name": "Greek yogurt (plain, 170g)", "serving": "170g", "kcal": 100, "protein_g": 17, "carbs_g": 6, "fat_g": 0.7 },
  { "name": "Salmon (cooked, 100g)", "serving": "100g", "kcal": 206, "protein_g": 22, "carbs_g": 0, "fat_g": 13 },
  { "name": "Beef (lean, cooked, 100g)", "serving": "100g", "kcal": 250, "protein_g": 26, "carbs_g": 0, "fat_g": 15 },
  { "name": "Tofu (firm, 100g)", "serving": "100g", "kcal": 144, "protein_g": 17, "carbs_g": 3, "fat_g": 9 },
  { "name": "Broccoli (cooked, 1 cup)", "serving": "1 cup (156g)", "kcal": 55, "protein_g": 3.7, "carbs_g": 11, "fat_g": 0.6 },
  { "name": "Bread (white, 1 slice)", "serving": "1 slice", "kcal": 79, "protein_g": 2.7, "carbs_g": 15, "fat_g": 1 },
  { "name": "Peanut butter (2 tbsp)", "serving": "32g", "kcal": 190, "protein_g": 8, "carbs_g": 7, "fat_g": 16 },
  { "name": "Instant noodles (1 pack)", "serving": "1 pack", "kcal": 385, "protein_g": 8, "carbs_g": 55, "fat_g": 15 },
  { "name": "Milo (1 cup, made with milk)", "serving": "1 cup", "kcal": 210, "protein_g": 8, "carbs_g": 32, "fat_g": 6 },
  { "name": "Teh tarik", "serving": "1 cup", "kcal": 130, "protein_g": 3, "carbs_g": 20, "fat_g": 4 },
  { "name": "Kaya toast (2 slices)", "serving": "2 slices", "kcal": 280, "protein_g": 6, "carbs_g": 36, "fat_g": 12 },
  { "name": "Mee goreng", "serving": "1 plate", "kcal": 660, "protein_g": 20, "carbs_g": 80, "fat_g": 28 },
  { "name": "Fried chicken (1 piece, thigh)", "serving": "1 piece", "kcal": 280, "protein_g": 22, "carbs_g": 9, "fat_g": 17 },
  { "name": "French fries (medium)", "serving": "medium (117g)", "kcal": 365, "protein_g": 4, "carbs_g": 48, "fat_g": 17 },
  { "name": "Avocado (half)", "serving": "1/2 (100g)", "kcal": 160, "protein_g": 2, "carbs_g": 9, "fat_g": 15 },
  { "name": "Almonds (28g)", "serving": "28g", "kcal": 164, "protein_g": 6, "carbs_g": 6, "fat_g": 14 },
  { "name": "Protein shake (1 scoop whey)", "serving": "1 scoop", "kcal": 120, "protein_g": 24, "carbs_g": 3, "fat_g": 1.5 },
  { "name": "Sweet potato (baked, 130g)", "serving": "130g", "kcal": 112, "protein_g": 2, "carbs_g": 26, "fat_g": 0.1 },
  { "name": "Coffee (black)", "serving": "1 cup", "kcal": 2, "protein_g": 0.3, "carbs_g": 0, "fat_g": 0 }
]
```

- [ ] **Step 4: Verify foods.json parses**

Run: `node -e 'const d=require("./health/data/foods.json"); console.log(d.length, "foods; keys:", Object.keys(d[0]).join(","))'`
Expected: `30 foods; keys: name,serving,kcal,protein_g,carbs_g,fat_g`

- [ ] **Step 5: Commit**

```bash
git add health/data/exercises.json health/data/foods.json
git commit -m "Bundle offline seed data: 873 exercises + curated foods"
```

---

### Task 5: expenses-repo.js (Finance)

**Files:**
- Create: `finance/expenses-repo.js`

**Interfaces:**
- Consumes: `getClient`, `cloudEnabled` from `../db.js`.
- Produces `ExpensesRepo` object:
  - `create({ spentAt, amount, category, note })` → inserts row, returns saved row.
  - `list()` → array of camelCase `{ id, spentAt, amount, category, note }` desc by `spent_at`.
  - `monthlySummary(yyyymm)` → `{ total, byCategory: {cat: total} }` for the given `YYYY-MM`, or `null` when `!cloudEnabled`.

- [ ] **Step 1: Write the repo (verified manually — no unit test; matches receipts-repo pattern)**

Create `finance/expenses-repo.js`:

```javascript
import { getClient, cloudEnabled } from '../db.js';

function toRow(e) {
  return {
    id: e.id,
    spentAt: e.spent_at,
    amount: Number(e.amount),
    category: e.category,
    note: e.note,
  };
}

export const ExpensesRepo = {
  async create({ spentAt, amount, category, note }) {
    const c = await getClient();
    if (!c) throw new Error('Expenses need cloud sync — enable Supabase in config.js.');
    const { data: { user } } = await c.auth.getUser();
    if (!user) throw new Error('Not signed in.');
    const { data, error } = await c
      .from('expenses')
      .insert({ user_id: user.id, spent_at: spentAt, amount, category: category || 'other', note: note || null })
      .select()
      .single();
    if (error) throw error;
    return toRow(data);
  },

  async list() {
    const c = await getClient();
    if (!c) return [];
    const { data, error } = await c.from('expenses').select('*').order('spent_at', { ascending: false });
    if (error) throw error;
    return data.map(toRow);
  },

  async monthlySummary(yyyymm) {
    if (!cloudEnabled) return null;
    const rows = await this.list();
    const inMonth = rows.filter((r) => (r.spentAt || '').slice(0, 7) === yyyymm);
    const byCategory = {};
    let total = 0;
    for (const r of inMonth) {
      byCategory[r.category] = (byCategory[r.category] || 0) + r.amount;
      total += r.amount;
    }
    return { total, byCategory };
  },
};
```

- [ ] **Step 2: Static import check**

Run: `node -e 'import("./finance/expenses-repo.js").then(m=>console.log("exports:", Object.keys(m)))' --input-type=module 2>/dev/null || node --input-type=module -e 'import("./finance/expenses-repo.js").then(m=>console.log(Object.keys(m.ExpensesRepo||{})))'`
Expected: lists `create,list,monthlySummary` (the `../db.js` import resolves; esm.sh import is dynamic inside `getClient`, not triggered here).
Note: if the esm.sh dynamic import warns, ignore — it only runs in-browser.

- [ ] **Step 3: Commit**

```bash
git add finance/expenses-repo.js
git commit -m "Add expenses repo (create/list/monthlySummary)"
```

---

### Task 6: Wire Expenses tab into Finance UI

**Files:**
- Modify: `finance/index.html` (add tab button + panel)
- Modify: `finance/finance.js` (import + init)

**Interfaces:**
- Consumes: `ExpensesRepo` from Task 5.

- [ ] **Step 1: Add the Expenses tab button and panel to `finance/index.html`**

In the `<nav class="tabs">` block, add a third button after the OT Pay button:

```html
  <button class="tab-btn" data-tab="expenses">Expenses</button>
```

After the closing `</section>` of `#tab-ot-pay`, add:

```html
<section id="tab-expenses" class="tab-panel">
  <h2>Add expense</h2>
  <form id="expense-form">
    <label>Date <input type="date" id="expense-date" required /></label>
    <label>Amount <input type="number" step="0.01" id="expense-amount" required /></label>
    <label>Category <input type="text" id="expense-category" value="other" /></label>
    <label>Note <input type="text" id="expense-note" placeholder="optional" /></label>
    <button type="submit">Add</button>
  </form>
  <div id="expense-status"></div>

  <h2>This month</h2>
  <p id="expense-total"></p>
  <ul id="expense-by-category"></ul>
</section>
```

- [ ] **Step 2: Wire it in `finance/finance.js`**

Add to the imports at top:

```javascript
import { ExpensesRepo } from './expenses-repo.js';
```

Add `initExpensesTab();` after the existing `initOtPayTab();` call.

Add these functions at the end of the file:

```javascript
/* ---------------- Expenses tab ---------------- */

function initExpensesTab() {
  document.getElementById('expense-form').addEventListener('submit', onAddExpense);
  refreshExpenseSummary().catch(() => {});
}

async function onAddExpense(e) {
  e.preventDefault();
  const status = document.getElementById('expense-status');
  try {
    await ExpensesRepo.create({
      spentAt: document.getElementById('expense-date').value,
      amount: parseFloat(document.getElementById('expense-amount').value),
      category: document.getElementById('expense-category').value || 'other',
      note: document.getElementById('expense-note').value || null,
    });
    document.getElementById('expense-form').reset();
    document.getElementById('expense-category').value = 'other';
    status.textContent = 'Added.';
    refreshExpenseSummary();
  } catch (err) {
    status.textContent = `Could not add (${err.message}).`;
  }
}

async function refreshExpenseSummary() {
  const now = new Date();
  const yyyymm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const summary = await ExpensesRepo.monthlySummary(yyyymm);
  const totalEl = document.getElementById('expense-total');
  const listEl = document.getElementById('expense-by-category');
  if (summary === null) {
    totalEl.textContent = 'Expenses need cloud sync — enable Supabase in config.js.';
    listEl.innerHTML = '';
    return;
  }
  totalEl.textContent = `Total: ${summary.total.toFixed(2)}`;
  listEl.innerHTML = '';
  for (const [cat, total] of Object.entries(summary.byCategory)) {
    const li = document.createElement('li');
    li.textContent = `${cat}: ${total.toFixed(2)}`;
    listEl.appendChild(li);
  }
}
```

- [ ] **Step 3: Manual verification**

Run: `python3 -m http.server 8080` (from `life-os/`), open `http://localhost:8080/finance/index.html`.
Expected: three tabs (Spending / OT Pay / Expenses). Expenses tab shows the form; in local mode (no Supabase) the summary shows the "needs cloud sync" message and Add shows an error — no silent failure. (With Supabase configured + signed in, adding an expense updates the month total.)

- [ ] **Step 4: Commit**

```bash
git add finance/index.html finance/finance.js
git commit -m "Wire Expenses tab into Finance UI"
```

---

### Task 7: meals-repo.js and workouts-repo.js

**Files:**
- Create: `health/meals-repo.js`
- Create: `health/workouts-repo.js`

**Interfaces:**
- Consumes: `getClient`, `cloudEnabled` from `../db.js`; `parse-receipt`-style storage upload + edge invoke for the photo path (edge function built in Task 9).
- Produces:
  - `MealsRepo.estimatePhoto(file)` → `{ storagePath, extracted: { name, calories, protein_g, carbs_g, fat_g } }` (uploads to `meals` bucket, invokes `estimate-meal`).
  - `MealsRepo.save({ eatenAt, name, source, imagePath, calories, proteinG, carbsG, fatG })` → saved row.
  - `MealsRepo.listForDay(date)` → array of camelCase meals `{ id, eatenAt, name, source, calories, proteinG, carbsG, fatG }`.
  - `WorkoutsRepo.save({ doneAt, exercise, category, sets, reps, weightKg, durationMin, caloriesBurned })` → saved row.
  - `WorkoutsRepo.listForWeek(startDate)` → array of camelCase workouts for the 7 days from `startDate`.

- [ ] **Step 1: Create `health/meals-repo.js`**

```javascript
import { getClient } from '../db.js';

function localId() {
  return globalThis.crypto?.randomUUID?.() || 'm_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function toRow(m) {
  return {
    id: m.id, eatenAt: m.eaten_at, name: m.name, source: m.source,
    calories: m.calories, proteinG: m.protein_g, carbsG: m.carbs_g, fatG: m.fat_g,
  };
}

export const MealsRepo = {
  async estimatePhoto(file) {
    const c = await getClient();
    if (!c) throw new Error('Photo estimate needs cloud sync — enable Supabase in config.js.');
    const { data: { user } } = await c.auth.getUser();
    if (!user) throw new Error('Not signed in.');
    const ext = file.name.includes('.') ? file.name.split('.').pop() : 'jpg';
    const storagePath = `${user.id}/${localId()}.${ext}`;
    const { error: upErr } = await c.storage.from('meals').upload(storagePath, file, { contentType: file.type });
    if (upErr) throw upErr;
    const { data: { session } } = await c.auth.getSession();
    const { data, error } = await c.functions.invoke('estimate-meal', {
      body: { storagePath, mediaType: file.type },
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (error) { const e = new Error(error.message || 'estimate-meal failed'); e.storagePath = storagePath; throw e; }
    return { storagePath, extracted: data };
  },

  async save({ eatenAt, name, source, imagePath, calories, proteinG, carbsG, fatG }) {
    const c = await getClient();
    if (!c) throw new Error('Meals need cloud sync — enable Supabase in config.js.');
    const { data: { user } } = await c.auth.getUser();
    if (!user) throw new Error('Not signed in.');
    const { data, error } = await c.from('meals').insert({
      user_id: user.id, eaten_at: eatenAt, name, source: source || 'manual',
      image_path: imagePath || null,
      calories: calories ?? null, protein_g: proteinG ?? null, carbs_g: carbsG ?? null, fat_g: fatG ?? null,
    }).select().single();
    if (error) throw error;
    return toRow(data);
  },

  async listForDay(date) {
    const c = await getClient();
    if (!c) return [];
    const { data, error } = await c.from('meals').select('*').eq('eaten_at', date).order('created_at', { ascending: true });
    if (error) throw error;
    return data.map(toRow);
  },
};
```

- [ ] **Step 2: Create `health/workouts-repo.js`**

```javascript
import { getClient } from '../db.js';

function toRow(w) {
  return {
    id: w.id, doneAt: w.done_at, exercise: w.exercise, category: w.category,
    sets: w.sets, reps: w.reps, weightKg: w.weight_kg, durationMin: w.duration_min,
    caloriesBurned: w.calories_burned,
  };
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export const WorkoutsRepo = {
  async save({ doneAt, exercise, category, sets, reps, weightKg, durationMin, caloriesBurned }) {
    const c = await getClient();
    if (!c) throw new Error('Workouts need cloud sync — enable Supabase in config.js.');
    const { data: { user } } = await c.auth.getUser();
    if (!user) throw new Error('Not signed in.');
    const { data, error } = await c.from('workouts').insert({
      user_id: user.id, done_at: doneAt, exercise, category: category || null,
      sets: sets ?? null, reps: reps ?? null, weight_kg: weightKg ?? null,
      duration_min: durationMin ?? null, calories_burned: caloriesBurned ?? null,
    }).select().single();
    if (error) throw error;
    return toRow(data);
  },

  async listForWeek(startDate) {
    const c = await getClient();
    if (!c) return [];
    const end = addDays(startDate, 7);
    const { data, error } = await c.from('workouts').select('*')
      .gte('done_at', startDate).lt('done_at', end).order('done_at', { ascending: false });
    if (error) throw error;
    return data.map(toRow);
  },
};
```

- [ ] **Step 3: Static import check**

Run: `node --input-type=module -e 'Promise.all([import("./health/meals-repo.js"),import("./health/workouts-repo.js")]).then(([a,b])=>console.log(Object.keys(a.MealsRepo), Object.keys(b.WorkoutsRepo)))'`
Expected: `[ 'estimatePhoto', 'save', 'listForDay' ] [ 'save', 'listForWeek' ]`

- [ ] **Step 4: Commit**

```bash
git add health/meals-repo.js health/workouts-repo.js
git commit -m "Add meals + workouts repos"
```

---

### Task 8: Health module UI (Meal | Workout tabs)

**Files:**
- Create: `health/index.html`
- Create: `health/health.js`

**Interfaces:**
- Consumes: `MealsRepo`, `WorkoutsRepo`, `portionScale`, `dailyTotals`, `compareToTarget`, `estimateBurn`, and the two JSON data files.

- [ ] **Step 1: Create `health/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>life-os — Health</title>
<link rel="stylesheet" href="../ui.css" />
<link rel="manifest" href="../manifest.webmanifest" />
</head>
<body>
<header>
  <a href="../index.html">&larr; life-os</a>
  <h1>Health</h1>
</header>

<nav class="tabs">
  <button class="tab-btn active" data-tab="meal">Meal</button>
  <button class="tab-btn" data-tab="workout">Workout</button>
</nav>

<section id="tab-meal" class="tab-panel active">
  <h2>Log meal</h2>
  <form id="meal-photo-form">
    <label>Snap a meal photo
      <input type="file" id="meal-photo" accept="image/*" capture="environment" />
    </label>
    <button type="submit">Estimate from photo</button>
  </form>

  <label>Or search a food
    <input type="text" id="food-search" placeholder="e.g. chicken rice" list="food-list" />
  </label>
  <datalist id="food-list"></datalist>
  <label>Servings <input type="number" id="food-servings" step="0.25" value="1" /></label>
  <button type="button" id="food-add">Add food</button>

  <div id="meal-status"></div>

  <div id="meal-preview" hidden>
    <h3>Review before saving</h3>
    <label>Name <input type="text" id="meal-name" /></label>
    <label>Date <input type="date" id="meal-date" /></label>
    <label>Calories <input type="number" id="meal-cal" /></label>
    <label>Protein (g) <input type="number" id="meal-protein" /></label>
    <label>Carbs (g) <input type="number" id="meal-carbs" /></label>
    <label>Fat (g) <input type="number" id="meal-fat" /></label>
    <button type="button" id="meal-save">Save meal</button>
  </div>

  <h2>Today</h2>
  <label>Daily target (kcal) <input type="number" id="meal-target" value="2000" /></label>
  <p id="meal-daily"></p>
  <ul id="meal-list"></ul>
</section>

<section id="tab-workout" class="tab-panel">
  <h2>Log workout</h2>
  <form id="workout-form">
    <label>Exercise
      <input type="text" id="workout-exercise" list="exercise-list" placeholder="e.g. Barbell Squat" required />
    </label>
    <datalist id="exercise-list"></datalist>
    <label>Date <input type="date" id="workout-date" required /></label>
    <label>Sets <input type="number" id="workout-sets" /></label>
    <label>Reps <input type="number" id="workout-reps" /></label>
    <label>Weight (kg) <input type="number" id="workout-weight" step="0.5" /></label>
    <label>Duration (min) <input type="number" id="workout-duration" /></label>
    <button type="submit">Log workout</button>
  </form>
  <div id="workout-status"></div>

  <h2>Bodyweight (for burn estimate)</h2>
  <label>Weight (kg) <input type="number" id="body-weight" step="0.5" value="70" /></label>

  <h2>This week</h2>
  <p id="workout-summary"></p>
  <ul id="workout-list"></ul>
</section>

<script type="module" src="health.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `health/health.js`**

```javascript
import { MealsRepo } from './meals-repo.js';
import { WorkoutsRepo } from './workouts-repo.js';
import { portionScale, dailyTotals, compareToTarget } from './nutrition.js';
import { estimateBurn } from './calories-burned.js';

const todayStr = () => new Date().toISOString().slice(0, 10);
let foods = [];
let exercises = [];

initTabs();
initMealTab();
initWorkoutTab();

function initTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });
}

/* ---------------- Meal tab ---------------- */

async function initMealTab() {
  document.getElementById('meal-date').value = todayStr();
  foods = await fetch('./data/foods.json').then((r) => r.json()).catch(() => []);
  const dl = document.getElementById('food-list');
  dl.innerHTML = foods.map((f) => `<option value="${f.name}"></option>`).join('');

  document.getElementById('food-add').addEventListener('click', onAddFood);
  document.getElementById('meal-photo-form').addEventListener('submit', onEstimatePhoto);
  document.getElementById('meal-save').addEventListener('click', onSaveMeal);
  document.getElementById('meal-target').addEventListener('input', refreshDaily);
  refreshDaily().catch(() => {});
}

function showMealPreview({ name, calories, proteinG, carbsG, fatG }) {
  document.getElementById('meal-preview').hidden = false;
  document.getElementById('meal-name').value = name || '';
  document.getElementById('meal-date').value = todayStr();
  document.getElementById('meal-cal').value = calories ?? '';
  document.getElementById('meal-protein').value = proteinG ?? '';
  document.getElementById('meal-carbs').value = carbsG ?? '';
  document.getElementById('meal-fat').value = fatG ?? '';
}

function onAddFood() {
  const name = document.getElementById('food-search').value.trim();
  const food = foods.find((f) => f.name === name);
  if (!food) { document.getElementById('meal-status').textContent = 'Pick a food from the list.'; return; }
  const servings = parseFloat(document.getElementById('food-servings').value) || 1;
  const scaled = portionScale(food, servings);
  showMealPreview({ name: `${food.name} × ${servings}`, ...scaled });
  document.getElementById('meal-status').textContent = '';
}

async function onEstimatePhoto(e) {
  e.preventDefault();
  const file = document.getElementById('meal-photo').files[0];
  const status = document.getElementById('meal-status');
  if (!file) return;
  status.textContent = 'Uploading and estimating...';
  try {
    const { extracted } = await MealsRepo.estimatePhoto(file);
    showMealPreview({
      name: extracted.name, calories: extracted.calories,
      proteinG: extracted.protein_g, carbsG: extracted.carbs_g, fatG: extracted.fat_g,
    });
    status.textContent = '';
  } catch (err) {
    status.textContent = `Could not estimate (${err.message}). Enter it manually below.`;
    showMealPreview({ name: '', calories: '', proteinG: '', carbsG: '', fatG: '' });
  }
}

async function onSaveMeal() {
  const status = document.getElementById('meal-status');
  try {
    await MealsRepo.save({
      eatenAt: document.getElementById('meal-date').value || todayStr(),
      name: document.getElementById('meal-name').value || 'meal',
      source: 'manual',
      calories: parseFloat(document.getElementById('meal-cal').value) || null,
      proteinG: parseFloat(document.getElementById('meal-protein').value) || null,
      carbsG: parseFloat(document.getElementById('meal-carbs').value) || null,
      fatG: parseFloat(document.getElementById('meal-fat').value) || null,
    });
    document.getElementById('meal-preview').hidden = true;
    status.textContent = 'Saved.';
    refreshDaily();
  } catch (err) {
    status.textContent = `Could not save (${err.message}).`;
  }
}

async function refreshDaily() {
  const meals = await MealsRepo.listForDay(todayStr());
  const totals = dailyTotals(meals);
  const target = parseFloat(document.getElementById('meal-target').value) || 0;
  const cmp = compareToTarget(totals, target);
  const pctStr = cmp.pct === null ? '' : ` (${cmp.pct}% of target, ${cmp.remaining} left)`;
  document.getElementById('meal-daily').textContent =
    `${Math.round(totals.calories)} kcal · P ${Math.round(totals.proteinG)}g · C ${Math.round(totals.carbsG)}g · F ${Math.round(totals.fatG)}g${pctStr}`;
  const list = document.getElementById('meal-list');
  list.innerHTML = meals.map((m) => `<li>${m.name} — ${Math.round(m.calories || 0)} kcal</li>`).join('');
}

/* ---------------- Workout tab ---------------- */

async function initWorkoutTab() {
  document.getElementById('workout-date').value = todayStr();
  exercises = await fetch('./data/exercises.json').then((r) => r.json()).catch(() => []);
  const dl = document.getElementById('exercise-list');
  // datalists over ~900 options are fine; browser filters as you type
  dl.innerHTML = exercises.map((x) => `<option value="${x.name}"></option>`).join('');
  document.getElementById('workout-form').addEventListener('submit', onLogWorkout);
  refreshWeek().catch(() => {});
}

async function onLogWorkout(e) {
  e.preventDefault();
  const status = document.getElementById('workout-status');
  const name = document.getElementById('workout-exercise').value.trim();
  const ex = exercises.find((x) => x.name === name);
  const durationMin = parseFloat(document.getElementById('workout-duration').value) || null;
  const weightKg = parseFloat(document.getElementById('body-weight').value) || 70;
  const caloriesBurned = ex && durationMin
    ? Math.round(estimateBurn({ met: ex.met, weightKg, durationMin }))
    : null;
  try {
    await WorkoutsRepo.save({
      doneAt: document.getElementById('workout-date').value || todayStr(),
      exercise: name,
      category: ex?.category || null,
      sets: parseInt(document.getElementById('workout-sets').value, 10) || null,
      reps: parseInt(document.getElementById('workout-reps').value, 10) || null,
      weightKg: parseFloat(document.getElementById('workout-weight').value) || null,
      durationMin,
      caloriesBurned,
    });
    document.getElementById('workout-form').reset();
    document.getElementById('workout-date').value = todayStr();
    status.textContent = caloriesBurned ? `Logged (~${caloriesBurned} kcal burned).` : 'Logged.';
    refreshWeek();
  } catch (err) {
    status.textContent = `Could not save (${err.message}).`;
  }
}

function weekStart() {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

async function refreshWeek() {
  const workouts = await WorkoutsRepo.listForWeek(weekStart());
  const totalBurn = workouts.reduce((s, w) => s + (Number(w.caloriesBurned) || 0), 0);
  document.getElementById('workout-summary').textContent =
    `${workouts.length} workouts this week · ~${Math.round(totalBurn)} kcal burned`;
  document.getElementById('workout-list').innerHTML = workouts
    .map((w) => `<li>${w.doneAt}: ${w.exercise}${w.sets ? ` ${w.sets}×${w.reps || ''}` : ''}${w.caloriesBurned ? ` (~${Math.round(w.caloriesBurned)} kcal)` : ''}</li>`)
    .join('');
}
```

- [ ] **Step 3: Manual verification**

Run: `python3 -m http.server 8080`, open `http://localhost:8080/health/index.html`.
Expected: Meal tab — food search datalist populates from `foods.json`; "Add food" with servings fills the preview with scaled macros; the daily line + target math render. Workout tab — exercise datalist populates from `exercises.json`; logging with a duration shows an estimated burn. In local mode, saves show the "needs cloud sync" message (no silent failure); pure search/scale/estimate work offline.

- [ ] **Step 4: Commit**

```bash
git add health/index.html health/health.js
git commit -m "Add Health module UI (Meal + Workout tabs)"
```

---

### Task 9: estimate-meal edge function

**Files:**
- Create: `supabase/functions/estimate-meal/index.ts`
- Reference: `supabase/functions/parse-receipt/index.ts` (mirror its structure exactly — auth, storage download, Claude call, JSON parse, CORS)

**Interfaces:**
- Consumes: request `{ storagePath, mediaType }` + Bearer auth; the `meals` bucket.
- Produces: JSON `{ name, calories, protein_g, carbs_g, fat_g }`.

- [ ] **Step 1: Read the existing function to mirror its exact shape**

Run: `cat supabase/functions/parse-receipt/index.ts`
This shows the exact imports (`serve`, `createClient`, `Anthropic`), CORS headers, auth-from-Bearer, storage download → base64, the `anthropic.messages.create` vision call, and JSON extraction. **Mirror it**; only the prompt and output schema change.

- [ ] **Step 2: Create `supabase/functions/estimate-meal/index.ts`**

Copy `parse-receipt/index.ts` verbatim, then change only:
1. The storage bucket from `receipts` to `meals`.
2. The Claude prompt to:

```
You are a nutrition estimator. Look at this meal photo and estimate the dish
name and TOTAL calories, protein, carbs, and fat for the whole plate.
Respond with ONLY strict minified JSON, no prose:
{"name": string, "calories": number, "protein_g": number, "carbs_g": number, "fat_g": number}
If unsure, give your best single estimate (do not return ranges or null).
```

3. The returned object shape to `{ name, calories, protein_g, carbs_g, fat_g }` (parse Claude's JSON, return it as the function response, same as parse-receipt returns its items).

Keep the model id, auth check, CORS handling, and error shape identical to parse-receipt.

- [ ] **Step 3: Verify it type-checks / deploys (requires Supabase CLI + login — user runs)**

Run: `supabase functions deploy estimate-meal`
Expected: deploy succeeds. (If the CLI isn't linked yet, this is the same setup as README steps 5-7 for parse-receipt; the function code is what this task delivers.)
Note: the `ANTHROPIC_API_KEY` secret is already set for parse-receipt (README step 6), so no new secret is needed.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/estimate-meal/index.ts
git commit -m "Add estimate-meal edge function (photo -> macros via Claude)"
```

---

### Task 10: Enable the Health hub card

**Files:**
- Modify: `index.html` (root hub)

**Interfaces:** none.

- [ ] **Step 1: Enable the Health card**

In root `index.html`, change the Health line from:

```html
  <a class="hub-card disabled" href="#">Health (coming soon)</a>
```

to:

```html
  <a class="hub-card" href="./health/index.html">Health</a>
```

- [ ] **Step 2: Manual verification**

Run: `python3 -m http.server 8080`, open `http://localhost:8080/`.
Expected: the Health card is enabled and links to the Health module; Finance still works.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "Enable Health hub card"
```

---

### Task 11: Docs + full test run

**Files:**
- Modify: `README.md` (document the new modules + estimate-meal deploy step)

**Interfaces:** none.

- [ ] **Step 1: Update README**

In `README.md`, update the "Currently live" line to mention Health, and add `estimate-meal` alongside `parse-receipt` in the functions-deploy step:

Change the intro paragraph's module list to include: "the **Finance** module (receipt scanning, expenses, OT pay) and the **Health** module (meal + workout tracking)."

In the setup steps, change the deploy line to:
```
7. `supabase functions deploy parse-receipt && supabase functions deploy estimate-meal`
```

Add a short "Health module" note after the holidays section:
```
## Health module

Meal and workout tracking. Food and exercise data are bundled offline in
`health/data/` (foods.json is hand-curated; exercises.json is derived from the
public-domain yuhonas/free-exercise-db). Meal photos are estimated by the
`estimate-meal` edge function (same Claude/`ANTHROPIC_API_KEY` setup as receipts).
```

- [ ] **Step 2: Run the full pure-logic test suite**

Run: `node --test health/*.test.js`
Expected: all tests pass (nutrition: 6, calories-burned: 4 = 10 total).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Document Health module and estimate-meal deploy step"
```

---

## Self-Review Notes

- **Spec coverage:** expenses table + Finance tab (T1,T5,T6); meals/workouts tables (T1); pure nutrition + burn logic with tests (T2,T3); bundled offline foods+exercises (T4); meal photo estimate edge fn (T9) + repo (T7) + UI (T8); workout logging + burn (T7,T8); Health module + tabs (T8); hub card (T10); graceful signed-out degradation (every repo + UI catch path); RLS on all tables (T1); manual-verify convention + pure-logic tests (T2,T3,T11). All spec sections mapped.
- **Deferred (spec "out of scope"):** live USDA/Open Food Facts, barcode, charts, wearables — none in tasks, intentionally.
- **Type consistency:** repos map snake_case↔camelCase; `MealsRepo.save` params `{eatenAt,name,source,imagePath,calories,proteinG,carbsG,fatG}` match `health.js` callers; `estimatePhoto` returns `extracted.{protein_g,...}` (snake, from Claude) and `health.js` maps to `proteinG` before `showMealPreview` — consistent. `estimateBurn`/`portionScale`/`dailyTotals`/`compareToTarget` signatures match tests and callers.
- **No placeholders:** every code step has full content.
