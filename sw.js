// JG Sales PWA Service Worker
//
// Lives at /jg-dispatch/sw.js. Default registration scope is /jg-dispatch/.
// On GitHub Pages we can't narrow the scope (no Service-Worker-Allowed
// header support), so this SW MUST be defensive and only intercept URLs
// that belong to the sales app — not timeclock, dispatch, hub, etc.
//
// Fixed May 2026:
//   1. Removed timeclock.html from precache (was hijacking the timeclock
//      app — installing sales would cache the timeclock page in the
//      sales SW).
//   2. Narrowed fetch handler to an explicit allow-list of sales paths.
//      All other requests pass through with no SW involvement.

const VERSION = '2026-05-04-v1';
const CACHE = 'jg-sales-' + VERSION;

// Strict allow-list. Only these paths are precached AND only these are
// served from cache by the fetch handler. Adding new files here is a
// deliberate decision — never add another app's pages.
const SALES_PATHS = [
  '/jg-dispatch/sales_app.html',
  '/jg-dispatch/sales-shared.js',
  '/jg-dispatch/manifest.json',
  '/jg-dispatch/logo.png'
];

function isSalesPath(url) {
  try {
    return SALES_PATHS.indexOf(new URL(url).pathname) !== -1;
  } catch(e) {
    return false;
  }
}

self.addEventListener('install', function(e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(SALES_PATHS).catch(function(){});
    })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      // Only purge OUR old sales caches. Leave caches owned by other
      // apps (timeclock, dispatch, etc.) untouched.
      return Promise.all(
        keys.filter(function(key) {
          return key.indexOf('jg-sales-') === 0 && key !== CACHE;
        }).map(function(key) {
          return caches.delete(key);
        })
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
  if (e.request.method !== 'GET') return;

  // Only intercept URLs in our allow-list. Everything else (timeclock,
  // dispatch, hub, API calls, etc.) passes through to the network with
  // no SW involvement.
  if (!isSalesPath(e.request.url)) return;

  // Network-first with cache fallback for the sales-app assets only
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
