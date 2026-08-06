# Training module (Phase 3) — design

**Date:** 2026-08-06
**Status:** Approved (design); implementation not started
**Inputs:** three independently-constrained interface designs (minimal-surface / maximum-flexibility /
optimise-the-common-case) plus a licensing investigation into exercise media.
**Decision:** full version — interface shape from the common-case design, full four-table schema.
The owner explicitly chose this over the one-column lazy alternative recorded in §8.

## Goal

Pick an exercise and see how it is performed. Log working sets — weight × reps — fast enough to do
between sets. Run a muscle-building block or a fat-loss block. See progression per exercise, and see
it when it flattens.

## 1. Interface

The shape comes from the common-case design because it is the only one of the three that answers the
moment that actually decides whether this gets used: standing in a gym, one hand on the phone, 60–90
seconds of rest, having just finished a set. The other two designs answer "how do I model training"
— a question with no user in it.

```js
// strength-repo.js — I/O. What the UI imports.

/** The only call the gym screen makes on mount. No arguments: it resolves the
 *  active block, today's session (creating it on first touch), which exercise
 *  is next and which set number, and pre-fills weight/reps from last time or
 *  the block target. */
getCurrentSet(): Promise<SetSuggestion>

/** Commits it. No arguments = accept the suggestion verbatim. This is the
 *  one-tap path and it must stay one tap. */
logSet(overrides?: { weightKg?, reps?, rir? }): Promise<{ logged, next: SetSuggestion | 'session_complete' }>

undoLastSet(): Promise<void>                       // LIFO, fat-finger recovery
skipExercise(reason?): Promise<SetSuggestion | 'session_complete'>
jumpToExercise(sessionExerciseId): Promise<SetSuggestion>   // did them out of order
getSessionPlan(): Promise<{ sessionExerciseId, exerciseName, targetSets, setsLogged }[]>
finishWorkout(): Promise<void>

// second-class — desk-side, verbosity is fine here
findExercises({ q?, muscleGroup?, equipment? }): Promise<ExerciseSummary[]>
getExercise(id): Promise<ExerciseDetail>           // image | null, instructions, outboundUrl
createMesocycle(plan): Promise<Mesocycle>
getProgression(exerciseId, { since? }): Promise<ProgressionPoint[]>
```

```js
// strength.js — pure, zero I/O, the only part with unit tests.
resolveCursor(sessionPlan, loggedSets) -> { sessionExerciseId, setNumber } | 'session_complete'
suggestSet(target, exerciseHistory)   -> { weightKg, reps, rir, source }
buildProgressionSeries(sets)          -> ProgressionPoint[]   // includes plateau detection
```

**The one load-bearing design decision:** `resolveCursor` **recomputes** position from
(plan, sets-already-logged) on every call. There is no stored cursor. A refresh, a crash, a phone
locking mid-set, or logging from a second device all land on the correct next set, because position
is derived rather than remembered. A stored pointer would desync exactly when it matters most.

**Rejected from the flexibility design, using its own admissions:** `substitutedForExerciseId`
("dead weight until something reads it"), `supersetGroup` as a loose string tag ("pushes grouping
logic into every renderer — I did not build that renderer, so I don't know if a string is enough"),
and the open-bag `SetMetrics` with every field optional ("no DB-level guarantee a working set has
any particular field"). Each is real complexity bought for a use case nobody has asked for. They can
be added later; none is cheaper to add now than to add when needed.

**Rejected from the minimal design:** collapsing everything into three methods. Its own trade-off
section names the fatal case — editing an in-progress block (swap an exercise, adjust a rep range)
has nowhere to go, so `planBlock` either replaces the whole spec or grows invisible upsert-merge
semantics. Blocks get edited mid-block in real life; a rack is occupied, an elbow hurts.

## 2. Schema

```
mesocycles         id, user_id, name, goal ('hypertrophy'|'fatloss'), weeks,
                   start_date, status, notes, created_at
sessions           id, user_id, mesocycle_id (NULL = off-plan), week_no, day_no,
                   name, date, status, created_at
session_exercises  id, session_id, exercise_id, position, target_sets,
                   target_rep_low, target_rep_high, target_rir, skipped_reason
sets               id, session_exercise_id, set_no, weight_kg, reps, rir,
                   completed_at, source ('manual'|'watch'), source_key
```

Hypertrophy and fat-loss need **no schema difference** — same tables, different `goal` and different
seeded rep/RIR targets (hypertrophy 6–12 @ RIR 1–3 with weekly load progression; cutting holds load
and trims volume). Anyone proposing separate tables for the two is modelling the label, not the data.

Progressive overload is **a query over `sets`**, not a stored column — best weight×reps per exercise
over time. "Until I can't progress further" is that curve going flat, which is a property of the
data, not a field to maintain.

Every table carries `user_id` + the four `own_*` RLS policies **and an entry in the aal2 array** in
`20260805130000_require_aal2_when_mfa_enrolled.sql`. A table added without that array entry silently
escapes the 2FA gate every other table has.

`sets.source` + `source_key` + a partial unique index on `(source, source_key) where source_key is
not null` exist from day one so a later watch importer is idempotent without a second migration —
and, unlike the `sleep` table, a partial index is correct **here**, because multiple manual sets per
exercise are the normal case, not a duplicate.

## 3. Exercise media — the licensing trap

The obvious dataset is unusable. `yuhonas/free-exercise-db` (800+ exercises, 1.7k stars) declares the
Unlicense, but that covers the dataset, not the photographs; the maintainer states in issue #2:

> "I actually have no idea where the images are from or if they are royalty free so usage would be at
> your own risk"

A declaration cannot launder copyright the declarer never held, and life-os is a **public repo serving
a public site**. `ExerciseDB` has real animated GIFs but its licence forbids republishing raw files as
a downloadable database — which a public repo is. Both out.

**What ships:**
- **Text** from `free-exercise-db` JSON — the Unlicense genuinely covers this: `name, force, level,
  mechanic, equipment, primaryMuscles[], secondaryMuscles[], instructions[], category`.
- **Images** from **wger**, filtered by its per-image `license` field to CC0 / CC-BY-4 / CC-BY-SA-3,
  mirrored **once into Supabase Storage** with `license`, `license_author`, `source_url` stored per
  image. Attribution line under each image plus a credits page. Never hotlink wger.de.
- **The ~60% with no free image** show instructions plus an outbound "watch demo" link. **Linking is
  not redistribution and carries no licence burden.** `getExercise` returns `image: null` and the UI
  branches on that — the caller never learns which case it got.

Note the repo already has `health/data/exercises.json` (~800 entries with `name`, `category`,
`primaryMuscles`, `met`) driving the existing workout picker. The new catalogue supersedes it for the
training module; the MET values stay in use for the calorie estimate on cardio.

## 4. What already exists and is reused

- `public.workouts` + its form (`health/index.html:68-83`, `health/health.js:128-156`) — **kept, not
  replaced.** It stays the path for cardio and for one-off "I did some curls" logging that is not part
  of a block. The training module does not swallow it.
- `health/calories-burned.js` — the 9-line MET formula with 4 tests, used unchanged.
- `health/data/exercises.json` — MET lookup.
- The `<name>.js` pure / `<name>-repo.js` I/O split, and `npm test` → `node --test "*/*.test.js"`.

## 4b. The gym screen — visual design

The interface design above decides what is *possible* in one tap. This section decides whether it is
*actually* one tap. They are different problems and skipping the second is how the existing modules
ended up technically complete and unused.

**Design constraints that come from the room, not from taste:**

- **One thumb, one hand.** The other hand is holding a barbell, a phone case, or a towel. Every
  control needed between sets sits in the bottom half of the screen. Nothing that matters lives in a
  top-right corner.
- **Glanceable at arm's length, sweaty, possibly without glasses.** The three numbers that matter —
  exercise, weight, reps — are display-scale, not body-scale. The set counter ("3 / 4") is the second
  thing the eye lands on.
- **Gym lighting is either blown-out bright or dim.** Rely on the existing light/dark tokens rather
  than a fixed palette; `color-scheme: light dark` already works.
- **Tap targets ≥ 44px.** The confirm button is the largest element on the screen and cannot be
  adjacent to `undoLastSet` — misfiring "undo" when you meant "log" is the one error that costs real
  data.

**Layout, top to bottom:**

```
  Barbell Curl                     ← exercise name, --display scale
  demo image (or text + link)      ← 40% have one; the fallback must not look broken
  ──────────────────────────
  Set 3 / 4        · RIR 2         ← where you are in the plan
  20 kg  ×  10                     ← pre-filled, tappable to edit, largest numbers on screen
  last time: 20 kg × 9             ← the comparison that drives progression, in --muted
  ──────────────────────────
  [        Log set        ]        ← full-width, thumb zone, --accent
  [ Skip ]            [ Undo ]     ← smaller, separated, deliberately far from Log
```

**Token compliance is a hard requirement, not a preference.** Every colour, radius, shadow and font
comes from `ui.css` via `var(--…)`. No hex literals in the training module's CSS.

This is not pedantry — it was just measured. `plan/plan.css`, written today, uses **11 hardcoded
colours and zero `var()`**: cold blue `#2563eb` and generic greys `#777/#666/#999` in a codebase
whose palette is warm paper-and-ink with a honey accent (`--accent: #c97a16`). Worse, it hardcodes
its own dark-mode greys, so those values **do not participate in theme switching** and the module
will read wrong in dark mode. The training module must not repeat this. The mapping for anyone
tempted: text → `--ink` / `--muted`, borders → `--line` / `--line-strong`, highlight → `--accent` /
`--accent-wash`, panels → `--surface` / `--surface-2`, good/over → `--good` / `--over`.

**The image fallback must be designed, not defaulted.** Around 60% of exercises have no free image.
A broken-image icon or a grey box reads as "the app is broken". The no-image state is a deliberate
composition: the exercise's own instruction text at readable size plus a single "watch a demo" link —
visually complete on its own, not a hole where a picture should be.

**Rest timer: deliberately omitted.** Every training app has one; it also means the screen must stay
awake and the app must run a timer while the phone is in a pocket. The phone's own timer already
does this. Add one only if the lack is felt in real use.

## 5. Phases

**3a. Catalogue.** Import the text data; mirror the licence-filtered wger images into Storage with
attribution; build `findExercises` / `getExercise` and the picker UI with image-or-link fallback.
*Done-check:* every rendered image shows correct attribution; an exercise with no image renders text
plus a working outbound link; the credits page lists every licence in use.

**3b. Log a set.** The four tables, `resolveCursor` / `suggestSet` with unit tests, then
`getCurrentSet` / `logSet` / `undoLastSet` and the gym screen.
*Done-check:* a full session logged from the phone with no typing beyond corrections; killing the tab
mid-session and reopening lands on the correct next set.

**3c. Blocks.** `createMesocycle`, one seeded hypertrophy block and one fat-loss block, `getSessionPlan`,
`skipExercise` / `jumpToExercise`.
*Done-check:* a week runs off the plan; skipping and reordering both recover without corrupting the
cursor.

**3d. Progression.** `buildProgressionSeries` + plateau detection, per-exercise history view.
*Done-check:* an exercise with 3+ sessions shows a curve and flags a new best; a deliberately flat
series is detected as plateaued.

## 6. Testing

Only the pure module is tested: `resolveCursor` (empty plan, mid-session, all sets logged, skipped
exercise, out-of-order), `suggestSet` (cold start with no history, at target, above rep range → load
increase), `buildProgressionSeries` (rising / flat / insufficient data). No test touches the network
or a database. UI and repo behaviour is verified on a real device against the done-checks above.

## 7. Known unknowns

- The exact size of wger's licence-filtered image subset — 360 image records counted, aggregate bytes
  not measured.
- Whether every wger image carries usable attribution metadata; 3 sampled, the first had a blank
  `license_author`. Budget for a manual attribution fallback.
- Plateau detection thresholds (window length, slope cutoff) are guesses until there is real data;
  expect to tune them.
- Watch-imported sessions arrive after the fact with no live session to attach to. Reconciling them
  against whatever session was active at that timestamp is deliberately left to the importer design,
  not solved here.

## 8. The rejected alternative, recorded

A one-column version was proposed and declined: `alter table workouts add column block text`, with
progression as a query over the existing `workouts` rows and images added to the existing picker —
zero new tables, since `workouts` already stores exercise/sets/reps/weight and a picker already
exists. It genuinely covers "record what I can lift and watch it go up".

What it cannot do, which is why it was declined: **per-set logging.** One `workouts` row is an
aggregate (3 sets × 10 reps @ 60kg); it cannot express set 1 at 10 reps, set 2 at 8, set 3 at 6 —
which is what actually happens, and what drop-sets and RIR tracking require. The full version is
being built because per-set truth is the point, not because four tables are better than one.
