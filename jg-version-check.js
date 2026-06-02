// JG Version Check — universal cache-busting helper
//
// Every JG app includes this script. On load, and every 5 minutes while
// the page is open, it fetches /version.json and compares the version
// string to what's stored in localStorage. If they differ, it hard-reloads
// the page so the user sees the fresh code.
//
// Why this exists:
//   PWAs, service workers, and aggressive browser caching make it hard
//   to guarantee that code reaches the field. Field staff would sometimes
//   spend hours on stale versions of an app, leading to bugs that "only
//   happen on this one phone." This solves that universally — any deploy
//   propagates to every device within ~5 minutes of opening the app.
//
// How to add to a new app:
//   <script src="jg-version-check.js"></script>
//   Place it BEFORE other scripts in <head>. No further wiring needed.
//
// Coexistence with service workers:
//   sales_app.html has its own SW with its own update mechanism. This
//   script's reload happens at most once per version change, so even if
//   the SW also triggers a reload, the user sees a single refresh, not
//   a loop. The localStorage write happens BEFORE reload so the new
//   page sees the new version and exits cleanly.

(function() {
  if (typeof window === 'undefined') return;

  // Per-app storage key so multiple apps on the same domain don't fight.
  // The pathname differentiates timeclock vs rebuild vs sales etc.
  var STORAGE_KEY = 'jg_app_version:' + window.location.pathname;
  var VERSION_URL = '/jg-dispatch/version.json';
  var POLL_INTERVAL_MS = 5 * 60 * 1000;  // 5 minutes

  // Track whether we've already triggered a reload this session to avoid
  // bouncing in a loop if anything goes weird.
  var reloadTriggered = false;

  async function checkVersion() {
    if (reloadTriggered) return;

    try {
      // cache:'no-store' bypasses HTTP cache so we always hit the server.
      // The query string is belt-and-suspenders for any proxy that
      // ignores cache-control.
      var resp = await fetch(VERSION_URL + '?_=' + Date.now(), {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!resp.ok) return;
      var data = await resp.json();
      if (!data || !data.version) return;

      var stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        // First visit — just store and continue. No reload needed.
        localStorage.setItem(STORAGE_KEY, data.version);
        return;
      }

      if (stored !== data.version) {
        // Version changed. Store new value FIRST so the reloaded page
        // doesn't bounce again, then reload.
        reloadTriggered = true;
        localStorage.setItem(STORAGE_KEY, data.version);
        console.log('[jg-version-check] New version detected (' +
          stored + ' → ' + data.version + '). Reloading…');
        // location.reload(true) is non-standard but widely supported as
        // "force-bypass cache." Modern path is to fetch a no-store URL,
        // which the polling above already does, so a plain reload suffices.
        window.location.reload();
      }
    } catch (err) {
      // Silently ignore network errors — the app continues working.
      // Next check in 5 minutes will try again.
    }
  }

  // Initial check ~1s after load so the app's own startup runs first
  // and a reload (if triggered) doesn't interrupt anything important.
  setTimeout(checkVersion, 1000);

  // Then poll every 5 minutes while the page is open. Catches deploys
  // that happen mid-session for users who never close their browser.
  setInterval(checkVersion, POLL_INTERVAL_MS);

  // Also check when the page returns to focus from a background tab,
  // since phone users often leave the app in the background for hours.
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') {
      checkVersion();
    }
  });
})();
