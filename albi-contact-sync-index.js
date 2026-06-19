/**
 * jg-albi-contact-sync — fetches a project's contacts from Albi and
 * upserts them into rebuild_project_albi_contacts so the rebuild app's
 * relationships tab can render the full list.
 *
 * Endpoint:
 *   POST /sync       — body: { project_id?: uuid, albi_project_id?: string }
 *                      — accepts either the rebuild_projects.id (UUID) or
 *                        the Albi uniqueNumber. Looks up the missing one
 *                        in Supabase as needed.
 *
 * Auth: X-API-Key header matching MAILER_API_KEY (uniform with the other
 * platform workers — one key to rotate, not five).
 *
 * Behavior:
 *   1. Resolve to (rebuild_project_id, albi_project_id) pair via Supabase
 *   2. Call Albi's contacts endpoint — tries two likely paths and uses
 *      whichever responds. Logs which one worked.
 *   3. Normalize Albi's response into the rebuild_project_albi_contacts
 *      schema. Anything unexpected goes into `raw` jsonb for inspection.
 *   4. Upsert rows on (project_id, albi_contact_id). Idempotent.
 *   5. Optionally delete-missing — if `prune=true`, contacts that exist in
 *      our mirror but NOT in Albi's latest response are removed (handles
 *      contacts deleted on the Albi side).
 *   6. Return sync stats.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Supabase helpers
// ────────────────────────────────────────────────────────────────────────────

async function sb(env, path, opts = {}) {
  const url = `${env.SUPABASE_URL}/rest/v1${path}`;
  const r = await fetch(url, {
    ...opts,
    headers: {
      'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`Supabase ${r.status}: ${txt}`);
  }
  return r.status === 204 ? null : await r.json();
}

async function resolveProject(env, { project_id, albi_project_id }) {
  // Need both the rebuild UUID and the Albi uniqueNumber — caller may have
  // passed either. If neither, error.
  if (!project_id && !albi_project_id) {
    throw new Error('Must provide project_id or albi_project_id');
  }
  let filter;
  if (project_id) filter = `id=eq.${encodeURIComponent(project_id)}`;
  else filter = `albi_project_id=eq.${encodeURIComponent(albi_project_id)}`;

  const rows = await sb(env, `/rebuild_projects?${filter}&select=id,albi_project_id,albi_job_number&limit=1`);
  if (!rows || !rows.length) {
    throw new Error('Project not found in rebuild_projects');
  }
  return rows[0];
}

// ────────────────────────────────────────────────────────────────────────────
// Albi fetch — try the two most likely endpoint shapes. Whichever responds
// 2xx wins. Logs the chosen path so we can confirm in worker logs.
// ────────────────────────────────────────────────────────────────────────────

async function fetchAlbiContacts(env, albiProjectId) {
  const base = env.ALBI_API_BASE || 'https://api.albiware.com/v5';
  const candidates = [
    // Most likely: nested under the project resource (REST convention)
    `${base}/Integrations/Projects/${encodeURIComponent(albiProjectId)}/Contacts`,
    // Alternative: flat with query param (some Albi tenants expose this)
    `${base}/Integrations/Contacts?projectId=${encodeURIComponent(albiProjectId)}`,
  ];

  let lastErr = null;
  for (const url of candidates) {
    try {
      const r = await fetch(url, {
        headers: {
          'ApiKey': env.ALBI_API_KEY,
          'Accept': 'application/json',
        },
      });
      if (r.ok) {
        const body = await r.json();
        console.log(`Albi contacts fetched via ${url}`);
        // Some Albi endpoints return an array; some return { data: [...] }
        const list = Array.isArray(body) ? body : (Array.isArray(body.data) ? body.data : (Array.isArray(body.contacts) ? body.contacts : []));
        return { url, list, raw: body };
      }
      lastErr = `${url} → ${r.status} ${r.statusText}`;
    } catch (e) {
      lastErr = `${url} → ${e.message}`;
    }
  }
  throw new Error('All Albi contact endpoints failed. Last error: ' + lastErr);
}

// ────────────────────────────────────────────────────────────────────────────
// Normalize Albi's contact shape into our table schema. Albi field names
// vary — we coalesce across the most common ones and stash the full row
// in `raw` for forensic lookup.
// ────────────────────────────────────────────────────────────────────────────

function normalizeContact(c, projectId) {
  // Albi uses a mix of camelCase and PascalCase across endpoints. Pull each
  // value from any field that could plausibly hold it.
  const first = c.firstName || c.FirstName || c.first_name || '';
  const last = c.lastName || c.LastName || c.last_name || '';
  const fullName = (first + ' ' + last).trim() || c.name || c.Name || c.fullName || '';
  const companyName = c.companyName || c.CompanyName || c.organizationName || c.OrganizationName || c.company || '';
  const contactType = c.contactType || c.ContactType || c.type || (companyName && !fullName ? 'Organization' : 'Contact');
  const relType = c.relationship || c.Relationship || c.relationshipType || c.RelationshipType || c.role || c.Role || c.type || '';

  return {
    project_id: projectId,
    albi_contact_id: String(c.id || c.Id || c.uniqueNumber || c.UniqueNumber || c.contactId || c.ContactId || ''),
    contact_type: contactType,
    display_name: fullName || companyName || c.displayName || c.DisplayName || '(unnamed)',
    full_name: fullName || null,
    company_name: companyName || null,
    relationship_type: relType || null,
    email: c.email || c.Email || c.emailAddress || c.EmailAddress || null,
    phone: c.phone || c.Phone || c.phoneNumber || c.PhoneNumber || null,
    phone_secondary: c.phoneSecondary || c.PhoneSecondary || c.altPhone || c.AltPhone || null,
    address_line1: c.address1 || c.Address1 || c.addressLine1 || c.AddressLine1 || c.street || c.Street || null,
    address_line2: c.address2 || c.Address2 || c.addressLine2 || c.AddressLine2 || null,
    city: c.city || c.City || null,
    state: c.state || c.State || null,
    zip: c.zip || c.Zip || c.postalCode || c.PostalCode || null,
    is_primary: !!(c.isPrimary || c.IsPrimary || c.primary || c.Primary),
    notes: c.notes || c.Notes || null,
    raw: c,
    synced_at: new Date().toISOString(),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Upsert rows + optional prune of missing
// ────────────────────────────────────────────────────────────────────────────

async function syncContacts(env, projectId, normalizedRows, { prune = true } = {}) {
  // Filter out rows with no albi_contact_id (can't dedupe them) — log
  // count so we can spot if Albi is returning rows without identifiers.
  const valid = normalizedRows.filter(r => r.albi_contact_id);
  const dropped = normalizedRows.length - valid.length;
  if (dropped) console.warn(`Dropping ${dropped} rows with empty albi_contact_id`);

  if (!valid.length) {
    return { synced: 0, pruned: 0, dropped };
  }

  // Upsert via Prefer: resolution=merge-duplicates against the unique
  // constraint on (project_id, albi_contact_id).
  await sb(env, `/rebuild_project_albi_contacts`, {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(valid),
  });

  let pruned = 0;
  if (prune) {
    // Delete any rows in our mirror NOT present in this fresh fetch.
    // Handles Albi-side deletions cleanly. The IN-list approach uses a
    // NOT IN filter on PostgREST.
    const keepIds = valid.map(r => `"${r.albi_contact_id.replace(/"/g, '\\"')}"`).join(',');
    const url = `/rebuild_project_albi_contacts?project_id=eq.${projectId}&albi_contact_id=not.in.(${keepIds})`;
    const before = await sb(env, `${url}&select=id`);
    pruned = (before || []).length;
    if (pruned > 0) {
      await sb(env, url, { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } });
    }
  }

  return { synced: valid.length, pruned, dropped };
}

// ────────────────────────────────────────────────────────────────────────────
// Request handler
// ────────────────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'POST') return jsonResponse({ error: 'POST required' }, 405);

    if (request.headers.get('X-API-Key') !== env.MAILER_API_KEY) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const url = new URL(request.url);
    if (url.pathname !== '/sync') {
      return jsonResponse({ error: 'Unknown path. Use POST /sync' }, 404);
    }

    try {
      const body = await request.json();
      const prune = body.prune !== false; // default true

      // 1. Resolve project identifiers
      const project = await resolveProject(env, body);
      if (!project.albi_project_id) {
        return jsonResponse({ error: 'Project has no albi_project_id — cannot sync' }, 400);
      }

      // 2. Fetch contacts from Albi
      const { url: usedUrl, list, raw } = await fetchAlbiContacts(env, project.albi_project_id);

      // 3. Normalize
      const normalized = list.map(c => normalizeContact(c, project.id));

      // 4. Upsert + prune
      const stats = await syncContacts(env, project.id, normalized, { prune });

      return jsonResponse({
        ok: true,
        project_id: project.id,
        albi_project_id: project.albi_project_id,
        albi_job_number: project.albi_job_number,
        endpoint_used: usedUrl,
        fetched: list.length,
        ...stats,
        sample: list.slice(0, 1), // first row so we can spot-check the shape on first run
      });
    } catch (e) {
      console.error('sync error:', e.stack || e.message);
      return jsonResponse({ error: e.message }, 500);
    }
  },
};
