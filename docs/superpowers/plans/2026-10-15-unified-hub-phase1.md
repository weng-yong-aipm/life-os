# life-os unified hub phase 1 — nightly check-in loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every evening at 21:00 MYT the owner's Android phone gets "今天主线：… 做了吗？" with Done / Not done buttons; one tap records a check-in; three silent days produce a morning drift alert; the stop-gate counts the taps.

**Architecture:** A Mac launchd job parses one machine-readable table out of the private master plan and upserts it into Supabase. Two Supabase Edge Functions do the rest in the cloud: `nudge` (called by pg_cron, sends Web Push) and `checkin` (called by the service worker, verifies an HMAC token, writes the row). All decision logic is one pure module shared by Node tests and Deno functions.

**Tech Stack:** Vanilla ESM PWA, Node 26 `node --test`, Supabase Postgres + RLS + pg_cron/pg_net + Vault, Deno edge functions, `npm:web-push@3`, macOS launchd.

**Spec:** `docs/superpowers/specs/2026-10-15-unified-hub-design.md`

## Global Constraints

- This repo is **public**. No goal text, milestone content, personal paths, secrets, or user ids in any committed file. Goal content lives only in the database; the plan file path only in `.env` and the local plist.
- Local day is always `Asia/Kuala_Lumpur`. Never `toISOString().slice(0,10)` on a wall-clock time.
- Push copy (exact): evening title `今天主线`; body `<title>：<next_step>。做了吗？`; actions `做了` (`done`) / `没做` (`not_done`); no-open-milestone body `没有进行中的里程碑——总计划需要更新`; drift title `主线已停 N 天`; retry title `没记上，再点一次`; stale notice `目标数据 N 天未同步`.
- Schedules: evening `0 13 * * *` UTC (21:00 MYT), drift `0 0 * * *` UTC (08:00 MYT). goal-sync launchd: `StartCalendarInterval` 07:00 + `WatchPaths` on the plan file. Never `StartInterval`.
- Gate phase-2 unlock: **≥5 distinct check-in days among the last 7 local days, today included**; Training, Finance, Health, Capture are `frozen` (printed, never blocking).
- Every new table: RLS on, `own_select`, and the `aal2_when_mfa_enrolled` restrictive policy.
- Production changes (migration push, secrets, function deploy, cron SQL, launchctl) need the owner's explicit OK at the moment they run. Secrets are never printed or pasted into chat.
- tanfood is read-only for this work (another session owns it): copy patterns, never edit it.

## Review Focus

1. **Tapping after midnight** — a 21:00 push answered at 00:30 must record the *push's* day, and the token must still be accepted. → Task 2 test `verifyToken accepts the push day on the following day`; Task 5 test `checkin writes the day from the push, not today`.
2. **The loop's first mornings** — no drift alert until three full days have existed since subscribing. → Task 2 test `no drift before three in-scope days exist`.
3. **Mac side broken** (asleep a week, or the plan table malformed) — the phone must say so instead of silently pushing stale milestones. → Task 2 tests for `syncNotice`; Task 4 test `drift mode with healthy checkins still sends a stale-sync notice`.
4. **Stale notification tapped days later** — must not loop the retry notification forever; it says it expired. → Task 6 test `classifyCheckinResult: 403 is expired, not retry`.
5. **Every milestone done or dropped** — evening push says the plan needs updating, with no buttons (nothing to check in against). → Task 2 test `eveningMessage with no focus has no actions`.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261015000000_add_checkin_loop.sql` | 4 tables, RLS, aal2 |
| `supabase/functions/_shared/hub-core.js` | Pure logic: local day, focus, drift, sync notice, messages, token, body parsing |
| `tools/hub-core.test.js` | Node tests for hub-core |
| `tools/goal-sync.mjs` | Pure `parseMilestones`/`planSync` + I/O sync to Supabase |
| `tools/goal-sync.test.js` | Node tests for the parser |
| `supabase/functions/_shared/push.ts` | Web Push sender (pattern from tanfood) |
| `supabase/functions/_shared/hub-db.ts` | supabase-js data access for both functions |
| `supabase/functions/nudge/{index.ts,handler.ts,handler_test.ts}` | Evening + drift pushes |
| `supabase/functions/checkin/{index.ts,handler.ts,handler_test.ts}` | Token-verified check-in write |
| `settings/push-subscribe.js` + `settings/push-subscribe.test.js` | Pure client helpers (key decode, state label, result classification) |
| `settings/index.html`, `settings/settings-ui.js` | `开启提醒` button |
| `service-worker.js`, `config.js` | push + notificationclick handlers; VAPID public key |
| `tools/gate.mjs`, `tools/gate.test.js` | Tap-count rule, frozen modules |
| `~/second-brain/docs/launchagents/com.wengyong.drama-scan.plist` | Housekeeping rider |

---

### Task 0 (owner): machine-readable milestones in the master plan

Not code. Nothing pushes without it; Tasks 1–7 can proceed in parallel.

- [ ] **Step 1:** Owner reviews the master plan and marks it final.
- [ ] **Step 2:** Owner adds this section (content is the owner's; shape is fixed):

```markdown
## Milestones (machine)

| id | title | due | status | next_step |
|---|---|---|---|---|
| m-example | Example milestone | 2026-11-30 | doing | One concrete action doable tonight |
```

Rules: `id` is letters/digits/dashes; `due` is `YYYY-MM-DD`; `status` ∈ `todo|doing|done|dropped`; `next_step` required for `todo`/`doing`; no `|` inside cells.

- [ ] **Step 3:** Owner adds `GOAL_PLAN_PATH=<absolute path>` and `OWNER_USER_ID=<auth user id>` to `life-os/.env` (gitignored).

---

### Task 1: Migration — checkin-loop tables

**Files:**
- Create: `supabase/migrations/20261015000000_add_checkin_loop.sql`

**Interfaces:**
- Produces tables `milestones(id text pk, user_id, title, due, status, next_step, updated_at)`, `checkins(id, user_id, day, milestone_id, done, answered_at, unique(user_id, day))`, `push_subscriptions(id, user_id, endpoint unique, p256dh, auth, created_at)`, `goal_sync_status(user_id pk, synced_at, ok, error)`.

- [ ] **Step 1: Write the migration**

```sql
-- Phase 1 of the unified hub: the nightly check-in loop.
-- docs/superpowers/specs/2026-10-15-unified-hub-design.md
--
-- milestones / checkins / goal_sync_status are written only by the service
-- role (goal-sync on the Mac, the nudge/checkin edge functions), so the owner
-- gets select policies and nothing else. push_subscriptions is the one table
-- the app writes: subscribing happens in the browser.

create table if not exists public.milestones (
  id          text primary key check (id ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,63}$'),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  due         date not null,
  status      text not null check (status in ('todo', 'doing', 'done', 'dropped')),
  next_step   text not null default '',
  updated_at  timestamptz not null default now()
);

create table if not exists public.checkins (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  day           date not null,
  milestone_id  text not null references public.milestones(id),
  done          boolean not null,
  answered_at   timestamptz not null default now(),
  unique (user_id, day)
);

create table if not exists public.push_subscriptions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint    text not null unique check (endpoint like 'https://%' and length(endpoint) <= 1024),
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.goal_sync_status (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  synced_at  timestamptz,
  ok         boolean not null default false,
  error      text
);

alter table public.milestones         enable row level security;
alter table public.checkins           enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.goal_sync_status   enable row level security;

create policy "own_select" on public.milestones         for select using (auth.uid() = user_id);
create policy "own_select" on public.checkins           for select using (auth.uid() = user_id);
create policy "own_select" on public.goal_sync_status   for select using (auth.uid() = user_id);
create policy "own_select" on public.push_subscriptions for select using (auth.uid() = user_id);
create policy "own_insert" on public.push_subscriptions for insert with check (auth.uid() = user_id);
create policy "own_delete" on public.push_subscriptions for delete using (auth.uid() = user_id);

do $$
declare
  t text;
begin
  foreach t in array array['milestones', 'checkins', 'push_subscriptions', 'goal_sync_status']
  loop
    execute format('drop policy if exists "aal2_when_mfa_enrolled" on public.%I', t);
    execute format(
      'create policy "aal2_when_mfa_enrolled" on public.%I ' ||
      'as restrictive for all to authenticated ' ||
      'using (not public.requires_aal2() or (select auth.jwt()->>''aal'') = ''aal2'') ' ||
      'with check (not public.requires_aal2() or (select auth.jwt()->>''aal'') = ''aal2'')',
      t
    );
  end loop;
end $$;
```

- [ ] **Step 2: Verify locally if a local stack is available**

Run: `supabase db reset` (only if `supabase status` shows a running local stack; otherwise skip — Task 8 applies it to prod with the owner's OK).
Expected: completes without error.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261015000000_add_checkin_loop.sql
git commit -m "feat(hub): tables for the nightly check-in loop"
```

---

### Task 2: hub-core — the pure decision logic

**Files:**
- Create: `supabase/functions/_shared/hub-core.js`
- Test: `tools/hub-core.test.js`

**Interfaces:**
- Produces (all exported from `hub-core.js`):
  - `TZ = 'Asia/Kuala_Lumpur'`
  - `localDay(date: Date, tz = TZ): string` → `'YYYY-MM-DD'`
  - `addDays(day: string, n: number): string`
  - `daysBetween(a: string, b: string): number` (b − a)
  - `pickFocus(milestones: {id,title,due,status,next_step}[]): milestone | null`
  - `evaluateDrift({today, checkins: {day,done}[], since: string|null}): {drifting: boolean, stalledDays: number}`
  - `syncNotice({status: {synced_at,ok,error}|null, now: Date}): string | null`
  - `eveningMessage({focus, day, token, checkinUrl, notice}): Payload`
  - `driftMessage({drift, focus, notice}): Payload | null`
  - `mintToken(secret, {userId, day, milestoneId}): Promise<string>`
  - `verifyToken(secret, {userId, day, milestoneId, token, today}): Promise<boolean>`
  - `parseCheckinBody(body: unknown): {day, milestone_id, done, token} | null`
  - `Payload = {title, body, tag?, actions?: {action,title}[], data: object}`

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  localDay, addDays, daysBetween, pickFocus, evaluateDrift, syncNotice,
  eveningMessage, driftMessage, mintToken, verifyToken, parseCheckinBody,
} from '../supabase/functions/_shared/hub-core.js';

test('localDay is the Kuala Lumpur day, not the UTC day', () => {
  // 2026-10-15 23:30 UTC is already 07:30 on the 16th in MYT.
  assert.equal(localDay(new Date('2026-10-15T23:30:00Z')), '2026-10-16');
  // 13:00 UTC is the 21:00 MYT push — same calendar day.
  assert.equal(localDay(new Date('2026-10-15T13:00:00Z')), '2026-10-15');
});

test('addDays and daysBetween cross month ends', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-11-01', -1), '2026-10-31');
  assert.equal(daysBetween('2026-10-30', '2026-11-02'), 3);
});

const M = (id, due, status, next_step = 'step') => ({ id, title: id, due, status, next_step });

test('pickFocus takes the earliest-due open milestone, ties by id', () => {
  const ms = [M('b', '2026-11-01', 'todo'), M('a', '2026-11-01', 'doing'), M('c', '2026-10-01', 'done')];
  assert.equal(pickFocus(ms).id, 'a');
});

test('pickFocus returns null when nothing is open', () => {
  assert.equal(pickFocus([M('a', '2026-10-01', 'done'), M('b', '2026-10-02', 'dropped')]), null);
  assert.equal(pickFocus([]), null);
});

const TODAY = '2026-10-20';
const C = (n, done) => ({ day: addDays(TODAY, -n), done });

test('no drift before three in-scope days exist', () => {
  // Subscribed two days ago: only 2 of the 3 window days are in scope.
  const r = evaluateDrift({ today: TODAY, checkins: [], since: addDays(TODAY, -2) });
  assert.deepEqual(r, { drifting: false, stalledDays: 0 });
  assert.equal(evaluateDrift({ today: TODAY, checkins: [], since: null }).drifting, false);
});

test('three in-scope days with no done is drift; unanswered counts as not done', () => {
  const r = evaluateDrift({ today: TODAY, checkins: [C(1, false)], since: addDays(TODAY, -5) });
  assert.deepEqual(r, { drifting: true, stalledDays: 5 });
});

test('one done day inside the window means no drift', () => {
  const r = evaluateDrift({ today: TODAY, checkins: [C(3, true)], since: addDays(TODAY, -10) });
  assert.equal(r.drifting, false);
});

test('stalledDays counts back to the last done day', () => {
  const r = evaluateDrift({ today: TODAY, checkins: [C(6, true), C(2, false)], since: addDays(TODAY, -10) });
  assert.deepEqual(r, { drifting: true, stalledDays: 5 });
});

test('a done check-in TODAY does not hide drift in the window (the morning run is before tonight)', () => {
  const r = evaluateDrift({ today: TODAY, checkins: [{ day: TODAY, done: true }], since: addDays(TODAY, -5) });
  assert.equal(r.drifting, true);
});

const NOW = new Date('2026-10-20T00:00:00Z'); // 08:00 MYT on the 20th

test('syncNotice: healthy recent sync says nothing', () => {
  assert.equal(syncNotice({ status: { synced_at: '2026-10-19T00:00:00Z', ok: true, error: null }, now: NOW }), null);
});

test('syncNotice: never synced, failed, or stale all speak up', () => {
  assert.equal(syncNotice({ status: null, now: NOW }), '目标数据从未同步');
  assert.match(syncNotice({ status: { synced_at: '2026-10-19T00:00:00Z', ok: false, error: 'line 7: bad due' }, now: NOW }), /^目标数据同步失败：line 7: bad due/);
  assert.equal(syncNotice({ status: { synced_at: '2026-10-15T23:00:00Z', ok: true, error: null }, now: NOW }), '目标数据 4 天未同步');
});

test('syncNotice: exactly 3 days old is still fine', () => {
  assert.equal(syncNotice({ status: { synced_at: '2026-10-17T00:00:00Z', ok: true, error: null }, now: NOW }), null);
});

test('eveningMessage carries the buttons and the check-in data', () => {
  const focus = M('m1', '2026-11-01', 'doing', '写资料页');
  const p = eveningMessage({ focus: { ...focus, title: '副业上架' }, day: '2026-10-20', token: 'T', checkinUrl: 'https://x/functions/v1/checkin', notice: null });
  assert.equal(p.title, '今天主线');
  assert.equal(p.body, '副业上架：写资料页。做了吗？');
  assert.deepEqual(p.actions, [{ action: 'done', title: '做了' }, { action: 'not_done', title: '没做' }]);
  assert.deepEqual(p.data, { day: '2026-10-20', milestone_id: 'm1', token: 'T', checkinUrl: 'https://x/functions/v1/checkin' });
  assert.equal(p.tag, 'checkin-2026-10-20');
});

test('eveningMessage with no focus has no actions', () => {
  const p = eveningMessage({ focus: null, day: '2026-10-20', token: null, checkinUrl: 'u', notice: '目标数据 4 天未同步' });
  assert.equal(p.actions, undefined);
  assert.equal(p.body, '目标数据 4 天未同步\n没有进行中的里程碑——总计划需要更新');
});

test('driftMessage: nothing to say returns null; notice alone is still sent', () => {
  assert.equal(driftMessage({ drift: { drifting: false, stalledDays: 0 }, focus: null, notice: null }), null);
  const p = driftMessage({ drift: { drifting: false, stalledDays: 0 }, focus: null, notice: '目标数据从未同步' });
  assert.equal(p.title, '目标数据异常');
});

test('driftMessage when drifting names the next step', () => {
  const p = driftMessage({ drift: { drifting: true, stalledDays: 4 }, focus: { ...M('m1', '2026-11-01', 'doing', '写资料页'), title: '副业上架' }, notice: null });
  assert.equal(p.title, '主线已停 4 天');
  assert.equal(p.body, '下一步：副业上架：写资料页');
});

const S = 'test-secret';
const T = { userId: 'u1', day: '2026-10-20', milestoneId: 'm1' };

test('verifyToken accepts the push day on the same and the following day', async () => {
  const token = await mintToken(S, T);
  assert.equal(await verifyToken(S, { ...T, token, today: '2026-10-20' }), true);
  assert.equal(await verifyToken(S, { ...T, token, today: '2026-10-21' }), true);
});

test('verifyToken rejects later days, other days, other milestones, and garbage', async () => {
  const token = await mintToken(S, T);
  assert.equal(await verifyToken(S, { ...T, token, today: '2026-10-22' }), false);
  assert.equal(await verifyToken(S, { ...T, day: '2026-10-21', token, today: '2026-10-21' }), false);
  assert.equal(await verifyToken(S, { ...T, milestoneId: 'm2', token, today: '2026-10-20' }), false);
  assert.equal(await verifyToken(S, { ...T, token: 'x', today: '2026-10-20' }), false);
  assert.equal(await verifyToken('', { ...T, token, today: '2026-10-20' }), false);
});

test('parseCheckinBody accepts only the exact shape', () => {
  const ok = { day: '2026-10-20', milestone_id: 'm1', done: true, token: 'abc' };
  assert.deepEqual(parseCheckinBody(ok), ok);
  assert.equal(parseCheckinBody({ ...ok, done: 'true' }), null);
  assert.equal(parseCheckinBody({ ...ok, day: '2026-10-2' }), null);
  assert.equal(parseCheckinBody({ ...ok, milestone_id: 'x'.repeat(65) }), null);
  assert.equal(parseCheckinBody(null), null);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tools/hub-core.test.js`
Expected: FAIL — `Cannot find module .../hub-core.js`.

- [ ] **Step 3: Implement**

```js
/* Pure logic for the nightly check-in loop. No I/O, no Node or Deno APIs —
 * only Web-standard globals (Intl, crypto.subtle, btoa), so the same file is
 * unit-tested by `node --test` and imported by the edge functions.
 * docs/superpowers/specs/2026-10-15-unified-hub-design.md */

export const TZ = 'Asia/Kuala_Lumpur';
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MILESTONE_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

/* en-CA formats as YYYY-MM-DD. The UTC slice this replaces files anything
 * before 08:00 MYT under yesterday. */
export function localDay(date, tz = TZ) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10); // pure calendar arithmetic at UTC midnight: safe
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function pickFocus(milestones) {
  const open = milestones.filter((m) => m.status === 'todo' || m.status === 'doing');
  open.sort((a, b) => (a.due === b.due ? (a.id < b.id ? -1 : 1) : (a.due < b.due ? -1 : 1)));
  return open[0] ?? null;
}

/* The window is the 3 days BEFORE today: the drift run is at 08:00, before
 * tonight's push could have been answered. Days before `since` (the first
 * subscription) did not have a loop to answer, so drift needs all 3 in scope. */
export function evaluateDrift({ today, checkins, since }) {
  const window = [1, 2, 3].map((n) => addDays(today, -n));
  if (!since || window.some((d) => d < since)) return { drifting: false, stalledDays: 0 };
  const done = new Set(checkins.filter((c) => c.done).map((c) => c.day));
  if (window.some((d) => done.has(d))) return { drifting: false, stalledDays: 0 };
  let n = 1;
  while (addDays(today, -n) >= since && !done.has(addDays(today, -n))) n++;
  return { drifting: true, stalledDays: n - 1 };
}

export function syncNotice({ status, now }) {
  if (!status || !status.synced_at) return '目标数据从未同步';
  if (!status.ok) return `目标数据同步失败：${String(status.error ?? '').slice(0, 80)}`;
  const age = daysBetween(localDay(new Date(status.synced_at)), localDay(now));
  return age > 3 ? `目标数据 ${age} 天未同步` : null;
}

const NO_FOCUS = '没有进行中的里程碑——总计划需要更新';
const withNotice = (notice, text) => (notice ? `${notice}\n${text}` : text);

export function eveningMessage({ focus, day, token, checkinUrl, notice }) {
  if (!focus) return { title: '今天主线', body: withNotice(notice, NO_FOCUS), data: { open: './plan/' } };
  return {
    title: '今天主线',
    body: withNotice(notice, `${focus.title}：${focus.next_step}。做了吗？`),
    tag: `checkin-${day}`,
    actions: [{ action: 'done', title: '做了' }, { action: 'not_done', title: '没做' }],
    data: { day, milestone_id: focus.id, token, checkinUrl },
  };
}

export function driftMessage({ drift, focus, notice }) {
  if (drift.drifting) {
    const next = focus ? `下一步：${focus.title}：${focus.next_step}` : NO_FOCUS;
    return { title: `主线已停 ${drift.stalledDays} 天`, body: withNotice(notice, next), data: { open: './plan/' } };
  }
  if (notice) return { title: '目标数据异常', body: notice, data: { open: './plan/' } };
  return null;
}

const enc = new TextEncoder();
function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function mintToken(secret, { userId, day, milestoneId }) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${userId}|${day}|${milestoneId}`));
  return b64url(new Uint8Array(sig));
}

/* Valid on the push's day and the next one, so a 21:00 push answered at
 * 00:30 still lands on the day it asked about. */
export async function verifyToken(secret, { userId, day, milestoneId, token, today }) {
  if (!secret || typeof token !== 'string') return false;
  if (day !== today && addDays(day, 1) !== today) return false;
  const expected = await mintToken(secret, { userId, day, milestoneId });
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

export function parseCheckinBody(body) {
  if (!body || typeof body !== 'object') return null;
  const { day, milestone_id, done, token } = body;
  if (typeof day !== 'string' || !ISO_DAY.test(day)) return null;
  if (typeof milestone_id !== 'string' || !MILESTONE_ID.test(milestone_id)) return null;
  if (typeof done !== 'boolean') return null;
  if (typeof token !== 'string' || token.length === 0 || token.length > 128) return null;
  return { day, milestone_id, done, token };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tools/hub-core.test.js`
Expected: all tests PASS. Then `npm test` — whole suite still green.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/hub-core.js tools/hub-core.test.js
git commit -m "feat(hub): pure focus/drift/token logic for the check-in loop"
```

---

### Task 3: goal-sync — master plan → milestones

**Files:**
- Create: `tools/goal-sync.mjs`
- Test: `tools/goal-sync.test.js`

**Interfaces:**
- Produces: `parseMilestones(markdown: string): {id,title,due,status,next_step}[]` (throws `Error` whose message starts `line N:` or names the missing section); `planSync(existing: {id,status}[], rows): {upserts: rows, dropIds: string[]}`.
- Consumes: tables from Task 1; `.env` keys `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOAL_PLAN_PATH`, `OWNER_USER_ID`.

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMilestones, planSync } from './goal-sync.mjs';

const doc = (rows) => `# Plan\n\nprose\n\n## Milestones (machine)\n\n| id | title | due | status | next_step |\n|---|---|---|---|---|\n${rows.join('\n')}\n\n## Later\n| not | a | milestone | table | x |\n`;

test('parses the machine table and stops at the next heading', () => {
  const r = parseMilestones(doc(['| m1 | One | 2026-11-01 | doing | do it |', '| m2 | Two | 2026-12-01 | done |  |']));
  assert.deepEqual(r, [
    { id: 'm1', title: 'One', due: '2026-11-01', status: 'doing', next_step: 'do it' },
    { id: 'm2', title: 'Two', due: '2026-12-01', status: 'done', next_step: '' },
  ]);
});

test('missing section fails loudly', () => {
  assert.throws(() => parseMilestones('# Plan\nno table'), /Milestones \(machine\)/);
});

test('every malformed row names its line', () => {
  const bad = [
    ['| m1 | One | 2026-13-01 | doing | x |', /line 9: .*due/],
    ['| m1 | One | 2026-11-01 | started | x |', /line 9: .*status/],
    ['| m1 | One | 2026-11-01 | doing |  |', /line 9: .*next_step/],
    ['| m 1 | One | 2026-11-01 | doing | x |', /line 9: .*id/],
    ['| m1 | One | 2026-11-01 | doing |', /line 9: .*5 columns/],
  ];
  for (const [row, re] of bad) assert.throws(() => parseMilestones(doc([row])), re);
});

test('duplicate ids fail', () => {
  assert.throws(() => parseMilestones(doc(['| m1 | A | 2026-11-01 | todo | x |', '| m1 | B | 2026-11-02 | todo | y |'])), /line 10: duplicate id m1/);
});

test('an empty table fails rather than dropping everything', () => {
  assert.throws(() => parseMilestones(doc([])), /no milestone rows/);
});

test('a wrong header fails', () => {
  const md = '## Milestones (machine)\n\n| id | name | due | status | next_step |\n|---|---|---|---|---|\n| m1 | A | 2026-11-01 | todo | x |\n';
  assert.throws(() => parseMilestones(md), /line 3: header/);
});

test('planSync drops ids that left the file, but never re-drops', () => {
  const rows = [{ id: 'm1' }];
  const existing = [{ id: 'm1', status: 'doing' }, { id: 'm2', status: 'todo' }, { id: 'm3', status: 'dropped' }];
  assert.deepEqual(planSync(existing, rows), { upserts: rows, dropIds: ['m2'] });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tools/goal-sync.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
#!/usr/bin/env node
/* Master plan -> milestones. Runs on the Mac (launchd, 07:00 + on file change).
 *
 *   node tools/goal-sync.mjs
 *
 * Reads ONE section of the private master plan (GOAL_PLAN_PATH in .env — the
 * file never enters this public repo): a table under `## Milestones (machine)`.
 * Strict on purpose: a malformed row fails the whole run with its line number
 * and writes nothing but the failure into goal_sync_status, which the morning
 * push reads. A half-synced plan would push the wrong "today's focus" silently.
 * docs/superpowers/specs/2026-10-15-unified-hub-design.md §2.1 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HEADING = /^##\s+Milestones \(machine\)\s*$/;
const COLUMNS = ['id', 'title', 'due', 'status', 'next_step'];
const STATUSES = new Set(['todo', 'doing', 'done', 'dropped']);
const ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

function isRealDay(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export function parseMilestones(markdown) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => HEADING.test(l));
  if (start === -1) throw new Error('section "## Milestones (machine)" not found');
  const rows = [];
  const seen = new Set();
  let header = false;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    if (/^#{1,2}\s/.test(line)) break;
    if (!line.trim().startsWith('|')) continue;
    const c = cells(line);
    if (!header) {
      if (c.join('|') !== COLUMNS.join('|')) throw new Error(`line ${lineNo}: header must be | ${COLUMNS.join(' | ')} |`);
      header = true;
      continue;
    }
    if (c.every((x) => /^:?-+:?$/.test(x))) continue; // separator row
    if (c.length !== 5) throw new Error(`line ${lineNo}: expected 5 columns, got ${c.length}`);
    const [id, title, due, status, next_step] = c;
    if (!ID.test(id)) throw new Error(`line ${lineNo}: id "${id}" must be letters, digits, dashes`);
    if (!title) throw new Error(`line ${lineNo}: title is empty`);
    if (!isRealDay(due)) throw new Error(`line ${lineNo}: due "${due}" is not a real YYYY-MM-DD date`);
    if (!STATUSES.has(status)) throw new Error(`line ${lineNo}: status "${status}" must be todo|doing|done|dropped`);
    if ((status === 'todo' || status === 'doing') && !next_step) throw new Error(`line ${lineNo}: next_step is required while ${status}`);
    if (seen.has(id)) throw new Error(`line ${lineNo}: duplicate id ${id}`);
    seen.add(id);
    rows.push({ id, title, due, status, next_step });
  }
  if (!header) throw new Error('section "## Milestones (machine)" has no table');
  if (!rows.length) throw new Error('no milestone rows — refusing to drop every milestone');
  return rows;
}

export function planSync(existing, rows) {
  const keep = new Set(rows.map((r) => r.id));
  const dropIds = existing.filter((e) => !keep.has(e.id) && e.status !== 'dropped').map((e) => e.id);
  return { upserts: rows, dropIds };
}

/* ------------------------------------------------------------------- the I/O */

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/* Same loader as tools/gate.mjs: process.env wins over .env. */
function loadEnv() {
  const env = { ...process.env };
  try {
    for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* rely on process.env */ }
  return env;
}

async function rest(env, path, init = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path.split('?')[0]} -> HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

const upsert = { Prefer: 'resolution=merge-duplicates,return=minimal' };

async function main() {
  const env = loadEnv();
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GOAL_PLAN_PATH', 'OWNER_USER_ID']) {
    if (!env[k]) { console.error(`goal-sync: ${k} not set`); process.exit(2); }
  }
  const user_id = env.OWNER_USER_ID;
  const now = new Date().toISOString();
  let rows;
  try {
    rows = parseMilestones(readFileSync(env.GOAL_PLAN_PATH, 'utf8'));
  } catch (err) {
    await rest(env, 'goal_sync_status', { method: 'POST', headers: upsert, body: JSON.stringify({ user_id, ok: false, error: err.message.slice(0, 300) }) });
    console.error(`goal-sync FAILED: ${err.message}`);
    process.exit(1);
  }
  const existing = await rest(env, `milestones?select=id,status&user_id=eq.${user_id}`);
  const { upserts, dropIds } = planSync(existing, rows);
  await rest(env, 'milestones', { method: 'POST', headers: upsert, body: JSON.stringify(upserts.map((r) => ({ ...r, user_id, updated_at: now }))) });
  if (dropIds.length) {
    await rest(env, `milestones?id=in.(${dropIds.join(',')})`, { method: 'PATCH', body: JSON.stringify({ status: 'dropped', updated_at: now }) });
  }
  await rest(env, 'goal_sync_status', { method: 'POST', headers: upsert, body: JSON.stringify({ user_id, synced_at: now, ok: true, error: null }) });
  console.log(`goal-sync ok: ${upserts.length} milestones, ${dropIds.length} dropped`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((err) => { console.error(`goal-sync ERROR: ${err.message}`); process.exit(2); });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tools/goal-sync.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/goal-sync.mjs tools/goal-sync.test.js
git commit -m "feat(hub): goal-sync parses the master plan's milestone table"
```

---

### Task 4: `nudge` edge function

**Files:**
- Create: `supabase/functions/_shared/push.ts`, `supabase/functions/_shared/hub-db.ts`, `supabase/functions/nudge/handler.ts`, `supabase/functions/nudge/index.ts`
- Test: `supabase/functions/nudge/handler_test.ts`

**Interfaces:**
- Consumes: everything from Task 2.
- Produces: `PushSender { send(sub, payload: string): Promise<{status:number}> }`, `createWebPushSender(v)`; `HubDb` (below) and `makeDb(sb, userId)`; `handleNudge(req: Request, deps: {env:{JOB_SECRET,CHECKIN_SECRET,OWNER_USER_ID,CHECKIN_URL}, db: HubDb, sender: PushSender, now: () => Date}): Promise<Response>`.

- [ ] **Step 1: Write the failing test**

```ts
import { assertEquals } from 'jsr:@std/assert@1';
import { handleNudge } from './handler.ts';

const MS = [{ id: 'm1', title: '副业上架', due: '2026-11-01', status: 'doing', next_step: '写资料页' }];
const SUB = { id: 1, user_id: 'u1', endpoint: 'https://push.example/1', p256dh: 'k', auth: 'a', created_at: '2026-10-01T00:00:00Z' };

function deps(over: Record<string, unknown> = {}) {
  const sent: string[] = [];
  const deleted: number[] = [];
  const d = {
    env: { JOB_SECRET: 'js', CHECKIN_SECRET: 'cs', OWNER_USER_ID: 'u1', CHECKIN_URL: 'https://x/functions/v1/checkin' },
    db: {
      listMilestones: () => Promise.resolve(MS),
      listCheckins: () => Promise.resolve([] as { day: string; done: boolean }[]),
      listSubscriptions: () => Promise.resolve([SUB]),
      deleteSubscription: (id: number) => { deleted.push(id); return Promise.resolve(); },
      getSyncStatus: () => Promise.resolve({ synced_at: '2026-10-19T23:00:00Z', ok: true, error: null }),
      upsertCheckin: () => Promise.resolve(),
    },
    sender: { send: (_s: unknown, p: string) => { sent.push(p); return Promise.resolve({ status: 201 }); } },
    now: () => new Date('2026-10-20T13:00:00Z'),
    ...over,
  };
  return { d, sent, deleted };
}
const req = (mode: string, secret = 'js') =>
  new Request(`https://x/functions/v1/nudge?mode=${mode}`, { method: 'POST', headers: { 'x-job-secret': secret } });

Deno.test('wrong job secret is 401 and sends nothing', async () => {
  const { d, sent } = deps();
  assertEquals((await handleNudge(req('evening', 'nope'), d)).status, 401);
  assertEquals(sent.length, 0);
});

Deno.test('evening sends the focus with a token for today', async () => {
  const { d, sent } = deps();
  assertEquals((await handleNudge(req('evening'), d)).status, 200);
  const p = JSON.parse(sent[0]);
  assertEquals(p.body, '副业上架：写资料页。做了吗？');
  assertEquals(p.data.day, '2026-10-20');
  assertEquals(typeof p.data.token, 'string');
});

Deno.test('a 410 subscription is deleted', async () => {
  const { d, deleted } = deps({ sender: { send: () => Promise.resolve({ status: 410 }) } });
  await handleNudge(req('evening'), d);
  assertEquals(deleted, [1]);
});

Deno.test('drift mode with healthy checkins and fresh sync sends nothing', async () => {
  const { d, sent } = deps({
    now: () => new Date('2026-10-20T00:00:00Z'),
    db: { ...deps().d.db, listCheckins: () => Promise.resolve([{ day: '2026-10-19', done: true }]) },
  });
  await handleNudge(req('drift'), d);
  assertEquals(sent.length, 0);
});

Deno.test('drift mode with healthy checkins still sends a stale-sync notice', async () => {
  const { d, sent } = deps({
    now: () => new Date('2026-10-20T00:00:00Z'),
    db: {
      ...deps().d.db,
      listCheckins: () => Promise.resolve([{ day: '2026-10-19', done: true }]),
      getSyncStatus: () => Promise.resolve({ synced_at: '2026-10-10T00:00:00Z', ok: true, error: null }),
    },
  });
  await handleNudge(req('drift'), d);
  assertEquals(JSON.parse(sent[0]).title, '目标数据异常');
});

Deno.test('drift mode with three silent days alerts', async () => {
  const { d, sent } = deps({ now: () => new Date('2026-10-20T00:00:00Z') });
  await handleNudge(req('drift'), d);
  assertEquals(JSON.parse(sent[0]).title.startsWith('主线已停'), true);
});

Deno.test('unknown mode is 400', async () => {
  const { d } = deps();
  assertEquals((await handleNudge(req('noon'), d)).status, 400);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test -A --no-check supabase/functions/nudge/`
Expected: FAIL — `handler.ts` not found.

- [ ] **Step 3: Implement `_shared/push.ts`** (pattern from `~/tanfood/supabase/functions/_shared/push.ts`; read it, do not edit it)

```ts
// Web Push sender. Same pattern as tanfood's _shared/push.ts: web-push only
// encrypts (RFC 8291) and signs (VAPID, RFC 8292); Deno's fetch sends.
import webpush from 'npm:web-push@3';

export interface PushSubscriptionRow { id: number; endpoint: string; p256dh: string; auth: string; created_at: string }
export interface PushSender { send(sub: PushSubscriptionRow, payload: string): Promise<{ status: number }> }

const TTL_SECONDS = 86_400;
const TIMEOUT_MS = 10_000;

export function createWebPushSender(v: { publicKey: string; privateKey: string; subject: string }): PushSender {
  return {
    async send(sub, payload) {
      if (!sub.endpoint.startsWith('https://') || sub.endpoint.length > 1024) return { status: 0 };
      try {
        const d = webpush.generateRequestDetails(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { vapidDetails: { subject: v.subject, publicKey: v.publicKey, privateKey: v.privateKey }, TTL: TTL_SECONDS },
        );
        const res = await fetch(d.endpoint, { method: d.method, headers: d.headers, body: d.body, signal: AbortSignal.timeout(TIMEOUT_MS) });
        await res.body?.cancel();
        return { status: res.status };
      } catch (e) {
        // The endpoint is a live push capability — never log it.
        console.error('push send_error', e instanceof Error ? e.name : typeof e);
        return { status: 0 };
      }
    },
  };
}
```

- [ ] **Step 4: Implement `_shared/hub-db.ts`**

```ts
// Data access for the check-in loop. Service-role client, scoped to the single owner.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { PushSubscriptionRow } from './push.ts';

export interface Milestone { id: string; title: string; due: string; status: string; next_step: string }
export interface HubDb {
  listMilestones(): Promise<Milestone[]>;
  listCheckins(fromDay: string): Promise<{ day: string; done: boolean }[]>;
  listSubscriptions(): Promise<PushSubscriptionRow[]>;
  deleteSubscription(id: number): Promise<void>;
  getSyncStatus(): Promise<{ synced_at: string | null; ok: boolean; error: string | null } | null>;
  upsertCheckin(row: { day: string; milestone_id: string; done: boolean }): Promise<void>;
}

function must<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error;
  return r.data;
}

export function makeDb(sb: SupabaseClient, userId: string): HubDb {
  return {
    async listMilestones() {
      return must(await sb.from('milestones').select('id,title,due,status,next_step').eq('user_id', userId)) ?? [];
    },
    async listCheckins(fromDay) {
      return must(await sb.from('checkins').select('day,done').eq('user_id', userId).gte('day', fromDay)) ?? [];
    },
    async listSubscriptions() {
      return must(await sb.from('push_subscriptions').select('id,endpoint,p256dh,auth,created_at').eq('user_id', userId)) ?? [];
    },
    async deleteSubscription(id) {
      must(await sb.from('push_subscriptions').delete().eq('id', id));
    },
    async getSyncStatus() {
      return must(await sb.from('goal_sync_status').select('synced_at,ok,error').eq('user_id', userId).maybeSingle());
    },
    async upsertCheckin(row) {
      must(await sb.from('checkins').upsert({ ...row, user_id: userId, answered_at: new Date().toISOString() }, { onConflict: 'user_id,day' }));
    },
  };
}
```

- [ ] **Step 5: Implement `nudge/handler.ts`**

```ts
import {
  addDays, driftMessage, evaluateDrift, eveningMessage, localDay, mintToken, pickFocus, syncNotice,
} from '../_shared/hub-core.js';
import type { HubDb } from '../_shared/hub-db.ts';
import type { PushSender } from '../_shared/push.ts';

export interface NudgeDeps {
  env: { JOB_SECRET: string; CHECKIN_SECRET: string; OWNER_USER_ID: string; CHECKIN_URL: string };
  db: HubDb;
  sender: PushSender;
  now: () => Date;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export async function handleNudge(req: Request, deps: NudgeDeps): Promise<Response> {
  if (!deps.env.JOB_SECRET || req.headers.get('x-job-secret') !== deps.env.JOB_SECRET) {
    return new Response('unauthorized', { status: 401 });
  }
  const mode = new URL(req.url).searchParams.get('mode');
  if (mode !== 'evening' && mode !== 'drift') return new Response('mode must be evening|drift', { status: 400 });

  const now = deps.now();
  const today = localDay(now);
  const [milestones, status, subs] = await Promise.all([
    deps.db.listMilestones(), deps.db.getSyncStatus(), deps.db.listSubscriptions(),
  ]);
  if (!subs.length) return json({ sent: 0, reason: 'no subscriptions' });
  const notice = syncNotice({ status, now });
  const focus = pickFocus(milestones);

  let payload;
  if (mode === 'evening') {
    const token = focus
      ? await mintToken(deps.env.CHECKIN_SECRET, { userId: deps.env.OWNER_USER_ID, day: today, milestoneId: focus.id })
      : null;
    payload = eveningMessage({ focus, day: today, token, checkinUrl: deps.env.CHECKIN_URL, notice });
  } else {
    const since = localDay(new Date(Math.min(...subs.map((s) => Date.parse(s.created_at)))));
    const checkins = await deps.db.listCheckins(addDays(today, -60));
    payload = driftMessage({ drift: evaluateDrift({ today, checkins, since }), focus, notice });
    if (!payload) return json({ sent: 0 });
  }

  let sent = 0;
  for (const s of subs) {
    const { status: code } = await deps.sender.send(s, JSON.stringify(payload));
    if (code === 404 || code === 410) await deps.db.deleteSubscription(s.id);
    else if (code >= 200 && code < 300) sent++;
    else console.error('push status', code);
  }
  return json({ sent });
}
```

- [ ] **Step 6: Implement `nudge/index.ts`**

```ts
// Deploy: supabase functions deploy nudge --no-verify-jwt
// Called by pg_cron (21:00 and 08:00 MYT); guarded by X-Job-Secret == JOB_SECRET.
// Secrets: JOB_SECRET, CHECKIN_SECRET, OWNER_USER_ID, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { makeDb } from '../_shared/hub-db.ts';
import { createWebPushSender } from '../_shared/push.ts';
import { handleNudge } from './handler.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const SUPABASE_URL = env('SUPABASE_URL');

Deno.serve((req) =>
  handleNudge(req, {
    env: {
      JOB_SECRET: env('JOB_SECRET'),
      CHECKIN_SECRET: env('CHECKIN_SECRET'),
      OWNER_USER_ID: env('OWNER_USER_ID'),
      CHECKIN_URL: `${SUPABASE_URL}/functions/v1/checkin`,
    },
    db: makeDb(createClient(SUPABASE_URL, env('SUPABASE_SERVICE_ROLE_KEY')), env('OWNER_USER_ID')),
    sender: createWebPushSender({ publicKey: env('VAPID_PUBLIC_KEY'), privateKey: env('VAPID_PRIVATE_KEY'), subject: env('VAPID_SUBJECT') }),
    now: () => new Date(),
  })
);
```

- [ ] **Step 7: Run to verify pass**

Run: `deno test -A --no-check supabase/functions/nudge/ && deno check supabase/functions/nudge/index.ts`
Expected: all PASS; check clean.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/_shared/push.ts supabase/functions/_shared/hub-db.ts supabase/functions/nudge
git commit -m "feat(hub): nudge edge function — evening focus push and morning drift alert"
```

---

### Task 5: `checkin` edge function

**Files:**
- Create: `supabase/functions/checkin/handler.ts`, `supabase/functions/checkin/index.ts`
- Test: `supabase/functions/checkin/handler_test.ts`

**Interfaces:**
- Consumes: `parseCheckinBody`, `verifyToken`, `localDay`, `mintToken` (tests) from Task 2; `HubDb.upsertCheckin`, `makeDb` from Task 4.
- Produces: `POST /functions/v1/checkin` body `{day, milestone_id, done, token}` → 204 | 400 | 403 | 405; CORS for `https://weng-yong-aipm.github.io`.

- [ ] **Step 1: Write the failing test**

```ts
import { assertEquals } from 'jsr:@std/assert@1';
import { mintToken } from '../_shared/hub-core.js';
import { handleCheckin } from './handler.ts';

const ORIGIN = 'https://weng-yong-aipm.github.io';
function deps(now: string) {
  const writes: unknown[] = [];
  return {
    writes,
    d: {
      env: { CHECKIN_SECRET: 'cs', OWNER_USER_ID: 'u1', APP_ORIGIN: ORIGIN },
      db: { upsertCheckin: (r: unknown) => { writes.push(r); return Promise.resolve(); } },
      now: () => new Date(now),
    },
  };
}
const post = (body: unknown) =>
  new Request('https://x/functions/v1/checkin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

Deno.test('preflight answers with CORS for the app origin', async () => {
  const { d } = deps('2026-10-20T13:05:00Z');
  const r = await handleCheckin(new Request('https://x/functions/v1/checkin', { method: 'OPTIONS' }), d);
  assertEquals(r.status, 204);
  assertEquals(r.headers.get('access-control-allow-origin'), ORIGIN);
});

Deno.test('a valid tap writes and returns 204', async () => {
  const { d, writes } = deps('2026-10-20T13:05:00Z');
  const token = await mintToken('cs', { userId: 'u1', day: '2026-10-20', milestoneId: 'm1' });
  const r = await handleCheckin(post({ day: '2026-10-20', milestone_id: 'm1', done: true, token }), d);
  assertEquals(r.status, 204);
  assertEquals(writes, [{ day: '2026-10-20', milestone_id: 'm1', done: true }]);
});

Deno.test('checkin writes the day from the push, not today (tap after midnight)', async () => {
  const { d, writes } = deps('2026-10-20T16:30:00Z'); // 00:30 MYT on the 21st
  const token = await mintToken('cs', { userId: 'u1', day: '2026-10-20', milestoneId: 'm1' });
  assertEquals((await handleCheckin(post({ day: '2026-10-20', milestone_id: 'm1', done: false, token }), d)).status, 204);
  assertEquals(writes, [{ day: '2026-10-20', milestone_id: 'm1', done: false }]);
});

Deno.test('a forged or expired token is 403 and writes nothing', async () => {
  const { d, writes } = deps('2026-10-22T13:05:00Z');
  const token = await mintToken('cs', { userId: 'u1', day: '2026-10-20', milestoneId: 'm1' });
  assertEquals((await handleCheckin(post({ day: '2026-10-20', milestone_id: 'm1', done: true, token }), d)).status, 403);
  assertEquals((await handleCheckin(post({ day: '2026-10-22', milestone_id: 'm1', done: true, token: 'forged' }), d)).status, 403);
  assertEquals(writes.length, 0);
});

Deno.test('a malformed body is 400', async () => {
  const { d } = deps('2026-10-20T13:05:00Z');
  assertEquals((await handleCheckin(post({ day: 'x' }), d)).status, 400);
  const bad = new Request('https://x/functions/v1/checkin', { method: 'POST', body: '{' });
  assertEquals((await handleCheckin(bad, d)).status, 400);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test -A --no-check supabase/functions/checkin/`
Expected: FAIL — `handler.ts` not found.

- [ ] **Step 3: Implement `checkin/handler.ts`**

```ts
import { localDay, parseCheckinBody, verifyToken } from '../_shared/hub-core.js';
import type { HubDb } from '../_shared/hub-db.ts';

export interface CheckinDeps {
  env: { CHECKIN_SECRET: string; OWNER_USER_ID: string; APP_ORIGIN: string };
  db: Pick<HubDb, 'upsertCheckin'>;
  now: () => Date;
}

export async function handleCheckin(req: Request, deps: CheckinDeps): Promise<Response> {
  const cors = {
    'access-control-allow-origin': deps.env.APP_ORIGIN,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
  const reply = (status: number) => new Response(null, { status, headers: cors });
  if (req.method === 'OPTIONS') return reply(204);
  if (req.method !== 'POST') return reply(405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reply(400);
  }
  const c = parseCheckinBody(body);
  if (!c) return reply(400);
  const valid = await verifyToken(deps.env.CHECKIN_SECRET, {
    userId: deps.env.OWNER_USER_ID, day: c.day, milestoneId: c.milestone_id, token: c.token, today: localDay(deps.now()),
  });
  if (!valid) return reply(403);
  // Last answer of the day wins: the upsert is on (user_id, day).
  await deps.db.upsertCheckin({ day: c.day, milestone_id: c.milestone_id, done: c.done });
  return reply(204);
}
```

- [ ] **Step 4: Implement `checkin/index.ts`**

```ts
// Deploy: supabase functions deploy checkin --no-verify-jwt
// Called by the service worker with no session; the HMAC token minted by
// `nudge` is the only credential, bound to one day and one milestone.
// Secrets: CHECKIN_SECRET, OWNER_USER_ID
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { makeDb } from '../_shared/hub-db.ts';
import { handleCheckin } from './handler.ts';

const env = (k: string) => Deno.env.get(k) ?? '';

Deno.serve((req) =>
  handleCheckin(req, {
    env: { CHECKIN_SECRET: env('CHECKIN_SECRET'), OWNER_USER_ID: env('OWNER_USER_ID'), APP_ORIGIN: 'https://weng-yong-aipm.github.io' },
    db: makeDb(createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY')), env('OWNER_USER_ID')),
    now: () => new Date(),
  })
);
```

- [ ] **Step 5: Run to verify pass**

Run: `deno test -A --no-check supabase/functions/ && deno check supabase/functions/checkin/index.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/checkin
git commit -m "feat(hub): checkin edge function — one-tap answer from the notification"
```

---

### Task 6: PWA — service worker handlers and `开启提醒`

**Files:**
- Create: `settings/push-subscribe.js`, `settings/push-subscribe.test.js`
- Modify: `service-worker.js` (bump `CACHE` to `life-os-v11`, add `'./settings/push-subscribe.js'` to `ASSETS` after `'./settings/settings-repo.js'`, append handlers), `config.js` (add `VAPID_PUBLIC_KEY`), `settings/index.html` (new section), `settings/settings-ui.js` (wire button)

**Interfaces:**
- Produces: `urlBase64ToUint8Array(s): Uint8Array`, `pushStateLabel({supported, permission, subscribed}): string`, `classifyCheckinResult(statusOrError): 'ok'|'retry'|'expired'`.
- Consumes: `push_subscriptions` (Task 1); notification payload shape from Task 2 (`data.{day,milestone_id,token,checkinUrl}` or `data.open`).

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { urlBase64ToUint8Array, pushStateLabel, classifyCheckinResult } from './push-subscribe.js';

test('urlBase64ToUint8Array decodes unpadded base64url', () => {
  assert.deepEqual([...urlBase64ToUint8Array('AQID_-8')], [1, 2, 3, 255, 239]);
});

test('pushStateLabel covers every state the button can be in', () => {
  assert.equal(pushStateLabel({ supported: false }), '这个浏览器不支持推送');
  assert.equal(pushStateLabel({ supported: true, permission: 'denied' }), '通知被拦截了：请在 Chrome 网站设置里允许通知');
  assert.equal(pushStateLabel({ supported: true, permission: 'granted', subscribed: true }), '提醒已开启');
  assert.equal(pushStateLabel({ supported: true, permission: 'default', subscribed: false }), '提醒未开启');
});

test('classifyCheckinResult: 403 is expired, not retry', () => {
  assert.equal(classifyCheckinResult(204), 'ok');
  assert.equal(classifyCheckinResult(403), 'expired');
  assert.equal(classifyCheckinResult(400), 'expired');
  assert.equal(classifyCheckinResult(500), 'retry');
  assert.equal(classifyCheckinResult(new TypeError('Failed to fetch')), 'retry');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test settings/push-subscribe.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `settings/push-subscribe.js`**

```js
/* Pure helpers for the nightly check-in push. No I/O. classifyCheckinResult is
 * duplicated inline in service-worker.js (a classic worker cannot import ES
 * modules); keep the two in step. */

export function urlBase64ToUint8Array(s) {
  const b64 = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function pushStateLabel({ supported, permission, subscribed }) {
  if (!supported) return '这个浏览器不支持推送';
  if (permission === 'denied') return '通知被拦截了：请在 Chrome 网站设置里允许通知';
  return subscribed ? '提醒已开启' : '提醒未开启';
}

/* 4xx means the token or body will never be accepted — retrying would loop the
 * notification forever. Only network errors and 5xx are worth a second tap. */
export function classifyCheckinResult(r) {
  if (typeof r !== 'number') return 'retry';
  if (r >= 200 && r < 300) return 'ok';
  if (r >= 400 && r < 500) return 'expired';
  return 'retry';
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test settings/push-subscribe.test.js`
Expected: PASS.

- [ ] **Step 5: Add the VAPID public key to `config.js`** (public by design; the value comes from Task 8 Step 1 — until then leave it empty, which keeps the button disabled)

```js
// Web Push VAPID public key for the nightly check-in. Public by design: it only
// lets a browser subscribe; the private half lives in Supabase secrets.
export const VAPID_PUBLIC_KEY = '';
```

- [ ] **Step 6: Append handlers to `service-worker.js`** (and bump `CACHE`, add the ASSETS entry)

```js
/* Nightly check-in push. docs/superpowers/specs/2026-10-15-unified-hub-design.md
 * The Done / Not done buttons answer from the notification itself: the app is
 * never opened, which is the whole point — every earlier design that needed
 * the app opened collected zero rows. */
self.addEventListener('push', (e) => {
  let msg = null;
  try { msg = e.data ? e.data.json() : null; } catch { msg = null; }
  if (!msg) return;
  e.waitUntil(self.registration.showNotification(msg.title, {
    body: msg.body, tag: msg.tag, actions: msg.actions || [], data: msg.data || {},
  }));
});

/* Inline copy of classifyCheckinResult from settings/push-subscribe.js. */
function classifyCheckinResult(r) {
  if (typeof r !== 'number') return 'retry';
  if (r >= 200 && r < 300) return 'ok';
  if (r >= 400 && r < 500) return 'expired';
  return 'retry';
}

self.addEventListener('notificationclick', (e) => {
  const n = e.notification;
  const d = n.data || {};
  n.close();
  if ((e.action === 'done' || e.action === 'not_done') && d.checkinUrl) {
    e.waitUntil(
      fetch(d.checkinUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ day: d.day, milestone_id: d.milestone_id, done: e.action === 'done', token: d.token }),
      })
        .then((res) => classifyCheckinResult(res.status), (err) => classifyCheckinResult(err))
        .then((kind) => {
          if (kind === 'retry') {
            return self.registration.showNotification('没记上，再点一次', {
              body: n.body, tag: n.tag, actions: [{ action: 'done', title: '做了' }, { action: 'not_done', title: '没做' }], data: d,
            });
          }
          if (kind === 'expired') {
            return self.registration.showNotification('这条提醒已过期', { body: '等今晚 21:00 的新提醒', data: { open: './plan/' } });
          }
          return undefined;
        })
    );
    return;
  }
  e.waitUntil(self.clients.openWindow(d.open || './plan/'));
});
```

- [ ] **Step 7: Add the settings section** — in `settings/index.html`, insert immediately before `<script type="module" src="settings-ui.js"></script>`:

```html
<section>
  <h2>提醒</h2>
  <p class="hint">每晚 21:00 推送今天主线，直接在通知上点「做了 / 没做」。</p>
  <button type="button" id="push-enable">开启提醒</button>
  <div id="push-status"></div>
</section>
```

- [ ] **Step 8: Wire it in `settings/settings-ui.js`** — add imports at the top and call `initPush()` at the end of `init()`:

```js
import { getClient } from '../db.js';
import { VAPID_PUBLIC_KEY } from '../config.js';
import { urlBase64ToUint8Array, pushStateLabel } from './push-subscribe.js';
```

```js
async function initPush() {
  const btn = document.getElementById('push-enable');
  const status = document.getElementById('push-status');
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && Boolean(VAPID_PUBLIC_KEY);
  const reg = supported ? await navigator.serviceWorker.ready : null;
  const show = async () => {
    const subscribed = Boolean(reg && (await reg.pushManager.getSubscription()));
    status.textContent = pushStateLabel({ supported, permission: supported ? Notification.permission : 'default', subscribed });
    btn.disabled = !supported || subscribed;
  };
  await show();
  btn.addEventListener('click', async () => {
    try {
      if ((await Notification.requestPermission()) !== 'granted') return show();
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
      const j = sub.toJSON();
      const c = await getClient();
      if (!c) throw new Error('需要登录并开启云同步');
      const { error } = await c.from('push_subscriptions').insert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
      if (error && error.code !== '23505') throw error; // 23505: this endpoint is already saved
      await show();
    } catch (err) {
      status.textContent = `开启失败（${err.message}）`;
    }
  });
}
```

- [ ] **Step 9: Run the whole suite** (sw-precache walks the import graph and fails if `push-subscribe.js` is missing from ASSETS)

Run: `npm test`
Expected: PASS, including `tools/sw-precache.test.js`.

- [ ] **Step 10: Commit**

```bash
git add settings/push-subscribe.js settings/push-subscribe.test.js settings/index.html settings/settings-ui.js service-worker.js config.js
git commit -m "feat(hub): one-tap check-in from the notification + 开启提醒 in settings"
```

---

### Task 7: Gate — count taps, freeze the four zero-row modules

**Files:**
- Modify: `tools/gate.mjs`, `tools/gate.test.js`

**Interfaces:**
- Produces: `countTappedDays(today, checkinDays: string[]): number`, `TAP_TARGET = 5`, `effectiveVerdict(mod: {frozen?}, verdict): string` (returns `'FROZEN'` for frozen modules), `gatePasses(verdicts)` treating `'FROZEN'` as non-blocking. Removes `countStreak` (its rule is replaced; owner decision 2026-10-15).

- [ ] **Step 1: Replace the countStreak tests** — in `tools/gate.test.js`, delete the seven tests that call `countStreak` (lines 23–58: "the streak today is 0" through "duplicate rows on one day"), change the import line to `localDateStr, countTappedDays, TAP_TARGET, effectiveVerdict, tableVerdict, moduleVerdict, gatePasses,`, and add:

```js
test('countTappedDays: 5 of the last 7 days, today included', () => {
  assert.equal(countTappedDays(TODAY, [back(0), back(1), back(3), back(4), back(6)]), 5);
  assert.ok(countTappedDays(TODAY, [back(0), back(1), back(3), back(4), back(6)]) >= TAP_TARGET);
});

test('countTappedDays: 4 of 7 fails the target', () => {
  assert.ok(countTappedDays(TODAY, [back(1), back(2), back(3), back(4)]) < TAP_TARGET);
});

test('countTappedDays: days older than the window and duplicates do not count', () => {
  assert.equal(countTappedDays(TODAY, [back(7), back(8), back(0), back(0)]), 1);
});

test('today unanswered still counts the other six days', () => {
  assert.equal(countTappedDays(TODAY, [1, 2, 3, 4, 5, 6].map(back)), 6);
});

test('a frozen module with 0 rows does not block', () => {
  assert.equal(effectiveVerdict({ frozen: true }, 'EMPTY'), 'FROZEN');
  assert.equal(gatePasses(['FROZEN', 'FROZEN', 'OK']), true);
});

test('an unfrozen module with 0 rows still blocks', () => {
  assert.equal(effectiveVerdict({}, 'EMPTY'), 'EMPTY');
  assert.equal(gatePasses(['FROZEN', 'EMPTY']), false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tools/gate.test.js`
Expected: FAIL — `countTappedDays` is not exported.

- [ ] **Step 3: Implement in `tools/gate.mjs`**

Replace `countStreak` (and its comment block) with:

```js
/* The rule as of 2026-10-15 (owner decision, unified-hub spec §3): the gate
 * counts the ONE daily action the check-in loop asks for — a tap on the 21:00
 * push, either answer. The meal+sleep+learning streak it replaces sat at 0/7
 * for two months; the four modules it measured are frozen, not deleted.
 * Distinct days in the last 7 local days, today included. */
export const TAP_TARGET = 5;
export function countTappedDays(today, checkinDays) {
  const days = new Set(checkinDays);
  const cursor = new Date(`${today}T12:00:00`); // midday: immune to DST shifts
  let n = 0;
  for (let i = 0; i < 7; i++) {
    if (days.has(localDateStr(cursor))) n++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}

/* Frozen modules are still probed and printed, never blocking. */
export function effectiveVerdict(mod, verdict) {
  return mod.frozen ? 'FROZEN' : verdict;
}
```

Change `gatePasses` to:

```js
export function gatePasses(moduleVerdicts) {
  return moduleVerdicts.length > 0 && moduleVerdicts.every((v) => v === 'OK' || v === 'FROZEN');
}
```

Change `MODULES` to:

```js
const MODULES = [
  { name: 'Check-in', tables: ['checkins'] },
  { name: 'Training', tables: ['mesocycles', 'sessions', 'session_exercises', 'sets'], frozen: true },
  { name: 'Finance', tables: ['receipts', 'expenses', 'work_hours'], frozen: true },
  { name: 'Health', tables: ['meals', 'workouts', 'sleep'], frozen: true },
  { name: 'Capture', tables: ['capture_queue'], frozen: true },
];
```

Change `DONE_CHECK` to:

```js
const DONE_CHECK = `"2026-10-15: the gate counts taps on the nightly check-in push. Phase 2
 (the hub page) starts when >=5 of the last 7 days have a tap. Training,
 Finance, Health and Capture are frozen - shown here, not blocking."`;
```

In `main()`: compute `verdict: effectiveVerdict(mod, moduleVerdict(verdicts))` when pushing results; print `[FROZEN]` for frozen modules (`const mark = r.verdict === 'OK' ? 'PASS' : r.verdict === 'FROZEN' ? 'FROZEN' : 'FAIL';`); replace the three-stream fetch with

```js
    const days = await fetchDates(sb, headers, 'checkins?select=day&order=day.desc&limit=60', 'day');
    streak = countTappedDays(today, days);
```

and the streak printout/verdict with

```js
    console.log(`  ${streak} / 7 days with a check-in tap (need ${TAP_TARGET}).`);
```

```js
  const offenders = results.filter((r) => r.verdict !== 'OK' && r.verdict !== 'FROZEN');
  const pass = gatePasses(results.map((r) => r.verdict)) && streakError === null && streak >= TAP_TARGET;
```

and change the pass/fail lines that say `streak is >= 7` / `required 7` to `TAP_TARGET`. Rename the section header `LOGGING STREAK` → `CHECK-IN TAPS`, and change `WHY THIS GATE EXISTS - his own words, 2026-08-05:` to `WHY THIS GATE EXISTS - owner decision, 2026-10-15:`. Delete the two "Not checked here" lines about thumbnails and phone entry (they described the retired rule).

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/gate.mjs tools/gate.test.js
git commit -m "feat(gate): count check-in taps (>=5 of 7); freeze the four zero-row modules"
```

---

### Task 8: Ship — owner-approved production steps

Each step changes production; ask the owner before running it and show the exact command.

- [ ] **Step 1: VAPID keys** (local, not prod)

Run: `npx --yes web-push@3 generate-vapid-keys --json > ~/.lifeos-vapid.json && chmod 600 ~/.lifeos-vapid.json`
Then put only the `publicKey` value into `config.js` `VAPID_PUBLIC_KEY`, `npm test`, commit `chore(hub): VAPID public key`.

- [ ] **Step 2: Apply the migration** — `supabase db push` (linked project `cfbfiazzvbedsdgwpujs`). Verify: `node tools/gate.mjs` shows `Check-in  EMPTY` (table exists), not `MISSING`.

- [ ] **Step 3: Secrets** — owner runs in their own terminal (values never in chat):

```bash
supabase secrets set JOB_SECRET=$(openssl rand -hex 32) CHECKIN_SECRET=$(openssl rand -hex 32) \
  OWNER_USER_ID=<owner auth user id> VAPID_SUBJECT=mailto:<owner personal email> \
  VAPID_PUBLIC_KEY=$(jq -r .publicKey ~/.lifeos-vapid.json) VAPID_PRIVATE_KEY=$(jq -r .privateKey ~/.lifeos-vapid.json)
```

The JOB_SECRET must also go into Vault for pg_cron: owner runs `select vault.create_secret('<same JOB_SECRET>', 'hub_job_secret');` in the SQL editor.

- [ ] **Step 4: Deploy** — `supabase functions deploy nudge --no-verify-jwt && supabase functions deploy checkin --no-verify-jwt`. Verify: `curl -s -o /dev/null -w '%{http_code}' -X POST "$SUPABASE_URL/functions/v1/nudge?mode=evening"` → `401` (no secret).

- [ ] **Step 5: Schedules** — owner runs in the SQL editor (prod-only, not a migration — it embeds the project URL):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('hub-evening', '0 13 * * *', $$
  select net.http_post(
    url := 'https://cfbfiazzvbedsdgwpujs.supabase.co/functions/v1/nudge?mode=evening',
    headers := jsonb_build_object('content-type', 'application/json',
      'x-job-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'hub_job_secret')),
    body := '{}'::jsonb);
$$);
select cron.schedule('hub-drift', '0 0 * * *', $$
  select net.http_post(
    url := 'https://cfbfiazzvbedsdgwpujs.supabase.co/functions/v1/nudge?mode=drift',
    headers := jsonb_build_object('content-type', 'application/json',
      'x-job-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'hub_job_secret')),
    body := '{}'::jsonb);
$$);
```

Verify: `select jobname, schedule from cron.job where jobname like 'hub-%';` → two rows.

- [ ] **Step 6: goal-sync launchd** — create `~/Library/LaunchAgents/com.wengyong.lifeos-goal-sync.plist` (not in the repo — it names the private plan path):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Master plan -> life-os milestones. StartCalendarInterval (runs once on wake
     if the Mac slept through 07:00) + WatchPaths (runs when the plan is saved).
     Never StartInterval: see com.wengyong.lifeos-db-backup.plist. -->
<plist version="1.0">
<dict>
  <key>Label</key><string>com.wengyong.lifeos-goal-sync</string>
  <key>ProgramArguments</key>
  <array><string>/usr/local/bin/node</string><string>/Users/wengyong/life-os/tools/goal-sync.mjs</string></array>
  <key>WorkingDirectory</key><string>/Users/wengyong/life-os</string>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>0</integer></dict>
  <key>WatchPaths</key><array><string>GOAL_PLAN_PATH_VALUE</string></array>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>/Users/wengyong/Library/Logs/lifeos-goal-sync.log</string>
  <key>StandardErrorPath</key><string>/Users/wengyong/Library/Logs/lifeos-goal-sync.log</string>
</dict>
</plist>
```

Replace `GOAL_PLAN_PATH_VALUE` with the `.env` value, then `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.wengyong.lifeos-goal-sync.plist`. Verify: `tail -1 ~/Library/Logs/lifeos-goal-sync.log` → `goal-sync ok: N milestones` (requires Task 0).

- [ ] **Step 7: Publish the PWA** — push `main` to `origin` (GitHub Pages) using the personal token: `GH_TOKEN=$(gh auth token --user yongsnsoft2025-a11y) git push origin main`. Verify the deployed `service-worker.js` contains `life-os-v11`.

---

### Task 9: drama-scan launchd rider (second-brain repo)

**Files:**
- Modify: `~/second-brain/docs/launchagents/com.wengyong.drama-scan.plist`

- [ ] **Step 1:** `git -C ~/second-brain status -s` — if another session has uncommitted changes to this plist, stop and ask.
- [ ] **Step 2:** Replace the `StartInterval` comment + key with:

```xml
  <!-- StartCalendarInterval, not StartInterval (changed 2026-10-15). The
       earlier reasoning was that calendar jobs fire late; late is fine for a
       daily scan. StartInterval counts awake time and silently stops after
       sleep: com.wengyong.lifeos-db-backup fired once in 11 days that way, and
       this job's own log stopped on 2026-09-07. A calendar slot missed while
       asleep runs once on wake. -->
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>10</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
```

- [ ] **Step 3:** `plutil -lint ~/second-brain/docs/launchagents/com.wengyong.drama-scan.plist` → `OK`.
- [ ] **Step 4 (owner OK):** `cp` it to `~/Library/LaunchAgents/` and `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.wengyong.drama-scan.plist`. Verify: `launchctl print gui/$(id -u)/com.wengyong.drama-scan | grep -E 'state|calendar'`.
- [ ] **Step 5:** Commit in second-brain: `fix(drama-scan): StartCalendarInterval so the daily scan survives sleep`.

---

### Task 10: Done-check (real, on the phone)

- [ ] **Step 1:** Owner opens life-os in Android Chrome → Settings → `开启提醒` → status reads `提醒已开启`.
- [ ] **Step 2:** Trigger once without waiting for 21:00 — owner runs `select net.http_post(url := 'https://cfbfiazzvbedsdgwpujs.supabase.co/functions/v1/nudge?mode=evening', headers := jsonb_build_object('content-type','application/json','x-job-secret',(select decrypted_secret from vault.decrypted_secrets where name='hub_job_secret')), body := '{}'::jsonb);`. Expected: the phone shows `今天主线` with two buttons.
- [ ] **Step 3:** Owner taps `做了` **without opening the app**. Verify: `select day, done, milestone_id from checkins order by answered_at desc limit 1;` → today, `true`.
- [ ] **Step 4:** Next morning: no drift push arrives (a done day is in the window — and fewer than 3 in-scope days exist anyway).
- [ ] **Step 5:** Seven days later: `npm run gate` → `CHECK-IN TAPS  N / 7` and, at N ≥ 5, `GATE PASSES` — the trigger to brainstorm phase 2.
