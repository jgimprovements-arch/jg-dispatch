/**
 * JG Restoration — Shared Contacts Widget
 * ========================================
 * Adds a floating "📇 Contacts" button to any page.
 * Click → slide-up panel with live employee directory, grouped by role.
 * Each contact has Call / Text / Email action buttons (work on desktop + mobile).
 *
 * USAGE: Add this line to any HTML page's <head> or before </body>:
 *   <script src="contacts-widget.js"></script>
 */
(function() {
  'use strict';

  var SB_URL = 'https://nuykvchgecpiuikoerze.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51eWt2Y2hnZWNwaXVpa29lcnplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNjM3ODYsImV4cCI6MjA5MTgzOTc4Nn0.39hZ8DdjT_0iFJXPeAL2FXUSLw8FZBirDVzxZTO1W9s';
  var ROLE_ORDER = ['Admin','Project Manager','Office','Estimator','Sales','Technician'];

  var CW = {
    employees: [],
    loaded: false,
    search: '',
    open: false,
    realtimeInit: false
  };

  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function attrEsc(s) { return String(s||'').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  function initials(n) {
    var p = (n||'').trim().split(/\s+/);
    return (((p[0]||'')[0]||'') + ((p[1]||'')[0]||'')).toUpperCase() || '?';
  }

  function roleClass(r) {
    if (!r) return 'tech';
    var s = r.toLowerCase();
    if (s === 'admin') return 'admin';
    if (s === 'project manager') return 'pm';
    if (s === 'office') return 'office';
    return 'tech';
  }

  function formatPhone(p) {
    if (!p) return '';
    var d = String(p).replace(/\D/g,'');
    if (d.length === 10) return '(' + d.slice(0,3) + ') ' + d.slice(3,6) + '-' + d.slice(6);
    if (d.length === 11 && d[0] === '1') return '(' + d.slice(1,4) + ') ' + d.slice(4,7) + '-' + d.slice(7);
    return p;
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch(e) {}
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch(e) { return false; }
  }

  function showToast(msg) {
    var t = document.getElementById('cw-toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(CW._toastTimer);
    CW._toastTimer = setTimeout(function(){ t.classList.remove('show'); }, 1800);
  }

  // Public: triggered from onclick
  window.cwHandleContact = async function(kind, value, label) {
    if (!value) return;
    await copyToClipboard(value);
    var url = null;
    if (kind === 'call')  url = 'tel:+1' + value.replace(/\D/g,'');
    if (kind === 'sms')   url = 'sms:+1' + value.replace(/\D/g,'');
    if (kind === 'email') url = 'mailto:' + value;
    if (url) {
      var a = document.createElement('a');
      a.href = url;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function(){ document.body.removeChild(a); }, 100);
    }
    showToast('📋 Copied ' + label + ': ' + value);
  };

  var CSS = [
    '#cw-btn{position:fixed;bottom:20px;right:20px;width:52px;height:52px;border-radius:50%;background:#e85d04;color:#fff;border:none;box-shadow:0 4px 12px rgba(232,93,4,.35);cursor:pointer;font-size:22px;z-index:9000;display:flex;align-items:center;justify-content:center;transition:transform .15s;}',
    '#cw-btn:hover{transform:scale(1.08);}',
    '#cw-btn.open{background:#0d2d5e;}',
    '#cw-overlay{position:fixed;inset:0;background:rgba(13,29,60,.55);z-index:8990;display:none;animation:cw-fade .18s ease-out;}',
    '#cw-overlay.open{display:block;}',
    '@keyframes cw-fade{from{opacity:0}to{opacity:1}}',
    '@keyframes cw-slide{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}',
    '#cw-panel{position:fixed;bottom:82px;right:20px;width:380px;max-width:calc(100vw - 40px);max-height:70vh;background:#fff;border-radius:12px;box-shadow:0 12px 48px rgba(0,0,0,.25);z-index:9001;display:none;flex-direction:column;overflow:hidden;animation:cw-slide .22s ease-out;}',
    '#cw-panel.open{display:flex;}',
    '#cw-head{background:#0d2d5e;color:#fff;padding:12px 14px;display:flex;align-items:center;gap:10px;flex-shrink:0;}',
    '#cw-head-title{font-size:13px;font-weight:700;}',
    '#cw-head-sub{font-size:10px;color:rgba(255,255,255,.6);font-family:"DM Mono",monospace;}',
    '#cw-close{margin-left:auto;background:rgba(255,255,255,.15);border:none;color:#fff;width:26px;height:26px;border-radius:50%;font-size:14px;cursor:pointer;}',
    '#cw-search-wrap{padding:8px 10px;border-bottom:1px solid #e1e4ea;flex-shrink:0;}',
    '#cw-search{width:100%;padding:7px 10px;font-size:13px;border:1px solid #e1e4ea;border-radius:5px;outline:none;font-family:inherit;box-sizing:border-box;}',
    '#cw-search:focus{border-color:#e85d04;}',
    '#cw-body{overflow-y:auto;-webkit-overflow-scrolling:touch;flex:1;padding:6px 4px 10px;}',
    '.cw-group{margin-top:6px;}',
    '.cw-group-head{padding:4px 12px;font-size:9px;font-weight:700;color:#0d2d5e;text-transform:uppercase;letter-spacing:.06em;font-family:"DM Mono",monospace;display:flex;gap:6px;align-items:center;}',
    '.cw-group-count{background:rgba(13,45,94,.08);color:#0d2d5e;font-size:9px;padding:1px 5px;border-radius:6px;}',
    '.cw-contact{padding:8px 12px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #f0f2f6;}',
    '.cw-contact:last-child{border-bottom:none;}',
    '.cw-av{width:30px;height:30px;border-radius:50%;background:#0d2d5e;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:10px;font-family:"DM Mono",monospace;flex-shrink:0;}',
    '.cw-av.pm{background:#1565c0;}',
    '.cw-av.admin{background:#e85d04;}',
    '.cw-av.office{background:#7c3aed;}',
    '.cw-av.tech{background:#2e7d32;}',
    '.cw-info{flex:1;min-width:0;}',
    '.cw-name{font-size:12px;font-weight:700;color:#0d2d5e;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.cw-meta{font-size:9px;color:#6b7a96;text-transform:uppercase;letter-spacing:.04em;margin-top:1px;font-family:"DM Mono",monospace;}',
    '.cw-act{display:flex;gap:3px;flex-shrink:0;}',
    '.cw-act button{display:flex;align-items:center;justify-content:center;width:28px;height:28px;background:rgba(13,45,94,.05);color:#0d2d5e;border:none;border-radius:5px;cursor:pointer;font-size:12px;padding:0;transition:all .12s;}',
    '.cw-act button:hover{background:#e85d04;color:#fff;transform:scale(1.05);}',
    '.cw-act button:active{transform:scale(0.95);}',
    '.cw-act button.disabled{background:rgba(0,0,0,.03);color:#c0c5ce;cursor:not-allowed;pointer-events:none;}',
    '.cw-empty{padding:24px;text-align:center;color:#6b7a96;font-size:12px;}',
    '.cw-loading{padding:24px;text-align:center;color:#6b7a96;font-size:12px;}',
    '#cw-toast{position:fixed;bottom:82px;left:50%;transform:translateX(-50%) translateY(10px);background:#0d2d5e;color:#fff;padding:8px 14px;border-radius:6px;font-size:12px;font-weight:600;box-shadow:0 4px 14px rgba(0,0,0,.2);opacity:0;transition:all .2s;pointer-events:none;z-index:9999;}',
    '#cw-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}',
    '@media(max-width:480px){#cw-panel{left:10px;right:10px;bottom:78px;width:auto;max-height:75vh;}#cw-toast{bottom:140px;}}'
  ].join('\n');

  function injectStyle() {
    if (document.getElementById('cw-style')) return;
    var s = document.createElement('style');
    s.id = 'cw-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function injectUI() {
    if (document.getElementById('cw-btn')) return;
    var html = '<button id="cw-btn" onclick="ContactsWidget.toggle()" title="Contacts">📇</button>';
    html += '<div id="cw-overlay" onclick="ContactsWidget.close()"></div>';
    html += '<div id="cw-panel" role="dialog" aria-label="Contacts">';
    html += '<div id="cw-head">';
    html += '<span style="font-size:16px;">📇</span>';
    html += '<div><div id="cw-head-title">Contacts</div><div id="cw-head-sub"></div></div>';
    html += '<button id="cw-close" onclick="ContactsWidget.close()">×</button>';
    html += '</div>';
    html += '<div id="cw-search-wrap"><input type="text" id="cw-search" placeholder="Search..." oninput="ContactsWidget._onSearch(this.value)"></div>';
    html += '<div id="cw-body" class="cw-loading">Loading…</div>';
    html += '</div>';
    html += '<div id="cw-toast"></div>';
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
  }

  async function loadData() {
    try {
      var r = await fetch(SB_URL + '/rest/v1/employees?active=eq.true&select=name,email,phone,role,market&order=role.asc,name.asc', {
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY }
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      CW.employees = await r.json();
      CW.loaded = true;
      if (CW.open) render();
      var sub = document.getElementById('cw-head-sub');
      if (sub) sub.textContent = CW.employees.length + ' active';
    } catch(e) {
      var b = document.getElementById('cw-body');
      if (b) b.innerHTML = '<div class="cw-empty" style="color:#c02020">Could not load</div>';
    }
  }

  function render() {
    var body = document.getElementById('cw-body');
    if (!body) return;
    body.className = '';

    if (!CW.loaded) {
      body.className = 'cw-loading';
      body.textContent = 'Loading…';
      return;
    }

    var q = (CW.search||'').toLowerCase().trim();
    var filtered = q
      ? CW.employees.filter(function(e){
          return (e.name||'').toLowerCase().indexOf(q) !== -1
            || (e.role||'').toLowerCase().indexOf(q) !== -1
            || (e.market||'').toLowerCase().indexOf(q) !== -1
            || (e.email||'').toLowerCase().indexOf(q) !== -1
            || (e.phone||'').toLowerCase().indexOf(q) !== -1;
        })
      : CW.employees;

    if (!filtered.length) {
      body.innerHTML = '<div class="cw-empty">' + (q ? 'No matching contacts' : 'No employees found') + '</div>';
      return;
    }

    var groups = {};
    filtered.forEach(function(e){
      var role = e.role || '(No Role)';
      if (!groups[role]) groups[role] = [];
      groups[role].push(e);
    });
    var sortedRoles = Object.keys(groups).sort(function(a,b){
      var ai = ROLE_ORDER.indexOf(a); if (ai === -1) ai = 99;
      var bi = ROLE_ORDER.indexOf(b); if (bi === -1) bi = 99;
      return ai - bi;
    });

    var html = '';
    sortedRoles.forEach(function(role){
      var items = groups[role];
      html += '<div class="cw-group">';
      html += '<div class="cw-group-head"><span>' + esc(role) + '</span><span class="cw-group-count">' + items.length + '</span></div>';
      items.forEach(function(e){ html += renderContact(e); });
      html += '</div>';
    });
    body.innerHTML = html;
  }

  function renderContact(e) {
    var phone = e.phone || '';
    var email = e.email || '';
    var h = '<div class="cw-contact">';
    h += '<div class="cw-av ' + roleClass(e.role) + '">' + esc(initials(e.name)) + '</div>';
    h += '<div class="cw-info">';
    h += '<div class="cw-name">' + esc(e.name || '(No name)') + '</div>';
    h += '<div class="cw-meta">' + esc(e.role||'—') + (e.market ? ' · ' + esc(e.market) : '') + '</div>';
    h += '</div>';
    h += '<div class="cw-act">';
    if (phone) {
      h += '<button title="Call" onclick="cwHandleContact(\'call\',\'' + attrEsc(phone) + '\',\'phone\')">📞</button>';
      h += '<button title="Text" onclick="cwHandleContact(\'sms\',\'' + attrEsc(phone) + '\',\'phone\')">💬</button>';
    } else {
      h += '<button class="disabled" title="No phone on file">📞</button>';
      h += '<button class="disabled" title="No phone on file">💬</button>';
    }
    if (email) {
      h += '<button title="Email" onclick="cwHandleContact(\'email\',\'' + attrEsc(email) + '\',\'email\')">✉️</button>';
    } else {
      h += '<button class="disabled" title="No email on file">✉️</button>';
    }
    h += '</div></div>';
    return h;
  }

  function initRealtime() {
    if (CW.realtimeInit) return;
    CW.realtimeInit = true;
    if (window.JGSupabase && window.JGSupabase.client) {
      try {
        window.JGSupabase.client.channel('rt_contacts_widget')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, loadData)
          .subscribe();
      } catch(e) { console.warn('contacts rt failed:', e); }
    } else {
      if (typeof window.supabase === 'undefined') {
        var script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
        script.onload = function(){
          try {
            var c = window.supabase.createClient(SB_URL, SB_KEY);
            window.JGSupabase = window.JGSupabase || {};
            window.JGSupabase.client = c;
            c.channel('rt_contacts_widget')
              .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, loadData)
              .subscribe();
          } catch(e) { console.warn('contacts rt init failed:', e); }
        };
        document.head.appendChild(script);
      }
    }
  }

  window.ContactsWidget = {
    open: function() {
      CW.open = true;
      document.getElementById('cw-btn').classList.add('open');
      document.getElementById('cw-overlay').classList.add('open');
      document.getElementById('cw-panel').classList.add('open');
      if (!CW.loaded) loadData();
      else render();
      initRealtime();
      setTimeout(function(){
        var s = document.getElementById('cw-search');
        if (s) s.focus();
      }, 120);
    },
    close: function() {
      CW.open = false;
      var btn = document.getElementById('cw-btn'); if (btn) btn.classList.remove('open');
      var ov = document.getElementById('cw-overlay'); if (ov) ov.classList.remove('open');
      var p = document.getElementById('cw-panel'); if (p) p.classList.remove('open');
    },
    toggle: function() { CW.open ? this.close() : this.open(); },
    _onSearch: function(v) { CW.search = v; render(); }
  };

  function boot() {
    var path = window.location.pathname.toLowerCase();
    if (path.indexOf('contacts.html') !== -1) return;
    if (path.indexOf('onboarding.html') !== -1) return;
    if (path.indexOf('sign_noncompete.html') !== -1) return;
    if (path.indexOf('sales_app.html') !== -1) return;
    injectStyle();
    injectUI();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
