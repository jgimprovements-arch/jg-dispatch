// render-contract/src/index.js
// Cloudflare Worker — generates a JG Restoration contract PDF from the
// attorney-reviewed HTML template by injecting customer data, project
// details, financial summary, and draw schedule via headless Chrome
// (Cloudflare Browser Rendering).
//
// Replaces the broken Vercel /api/render-contract endpoint.
//
// All shared utilities are inlined to keep this folder self-contained for
// Cloudflare's monorepo deployment pattern (Git → root_dir = render-contract).

import puppeteer from '@cloudflare/puppeteer';
import { CONTRACT_TEMPLATE_HTML } from './template.js';

// ─── CORS (inlined) ──────────────────────────────────────────────────────
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

// ─── Supabase REST helper (inlined) ──────────────────────────────────────
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

// ─── Field IDs the template exposes ──────────────────────────────────────
// Must match JG_Contract_Template.html exactly. If the template adds/removes
// fields, update this list.
const FIELD_IDS = [
  'cover_owner_name', 'cover_project_site', 'cover_contract_date', 'cover_project_ref',
  'owner_name', 'owner_address', 'owner_phone', 'owner_email',
  'contract_price', 'sales_rep_name',
  'project_site_addr_1', 'project_site_addr_2',
  'commencement_date', 'completion_date',
  'cancellation_contract_date', 'guaranty_contract_date', 'guaranty_project_site',
  'other_incorporated_docs',
  'sov_project_ref', 'sov_contract_price', 'sov_source_estimate', 'sov_version_date',
  'sov_subtotal', 'sov_tax', 'sov_overhead', 'sov_profit', 'sov_exclusions',
];

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

    const { packet_id, project_id, fields, draws, xact_items } = body || {};
    if (!packet_id || !project_id) {
      return jsonResponse(request, { ok: false, error: 'packet_id and project_id required' }, 400);
    }
    if (!fields || typeof fields !== 'object') {
      return jsonResponse(request, { ok: false, error: 'fields object required' }, 400);
    }
    if (!Array.isArray(draws)) {
      return jsonResponse(request, { ok: false, error: 'draws array required' }, 400);
    }
    // xact_items is optional — if absent or empty, the SOV phase table is
    // hidden rather than rendered with empty rows.
    const xactItems = Array.isArray(xact_items) ? xact_items : [];
    if (!env.BROWSER) {
      return jsonResponse(request, { ok: false, error: 'BROWSER binding not configured' }, 500);
    }
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse(request, { ok: false, error: 'Supabase env vars missing' }, 500);
    }

    let browser;
    try {
      browser = await puppeteer.launch(env.BROWSER);
      const page = await browser.newPage();

      // Load template HTML directly — fonts are all system fonts
      // (Georgia, Helvetica Neue, Times, Arial), no external network calls.
      await page.setContent(CONTRACT_TEMPLATE_HTML, { waitUntil: 'load' });

      // Inject fields + draws table + Xact line items in page context.
      await page.evaluate(({ fields, draws, fieldIds, xactItems }) => {
        // 1) Field text injection.
        for (const id of fieldIds) {
          const el = document.getElementById(id);
          if (!el) continue;
          const value = fields[id];
          el.textContent = (value === null || value === undefined) ? '' : String(value);
        }

        // 2) Draw schedule table.
        const tbody = document.getElementById('draw_table_body');
        if (tbody && Array.isArray(draws)) {
          tbody.innerHTML = '';
          for (const d of draws) {
            const tr = document.createElement('tr');
            const cells = [
              d.num     !== undefined ? String(d.num)     : '',
              d.pct     !== undefined ? String(d.pct)     : '',
              d.amount  !== undefined ? String(d.amount)  : '',
              d.trigger !== undefined ? String(d.trigger) : '',
            ];
            for (const c of cells) {
              const td = document.createElement('td');
              td.textContent = c;
              tr.appendChild(td);
            }
            tbody.appendChild(tr);
          }
        }

        // 3) SOV phase table — group xact items by trade_category, render
        //    a phase header row then a line per item with running totals.
        const phaseBody = document.getElementById('sov_phase_table_body');
        if (phaseBody) {
          if (!xactItems.length) {
            // No Xact items — collapse the section by hiding its surrounding
            // structure. We hide the closest <table> ancestor to also drop
            // the "Schedule of Values by Trade" header treatment.
            const parentTable = phaseBody.closest('table');
            if (parentTable) parentTable.style.display = 'none';
          } else {
            // Group by trade_category, preserving insertion order of trades.
            const groups = new Map();
            for (const it of xactItems) {
              const key = (it.trade_category || 'general').toString();
              if (!groups.has(key)) groups.set(key, []);
              groups.get(key).push(it);
            }

            // Format helpers (page-context safe — no module imports).
            const usd = (n) => {
              const v = Number(n) || 0;
              return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
            };
            const titleCase = (s) => s
              .replace(/_/g, ' ')
              .replace(/\b\w/g, c => c.toUpperCase());

            phaseBody.innerHTML = '';
            let phaseNum = 1;
            for (const [trade, items] of groups) {
              // Phase header row (4-col colspan, formatted like the template's
              // original PHASE 1/2/3 rows).
              const headerTr = document.createElement('tr');
              const headerTd = document.createElement('td');
              headerTd.colSpan = 4;
              headerTd.className = 'sov-phase-row';
              const tradeTotal = items.reduce((s, it) => s + (Number(it.line_total) || 0), 0);
              headerTd.textContent =
                `PHASE ${phaseNum} — ${titleCase(trade).toUpperCase()}  (${usd(tradeTotal)})`;
              headerTr.appendChild(headerTd);
              phaseBody.appendChild(headerTr);

              // Item rows.
              for (const it of items) {
                const tr = document.createElement('tr');
                const num = document.createElement('td');
                num.textContent = '';                 // line number column — left blank for now
                const div = document.createElement('td');
                div.textContent = titleCase(trade);
                const desc = document.createElement('td');
                // Include room/section when present for clarity.
                const ctx = [it.room, it.section].filter(Boolean).join(' / ');
                desc.textContent = ctx
                  ? `${it.description} — ${ctx}`
                  : (it.description || '');
                const val = document.createElement('td');
                val.className = 'num';
                val.style.textAlign = 'right';
                val.textContent = usd(it.line_total || 0);
                tr.appendChild(num);
                tr.appendChild(div);
                tr.appendChild(desc);
                tr.appendChild(val);
                phaseBody.appendChild(tr);
              }
              phaseNum += 1;
            }
          }
        }
      }, { fields, draws, fieldIds: FIELD_IDS, xactItems });

      const pdfBuffer = await page.pdf({
        format: 'Letter',
        printBackground: true,    // cover-page gradient requires this
        preferCSSPageSize: true,  // honor template's @page rules
      });

      // Deterministic storage path — re-issues use new packet_id → new path,
      // never overwrites a sent/locked packet's contract.
      const storagePath = `projects/${project_id}/contracts/contract-${packet_id}.pdf`;
      const contract_pdf_url = await uploadPdfToStorage(env, storagePath, pdfBuffer);

      return jsonResponse(request, {
        ok: true,
        contract_pdf_url,
        byte_size: pdfBuffer.byteLength,
      });
    } catch (err) {
      console.error('render-contract error:', err.stack || err.message || err);
      return jsonResponse(request, { ok: false, error: err.message || String(err) }, 500);
    } finally {
      if (browser) {
        try { await browser.close(); } catch (_) { /* ignore */ }
      }
    }
  },
};
