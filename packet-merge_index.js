// packet-merge/src/index.js
// Cloudflare Worker — merges Contract + SOV + Xactimate PDFs into a single
// signed-packet PDF, uploads to Supabase storage, returns the public URL.
//
// Replaces the broken Vercel /api/packet-merge endpoint.

import { PDFDocument } from 'pdf-lib';

// ─── CORS ────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://jgimprovements-arch.github.io',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function preflight(request) {
  if (request.method !== 'OPTIONS') return null;
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

function jsonResponse(request, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  });
}

// ─── Supabase upload ─────────────────────────────────────────────────────
async function uploadPdfToStorage(env, path, bytes) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  const uploadUrl = `${env.SUPABASE_URL}/storage/v1/object/rebuild-documents/${path}`;
  const r = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/pdf',
      'x-upsert': 'false',
    },
    body: bytes,
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Storage upload failed (${r.status}): ${txt}`);
  }
  return `${env.SUPABASE_URL}/storage/v1/object/public/rebuild-documents/${path}`;
}

// ─── PDF helpers ─────────────────────────────────────────────────────────
async function fetchPdfBytes(url) {
  if (!url) throw new Error('PDF URL missing');
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch failed (${r.status}) for ${url}`);
  return new Uint8Array(await r.arrayBuffer());
}

async function mergePdfs(contractBytes, sovBytes, xactBytes) {
  const merged = await PDFDocument.create();
  merged.setTitle('JG Restoration — Contract Packet');
  merged.setProducer('JG Platform');
  merged.setCreator('jg-workers/packet-merge');
  merged.setCreationDate(new Date());

  // Order: Contract (legal terms — includes inline draw schedule) → SOV
  // standalone (optional — historically appended; now skippable since the
  // contract itself contains the SOV draw table) → Xact (line detail).
  // Pass sovBytes = null to skip the standalone SOV page entirely.
  const sources = [
    { bytes: contractBytes, label: 'Contract', required: true  },
    { bytes: sovBytes,      label: 'SOV',      required: false },
    { bytes: xactBytes,     label: 'Xactimate', required: true },
  ];

  for (const src of sources) {
    // Skip optional sources when the caller passed null/empty.
    if (!src.bytes || src.bytes.length === 0) {
      if (src.required) {
        throw new Error(`Empty PDF: ${src.label}`);
      }
      continue;
    }
    let doc;
    try {
      doc = await PDFDocument.load(src.bytes, { ignoreEncryption: true });
    } catch (e) {
      throw new Error(`${src.label} PDF could not be parsed: ${e.message}`);
    }
    const indices = doc.getPageIndices();
    const copied = await merged.copyPages(doc, indices);
    copied.forEach(p => merged.addPage(p));
  }

  const pageCount = merged.getPageCount();
  const bytes = await merged.save({ useObjectStreams: false });
  return { bytes, pageCount };
}

export default {
  async fetch(request, env, ctx) {
    const pre = preflight(request);
    if (pre) return pre;

    if (request.method !== 'POST') {
      return jsonResponse(request, { ok: false, error: 'POST only' }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return jsonResponse(request, { ok: false, error: 'Invalid JSON body' }, 400);
    }

    const { packet_id, project_id, xact_pdf_url, sov_pdf_url, contract_pdf_url, albi_job_number } = body || {};

    if (!packet_id || !project_id) {
      return jsonResponse(request, { ok: false, error: 'packet_id and project_id required' }, 400);
    }
    // contract_pdf_url and xact_pdf_url are required; sov_pdf_url is optional
    // (the contract template already includes the SOV draw schedule inline).
    if (!xact_pdf_url || !contract_pdf_url) {
      return jsonResponse(request, {
        ok: false,
        error: 'xact_pdf_url and contract_pdf_url required',
      }, 400);
    }
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse(request, { ok: false, error: 'Supabase env vars missing' }, 500);
    }

    try {
      // Fetch the two required PDFs in parallel; SOV only if URL provided.
      const [contractBytes, xactBytes, sovBytes] = await Promise.all([
        fetchPdfBytes(contract_pdf_url),
        fetchPdfBytes(xact_pdf_url),
        sov_pdf_url ? fetchPdfBytes(sov_pdf_url) : Promise.resolve(null),
      ]);

      const { bytes, pageCount } = await mergePdfs(contractBytes, sovBytes, xactBytes);

      const safeJob = (albi_job_number || project_id).replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `projects/${project_id}/packets/${packet_id}-${safeJob}-packet.pdf`;
      const merged_pdf_url = await uploadPdfToStorage(env, storagePath, bytes);

      return jsonResponse(request, {
        ok: true,
        merged_pdf_url,
        page_count: pageCount,
        byte_size: bytes.length,
      });
    } catch (err) {
      console.error('packet-merge error:', err.stack || err.message || err);
      return jsonResponse(request, { ok: false, error: err.message || String(err) }, 500);
    }
  },
};
