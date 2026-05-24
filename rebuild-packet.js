// ════════════════════════════════════════════════════════════════════════════
// CONTRACT PACKET MODULE (extracted from rebuild-sov.js + rebuild.html 2026-05-24)
// ════════════════════════════════════════════════════════════════════════════
// Tracks the customer contract bundle (Xact + SOV + Contract doc) in
// rebuild_contract_packets. Lifecycle:
//   draft → sent → (customer_signed | declined | voided | expired)
//
// Functions (all exposed on window for HTML onclick handlers):
//   loadPacket, renderPacketSection, createPacket, sendPacket, voidPacket,
//   reissuePacket, copyPacketLink, wirePacketActions, discardDraftPacket,
//   renderPacketXactUpload  (Packet tab Xact upload card — moved from rebuild.html)
//
// Constants exposed: PACKET_STATUS_META, PACKET_DECLINE_REASON_LABELS,
//   PACKET_PORTAL_BASE, PACKET_MERGE_ENDPOINT, PACKET_CONTRACT_GEN_ENDPOINT,
//   CONTRACT_TEMPLATE_VERSION
//
// Dependencies (must be in scope when this script loads):
//   - sb (Supabase client), state, toast, esc, renderDetail
//   - From rebuild-sov.js: loadSov, computeXactTotalForSov, sovBadge,
//     state.sov (read), confirmSovForPacket (referenced via UI)
//   - From rebuild-utils.js: usdCompact, esc
//
// Loaded AFTER rebuild-utils.js, rebuild-sov.js, rebuild-pdf.js
// ════════════════════════════════════════════════════════════════════════════

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

// Customer-facing packet portal base URL
const PACKET_PORTAL_BASE = 'https://jgimprovements-arch.github.io/jg-dispatch/packet.html';

// Vercel merge endpoint
// Cloudflare Worker — replaces broken Vercel jg-proxy-v2/api/packet-merge.
// Source: github.com/jgimprovements-arch/jg-workers/packet-merge
const PACKET_MERGE_ENDPOINT = 'https://jg-packet-merge.josh-70f.workers.dev';

// Vercel contract-generation endpoint (renders contract.html template → PDF)
// Cloudflare Worker — replaces broken Vercel jg-proxy-v2/api/render-contract.
// Source: github.com/jgimprovements-arch/jg-workers/render-contract
const PACKET_CONTRACT_GEN_ENDPOINT = 'https://jg-render-contract.josh-70f.workers.dev';

// Contract template version (bumped when JG_Contract_Template.html is revised)
const CONTRACT_TEMPLATE_VERSION = '1.0';

// ─── Loader ─────────────────────────────────────────────────────────────────
async function loadPacket() {
  if (!sb || !state.activeProjectId) {
    state.packet = null;
    return;
  }
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

// ─── Time helpers ───────────────────────────────────────────────────────────
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

// ─── Find the most recent Xactimate PDF document for the project ────────────
async function _findXactDoc() {
  if (!sb || !state.activeProjectId) return null;
  const { data } = await sb.from('rebuild_documents')
    .select('id, file_url, filename, category, uploaded_at')
    .eq('project_id', state.activeProjectId)
    .or('category.ilike.%xact%,category.ilike.%estimate%')
    .order('uploaded_at', { ascending: false })
    .limit(1);
  return (data && data[0]) || null;
}

// ─── Gate check ─────────────────────────────────────────────────────────────
async function _packetGateCheck() {
  const p = state.activeProject;
  if (!p) return { ok: false, reason: 'No active project loaded.' };
  if (!p.customer_email) return { ok: false, reason: 'No customer email on file. Add one before creating a packet.' };
  if (!state.sov) return { ok: false, reason: 'No Schedule of Values yet. Upload Xactimate to auto-create the SOV.' };
  if (state.sov.status !== 'draft') return { ok: false, reason: `SOV is in status "${state.sov.status}". It must be in draft to bundle into a new packet.` };
  if (!state.sov.confirmed_for_packet_at) return { ok: false, reason: 'SOV is not confirmed for packet. Review the draws in the SOV tab and click "Confirm SOV for Packet" before sending.' };
  const xactDoc = await _findXactDoc();
  if (!xactDoc) return { ok: false, reason: 'No Xactimate estimate uploaded. Upload it to the Documents tab first.' };
  const pkt = state.packet;
  if (pkt && ['draft','sent'].includes(pkt.status)) {
    return { ok: false, reason: `An active packet already exists (status: ${pkt.status}). Discard or void it first.` };
  }
  return { ok: true, xactDoc };
}

// ─── renderPacketSection — STATUS CARD WITH BUTTONS ─────────────────────────
function renderPacketSection() {
  const pkt = state.packet;
  const containerStyle = 'background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:12px;';

  function actions(statusKey) {
    if (!statusKey) {
      return `<button class="btn primary" id="packet_create_btn" style="font-size:12px;padding:5px 14px;">+ Create Packet</button>`;
    }
    if (statusKey === 'draft') {
      return `
        <button class="btn primary" id="packet_send_btn" style="font-size:12px;padding:5px 14px;">✉ Send to Customer</button>
        <button class="btn ghost" id="packet_discard_btn" style="font-size:12px;padding:5px 14px;color:var(--danger);border-color:var(--danger);">🗑 Discard</button>
      `;
    }
    if (statusKey === 'sent') {
      return `
        <button class="btn ghost" id="packet_copy_link_btn" style="font-size:12px;padding:5px 14px;">🔗 Copy Link</button>
        <button class="btn ghost" id="packet_resend_btn" style="font-size:12px;padding:5px 14px;">✉ Resend Email</button>
        <button class="btn ghost" id="packet_void_btn" style="font-size:12px;padding:5px 14px;color:var(--danger);border-color:var(--danger);">🚫 Void</button>
      `;
    }
    if (statusKey === 'declined' || statusKey === 'expired') {
      return `<button class="btn primary" id="packet_reissue_btn" style="font-size:12px;padding:5px 14px;">↩ Re-issue Packet</button>`;
    }
    return '';
  }

  function header(statusKey) {
    const meta = PACKET_STATUS_META[statusKey] || PACKET_STATUS_META.draft;
    const pillHtml = statusKey
      ? `<span class="wobx-status-pill" style="background:${meta.bg};color:${meta.color};border:1px solid ${meta.color}40;font-size:11px;padding:2px 10px;border-radius:20px;font-weight:600;">${meta.icon} ${meta.lbl}</span>`
      : '<span style="font-size:11px;color:var(--muted);font-style:italic;">— not started</span>';
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:10px;">
          <h3 style="margin:0;font-size:16px;color:var(--navy);">📋 Contract Packet</h3>
          ${pillHtml}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">${actions(statusKey)}</div>
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
        ${pkt.merged_pdf_url ? `<div style="margin-top:6px;"><a href="${esc(pkt.merged_pdf_url)}" target="_blank" style="color:var(--navy);">📑 Preview merged PDF</a></div>` : ''}
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
        ${pkt.merged_pdf_url ? `<div style="color:var(--muted);">Packet PDF:</div><div><a href="${esc(pkt.merged_pdf_url)}" target="_blank" style="color:var(--navy);">📑 View</a></div>` : ''}
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

// ─── ACTION: Create Packet ──────────────────────────────────────────────────
async function createPacket() {
  const gate = await _packetGateCheck();
  if (!gate.ok) { toast(gate.reason); return; }
  const { xactDoc } = gate;
  const p = state.activeProject;
  const sov = state.sov;

  // Pull frozen financial snapshot from the parsed Xact upload
  const up = state.woBudget && state.woBudget.upload ? state.woBudget.upload : {};
  const fin = {
    line_item_total: Number(up.line_item_total) || 0,
    material_tax:    Number(up.material_sales_tax) || 0,
    service_tax:     Number(up.service_sales_tax) || 0,
    subtotal:        Number(up.subtotal) || 0,
    overhead:        Number(up.overhead) || 0,
    profit:          Number(up.profit) || 0,
    rcv:             Number(up.replacement_cost_value) || 0,
  };
  const totalTax = fin.material_tax + fin.service_tax;

  const html = `
    <div class="modal-back on" id="packet_create_overlay">
      <div class="modal" style="max-width:560px;">
        <h3>Create Contract Packet <button class="close" data-close>×</button></h3>
        <div class="modal-body">
          <div style="background:rgba(245,166,35,0.08);border:1px solid rgba(245,166,35,0.3);border-radius:6px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:var(--navy);">
            <strong>Heads up:</strong> Once sent, the SOV and all draw amounts become locked.
            They can only be edited if the customer declines or the link expires.
            The financial breakdown below will be <strong>frozen into this packet</strong> — re-uploading the Xactimate later won't change the signed amount.
          </div>

          <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:12px;margin-bottom:12px;padding:10px;background:var(--bg);border-radius:6px;">
            <div style="color:var(--muted);">Customer:</div><div style="font-weight:600;">${esc(p.customer_name || '—')}</div>
            <div style="color:var(--muted);">Email:</div><div>${esc(p.customer_email)}</div>
            <div style="color:var(--muted);">Xactimate:</div><div>${esc(xactDoc.filename)}</div>
          </div>

          <div style="border:1px solid var(--border);border-radius:6px;padding:10px 12px;margin-bottom:14px;background:#fff;">
            <div style="font-size:11px;font-weight:700;color:var(--navy);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">Contract Financial Terms (from Xactimate)</div>
            <div style="display:grid;grid-template-columns:1fr auto;gap:4px 14px;font-size:13px;">
              <div style="color:var(--muted);">Line items subtotal</div><div style="text-align:right;">${usd(fin.line_item_total)}</div>
              <div style="color:var(--muted);">Sales tax (material + service)</div><div style="text-align:right;">${usd(totalTax)}</div>
              <div style="color:var(--muted);border-top:1px solid var(--border);padding-top:4px;">Subtotal</div><div style="text-align:right;border-top:1px solid var(--border);padding-top:4px;">${usd(fin.subtotal)}</div>
              <div style="color:var(--muted);">Overhead</div><div style="text-align:right;">${usd(fin.overhead)}</div>
              <div style="color:var(--muted);">Profit</div><div style="text-align:right;">${usd(fin.profit)}</div>
              <div style="font-weight:700;color:var(--navy);border-top:2px solid var(--navy);padding-top:6px;font-size:14px;">Contract Price (RCV)</div><div style="font-weight:700;color:var(--navy);text-align:right;border-top:2px solid var(--navy);padding-top:6px;font-size:14px;">${usd(fin.rcv)}</div>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
            <div>
              <label style="font-size:11px;font-weight:700;color:var(--navy);text-transform:uppercase;letter-spacing:.05em;">Commencement Date *</label>
              <input type="date" id="packet_start_date" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:13px;margin-top:4px;" required>
            </div>
            <div>
              <label style="font-size:11px;font-weight:700;color:var(--navy);text-transform:uppercase;letter-spacing:.05em;">Substantial Completion *</label>
              <input type="date" id="packet_completion_date" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:13px;margin-top:4px;" required>
            </div>
          </div>

          <div style="margin-bottom:12px;">
            <label style="font-size:11px;font-weight:700;color:var(--navy);text-transform:uppercase;letter-spacing:.05em;">Exclusions (optional)</label>
            <textarea id="packet_exclusions" rows="3" placeholder="e.g. Personal property, landscaping, items not listed in scope…" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:13px;margin-top:4px;resize:vertical;font-family:inherit;"></textarea>
            <div style="font-size:11px;color:var(--muted);margin-top:4px;">Items explicitly NOT covered by this contract. Surfaced to the customer in the signed packet.</div>
          </div>

          <div style="margin-bottom:12px;padding:10px 12px;background:rgba(34,197,94,0.05);border:1px solid rgba(34,197,94,0.25);border-radius:6px;">
            <div style="font-size:11px;font-weight:700;color:var(--success);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">📄 Contract Auto-Generated</div>
            <div style="font-size:12px;color:var(--navy);line-height:1.5;">
              The legal contract will be generated automatically from JG Restoration's attorney-reviewed template, with Exhibits A-G included. It auto-fills customer info, property address, financial terms, dates, and exclusions from above.
            </div>
          </div>

          <div id="packet_create_status" style="font-size:12px;color:var(--muted);min-height:18px;margin-bottom:10px;"></div>
          <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button class="btn ghost" data-close>Cancel</button>
            <button class="btn primary" id="packet_create_submit">Create Packet</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('packet_create_overlay');
  overlay.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => overlay.remove()));

  document.getElementById('packet_create_submit').addEventListener('click', async () => {
    const statusEl = document.getElementById('packet_create_status');
    const submitBtn = document.getElementById('packet_create_submit');
    const startInput = document.getElementById('packet_start_date');
    const completionInput = document.getElementById('packet_completion_date');
    const exclusionsInput = document.getElementById('packet_exclusions');

    // ─── Validation ──────────────────────────────────────────────────
    if (!startInput.value) { statusEl.textContent = 'Commencement Date is required.'; statusEl.style.color = 'var(--danger)'; return; }
    if (!completionInput.value) { statusEl.textContent = 'Substantial Completion Date is required.'; statusEl.style.color = 'var(--danger)'; return; }
    if (new Date(completionInput.value) <= new Date(startInput.value)) {
      statusEl.textContent = 'Substantial Completion must be after Commencement.';
      statusEl.style.color = 'var(--danger)';
      return;
    }

    submitBtn.disabled = true;
    statusEl.style.color = 'var(--muted)';

    try {
      // ── Money formatter for contract template (e.g., 103874.51 → "103,874.51") ──
      const fmtMoney = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      // ── Date formatter for contract template (e.g., "Jun 1, 2026") ──
      const fmtDate = (iso) => {
        if (!iso) return '';
        const d = new Date(iso + (iso.length === 10 ? 'T12:00:00' : ''));
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      };

      const draws = state.sovDraws || [];
      const totalTax = (fin.material_tax || 0) + (fin.service_tax || 0);
      const todayIso = new Date().toISOString().slice(0, 10);

      // Split property address into two lines for the contract template
      const addrParts = (p.property_address || '').split(',').map(s => s.trim());
      const projectSiteAddr1 = addrParts[0] || '';
      const projectSiteAddr2 = addrParts.slice(1).join(', ') || '';

      // 1) Generate + upload SOV PDF (needed first so packet row can reference it)
      statusEl.textContent = 'Generating SOV PDF…';
      const sovBlob = await buildSovPdfBlob({ forSignature: true });
      if (!sovBlob) throw new Error('SOV PDF generator returned null');
      const sovPath = `projects/${state.activeProjectId}/packets/sov-${Date.now()}.pdf`;
      const sovUp = await sb.storage.from('rebuild-documents').upload(sovPath, sovBlob, { contentType: 'application/pdf', upsert: false });
      if (sovUp.error) throw new Error('SOV PDF upload failed: ' + sovUp.error.message);
      const { data: sovUrlData } = sb.storage.from('rebuild-documents').getPublicUrl(sovPath);
      const sovPdfUrl = sovUrlData.publicUrl;

      // 2) Insert packet row first (need packet_id for contract storage path)
      //    contract_pdf_url + merged_pdf_url are filled in after Vercel calls complete.
      statusEl.textContent = 'Creating packet record…';
      const packetInsertRow = {
        project_id: state.activeProjectId,
        sov_id: state.sov.id,
        xact_pdf_url: xactDoc.file_url,
        status: 'draft',
        created_by: state.pmEmail || null,
        // ── Contractual terms captured at packet creation ──
        commencement_date: startInput.value,
        substantial_completion_date: completionInput.value,
        exclusions: (exclusionsInput.value || '').trim() || null,
        // ── Frozen financial snapshot from Xact upload (immutable) ──
        contract_line_item_total: fin.line_item_total,
        contract_material_tax:    fin.material_tax,
        contract_service_tax:     fin.service_tax,
        contract_subtotal:        fin.subtotal,
        contract_overhead:        fin.overhead,
        contract_profit:          fin.profit,
        contract_rcv:             fin.rcv,
        // ── Contract template version (for diligence: which template signed) ──
        contract_template_version: CONTRACT_TEMPLATE_VERSION,
      };
      if (state._packetReissueFrom) {
        packetInsertRow.voids_packet_id = state._packetReissueFrom;
      }
      const { data: pktRows, error: pktErr } = await sb.from('rebuild_contract_packets').insert(packetInsertRow).select();
      if (pktErr) throw new Error('Packet insert failed: ' + pktErr.message);
      const packetRow = pktRows[0];

      // 3) Call /api/render-contract — fetches JG_Contract_Template.html, injects field values, renders PDF
      statusEl.textContent = 'Generating contract from template…';
      const renderPayload = {
        packet_id: packetRow.id,
        project_id: state.activeProjectId,
        fields: {
          // Cover page
          cover_owner_name:        p.customer_name || '',
          cover_project_site:      p.property_address || '',
          cover_contract_date:     fmtDate(todayIso),
          cover_project_ref:       p.albi_job_number || '',
          // Owner / Customer details
          owner_name:              p.customer_name || '',
          owner_address:           p.property_address || '',
          owner_phone:             p.customer_phone || '',
          owner_email:             p.customer_email || '',
          // Contract details
          contract_price:          fmtMoney(fin.rcv),
          sales_rep_name:          p.albi_pm_name || state.pmName || 'JG Restoration',
          project_site_addr_1:     projectSiteAddr1,
          project_site_addr_2:     projectSiteAddr2,
          commencement_date:       fmtDate(startInput.value),
          completion_date:         fmtDate(completionInput.value),
          // Cancellation page
          cancellation_contract_date: fmtDate(todayIso),
          // Guaranty page
          guaranty_contract_date:  fmtDate(todayIso),
          guaranty_project_site:   p.property_address || '',
          // Other
          other_incorporated_docs: 'Xactimate Estimate; Schedule of Values',
          // SOV exhibit — phase table removed from template; Exhibit A now
          // references the attached Xactimate. Only the contract-price total +
          // tax + exclusions appear in Exhibit A's summary box.
          sov_project_ref:         p.albi_job_number || '',
          sov_contract_price:      fmtMoney(fin.rcv),
          sov_source_estimate:     xactDoc.filename || '',
          sov_source_estimate_ref: xactDoc.filename || '',  // mirror for inline callout
          sov_version_date:        fmtDate(todayIso),
          sov_subtotal:            fmtMoney(fin.subtotal || fin.line_item_total || 0),
          sov_tax:                 fmtMoney(totalTax),
          sov_exclusions:          (exclusionsInput.value || '').trim() || 'None',
        },
        draws: draws.map(d => ({
          num:     d.draw_num,
          pct:     Number(d.percent) > 0 ? `${(Number(d.percent) * 100).toFixed(0)}%` : '—',
          amount:  fmtMoney(d.total_amount || d.base_amount),
          trigger: d.trigger_event || '',
        })),
      };

      const contractRes = await fetch(PACKET_CONTRACT_GEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(renderPayload),
      });
      if (!contractRes.ok) {
        const errTxt = await contractRes.text();
        throw new Error(`Contract generation failed (${contractRes.status}): ${errTxt}`);
      }
      const contractData = await contractRes.json();
      if (!contractData.ok) throw new Error('Contract gen failed: ' + (contractData.error || 'unknown'));
      const contractPdfUrl = contractData.contract_pdf_url;
      const contractByteSize = contractData.byte_size || 0;

      // 4) Update packet row with generated contract URL
      const { error: contractUpdErr } = await sb.from('rebuild_contract_packets')
        .update({ contract_pdf_url: contractPdfUrl })
        .eq('id', packetRow.id);
      if (contractUpdErr) throw new Error('Packet contract URL update failed: ' + contractUpdErr.message);
      packetRow.contract_pdf_url = contractPdfUrl;

      // 5) Log generated contract in rebuild_documents (visibility in Documents tab)
      await sb.from('rebuild_documents').insert({
        project_id: state.activeProjectId,
        category: 'Contract',
        filename: `Contract_${p.albi_job_number || state.activeProjectId}_v${CONTRACT_TEMPLATE_VERSION}.pdf`,
        file_url: contractPdfUrl,
        file_size_bytes: contractByteSize,
        mime_type: 'application/pdf',
        uploaded_by_email: state.pmEmail || null,
        push_status: 'skipped',
        notes: `Auto-generated from template v${CONTRACT_TEMPLATE_VERSION}`,
      });

      // 6) Call /api/packet-merge — merges Contract + Xact into one PDF.
      //    NOTE: sov_pdf_url is intentionally omitted. The contract template
      //    already contains the SOV draw schedule inline (Section 9 + Exhibit A),
      //    so appending the standalone SOV PDF would duplicate the same content
      //    and confuse the customer. To re-enable, add `sov_pdf_url: sovPdfUrl`
      //    back to the body — the merge worker accepts it as optional.
      statusEl.textContent = 'Merging Xactimate + Contract into one PDF…';
      const mergeRes = await fetch(PACKET_MERGE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packet_id: packetRow.id,
          project_id: state.activeProjectId,
          xact_pdf_url: xactDoc.file_url,
          contract_pdf_url: contractPdfUrl,
          albi_job_number: p.albi_job_number || '',
        }),
      });
      if (!mergeRes.ok) {
        const errTxt = await mergeRes.text();
        throw new Error(`Merge failed (${mergeRes.status}): ${errTxt}`);
      }
      const mergeData = await mergeRes.json();
      if (!mergeData.ok) throw new Error('Merge failed: ' + (mergeData.error || 'unknown'));

      // 7) Update packet row with merged_pdf_url
      const { error: updErr } = await sb.from('rebuild_contract_packets').update({
        merged_pdf_url: mergeData.merged_pdf_url,
      }).eq('id', packetRow.id);
      if (updErr) throw new Error('Packet update failed: ' + updErr.message);

      overlay.remove();
      toast('✓ Packet created as draft. Review and send when ready.');
      await loadPacket();
      if (typeof loadDocuments === 'function') await loadDocuments();
      renderDetail();

    } catch (err) {
      console.error('[packet] create failed:', err);
      statusEl.textContent = 'Failed: ' + err.message;
      statusEl.style.color = 'var(--danger)';
      submitBtn.disabled = false;
    }
  });
}

// ─── ACTION: Send Packet ────────────────────────────────────────────────────
async function sendPacket(isResend) {
  const pkt = state.packet;
  const p = state.activeProject;
  if (!pkt) { toast('No packet to send'); return; }
  if (!isResend && pkt.status !== 'draft') { toast(`Cannot send a packet in status "${pkt.status}"`); return; }
  if (isResend && pkt.status !== 'sent') { toast('Resend only works on sent packets'); return; }
  if (!p.customer_email) { toast('No customer email on file'); return; }

  if (!isResend) {
    const ok = confirm(`Send contract packet to ${p.customer_email}?\n\nOnce sent, the SOV and draws will be locked. The customer has 90 days to sign.`);
    if (!ok) return;
  }

  toast(isResend ? 'Re-sending packet…' : 'Sending packet…');

  try {
    let activePkt = pkt;

    if (!isResend) {
      const callerEmail = (state.pmEmail || '').toLowerCase();
      if (!callerEmail) throw new Error('Not logged in — state.pmEmail is empty');
      const { data, error } = await sb.rpc('send_contract_packet', {
        p_packet_id: pkt.id,
        p_caller_email: callerEmail,
      });
      if (error) throw new Error('RPC send failed: ' + error.message);
      activePkt = Array.isArray(data) ? data[0] : data;
    }

    const signUrl = `${PACKET_PORTAL_BASE}?t=${activePkt.customer_token}`;
    const custFirst = (p.customer_name || '').split(' ')[0] || 'there';
    // Sender: logged-in PM. Falls back to a known admin if pmEmail not set
    // (shouldn't happen — sendPacket is only available to authorized users).
    const senderEmail = (state.pmEmail || 'josh@jg-restoration.com').toLowerCase();
    const senderDisplayName = p.albi_pm_name || state.pmName || 'JG Restoration';
    const subject = `${isResend ? 'Reminder: ' : ''}Contract Ready for Signature · ${p.albi_job_number || 'JG Restoration'}`;
    const emailBody = buildBrandedEmail({
      preheader: isResend ? 'Reminder: your JG Restoration contract is awaiting signature' : 'Your JG Restoration contract is ready for signature',
      headline: isResend ? 'Reminder: Contract Awaiting Signature' : 'Contract Ready for Signature',
      intro: 'Hi ' + custFirst + ',',
      bodyHtml: `<p>${isResend ? 'This is a friendly reminder that your' : 'Your'} JG Restoration contract packet is ready for your review and signature. The packet includes:</p>
        <ul style="margin:8px 0 14px 18px;padding:0;line-height:1.7;">
          <li>The signed contract terms</li>
          <li>The Schedule of Values (draw schedule)</li>
          <li>The Xactimate estimate detail</li>
        </ul>
        <p>The full packet PDF is attached to this email for your records. To review and sign, please click the button below.</p>`,
      ctaLabel: 'Review & Sign Packet',
      ctaUrl: signUrl,
      signoffName: senderDisplayName,
    });

    // Attempt to attach the merged contract packet PDF (best-effort).
    // If the PDF fetch fails for any reason, we still send the email with link only.
    let attachments;
    if (activePkt.merged_pdf_url) {
      try {
        const pdfBase64 = await fetchAsBase64(activePkt.merged_pdf_url);
        const filename = `Contract-Packet-${(p.albi_job_number || 'JG').replace(/[^a-zA-Z0-9._-]/g, '_')}.pdf`;
        attachments = [{
          filename,
          content_base64: pdfBase64,
          mime_type: 'application/pdf',
        }];
      } catch (attachErr) {
        console.warn('[packet] PDF attach failed, sending link-only:', attachErr);
      }
    }

    // Send via platform mailer (Cloudflare Worker → Gmail API).
    // Sender impersonation is via Google Workspace domain-wide delegation.
    const sendResult = await sendViaPlatformMailer({
      from: senderEmail,
      to: p.customer_email,
      subject,
      html: emailBody,
      text: `${isResend ? 'Reminder: your' : 'Your'} JG Restoration contract packet is ready for signature.\n\nReview and sign here: ${signUrl}\n\n— ${senderDisplayName}`,
      reply_to: senderEmail,
      attachments,
    });

    // Audit log — record the send to rebuild_messages.
    // Includes the Gmail message_id for downstream lookup/diligence.
    await sb.from('rebuild_messages').insert({
      project_id: p.id,
      direction: 'outbound',
      channel: 'email',
      status: 'sent',
      subject,
      body: emailBody,
      recipient_type: 'customer',
      recipient_name: p.customer_name || null,
      recipient_email: p.customer_email,
      sent_by_name: senderDisplayName,
      sent_by_email: senderEmail,
      gmail_message_id: sendResult.message_id || null,
    });

    toast(isResend ? '✓ Reminder email sent' : '✓ Packet sent to ' + p.customer_email);
    await loadPacket();
    await loadSov();
    renderDetail();
  } catch (err) {
    console.error('[packet] send failed:', err);
    toast('Send failed: ' + err.message);
  }
}

// ─── ACTION: Copy Customer Link ─────────────────────────────────────────────
function copyPacketLink() {
  const pkt = state.packet;
  if (!pkt || pkt.status !== 'sent' || !pkt.customer_token) { toast('No active packet link'); return; }
  const url = `${PACKET_PORTAL_BASE}?t=${pkt.customer_token}`;
  navigator.clipboard.writeText(url).then(
    () => toast('✓ Customer link copied'),
    () => toast('Copy failed — link: ' + url)
  );
}

// ─── ACTION: Void Packet ────────────────────────────────────────────────────
async function voidPacket() {
  const pkt = state.packet;
  if (!pkt) return;
  if (pkt.status !== 'sent') { toast(`Cannot void a packet in status "${pkt.status}"`); return; }
  const ok = confirm('Void this contract packet?\n\nThe customer link will stop working immediately. The SOV will unlock so you can re-issue a new packet.');
  if (!ok) return;

  toast('Voiding packet…');
  try {
    const { error } = await sb.rpc('void_contract_packet', { p_packet_id: pkt.id });
    if (error) throw new Error(error.message);
    toast('✓ Packet voided');
    await loadPacket();
    await loadSov();
    renderDetail();
  } catch (err) {
    console.error('[packet] void failed:', err);
    toast('Void failed: ' + err.message);
  }
}

// ─── ACTION: Discard Draft ──────────────────────────────────────────────────
async function discardDraftPacket() {
  const pkt = state.packet;
  if (!pkt || pkt.status !== 'draft') { toast('Only draft packets can be discarded'); return; }
  const ok = confirm('Discard this draft packet?\n\nThe merged PDF and packet record will be deleted. You can create a fresh one afterward.');
  if (!ok) return;

  try {
    const { error } = await sb.from('rebuild_contract_packets').delete().eq('id', pkt.id);
    if (error) throw new Error(error.message);
    toast('✓ Draft discarded');
    await loadPacket();
    renderDetail();
  } catch (err) {
    console.error('[packet] discard failed:', err);
    toast('Discard failed: ' + err.message);
  }
}

// ─── ACTION: Re-issue Packet ────────────────────────────────────────────────
async function reissuePacket() {
  const pkt = state.packet;
  if (!pkt) return;
  if (!['declined','expired','voided'].includes(pkt.status)) {
    toast(`Cannot re-issue from status "${pkt.status}"`); return;
  }
  state._packetReissueFrom = pkt.id;
  try {
    await createPacket();
  } finally {
    state._packetReissueFrom = null;
  }
}

// ─── Wire packet button events ──────────────────────────────────────────────
function wirePacketActions() {
  const createBtn = document.getElementById('packet_create_btn');
  if (createBtn) createBtn.addEventListener('click', createPacket);

  const sendBtn = document.getElementById('packet_send_btn');
  if (sendBtn) sendBtn.addEventListener('click', () => sendPacket(false));

  const resendBtn = document.getElementById('packet_resend_btn');
  if (resendBtn) resendBtn.addEventListener('click', () => sendPacket(true));

  const copyBtn = document.getElementById('packet_copy_link_btn');
  if (copyBtn) copyBtn.addEventListener('click', copyPacketLink);

  const voidBtn = document.getElementById('packet_void_btn');
  if (voidBtn) voidBtn.addEventListener('click', voidPacket);

  const discardBtn = document.getElementById('packet_discard_btn');
  if (discardBtn) discardBtn.addEventListener('click', discardDraftPacket);

  const reissueBtn = document.getElementById('packet_reissue_btn');
  if (reissueBtn) reissueBtn.addEventListener('click', reissuePacket);
}

// ────────────────────────────────────────────────────────────────────────────
// PACKET XACT UPLOAD (was in rebuild.html — Packet tab entry point)
// Extracted from WO Builder to make Xact upload the first step of the
// contract-first workflow. Only shown in Packet tab when gated (not signed).
// ────────────────────────────────────────────────────────────────────────────
function renderPacketXactUpload() {
  const budget = state.woBudget;
  
  // Parsing in progress
  if (state.woBudgetParsing) {
    const { stage, pct } = state.woBudgetProgress || { stage: '', pct: 0 };
    return `
      <div class="wobx-card">
        <div class="wobx-head">
          <h3>📄 Parsing Xactimate…</h3>
        </div>
        <div class="wobx-body">
          <div class="wobx-progress-bar"><div class="wobx-progress-fill" style="width:${pct}%;"></div></div>
          <div class="wobx-progress-label">${esc(stage)} (${pct}%)</div>
        </div>
      </div>
    `;
  }

  // No upload yet
  if (!budget || !budget.upload) {
    return `
      <div class="wobx-card wobx-empty">
        <div class="wobx-head">
          <h3>Step 1: Upload Xactimate Estimate</h3>
        </div>
        <div class="wobx-body">
          <p style="color:var(--muted);font-size:13px;margin:0 0 14px;">
            Upload the <b>Estimate PDF</b> and <b>Components PDF</b> from Xactimate.
            The platform will parse them, generate the Schedule of Values (50/50 split),
            and prepare the contract document for the customer to sign.
          </p>
          <div class="wobx-dropzone" id="wobx_dropzone">
            <input type="file" id="wobx_files" accept="application/pdf" multiple style="display:none;">
            <div class="wobx-dz-empty">
              <div class="wobx-dz-icon">📥</div>
              <div class="wobx-dz-title">Drop both PDFs here</div>
              <div class="wobx-dz-sub">or <span class="wobx-dz-link">click to browse</span> · need both Estimate + Components</div>
            </div>
            <div class="wobx-dz-files" id="wobx_dz_files"></div>
          </div>
          <div class="wobx-action-row">
            <button class="wobx-go-btn" id="wobx_generate" disabled>Parse & Generate SOV</button>
          </div>
        </div>
      </div>
    `;
  }

  // Parse failed
  if (budget.upload.parse_status === 'error') {
    return `
      <div class="wobx-card wobx-error">
        <div class="wobx-head">
          <h3>⚠️ Parse Failed</h3>
          <button class="wobx-action-btn" id="wobx_retry">Try Again</button>
        </div>
        <div class="wobx-body">
          <p style="color:var(--red);font-size:13px;margin:0;">
            <b>Error:</b> ${esc(budget.upload.parse_error || 'Unknown error')}
          </p>
        </div>
      </div>
    `;
  }

  // Parsed successfully — show summary + next steps
  if (budget.upload.parse_status === 'parsed') {
    return `
      <div class="wobx-card wobx-success">
        <div class="wobx-head">
          <h3>✓ Xactimate Parsed Successfully</h3>
        </div>
        <div class="wobx-body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;font-size:13px;">
            <div><span style="color:var(--muted);">File:</span> ${esc(budget.upload.filename)}</div>
            <div><span style="color:var(--muted);">Estimate Date:</span> ${budget.upload.date_estimated ? new Date(budget.upload.date_estimated).toLocaleDateString() : '—'}</div>
            <div><span style="color:var(--muted);">Line Items:</span> ${usdCompact(budget.upload.line_item_total || 0)}</div>
            <div><span style="color:var(--muted);">Contract Price (RCV):</span> <strong>${usdCompact(budget.upload.replacement_cost_value || 0)}</strong></div>
          </div>
          <p style="color:var(--muted);font-size:12px;margin:0;">
            The Schedule of Values has been auto-generated (50/50 split). Proceed to enter contract dates and exclusions below.
          </p>
        </div>
      </div>
    `;
  }

  return '';
}

// ────────────────────────────────────────────────────────────────────────────
// Expose to window so HTML onclick= attributes and other modules can call
// ────────────────────────────────────────────────────────────────────────────
window.loadPacket = loadPacket;
window.renderPacketSection = renderPacketSection;
window.wirePacketActions = wirePacketActions;
window.createPacket = createPacket;
window.sendPacket = sendPacket;
window.copyPacketLink = copyPacketLink;
window.voidPacket = voidPacket;
window.discardDraftPacket = discardDraftPacket;
window.reissuePacket = reissuePacket;
window.renderPacketXactUpload = renderPacketXactUpload;
window.PACKET_STATUS_META = PACKET_STATUS_META;
window.PACKET_DECLINE_REASON_LABELS = PACKET_DECLINE_REASON_LABELS;
