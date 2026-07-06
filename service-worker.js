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
