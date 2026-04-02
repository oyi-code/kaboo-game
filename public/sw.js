// KABOO Service Worker — minimal, enables PWA install
const CACHE_NAME = 'kaboo-v2';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', (e) => {
  // Network-first strategy — always get fresh data
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
