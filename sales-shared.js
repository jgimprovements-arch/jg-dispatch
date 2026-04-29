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
          // Validate market value — only Appleton or Stevens Point. null/missing
          // means "no specific market" → treated as both.
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
    }
  };

})(typeof window !== 'undefined' ? window : this);
