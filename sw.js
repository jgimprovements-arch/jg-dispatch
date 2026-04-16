// JG Sales PWA Service Worker
// Increment VERSION on every deploy to force cache refresh
const VERSION = '2025-04-16-v1';
const CACHE = 'jg-sales-' + VERSION;

// Files to cache for offline use
const PRECACHE = [
  '/jg-dispatch/sales_app.html',
  '/jg-dispatch/logo.png'
];

// Install — cache core files
self.addEventListener('install', function(e) {
  self.skipWaiting(); // activate immediately
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(PRECACHE).catch(function(){});
    })
  );
});

// Activate — delete old caches
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) { return key !== CACHE; })
            .map(function(key) { return caches.delete(key); })
      );
    }).then(function() {
      // Tell all open tabs to reload so they get the fresh version
      return self.clients.matchAll({ type: 'window' }).then(function(clients) {
        clients.forEach(function(client) { client.postMessage('reload'); });
      });
    })
  );
  return self.clients.claim();
});

// Fetch — network first, fall back to cache
self.addEventListener('fetch', function(e) {
  // Only handle same-origin requests
  if (!e.request.url.startsWith(self.location.origin)) return;

  e.respondWith(
    fetch(e.request).then(function(response) {
      // Cache successful responses
      if (response && response.status === 200) {
        var clone = response.clone();
        caches.open(CACHE).then(function(cache) {
          cache.put(e.request, clone);
        });
      }
      return response;
    }).catch(function() {
      // Network failed — serve from cache
      return caches.match(e.request);
    })
  );
});
