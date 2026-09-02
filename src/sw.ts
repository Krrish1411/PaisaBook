// Service Worker for PaisaBook - Offline-first caching
const CACHE_NAME = 'paisabook-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache the main entry point and manifest
      return cache.addAll([
        '/PaisaBook/',
        '/PaisaBook/index.html',
        '/PaisaBook/manifest.json'
      ]);
    }).catch(err => {
      console.log('SW cache addAll failed (some assets may not exist yet):', err);
      // Don't fail installation if some assets aren't available yet
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => 
      Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networked = fetch(event.request).then((res) => {
        // Only cache successful responses
        if (!res || res.status !== 200) return cached;
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return res;
      }).catch(() => cached);
      return cached || networked;
    })
  );
});
