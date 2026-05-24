// rebuild-uploads.js
// Document upload pipeline:
//   - Persistent upload queue with crash recovery (localStorage)
//   - Photo capture flow (camera + multi-file selection)
//   - HEIC → JPEG conversion (lazy-loaded heic2any)
//   - EXIF geotag + capture timestamp extraction
//   - Per-tile progress / retry / repick / remove UI
//   - Supabase Storage upload + rebuild_documents row insert
//   - Best-effort Albi push (single + batch hooks via Zapier)
//   - Document picker modal (for attaching existing docs to outgoing emails)
//
// Extracted from rebuild.html for module-size hygiene.
//
// Depends on globals defined in rebuild.html:
//   - sb                        : Supabase client
//   - state                     : Shared state (uploadQueue, documents, activeProject, activeProjectId, pmEmail, pmName, etc.)
//   - DOC_CATEGORIES            : Array of category names
//   - ALBI_DOC_HOOK             : Zapier webhook URL for single doc push
//   - ALBI_DOC_BATCH_HOOK       : Zapier webhook URL for batch doc push
//   - loadDocuments()           : Reloads state.documents from Supabase
//   - loadHeic2Any()            : Lazy heic2any loader (window-scoped)
//   - extractExifBasics(file)   : Reads EXIF from image File
//   - getCurrentLocation()      : Geolocation helper
//   - renderDetail()            : Re-renders the project detail pane
//   - toast(msg)                : Global toast notification helper
//
// Depends on globals defined in rebuild-utils.js:
//   - esc(s)
//   - mimeFromFilename(filename)
//
// Entry points called from rebuild.html:
//   - loadUploadQueue()         — called from init() after rail wiring
//   - uploadFilesToCategory()   — called from docs-tab file pickers
//   - openDocPickerModal(cb)    — called from report builder
//
// All function declarations remain global (no module wrapper) so inline
// event handlers in template strings continue to work.

// Convert HEIC files to JPEG before upload so browsers can display thumbnails.
// Returns the original File if not HEIC, or a new File with .jpg extension if converted.
// Falls back to the original File if conversion fails (user gets unviewable thumbnail rather than upload failure).
async function convertHeicIfNeeded(file) {
  const name = (file.name || '').toLowerCase();
  const type = (file.type || '').toLowerCase();
  const isHeic = name.endsWith('.heic') || name.endsWith('.heif')
               || type === 'image/heic' || type === 'image/heif'
               || type === 'image/heic-sequence' || type === 'image/heif-sequence';
  if (!isHeic) return file;

  try {
    const heic2any = await loadHeic2Any();
    if (typeof heic2any !== 'function') {
      throw new Error('heic2any did not load — check network');
    }
    const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 });
    const jpgBlob = Array.isArray(blob) ? blob[0] : blob;
    if (!jpgBlob || !jpgBlob.size) {
      throw new Error('Conversion produced empty blob');
    }
    const newName = file.name.replace(/\.(heic|heif)$/i, '.jpg');
    return new File([jpgBlob], newName, { type: 'image/jpeg', lastModified: file.lastModified });
  } catch (err) {
    console.error('HEIC conversion FAILED for', file.name, err);
    // Throw so the queue item shows the error instead of silently uploading an unviewable HEIC
    throw new Error('HEIC conversion failed: ' + (err.message || err));
  }
}

// Run async tasks in parallel batches of `concurrency` size.
// Returns results array in original order.
async function runParallel(items, concurrency, taskFn) {
  const results = new Array(items.length);
  let nextIdx = 0;
  async function worker() {
    while (true) {
      const i = nextIdx++;
      if (i >= items.length) return;
      results[i] = await taskFn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ========== Upload queue with progress tiles, auto-retry, and crash recovery ==========

const UPLOAD_QUEUE_KEY = 'jg_upload_queue_v1';
const MAX_AUTO_RETRIES = 3;
const UPLOAD_CONCURRENCY = 5;

function loadUploadQueue() {
  try {
    const raw = localStorage.getItem(UPLOAD_QUEUE_KEY);
    state.uploadQueue = raw ? JSON.parse(raw) : [];
  } catch (e) { state.uploadQueue = []; }
  // Clean entries that are 'done' (no need to surface those) or older than 24h
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  state.uploadQueue = (state.uploadQueue || []).filter(q =>
    q.status !== 'done' && (q.createdAt || 0) > cutoff
  );
  // Mark in-flight items as 'failed' on load — they were killed by page close.
  // We have no File for them so user must re-pick.
  state.uploadQueue.forEach(q => {
    if (q.status === 'queued' || q.status === 'converting' || q.status === 'uploading') {
      q.status = 'failed';
      q.lastError = 'Page closed mid-upload — file must be re-picked';
      q.lost = true;
    }
  });
  saveUploadQueue();
}

function saveUploadQueue() {
  try {
    localStorage.setItem(UPLOAD_QUEUE_KEY, JSON.stringify(state.uploadQueue || []));
  } catch (e) { /* quota or disabled — non-fatal */ }
}

function updateQueueItem(id, patch) {
  const item = state.uploadQueue.find(q => q.id === id);
  if (!item) return;
  Object.assign(item, patch);
  saveUploadQueue();
  renderUploadTiles();
}

function removeQueueItem(id) {
  state.uploadQueue = state.uploadQueue.filter(q => q.id !== id);
  if (state.uploadQueueFiles) state.uploadQueueFiles.delete(id);
  saveUploadQueue();
  renderUploadTiles();
}

function clearDoneQueueItems() {
  state.uploadQueue = (state.uploadQueue || []).filter(q => q.status !== 'done');
  saveUploadQueue();
  renderUploadTiles();
}

// Render tiles for queued/in-progress/failed uploads above the Recent Uploads grid.
// 'done' tiles fade out and self-remove after a moment.
function renderUploadTiles() {
  const host = document.getElementById('upload_tiles_host');
  if (!host) return;
  const items = (state.uploadQueue || []).filter(q =>
    q.projectId === state.activeProjectId && q.status !== 'done'
  );
  if (!items.length) {
    host.innerHTML = '';
    return;
  }
  const counts = {
    uploading: items.filter(q => q.status === 'uploading' || q.status === 'converting' || q.status === 'queued').length,
    failed: items.filter(q => q.status === 'failed').length,
  };
  host.innerHTML = `
    <div class="upload-tile-strip">
      <div class="upload-tile-strip-head">
        <span>Upload queue</span>
        <span class="upload-tile-counts">
          ${counts.uploading ? `<span class="upload-tile-count uploading">${counts.uploading} in progress</span>` : ''}
          ${counts.failed ? `<span class="upload-tile-count failed">${counts.failed} failed</span>` : ''}
        </span>
        ${counts.failed ? `<button class="upload-tile-retry-all" id="upload_retry_all">Retry all failed</button>` : ''}
        <button class="upload-tile-clear" id="upload_clear_done">Clear done</button>
      </div>
      <div class="upload-tiles">
        ${items.map(q => {
          const statusLabel = {
            queued: 'Queued',
            converting: 'Converting…',
            uploading: `Uploading… ${q.attempts > 0 ? '(retry ' + q.attempts + ')' : ''}`,
            failed: q.lost ? 'File lost' : 'Failed',
          }[q.status] || q.status;
          const cls = `upload-tile upload-tile-${q.status}`;
          const ext = (q.filename.split('.').pop() || '').toLowerCase();
          const icon = ['jpg','jpeg','png','gif','webp','heic','heif'].includes(ext) ? '📷'
                     : ext === 'pdf' ? '📕' : '📄';
          return `
            <div class="${cls}" data-q-id="${esc(q.id)}">
              <div class="upload-tile-icon">${icon}</div>
              <div class="upload-tile-name" title="${esc(q.filename)}">${esc(q.filename)}</div>
              <div class="upload-tile-status">${statusLabel}</div>
              ${q.status === 'failed' && q.lastError ? `<div class="upload-tile-err" title="${esc(q.lastError)}">${esc(q.lastError.slice(0, 60))}</div>` : ''}
              <div class="upload-tile-actions">
                ${q.status === 'failed' && !q.lost ? `<button class="upload-tile-btn retry" data-q-id="${esc(q.id)}">↻ Retry</button>` : ''}
                ${q.status === 'failed' && q.lost ? `<button class="upload-tile-btn repick" data-q-id="${esc(q.id)}" data-filename="${esc(q.filename)}" data-category="${esc(q.category)}">📂 Re-pick</button>` : ''}
                ${(q.status === 'failed' || q.status === 'queued') ? `<button class="upload-tile-btn dismiss" data-q-id="${esc(q.id)}">✕</button>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;

  // Wire actions
  document.getElementById('upload_clear_done')?.addEventListener('click', () => {
    state.uploadQueue = (state.uploadQueue || []).filter(q =>
      q.status === 'uploading' || q.status === 'queued' || q.status === 'converting'
    );
    saveUploadQueue();
    renderUploadTiles();
  });
  document.getElementById('upload_retry_all')?.addEventListener('click', retryAllFailed);
  host.querySelectorAll('.upload-tile-btn.retry').forEach(btn => {
    btn.addEventListener('click', () => retryQueueItem(btn.dataset.qId));
  });
  host.querySelectorAll('.upload-tile-btn.dismiss').forEach(btn => {
    btn.addEventListener('click', () => removeQueueItem(btn.dataset.qId));
  });
  host.querySelectorAll('.upload-tile-btn.repick').forEach(btn => {
    btn.addEventListener('click', () => repickQueueItem(btn.dataset.qId));
  });
}

function repickQueueItem(id) {
  const item = state.uploadQueue.find(q => q.id === id);
  if (!item) return;
  // Open a file picker. Whatever user picks replaces this slot.
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.style.display = 'none';
  document.body.appendChild(inp);
  inp.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) { inp.remove(); return; }
    if (!state.uploadQueueFiles) state.uploadQueueFiles = new Map();
    state.uploadQueueFiles.set(id, file);
    item.filename = file.name;
    item.size = file.size;
    item.status = 'queued';
    item.attempts = 0;
    item.lastError = null;
    item.lost = false;
    saveUploadQueue();
    renderUploadTiles();
    processQueueItem(id);
    inp.remove();
  });
  inp.click();
}

async function retryAllFailed() {
  const failed = state.uploadQueue.filter(q => q.status === 'failed' && !q.lost);
  for (const q of failed) {
    q.status = 'queued';
    q.attempts = 0;
    q.lastError = null;
  }
  saveUploadQueue();
  renderUploadTiles();
  // Kick off processing — runQueue handles concurrency
  runQueue();
}

async function retryQueueItem(id) {
  const item = state.uploadQueue.find(q => q.id === id);
  if (!item || item.lost) return;
  item.status = 'queued';
  item.attempts = 0;
  item.lastError = null;
  saveUploadQueue();
  renderUploadTiles();
  processQueueItem(id);
}

// Process a single queue item. Handles HEIC conversion + upload + retries.
async function processQueueItem(id) {
  const item = state.uploadQueue.find(q => q.id === id);
  if (!item) return;
  if (!state.uploadQueueFiles) state.uploadQueueFiles = new Map();
  let file = state.uploadQueueFiles.get(id);
  if (!file) {
    updateQueueItem(id, { status: 'failed', lost: true, lastError: 'File not available' });
    return;
  }

  while (true) {
    try {
      // HEIC conversion if needed
      const isHeic = /\.(heic|heif)$/i.test(file.name || '');
      if (isHeic) {
        updateQueueItem(id, { status: 'converting' });
        file = await convertHeicIfNeeded(file);
        state.uploadQueueFiles.set(id, file);
        updateQueueItem(id, { filename: file.name });
      }

      // Upload
      updateQueueItem(id, { status: 'uploading' });
      const doc = await uploadDocument(file, item.category, /* skipPush */ true);
      if (!doc) throw new Error('Upload returned no document');

      // Success
      updateQueueItem(id, { status: 'done', documentId: doc.id });
      // Background-push to Albi (non-blocking)
      pushDocumentToAlbi(doc);
      // Drop the File from memory now that it's safely uploaded
      state.uploadQueueFiles.delete(id);
      return;
    } catch (err) {
      const msg = err?.message || String(err);
      const currentAttempts = (state.uploadQueue.find(q => q.id === id)?.attempts) || 0;
      if (currentAttempts < MAX_AUTO_RETRIES) {
        // Backoff: 1s, 2s, 4s
        const wait = 1000 * Math.pow(2, currentAttempts);
        updateQueueItem(id, { attempts: currentAttempts + 1, lastError: msg + ' — retrying' });
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      updateQueueItem(id, { status: 'failed', lastError: msg });
      return;
    }
  }
}

// Run all queued items with concurrency limit
let _queueRunning = false;
async function runQueue() {
  if (_queueRunning) return;
  _queueRunning = true;
  try {
    while (true) {
      const queued = state.uploadQueue.filter(q => q.status === 'queued' && q.projectId === state.activeProjectId);
      if (!queued.length) break;
      const batch = queued.slice(0, UPLOAD_CONCURRENCY);
      await Promise.all(batch.map(q => processQueueItem(q.id)));
    }
    // After queue drains, refresh the document grid
    await loadDocuments();
    renderDetail();
  } finally {
    _queueRunning = false;
  }
}

// Public entry — replaces the old uploadFilesToCategory
async function uploadFilesToCategory(files, category) {
  if (!files || !files.length) return;
  if (!state.uploadQueueFiles) state.uploadQueueFiles = new Map();

  // Add each file to the queue
  for (const f of files) {
    const id = (crypto.randomUUID ? crypto.randomUUID() : `q_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    state.uploadQueue.push({
      id,
      projectId: state.activeProjectId,
      category,
      filename: f.name,
      size: f.size,
      status: 'queued',
      attempts: 0,
      lastError: null,
      createdAt: Date.now(),
    });
    state.uploadQueueFiles.set(id, f);
  }
  saveUploadQueue();
  renderUploadTiles();
  runQueue();
}

async function uploadDocument(file, category, skipPush) {
  if (!sb || !state.activeProjectId) throw new Error('No active project / Supabase client');
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `projects/${state.activeProjectId}/${Date.now()}-${safeName}`;

  // Force a real MIME type — iOS often gives empty file.type, which causes the browser
  // to store octet-stream and serve as a download instead of displaying inline.
  const detectedType = (file.type && file.type !== 'application/octet-stream')
    ? file.type
    : mimeFromFilename(file.name);

  const { error: upErr } = await sb.storage.from('rebuild-documents').upload(path, file, {
    contentType: detectedType,
    upsert: false,
  });
  if (upErr) throw new Error(upErr.message);

  const { data: urlData } = sb.storage.from('rebuild-documents').getPublicUrl(path);
  const fileUrl = urlData.publicUrl;

  // Photos category — enrich with EXIF / GPS / auto-stage / auto-phase
  let photoFields = {};
  if (category === 'Photos' && /^image\//i.test(file.type || '')) {
    const exif = await extractExifBasics(file);
    let lat = exif.lat, lng = exif.lng, acc = exif.accuracy;
    if (lat == null || lng == null) {
      const live = await getCurrentLocation();
      if (live) { lat = live.lat; lng = live.lng; acc = live.accuracy; }
    }
    const phaseId = defaultPhaseIdForProject();
    const phaseName = phaseId ? state.phases.find(p => p.id === phaseId)?.phase_name : null;
    photoFields = {
      stage: defaultStageForProject(),
      phase_id: phaseId,
      phase_name: phaseName,
      taken_at: exif.takenAt || new Date().toISOString(),
      latitude: lat,
      longitude: lng,
      gps_accuracy_meters: acc,
      device_label: navigator.userAgent.slice(0, 200),
    };
  }

  const { data: inserted, error: insErr } = await sb.from('rebuild_documents').insert({
    project_id: state.activeProjectId,
    category,
    filename: file.name,
    file_url: fileUrl,
    file_size_bytes: file.size,
    mime_type: file.type || null,
    uploaded_by_email: state.pmEmail,
    push_status: 'pending',
    ...photoFields,
  }).select();

  if (insErr) throw new Error('DB save failed: ' + insErr.message);

  // Skip push when caller (batch upload) handles it
  if (!skipPush) {
    toast(`${file.name} uploaded`);
    await loadDocuments();
    renderDetail();
    pushDocumentToAlbi(inserted[0]);
  }
  return inserted[0];
}

async function pushDocumentBatchToAlbi(docs, category) {
  if (!docs || !docs.length) return;
  if (!ALBI_DOC_BATCH_HOOK || ALBI_DOC_BATCH_HOOK.startsWith('REPLACE_')) {
    for (const d of docs) {
      await sb.from('rebuild_documents').update({ push_status: 'skipped' }).eq('id', d.id);
    }
    return;
  }
  const p = state.activeProject;
  try {
    await fetch(ALBI_DOC_BATCH_HOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batch: true,
        project_id: p.id,
        albi_project_id: p.albi_project_id,
        albi_job_number: p.albi_job_number,
        category,
        file_count: docs.length,
        // Comma-separated URLs and filenames for simple Zap iteration
        file_urls: docs.map(d => d.file_url).join(','),
        filenames: docs.map(d => d.filename).join(','),
        // Also send as array for Zaps that prefer structured input
        files: docs.map(d => ({
          document_id: d.id,
          filename: d.filename,
          file_url: d.file_url,
          mime_type: d.mime_type,
        })),
        notes: `JG Platform: ${docs.length} files uploaded under "${category}"`,
      }),
      mode: 'no-cors',
    });
    // Mark all docs as sent
    const ids = docs.map(d => d.id);
    await sb.from('rebuild_documents').update({
      push_status: 'sent',
      pushed_to_albi_at: new Date().toISOString(),
    }).in('id', ids);
  } catch (e) {
    console.error('Albi batch push failed:', e);
    const ids = docs.map(d => d.id);
    await sb.from('rebuild_documents').update({ push_status: 'failed' }).in('id', ids);
  }
  await loadDocuments();
  if (state.tab === 'documents') renderDetail();
}

async function pushDocumentToAlbi(doc) {
  if (!doc) return;
  if (!ALBI_DOC_HOOK || ALBI_DOC_HOOK.startsWith('REPLACE_')) {
    // Hook not configured — mark as skipped silently
    await sb.from('rebuild_documents').update({ push_status: 'skipped' }).eq('id', doc.id);
    return;
  }
  const p = state.activeProject;
  try {
    await fetch(ALBI_DOC_HOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document_id: doc.id,
        project_id: p.id,
        albi_project_id: p.albi_project_id,
        albi_job_number: p.albi_job_number,
        category: doc.category,
        filename: doc.filename,
        file_url: doc.file_url,
        mime_type: doc.mime_type,
        notes: `JG Platform: uploaded under "${doc.category}"`,
      }),
      mode: 'no-cors',
    });
    await sb.from('rebuild_documents').update({
      push_status: 'sent',
      pushed_to_albi_at: new Date().toISOString(),
    }).eq('id', doc.id);
  } catch (e) {
    console.error('Albi push failed:', e);
    await sb.from('rebuild_documents').update({ push_status: 'failed' }).eq('id', doc.id);
  }
  await loadDocuments();
  if (state.tab === 'documents') renderDetail();
}

function openDocPickerModal(onPick) {
  const docs = state.documents || [];
  let modal = document.getElementById('modalDocPicker');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modalDocPicker';
    modal.className = 'modal-back';
    modal.innerHTML = `
      <div class="modal" style="max-width:680px;">
        <h3>Pick from Documents <button class="close" data-close>×</button></h3>
        <div class="modal-body" id="dpkBody"></div>
        <div class="modal-foot">
          <span id="dpkSel" style="font-size:11px;color:var(--muted);flex:1;">0 selected</span>
          <button class="btn" data-close>Cancel</button>
          <button class="btn primary" id="dpkAttach">Attach Selected</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => modal.classList.remove('on')));
  }

  const body = modal.querySelector('#dpkBody');
  if (!docs.length) {
    body.innerHTML = '<div class="empty" style="padding:30px;">No documents uploaded to this project yet.</div>';
  } else {
    // Group by category
    const grouped = {};
    for (const cat of DOC_CATEGORIES) grouped[cat] = [];
    for (const d of docs) (grouped[d.category] = grouped[d.category] || []).push(d);
    body.innerHTML = DOC_CATEGORIES.filter(c => grouped[c]?.length).map(cat => `
      <div style="margin-bottom:14px;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--muted);letter-spacing:.4px;margin-bottom:6px;">${cat}</div>
        ${grouped[cat].map(d => {
          const isImage = /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(d.filename);
          const isPdf = /\.pdf$/i.test(d.filename);
          const thumb = isImage
            ? `<img src="${d.file_url}" style="width:36px;height:36px;object-fit:cover;border-radius:4px;border:1px solid var(--line);">`
            : `<div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:20px;background:#fff;border:1px solid var(--line);border-radius:4px;">${isPdf ? '📕' : '📄'}</div>`;
          return `
            <label class="dpk-item" data-id="${d.id}" style="display:flex;align-items:center;gap:10px;padding:8px;border-radius:5px;cursor:pointer;font-size:13px;">
              <input type="checkbox" value="${d.id}" style="width:auto;margin:0;">
              ${thumb}
              <span style="flex:1;color:var(--navy);">${d.filename}</span>
              <span style="font-size:11px;color:var(--muted);">${d.file_size_bytes ? (d.file_size_bytes/1024).toFixed(0) + ' KB' : ''}</span>
            </label>`;
        }).join('')}
      </div>
    `).join('');

    const selCount = modal.querySelector('#dpkSel');
    body.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.addEventListener('change', () => {
      const n = body.querySelectorAll('input[type="checkbox"]:checked').length;
      selCount.textContent = `${n} selected`;
    }));
  }

  // Replace attach handler
  const attachBtn = modal.querySelector('#dpkAttach');
  const newBtn = attachBtn.cloneNode(true);
  attachBtn.parentNode.replaceChild(newBtn, attachBtn);
  newBtn.addEventListener('click', () => {
    const ids = [...body.querySelectorAll('input:checked')].map(i => i.value);
    const picked = docs.filter(d => ids.includes(d.id));
    modal.classList.remove('on');
    onPick(picked);
  });

  modal.classList.add('on');
}
