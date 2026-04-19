/**
 * JG Restoration — Shared Sidebar
 * ================================
 * Single source of truth for the platform navigation.
 *
 * HOW TO USE: Add this ONE line to each page's <head> or before </body>:
 *   <script src="sidebar.js"></script>
 *
 * Then REMOVE the page's existing sidebar <style> and <nav id="jg-sidebar"> blocks.
 *
 * Auto-injects:
 *   - Sidebar CSS (scoped to #jg-sidebar)
 *   - Sidebar nav element
 *   - body padding-left to offset the collapsed rail
 *   - Active state for the current page
 *
 * To add/rename/remove menu items, edit the SIDEBAR_MENU array below.
 */
(function() {
  'use strict';

  // ── MENU DEFINITION ── single source of truth
  var SIDEBAR_MENU = [
    { section: 'PLATFORM' },
    { label: 'Hub',                 icon: '🏠',  url: 'hub.html' },

    { section: 'OPERATIONS' },
    { label: 'Dispatch',            icon: '📋',  url: 'index.html' },

    { section: 'TIME' },
    { label: 'Time Admin',          icon: '⏱',  url: 'timeclock_admin.html' },
    { label: 'Clock In/Out',        icon: '🕐',  url: 'timeclock.html' },

    { section: 'SALES' },
    { label: 'Sales Dashboard',     icon: '📈',  url: 'sales.html' },
    { label: 'Sales Admin',         icon: '🔐',  url: 'sales_admin.html' },

    { section: 'AI TOOLS' },
    { label: 'QA Review',           icon: '🔍',  url: 'qa.html' },
    { label: 'Adjuster Rebuttal',   icon: '⚖️',  url: 'adjuster.html' },
    { label: 'Recon Estimate',      icon: '🏗️',  url: 'recon.html' },

    { section: 'INSIGHTS' },
    { label: 'Adjuster Intel',      icon: '🧠',  url: 'intelligence.html' },

    { section: 'QUICK ACTIONS' },
    { label: 'Request Time Off',    icon: '🏖',  url: 'timeclock.html?action=vacation' }
  ];

  // ── CSS ── scoped to #jg-sidebar, matches existing hub.html styling
  var CSS = `
#jg-sidebar{position:fixed;left:0;top:0;bottom:0;width:48px;background:#0d2d5e;display:flex;flex-direction:column;z-index:90;box-shadow:2px 0 12px rgba(0,0,0,.15);transition:width .22s cubic-bezier(.4,0,.2,1);overflow:hidden;white-space:nowrap;font-family:'DM Sans',system-ui,sans-serif;}
#jg-sidebar:hover,#jg-sidebar.expanded{width:200px;z-index:200;box-shadow:4px 0 24px rgba(0,0,0,.3);overflow-y:auto;}
#jg-sidebar::-webkit-scrollbar{width:4px;}
#jg-sidebar::-webkit-scrollbar-thumb{background:rgba(255,255,255,.15);border-radius:2px;}
#jg-sidebar .sb-logo{padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.1);display:flex;align-items:center;min-height:52px;flex-shrink:0;}
#jg-sidebar .sb-logo img{height:28px;width:28px;object-fit:contain;flex-shrink:0;border-radius:4px;}
#jg-sidebar .sb-sec{font-size:9px;font-weight:700;color:rgba(255,255,255,.3);text-transform:uppercase;letter-spacing:.1em;padding:12px 14px 4px;font-family:monospace;opacity:0;transition:opacity .15s .1s;flex-shrink:0;}
#jg-sidebar:hover .sb-sec,#jg-sidebar.expanded .sb-sec{opacity:1;}
#jg-sidebar a.sb-lnk{display:flex;align-items:center;gap:10px;padding:9px 14px;font-size:12px;font-weight:500;color:rgba(255,255,255,.65);text-decoration:none;border-left:3px solid transparent;transition:all .15s;flex-shrink:0;}
#jg-sidebar a.sb-lnk:hover{background:rgba(255,255,255,.08);color:#fff;border-left-color:rgba(255,255,255,.3);}
#jg-sidebar a.sb-lnk.active{background:rgba(255,255,255,.12);color:#fff;border-left-color:#e85d04;font-weight:600;}
#jg-sidebar .sb-icon{font-size:16px;width:20px;text-align:center;flex-shrink:0;}
#jg-sidebar .sb-label{opacity:0;transition:opacity .15s .05s;overflow:hidden;}
#jg-sidebar:hover .sb-label,#jg-sidebar.expanded .sb-label{opacity:1;}
#jg-sidebar .sb-btm{margin-top:auto;padding:10px 14px;border-top:1px solid rgba(255,255,255,.1);flex-shrink:0;}
#jg-sidebar .sb-user{display:flex;align-items:center;gap:8px;font-size:11px;color:rgba(255,255,255,.55);cursor:pointer;padding:4px 0;}
#jg-sidebar .sb-user:hover{color:#fff;}
#jg-sidebar .sb-user-label{opacity:0;transition:opacity .15s .05s;overflow:hidden;}
#jg-sidebar:hover .sb-user-label,#jg-sidebar.expanded .sb-user-label{opacity:1;}
body{padding-left:48px;box-sizing:border-box;}
`;

  // ── DETERMINE ACTIVE PAGE ──
  function currentFilename() {
    var path = window.location.pathname;
    var filename = path.substring(path.lastIndexOf('/') + 1) || 'index.html';
    var q = filename.indexOf('?');
    if (q !== -1) filename = filename.substring(0, q);
    return filename;
  }

  // ── BUILD HTML ──
  function buildSidebarHtml() {
    var activePage = currentFilename();
    var html = '<div class="sb-logo"><img src="https://jgimprovements-arch.github.io/jg-dispatch/logo.png" alt="JG"></div>';

    SIDEBAR_MENU.forEach(function(item) {
      if (item.section) {
        html += '<div class="sb-sec">' + item.section + '</div>';
      } else {
        var linkPage = item.url.split('?')[0];
        var isActive = (linkPage === activePage);
        html += '<a href="' + item.url + '" class="sb-lnk' + (isActive ? ' active' : '') + '">';
        html += '<span class="sb-icon">' + item.icon + '</span>';
        html += '<span class="sb-label">' + item.label + '</span>';
        html += '</a>';
      }
    });

    html += '<div class="sb-btm">';
    html += '<div class="sb-user" onclick="if(typeof jgSignOut===\'function\')jgSignOut();else window.location=\'hub.html\'" title="Sign out">';
    html += '<span id="sb-av">👤</span>';
    html += '<span class="sb-user-label"><span id="sb-nm">...</span></span>';
    html += '</div></div>';

    return html;
  }

  // ── INJECTION ──
  function injectSidebar() {
    var existing = document.getElementById('jg-sidebar');
    if (existing) existing.remove();

    if (!document.getElementById('jg-sidebar-css')) {
      var style = document.createElement('style');
      style.id = 'jg-sidebar-css';
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    var nav = document.createElement('nav');
    nav.id = 'jg-sidebar';
    nav.innerHTML = buildSidebarHtml();
    document.body.insertBefore(nav, document.body.firstChild);
  }

  // ── USER NAME POPULATION ──
  // Reads from jg_platform_user (the actual localStorage key used by all pages)
  function tryPopulateUser() {
    var nmEl = document.getElementById('sb-nm');
    var avEl = document.getElementById('sb-av');
    if (!nmEl) return;

    var user = null;
    try {
      var cached = localStorage.getItem('jg_platform_user');
      if (cached) user = JSON.parse(cached);
    } catch(e) {}

    // Fallback: in-memory globals set by page-specific auth
    if (!user) user = window.JG_USER || window._user;

    if (user && (user.name || user.email || user.given_name)) {
      var displayName = user.given_name || (user.name ? user.name.split(' ')[0] : null) || user.email.split('@')[0];
      nmEl.textContent = displayName;
      if (avEl && user.picture) {
        avEl.innerHTML = '<img src="' + user.picture + '" style="width:22px;height:22px;border-radius:50%;object-fit:cover;">';
      } else if (avEl) {
        avEl.textContent = '👤';
      }
    }
  }

  // ── INIT ──
  function init() {
    injectSidebar();
    tryPopulateUser();
    // Re-try user population after auth resolves async
    setTimeout(tryPopulateUser, 500);
    setTimeout(tryPopulateUser, 1500);
    // Refresh when auth changes in another tab
    window.addEventListener('storage', function(e) {
      if (e.key === 'jg_platform_user') tryPopulateUser();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ── PUBLIC API ──
  window.JGSidebar = {
    refresh: tryPopulateUser,
    setActive: function(filename) {
      document.querySelectorAll('#jg-sidebar a.sb-lnk').forEach(function(a) {
        a.classList.toggle('active', a.getAttribute('href').split('?')[0] === filename);
      });
    },
    menu: SIDEBAR_MENU
  };
})();
