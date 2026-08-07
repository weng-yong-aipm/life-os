# Training-block (mesocycle) planning — phase 3c

**Date:** 2026-08-07
**Scope:** `training/strength.js` (+ tests), `training/strength-repo.js`, `training/plan.html`,
`training/plan-ui.js`, one hub card in `index.html`. No migration changes — the phase 3b schema was
sufficient as-is. Did not touch `training/log.html`, `training/log-ui.js`, or `training/catalogue*.js`.

## What was built

**`strength.js`:** `seedTargets(goal)` — a pure lookup returning `{ sets, repLow, repHigh, rir }`,
same four fields for both goals, only the numbers differ (hypertrophy 3×6-12 @ RIR 2, fat-loss
2×6-12 @ RIR 2 — sets trimmed, rep range and RIR held). `sessionForDate(mesocycle, date)` — pure
calendar arithmetic over `{ startDate, weeks, sessions: [{ dayOfWeek, ... }] }`, returning the
matching session (plus computed `weekNo`) or `null` for before-start, after-`weeks`, and rest days.
7 new tests in `strength.test.js`, all passing.

**`strength-repo.js`:** `createMesocycle(plan)`, `listMesocycles()`, `getActiveMesocycle()`,
`endMesocycle(id)` — see "Session-generation strategy" below. `getCurrentSet()` and everything else
in the file is **untouched**.

**`training/plan.html` + `plan-ui.js`:** desk-side builder — name/goal/weeks/start-date, an "+ Add
session" button that appends a weekday + name row with its own "+ Add exercise" control (datalist
over the exercise catalogue, same as `log-ui.js`/`catalogue-ui.js`), each exercise row pre-filled
from `seedTargets(goal)` and directly editable. Shows the active block (name/goal/weeks/start) with
an "End block" button when one exists, hiding the builder; shows the builder otherwise. Hub card
added to `index.html`, copying the neighbouring `training/log.html` card's markup exactly (icon 📅,
not used elsewhere in the grid).

## Session-generation strategy: eager, not lazy

Chose **eager** — `createMesocycle` writes a real `sessions` row (with a computed calendar date) plus
`session_exercises` for every day, across every week, that `sessionForDate` matches to a planned
session. Rest days get nothing.

Why: `sessions.date` is `NOT NULL` in the phase 3b schema. A lazy design ("session template, no date
yet, materialize on the day") doesn't fit that column without inventing a second, parallel plan store
— and the ticket ruled out new schema. Eager needs no new table: the `sessions`/`session_exercises`
rows this writes over the whole block **are** the plan, not a copy of it.

The direct payoff: **`getCurrentSet()` required zero changes.** It already finds "today" by querying
`sessions` for today's date (`findTodaySession`, from 3b). Once a block exists, today's row is
already there with real target data from the moment `createMesocycle` ran, so the existing lookup
just finds it. Off-plan days (rest days, or no active block at all) still have no `sessions` row for
today, so `cloneForwardIfEmpty` — 3b's fallback — fires exactly as before, unmodified. This is
verified in the browser smoke test below (log.html's behavior is unchanged).

`endMesocycle` deletes only *still-`planned`, strictly-future* (`date > today`) sessions for that
block, then flips `status` to `'ended'`. Today's session and anything in the past are never touched,
`planned` or not — deleting them risks losing real logged sets. This means ending a block mid-day
still lets today's planned workout be logged.

## Verify

- `npm test` → **146 pass / 0 fail** (139 prior + 7 new for `seedTargets`/`sessionForDate`; no
  regressions).
- `grep -cE "#[0-9a-fA-F]{3,6}\b" training/plan.html training/plan-ui.js` → **0** for both.

## Browser smoke test

Served the repo root with `python3 -m http.server 4923` (not 4173 — that port was flagged as
previously squatted), drove it with the chrome-devtools MCP, killed the server afterward.

- **Signed-out state (the only state reachable — no test session available):** `plan.html` loads
  clean, no error line shown (Supabase client exists, `auth.getUser()` returns no user,
  `getActiveMesocycle()` degrades to `null` per convention), and shows the builder form. Filled in a
  full block — name, Monday "Push Day" session, added "Barbell Bench Press" from the catalogue
  datalist, confirmed `seedTargets('hypertrophy')` pre-filled sets=3/6/12/RIR=2 correctly into the
  row. Clicked "Create block": got `Could not create block (Not signed in.).` in `#plan-status` — a
  plain message, not a stack trace or blank page.
- Console showed one pre-existing unrelated `favicon.ico` 404 (present on every page in this repo,
  not introduced here) and an accessibility lint (`form field element should have an id or name
  attribute`, count 7) on the dynamically-created session/exercise inputs — same pattern as
  `finance.js`'s dynamically-created receipt-line inputs, which also carry no `id`/`name`. Not a
  functional issue, left as-is for consistency.
- Regression-checked `training/log.html`: unchanged behavior confirmed — `Training log isn't
  available right now (Not signed in.).`, no console errors.
- Confirmed the new "Plan a block" hub card renders in `index.html`'s `#hub-grid` (12 cards total,
  was 11), correctly positioned, correct icon/copy, links to `training/plan.html`.
- Could not exercise the signed-in / real-data path — no test account available — so
  `createMesocycle`'s actual writes (block + N sessions + session_exercises), `listMesocycles`,
  `getActiveMesocycle` returning real data, and `endMesocycle`'s delete-future-planned-sessions
  behavior are unverified against the live database. Logically verified by inspection (reuses
  `sessionForDate`/`resolveCursor` unchanged; `endMesocycle`'s date filter is a single `gt('date',
  localDateStr())` clause), same caveat 3b's report flagged for its own unverified paths.

## Concerns / open items

1. **No repo-level guard against two simultaneous active blocks.** `createMesocycle` doesn't check
   for an existing active one; `plan-ui.js` only *shows* the builder when `getActiveMesocycle()`
   returns null, so the UI naturally prevents it, but a second write path (a future API caller, a
   race) could create an overlapping block. Not enforced with a partial unique index since the
   ticket didn't ask for a migration change.
2. **Eager materialization means editing a block's plan mid-block has nowhere to go** — the same
   trade-off the phase-3 design doc flagged against the "minimal" interface design, just deferred
   rather than solved. Today, the only lever is `endMesocycle` (which nukes future planned sessions)
   + a fresh `createMesocycle`; a real "edit exercises for week 3 onward" flow is out of scope here.
3. Full end-to-end verification (create a block, confirm `getCurrentSet()` returns the right
   session on a plan day and clone-forward on a rest day, end the block, confirm future sessions
   vanish and past ones don't) is blocked on a signed-in test account — flagged, not silently
   skipped.
