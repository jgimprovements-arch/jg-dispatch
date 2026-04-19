/**
 * JG Timeclock — Dispatch Tab
 * ===========================
 * Adds a Dispatch view inside timeclock.html.
 *
 *   Tech role        → Read-only list of their own assigned jobs
 *   PM / Admin role  → All assignments across markets, can reassign jobs
 *
 * HOW IT WIRES IN:
 *   <script src="tc-dispatch.js"></script>  (before </body>, after the main app script)
 *
 * DEPENDS ON (already in timeclock.html):
 *   - TC global object (has employee, user, jobs, selectedJobId)
 *   - sb(path, opts) helper for Supabase REST
 *   - ADMINS constant (array of admin emails)
 *   - SB_URL / SB_KEY in global scope via sb() helper
 *
 * DATA:
 *   - Reads/writes Supabase `board_state` row where id = 'current'
 *     state.jobNames[jobId]               → display name
 *     state.assignments[market][tech][]   → ordered job ids for that tech
 *     state.unassigned[market][]          → job ids with no tech
 *   - Reads Supabase `employees` for the tech roster per market
 */
(function() {
  'use strict';

  // Wait for TC to be ready
  function ready(cb) {
    if (window.TC && window.sb) return cb();
    setTimeout(function() { ready(cb); }, 120);
  }

  ready(function() {

  // ── ROLE HELPERS ─────────────────────────
  function role() {
    if (!window.TC) return 'Technician';
    if (window.TC.user && window.ADMINS && window.ADMINS.indexOf(window.TC.user.email.toLowerCase()) !== -1) return 'Admin';
    var r = window.TC.employee ? window.TC.employee.role : 'Technician';
    return r || 'Technician';
  }
  function canEdit() {
    var r = role();
    return r === 'Admin' || r === 'Project Manager' || r === 'Office';
  }
  function myName() {
    return window.TC.employee ? window.TC.employee.name : (window.TC.user ? window.TC.user.name : '');
  }
  function myFirst() {
    return (myName() || '').split(' ')[0].toLowerCase();
  }

  // ── STATE ────────────────────────────────
  var D = {
    state: null,              // full board_state.state
    employees: [],            // all active employees
    loading: false,
    error: null,
    market: 'appleton',       // active tab within dispatch
    dragJob: null,
    dragSource: null,         // { market, tech }  or  { market, pool: true }
    lastLoad: null
  };

  // ── CSS ──────────────────────────────────
  var CSS = [
    '#tc-dispatch-overlay{position:fixed;inset:0;background:rgba(13,29,60,.5);z-index:500;display:none;align-items:flex-start;justify-content:center;}',
    '#tc-dispatch-overlay.open{display:flex;}',
    '#tc-dispatch-panel{background:#fff;width:100%;max-width:920px;height:100%;overflow-y:auto;-webkit-overflow-scrolling:touch;border-radius:0;animation:tcdSlideUp .22s ease-out;display:flex;flex-direction:column;}',
    '@keyframes tcdSlideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}',
    '#tc-dispatch-head{background:#0d2d5e;color:#fff;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10;flex-shrink:0;}',
    '.tcd-head-l{display:flex;align-items:center;gap:10px;}',
    '.tcd-title{font-size:14px;font-weight:700;}',
    '.tcd-subtitle{font-size:11px;color:rgba(255,255,255,.65);font-family:"DM Mono",monospace;}',
    '.tcd-close{background:rgba(255,255,255,.1);border:none;color:#fff;width:32px;height:32px;border-radius:6px;cursor:pointer;font-size:18px;}',
    '.tcd-close:hover{background:rgba(255,255,255,.2);}',
    '.tcd-role-badge{font-size:9px;font-weight:700;padding:3px 8px;border-radius:10px;text-transform:uppercase;letter-spacing:.06em;font-family:"DM Mono",monospace;}',
    '.tcd-role-badge.edit{background:rgba(232,147,12,.2);color:#f5a623;}',
    '.tcd-role-badge.read{background:rgba(255,255,255,.12);color:rgba(255,255,255,.85);}',
    '#tc-dispatch-tabs{background:#fff;border-bottom:1px solid rgba(13,45,94,.12);padding:0 16px;display:flex;gap:4px;overflow-x:auto;flex-shrink:0;}',
    '.tcd-tab{padding:11px 14px;font-size:12px;font-weight:600;color:#6b7a96;background:none;border:none;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap;font-family:"DM Sans",sans-serif;}',
    '.tcd-tab.active{color:#e85d04;border-bottom-color:#e85d04;}',
    '.tcd-tab:hover{color:#0d1f3c;}',
    '#tc-dispatch-body{padding:12px;flex:1;background:#f0ede8;}',
    '.tcd-stats{display:flex;gap:8px;margin-bottom:12px;overflow-x:auto;-webkit-overflow-scrolling:touch;}',
    '.tcd-stat{background:#fff;border:1px solid rgba(13,45,94,.1);border-radius:8px;padding:8px 12px;flex-shrink:0;min-width:82px;}',
    '.tcd-stat-val{font-size:18px;font-weight:700;color:#0d2d5e;font-family:"DM Mono",monospace;line-height:1;}',
    '.tcd-stat-lbl{font-size:9px;color:#6b7a96;text-transform:uppercase;letter-spacing:.05em;margin-top:3px;font-family:"DM Mono",monospace;font-weight:600;}',
    '.tcd-empty{text-align:center;padding:40px 20px;color:#6b7a96;font-size:13px;}',
    '.tcd-refresh{font-size:10px;color:#6b7a96;font-family:"DM Mono",monospace;}',

    /* Tech-read view */
    '.tcd-mylane{background:#fff;border-radius:10px;box-shadow:0 1px 3px rgba(13,45,94,.08);overflow:hidden;margin-bottom:12px;}',
    '.tcd-mylane-head{background:#0d2d5e;color:#fff;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;}',
    '.tcd-mylane-name{font-size:13px;font-weight:700;}',
    '.tcd-mylane-meta{font-size:10px;color:rgba(255,255,255,.7);font-family:"DM Mono",monospace;}',
    '.tcd-mylane-body{padding:4px 0;}',
    '.tcd-myjob{padding:12px 14px;border-bottom:1px solid rgba(13,45,94,.06);display:flex;align-items:flex-start;gap:10px;}',
    '.tcd-myjob:last-child{border-bottom:none;}',
    '.tcd-myjob.active{background:rgba(46,125,50,.06);}',
    '.tcd-myjob-num{width:22px;height:22px;border-radius:50%;background:#e8e4df;color:#0d2d5e;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;font-family:"DM Mono",monospace;flex-shrink:0;}',
    '.tcd-myjob.active .tcd-myjob-num{background:#2e7d32;color:#fff;}',
    '.tcd-myjob-body{flex:1;min-width:0;}',
    '.tcd-myjob-name{font-size:13px;font-weight:600;color:#0d1f3c;word-break:break-word;}',
    '.tcd-myjob-meta{font-size:11px;color:#6b7a96;margin-top:2px;font-family:"DM Mono",monospace;}',
    '.tcd-myjob-btn{background:#e85d04;color:#fff;border:none;padding:6px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;}',
    '.tcd-myjob-btn:disabled{background:#a0abbf;cursor:default;}',
    '.tcd-myjob-active-tag{font-size:9px;color:#2e7d32;font-weight:700;text-transform:uppercase;letter-spacing:.06em;font-family:"DM Mono",monospace;background:rgba(46,125,50,.12);padding:3px 8px;border-radius:4px;align-self:center;}',

    /* PM edit view */
    '.tcd-lane{background:#fff;border-radius:10px;margin-bottom:10px;overflow:hidden;box-shadow:0 1px 3px rgba(13,45,94,.05);}',
    '.tcd-lane.me{border:2px solid #e85d04;}',
    '.tcd-lane-head{padding:10px 12px;display:flex;align-items:center;justify-content:space-between;background:rgba(13,45,94,.04);border-bottom:1px solid rgba(13,45,94,.08);}',
    '.tcd-lane-head-l{display:flex;align-items:center;gap:8px;}',
    '.tcd-lane-avatar{width:28px;height:28px;border-radius:50%;background:#0d2d5e;color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;font-family:"DM Mono",monospace;}',
    '.tcd-lane-name{font-size:13px;font-weight:700;}',
    '.tcd-lane-role{font-size:9px;color:#6b7a96;text-transform:uppercase;letter-spacing:.04em;font-family:"DM Mono",monospace;}',
    '.tcd-lane-count{font-size:10px;background:rgba(13,45,94,.08);color:#0d1f3c;padding:3px 8px;border-radius:10px;font-weight:700;font-family:"DM Mono",monospace;}',
    '.tcd-lane-count.over{background:rgba(192,32,32,.12);color:#c02020;}',
    '.tcd-lane-body{min-height:44px;padding:4px 0;}',
    '.tcd-lane-body.empty{padding:16px;text-align:center;font-size:11px;color:#a0abbf;font-style:italic;}',
    '.tcd-lane-body.drag-over{background:rgba(232,93,4,.06);}',
    '.tcd-job{padding:10px 12px;border-bottom:1px solid rgba(13,45,94,.05);display:flex;align-items:center;gap:8px;cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;}',
    '.tcd-job:last-child{border-bottom:none;}',
    '.tcd-job.dragging{opacity:.4;}',
    '.tcd-job-name{font-size:12px;font-weight:600;color:#0d1f3c;flex:1;word-break:break-word;min-width:0;}',
    '.tcd-job-handle{color:#a0abbf;font-size:14px;cursor:grab;flex-shrink:0;}',
    '.tcd-job-reassign{background:none;border:1px solid rgba(13,45,94,.2);color:#0d2d5e;padding:4px 8px;border-radius:5px;font-size:10px;cursor:pointer;font-weight:700;flex-shrink:0;}',
    '.tcd-job-reassign:hover{background:#0d2d5e;color:#fff;}',

    /* Unassigned pool */
    '.tcd-pool{background:#fff;border:2px dashed rgba(232,93,4,.4);border-radius:10px;margin-bottom:10px;}',
    '.tcd-pool-head{padding:10px 12px;display:flex;align-items:center;justify-content:space-between;background:rgba(232,93,4,.06);border-radius:8px 8px 0 0;}',
    '.tcd-pool-title{font-size:11px;font-weight:700;color:#e85d04;text-transform:uppercase;letter-spacing:.05em;font-family:"DM Mono",monospace;}',
    '.tcd-pool-body{padding:4px 0;max-height:220px;overflow-y:auto;-webkit-overflow-scrolling:touch;}',
    '.tcd-pool-body.drag-over{background:rgba(232,93,4,.08);}',

    /* Reassign modal */
    '#tcd-reassign-modal{position:fixed;inset:0;background:rgba(13,29,60,.7);z-index:600;display:none;align-items:flex-end;justify-content:center;}',
    '#tcd-reassign-modal.open{display:flex;}',
    '.tcd-ra-sheet{background:#fff;border-radius:16px 16px 0 0;width:100%;max-width:520px;max-height:70vh;overflow-y:auto;padding:16px;padding-bottom:32px;animation:tcdSlideUp .18s ease-out;}',
    '.tcd-ra-title{font-size:14px;font-weight:700;margin-bottom:6px;}',
    '.tcd-ra-sub{font-size:11px;color:#6b7a96;margin-bottom:14px;font-family:"DM Mono",monospace;}',
    '.tcd-ra-option{display:flex;align-items:center;gap:10px;padding:12px;border:1px solid rgba(13,45,94,.1);border-radius:8px;margin-bottom:6px;cursor:pointer;background:#fff;width:100%;text-align:left;font-family:inherit;}',
    '.tcd-ra-option:hover{border-color:#e85d04;background:rgba(232,93,4,.04);}',
    '.tcd-ra-option.pool{border-color:rgba(232,93,4,.3);background:rgba(232,93,4,.04);}',
    '.tcd-ra-avatar{width:30px;height:30px;border-radius:50%;background:#0d2d5e;color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;font-family:"DM Mono",monospace;flex-shrink:0;}',
    '.tcd-ra-info{flex:1;min-width:0;}',
    '.tcd-ra-name{font-size:13px;font-weight:600;}',
    '.tcd-ra-meta{font-size:10px;color:#6b7a96;font-family:"DM Mono",monospace;}',

    /* Toast */
    '#tcd-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0d2d5e;color:#fff;padding:10px 16px;border-radius:8px;font-size:12px;z-index:1000;display:none;box-shadow:0 8px 24px rgba(0,0,0,.2);}',
    '#tcd-toast.show{display:block;animation:tcdFade .2s ease-out;}',
    '@keyframes tcdFade{from{opacity:0;transform:translate(-50%,4px)}to{opacity:1;transform:translate(-50%,0)}}',

    /* Entry button in main UI */
    '#tcd-entry-btn{background:#0d2d5e;color:#fff;border:none;padding:10px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:8px;width:100%;margin-top:10px;box-shadow:0 2px 6px rgba(13,45,94,.15);}',
    '#tcd-entry-btn:hover{background:#081d40;}',
    '#tcd-entry-btn .dot{width:6px;height:6px;border-radius:50%;background:#4cdb7a;animation:tcdPulse 2s infinite;}',
    '@keyframes tcdPulse{0%,100%{opacity:1}50%{opacity:.4}}',

    /* Large screen */
    '@media (min-width:768px){#tc-dispatch-panel{border-radius:14px;height:auto;max-height:90vh;margin-top:24px;margin-bottom:24px;}#tc-dispatch-head{border-radius:14px 14px 0 0;}}'
  ].join('\n');

  // ── HELPERS ──────────────────────────────
  function initials(n) { return (n || '?').split(' ').map(function(w){return w[0];}).join('').toUpperCase().slice(0,2); }
  function esc(s) { return String(s || '').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function marketLabel(k) { return k === 'appleton' ? 'Appleton' : k === 'stevens_point' ? 'Stevens Point' : k; }
  function marketEmp(m) { return m === 'appleton' ? 'Appleton' : 'Stevens Point'; }
  function toast(msg) {
    var t = document.getElementById('tcd-toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function() { t.classList.remove('show'); }, 2200);
  }

  // ── INJECT ───────────────────────────────
  function inject() {
    if (document.getElementById('tc-dispatch-css')) return;

    var style = document.createElement('style');
    style.id = 'tc-dispatch-css';
    style.textContent = CSS;
    document.head.appendChild(style);

    var overlay = document.createElement('div');
    overlay.id = 'tc-dispatch-overlay';
    overlay.innerHTML = [
      '<div id="tc-dispatch-panel">',
        '<div id="tc-dispatch-head">',
          '<div class="tcd-head-l">',
            '<button class="tcd-close" onclick="TCDispatch.close()" aria-label="Close">&times;</button>',
            '<div>',
              '<div class="tcd-title">📋 Dispatch</div>',
              '<div class="tcd-subtitle" id="tcd-subtitle">loading&hellip;</div>',
            '</div>',
          '</div>',
          '<div style="display:flex;align-items:center;gap:8px;">',
            '<span class="tcd-role-badge" id="tcd-role-badge">—</span>',
            '<button class="tcd-close" onclick="TCDispatch.refresh()" title="Refresh">&#x21bb;</button>',
          '</div>',
        '</div>',
        '<div id="tc-dispatch-tabs"></div>',
        '<div id="tc-dispatch-body"><div class="tcd-empty">Loading board&hellip;</div></div>',
      '</div>'
    ].join('');
    document.body.appendChild(overlay);

    var toastEl = document.createElement('div');
    toastEl.id = 'tcd-toast';
    document.body.appendChild(toastEl);

    var reassign = document.createElement('div');
    reassign.id = 'tcd-reassign-modal';
    reassign.innerHTML = '<div class="tcd-ra-sheet" id="tcd-ra-sheet"></div>';
    reassign.onclick = function(e) { if (e.target === reassign) closeReassign(); };
    document.body.appendChild(reassign);

    // Inject entry button after the clock card
    insertEntryButton();
  }

  function insertEntryButton() {
    if (document.getElementById('tcd-entry-btn')) return;
    // Find the clock-card and insert button after it
    var card = document.querySelector('.clock-card');
    if (!card) { setTimeout(insertEntryButton, 400); return; }
    var btn = document.createElement('button');
    btn.id = 'tcd-entry-btn';
    btn.onclick = function() { window.TCDispatch.open(); };
    btn.innerHTML = '<span class="dot"></span><span>📋 Dispatch Board</span><span style="margin-left:auto;font-size:16px;">›</span>';
    card.parentNode.insertBefore(btn, card.nextSibling);
  }

  // ── LOAD DATA ────────────────────────────
  async function load() {
    D.loading = true;
    render();

    try {
      var bs = await window.sb('/rest/v1/board_state?id=eq.current&select=state,updated_at');
      D.state = (bs && bs[0] && bs[0].state) ? bs[0].state : { jobNames: {}, assignments: { appleton:{}, stevens_point:{} }, unassigned: { appleton:[], stevens_point:[] } };
      D.lastLoad = (bs && bs[0] && bs[0].updated_at) ? new Date(bs[0].updated_at) : new Date();

      // Normalize shape
      D.state.jobNames = D.state.jobNames || {};
      D.state.assignments = D.state.assignments || {};
      D.state.unassigned = D.state.unassigned || {};
      ['appleton','stevens_point'].forEach(function(m) {
        D.state.assignments[m] = D.state.assignments[m] || {};
        D.state.unassigned[m] = D.state.unassigned[m] || [];
      });

      // For PMs/Admins, pull the employee roster
      if (canEdit()) {
        var emp = await window.sb('/rest/v1/employees?active=eq.true&role=in.(Technician,%22Project%20Manager%22)&select=id,name,role,market');
        D.employees = emp || [];
      }

      D.error = null;
    } catch (err) {
      D.error = err.message || 'Load failed';
    }

    D.loading = false;
    render();
  }

  async function saveState() {
    try {
      var r = await window.sb('/rest/v1/board_state?id=eq.current', {
        method: 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify({ state: D.state, updated_at: new Date().toISOString() })
      });
      return r !== null;
    } catch (e) {
      return false;
    }
  }

  // ── ACTIONS ──────────────────────────────
  function findJobTech(market, jobId) {
    var a = D.state.assignments[market] || {};
    var techs = Object.keys(a);
    for (var i = 0; i < techs.length; i++) {
      if ((a[techs[i]] || []).indexOf(jobId) !== -1) return techs[i];
    }
    return null;
  }

  async function moveJob(market, jobId, toTech) {
    // Remove from current location
    var a = D.state.assignments[market];
    Object.keys(a).forEach(function(t) {
      a[t] = (a[t] || []).filter(function(id) { return id !== jobId; });
    });
    D.state.unassigned[market] = (D.state.unassigned[market] || []).filter(function(id) { return id !== jobId; });

    // Insert at destination
    if (toTech === '__unassigned__') {
      D.state.unassigned[market].push(jobId);
    } else {
      a[toTech] = a[toTech] || [];
      a[toTech].push(jobId);
    }

    var ok = await saveState();
    toast(ok ? '✓ Reassigned' : '⚠ Save failed — refresh to retry');
    render();
    return ok;
  }

  // ── REASSIGN MODAL ───────────────────────
  var pendingReassign = null;
  function openReassign(market, jobId) {
    pendingReassign = { market: market, jobId: jobId };
    var sheet = document.getElementById('tcd-ra-sheet');
    var jobName = D.state.jobNames[jobId] || jobId;
    var curTech = findJobTech(market, jobId);

    var techs = techsForMarket(market);
    var html = '<div class="tcd-ra-title">Reassign <span style="color:#e85d04">' + esc(jobName) + '</span></div>';
    html += '<div class="tcd-ra-sub">Currently: ' + (curTech ? esc(curTech) : 'Unassigned') + '</div>';

    if (curTech) {
      html += '<button class="tcd-ra-option pool" onclick="TCDispatch._pick(\'__unassigned__\')">';
      html += '<div class="tcd-ra-avatar" style="background:#e85d04">+</div>';
      html += '<div class="tcd-ra-info"><div class="tcd-ra-name">Move to Unassigned Pool</div><div class="tcd-ra-meta">Job returns to pool for later pickup</div></div>';
      html += '</button>';
    }

    techs.forEach(function(t) {
      if (t === curTech) return;
      var jobCount = (D.state.assignments[market][t] || []).length;
      html += '<button class="tcd-ra-option" onclick="TCDispatch._pick(\'' + esc(t).replace(/'/g,"\\'") + '\')">';
      html += '<div class="tcd-ra-avatar">' + initials(t) + '</div>';
      html += '<div class="tcd-ra-info"><div class="tcd-ra-name">' + esc(t) + '</div><div class="tcd-ra-meta">' + jobCount + ' job' + (jobCount===1?'':'s') + ' today</div></div>';
      html += '</button>';
    });

    sheet.innerHTML = html;
    document.getElementById('tcd-reassign-modal').classList.add('open');
  }

  function closeReassign() {
    document.getElementById('tcd-reassign-modal').classList.remove('open');
    pendingReassign = null;
  }

  async function pick(toTech) {
    if (!pendingReassign) return;
    var p = pendingReassign;
    closeReassign();
    await moveJob(p.market, p.jobId, toTech);
  }

  function techsForMarket(market) {
    // Derive tech list: employees in that market + any tech currently in the board_state
    var mLabel = marketEmp(market);
    var fromEmp = D.employees.filter(function(e) { return e.market === mLabel; }).map(function(e) { return e.name; });
    var fromBoard = Object.keys(D.state.assignments[market] || {});
    var all = fromEmp.concat(fromBoard);
    var seen = {};
    return all.filter(function(n) { if (seen[n]) return false; seen[n] = true; return true; }).sort();
  }

  // ── RENDER ───────────────────────────────
  function render() {
    // Role badge + subtitle
    var badge = document.getElementById('tcd-role-badge');
    var sub = document.getElementById('tcd-subtitle');
    if (badge) {
      if (canEdit()) { badge.textContent = role() + ' • Edit'; badge.className = 'tcd-role-badge edit'; }
      else { badge.textContent = 'Technician • View'; badge.className = 'tcd-role-badge read'; }
    }
    if (sub) {
      if (D.loading) sub.textContent = 'loading…';
      else if (D.error) sub.textContent = 'error: ' + D.error;
      else if (D.lastLoad) sub.textContent = 'synced ' + D.lastLoad.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
      else sub.textContent = '';
    }

    var body = document.getElementById('tc-dispatch-body');
    var tabs = document.getElementById('tc-dispatch-tabs');
    if (!body) return;

    if (D.loading) {
      body.innerHTML = '<div class="tcd-empty">Loading board&hellip;</div>';
      tabs.innerHTML = '';
      return;
    }
    if (D.error) {
      body.innerHTML = '<div class="tcd-empty">Could not load board.<br><br><button class="tcd-job-reassign" onclick="TCDispatch.refresh()">Try again</button></div>';
      tabs.innerHTML = '';
      return;
    }
    if (!D.state) {
      body.innerHTML = '<div class="tcd-empty">No dispatch data yet.</div>';
      return;
    }

    if (canEdit()) {
      renderEditView(body, tabs);
    } else {
      renderTechView(body, tabs);
    }
  }

  // ── TECH READ-ONLY VIEW ──────────────────
  function renderTechView(body, tabs) {
    tabs.innerHTML = '';
    var first = myFirst();
    var me = myName();

    // Find my jobs across both markets
    var myJobs = [];
    var myMarket = '';
    ['appleton','stevens_point'].forEach(function(m) {
      var a = D.state.assignments[m] || {};
      Object.keys(a).forEach(function(tech) {
        var tFirst = tech.split(' ')[0].toLowerCase();
        if (tFirst === first || tech.toLowerCase().indexOf(first) !== -1) {
          myMarket = marketLabel(m);
          (a[tech] || []).forEach(function(jid) {
            myJobs.push({ id: jid, name: D.state.jobNames[jid] || jid, market: m });
          });
        }
      });
    });

    var activeJobId = window.TC.activeEntry ? window.TC.activeEntry.job_id : null;
    var selectedId = window.TC.selectedJobId;

    var html = '';
    html += '<div class="tcd-stats">';
    html += '<div class="tcd-stat"><div class="tcd-stat-val">' + myJobs.length + '</div><div class="tcd-stat-lbl">My Jobs</div></div>';
    html += '<div class="tcd-stat"><div class="tcd-stat-val">' + (activeJobId ? '1' : '0') + '</div><div class="tcd-stat-lbl">Active</div></div>';
    html += '<div class="tcd-stat"><div class="tcd-stat-val">' + (myMarket || '—') + '</div><div class="tcd-stat-lbl">Market</div></div>';
    html += '</div>';

    if (!myJobs.length) {
      html += '<div class="tcd-empty">You don\'t have any jobs assigned right now.<br><br>Ask your dispatcher if this looks wrong.</div>';
      body.innerHTML = html;
      return;
    }

    html += '<div class="tcd-mylane">';
    html += '<div class="tcd-mylane-head"><div><div class="tcd-mylane-name">' + esc(me || 'You') + '</div><div class="tcd-mylane-meta">' + (myMarket || '') + ' · ' + myJobs.length + ' job' + (myJobs.length===1?'':'s') + '</div></div>';
    html += '<span style="font-size:9px;color:rgba(255,255,255,.65);font-family:\'DM Mono\',monospace;">TODAY</span>';
    html += '</div>';
    html += '<div class="tcd-mylane-body">';
    myJobs.forEach(function(j, i) {
      var isActive = j.id === activeJobId;
      var isSelected = j.id === selectedId;
      html += '<div class="tcd-myjob' + (isActive ? ' active' : '') + '">';
      html += '<div class="tcd-myjob-num">' + (i + 1) + '</div>';
      html += '<div class="tcd-myjob-body">';
      html += '<div class="tcd-myjob-name">' + esc(j.name) + '</div>';
      html += '<div class="tcd-myjob-meta">' + esc(j.id) + '</div>';
      html += '</div>';
      if (isActive) {
        html += '<span class="tcd-myjob-active-tag">● ACTIVE</span>';
      } else if (!window.TC.clockedIn) {
        html += '<button class="tcd-myjob-btn" onclick="TCDispatch._selectJob(\'' + esc(j.id).replace(/'/g,"\\'") + '\',\'' + esc(j.name).replace(/'/g,"\\'") + '\')">' + (isSelected ? '✓ Selected' : 'Select') + '</button>';
      }
      html += '</div>';
    });
    html += '</div></div>';

    body.innerHTML = html;
  }

  function selectJobFromList(jobId, jobName) {
    if (typeof window.selectJob === 'function') {
      window.selectJob(jobId, jobName, '');
    } else {
      window.TC.selectedJobId = jobId;
      window.TC.selectedJobName = jobName;
    }
    toast('Selected: ' + jobName);
    render();
  }

  // ── PM EDIT VIEW ─────────────────────────
  function renderEditView(body, tabs) {
    // Market tabs
    var markets = ['appleton','stevens_point'];
    tabs.innerHTML = markets.map(function(m) {
      return '<button class="tcd-tab' + (D.market === m ? ' active' : '') + '" onclick="TCDispatch._setMarket(\'' + m + '\')">' + marketLabel(m) + '</button>';
    }).join('');

    var m = D.market;
    var assignments = D.state.assignments[m] || {};
    var unassigned = D.state.unassigned[m] || [];
    var techs = techsForMarket(m);

    var totalJobs = Object.keys(assignments).reduce(function(n, t) { return n + (assignments[t] || []).length; }, 0) + unassigned.length;
    var assignedJobs = totalJobs - unassigned.length;

    var html = '';
    html += '<div class="tcd-stats">';
    html += '<div class="tcd-stat"><div class="tcd-stat-val">' + totalJobs + '</div><div class="tcd-stat-lbl">Total</div></div>';
    html += '<div class="tcd-stat"><div class="tcd-stat-val" style="color:#2e7d32">' + assignedJobs + '</div><div class="tcd-stat-lbl">Assigned</div></div>';
    html += '<div class="tcd-stat"><div class="tcd-stat-val" style="color:#c02020">' + unassigned.length + '</div><div class="tcd-stat-lbl">Unassigned</div></div>';
    html += '<div class="tcd-stat"><div class="tcd-stat-val">' + techs.length + '</div><div class="tcd-stat-lbl">Techs</div></div>';
    html += '</div>';

    // Unassigned pool (always visible at top)
    html += '<div class="tcd-pool">';
    html += '<div class="tcd-pool-head"><span class="tcd-pool-title">🚨 Unassigned · ' + unassigned.length + '</span>' + (unassigned.length ? '<span style="font-size:10px;color:#6b7a96;">Tap to assign</span>' : '') + '</div>';
    html += '<div class="tcd-pool-body" data-market="' + m + '" data-pool="1">';
    if (!unassigned.length) {
      html += '<div class="tcd-lane-body empty">All jobs assigned ✓</div>';
    } else {
      unassigned.forEach(function(jid) {
        var name = D.state.jobNames[jid] || jid;
        html += '<div class="tcd-job" data-job-id="' + esc(jid) + '" data-from-pool="1">';
        html += '<span class="tcd-job-handle">⠿</span>';
        html += '<span class="tcd-job-name">' + esc(name) + '</span>';
        html += '<button class="tcd-job-reassign" onclick="TCDispatch._open(\'' + m + '\',\'' + esc(jid).replace(/'/g,"\\'") + '\')">Assign</button>';
        html += '</div>';
      });
    }
    html += '</div></div>';

    // Tech lanes
    if (!techs.length) {
      html += '<div class="tcd-empty">No techs found for ' + marketLabel(m) + '</div>';
    } else {
      techs.forEach(function(tech) {
        var jobs = assignments[tech] || [];
        var isMe = tech.toLowerCase() === (myName() || '').toLowerCase();
        var over = jobs.length > 5; // soft cap
        html += '<div class="tcd-lane' + (isMe ? ' me' : '') + '">';
        html += '<div class="tcd-lane-head">';
        html += '<div class="tcd-lane-head-l"><div class="tcd-lane-avatar">' + initials(tech) + '</div>';
        html += '<div><div class="tcd-lane-name">' + esc(tech) + (isMe ? ' <span style="color:#e85d04;font-size:10px;">(you)</span>' : '') + '</div><div class="tcd-lane-role">Technician</div></div></div>';
        html += '<span class="tcd-lane-count' + (over ? ' over' : '') + '">' + jobs.length + '</span>';
        html += '</div>';
        html += '<div class="tcd-lane-body' + (jobs.length ? '' : ' empty') + '" data-market="' + m + '" data-tech="' + esc(tech) + '">';
        if (!jobs.length) {
          html += 'No jobs';
        } else {
          jobs.forEach(function(jid, idx) {
            var name = D.state.jobNames[jid] || jid;
            html += '<div class="tcd-job" data-job-id="' + esc(jid) + '" data-from-tech="' + esc(tech) + '">';
            html += '<span class="tcd-job-handle">⠿</span>';
            html += '<span class="tcd-job-name">' + (idx + 1) + '. ' + esc(name) + '</span>';
            html += '<button class="tcd-job-reassign" onclick="TCDispatch._open(\'' + m + '\',\'' + esc(jid).replace(/'/g,"\\'") + '\')">Move</button>';
            html += '</div>';
          });
        }
        html += '</div></div>';
      });
    }

    body.innerHTML = html;
  }

  // ── PUBLIC API ───────────────────────────
  window.TCDispatch = {
    open: function() {
      inject();
      document.getElementById('tc-dispatch-overlay').classList.add('open');
      load();
    },
    close: function() {
      var el = document.getElementById('tc-dispatch-overlay');
      if (el) el.classList.remove('open');
    },
    refresh: load,
    _setMarket: function(m) { D.market = m; render(); },
    _open: openReassign,
    _pick: pick,
    _selectJob: selectJobFromList,
    _state: function() { return D; }
  };

  // Inject entry button on ready
  inject();

  // Re-inject entry button if timeclock re-renders
  var reInjectTimer = null;
  var observer = new MutationObserver(function() {
    clearTimeout(reInjectTimer);
    reInjectTimer = setTimeout(insertEntryButton, 300);
  });
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: false });
  }

  }); // ready
})();
