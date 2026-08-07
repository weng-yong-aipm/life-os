# Demo-mode fixture drift fix — 2026-08-07

## Why

`README.md:12` links `?demo=1` as the public showcase. Several `demo.js`
fixtures used field names that didn't match what the consuming module reads,
so the demo Health tabs rendered broken values — this is the first thing a
stranger sees.

## Confirmed drift, fixed

- **Workouts**: `demo.js` used `doneOn`/`kind`/`minutes`/`calories`;
  `health/health.js`'s week render reads `w.doneAt`/`w.exercise`/`w.caloriesBurned`
  (per `workouts-repo.js`'s `toRow`). Renamed fixture fields to match.
- **Meals**: `demo.js` used `protein` only; `health/nutrition.js`'s
  `dailyTotals` sums `proteinG`/`carbsG`/`fatG` (per `meals-repo.js`'s `toRow`).
  Renamed `protein` → `proteinG`, added `carbsG`/`fatG` (previously absent
  entirely, so demo macros showed `C 0g · F 0g`).
- **Expenses** (found during the sweep, same class of bug, not in the
  original confirmed list): `demo.js` used `spentOn`; `finance/expenses-repo.js`'s
  `toRow` and `monthlySummary` read `spentAt`. `ExpensesRepo.list()` returns
  demo fixtures raw (no `toRow` pass), so `monthlySummary`'s
  `r.spentAt.slice(0,7)` was always `undefined` in demo mode — the demo
  Expenses tab's monthly total/by-category list was silently always empty.
  Renamed `spentOn` → `spentAt`.
- **Sleep**: `health/sleep-repo.js`'s `listRecent` returned `[]` unconditionally
  in demo mode — no fixture existed. Added `fixtures.sleep` (5 nights, mirrors
  `sleep-repo.js`'s `toRow` shape exactly: `sleptOn`, `bedAt`, `wakeAt`,
  `durationMin`, `quality`, `note`, `source`) and wired `listRecent` to return
  `fixtures.sleep.slice(0, limit)` in demo mode, matching `meals-repo.js`'s
  `if (demoMode) return fixtures....` pattern.

## Checked, no drift found

- `learning` (`learning-repo.js`), `goals`/career (`goals-repo.js`) — fixture
  field names already match what `list()` returns/consumes.
- `feed`, `improve` (`feed-repo.js`, `improve-repo.js`) — neither imports
  `demo.js`/`fixtures` at all; not wired into demo mode. Out of scope (adding
  demo support to a module that has none is a feature, not a fixture-drift
  fix).
- `workHours` fixture in `demo.js` — dead: `finance/work-hours-repo.js`
  chooses between `CloudRepo`/`LocalRepo` via `cloudEnabled` and never reads
  `demo.js` at all. Left untouched (same reasoning as feed/improve — no
  consumer to be "in drift" against, and wiring it up would be scope
  expansion).

## Verification

- `npm test` → `node --test "*/*.test.js"`: 116 pass, 0 fail (no change in
  count — none of these are exercised by the existing test tree).
- Served the repo locally (`python3 -m http.server`) and loaded
  `/health/index.html?demo=1` in a real browser:
  - Meal tab: `1150 kcal · P 67g · C 139g · F 28g (57% of target, 850 left)` —
    no `undefined`, non-zero macros.
  - Workout tab: `3 workouts this week · ~750 kcal burned`, rows read
    `2026-08-06: run (~310 kcal)` etc. — no `undefined: undefined`.
  - Sleep tab: `7-night average: 7h 31m`, 5 rows with duration + quality —
    previously blank.
  - No console errors on any of the three tabs.

## Files changed

- `demo.js` — workout/meal/expense field renames, new `fixtures.sleep`.
- `health/sleep-repo.js` — `listRecent` returns demo fixtures instead of `[]`.
