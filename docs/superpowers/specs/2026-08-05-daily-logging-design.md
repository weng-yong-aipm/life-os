# life-os daily logging + training + watch ingest — design

**Date:** 2026-08-05
**Status:** Approved (design); implementation not started
**Research:** 8-agent workflow `wf_c4f075b9-72e` (5 domain investigations + 2 adversarial
feasibility reviews + synthesis) plus a separate exercise-media licensing investigation.

## Goal

Log, from the phone, every day: what I ate (with a photo), when I woke and how I slept, what I
trained and at what weight, and what I actually learned. Then use that to drive a training
program and a job-change plan.

## Decisions taken (owner, 2026-08-05)

| Question | Decision |
|---|---|
| Phone strategy | **PWA only** — add to home screen. No native app, no store. |
| Users | **One — the owner.** No multi-user, no sharing, no permission tiers. RLS stays as a mistake-guard, not as a collaboration feature. |
| Food logging depth | **Photo + AI-estimated calories/protein**, correct by hand when obviously wrong. |
| Learning entries | **Takeaways, not consumption.** The Desk already auto-captures 985 "what I watched" items; life-os records "what I concluded / how I'll use it". |
| Daily items | All four: meals, sleep, training, learning. |
| Build order | Thin daily-log first, then the training module deep. |
| Courses vs. the prior "Do Not Do" | **Both** — see §6. |
| Scope | Everything eventually; the phases below are sequence, not exclusion. |

---

## 1. The finding that shapes everything: the watch is reachable, but must not be load-bearing

An earlier verbal claim in this project — *"PWA means the Galaxy Watch is out"* — **was wrong and
is retracted here.** Watch data is reachable without writing an Android app, without Samsung
partner approval, and without the Play Store:

**Samsung Health → Android Health Connect → Tasker + TaskerHealthConnect plugin → HTTP POST →
Supabase.** Health Connect's data-type declaration is a *Play Console publishing* gate, not a
platform gate; nothing is published here. `SleepSessionRecord` yields start, end (= wake time),
timezone offset and Awake/Light/REM/Deep stages. `ExerciseSessionRecord` yields exercise type with
start/end. That is exactly what was asked for.

Two adversarial reviewers were tasked with refuting this. **Neither could** — both verified it
against first-party documentation. But they materially corrected the optimistic version, and this
design follows the reviewers:

| Correction | Consequence accepted |
|---|---|
| Health Connect exposes only the **30 days before permission was first granted**, unless `READ_HEALTH_DATA_HISTORY` is *granted* (not merely declared). Uninstalling the reader resets the clock. | Grant history + background permissions **on day one, before any code exists**, or there is no backfill. This is why Phase 0 has a zero-code Health Connect step. |
| The Samsung→Health Connect bridge **breaks periodically.** The Samsung Health 7.0 redesign (mid-2026) broke exercise writes outright — Activity/Exercise vanished while sleep kept syncing. Second such regression on record. | Workout data can silently vanish for weeks. **The manual workout form stays permanently load-bearing**, not a decorative fallback. |
| **Android developer verification** starts 2026-09-30. Sideloading an unverified-developer APK will need ADB or Google's advanced flow; the hobbyist tier caps at 20 devices and depends on the *plugin maintainer* opting in. | Tasker is a **convenience layer with a 12–18 month erosion horizon**, not the durable path. The durable path is Health Connect's scheduled export to Drive + a local parser. Keep a copy of the pinned APK. |
| Health Connect has **no change notifications** — every path is a poll. Samsung warns sync "can be delayed, depending on processor availability." | Last night's sleep is not readable at 06:00. Poll mid-morning, read the last ~36h, upsert idempotently. |
| Only **exercise-tracker** data syncs, not activity-tracker data. Samsung's proprietary sleep score / HRV / SpO2 are unconfirmed via Health Connect. | "How long I exercised" means logged sessions, not passive auto-detected movement. Assume no sleep score. |

**Design consequence: the watch is Phase 4.** Phases 0–3 deliver a working daily log with zero
device integration. If the wearable path erodes in 2027, nothing used daily stops working.

**Unverified prerequisite:** the phone must be Android. Galaxy Watch 4+ runs Wear OS 3+, which
cannot pair with an iPhone at all — so this is almost certainly already true. Confirm before
spending an hour. If it is an iPhone, every automatic path dies, and so does Web Share Target
(iOS Safari does not implement it).

**Explicitly rejected:** Google Fit in any form (developer signups closed 2024-05-01, end-of-service
late 2026 — any tutorial routing Samsung Health → Google Fit → REST is stale); commercial
aggregators (Terra, Rook, Junction/Vital, Thryve — still need an SDK on the phone *and* a
subscription for one user); the Samsung Health Data SDK, on effort and fragility grounds —
revisitable only if sleep score turns out to matter.

---

## 2. Very little here is new. Most of it is already written and mis-wired.

This is the load-bearing finding across all five research domains.

**Meal photo logging is ~85% built and one line from working.**
`health/index.html:29` already has `<input type="file" accept="image/*" capture="environment">`.
`health/meals-repo.js:16-32` uploads to a private bucket and invokes the `estimate-meal` Edge
Function. That function is complete — CORS, ownership check, service-role download, Claude vision,
strict-JSON parse. `meals.image_path` exists (`schema.sql:142-151`); the bucket has four correct
folder-scoped RLS policies.

**The defect (verified live):** `health/health.js:68` destructures only
`const { extracted } = await MealsRepo.estimatePhoto(file)` and **throws `storagePath` away**;
`onSaveMeal` hardcodes `source: 'manual'` and never passes `imagePath` — even though
`MealsRepo.save` accepts it. Every photo lands orphaned in Storage, every row gets
`image_path: null`, and a repo-wide grep for `createSignedUrl`/`getPublicUrl` returns **zero
hits**, so no photo can be displayed even once linked.

**Workout logging is complete for manual entry** — form, save path, a 9-line MET calorie formula
with 4 tests, and `health/data/exercises.json` (~800 entries with MET values). It has no
provenance or dedup column, and no timestamp finer than `done_at date`.

**The "scheduled local Node script writes to Supabase" pattern is established** — `tools/` already
holds six such scripts with `scripts/*.sh` LaunchAgent wrappers. A watch importer slots in with
zero new architecture.

**Career + learning: the data and the connector exist; the wiring is dead.** `career/goals.js`
holds `NINETY_DAY_TRACK` — 13 dated weekly rows, written, tested, **and never clicked** (zero
W1–W13 rows in the DB). `learning/goal-link.js` is unit-tested but returns empty **every time**,
because all 113 live `learning_sessions` rows have `verdict='considering'` and `project=NULL`,
and `linkAppliedToGoals` filters on `verdict==='applied'` first. `learning-repo.js` has no
`update()` at all, so nothing can promote a verdict.

**Desk→Shelf publish is fully built and has never fired.** Writer script, HTTP route, KB
checkbox, target table, unique index, Shelf-side reader — all present. All 985 `knowledge_items`
are `verdict='considering'` with `publish=0`, and the query requires `applied AND publish=1`. The
blocker is the **triage step**, not the plumbing.

---

## 3. Pre-flight blockers — verified live, 2026-08-05

| # | Check | Result |
|---|---|---|
| 1 | **AAL2/MFA RLS gate.** Migration `20260805130000` adds a RESTRICTIVE `for all` policy over a table list including `meals`, `workouts`, `learning_sessions`. If a verified TOTP factor exists and the session is aal1, every insert and select fails, surfacing only as `Could not save (…)`. | ✅ **Not currently blocking** — the project has **0 verified factors**, so `requires_aal2()` returns false. ⚠️ **The moment MFA is enrolled, the phone/cron ingest path breaks** unless it can reach aal2. Design §5 accordingly. Note `storage.objects` policies are *not* in that loop — a phone at aal1 could upload a photo and then fail to save the row, producing exactly the orphan case above. |
| 2 | **UTC date bug.** | ❌ **Confirmed at 3 sites:** `health/health.js:6`, `health/health.js:162`, `health/workouts-repo.js:15` — all `new Date().toISOString().slice(0,10)`. In MYT (UTC+8) anything logged **before 08:00 local files under yesterday**. That is precisely the breakfast and wake-time window this project is about. Zero production rows is why nobody noticed. |
| 3 | **`max_tokens: 512`** on the vision call. | ❌ **Confirmed** at `supabase/functions/estimate-meal/index.ts:83`, with no `thinking` field. Sonnet 5 runs adaptive thinking by default, and `max_tokens` caps thinking + output *together* — the JSON can truncate, `JSON.parse` throws, the function 502s, and the UI silently degrades to manual entry. Photo estimation could be broken forever without a visible error. |
| 4 | Is `estimate-meal` deployed with an `ANTHROPIC_API_KEY` secret? | ⬜ Not verifiable from the repo. Check before Phase 1. |
| 5 | Is the phone Android? | ⬜ Unconfirmed. Almost certainly yes (the watch requires it). |
| 6 | Does the SVG-only icon make the PWA installable on Android Chrome? | ⬜ Unverified. If not, there is no home-screen icon and no shortcuts. Test on the real device first. |

---

## 4. The training module (the "make it actually good" request)

Requested: pick an exercise **and see a demo image**; record **current working weight and reps**
per exercise and push it up over time "until I can't progress further"; and run a **muscle-building
block** vs a **fat-loss block**.

### 4a. Exercise media — the licensing trap, and the one clean way through

The obvious dataset is a trap. `yuhonas/free-exercise-db` (800+ exercises, 1.7k stars) declares
the Unlicense — **but that covers the dataset, not the photographs.** The maintainer states
verbatim in issue #2:

> "I actually have no idea where the images are from or if they are royalty free so usage would be
> at your own risk"

A declaration cannot launder third-party copyright the declarer never held. life-os is a **public
repo serving a public site**, so committing those images is real (if low-probability) legal
exposure. `ExerciseDB` has the nicest media (real animated GIFs) but its licence explicitly
forbids republishing raw files as a downloadable database — a public repo *is* that. Both are out.

**The workable combination:**
- **Text data** from `free-exercise-db`'s JSON — the Unlicense genuinely does cover this, and it is
  better structured than the alternatives: `name, force, level, mechanic, equipment,
  primaryMuscles[], secondaryMuscles[], instructions[], category`.
- **Images** from **wger** (`wger-project/wger`), filtered by its per-image `license` field to
  CC0 / CC-BY-4 / CC-BY-SA-3, mirrored **once into Supabase Storage** — not committed to git, so
  the public repo stays lean and images can be swapped without a redeploy. Store `license`,
  `license_author` and `source_url` per image and render an attribution line + a credits page.
  Do **not** hotlink wger.de (their bandwidth, and their bot-detection will break hotlinks).
- **The gap:** wger has ~360 images for 834 exercises. For the rest, show text instructions plus
  an outbound "watch demo" link — **linking is not redistribution and carries no licence burden**.

### 4b. Program modelling — minimal, and no schema difference between bulk and cut

The established shape is mesocycle → week → session → exercise slot → set:

```
mesocycles         id, name, goal ('hypertrophy'|'fatloss'), weeks, start_date, notes
sessions           id, mesocycle_id, week_no, day_no, name, date, status
session_exercises  id, session_id, exercise_id, order, target_sets,
                   target_rep_low, target_rep_high, target_rir
sets               id, session_exercise_id, set_no, weight_kg, reps, rir, completed_at
```

Hypertrophy vs fat-loss needs **no schema difference** — only a different `goal` value and
different seeded rep/RIR targets (hypertrophy 6–12 @ RIR 1–3 with weekly load progression; cutting
holds load and trims volume).

**"Keep progressing until I can't" needs no extra field either.** Progressive overload is a
*query* over `sets` (best weight×reps per exercise over time), not a stored column. When the curve
flattens, the data says so on its own.

Resist a `program_templates` table until a block is actually reused twice.

---

## 5. Courses — the override, recorded honestly

The owner asked which courses would close the gap fastest. **Three independent sources record the
opposite decision, made two days earlier:**

- Live `career_goals` notes: *"DEPRIORITIZED — … it is not progress and must not be counted as
  such"* (Anthropic AI Fluency); *"DROPPED — RAG is not the FDE hiring axis"* (NVIDIA DLI);
  *"DROPPED — a months-long trap that substitutes a credential for the one Dockerfile that closes
  the gap"* (AWS).
- The 90-day plan, "Do Not Do": *"AWS/cloud certifications, Coursera credential paths… Nothing in
  the research reverses this."*
- `capability-roadmap.md:122`, "Deliberately NOT on this schedule": *"Any certification, any
  course."*

**Owner's decision, 2026-08-05: 都要有 — build both.**

This is an explicit override, not an oversight, and it is implemented as one:

1. **The skill-gap engine is the default view.** The 8 named ❌/⬜ gaps in `capability-roadmap.md`
   move into `career_goals` as `skill` rows (done-when → `note`, block deadline → `target_date`,
   no schema change). This is the answer the owner's own documents give.
2. **A course view exists alongside it**, and renders **the prior reasoning next to each course
   entry** — a course row that was previously DROPPED shows its DROPPED note. The override is
   visible, not silent.
3. **The three stale DROPPED notes and the "Do Not Do" lines get updated** to record that the
   decision was revisited on 2026-08-05, so the documents stop contradicting the running app.

**Two traps to avoid while doing this:** `FDE_STARTER` (`career/goals.js:8-23`) still seeds PMP,
Scrum/PSM, NVIDIA and "AI Essentials" — re-seeding it re-injects killed goals, and
`career/goals.test.js:66` actively asserts `/PMP/` is present. `MILESTONE_TRACK` still ends at
"$20k USD/mo", a target the 2026-08-05 calibration retired in favour of "take any Singapore offer
at SGD 12k+". Any milestone UI built on those two sets will display abandoned targets.

---

## 6. Publishing safety — the real risk is not what it looked like

**Correction to an earlier verbal claim in this project:** "publish" does **not** mean "post to the
internet." The life-os *code* is public; `learning_sessions` is guarded by owner-only RLS plus the
restrictive AAL2 policy, and the anon key grants nothing without a session. Publishing moves data
from local SQLite into the owner's own cloud Postgres. *Low confidence caveat:* this was read from
migration **files**, not queried live — **confirm in the Supabase dashboard that no anon-select
policy or public view exists on `learning_sessions` before the first publish.**

Four real leak surfaces remain, each with its safeguard:

1. **The applied-verdict gate is client-side only.** `knowledge-handler.js:143-150` accepts
   `publish` in a patch with **no verdict check**; the only block is a `disabled` attribute in the
   DOM. Any local script or agent can arm `publish:true` on a private note, and that flag then
   fires **automatically** when the verdict is later flipped — with no second confirmation. All 51
   Desk routes are unauthenticated, safe only because the server binds loopback.
   → **Move the gate server-side. This is the highest-consequence fix in the proposal.**
2. **"Publish N" drains the entire pending set, not the ticked rows.** `publishPending()` runs its
   SQL unfiltered while the count reflects only checkboxes in the DOM under a server-side filter.
   The button can read "Publish 3" and publish every qualifying row.
   → **Make the button dry-run first**, render the exact JSON payload, require a `confirm()`. The
   server and CLI already support `--dry`; the button posts a literal `"{}"`.
3. **There is no content-level redaction — only field selection.** `title` and `summary` cross
   verbatim.
   → Keep the six-field discipline and its canary tests as insurance; the primary control is RLS.
4. **The public *repo* is the genuinely world-readable surface.** Target companies, comp figures,
   employer-internal counts and plan text stay in `~/second-brain` and must never be copied here.
   → **Extend the banned-names assertion at `career/goals.test.js:82-88`; never bypass it.**

**One integrity defect, not a leak:** the "no two-way sync" invariant is already violated —
`tools/import-obsidian.mjs:64-70` and `tools/lifeos-bridge.mjs:161` both PATCH `title`+`summary`
back into `learning_sessions`, so a reverse Obsidian sync can overwrite a published row. And
`feed/feed-repo.js:56-77` inserts into the same table carrying `link: item.url` unredacted — the
six-field discipline is a property of one code path, not of the table.

---

## 7. Phases

**Ordering principle: logging from the phone by the end of week 1.** Nothing in Phases 0–2 depends
on the watch, on Samsung, or on any approval.

### Phase 0 — Unblock and start the clock (½ day, mostly not code)
1. Confirm `estimate-meal` is deployed with `ANTHROPIC_API_KEY` set.
2. Confirm the phone is Android; install the PWA and confirm the SVG icon is accepted.
3. **Zero-code, do it today:** in Health Connect grant `READ_HEALTH_DATA_HISTORY` and
   `READ_HEALTH_DATA_IN_BACKGROUND`, and enable the scheduled daily export to Drive (Android 14+;
   cannot export to local storage by design). This starts the 30-day window **now** and
   accumulates the backfill Phase 4 will parse. The **first export is known to come out empty** —
   verify the second has data.
4. Fix the local-date bug: one shared `localDateStr()` helper replacing all three sites.
5. Raise `max_tokens` to ~2000 in `estimate-meal/index.ts:83` and/or pass `thinking:{type:'disabled'}`.

**Done-check:** `npm test` green. A meal logged at 07:30 MYT appears under **today**. A Health
Connect export exists in Drive with ≥1 sleep record.

### Phase 1 — The daily log (week 1) — *the deliverable that matters*
1. **Stop discarding the photo.** Keep `storagePath`, pass `imagePath` + `source:'photo'` into
   `MealsRepo.save`. Add `createSignedUrl` and an `<img>` thumbnail to the day list.
2. **New `public.sleep` table + third tab** — `(user_id, slept_on, bed_at, wake_at, duration_min,
   quality, note, source, source_key, synced_at, created_at)` + indexes + RLS + the four `own_*`
   policies **+ an entry in the aal2 table array in migration `20260805130000`** — a new table
   added without touching that array silently escapes the 2FA gate every other table has. Module
   trio: `sleep-repo.js`, pure `sleep.js`, `sleep.test.js`.
3. **Learning quick-log** — one field, "what did I learn about AI today", writing `learned_on` +
   `title` + `summary`, `source='manual'`. (The 113 existing rows cluster on three dates — that was
   a batch import, not a habit. Also add `minutes numeric`, since the plan budgets in hours.)
4. **`shortcuts` in `manifest.webmanifest`** → `./health/index.html#meal`, `#sleep`,
   `./learning/index.html#quick`. Pure static; removes the hub hop and the sign-in hop.
5. Fix `parseFloat(x) || null` coercing a legitimate `0` to NULL (`health.js:87-90`, `143-145`).

**Done-check:** seven consecutive days with ≥1 meal row where `image_path is not null` **and a
rendered thumbnail**, ≥1 sleep row, ≥1 learning row — all entered **from the phone**. If the streak
does not happen, stop and fix the friction before building anything else.

### Phase 2 — Survive a bad commute (week 2)
1. Downscale to ~1280px JPEG on file-pick via `createImageBitmap`/canvas (4 MB → ~200 KB). No
   downscale code exists in the repo today.
2. Optimistic save: insert the row immediately with `image_path` set and macros NULL; let the
   estimate PATCH it. Takes the Claude round trip off the critical path.
3. IndexedDB outbox for pending `{blob, fields}`, flushed on `online`. `capture_queue` is a
   *server*-side queue — reaching it already needs network.
4. Add `update`/`delete` to `MealsRepo` and `WorkoutsRepo` — RLS already grants both, but with no
   repo method a typo can currently only be fixed in the Supabase dashboard.
5. Add `capture/` assets to the service-worker precache list.

**Done-check:** airplane mode → log a meal with a photo → re-enable network; the row and image both
land with no user action. A mis-logged meal can be deleted from the UI.

*Deferred:* `share_target`. The GET form is 5 lines and `capture-ui.js:45-50` already consumes
`?url=`; the POST/multipart photo share needs `service-worker.js:62` to stop bailing on non-GET and
is Android-only. Neither is on the daily-log path.

### Phase 3 — Training module (weeks 2–4) — *the "make it good" request*
1. One-time media pipeline: fetch wger's exercise images, filter to CC0/CC-BY/CC-BY-SA, mirror into
   Supabase Storage with `license` / `license_author` / `source_url` per image.
2. Import `free-exercise-db` JSON **text only** as the exercise catalogue.
3. `mesocycles` / `sessions` / `session_exercises` / `sets` per §4b, all four in the aal2 array.
4. Exercise picker: filter by muscle group, show demo image + instructions, or text + outbound link
   where no free image exists. Attribution line + credits page.
5. Set logger: weight × reps × RIR per set. Per-exercise history chart from a query over `sets`.
6. Seed one hypertrophy block and one fat-loss block — same schema, different targets.

**Done-check:** a full session logged from the phone; the per-exercise history shows the last 3
sessions and flags a new best; every rendered image carries correct attribution.

### Phase 4 — Watch ingest (weeks 4–6)
1. **Schema first** (even if the rest slips): `started_at`/`ended_at timestamptz`, `source`,
   `source_key`, `synced_at` on `workouts`, plus
   `unique index … on workouts (user_id, source, source_key) where source_key is not null` —
   migration `20260729064944` already prototyped this pattern. Add `avg_hr`, `max_hr`, `distance_m`,
   `steps`, and keep device-reported calories distinguishable from the MET estimate currently
   written to the same column.
2. **Parse the Drive export** into `tools/import-health.mjs`, LaunchAgent-wrapped like
   `feed-daily.sh`. ⚠️ **Low confidence:** the Health Connect export SQLite schema is internal and
   undocumented, and the Samsung CSV column names came from third-party blogs, not Samsung docs.
   **Do a throwaway export and inspect it before writing one line of parser.**
3. **Ingest endpoint:** a restricted-role PostgREST insert (avoids adding a deploy step to a
   no-build-step repo) or a token-authenticated Edge Function. **Never paste a service_role key
   into Tasker.** Design this against the AAL2 interaction in §3.
4. **Only then** wire Tasker + TaskerHealthConnect. Pin the plugin version. Verify history +
   background are actually **granted**, not merely declared. Keep a local copy of the APK.
5. Poll mid-morning, read the last ~36h, upsert. **Never delete a manual row on import.**

**Done-check:** run the importer twice against the same export — identical row counts the second
time. One real night's sleep appears with the correct wake time in MYT. A >30-day-old record reads
successfully (proves `READ_HEALTH_DATA_HISTORY` is granted). Manual entry still works with the
importer disabled.

### Phase 5 — Turn on the two dormant systems (weeks 4–6, parallel)
**5a. Desk→Shelf publish.** Nothing to build; in order: move the verdict gate server-side; add
`verdict:'applied'` as a seventh field in `publicRow()` (without it every published item renders as
"· considering" and is invisible to the Shelf's `applied` filter); make the button dry-run +
`confirm()`; confirm no anon-select policy exists; then triage **one** innocuous item and publish it.
**Done-check:** exactly one row crosses, labelled `applied`; canary tests still pass.

**5b. Finance + health in real use.** Both are code-complete with zero production rows — meaning
every bug in them is undiscovered, exactly like the UTC bug was. The point of this phase is to
*find* them.
**Done-check:** one week of real expenses (≥5 receipts with parsed line-items) and one `work_hours`
week.

### Phase 6 — Career milestones + skill gaps + the course view (weeks 5–7)
1. **Click the seed button.** `NINETY_DAY_TRACK` is written, tested, unclicked; W1 is 2026-08-10.
   `onSeed()` dedupes by exact title, so it is idempotent. Do **not** re-seed `FDE_STARTER` or
   `MILESTONE_TRACK` — see §5.
2. Smallest date-aware view: sort by `target_date`, badge the current week and overdue rows. No
   schema change — `target_date` exists but is NULL on all 23 live rows and renders as inert text.
3. Move the 8-gap capability matrix into `career_goals` as `skill` rows.
4. **The course view** per §5 — alongside the gap engine, with prior DROPPED reasoning rendered
   next to each entry; update the three stale notes and the "Do Not Do" lines to record the override.
5. Repair the Learning→Goals link at the source: add `LearningRepo.update()` and a verdict + goal
   picker, so `linkAppliedToGoals` can ever return non-empty.
6. Add a progress editor — `GoalsRepo.update` already accepts `progress`/`targetDate`/`note` but
   only the status `<select>` is wired.

**Done-check:** 13 W1–W13 rows exist; the app shows the current week and flags overdue.
`linkAppliedToGoals` returns ≥1 non-empty group against real data. No employer name, comp figure or
plan text appears anywhere in the life-os repo — banned-names assertion extended and passing.

---

## 8. Known unknowns, stated rather than papered over

- Whether `estimate-meal` was ever deployed with its API key. Unverifiable from the repo.
- Whether the phone is Android (almost certainly yes; unconfirmed).
- Whether the SVG-only icon makes the PWA installable on Android Chrome.
- **HEIC:** `meals-repo.js:23` passes `file.type` straight through; Claude vision accepts
  jpeg/png/gif/webp only. iOS Safari usually transcodes on upload; untested with zero real uploads.
- The Health Connect export SQLite schema (internal, no stability guarantee) and the Samsung CSV
  export column names (third-party sources only).
- Live Supabase RLS state was read from migration **files**, not queried from the dashboard.
- The exact size of wger's licence-filtered image subset (360 image records counted, aggregate size
  not measured), and whether every wger image carries usable attribution metadata (3 sampled; the
  first had a blank `license_author` — budget for a manual attribution fallback).
- All phone timings are reasoned, **not measured** — no agent ran the app on a device.
