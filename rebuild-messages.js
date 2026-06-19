// ════════════════════════════════════════════════════════════════════════════
// MESSAGES MODULE (extracted from rebuild.html 2026-05-24)
// ════════════════════════════════════════════════════════════════════════════
// Project-level threaded messaging (rebuild_messages table) with subs, employees,
// and customer recipients. Supports attachments, @mentions, and Albi event logging.
//
// Functions (all exposed on window for HTML onclick handlers):
//   loadMessages, renderMessagesTab, renderMessageRow, sendMessage
//
// Dependencies (must be in scope when this script loads):
//   - sb (Supabase client), state, toast, esc, renderDetail
//   - From rebuild.html: buildBrandedEmail, fmtDateTime, fmtPhone, titleCase,
//     toE164, logToAlbi, renderJournalTab (Journal sub-tab still in rebuild.html)
//   - @mention helpers stay in rebuild.html since Journal also uses them:
//     getMentionablePeople, wireMentionAutocomplete, parseMentionsFromBody
//
// Loaded AFTER rebuild-utils.js (toast, esc, usd, etc.)
// ════════════════════════════════════════════════════════════════════════════

// Document-upload notifications get generated server-side by Zapier when a
// PM uploads photos/docs (the body always begins "Document uploaded from
// JG Platform under category: …"). They exist in rebuild_messages because
// they're real outbound emails, but they're noise in the conversation
// thread — hide from the Messages view. Documents tab still shows them
// via rebuild_documents, which is the right home for them.
const _isDocAutoMessage = m => !!(m && m.body && /^Document uploaded from JG Platform/.test(m.body));

async function loadMessages() {
  if (!sb) { state.messages = []; return; }
  const { data } = await sb.from('rebuild_messages')
    .select('*, recipient_sub:rebuild_subs(id, company_name, primary_contact), attachments:rebuild_message_attachments(id, file_name, file_size, mime_type, public_url)')
    .eq('project_id', state.activeProjectId)
    .order('created_at', { ascending: false }).limit(200);
  state.messages = (data || []).filter(m => !_isDocAutoMessage(m));
}

function renderMessagesTab() {
  const p = state.activeProject;
  const msgs = state.messages;

  // Sub-tab state: 'messages' (default) or 'journal'
  if (!state.messagesSubtab) state.messagesSubtab = 'messages';
  const subtab = state.messagesSubtab;

  // Build the sub-tab bar — same row as the existing tabs but visually tighter
  const journalCount = (state.journalEntries || []).filter(e => !e.deleted_at).length;
  const msgCount = (state.messages || []).length;
  const subtabBar = `
    <div class="msg-subtab-bar">
      <button class="msg-subtab ${subtab==='messages'?'on':''}" data-msg-subtab="messages">
        💬 Messages ${msgCount ? `<span class="msg-subtab-count">${msgCount}</span>` : ''}
      </button>
      <button class="msg-subtab ${subtab==='journal'?'on':''}" data-msg-subtab="journal">
        📓 Journal ${journalCount ? `<span class="msg-subtab-count">${journalCount}</span>` : ''}
      </button>
      <div style="flex:1;"></div>
      <span style="font-size:11px;color:var(--muted);font-weight:600;">All entries log to Albi project timeline</span>
    </div>
  `;

  // If journal sub-tab is active, return journal content with the bar on top
  if (subtab === 'journal') {
    const journalHtml = renderJournalTab();
    return subtabBar + journalHtml;
  }

  // Otherwise render normal Messages tab content (with subtab bar on top)
  // Build sub options for the To dropdown — pull from assigned-on-this-project first, then full roster
  const assignedSubIds = new Set();
  state.phases.forEach(ph => (ph.assignees || []).forEach(a => {
    if (a.assignee_type === 'sub' && a.sub_id) assignedSubIds.add(a.sub_id);
  }));
  const assignedSubs = state.subs.filter(s => assignedSubIds.has(s.id));
  const otherSubs = state.subs.filter(s => !assignedSubIds.has(s.id));

  const subOptions = [
    ...(assignedSubs.length ? [`<optgroup label="On this project">`,
      ...assignedSubs.map(s => `<option value="sub:${s.id}">${s.company_name}${s.primary_contact ? ' · ' + s.primary_contact : ''}</option>`),
      `</optgroup>`] : []),
    `<optgroup label="All subs">`,
    ...otherSubs.map(s => `<option value="sub:${s.id}">${s.company_name}${s.primary_contact ? ' · ' + s.primary_contact : ''}</option>`),
    `</optgroup>`,
  ].join('');

  // Build staff sender options — PM first, then all employees
  state.staffSenders = [];
  const pmName = p.albi_pm || 'Project Manager';
  const pmEmail = p.albi_pm_email || state.pmEmail || 'info@jg-restoration.com';
  const pmPhone = p.albi_pm_phone || '';
  state.staffSenders.push({ name: pmName, email: pmEmail, phone: pmPhone, role: 'Project Manager', isDefault: true });
  // Add all active staff not already in the list
  const seenEmails = new Set([pmEmail.toLowerCase()]);
  (state.allStaff || []).forEach(e => {
    if (e.email && !seenEmails.has(e.email.toLowerCase())) {
      state.staffSenders.push({ name: e.name, email: e.email, phone: e.phone || '', role: e.role || 'Team Member' });
      seenEmails.add(e.email.toLowerCase());
    }
  });
  // Also add JG staff from relationships who aren't employees (e.g. office staff with @jg-restoration.com emails)
  (state.relationships || []).forEach(r => {
    if (r.email && r.email.includes('jg-restoration.com') && !seenEmails.has(r.email.toLowerCase())) {
      const roleLabel = (r.role || '').replace(/_/g, ' ').replace(/\bjg\b/gi, '').trim();
      state.staffSenders.push({ name: r.display_name, email: r.email, phone: r.phone || '', role: roleLabel || 'Team Member' });
      seenEmails.add(r.email.toLowerCase());
    }
  });
  const fromOptions = state.staffSenders.map((s, i) =>
    `<option value="${i}" ${s.isDefault ? 'selected' : ''}>${esc(s.name)}${s.email ? ' · ' + esc(s.email) : ''}</option>`
  ).join('');

  return subtabBar + `
    <div class="msg-wrap">
      <div class="msg-composer">
        <div class="msg-composer-head">
          <div class="row">
            <div>
              <label>To</label>
              <select id="msg_to">
                ${p.customer_name ? `<option value="customer">👤 Customer · ${p.customer_name}</option>` : ''}
                ${subOptions}
                <option value="internal">📝 Internal note (no send)</option>
              </select>
            </div>
            <div>
              <label>Channel</label>
              <select id="msg_channel">
                <option value="sms">📱 SMS</option>
                <option value="email">✉ Email</option>
              </select>
            </div>
            <div>
              <label>From</label>
              <select id="msg_from">
                ${fromOptions}
              </select>
            </div>
          </div>
          <div id="msg_subject_wrap" style="display:none;">
            <label>Subject</label>
            <input id="msg_subject" placeholder="Re: ${p.albi_job_number || 'project'}">
          </div>
          <div id="msg_cc_wrap" style="display:none;">
            <label>CC <span style="color:var(--muted);font-weight:400;">(optional · comma-separate multiple)</span></label>
            <input id="msg_cc" placeholder="adjuster@example.com, manager@example.com">
          </div>
        </div>
        <textarea id="msg_body" placeholder="Type your message…" rows="10"></textarea>
        <div id="msg_attachments_wrap" style="display:none;margin-top:8px;">
          <div id="msg_attachments_list" class="msg-att-list"></div>
          <input type="file" id="msg_file_input" multiple style="display:none;">
        </div>
        <div class="msg-composer-foot">
          <div style="display:flex;align-items:center;gap:10px;">
            <button class="btn" id="msg_attach_btn" type="button" style="display:none;">📎 Attach files</button>
            <button class="btn" id="msg_from_docs_btn" type="button">📁 From Documents</button>
            <span id="msg_send_info" style="font-size:11px;color:var(--muted);"></span>
          </div>
          <button class="btn primary" id="msg_send_btn">Send</button>
        </div>
      </div>

      <div class="msg-list">
        ${msgs.length === 0 ? `<div class="empty" style="padding:20px;color:var(--muted);font-size:12px;">No messages yet on this project.</div>` : msgs.map(m => renderMessageRow(m)).join('')}
      </div>
    </div>
  `;
}

function renderMessageRow(m) {
  const who = m.recipient_type === 'customer'
    ? `👤 ${m.recipient_name || 'Customer'}`
    : m.recipient_type === 'sub'
      ? `🛠 ${m.recipient_sub?.company_name || m.recipient_name || 'Sub'}`
      : `📝 Internal Note`;
  const channelIcon = m.channel === 'sms' ? '📱' : (m.channel === 'email' ? '✉' : '📝');
  const dirIcon = m.direction === 'inbound' ? '⇠' : '⇢';
  const sender = m.sent_by_name || m.sent_by_email || 'platform';
  const statusBadge = m.status === 'failed'
    ? `<span class="msg-status-bad">Failed</span>`
    : m.status === 'received'
      ? `<span class="msg-status-rx">Received</span>`
      : '';
  const attachments = m.attachments || [];
  // Twilio MMS media URLs may land on the message row instead of rebuild_message_attachments.
  // Pick them up from media_urls or attachment_urls JSON/array columns if present.
  const fallbackUrls = [];
  ['media_urls','attachment_urls','sms_media_urls','media'].forEach(field => {
    const val = m[field];
    if (!val) return;
    if (Array.isArray(val)) val.forEach(u => u && fallbackUrls.push(typeof u === 'string' ? u : (u.url || u.public_url)));
    else if (typeof val === 'string') {
      // Could be a JSON array or a comma-separated list
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) parsed.forEach(u => u && fallbackUrls.push(typeof u === 'string' ? u : (u.url || u.public_url)));
        else if (parsed) fallbackUrls.push(parsed);
      } catch {
        val.split(',').forEach(u => { const trimmed = u.trim(); if (trimmed) fallbackUrls.push(trimmed); });
      }
    }
  });
  // Don't double-count anything already in attachments
  const existingUrls = new Set(attachments.map(a => a.public_url));
  const extras = fallbackUrls.filter(u => u && !existingUrls.has(u)).map(u => {
    const name = decodeURIComponent((u.split('/').pop() || 'attachment').split('?')[0]);
    return { public_url: u, file_name: name, file_size: null, _fallback: true };
  });
  const allAttachments = attachments.concat(extras);
  const attachHtml = allAttachments.length ? `
    <div class="msg-att-list">
      ${allAttachments.map(a => {
        const isImg = /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(a.file_name || '') || /\.(jpg|jpeg|png|gif|webp|heic)(\?|$)/i.test(a.public_url || '');
        if (isImg) {
          return `<span class="msg-att-chip msg-att-img">
            <a href="${a.public_url}" target="_blank" rel="noopener" title="View full size">
              <img src="${a.public_url}" data-lightbox-url="${a.public_url}" data-lightbox-name="${esc(a.file_name)}" loading="lazy" alt="${esc(a.file_name)}" style="width:48px;height:48px;object-fit:cover;border-radius:4px;cursor:pointer;">
            </a>
            <a href="${a.public_url}" target="_blank" rel="noopener" style="margin-left:6px;text-decoration:none;color:var(--navy);font-weight:600;" title="Open in new tab">${esc(a.file_name)}</a>
            <a href="${a.public_url}" target="_blank" rel="noopener" class="msg-att-view">View</a>
            <button class="msg-att-dl" data-url="${a.public_url}" data-name="${esc(a.file_name)}" title="Download">📥</button>
          </span>`;
        }
        return `<span class="msg-att-chip">
          📎 <a href="${a.public_url}" target="_blank" rel="noopener" title="Open in new tab">${esc(a.file_name)}</a>
          ${a.file_size ? `<span style="color:var(--muted);">(${(a.file_size/1024).toFixed(0)} KB)</span>` : ''}
          <a href="${a.public_url}" target="_blank" rel="noopener" class="msg-att-view">View</a>
          <button class="msg-att-dl" data-url="${a.public_url}" data-name="${esc(a.file_name)}" title="Download">📥</button>
        </span>`;
      }).join('')}
    </div>` : '';
  return `
    <div class="msg-row msg-${m.recipient_type} msg-dir-${m.direction}">
      <div class="msg-row-head">
        <span class="msg-who">${dirIcon} ${who}</span>
        <span class="msg-channel">${channelIcon} ${titleCase(m.channel === 'internal_note' ? 'note' : m.channel)}</span>
        <span class="msg-time">${fmtDateTime(m.created_at)}</span>
        ${statusBadge}
      </div>
      ${m.subject ? `<div class="msg-subject"><b>${m.subject}</b></div>` : ''}
      ${(/<html|<body|<table[^>]*role=/i.test(m.body || ''))
        ? `<details class="msg-html-wrap"><summary>📧 View formatted email</summary><iframe class="msg-html-frame" sandbox srcdoc="${(m.body||'').replace(/"/g,'&quot;')}"></iframe></details>`
        : `<div class="msg-body">${(m.body||'').replace(/</g,'&lt;').replace(/\n/g,'<br>')}</div>`}
      ${attachHtml}
      <div class="msg-row-foot">
        <span>by ${sender}</span>
        ${m.recipient_phone ? `<span> · ${fmtPhone(m.recipient_phone)}</span>` : ''}
        ${m.recipient_email ? `<span> · ${m.recipient_email}</span>` : ''}
      </div>
    </div>`;
}

async function sendMessage() {
  const p = state.activeProject;
  if (!p) return;
  const toVal = $('#msg_to').value;
  const channel = $('#msg_channel').value;
  let body = $('#msg_body').value.trim();
  const subject = $('#msg_subject') ? $('#msg_subject').value.trim() : '';

  // CC — optional, comma-separated. Normalize and basic-validate.
  // Only used for email channel; SMS / internal notes ignore.
  let ccList = [];
  const rawCc = $('#msg_cc') ? $('#msg_cc').value.trim() : '';
  if (rawCc && channel === 'email') {
    ccList = rawCc.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    const invalid = ccList.filter(e => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (invalid.length) { toast('Invalid CC email(s): ' + invalid.join(', ')); return; }
    // Dedupe + drop if same as primary recipient (no point CCing the To address)
    ccList = [...new Set(ccList.map(e => e.toLowerCase()))];
  }
  const ccEmails = ccList.join(',');
  if (!body) { toast('Message body required'); return; }

  // For outbound SMS, append the job reference so customers can identify which job
  // (and so we can route their replies back to the right project).
  if (channel === 'sms' && p.albi_job_number) {
    const ref = `\n— Ref: ${p.albi_job_number}`;
    // Only append if it's not already there (user may have typed it themselves)
    if (!body.includes(p.albi_job_number)) {
      body = body + ref;
    }
  }

  // Resolve recipient
  let recipient = { type: null, sub_id: null, name: null, phone: null, email: null };
  if (toVal === 'customer') {
    if (!p.customer_name) { toast('No customer on this project'); return; }
    recipient = {
      type: 'customer',
      sub_id: null,
      name: p.customer_name,
      phone: p.customer_phone,
      email: p.customer_email,
    };
  } else if (toVal === 'internal') {
    recipient = { type: 'internal', sub_id: null, name: null, phone: null, email: null };
  } else if (toVal.startsWith('sub:')) {
    const subId = toVal.substring(4);
    const sub = state.subs.find(s => s.id === subId);
    if (!sub) { toast('Sub not found'); return; }
    recipient = {
      type: 'sub',
      sub_id: sub.id,
      name: sub.primary_contact || sub.company_name,
      phone: sub.phone,
      email: sub.email,
    };
  }

  // Validate channel + recipient combo
  const isInternal = recipient.type === 'internal';
  const effectiveChannel = isInternal ? 'internal_note' : channel;
  if (!isInternal) {
    if (channel === 'sms' && !recipient.phone) { toast('No phone on file for that recipient'); return; }
    if (channel === 'email' && !recipient.email) { toast('No email on file for that recipient'); return; }
  }

  // Get selected sender from the From dropdown
  const fromIdx = parseInt($('#msg_from')?.value || '0', 10);
  const selectedSender = (state.staffSenders || [])[fromIdx] || {};
  const fromEmail = selectedSender.email || p.albi_pm_email || state.pmEmail || 'info@jg-restoration.com';
  const fromName = selectedSender.name || p.albi_pm_name || 'JG Restoration';
  const fromPhone = selectedSender.phone || '';

  // Drop CC entries that match the primary recipient (no self-cc)
  if (ccList.length && recipient.email) {
    ccList = ccList.filter(e => e !== recipient.email.toLowerCase());
  }
  const ccEmailsClean = ccList.join(',');

  // Insert into Supabase first (source of truth)
  const insertRow = {
    project_id: p.id,
    recipient_type: recipient.type,
    recipient_sub_id: recipient.sub_id,
    recipient_name: recipient.name,
    recipient_phone: recipient.phone,
    recipient_email: recipient.email,
    cc_email: ccEmailsClean || null,
    channel: effectiveChannel,
    direction: 'outbound',
    subject: subject || null,
    body: body,
    sent_by_email: fromEmail,
    sent_by_name: fromName,
    status: isInternal ? 'sent' : 'queued',
  };
  const { data: insertedArr, error } = await sb.from('rebuild_messages').insert(insertRow).select();
  if (error) { toast('Save failed: ' + error.message); return; }
  const inserted = insertedArr?.[0];

  // Upload staged attachments (email AND SMS — both should preserve attachments in history)
  const uploadedAttachments = [];
  const stagedFiles = ((channel === 'email' || channel === 'sms') && !isInternal) ? (state.stagedAttachments || []) : [];
  if (stagedFiles.length && inserted) {
    for (const file of stagedFiles) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${inserted.id}/${Date.now()}-${safeName}`;
      const { error: upErr } = await sb.storage
        .from('rebuild-message-attachments')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) {
        console.error('Upload failed:', upErr);
        toast('Attachment upload failed: ' + file.name);
        continue;
      }
      const { data: urlData } = sb.storage
        .from('rebuild-message-attachments')
        .getPublicUrl(path);
      const publicUrl = urlData.publicUrl;
      await sb.from('rebuild_message_attachments').insert({
        message_id: inserted.id,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type,
        storage_path: path,
        public_url: publicUrl,
      });
      uploadedAttachments.push({ name: file.name, url: publicUrl, size: file.size, type: file.type });
    }
  }

  // Add docs picked from Documents tab (already public URLs, no re-upload)
  const docAttachments = (!isInternal) ? (state.stagedDocAttachments || []) : [];
  for (const d of docAttachments) {
    if (inserted) {
      await sb.from('rebuild_message_attachments').insert({
        message_id: inserted.id,
        file_name: d.filename,
        file_size: d.file_size_bytes,
        mime_type: d.mime_type,
        storage_path: null,
        public_url: d.file_url,
      });
    }
    uploadedAttachments.push({ name: d.filename, url: d.file_url, size: d.file_size_bytes, type: d.mime_type });
  }

  // Fire-and-forget to Zapier (skip for internal notes)
  if (!isInternal) {
    // For emails, wrap body in branded HTML template (logo + signature)
    // SMS uses plain body unchanged.
    const brandedBody = (channel === 'email')
      ? (() => {
          // Convert body lines to <p> tags, preserving signature line breaks
          const bodyLines = body.split('\n');
          // If body already ends with a sign-off, strip it so we don't duplicate
          const cleanLines = bodyLines.filter(line => {
            const t = line.trim().toLowerCase();
            return !/^(thanks|thank you|sincerely|best|regards|cheers),?$/.test(t)
              && !/^jg restoration$/i.test(line.trim());
          });
          const introLine = cleanLines[0] || '';
          const restLines = cleanLines.slice(1).filter(l => l.trim() && !l.includes('Please call me at'));
          const bodyHtml = restLines
            .map(line => line.trim() ? `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#1a2540;">${line}</p>` : '')
            .join('');
          const senderName = fromName || 'JG Restoration';
          const senderTitle = selectedSender.role || selectedSender.title || '';
          const senderPhone = fromPhone ? fmtPhone(fromPhone) : (p.albi_pm_phone ? fmtPhone(p.albi_pm_phone) : '(920) 428-4200');
          const senderEmail = fromEmail || 'info@jg-restoration.com';
          const signatureHtml = `
            <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;">
              <table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,sans-serif;">
                <tr>
                  <td style="padding-right:14px;vertical-align:top;">
                    <img src="https://jgimprovements-arch.github.io/jg-dispatch/logo.png" alt="JG Restoration" width="80" style="border-radius:6px;">
                  </td>
                  <td style="vertical-align:top;">
                    <div style="font-weight:700;font-size:14px;color:#0d2d5e;">${esc(senderName)}</div>
                    ${senderTitle ? `<div style="font-size:13px;color:#7884a0;margin-top:2px;">${esc(senderTitle)}</div>` : ''}
                    <div style="font-size:13px;color:#0d2d5e;margin-top:6px;font-weight:600;">JG Restoration</div>
                    <div style="font-size:12px;color:#7884a0;">Fire · Water · Mold · Reconstruction</div>
                    <div style="margin-top:6px;font-size:13px;">
                      <a href="tel:${senderPhone.replace(/\D/g,'')}" style="color:#e85d04;text-decoration:none;">${senderPhone}</a>
                      ${senderEmail !== 'info@jg-restoration.com' ? ` · <a href="mailto:${senderEmail}" style="color:#e85d04;text-decoration:none;">${esc(senderEmail)}</a>` : ''}
                    </div>
                    <div style="margin-top:4px;font-size:12px;">
                      <a href="https://jg-restoration.com" style="color:#7884a0;text-decoration:none;">jg-restoration.com</a>
                    </div>
                  </td>
                </tr>
              </table>
            </div>
          `;
          return buildBrandedEmail({
            preheader: subject || `Update on ${p.albi_job_number || 'your project'}`,
            headline: '',
            intro: introLine,
            bodyHtml: bodyHtml + signatureHtml,
            signoffName: '',
            signoffPhone: '',
          });
        })()
      : body;

    const payload = {
      message_id: inserted?.id,
      project_id: p.id,
      albi_project_id: p.albi_project_id,
      job_number: p.albi_job_number,
      channel: channel,
      to_phone: toE164(recipient.phone),
      to_email: recipient.email || '',
      cc_email: ccEmailsClean || '',
      from_email: fromEmail,
      from_name: fromName,
      recipient_name: recipient.name || '',
      recipient_type: recipient.type,
      subject: subject || `Re: ${p.albi_job_number || 'project'}`,
      body: brandedBody,
      // Attachments — Zapier Gmail action takes a comma-separated list of URLs
      attachment_count: uploadedAttachments.length,
      attachment_urls: uploadedAttachments.map(a => a.url).join(','),
      attachment_url_1: uploadedAttachments[0]?.url || '',
      attachment_url_2: uploadedAttachments[1]?.url || '',
      attachment_url_3: uploadedAttachments[2]?.url || '',
      attachment_url_4: uploadedAttachments[3]?.url || '',
      attachment_url_5: uploadedAttachments[4]?.url || '',
      attachment_names: uploadedAttachments.map(a => a.name).join(', '),
    };
    try {
      await fetch(MESSAGE_HOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        mode: 'no-cors',
      });
      if (inserted) await sb.from('rebuild_messages').update({ status: 'sent' }).eq('id', inserted.id);
    } catch (e) {
      console.warn('Zapier send failed:', e);
      if (inserted) await sb.from('rebuild_messages').update({ status: 'failed', error_message: String(e) }).eq('id', inserted.id);
    }
  }

  // Log to Albi timeline
  if (!isInternal) {
    const channelLabel = channel === 'sms' ? 'SMS' : 'Email';
    const recipLabel = recipient.type === 'customer'
      ? `customer (${recipient.name})`
      : `sub (${state.subs.find(s => s.id === recipient.sub_id)?.company_name || recipient.name})`;
    const preview = body.length > 200 ? body.substring(0, 200) + '…' : body;
    const attachNote = uploadedAttachments.length ? ` [+${uploadedAttachments.length} attachment${uploadedAttachments.length>1?'s':''}]` : '';
    logToAlbi(`message_${recipient.type}_out`, `${channelLabel} sent to ${recipLabel}${attachNote}: ${preview}`);
  }

  toast(isInternal ? 'Note saved' : 'Message sent');
  $('#msg_body').value = '';
  if ($('#msg_subject')) $('#msg_subject').value = '';
  state.stagedAttachments = [];
  state.stagedDocAttachments = [];
  await loadMessages();
  renderDetail();
}

// ────────────────────────────────────────────────────────────────────────────
// Expose to window so HTML onclick= attributes and other modules can call
// ────────────────────────────────────────────────────────────────────────────
window.loadMessages = loadMessages;
window.renderMessagesTab = renderMessagesTab;
window.renderMessageRow = renderMessageRow;
window.sendMessage = sendMessage;
