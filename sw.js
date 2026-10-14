/* Go Quiz v1.1 — static files stored for offline use.
   Increment CACHE_VERSION when releasing changed static assets or questions. */
const CACHE_VERSION = 'go-quiz-v1.1.0';
const APP_FILES = [
  './', './index.html', './styles.css', './app.js',
  './manifest.webmanifest', './data/questions.json',
  './icons/icon.svg', './icons/icon-180.png',
  './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('go-quiz-') && key !== CACHE_VERSION).map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const requestURL = new URL(event.request.url);
  if (requestURL.origin !== self.location.origin || !requestURL.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  // Offline-first for app shell and question database; cache is versioned and refreshed on a new release.
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.put(event.request, copy)));
    }
    return response;
  }).catch(() => {
    if (event.request.mode === 'navigate') return caches.match(new URL('./index.html', self.registration.scope));
    return Response.error();
  })));
});