// JG Project Hub — Service Worker
// Strategy: network-first for HTML/JS (so updates are picked up), cache-first for assets

const CACHE_VERSION = 'jg-project-v1';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Files to pre-cache so the app boots offline
const SHELL_URLS = [
  '/jg-dispatch/project.html',
  '/jg-dispatch/manifest.json',
  '/jg-dispatch/logo.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Don't cache: API calls, auth, Supabase realtime, POST/PUT/DELETE
  if (req.method !== 'GET') return;
  if (url.host.includes('supabase.co') && !url.pathname.includes('/storage/')) return;
  if (url.host.includes('hooks.zapier.com')) return;
  if (url.host.includes('api.ipify.org')) return;

  // Navigation requests (HTML): network-first, fall back to cache, fall back to project.html
  if (req.mode === 'navigate' || (req.method === 'GET' && req.headers.get('accept')?.includes('text/html'))) {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
          return resp;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/jg-dispatch/project.html')))
    );
    return;
  }

  // CSS / JS / images / fonts: stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req).then((resp) => {
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
        }
        return resp;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});
