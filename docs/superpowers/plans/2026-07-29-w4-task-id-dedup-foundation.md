# W4 — Task-ID / Dedup Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every life-os record table a `source` + `source_key` so any external import (Obsidian, 抖音, NotebookLM, …) is idempotent by construction — nothing is ever imported or advised twice.

**Architecture:** One additive Supabase migration adds `source`/`source_key`/`synced_at` columns plus a partial unique index `(user_id, source, source_key) where source_key is not null` to each record table. A tiny pure helper (`source.js`) stamps the fields; existing repo inserts call it so every row explicitly carries a source. No behavior changes — manual rows get `source='manual', source_key=null` (nulls don't collide). The first *consumer* of the upsert-by-source-key (the 抖音 importer) is deliberately deferred to W5; this plan only lays the foundation and proves it with unit tests + a regression check.

**Tech Stack:** vanilla ES modules, Node built-in test runner (`node --test`), Supabase Postgres, migrations applied via the Supabase Management API (Docker is not available on this Mac).

## Global Constraints

- No build step, no framework, no new npm dependencies. Pure ES modules only. (verbatim: repo is "vanilla ES-module JavaScript, no build step".)
- Pure logic lives in a dependency-free `.js` file with a sibling `.test.js`; only pure logic is unit-tested — cloud/RLS flows are verified live, not mocked.
- DB columns are `snake_case`; JS is `camelCase`.
- Rows are rendered/created XSS-safe elsewhere; not relevant to this plan (no UI).
- Migrations are **additive and idempotent** (`add column if not exists`, `create unique index if not exists`).
- Do **not** modify `feed/feed-repo.js` (belongs to a separate merged module) — `feed_items` gets the column via the migration's DB default only.
- Skip `pay_settings` (singleton config, one row/user) and `receipt_items` (child rows deduped via their parent receipt).
- Secrets: never commit `.env`. The migration-apply step reads an access token from the environment; it is never written to a file or committed.

---

### Task 1: `source.js` pure helper + unit tests

**Files:**
- Create: `source.js`
- Test: `source.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SOURCES: string[]` — allowed source names.
  - `withSource(record: object, source = 'manual', sourceKey = null): object` — returns a **new** object = `record` plus `source` and `source_key`; throws `Error` if `source` not in `SOURCES`. Does not mutate `record`.

- [ ] **Step 1: Write the failing test**

Create `source.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withSource, SOURCES } from './source.js';

test('withSource defaults to manual + null key', () => {
  assert.deepEqual(withSource({ a: 1 }), { a: 1, source: 'manual', source_key: null });
});

test('withSource stamps an explicit source and key', () => {
  assert.deepEqual(
    withSource({ a: 1 }, 'douyin', '7663324074667494656'),
    { a: 1, source: 'douyin', source_key: '7663324074667494656' },
  );
});

test('withSource rejects an unknown source', () => {
  assert.throws(() => withSource({ a: 1 }, 'bogus'), /unknown source/);
});

test('withSource does not mutate its input', () => {
  const input = { a: 1 };
  withSource(input, 'obsidian', 'x');
  assert.deepEqual(input, { a: 1 });
});

test('SOURCES contains the connectors the blueprint names', () => {
  for (const s of ['manual', 'obsidian', 'douyin', 'notebooklm', 'lark', 'gdrive']) {
    assert.ok(SOURCES.includes(s), `missing ${s}`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test source.test.js`
Expected: FAIL — `Cannot find module './source.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `source.js`:

```js
/* Pure source-stamping helper for the dedup foundation (W4).
 * Every persisted row carries (source, source_key); an external import upserts
 * on (user_id, source, source_key) so re-imports are idempotent. */

export const SOURCES = ['manual', 'obsidian', 'douyin', 'notebooklm', 'lark', 'gdrive'];

export function withSource(record, source = 'manual', sourceKey = null) {
  if (!SOURCES.includes(source)) throw new Error(`unknown source: ${source}`);
  return { ...record, source, source_key: sourceKey };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test source.test.js`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add source.js source.test.js
git commit -m "feat(w4): add source.js dedup-stamping helper + tests"
```

---

### Task 2: Migration — add source columns + partial unique index

**Files:**
- Create: `supabase/migrations/<TS>_add_source_dedup.sql` (where `<TS>` = output of `date -u +%Y%m%d%H%M%S`)

**Interfaces:**
- Consumes: nothing.
- Produces: on `receipts, work_hours, expenses, meals, workouts, learning_sessions, career_goals, feed_items` — columns `source text not null default 'manual'`, `source_key text`, `synced_at timestamptz`, and unique index `<table>_src_uk (user_id, source, source_key) where source_key is not null`.

- [ ] **Step 1: Create the migration file**

```bash
TS=$(date -u +%Y%m%d%H%M%S)
printf '%s\n' "created supabase/migrations/${TS}_add_source_dedup.sql"
```

Write to `supabase/migrations/<TS>_add_source_dedup.sql`:

```sql
-- W4: task-id / dedup foundation.
-- Additive + idempotent. Adds (source, source_key, synced_at) + a partial unique
-- index so external imports upsert on (user_id, source, source_key).
do $$
declare t text;
begin
  foreach t in array array[
    'receipts','work_hours','expenses','meals',
    'workouts','learning_sessions','career_goals','feed_items'
  ]
  loop
    execute format('alter table public.%I add column if not exists source text not null default ''manual''', t);
    execute format('alter table public.%I add column if not exists source_key text', t);
    execute format('alter table public.%I add column if not exists synced_at timestamptz', t);
    execute format(
      'create unique index if not exists %I on public.%I (user_id, source, source_key) where source_key is not null',
      t || '_src_uk', t
    );
  end loop;
end $$;
```

- [ ] **Step 2: Apply the migration to the live project**

Project ref: `cfbfiazzvbedsdgwpujs`. Docker is unavailable, so apply via the Management API (this is the method proven to work in this project). Requires a Supabase **personal access token** in `$SUPABASE_ACCESS_TOKEN` (the human running the plan provides it; never write it to a file).

Run (uses `curl`, **not** python-requests, which Cloudflare 403s):

```bash
SQL=$(cat supabase/migrations/*_add_source_dedup.sql | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
curl -s -X POST \
  "https://api.supabase.com/v1/projects/cfbfiazzvbedsdgwpujs/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"query\": $SQL}"
```

Expected: `[]` (success, no rows returned) and HTTP 2xx.
**Human fallback if no token:** paste the migration SQL into the Supabase SQL Editor for project `cfbfiazzvbedsdgwpujs` and run it.

- [ ] **Step 3: Record the migration as applied (no re-run of DDL)**

```bash
TS=$(ls supabase/migrations/*_add_source_dedup.sql | sed -E 's:.*/([0-9]+)_.*:\1:')
supabase migration repair --status applied "$TS"
supabase migration list
```

Expected: `migration list` shows the new timestamp present in both Local and Remote columns.

- [ ] **Step 4: Verify the column exists live**

```bash
ANON=$(grep -E '^SUPABASE_ANON_KEY=' .env | cut -d= -f2- | tr -d '"'"'"' \r')
URL=$(grep -E '^SUPABASE_URL=' .env | cut -d= -f2- | tr -d '"'"'"' \r')
curl -s -o /dev/null -w "%{http_code}\n" \
  "$URL/rest/v1/learning_sessions?select=id,source,source_key&limit=1" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
```

Expected: `200` (selecting the new columns succeeds; a missing column would return `400` with `PGRST` "column does not exist").

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/*_add_source_dedup.sql
git commit -m "feat(w4): migration — source/source_key/synced_at + dedup unique index"
```

---

### Task 3: Wire `withSource` into existing record-repo inserts

Makes every existing insert carry `source='manual'` explicitly (via the DB default it already would, but this establishes the seam W5 upserts build on). Mechanical, no behavior change.

**Files (modify the `.insert(...)` payload only):**
- Modify: `finance/receipts-repo.js:40`
- Modify: `finance/work-hours-repo.js:49`
- Modify: `finance/expenses-repo.js:21`
- Modify: `health/meals-repo.js:38`
- Modify: `health/workouts-repo.js:23`
- Modify: `learning/learning-repo.js:47` (array insert)
- Modify: `career/goals-repo.js:44` (array insert)

**Interfaces:**
- Consumes: `withSource` from `source.js` (Task 1).
- Produces: no new exports; existing repo method signatures unchanged.

- [ ] **Step 1: Add the import + wrap each single-object insert**

In each of the five single-object repos, add at the top (adjust the `../` depth — all these files are one directory below root, so `../source.js`):

```js
import { withSource } from '../source.js';
```

Then wrap the object passed to `.insert(...)`. Examples (apply the same pattern to each):

`finance/expenses-repo.js` — change:
```js
.insert({ user_id: user.id, spent_at: spentAt, amount, category: category || 'other', note: note || null })
```
to:
```js
.insert(withSource({ user_id: user.id, spent_at: spentAt, amount, category: category || 'other', note: note || null }))
```

`finance/receipts-repo.js` — change:
```js
.insert({ user_id: user.id, image_path: storagePath, merchant, purchased_at: purchasedAt })
```
to:
```js
.insert(withSource({ user_id: user.id, image_path: storagePath, merchant, purchased_at: purchasedAt }))
```

`finance/work-hours-repo.js` — change:
```js
.insert({ ...toRow(data), user_id: user.id })
```
to:
```js
.insert(withSource({ ...toRow(data), user_id: user.id }))
```

For `health/meals-repo.js:38` and `health/workouts-repo.js:23`, wrap the object literal passed to `.insert({ ... })` the same way: `.insert(withSource({ ... }))`.

- [ ] **Step 2: Wrap the two array inserts with `.map`**

`learning/learning-repo.js` — change:
```js
const { data, error } = await c.from('learning_sessions').insert(rows).select();
```
to:
```js
const { data, error } = await c.from('learning_sessions').insert(rows.map((r) => withSource(r))).select();
```
(and add `import { withSource } from '../source.js';` at the top).

`career/goals-repo.js` — change:
```js
.insert(list.map((g) => toInsert(user.id, g)))
```
to:
```js
.insert(list.map((g) => withSource(toInsert(user.id, g))))
```
(and add the import).

- [ ] **Step 3: Confirm unit tests still pass (no regression in pure logic)**

Run: `node --test`
Expected: PASS — all existing suites plus `source.test.js` (Task 1) green.

- [ ] **Step 4: Live regression — one insert still works and stamps source**

With the debug Chrome/CDP on 9333 (or the deployed app) signed in, add one expense in the Finance module, then verify it persisted with `source='manual'`:

```bash
ANON=$(grep -E '^SUPABASE_ANON_KEY=' .env | cut -d= -f2- | tr -d '"'"'"' \r')
URL=$(grep -E '^SUPABASE_URL=' .env | cut -d= -f2- | tr -d '"'"'"' \r')
curl -s "$URL/rest/v1/expenses?select=id,source,source_key&order=id.desc&limit=1" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
```
Expected: the newest row shows `"source":"manual","source_key":null` (RLS returns `[]` for the anon probe — if so, verify instead in the app's Expenses list that the add succeeded; the point is the insert did not error).

- [ ] **Step 5: Commit**

```bash
git add finance/receipts-repo.js finance/work-hours-repo.js finance/expenses-repo.js \
        health/meals-repo.js health/workouts-repo.js learning/learning-repo.js career/goals-repo.js
git commit -m "feat(w4): stamp source on all record-repo inserts via withSource"
```

---

## Self-Review

**1. Spec coverage** (against blueprint §4):
- `source`/`source_key`/`synced_at` columns → Task 2 ✅
- `UNIQUE(user_id, source, source_key)` idempotent upsert base → Task 2 (partial index) ✅
- `withSource()` helper in the data layer → Task 1 (placed in `source.js`, a pure file, not `db.js`, because `db.js` imports the Supabase client from a CDN URL and can't be unit-tested) ✅
- Repos stamp source → Task 3 ✅
- Existing manual rows backfill = `source='manual'`, `source_key=null` → achieved via the column **default** on existing rows (no data backfill statement needed; `not null default 'manual'` fills existing rows automatically) ✅
- The upsert *consumer* (抖音 import) → intentionally **out of scope**, deferred to W5 (noted in Architecture).

**2. Placeholder scan:** none — every code/command step is complete. `<TS>` is a shell-generated timestamp with the exact `date` command shown.

**3. Type consistency:** `withSource(record, source, sourceKey)` signature is identical in Task 1 (definition), Task 3 (all call sites), and the Interfaces blocks. Columns `source`/`source_key` match between the migration (Task 2) and the helper output (Task 1).
