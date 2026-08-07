# Training module, phase 3b — schema + pure strength logic — 2026-08-07

## Why

Phase 3b of `docs/superpowers/specs/2026-08-06-training-module-design.md`: the four tables that let a
set be logged, plus the pure cursor/suggestion/progression logic. Deliberately narrow — no repo layer,
no UI, no browser work; those are separate follow-on tasks.

## What shipped

- `supabase/migrations/20260807100000_add_training.sql` — `mesocycles`, `sessions`,
  `session_exercises`, `sets`. Exercises are referenced by name (`session_exercises.exercise_name`),
  matching `health/data/exercises.json`; there is no FK because that catalogue is a JSON file, not a
  table. `mesocycles`/`sessions` carry `user_id` + the standard four `own_*` policies. `sets` gets a
  **partial** unique index `(source, source_key) where source_key is not null` — unlike `sleep`'s full
  index, many manual sets per exercise are the normal case here, not a duplicate. `session_exercises`
  and `sets` have no `user_id` of their own (per the given schema), so their `own_*` policies walk the
  FK chain back to the owning `sessions` row instead of comparing `user_id` directly. Each of the four
  tables also gets its own `aal2_when_mfa_enrolled` restrictive policy.
- `supabase/migrations/20260805130000_require_aal2_when_mfa_enrolled.sql` — appended `mesocycles`,
  `sessions`, `session_exercises`, `sets` to the table array. The existing `to_regclass` guard makes
  this safe to replay against a database that hasn't run the new migration yet.
- `supabase/schema.sql` — the same four tables, indexes, and policies mirrored verbatim so a fresh
  deployer following the README gets the full picture, not just the migrations-folder history.
- `training/strength.js` — pure, zero I/O: `resolveCursor`, `suggestSet`, `buildProgressionSeries`.
  `resolveCursor` recomputes position from `(sessionPlan, loggedSets)` on every call — no stored
  cursor, no module-level state — by finding the lowest unfilled set number of the first non-skipped,
  incomplete exercise in position order. `suggestSet` does double progression: cold start falls back to
  the target; otherwise prefills from the heaviest set in the given history, and bumps load by
  `LOAD_INCREMENT_KG` (2.5kg) once the last session hit the top of the target rep range at or below
  target RIR. `buildProgressionSeries` groups sets by session, takes the best-volume (weight × reps)
  set per session, sorts by date, and flags a point `plateaued` when it and the `PLATEAU_WINDOW - 1`
  points before it (window = 3) sit within `PLATEAU_TOLERANCE` (2%) of each other's volume.
- `training/strength.test.js` — 13 tests: `resolveCursor` (empty plan, mid-session, all logged →
  `session_complete`, skipped exercise, out-of-order logging), `suggestSet` (cold start, at target →
  prefill, above rep range → load increase, tie-break across a multi-set history), `buildProgressionSeries`
  (rising → no plateau, flat → plateau detected, insufficient data → no crash, best-set-per-session
  selection with a volume tie broken by weight).

## Verification

- `npm test`: **139 pass, 0 fail** (126 pre-existing + 13 new `strength.test.js`).
- `grep -n "mesocycles\|sessions\|session_exercises\|sets" .../20260805130000_....sql` shows all four
  table names in the array.
- `git status --short`: only the intended five files touched; `docs/career/` untracked files
  untouched, nothing staged with `git add -A`.

## Concern — plateau/progression thresholds are guesses

`LOAD_INCREMENT_KG` (2.5), `PLATEAU_WINDOW` (3 sessions), and `PLATEAU_TOLERANCE` (2%) are named
module constants in `training/strength.js` precisely because they are guesses, not measurements —
there is no real logged-set data yet. Expect to tune all three once there is.

## Not done (by design)

- Migration committed only, **not applied**.
- No repo layer (`strength-repo.js`), no UI, no browser work — separate task per scope.
