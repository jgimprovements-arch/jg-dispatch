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

// ─── JG (Contractor) signature ──────────────────────────────────────────
// Pre-baked PNG data URL of Josh Greil's signature, rendered once from
// sign.html's jgDrawSignature() (Alex Brush font, baseline-aligned) and
// captured via canvas.toDataURL('image/png').
//
// Pre-baking the contractor sig as a PNG (instead of injecting Alex Brush
// font + text into the Worker's headless Chrome) gives us pixel-identical
// output across every contract — no font-rendering variance between
// environments. For M&A diligence: every signed contract you've ever
// generated has the same JG signature pixels. Defensible.
//
// To regenerate (e.g., new authorized signer): open sign.html in any
// browser, run in the console:
//   const c = document.createElement('canvas'); c.width=400; c.height=120;
//   const ctx = c.getContext('2d'); ctx.fillStyle='#000';
//   const { jsPDF } = window.jspdf; const tmp = new jsPDF();
//   jgDrawSignature(tmp, 0, 0, 48);   // jsPDF path — see sign.html
//   // OR direct canvas: ctx.font = "48px 'Alex Brush'"; ctx.fillText('Josh Greil', 10, 80);
//   console.log(c.toDataURL('image/png'));
// Paste the data:image/png;base64,... output below.
const JG_SIG_DATA_URL = '';  // TODO: paste pre-baked PNG here before deploy

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

    const { packet_id, project_id, fields, draws, xact_items, signatures } = body || {};
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

    // signatures is optional. If absent → pre-sign render (unsigned contract,
    // sent to customer). If present → post-sign render (fully executed
    // contract, JG + customer sigs embedded as page content).
    //
    // Shape: {
    //   customer_name:        string,    // printed name to stamp under sig
    //   customer_sig_data_url: string,    // 'data:image/png;base64,...'
    //   customer_joint_name:  string?,   // optional joint signer printed name
    //   customer_joint_sig_data_url: string?,  // optional joint sig PNG
    //   guarantor_name:       string?,   // optional Exhibit G guarantor name
    //   guarantor_sig_data_url: string?, // optional Exhibit G guarantor sig PNG
    //   signed_at:            string,    // ISO timestamp, stamped under sig
    // }
    //
    // Roles handled by the DOM walker:
    //   contractor       → JG_SIG_DATA_URL (always stamped, baked into Worker)
    //   customer         → signatures.customer_sig_data_url
    //   customer-joint   → signatures.customer_joint_sig_data_url (skipped if absent)
    //   customer-guarantor → signatures.guarantor_sig_data_url (skipped if absent)
    //   leave-blank      → never stamped (cancellation/optional forms)
    const sigs = (signatures && typeof signatures === 'object') ? signatures : null;
    if (sigs && !sigs.customer_sig_data_url) {
      return jsonResponse(request, { ok: false, error: 'signatures.customer_sig_data_url required when signatures provided' }, 400);
    }
    if (sigs && !JG_SIG_DATA_URL) {
      // Fail fast — won't deploy if the contractor sig wasn't baked in.
      return jsonResponse(request, { ok: false, error: 'JG_SIG_DATA_URL not configured in Worker' }, 500);
    }
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
      await page.evaluate(({ fields, draws, fieldIds, xactItems, sigs, jgSig }) => {
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

        // 4) Signature stamping (DOM-injected for pixel-identical output
        //    across renders). When sigs is null this block is a no-op — the
        //    unsigned pre-send render leaves every sig-field-line blank.
        //
        //    Strategy: replace each tagged sig-field's internal markup with
        //    an <img> of the sig PNG sitting just above the existing
        //    underline+label. Image is sized to span the underline width
        //    (~180px target, scales down for narrow fields). Below the image
        //    we add the printed name + signed date for legal completeness.
        //
        //    For 'leave-blank' role: skip entirely (cancellation forms).
        //    For 'customer-joint'/'customer-guarantor': skip if no data URL.
        if (sigs) {
          const stampSig = (el, sigDataUrl, printedName, signedAt) => {
            // Find the underline div and label inside the tagged sig-field.
            const line = el.querySelector('.sig-field-line');
            const label = el.querySelector('.sig-field-label');
            if (!line || !label) return;

            // Insert <img> above the underline. Inline styles only — avoids
            // depending on additional CSS in the template.
            const img = document.createElement('img');
            img.src = sigDataUrl;
            img.style.display = 'block';
            img.style.maxHeight = '36pt';
            img.style.maxWidth = '100%';
            img.style.objectFit = 'contain';
            img.style.objectPosition = 'left bottom';
            img.style.marginBottom = '-4pt';  // overlap the line slightly so sig sits "on" it
            line.parentNode.insertBefore(img, line);

            // Replace the label with printed name + date (smaller, on two lines).
            // This gives diligence reviewers the printed name without needing
            // to inspect canvas pixels.
            if (printedName || signedAt) {
              label.innerHTML = '';
              if (printedName) {
                const nameSpan = document.createElement('span');
                nameSpan.textContent = printedName;
                nameSpan.style.fontWeight = '600';
                label.appendChild(nameSpan);
              }
              if (signedAt) {
                if (printedName) label.appendChild(document.createElement('br'));
                const dateSpan = document.createElement('span');
                dateSpan.textContent = `Signed ${signedAt}`;
                dateSpan.style.fontSize = '7pt';
                dateSpan.style.opacity = '0.7';
                label.appendChild(dateSpan);
              }
            }
          };

          const anchors = document.querySelectorAll('[data-sig-role]');
          for (const el of anchors) {
            const role = el.getAttribute('data-sig-role');
            switch (role) {
              case 'contractor':
                stampSig(el, jgSig, 'Joshua J. Greil', sigs.signed_at);
                break;
              case 'customer':
                stampSig(el, sigs.customer_sig_data_url, sigs.customer_name, sigs.signed_at);
                break;
              case 'customer-joint':
                if (sigs.customer_joint_sig_data_url) {
                  stampSig(el, sigs.customer_joint_sig_data_url, sigs.customer_joint_name, sigs.signed_at);
                }
                break;
              case 'customer-guarantor':
                if (sigs.guarantor_sig_data_url) {
                  stampSig(el, sigs.guarantor_sig_data_url, sigs.guarantor_name, sigs.signed_at);
                }
                break;
              case 'leave-blank':
                // Intentional no-op. Cancellation/optional forms stay blank.
                break;
              default:
                // Unknown role — log for diligence, do nothing.
                console.warn('Unknown data-sig-role:', role);
            }
          }
        }
      }, { fields, draws, fieldIds: FIELD_IDS, xactItems, sigs, jgSig: JG_SIG_DATA_URL });

      const pdfBuffer = await page.pdf({
        format: 'Letter',
        printBackground: true,    // cover-page gradient requires this
        preferCSSPageSize: true,  // honor template's @page rules
      });

      // Deterministic storage path. Pre-sign and post-sign renders go to
      // distinct paths so we preserve both for diligence:
      //   contract-{packet_id}.pdf         — unsigned, what we sent
      //   contract-{packet_id}-signed.pdf  — fully executed (JG + customer)
      // Re-issues use new packet_id → new path, never overwrites a sent/
      // locked packet's contract. x-upsert: false in uploadPdfToStorage()
      // would 409 on collision; the suffix prevents that case entirely.
      const suffix = sigs ? '-signed' : '';
      const storagePath = `projects/${project_id}/contracts/contract-${packet_id}${suffix}.pdf`;
      const contract_pdf_url = await uploadPdfToStorage(env, storagePath, pdfBuffer);

      return jsonResponse(request, {
        ok: true,
        contract_pdf_url,
        signed: !!sigs,
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
