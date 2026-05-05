// JG Timeclock Service Worker
//
// Dedicated SW for timeclock.html. Replaces the previous shared sw.js
// which was a sales-only SW that didn't handle timeclock at all (leaving
// browser HTTP cache to serve stale code, sometimes for days).
//
// Strategy: NETWORK-FIRST, never cache HTML.
// - HTML pages always come from network (so code updates propagate
//   immediately on any page load).
// - On network failure, fall back to last cached version (offline mode).
// - Static assets (logo, manifest) cached briefly for offline fallback.
// - skipWaiting + clients.claim so a new SW takes over immediately
//   instead of waiting for all tabs to close.
//
// To force an update for everyone: bump VERSION and ship new sw-timeclock.js.
// The browser fetches the new SW on next page load, sees it's different,
// installs it, claims clients, posts 'reload' to open windows. Done — no
// user action required.

const VERSION = '2026-05-05-v1';
const CACHE = 'jg-timeclock-' + VERSION;

// Static assets only — NOT timeclock.html. HTML always goes to network.
const STATIC_ASSETS = [
  '/jg-dispatch/logo.png',
  '/jg-dispatch/timeclock-manifest.json'
];

self.addEventListener('install', function(e) {
  // Activate as soon as install finishes — don't wait for old SW to die
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(STATIC_ASSETS).catch(function(){});
    })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      // Purge ALL old timeclock caches (any version that isn't current)
      return Promise.all(
        keys.filter(function(key) {
          return key.indexOf('jg-timeclock-') === 0 && key !== CACHE;
        }).map(function(key) {
          return caches.delete(key);
        })
      );
    }).then(function() {
      // Take control of all open timeclock tabs/PWAs immediately
      return self.clients.claim();
    }).then(function() {
      // Tell every open client to reload so they pick up the new code
      return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({ type: 'sw-updated', version: VERSION });
        });
      });
    })
  );
});

self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;

  var url;
  try { url = new URL(e.request.url); } catch (err) { return; }

  // Only handle requests under our scope (timeclock + its assets)
  // Pass through anything else (cross-origin, other apps, API)
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/jg-dispatch/') !== 0) return;

  // Don't intercept other app pages — only timeclock + its dedicated assets
  var pathname = url.pathname;
  var isTimeclockPage = pathname.endsWith('/timeclock.html') || pathname.endsWith('/jg-dispatch/timeclock.html');
  var isOurAsset = STATIC_ASSETS.indexOf(pathname) !== -1;
  if (!isTimeclockPage && !isOurAsset) return;

  // NETWORK-FIRST for timeclock.html: always try network, fall back to
  // cache only on offline. This way code updates ALWAYS propagate.
  if (isTimeclockPage) {
    e.respondWith(
      fetch(e.request, { credentials: 'same-origin', cache: 'no-store' }).then(function(response) {
        // Cache the latest version for offline fallback
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE).then(function(cache) { cache.put(e.request, clone); });
        }
        return response;
      }).catch(function() {
        // Offline — serve last good cached version
        return caches.match(e.request);
      })
    );
    return;
  }

  // Static assets: cache-first, fall back to network
  if (isOurAsset) {
    e.respondWith(
      caches.match(e.request).then(function(cached) {
        return cached || fetch(e.request).then(function(response) {
          if (response && response.status === 200) {
            var clone = response.clone();
            caches.open(CACHE).then(function(cache) { cache.put(e.request, clone); });
          }
          return response;
        });
      })
    );
  }
});
