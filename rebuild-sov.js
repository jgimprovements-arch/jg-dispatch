/*  ══════════════════════════════════════════════════════════════════════
    JG PLATFORM — REBUILD SCHEDULER · SOV MODULE
    Extracted 2026-05-20 from rebuild.html.

    What this is:
      Schedule of Values (customer-facing draw schedule) module.
      Tables: rebuild_sov, rebuild_sov_draws, rebuild_sov_history.

    Dependencies (defined in rebuild.html main <script>):
      - state.*   (activeProject, activeProjectId, pmEmail, sov, sovDraws,
                   sovHistory, sovLoading, woBudget)
      - sb        (Supabase client)
      - $(), $$() (selector helpers)
      - esc(), toast(), logToAlbi(), renderDetail(), renderCoSection()
      - XLSX, jsPDF (CDN-loaded libraries)

    Scope:
      Top-level script (NOT wrapped in an IIFE). Function declarations
      hoist into the shared window scope alongside rebuild.html's main
      <script>. This is required so bare-identifier calls like loadSov()
      from rebuild.html's selectProject() can resolve.
      The window.* assignments at the bottom are redundant in this
      configuration but kept as documentation of the module's public API.

    External callsites in rebuild.html (verified working):
      - loadSov()         — selectProject() parallel loader + realtime
      - sovBadge()        — tab button HTML
      - renderSovTab()    — tab content dispatcher
      - wireSovTab()      — tab wiring
      Plus onclick= attributes inside SOV's own template literals.

    Load order:
      rebuild.html main <script> defines all dependencies first.
      Then <script src="rebuild-sov.js"> runs and declares loadSov etc.
      at script-top scope.
    ════════════════════════════════════════════════════════════════════════ */

// ════════════════════════════════════════════════════════════════════════════
// BEGIN SOV MODULE — added 2026-05-20 (Schedule of Values tab)
// ════════════════════════════════════════════════════════════════════════════

// ─── Local money formatter (delegates to existing usdCompact) ───────────────
// SOV module uses usd() everywhere; rebuild.html only defines usdCompact.
// Two cents of precision matters for partial payments, so use a real formatter.
function usd(n) {
const v = Number(n) || 0;
return '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Compute Xact total from woBudget for SOV contract auto-fill ────────────
// rebuild.html doesn't store a single grand_total field on the upload row.
// We sum the line item totals across materials + labor + equipment (matches
// the pattern used in computeAutoTargetBudgets at line ~13780).
function computeXactTotalForSov() {
const b = state.woBudget;
if (!b) return 0;
const sumField = (arr, field) => (arr || []).reduce((s, r) => s + (Number(r?.[field]) || 0), 0);
// Prefer items if present (line-item totals from estimate), fall back to material/labor/equipment buckets
const itemsTotal = sumField(b.items, 'total') || sumField(b.items, 'line_total') || sumField(b.items, 'amount');
if (itemsTotal > 0) return itemsTotal;
return sumField(b.materials, 'total') + sumField(b.labor, 'total') + sumField(b.equipment, 'total');
}

// ════════════════════════════════════════════════════════════════════════════
// SOV (Schedule of Values) Module — customer-facing draw schedule
// Tables: rebuild_sov, rebuild_sov_draws, rebuild_sov_history
// Splice into rebuild.html BEFORE renderCoSection() (currently line 15110)
// ════════════════════════════════════════════════════════════════════════════

const SOV_STATUS_META = {
draft:           { lbl: 'Draft',              color: 'var(--muted)',  bg: 'rgba(107,122,150,.12)' },
sent:            { lbl: 'Awaiting Customer',  color: 'var(--gold)',   bg: 'rgba(245,166,35,.12)' },
customer_signed: { lbl: 'Customer Signed',    color: 'var(--orange)', bg: 'rgba(232,93,4,.12)' },
active:          { lbl: 'Active',             color: 'var(--blue)',   bg: 'rgba(21,101,192,.12)' },
complete:        { lbl: 'Complete',           color: 'var(--success)',bg: 'rgba(46,125,50,.12)' },
cancelled:       { lbl: 'Cancelled',          color: 'var(--danger)', bg: 'rgba(192,32,32,.10)' },
superseded:      { lbl: 'Superseded',         color: 'var(--muted)',  bg: 'rgba(107,122,150,.08)' },
};

const DRAW_STATUS_META = {
pending:   { lbl: 'Pending',    color: 'var(--muted)',   bg: 'rgba(107,122,150,.12)' },
requested: { lbl: 'Requested',  color: 'var(--gold)',    bg: 'rgba(245,166,35,.12)' },
paid:      { lbl: 'Paid',       color: 'var(--success)', bg: 'rgba(46,125,50,.12)' },
partial:   { lbl: 'Partial',    color: 'var(--orange)',  bg: 'rgba(232,93,4,.12)' },
waived:    { lbl: 'Waived',     color: 'var(--muted)',   bg: 'rgba(107,122,150,.08)' },
};

const SOV_PRESET_SPLITS = {
'50/50': [
  { pct: 0.50, trigger: 'Contract signing & material deposits' },
  { pct: 0.50, trigger: 'Substantial completion & punch list sign-off' },
],
'30/30/40': [
  { pct: 0.30, trigger: 'Mobilization, permits, material deposits & framing start (due at contract signing)' },
  { pct: 0.30, trigger: 'Rough-ins complete: framing, roofing, windows, MEP rough-in & insulation (passed inspections)' },
  { pct: 0.40, trigger: 'Substantial completion: drywall, paint, trim, flooring, cabinets, appliances, final punch & C of O' },
],
};

// ─── Badge for tab nav ──────────────────────────────────────────────────────
function sovBadge() {
if (!state.sov) return '';
const unpaid = (state.sovDraws || []).filter(d =>
  d.status === 'pending' || d.status === 'requested' || d.status === 'partial'
).length;
if (!unpaid) return '';
return `<span class="badge">${unpaid}</span>`;
}

// ─── Loader ─────────────────────────────────────────────────────────────────
async function loadSov() {
if (!sb || !state.activeProjectId) {
  state.sov = null; state.sovDraws = []; state.sovHistory = [];
  return;
}
state.sovLoading = true;
const { data: sovRows, error } = await sb.from('rebuild_sov')
  .select('*')
  .eq('project_id', state.activeProjectId)
  .in('status', ['draft', 'sent', 'customer_signed', 'active', 'complete'])
  .order('created_at', { ascending: false })
  .limit(1);
if (error) {
  console.error('[sov] load failed', error.message, error.code, error.details, error.hint);
  state.sov = null; state.sovDraws = []; state.sovHistory = []; state.sovLoading = false;
  return;
}
state.sov = (sovRows && sovRows[0]) || null;
if (!state.sov) { state.sovDraws = []; state.sovHistory = []; state.sovLoading = false; return; }
const { data: draws } = await sb.from('rebuild_sov_draws')
  .select('*')
  .eq('sov_id', state.sov.id)
  .order('draw_num', { ascending: true });
state.sovDraws = draws || [];
const { data: hist } = await sb.from('rebuild_sov_history')
  .select('*')
  .eq('sov_id', state.sov.id)
  .order('observed_at', { ascending: false })
  .limit(20);
state.sovHistory = hist || [];
state.sovLoading = false;
}

// ─── History logger helper ──────────────────────────────────────────────────
async function logSovEvent(action, opts) {
opts = opts || {};
if (!sb || !state.sov) return;
await sb.from('rebuild_sov_history').insert({
  sov_id: state.sov.id,
  draw_id: opts.draw_id || null,
  project_id: state.activeProjectId,
  action: action,
  changed_cols: opts.changed_cols || null,
  old_values: opts.old_values || null,
  new_values: opts.new_values || null,
  actor_email: state.pmEmail || null,
  actor_role: opts.actor_role || 'pm',
  notes: opts.notes || null,
});
}

// ─── Main tab renderer ──────────────────────────────────────────────────────
function renderSovTab() {
if (state.sovLoading) {
  return `<div class="empty" style="padding:40px 20px;"><p>Loading SOV…</p></div>`;
}
const packetHtml = (typeof renderPacketSection === 'function') ? renderPacketSection() : '';
if (!state.sov) return packetHtml + renderSovEmpty();
return packetHtml + renderSovHeader() + renderSovDrawsTable() + renderSovHistory();
}

// ─── Empty state ────────────────────────────────────────────────────────────
function renderSovEmpty() {
const p = state.activeProject || {};
const xactTotal = computeXactTotalForSov();
const xactHint = xactTotal > 0
  ? `<div style="margin-top:6px;font-size:12px;color:var(--muted);">Xactimate budget on file: <b>${usd(xactTotal)}</b> — use as contract starting point</div>`
  : '';
return `
  <div class="sov-empty" style="padding:32px 20px;text-align:center;background:#fff;border:1px solid var(--border);border-radius:10px;">
    <div style="font-size:48px;margin-bottom:10px;opacity:.4;">📄</div>
    <h3 style="margin:0 0 6px;color:var(--navy);">No Schedule of Values yet</h3>
    <p style="margin:0 0 4px;color:var(--muted);font-size:13px;">Create a customer-facing draw schedule with milestone-based billing.</p>
    ${xactHint}
    <button class="btn primary" id="sov_create_btn" style="margin-top:16px;">+ Create Schedule of Values</button>
  </div>
`;
}

// ─── Header (status, totals, actions) ───────────────────────────────────────
function renderSovHeader() {
const s = state.sov;
const meta = SOV_STATUS_META[s.status] || SOV_STATUS_META.draft;
const draws = state.sovDraws || [];
const paid = draws.filter(d => d.status === 'paid').reduce((sum, d) => sum + Number(d.paid_amount || d.total_amount || 0), 0);
const requested = draws.filter(d => d.status === 'requested').reduce((sum, d) => sum + Number(d.total_amount || 0), 0);
const pending = draws.filter(d => d.status === 'pending').reduce((sum, d) => sum + Number(d.total_amount || 0), 0);
const total = Number(s.contract_total || 0);

const signedLine = s.customer_signed_at
  ? `<span style="font-size:12px;color:var(--success);">✓ Signed ${new Date(s.customer_signed_at).toLocaleDateString()} by ${esc(s.customer_signed_name || 'customer')}</span>`
  : '';

// Actions by status
let actions = '';
if (s.status === 'draft') {
  actions = `
    <button class="btn primary" id="sov_send_btn">✉ Send to Customer</button>
    <button class="btn ghost" id="sov_mark_signed_btn">✓ Mark Signed Manually</button>
    <button class="btn ghost" id="sov_export_pdf_btn">📄 PDF</button>
    <button class="btn ghost" id="sov_export_xlsx_btn">📊 Excel</button>
    <button class="btn ghost" id="sov_cancel_btn" style="color:var(--danger);border-color:var(--danger);">Cancel</button>
  `;
} else if (s.status === 'sent') {
  actions = `
    <button class="btn primary" id="sov_mark_signed_btn">✓ Mark Customer Signed</button>
    <button class="btn ghost" id="sov_copy_link_btn">🔗 Copy Customer Link</button>
    <button class="btn ghost" id="sov_resend_btn">✉ Resend</button>
    <button class="btn ghost" id="sov_export_pdf_btn">📄 PDF</button>
    <button class="btn ghost" id="sov_cancel_btn" style="color:var(--danger);border-color:var(--danger);">Cancel</button>
  `;
} else if (s.status === 'customer_signed' || s.status === 'active') {
  actions = `
    <button class="btn ghost" id="sov_export_pdf_btn">📄 PDF</button>
    <button class="btn ghost" id="sov_export_xlsx_btn">📊 Excel</button>
    ${s.signed_pdf_url ? `<a class="btn ghost" href="${esc(s.signed_pdf_url)}" target="_blank">📑 Signed PDF</a>` : ''}
    <button class="btn ghost" id="sov_supersede_btn" style="color:var(--danger);border-color:var(--danger);">↩ Supersede & Re-issue</button>
  `;
} else if (s.status === 'complete') {
  actions = `
    <button class="btn ghost" id="sov_export_pdf_btn">📄 PDF</button>
    <button class="btn ghost" id="sov_export_xlsx_btn">📊 Excel</button>
  `;
}

return `
  <div class="sov-header" style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:12px;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
      <div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
          <h3 style="margin:0;font-size:16px;color:var(--navy);">Schedule of Values</h3>
          <span class="wobx-status-pill" style="background:${meta.bg};color:${meta.color};border:1px solid ${meta.color}40;font-size:11px;padding:2px 10px;border-radius:20px;font-weight:600;">${meta.lbl}</span>
        </div>
        <div style="font-size:12px;color:var(--muted);">${draws.length} draw${draws.length === 1 ? '' : 's'} · created ${new Date(s.created_at).toLocaleDateString()}</div>
        ${signedLine ? `<div style="margin-top:4px;">${signedLine}</div>` : ''}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">${actions}</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-top:14px;padding-top:12px;border-top:1px solid var(--border);">
      <div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;">Contract Total</div><div style="font-size:18px;font-weight:700;color:var(--navy);">${usd(total)}</div></div>
      <div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;">Paid</div><div style="font-size:18px;font-weight:700;color:var(--success);">${usd(paid)}</div></div>
      <div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;">Requested</div><div style="font-size:18px;font-weight:700;color:var(--gold);">${usd(requested)}</div></div>
      <div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;">Pending</div><div style="font-size:18px;font-weight:700;color:var(--muted);">${usd(pending)}</div></div>
    </div>
  </div>
`;
}

// ─── Draws table ────────────────────────────────────────────────────────────
function renderSovDrawsTable() {
const draws = state.sovDraws || [];
const isActive = ['customer_signed', 'active'].includes(state.sov.status);
const isDraft = state.sov.status === 'draft';

const rows = draws.map(d => {
  const meta = DRAW_STATUS_META[d.status] || DRAW_STATUS_META.pending;
  const isCo = d.notes && d.notes.startsWith('co:');
  const displayTrigger = d.trigger_event;
  const pctDisplay = Number(d.percent) > 0 ? `${(Number(d.percent) * 100).toFixed(1)}%` : '—';
  let actions = '';
  if (isActive) {
    if (d.status === 'pending') {
      actions = `<button class="btn primary" data-sov-draw-act="request" data-draw-id="${esc(d.id)}" style="font-size:11px;padding:4px 10px;">Request</button>`;
    } else if (d.status === 'requested' || d.status === 'partial') {
      actions = `
        <button class="btn primary" data-sov-draw-act="pay" data-draw-id="${esc(d.id)}" style="font-size:11px;padding:4px 10px;">Mark Paid</button>
        <button class="btn ghost" data-sov-draw-act="revert" data-draw-id="${esc(d.id)}" style="font-size:11px;padding:4px 10px;">↩</button>
      `;
    } else if (d.status === 'paid') {
      actions = `<button class="btn ghost" data-sov-draw-act="revert" data-draw-id="${esc(d.id)}" style="font-size:11px;padding:4px 10px;color:var(--muted);">↩ Undo</button>`;
    }
  } else if (isDraft) {
    actions = `<button class="btn ghost" data-sov-draw-act="edit" data-draw-id="${esc(d.id)}" style="font-size:11px;padding:4px 10px;">✎</button>`;
  }
  const paidLine = d.paid_at ? `<div style="font-size:10px;color:var(--muted);margin-top:2px;">Paid ${new Date(d.paid_at).toLocaleDateString()}${d.paid_check_num ? ' · #' + esc(d.paid_check_num) : ''}</div>` : '';
  const reqLine = (d.requested_at && d.status !== 'paid') ? `<div style="font-size:10px;color:var(--muted);margin-top:2px;">Requested ${new Date(d.requested_at).toLocaleDateString()}</div>` : '';
  return `
    <tr>
      <td style="font-weight:700;color:var(--navy);">${d.draw_num}${isCo ? ' <span style="font-size:10px;color:var(--purple);font-weight:600;">CO</span>' : ''}</td>
      <td>${esc(displayTrigger)}${paidLine}${reqLine}</td>
      <td class="r">${pctDisplay}</td>
      <td class="r" style="font-weight:600;">${usd(d.total_amount)}</td>
      <td><span class="wobx-status-pill" style="background:${meta.bg};color:${meta.color};border:1px solid ${meta.color}40;font-size:10px;padding:2px 8px;border-radius:20px;font-weight:600;">${meta.lbl}</span></td>
      <td style="text-align:right;white-space:nowrap;">${actions}</td>
    </tr>
  `;
}).join('');

return `
  <div class="sov-draws-wrap" style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:0;overflow:hidden;">
    <table class="wobx-trade-table" style="width:100%;">
      <thead>
        <tr style="background:var(--bg);">
          <th style="width:50px;">#</th>
          <th>Trigger Event</th>
          <th class="r" style="width:80px;">%</th>
          <th class="r" style="width:120px;">Amount</th>
          <th style="width:140px;">Status</th>
          <th style="width:160px;"></th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--muted);">No draws — this SOV is empty</td></tr>'}</tbody>
    </table>
  </div>
`;
}

// ─── History footer ─────────────────────────────────────────────────────────
function renderSovHistory() {
const h = state.sovHistory || [];
if (!h.length) return '';
const rows = h.slice(0, 10).map(e => `
  <div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;">
    <div><b style="color:var(--navy);">${esc(e.action)}</b>${e.notes ? ' · ' + esc(e.notes) : ''}</div>
    <div style="color:var(--muted);white-space:nowrap;">${esc(e.actor_email || e.actor_role || '')} · ${new Date(e.observed_at).toLocaleString()}</div>
  </div>
`).join('');
return `
  <div style="margin-top:12px;background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 16px;">
    <div style="font-size:11px;font-weight:700;color:var(--navy);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">History (last ${Math.min(h.length, 10)})</div>
    ${rows}
  </div>
`;
}

// ─── Wire tab events ────────────────────────────────────────────────────────
function wireSovTab() {
const createBtn = document.getElementById('sov_create_btn');
if (createBtn) createBtn.addEventListener('click', openCreateSovModal);
const sendBtn = document.getElementById('sov_send_btn');
if (sendBtn) sendBtn.addEventListener('click', sendSovForSignature);
const resendBtn = document.getElementById('sov_resend_btn');
if (resendBtn) resendBtn.addEventListener('click', sendSovForSignature);
const copyBtn = document.getElementById('sov_copy_link_btn');
if (copyBtn) copyBtn.addEventListener('click', copySovCustomerLink);
const markBtn = document.getElementById('sov_mark_signed_btn');
if (markBtn) markBtn.addEventListener('click', openMarkSovSignedModal);
const cancelBtn = document.getElementById('sov_cancel_btn');
if (cancelBtn) cancelBtn.addEventListener('click', cancelSov);
const supersedeBtn = document.getElementById('sov_supersede_btn');
if (supersedeBtn) supersedeBtn.addEventListener('click', supersedeSov);
const pdfBtn = document.getElementById('sov_export_pdf_btn');
if (pdfBtn) pdfBtn.addEventListener('click', exportSovPdf);
const xlsxBtn = document.getElementById('sov_export_xlsx_btn');
if (xlsxBtn) xlsxBtn.addEventListener('click', exportSovExcel);
document.querySelectorAll('[data-sov-draw-act]').forEach(btn => {
  btn.addEventListener('click', () => {
    const act = btn.dataset.sovDrawAct;
    const drawId = btn.dataset.drawId;
    if (act === 'request') openRequestDrawModal(drawId);
    else if (act === 'pay') openPayDrawModal(drawId);
    else if (act === 'revert') revertDrawStatus(drawId);
    else if (act === 'edit') openEditDrawModal(drawId);
  });
});
}

// ─── Create SOV modal ───────────────────────────────────────────────────────
function openCreateSovModal() {
const p = state.activeProject || {};
// Default contract total = sum of Xact items (materials + labor + equipment) if present
const xactTotal = computeXactTotalForSov();
const html = `
  <div class="modal-back on" id="sov_create_overlay">
    <div class="modal" style="max-width:560px;">
      <h3>Create Schedule of Values <button class="close" data-close>×</button></h3>
      <div class="modal-body">
        <div style="margin-bottom:12px;">
          <label style="font-size:11px;font-weight:700;color:var(--navy);text-transform:uppercase;letter-spacing:.05em;">Contract Total ($)</label>
          <input type="number" id="sov_form_total" value="${xactTotal.toFixed(2)}" step="0.01" min="0" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:14px;margin-top:4px;">
          ${xactTotal ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;">Pre-filled from Xact budget</div>` : ''}
        </div>
        <div style="margin-bottom:12px;">
          <label style="font-size:11px;font-weight:700;color:var(--navy);text-transform:uppercase;letter-spacing:.05em;">Draw Split</label>
          <div style="display:flex;gap:6px;margin-top:4px;">
            <button type="button" class="btn" data-sov-split="50/50" style="flex:1;">50 / 50 (default)</button>
            <button type="button" class="btn ghost" data-sov-split="30/30/40" style="flex:1;">30 / 30 / 40</button>
            <button type="button" class="btn ghost" data-sov-split="custom" style="flex:1;">Custom</button>
          </div>
        </div>
        <div id="sov_form_preview" style="margin-top:8px;"></div>
        <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end;">
          <button class="btn ghost" data-close>Cancel</button>
          <button class="btn primary" id="sov_form_submit">Create SOV</button>
        </div>
      </div>
    </div>
  </div>
`;
document.body.insertAdjacentHTML('beforeend', html);
const overlay = document.getElementById('sov_create_overlay');
overlay.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => overlay.remove()));

let currentSplit = '50/50';
let customDraws = null;

function renderPreview() {
  const total = Number(document.getElementById('sov_form_total').value) || 0;
  const preview = document.getElementById('sov_form_preview');
  let draws;
  if (currentSplit === 'custom') {
    draws = customDraws || [{ pct: 0.5, trigger: 'Draw 1' }, { pct: 0.5, trigger: 'Draw 2' }];
    preview.innerHTML = `
      <div style="background:var(--bg);padding:10px;border-radius:6px;font-size:12px;">
        <div style="font-weight:700;margin-bottom:6px;">Custom Draws (must total 100%)</div>
        <div id="sov_custom_rows">
          ${draws.map((d, i) => `
            <div style="display:flex;gap:6px;margin-bottom:4px;align-items:center;">
              <span style="width:24px;color:var(--muted);">#${i + 1}</span>
              <input type="number" data-custom-pct="${i}" value="${(d.pct * 100).toFixed(1)}" min="0" max="100" step="0.1" style="width:70px;padding:4px;border:1px solid var(--border);border-radius:4px;font-size:12px;">
              <span>%</span>
              <input type="text" data-custom-trigger="${i}" value="${esc(d.trigger)}" placeholder="Trigger event" style="flex:1;padding:4px;border:1px solid var(--border);border-radius:4px;font-size:12px;">
              ${draws.length > 1 ? `<button type="button" data-custom-remove="${i}" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:16px;">×</button>` : ''}
            </div>
          `).join('')}
        </div>
        <button type="button" id="sov_custom_add" class="btn ghost" style="font-size:11px;padding:4px 10px;margin-top:4px;">+ Add Draw</button>
        <div id="sov_custom_total" style="margin-top:6px;font-weight:700;"></div>
      </div>
    `;
    // Wire custom inputs
    preview.querySelectorAll('[data-custom-pct], [data-custom-trigger]').forEach(input => {
      input.addEventListener('input', updateCustom);
    });
    preview.querySelectorAll('[data-custom-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        customDraws.splice(Number(btn.dataset.customRemove), 1);
        renderPreview();
      });
    });
    document.getElementById('sov_custom_add').addEventListener('click', () => {
      customDraws = customDraws || draws;
      customDraws.push({ pct: 0, trigger: 'Draw ' + (customDraws.length + 1) });
      renderPreview();
    });
    updateCustom();
  } else {
    draws = SOV_PRESET_SPLITS[currentSplit];
    const rows = draws.map((d, i) => `
      <tr>
        <td style="padding:4px 8px;font-weight:700;">${i + 1}</td>
        <td style="padding:4px 8px;">${esc(d.trigger)}</td>
        <td style="padding:4px 8px;text-align:right;">${(d.pct * 100).toFixed(0)}%</td>
        <td style="padding:4px 8px;text-align:right;font-weight:600;">${usd(total * d.pct)}</td>
      </tr>
    `).join('');
    preview.innerHTML = `
      <div style="background:var(--bg);padding:10px;border-radius:6px;">
        <table style="width:100%;font-size:12px;">
          <thead><tr style="border-bottom:1px solid var(--border);"><th style="text-align:left;padding:4px 8px;">#</th><th style="text-align:left;padding:4px 8px;">Trigger</th><th style="text-align:right;padding:4px 8px;">%</th><th style="text-align:right;padding:4px 8px;">Amount</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr style="border-top:1px solid var(--border);font-weight:700;"><td colspan="3" style="padding:4px 8px;">Total</td><td style="padding:4px 8px;text-align:right;">${usd(total)}</td></tr></tfoot>
        </table>
      </div>
    `;
  }
}
function updateCustom() {
  const rows = document.querySelectorAll('#sov_custom_rows [data-custom-pct]');
  customDraws = Array.from(rows).map((input, i) => ({
    pct: (Number(input.value) || 0) / 100,
    trigger: document.querySelector(`[data-custom-trigger="${i}"]`)?.value || ('Draw ' + (i + 1)),
  }));
  const sum = customDraws.reduce((s, d) => s + d.pct, 0);
  const totalDisp = document.getElementById('sov_custom_total');
  if (totalDisp) {
    totalDisp.style.color = Math.abs(sum - 1) < 0.001 ? 'var(--success)' : 'var(--danger)';
    totalDisp.textContent = `Total: ${(sum * 100).toFixed(1)}% ${Math.abs(sum - 1) < 0.001 ? '✓' : '(must be 100%)'}`;
  }
}

overlay.querySelectorAll('[data-sov-split]').forEach(btn => {
  btn.addEventListener('click', () => {
    overlay.querySelectorAll('[data-sov-split]').forEach(b => b.classList.replace('primary', 'ghost'));
    btn.classList.remove('ghost');
    btn.classList.add('primary');
    currentSplit = btn.dataset.sovSplit;
    if (currentSplit === 'custom') customDraws = null;
    renderPreview();
  });
});
document.getElementById('sov_form_total').addEventListener('input', renderPreview);
renderPreview();

document.getElementById('sov_form_submit').addEventListener('click', async () => {
  const total = Number(document.getElementById('sov_form_total').value) || 0;
  if (total <= 0) { toast('Enter a contract total'); return; }
  let draws;
  if (currentSplit === 'custom') {
    const sum = (customDraws || []).reduce((s, d) => s + d.pct, 0);
    if (Math.abs(sum - 1) > 0.001) { toast('Custom split must total 100%'); return; }
    draws = customDraws;
  } else {
    draws = SOV_PRESET_SPLITS[currentSplit];
  }
  await createSov(total, draws);
  overlay.remove();
});
}

// ─── Create SOV (DB write) ──────────────────────────────────────────────────
async function createSov(total, draws) {
if (!sb || !state.activeProjectId) return;
const { data: sovRow, error } = await sb.from('rebuild_sov').insert({
  project_id: state.activeProjectId,
  contract_total: total,
  draw_count: draws.length,
  status: 'draft',
  created_by: state.pmEmail || null,
}).select().single();
if (error || !sovRow) { toast('Failed to create SOV: ' + (error?.message || 'unknown')); return; }
const drawRows = draws.map((d, i) => ({
  sov_id: sovRow.id,
  draw_num: i + 1,
  trigger_event: d.trigger,
  percent: d.pct,
  base_amount: +(total * d.pct).toFixed(2),
  status: 'pending',
}));
const { error: drawErr } = await sb.from('rebuild_sov_draws').insert(drawRows);
if (drawErr) { toast('SOV created but draws failed: ' + drawErr.message); }
state.sov = sovRow;
await logSovEvent('sov_created', {
  new_values: { contract_total: total, draw_count: draws.length },
  notes: `SOV drafted with ${draws.length} draws totaling ${usd(total)}`,
});
if (typeof logToAlbi === 'function') logToAlbi('sov_created', `SOV drafted: ${usd(total)} across ${draws.length} draws`);
await loadSov();
renderDetail();
toast('SOV created');
}

// ─── Send for signature (creates rebuild_documents entry) ───────────────────
async function sendSovForSignature() {
if (!state.sov || !state.activeProjectId) return;
const p = state.activeProject || {};
if (!p.customer_email) { toast('No customer email on project'); return; }
if (!confirm(`Send SOV to ${p.customer_email} for signature?`)) return;

// Generate signed PDF blob first, store, then send link
const pdfBlob = await buildSovPdfBlob({ forSignature: true });
if (!pdfBlob) { toast('Failed to generate PDF'); return; }

// Upload to rebuild_documents bucket (assumes same storage pattern as other docs)
const filename = `SOV_${(p.albi_job_number || state.activeProjectId).replace(/[^a-zA-Z0-9._-]/g, '_')}_${Date.now()}.pdf`;
const { data: upload, error: upErr } = await sb.storage
  .from('rebuild-documents')
  .upload(`signatures/${filename}`, pdfBlob, { contentType: 'application/pdf', upsert: true });
if (upErr) { toast('Upload failed: ' + upErr.message); return; }
const { data: urlData } = sb.storage.from('rebuild-documents').getPublicUrl(`signatures/${filename}`);
const fileUrl = urlData.publicUrl;

// Insert rebuild_documents row tracking the signature request
const { data: docRow, error: docErr } = await sb.from('rebuild_documents').insert({
  project_id: state.activeProjectId,
  category: 'contract',
  filename: filename,
  file_url: fileUrl,
  file_size_bytes: pdfBlob.size,
  mime_type: 'application/pdf',
  notes: `Schedule of Values — sent for customer signature`,
  uploaded_by_email: state.pmEmail || null,
  customer_visible: true,
  signature_status: 'sent',
  signature_token: state.sov.customer_token,
  signature_sent_at: new Date().toISOString(),
  signature_sent_to_email: p.customer_email,
  signature_sent_to_name: p.customer_name,
}).select().single();
if (docErr) { toast('Doc create failed: ' + docErr.message); return; }

// Update SOV status to sent
await sb.from('rebuild_sov').update({ status: 'sent' }).eq('id', state.sov.id);
await logSovEvent('sov_sent', {
  new_values: { sent_to: p.customer_email, doc_id: docRow.id },
  notes: `Sent for signature to ${p.customer_email}`,
});
if (typeof logToAlbi === 'function') logToAlbi('sov_sent', `SOV sent to ${p.customer_email} for signature`);
await loadSov();
renderDetail();
toast('SOV sent to customer');
}

// ─── Copy customer signature link ───────────────────────────────────────────
function copySovCustomerLink() {
if (!state.sov) return;
const url = `${location.origin}${location.pathname.replace(/[^/]*$/, '')}approval.html?sov=${state.sov.customer_token}`;
navigator.clipboard.writeText(url).then(() => toast('Link copied'));
}

// ─── Mark signed manually (PM override) ─────────────────────────────────────
function openMarkSovSignedModal() {
const p = state.activeProject || {};
const html = `
  <div class="modal-back on" id="sov_sign_overlay">
    <div class="modal" style="max-width:420px;">
      <h3>Mark SOV Customer-Signed <button class="close" data-close>×</button></h3>
      <div class="modal-body">
        <p style="font-size:13px;color:var(--muted);">Use this when the customer signed offline (paper, email, etc).</p>
        <div style="margin-bottom:10px;">
          <label style="font-size:11px;font-weight:700;color:var(--navy);text-transform:uppercase;">Signed by (name)</label>
          <input type="text" id="sov_sign_name" value="${esc(p.customer_name || '')}" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;margin-top:4px;">
        </div>
        <div style="margin-bottom:10px;">
          <label style="font-size:11px;font-weight:700;color:var(--navy);text-transform:uppercase;">Signed date</label>
          <input type="date" id="sov_sign_date" value="${new Date().toISOString().slice(0, 10)}" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;margin-top:4px;">
        </div>
        <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end;">
          <button class="btn ghost" data-close>Cancel</button>
          <button class="btn primary" id="sov_sign_submit">Mark Signed</button>
        </div>
      </div>
    </div>
  </div>
`;
document.body.insertAdjacentHTML('beforeend', html);
const overlay = document.getElementById('sov_sign_overlay');
overlay.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => overlay.remove()));
document.getElementById('sov_sign_submit').addEventListener('click', async () => {
  const name = document.getElementById('sov_sign_name').value.trim();
  const date = document.getElementById('sov_sign_date').value;
  if (!name) { toast('Enter signer name'); return; }
  const signedAt = new Date(date + 'T12:00:00').toISOString();
  await sb.from('rebuild_sov').update({
    status: 'customer_signed',
    customer_signed_at: signedAt,
    customer_signed_name: name,
  }).eq('id', state.sov.id);
  await logSovEvent('sov_signed', {
    new_values: { customer_signed_name: name, customer_signed_at: signedAt },
    notes: `Marked signed manually by ${name}`,
  });
  if (typeof logToAlbi === 'function') logToAlbi('sov_signed', `SOV customer-signed by ${name}`);
  overlay.remove();
  await loadSov();
  renderDetail();
  toast('SOV marked customer-signed');
});
}

// ─── Cancel SOV ─────────────────────────────────────────────────────────────
async function cancelSov() {
if (!state.sov) return;
if (!confirm('Cancel this SOV? It will be marked cancelled and a new one can be created.')) return;
await sb.from('rebuild_sov').update({ status: 'cancelled' }).eq('id', state.sov.id);
await logSovEvent('sov_cancelled', { notes: 'Cancelled by PM' });
if (typeof logToAlbi === 'function') logToAlbi('sov_cancelled', 'SOV cancelled');
await loadSov();
renderDetail();
toast('SOV cancelled');
}

// ─── Supersede (signed SOV → new one) ───────────────────────────────────────
async function supersedeSov() {
if (!state.sov) return;
if (!confirm('Supersede this signed SOV and start a new one? The old SOV is preserved as a historical record.')) return;
await sb.from('rebuild_sov').update({ status: 'superseded' }).eq('id', state.sov.id);
await logSovEvent('sov_superseded', { notes: 'Superseded by PM; new SOV to be drafted' });
if (typeof logToAlbi === 'function') logToAlbi('sov_superseded', 'SOV superseded');
await loadSov();
renderDetail();
toast('SOV superseded — create a new one to replace it');
}

// ─── Request a draw ─────────────────────────────────────────────────────────
function openRequestDrawModal(drawId) {
const draw = state.sovDraws.find(d => d.id === drawId);
if (!draw) return;
const html = `
  <div class="modal-back on" id="sov_req_overlay">
    <div class="modal" style="max-width:420px;">
      <h3>Request Draw #${draw.draw_num} <button class="close" data-close>×</button></h3>
      <div class="modal-body">
        <p style="font-size:13px;color:var(--muted);">Amount: <b style="color:var(--navy);">${usd(draw.total_amount)}</b></p>
        <div style="margin-bottom:10px;">
          <label style="font-size:11px;font-weight:700;color:var(--navy);text-transform:uppercase;">Note (optional)</label>
          <textarea id="sov_req_note" rows="3" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;margin-top:4px;font-family:inherit;" placeholder="e.g. Sent invoice INV-#"></textarea>
        </div>
        <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end;">
          <button class="btn ghost" data-close>Cancel</button>
          <button class="btn primary" id="sov_req_submit">Mark Requested</button>
        </div>
      </div>
    </div>
  </div>
`;
document.body.insertAdjacentHTML('beforeend', html);
const overlay = document.getElementById('sov_req_overlay');
overlay.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => overlay.remove()));
document.getElementById('sov_req_submit').addEventListener('click', async () => {
  const note = document.getElementById('sov_req_note').value.trim();
  const now = new Date().toISOString();
  await sb.from('rebuild_sov_draws').update({
    status: 'requested',
    requested_at: now,
    requested_by: state.pmEmail || null,
    request_note: note || null,
  }).eq('id', drawId);
  await logSovEvent('draw_requested', {
    draw_id: drawId,
    new_values: { draw_num: draw.draw_num, amount: draw.total_amount },
    notes: `Draw ${draw.draw_num} requested${note ? ': ' + note : ''}`,
  });
  if (typeof logToAlbi === 'function') logToAlbi('draw_requested', `Draw ${draw.draw_num} requested (${usd(draw.total_amount)})`);
  overlay.remove();
  await loadSov();
  renderDetail();
});
}

// ─── Mark draw paid ─────────────────────────────────────────────────────────
function openPayDrawModal(drawId) {
const draw = state.sovDraws.find(d => d.id === drawId);
if (!draw) return;
const html = `
  <div class="modal-back on" id="sov_pay_overlay">
    <div class="modal" style="max-width:420px;">
      <h3>Mark Draw #${draw.draw_num} Paid <button class="close" data-close>×</button></h3>
      <div class="modal-body">
        <div style="margin-bottom:10px;">
          <label style="font-size:11px;font-weight:700;color:var(--navy);text-transform:uppercase;">Amount Received ($)</label>
          <input type="number" id="sov_pay_amount" value="${Number(draw.total_amount).toFixed(2)}" step="0.01" min="0" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;margin-top:4px;">
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">Less than full amount → marked Partial. Full → Paid.</div>
        </div>
        <div style="margin-bottom:10px;">
          <label style="font-size:11px;font-weight:700;color:var(--navy);text-transform:uppercase;">Method</label>
          <select id="sov_pay_method" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;margin-top:4px;">
            <option value="check">Check</option>
            <option value="ach">ACH</option>
            <option value="wire">Wire</option>
            <option value="cc">Credit Card</option>
          </select>
        </div>
        <div style="margin-bottom:10px;">
          <label style="font-size:11px;font-weight:700;color:var(--navy);text-transform:uppercase;">Reference # (check/wire)</label>
          <input type="text" id="sov_pay_ref" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;margin-top:4px;">
        </div>
        <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end;">
          <button class="btn ghost" data-close>Cancel</button>
          <button class="btn primary" id="sov_pay_submit">Mark Paid</button>
        </div>
      </div>
    </div>
  </div>
`;
document.body.insertAdjacentHTML('beforeend', html);
const overlay = document.getElementById('sov_pay_overlay');
overlay.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => overlay.remove()));
document.getElementById('sov_pay_submit').addEventListener('click', async () => {
  const amt = Number(document.getElementById('sov_pay_amount').value) || 0;
  const method = document.getElementById('sov_pay_method').value;
  const ref = document.getElementById('sov_pay_ref').value.trim();
  if (amt <= 0) { toast('Enter amount received'); return; }
  const isFullPay = Math.abs(amt - Number(draw.total_amount)) < 0.01;
  const newStatus = isFullPay ? 'paid' : 'partial';
  const now = new Date().toISOString();
  await sb.from('rebuild_sov_draws').update({
    status: newStatus,
    paid_at: now,
    paid_amount: amt,
    paid_method: method,
    paid_check_num: ref || null,
  }).eq('id', drawId);
  // If all draws are paid and SOV isn't yet complete, flip status to complete
  const { data: allDraws } = await sb.from('rebuild_sov_draws').select('status').eq('sov_id', state.sov.id);
  const allPaid = (allDraws || []).every(d => d.status === 'paid' || d.status === 'waived');
  if (allPaid && allDraws.length) {
    await sb.from('rebuild_sov').update({ status: 'complete' }).eq('id', state.sov.id);
    await logSovEvent('sov_complete', { notes: 'All draws paid — SOV marked complete' });
  } else if (state.sov.status === 'customer_signed') {
    // First payment received — flip from customer_signed to active
    await sb.from('rebuild_sov').update({ status: 'active' }).eq('id', state.sov.id);
  }
  await logSovEvent(isFullPay ? 'draw_paid' : 'draw_partial', {
    draw_id: drawId,
    new_values: { amount: amt, method: method, ref: ref },
    notes: `Draw ${draw.draw_num} ${isFullPay ? 'paid in full' : 'partially paid'}: ${usd(amt)}${ref ? ' (#' + ref + ')' : ''}`,
  });
  if (typeof logToAlbi === 'function') logToAlbi(isFullPay ? 'draw_paid' : 'draw_partial', `Draw ${draw.draw_num} ${isFullPay ? 'paid' : 'partial'}: ${usd(amt)}`);
  overlay.remove();
  await loadSov();
  renderDetail();
});
}

// ─── Revert draw status (undo) ──────────────────────────────────────────────
async function revertDrawStatus(drawId) {
const draw = state.sovDraws.find(d => d.id === drawId);
if (!draw) return;
if (!confirm(`Revert Draw #${draw.draw_num} (${DRAW_STATUS_META[draw.status]?.lbl}) back to Pending?`)) return;
await sb.from('rebuild_sov_draws').update({
  status: 'pending',
  requested_at: null,
  requested_by: null,
  request_note: null,
  paid_at: null,
  paid_amount: null,
  paid_method: null,
  paid_check_num: null,
}).eq('id', drawId);
// If SOV was complete, demote to active
if (state.sov.status === 'complete') {
  await sb.from('rebuild_sov').update({ status: 'active' }).eq('id', state.sov.id);
}
await logSovEvent('draw_reverted', {
  draw_id: drawId,
  old_values: { status: draw.status, paid_amount: draw.paid_amount },
  notes: `Draw ${draw.draw_num} reverted from ${draw.status} to pending`,
});
if (typeof logToAlbi === 'function') logToAlbi('draw_reverted', `Draw ${draw.draw_num} status reverted`);
await loadSov();
renderDetail();
}

// ─── Edit draw (draft only) ─────────────────────────────────────────────────
function openEditDrawModal(drawId) {
const draw = state.sovDraws.find(d => d.id === drawId);
if (!draw) return;
if (state.sov.status !== 'draft') { toast('Draws can only be edited while SOV is in draft'); return; }
const html = `
  <div class="modal-back on" id="sov_edit_overlay">
    <div class="modal" style="max-width:480px;">
      <h3>Edit Draw #${draw.draw_num} <button class="close" data-close>×</button></h3>
      <div class="modal-body">
        <div style="margin-bottom:10px;">
          <label style="font-size:11px;font-weight:700;color:var(--navy);text-transform:uppercase;">Trigger Event</label>
          <textarea id="sov_edit_trigger" rows="3" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;margin-top:4px;font-family:inherit;">${esc(draw.trigger_event)}</textarea>
        </div>
        <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end;">
          <button class="btn ghost" data-close>Cancel</button>
          <button class="btn primary" id="sov_edit_submit">Save</button>
        </div>
      </div>
    </div>
  </div>
`;
document.body.insertAdjacentHTML('beforeend', html);
const overlay = document.getElementById('sov_edit_overlay');
overlay.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => overlay.remove()));
document.getElementById('sov_edit_submit').addEventListener('click', async () => {
  const trigger = document.getElementById('sov_edit_trigger').value.trim();
  if (!trigger) { toast('Trigger required'); return; }
  await sb.from('rebuild_sov_draws').update({ trigger_event: trigger }).eq('id', drawId);
  await logSovEvent('draw_edited', { draw_id: drawId, notes: `Draw ${draw.draw_num} trigger edited` });
  overlay.remove();
  await loadSov();
  renderDetail();
});
}

// ─── PDF Builder (returns Blob for both export and signature send) ──────────
async function buildSovPdfBlob(opts) {
opts = opts || {};
if (typeof window.jspdf === 'undefined' && typeof jsPDF === 'undefined') {
  toast('PDF library not loaded'); return null;
}
const PDFCtor = (window.jspdf && window.jspdf.jsPDF) || jsPDF;
const doc = new PDFCtor({ unit: 'pt', format: 'letter' });
const p = state.activeProject || {};
const s = state.sov;
const draws = state.sovDraws || [];
const pageW = doc.internal.pageSize.getWidth();
const margin = 48;
let y = margin;

// Header
doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(13, 45, 94);
doc.text('SCHEDULE OF VALUES', margin, y); y += 22;
doc.setFontSize(11); doc.setTextColor(60, 60, 60);
doc.text(`Project: ${p.customer_name || ''}`, margin, y); y += 14;
if (p.property_address) { doc.text(p.property_address, margin, y); y += 14; }
doc.setTextColor(120, 120, 120); doc.setFontSize(9);
doc.text('JG Restoration | (920) 428-4200 | Contractor License DC-011000010', margin, y); y += 20;

// Status line
doc.setFontSize(10); doc.setTextColor(60, 60, 60);
const statusMeta = SOV_STATUS_META[s.status] || SOV_STATUS_META.draft;
doc.text(`Status: ${statusMeta.lbl}    Contract Total: ${usd(s.contract_total)}    ${draws.length} Draw${draws.length === 1 ? '' : 's'}`, margin, y); y += 20;

// Draws table
doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(13, 45, 94);
doc.text('DRAW SCHEDULE', margin, y); y += 14;
doc.setDrawColor(200, 200, 200); doc.line(margin, y, pageW - margin, y); y += 4;
doc.setFontSize(9); doc.setTextColor(100, 100, 100);
doc.text('#', margin, y);
doc.text('TRIGGER EVENT', margin + 24, y);
doc.text('%', pageW - margin - 130, y);
doc.text('AMOUNT', pageW - margin - 80, y, { align: 'left' });
y += 4; doc.line(margin, y, pageW - margin, y); y += 12;

doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(40, 40, 40);
draws.forEach(d => {
  if (y > 700) { doc.addPage(); y = margin; }
  const triggerLines = doc.splitTextToSize(d.trigger_event, pageW - margin - margin - 180);
  doc.setFont('helvetica', 'bold');
  doc.text(String(d.draw_num), margin, y);
  doc.setFont('helvetica', 'normal');
  doc.text(triggerLines, margin + 24, y);
  const pctStr = Number(d.percent) > 0 ? `${(Number(d.percent) * 100).toFixed(1)}%` : '—';
  doc.text(pctStr, pageW - margin - 130, y);
  doc.setFont('helvetica', 'bold');
  doc.text(usd(d.total_amount), pageW - margin - 80, y);
  doc.setFont('helvetica', 'normal');
  y += Math.max(triggerLines.length * 12, 14) + 4;
});
y += 8; doc.line(margin, y, pageW - margin, y); y += 14;
doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
doc.text('TOTAL', margin, y);
doc.text(usd(s.contract_total), pageW - margin - 80, y); y += 24;

// Terms
if (y > 600) { doc.addPage(); y = margin; }
doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(13, 45, 94);
doc.text('TERMS', margin, y); y += 12;
doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(60, 60, 60);
const terms = [
  `• Payment due within ${s.payment_due_days || 5} business days of draw request.`,
  `• A ${((s.late_fee_percent || 0.015) * 100).toFixed(1)}% per month late fee applies to any draw not paid within ${s.late_fee_days || 10} business days of request.`,
  '• Lien waivers will be provided for each draw upon receipt of payment.',
  '• Change orders billed separately and added to draw schedule as approved in writing.',
  '• Material storage and protection is included in contract price.',
];
terms.forEach(t => {
  const lines = doc.splitTextToSize(t, pageW - margin - margin);
  doc.text(lines, margin, y);
  y += lines.length * 11 + 2;
});
y += 16;

// Acceptance block
if (y > 600) { doc.addPage(); y = margin; }
doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(13, 45, 94);
doc.text('ACCEPTANCE', margin, y); y += 14;
doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(60, 60, 60);
const accText = doc.splitTextToSize(
  `By signing below, both parties agree to the Schedule of Values for the ${p.customer_name || 'subject'} project${p.property_address ? ' located at ' + p.property_address : ''}.`,
  pageW - margin - margin
);
doc.text(accText, margin, y); y += accText.length * 11 + 14;

// Customer signature line
doc.setFontSize(10); doc.setTextColor(13, 45, 94); doc.setFont('helvetica', 'bold');
doc.text('HOMEOWNER', margin, y); y += 14;
doc.setTextColor(100, 100, 100); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
if (s.customer_signed_at) {
  doc.text(`Signature: ${s.customer_signed_name || ''}`, margin, y); y += 14;
  doc.text(`Signed: ${new Date(s.customer_signed_at).toLocaleDateString()}`, margin, y); y += 20;
} else {
  doc.text('Signature: ____________________________________', margin, y); y += 14;
  doc.text('Print Name: ____________________________________', margin, y); y += 14;
  doc.text('Date: ____________________________________', margin, y); y += 20;
}

// JG signature line
doc.setTextColor(13, 45, 94); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
doc.text('JG RESTORATION', margin, y); y += 14;
doc.setTextColor(100, 100, 100); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
doc.text('Signature: ____________________________________', margin, y); y += 14;
doc.text('Print Name: ____________________________________', margin, y); y += 14;
doc.text('Title: ____________________________________', margin, y); y += 14;
doc.text('Date: ____________________________________', margin, y);

return doc.output('blob');
}

// ─── Export PDF (download) ──────────────────────────────────────────────────
async function exportSovPdf() {
if (!state.sov) return;
const blob = await buildSovPdfBlob();
if (!blob) return;
const p = state.activeProject || {};
const filename = `SOV_${(p.albi_job_number || state.activeProjectId).replace(/[^a-zA-Z0-9._-]/g, '_')}.pdf`;
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url; a.download = filename;
document.body.appendChild(a); a.click(); a.remove();
URL.revokeObjectURL(url);
}

// ─── Export Excel (3-sheet Volkert format) ──────────────────────────────────
function exportSovExcel() {
if (!state.sov) return;
if (typeof XLSX === 'undefined') { toast('Excel library not loaded'); return; }
const p = state.activeProject || {};
const s = state.sov;
const draws = state.sovDraws || [];
const wb = XLSX.utils.book_new();

// Sheet 1: Draw Schedule (summary, since we don't have phase line items per SOV)
const draw1Data = [
  ['SCHEDULE OF VALUES'],
  [`Project: ${p.customer_name || ''}`],
  [p.property_address || ''],
  ['JG Restoration | (920) 428-4200 | Contractor License DC-011000010'],
  [],
  ['#', 'Trigger Event', '%', 'Amount', 'Status'],
];
draws.forEach(d => {
  draw1Data.push([
    d.draw_num,
    d.trigger_event,
    Number(d.percent) > 0 ? Number(d.percent) : '',
    Number(d.total_amount),
    (DRAW_STATUS_META[d.status] || {}).lbl || d.status,
  ]);
});
draw1Data.push([]);
draw1Data.push(['', 'TOTAL', '', Number(s.contract_total), '']);
const ws1 = XLSX.utils.aoa_to_sheet(draw1Data);
ws1['!cols'] = [{ wch: 6 }, { wch: 60 }, { wch: 10 }, { wch: 14 }, { wch: 16 }];
XLSX.utils.book_append_sheet(wb, ws1, 'Draw Schedule');

// Sheet 2: Payment Schedule (mirrors Volkert layout)
let cum = 0;
const sheet2 = [
  ['DRAW PAYMENT SCHEDULE'],
  [`${p.customer_name || ''} — Draw Sequence`],
  [],
  ['Draw #', 'Trigger Event', '% of Contract', 'Draw Amount', 'Cumulative %', 'Cumulative Total'],
];
draws.forEach(d => {
  cum += Number(d.total_amount);
  sheet2.push([
    d.draw_num,
    d.trigger_event,
    Number(d.percent) > 0 ? Number(d.percent) : '',
    Number(d.total_amount),
    Number(s.contract_total) > 0 ? cum / Number(s.contract_total) : '',
    cum,
  ]);
});
sheet2.push([]);
sheet2.push(['', 'TOTAL', 1, Number(s.contract_total), '', '']);
sheet2.push([]);
sheet2.push(['NOTES & TERMS']);
sheet2.push([`• Payment due within ${s.payment_due_days || 5} business days of draw request.`]);
sheet2.push([`• A ${((s.late_fee_percent || 0.015) * 100).toFixed(1)}% per month late fee applies after ${s.late_fee_days || 10} business days.`]);
sheet2.push(['• Lien waivers will be provided for each draw upon receipt of payment.']);
sheet2.push(['• Change orders billed separately and added to draw schedule as approved in writing.']);
const ws2 = XLSX.utils.aoa_to_sheet(sheet2);
ws2['!cols'] = [{ wch: 8 }, { wch: 60 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
XLSX.utils.book_append_sheet(wb, ws2, 'Payment Schedule');

// Sheet 3: Acceptance
const sheet3 = [
  ['SCHEDULE OF VALUES — ACCEPTANCE'],
  [],
  [`By signing below, both parties agree to the Schedule of Values for the ${p.customer_name || 'subject'} project${p.property_address ? ' located at ' + p.property_address : ''}.`],
  [],
  [],
  ['HOMEOWNER'],
  ['Signature:', s.customer_signed_name || '__________________________________'],
  ['Print Name:', s.customer_signed_name || '__________________________________'],
  ['Date:', s.customer_signed_at ? new Date(s.customer_signed_at).toLocaleDateString() : '__________________________________'],
  [],
  ['JG RESTORATION'],
  ['Signature:', '__________________________________'],
  ['Print Name:', '__________________________________'],
  ['Title:', '__________________________________'],
  ['Date:', '__________________________________'],
];
const ws3 = XLSX.utils.aoa_to_sheet(sheet3);
ws3['!cols'] = [{ wch: 16 }, { wch: 50 }];
XLSX.utils.book_append_sheet(wb, ws3, 'Acceptance');

const filename = `SOV_${(p.albi_job_number || state.activeProjectId).replace(/[^a-zA-Z0-9._-]/g, '_')}.xlsx`;
XLSX.writeFile(wb, filename);
}

// ════════════════════════════════════════════════════════════════════════════
// CONTRACT PACKET — read-only status display (Piece 1)
// ════════════════════════════════════════════════════════════════════════════
// Loads the most recent non-voided packet for the project. The packet is the
// signed customer contract bundle (Xact + SOV + Contract doc), tracked in
// rebuild_contract_packets. Lifecycle: draft → sent → (customer_signed |
// declined | voided | expired).
//
// This first piece is read-only: card shows current state with no buttons.
// Subsequent pieces will add Create / Send / Re-issue actions.
// ────────────────────────────────────────────────────────────────────────────

const PACKET_STATUS_META = {
  draft:           { lbl: 'DRAFT',           color: 'var(--muted)',   bg: 'rgba(107,114,128,0.10)', icon: '📄' },
  sent:            { lbl: 'SENT — AWAITING', color: 'var(--gold)',    bg: 'rgba(245,166,35,0.12)',  icon: '✉' },
  customer_signed: { lbl: 'CUSTOMER SIGNED', color: 'var(--success)', bg: 'rgba(34,197,94,0.12)',   icon: '✓' },
  declined:        { lbl: 'DECLINED',        color: 'var(--danger)',  bg: 'rgba(220,38,38,0.10)',   icon: '✗' },
  voided:          { lbl: 'VOIDED',          color: 'var(--muted)',   bg: 'rgba(107,114,128,0.10)', icon: '⊘' },
  expired:         { lbl: 'EXPIRED',         color: 'var(--muted)',   bg: 'rgba(107,114,128,0.10)', icon: '⏰' },
};

const PACKET_DECLINE_REASON_LABELS = {
  price_too_high:                 'Price too high',
  timing_concerns:                'Timing concerns',
  scope_concerns:                 'Scope concerns',
  going_with_another_contractor:  'Going with another contractor',
  wants_to_wait:                  'Wants to wait',
  other:                          'Other',
};

async function loadPacket() {
  if (!sb || !state.activeProjectId) {
    state.packet = null;
    return;
  }
  // Most recent packet that is NOT voided. Voided ones are history;
  // a project always has at most one "live" packet at a time.
  const { data, error } = await sb.from('rebuild_contract_packets')
    .select('*')
    .eq('project_id', state.activeProjectId)
    .not('status', 'eq', 'voided')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) {
    console.error('[packet] load failed', error.message, error.code, error.details);
    state.packet = null;
    return;
  }
  state.packet = (data && data[0]) || null;
}

function _packetTimeAgoCompact(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    + ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function _packetDaysRemaining(expiresAt) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (isNaN(ms)) return null;
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function _packetTimeToSignHours(sentAt, signedAt) {
  if (!sentAt || !signedAt) return null;
  const hrs = (new Date(signedAt).getTime() - new Date(sentAt).getTime()) / (1000 * 60 * 60);
  if (isNaN(hrs) || hrs < 0) return null;
  return hrs;
}

function renderPacketSection() {
  const pkt = state.packet;
  const containerStyle = 'background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:12px;';

  function header(statusKey) {
    const meta = PACKET_STATUS_META[statusKey] || PACKET_STATUS_META.draft;
    const pillHtml = statusKey
      ? `<span class="wobx-status-pill" style="background:${meta.bg};color:${meta.color};border:1px solid ${meta.color}40;font-size:11px;padding:2px 10px;border-radius:20px;font-weight:600;">${meta.icon} ${meta.lbl}</span>`
      : '<span style="font-size:11px;color:var(--muted);font-style:italic;">— not started</span>';
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:10px;">
          <h3 style="margin:0;font-size:16px;color:var(--navy);">📋 Contract Packet</h3>
        </div>
        <div>${pillHtml}</div>
      </div>
    `;
  }

  if (!pkt) {
    return `
      <div class="packet-section" style="${containerStyle}">
        ${header(null)}
        <div style="border-top:1px solid var(--border);margin-top:10px;padding-top:10px;font-size:13px;color:var(--muted);">
          No contract packet created yet. The contract packet bundles the Xactimate estimate, Schedule of Values, and contract document into one signable PDF for the customer.
        </div>
      </div>
    `;
  }

  let bodyRows = '';

  if (pkt.status === 'draft') {
    bodyRows = `
      <div style="font-size:13px;color:var(--muted);">
        Packet created ${_packetTimeAgoCompact(pkt.created_at)}. Ready to send to customer.
      </div>
    `;
  } else if (pkt.status === 'sent') {
    const days = _packetDaysRemaining(pkt.token_expires_at);
    const daysLine = days !== null
      ? (days > 0
          ? `<span style="color:var(--muted);">(${days} day${days === 1 ? '' : 's'} remaining)</span>`
          : `<span style="color:var(--danger);font-weight:600;">EXPIRED — sweep pending</span>`)
      : '';
    bodyRows = `
      <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:13px;">
        <div style="color:var(--muted);">Sent on:</div><div>${_packetTimeAgoCompact(pkt.sent_at)}</div>
        <div style="color:var(--muted);">Expires:</div><div>${_packetTimeAgoCompact(pkt.token_expires_at)} ${daysLine}</div>
        ${pkt.viewed_at ? `<div style="color:var(--muted);">First viewed:</div><div>${_packetTimeAgoCompact(pkt.viewed_at)}</div>` : ''}
      </div>
    `;
  } else if (pkt.status === 'customer_signed') {
    const tts = _packetTimeToSignHours(pkt.sent_at, pkt.signed_at);
    const ttsLine = tts !== null
      ? (tts < 24 ? `${tts.toFixed(1)} hours` : `${(tts / 24).toFixed(1)} days`)
      : '—';
    bodyRows = `
      <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:13px;">
        <div style="color:var(--muted);">Signed by:</div><div style="font-weight:600;">${esc(pkt.signed_name || '—')}</div>
        <div style="color:var(--muted);">Signed on:</div><div>${_packetTimeAgoCompact(pkt.signed_at)}</div>
        <div style="color:var(--muted);">Time to sign:</div><div>${ttsLine}</div>
        ${pkt.merged_pdf_url ? `<div style="color:var(--muted);">Packet PDF:</div><div><a href="${esc(pkt.merged_pdf_url)}" target="_blank" style="color:var(--navy);">📑 View signed packet</a></div>` : ''}
      </div>
    `;
  } else if (pkt.status === 'declined') {
    const reasonLbl = PACKET_DECLINE_REASON_LABELS[pkt.decline_reason] || pkt.decline_reason || '—';
    bodyRows = `
      <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:13px;">
        <div style="color:var(--muted);">Declined on:</div><div>${_packetTimeAgoCompact(pkt.declined_at)}</div>
        <div style="color:var(--muted);">Reason:</div><div style="font-weight:600;">${esc(reasonLbl)}</div>
        ${pkt.decline_comment ? `<div style="color:var(--muted);">Comment:</div><div style="font-style:italic;">"${esc(pkt.decline_comment)}"</div>` : ''}
      </div>
    `;
  } else if (pkt.status === 'expired') {
    bodyRows = `
      <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:13px;">
        <div style="color:var(--muted);">Sent on:</div><div>${_packetTimeAgoCompact(pkt.sent_at)}</div>
        <div style="color:var(--muted);">Expired on:</div><div>${_packetTimeAgoCompact(pkt.expired_at)}</div>
      </div>
    `;
  } else {
    bodyRows = `<div style="font-size:13px;color:var(--muted);">Status: ${esc(pkt.status)}</div>`;
  }

  return `
    <div class="packet-section" style="${containerStyle}">
      ${header(pkt.status)}
      <div style="border-top:1px solid var(--border);margin-top:10px;padding-top:10px;">
        ${bodyRows}
      </div>
    </div>
  `;
}

// ════════════════════════════════════════════════════════════════════════════
// END SOV MODULE
// ════════════════════════════════════════════════════════════════════════════
// ─── Expose to window so HTML onclick= attributes and rebuild.html call sites work ───
window.usd = usd;
window.loadPacket = loadPacket;
window.renderPacketSection = renderPacketSection;
window.PACKET_STATUS_META = PACKET_STATUS_META;
window.PACKET_DECLINE_REASON_LABELS = PACKET_DECLINE_REASON_LABELS;
window.computeXactTotalForSov = computeXactTotalForSov;
window.sovBadge = sovBadge;
window.loadSov = loadSov;
window.logSovEvent = logSovEvent;
window.renderSovTab = renderSovTab;
window.renderSovEmpty = renderSovEmpty;
window.renderSovHeader = renderSovHeader;
window.renderSovDrawsTable = renderSovDrawsTable;
window.renderSovHistory = renderSovHistory;
window.wireSovTab = wireSovTab;
window.openCreateSovModal = openCreateSovModal;
window.createSov = createSov;
window.sendSovForSignature = sendSovForSignature;
window.copySovCustomerLink = copySovCustomerLink;
window.openMarkSovSignedModal = openMarkSovSignedModal;
window.cancelSov = cancelSov;
window.supersedeSov = supersedeSov;
window.openRequestDrawModal = openRequestDrawModal;
window.openPayDrawModal = openPayDrawModal;
window.revertDrawStatus = revertDrawStatus;
window.openEditDrawModal = openEditDrawModal;
window.buildSovPdfBlob = buildSovPdfBlob;
window.exportSovPdf = exportSovPdf;
window.exportSovExcel = exportSovExcel;
window.SOV_STATUS_META = SOV_STATUS_META;
window.DRAW_STATUS_META = DRAW_STATUS_META;
window.SOV_PRESET_SPLITS = SOV_PRESET_SPLITS;
