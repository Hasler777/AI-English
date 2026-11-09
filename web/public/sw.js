// Минимальный service worker: оболочка приложения из кэша, /api всегда в сеть.
const CACHE = 'ai-english-v2';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon.svg'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // network-first с таймаутом 4 с: свежая версия, при плохой сети — кэш.
  // Подмена на index.html — только для навигации, не для JS/CSS.
  const network = Promise.race([
    fetch(e.request),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
  ]);
  e.respondWith(
    network
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() =>
        caches
          .match(e.request)
          .then((r) => r ?? (e.request.mode === 'navigate' ? caches.match('/') : Response.error())),
      ),
  );
});
