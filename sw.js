/* Go Quiz — offline-first static application */
const CACHE_VERSION = 'go-quiz-v1.0.2';
const APP_FILES = ['./', './index.html', './styles.css', './app.js',
 './manifest.webmanifest', './data/questions.json', './icons/icon.svg',
 './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', event => {
 event.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
 event.waitUntil(Promise.all([
  caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('go-quiz-') && k !== CACHE_VERSION).map(k => caches.delete(k)))),
  self.clients.claim()
 ]));
});
self.addEventListener('fetch', event => {
 if(event.request.method !== 'GET') return;
 const url = new URL(event.request.url);
 if(url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
 event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
  if(response.ok) {
   const copy = response.clone();
   event.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.put(event.request, copy)));
  }
  return response;
 }).catch(() => event.request.mode === 'navigate' ? caches.match(new URL('./index.html', self.registration.scope)) : Response.error())));
});
