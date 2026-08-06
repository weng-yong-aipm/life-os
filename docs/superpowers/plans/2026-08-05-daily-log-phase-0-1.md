# Daily Log — Phase 0 + Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it possible to log a meal (with a viewable photo), a night's sleep, and one learning takeaway from the phone, every day — and fix the three verified defects that would silently corrupt that data.

**Architecture:** Extends the existing per-module pattern in `~/life-os` — each module is `<name>.js` (pure logic, no I/O) + `<name>-repo.js` (Supabase data layer) + `<name>.test.js` + a tab in `index.html`. No new architecture, no new dependencies. A new `public.sleep` table follows the exact shape of the existing `meals`/`workouts` tables including RLS.

**Tech Stack:** Vanilla ES modules (no framework, no build step) · Supabase (Postgres + RLS + Storage + Edge Functions/Deno) · Node native test runner.

**Source spec:** `docs/superpowers/specs/2026-08-05-daily-logging-design.md` (Phases 0 and 1).

## Global Constraints

- **No build step, no framework, no npm packages.** Plain ES modules loaded directly by the browser. Do not add a bundler, a transpiler, or a dependency.
- **Test command is `npm test`** → `node --test "*/*.test.js"`. The glob is exactly one directory deep, so a test file must live at `<module>/<name>.test.js` to be picked up. Tests use `node:test` + `node:assert/strict`.
- **Pure logic goes in `<name>.js` with zero I/O**; anything touching Supabase goes in `<name>-repo.js`. Tests only cover the pure module — no test may hit the network or a real database.
- **Code style:** single quotes, 2-space indent, semicolons. Match the surrounding file exactly; do not reformat adjacent code.
- **Every new table MUST be added to the aal2 table array** in `supabase/migrations/20260805130000_require_aal2_when_mfa_enrolled.sql`. A table added without that entry silently escapes the 2FA gate every other table has.
- **`life-os` is a PUBLIC repo serving a public site.** No employer names, no compensation figures, no content copied from `~/second-brain`. Never weaken the banned-names assertion in `career/goals.test.js`.
- **Timezone is MYT (UTC+8), no DST.** All user-facing "today" calculations must be local-date, never UTC.
- Commit after each task. Stage only the files that task touched — never `git add -A`.

## File Structure

| File | Responsibility |
|---|---|
| `shared/local-date.js` *(new)* | The single `localDateStr()` helper. Pure, no I/O. |
| `shared/local-date.test.js` *(new)* | Its tests. |
| `health/health.js` *(modify)* | Meal/workout tab wiring. Stops discarding the photo path; uses `localDateStr`. |
| `health/meals-repo.js` *(modify)* | Adds `signedUrlFor()`. |
| `health/workouts-repo.js` *(modify)* | Uses `localDateStr`. |
| `health/sleep.js` *(new)* | Pure sleep math (duration, consistency). |
| `health/sleep.test.js` *(new)* | Its tests. |
| `health/sleep-repo.js` *(new)* | Supabase data layer for `sleep`. |
| `health/index.html` *(modify)* | Third tab: Sleep. Meal list gains thumbnails. |
| `learning/index.html` *(modify)* | One-field quick-add. |
| `learning/learning.js` *(modify)* | Quick-add handler. |
| `learning/learning-repo.js` *(modify)* | `quickAdd()`. |
| `supabase/migrations/20260805140000_add_sleep_and_learning_minutes.sql` *(new)* | `sleep` table + RLS + `learning_sessions.minutes` + aal2 array entry. |
| `supabase/functions/estimate-meal/index.ts` *(modify)* | `max_tokens` fix. |
| `manifest.webmanifest` *(modify)* | `shortcuts` array. |

---

### Task 1: The local-date helper (fixes the UTC date bug)

The bug: `new Date().toISOString().slice(0,10)` returns a **UTC** date. In MYT (UTC+8) anything logged before 08:00 local is filed under **yesterday** — exactly the breakfast and wake-time window this project exists to capture. Verified at three sites.

**Files:**
- Create: `shared/local-date.js`
- Create: `shared/local-date.test.js`
- Modify: `health/health.js:6` and `health/health.js:162`
- Modify: `health/workouts-repo.js:15`

**Interfaces:**
- Produces: `localDateStr(d = new Date()) -> 'YYYY-MM-DD'` — the calendar date in the **runtime's local timezone**. Tasks 3, 5 and 6 all call this.

- [ ] **Step 1: Write the failing test**

Create `shared/local-date.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDateStr } from './local-date.js';

test('localDateStr formats a date as local YYYY-MM-DD', () => {
  //构造一个本地时间的日期，避免依赖运行环境的时区
  const d = new Date(2026, 7, 5, 12, 0, 0); // 2026-08-05 12:00 local
  assert.equal(localDateStr(d), '2026-08-05');
});

test('localDateStr reads the local calendar date at an early-morning time', () => {
  // 07:30 local on Aug 5 — the exact window the UTC bug misfiled. East of UTC
  // this instant is still Aug 4 in UTC, so toISOString().slice(0,10) would say
  // 2026-08-04. This must say 2026-08-05 in every timezone.
  const d = new Date(2026, 7, 5, 7, 30, 0);
  assert.equal(localDateStr(d), '2026-08-05');
});

test('localDateStr zero-pads month and day', () => {
  const d = new Date(2026, 0, 9, 15, 0, 0); // 2026-01-09
  assert.equal(localDateStr(d), '2026-01-09');
});

test('localDateStr defaults to now and returns a well-formed string', () => {
  assert.match(localDateStr(), /^\d{4}-\d{2}-\d{2}$/);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node --test shared/local-date.test.js`
Expected: FAIL — `Cannot find module './local-date.js'`.

- [ ] **Step 3: Write the implementation**

Create `shared/local-date.js`:

```js
/* The calendar date in the runtime's LOCAL timezone, as 'YYYY-MM-DD'.
 *
 * `new Date().toISOString().slice(0,10)` returns the UTC date, which in MYT
 * (UTC+8) files anything logged before 08:00 local under yesterday — the exact
 * breakfast and wake-time window this app is for. Use this everywhere a user
 * sees or picks "today". */
export function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `node --test shared/local-date.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Replace all three UTC sites**

In `health/health.js`, replace line 6:

```js
const todayStr = () => new Date().toISOString().slice(0, 10);
```

with an import at the top of the file (after the existing imports) and a local alias:

```js
import { localDateStr } from '../shared/local-date.js';

const todayStr = () => localDateStr();
```

In `health/health.js`, `weekStart()` currently ends with `return d.toISOString().slice(0, 10);` (around line 162). Replace that single return with:

```js
  return localDateStr(d);
```

In `health/workouts-repo.js`, line 15 is `return d.toISOString().slice(0, 10);` inside the week-start helper. Replace it with:

```js
  return localDateStr(d);
```

and add at the top of `health/workouts-repo.js`, after its existing imports:

```js
import { localDateStr } from '../shared/local-date.js';
```

- [ ] **Step 6: Confirm no UTC-date sites remain**

Run: `grep -rn "toISOString().slice(0, 10)" health/ learning/ finance/ career/ improve/ feed/ capture/`
Expected: no output. (If any remain outside these modules, leave them — this task's scope is the three verified sites.)

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: all pass, 0 fail. The count should be the previous total + 4.

- [ ] **Step 8: Commit**

```bash
git add shared/local-date.js shared/local-date.test.js health/health.js health/workouts-repo.js
git commit -m "fix(date): use the local calendar date, not the UTC one

new Date().toISOString().slice(0,10) is the UTC date. In MYT (UTC+8)
anything logged before 08:00 local was filed under yesterday — precisely
the breakfast and wake-time window this app exists to capture. Zero
production rows is why it was never noticed."
```

---

### Task 2: Stop the vision call truncating its own JSON

`supabase/functions/estimate-meal/index.ts:83` sets `max_tokens: 512` with no `thinking` field. Sonnet 5 runs adaptive thinking by default, and `max_tokens` caps thinking **and** output together — so the JSON can truncate mid-object, `JSON.parse` throws, the function 502s, and the UI silently falls back to manual entry. Photo estimation could therefore be broken forever without ever showing an error.

**Files:**
- Modify: `supabase/functions/estimate-meal/index.ts:83`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing — behaviour-only change to a deployed function.

- [ ] **Step 1: Read the current request body**

Run: `sed -n '75,95p' supabase/functions/estimate-meal/index.ts`
Expected: a `body: JSON.stringify({...})` containing `max_tokens: 512` and a `messages` array. Note the exact surrounding keys before editing.

- [ ] **Step 2: Raise the ceiling and disable thinking**

Change `max_tokens: 512,` to:

```ts
      // max_tokens caps thinking + output TOGETHER. Sonnet 5 runs adaptive
      // thinking by default, so 512 could truncate the JSON mid-object —
      // JSON.parse then throws, the function 502s, and the UI silently
      // degrades to manual entry. Nutrition extraction needs no reasoning
      // budget, so disable thinking outright and leave room for the object.
      max_tokens: 2000,
      thinking: { type: 'disabled' },
```

- [ ] **Step 3: Confirm the file still parses as TypeScript**

Run: `node --input-type=module -e "import('node:fs').then(fs=>{const s=fs.readFileSync('supabase/functions/estimate-meal/index.ts','utf8'); if(!s.includes('max_tokens: 2000')) throw new Error('edit missing'); if(!s.includes(\"thinking: { type: 'disabled' }\")) throw new Error('thinking missing'); console.log('ok');})"`
Expected: `ok`.

- [ ] **Step 4: Run the suite (no test covers the Edge Function; this is a regression guard)**

Run: `npm test`
Expected: all pass, count unchanged from Task 1.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/estimate-meal/index.ts
git commit -m "fix(estimate-meal): stop the vision call truncating its own JSON

max_tokens caps thinking and output together, and Sonnet 5 thinks by
default. At 512 the JSON could truncate, JSON.parse throws, the function
502s, and the UI degrades to manual entry with no visible error — so photo
estimation could be broken indefinitely without anyone noticing."
```

> **Note for the human:** this function must be redeployed for the fix to take effect (`supabase functions deploy estimate-meal`). Deployment is not part of this task.

---

### Task 3: Link the photo to the meal and render it

Verified defect: `health/health.js:68` destructures only `const { extracted } = ...` and throws `storagePath` away; `onSaveMeal` hardcodes `source: 'manual'` and never passes `imagePath`, even though `MealsRepo.save` already accepts it. Every photo lands orphaned in Storage, every row gets `image_path: null`, and a repo-wide grep for `createSignedUrl` returns zero hits — so no photo can be displayed even once linked.

This task also fixes `parseFloat(x) || null`, which coerces a legitimate `0` to NULL (a zero-calorie drink becomes "unknown").

**Files:**
- Modify: `health/health.js` (photo handler, save handler, day list)
- Modify: `health/meals-repo.js` (add `signedUrlFor`)
- Modify: `health/index.html` (meal list styling hook)

**Interfaces:**
- Consumes: `localDateStr` from Task 1.
- Produces: `MealsRepo.signedUrlFor(imagePath) -> Promise<string|null>` — Task 5 does not use it, but Phase 2's outbox will.

- [ ] **Step 1: Add the signed-URL method to the repo**

In `health/meals-repo.js`, add this method to the exported object, immediately after `save`:

```js
  /* A short-lived signed URL for a private-bucket image. The meals bucket is
   * private, so a stored path is not directly fetchable — without this the
   * photo can be uploaded and linked but never displayed. Returns null rather
   * than throwing: a missing thumbnail must not break the day list. */
  async signedUrlFor(imagePath) {
    if (!imagePath) return null;
    const c = await getClient();
    if (!c) return null;
    const { data, error } = await c.storage.from('meals').createSignedUrl(imagePath, 3600);
    if (error) return null;
    return data?.signedUrl ?? null;
  },
```

- [ ] **Step 2: Keep the storage path when estimating**

In `health/health.js`, `onEstimatePhoto` currently reads:

```js
    const { extracted } = await MealsRepo.estimatePhoto(file);
```

Replace with:

```js
    const { storagePath, extracted } = await MealsRepo.estimatePhoto(file);
    pendingImagePath = storagePath;
```

and in the `catch` block of the same function, immediately before `showMealPreview({ name: '', ... })`, add:

```js
    pendingImagePath = err.storagePath || null;
```

(`meals-repo.js` already attaches `storagePath` to the thrown error, so a failed *estimate* after a successful *upload* still links the photo.)

Declare the module-level variable next to the existing `let foods = [];`:

```js
let pendingImagePath = null;
```

- [ ] **Step 3: Pass it through on save, and stop coercing 0 to null**

In `health/health.js`, `onSaveMeal`, replace the `MealsRepo.save({...})` call with:

```js
    await MealsRepo.save({
      eatenAt: document.getElementById('meal-date').value || todayStr(),
      name: document.getElementById('meal-name').value || 'meal',
      source: pendingImagePath ? 'photo' : 'manual',
      imagePath: pendingImagePath,
      calories: numOrNull(document.getElementById('meal-cal').value),
      proteinG: numOrNull(document.getElementById('meal-protein').value),
      carbsG: numOrNull(document.getElementById('meal-carbs').value),
      fatG: numOrNull(document.getElementById('meal-fat').value),
    });
    pendingImagePath = null;
```

and add this helper next to `todayStr` near the top of the file:

```js
/* parseFloat(x) || null turns a legitimate 0 into null — a zero-calorie drink
 * would be stored as "unknown" rather than as zero. */
const numOrNull = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
```

- [ ] **Step 4: Apply the same fix to the workout save**

In the same file, the workout save path uses the same `parseFloat(...) || null` pattern (around lines 143-145). Replace each `parseFloat(document.getElementById('...').value) || null` there with `numOrNull(document.getElementById('...').value)`. Do not change any other logic in that function.

- [ ] **Step 5: Render the thumbnail in the day list**

In `health/health.js`, `refreshDaily`, replace the list-building loop:

```js
  for (const m of meals) {
    const li = document.createElement('li');
    li.textContent = `${m.name} — ${Math.round(m.calories || 0)} kcal`;
    list.appendChild(li);
  }
```

with:

```js
  for (const m of meals) {
    const li = document.createElement('li');
    li.className = 'meal-row';
    const label = document.createElement('span');
    label.textContent = `${m.name} — ${Math.round(m.calories || 0)} kcal`;
    if (m.imagePath) {
      const img = document.createElement('img');
      img.className = 'meal-thumb';
      img.alt = '';
      img.loading = 'lazy';
      MealsRepo.signedUrlFor(m.imagePath).then((url) => { if (url) img.src = url; });
      li.appendChild(img);
    }
    li.appendChild(label);
    list.appendChild(li);
  }
```

- [ ] **Step 6: Confirm the repo actually returns `imagePath`**

Run: `grep -n "image_path" health/meals-repo.js`
Expected: at least one hit inside the row-mapping function (`toRow`) exposing it as `imagePath`. **If `toRow` does not map `image_path`, add `imagePath: r.image_path,` to it** — otherwise Step 5 renders nothing. Report in your report file which of the two cases you found.

- [ ] **Step 7: Style the thumbnail**

In `health/index.html`, inside the existing `<style>` block (or the module's stylesheet if one is linked), add:

```css
.meal-row { display: flex; align-items: center; gap: .6rem; }
.meal-thumb { width: 40px; height: 40px; object-fit: cover; border-radius: 6px; flex: none; }
```

- [ ] **Step 8: Run the suite**

Run: `npm test`
Expected: all pass, count unchanged from Task 2 (this task adds no pure logic, so no new tests — the behaviour is DOM/network-bound and is covered by the Phase 1 done-check on a real device).

- [ ] **Step 9: Commit**

```bash
git add health/health.js health/meals-repo.js health/index.html
git commit -m "fix(meals): actually link the photo to the meal, and show it

health.js discarded storagePath, so every meal row was written with
image_path NULL and every uploaded photo was orphaned in Storage. No
signed-URL call existed anywhere in the repo, so even a linked photo could
never be displayed. Also stops parseFloat(x) || null coercing a legitimate
0 to NULL for both meals and workouts."
```

---

### Task 4: The `sleep` table and its migration

Sleep has zero support at every layer — no table, no column, no repo, no UI, no test. This task adds the schema only; Task 5 adds the module and tab.

**Files:**
- Create: `supabase/migrations/20260805140000_add_sleep_and_learning_minutes.sql`

**Interfaces:**
- Produces: table `public.sleep` with columns `(id, user_id, slept_on, bed_at, wake_at, duration_min, quality, note, source, source_key, synced_at, created_at)`; and `public.learning_sessions.minutes numeric`. Tasks 5 and 6 depend on these exact names.

- [ ] **Step 1: Read the existing table pattern so the new one matches**

Run: `sed -n '142,170p' supabase/schema.sql` and `grep -n "own_select\|own_insert\|own_update\|own_delete" supabase/schema.sql | head -20`
Expected: the `meals`/`workouts` definitions and the four `own_*` policy names used across this schema. Match them exactly.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260805140000_add_sleep_and_learning_minutes.sql`:

```sql
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
```

- [ ] **Step 3: Add `sleep` to the aal2 table array for future re-runs**

In `supabase/migrations/20260805130000_require_aal2_when_mfa_enrolled.sql`, the `do $$` block loops over a `text[]` of table names. Append `'sleep'` to that array so a fresh replay of the migration chain covers it too. The standalone policy in Step 2 handles the already-applied database; this keeps the two in sync.

- [ ] **Step 4: Verify the migration is valid SQL and self-consistent**

Run: `grep -c "create policy" supabase/migrations/20260805140000_add_sleep_and_learning_minutes.sql`
Expected: `5` (four `own_*` plus the aal2 restrictive policy).

Run: `grep -n "sleep_night_uk" supabase/migrations/20260805140000_add_sleep_and_learning_minutes.sql`
Expected: one hit — the one-row-per-night unique index on `(user_id, slept_on)`. There must be
**no** `where source_key is not null` partial index on this table; that shape would leave
hand-entered rows unconstrained.

Run: `grep -n "sleep" supabase/migrations/20260805130000_require_aal2_when_mfa_enrolled.sql`
Expected: one hit, inside the table array.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: all pass, count unchanged (no JS touched).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260805140000_add_sleep_and_learning_minutes.sql supabase/migrations/20260805130000_require_aal2_when_mfa_enrolled.sql
git commit -m "feat(sleep): schema for sleep tracking, plus learning minutes

source/source_key/synced_at from day one so a later Health Connect import
lands without a second migration, and a partial unique index that makes
re-running an importer idempotent while never deduping against a
hand-typed row. Added to the aal2 array so the new table does not escape
the 2FA gate every other table has."
```

> **Note for the human:** apply with `supabase db push` (or the pooler script used for migration 20260805130000). Application is not part of this task.

---

### Task 5: The sleep module and its tab

**Files:**
- Create: `health/sleep.js` (pure)
- Create: `health/sleep.test.js`
- Create: `health/sleep-repo.js`
- Modify: `health/index.html` (third tab + panel)
- Modify: `health/health.js` (init the tab)

**Interfaces:**
- Consumes: `localDateStr` (Task 1); the `public.sleep` table (Task 4); **`numOrNull(v)` — the module-level helper added to `health/health.js` in Task 3 Step 3.** Step 7 below calls it for the quality field. If Task 3 has not run, add it first (its definition is in Task 3 Step 3) rather than inlining a different coercion.
- Produces: `sleepDurationMin(bedAt, wakeAt)`, `formatDuration(min)`, `averageDuration(rows)`; `SleepRepo.save()`, `SleepRepo.listRecent()`.

- [ ] **Step 1: Write the failing tests**

Create `health/sleep.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sleepDurationMin, formatDuration, averageDuration } from './sleep.js';

test('sleepDurationMin computes minutes between bed and wake', () => {
  assert.equal(sleepDurationMin('2026-08-04T23:00:00+08:00', '2026-08-05T07:00:00+08:00'), 480);
});

test('sleepDurationMin handles crossing midnight', () => {
  assert.equal(sleepDurationMin('2026-08-04T22:30:00+08:00', '2026-08-05T06:15:00+08:00'), 465);
});

test('sleepDurationMin returns null when either end is missing', () => {
  assert.equal(sleepDurationMin(null, '2026-08-05T07:00:00+08:00'), null);
  assert.equal(sleepDurationMin('2026-08-04T23:00:00+08:00', null), null);
  assert.equal(sleepDurationMin(null, null), null);
});

test('sleepDurationMin returns null when wake is before bed', () => {
  assert.equal(sleepDurationMin('2026-08-05T07:00:00+08:00', '2026-08-04T23:00:00+08:00'), null);
});

test('formatDuration renders hours and minutes', () => {
  assert.equal(formatDuration(480), '8h 0m');
  assert.equal(formatDuration(465), '7h 45m');
  assert.equal(formatDuration(59), '0h 59m');
});

test('formatDuration renders an em dash for null', () => {
  assert.equal(formatDuration(null), '—');
});

test('averageDuration averages the rows that have a duration', () => {
  const rows = [{ durationMin: 480 }, { durationMin: 420 }, { durationMin: null }];
  assert.equal(averageDuration(rows), 450);
});

test('averageDuration returns null for no usable rows', () => {
  assert.equal(averageDuration([]), null);
  assert.equal(averageDuration([{ durationMin: null }]), null);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `node --test health/sleep.test.js`
Expected: FAIL — `Cannot find module './sleep.js'`.

- [ ] **Step 3: Write the pure module**

Create `health/sleep.js`:

```js
/* Pure sleep math — no I/O. */

/* Minutes between two ISO timestamps. Returns null when either end is missing
 * or the pair is inverted, so a half-filled form can never store a negative or
 * absurd duration. */
export function sleepDurationMin(bedAt, wakeAt) {
  if (!bedAt || !wakeAt) return null;
  const bed = Date.parse(bedAt);
  const wake = Date.parse(wakeAt);
  if (!Number.isFinite(bed) || !Number.isFinite(wake)) return null;
  if (wake <= bed) return null;
  return Math.round((wake - bed) / 60000);
}

export function formatDuration(min) {
  if (min == null || !Number.isFinite(Number(min))) return '—';
  const m = Math.max(0, Math.round(Number(min)));
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function averageDuration(rows) {
  const usable = (rows || []).map((r) => Number(r?.durationMin)).filter((n) => Number.isFinite(n));
  if (!usable.length) return null;
  return Math.round(usable.reduce((a, b) => a + b, 0) / usable.length);
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `node --test health/sleep.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Write the repo**

Create `health/sleep-repo.js`, matching the structure of `health/meals-repo.js` (read it first for the exact `getClient`/`demoMode` import paths and the `toRow` convention):

```js
import { getClient } from '../db.js';
import { demoMode } from '../demo.js';
import { localDateStr } from '../shared/local-date.js';

const toRow = (r) => ({
  id: r.id,
  sleptOn: r.slept_on,
  bedAt: r.bed_at,
  wakeAt: r.wake_at,
  durationMin: r.duration_min,
  quality: r.quality,
  note: r.note,
  source: r.source,
});

export const SleepRepo = {
  /* UPSERT, not insert: the table enforces one row per night
   * (unique on user_id, slept_on). A plain insert would throw a duplicate-key
   * error the second time you correct a mistyped wake time — re-saving the same
   * night has to mean "fix it", not "fail". */
  async save({ sleptOn, bedAt, wakeAt, durationMin, quality, note }) {
    const c = await getClient();
    if (!c) throw new Error('Sleep needs cloud sync — enable Supabase in config.js.');
    const { data: { user } } = await c.auth.getUser();
    if (!user) throw new Error('Not signed in.');
    const { data, error } = await c.from('sleep').upsert({
      user_id: user.id,
      slept_on: sleptOn || localDateStr(),
      bed_at: bedAt || null,
      wake_at: wakeAt || null,
      duration_min: durationMin ?? null,
      quality: quality ?? null,
      note: note || null,
      source: 'manual',
    }, { onConflict: 'user_id,slept_on' }).select().single();
    if (error) throw error;
    return toRow(data);
  },

  async listRecent(limit = 7) {
    if (demoMode) return [];
    const c = await getClient();
    if (!c) return [];
    const { data, error } = await c.from('sleep')
      .select('*').order('slept_on', { ascending: false }).limit(limit);
    if (error) throw error;
    return (data || []).map(toRow);
  },
};
```

**Before writing this file, verify the import paths** by running `head -5 health/meals-repo.js` — if `getClient`/`demoMode` come from different paths there, use whatever that file uses and note the difference in your report.

- [ ] **Step 6: Add the tab and panel**

In `health/index.html`, add a third tab button next to the existing `tab-meal` / `tab-workout` buttons, matching their exact markup and classes:

```html
<button class="tab-btn" id="tab-sleep" data-tab="sleep">Sleep</button>
```

and a panel alongside the existing panels (match their wrapper element and class names exactly):

```html
<section class="tab-panel" id="panel-sleep">
  <h2>Sleep</h2>
  <label>Night of <input type="date" id="sleep-date" /></label>
  <label>Bed <input type="time" id="sleep-bed" /></label>
  <label>Woke <input type="time" id="sleep-wake" /></label>
  <label>Quality
    <select id="sleep-quality">
      <option value="">—</option>
      <option value="1">1 · terrible</option>
      <option value="2">2 · poor</option>
      <option value="3">3 · ok</option>
      <option value="4">4 · good</option>
      <option value="5">5 · great</option>
    </select>
  </label>
  <input type="text" id="sleep-note" placeholder="note (optional)" />
  <button type="button" id="sleep-save">Save</button>
  <p id="sleep-status"></p>
  <p id="sleep-avg" class="hint"></p>
  <ul id="sleep-list"></ul>
</section>
```

**Read the existing two panels first** and mirror their exact class names and nesting — do not invent a different structure.

- [ ] **Step 7: Wire it up**

In `health/health.js`, add the import and an `initSleepTab()` call next to the existing `initMealTab(); initWorkoutTab();`:

```js
import { SleepRepo } from './sleep-repo.js';
import { sleepDurationMin, formatDuration, averageDuration } from './sleep.js';
```

```js
initSleepTab();
```

and the function itself, following the style of `initMealTab`:

```js
function initSleepTab() {
  const dateEl = document.getElementById('sleep-date');
  if (!dateEl) return;
  dateEl.value = todayStr();
  document.getElementById('sleep-save').addEventListener('click', onSaveSleep);
  refreshSleep();
}

/* A time input gives 'HH:MM' with no date. Bed time before ~12:00 is treated
 * as the same morning; anything later is the previous evening — otherwise a
 * 23:00 bedtime and a 07:00 wake on the same date would compute as negative. */
function sleepTimestamps(sleptOn, bedTime, wakeTime) {
  if (!bedTime || !wakeTime) return { bedAt: null, wakeAt: null };
  const [bh] = bedTime.split(':').map(Number);
  const bedDate = new Date(`${sleptOn}T${bedTime}:00`);
  if (bh >= 12) bedDate.setDate(bedDate.getDate() - 1);
  const wakeDate = new Date(`${sleptOn}T${wakeTime}:00`);
  return { bedAt: bedDate.toISOString(), wakeAt: wakeDate.toISOString() };
}

async function onSaveSleep() {
  const status = document.getElementById('sleep-status');
  const sleptOn = document.getElementById('sleep-date').value || todayStr();
  const { bedAt, wakeAt } = sleepTimestamps(
    sleptOn,
    document.getElementById('sleep-bed').value,
    document.getElementById('sleep-wake').value,
  );
  try {
    await SleepRepo.save({
      sleptOn, bedAt, wakeAt,
      durationMin: sleepDurationMin(bedAt, wakeAt),
      quality: numOrNull(document.getElementById('sleep-quality').value),
      note: document.getElementById('sleep-note').value,
    });
    status.textContent = 'Saved.';
    refreshSleep();
  } catch (err) {
    status.textContent = `Could not save (${err.message}).`;
  }
}

async function refreshSleep() {
  const rows = await SleepRepo.listRecent(7);
  const avg = averageDuration(rows);
  document.getElementById('sleep-avg').textContent =
    avg == null ? '' : `7-night average: ${formatDuration(avg)}`;
  const list = document.getElementById('sleep-list');
  list.innerHTML = '';
  for (const r of rows) {
    const li = document.createElement('li');
    li.textContent = `${r.sleptOn} — ${formatDuration(r.durationMin)}${r.quality ? ` · ${r.quality}/5` : ''}`;
    list.appendChild(li);
  }
}
```

- [ ] **Step 8: Run the suite**

Run: `npm test`
Expected: all pass; count = Task 1's total + 8.

- [ ] **Step 9: Commit**

```bash
git add health/sleep.js health/sleep.test.js health/sleep-repo.js health/health.js health/index.html
git commit -m "feat(sleep): sleep tab with duration, quality and a 7-night average

Sleep had zero support at every layer. Duration is computed from the two
time inputs rather than typed, and a bed time at or after 12:00 is treated
as the previous evening so a 23:00->07:00 night does not compute negative."
```

---

### Task 6: Learning quick-log

The existing Log tab is an 8-field form plus a paste-JSON textarea, and the 113 live rows cluster on exactly three dates — that was a batch import, not a habit. This adds a one-field entry for the daily takeaway.

**Files:**
- Modify: `learning/index.html`
- Modify: `learning/learning.js`
- Modify: `learning/learning-repo.js`

**Interfaces:**
- Consumes: `localDateStr` (Task 1); `learning_sessions.minutes` (Task 4).
- Produces: `LearningRepo.quickAdd({ title, minutes })`.

**Also fix here (found by Task 1, same bug class, same file):** `learning/learning.js:5` still uses
`new Date().toISOString().slice(0, 10)`. Replace it with `localDateStr()` and add the import —
this task already edits that file, so leaving a known date bug in it would be dishonest. Do **not**
touch `feed/feed-repo.js:65` or `feed/feed-ui.js:5`, which Task 1 also found; those files are out
of scope for this plan and get their own task later.

- [ ] **Step 1: Add the repo method**

Read `learning/learning-repo.js` first (it has `add`/`list`/`remove`). Add, next to `add`:

```js
  /* One-field daily takeaway. The full form stays for detailed entries; this
   * exists so the daily habit costs one line of typing, not eight fields. */
  async quickAdd({ title, minutes }) {
    const c = await getClient();
    if (!c) throw new Error('Learning needs cloud sync — enable Supabase in config.js.');
    const { data: { user } } = await c.auth.getUser();
    if (!user) throw new Error('Not signed in.');
    const { data, error } = await c.from('learning_sessions').insert({
      user_id: user.id,
      learned_on: localDateStr(),
      title,
      minutes: minutes ?? null,
      source: 'manual',
      verdict: 'considering',
    }).select().single();
    if (error) throw error;
    return data;
  },
```

and add the import at the top if not already present:

```js
import { localDateStr } from '../shared/local-date.js';
```

**Verify first** that `learning_sessions` has a `source` column and that `'manual'` is an accepted value — run `grep -n "source" supabase/schema.sql | grep -i learning`. If `source` is constrained to a set that excludes `'manual'`, use the value the schema actually allows and note it in your report.

- [ ] **Step 2: Add the UI**

In `learning/index.html`, add above the existing detailed form (match the surrounding markup style):

```html
<div id="quick" class="quick-add">
  <label>What did you learn about AI today?
    <input type="text" id="quick-title" placeholder="one line — the takeaway, not the link" />
  </label>
  <label>Minutes <input type="number" id="quick-minutes" min="1" placeholder="optional" /></label>
  <button type="button" id="quick-save">Add</button>
  <p id="quick-status"></p>
</div>
```

- [ ] **Step 3: Wire it**

In `learning/learning.js`, add near the other initialisers:

```js
const quickBtn = document.getElementById('quick-save');
if (quickBtn) quickBtn.addEventListener('click', onQuickAdd);

async function onQuickAdd() {
  const status = document.getElementById('quick-status');
  const title = document.getElementById('quick-title').value.trim();
  if (!title) { status.textContent = 'Write one line first.'; return; }
  const raw = parseFloat(document.getElementById('quick-minutes').value);
  try {
    await LearningRepo.quickAdd({ title, minutes: Number.isFinite(raw) ? raw : null });
    document.getElementById('quick-title').value = '';
    document.getElementById('quick-minutes').value = '';
    status.textContent = 'Added.';
  } catch (err) {
    status.textContent = `Could not add (${err.message}).`;
  }
}
```

**Match the file's existing structure** — if `learning.js` wraps its setup in an init function rather than running at module top level, put these inside it.

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: all pass, count unchanged from Task 5 (no new pure logic).

- [ ] **Step 5: Commit**

```bash
git add learning/index.html learning/learning.js learning/learning-repo.js
git commit -m "feat(learning): one-field daily takeaway

The existing form is 8 fields plus a paste-JSON textarea, and the 113 live
rows cluster on three dates — a batch import, not a habit. The Desk already
captures what was consumed; this records what was concluded."
```

---

### Task 7: Home-screen shortcuts

The manifest is 12 lines with no `shortcuts`. Adding them puts "Log a meal", "Log sleep" and "Log learning" on the home-screen icon's long-press menu, removing the hub hop and the sign-in hop from the daily path. Pure static — works on GitHub Pages.

**Files:**
- Modify: `manifest.webmanifest`

**Interfaces:**
- Consumes: the `#meal` / `#sleep` / `#quick` anchors added in Tasks 5 and 6.
- Produces: nothing.

- [ ] **Step 1: Read the current manifest**

Run: `cat manifest.webmanifest`
Expected: a small JSON object with `name`, `start_url`, `icons`, etc. Note the exact icon `src` so the shortcut icons can reuse it.

- [ ] **Step 2: Add the shortcuts array**

Add a `shortcuts` key to the manifest object, reusing the existing icon `src` verbatim for each entry:

```json
  "shortcuts": [
    {
      "name": "Log a meal",
      "short_name": "Meal",
      "url": "./health/index.html#meal",
      "icons": [{ "src": "icon.svg", "sizes": "any" }]
    },
    {
      "name": "Log sleep",
      "short_name": "Sleep",
      "url": "./health/index.html#sleep",
      "icons": [{ "src": "icon.svg", "sizes": "any" }]
    },
    {
      "name": "Log learning",
      "short_name": "Learning",
      "url": "./learning/index.html#quick",
      "icons": [{ "src": "icon.svg", "sizes": "any" }]
    }
  ]
```

If the existing icon `src` is not `icon.svg`, use the actual value.

- [ ] **Step 3: Verify it is still valid JSON**

Run: `node -e "const m=require('./manifest.webmanifest'); if(!Array.isArray(m.shortcuts)||m.shortcuts.length!==3) throw new Error('shortcuts missing'); console.log('ok', m.shortcuts.map(s=>s.url).join(' '))"`
Expected: `ok ./health/index.html#meal ./health/index.html#sleep ./learning/index.html#quick`

- [ ] **Step 4: Make the anchors real**

Confirm the ids exist so the shortcut URLs land somewhere:

Run: `grep -n 'id="panel-sleep"' health/index.html && grep -n 'id="quick"' learning/index.html`
Expected: one hit each. The meal panel is the default tab, so `#meal` needs no anchor — **if `health/index.html` has no element with `id="meal"`, add `id="meal"` to the existing meal panel** so the fragment resolves.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: all pass, count unchanged.

- [ ] **Step 6: Commit**

```bash
git add manifest.webmanifest health/index.html
git commit -m "feat(pwa): home-screen shortcuts for the three daily logs

Removes the hub hop and the sign-in hop from the daily path. Pure static,
works on GitHub Pages."
```

---

## Done-check for this plan

- [ ] `npm test` — all pass, 0 fail, with 12 more tests than before this plan (4 from Task 1, 8 from Task 5)
- [ ] `grep -rn "toISOString().slice(0, 10)" health/ learning/` returns nothing
- [ ] `supabase/migrations/20260805140000_add_sleep_and_learning_minutes.sql` exists and contains 5 `create policy` statements
- [ ] `grep -n "sleep" supabase/migrations/20260805130000_require_aal2_when_mfa_enrolled.sql` returns one hit inside the table array
- [ ] `node -e "require('./manifest.webmanifest').shortcuts.length"` prints 3
- [ ] No file outside the ones listed per task was modified

## Out of scope (later plans)

- Applying the migration and redeploying the Edge Function — both are human steps, noted inline.
- Phase 2 (image downscale, optimistic save, IndexedDB outbox, repo update/delete, share_target).
- Phase 3 (the training module: exercise catalogue, wger media mirror, mesocycles, set logging).
- Phase 4 (Health Connect / Tasker watch ingest).
- Phase 5 (Desk→Shelf publish activation; finance/health real use).
- Phase 6 (career milestones, skill-gap matrix, the course view and the override notes).
