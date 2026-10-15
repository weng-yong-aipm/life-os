/* Offline caching for the PWA shell.
 * Network-first: always try the network so updates appear immediately when
 * online; fall back to cache only when offline. Bump CACHE on shell changes.
 *
 * Because the fetch handler is network-first with a runtime put(), a file that
 * is missing from ASSETS looks perfectly fine while online — it gets cached the
 * first time you visit that page. The gap only shows up on a cold offline load,
 * which is the one case this app exists for (logging from a phone with no
 * signal). So ASSETS must list the FULL transitive closure of every page, not
 * just the files someone remembered. tools/sw-precache.test.js walks the real
 * import graph on disk and fails if this list drifts from it in either
 * direction — missing a reachable file, or naming a file that no longer exists.
 * install() uses addAll(), which is atomic: one stale entry 404s and the whole
 * service worker never activates, so a wrong entry is as fatal as a missing one. */
const CACHE = 'life-os-v11';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './ui.css',
  './shell.css',
  './shell.js',
  './db.js',
  './auth.js',
  './config.js',
  './demo.js',
  './manifest.webmanifest',
  './log/index.html',
  './log/log-ui.js',
  './log/log-repo.js',
  './log/parse-log.js',
  './log/log.css',
  './icon.svg',
  './shared/local-date.js',
  './shared/tab-hash.js',
  './finance/index.html',
  './finance/finance.js',
  './finance/pay-calc.js',
  './finance/holidays-repo.js',
  './finance/malaysia-holidays.js',
  './finance/work-hours-repo.js',
  './finance/pay-settings-repo.js',
  './finance/receipts-repo.js',
  './finance/expenses-repo.js',
  './health/index.html',
  './health/health.js',
  './health/meals-repo.js',
  './health/workouts-repo.js',
  './health/sleep-repo.js',
  './health/sleep.js',
  './health/nutrition.js',
  './health/calories-burned.js',
  './health/data/foods.json',
  './health/data/exercises.json',
  './health/data/exercise-media.json',
  './learning/index.html',
  './learning/learning.js',
  './learning/learning-repo.js',
  './learning/materials-repo.js',
  './learning/weekly.js',
  './learning/goal-link-ui.js',
  './learning/goal-link.js',
  './career/index.html',
  './career/career.js',
  './career/goals-repo.js',
  './career/goals.js',
  './improve/index.html',
  './improve/improve.js',
  './improve/improve-repo.js',
  './improve/coach.js',
  './capture/index.html',
  './capture/capture-ui.js',
  './capture/capture.js',
  './capture/capture-repo.js',
  './feed/index.html',
  './feed/feed-ui.js',
  './feed/feed.js',
  './feed/feed-repo.js',
  './plan/index.html',
  './plan/plan.css',
  './plan/plan-ui.js',
  './plan/plan.js',
  './plan/plan-repo.js',
  './plan/plan-data.js',
  './settings/index.html',
  './settings/settings-ui.js',
  './settings/settings.js',
  './settings/settings-repo.js',
  './settings/push-subscribe.js',
  './training/index.html',
  './training/log.html',
  './training/plan.html',
  './training/credits.html',
  './training/catalogue-ui.js',
  './training/catalogue.js',
  './training/log-ui.js',
  './training/plan-ui.js',
  './training/credits-ui.js',
  './training/strength.js',
  './training/strength-repo.js',
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
  // Only manage same-origin requests; let cross-origin (fonts, Supabase, Google) pass through.
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      /* ignoreSearch is load-bearing, not a nicety.
       *
       * ASSETS stores clean paths ('./ui.css'), but every page asks for the
       * cache-busted URL ('../ui.css?v=7'). caches.match defaults to
       * ignoreSearch:false, so those are two different keys and the precached
       * copy was never found: offline, log/index.html came back as unstyled
       * Times with its module script missing entirely. The ?v= suffix is an
       * HTTP cache-buster, never a different resource, so matching without the
       * query is exactly right here.
       *
       * Remove this option and the whole precache list stops working offline
       * while every test stays green — sw-precache.test.js now asserts it is
       * present for that reason. */
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

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
