# Gym-logging screen — training I/O + UI

**Date:** 2026-08-07
**Scope:** `training/strength-repo.js`, `training/log.html`, `training/log-ui.js`, one hub card in `index.html`.
Did not touch `training/strength.js`, `training/strength.test.js`, or the migration.

## What was built

`training/strength-repo.js` implements the eight functions from the ticket, all calling into
`resolveCursor` / `suggestSet` / `buildProgressionSeries` from `strength.js` rather than
reimplementing them. Position is never stored — every function re-derives it from `session_exercises`
+ `sets` on each call.

One assumption made explicit: the ticket says `getCurrentSet()` "resolves the active session,
creating today's on first log." With no block-builder shipped yet (`createMesocycle` is phase 3c,
out of scope here), there is no source for a fresh day's plan. `getCurrentSet` handles this by
cloning the most recent *prior* session's `session_exercises` (name, position, target rep/RIR range)
forward into today's session the first time it's plan-less. If there's no prior session either, it's
a genuine cold start and the repo returns `{ empty: true }` — a state the screen renders as "No plan
for today yet," not a crash. `jumpToExercise` swaps `position` between the cursor's exercise and the
target rather than storing any override, so the reorder is a real, durable plan edit that
`resolveCursor` picks up on the next call, including from a second device.

Read-only calls (`getSessionPlan`, `getProgression`) degrade quietly to `[]` with no client/session,
matching `sleep-repo.js`'s `listRecent` convention. Everything else (`getCurrentSet`, `logSet`,
`undoLastSet`, `jumpToExercise`, `skipExercise`, `finishWorkout`) throws on missing client/auth/table,
matching `SleepRepo.save`'s convention — `log-ui.js` wraps every call in try/catch and writes a plain
message into `#log-status`, never a stack trace.

`training/log.html` + `log-ui.js` follow the design doc's §4b layout: exercise name → media (image or
instructions + outbound link, reusing `catalogue.js`'s `mediaFor`) → set counter + RIR → large
weight×reps inputs (pre-filled, directly editable) → "last time" line → full-width Log button → a
visually separated Skip/Undo row. Today's plan renders below as a tappable list wired to
`jumpToExercise`.

## Verify

- `npm test` → **139 pass / 0 fail** (no regression; no new tests added per the ticket's "optional,
  don't hit a real DB" guidance).
- `grep -cE "#[0-9a-fA-F]{3,6}\b" training/log.html training/log-ui.js training/strength-repo.js` →
  **0** for all three files.

## Browser smoke test

Served the repo root with `python3 -m http.server 4173`, drove it with chrome-devtools MCP.

- **Bug caught and fixed during the smoke test:** `#log-card[hidden]` wasn't hiding — the page's own
  `#log-card { display: flex }` outranks the UA `[hidden] { display: none }` rule on specificity (an
  id beats a bare attribute selector), so the card, empty state, and complete state could show
  simultaneously. Added explicit `#log-card[hidden], #log-empty[hidden], #log-complete[hidden] {
  display: none; }`. Re-tested — fixed.
- **Pre-migration / signed-out state** (the real state right now — Supabase is configured but nobody
  is signed in and the training tables don't exist yet): the screen shows one clear line, `Training
  log isn't available right now (Not signed in.)`, with `#log-card`/`#log-empty`/`#log-complete`
  correctly hidden and the plan list correctly empty (no blank page, no stack trace).
- Checked light mode + a 390×844 mobile viewport: warm-paper tokens render correctly, nothing is
  cut off, the degrade message stays legible.
- Confirmed the new hub card renders exactly once in `index.html`'s `#hub-grid`, matching neighbour
  markup:
  `<a class="hub-card" href="./training/log.html" data-module="training">💪 Log a set — Gym screen —
  weight, reps, next set</a>`.
- Could not exercise the signed-in / real-data path — no test account and the migration isn't
  applied — so `getCurrentSet`'s clone-forward, `logSet`, `undoLastSet`, `jumpToExercise`,
  `skipExercise`, and `finishWorkout` are unverified against a live database. That verification is
  the same "real device, after the migration ships" step the design doc's phase 3b done-check calls
  for.
- Killed the `python3 -m http.server 4173` process after the smoke test. Port 4173 now shows an
  unrelated pre-existing `bun run backoffice/server.js` process that was not started by this task and
  was left alone.

## Concerns / open items

1. **Clone-forward behavior is inferred, not specified.** It's the only way `getCurrentSet` can be
   useful before `createMesocycle` ships; flag if a different bootstrap (e.g. an explicit "start
   today's plan" action) is preferred instead.
2. **`jumpToExercise`'s position-swap is untested against a live database** — logically sound (reuses
   `resolveCursor` unchanged, just edits `position`), but only verified by inspection, not by running
   it.
3. Full end-to-end verification (log a real session, kill the tab mid-session, confirm it resumes on
   the right set) is blocked on the migration being applied and a signed-in account — flagged above,
   not silently skipped.
