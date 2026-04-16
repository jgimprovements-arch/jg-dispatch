// JG Sales PWA Service Worker
// Increment VERSION on every deploy to force cache refresh
const VERSION = '2025-04-16-v2';
const CACHE = 'jg-sales-' + VERSION;

const PRECACHE = [
  '/jg-dispatch/sales_app.html',
  '/jg-dispatch/logo.png'
];

self.addEventListener('install', function(e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(PRECACHE).catch(function(){});
    })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) { return key !== CACHE; })
            .map(function(key) { return caches.delete(key); })
      );
    }).then(function() {
      return self.clients.matchAll({ type: 'window' }).then(function(clients) {
        clients.forEach(function(client) { client.postMessage('reload'); });
      });
    })
  );
  return self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  // Pass through ALL non-GET requests (POST, PATCH, DELETE)
  if (e.request.method !== 'GET') return;

  // Pass through external API calls (Supabase, Google, etc)
  if (!url.startsWith(self.location.origin)) return;

  // Pass through non-HTML/asset requests
  var isAsset = url.endsWith('.html') || url.endsWith('.js') ||
                url.endsWith('.css') || url.endsWith('.png') ||
                url.endsWith('.jpg') || url.endsWith('.svg') ||
                url.endsWith('.json');
  if (!isAsset) return;

  // For app assets: network first, cache fallback
  e.respondWith(
    fetch(e.request).then(function(response) {
      if (response && response.status === 200) {
        var clone = response.clone();
        caches.open(CACHE).then(function(cache) {
          cache.put(e.request, clone);
        });
      }
      return response;
    }).catch(function() {
      return caches.match(e.request);
    })
  );
});
