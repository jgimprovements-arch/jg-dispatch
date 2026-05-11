// /api/sync-albi-relationships.js
// Vercel serverless cron function — runs nightly to mirror Albi project relationships into Supabase.
//
// Setup:
//   1. Create a NEW Vercel project (e.g. "jg-relationships-cron"). Do NOT touch jg-proxy.
//   2. Drop this file at /api/sync-albi-relationships.js in the repo.
//   3. Add vercel.json (provided alongside this file) with a cron schedule.
//   4. Set these environment variables in Vercel:
//        SUPABASE_URL              = https://nuykvchgecpiuikoerze.supabase.co
//        SUPABASE_SERVICE_KEY      = (Supabase service role key — NOT the anon key)
//        ALBI_PROXY_BASE           = https://jg-proxy-v2.vercel.app/api/albi
//        CRON_SECRET               = any random string, used to gate manual triggers
//   5. Deploy. The cron runs at 4am Central daily (UTC offset baked into schedule).
//
// Manual trigger (for testing): GET /api/sync-albi-relationships?secret={CRON_SECRET}

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ALBI_PROXY_BASE = process.env.ALBI_PROXY_BASE || 'https://jg-proxy-v2.vercel.app/api/albi';
const CRON_SECRET = process.env.CRON_SECRET;

// NOTE: This is the EXPECTED shape of what the Albi proxy returns for relationships.
// The actual proxy endpoint and response shape need to be confirmed against the
// real Albi API. Update fetchAlbiRelationships() once you know the exact shape.

export default async function handler(req, res) {
  // Auth: either Vercel cron (verified via vercel-cron header) or manual with secret
  const isVercelCron = req.headers['user-agent']?.includes('vercel-cron');
  const querySecret = req.query?.secret;
  if (!isVercelCron && querySecret !== CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const stats = { projects: 0, fetched: 0, inserted: 0, updated: 0, deleted: 0, errors: [] };

  try {
    // 1. Get all active projects with an Albi ID
    const { data: projects, error: projErr } = await sb.from('rebuild_projects')
      .select('id, albi_project_id, albi_job_number')
      .not('albi_project_id', 'is', null);
    if (projErr) throw projErr;

    for (const project of projects || []) {
      stats.projects++;
      try {
        const albiRels = await fetchAlbiRelationships(project.albi_project_id);
        stats.fetched += albiRels.length;

        // Get existing JG records sourced from Albi for this project
        const { data: existing } = await sb.from('rebuild_project_relationships')
          .select('id, albi_relationship_id')
          .eq('project_id', project.id)
          .eq('source', 'albi')
          .is('deleted_at', null);

        const existingByAlbiId = new Map((existing || []).map(r => [r.albi_relationship_id, r.id]));
        const seenAlbiIds = new Set();

        for (const albiRel of albiRels) {
          seenAlbiIds.add(albiRel.albi_relationship_id);
          const payload = {
            project_id: project.id,
            source: 'albi',
            albi_relationship_id: albiRel.albi_relationship_id,
            albi_contact_id: albiRel.albi_contact_id || null,
            role: mapAlbiRoleToJG(albiRel.role),
            role_label: albiRel.role_label || null,
            display_name: albiRel.display_name,
            company: albiRel.company || null,
            email: albiRel.email || null,
            phone: albiRel.phone || null,
            phone_secondary: albiRel.phone_secondary || null,
            is_primary: !!albiRel.is_primary,
            last_synced_at: new Date().toISOString(),
            push_status: 'synced',
            push_error: null,
          };

          if (existingByAlbiId.has(albiRel.albi_relationship_id)) {
            // Update existing
            const id = existingByAlbiId.get(albiRel.albi_relationship_id);
            const { error } = await sb.from('rebuild_project_relationships')
              .update(payload).eq('id', id);
            if (error) stats.errors.push(`Update fail: ${error.message}`);
            else stats.updated++;
          } else {
            // Insert new
            const { error } = await sb.from('rebuild_project_relationships').insert(payload);
            if (error) stats.errors.push(`Insert fail: ${error.message}`);
            else stats.inserted++;
          }
        }

        // Soft-delete Albi-sourced relationships that no longer exist in Albi
        for (const [albiId, jgId] of existingByAlbiId.entries()) {
          if (!seenAlbiIds.has(albiId)) {
            await sb.from('rebuild_project_relationships')
              .update({ deleted_at: new Date().toISOString() })
              .eq('id', jgId);
            stats.deleted++;
          }
        }
      } catch (e) {
        stats.errors.push(`Project ${project.albi_job_number}: ${e.message}`);
      }
    }

    return res.status(200).json({ success: true, stats });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, stats });
  }
}

async function fetchAlbiRelationships(albiProjectId) {
  // ⚠ The exact proxy URL and response shape are placeholders.
  // Confirm the actual endpoint with the proxy owner. Likely something like:
  //   GET {ALBI_PROXY_BASE}/projects/{id}/relationships
  // The proxy already authenticates with Albi; we just relay the response.
  const url = `${ALBI_PROXY_BASE}/projects/${albiProjectId}/relationships`;
  const resp = await fetch(url, { method: 'GET' });
  if (!resp.ok) throw new Error(`Albi proxy ${resp.status} ${resp.statusText}`);
  const json = await resp.json();
  // Normalize — expected shape per relationship:
  //   { id, contact_id, role, role_label, name, company, email, phone, phone_secondary, is_primary }
  // Adjust this mapping to match what the proxy actually returns.
  return (json.relationships || json.data || json || []).map(r => ({
    albi_relationship_id: String(r.id || r.relationship_id),
    albi_contact_id: r.contact_id ? String(r.contact_id) : null,
    role: r.role || r.relationship_type || 'other',
    role_label: r.role_label || r.label || null,
    display_name: r.name || r.display_name || `${r.first_name || ''} ${r.last_name || ''}`.trim(),
    company: r.company || r.organization || null,
    email: r.email || null,
    phone: r.phone || r.phone_primary || null,
    phone_secondary: r.phone_secondary || r.phone_alt || null,
    is_primary: !!(r.is_primary || r.primary),
  }));
}

// Map Albi's role strings to JG's enum values
function mapAlbiRoleToJG(albiRole) {
  if (!albiRole) return 'other';
  const r = String(albiRole).toLowerCase().replace(/[\s-]+/g, '_');
  const map = {
    'customer': 'customer',
    'home_owner': 'customer',
    'homeowner': 'customer',
    'insurance_adjuster': 'insurance_adjuster',
    'adjuster': 'insurance_adjuster',
    'insurance_carrier': 'insurance_carrier_rep',
    'carrier': 'insurance_carrier_rep',
    'public_adjuster': 'public_adjuster',
    'real_estate_agent': 'real_estate_agent',
    'realtor': 'real_estate_agent',
    'agent': 'real_estate_agent',
    'lender': 'lender',
    'mortgage_company': 'mortgage_company',
    'mortgage': 'mortgage_company',
    'property_manager': 'property_manager',
    'attorney': 'attorney',
    'lawyer': 'attorney',
  };
  return map[r] || 'other';
}
