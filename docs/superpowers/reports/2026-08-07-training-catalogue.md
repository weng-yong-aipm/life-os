# Training module, phase 3a — exercise catalogue & picker — 2026-08-07

## Why

Phase 3a of `docs/superpowers/specs/2026-08-06-training-module-design.md`: enrich the existing
873-exercise `health/data/exercises.json` with text (instructions/equipment/force/mechanic) and
licence-clean demo images, then build the picker UI. No set logging, no blocks — those are 3b/3c.

## What shipped

- `tools/import-exercise-catalogue.mjs` — fetches `yuhonas/free-exercise-db`'s JSON (Unlicense
  text, never its images), matches to the local 873 by name (normalised case/punctuation), merges
  `instructions`/`equipment`/`force`/`mechanic` while preserving every existing field including
  `met`. `--dry` reports match counts without writing.
- `tools/mirror-exercise-images.mjs` — fetches wger's `/license/`, `/exercise-translation/`
  (client-side filtered to English — the API's `language` query param is silently ignored) and
  `/exerciseimage/`, filters to CC0/CC-BY-4/CC-BY-SA-3, matches to the local catalogue by exact
  normalised name (no fuzzy matching — a wrong attribution is worse than a missing image), and
  would upload one image per matched exercise to a public bucket + record
  `{exercise, path, license, licenseAuthor, sourceUrl, wgerImageId}` in
  `health/data/exercise-media.json`. Idempotent via `wgerImageId`. `--dry` and `--limit` both work.
- `supabase/schema.sql` + `supabase/migrations/20260807010000_add_exercise_media_bucket.sql` —
  new **public** `exercise-media` bucket (unlike `receipts`/`meals`), read policy only; no new
  `public.*` table, so no aal2-array entry needed (same precedent as the receipts/meals buckets).
- `training/catalogue.js` + `training/catalogue.test.js` — pure, zero I/O: `muscleList`,
  `byMuscle`, `search`, `mediaFor` (incl. the no-media case). 10 new tests.
- `training/index.html` + `training/catalogue-ui.js` — the picker: search, muscle-group filter,
  detail view. No-image state (~currently all of them, since enrichment/mirroring is a real run
  the owner triggers) renders instructions + a "Watch a demo" YouTube-search outbound link as a
  designed panel, not a broken-image box. Has-image state renders the image + a credit line
  (`author · licence`) linking back to the wger source page. Hub card added to `index.html`
  (exact existing markup) and a `training` entry added to `shell.js`'s sidebar (every other module
  page has one; this one otherwise wouldn't highlight when active).
- `training/credits.html` + `training/credits-ui.js` — licence summary + per-image attribution list.
- `health/data/exercise-media.json` — seeded `[]` (real content added by the real mirror run).

## Verification

- `npm test`: **126 pass, 0 fail** (116 pre-existing + 10 new `catalogue.test.js`).
- `grep -cE "#[0-9a-fA-F]{3,6}\b" training/*.html training/*.js` → 0 across all 6 files.
- `health/data/exercises.json`: still 873 entries, all retain `met`, no enrichment fields leaked
  (dry-run only, as instructed).
- Smoke-tested both pages in a real browser (Chrome DevTools MCP) over a local static server:
  873 exercises list, muscle dropdown populated, search/filter/click-to-detail all work, no-image
  panel renders correctly, and — with a temporary fake media record (reverted after) — the
  has-image code path (image + credit line) also renders correctly. Zero console errors other than
  the pre-existing benign `favicon.ico` 404 every module page already has.

## Dry-run counts (real fetches, no writes/uploads)

- **Enrichment** (`import-exercise-catalogue.mjs --dry`): 873/873 matched, 0 unmatched either
  direction — the local catalogue already *is* free-exercise-db's names verbatim.
- **Mirror** (`mirror-exercise-images.mjs --dry`): 88 wger images pass the licence filter (out of
  360 total, all licences); of those, only **5** unique exercises match the local catalogue by
  exact normalised name → **5 exercises would get an image, 868 would still have none**.

## Concern — image coverage is far below the spec's estimate

The design doc's "roughly 360 images cover 834 exercises, so expect well under half" reads 360 as
the *licence-filtered* count. Live: 360 is wger's **total** image count across *all* licences —
only 88 pass CC0/CC-BY-4/CC-BY-SA-3. Worse, wger's own exercise names (community-curated, German
project) diverge stylistically from free-exercise-db's ("Bench Press" vs. local "Barbell Bench
Press", "Biceps Curls With Barbell" vs. "Barbell Curl") — exact matching only recovers 5 of 88. I
deliberately did not add fuzzy matching: mismatched attribution on a CC-licensed image is a real
compliance risk, silently guessing isn't. Real coverage will land near 5/873 (~0.6%), not "well
under half." The owner should decide whether that's acceptable as shipped, or whether a manual
name-mapping table (wger id → local exercise) is worth building before the real mirror run.

## Not done (by design)

- Neither script's real run happened — both executed `--dry` only. `health/data/exercises.json`
  and `health/data/exercise-media.json` are unchanged from their pre-task state (`[]`).
- Migration committed only, **not applied**.
- Set logging, training blocks, progression — phases 3b/3c/3d, out of scope here.
