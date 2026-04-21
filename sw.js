// Service Worker - Evidencija Stanova
const CACHE = 'investprom-v6';

// Fajlovi koji se uvijek preuzimaju sa mreze (ne iz cache-a)
const NETWORK_FIRST = ['app.js', 'data.json'];

// Fajlovi koji se cachuju i sluze iz cache-a
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './data.json',
  './manifest.json',
  './logo.png',
  './logo-login.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);
  const filename = url.pathname.split('/').pop();

  // Network-first za app.js i data.json — uvijek svjeza verzija
  if (NETWORK_FIRST.some(f => filename === f || url.pathname.endsWith(f))) {
    e.respondWith(
      fetch(e.request).then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first za ostale fajlove (slike, ikone, manifest)
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        if (resp.ok && e.request.url.startsWith(self.location.origin)) {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => cached);
    })
  );
});
