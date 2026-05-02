// ─────────────────────────────────────────────────────────────────────────
// Albi → Supabase referral sync
// ─────────────────────────────────────────────────────────────────────────
// Pulls projects from Albi for both JG markets, extracts the "Referrer"
// relationship, looks up the matching partner in sales_partners by
// albi_contact_id, and upserts a row in albi_referrals.
//
// Triggered by:
//   - Vercel cron (nightly, see vercel.json)        →  trigger: 'cron'
//   - Manual button on the sales dashboard          →  trigger: 'manual'
//
// Idempotent: re-running the sync is safe. Uses ON CONFLICT on the
// (albi_project_id, albi_referrer_contact_id) unique constraint.
// ─────────────────────────────────────────────────────────────────────────

const ALBI_PROXY_URL = process.env.ALBI_PROXY_URL || 'https://jg-proxy-v2.vercel.app/api/albi';
const SUPABASE_URL   = process.env.SUPABASE_URL   || 'https://nuykvchgecpiuikoerze.supabase.co';
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

const JG_LOCATIONS = [
  { id: 222,  name: 'Appleton' },
  { id: 1477, name: 'Stevens Point' }
];

// How many days back to scan on each run. The unique constraint makes
// re-running safe, so a wide window has no downside other than runtime.
// 90 days catches recent jobs without blowing the function budget.
const SYNC_LOOKBACK_DAYS = 90;

// Albi relationship "type" string that identifies a referrer. Albi labels
// these as "Referrer" in the UI (confirmed via Gray-2943-WTR audit).
const REFERRER_RELATIONSHIP_TYPE = 'Referrer';

// ─────────────────────────────────────────────────────────────────────────
// Vercel handler
// ─────────────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  // CORS — allow the dashboard to call this from the browser
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!SUPABASE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY env var not set' });
  }

  // Detect trigger source. Cron jobs hit this with GET (Vercel cron uses GET);
  // manual refresh from the dashboard uses POST with { trigger: 'manual' }.
  const body = req.body || {};
  const trigger     = body.trigger     || (req.method === 'GET' ? 'cron' : 'manual');
  const triggeredBy = body.triggeredBy || (trigger === 'cron' ? 'cron' : 'unknown');
  const marketFilter = body.market || 'Both';  // 'Appleton' | 'Stevens Point' | 'Both'

  const startedAt = new Date();
  const t0 = Date.now();

  // 1. Open the sync log row right away so we always have a record, even if
  //    something below fails partway through.
  const logId = await sbInsert('albi_referral_sync_log', {
    started_at: startedAt.toISOString(),
    trigger,
    triggered_by: triggeredBy,
    market: marketFilter,
    status: 'running'
  });

  // Counters
  let projectsScanned    = 0;
  let referralsInserted  = 0;
  let referralsUpdated   = 0;
  let referralsUnmatched = 0;
  let errorMessage       = null;

  try {
    // 2. Build the list of locations to scan based on marketFilter
    const locsToScan = marketFilter === 'Both'
      ? JG_LOCATIONS
      : JG_LOCATIONS.filter(l => l.name === marketFilter);

    if (!locsToScan.length) {
      throw new Error(`Unknown market filter: ${marketFilter}`);
    }

    // 3. Pre-load partner→albi_contact_id index. One DB call instead of
    //    one-per-referral. Critical for performance.
    const partnersByAlbiId = await loadPartnerIndex();

    // 4. Loop locations → projects → relationships
    const sinceISO = new Date(Date.now() - SYNC_LOOKBACK_DAYS * 86400000).toISOString();

    for (const loc of locsToScan) {
      const projects = await fetchProjects(loc.id, sinceISO);
      projectsScanned += projects.length;

      // Process each project
      for (const proj of projects) {
        const projectId   = String(proj.id || proj._id || '');
        const projectCode = proj.jobNumber || proj.projectCode || proj.code || null;
        const projectVal  = extractRevenue(proj);
        const projStatus  = proj.status || proj.projectStatus || null;
        const lossType    = proj.lossType || proj.type || null;
        const createdDate = formatDate(proj.dateCreated || proj.createdAt || proj.created_at);
        const closedDate  = formatDate(proj.dateClosed  || proj.closedAt  || proj.closed_at);

        if (!projectId) continue;

        // Get relationships — Albi may return these inline on the project, or
        // require a separate fetch. Try inline first.
        let relationships = proj.relationships || proj.contacts || [];
        if (!relationships.length) {
          try {
            relationships = await fetchProjectRelationships(projectId);
          } catch(e) {
            // Don't blow the whole sync over one project's relationship fetch
            console.error('relationships fetch failed for project ' + projectId, e.message);
            relationships = [];
          }
        }

        // Filter to Referrer-type relationships only
        const referrers = relationships.filter(rel => {
          const relType = String(rel.relationshipType || rel.type || rel.role || '').trim();
          // Match "Referrer" exactly, also tolerate "referrer" lowercase
          return relType.toLowerCase() === REFERRER_RELATIONSHIP_TYPE.toLowerCase();
        });

        // Upsert one albi_referrals row per referrer relationship
        for (const ref of referrers) {
          const refContactId = String(ref.contactId || ref.contact_id || ref.id || ref.referrerId || '');
          const refName      = ref.name || ref.contactName || ref.organizationName || null;
          const refPhone     = ref.phone || ref.phoneNumber || null;

          if (!refContactId) continue;

          // Match against sales_partners by albi_contact_id — deterministic
          const matchedPartner = partnersByAlbiId.get(refContactId);
          const partnerId      = matchedPartner ? matchedPartner.id : null;
          if (!partnerId) referralsUnmatched++;

          const upsertResult = await sbUpsert('albi_referrals',
            {
              albi_project_id:           projectId,
              albi_project_code:         projectCode,
              albi_referrer_contact_id:  refContactId,
              albi_referrer_name:        refName,
              albi_referrer_phone:       refPhone,
              referrer_partner_id:       partnerId,
              project_value:             projectVal,
              project_status:            projStatus,
              project_loss_type:         lossType,
              market:                    loc.name,
              project_created_date:      createdDate,
              project_closed_date:       closedDate,
              last_synced_at:            new Date().toISOString(),
              updated_at:                new Date().toISOString()
            },
            'albi_project_id,albi_referrer_contact_id'   // conflict target
          );
          if (upsertResult === 'inserted') referralsInserted++;
          else if (upsertResult === 'updated') referralsUpdated++;
        }
      }
    }

    // 5. Close the log row with the success summary
    await sbUpdate('albi_referral_sync_log', logId, {
      finished_at:           new Date().toISOString(),
      projects_scanned:      projectsScanned,
      referrals_inserted:    referralsInserted,
      referrals_updated:     referralsUpdated,
      referrals_unmatched:   referralsUnmatched,
      status:                'success',
      duration_ms:           Date.now() - t0
    });

    return res.status(200).json({
      ok: true,
      trigger,
      market: marketFilter,
      projects_scanned:    projectsScanned,
      referrals_inserted:  referralsInserted,
      referrals_updated:   referralsUpdated,
      referrals_unmatched: referralsUnmatched,
      duration_ms:         Date.now() - t0,
      log_id:              logId
    });

  } catch (err) {
    errorMessage = err && err.message ? err.message : String(err);
    console.error('Sync failed:', err);
    if (logId) {
      await sbUpdate('albi_referral_sync_log', logId, {
        finished_at:    new Date().toISOString(),
        status:         'error',
        error_message:  errorMessage,
        duration_ms:    Date.now() - t0,
        projects_scanned:    projectsScanned,
        referrals_inserted:  referralsInserted,
        referrals_updated:   referralsUpdated,
        referrals_unmatched: referralsUnmatched
      }).catch(()=>{});
    }
    return res.status(500).json({
      ok: false,
      error: errorMessage,
      partial: { projectsScanned, referralsInserted, referralsUpdated, referralsUnmatched }
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────
// Albi calls
// ─────────────────────────────────────────────────────────────────────────

async function fetchProjects(locationId, sinceISO) {
  // Try the Albi proxy with the same pattern existing platform code uses.
  // The proxy is responsible for the actual Albi API auth headers.
  const r = await fetch(ALBI_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'get_projects',
      locationId: locationId,
      modifiedSince: sinceISO,
      limit: 500
    })
  });
  if (!r.ok) {
    throw new Error(`Albi get_projects failed: ${r.status} ${await r.text()}`);
  }
  const data = await r.json();
  return data.projects || data.data || data.items || (Array.isArray(data) ? data : []);
}

async function fetchProjectRelationships(projectId) {
  const r = await fetch(ALBI_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'get_project_relationships',
      projectId: projectId
    })
  });
  if (!r.ok) return [];
  const data = await r.json();
  return data.relationships || data.contacts || data.data || (Array.isArray(data) ? data : []);
}

// ─────────────────────────────────────────────────────────────────────────
// Field extraction (Albi field names vary across versions)
// ─────────────────────────────────────────────────────────────────────────

function extractRevenue(project) {
  // Per Josh's instruction: "total invoiced amount on the project"
  // Try invoice-related fields first, then fall back to other totals.
  const candidates = [
    'totalInvoiced', 'invoicedAmount', 'invoiceTotal',
    'totalAmount', 'total', 'projectValue', 'amount'
  ];
  for (const k of candidates) {
    const v = project[k];
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const n = parseFloat(v.replace(/[^0-9.\-]/g, ''));
      if (!isNaN(n)) return n;
    }
  }
  return 0;
}

function formatDate(d) {
  if (!d) return null;
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return null;
    return dt.toISOString().slice(0, 10);  // YYYY-MM-DD
  } catch(e) { return null; }
}

// ─────────────────────────────────────────────────────────────────────────
// Supabase helpers (REST API — no JS client, keeps deps zero)
// ─────────────────────────────────────────────────────────────────────────

async function loadPartnerIndex() {
  // Pull every partner with an albi_contact_id and build a Map for O(1) lookup
  const r = await fetch(
    SUPABASE_URL + '/rest/v1/sales_partners?select=id,albi_contact_id&albi_contact_id=not.is.null&limit=20000',
    { headers: sbHeaders() }
  );
  if (!r.ok) throw new Error('partner index fetch failed: ' + r.status);
  const rows = await r.json();
  const map = new Map();
  for (const p of rows) {
    if (p.albi_contact_id) map.set(String(p.albi_contact_id), p);
  }
  return map;
}

async function sbInsert(table, body) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
    method: 'POST',
    headers: { ...sbHeaders(), 'Prefer': 'return=representation' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`Insert ${table} failed: ${r.status} ${await r.text()}`);
  const data = await r.json();
  return Array.isArray(data) && data[0] ? data[0].id : null;
}

async function sbUpdate(table, id, body) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: sbHeaders(),
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`Update ${table}/${id} failed: ${r.status} ${await r.text()}`);
  return true;
}

// Upsert returns 'inserted' or 'updated'. Uses Supabase's on_conflict feature
// with the resolution=merge-duplicates Prefer header.
async function sbUpsert(table, body, conflictTarget) {
  const url = SUPABASE_URL + '/rest/v1/' + table + '?on_conflict=' + encodeURIComponent(conflictTarget);
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      ...sbHeaders(),
      'Prefer': 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`Upsert ${table} failed: ${r.status} ${await r.text()}`);
  const data = await r.json();
  // Heuristic: if created_at == updated_at within ~5s, treat as new insert.
  // Not perfect but good enough for stat counters.
  if (Array.isArray(data) && data[0]) {
    const created = new Date(data[0].created_at).getTime();
    const updated = new Date(data[0].updated_at).getTime();
    return Math.abs(updated - created) < 5000 ? 'inserted' : 'updated';
  }
  return 'updated';
}

function sbHeaders() {
  return {
    'apikey':        SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type':  'application/json'
  };
}
