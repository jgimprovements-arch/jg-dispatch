/*  ══════════════════════════════════════════════════════════════════════
    JG PLATFORM — REBUILD SCHEDULER · RELATIONSHIPS MODULE
    Extracted 2026-05-20 from rebuild.html.

    What this is:
      Project Relationships tab — manages people/orgs associated with a
      project (customer, adjuster, lender, subs, JG team members, etc.).
      Includes the contact-directory search and the per-project rel
      cards with role-grouped display.

      Table: rebuild_project_relationships
      Reads: contact_directory (for autocomplete + directory browse)

    Module shape:
      Two clumps in the original file:
        - loadRelationships()  (one orphan function)
        - The main cluster:    banner + 2 consts + 14 functions
      Combined here as a single module file with the orphan loader at top.

    Dependencies (defined in rebuild.html main <script>):
      - state.*  (activeProjectId, activeProject, relationships, relDirTab, …)
      - sb       (Supabase client)
      - $(), $$()
      - esc(), toast(), fmtPhone(), titleCase(), addAudit()
      - bus / dispatchEvent for cross-module signals (if any)

    External callsites (in rebuild.html, must keep working):
      - loadRelationships()         — selectProject() Promise.all loader
                                       + 2 other refresh sites (L3050, L3076 in
                                       the pre-extraction file)
      - renderRelationshipsTab()    — tab dispatcher in renderDetail
      - wireRelationshipsTab()      — tab wiring in renderDetail
      - REL_ROLE_LABELS             — used in 2 places outside the module
                                       (rel_autocomplete + rel_dir rendering)
                                       Both INSIDE other module functions
                                       that we ARE keeping in this file
                                       (relRunAutocomplete, relRunDirectorySearch)
                                       so no external const access remains.

    Plus onclick= attributes inside relationship HTML template literals
    reference: relOpenEditSheet, relDelete, relPickDirectoryContact, etc.
    All exports are explicitly attached to window below.
    ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ─── Clump A: data loader (was at L1997 in pre-extraction file) ─────────────
async function loadRelationships() {
  if (!sb || !state.activeProjectId) { state.relationships = []; return; }
  const { data, error } = await sb.from('rebuild_project_relationships')
    .select('*')
    .eq('project_id', state.activeProjectId)
    .is('deleted_at', null)
    .order('is_primary', { ascending: false })
    .order('display_name');
  if (error) { console.warn('loadRelationships', error); state.relationships = []; return; }
  state.relationships = data || [];
}

  // ─── Clump B: main module (was at L2579 in pre-extraction file) ─────────────
// ═══════════════ RELATIONSHIPS TAB (desktop) ═══════════════
const REL_ROLE_LABELS = {
  customer: 'Customer',
  insurance_adjuster: 'Insurance Adjuster',
  insurance_carrier: 'Insurance Company',
  insurance_carrier_rep: 'Insurance Carrier Rep',
  public_adjuster: 'Public Adjuster',
  real_estate_agent: 'Real Estate Agent',
  lender: 'Lender',
  property_manager: 'Property Manager',
  mortgage_company: 'Mortgage Company',
  attorney: 'Attorney',
  tech: 'Tech',
  carpenter: 'Carpenter',
  subcontractor: 'Subcontractor',
  vendor: 'Vendor',
  estimator: 'Estimator',
  project_manager: 'Project Manager',
  office_admin: 'Office Admin',
  other: 'Other',
};

const REL_GROUP_ORDER = [
  { key: 'Customer & Property', roles: ['customer','property_manager'] },
  { key: 'Insurance', roles: ['insurance_carrier','insurance_adjuster','insurance_carrier_rep','public_adjuster'] },
  { key: 'Financial', roles: ['lender','mortgage_company','attorney'] },
  { key: 'Real Estate', roles: ['real_estate_agent'] },
  { key: 'Trade & Supplier', roles: ['subcontractor','vendor'] },
  { key: 'JG Team', roles: ['project_manager','estimator','tech','carpenter','office_admin'] },
  { key: 'Other', roles: ['other'] },
];

function renderRelationshipsTab() {
  const rels = (state.relationships || []).slice();

  // ── Synthesize virtual cards from Albi-synced project fields ──────────
  // The PM and insurance adjuster aren't stored in rebuild_project_relationships
  // by default — they live as columns on rebuild_projects from the Albi sync.
  // Rendering them as virtual cards keeps the Relationships tab a single
  // source of truth ("everyone connected to this job") instead of forcing
  // the user to look at the header AND the tab to see the full picture.
  // Dedupe rule: if a real relationship already has the same email, the
  // real one wins (user-added context takes precedence over auto-sync).
  if (state.project) {
    const p = state.project;
    const existingEmails = new Set(rels.map(r => (r.email || '').toLowerCase()).filter(Boolean));

    function pushSynth(synth) {
      if (!synth.display_name) return;
      const em = (synth.email || '').toLowerCase();
      if (em && existingEmails.has(em)) return; // user has a real row already
      rels.push(synth);
      if (em) existingEmails.add(em);
    }

    // Project Manager — `albi_pm_name` / `albi_pm_email`. Almost always set
    // post-Albi-sync. Without this card a PM can navigate to a job and not
    // see themselves listed, which is jarring.
    if (p.albi_pm_name || p.albi_pm_email) {
      pushSynth({
        id: '_synth_pm',
        _synth: true,
        source: 'albi',
        role: 'project_manager',
        display_name: p.albi_pm_name || p.albi_pm_email,
        email: p.albi_pm_email || null,
        phone: null,
        company: 'JG Restoration',
        is_primary: false,
      });
    }

    // Insurance carrier (the organization itself) — from `insurance_carrier`
    // text column. Albi treats the carrier as a separate entity from the
    // adjuster (one is the company, the other is the person handling the
    // claim). We mirror that distinction so the relationships tab matches
    // what the PM sees in Albi. Falls back to no contact info since
    // rebuild_projects doesn't currently store carrier phone/address.
    if (p.insurance_carrier) {
      pushSynth({
        id: '_synth_carrier',
        _synth: true,
        source: 'albi',
        role: 'insurance_carrier',
        display_name: p.insurance_carrier,
        email: null,
        phone: p.insurance_carrier_phone || null,   // safe even if column doesn't exist
        company: p.insurance_carrier,
        is_primary: false,
      });
    }

    // Insurance adjuster — `insurance_adjuster_name` / `_email` / `_phone`
    if (p.insurance_adjuster_name || p.insurance_adjuster_email) {
      pushSynth({
        id: '_synth_adjuster',
        _synth: true,
        source: 'albi',
        role: 'insurance_adjuster',
        display_name: p.insurance_adjuster_name || p.insurance_adjuster_email,
        email: p.insurance_adjuster_email || null,
        phone: p.insurance_adjuster_phone || null,
        company: p.insurance_carrier || null,
        is_primary: false,
      });
    }

    // Customer secondary contact — `customer_email_secondary` if present
    // and the primary customer email isn't the same value. Best guess on
    // the name since Albi typically stores it as one field. Uses 'customer'
    // role so it groups with the primary customer card.
    if (p.customer_email_secondary && p.customer_email_secondary !== p.customer_email) {
      pushSynth({
        id: '_synth_customer_secondary',
        _synth: true,
        source: 'albi',
        role: 'customer',
        display_name: p.customer_email_secondary,
        email: p.customer_email_secondary,
        phone: null,
        company: null,
        is_primary: false,
      });
    }
  }

  // Group rels
  const byGroup = {};
  REL_GROUP_ORDER.forEach(g => byGroup[g.key] = []);
  byGroup.Other = [];
  rels.forEach(r => {
    const matched = REL_GROUP_ORDER.find(g => g.roles.includes(r.role));
    if (matched) byGroup[matched.key].push(r);
    else byGroup.Other.push(r);
  });

  const groupsHtml = REL_GROUP_ORDER
    .concat([{ key: 'Other', roles: [] }])
    .filter(g => (byGroup[g.key] || []).length > 0)
    .map(g => `
      <div class="rel-group">
        <div class="rel-group-label">${esc(g.key)} <span class="rel-group-count">${byGroup[g.key].length}</span></div>
        <div class="rel-card-grid">${byGroup[g.key].map(relCardDesktop).join('')}</div>
      </div>
    `).join('');

  const emptyState = !rels.length ? `
    <div class="empty" style="padding:60px 20px;text-align:center;color:var(--muted);">
      <div style="font-size:48px;opacity:.3;margin-bottom:8px;">👥</div>
      <h3 style="margin:0 0 4px;color:var(--text);">No relationships yet</h3>
      <p style="margin:0;font-size:13px;">Use the buttons above to browse the directory or add a new contact.</p>
    </div>
  ` : '';

  return `
    <div class="rel-tab-header">
      <div>
        <h2 style="margin:0;font-size:18px;font-weight:800;color:var(--navy);">People on this Project</h2>
        <div style="font-size:12px;color:var(--muted);margin-top:2px;">Customers, adjusters, agents, subs, JG team</div>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="rel-action-primary" id="rel_browse_dir">📇 Browse Directory</button>
        <button class="rel-action-primary" id="rel_add_new" style="background:var(--orange);">+ Add New</button>
      </div>
    </div>
    ${emptyState}
    ${groupsHtml}

    <!-- Add/Edit sheet (rendered inline but absolutely positioned) -->
    <div class="rel-sheet-back" id="rel_sheet_back">
      <div class="rel-sheet">
        <div class="rel-sheet-header">
          <h3 id="rel_sheet_title">Add Relationship</h3>
          <button class="rel-sheet-close" id="rel_sheet_close">×</button>
        </div>
        <div class="rel-sheet-body">
          <label>Role *</label>
          <select id="rel_f_role">
            <optgroup label="Albi roles">
              <option value="customer">Customer</option>
              <option value="insurance_adjuster">Insurance Adjuster</option>
              <option value="insurance_carrier">Insurance Company</option>
              <option value="insurance_carrier_rep">Insurance Carrier Rep</option>
              <option value="public_adjuster">Public Adjuster</option>
              <option value="real_estate_agent">Real Estate Agent</option>
              <option value="lender">Lender</option>
              <option value="property_manager">Property Manager</option>
              <option value="mortgage_company">Mortgage Company</option>
              <option value="attorney">Attorney</option>
            </optgroup>
            <optgroup label="Trade & Supplier">
              <option value="subcontractor">Subcontractor</option>
              <option value="vendor">Vendor</option>
            </optgroup>
            <optgroup label="JG roles">
              <option value="tech">Tech</option>
              <option value="carpenter">Carpenter</option>
              <option value="estimator">Estimator</option>
              <option value="project_manager">Project Manager</option>
              <option value="office_admin">Office Admin</option>
              <option value="other">Other</option>
            </optgroup>
          </select>

          <!-- JG Staff picker — only shown when a JG role is selected -->
          <div id="rel_staff_picker_wrap" style="display:none;margin-top:6px;padding:10px 12px;background:rgba(232,93,4,.06);border:1px solid rgba(232,93,4,.25);border-radius:6px;">
            <label style="font-size:10px;font-weight:800;color:var(--orange);text-transform:uppercase;letter-spacing:.4px;margin:0 0 4px;display:block;">Pick from JG Staff</label>
            <select id="rel_f_staff_picker" style="width:100%;border:1px solid var(--line);border-radius:6px;padding:7px 10px;font-size:13px;font-family:inherit;background:#fff;">
              <option value="">— Pick a staff member to auto-fill —</option>
            </select>
            <div style="font-size:11px;color:var(--muted);margin-top:4px;">Pick someone to auto-fill their name, email, and phone below.</div>
          </div>

          <label>Name * <span id="rel_from_dir_badge" style="display:none;background:rgba(74,144,226,.15);color:#4a90e2;padding:2px 8px;border-radius:999px;font-size:9px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;margin-left:8px;vertical-align:middle;">📇 From Directory</span></label>
          <div style="position:relative;">
            <input type="text" id="rel_f_name" autocomplete="off" placeholder="Start typing for suggestions">
            <div class="rel-autocomplete" id="rel_autocomplete"></div>
          </div>

          <label>Company / Org</label>
          <input type="text" id="rel_f_company" autocomplete="off" placeholder="e.g. State Farm">

          <div class="rel-row2">
            <div>
              <label>Phone</label>
              <input type="tel" id="rel_f_phone" autocomplete="off">
            </div>
            <div>
              <label>Phone (alt)</label>
              <input type="tel" id="rel_f_phone_secondary" autocomplete="off">
            </div>
          </div>

          <label>Email</label>
          <input type="email" id="rel_f_email" autocomplete="off">

          <label>Notes</label>
          <textarea id="rel_f_notes" placeholder="Best contact time, claim-specific details…"></textarea>

          <label style="display:flex;align-items:center;gap:8px;text-transform:none;font-weight:600;color:var(--text);">
            <input type="checkbox" id="rel_f_primary" style="width:18px;height:18px;accent-color:var(--orange);"> Mark as primary for this role
          </label>
        </div>
        <div class="rel-sheet-actions">
          <button class="rel-btn-danger" id="rel_delete" style="display:none;">Delete</button>
          <div style="flex:1;"></div>
          <button class="rel-btn-ghost" id="rel_cancel">Cancel</button>
          <button class="rel-btn-primary" id="rel_save">Save</button>
        </div>
      </div>
    </div>

    <!-- Directory picker -->
    <div class="rel-sheet-back" id="rel_dir_back">
      <div class="rel-dir-overlay">
        <div class="rel-dir-header">
          <input type="text" id="rel_dir_search" placeholder="Search 5,300+ contacts and organizations…">
          <button class="rel-btn-primary" id="rel_dir_close">Done</button>
        </div>
        <div class="rel-dir-tabs">
          <button class="rel-dir-tab on" data-rel-tab="people">People</button>
          <button class="rel-dir-tab" data-rel-tab="orgs">Organizations</button>
          <label style="margin-left:auto;font-size:12px;color:var(--text-soft);display:flex;align-items:center;gap:6px;cursor:pointer;">
            <input type="checkbox" id="rel_dir_show_customers" style="accent-color:var(--orange);width:16px;height:16px;"> Include customers
          </label>
        </div>
        <div class="rel-dir-list" id="rel_dir_list">
          <div style="padding:30px;text-align:center;color:var(--muted);font-size:13px;">Type to search…</div>
        </div>
      </div>
    </div>
  `;
}

function relCardDesktop(r) {
  const phoneBtn = r.phone
    ? `<a href="tel:${esc(r.phone)}" class="rel-action-btn"><span style="margin-right:4px;">📞</span>Call</a>`
    : `<span class="rel-action-btn disabled">Call</span>`;
  const emailBtn = r.email
    ? `<a href="mailto:${esc(r.email)}" class="rel-action-btn"><span style="margin-right:4px;">✉</span>Email</a>`
    : `<span class="rel-action-btn disabled">Email</span>`;
  const smsBtn = r.phone
    ? `<a href="sms:${esc(r.phone)}" class="rel-action-btn"><span style="margin-right:4px;">💬</span>Text</a>`
    : `<span class="rel-action-btn disabled">Text</span>`;

  const sourceLabel = r.directory_contact_id ? 'DIR' : (r.source === 'albi' ? 'ALBI' : 'JG');
  const sourceCls = r.directory_contact_id ? 'dir' : (r.source === 'albi' ? 'albi' : 'jg');

  return `
    <div class="rel-card-d ${sourceCls}" data-rel-id="${esc(r.id)}">
      <div class="rel-card-top">
        <div style="flex:1;min-width:0;">
          <div class="rel-name">${esc(r.display_name)}</div>
          <div class="rel-role">${esc(REL_ROLE_LABELS[r.role] || r.role)}</div>
          ${r.company ? `<div class="rel-company">${esc(r.company)}</div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;">
          <span class="rel-source-pill ${sourceCls}">${sourceLabel}</span>
          ${r.is_primary ? `<span class="rel-source-pill primary">Primary</span>` : ''}
        </div>
      </div>
      ${r.email || r.phone ? `<div class="rel-contact-line">
        ${r.email ? `<span>${esc(r.email)}</span>` : ''}
        ${r.phone ? `<span>${esc(r.phone)}</span>` : ''}
      </div>` : ''}
      <div class="rel-actions">
        ${phoneBtn}
        ${smsBtn}
        ${emailBtn}
        ${r._synth
          ? `<span class="rel-action-btn disabled" title="Synced from Albi — edit in Albi to change">From Albi</span>`
          : `<button class="rel-action-btn rel-edit-btn" data-rel-edit="${esc(r.id)}"><span style="margin-right:4px;">✎</span>Edit</button>`}
      </div>
    </div>
  `;
}

function wireRelationshipsTab() {
  // Open Add sheet
  const addBtn = $('#rel_add_new');
  if (addBtn) addBtn.addEventListener('click', () => relOpenAddSheet());

  // Open directory
  const browseBtn = $('#rel_browse_dir');
  if (browseBtn) browseBtn.addEventListener('click', () => relOpenDirectory());

  // Edit existing cards
  $$('[data-rel-edit]').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      relOpenEditSheet(b.dataset.relEdit);
    });
  });

  // Sheet controls
  const closeS = $('#rel_sheet_close');
  if (closeS) closeS.addEventListener('click', relCloseSheet);
  const cancelS = $('#rel_cancel');
  if (cancelS) cancelS.addEventListener('click', relCloseSheet);
  const saveS = $('#rel_save');
  if (saveS) saveS.addEventListener('click', relSave);
  const delS = $('#rel_delete');
  if (delS) delS.addEventListener('click', relDelete);
  const sheetBack = $('#rel_sheet_back');
  if (sheetBack) sheetBack.addEventListener('click', (e) => { if (e.target.id === 'rel_sheet_back') relCloseSheet(); });

  // Autocomplete
  const nameInput = $('#rel_f_name');
  if (nameInput) {
    let timer = null;
    nameInput.addEventListener('input', (e) => {
      if (state.relSheetDirContactId && !state.relEditingId) {
        state.relSheetDirContactId = null;
        state.relSheetDirOrgId = null;
        $('#rel_from_dir_badge').style.display = 'none';
      }
      clearTimeout(timer);
      const v = e.target.value.trim();
      if (v.length < 2) { $('#rel_autocomplete').classList.remove('on'); return; }
      timer = setTimeout(() => relRunAutocomplete(v), 200);
    });
    nameInput.addEventListener('blur', () => setTimeout(() => $('#rel_autocomplete')?.classList.remove('on'), 200));
  }

  // ─── JG Staff picker ───
  // Role-to-staff-filter map: which employee roles match which relationship roles
  const JG_ROLE_FILTER = {
    tech: ['Tech', 'Technician'],
    carpenter: ['Carpenter'],
    estimator: ['Estimator'],
    project_manager: ['Project Manager', 'PM'],
    office_admin: ['Office', 'Office Admin', 'Admin', 'Office Manager', 'Bookkeeper'],
    // 'other' gets the full staff list
  };
  const JG_ROLES = new Set(['tech','carpenter','estimator','project_manager','office_admin','other']);

  const updateStaffPicker = () => {
    const roleSel = $('#rel_f_role');
    const wrap = $('#rel_staff_picker_wrap');
    const picker = $('#rel_f_staff_picker');
    if (!roleSel || !wrap || !picker) return;
    const role = roleSel.value;
    if (!JG_ROLES.has(role)) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'block';
    // Filter staff by role match if we have a filter list
    const allStaff = state.allStaff || [];
    const filterList = JG_ROLE_FILTER[role];
    const filtered = filterList
      ? allStaff.filter(s => filterList.some(f => (s.role || '').toLowerCase().includes(f.toLowerCase())))
      : allStaff;
    // If filter returns nothing, fall back to full list
    const finalList = filtered.length ? filtered : allStaff;
    picker.innerHTML = '<option value="">— Pick a staff member to auto-fill —</option>' +
      finalList.map(s => `<option value="${esc(s.id)}">${esc(s.name)}${s.role ? ' · ' + esc(s.role) : ''}</option>`).join('');
    picker.value = '';
  };

  $('#rel_f_role')?.addEventListener('change', updateStaffPicker);

  $('#rel_f_staff_picker')?.addEventListener('change', (e) => {
    const staffId = e.target.value;
    if (!staffId) return;
    const staff = (state.allStaff || []).find(s => s.id === staffId);
    if (!staff) return;
    $('#rel_f_name').value = staff.name || '';
    if (staff.email) $('#rel_f_email').value = staff.email;
    else if (staff.personal_email) $('#rel_f_email').value = staff.personal_email;
    if (staff.phone) $('#rel_f_phone').value = staff.phone;
    $('#rel_f_company').value = 'JG Restoration';
  });

  // Initialize visibility once on wire
  setTimeout(updateStaffPicker, 50);

  // Directory picker
  const dirClose = $('#rel_dir_close');
  if (dirClose) dirClose.addEventListener('click', relCloseDirectory);
  const dirBack = $('#rel_dir_back');
  if (dirBack) dirBack.addEventListener('click', (e) => { if (e.target.id === 'rel_dir_back') relCloseDirectory(); });
  const dirSearch = $('#rel_dir_search');
  if (dirSearch) {
    let timer = null;
    dirSearch.addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => relRunDirectorySearch(e.target.value), 200);
    });
  }
  $$('.rel-dir-tab').forEach(t => {
    t.addEventListener('click', () => {
      state.relDirTab = t.dataset.relTab;
      $$('.rel-dir-tab').forEach(x => x.classList.toggle('on', x.dataset.relTab === state.relDirTab));
      relRunDirectorySearch($('#rel_dir_search').value);
    });
  });
  const showCust = $('#rel_dir_show_customers');
  if (showCust) showCust.addEventListener('change', (e) => {
    state.relDirShowCustomers = e.target.checked;
    relRunDirectorySearch($('#rel_dir_search').value);
  });
}

function relOpenAddSheet() {
  state.relEditingId = null;
  state.relSheetDirContactId = null;
  state.relSheetDirOrgId = null;
  $('#rel_sheet_title').textContent = 'Add Relationship';
  $('#rel_delete').style.display = 'none';
  $('#rel_from_dir_badge').style.display = 'none';
  $('#rel_f_role').value = 'customer';
  $('#rel_f_name').value = '';
  $('#rel_f_company').value = '';
  $('#rel_f_phone').value = '';
  $('#rel_f_phone_secondary').value = '';
  $('#rel_f_email').value = '';
  $('#rel_f_notes').value = '';
  $('#rel_f_primary').checked = false;
  $('#rel_sheet_back').classList.add('on');
  setTimeout(() => $('#rel_f_name').focus(), 100);
  // Refresh JG staff picker (defined in wireRelationshipsTab scope, called via event listener)
  $('#rel_f_role').dispatchEvent(new Event('change'));
}

function relOpenEditSheet(id) {
  const r = (state.relationships || []).find(x => x.id === id);
  if (!r) return;
  state.relEditingId = id;
  state.relSheetDirContactId = r.directory_contact_id || null;
  state.relSheetDirOrgId = r.directory_org_id || null;
  $('#rel_sheet_title').textContent = 'Edit Relationship';
  $('#rel_delete').style.display = 'inline-block';
  $('#rel_from_dir_badge').style.display = r.directory_contact_id ? 'inline-block' : 'none';
  $('#rel_f_role').value = r.role || 'other';
  $('#rel_f_name').value = r.display_name || '';
  $('#rel_f_company').value = r.company || '';
  $('#rel_f_phone').value = r.phone || '';
  $('#rel_f_phone_secondary').value = r.phone_secondary || '';
  $('#rel_f_email').value = r.email || '';
  $('#rel_f_notes').value = r.notes || '';
  $('#rel_f_primary').checked = !!r.is_primary;
  $('#rel_sheet_back').classList.add('on');
  $('#rel_f_role').dispatchEvent(new Event('change'));
}

function relCloseSheet() {
  $('#rel_sheet_back')?.classList.remove('on');
  state.relEditingId = null;
}

async function relSave() {
  const name = $('#rel_f_name').value.trim();
  if (!name) { toast('Name is required'); return; }
  const saveBtn = $('#rel_save');
  saveBtn.disabled = true;
  const orig = saveBtn.textContent;
  saveBtn.textContent = 'Saving…';

  const fields = {
    project_id: state.activeProjectId,
    role: $('#rel_f_role').value,
    display_name: name,
    company: $('#rel_f_company').value.trim() || null,
    phone: toE164($('#rel_f_phone').value.trim()) || null,
    phone_secondary: toE164($('#rel_f_phone_secondary').value.trim()) || null,
    email: $('#rel_f_email').value.trim() || null,
    notes: $('#rel_f_notes').value.trim() || null,
    is_primary: $('#rel_f_primary').checked,
    directory_contact_id: state.relSheetDirContactId,
    directory_org_id: state.relSheetDirOrgId,
  };

  let savedRow, action;
  if (state.relEditingId) {
    const { data, error } = await sb.from('rebuild_project_relationships').update(fields).eq('id', state.relEditingId).select();
    if (error) { toast('Save failed: ' + error.message); saveBtn.disabled = false; saveBtn.textContent = orig; return; }
    savedRow = data[0]; action = 'edited';
  } else {
    // DEDUPE: find or create a directory contact unless user already picked one
    let matchedExisting = false;
    if (!fields.directory_contact_id) {
      const { data: dirId, error: rpcErr } = await sb.rpc('find_or_create_contact', {
        p_display_name: fields.display_name,
        p_phone: fields.phone,
        p_email: fields.email,
        p_role: fields.role,
        p_company: fields.company,
      });
      if (rpcErr) {
        console.warn('find_or_create_contact failed:', rpcErr);
      } else if (dirId) {
        fields.directory_contact_id = dirId;
        const { data: existing } = await sb.from('contact_directory')
          .select('display_name, mobile_phone, email, organization_name, role')
          .eq('id', dirId).maybeSingle();
        if (existing) {
          const isMatch = (
            existing.display_name?.trim().toLowerCase() === fields.display_name.trim().toLowerCase() &&
            (
              (fields.phone && existing.mobile_phone &&
                existing.mobile_phone.replace(/\D/g,'') === fields.phone.replace(/\D/g,'')) ||
              (fields.email && existing.email &&
                existing.email.toLowerCase() === fields.email.toLowerCase())
            )
          );
          fields.display_name = existing.display_name;
          fields.phone = fields.phone || existing.mobile_phone;
          fields.email = fields.email || existing.email;
          fields.company = fields.company || existing.organization_name;
          matchedExisting = isMatch;
        }
      }
    }

    fields.source = 'jg';
    fields.created_by_email = state.pmEmail;
    fields.created_by_name = state.pmName;
    const { data, error } = await sb.from('rebuild_project_relationships').insert(fields).select();
    if (error) { toast('Save failed: ' + error.message); saveBtn.disabled = false; saveBtn.textContent = orig; return; }
    savedRow = data[0];
    action = matchedExisting ? 'created_from_existing' : 'created';
    if (matchedExisting) toast('Matched existing contact');
  }

  try {
    await sb.from('rebuild_project_relationship_history').insert({
      relationship_id: savedRow.id,
      project_id: state.activeProjectId,
      action,
      actor: state.pmEmail || 'unknown',
      actor_name: state.pmName,
      changes: fields,
    });
  } catch (e) { console.warn(e); }

  await loadRelationships();
  renderTabContent();
  if (action !== 'created_from_existing') {
    toast(action === 'created' ? 'Relationship added' : 'Relationship updated');
  }
}

async function relDelete() {
  if (!state.relEditingId) return;
  const r = (state.relationships || []).find(x => x.id === state.relEditingId);
  if (!r) return;
  if (!confirm(`Delete relationship "${r.display_name}"?`)) return;
  const { error } = await sb.from('rebuild_project_relationships')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', state.relEditingId);
  if (error) { toast('Delete failed: ' + error.message); return; }
  try {
    await sb.from('rebuild_project_relationship_history').insert({
      relationship_id: state.relEditingId,
      project_id: state.activeProjectId,
      action: 'deleted',
      actor: state.pmEmail || 'unknown',
      actor_name: state.pmName,
    });
  } catch (e) { console.warn(e); }
  relCloseSheet();
  await loadRelationships();
  renderTabContent();
  toast('Relationship deleted');
}

async function relRunAutocomplete(q) {
  const { data, error } = await sb.from('contact_directory')
    .select('id, display_name, role, contact_type, mobile_phone, email, organization_name, job_title, is_customer_only')
    .or(`display_name.ilike.%${q}%,organization_name.ilike.%${q}%,email.ilike.%${q}%`)
    .eq('is_customer_only', false)
    .is('deleted_at', null)
    .limit(6);
  if (error || !data || !data.length) { $('#rel_autocomplete').classList.remove('on'); return; }
  const list = $('#rel_autocomplete');
  list.innerHTML = data.map(c => `
    <div class="rel-ac-item" data-c-id="${esc(c.id)}">
      <div style="font-weight:700;color:var(--text);font-size:13px;">${esc(c.display_name)}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px;">${esc([c.job_title, c.organization_name].filter(Boolean).join(' · '))}${c.email ? ' · ' + esc(c.email) : ''}</div>
      ${c.role ? `<div style="font-size:9px;color:#4a90e2;font-weight:800;text-transform:uppercase;letter-spacing:.4px;margin-top:2px;">${esc(REL_ROLE_LABELS[c.role] || c.role)}</div>` : ''}
    </div>
  `).join('');
  list.classList.add('on');
  list.querySelectorAll('[data-c-id]').forEach(el => {
    el.addEventListener('click', () => {
      const c = data.find(x => x.id === el.dataset.cId);
      if (c) relPickDirectoryContact(c);
    });
  });
}

function relPickDirectoryContact(c) {
  $('#rel_f_name').value = c.display_name || '';
  $('#rel_f_email').value = c.email || '';
  $('#rel_f_phone').value = c.mobile_phone || '';
  $('#rel_f_company').value = c.organization_name || '';
  if (c.role) $('#rel_f_role').value = c.role;
  state.relSheetDirContactId = c.id;
  state.relSheetDirOrgId = null;
  $('#rel_from_dir_badge').style.display = 'inline-block';
  $('#rel_autocomplete').classList.remove('on');
}

function relPickDirectoryOrg(o) {
  $('#rel_f_name').value = o.name || '';
  $('#rel_f_email').value = o.email || '';
  $('#rel_f_phone').value = o.phone || '';
  $('#rel_f_company').value = o.name || '';
  state.relSheetDirOrgId = o.id;
  state.relSheetDirContactId = null;
  $('#rel_from_dir_badge').style.display = 'inline-block';
}

function relOpenDirectory() {
  state.relDirTab = 'people';
  $$('.rel-dir-tab').forEach(t => t.classList.toggle('on', t.dataset.relTab === 'people'));
  $('#rel_dir_search').value = '';
  $('#rel_dir_back').classList.add('on');
  relRunDirectorySearch('');
  setTimeout(() => $('#rel_dir_search').focus(), 100);
}

function relCloseDirectory() {
  $('#rel_dir_back')?.classList.remove('on');
}

async function relRunDirectorySearch(q, opts = {}) {
  q = (q || '').trim();
  const append = !!opts.append;
  const showCust = state.relDirShowCustomers;

  // Reset pagination on new search/filter; only append mode preserves it
  if (!append) {
    state.relDirPage = 0;
    state.relDirHasMore = true;
    state.relDirLastQuery = q;
    state.relDirLoading = false;
  }
  if (state.relDirLoading || !state.relDirHasMore) return;
  state.relDirLoading = true;

  const PAGE_SIZE = 100;
  const from = state.relDirPage * PAGE_SIZE;
  const to   = from + PAGE_SIZE - 1;

  let queryRes;
  if (state.relDirTab === 'people') {
    let qb = sb.from('contact_directory')
      .select('id, display_name, role, contact_type, mobile_phone, email, organization_name, job_title, is_customer_only')
      .is('deleted_at', null);
    if (!showCust) qb = qb.eq('is_customer_only', false);
    if (q.length >= 2) qb = qb.or(`display_name.ilike.%${q}%,organization_name.ilike.%${q}%,email.ilike.%${q}%`);
    qb = qb.order('display_name').range(from, to);
    queryRes = await qb;
  } else {
    let qb = sb.from('organization_directory')
      .select('id, name, org_type, phone, email, city, state, is_customer_only')
      .is('deleted_at', null);
    if (!showCust) qb = qb.eq('is_customer_only', false);
    if (q.length >= 2) qb = qb.or(`name.ilike.%${q}%,email.ilike.%${q}%,city.ilike.%${q}%`);
    qb = qb.order('name').range(from, to);
    queryRes = await qb;
  }

  const { data, error } = queryRes;
  const list = $('#rel_dir_list');
  state.relDirLoading = false;

  if (error) {
    if (!append) list.innerHTML = `<div style="padding:20px;color:var(--red);">Error: ${esc(error.message)}</div>`;
    state.relDirHasMore = false;
    return;
  }

  // If fewer rows returned than we asked for, we've reached the end.
  if (!data || data.length < PAGE_SIZE) state.relDirHasMore = false;

  if (!append && (!data || !data.length)) {
    list.innerHTML = `<div style="padding:30px;text-align:center;color:var(--muted);">No matches.</div>`;
    return;
  }

  const renderRow = state.relDirTab === 'people'
    ? c => `
      <div class="rel-dir-item" data-pick="contact" data-id="${esc(c.id)}">
        <div style="font-weight:700;color:var(--text);font-size:14px;">${esc(c.display_name)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:3px;line-height:1.4;">
          ${c.role ? `<span style="background:rgba(13,45,94,.10);color:var(--navy);padding:2px 7px;border-radius:999px;font-size:9px;font-weight:800;text-transform:uppercase;margin-right:4px;">${esc(REL_ROLE_LABELS[c.role] || c.role)}</span>` : ''}
          ${esc([c.job_title, c.organization_name].filter(Boolean).join(' · ') || '—')}
          ${c.email ? `<br>${esc(c.email)}` : ''}
          ${c.mobile_phone ? ` · ${esc(c.mobile_phone)}` : ''}
        </div>
      </div>`
    : o => `
      <div class="rel-dir-item" data-pick="org" data-id="${esc(o.id)}">
        <div style="font-weight:700;color:var(--text);font-size:14px;">${esc(o.name)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:3px;line-height:1.4;">
          ${o.org_type ? `<span style="background:rgba(13,45,94,.10);color:var(--navy);padding:2px 7px;border-radius:999px;font-size:9px;font-weight:800;text-transform:uppercase;margin-right:4px;">${esc(o.org_type)}</span>` : ''}
          ${esc([o.city, o.state].filter(Boolean).join(', ') || '—')}
          ${o.email ? `<br>${esc(o.email)}` : ''}
          ${o.phone ? ` · ${esc(o.phone)}` : ''}
        </div>
      </div>`;

  const newRowsHtml = (data || []).map(renderRow).join('');

  if (append) {
    list.insertAdjacentHTML('beforeend', newRowsHtml);
  } else {
    list.innerHTML = newRowsHtml;
    // Attach scroll listener once. Triggers ~120px before bottom for smooth load.
    if (!list._scrollWired) {
      list.addEventListener('scroll', () => {
        if (list.scrollTop + list.clientHeight >= list.scrollHeight - 120) {
          if (state.relDirHasMore && !state.relDirLoading) {
            state.relDirPage += 1;
            relRunDirectorySearch(state.relDirLastQuery || '', { append: true });
          }
        }
      });
      list._scrollWired = true;
    }
  }

  // Bind click handlers on newly added rows only (idempotent via _pickWired flag).
  // Picked rows are refetched by id so we always get current data regardless of
  // which page rendered them — works correctly across pagination.
  list.querySelectorAll('[data-pick]').forEach(el => {
    if (el._pickWired) return;
    el._pickWired = true;
    el.addEventListener('click', async () => {
      const id = el.dataset.id;
      const tab = el.dataset.pick;
      if (tab === 'contact') {
        const { data: c } = await sb.from('contact_directory')
          .select('id, display_name, role, contact_type, mobile_phone, email, organization_name, job_title, is_customer_only')
          .eq('id', id).maybeSingle();
        if (!$('#rel_sheet_back').classList.contains('on')) relOpenAddSheet();
        if (c) relPickDirectoryContact(c);
      } else {
        const { data: o } = await sb.from('organization_directory')
          .select('id, name, org_type, phone, email, city, state, is_customer_only')
          .eq('id', id).maybeSingle();
        if (!$('#rel_sheet_back').classList.contains('on')) relOpenAddSheet();
        if (o) relPickDirectoryOrg(o);
      }
      relCloseDirectory();
    });
  });
}

  // ─── Expose to window so HTML onclick= attributes and rebuild.html callsites work ───
  window.REL_ROLE_LABELS = REL_ROLE_LABELS;
  window.REL_GROUP_ORDER = REL_GROUP_ORDER;
  window.loadRelationships = loadRelationships;
  window.renderRelationshipsTab = renderRelationshipsTab;
  window.relCardDesktop = relCardDesktop;
  window.wireRelationshipsTab = wireRelationshipsTab;
  window.relOpenAddSheet = relOpenAddSheet;
  window.relOpenEditSheet = relOpenEditSheet;
  window.relCloseSheet = relCloseSheet;
  window.relSave = relSave;
  window.relDelete = relDelete;
  window.relRunAutocomplete = relRunAutocomplete;
  window.relPickDirectoryContact = relPickDirectoryContact;
  window.relPickDirectoryOrg = relPickDirectoryOrg;
  window.relOpenDirectory = relOpenDirectory;
  window.relCloseDirectory = relCloseDirectory;
  window.relRunDirectorySearch = relRunDirectorySearch;

})();
