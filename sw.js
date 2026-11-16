const CACHE = 'money-sorted-v4';
const STATIC_PATHS = new Set([
  '/', '/index.html', '/privacy.html', '/manifest.json',
  '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png',
]);
self.addEventListener('install', () => {
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  // Cache only same-origin static GETs. Financial API responses and writes must
  // never be stored in a shared browser cache.
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin ||
      url.search || !STATIC_PATHS.has(url.pathname) || e.request.cache === 'no-store') return;
  // Network-first: always serve the latest deploy, only falling back to the
  // cache when there's no connection (previous version cached-forever with
  // no way to see updates).
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        const cacheControl = resp.headers.get('Cache-Control') || '';
        if (resp.ok && !/\b(no-store|private)\b/i.test(cacheControl)) {
          const copy = resp.clone();
          e.waitUntil(caches.open(CACHE).then((cache) => cache.put(e.request, copy)));
        }
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});
