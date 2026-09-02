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
  // A day's driving beyond this is almost certainly an added digit, not a
  // real trip. Readings above it are recorded but quarantined — they don't
  // move the vehicle's tracked mileage until the office confirms.
  var HARD_MAX_MILES = 15000;

  var F = {
    vehicles: {},        // id → vehicle row
    byMarket: {},        // marketKey → [vehicle]
    assigns: {},         // employeeId → assignment row (for mounted day)
    openIssues: {},      // vehicleId → count of unresolved issues
    choices: {},        // employeeId → [vehicle] currently offered in that lane
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

  // Returns { ok, status, error } so callers can react to the ACTUAL failure
  // instead of a bare false. Silent write failures are how a feature ends up
  // looking deployed while quietly doing nothing.
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
        return { ok: false, status: r.status, error: t };
      }
      return { ok: true, status: r.status };
    } catch (e) {
      console.warn('[fleet] write failed:', e.message);
      return { ok: false, status: 0, error: e.message };
    }
  }

  // Pull the human-readable bit out of a PostgREST error body.
  function errMsg(res) {
    if (!res) return 'unknown error';
    var t = res.error || '';
    try {
      var j = JSON.parse(t);
      return j.message || j.hint || j.details || t;
    } catch (e) { return t || ('HTTP ' + res.status); }
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
  // same work_date.
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

  // Several vehicles share a name with no unit number ("Van", "Van", "Van";
  // "Transit Van", "Transit Van"), which made the picker a guess. The plate
  // is the one thing that's always unique and is written on the truck, so
  // it's the disambiguator a PM can verify from the lot.
  function vehicleSubLabel(v) {
    if (!v) return '';
    var bits = [];
    if (v.plate) bits.push(v.plate);
    if (v.year && v.model) bits.push(v.year + ' ' + v.model);
    else if (v.model) bits.push(v.model);
    return bits.join(' · ');
  }

  function actorName() {
    try {
      var raw = localStorage.getItem('jg_dispatch_user') || localStorage.getItem('jg_user');
      if (raw) { var u = JSON.parse(raw); return u.name || u.email || 'platform'; }
    } catch (e) {}
    return 'platform';
  }

  // ── ALERTING ────────────────────────────────────────────────
  // Who hears about vehicle problems. EDIT HERE to change recipients.
  var FLEET_MAIL_TO   = ['josh@jg-restoration.com', 'hannah@jg-restoration.com', 'lisa@jg-restoration.com'];
  var FLEET_MAIL_FROM = 'josh@jg-restoration.com';
  var FLEET_MAILER    = 'https://jg-platform-mailer.josh-70f.workers.dev/send';
  var _fleetMailKey   = null;

  async function mailerKey() {
    if (_fleetMailKey) return _fleetMailKey;
    var rows = await get('platform_settings?key=eq.mailer_api_key&select=value&limit=1');
    if (!rows || !rows.length) return null;
    _fleetMailKey = rows[0].value;
    return _fleetMailKey;
  }

  // Fire-and-forget. The underlying record is always written first, so a
  // failed alert never costs you the data — only the notice.
  async function alertFleet(opts) {
    // 1. Email
    try {
      var key = await mailerKey();
      if (key) {
        await fetch(FLEET_MAILER, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Mailer-Key': key },
          body: JSON.stringify({
            from: FLEET_MAIL_FROM,
            to: FLEET_MAIL_TO.join(','),
            subject: opts.subject,
            html: opts.html,
            text: opts.text,
            reply_to: FLEET_MAIL_FROM
          })
        });
      } else {
        console.warn('[fleet] no mailer key — email skipped');
      }
    } catch (e) { console.warn('[fleet] alert email failed:', e.message); }

    // 2. In-app bell, for anyone who manages the fleet. Role is a
    // comma-separated string, so match by overlap, never exact equality.
    try {
      var emps = await get('employees?active=eq.true&select=id,name,email,role');
      if (!emps) return;
      var want = ['admin', 'office', 'project manager'];
      var rows = emps.filter(function (e) {
        if (!e.email) return false;
        var mine = String(e.role || '').split(',').map(function (r) { return r.trim().toLowerCase(); });
        return want.some(function (w) { return mine.indexOf(w) !== -1; });
      }).map(function (e) {
        return {
          recipient_employee_id: e.id,
          recipient_email: e.email,
          recipient_name: e.name,
          category: 'timeclock',
          severity: opts.urgent ? 'urgent' : 'info',
          title: opts.subject,
          body: opts.text,
          action_url: 'https://jgimprovements-arch.github.io/jg-dispatch/vehicles.html',
          action_label: 'Open Fleet',
          metadata: opts.metadata || {},
          expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
        };
      });
      if (rows.length) await write('POST', 'notifications', rows);
    } catch (e) { console.warn('[fleet] alert notification failed:', e.message); }
  }

  function fleetMailHtml(o) {
    var rows = (o.rows || []).map(function (r) {
      return '<tr><td style="padding:8px 14px;border-bottom:1px solid #e6eaf0;font-size:12px;color:#6b7a96;'
        + 'text-transform:uppercase;letter-spacing:.04em;font-weight:700;white-space:nowrap;">' + r[0] + '</td>'
        + '<td style="padding:8px 14px;border-bottom:1px solid #e6eaf0;font-size:14px;color:#0d1f3c;'
        + 'font-weight:600;">' + r[1] + '</td></tr>';
    }).join('');
    return '<div style="font-family:Arial,Helvetica,sans-serif;background:#f4f6f9;padding:24px;">'
      + '<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;'
      + 'box-shadow:0 2px 10px rgba(13,45,94,.08);">'
      + '<div style="background:' + (o.urgent ? '#c62828' : '#0d2d5e') + ';padding:18px 22px;">'
      + '<div style="color:#fff;font-size:17px;font-weight:700;">' + o.heading + '</div>'
      + '<div style="color:rgba(255,255,255,.72);font-size:12px;margin-top:3px;">JG Restoration — fleet</div></div>'
      + (o.alert ? '<div style="background:#fdecea;border-left:4px solid #c62828;padding:12px 18px;'
          + 'font-size:13px;color:#8c1414;font-weight:600;">' + o.alert + '</div>' : '')
      + '<table style="width:100%;border-collapse:collapse;">' + rows + '</table>'
      + '<div style="padding:20px 22px;">'
      + '<a href="https://jgimprovements-arch.github.io/jg-dispatch/vehicles.html" '
      + 'style="display:inline-block;background:#e85d04;color:#fff;text-decoration:none;font-weight:700;'
      + 'font-size:14px;padding:12px 22px;border-radius:8px;">Open Fleet</a></div></div></div>';
  }

  // ── MAINTENANCE STATUS ──────────────────────────────────────
  // Mirrors the due logic in vehicles.html so the board and the fleet page
  // never disagree about whether a van is roadworthy.
  function daysUntil(d) {
    if (!d) return null;
    var t = new Date(d + 'T00:00:00');
    if (isNaN(t)) return null;
    return Math.ceil((t - new Date()) / 86400000);
  }

  // Returns [{ text, urgent }] — everything wrong with this vehicle.
  function vehicleProblems(v, issueCount) {
    var out = [];
    if (!v) return out;
    if (issueCount) out.push({ text: issueCount + ' open issue' + (issueCount > 1 ? 's' : ''), urgent: true });
    if (v.status === 'flagged') out.push({ text: 'Flagged — do not drive', urgent: true });
    if (v.status === 'in_shop')  out.push({ text: 'In shop', urgent: true });

    [['Registration', v.registration_due], ['Insurance', v.insurance_due], ['DOT inspection', v.inspection_due]]
      .forEach(function (p) {
        var n = daysUntil(p[1]);
        if (n === null) return;
        if (n < 0)       out.push({ text: p[0] + ' EXPIRED', urgent: true });
        else if (n <= 30) out.push({ text: p[0] + ' due in ' + n + 'd', urgent: false });
      });

    if (v.current_mileage && v.last_oil_mileage && v.oil_interval_miles) {
      var left = (v.last_oil_mileage + v.oil_interval_miles) - v.current_mileage;
      if (left < 0)        out.push({ text: 'Oil OVERDUE by ' + Math.abs(left).toLocaleString() + ' mi', urgent: true });
      else if (left <= 500) out.push({ text: 'Oil due in ' + left.toLocaleString() + ' mi', urgent: false });
    }
    return out;
  }

  // ── styles (injected once, scoped with jgf- prefix) ─────────
  function injectCss() {
    if (document.getElementById('jgf-css')) return;
    var s = document.createElement('style');
    s.id = 'jgf-css';
    s.textContent = [
      '.jgf-slot{display:block;width:100%;min-width:0;box-sizing:border-box;}',
      '.jgf-row{display:flex;align-items:center;gap:4px;width:100%;min-width:0;}',
      '.jgf-sel{flex:1;min-width:0;font-size:11px;font-weight:600;font-family:"DM Mono",monospace;',
      'background:#fff;border:1px solid rgba(255,255,255,.25);border-radius:4px;color:#0d1f3c;',
      'padding:3px 4px;cursor:pointer;}',
      '.jgf-sel.jgf-warn{background:#ffe9e5;border-color:#c02020;color:#8c1414;}',
      '.jgf-share{font-size:9px;color:rgba(255,255,255,.7);font-family:"DM Mono",monospace;flex-shrink:0;}',
      '.jgf-self{font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#0d2d5e;background:#f4d58d;border-radius:3px;padding:1px 4px;flex-shrink:0;}',
      '.jgf-why{font-size:9px;line-height:1.3;margin-top:3px;color:#ffd9d2;font-weight:700;}',
      /* custom vehicle picker — a native <select> cannot render thumbnails,
         and the fleet has four vehicles literally named "Van" */
      '.jgf-btn2{flex:1;min-width:0;display:flex;align-items:center;gap:6px;background:#fff;',
      'border:1px solid rgba(255,255,255,.25);border-radius:4px;padding:2px 5px 2px 2px;',
      'cursor:pointer;font-family:"DM Mono",monospace;font-size:11px;font-weight:600;color:#0d1f3c;',
      'text-align:left;width:100%;}',
      '.jgf-btn2.jgf-warn{background:#ffe9e5;border-color:#c02020;color:#8c1414;}',
      '.jgf-thumb{width:26px;height:20px;border-radius:3px;flex-shrink:0;background:#e6eaf0 center/cover no-repeat;}',
      '.jgf-thumb.ph{display:flex;align-items:center;justify-content:center;font-size:11px;}',
      '.jgf-btn2 .jgf-nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;}',
      '.jgf-pop{position:fixed;z-index:9600;background:#fff;border:1px solid #d5dce6;border-radius:8px;',
      'box-shadow:0 8px 28px rgba(13,45,94,.25);max-height:340px;overflow-y:auto;padding:4px;width:270px;}',
      '.jgf-opt{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:5px;cursor:pointer;',
      'font-size:13px;color:#0d1f3c;}',
      '.jgf-opt:hover{background:rgba(232,93,4,.09);}',
      '.jgf-opt.sel{background:rgba(232,93,4,.14);font-weight:700;}',
      '.jgf-opt .t{width:46px;height:34px;border-radius:4px;flex-shrink:0;background:#e6eaf0 center/cover no-repeat;',
      'display:flex;align-items:center;justify-content:center;font-size:15px;}',
      '.jgf-opt .meta{font-size:10px;color:#6b7a96;}',
      '.jgf-opt .bad{font-size:10px;color:#c02020;font-weight:700;}',
      '.jgf-why.urgent{color:#ff8a75;}',
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
  // ── TIMECLOCK VEHICLE BADGE ─────────────────────────────────────────────
  // Shows the tech which vehicle is theirs today, in the clock card. Reads the
  // same vehicle_assignments the punch-out prompt uses, so what they see here
  // is exactly the vehicle they'll be asked to record an odometer for. Renders
  // into an element the host page provides (id 'vehicle-badge'); does nothing
  // if that element is absent, so it's safe to call from anywhere.
  async function showVehicleBadge(empId, empName, market) {
    try {
      var el = document.getElementById('vehicle-badge');
      if (!el || !empId) return;
      var day = dispatchDate();
      var as = await get('vehicle_assignments?select=vehicle_id,created_by&employee_id=eq.'
        + encodeURIComponent(empId) + '&work_date=eq.' + encodeURIComponent(day) + '&limit=1');

      // No vehicle assigned yet → offer a self-assign picker. The moment a PM
      // assigns one on the board, this branch stops showing (there's a row),
      // so a tech can never override a PM's placement — only fill a gap.
      if (!as || !as.length || !as[0].vehicle_id) {
        return renderSelfAssign(el, empId, empName, market, day);
      }

      var vs = await get('vehicles?select=id,name,vehicle_number,plate,status,current_mileage,'
        + 'last_oil_mileage,oil_interval_miles,registration_due,insurance_due,inspection_due'
        + '&id=eq.' + encodeURIComponent(as[0].vehicle_id) + '&limit=1');
      if (!vs || !vs.length) { el.style.display = 'none'; return; }
      var v = vs[0];

      var probs = vehicleProblems(v, 0);
      var warn = probs.some(function (p) { return p.urgent; });
      var self = /self/i.test(as[0].created_by || '');
      var label = '🚐 ' + vehicleLabel(v) + (v.plate ? ' · ' + v.plate : '');
      if (probs.length) label += '  ⚠ ' + probs[0].text;

      el.textContent = label;
      el.style.display = '';
      el.style.background = warn ? 'rgba(198,40,40,.08)' : 'rgba(13,45,94,.05)';
      el.style.color = warn ? '#8c1414' : '';
      el.style.border = warn ? '1px solid rgba(198,40,40,.3)' : '';
      el.title = (self ? 'You picked this vehicle. ' : 'Assigned to you. ')
        + "You'll record its odometer at clock-out.";
    } catch (e) {
      console.warn('[fleet] vehicle badge skipped:', e.message);
    }
  }

  // Self-assign picker, shown only when no vehicle is set for the day. Offers
  // pool vehicles plus this tech's own dedicated one; excludes vehicles that
  // already belong to someone else as a dedicated unit. A pick writes an
  // assignment stamped created_by '<name> (self)' so the board shows it was
  // the tech's choice, not a PM placement.
  async function renderSelfAssign(el, empId, empName, market, day) {
    try {
      var mk = marketKey(market);
      var vs = await get('vehicles?select=id,name,vehicle_number,plate,status,usual_assigned_to,market'
        + '&status=in.(active,flagged,in_shop)&order=name.asc');
      if (!vs || !vs.length) { el.style.display = 'none'; return; }

      var list = vs.filter(function (v) {
        // a dedicated vehicle belonging to someone else isn't self-grabbable
        if (v.usual_assigned_to && v.usual_assigned_to !== empId) return false;
        // keep to this tech's market plus pool (no market)
        if (mk && v.market && v.market !== mk) return false;
        return true;
      });
      if (!list.length) { el.style.display = 'none'; return; }

      var opts = '<option value="">🚐 pick your vehicle…</option>'
        + list.map(function (v) {
          var mine = v.usual_assigned_to === empId ? '★ ' : '';
          var warn = v.status === 'flagged' ? ' ⚠' : '';
          return '<option value="' + esc(v.id) + '">' + mine + esc(vehicleLabel(v))
            + (v.plate ? ' · ' + esc(v.plate) : '') + warn + '</option>';
        }).join('');

      el.style.display = '';
      el.style.background = 'rgba(13,45,94,.05)';
      el.style.border = '';
      el.style.color = '';
      el.innerHTML = '<span style="font-size:12px;color:#3E4E62;margin-right:6px;">No vehicle set —</span>'
        + '<select id="jgf-self-veh" style="font-size:13px;font-weight:600;padding:4px 6px;border-radius:6px;'
        + 'border:1px solid rgba(13,45,94,.25);background:#fff;color:#0d1f3c;">' + opts + '</select>';

      var sel = document.getElementById('jgf-self-veh');
      sel.onchange = function () {
        if (!sel.value) return;
        selfAssignVehicle(empId, empName, sel.value, day, market);
      };
    } catch (e) {
      console.warn('[fleet] self-assign picker skipped:', e.message);
      el.style.display = 'none';
    }
  }

  async function selfAssignVehicle(empId, empName, vehicleId, day, market) {
    try {
      // Guard against a race: if a PM assigned one in the meantime, don't
      // override — re-render to show their placement instead.
      var chk = await get('vehicle_assignments?select=vehicle_id&employee_id=eq.'
        + encodeURIComponent(empId) + '&work_date=eq.' + encodeURIComponent(day) + '&limit=1');
      if (chk && chk.length && chk[0].vehicle_id) {
        say('A vehicle was just assigned to you');
        return showVehicleBadge(empId, empName, market);
      }
      var row = {
        vehicle_id: vehicleId, employee_id: empId, employee_name: empName,
        work_date: day, market: marketKey(market),
        created_by: (empName || 'Tech') + ' (self)'
      };
      var res = await write('POST', 'vehicle_assignments?on_conflict=employee_id,work_date',
        row, 'resolution=merge-duplicates,return=minimal');
      if (!res.ok) {
        // fall back to read-then-write if the unique index isn't present
        res = await write('POST', 'vehicle_assignments', row);
      }
      if (res.ok) { say('🚐 Vehicle set'); showVehicleBadge(empId, empName, market); }
      else say('⚠ Could not set vehicle: ' + errMsg(res));
    } catch (e) {
      console.warn('[fleet] self-assign failed:', e.message);
      say('⚠ Could not set vehicle');
    }
  }

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

        var vs = await get('vehicles?select=id,name,vehicle_number,market,status,current_mileage,'
          + 'usual_assigned_to,photo_url,plate,year,model,'
          + 'last_oil_mileage,oil_interval_miles,registration_due,insurance_due,inspection_due'
          + '&status=in.(active,flagged,in_shop)&order=name.asc');
        if (vs) {
          vs.forEach(function (v) {
            F.vehicles[v.id] = v;
            // A vehicle with no market is a shared/pool unit — offer it everywhere.
            var key = v.market || '__pool__';
            (F.byMarket[key] = F.byMarket[key] || []).push(v);
          });
        }

        var as = await get('vehicle_assignments?select=id,vehicle_id,employee_id,employee_name,work_date,created_by'
          + '&work_date=eq.' + encodeURIComponent(day));
        if (as) as.forEach(function (a) { F.assigns[a.employee_id] = a; });

        var iss = await get('vehicle_issues?select=vehicle_id&status=neq.resolved');
        if (iss) iss.forEach(function (i) {
          F.openIssues[i.vehicle_id] = (F.openIssues[i.vehicle_id] || 0) + 1;
        });
      }

      paint(mk);
      autoDefaultDedicated(mk);
    } catch (e) {
      console.warn('[fleet] mount failed (board unaffected):', e.message);
    } finally {
      F.mounting = false;
    }
  }

  // A dedicated vehicle (usual_assigned_to set) belongs to one driver every
  // day. If that driver is on today's board and has no vehicle chosen yet,
  // assign theirs automatically — but WRITE the row, don't just pre-select,
  // because the punch-out odometer prompt reads a real assignment. The PM can
  // still change it in the dropdown; a manual pick already counts as "chosen"
  // so we never override a deliberate choice. Idempotent per day.
  function autoDefaultDedicated(mk) {
    try {
      // Map each dedicated vehicle to its driver, within this market or pool.
      var dedicatedByDriver = {};
      (F.byMarket[mk] || []).concat(F.byMarket.__pool__ || []).forEach(function (v) {
        if (v.usual_assigned_to && v.status !== 'retired') dedicatedByDriver[v.usual_assigned_to] = v;
      });

      var slots = document.querySelectorAll('.jgf-slot[data-jgf-emp]');
      Array.prototype.forEach.call(slots, function (slot) {
        var eid = slot.getAttribute('data-jgf-emp');
        var enm = slot.getAttribute('data-jgf-name') || '';
        var v = dedicatedByDriver[eid];
        if (!v) return;                    // no dedicated vehicle for this person
        if (F.assigns[eid]) return;        // already has one (auto or manual) — leave it
        if (F._autoTried && F._autoTried[eid] === F.date) return; // don't retry same day

        F._autoTried = F._autoTried || {};
        F._autoTried[eid] = F.date;

        var row = {
          vehicle_id: v.id, employee_id: eid, employee_name: enm,
          work_date: F.date, market: F.market, created_by: 'auto-default'
        };
        // Optimistic local update so the board reflects it immediately.
        F.assigns[eid] = row;
        write('POST', 'vehicle_assignments?on_conflict=employee_id,work_date',
          row, 'resolution=merge-duplicates,return=minimal').then(function (res) {
          if (!res.ok) { delete F.assigns[eid]; }  // roll back the optimistic add
          paint(F.market);
        });
      });
      paint(mk);
    } catch (e) {
      console.warn('[fleet] auto-default skipped:', e.message);
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
      var curProblems = curId ? vehicleProblems(F.vehicles[curId], F.openIssues[curId]) : [];
      var flagged = curProblems.length > 0;
      var isUrgent = curProblems.some(function (p) { return p.urgent; });

      // Which vehicles this lane may choose from. A vehicle with a dedicated
      // driver belongs to that person and is not pool equipment, so it stays
      // out of everyone else's picker — unless it's already assigned to this
      // lane, in which case hiding it would misrepresent who is in what.
      var choices = [];
      var seen = {};
      list.forEach(function (v) {
        if (seen[v.id]) return;
        if (v.usual_assigned_to && v.usual_assigned_to !== eid && v.id !== curId) return;
        seen[v.id] = 1;
        choices.push(v);
      });
      if (curId && !seen[curId] && F.vehicles[curId]) { choices.push(F.vehicles[curId]); seen[curId] = 1; }
      F.choices[eid] = choices;

      var curV = curId ? F.vehicles[curId] : null;
      var share = (curId && shareCount[curId] > 1) ? '<span class="jgf-share">+' + (shareCount[curId] - 1) + '</span>' : '';
      var selfPick = (cur && /self/i.test(cur.created_by || '')) ? '<span class="jgf-self">self</span>' : '';

      // Spell out WHY the vehicle is flagged. A red box with no reason just
      // trains people to ignore red boxes.
      var reason = curProblems.length
        ? '<div class="jgf-why' + (isUrgent ? ' urgent' : '') + '">'
          + esc(curProblems.map(function (p) { return p.text; }).join(' · ')) + '</div>'
        : '';

      slot.innerHTML = '<div class="jgf-row">'
        + '<button type="button" class="jgf-btn2' + (flagged ? ' jgf-warn' : '') + '"'
        + ' data-jgf-emp="' + esc(eid) + '" data-jgf-name="' + esc(enm) + '"'
        + ' data-jgf-prev="' + esc(curId || '') + '"'
        + ' onclick="event.stopPropagation();JGFleet.openPicker(this)"'
        + ' title="Vehicle for this day">'
        + thumbHtml(curV, 'jgf-thumb')
        + '<span class="jgf-nm">' + (curV ? esc(vehicleLabel(curV)) : 'no vehicle') + '</span>'
        + '<span style="opacity:.5;flex-shrink:0;">▾</span>'
        + '</button>'
        + selfPick + share + '</div>' + reason;
    });
  }

  function thumbHtml(v, cls) {
    if (v && v.photo_url) {
      return '<span class="' + cls + '" style="background-image:url(\'' + esc(v.photo_url) + '\');"></span>';
    }
    return '<span class="' + cls + ' ph">🚐</span>';
  }

  // Native <select> can't show images, and the roster has four vehicles named
  // some variant of "Van" — a photo is the fastest way to pick the right one.
  // The panel is position:fixed off the button's rect so it can't be clipped
  // by the lane's overflow.
  function openPicker(btn) {
    closePicker();
    var eid = btn.getAttribute('data-jgf-emp');
    var enm = btn.getAttribute('data-jgf-name') || '';
    var prev = btn.getAttribute('data-jgf-prev') || '';
    var choices = F.choices[eid] || [];

    var pop = document.createElement('div');
    pop.className = 'jgf-pop';
    pop.id = 'jgf-pop';

    var html = '<div class="jgf-opt' + (prev ? '' : ' sel') + '" data-vid="">'
      + '<span class="t">—</span><div><div>No vehicle</div>'
      + '<div class="meta">Clear the assignment</div></div></div>';

    choices.forEach(function (v) {
      var probs = vehicleProblems(v, F.openIssues[v.id]);
      var mine = (v.usual_assigned_to && v.usual_assigned_to === eid);
      var sub = vehicleSubLabel(v);
      html += '<div class="jgf-opt' + (v.id === prev ? ' sel' : '') + '" data-vid="' + esc(v.id) + '">'
        + thumbHtml(v, 't')
        + '<div style="min-width:0;">'
        + '<div>' + (mine ? '★ ' : '') + esc(vehicleLabel(v)) + '</div>'
        + (sub ? '<div class="meta">' + esc(sub) + '</div>' : '')
        + (probs.length ? '<div class="bad">' + esc(probs.map(function (p) { return p.text; }).join(' · ')) + '</div>' : '')
        + '</div></div>';
    });
    pop.innerHTML = html;

    document.body.appendChild(pop);
    var r = btn.getBoundingClientRect();
    var w = 270, h = pop.offsetHeight;
    var left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    var top = (r.bottom + h + 8 > window.innerHeight && r.top - h - 4 > 0) ? (r.top - h - 4) : (r.bottom + 4);
    pop.style.left = left + 'px';
    pop.style.top = Math.max(8, top) + 'px';

    pop.addEventListener('click', function (e) {
      var opt = e.target.closest('.jgf-opt');
      if (!opt) return;
      e.stopPropagation();
      closePicker();
      commitVehicle(eid, enm, opt.getAttribute('data-vid') || '', prev);
    });

    F._closer = function (e) { if (!e || !pop.contains(e.target)) closePicker(); };
    setTimeout(function () {
      document.addEventListener('click', F._closer, true);
      document.addEventListener('keydown', F._esc = function (e) { if (e.key === 'Escape') closePicker(); });
    }, 0);
  }

  function closePicker() {
    var p = document.getElementById('jgf-pop');
    if (p) p.remove();
    if (F._closer) { document.removeEventListener('click', F._closer, true); F._closer = null; }
    if (F._esc) { document.removeEventListener('keydown', F._esc); F._esc = null; }
  }

  // Kept for compatibility with any lane still rendering a native <select>.
  function setVehicle(sel) {
    return commitVehicle(
      sel.getAttribute('data-jgf-emp'),
      sel.getAttribute('data-jgf-name') || '',
      sel.value,
      sel.getAttribute('data-jgf-prev') || ''
    );
  }

  async function commitVehicle(eid, enm, vid, prev) {
    try {
      var day = F.date || dispatchDate();
      if (!eid) return;

      // ── CLEAR ────────────────────────────────────────────────
      if (!vid) {
        var del = await write('DELETE',
          'vehicle_assignments?employee_id=eq.' + encodeURIComponent(eid)
          + '&work_date=eq.' + encodeURIComponent(day));
        if (del.ok) { delete F.assigns[eid]; say('Vehicle cleared'); }
        else { say('⚠ Could not clear: ' + errMsg(del)); }
        paint(F.market);
        return;
      }

      var row = {
        vehicle_id: vid,
        employee_id: eid,
        employee_name: enm,
        work_date: day,
        market: F.market,
        created_by: actorName()
      };

      // Tell the PM what's wrong BEFORE the assignment lands. Urgent
      // problems (open issue, flagged, expired registration, oil overdue)
      // require an explicit override; soft warnings just inform.
      var probs = vehicleProblems(F.vehicles[vid], F.openIssues[vid]);
      if (probs.some(function (p) { return p.urgent; })) {
        var v0 = F.vehicles[vid];
        var okGo = confirm(
          (v0 ? vehicleLabel(v0) : 'This vehicle') + ' has a problem:\n\n'
          + probs.map(function (p) { return '• ' + p.text; }).join('\n')
          + '\n\nAssign ' + (enm || 'this tech') + ' to it anyway?'
        );
        if (!okGo) { paint(F.market); return; }
      } else if (probs.length) {
        say('⚠ ' + probs.map(function (p) { return p.text; }).join(' · '));
      }

      // ── STAGE 1: upsert on the unique index ──────────────────
      // Fastest path, but only works if vehicle_assignments_emp_date_key
      // exists. If the slice-2 migration hasn't run, PostgREST returns
      // 42P10 ("no unique or exclusion constraint matching the ON CONFLICT
      // specification") and we fall through rather than failing the user.
      var res = await write('POST',
        'vehicle_assignments?on_conflict=employee_id,work_date',
        row, 'resolution=merge-duplicates,return=minimal');

      // ── STAGE 2: read-then-write ─────────────────────────────
      // Works on any table shape that has the columns, index or not.
      if (!res.ok) {
        console.warn('[fleet] upsert unavailable, falling back to read-then-write');
        var existing = await get('vehicle_assignments?select=id&employee_id=eq.'
          + encodeURIComponent(eid) + '&work_date=eq.' + encodeURIComponent(day) + '&limit=1');

        if (existing && existing.length) {
          res = await write('PATCH',
            'vehicle_assignments?id=eq.' + encodeURIComponent(existing[0].id),
            { vehicle_id: vid, employee_name: enm, market: F.market, created_by: actorName() });
        } else {
          res = await write('POST', 'vehicle_assignments', row);
        }
      }

      if (res.ok) {
        F.assigns[eid] = row;
        var v = F.vehicles[vid];
        say('🚐 ' + (enm.split(' ')[0] || 'Tech') + ' → ' + (v ? vehicleLabel(v) : 'vehicle'));
        paint(F.market);
      } else {
        // Show the real reason. A silent revert would leave the dispatcher
        // believing a vehicle is assigned when nothing was written.
        sel.value = prev;
        say('⚠ Vehicle not saved: ' + errMsg(res));
      }
    } catch (e) {
      sel.disabled = false;
      sel.value = prev;
      console.warn('[fleet] setVehicle failed:', e.message);
      say('⚠ Vehicle not saved: ' + e.message);
    }
  }

  // Console diagnostic — run JGFleet.diagnose() on the board to see exactly
  // which piece is failing, instead of guessing from a toast.
  async function diagnose() {
    var out = { date: F.date || dispatchDate(), market: F.market };
    var v = await get('vehicles?select=id,name&limit=1');
    out.vehicles_readable = !!v;
    out.vehicle_count = Object.keys(F.vehicles).length;
    var a = await get('vehicle_assignments?select=*&limit=1');
    out.assignments_readable = !!a;
    out.assignment_columns = (a && a.length) ? Object.keys(a[0]) : '(table empty — cannot infer columns)';
    var probe = await write('POST', 'vehicle_assignments?on_conflict=employee_id,work_date',
      { employee_id: '00000000-0000-0000-0000-000000000000', work_date: out.date },
      'resolution=merge-duplicates,return=minimal');
    out.upsert_probe = probe.ok ? 'OK' : errMsg(probe);
    console.table ? console.table(out) : console.log(out);
    return out;
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
            + '&work_date=eq.' + encodeURIComponent(day) + '&limit=1');
          if (!as || !as.length || !as[0].vehicle_id) return resolve(true); // no vehicle today

          var assign = as[0];
          var vs = await get('vehicles?select=id,name,vehicle_number,current_mileage,status,'
            + 'last_oil_mileage,oil_interval_miles'
            + '&id=eq.' + encodeURIComponent(assign.vehicle_id) + '&limit=1');
          if (!vs || !vs.length) return resolve(true);
          var veh = vs[0];

          // "Last punch owns the reading": am I the last person on this
          // vehicle who is still clocked in?
          var lastOut = true;
          var crew = await get('vehicle_assignments?select=employee_id'
            + '&vehicle_id=eq.' + encodeURIComponent(veh.id)
            + '&work_date=eq.' + encodeURIComponent(day));
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
      + '<option value="normal">Minor — still safe to drive</option>'
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
    var mileageSuspect = false;   // saved to the assignment, but NOT trusted as the new baseline
    if (mi != null && last != null) {
      var jump = mi - last;
      if (mi < last) {
        if (!confirm('That reading (' + mi.toLocaleString() + ') is LOWER than the last one on file ('
          + Number(last).toLocaleString() + ').\n\nDouble-check the odometer. Save it anyway?')) return;
        mileageSuspect = true;   // a lower-than-last reading never advances the baseline
      } else if (jump > HARD_MAX_MILES) {
        // Beyond any believable day — almost certainly an added digit
        // (127,308 → 1,273,080). Two-step confirm, and even if they tap
        // through it's flagged so it can't corrupt the vehicle baseline.
        if (!confirm('That reading is ' + mi.toLocaleString() + ' — a jump of '
          + jump.toLocaleString() + ' miles since the last reading.\n\nThat looks like a typo. Re-check the odometer.')) return;
        if (!confirm('Save ' + mi.toLocaleString() + ' anyway?\n\nIt will be recorded against today, but won\'t change the truck\'s tracked mileage until the office confirms it.')) return;
        mileageSuspect = true;
      } else if (jump > MAX_DAILY_MILES) {
        if (!confirm('That\'s ' + jump.toLocaleString() + ' miles since the last reading.\n\nIs that right?')) return;
      }
    }

    if (btn) { btn.style.opacity = '.6'; btn.style.pointerEvents = 'none'; btn.textContent = 'Saving…'; }

    try {
      var nowIso = new Date().toISOString();

      var failures = [];

      if (mi != null) {
        var r1 = await write('PATCH', 'vehicle_assignments?id=eq.' + encodeURIComponent(ctx.assign.id), {
          mileage_end: mi,
          mileage_entered_at: nowIso,
          // uuid column — the employee id, not the name. The name is
          // recoverable from employee_id on the same row.
          mileage_entered_by: ctx.empId || null,
          entry_id: ctx.entryId || null
        });
        if (!r1.ok) failures.push('odometer (' + errMsg(r1) + ')');
        // Advance the vehicle baseline only for readings that are (a) higher
        // than the last and (b) not flagged suspect. A quarantined reading is
        // still saved on the assignment row for the office to review, but it
        // never becomes the tracked mileage that maintenance math depends on.
        if (r1.ok && !mileageSuspect && (last == null || mi >= last)) {
          await write('PATCH', 'vehicles?id=eq.' + encodeURIComponent(ctx.veh.id), {
            current_mileage: mi, updated_at: nowIso
          });

          // Oil interval: alert on the CROSSING only — the reading that
          // first pushes the van past due. Comparing old vs new means this
          // fires exactly once, not every night from then on.
          var v = ctx.veh;
          if (v.last_oil_mileage && v.oil_interval_miles) {
            var nextOil = v.last_oil_mileage + v.oil_interval_miles;
            var wasDue  = last != null && last >= nextOil;
            var nowDue  = mi >= nextOil;
            var wasNear = last != null && last >= nextOil - 500;
            var nowNear = mi >= nextOil - 500;

            if (nowDue && !wasDue) {
              alertFleet({
                urgent: true,
                subject: '🛢 Oil change DUE — ' + vehicleLabel(v),
                text: vehicleLabel(v) + ' hit ' + mi.toLocaleString() + ' mi and is now past its oil change at '
                      + nextOil.toLocaleString() + ' mi.',
                html: fleetMailHtml({
                  urgent: true,
                  heading: '🛢 Oil change due',
                  alert: 'This vehicle has passed its scheduled oil change interval.',
                  rows: [
                    ['Vehicle',      vehicleLabel(v)],
                    ['Current',      mi.toLocaleString() + ' mi'],
                    ['Was due at',   nextOil.toLocaleString() + ' mi'],
                    ['Overdue by',   (mi - nextOil).toLocaleString() + ' mi'],
                    ['Last changed', v.last_oil_mileage.toLocaleString() + ' mi'],
                    ['Reading from', ctx.empName || '—']
                  ]
                }),
                metadata: { kind: 'oil_due', vehicle_id: v.id, mileage: mi, due_at: nextOil }
              });
            } else if (nowNear && !wasNear) {
              alertFleet({
                urgent: false,
                subject: '🛢 Oil change coming up — ' + vehicleLabel(v),
                text: vehicleLabel(v) + ' is within ' + (nextOil - mi).toLocaleString()
                      + ' mi of its next oil change.',
                html: fleetMailHtml({
                  heading: '🛢 Oil change approaching',
                  rows: [
                    ['Vehicle',    vehicleLabel(v)],
                    ['Current',    mi.toLocaleString() + ' mi'],
                    ['Due at',     nextOil.toLocaleString() + ' mi'],
                    ['Miles left', (nextOil - mi).toLocaleString() + ' mi']
                  ]
                }),
                metadata: { kind: 'oil_soon', vehicle_id: v.id, mileage: mi, due_at: nextOil }
              });
            }
          }
        }
      }

      if (ctx.issue) {
        var cat = (document.getElementById('jgf-cat') || {}).value || 'Other';
        var sevEl = document.getElementById('jgf-sev');
        // The dropdown shows three human labels but the DB constraint only
        // allows 'normal' or 'urgent'. Capture the label for the email, but
        // write a value the constraint accepts. Only true "urgent" flags the van.
        var sevText = sevEl ? sevEl.options[sevEl.selectedIndex].text : 'Minor';
        var isUrgent = sevEl ? (sevEl.value === 'urgent') : false;
        var sev = isUrgent ? 'urgent' : 'normal';
        var note = (document.getElementById('jgf-note') || {}).value || '';
        var r2 = await write('POST', 'vehicle_issues', {
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
        if (!r2.ok) failures.push('issue report (' + errMsg(r2) + ')');
        if (r2.ok && isUrgent) {
          await write('PATCH', 'vehicles?id=eq.' + encodeURIComponent(ctx.veh.id), { status: 'flagged' });
        }
        if (r2.ok) {
          var sevLabel = sevText;
          alertFleet({
            urgent: isUrgent,
            subject: (isUrgent ? '⛔ URGENT vehicle issue — ' : '🔧 Vehicle issue — ') + vehicleLabel(ctx.veh),
            text: (ctx.empName || 'A tech') + ' reported "' + cat + '" on ' + vehicleLabel(ctx.veh)
                  + ' (' + sevLabel + ')' + (note ? ': ' + note : '') + '.',
            html: fleetMailHtml({
              urgent: isUrgent,
              heading: '🔧 Vehicle issue reported',
              alert: isUrgent
                ? 'Reported as URGENT — this vehicle should not go out tomorrow. It has been flagged on the dispatch board.'
                : null,
              rows: [
                ['Vehicle',    vehicleLabel(ctx.veh)],
                ['Reported by', ctx.empName || '—'],
                ['Problem',    cat],
                ['Severity',   sevLabel],
                ['Details',    note || '—'],
                ['Odometer',   mi != null ? mi.toLocaleString() + ' mi' : '—']
              ]
            }),
            metadata: { kind: 'vehicle_issue', vehicle_id: ctx.veh.id, severity: sev, category: cat }
          });
        }
      }

      if (failures.length) {
        // Tell the tech the truth — but never block the punch.
        say('⚠ Not saved: ' + failures.join(', '));
      } else if (ctx.issue) {
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
    showVehicleBadge: showVehicleBadge,
    mount: mount,
    setVehicle: setVehicle,
    openPicker: openPicker,
    closePicker: closePicker,
    punchOutFlow: punchOutFlow,
    dispatchDate: dispatchDate,
    diagnose: diagnose,
    _issue: toggleIssue,
    _close: closeSheet,
    _submit: submitSheet
  };

  window.JGFleet = JGFleet;
})();
