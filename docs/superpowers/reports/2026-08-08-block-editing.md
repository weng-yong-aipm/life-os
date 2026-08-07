# Block editing (mid-mesocycle edits) — phase 3d

**Date:** 2026-08-08
**Scope:** `training/strength.js` (+ tests), `training/strength-repo.js`, `training/plan.html` +
`plan-ui.js`, `training/log.html` + `log-ui.js`. No migration.

## What was built

**`strength.js`:** one new pure function, `requiresSupersede(loggedSetCount)` — `true` when a
session_exercise has ≥1 logged set, `false` (including `undefined`/`null`) otherwise. 3 new tests.

**`strength-repo.js`:** the five requested methods —

- `swapExercise(sessionExerciseId, newExerciseName)` — this session only.
- `replaceExerciseInBlock(mesocycleId, oldName, newName, { fromDate })` — future sessions too,
  `fromDate` defaults to today.
- `updateTargets(sessionExerciseId, { targetSets, targetRepLow, targetRepHigh, targetRir })`.
- `addExerciseToSession(sessionId, exerciseName, targets)`.
- `removeExerciseFromSession(sessionExerciseId)`.

Plus one read-only supporting method the editor UI needs: `getUpcomingSessions(mesocycleId,
{ fromDate })` — sessions of a block from `fromDate` (default today) onward, each with its
exercises and how many sets are already logged against each. Degrades to `[]`, same convention as
`getSessionPlan`/`listMesocycles`.

**`plan.html` + `plan-ui.js`:** an "Edit block" button on the active-block card opens a new
`#plan-edit` section — one card per upcoming session (from today on), each exercise row editable
in place (targets + Save), with a swap control (text input + "this session only" / "rest of the
block" scope + Swap) and a Remove button, plus a per-session "+ Add exercise" row. Rows already
superseded/removed (`skippedReason` set) are left out — they're history, not something to keep
editing. A row with ≥1 logged set shows a 🔒 prefix and a tooltip explaining the swap/remove
consequence.

**`log.html` + `log-ui.js`:** a "Swap exercise" button next to the exercise name on the gym card
opens an inline panel (text input with an exercise datalist, Confirm/Cancel) that calls
`swapExercise` for the current exercise, this session only — no trip to the planner.

## The ruling: supersede, not refuse

**Chose supersede.** A session_exercise with ≥1 logged set is never mutated or deleted. Instead:

1. The original row is marked aside via the **existing** `skipped_reason` column —
   `resolveCursor` already treats any truthy `skipped_reason` as "skip this exercise", so this
   alone removes it from the cursor without touching a single `sets` row.
2. A fresh `session_exercises` row is inserted in its place: same `session_id`, same `position`,
   same targets, new `exercise_name`. The next `getCurrentSet()` call finds it exactly where the
   old exercise was — no change needed to `getCurrentSet`/`resolveCursor`/`logSet`.

A row with **zero** logged sets is free: `swapExercise`/`replaceExerciseInBlock` rename in place,
`removeExerciseFromSession` deletes outright. `updateTargets` is unconditional regardless of
logged-set count — it only ever touches `session_exercises` columns, never `sets`, so there is no
history to endanger either way (lowering `target_sets` below the logged count just makes
`resolveCursor` stop asking for more; the sets already logged are untouched).

**Why supersede over refuse:** refuse would mean the exact real-world case in the brief — "did 2
sets, machine got taken" — has no lever at all once a single set is logged, which just relocates
the original "no way to change it" bug one level down. Supersede keeps the UI's promise (swap
always works) while making the safety property structural rather than a runtime check someone
could route around: the row with real data is never the target of an UPDATE or DELETE, full stop.

**Why no migration:** `session_exercises.skipped_reason` (phase 3b schema) already does the job —
"hide this from the cursor, keep the row and its sets." Reusing it means zero new columns for the
common case. The one place it's slightly overloaded: `skipExercise`'s existing use
(`skipped_reason = 'skipped'` or a free-text injury note) and the new use
(`skipped_reason = 'superseded: swapped to <name>'` / `'superseded: removed'`) share one text
column with different semantics, distinguished only by string prefix. That is a real but minor
seam — a dedicated boolean/enum column would be cleaner — and not worth a migration to fix pre-
emptively; flagging it as the one place to revisit if a `skipped_reason` UI ever needs to
distinguish "genuinely skipped" from "superseded" beyond a string match.

## What happens to a session that is today and partly logged

`fromDate` defaults to today for every block-wide edit, and the default is **inclusive** — today's
session is in scope, not excluded. So a same-day edit on an exercise with sets already logged today
behaves exactly like the single-session case: the already-logged sets stay on the (now superseded)
original row, a fresh row is inserted at the same position with the remaining target sets, and the
next `getCurrentSet()`/`logSet()` call picks it up mid-workout with no special-casing. Yesterday's
session is never touched by a block-wide edit (its date is `< fromDate`); a same-day edit is
touched, by design — "changed my mind mid-session" and "changed the plan from today" are the same
action from the schema's point of view.

## Verify

- `npm test` → **149 pass / 0 fail** (146 prior + 3 new for `requiresSupersede`; no regressions).
- `grep -cE "#[0-9a-fA-F]{3,6}\b" training/plan-ui.js training/log-ui.js training/plan.html
  training/log.html` → **0** for all four.
- No migration file was written — the supersede approach needed none (see above).

## Browser smoke test

Served the repo root with `python3 -m http.server 4931` (not 4173 — flagged in the brief as
previously squatted for three days), drove it with the chrome-devtools MCP, killed the server
afterward (`lsof -ti:4931 | xargs kill`; confirmed the port is free).

- **`plan.html`, signed out:** loads clean, no error line, shows the builder (matches prior
  report's baseline — `getActiveMesocycle()` degrades to `null`). Built a full block (name, Monday
  "Push Day", added "Barbell Bench Press"), confirmed `seedTargets('hypertrophy')` prefilled
  3 sets / 6–12 reps / RIR 2 into the row. "Create block" → `Could not create block (Not signed
  in.).` in `#plan-status` — plain message, no stack trace.
- **Edit-block wiring (signed-out edge case):** with no active block, `#edit-block-btn` still
  exists in the DOM (inside the hidden `#plan-active` section). Clicked it directly via
  `evaluate_script` — `#plan-edit` un-hides, `renderEditor()` runs its `if (!active) return`
  guard and exits cleanly with no error and no console noise; "Close editor" re-hides the section.
  Confirms the editor doesn't throw when opened against no active block, even though that path is
  unreachable from the real UI (the button only renders inside `#plan-active`, which only shows
  when `active` is truthy).
- **`log.html`, signed out:** loads clean, `Training log isn't available right now (Not signed
  in.).`, `#log-card` (and everything inside it, including the new swap toggle/panel) correctly
  hidden. Confirmed `#log-exercise-list` datalist populated with all 873 catalogue exercises on
  init. Forced `#log-card` visible via `evaluate_script` to exercise the swap toggle in isolation:
  clicking "Swap exercise" un-hides the panel and focuses the input; typing a name then clicking
  "Cancel" re-hides the panel and clears the input — the wiring behaves as coded.
- Console: one pre-existing `favicon.ico` 404 and the pre-existing "form field element should have
  an id or name attribute" (count 7) accessibility lint on dynamically-created inputs — both
  present before this change, neither introduced by it. No new console errors on either page.
- **Not exercised:** the actual signed-in write paths (`swapExercise` inserting a superseded +
  fresh row pair, `replaceExerciseInBlock` walking a real block's sessions, `updateTargets`,
  `addExerciseToSession`, `removeExerciseFromSession`, `getUpcomingSessions` returning real rows)
  — no test account is available, same caveat every training-module report so far has flagged for
  its own unverified paths. Logically verified by inspection: each write path is a direct,
  small extension of the same Supabase-call shapes already proven out in `createMesocycle`/
  `endMesocycle`/`getSessionPlan` from phases 3b–3c.

## Concerns / open items

1. **`skipped_reason` now carries two different meanings** (genuinely skipped vs. superseded),
   distinguished by a string prefix rather than a column — see "Why no migration" above. Cheap to
   fix later with a real column if a UI ever needs to tell them apart; not worth it now.
2. **`replaceExerciseInBlock` is one row at a time** (fetch matching rows, then a
   free-or-supersede branch per row), not a single bulk UPDATE. A block has at most a few dozen
   sessions, so this trades a handful of extra round-trips for reusing the exact same
   free/supersede logic as `swapExercise` instead of duplicating it in bulk-SQL form.
3. Same open item phase 3c's report flagged and still open: no repo-level guard against two
   simultaneous active blocks. Unrelated to this task, not touched.
4. `getUpcomingSessions` is a new read-only surface the brief didn't name explicitly, added
   because the "edit active block" UI has no other way to see what's in the block to edit — kept
   minimal (read-only, degrades to `[]`, same shape conventions as `getSessionPlan`).
