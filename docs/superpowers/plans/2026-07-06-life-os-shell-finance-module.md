# life-os Shell + Finance Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `life-os` app shell (hub page, shared auth/data layer, PWA install) plus its first module, Finance — receipt-scan spending/nutrition tracking and an OT-pay calculator for Malaysia.

**Architecture:** Vanilla HTML/CSS/JS, no build step, installable PWA — same shape as the existing `~/eat-decider` project. One Supabase project (Postgres + Auth + Storage) with per-user Row Level Security. Receipt photos are parsed by a Supabase Edge Function that calls Claude vision server-side, keeping the Anthropic key off the client. Pay-rate math and date classification are pure, unit-tested functions; UI flows are verified manually against the running PWA.

**Tech Stack:** Vanilla JS (ES modules), HTML5, CSS3, Supabase JS client v2 (`@supabase/supabase-js`, loaded via `esm.sh`, no npm install), Supabase Postgres/Auth/Storage/Edge Functions (Deno), Node's built-in `node:test` runner for unit tests.

## Global Constraints

- No build step, no bundler, no framework — plain `<script type="module">` files, exactly like `~/eat-decider`.
- New Supabase project, separate from `eat-decider`'s. Never reuse that project's credentials.
- The Anthropic API key is a Supabase Edge Function secret ONLY. It must never appear in any client-side `.js` file or be sent to the browser.
- Malaysia public holidays are a static, version-controlled data file (`finance/malaysia-holidays.js`), not a live API — `date.nager.at` was checked and does not cover Malaysia. Update the file every December for the coming year.
- Tests: Node's built-in `node:test` + `node:assert/strict`. Run with `npm test` (`node --test finance/*.test.js`). No test framework dependency to install.
- Repo lives at `~/life-os`, git-initialized, no remote configured yet (adding a GitHub remote is a manual step for the user, out of scope here).
- Git identity: this path is not under `~/Projects/personal/`, so it uses the global git config (same as `~/eat-decider` already does) — no per-repo git config change needed.

---

## File Structure

```
life-os/
├── package.json                 # type: module, test script, zero dependencies
├── .gitignore
├── .env.example
├── config.js                    # Supabase URL/anon key, blank until user fills them
├── index.html                   # hub page: login + module cards
├── app.js                       # hub page logic (auth UI, service worker registration)
├── ui.css                       # shared styles for hub + every module
├── auth.js                      # shared Supabase auth helpers
├── db.js                        # shared Supabase client bootstrap
├── manifest.webmanifest
├── service-worker.js
├── icon.svg
├── README.md
├── supabase/
│   ├── schema.sql                       # all Finance tables + RLS + storage bucket
│   └── functions/
│       └── parse-receipt/
│           └── index.ts                 # Edge Function: Storage -> Claude vision -> JSON
└── finance/
    ├── index.html                # Finance module page (Spending + OT Pay tabs)
    ├── finance.js                 # UI wiring for both tabs
    ├── pay-calc.js                 # pure: classifyDay, calculatePay
    ├── pay-calc.test.js
    ├── malaysia-holidays.js        # static holiday data
    ├── holidays-repo.js            # holidaySetForYear, nameForDate
    ├── holidays-repo.test.js
    ├── pay-settings-repo.js        # per-user settings singleton (Local/Cloud)
    ├── work-hours-repo.js          # work_hours CRUD (Local/Cloud, offline-first)
    └── receipts-repo.js            # receipt upload/parse/save + dashboard queries
```

Each file has one job: `db.js` only knows how to get a Supabase client; `auth.js` only knows sign-in/out; every `*-repo.js` only knows its own table(s); `pay-calc.js` has zero I/O, just math, so it's trivial to test; `finance.js` is the only file that touches the DOM for the Finance module.

---

## Task 1: Repo scaffolding

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `config.js`

**Interfaces:**
- Produces: `SUPABASE_URL: string`, `SUPABASE_ANON_KEY: string` (named exports from `config.js`, consumed by `db.js` in Task 4)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "life-os",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test finance/*.test.js"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
.DS_Store
node_modules/
*.log
.env
.env.local
.vercel/
```

- [ ] **Step 3: Create `.env.example`**

```
# Copy this file to `.env` and fill in real values. `.env` is gitignored.
# The DB password and service-role key are for Postgres/migrations and the
# Edge Function only — the browser client never uses them (it uses
# SUPABASE_URL + SUPABASE_ANON_KEY from config.js).
SUPABASE_DB_PASSWORD=""
SUPABASE_URL=""
SUPABASE_ANON_KEY=""
SUPABASE_SERVICE_ROLE_KEY=""
ANTHROPIC_API_KEY=""
```

- [ ] **Step 4: Create `config.js`**

```js
// Supabase config — fill these from your life-os Supabase project
// (Project Settings -> API). Must be a NEW project, separate from
// eat-decider's.
//   SUPABASE_URL       = "Project URL"
//   SUPABASE_ANON_KEY  = "anon / public" key
//
// The anon key is SAFE to expose in client code: your data is protected by
// Row Level Security (see supabase/schema.sql), so each user only ever reads
// or writes their own rows. Leave both blank to run in local-only mode.
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';
```

- [ ] **Step 5: Verify config.js loads as a module**

Run: `node --input-type=module -e "import('./config.js').then(m => console.log(m.SUPABASE_URL === '' && m.SUPABASE_ANON_KEY === ''))"`
Expected: `true`

- [ ] **Step 6: Commit**

```bash
cd ~/life-os
git add package.json .gitignore .env.example config.js
git commit -m "Scaffold life-os project: package.json, config.js, env template"
```

---

## Task 2: Pay calculation logic (`pay-calc.js`)

**Files:**
- Create: `finance/pay-calc.js`
- Test: `finance/pay-calc.test.js`

**Interfaces:**
- Consumes: nothing (pure module)
- Produces: `classifyDay(dateStr: string, holidayDates: Set<string>): 'workday' | 'weekend' | 'holiday'`, `calculatePay({hours: number, dayType: string, settings: {baseHourlyRate: number, weekendMultiplier: number, holidayMultiplier: number}}): number` — used by `finance.js` (Task 8) and tested against `holidays-repo.js` (Task 3)

- [ ] **Step 1: Write the failing tests**

Create `finance/pay-calc.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDay, calculatePay } from './pay-calc.js';

test('classifyDay: known holiday date returns holiday even on a weekday', () => {
  const holidays = new Set(['2026-08-31']); // Monday, Merdeka Day
  assert.equal(classifyDay('2026-08-31', holidays), 'holiday');
});

test('classifyDay: holiday overlapping a weekend still returns holiday, not weekend', () => {
  const holidays = new Set(['2026-03-21']); // Saturday, Hari Raya Aidilfitri
  assert.equal(classifyDay('2026-03-21', holidays), 'holiday');
});

test('classifyDay: Saturday with no matching holiday returns weekend', () => {
  assert.equal(classifyDay('2026-07-11', new Set()), 'weekend');
});

test('classifyDay: weekday with no matching holiday returns workday', () => {
  assert.equal(classifyDay('2026-07-13', new Set()), 'workday');
});

test('calculatePay: workday uses base rate with no multiplier', () => {
  const settings = { baseHourlyRate: 20, weekendMultiplier: 1.5, holidayMultiplier: 2 };
  assert.equal(calculatePay({ hours: 8, dayType: 'workday', settings }), 160);
});

test('calculatePay: weekend applies weekend multiplier', () => {
  const settings = { baseHourlyRate: 20, weekendMultiplier: 1.5, holidayMultiplier: 2 };
  assert.equal(calculatePay({ hours: 8, dayType: 'weekend', settings }), 240);
});

test('calculatePay: holiday applies holiday multiplier', () => {
  const settings = { baseHourlyRate: 20, weekendMultiplier: 1.5, holidayMultiplier: 2 };
  assert.equal(calculatePay({ hours: 8, dayType: 'holiday', settings }), 320);
});

test('calculatePay: rounds to 2 decimal places', () => {
  const settings = { baseHourlyRate: 19.99, weekendMultiplier: 1.5, holidayMultiplier: 2 };
  assert.equal(calculatePay({ hours: 3, dayType: 'workday', settings }), 59.97);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test finance/pay-calc.test.js`
Expected: FAIL — `Cannot find module './pay-calc.js'`

- [ ] **Step 3: Write the implementation**

Create `finance/pay-calc.js`:

```js
/* Pure pay-rate logic — no I/O, safe to unit test directly. */

export function classifyDay(dateStr, holidayDates) {
  if (holidayDates.has(dateStr)) return 'holiday';
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return (dow === 0 || dow === 6) ? 'weekend' : 'workday';
}

export function calculatePay({ hours, dayType, settings }) {
  const multiplier =
    dayType === 'holiday' ? settings.holidayMultiplier :
    dayType === 'weekend' ? settings.weekendMultiplier :
    1;
  return Math.round(hours * settings.baseHourlyRate * multiplier * 100) / 100;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test finance/pay-calc.test.js`
Expected: PASS, 8 tests passing

- [ ] **Step 5: Commit**

```bash
cd ~/life-os
git add finance/pay-calc.js finance/pay-calc.test.js
git commit -m "Add pay-calc.js: pure day classification and pay math, unit tested"
```

---

## Task 3: Malaysia holiday data (`malaysia-holidays.js` + `holidays-repo.js`)

**Files:**
- Create: `finance/malaysia-holidays.js`
- Create: `finance/holidays-repo.js`
- Test: `finance/holidays-repo.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `holidaySetForYear(year: number): Set<string>`, `nameForDate(dateStr: string): string | null` — consumed by `finance.js` (Task 8), matches the `holidayDates` argument shape expected by `classifyDay` (Task 2)

- [ ] **Step 1: Create the static holiday data file**

Create `finance/malaysia-holidays.js`:

```js
/* Malaysia national public holidays.
 *
 * Best-effort list compiled 2026-07-06 from officeholidays.com and
 * calendar-malaysia.com. State-specific holidays (Thaipusam, state rulers'
 * birthdays, etc.) are NOT included — verify against your own state's
 * official gazette if those matter to you. Hari Raya dates are subject to
 * moon-sighting confirmation and may shift by a day near the observance.
 *
 * Add a new MALAYSIA_HOLIDAYS_<year> array every December for the coming
 * year and spread it into ALL_HOLIDAYS below.
 */

export const MALAYSIA_HOLIDAYS_2026 = [
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-02-17', name: 'Chinese New Year' },
  { date: '2026-02-18', name: 'Chinese New Year Holiday' },
  { date: '2026-03-07', name: 'Nuzul Al-Quran' },
  { date: '2026-03-21', name: 'Hari Raya Aidilfitri' },
  { date: '2026-03-22', name: 'Hari Raya Aidilfitri Holiday' },
  { date: '2026-05-01', name: 'Labour Day' },
  { date: '2026-05-27', name: 'Hari Raya Haji' },
  { date: '2026-05-31', name: 'Wesak Day' },
  { date: '2026-06-01', name: 'Birthday of SPB Yang di-Pertuan Agong' },
  { date: '2026-06-17', name: 'Awal Muharram' },
  { date: '2026-08-25', name: 'Maulidur Rasul' },
  { date: '2026-08-31', name: 'Merdeka Day (National Day)' },
  { date: '2026-09-16', name: 'Malaysia Day' },
  { date: '2026-11-08', name: 'Deepavali' },
  { date: '2026-12-25', name: 'Christmas Day' },
];

export const ALL_HOLIDAYS = [...MALAYSIA_HOLIDAYS_2026];
```

- [ ] **Step 2: Write the failing tests**

Create `finance/holidays-repo.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { holidaySetForYear, nameForDate } from './holidays-repo.js';

test('holidaySetForYear returns only dates for the given year', () => {
  const set2026 = holidaySetForYear(2026);
  assert.ok(set2026.has('2026-08-31'));
  assert.ok(!set2026.has('2025-08-31'));
});

test('holidaySetForYear returns an empty set for a year with no data yet', () => {
  const set2030 = holidaySetForYear(2030);
  assert.equal(set2030.size, 0);
});

test('nameForDate returns the holiday name for a known date', () => {
  assert.equal(nameForDate('2026-08-31'), 'Merdeka Day (National Day)');
});

test('nameForDate returns null for a non-holiday date', () => {
  assert.equal(nameForDate('2026-07-13'), null);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test finance/holidays-repo.test.js`
Expected: FAIL — `Cannot find module './holidays-repo.js'`

- [ ] **Step 4: Write the implementation**

Create `finance/holidays-repo.js`:

```js
import { ALL_HOLIDAYS } from './malaysia-holidays.js';

export function holidaySetForYear(year) {
  const prefix = String(year);
  return new Set(
    ALL_HOLIDAYS.filter((h) => h.date.startsWith(prefix)).map((h) => h.date)
  );
}

export function nameForDate(dateStr) {
  const match = ALL_HOLIDAYS.find((h) => h.date === dateStr);
  return match ? match.name : null;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test finance/holidays-repo.test.js`
Expected: PASS, 4 tests passing

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS, 12 tests passing (8 from Task 2 + 4 from this task)

- [ ] **Step 7: Commit**

```bash
cd ~/life-os
git add finance/malaysia-holidays.js finance/holidays-repo.js finance/holidays-repo.test.js
git commit -m "Add static Malaysia holiday data and holidays-repo, unit tested"
```

---

## Task 4: Shared Supabase client and auth (`db.js` + `auth.js`)

**Files:**
- Create: `db.js`
- Create: `auth.js`

**Interfaces:**
- Consumes: `SUPABASE_URL`, `SUPABASE_ANON_KEY` from `config.js` (Task 1)
- Produces: `getClient(): Promise<SupabaseClient | null>`, `cloudEnabled: boolean` (from `db.js`); `Auth.session()`, `Auth.signIn(email, password)`, `Auth.signUp(email, password)`, `Auth.signOut()`, `Auth.onChange(cb)` (from `auth.js`) — consumed by `app.js` (Task 5) and every `finance/*-repo.js` (Tasks 7, 10)

- [ ] **Step 1: Create `db.js`**

```js
/* Shared Supabase client bootstrap. Every module's repo files import
 * getClient()/cloudEnabled from here instead of creating their own client. */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const cloudEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let sb = null;
export async function getClient() {
  if (!cloudEnabled) return null;
  if (sb) return sb;
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return sb;
}
```

- [ ] **Step 2: Create `auth.js`**

```js
import { getClient, cloudEnabled } from './db.js';

export { cloudEnabled };

export const Auth = {
  async session() {
    const c = await getClient();
    if (!c) return null;
    const { data } = await c.auth.getSession();
    return data.session;
  },
  async signIn(email, password) {
    const c = await getClient();
    return c.auth.signInWithPassword({ email, password });
  },
  async signUp(email, password) {
    const c = await getClient();
    return c.auth.signUp({ email, password });
  },
  async signOut() {
    const c = await getClient();
    return c.auth.signOut();
  },
  async onChange(cb) {
    const c = await getClient();
    if (!c) return;
    c.auth.onAuthStateChange((_event, session) => cb(session));
  },
};
```

- [ ] **Step 3: Verify both modules load without error**

Run: `node --input-type=module -e "import('./db.js').then(m => console.log(typeof m.getClient, m.cloudEnabled))"`
Expected: `function false` (cloud disabled — config.js is still blank at this point)

Run: `node --input-type=module -e "import('./auth.js').then(m => console.log(typeof m.Auth.signIn))"`
Expected: `function`

- [ ] **Step 4: Commit**

```bash
cd ~/life-os
git add db.js auth.js
git commit -m "Add shared Supabase client bootstrap and auth helpers"
```

---

## Task 5: Hub page and PWA shell

**Files:**
- Create: `index.html`
- Create: `app.js`
- Create: `ui.css`
- Create: `manifest.webmanifest`
- Create: `service-worker.js`
- Create: `icon.svg`

**Interfaces:**
- Consumes: `Auth`, `cloudEnabled` from `auth.js` (Task 4)
- Produces: nothing consumed by later tasks (the hub links to `./finance/index.html`, wired in Task 12)

- [ ] **Step 1: Create `ui.css`**

```css
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --fg: #14110f;
  --accent: #2a6df4;
  --border: #d8d8d8;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #14110f; --fg: #f2f2f2; --border: #3a3a3a; }
}
* { box-sizing: border-box; }
body {
  margin: 0; font-family: system-ui, sans-serif;
  background: var(--bg); color: var(--fg);
  padding: 1rem; max-width: 720px; margin-inline: auto;
}
header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; }
header a { color: var(--accent); text-decoration: none; }
.hub-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 1rem; }
.hub-card {
  border: 1px solid var(--border); border-radius: 8px; padding: 1rem;
  text-decoration: none; color: inherit; display: block;
}
.hub-card.disabled { opacity: 0.5; pointer-events: none; }
.tabs { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
.tab-btn { padding: 0.5rem 1rem; border: 1px solid var(--border); background: none; color: inherit; border-radius: 6px; cursor: pointer; }
.tab-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }
.tab-panel { display: none; }
.tab-panel.active { display: block; }
form { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1rem; max-width: 420px; }
label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.9rem; }
input, button { padding: 0.5rem; border: 1px solid var(--border); border-radius: 6px; font-size: 1rem; background: var(--bg); color: var(--fg); }
button { cursor: pointer; }
table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; }
td, th { border-bottom: 1px solid var(--border); padding: 0.4rem; text-align: left; }
```

- [ ] **Step 2: Create `index.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>life-os</title>
<link rel="stylesheet" href="ui.css" />
<link rel="manifest" href="manifest.webmanifest" />
<link rel="icon" href="icon.svg" />
</head>
<body>
<header>
  <h1>life-os</h1>
  <span id="auth-status"></span>
</header>

<div id="login-box">
  <form id="login-form">
    <label>Email <input type="email" id="login-email" required /></label>
    <label>Password <input type="password" id="login-password" required /></label>
    <button type="submit">Sign in</button>
    <button type="button" id="signup-btn">Create account</button>
  </form>
</div>

<nav class="hub-grid">
  <a class="hub-card" href="./finance/index.html">Finance</a>
  <a class="hub-card disabled" href="#">Career (coming soon)</a>
  <a class="hub-card disabled" href="#">Learning (coming soon)</a>
  <a class="hub-card disabled" href="#">Invest (coming soon)</a>
  <a class="hub-card disabled" href="#">Health (coming soon)</a>
</nav>

<script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create `app.js`**

```js
import { Auth, cloudEnabled } from './auth.js';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js');
}

const statusEl = document.getElementById('auth-status');
const loginBox = document.getElementById('login-box');

async function refreshAuthUI() {
  if (!cloudEnabled) {
    statusEl.textContent = 'local mode (no Supabase config yet)';
    loginBox.hidden = true;
    return;
  }
  const session = await Auth.session();
  if (session) {
    statusEl.textContent = `signed in as ${session.user.email}`;
    loginBox.hidden = true;
  } else {
    statusEl.textContent = 'signed out';
    loginBox.hidden = false;
  }
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const { error } = await Auth.signIn(email, password);
  if (error) { alert(error.message); return; }
  refreshAuthUI();
});

document.getElementById('signup-btn').addEventListener('click', async () => {
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const { error } = await Auth.signUp(email, password);
  if (error) { alert(error.message); return; }
  alert('Account created — check your email if confirmation is required, then sign in.');
});

refreshAuthUI();
```

- [ ] **Step 4: Create `manifest.webmanifest`**

```json
{
  "name": "life-os",
  "short_name": "life-os",
  "description": "Personal life dashboard — finance, career, learning, investing, health.",
  "start_url": "./index.html",
  "display": "standalone",
  "background_color": "#14110f",
  "theme_color": "#2a6df4",
  "icons": [
    { "src": "icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable" }
  ]
}
```

- [ ] **Step 5: Create `icon.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="20" fill="#2a6df4"/>
  <text x="50" y="68" font-size="56" font-family="system-ui, sans-serif" fill="#ffffff" text-anchor="middle">L</text>
</svg>
```

- [ ] **Step 6: Create `service-worker.js`**

```js
/* Offline caching for the PWA shell. Bump CACHE whenever ASSETS changes. */
const CACHE = 'life-os-v1';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './ui.css',
  './db.js',
  './auth.js',
  './config.js',
  './manifest.webmanifest',
  './icon.svg',
  './finance/index.html',
  './finance/finance.js',
  './finance/pay-calc.js',
  './finance/holidays-repo.js',
  './finance/malaysia-holidays.js',
  './finance/work-hours-repo.js',
  './finance/pay-settings-repo.js',
  './finance/receipts-repo.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((cached) =>
      cached ||
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
          return res;
        })
        .catch(() => cached)
    )
  );
});
```

- [ ] **Step 7: Manually verify the hub loads**

Run: `cd ~/life-os && python3 -m http.server 8080`
Open `http://localhost:8080/index.html` in a browser.
Expected: page shows "life-os" header, "local mode (no Supabase config yet)" status (config.js is still blank), and 5 module cards (Finance clickable, other 4 visibly disabled). No console errors. Stop the server with Ctrl-C when done.

- [ ] **Step 8: Commit**

```bash
cd ~/life-os
git add index.html app.js ui.css manifest.webmanifest service-worker.js icon.svg
git commit -m "Add life-os hub page and PWA shell"
```

---

## Task 6: Supabase schema and project setup

**Files:**
- Create: `supabase/schema.sql`

**Interfaces:**
- Produces: Postgres tables `receipts`, `receipt_items`, `pay_settings`, `work_hours`, `work_hours`; Storage bucket `receipts` — consumed by `pay-settings-repo.js` and `work-hours-repo.js` (Task 7), `receipts-repo.js` (Task 10), and the `parse-receipt` Edge Function (Task 9)

- [ ] **Step 1: Create `supabase/schema.sql`**

```sql
-- Run this once in your NEW life-os Supabase project:
--   Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Creates every Finance-module table with Row Level Security so each
-- account can only see and edit its own rows, plus a private Storage
-- bucket for receipt photos.

create table if not exists public.receipts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  image_path    text not null,
  merchant      text,
  purchased_at  date,
  raw_json      jsonb,
  created_at    timestamptz not null default now()
);

create table if not exists public.receipt_items (
  id              uuid primary key default gen_random_uuid(),
  receipt_id      uuid not null references public.receipts(id) on delete cascade,
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name            text not null,
  price           numeric,
  category        text,
  calories        numeric,
  protein_g       numeric,
  carbs_g         numeric,
  fat_g           numeric,
  edited_by_user  boolean not null default false
);

create table if not exists public.pay_settings (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  base_hourly_rate    numeric not null default 0,
  weekend_multiplier  numeric not null default 1.5,
  holiday_multiplier  numeric not null default 2.0,
  currency            text not null default 'MYR'
);

create table if not exists public.work_hours (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  work_date      date not null,
  hours          numeric not null,
  day_type       text not null,
  computed_pay   numeric not null,
  created_at     timestamptz not null default now()
);

create index if not exists receipts_user_id_idx on public.receipts (user_id);
create index if not exists receipt_items_receipt_id_idx on public.receipt_items (receipt_id);
create index if not exists work_hours_user_id_idx on public.work_hours (user_id);

alter table public.receipts enable row level security;
alter table public.receipt_items enable row level security;
alter table public.pay_settings enable row level security;
alter table public.work_hours enable row level security;

drop policy if exists "own_select" on public.receipts;
drop policy if exists "own_insert" on public.receipts;
drop policy if exists "own_update" on public.receipts;
drop policy if exists "own_delete" on public.receipts;
create policy "own_select" on public.receipts for select using (auth.uid() = user_id);
create policy "own_insert" on public.receipts for insert with check (auth.uid() = user_id);
create policy "own_update" on public.receipts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.receipts for delete using (auth.uid() = user_id);

drop policy if exists "own_select" on public.receipt_items;
drop policy if exists "own_insert" on public.receipt_items;
drop policy if exists "own_update" on public.receipt_items;
drop policy if exists "own_delete" on public.receipt_items;
create policy "own_select" on public.receipt_items for select using (auth.uid() = user_id);
create policy "own_insert" on public.receipt_items for insert with check (auth.uid() = user_id);
create policy "own_update" on public.receipt_items for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.receipt_items for delete using (auth.uid() = user_id);

drop policy if exists "own_select" on public.pay_settings;
drop policy if exists "own_insert" on public.pay_settings;
drop policy if exists "own_update" on public.pay_settings;
create policy "own_select" on public.pay_settings for select using (auth.uid() = user_id);
create policy "own_insert" on public.pay_settings for insert with check (auth.uid() = user_id);
create policy "own_update" on public.pay_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own_select" on public.work_hours;
drop policy if exists "own_insert" on public.work_hours;
drop policy if exists "own_update" on public.work_hours;
drop policy if exists "own_delete" on public.work_hours;
create policy "own_select" on public.work_hours for select using (auth.uid() = user_id);
create policy "own_insert" on public.work_hours for insert with check (auth.uid() = user_id);
create policy "own_update" on public.work_hours for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.work_hours for delete using (auth.uid() = user_id);

-- Private bucket for receipt photos. Objects are stored as "<user_id>/<file>",
-- and the policies below only allow a user to touch objects under their own folder.
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

drop policy if exists "own_receipt_photos_select" on storage.objects;
drop policy if exists "own_receipt_photos_insert" on storage.objects;
create policy "own_receipt_photos_select" on storage.objects
  for select using (bucket_id = 'receipts' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "own_receipt_photos_insert" on storage.objects
  for insert with check (bucket_id = 'receipts' and auth.uid()::text = (storage.foldername(name))[1]);
```

- [ ] **Step 2: Create the Supabase project (manual, one-time)**

1. Go to https://supabase.com/dashboard and create a new project named `life-os` (separate from `eat-decider`'s project).
2. Project Settings -> API: copy the Project URL and `anon` `public` key into `config.js` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`), and also into a local `.env` (copy `.env.example` to `.env` first — it's gitignored).
3. Project Settings -> API: copy the `service_role` key into `.env` as `SUPABASE_SERVICE_ROLE_KEY` (needed by the Edge Function in Task 9, never used client-side).
4. SQL Editor -> New query -> paste the full contents of `supabase/schema.sql` -> Run.

- [ ] **Step 3: Verify the schema applied**

In the Supabase SQL Editor, run:

```sql
select table_name from information_schema.tables
where table_schema = 'public'
order by table_name;
```

Expected: `pay_settings`, `receipt_items`, `receipts`, `work_hours` all listed.

Run:

```sql
select id, public from storage.buckets where id = 'receipts';
```

Expected: one row, `public = false`.

- [ ] **Step 4: Commit**

```bash
cd ~/life-os
git add supabase/schema.sql
git commit -m "Add Supabase schema: Finance tables, RLS policies, receipts storage bucket"
```

(Do not commit `.env` — it's gitignored and holds real secrets.)

---

## Task 7: OT Pay data repos (`pay-settings-repo.js` + `work-hours-repo.js`)

**Files:**
- Create: `finance/pay-settings-repo.js`
- Create: `finance/work-hours-repo.js`

**Interfaces:**
- Consumes: `getClient()`, `cloudEnabled` from `db.js` (Task 4); tables `pay_settings`, `work_hours` from `supabase/schema.sql` (Task 6)
- Produces: `PaySettingsRepo.get(): Promise<{baseHourlyRate, weekendMultiplier, holidayMultiplier, currency}>`, `PaySettingsRepo.upsert(settings): Promise<settings>`; `WorkHoursRepo.list(): Promise<Array<{id, workDate, hours, dayType, computedPay}>>`, `WorkHoursRepo.create(data): Promise<entry>`, `WorkHoursRepo.remove(id): Promise<void>` — consumed by `finance.js` (Task 8)

- [ ] **Step 1: Create `finance/pay-settings-repo.js`**

```js
import { getClient, cloudEnabled } from '../db.js';

const LOCAL_KEY = 'life-os:finance:pay-settings:v1';
const DEFAULT_SETTINGS = {
  baseHourlyRate: 0,
  weekendMultiplier: 1.5,
  holidayMultiplier: 2.0,
  currency: 'MYR',
};

export const LocalRepo = {
  async get() {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(LOCAL_KEY)) };
    } catch {
      return DEFAULT_SETTINGS;
    }
  },
  async upsert(settings) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(settings));
    return settings;
  },
};

export const CloudRepo = {
  async get() {
    const c = await getClient();
    const { data: { user } } = await c.auth.getUser();
    const { data, error } = await c
      .from('pay_settings')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return DEFAULT_SETTINGS;
    return {
      baseHourlyRate: data.base_hourly_rate,
      weekendMultiplier: data.weekend_multiplier,
      holidayMultiplier: data.holiday_multiplier,
      currency: data.currency,
    };
  },
  async upsert(settings) {
    const c = await getClient();
    const { data: { user } } = await c.auth.getUser();
    const { error } = await c.from('pay_settings').upsert({
      user_id: user.id,
      base_hourly_rate: settings.baseHourlyRate,
      weekend_multiplier: settings.weekendMultiplier,
      holiday_multiplier: settings.holidayMultiplier,
      currency: settings.currency,
    });
    if (error) throw error;
    return settings;
  },
};

export const PaySettingsRepo = cloudEnabled ? CloudRepo : LocalRepo;
```

- [ ] **Step 2: Create `finance/work-hours-repo.js`**

```js
import { getClient, cloudEnabled } from '../db.js';

const LOCAL_KEY = 'life-os:finance:work-hours:v1';

function localId() {
  return globalThis.crypto?.randomUUID?.() || 'w_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function toRow(d) {
  return { work_date: d.workDate, hours: d.hours, day_type: d.dayType, computed_pay: d.computedPay };
}
function fromRow(r) {
  return { id: r.id, workDate: r.work_date, hours: r.hours, dayType: r.day_type, computedPay: r.computed_pay };
}

export const LocalRepo = {
  _read() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || []; }
    catch { return []; }
  },
  _write(arr) { localStorage.setItem(LOCAL_KEY, JSON.stringify(arr)); },
  async list() { return this._read(); },
  async create(data) {
    const arr = this._read();
    const entry = { ...data, id: localId() };
    arr.push(entry);
    this._write(arr);
    return entry;
  },
  async remove(id) {
    this._write(this._read().filter((e) => e.id !== id));
  },
};

export const CloudRepo = {
  async list() {
    const c = await getClient();
    const { data, error } = await c.from('work_hours').select('*').order('work_date', { ascending: false });
    if (error) throw error;
    return (data || []).map(fromRow);
  },
  async create(data) {
    const c = await getClient();
    const { data: { user } } = await c.auth.getUser();
    const { data: row, error } = await c
      .from('work_hours')
      .insert({ ...toRow(data), user_id: user.id })
      .select()
      .single();
    if (error) throw error;
    return fromRow(row);
  },
  async remove(id) {
    const c = await getClient();
    const { error } = await c.from('work_hours').delete().eq('id', id);
    if (error) throw error;
  },
};

export const WorkHoursRepo = cloudEnabled ? CloudRepo : LocalRepo;
```

- [ ] **Step 3: Verify both modules load without error**

Run: `node --input-type=module -e "import('./finance/pay-settings-repo.js').then(m => console.log(typeof m.PaySettingsRepo.get))"`
Expected: `function`

Run: `node --input-type=module -e "import('./finance/work-hours-repo.js').then(m => console.log(typeof m.WorkHoursRepo.create))"`
Expected: `function`

(These resolve to `LocalRepo` at this point since `config.js` is still blank — `cloudEnabled` is `false` until Task 6's project details are pasted in.)

- [ ] **Step 4: Commit**

```bash
cd ~/life-os
git add finance/pay-settings-repo.js finance/work-hours-repo.js
git commit -m "Add pay-settings-repo and work-hours-repo (offline-first Local/Cloud pattern)"
```

---

## Task 8: OT Pay tab UI

**Files:**
- Create: `finance/index.html`
- Create: `finance/finance.js` (OT Pay portion only — Spending portion added in Task 11)

**Interfaces:**
- Consumes: `classifyDay`, `calculatePay` (Task 2); `holidaySetForYear` (Task 3); `PaySettingsRepo`, `WorkHoursRepo` (Task 7)
- Produces: nothing consumed by later tasks except the DOM structure that Task 11 adds the Spending tab into (same `finance/index.html` and `finance/finance.js` files)

- [ ] **Step 1: Create `finance/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>life-os — Finance</title>
<link rel="stylesheet" href="../ui.css" />
<link rel="manifest" href="../manifest.webmanifest" />
</head>
<body>
<header>
  <a href="../index.html">&larr; life-os</a>
  <h1>Finance</h1>
</header>

<nav class="tabs">
  <button class="tab-btn active" data-tab="spending">Spending</button>
  <button class="tab-btn" data-tab="ot-pay">OT Pay</button>
</nav>

<section id="tab-spending" class="tab-panel active">
  <p><em>Spending tab is wired in Task 11.</em></p>
</section>

<section id="tab-ot-pay" class="tab-panel">
  <h2>Pay settings</h2>
  <form id="settings-form">
    <label>Base hourly rate <input type="number" step="0.01" id="settings-base-rate" required /></label>
    <label>Weekend multiplier <input type="number" step="0.01" id="settings-weekend-mult" required /></label>
    <label>Holiday multiplier <input type="number" step="0.01" id="settings-holiday-mult" required /></label>
    <button type="submit">Save settings</button>
  </form>

  <h2>Log hours</h2>
  <form id="hours-form">
    <label>Date <input type="date" id="hours-date" required /></label>
    <label>Hours worked <input type="number" step="0.25" id="hours-worked" required /></label>
    <label><input type="checkbox" id="hours-manual-holiday" /> This is a public holiday (not in the list)</label>
    <button type="submit">Log hours</button>
  </form>
  <div id="hours-status"></div>

  <h2>This month</h2>
  <table id="hours-summary"><tbody></tbody></table>
</section>

<script type="module" src="finance.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `finance/finance.js`**

```js
import { classifyDay, calculatePay } from './pay-calc.js';
import { holidaySetForYear } from './holidays-repo.js';
import { WorkHoursRepo } from './work-hours-repo.js';
import { PaySettingsRepo } from './pay-settings-repo.js';

initTabs();
initOtPayTab();

function initTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });
}

async function initOtPayTab() {
  const settings = await PaySettingsRepo.get();
  document.getElementById('settings-base-rate').value = settings.baseHourlyRate;
  document.getElementById('settings-weekend-mult').value = settings.weekendMultiplier;
  document.getElementById('settings-holiday-mult').value = settings.holidayMultiplier;

  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await PaySettingsRepo.upsert({
      baseHourlyRate: parseFloat(document.getElementById('settings-base-rate').value),
      weekendMultiplier: parseFloat(document.getElementById('settings-weekend-mult').value),
      holidayMultiplier: parseFloat(document.getElementById('settings-holiday-mult').value),
      currency: settings.currency,
    });
  });

  document.getElementById('hours-form').addEventListener('submit', onLogHours);
  refreshHoursSummary();
}

async function onLogHours(e) {
  e.preventDefault();
  const status = document.getElementById('hours-status');
  const workDate = document.getElementById('hours-date').value;
  const hours = parseFloat(document.getElementById('hours-worked').value);
  const manualHoliday = document.getElementById('hours-manual-holiday').checked;

  const settings = await PaySettingsRepo.get();
  const year = Number(workDate.slice(0, 4));
  const holidaySet = holidaySetForYear(year);
  const dayType = manualHoliday ? 'holiday' : classifyDay(workDate, holidaySet);
  const computedPay = calculatePay({ hours, dayType, settings });

  await WorkHoursRepo.create({ workDate, hours, dayType, computedPay });
  status.textContent = `Logged: ${dayType}, pay ${computedPay.toFixed(2)} ${settings.currency}`;
  document.getElementById('hours-form').reset();
  refreshHoursSummary();
}

async function refreshHoursSummary() {
  const entries = await WorkHoursRepo.list();
  const currentMonth = new Date().toISOString().slice(0, 7);
  const thisMonth = entries.filter((e) => e.workDate.slice(0, 7) === currentMonth);
  const totalsByType = {};
  for (const e of thisMonth) {
    totalsByType[e.dayType] = totalsByType[e.dayType] || { hours: 0, pay: 0 };
    totalsByType[e.dayType].hours += e.hours;
    totalsByType[e.dayType].pay += e.computedPay;
  }
  const tbody = document.querySelector('#hours-summary tbody');
  tbody.innerHTML = Object.entries(totalsByType)
    .map(([type, t]) => `<tr><td>${type}</td><td>${t.hours}h</td><td>${t.pay.toFixed(2)}</td></tr>`)
    .join('');
}
```

- [ ] **Step 3: Manually verify the OT Pay tab**

Run: `cd ~/life-os && python3 -m http.server 8080`
Open `http://localhost:8080/finance/index.html`, click the "OT Pay" tab.

1. Set base rate `20`, weekend multiplier `1.5`, holiday multiplier `2`, save.
2. Log hours: date `2026-07-11` (a Saturday), hours `8`. Expected status: `Logged: weekend, pay 240.00 MYR`.
3. Log hours: date `2026-08-31` (Merdeka Day), hours `8`. Expected status: `Logged: holiday, pay 320.00 MYR`.
4. Confirm "This month" table updates (rows only appear if the logged date is in the current month — adjust test dates to the current month if needed to see the summary populate).
5. Reload the page — settings and logged hours should persist (backed by `localStorage` while `config.js` is blank).

Stop the server with Ctrl-C when done.

- [ ] **Step 4: Commit**

```bash
cd ~/life-os
git add finance/index.html finance/finance.js
git commit -m "Wire OT Pay tab: settings form, hours logging, monthly summary"
```

---

## Task 9: `parse-receipt` Edge Function

**Files:**
- Create: `supabase/functions/parse-receipt/index.ts`

**Interfaces:**
- Consumes: `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` as Supabase secrets/env vars; the `receipts` Storage bucket (Task 6)
- Produces: HTTP endpoint — `POST` with JSON body `{storagePath: string, mediaType: string}` and header `Authorization: Bearer <user access_token>`, responds `{merchant: string|null, purchased_at: string|null, items: [{name, price, category, calories, protein_g, carbs_g, fat_g}]}` — consumed by `receipts-repo.js` (Task 10)

- [ ] **Step 1: Install the Supabase CLI (one-time, manual)**

Run: `brew install supabase/tap/supabase`
Verify: `supabase --version` prints a version number.

- [ ] **Step 2: Link the CLI to the life-os project (one-time, manual)**

Run: `cd ~/life-os && supabase login` (opens a browser to authenticate)
Run: `supabase link --project-ref <your-life-os-project-ref>` (the ref is in the Supabase dashboard URL: `https://supabase.com/dashboard/project/<ref>`)

- [ ] **Step 3: Create `supabase/functions/parse-receipt/index.ts`**

```ts
// Deploy: supabase functions deploy parse-receipt
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const RECEIPT_PROMPT = `You are extracting structured data from a photo of a purchase receipt.
Return ONLY valid JSON (no markdown fences, no commentary) matching this shape:
{
  "merchant": string | null,
  "purchased_at": string | null,
  "items": [
    {
      "name": string,
      "price": number | null,
      "category": string,
      "calories": number | null,
      "protein_g": number | null,
      "carbs_g": number | null,
      "fat_g": number | null
    }
  ]
}
"purchased_at" must be YYYY-MM-DD if you can read a date on the receipt, else null.
"category" must be one of: groceries, dining, transport, other.
Calorie/macro fields are your best estimate for that line item, or null if it isn't food.
If the image isn't a legible receipt, return {"merchant": null, "purchased_at": null, "items": []}.`;

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const { storagePath, mediaType } = await req.json();
  if (!storagePath) {
    return new Response(JSON.stringify({ error: 'storagePath is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'missing auth' }), { status: 401 });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: 'invalid session' }), { status: 401 });
  }
  if (!storagePath.startsWith(`${userData.user.id}/`)) {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
  }

  const { data: fileData, error: downloadErr } = await admin.storage.from('receipts').download(storagePath);
  if (downloadErr || !fileData) {
    return new Response(JSON.stringify({ error: 'could not read image' }), { status: 404 });
  }

  const bytes = new Uint8Array(await fileData.arrayBuffer());
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64Image = btoa(binary);

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: base64Image } },
            { type: 'text', text: RECEIPT_PROMPT },
          ],
        },
      ],
    }),
  });

  if (!claudeRes.ok) {
    const errText = await claudeRes.text();
    return new Response(JSON.stringify({ error: 'claude request failed', detail: errText }), { status: 502 });
  }

  const claudeJson = await claudeRes.json();
  const textBlock = claudeJson.content?.find((b: { type: string }) => b.type === 'text');
  let parsed;
  try {
    parsed = JSON.parse(textBlock?.text ?? '{}');
  } catch {
    return new Response(JSON.stringify({ error: 'unparseable response', raw: textBlock?.text }), { status: 502 });
  }

  return new Response(JSON.stringify(parsed), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
```

- [ ] **Step 4: Set the secret and deploy (manual)**

Run: `supabase secrets set ANTHROPIC_API_KEY=<your real key>`
Run: `supabase functions deploy parse-receipt`
Expected: CLI prints a deployed function URL like `https://<project-ref>.supabase.co/functions/v1/parse-receipt`.

- [ ] **Step 5: Manually verify with a real image**

1. Upload a test receipt photo to the `receipts` bucket via the Supabase Dashboard -> Storage -> `receipts` -> upload to a folder named after your own user id (find your user id under Authentication -> Users), e.g. `<your-user-id>/test.jpg`.
2. Get your access token: sign in via the life-os hub once Task 6's config is in place, then in the browser console run `(await (await import('./db.js')).getClient()).auth.getSession()` and copy `session.access_token`.
3. Run:

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/parse-receipt" \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"storagePath": "<your-user-id>/test.jpg", "mediaType": "image/jpeg"}'
```

Expected: HTTP 200 with a JSON body containing `merchant`, `purchased_at`, and an `items` array.

- [ ] **Step 6: Commit**

```bash
cd ~/life-os
git add supabase/functions/parse-receipt/index.ts
git commit -m "Add parse-receipt Edge Function: Storage -> Claude vision -> structured JSON"
```

---

## Task 10: Receipts repo (`receipts-repo.js`)

**Files:**
- Create: `finance/receipts-repo.js`

**Interfaces:**
- Consumes: `getClient()` from `db.js` (Task 4); tables `receipts`, `receipt_items` and bucket `receipts` from `supabase/schema.sql` (Task 6); the `parse-receipt` Edge Function (Task 9)
- Produces: `parseReceiptPhoto(file: File): Promise<{storagePath: string, extracted: object}>`, `saveReceipt({storagePath, merchant, purchasedAt, items}): Promise<{receipt: object}>`, `spendByCategory(): Promise<Record<string, number>>`, `caloriesByDay(): Promise<Record<string, number>>` — consumed by `finance.js` (Task 11)

**Note on offline behavior:** unlike `work-hours-repo.js`, receipts do NOT get a Local/Cloud offline queue. Parsing a receipt inherently requires a network round trip to Claude via the Edge Function, so there is no meaningful "offline capture" to support — if you're offline, scanning simply isn't possible yet, and the UI says so (wired in Task 11). This is a deliberate simplification from the original spec wording ("every write goes through LocalRepo first"), which assumed offline queuing was possible here; it isn't, so building a fake queue for it would just be complexity with no payoff.

- [ ] **Step 1: Create `finance/receipts-repo.js`**

```js
import { getClient } from '../db.js';

function localId() {
  return globalThis.crypto?.randomUUID?.() || 'r_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function parseReceiptPhoto(file) {
  const c = await getClient();
  if (!c) throw new Error('Not signed in — cannot scan receipts without a Supabase connection.');

  const { data: { user } } = await c.auth.getUser();
  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'jpg';
  const storagePath = `${user.id}/${localId()}.${ext}`;

  const { error: uploadErr } = await c.storage.from('receipts').upload(storagePath, file, { contentType: file.type });
  if (uploadErr) throw uploadErr;

  const { data: { session } } = await c.auth.getSession();
  const { data, error } = await c.functions.invoke('parse-receipt', {
    body: { storagePath, mediaType: file.type },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) throw error;
  return { storagePath, extracted: data };
}

export async function saveReceipt({ storagePath, merchant, purchasedAt, items }) {
  const c = await getClient();
  if (!c) throw new Error('Not signed in — cannot save receipts without a Supabase connection.');

  const { data: { user } } = await c.auth.getUser();
  const { data: receipt, error: receiptErr } = await c
    .from('receipts')
    .insert({ user_id: user.id, image_path: storagePath, merchant, purchased_at: purchasedAt })
    .select()
    .single();
  if (receiptErr) throw receiptErr;

  const rows = items.map((i) => ({
    receipt_id: receipt.id,
    user_id: user.id,
    name: i.name,
    price: i.price,
    category: i.category,
    calories: i.calories,
    protein_g: i.proteinG,
    carbs_g: i.carbsG,
    fat_g: i.fatG,
    edited_by_user: !!i.editedByUser,
  }));
  const { error: itemsErr } = await c.from('receipt_items').insert(rows);
  if (itemsErr) throw itemsErr;

  return { receipt };
}

async function listReceiptsWithItems() {
  const c = await getClient();
  if (!c) return [];
  const { data, error } = await c.from('receipts').select('*, receipt_items(*)').order('purchased_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function spendByCategory() {
  const receipts = await listReceiptsWithItems();
  const totals = {};
  for (const r of receipts) {
    for (const item of r.receipt_items) {
      const cat = item.category || 'other';
      totals[cat] = (totals[cat] || 0) + (Number(item.price) || 0);
    }
  }
  return totals;
}

export async function caloriesByDay() {
  const receipts = await listReceiptsWithItems();
  const totals = {};
  for (const r of receipts) {
    if (!r.purchased_at) continue;
    const dayTotal = r.receipt_items.reduce((sum, i) => sum + (Number(i.calories) || 0), 0);
    totals[r.purchased_at] = (totals[r.purchased_at] || 0) + dayTotal;
  }
  return totals;
}
```

- [ ] **Step 2: Verify the module loads without error**

Run: `node --input-type=module -e "import('./finance/receipts-repo.js').then(m => console.log(typeof m.parseReceiptPhoto, typeof m.saveReceipt, typeof m.spendByCategory, typeof m.caloriesByDay))"`
Expected: `function function function function`

- [ ] **Step 3: Commit**

```bash
cd ~/life-os
git add finance/receipts-repo.js
git commit -m "Add receipts-repo: upload+parse+save receipts, spend/calorie aggregation"
```

---

## Task 11: Spending tab UI

**Files:**
- Modify: `finance/index.html` (replace the Task 8 placeholder `#tab-spending` content)
- Modify: `finance/finance.js` (add Spending tab wiring alongside the existing OT Pay wiring)

**Interfaces:**
- Consumes: `parseReceiptPhoto`, `saveReceipt`, `spendByCategory`, `caloriesByDay` from `receipts-repo.js` (Task 10)
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Replace the Spending tab markup in `finance/index.html`**

Replace:

```html
<section id="tab-spending" class="tab-panel active">
  <p><em>Spending tab is wired in Task 11.</em></p>
</section>
```

with:

```html
<section id="tab-spending" class="tab-panel active">
  <form id="receipt-form">
    <label>
      Add receipt photo
      <input type="file" id="receipt-photo" accept="image/*" capture="environment" required />
    </label>
    <button type="submit">Scan Receipt</button>
  </form>
  <div id="receipt-status"></div>

  <div id="receipt-preview" hidden>
    <h2>Review before saving</h2>
    <label>Merchant <input type="text" id="preview-merchant" /></label>
    <label>Date <input type="date" id="preview-date" /></label>
    <table id="preview-items"><tbody></tbody></table>
    <button type="button" id="add-item-row">+ Add item</button>
    <button type="button" id="save-receipt">Save</button>
  </div>

  <h2>Spend by category</h2>
  <ul id="spend-by-category"></ul>

  <h2>Calories by day</h2>
  <ul id="calories-by-day"></ul>
</section>
```

- [ ] **Step 2: Add Spending tab wiring to `finance/finance.js`**

At the top of the file, change the import block to:

```js
import { classifyDay, calculatePay } from './pay-calc.js';
import { holidaySetForYear } from './holidays-repo.js';
import { WorkHoursRepo } from './work-hours-repo.js';
import { PaySettingsRepo } from './pay-settings-repo.js';
import { parseReceiptPhoto, saveReceipt, spendByCategory, caloriesByDay } from './receipts-repo.js';
```

Change the top-level init calls to:

```js
initTabs();
initSpendingTab();
initOtPayTab();
```

Append the Spending tab logic to the end of the file:

```js
/* ---------------- Spending tab ---------------- */

let pendingParse = null;

function initSpendingTab() {
  document.getElementById('receipt-form').addEventListener('submit', onScanReceipt);
  document.getElementById('add-item-row').addEventListener('click', () => addItemRow({}));
  document.getElementById('save-receipt').addEventListener('click', onSaveReceipt);
  refreshSpendingDashboards();
}

async function onScanReceipt(e) {
  e.preventDefault();
  const file = document.getElementById('receipt-photo').files[0];
  const status = document.getElementById('receipt-status');
  if (!file) return;

  status.textContent = 'Uploading and scanning...';
  try {
    pendingParse = await parseReceiptPhoto(file);
    showPreview(pendingParse.extracted);
    status.textContent = '';
  } catch (err) {
    status.textContent = `Could not scan automatically (${err.message}). Enter items manually below.`;
    pendingParse = { storagePath: null, extracted: { merchant: null, purchased_at: null, items: [] } };
    showPreview(pendingParse.extracted);
  }
}

function showPreview(extracted) {
  document.getElementById('receipt-preview').hidden = false;
  document.getElementById('preview-merchant').value = extracted.merchant || '';
  document.getElementById('preview-date').value = extracted.purchased_at || '';
  const tbody = document.querySelector('#preview-items tbody');
  tbody.innerHTML = '';
  (extracted.items || []).forEach(addItemRow);
}

function addItemRow(item) {
  const tbody = document.querySelector('#preview-items tbody');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="item-name" value="${item.name || ''}" placeholder="Item" /></td>
    <td><input type="number" step="0.01" class="item-price" value="${item.price ?? ''}" placeholder="Price" /></td>
    <td><input type="text" class="item-category" value="${item.category || 'other'}" placeholder="Category" /></td>
    <td><input type="number" class="item-calories" value="${item.calories ?? ''}" placeholder="kcal (est.)" /></td>
    <td><button type="button" class="remove-item">Remove</button></td>
  `;
  tr.querySelector('.remove-item').addEventListener('click', () => tr.remove());
  tbody.appendChild(tr);
}

async function onSaveReceipt() {
  const status = document.getElementById('receipt-status');
  const rows = [...document.querySelectorAll('#preview-items tbody tr')].map((tr) => ({
    name: tr.querySelector('.item-name').value,
    price: parseFloat(tr.querySelector('.item-price').value) || null,
    category: tr.querySelector('.item-category').value || 'other',
    calories: parseFloat(tr.querySelector('.item-calories').value) || null,
    proteinG: null,
    carbsG: null,
    fatG: null,
    editedByUser: true,
  }));

  try {
    await saveReceipt({
      storagePath: pendingParse?.storagePath,
      merchant: document.getElementById('preview-merchant').value || null,
      purchasedAt: document.getElementById('preview-date').value || null,
      items: rows,
    });
    document.getElementById('receipt-preview').hidden = true;
    document.getElementById('receipt-form').reset();
    status.textContent = 'Saved.';
    pendingParse = null;
    refreshSpendingDashboards();
  } catch (err) {
    status.textContent = `Could not save (${err.message}). Try again once you're online.`;
  }
}

async function refreshSpendingDashboards() {
  const [byCategory, byDay] = await Promise.all([spendByCategory(), caloriesByDay()]);
  document.getElementById('spend-by-category').innerHTML = Object.entries(byCategory)
    .map(([cat, total]) => `<li>${cat}: ${total.toFixed(2)}</li>`)
    .join('');
  document.getElementById('calories-by-day').innerHTML = Object.entries(byDay)
    .map(([day, kcal]) => `<li>${day}: ${Math.round(kcal)} kcal</li>`)
    .join('');
}
```

- [ ] **Step 3: Manually verify the Spending tab (requires Task 6's Supabase config and Task 9's deployed function to be live)**

Run: `cd ~/life-os && python3 -m http.server 8080`
Open `http://localhost:8080/finance/index.html`, sign in from the hub first if not already.

1. On the Spending tab, choose a photo of a real or sample receipt, submit.
2. Expected: "Uploading and scanning..." then an editable preview with merchant/date/items pre-filled from Claude's extraction.
3. Edit an item's category or price, click "+ Add item" and fill in one manual row, then "Save".
4. Expected: preview hides, status shows "Saved.", and "Spend by category" / "Calories by day" lists update to include the new receipt.
5. Reload the page — the saved receipt's totals should still be reflected in both lists (confirms it persisted to Supabase, not just local state).

Stop the server with Ctrl-C when done.

- [ ] **Step 4: Commit**

```bash
cd ~/life-os
git add finance/index.html finance/finance.js
git commit -m "Wire Spending tab: receipt scan, editable preview, spend/calorie dashboards"
```

---

## Task 12: Final wiring, README, and end-to-end verification

**Files:**
- Modify: `index.html` (already links to Finance — this task is the final verification pass, no code change expected unless verification surfaces a bug)
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
# life-os

Personal life dashboard. Vanilla HTML/CSS/JS, no build step, installable PWA.
Currently live: the **Finance** module (receipt scanning + nutrition/spend
tracking, OT pay calculator). Other modules (career, learning, invest,
health) are planned but not built yet.

## Setup

1. Create a new Supabase project (separate from any other personal project).
2. Project Settings -> API: copy the Project URL and `anon` key into `config.js`.
3. Copy `.env.example` to `.env` and fill in `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_PASSWORD`, `ANTHROPIC_API_KEY`.
4. Supabase SQL Editor: run `supabase/schema.sql`.
5. Install the Supabase CLI (`brew install supabase/tap/supabase`), `supabase login`,
   `supabase link --project-ref <ref>`.
6. `supabase secrets set ANTHROPIC_API_KEY=<your key>`
7. `supabase functions deploy parse-receipt`
8. Serve locally: `python3 -m http.server 8080`, open `http://localhost:8080`.

## Tests

`npm test` runs the pure-logic unit tests (pay calculation, day classification,
holiday lookup). UI flows (receipt scan, OT pay entry) are verified manually
against the running app — see the plan doc for the exact checklist.

## Updating Malaysia public holidays

`finance/malaysia-holidays.js` is a static list, not a live API (Malaysia isn't
covered by the free public-holiday APIs checked during planning). Add a new
`MALAYSIA_HOLIDAYS_<year>` array every December and spread it into `ALL_HOLIDAYS`.
```

- [ ] **Step 2: Run the full automated test suite**

Run: `npm test`
Expected: PASS, 12 tests passing (all from Tasks 2 and 3 — no regressions from Tasks 4-11, which added no new automated tests by design).

- [ ] **Step 3: Full manual end-to-end pass**

With `config.js`/`.env` filled in (Task 6) and `parse-receipt` deployed (Task 9), repeat the checks from Task 8 Step 3 and Task 11 Step 3 back to back in one session, plus:

1. From the hub (`index.html`), confirm "Finance" card navigates to the Finance module and the other 4 cards are visibly disabled and unclickable.
2. Sign out from the hub, confirm the Finance module's data operations correctly fail/prompt rather than silently doing nothing.
3. Kill the local server mid-session (simulating offline) and confirm: OT Pay hours logging still works (falls back to `localStorage`), while Spending's "Scan Receipt" surfaces a clear error rather than hanging.

- [ ] **Step 4: Commit**

```bash
cd ~/life-os
git add README.md
git commit -m "Add README with setup, testing, and holiday-data-maintenance instructions"
```

---

## Plan Self-Review Notes

- **Spec coverage:** every spec section maps to a task — shell (Tasks 1, 4, 5), Spending (Tasks 9, 10, 11), OT Pay (Tasks 2, 3, 7, 8), Supabase backend (Task 6), security/secrets (Task 9), testing plan (Tasks 2, 3, 12).
- **Deviation from spec, flagged to the user separately:** `public_holidays` uses a static file instead of `date.nager.at` (that API doesn't support Malaysia — verified directly), and receipts skip the Local/Cloud offline queue (parsing inherently requires network, so queuing was fake complexity). Both are corrected in the spec doc and called out in Task 3 and Task 10 respectively.
- **Type consistency check:** `WorkHoursRepo`/`PaySettingsRepo` shapes (`workDate`, `hours`, `dayType`, `computedPay` / `baseHourlyRate`, `weekendMultiplier`, `holidayMultiplier`, `currency`) are used identically in Tasks 7, 8, and 11. `classifyDay`/`calculatePay` signatures from Task 2 match their call sites in Task 8 exactly.
