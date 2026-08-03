/* Offline caching for the PWA shell.
 * Network-first: always try the network so updates appear immediately when
 * online; fall back to cache only when offline. Bump CACHE on shell changes. */
const CACHE = 'life-os-v8';
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
  './finance/expenses-repo.js',
  './health/index.html',
  './health/health.js',
  './health/meals-repo.js',
  './health/workouts-repo.js',
  './health/nutrition.js',
  './health/calories-burned.js',
  './health/data/foods.json',
  './health/data/exercises.json',
  './learning/index.html',
  './learning/learning.js',
  './learning/learning-repo.js',
  './learning/materials-repo.js',
  './learning/weekly.js',
  './career/index.html',
  './career/career.js',
  './career/goals-repo.js',
  './career/goals.js',
  './improve/index.html',
  './improve/improve.js',
  './improve/improve-repo.js',
  './improve/coach.js',
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
