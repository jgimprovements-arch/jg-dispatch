// rebuild-co.js — Change Order Module
// Extracted from rebuild.html (2026-05-26).
//
// Functions (all exposed on window):
//   loadChangeOrders, renderCoSection, wireCoActions, openCoUploadModal,
//   processCoUpload, openCoPdfPreview, openCoEditModal, sendCoToCustomer
//
// Depends on globals from rebuild.html / rebuild-packet.js:
//   sb, state, toast, esc, usdCompact, $, renderDetail, renderTabContent,
//   loadSov, loadWoBudget, loadDocuments, logToAlbi, MERGED_TRADE_GROUPS,
//   buildBrandedEmail, sendViaPlatformMailer, fetchAsBase64

const CO_CONTRACT_GEN_ENDPOINT = 'https://jg-render-contract.josh-70f.workers.dev';
const CO_PORTAL_BASE = 'https://jgimprovements-arch.github.io/jg-dispatch/sign.html';

// ─── Load Change Orders ─────────────────────────────────────────────────────
async function loadChangeOrders() {
  if (!sb || !state.activeProjectId) { state.changeOrders = []; state.coLineItems = {}; return; }

  // Load CO headers
  const { data: cos } = await sb.from('rebuild_change_orders')
    .select('*')
    .eq('project_id', state.activeProjectId)
    .order('co_number');
  state.changeOrders = cos || [];

  // Load line items for all COs
  state.coLineItems = {};
  if (state.changeOrders.length) {
    const coIds = state.changeOrders.map(c => c.id);
    const { data: items } = await sb.from('rebuild_co_line_items')
      .select('*')
      .in('co_id', coIds);
    for (const item of (items || [])) {
      if (!state.coLineItems[item.co_id]) state.coLineItems[item.co_id] = [];
      state.coLineItems[item.co_id].push(item);
    }
  }
}

// ─── Render CO Section ──────────────────────────────────────────────────────
function renderCoSection() {
  const p = state.activeProject || {};
  const contractSigned = !!p.contract_signed_at;
  const cos = state.changeOrders || [];

  if (!contractSigned) {
    return `
      <div class="wobx-co-section" style="margin-top:16px;border-top:2px solid var(--line);padding-top:16px;">
        <div class="wobx-trades-title">
          <span style="color:var(--muted);">🔒 Change Orders</span>
          <button class="btn primary" id="markContractSignedBtn" style="font-size:12px;padding:5px 14px;">✓ Mark Contract Signed</button>
        </div>
        <div style="padding:14px 0;color:var(--muted);font-size:13px;">
          Change Orders are locked until the customer contract is signed.
        </div>
      </div>
    `;
  }

  // ── Slim CO summary ─────────────────────────────────────────────────────
  // Rebuild page shows ONE LINE per CO (number, title, status pill, delta,
  // View CO link). All authoring/sending/signing/deleting lives on the
  // dedicated Contract Packet page. The trade-row CO badges + $ delta are
  // surfaced separately by the WO Builder (renderCoScopeForTrade / KPI
  // roll-ups). Unmark Contract Signed stays here because it's contract-level.
  const coStatusMeta = {
    draft:             { lbl: 'Draft',              color: 'var(--muted)' },
    sent_to_customer:  { lbl: 'Awaiting Customer',  color: 'var(--gold)' },
    customer_signed:   { lbl: 'Customer Signed',    color: 'var(--orange)' },
    sent_to_sub:       { lbl: 'Awaiting Sub',       color: 'var(--gold)' },
    sub_signed:        { lbl: 'Sub Signed',         color: 'var(--orange)' },
    complete:          { lbl: 'Complete',            color: 'var(--green)' },
  };

  const cosHtml = cos.map(co => {
    const meta = coStatusMeta[co.status] || { lbl: co.status, color: 'var(--muted)' };
    return `
      <div class="wobx-co-card" data-co-id="${esc(co.id)}" style="padding:10px 14px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;">
            <span class="wobx-co-title" style="font-weight:600;">CO #${co.co_number}${co.description ? ' — ' + esc(co.description) : ''}</span>
            <span class="wobx-status-pill" style="background:${meta.color}20;color:${meta.color};border:1px solid ${meta.color}40;font-size:11px;padding:2px 8px;border-radius:20px;white-space:nowrap;">${meta.lbl}</span>
            <span style="color:var(--green);font-weight:700;white-space:nowrap;">+${usdCompact(co.amount_delta)}</span>
          </div>
          <button class="btn ghost" data-co-act="view-pdf" data-co-id="${esc(co.id)}" style="font-size:12px;padding:4px 10px;">📄 View CO</button>
        </div>
      </div>
    `;
  }).join('');

  const signedDate = new Date(p.contract_signed_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
  return `
    <div class="wobx-co-section">
      <div class="wobx-trades-title" style="margin-top:16px;border-top:2px solid var(--line);padding-top:16px;">
        <span>Change Orders <span style="font-size:11px;color:var(--green);font-weight:600;margin-left:8px;">✓ Contract signed ${signedDate}</span></span>
        <span style="display:flex;gap:8px;align-items:center;">
          <button class="btn ghost" id="markContractUnsignedBtn" style="font-size:11px;padding:4px 10px;color:var(--muted);">↩ Unmark</button>
        </span>
      </div>
      ${cos.length ? cosHtml : `<div style="padding:16px 0;color:var(--muted);font-size:13px;">No change orders yet. Manage change orders from the Contract Packet page.</div>`}
    </div>
  `;
}

// ─── Wire CO Actions ────────────────────────────────────────────────────────
// Called after renderTabContent to bind CO-specific buttons.
function wireCoActions() {
  // "+ Upload Change Order" button
  const newCoBtn = document.getElementById('wobx_new_co');
  if (newCoBtn) newCoBtn.addEventListener('click', () => openCoUploadModal());

  // CO card toggles
  document.querySelectorAll('.wobx-co-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const coId = btn.dataset.coId;
      const body = document.querySelector(`[data-co-body="${coId}"]`);
      if (!body) return;
      const hidden = body.style.display === 'none';
      body.style.display = hidden ? '' : 'none';
      btn.textContent = hidden ? '▾' : '▸';
    });
  });

  // CO action buttons
  document.querySelectorAll('[data-co-act]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const act = btn.dataset.coAct;
      const coId = btn.dataset.coId;
      const co = (state.changeOrders || []).find(c => c.id === coId);
      if (!co) return;

      if (act === 'delete') {
        if (!confirm(`Delete CO #${co.co_number}? This cannot be undone.`)) return;
        await sb.from('rebuild_change_orders').delete().eq('id', coId);
        await loadChangeOrders();
        toast('Change Order deleted');
        renderTabContent();

      } else if (act === 'send-customer') {
        await sendCoToCustomer(co);

      } else if (act === 'mark-customer-signed') {
        const name = prompt('Customer name (for record):') || 'Customer';
        const { error } = await sb.from('rebuild_change_orders')
          .update({ status: 'customer_signed', customer_signed_at: new Date().toISOString(), customer_signed_name: name })
          .eq('id', coId);
        if (error) { toast('Failed: ' + error.message); return; }
        // Feature flag — when CO bucket workflow is on, items stay
        // is_unassigned=true and the PM manually moves them from the
        // Change Orders bucket into specific WOs (forces re-sign).
        // When off, the legacy cascade fans items out to their guessed trades.
        const useBucket = (state.platformConfig?.feature_co_bucket_workflow === 'true');
        if (!useBucket) {
          await sb.from('rebuild_co_line_items')
            .update({ is_unassigned: false })
            .eq('co_id', coId);
        }
        await loadChangeOrders();
        await loadWoBudget();
        toast(useBucket
          ? `CO #${co.co_number} signed — items in Change Orders bucket, move to WO when ready`
          : `CO #${co.co_number} customer signature recorded — items now available in WO Builder`);
        renderTabContent();

      } else if (act === 'send-sub') {
        const { error } = await sb.from('rebuild_change_orders')
          .update({ status: 'sent_to_sub' })
          .eq('id', coId);
        if (error) { toast('Failed: ' + error.message); return; }
        if (typeof logToAlbi === 'function') logToAlbi('co_sent_to_sub', `CO #${co.co_number} sent to sub for signature`);
        toast(`CO #${co.co_number} marked as sent to sub`);
        await loadChangeOrders();
        renderTabContent();

      } else if (act === 'view-pdf') {
        if (typeof openCoPdfPreview === 'function') openCoPdfPreview(co);

      } else if (act === 'edit') {
        if (typeof openCoEditModal === 'function') openCoEditModal(co);
      }
    });
  });
}

// ─── Send CO to Customer (e-sign flow) ──────────────────────────────────────
// Mirrors the contract packet send flow:
//   1. Build CO amendment fields from project + CO data
//   2. Call render-contract worker with type='change_order'
//   3. Create signable rebuild_documents row with signature_token
//   4. Auto-create SOV draw for the CO amount
//   5. Send email with sign link
//   6. Update CO status to sent_to_customer
async function sendCoToCustomer(co) {
  const p = state.activeProject;
  if (!p) { toast('No active project'); return; }
  if (!p.customer_email) { toast('No customer email on file'); return; }
  if (co.status !== 'draft') { toast(`Cannot send CO in status "${co.status}"`); return; }

  const items = state.coLineItems[co.id] || [];
  if (!items.length) { toast('No line items on this CO — upload an estimate first'); return; }

  const ok = confirm(
    `Send CO #${co.co_number} to ${p.customer_email} for signature?\n\n` +
    `Amount: +${usdCompact(co.amount_delta)}\n` +
    `Items: ${items.length}\n\n` +
    `A new SOV draw will be created for this CO amount.`
  );
  if (!ok) return;

  toast('Generating CO amendment…');

  try {
    // ─── 1. Compute financial summary ───────────────────────────────────
    // Original total = the SOV contract_total (the signed contract price).
    // CO delta = amount_delta on the CO row (computed at upload time as
    //   new estimate total - original estimate total for diff mode, or
    //   sum of all items for standalone mode).
    // New total = original + delta.
    const sov = state.sov;
    const draws = state.sovDraws || [];
    const originalTotal = Number(sov?.contract_total) || draws.reduce((s, d) => s + (Number(d.base_amount) || 0), 0);
    const coDelta = Number(co.amount_delta) || 0;
    const newTotal = originalTotal + coDelta;

    const usd = (n) => Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    const fmtDate = (d) => new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    // Original contract date from the signed packet
    const contractDate = p.contract_signed_at ? fmtDate(p.contract_signed_at) : '___';

    // ─── 2. Build worker payload ────────────────────────────────────────
    const coFields = {
      co_title:                  `Change Order #${co.co_number} — ${co.description || 'Amendment'}`,
      co_project_ref:            p.albi_job_number || state.activeProjectId,
      co_date:                   fmtDate(new Date()),
      co_original_contract_date: contractDate,
      co_owner_name:             p.customer_name || '___',
      co_project_address:        p.property_address || [p.project_address, p.project_city, p.project_state, p.project_zip].filter(Boolean).join('  ') || '___',
      co_original_total:         usd(originalTotal),
      co_delta_amount:           (coDelta >= 0 ? '+' : '') + usd(coDelta),
      co_delta_label:            `CO #${co.co_number}`,
      co_new_total:              usd(newTotal),
    };

    const coItems = items.map(i => ({
      description:     i.description,
      trade_category:  i.trade_category || 'general',
      original_amount: Number(i.original_amount) || 0,
      new_amount:      Number(i.new_amount) || 0,
      is_new:          !!i.is_new,
    }));

    // ─── 3. Call render-contract worker ─────────────────────────────────
    const renderRes = await fetch(CO_CONTRACT_GEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'change_order',
        packet_id: co.id,      // reuse CO id as the "packet" id for storage path
        project_id: p.id,
        co_fields: coFields,
        co_items: coItems,
      }),
    });
    if (!renderRes.ok) {
      const errTxt = await renderRes.text();
      throw new Error('CO render failed (' + renderRes.status + '): ' + errTxt);
    }
    const renderData = await renderRes.json();
    if (!renderData.ok) throw new Error('CO render rejected: ' + (renderData.error || 'unknown'));
    const coPdfUrl = renderData.contract_pdf_url;

    // ─── 4. Create signable document ────────────────────────────────────
    const signatureToken = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'co-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);

    const { data: signDocRows, error: signDocErr } = await sb.from('rebuild_documents').insert({
      project_id: p.id,
      category: 'Customer Documents',
      kind: 'change_order',
      filename: `CO${co.co_number}_${p.albi_job_number || p.id}.pdf`,
      file_url: coPdfUrl,
      mime_type: 'application/pdf',
      uploaded_by_email: state.pmEmail || null,
      signature_status: 'pending',
      signature_token: signatureToken,
      customer_visible: true,
    }).select('id').single();
    if (signDocErr) throw new Error('Sign doc insert failed: ' + signDocErr.message);
    const signDocId = signDocRows.id;

    // Link the signable doc to the CO
    await sb.from('rebuild_change_orders').update({
      signed_document_id: signDocId,
      co_pdf_url: coPdfUrl,
      render_payload: {
        type: 'change_order',
        packet_id: co.id,
        project_id: p.id,
        co_fields: coFields,
        co_items: coItems,
      },
    }).eq('id', co.id);

    // ─── 5. Auto-create SOV draw for this CO ────────────────────────────
    if (sov) {
      const existingDraws = draws.length;
      const { error: drawErr } = await sb.from('rebuild_sov_draws').insert({
        sov_id: sov.id,
        draw_num: existingDraws + 1,
        trigger_event: `CO #${co.co_number}: ${co.description || 'Change Order'}`,
        percent: 0, // CO draws are flat amounts, not percentages
        base_amount: coDelta,
        status: 'pending',
        co_id: co.id,
      });
      if (drawErr) console.error('[co] SOV draw insert failed:', drawErr);
      // Update SOV contract_total
      await sb.from('rebuild_sov').update({
        contract_total: newTotal,
      }).eq('id', sov.id);
    }

    // ─── 6. Update CO status ────────────────────────────────────────────
    await sb.from('rebuild_change_orders').update({
      status: 'sent_to_customer',
      sent_to_customer_at: new Date().toISOString(),
    }).eq('id', co.id);

    // ─── 7. Send email ──────────────────────────────────────────────────
    const signUrl = `${CO_PORTAL_BASE}?t=${signatureToken}`;
    const custFirst = (p.customer_name || '').split(' ')[0] || 'there';
    const senderEmail = (state.pmEmail || 'josh@jg-restoration.com').toLowerCase();
    const senderDisplayName = p.albi_pm_name || state.pmName || 'JG Restoration';

    const subject = `Change Order #${co.co_number} Ready for Signature · ${p.albi_job_number || 'JG Restoration'}`;
    const emailBody = buildBrandedEmail({
      preheader: `Change Order #${co.co_number} is ready for your review and signature`,
      headline: `Change Order #${co.co_number} — Review & Sign`,
      intro: 'Hi ' + custFirst + ',',
      bodyHtml: `<p>A change order has been prepared for your project. This amendment adjusts the scope of work and contract price as follows:</p>
        <table style="width:100%;border-collapse:collapse;margin:12px 0;">
          <tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">Original Contract</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${coFields.co_original_total}</td></tr>
          <tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">This Change Order</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right;color:#16A34A;font-weight:700;">${coFields.co_delta_amount}</td></tr>
          <tr><td style="padding:6px 12px;font-weight:700;">New Contract Price</td><td style="padding:6px 12px;text-align:right;font-weight:700;">${coFields.co_new_total}</td></tr>
        </table>
        <p>Please review the full change order and sign by clicking the button below.</p>`,
      ctaLabel: 'Review & Sign Change Order',
      ctaUrl: signUrl,
      signoffName: senderDisplayName,
    });

    // Attach the CO PDF (best-effort)
    let attachments;
    try {
      const pdfBase64 = await fetchAsBase64(coPdfUrl);
      attachments = [{
        filename: `CO${co.co_number}-${(p.albi_job_number || 'JG').replace(/[^a-zA-Z0-9._-]/g, '_')}.pdf`,
        content_base64: pdfBase64,
        mime_type: 'application/pdf',
      }];
    } catch (attachErr) {
      console.warn('[co] PDF attach failed, sending link-only:', attachErr);
    }

    await sendViaPlatformMailer({
      from: senderEmail,
      to: p.customer_email,
      subject,
      html: emailBody,
      text: `Change Order #${co.co_number} is ready for signature.\n\nOriginal: ${coFields.co_original_total}\nCO Delta: ${coFields.co_delta_amount}\nNew Total: ${coFields.co_new_total}\n\nReview and sign here: ${signUrl}\n\n— ${senderDisplayName}`,
      reply_to: senderEmail,
      attachments,
    });

    // Audit log
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
    });

    toast(`✓ CO #${co.co_number} sent to ${p.customer_email} for signature`);
    await loadChangeOrders();
    await loadSov();
    if (typeof loadDocuments === 'function') await loadDocuments();
    renderDetail();

  } catch (err) {
    console.error('[co] send failed:', err);
    toast('CO send failed: ' + err.message);
  }
}

// ─── CO Upload Modal ────────────────────────────────────────────────────────
function openCoUploadModal() {
  const budget = state.woBudget;
  if (!budget) { toast('Upload a base estimate first before creating a Change Order'); return; }
  const coNum = (state.changeOrders || []).length + 1;
  document.querySelectorAll('.co-upload-modal-back').forEach(m => m.remove());
  const back = document.createElement('div');
  back.className = 'co-upload-modal-back';
  back.style.cssText = 'position:fixed;inset:0;background:rgba(13,45,94,.6);z-index:9998;display:flex;align-items:center;justify-content:center;';
  const defaultTitle = `CO #${coNum} — ${new Date().toLocaleDateString('en-US',{month:'short',year:'numeric'})}`;
  back.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:24px;max-width:560px;width:92%;box-shadow:0 20px 60px rgba(0,0,0,.3);">
      <div style="font-weight:700;font-size:16px;color:var(--navy);margin-bottom:4px;">Upload Change Order #${coNum}</div>
      <div style="font-size:13px;color:var(--muted);margin-bottom:16px;">Upload both the new Estimate PDF and Components PDF from Xactimate. New or changed line items become the CO additions.</div>
      <label style="font-size:12px;font-weight:600;color:var(--navy);">CO Title</label>
      <input id="co_title_input" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:6px;font-size:13px;margin:4px 0 12px;box-sizing:border-box;" value="${defaultTitle}">
      <label style="font-size:12px;font-weight:600;color:var(--navy);">Estimate Type</label>
      <div style="display:flex;gap:8px;margin:6px 0 14px;" id="co_est_type_btns">
        <button type="button" class="btn" id="co_type_standalone" style="font-size:11px;padding:6px 12px;border:2px solid var(--orange);background:rgba(232,116,60,.08);color:var(--navy);font-weight:600;">Standalone CO estimate</button>
        <button type="button" class="btn" id="co_type_diff" style="font-size:11px;padding:6px 12px;border:2px solid var(--line);background:transparent;color:var(--muted);">Updated full estimate (diff)</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
        <div>
          <label style="font-size:12px;font-weight:600;color:var(--navy);">Estimate PDF</label>
          <div id="co_est_drop" style="border:2px dashed var(--line);border-radius:8px;padding:16px;text-align:center;cursor:pointer;color:var(--muted);font-size:12px;margin-top:4px;min-height:60px;display:flex;align-items:center;justify-content:center;">
            Drop or click<input type="file" id="co_est_input" accept=".pdf" style="display:none">
          </div>
        </div>
        <div>
          <label style="font-size:12px;font-weight:600;color:var(--navy);">Components PDF</label>
          <div id="co_comp_drop" style="border:2px dashed var(--line);border-radius:8px;padding:16px;text-align:center;cursor:pointer;color:var(--muted);font-size:12px;margin-top:4px;min-height:60px;display:flex;align-items:center;justify-content:center;">
            Drop or click<input type="file" id="co_comp_input" accept=".pdf" style="display:none">
          </div>
        </div>
      </div>
      <div id="co_parse_status" style="font-size:12px;color:var(--muted);margin-bottom:12px;min-height:18px;"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn" id="co_cancel_btn">Cancel</button>
        <button class="btn primary" id="co_process_btn" disabled>Process & Diff</button>
      </div>
    </div>
  `;
  document.body.appendChild(back);
  let estFile = null, compFile = null;
  let selectedEstType = 'standalone';
  const processBtn = back.querySelector('#co_process_btn');
  const statusEl = back.querySelector('#co_parse_status');

  // Wire estimate type toggle
  const standaloneBtn = back.querySelector('#co_type_standalone');
  const diffBtn = back.querySelector('#co_type_diff');
  function setEstType(type) {
    selectedEstType = type;
    if (type === 'standalone') {
      standaloneBtn.style.borderColor = 'var(--orange)';
      standaloneBtn.style.background = 'rgba(232,116,60,.08)';
      standaloneBtn.style.color = 'var(--navy)';
      standaloneBtn.style.fontWeight = '600';
      diffBtn.style.borderColor = 'var(--line)';
      diffBtn.style.background = 'transparent';
      diffBtn.style.color = 'var(--muted)';
      diffBtn.style.fontWeight = '400';
    } else {
      diffBtn.style.borderColor = 'var(--orange)';
      diffBtn.style.background = 'rgba(232,116,60,.08)';
      diffBtn.style.color = 'var(--navy)';
      diffBtn.style.fontWeight = '600';
      standaloneBtn.style.borderColor = 'var(--line)';
      standaloneBtn.style.background = 'transparent';
      standaloneBtn.style.color = 'var(--muted)';
      standaloneBtn.style.fontWeight = '400';
    }
  }
  standaloneBtn.addEventListener('click', () => setEstType('standalone'));
  diffBtn.addEventListener('click', () => setEstType('full_re_estimate'));

  function wireSlot(dropId, inputId, onFile) {
    const drop = back.querySelector('#' + dropId);
    const input = back.querySelector('#' + inputId);
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.style.borderColor = 'var(--orange)'; });
    drop.addEventListener('dragleave', () => { drop.style.borderColor = 'var(--line)'; });
    drop.addEventListener('drop', e => { e.preventDefault(); drop.style.borderColor = 'var(--line)'; if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0], drop); });
    input.addEventListener('change', () => { if (input.files[0]) onFile(input.files[0], drop); });
  }
  function markFile(file, drop) {
    drop.innerHTML = `<span style="color:var(--navy);font-size:11px;">✓ ${file.name}</span>`;
  }
  wireSlot('co_est_drop', 'co_est_input', (f, drop) => { estFile = f; markFile(f, drop); checkReady(); });
  wireSlot('co_comp_drop', 'co_comp_input', (f, drop) => { compFile = f; markFile(f, drop); checkReady(); });
  function checkReady() { processBtn.disabled = !(estFile && compFile); }

  back.querySelector('#co_cancel_btn').addEventListener('click', () => back.remove());
  back.addEventListener('click', e => { if (e.target === back) back.remove(); });
  processBtn.addEventListener('click', async () => {
    if (!estFile || !compFile) return;
    processBtn.disabled = true;
    processBtn.textContent = 'Processing...';
    statusEl.style.color = 'var(--muted)';
    try {
      const title = back.querySelector('#co_title_input').value.trim() || defaultTitle;
      await processCoUpload(estFile, compFile, coNum, title, budget, statusEl, selectedEstType);
      back.remove();
      await loadChangeOrders();
      await loadWoBudget();
      renderTabContent();
      toast(`CO #${coNum} created — review the change items below`);
    } catch (err) {
      statusEl.style.color = 'var(--red)';
      statusEl.textContent = 'Error: ' + err.message;
      processBtn.disabled = false;
      processBtn.textContent = 'Process & Diff';
    }
  });
}

// ─── Process CO Upload (parse + diff) ───────────────────────────────────────
async function processCoUpload(estimateFile, componentsFile, coNum, title, budget, statusEl, estType) {
  statusEl.textContent = 'Parsing estimate + components PDFs...';
  let newItems = [];
  try {
    const mod = await import('./wo-builder-parser.js');
    const result = await mod.parseAndStoreXactPDFs(sb, state.activeProjectId, estimateFile, componentsFile, {
      onProgress: (stage, pct) => { statusEl.textContent = `${stage} (${pct}%)`; },
      uploadedByEmail: state.pmEmail,
      uploadedByName: state.pmName,
      dryRun: true,
    });
    newItems = result?.items || result?.lineItems || [];
  } catch (parseErr) {
    console.error('Xact PDF parse failed:', parseErr);
    throw new Error('Estimate parsing failed: ' + (parseErr.message || parseErr));
  }

  if (!newItems.length) throw new Error('No line items found. Check the files are Xact PDFs.');

  let coItems = [];
  let totalDelta = 0;

  if (estType === 'standalone') {
    // ─── Standalone CO estimate: every item IS the CO scope ─────────────
    statusEl.textContent = `Found ${newItems.length} items. Processing as standalone CO...`;
    newItems.forEach(item => {
      const amt = Number(item.line_total || item.total || item.amount || 0);
      coItems.push({
        description: item.description || '',
        qty: item.qty || null,
        unit: item.unit || null,
        original_amount: 0,
        new_amount: amt,
        trade_category: item.trade_category || item.category || 'general',
        is_new: true,
        is_unassigned: true,
      });
      totalDelta += amt;
    });
  } else {
    // ─── Full re-estimate: the CO estimate REPLACES the original ────────
    // Delta = new estimate total - original estimate total (simple subtraction).
    // ALL items from the new estimate are shown (not just changed ones),
    // with original amounts populated where descriptions match. Items that
    // existed in the original but are absent from the CO are shown as removed.
    statusEl.textContent = `Found ${newItems.length} items. Comparing against original...`;

    const origTotal = (budget.items || []).reduce((s, i) => s + (Number(i.line_total || i.total || i.amount || 0)), 0);
    const newTotal = newItems.reduce((s, i) => s + (Number(i.line_total || i.total || i.amount || 0)), 0);
    totalDelta = newTotal - origTotal;

    // Build lookup of original items for matching (display purposes only —
    // totalDelta is already computed from the gross totals above).
    const origLookup = {};
    (budget.items || []).forEach(item => {
      const key = (item.description || '').trim().toLowerCase();
      if (!origLookup[key]) origLookup[key] = [];
      origLookup[key].push(item);
    });
    const origConsumed = {};

    // Items in the new estimate
    newItems.forEach(item => {
      const key = (item.description || '').trim().toLowerCase();
      const newAmt = Number(item.line_total || item.total || item.amount || 0);
      const origList = origLookup[key] || [];
      const consumedCount = origConsumed[key] || 0;
      const orig = origList[consumedCount] || null;

      if (orig) {
        origConsumed[key] = consumedCount + 1;
        const origAmt = Number(orig.line_total || orig.total || orig.amount || 0);
        const delta = newAmt - origAmt;
        // Only show items that changed or are new — skip unchanged items
        if (Math.abs(delta) > 0.01) {
          coItems.push({
            description: item.description || '',
            qty: item.qty || null,
            unit: item.unit || null,
            original_amount: origAmt,
            new_amount: newAmt,
            trade_category: item.trade_category || item.category || orig.trade_category || 'general',
            is_new: false,
            is_unassigned: true,
          });
        }
      } else {
        coItems.push({
          description: item.description || '',
          qty: item.qty || null,
          unit: item.unit || null,
          original_amount: 0,
          new_amount: newAmt,
          trade_category: item.trade_category || item.category || 'general',
          is_new: true,
          is_unassigned: true,
        });
      }
    });
  }

  if (!coItems.length && Math.abs(totalDelta) < 0.01) throw new Error(estType === 'standalone'
    ? 'No line items found in the estimate.'
    : 'No differences found. The new estimate appears identical to the original.');

  statusEl.textContent = `${coItems.length} CO items (+${usdCompact(totalDelta)}). Saving...`;

  const { data: coData, error: coErr } = await sb.from('rebuild_change_orders').insert({
    project_id: state.activeProjectId,
    co_number: coNum,
    description: title,
    status: 'draft',
    amount_delta: totalDelta,
    created_by: state.pmEmail,
  }).select().single();
  if (coErr) throw new Error('Failed to create CO: ' + coErr.message);

  const { error: itemErr } = await sb.from('rebuild_co_line_items').insert(coItems.map(i => ({
    co_id: coData.id,
    description: i.description || '',
    category: i.trade_category || 'general',
    qty: i.qty || null,
    unit: i.unit || null,
    original_amount: Number(i.original_amount) || 0,
    new_amount: Number(i.new_amount) || 0,
    trade_category: i.trade_category || 'general',
    is_new: !!i.is_new,
    is_unassigned: true,
  })));
  if (itemErr) throw new Error('Failed to save CO items: ' + itemErr.message);

  statusEl.textContent = 'Done!';
}

// ─── CO PDF Preview ─────────────────────────────────────────────────────────
function openCoPdfPreview(co) {
  // If we have a rendered CO PDF URL, open it directly
  if (co.co_pdf_url) {
    window.open(co.co_pdf_url, '_blank');
    return;
  }
  // Fallback: generate a simple HTML preview (legacy behavior)
  const items = state.coLineItems[co.id] || [];
  const p = state.activeProject || {};
  const w = 800;
  const win = window.open('', '_blank', `width=${w},height=900`);
  if (!win) { toast('Popup blocked — allow popups for this site'); return; }
  const rows = items.map(i => {
    const delta = (Number(i.new_amount)||0) - (Number(i.original_amount)||0);
    return `<tr>
      <td>${i.description || ''}${i.is_new ? ' <span style="color:#16A34A;font-weight:700;font-size:11px;">NEW</span>' : ''}</td>
      <td style="text-align:right">${i.is_new ? '—' : '$' + (Number(i.original_amount)||0).toLocaleString()}</td>
      <td style="text-align:right">$${(Number(i.new_amount)||0).toLocaleString()}</td>
      <td style="text-align:right;color:${delta>=0?'#16A34A':'#DC2626'};font-weight:700">${delta>=0?'+':''}$${delta.toLocaleString()}</td>
    </tr>`;
  }).join('');
  win.document.write(`<html><head><title>CO #${co.co_number}</title><style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse}th,td{padding:6px 10px;border-bottom:1px solid #ddd;font-size:13px}th{text-align:left;background:#f5f5f5}</style></head><body>
    <h2>CO #${co.co_number} — ${co.description || 'Change Order'}</h2>
    <p>${p.albi_job_number || ''} · Delta: <b>+$${(Number(co.amount_delta)||0).toLocaleString()}</b></p>
    <table><thead><tr><th>Description</th><th style="text-align:right">Original</th><th style="text-align:right">New</th><th style="text-align:right">Delta</th></tr></thead><tbody>${rows}</tbody></table>
  </body></html>`);
  win.document.close();
}

// ─── CO Edit Modal ──────────────────────────────────────────────────────────
function openCoEditModal(co) {
  const newTitle = prompt('Edit CO title:', co.description || '');
  if (newTitle === null) return;
  sb.from('rebuild_change_orders').update({ title: newTitle.trim() }).eq('id', co.id).then(async () => {
    await loadChangeOrders();
    renderTabContent();
    toast('CO title updated');
  });
}

// ─── CO → WO Integration helpers ────────────────────────────────────────────
// Returns CO line items grouped by trade_category, filtered to COs that have
// been customer-signed or later. Only items with is_unassigned=false are
// included (unsigned CO items stay locked until sign.html cascades the flip).
//
// Shape: { tradeKey: [ { ...item, co_number, co_id, co_status, co_description }, ... ] }
//
// IMPORTANT: trade_category on a CO line item uses the RAW category (e.g.
// "drywall"), not the merged group key. Callers that need to match against
// the trade rollup must pass each item's trade_category through mergedGroupFor().
function getActiveCoItemsByTrade() {
  const out = {};
  const cos = state.changeOrders || [];
  const ACTIVE_STATUSES = new Set(['customer_signed', 'sent_to_sub', 'sub_signed', 'complete']);

  cos.forEach(co => {
    if (!ACTIVE_STATUSES.has(co.status)) return;
    const items = state.coLineItems[co.id] || [];
    items.forEach(item => {
      // Once is_unassigned flips false, the item is "active" in the WO Builder.
      // Items where is_unassigned=true mean the CO is signed but the cascade
      // hasn't run yet — defensive skip.
      if (item.is_unassigned) return;
      const trade = item.trade_category || 'general';
      if (!out[trade]) out[trade] = [];
      out[trade].push({
        ...item,
        co_number: co.co_number,
        co_id: co.id,
        co_status: co.status,
        co_description: co.description || co.title || '',
      });
    });
  });

  return out;
}

// Returns ALL active CO line items still waiting in the "Change Orders"
// bucket — i.e. is_unassigned=true on a customer-signed-or-later CO, and
// not yet converted to a WO. These are the items the PM needs to manually
// assign to a Work Order via the new bucket modal.
// Returns a flat array (not grouped by trade) since the bucket is one list.
function getUnassignedCoItems() {
  const out = [];
  const cos = state.changeOrders || [];
  const ACTIVE_STATUSES = new Set(['customer_signed', 'sent_to_sub', 'sub_signed', 'complete']);

  cos.forEach(co => {
    if (!ACTIVE_STATUSES.has(co.status)) return;
    const items = state.coLineItems[co.id] || [];
    items.forEach(item => {
      if (!item.is_unassigned) return;          // already moved out of bucket
      if (item.converted_to_wo_id) return;      // already in a WO
      out.push({
        ...item,
        co_number: co.co_number,
        co_id: co.id,
        co_status: co.status,
        co_description: co.description || co.title || '',
      });
    });
  });

  // Sort by CO# then description for stable display
  out.sort((a, b) => (a.co_number - b.co_number) || (a.description || '').localeCompare(b.description || ''));
  return out;
}

// Returns the dollar delta for a given merged trade key from all active COs.
// Uses delta_amount (the generated column on rebuild_co_line_items).
function getCoDeltaForMergedTrade(mergedTradeKey) {
  const byTrade = getActiveCoItemsByTrade();
  let total = 0;
  for (const [rawCat, items] of Object.entries(byTrade)) {
    const mergedKey = (typeof mergedGroupFor === 'function')
      ? mergedGroupFor(rawCat || 'general')
      : rawCat;
    if (mergedKey !== mergedTradeKey) continue;
    items.forEach(i => { total += Number(i.delta_amount) || 0; });
  }
  return total;
}

// Returns all active CO items for a given merged trade key (for the WO Detail modal).
function getCoItemsForMergedTrade(mergedTradeKey) {
  const byTrade = getActiveCoItemsByTrade();
  const out = [];
  for (const [rawCat, items] of Object.entries(byTrade)) {
    const mergedKey = (typeof mergedGroupFor === 'function')
      ? mergedGroupFor(rawCat || 'general')
      : rawCat;
    if (mergedKey !== mergedTradeKey) continue;
    out.push(...items);
  }
  // Sort by CO# then by description
  out.sort((a, b) => (a.co_number - b.co_number) || (a.description || '').localeCompare(b.description || ''));
  return out;
}

// ─── Window exports ─────────────────────────────────────────────────────────
window.loadChangeOrders = loadChangeOrders;
window.renderCoSection = renderCoSection;
window.wireCoActions = wireCoActions;
window.openCoUploadModal = openCoUploadModal;
window.processCoUpload = processCoUpload;
window.openCoPdfPreview = openCoPdfPreview;
window.openCoEditModal = openCoEditModal;
window.sendCoToCustomer = sendCoToCustomer;
window.getActiveCoItemsByTrade = getActiveCoItemsByTrade;
window.getCoDeltaForMergedTrade = getCoDeltaForMergedTrade;
window.getCoItemsForMergedTrade = getCoItemsForMergedTrade;
window.getUnassignedCoItems = getUnassignedCoItems;
