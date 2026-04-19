// JG Sales PWA Service Worker
const VERSION = '2026-04-19-v12';
const CACHE = 'jg-sales-' + VERSION;

const PRECACHE = [
  '/jg-dispatch/sales_app.html',
  '/jg-dispatch/timeclock.html',
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

  // Pass through everything except same-origin static assets
  // This ensures API calls (Supabase, Google, Albi, etc.) are never intercepted
  if (e.request.method !== 'GET') return;
  if (url.indexOf(self.location.origin) !== 0) return;

  // Only cache html, js, css, png, jpg, svg, json files
  var ext = url.split('?')[0].split('.').pop().toLowerCase();
  var cacheable = ['html','js','css','png','jpg','jpeg','svg','json','ico','woff','woff2'];
  if (cacheable.indexOf(ext) === -1) return;

  // Network first, cache fallback for static assets only
  e.respondWith(
    fetch(e.request, { credentials: 'same-origin' }).then(function(response) {
      if (response && response.status === 200 && response.type !== 'opaque') {
        var clone = response.clone();
        caches.open(CACHE).then(function(cache) { cache.put(e.request, clone); });
      }
      return response;
    }).catch(function() {
      return caches.match(e.request);
    })
  );
});