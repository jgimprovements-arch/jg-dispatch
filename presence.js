/**
 * JG Platform — Presence Tracker
 * ==============================
 * Tracks who is currently signed into the platform using Supabase Realtime
 * Presence. No heartbeats, no tables, no cleanup jobs — disconnects detected
 * automatically (~5 seconds after tab close).
 *
 * HOW TO USE:
 *   Add <script src="presence.js"></script> to any page where users are
 *   authenticated. It reads jg_platform_user from localStorage and joins
 *   the 'jg-platform-presence' channel automatically.
 *
 * READ THE PRESENCE LIST:
 *   Other pages (like admin.html) can call:
 *     window.JGPresence.online()  →  [{ name, email, page, since }]
 *     window.JGPresence.count()   →  number
 *     window.JGPresence.subscribe(callback)  →  notifies on change
 *
 * DEPENDENCIES:
 *   Supabase JS client — loaded from CDN if not already present.
 */
(function(){
  'use strict';

  var SB_URL = 'https://nuykvchgecpiuikoerze.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51eWt2Y2hnZWNwaXVpa29lcnplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNjM3ODYsImV4cCI6MjA5MTgzOTc4Nn0.39hZ8DdjT_0iFJXPeAL2FXUSLw8FZBirDVzxZTO1W9s';
  var CHANNEL = 'jg-platform-presence';

  var _client = null;
  var _channel = null;
  var _me = null;
  var _state = []; // current online users
  var _subs = []; // subscriber callbacks
  var _joinedAt = null;

  // ── LOAD SUPABASE CLIENT IF NOT ALREADY ──
  function ensureSupabase(cb){
    if (window.supabase && typeof window.supabase.createClient === 'function') return cb();
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    s.onload = cb;
    s.onerror = function(){ console.warn('[JGPresence] Supabase client failed to load'); };
    document.head.appendChild(s);
  }

  // ── READ AUTHENTICATED USER ──
  function readUser(){
    try {
      var raw = localStorage.getItem('jg_platform_user');
      if (!raw) return null;
      var u = JSON.parse(raw);
      if (!u || !u.email) return null;
      // Expiry check
      var exp = localStorage.getItem('jg_platform_exp');
      if (exp && Date.now() > parseInt(exp)) return null;
      return u;
    } catch(e) { return null; }
  }

  // ── DETERMINE CURRENT PAGE LABEL ──
  function pageLabel(){
    var path = window.location.pathname || '';
    var name = path.substring(path.lastIndexOf('/') + 1) || 'index.html';
    // Strip query + hash
    name = name.split('?')[0].split('#')[0];
    var labels = {
      'hub.html': 'Hub',
      'index.html': 'Dispatch',
      '': 'Dispatch',
      'sales.html': 'Sales',
      'sales_app.html': 'Sales (Mobile)',
      'timeclock.html': 'Clock In/Out',
      'timeclock_admin.html': 'Time Admin',
      'qa.html': 'QA Review',
      'adjuster.html': 'Rebuttal',
      'recon.html': 'Recon',
      'intelligence.html': 'Adjuster Intel',
      'admin.html': 'Admin Panel'
    };
    return labels[name] || name.replace('.html','');
  }

  // ── JOIN CHANNEL ──
  function join(){
    var u = readUser();
    if (!u) {
      // Try again when the user signs in
      window.addEventListener('storage', function onStorage(e){
        if (e.key === 'jg_platform_user' && e.newValue) {
          window.removeEventListener('storage', onStorage);
          setTimeout(join, 300);
        }
      });
      return;
    }

    _me = {
      email: (u.email || '').toLowerCase(),
      name: u.name || u.email.split('@')[0],
      picture: u.picture || '',
      page: pageLabel(),
      role: (u.role || 'User'),
      since: Date.now()
    };
    _joinedAt = _me.since;

    ensureSupabase(function(){
      try {
        // Use the shared Supabase instance (creates it if no one has yet)
        if (!_client) {
          if (window.JGSupabase && window.JGSupabase.client) {
            _client = window.JGSupabase.client;
          } else {
            _client = window.supabase.createClient(SB_URL, SB_KEY);
            // Publish it for other scripts on this page to share
            window.JGSupabase = window.JGSupabase || {};
            window.JGSupabase.client = _client;
          }
        }
        _channel = _client.channel(CHANNEL, {
          config: { presence: { key: _me.email } }
        });

        _channel.on('presence', { event: 'sync' }, function(){
          var raw = _channel.presenceState();
          var out = [];
          Object.keys(raw).forEach(function(key){
            // raw[key] is an array of presence entries for this key (multiple tabs possible)
            var entries = raw[key] || [];
            if (!entries.length) return;
            // Dedupe by email, taking the most recent entry (for multi-tab users)
            var latest = entries[0];
            entries.forEach(function(e){ if ((e.since||0) > (latest.since||0)) latest = e; });
            out.push(latest);
          });
          // Sort by since asc (earliest joiners first)
          out.sort(function(a,b){ return (a.since||0) - (b.since||0); });
          _state = out;
          _subs.forEach(function(cb){ try { cb(out); } catch(e){} });
        });

        _channel.subscribe(function(status){
          if (status === 'SUBSCRIBED') {
            _channel.track(_me);
          }
        });

        // Update presence on page hide/show (so "page" field reflects reality)
        document.addEventListener('visibilitychange', function(){
          if (!_channel || _channel.state !== 'joined') return;
          var updated = Object.assign({}, _me, { page: pageLabel() });
          _channel.track(updated);
        });

        // Graceful leave
        window.addEventListener('pagehide', function(){
          try { if (_channel) _channel.untrack(); } catch(e){}
        });
      } catch(e){
        console.warn('[JGPresence] failed:', e);
      }
    });
  }

  // ── PUBLIC API ──
  window.JGPresence = {
    online: function(){ return _state.slice(); },
    count: function(){ return _state.length; },
    me: function(){ return _me; },
    subscribe: function(cb){
      if (typeof cb !== 'function') return function(){};
      _subs.push(cb);
      // Fire immediately with current state
      try { cb(_state.slice()); } catch(e){}
      return function unsubscribe(){
        _subs = _subs.filter(function(f){ return f !== cb; });
      };
    },
    refresh: join
  };

  // ── START ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', join);
  } else {
    setTimeout(join, 0);
  }
})();
