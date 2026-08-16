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
const CACHE = 'life-os-v9';
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
      .catch(() => caches.match(e.request))
  );
});
