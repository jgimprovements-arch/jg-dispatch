// ══════════════════════════════════════════════════════════════════════════
// sales-shared.js — Single source of truth for sales platform constants,
// permissions, and market resolution. Loaded by sales.html and sales_app.html.
//
// Keep the version string in sync with the ?v= query string used to load this
// file. When you change anything here, bump the version and update the two
// <script src="sales-shared.js?v=..."> tags in sales.html and sales_app.html.
// ══════════════════════════════════════════════════════════════════════════

(function(global){
  'use strict';

  var VERSION = '2026-04-20-1';

  // ── CONSTANTS ───────────────────────────────────────────────────────────
  // Partner types — alphabetical. Used by both desktop filter pills and
  // mobile type pills. Do NOT add "Firefighter" — it was collapsed into
  // "Fire Department" on 2026-04-20 to eliminate mobile/desktop drift.
  var PARTNER_TYPES = [
    'Assisted Living',
    'Chamber of Commerce',
    'Charity',
    'Customer',
    'Fire Department',
    'Foundation Repair',
    'GC',
    'HVAC',
    'Insurance Adjuster',
    'Insurance Agent',
    'Other',
    'Plumber',
    'Property Manager',
    'Realtor'
  ];

  // Type → avatar/chip color. Covers every type in PARTNER_TYPES so a tagged
  // partner never falls back to neutral gray on either platform.
  var TYPE_COLORS = {
    'Assisted Living':     '#827717',
    'Chamber of Commerce': '#455a64',
    'Charity':             '#558b2f',
    'Customer':            '#37474f',
    'Fire Department':     '#b71c1c',
    'Foundation Repair':   '#5d4037',
    'GC':                  '#4a148c',
    'HVAC':                '#00796b',
    'Insurance Adjuster':  '#ad1457',
    'Insurance Agent':     '#c0392b',
    'Other':               '#6b7a96',
    'Plumber':             '#1565c0',
    'Property Manager':    '#e65100',
    'Realtor':             '#6a1b9a'
  };

  // Email → display name. Lowercased emails only.
  var REPS = {
    'kristina@jg-restoration.com':   'Kristina',
    'rylan@jg-restoration.com':      'Rylan',
    'rylan.reoh@jg-restoration.com': 'Rylan',
    'david@jg-restoration.com':      'David',
    'brent@jg-restoration.com':      'Brent',
    'josh@jg-restoration.com':       'Josh',
    'josh.greil@jg-restoration.com': 'Josh'
  };

  // Live rep → home market map. Populated from the employees table at app
  // init via _refreshAllRepMarkets(). Key is the rep's display name (e.g.
  // "Kristina"), value is "Appleton" / "Stevens Point" / null. null means
  // employee record exists but has no market assigned — treat as "both".
  // Reps not in this map are unknown / former employees — also treat as
  // "both" so historical touches don't disappear.
  var _repMarketsByName = {};

  // Admin emails (lowercased). Admins bypass canEdit/canDelete checks.
  var ADMINS = [
    'josh@jg-restoration.com',
    'josh.greil@jg-restoration.com'
  ];

  // Valid markets. Used as fallback destination and for validation.
  var MARKETS = ['Appleton', 'Stevens Point'];
  var DEFAULT_MARKET = 'Appleton';

  // ── LOCAL-STORAGE KEYS (kept in sync with existing code) ────────────────
  var JG_USER_KEY = 'jg_platform_user';
  var JG_EXP_KEY  = 'jg_platform_exp';
  var REP_MARKET_CACHE_KEY = 'jg_rep_market_cache'; // cached market per email

  // ── RUNTIME STATE ───────────────────────────────────────────────────────
  // Populated by init(). Read by getRepMarket() and resolveMarketFor*().
  var _repMarket = null;
  var _initPromise = null;

  // ── AUTH HELPERS ────────────────────────────────────────────────────────
  function currentUser() {
    try {
      var raw = localStorage.getItem(JG_USER_KEY);
      var exp = localStorage.getItem(JG_EXP_KEY);
      if (!raw || !exp) return null;
      if (Date.now() >= parseInt(exp, 10)) return null;
      return JSON.parse(raw);
    } catch(e) {
      return null;
    }
  }

  function currentEmail() {
    var u = currentUser();
    return u && u.email ? u.email.toLowerCase() : '';
  }

  function currentRepName() {
    var u = currentUser();
    if (!u) return '';
    var byMap = REPS[currentEmail()];
    if (byMap) return byMap;
    if (u.name) return u.name.split(' ')[0];
    return u.email ? u.email.split('@')[0] : '';
  }

  function isAdmin() {
    var e = currentEmail();
    return !!e && ADMINS.indexOf(e) !== -1;
  }

  // A rep can edit a partner if:
  //   - they are an admin, OR
  //   - the partner is assigned to them, OR
  //   - the partner is unassigned (first-touch claim pattern)
  function canEdit(partner) {
    if (isAdmin()) return true;
    if (!partner) return false;
    var rep = currentRepName();
    if (!rep) return false;
    if (!partner.assigned_to) return true;
    return partner.assigned_to === rep;
  }

  // Only admins can delete partners.
  function canDelete() {
    return isAdmin();
  }

  // Only admins can reassign a partner to a different rep.
  function canReassign() {
    return isAdmin();
  }

  // ── MARKET RESOLUTION ───────────────────────────────────────────────────
  // Called once after login. Fetches rep's market from employees table and
  // caches it in localStorage so subsequent loads don't need the network.
  //
  // sbFetch: function(path) => Promise<Response>  — caller passes their own
  //   Supabase fetcher so we don't duplicate creds/URL here.
  function init(sbFetch) {
    if (_initPromise) return _initPromise;

    _initPromise = (function(){
      var email = currentEmail();
      if (!email) {
        _repMarket = DEFAULT_MARKET;
        return Promise.resolve(_repMarket);
      }

      // Try cache first
      try {
        var cached = JSON.parse(localStorage.getItem(REP_MARKET_CACHE_KEY) || '{}');
        if (cached[email]) {
          _repMarket = cached[email];
          // Still kick off a background refresh — don't await it
          _refreshMarketCache(sbFetch, email).catch(function(){});
          // Also refresh the all-reps map for the Touches tab filter
          _refreshAllRepMarkets(sbFetch).catch(function(){});
          return Promise.resolve(_repMarket);
        }
      } catch(e) {}

      // Cache miss — fetch synchronously. Also kick off the all-reps fetch
      // in parallel since the Touches tab filter depends on it.
      _refreshAllRepMarkets(sbFetch).catch(function(){});
      return _refreshMarketCache(sbFetch, email).then(function(m){
        _repMarket = m || DEFAULT_MARKET;
        return _repMarket;
      }).catch(function(){
        _repMarket = DEFAULT_MARKET;
        return _repMarket;
      });
    })();

    return _initPromise;
  }

  function _refreshMarketCache(sbFetch, email) {
    if (typeof sbFetch !== 'function') return Promise.resolve(null);
    return sbFetch('/rest/v1/employees?email=eq.' + encodeURIComponent(email) + '&select=market&limit=1')
      .then(function(r){
        if (!r || !r.ok) return null;
        return r.json();
      })
      .then(function(rows){
        if (!rows || !rows.length) return null;
        var m = rows[0].market;
        // Normalize lowercase-underscore convention from the employees table
        // (e.g. "stevens_point") to the proper-case format ("Stevens Point")
        // used everywhere else in the platform.
        if (typeof m === 'string') {
          var mLower = m.toLowerCase().replace(/_/g, ' ').trim();
          if (mLower === 'appleton') m = 'Appleton';
          else if (mLower === 'stevens point') m = 'Stevens Point';
        }
        if (!m || MARKETS.indexOf(m) === -1) return null;
        try {
          var cache = JSON.parse(localStorage.getItem(REP_MARKET_CACHE_KEY) || '{}');
          cache[email] = m;
          localStorage.setItem(REP_MARKET_CACHE_KEY, JSON.stringify(cache));
        } catch(e) {}
        _repMarket = m;
        return m;
      });
  }

  // Build the rep_name → market map from the employees table. Called by
  // init() so it's ready before the Touches tab renders. Keyed by display
  // name (matching what shows up in touches.logged_by) instead of email.
  // Best-effort — if the fetch fails, _repMarketsByName stays empty and
  // every rep gets "show in both markets" treatment via repMatchesMarket.
  function _refreshAllRepMarkets(sbFetch) {
    if (typeof sbFetch !== 'function') return Promise.resolve();
    return sbFetch('/rest/v1/employees?active=eq.true&select=email,name,market')
      .then(function(r){
        if (!r || !r.ok) return null;
        return r.json();
      })
      .then(function(rows){
        if (!rows || !rows.length) return;
        var map = {};
        rows.forEach(function(emp){
          if (!emp.email) return;
          // Match against our REPS dict so the key is the display name we
          // actually use elsewhere (Kristina, not kristina@jg-...). Falls
          // back to the employee's `name` field if not in REPS, and finally
          // to a name derived from the employee record.
          var displayName = REPS[(emp.email||'').toLowerCase()];
          if (!displayName && emp.name) {
            // Take first name from the employee record (e.g. "Kristina K." → "Kristina")
            displayName = String(emp.name).split(/\s+/)[0];
          }
          if (!displayName) return;
          var m = emp.market;
          // Normalize the market value. The employees table uses
          // lowercase-underscore convention (stevens_point, appleton) while
          // the rest of the platform uses proper case with spaces (Stevens
          // Point, Appleton). Map between them so the validator below
          // accepts both formats.
          if (typeof m === 'string') {
            var mLower = m.toLowerCase().replace(/_/g, ' ').trim();
            if (mLower === 'appleton') m = 'Appleton';
            else if (mLower === 'stevens point') m = 'Stevens Point';
          }
          // Validate — only Appleton or Stevens Point. Anything else (null,
          // empty, unknown) means "no specific market" → treated as both.
          if (m && MARKETS.indexOf(m) === -1) m = null;
          map[displayName] = m;
        });
        _repMarketsByName = map;
      })
      .catch(function(){ /* best-effort, leave map empty */ });
  }

  // Returns whether a rep should be visible in the given market tab.
  // Logic:
  //   - touch with no logged_by → show in all markets
  //   - market filter is 'All' → show in all markets
  //   - rep is in the map with a specific market → match exactly
  //   - rep is in the map but has null market → show in both (no specified home)
  //   - rep is NOT in the map (former employee, unknown name) → show in both
  // Bias is toward showing data, not hiding it. Hiding rep activity by
  // mistake is more confusing than seeing too much.
  function repMatchesMarket(repName, market) {
    if (!repName) return true;
    if (!market || market === 'All') return true;
    if (!(repName in _repMarketsByName)) return true;  // unknown / former
    var home = _repMarketsByName[repName];
    if (!home) return true;  // employee record exists, no market set
    return home === market;
  }

  // Returns the rep's home market. DEFAULT_MARKET if init() hasn't completed
  // or the rep has no market set. Safe to call any time.
  function getRepMarket() {
    return _repMarket || DEFAULT_MARKET;
  }

  // Resolve the market for a new touch. Priority:
  //   1. partner.market (most specific — the partner belongs to a market)
  //   2. rep's assigned market (from employees table)
  //   3. DEFAULT_MARKET (safety net)
  function resolveMarketForTouch(partner) {
    if (partner && partner.market && MARKETS.indexOf(partner.market) !== -1) {
      return partner.market;
    }
    return getRepMarket();
  }

  // Resolve the market for a new route / route template. Routes don't have
  // a partner until stops are added, so we always use the rep's market.
  function resolveMarketForRoute() {
    return getRepMarket();
  }

  // Resolve the market for a new partner created from the field. Uses the
  // rep's market since there's no prior record to inherit from.
  function resolveMarketForNewPartner() {
    return getRepMarket();
  }

  // ── EXPORT ──────────────────────────────────────────────────────────────
  global.JG_SHARED = {
    version: VERSION,
    PARTNER_TYPES: PARTNER_TYPES,
    TYPE_COLORS: TYPE_COLORS,
    REPS: REPS,
    ADMINS: ADMINS,
    MARKETS: MARKETS,
    DEFAULT_MARKET: DEFAULT_MARKET,
    repMatchesMarket: repMatchesMarket,
    auth: {
      currentUser: currentUser,
      currentEmail: currentEmail,
      currentRepName: currentRepName,
      isAdmin: isAdmin,
      canEdit: canEdit,
      canDelete: canDelete,
      canReassign: canReassign
    },
    market: {
      init: init,
      getRepMarket: getRepMarket,
      resolveMarketForTouch: resolveMarketForTouch,
      resolveMarketForRoute: resolveMarketForRoute,
      resolveMarketForNewPartner: resolveMarketForNewPartner
    },
    geo: (function(){
      // ── GEOCODING + ROUTE BUILDING ─────────────────────────────────────
      // Caches geocoded addresses in Supabase so we only hit Nominatim once
      // per unique address. Provides distance math + nearest-neighbor route
      // construction.
      //
      // Nominatim usage policy: max 1 request/second/IP, must include a
      // User-Agent. We respect this by serializing geocode calls through a
      // queue with 1100ms spacing.

      var SB_URL = 'https://nuykvchgecpiuikoerze.supabase.co';
      var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51eWt2Y2hnZWNwaXVpa29lcnplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNjM3ODYsImV4cCI6MjA5MTgzOTc4Nn0.39hZ8DdjT_0iFJXPeAL2FXUSLw8FZBirDVzxZTO1W9s';

      function _norm(addr) {
        if (!addr) return '';
        return String(addr).toLowerCase().trim().replace(/\s+/g,' ');
      }

      function _sleep(ms) {
        return new Promise(function(r){ setTimeout(r, ms); });
      }

      // Fetch any existing cache rows for a list of normalized addresses
      function getCached(addresses) {
        if (!addresses || !addresses.length) return Promise.resolve({});
        var unique = Array.from(new Set(addresses.map(_norm).filter(Boolean)));
        if (!unique.length) return Promise.resolve({});
        // Supabase 'in' filter — escape commas in addresses by URL-encoding
        var inList = '(' + unique.map(function(a){
          return '"' + a.replace(/"/g, '\\"') + '"';
        }).join(',') + ')';
        var url = SB_URL + '/rest/v1/geocoded_addresses?address_normalized=in.' + encodeURIComponent(inList) + '&select=*';
        return fetch(url, {
          headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY }
        }).then(function(r){ return r.ok ? r.json() : []; }).then(function(rows){
          var byAddr = {};
          rows.forEach(function(row){ byAddr[row.address_normalized] = row; });
          return byAddr;
        }).catch(function(){ return {}; });
      }

      // Save a geocoded result to the cache (upsert by address_normalized)
      function _saveCache(normalized, original, lat, lng, displayName, confidence) {
        var url = SB_URL + '/rest/v1/geocoded_addresses?on_conflict=address_normalized';
        return fetch(url, {
          method: 'POST',
          headers: {
            'apikey': SB_KEY,
            'Authorization': 'Bearer ' + SB_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates'
          },
          body: JSON.stringify({
            address_normalized: normalized,
            address_original: original,
            latitude: lat,
            longitude: lng,
            display_name: displayName,
            confidence: confidence,
            source: 'nominatim'
          })
        }).catch(function(err){ console.warn('cache save failed:', err); });
      }

      // Geocode a single address via Nominatim
      function _geocodeOne(address) {
        var url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(address);
        return fetch(url, {
          headers: {
            // Nominatim policy requires a real User-Agent. Browsers don't
            // let us set User-Agent header from JS, but the Referer is
            // automatically set to our origin which is policy-acceptable.
            'Accept': 'application/json'
          }
        }).then(function(r){ return r.ok ? r.json() : []; });
      }

      // Geocode a batch with caching + 1.1s rate limit between live calls.
      // Returns map: { normalized_address: { lat, lng, confidence } | null }
      function geocodeBatch(addresses, onProgress) {
        return getCached(addresses).then(function(cache){
          var results = {};
          var toFetch = [];
          addresses.forEach(function(a){
            var n = _norm(a);
            if (!n) return;
            if (cache[n]) {
              results[n] = {
                lat: cache[n].latitude,
                lng: cache[n].longitude,
                confidence: cache[n].confidence
              };
            } else {
              toFetch.push({ original: a, normalized: n });
            }
          });
          if (!toFetch.length) return results;

          // Sequential with rate limit
          var idx = 0;
          function next() {
            if (idx >= toFetch.length) return Promise.resolve();
            var item = toFetch[idx++];
            if (onProgress) onProgress(idx, toFetch.length);
            return _geocodeOne(item.original).then(function(arr){
              if (arr && arr.length > 0) {
                var hit = arr[0];
                var lat = parseFloat(hit.lat);
                var lng = parseFloat(hit.lon);
                var conf = hit.importance > 0.5 ? 'exact' : 'approximate';
                results[item.normalized] = { lat: lat, lng: lng, confidence: conf };
                _saveCache(item.normalized, item.original, lat, lng, hit.display_name, conf);
              } else {
                results[item.normalized] = null;
                _saveCache(item.normalized, item.original, null, null, null, 'failed');
              }
            }).catch(function(){
              results[item.normalized] = null;
            }).then(function(){
              return _sleep(1100).then(next);
            });
          }

          return next().then(function(){ return results; });
        });
      }

      // Haversine distance in miles between two lat/lng pairs
      function distanceMiles(lat1, lng1, lat2, lng2) {
        var R = 3958.8; // earth radius in miles
        var toRad = function(d){ return d * Math.PI / 180; };
        var dLat = toRad(lat2 - lat1);
        var dLng = toRad(lng2 - lng1);
        var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
                Math.sin(dLng/2) * Math.sin(dLng/2);
        var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
      }

      // Build a route via nearest-neighbor traversal.
      // Inputs:
      //   start: { lat, lng } — starting point
      //   stops: array of { id, name, address, lat, lng, score (optional) }
      //   maxStops: integer
      // Returns: ordered array of stops with cumulative distance
      function buildRoute(start, stops, maxStops) {
        var unvisited = stops.slice();
        var route = [];
        var current = { lat: start.lat, lng: start.lng };
        var totalMiles = 0;

        while (route.length < maxStops && unvisited.length > 0) {
          // Find nearest unvisited stop, with optional score weighting
          var bestIdx = -1;
          var bestScore = Infinity;
          for (var i = 0; i < unvisited.length; i++) {
            var s = unvisited[i];
            if (s.lat == null || s.lng == null) continue;
            var d = distanceMiles(current.lat, current.lng, s.lat, s.lng);
            // Score: distance penalty minus stop's own score (higher = better)
            // Higher score (e.g., A-tier, stale partner) reduces effective distance.
            var weighted = d - (s.score || 0) * 0.5;
            if (weighted < bestScore) {
              bestScore = weighted;
              bestIdx = i;
            }
          }
          if (bestIdx === -1) break;
          var picked = unvisited.splice(bestIdx, 1)[0];
          var leg = distanceMiles(current.lat, current.lng, picked.lat, picked.lng);
          totalMiles += leg;
          route.push(Object.assign({}, picked, { leg_miles: leg, cum_miles: totalMiles }));
          current = { lat: picked.lat, lng: picked.lng };
        }

        return { stops: route, total_miles: totalMiles };
      }

      // Score a partner for route inclusion. Higher = more desirable to visit.
      // Factors: tier (A=3, B=2, C=1), staleness (more days since touch = higher),
      // partner has phone (small bonus, easier to call ahead).
      function scorePartner(partner, lastTouchDate) {
        var score = 0;
        if (partner.tier === 'A') score += 6;
        else if (partner.tier === 'B') score += 3;
        else if (partner.tier === 'C') score += 1;

        if (lastTouchDate) {
          var daysSince = (Date.now() - new Date(lastTouchDate).getTime()) / 86400000;
          // Cap staleness bonus at 60 days (no extra credit for ancient relationships)
          score += Math.min(daysSince / 7, 8);
        } else {
          // Never touched — high priority
          score += 10;
        }

        if (partner.phone) score += 0.5;
        return score;
      }

      // Pick a default start point for a market (geographic centroid of
      // existing partners, fallback to known city centers)
      var MARKET_CENTERS = {
        'Appleton':       { lat: 44.2619, lng: -88.4154, name: 'Appleton, WI' },
        'Stevens Point':  { lat: 44.5238, lng: -89.5746, name: 'Stevens Point, WI' }
      };

      function getMarketCenter(market) {
        return MARKET_CENTERS[market] || MARKET_CENTERS['Appleton'];
      }

      return {
        geocodeBatch: geocodeBatch,
        getCached: getCached,
        distanceMiles: distanceMiles,
        buildRoute: buildRoute,
        scorePartner: scorePartner,
        getMarketCenter: getMarketCenter,
        _norm: _norm  // exported for testing
      };
    })()
  };

})(typeof window !== 'undefined' ? window : this);
