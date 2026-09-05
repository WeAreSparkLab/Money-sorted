const CACHE = 'money-sorted-v2';
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
  // Network-first: always serve the latest deploy, only falling back to the
  // cache when there's no connection (previous version cached-forever with
  // no way to see updates).
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((cache) => cache.put(e.request, copy));
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});
