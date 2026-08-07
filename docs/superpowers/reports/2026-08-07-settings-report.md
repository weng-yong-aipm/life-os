# Settings page — 2026-08-07

## Why

`health/index.html` hardcoded `meal-target` (2000) and `body-weight` (70) as HTML
`value` attributes, reset on every page load. `body-weight` feeds directly into
`estimateBurn`'s MET formula (`health/calories-burned.js`), so every
calories-burned figure was silently computed at a fixed 70kg unless the owner
retyped his real weight before every single workout entry.

## What shipped

- `supabase/migrations/20260807000000_add_user_settings.sql` — new
  `user_settings` table (single-row-per-user, same shape as `pay_settings`):
  `daily_kcal_target`, `daily_protein_target_g`, `body_weight_kg`,
  `sleep_target_min`, `hidden_modules text[]`. RLS + four `own_*` policies +
  its own `aal2_when_mfa_enrolled` restrictive policy.
- `supabase/migrations/20260805130000_require_aal2_when_mfa_enrolled.sql` —
  appended `'user_settings'` to the aal2-gate table array.
- `settings/settings.js` — pure: `DEFAULTS`, `HIDEABLE_MODULES`,
  `mergeSettings(row)`, `isHidden(settings, moduleId)`. Zero I/O.
- `settings/settings.test.js` — null row → defaults; partial row → only
  provided fields override; null/undefined `hidden_modules` → `[]`;
  `isHidden` true/false/missing-field.
- `settings/settings-repo.js` — `get()`/`save()`, same import path
  (`../db.js`) and `upsert({ user_id, ...toRow(settings) })` shape as
  `pay-settings-repo.js`. `get()` returns `DEFAULTS` when `getClient()` is
  null (demo mode) or no user, matching how `meals-repo.js`/`goals-repo.js`
  handle it — `save()` throws like sibling write methods.
- `settings/settings-ui.js` — DOM wiring for the form (kept separate so
  `settings.js` stays the zero-I/O tested layer).
- `settings/index.html` — targets form + hide-modules checkboxes. Styled
  only with `var(--…)` tokens, no hex literals.
- `health/health.js` — `initMealTab`/`initWorkoutTab` now load
  `SettingsRepo.get()` and populate `#meal-target`/`#body-weight` from it.
  Existing `|| 70` / `|| 0` last-resort fallbacks left untouched.
- `index.html` — added a 9th hub card for Settings; tagged the other 8 with
  `data-module="…"` (Settings itself carries none, so it can never be
  hidden).
- `app.js` — `applyModuleVisibility()` hides any `.hub-card[data-module]`
  whose id is in the signed-in user's `hidden_modules`, called after each
  branch that unhides the hub (demo, local-mode, signed-in).

## Verification

- `npm test`: 116 pass, 0 fail (111 pre-existing + 5 new `settings.test.js`).
- `grep -c "var(--" settings/index.html` → 1 (>0); hex-literal grep → 0.
- `grep -n "user_settings" .../20260805130000_...sql` → 1 hit.

## Not done (by design)

- Migration is committed only — **not applied**, per instructions.
- No local-storage demo fallback (unlike `pay-settings-repo.js`'s
  `LocalRepo`) — deliberate, matches the null-`getClient()` handling used by
  `meals-repo.js`, `goals-repo.js`, `sleep-repo.js` rather than inventing a
  second storage backend.
