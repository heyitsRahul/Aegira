// Aegira service worker. Two jobs only: make the app installable, and show
// an offline page with emergency numbers when there is no connection.
// It never caches API responses or app pages — session state must always
// come live from the server, never from a stale copy.
const CACHE = 'aegira-offline-v1';
const OFFLINE = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, '/icon-192.png'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return; // everything else: straight to network
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});
