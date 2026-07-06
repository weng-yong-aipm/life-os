# life-os: Shell + Finance Module Design

## Overview

`life-os` is a personal (non-work) multi-module dashboard: finance, career/resume,
learning, investments, and self-tracking (skincare/workout/weight/performance), all
living in one app. This spec covers the **shell** (needed by every module) and the
**first module, Finance**, which the user prioritized to build first.

Remaining modules (career/resume tracker, learning/course tracker, investment landing
page, self-tracking dashboards) are out of scope for this spec — each gets its own
short design pass before it's built, reusing this shell.

## Scope

**In scope:**
- App shell: hub page, shared auth, shared offline-first data layer, PWA install
- Finance module, two tabs:
  - **Spending**: photograph/upload a receipt → auto-extract items, prices, category,
    and estimated nutrition → editable → saved
  - **OT Pay**: manually log hours worked per day → auto-classified as normal
    workday / weekend / Malaysia public holiday → pay computed from user-set rate
    multipliers

**Out of scope (this spec):** career/resume tracker, learning/course tracker,
investment tracking + landing page, self-tracking dashboards (skincare, workout,
weigh-in, performance), reading from the existing `DevNotes` Obsidian vault (explicitly
deferred by the user — nothing personal identified in it yet).

## Architecture

- Repo: `~/life-os` (new, separate from `AI-chatops` and any company repo — personal
  project, per the user's personal-project convention).
- Stack: vanilla HTML/CSS/JS, no build step, installable PWA — same shape as the
  user's existing `eat-decider` project.
- `index.html`: hub page with a card per module (Finance, Career, Learning, Invest,
  Health). Only Finance is functional in v1; the rest render as "coming soon."
- Shared files, reused by every future module:
  - `auth.js` — Supabase email/password auth (mirrors `eat-decider`)
  - `db.js` — LocalRepo/CloudRepo pattern: reads/writes hit `localStorage` first,
    sync to Supabase when online (same interface as `eat-decider`'s `db.js`)
  - `ui.css` — shared styling
- Finance module: `/finance/index.html` + `/finance/finance.js`, two tabs (Spending,
  OT Pay) within the one page.
- Backend: new Supabase project (separate from `eat-decider`'s), Postgres + Auth +
  Storage (for receipt photos), per-user Row Level Security on every table.
- Receipt parsing: a **Supabase Edge Function** (`parse-receipt`), not client-side.
  The browser uploads the photo to Supabase Storage, then calls the Edge Function
  with the storage path. The Edge Function holds the Anthropic API key as a Supabase
  secret, sends the image to Claude (vision) with a prompt requesting structured JSON
  (merchant, purchase date, line items with price/category/estimated
  calories+macros), and returns that JSON to the browser. The Anthropic key never
  reaches client-side JS.

## Data Model

Postgres tables (Supabase), RLS scoped to `auth.uid()`:

```sql
receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  image_path text not null,       -- Supabase Storage path
  merchant text,
  purchased_at date,
  raw_json jsonb,                 -- full Claude response, kept for debugging/re-edit
  created_at timestamptz default now()
)

receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid references receipts on delete cascade,
  name text not null,
  price numeric,
  category text,                  -- e.g. groceries, dining, transport, other
  calories numeric,
  protein_g numeric,
  carbs_g numeric,
  fat_g numeric,
  edited_by_user boolean default false
)

pay_settings (
  user_id uuid primary key references auth.users,
  base_hourly_rate numeric not null,
  weekend_multiplier numeric not null default 1.5,
  holiday_multiplier numeric not null default 2.0,
  currency text not null default 'MYR'
)

work_hours (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  work_date date not null,
  hours numeric not null,
  day_type text not null,         -- 'workday' | 'weekend' | 'holiday' (computed at save time)
  computed_pay numeric not null,
  created_at timestamptz default now()
)

public_holidays (
  holiday_date date primary key,
  name text not null,
  year int not null
)
```

`public_holidays` is seeded from a static, version-controlled `finance/malaysia-holidays.json`
in the repo, not a live API — `date.nager.at` (the originally planned free public-holiday
API) was checked and does **not** cover Malaysia. A static file is also arguably more
correct here: Malaysia has state-specific holidays no free API captures anyway. The file
ships with a best-effort 2026 national list (cross-referenced from officeholidays.com and
calendar-malaysia.com on 2026-07-06) and a note to verify/update it yearly against an
official source or the user's own state calendar.

## Data Flow

**Spending (receipt scan):**
1. User taps "Add Receipt" → camera capture or file picker (`<input type=file
   accept=image/* capture=environment>`).
2. Image uploads to Supabase Storage under the user's folder.
3. Client calls the `parse-receipt` Edge Function with the storage path.
4. Edge Function calls Claude with the image + a JSON-schema prompt; returns
   `{merchant, purchased_at, items: [{name, price, category, calories, protein_g,
   carbs_g, fat_g}]}`.
5. Client renders an editable preview (every field editable, items addable/removable).
6. On confirm, one `receipts` row + N `receipt_items` rows are written.
7. Two dashboard views read from `receipt_items`: spend-by-category (grouped by
   `category`, summed `price`) and calories-by-day (grouped by `receipts.purchased_at`,
   summed `calories`).

**OT Pay:**
1. User opens the OT Pay tab, enters a date and hours worked.
2. Client looks up the date against the static holiday list (loaded from
   `malaysia-holidays.json` into `public_holidays`); if not a holiday, checks if it's
   Sat/Sun for `weekend`; otherwise `workday`.
3. Client computes `pay = hours * base_hourly_rate * multiplier` using the day's
   multiplier from `pay_settings` (`workday` multiplier is implicitly `1`).
4. Row saved to `work_hours`. A monthly summary view sums `computed_pay` and hours
   per `day_type`.
5. If a date isn't in the holiday list (e.g. next year's list hasn't been added yet),
   the entry form shows a manual "this is a public holiday" checkbox as a fallback
   classification.

## Error Handling & Security

- **Offline-first:** every write (receipt, hours entry) goes through `db.js`'s
  LocalRepo first and queues for CloudRepo sync when connectivity returns — same
  behavior as `eat-decider`.
- **Low-confidence/failed OCR:** if the Edge Function call fails or Claude returns
  unparseable output, the UI shows the raw photo next to a blank, fully-editable
  item form — the flow never blocks a save on parsing failure.
- **Nutrition estimates:** always labeled "estimated" in the UI; editing a value sets
  `edited_by_user = true` so future logic can tell real vs. estimated data apart.
- **Secrets:** Anthropic API key lives only as a Supabase Edge Function secret, never
  shipped to the client. Supabase anon key (safe to expose, RLS-protected) is the only
  key in client config, matching `eat-decider`'s `config.js` pattern.
- **Unlisted holiday date:** falls back to the manual checkbox described above; never
  blocks saving an hours entry.

## Testing Plan

- **Unit tests** for the pay calculation (`hours, base_rate, day_type, multipliers →
  computed_pay`) — pure function, easy to get wrong, worth locking down with tests
  before anything else is built.
- **Unit tests** for date → day_type classification (workday/weekend/holiday),
  including the "date not in the static holiday list" fallback path.
- **Manual pass** against the deployed PWA for the receipt-scan flow (camera capture,
  parse, edit, save, dashboard update) and offline queue/sync — same verification
  style used for `eat-decider`, since the receipt/Claude round-trip isn't practical to
  fully mock.

## Future Modules (not built yet, tracked for later)

1. Career/resume tracker — resume + applied-company history
2. Learning tracker — Coursera subscriptions (Google AI Essentials, NVIDIA AI/LLM,
   PM, "vibe coding" courses)
3. Investment tracking + landing page
4. Self-tracking dashboards — skincare, workout, weigh-in, performance

Each will get its own brief design pass (data model + flow) before implementation,
reusing the shell's `auth.js`/`db.js`/`ui.css` and adding its own Supabase tables.
