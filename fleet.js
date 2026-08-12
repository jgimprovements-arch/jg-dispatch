/* ============================================================
 * fleet.js — FLEET PROGRAM, SLICE 2
 * ============================================================
 * Two entry points, one file:
 *
 *   DISPATCH BOARD (index.html)
 *     JGFleet.laneSlot(empId, empName)  → placeholder HTML for a lane head
 *     JGFleet.mount(marketKey, dateStr) → fills every placeholder with a
 *                                         vehicle picker for that board day
 *
 *   TIMECLOCK (timeclock.html)
 *     JGFleet.punchOutFlow(empId, empName, entryId)
 *                                       → Promise<boolean>
 *                                         true  = continue with clock out
 *                                         false = tech backed out
 *
 * DESIGN RULE — FAILS SOFT, ALWAYS.
 * Dispatch and the time clock are load-bearing. Nothing in this file is
 * allowed to break either one. Every network call is wrapped; on any
 * error the picker simply doesn't render and the punch-out proceeds
 * normally. A fleet bug can cost you a mileage reading. It can never
 * cost you a dispatch board or a punch.
 * ============================================================ */
(function () {
  'use strict';

  var SB_URL = 'https://nuykvchgecpiuikoerze.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51eWt2Y2hnZWNwaXVpa29lcnplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNjM3ODYsImV4cCI6MjA5MTgzOTc4Nn0.39hZ8DdjT_0iFJXPeAL2FXUSLw8FZBirDVzxZTO1W9s';

  // Typo guard: a single day's driving that exceeds this is almost
  // certainly a fat-fingered odometer (84,210 typed as 842,100).
  var MAX_DAILY_MILES = 3000;

  var F = {
    vehicles: {},        // id → vehicle row
    byMarket: {},        // marketKey → [vehicle]
    assigns: {},         // employeeId → assignment row (for mounted day)
    openIssues: {},      // vehicleId → count of unresolved issues
    market: null,
    date: null,
    mounting: false
  };

  // ── plumbing ────────────────────────────────────────────────
  function hdr(json) {
    var h = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  // Every read goes through here. Returns null on ANY failure — callers
  // treat null as "fleet unavailable" and degrade silently.
  async function get(path) {
    try {
      var r = await fetch(SB_URL + '/rest/v1/' + path, { headers: hdr(false) });
      if (!r.ok) { console.warn('[fleet] GET ' + path + ' → ' + r.status); return null; }
      return await r.json();
    } catch (e) { console.warn('[fleet] GET failed:', e.message); return null; }
  }

  async function write(method, path, body, extraPrefer) {
    try {
      var h = hdr(true);
      h.Prefer = extraPrefer || 'return=minimal';
      var r = await fetch(SB_URL + '/rest/v1/' + path, {
        method: method, headers: h,
        body: body ? JSON.stringify(body) : undefined
      });
      if (!r.ok) {
        var t = '';
        try { t = await r.text(); } catch (e) {}
        console.warn('[fleet] ' + method + ' ' + path + ' → ' + r.status + ' ' + t);
        return false;
      }
      return true;
    } catch (e) { console.warn('[fleet] write failed:', e.message); return false; }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function say(msg) {
    // Reuse the host page's toast if it has one, otherwise stay silent
    // rather than throwing an alert into someone's workflow.
    try {
      if (typeof window.showToast === 'function') { window.showToast(msg); return; }
      if (typeof window.toast === 'function') { window.toast(msg); return; }
    } catch (e) {}
    console.log('[fleet] ' + msg);
  }

  // Dispatch day in Central with the same 5am rollover the board uses,
  // so a vehicle picked on the board and a punch-out at 11pm land on the
  // same assign_date.
  function dispatchDate() {
    var fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', hour12: false
    });
    var p = fmt.formatToParts(new Date()).reduce(function (a, x) { a[x.type] = x.value; return a; }, {});
    var y = parseInt(p.year, 10), m = parseInt(p.month, 10), d = parseInt(p.day, 10);
    var h = parseInt(p.hour, 10);
    if (h < 5) {
      var prev = new Date(Date.UTC(y, m - 1, d));
      prev.setUTCDate(prev.getUTCDate() - 1);
      y = prev.getUTCFullYear(); m = prev.getUTCMonth() + 1; d = prev.getUTCDate();
    }
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  // Board uses 'stevens'; the vehicles table uses 'stevens_point'.
  function marketKey(loc) {
    if (!loc) return null;
    var l = String(loc).toLowerCase();
    return (l.indexOf('stevens') !== -1 || l.indexOf('point') !== -1) ? 'stevens_point' : 'appleton';
  }

  function vehicleLabel(v) {
    var n = v.name || 'Vehicle';
    if (v.vehicle_number) n += ' #' + v.vehicle_number;
    return n;
  }

  function actorName() {
    try {
      var raw = localStorage.getItem('jg_dispatch_user') || localStorage.getItem('jg_user');
      if (raw) { var u = JSON.parse(raw); return u.name || u.email || 'platform'; }
    } catch (e) {}
    return 'platform';
  }

  // ── styles (injected once, scoped with jgf- prefix) ─────────
  function injectCss() {
    if (document.getElementById('jgf-css')) return;
    var s = document.createElement('style');
    s.id = 'jgf-css';
    s.textContent = [
      '.jgf-slot{display:block;}',
      '.jgf-row{display:flex;align-items:center;gap:4px;}',
      '.jgf-sel{flex:1;min-width:0;font-size:11px;font-weight:600;font-family:"DM Mono",monospace;',
      'background:#fff;border:1px solid rgba(255,255,255,.25);border-radius:4px;color:#0d1f3c;',
      'padding:3px 4px;cursor:pointer;}',
      '.jgf-sel.jgf-warn{background:#ffe9e5;border-color:#c02020;color:#8c1414;}',
      '.jgf-share{font-size:9px;color:rgba(255,255,255,.7);font-family:"DM Mono",monospace;flex-shrink:0;}',
      /* punch-out sheet */
      '.jgf-ov{position:fixed;inset:0;background:rgba(13,29,60,.72);z-index:9000;display:none;',
      'align-items:flex-end;justify-content:center;}',
      '.jgf-ov.open{display:flex;}',
      '.jgf-sheet{background:#fff;width:100%;max-width:520px;border-radius:18px 18px 0 0;',
      'padding:0 20px 28px;max-height:92vh;overflow-y:auto;box-shadow:0 -8px 30px rgba(0,0,0,.25);}',
      '.jgf-grab{width:36px;height:4px;border-radius:2px;background:#d0d5dd;margin:10px auto 16px;}',
      '.jgf-h{font-size:19px;font-weight:800;color:#0d2d5e;margin-bottom:2px;}',
      '.jgf-sub{font-size:12px;color:#6b7a96;margin-bottom:18px;}',
      '.jgf-lbl{font-size:11px;font-weight:700;color:#0d2d5e;text-transform:uppercase;',
      'letter-spacing:.05em;margin-bottom:6px;display:block;}',
      '.jgf-in{width:100%;font-size:22px;font-weight:700;font-family:"DM Mono",monospace;',
      'padding:14px 12px;border:2px solid #d5dce6;border-radius:10px;color:#0d1f3c;',
      'box-sizing:border-box;text-align:center;letter-spacing:.04em;}',
      '.jgf-in:focus{outline:none;border-color:#e85d04;}',
      '.jgf-sel2{width:100%;font-size:15px;padding:12px;border:2px solid #d5dce6;',
      'border-radius:10px;color:#0d1f3c;box-sizing:border-box;background:#fff;}',
      '.jgf-ta{width:100%;font-size:15px;padding:12px;border:2px solid #d5dce6;border-radius:10px;',
      'color:#0d1f3c;box-sizing:border-box;min-height:70px;font-family:inherit;resize:vertical;}',
      '.jgf-hint{font-size:11px;color:#6b7a96;margin-top:6px;}',
      '.jgf-seg{display:flex;gap:8px;margin-top:4px;}',
      '.jgf-seg button{flex:1;padding:14px 8px;border-radius:10px;border:2px solid #d5dce6;',
      'background:#fff;font-size:15px;font-weight:700;color:#0d2d5e;cursor:pointer;}',
      '.jgf-seg button.on{border-color:#e85d04;background:rgba(232,93,4,.08);color:#e85d04;}',
      '.jgf-blk{margin-bottom:20px;}',
      '.jgf-acts{display:flex;gap:10px;margin-top:6px;}',
      '.jgf-btn{flex:1;padding:16px;border-radius:12px;border:none;font-size:15px;',
      'font-weight:800;cursor:pointer;}',
      '.jgf-btn.go{background:#e85d04;color:#fff;}',
      '.jgf-btn.gh{background:#fff;color:#0d2d5e;border:2px solid #d5dce6;}',
      '.jgf-req{color:#c02020;}'
    ].join('');
    document.head.appendChild(s);
  }

  /* ==========================================================
   * DISPATCH BOARD
   * ========================================================== */

  // Emitted inline while renderBoard() builds the lane head. Purely a
  // placeholder — if mount() never succeeds it stays empty and the lane
  // looks exactly like it does today.
  function laneSlot(empId, empName) {
    if (!empId) return '';
    return '<div class="jgf-slot" data-jgf-emp="' + esc(empId) + '" data-jgf-name="' + esc(empName) + '"></div>';
  }

  async function mount(loc, dateStr) {
    try {
      injectCss();
      var mk = marketKey(loc);
      var day = dateStr || dispatchDate();
      if (!mk) return;
      if (F.mounting) return;
      F.mounting = true;

      // Reload only when the market or day actually changed — the board
      // re-renders constantly and we don't want to hammer Supabase.
      if (F.market !== mk || F.date !== day) {
        F.market = mk; F.date = day;
        F.vehicles = {}; F.byMarket = {}; F.assigns = {}; F.openIssues = {};

        var vs = await get('vehicles?select=id,name,vehicle_number,market,status,current_mileage'
          + '&status=in.(active,flagged,in_shop)&order=name.asc');
        if (vs) {
          vs.forEach(function (v) {
            F.vehicles[v.id] = v;
            // A vehicle with no market is a shared/pool unit — offer it everywhere.
            var key = v.market || '__pool__';
            (F.byMarket[key] = F.byMarket[key] || []).push(v);
          });
        }

        var as = await get('vehicle_assignments?select=id,vehicle_id,employee_id,employee_name,assign_date'
          + '&assign_date=eq.' + encodeURIComponent(day));
        if (as) as.forEach(function (a) { F.assigns[a.employee_id] = a; });

        var iss = await get('vehicle_issues?select=vehicle_id&status=neq.resolved');
        if (iss) iss.forEach(function (i) {
          F.openIssues[i.vehicle_id] = (F.openIssues[i.vehicle_id] || 0) + 1;
        });
      }

      paint(mk);
    } catch (e) {
      console.warn('[fleet] mount failed (board unaffected):', e.message);
    } finally {
      F.mounting = false;
    }
  }

  function paint(mk) {
    var list = (F.byMarket[mk] || []).concat(F.byMarket.__pool__ || []);
    if (!list.length) return; // no vehicles seeded → render nothing at all

    // How many people are on each vehicle today (crew sharing indicator).
    var shareCount = {};
    Object.keys(F.assigns).forEach(function (eid) {
      var vid = F.assigns[eid].vehicle_id;
      if (vid) shareCount[vid] = (shareCount[vid] || 0) + 1;
    });

    var slots = document.querySelectorAll('.jgf-slot[data-jgf-emp]');
    Array.prototype.forEach.call(slots, function (slot) {
      var eid = slot.getAttribute('data-jgf-emp');
      var enm = slot.getAttribute('data-jgf-name') || '';
      var cur = F.assigns[eid];
      var curId = cur ? cur.vehicle_id : '';
      var flagged = curId && (F.openIssues[curId] || (F.vehicles[curId] && F.vehicles[curId].status === 'flagged'));

      var opts = '<option value="">🚐 no vehicle</option>';
      var seen = {};
      list.forEach(function (v) {
        if (seen[v.id]) return; seen[v.id] = 1;
        var warn = F.openIssues[v.id] || v.status === 'flagged' ? ' ⚠' : '';
        opts += '<option value="' + esc(v.id) + '"' + (v.id === curId ? ' selected' : '') + '>'
          + esc(vehicleLabel(v)) + warn + '</option>';
      });
      // A vehicle assigned but no longer in the active list (retired
      // mid-day) still needs to show, or the picker would silently
      // misrepresent who is in what.
      if (curId && !seen[curId]) {
        var gone = F.vehicles[curId];
        opts += '<option value="' + esc(curId) + '" selected>'
          + esc(gone ? vehicleLabel(gone) : 'Vehicle (retired)') + '</option>';
      }

      var share = (curId && shareCount[curId] > 1) ? '<span class="jgf-share">+' + (shareCount[curId] - 1) + '</span>' : '';

      slot.innerHTML = '<div class="jgf-row">'
        + '<select class="jgf-sel' + (flagged ? ' jgf-warn' : '') + '"'
        + ' data-jgf-emp="' + esc(eid) + '" data-jgf-name="' + esc(enm) + '"'
        + ' onchange="JGFleet.setVehicle(this)" onclick="event.stopPropagation()"'
        + ' title="Vehicle for this day">' + opts + '</select>'
        + share + '</div>';
    });
  }

  async function setVehicle(sel) {
    try {
      var eid = sel.getAttribute('data-jgf-emp');
      var enm = sel.getAttribute('data-jgf-name') || '';
      var vid = sel.value;
      var day = F.date || dispatchDate();
      if (!eid) return;

      if (!vid) {
        var ok = await write('DELETE',
          'vehicle_assignments?employee_id=eq.' + encodeURIComponent(eid)
          + '&assign_date=eq.' + encodeURIComponent(day));
        if (ok) { delete F.assigns[eid]; say('Vehicle cleared'); }
        else say('⚠ Could not clear vehicle');
        paint(F.market);
        return;
      }

      var row = {
        vehicle_id: vid,
        employee_id: eid,
        employee_name: enm,
        assign_date: day,
        market: F.market,
        created_by: actorName()
      };
      var saved = await write('POST',
        'vehicle_assignments?on_conflict=employee_id,assign_date',
        row, 'resolution=merge-duplicates,return=minimal');

      if (saved) {
        F.assigns[eid] = row;
        var v = F.vehicles[vid];
        say('🚐 ' + (enm.split(' ')[0] || 'Tech') + ' → ' + (v ? vehicleLabel(v) : 'vehicle'));
      } else {
        say('⚠ Vehicle not saved');
      }
      paint(F.market);
    } catch (e) {
      console.warn('[fleet] setVehicle failed:', e.message);
    }
  }

  /* ==========================================================
   * TIMECLOCK — end-of-day odometer + issue report
   * ========================================================== */

  var ISSUE_CATEGORIES = [
    'Tires / wheels', 'Brakes', 'Engine / warning light', 'Fluids / leak',
    'Body / glass', 'Electrical / lights', 'Equipment / rack', 'Other'
  ];

  // Returns a Promise<boolean>. NEVER rejects — a fleet problem must not
  // be able to stop someone from punching out.
  function punchOutFlow(empId, empName, entryId) {
    return new Promise(function (resolve) {
      (async function () {
        try {
          if (!empId) return resolve(true);
          injectCss();
          var day = dispatchDate();

          var as = await get('vehicle_assignments?select=id,vehicle_id,employee_id'
            + '&employee_id=eq.' + encodeURIComponent(empId)
            + '&assign_date=eq.' + encodeURIComponent(day) + '&limit=1');
          if (!as || !as.length || !as[0].vehicle_id) return resolve(true); // no vehicle today

          var assign = as[0];
          var vs = await get('vehicles?select=id,name,vehicle_number,current_mileage,status'
            + '&id=eq.' + encodeURIComponent(assign.vehicle_id) + '&limit=1');
          if (!vs || !vs.length) return resolve(true);
          var veh = vs[0];

          // "Last punch owns the reading": am I the last person on this
          // vehicle who is still clocked in?
          var lastOut = true;
          var crew = await get('vehicle_assignments?select=employee_id'
            + '&vehicle_id=eq.' + encodeURIComponent(veh.id)
            + '&assign_date=eq.' + encodeURIComponent(day));
          var others = (crew || []).map(function (c) { return c.employee_id; })
            .filter(function (id) { return id && id !== empId; });
          if (others.length) {
            var act = await get('time_entries?select=employee_id&clock_out=is.null'
              + '&employee_id=in.(' + others.map(encodeURIComponent).join(',') + ')');
            if (act && act.length) lastOut = false;
          }

          showSheet(veh, assign, empId, empName, entryId, lastOut, resolve);
        } catch (e) {
          console.warn('[fleet] punchOutFlow failed, continuing punch:', e.message);
          resolve(true);
        }
      })();
    });
  }

  function showSheet(veh, assign, empId, empName, entryId, lastOut, resolve) {
    var ov = document.getElementById('jgf-ov');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'jgf-ov';
      ov.className = 'jgf-ov';
      document.body.appendChild(ov);
    }

    var last = veh.current_mileage;
    var cats = ISSUE_CATEGORIES.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
    }).join('');

    ov.innerHTML = '<div class="jgf-sheet" onclick="event.stopPropagation()">'
      + '<div class="jgf-grab"></div>'
      + '<div class="jgf-h">🚐 ' + esc(vehicleLabel(veh)) + ' — end of day</div>'
      + '<div class="jgf-sub">' + (lastOut
          ? 'You\'re the last one out. Odometer reading required.'
          : 'Teammates are still clocked in — the last one out will record the odometer.')
        + '</div>'

      + '<div class="jgf-blk">'
      + '<label class="jgf-lbl">Odometer' + (lastOut ? ' <span class="jgf-req">*</span>' : ' (optional)') + '</label>'
      + '<input id="jgf-mi" class="jgf-in" type="number" inputmode="numeric" placeholder="'
        + (last != null ? esc(String(last)) : '000000') + '">'
      + '<div class="jgf-hint">' + (last != null
          ? 'Last recorded: ' + Number(last).toLocaleString() + ' mi'
          : 'No previous reading on file.') + '</div>'
      + '</div>'

      + '<div class="jgf-blk">'
      + '<label class="jgf-lbl">Anything wrong with the vehicle?</label>'
      + '<div class="jgf-seg">'
      + '<button type="button" id="jgf-no" class="on" onclick="JGFleet._issue(false)">No</button>'
      + '<button type="button" id="jgf-yes" onclick="JGFleet._issue(true)">Yes</button>'
      + '</div>'
      + '<div id="jgf-issue" style="display:none;margin-top:14px;">'
      + '<label class="jgf-lbl">What\'s wrong?</label>'
      + '<select id="jgf-cat" class="jgf-sel2">' + cats + '</select>'
      + '<label class="jgf-lbl" style="margin-top:14px;">How bad?</label>'
      + '<select id="jgf-sev" class="jgf-sel2">'
      + '<option value="minor">Minor — still safe to drive</option>'
      + '<option value="soon">Needs attention soon</option>'
      + '<option value="urgent">Urgent — do not drive</option>'
      + '</select>'
      + '<label class="jgf-lbl" style="margin-top:14px;">Details</label>'
      + '<textarea id="jgf-note" class="jgf-ta" placeholder="Short description…"></textarea>'
      + '</div>'
      + '</div>'

      + '<div class="jgf-acts">'
      + '<button type="button" class="jgf-btn gh" onclick="JGFleet._close(false)">Back</button>'
      + '<button type="button" class="jgf-btn go" id="jgf-go" onclick="JGFleet._submit()">'
        + (lastOut ? 'Save &amp; clock out' : 'Clock out') + '</button>'
      + '</div>'
      + '</div>';

    ov.onclick = function (e) { if (e.target === ov) JGFleet._close(false); };
    ov.classList.add('open');

    F._ctx = { veh: veh, assign: assign, empId: empId, empName: empName,
               entryId: entryId, lastOut: lastOut, resolve: resolve, issue: false, done: false };

    setTimeout(function () { var i = document.getElementById('jgf-mi'); if (i && lastOut) i.focus(); }, 250);
  }

  function toggleIssue(on) {
    F._ctx = F._ctx || {};
    F._ctx.issue = !!on;
    var box = document.getElementById('jgf-issue');
    var yes = document.getElementById('jgf-yes');
    var no = document.getElementById('jgf-no');
    if (box) box.style.display = on ? '' : 'none';
    if (yes) yes.className = on ? 'on' : '';
    if (no) no.className = on ? '' : 'on';
  }

  function closeSheet(proceed) {
    var ov = document.getElementById('jgf-ov');
    if (ov) ov.classList.remove('open');
    var ctx = F._ctx;
    F._ctx = null;
    if (ctx && ctx.resolve && !ctx.done) { ctx.done = true; ctx.resolve(!!proceed); }
  }

  async function submitSheet() {
    var ctx = F._ctx;
    if (!ctx) return;
    var btn = document.getElementById('jgf-go');

    var raw = (document.getElementById('jgf-mi') || {}).value;
    var mi = raw === '' || raw == null ? null : parseInt(String(raw).replace(/[^0-9]/g, ''), 10);
    if (mi != null && (!isFinite(mi) || mi < 0)) mi = null;

    if (ctx.lastOut && mi == null) {
      say('Odometer reading required — you\'re the last one out.');
      var i = document.getElementById('jgf-mi'); if (i) i.focus();
      return;
    }

    // Data-quality guards. Bad mileage silently poisons every maintenance
    // prediction downstream, so catch it at the point of entry.
    var last = ctx.veh.current_mileage;
    if (mi != null && last != null) {
      if (mi < last) {
        if (!confirm('That reading (' + mi.toLocaleString() + ') is LOWER than the last one on file ('
          + Number(last).toLocaleString() + ').\n\nDouble-check the odometer. Save it anyway?')) return;
      } else if (mi - last > MAX_DAILY_MILES) {
        if (!confirm('That\'s ' + (mi - last).toLocaleString() + ' miles since the last reading.\n\nIs that right?')) return;
      }
    }

    if (btn) { btn.style.opacity = '.6'; btn.style.pointerEvents = 'none'; btn.textContent = 'Saving…'; }

    try {
      var nowIso = new Date().toISOString();

      if (mi != null) {
        await write('PATCH', 'vehicle_assignments?id=eq.' + encodeURIComponent(ctx.assign.id), {
          end_mileage: mi,
          end_mileage_at: nowIso,
          end_mileage_by: ctx.empName || null,
          entry_id: ctx.entryId || null
        });
        // Only ever move the odometer forward — a stale or mistyped low
        // reading must not roll the vehicle's baseline backwards.
        if (last == null || mi >= last) {
          await write('PATCH', 'vehicles?id=eq.' + encodeURIComponent(ctx.veh.id), {
            current_mileage: mi, updated_at: nowIso
          });
        }
      }

      if (ctx.issue) {
        var cat = (document.getElementById('jgf-cat') || {}).value || 'Other';
        var sev = (document.getElementById('jgf-sev') || {}).value || 'minor';
        var note = (document.getElementById('jgf-note') || {}).value || '';
        await write('POST', 'vehicle_issues', {
          vehicle_id: ctx.veh.id,
          category: cat,
          severity: sev,
          note: note,
          status: 'open',
          reported_at: nowIso,
          reported_by: ctx.empId || null,
          reported_by_name: ctx.empName || null,
          entry_id: ctx.entryId || null,
          mileage_at_report: mi
        });
        // Urgent = the van shouldn't roll tomorrow. Flagging turns it red
        // on the board so nobody assigns into it. vehicles.html clears the
        // flag automatically when the last open issue is resolved.
        if (sev === 'urgent') {
          await write('PATCH', 'vehicles?id=eq.' + encodeURIComponent(ctx.veh.id), { status: 'flagged' });
        }
        say('🔧 Issue reported — office notified');
      } else if (mi != null) {
        say('✓ Odometer saved');
      }
    } catch (e) {
      console.warn('[fleet] submit failed, punch continues:', e.message);
    }

    closeSheet(true);
  }

  /* ========================================================== */

  var JGFleet = {
    laneSlot: laneSlot,
    mount: mount,
    setVehicle: setVehicle,
    punchOutFlow: punchOutFlow,
    dispatchDate: dispatchDate,
    _issue: toggleIssue,
    _close: closeSheet,
    _submit: submitSheet
  };

  window.JGFleet = JGFleet;
})();
