# life-os unified hub — phase 1: the nightly check-in loop

**Date:** 2026-10-15
**Status:** Design approved in conversation (owner, 2026-10-14/15); written spec awaiting owner review
**Research:** 8-agent read-only survey `wf_7e4667c2-cfc` across life-os, the second-brain Desk,
drama-scan, tanfood, and the scattered goal/preference sources.

## Goal

One place, on the phone and on the desktop, that shows goals, plan progress, what I'm watching,
what I'm planning to do, and what I seem to like — aggregated, not a page of links — and that
**pushes** me when I drift off the plan.

This spec covers **phase 1 only**. Phases 2 and 3 are outlined in §8 and get their own specs.

## Decisions taken (owner, 2026-10-14/15)

| Question | Decision |
|---|---|
| Where the hub lives | **life-os.** Desktop layout and phone layout, both designed, both aggregated in-page — never a hub of links or iframes into other apps. |
| Single source of goals | **The 2026→2030 master plan markdown** (private vault, not this repo), once reviewed. Everything else (13-week plan, `career_goals`, the Desk Worklist, the Claude dashboard) becomes a view of it or is retired. |
| The one thing the owner does daily | **One tap on the nightly push** — "done / not done". Nothing else. |
| Phone | Android, Chrome. Web Push notification **action buttons** work there, so the tap happens on the notification itself. |
| Build order | **Push loop first, run it 7 days, then build the hub page.** |
| The stop-gate | `tools/gate.mjs` changes its streak metric from meal+sleep+learning to **check-in taps**; the phase-2 unlock is **≥5 tapped days out of the last 7** (either answer counts). The four zero-row modules are **frozen**, not deleted. |
| Retire before / with build | Old entry points retire when the phase-2 hub ships (see §8). |

## 1. Why phase 1 is this small

This is the fifth personal dashboard (Personal Cockpit, the Desk, life-os's modules, the
Worklist, now this). Every time, the machine side shipped and the human side stayed at zero
rows: as of 2026-10-13 all 15 human-filled life-os tables hold 0 rows, and the 2026-08-05
seven-day streak is 0/7.

Drift detection needs a daily human signal. If that signal costs more than one tap, history says
it will not happen, and the drift reading will be permanently empty. So phase 1 builds exactly
the signal and nothing else, and the gate measures it.

Building phase 1 while `gate.mjs` currently fails is an explicit owner decision: the check-in
loop **is** the habit the gate exists to demand, rebuilt at the smallest size.

## 2. Components

```
 Mac (launchd, daily 07:00 + on file change)
   tools/goal-sync.mjs ── parses master plan ──► milestones (Supabase, owner-only RLS)
                                                        │
 Supabase pg_cron ─► 21:00 MYT ─► edge fn `nudge` ──────┤ picks today's focus
                                     │ web-push         │
                                     ▼                  │
                             Android Chrome notification
                             [Done] [Not done]          │
                                     │ service worker   │
                                     ▼                  │
                             edge fn `checkin` ──► checkins
                                                        │
 Supabase pg_cron ─► 08:00 MYT ─► edge fn `nudge?mode=drift` reads checkins + milestones
                                     └─► alert push if drifting
```

The push stack copies tanfood's proven pattern (`supabase/functions/_shared/push.ts` there):
`npm:web-push` for RFC 8291 encryption + VAPID signing, Deno `fetch` to send, `pg_cron` +
`pg_net` to call the function, `X-Job-Secret` header checked in-function. Nothing depends on the
Mac being awake except goal-sync.

### 2.1 `tools/goal-sync.mjs` (runs on the Mac)

- Reads the master plan path from `.env` (`GOAL_PLAN_PATH`). The file never enters this repo.
- Parses **one machine-readable section**: a markdown table under the heading
  `## Milestones (machine)` with columns `id | title | due | status | next_step`.
  - `due` is `YYYY-MM-DD`; `status` is one of `todo | doing | done | dropped`.
  - `next_step` is one line — what tonight's push will say.
- Strict: a malformed row, duplicate `id`, bad date, or unknown status **fails the run with the
  row number** and writes nothing. A missing section fails too. No partial sync.
- Upserts into `milestones` by `id`; rows no longer in the file are marked `status = 'dropped'`,
  never deleted (check-ins reference them).
- Records `synced_at` in a single-row `goal_sync_status` table, success or failure, with the
  error text on failure.
- Uses `SUPABASE_SERVICE_ROLE_KEY` from `.env`, same loader as `tools/gate.mjs`.
- launchd: `StartCalendarInterval` at 07:00 plus `WatchPaths` on the plan file. Not
  `StartInterval` — that is what silently stopped drama-scan after sleep.

Parsing is a pure function (`parseMilestones(markdown) -> {rows} | throws`) tested without I/O.

### 2.2 Tables (one migration)

| Table | Columns | Notes |
|---|---|---|
| `milestones` | `id text pk`, `user_id`, `title`, `due date`, `status`, `next_step`, `updated_at` | Written only by goal-sync (service role). Owner can select. |
| `checkins` | `id`, `user_id`, `day date`, `milestone_id`, `done boolean`, `answered_at`, unique `(user_id, day)` | Written only by `checkin` (service role). Last answer of the day wins. |
| `push_subscriptions` | `id`, `user_id`, `endpoint`, `p256dh`, `auth`, `created_at` | Same shape and https/≤1024 endpoint guard as tanfood. |
| `goal_sync_status` | `user_id pk`, `synced_at`, `ok boolean`, `error text` | |

All four: RLS on, `own_select` policies, plus the existing `aal2_when_mfa_enrolled` restrictive
policy. No client insert/update policies except `push_subscriptions` (owner subscribes from the
app). Goal text lives only in the database; this public repo holds only generic code.

### 2.3 Edge function `nudge`

- Auth: `X-Job-Secret == JOB_SECRET`, otherwise 401.
- **Evening mode (21:00 MYT = 13:00 UTC):** pick today's focus = the milestone with
  `status in (todo, doing)` and the earliest `due` (ties: `id` order). Send:
  - title `今天主线`, body `<title>：<next_step>。做了吗？`
  - actions `done` / `not_done`
  - `data: { day, milestone_id, token }`
  - If there is no open milestone, send `没有进行中的里程碑——总计划需要更新` instead (no actions).
- **Drift mode (08:00 MYT = 00:00 UTC):** look at the 3 local days before today, counting only
  days on or after the first push subscription's local day (so the loop does not report drift
  for days before it existed). Only when all 3 days are in scope and none of them has a
  `done = true` check-in (an unanswered day counts as not done), send `主线已停 N 天` + the focus milestone's
  `next_step`. Otherwise send nothing.
- Both modes: if `goal_sync_status.synced_at` is older than 3 days or `ok = false`, prepend
  `目标数据 N 天未同步` to whatever is sent — and in drift mode send that line on its own if
  nothing else is due. A broken Mac side must surface on the phone.
- Subscription returning 404/410 → delete that row. Other failures → log, no retry (the next
  scheduled run is the retry).
- Local day is computed in `Asia/Kuala_Lumpur`, never `toISOString().slice(0,10)` (see the
  UTC bug noted in `gate.mjs`).

Focus selection, drift evaluation, and message text are pure functions with unit tests.

### 2.4 Edge function `checkin`

- Body `{ day, milestone_id, done, token }`. No user session needed — the service worker has none.
- `token = HMAC-SHA256(CHECKIN_SECRET, user_id|day|milestone_id)`, base64url, minted by `nudge`.
  Valid only for that day and the following day. A token cannot be reused to write any other
  day or milestone.
- Upsert into `checkins` on `(user_id, day)`. Returns 204.

### 2.5 Client (life-os PWA)

- `service-worker.js`: `push` handler shows the notification; `notificationclick` with an action
  POSTs to `checkin` and, on success, does nothing visible. On failure it re-shows the same
  notification titled `没记上，再点一次` with the same two buttons and data, so the retry is the
  same single tap. A tap on the notification body (no action) opens `./plan/`.
- `settings/`: one button `开启提醒` → request permission → `pushManager.subscribe` with the
  VAPID public key → insert into `push_subscriptions`. Shows current state (on / off / blocked).
- `ASSETS` in `service-worker.js` and `tools/sw-precache.test.js` stay in sync; bump `CACHE`.

## 3. The gate change (`tools/gate.mjs`)

- New streak input: `checkins.day` (any answer). New pass rule for phase 2: **≥5 distinct days
  with a check-in among the last 7 local days, today included**.
- `MODULES` gains a `frozen: true` flag for Training, Finance, Health, Capture. Frozen modules
  are still probed and printed, but do not block. The output says FROZEN, not OK.
- Everything else keeps its current semantics: unreachable ≠ empty, missing credentials exit 2,
  a fetch that fails throws instead of reading as 0.
- `gate.test.js` gains cases for: 5/7 passes, 4/7 fails, today-unanswered, frozen module with
  0 rows does not block, unfrozen module with 0 rows still blocks.

## 4. Owner-only steps (I cannot or must not do these)

1. **Review the master plan** and add the `## Milestones (machine)` table with a `next_step`
   per open milestone. This is step 0; nothing pushes without it.
2. Set Supabase secrets: `JOB_SECRET`, `CHECKIN_SECRET`, `VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `OWNER_USER_ID` (single-user app: the function and
   goal-sync write rows for this auth user id). (I generate the VAPID pair into a local file for the owner;
   values are never pasted into chat or committed.)
3. Run the prod-only `pg_cron` SQL (two schedules) in the SQL editor.
4. On the phone: open life-os in Chrome → Settings → `开启提醒`.

## 5. Error handling summary

| Failure | What the owner sees |
|---|---|
| Master plan malformed | goal-sync fails; after 3 days the push says `目标数据 N 天未同步` |
| Mac asleep for days | same as above; pushes keep coming from the cloud with the last good milestones |
| Push endpoint expired | row deleted; settings page shows "off" next time it is opened |
| Check-in POST fails (offline) | same notification re-shown as `没记上，再点一次`, same buttons |
| No open milestones | evening push says the plan needs updating |
| Gate cannot reach DB | exits non-zero with UNREACHABLE, as today |

## 6. Testing

- `node --test`: `parseMilestones`, focus selection, drift evaluation, message text, token
  mint/verify, local-day calculation around 00:00–08:00 MYT, gate streak and frozen rules.
- `deno test` for the two edge functions with a fake push sender (tanfood's `PushSender` seam).
- `tools/sw-precache.test.js` stays green.
- **Done-check for phase 1** (real, not simulated): the owner receives the 21:00 push on the
  Android phone, taps `Done` without opening the app, and a row appears in `checkins` for that
  day; the next morning's drift run sends nothing. Then 7 days of the loop running.

## 7. Out of scope for phase 1

The hub page, any drama / tanfood / preference data, retiring old entry points, changes to the
13-week plan UI, Gmail or calendar channels, iPhone support.

One housekeeping item rides along because phase 2 depends on it and it adds no module: the
drama-scan launchd job is not loaded at all; reinstall it with `StartCalendarInterval` (the
life-os db-backup job proved StartInterval never fires again after sleep). That work is in the
second-brain repo, not here. Reconciling `drama-progress.md` with `drama-state.json` moves to
phase 2: the progress file was hand-updated again on 2026-10-15 by another workflow, and
regenerating it now would overwrite that work.

## 8. Phases 2 and 3 (outline only — each gets its own spec)

**Phase 2 — the hub page** (starts only when the gate passes):
- One page, two designed layouts (desktop, phone). Sections: today's focus + check-in streak;
  milestones vs. plan; what I'm watching (drama-scan state, pushed from the Mac into private
  tables); upcoming plans (tanfood trips/bookings, **read-only** from its database — no tanfood
  code changes); preference signals (derived from saved/liked items, owner confirms or deletes;
  no hand-written profile).
- Retire at the same time: Desk goal/plan tabs and Worklist, `career_goals` set read-only, the
  Claude dashboard reads from the master plan only.

**Phase 3 — module tune-up and finer drift:** weekly hours vs. plan thresholds (e.g. the
"<10h/week ⇒ stretch the cycle" rule), per-module cleanup, unfreezing modules one at a time
only if they get used.
