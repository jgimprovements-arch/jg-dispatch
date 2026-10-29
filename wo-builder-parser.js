// wo-builder-parser.js
// Self-contained module that parses an Xactimate Estimate PDF + Components PDF pair
// using the Claude API (key from localStorage as 'jg_key'), then writes the structured
// data to Supabase tables (wo_builder_uploads, _estimate_items, _component_materials,
// _component_labor, _component_equipment).
//
// Usage:
//   import { parseAndStoreXactPDFs } from './wo-builder-parser.js';
//   const result = await parseAndStoreXactPDFs(supabaseClient, projectId, estimateFile, componentsFile, {
//     onProgress: (stage, pct) => console.log(stage, pct),
//     uploadedByEmail: 'josh@jg-restoration.com',
//     uploadedByName: 'Josh Greil',
//   });
//   // result = { uploadId, summary: { rcv, cost, margin, ... }, errors: [] }

// Routes through the platform's Cloudflare Worker proxy (jg-anthropic-proxy).
// The Anthropic API key lives as a Worker Secret on the proxy — clients
// never have access to it. Origin-enforced auth: only platform-hosted
// origins can call the proxy.
const ANTHROPIC_API = 'https://jg-anthropic-proxy.josh-70f.workers.dev';
// Sonnet is several times faster than Opus at the same structured-extraction
// quality for line-item estimates. Opus emitting a full 16k-token chunk was
// taking longer than the proxy's ~100s limit and failing with HTTP 524.
const MODEL = 'claude-sonnet-5';
// Smaller per-call output keeps each chunk well under the 100s proxy timeout.
// The chunk loop just does a few more passes (capped at MAX_CHUNKS) to cover
// every line item, so nothing is lost — each call just finishes faster.
const MAX_TOKENS = 8000;
// Components is a SINGLE (non-chunked) call, so it needs more room than one
// estimate chunk. Sonnet emits this fast enough to stay under the proxy timeout,
// and if a very large components list still truncates, recoverTruncatedItems
// salvages the complete materials.
const COMPONENTS_MAX_TOKENS = 16000;
const CHUNK_BATCH_SIZE = 40; // line items per estimate chunk before forcing a continuation call

// ─── Public entrypoint ─────────────────────────────────────────────
// opts:
//   onProgress      - (stage, pct) => void  progress callback
//   uploadedByEmail - string                 user attribution
//   uploadedByName  - string                 user attribution
//   dryRun          - boolean                if true, parse only — no DB writes.
//                                            Returns { items, summary, dryRun: true }
//                                            with no uploadId. Used by the
//                                            change-order flow to diff against
//                                            the original estimate before
//                                            committing anything to storage.
export async function parseAndStoreXactPDFs(sb, projectId, estimateFile, componentsFile, opts = {}) {
  const { onProgress = () => {}, uploadedByEmail, uploadedByName, dryRun = false } = opts;
  // No client-side API key — the jg-anthropic-proxy Worker holds the
  // Anthropic API key as an encrypted secret and validates origin to
  // ensure only the platform itself can call it. This means no per-PM
  // setup, no key in localStorage, no key in platform_settings, no key
  // anywhere on the client.
  const apiKey = null;  // intentionally unused — proxy handles auth

  // ─── DRY-RUN FAST PATH ────────────────────────────────────────────
  // Parse PDFs via Claude API only. No Supabase reads or writes, no
  // upload rows, no document audit trail. Caller gets line items + summary
  // for diffing/preview purposes and decides whether to commit.
  if (dryRun) {
    onProgress('Reading PDFs…', 10);
    const [estimateB64, componentsB64] = await Promise.all([
      fileToBase64(estimateFile),
      fileToBase64(componentsFile),
    ]);
    onProgress('Sending to Claude for extraction…', 25);
    // Estimate uses chunked parsing (big PDFs can have 100+ line items that
    // exceed max_tokens in one call). Components parsing fits in one call.
    const [estimateData, componentsResult] = await Promise.all([
      callClaudeEstimateChunked(apiKey, estimateB64, msg => onProgress(msg, 40)),
      callClaude(apiKey, componentsB64, COMPONENTS_PROMPT, 'components', COMPONENTS_MAX_TOKENS),
    ]);
    const componentsData = componentsResult.parsed;
    onProgress('Computing totals…', 80);
    const materialsTotal = sum(componentsData.materials, 'total');
    const equipmentTotal = sum(componentsData.equipment, 'total');
    const laborSubtotal = sum(componentsData.labor, 'total');
    const miscLabor = componentsData.misc_labor || 0;
    const laborTotal = laborSubtotal + miscLabor;
    const componentsGrandTotal = materialsTotal + equipmentTotal + laborTotal;
    const rcv = estimateData.replacement_cost_value || 0;
    const grossProfit = rcv - componentsGrandTotal;
    const marginPct = rcv > 0 ? (grossProfit / rcv) * 100 : 0;
    onProgress('Done!', 100);
    return {
      dryRun: true,
      uploadId: null,
      items: estimateData.items || [],       // ← what the change-order diff reads
      lineItems: estimateData.items || [],   // alias for older callers
      estimateData,
      componentsData,
      summary: {
        rcv,
        cost: round2(componentsGrandTotal),
        materials: round2(materialsTotal),
        labor: round2(laborTotal),
        equipment: round2(equipmentTotal),
        grossProfit: round2(grossProfit),
        marginPct: round2(marginPct),
        itemCount: (estimateData.items || []).length,
        materialCount: (componentsData.materials || []).length,
        laborCount: (componentsData.labor || []).length,
        equipmentCount: (componentsData.equipment || []).length,
      },
      errors: [],
    };
  }

  // ─── COMMIT PATH (writes to Supabase) ─────────────────────────────

  // ─── 1. Mark ALL older uploads for this project as not-current ───
  //   Note: we deliberately do NOT filter by `deleted_at IS NULL` here.
  //   A soft-deleted row logically cannot be "current", so the flag must
  //   be cleared regardless of soft-delete state. Without this, soft-deleted
  //   rows retain is_current=true and pollute audit/diligence queries.
  onProgress('Preparing upload session…', 5);
  await sb.from('wo_builder_uploads')
    .update({ is_current: false })
    .eq('project_id', projectId);

  // ─── 1b. Upload both PDFs to rebuild-documents (audit trail) ───
  // These land in the Estimate/Invoices folder alongside other estimate docs.
  onProgress('Saving PDFs to Documents…', 8);
  const [estimateDocUrl, componentsDocUrl] = await Promise.all([
    uploadPdfToDocuments(sb, projectId, estimateFile, uploadedByEmail).catch(e => {
      console.warn('[WO Builder] Estimate doc upload failed:', e);
      return null;
    }),
    uploadPdfToDocuments(sb, projectId, componentsFile, uploadedByEmail).catch(e => {
      console.warn('[WO Builder] Components doc upload failed:', e);
      return null;
    }),
  ]);

  // ─── 2. Create a pending upload row ───
  const { data: upload, error: upErr } = await sb.from('wo_builder_uploads').insert({
    project_id: projectId,
    estimate_filename: estimateFile.name,
    components_filename: componentsFile.name,
    estimate_file_url: estimateDocUrl,
    components_file_url: componentsDocUrl,
    parse_status: 'parsing',
    is_current: true,
    uploaded_by_email: uploadedByEmail || null,
    uploaded_by_name: uploadedByName || null,
  }).select().single();
  if (upErr) throw new Error('Upload row create failed: ' + upErr.message);
  const uploadId = upload.id;

  try {
    // ─── 3. Convert both PDFs to base64 ───
    onProgress('Reading PDFs…', 10);
    const [estimateB64, componentsB64] = await Promise.all([
      fileToBase64(estimateFile),
      fileToBase64(componentsFile),
    ]);

    // ─── 4. Run both Anthropic calls in parallel ───
    onProgress('Sending to Claude for extraction…', 25);
    const [estimateData, componentsResult] = await Promise.all([
      callClaudeEstimateChunked(apiKey, estimateB64, msg => onProgress(msg, 40)),
      callClaude(apiKey, componentsB64, COMPONENTS_PROMPT, 'components', COMPONENTS_MAX_TOKENS),
    ]);
    const componentsData = componentsResult.parsed;
    onProgress('Got data back from Claude…', 65);

    // ─── 5. Load trade mappings to classify codes/items ───
    const { data: tradeMap } = await sb.from('wo_builder_trade_mapping')
      .select('code_pattern, trade_category, trade_label, sort_order')
      .order('sort_order');
    const tradeMappings = tradeMap || [];

    // ─── 6. Compute roll-up totals ───
    const materialsTotal = sum(componentsData.materials, 'total');
    const equipmentTotal = sum(componentsData.equipment, 'total');
    const laborSubtotal = sum(componentsData.labor, 'total');
    const miscLabor = componentsData.misc_labor || 0;
    const laborTotal = laborSubtotal + miscLabor;
    const componentsGrandTotal = materialsTotal + equipmentTotal + laborTotal;

    // ─── 6b. Validate LLM-extracted estimate totals against Xact arithmetic ───
    // Xact summary page invariants:
    //   subtotal == line_item_total + material_sales_tax           (within rounding)
    //   RCV      == subtotal + overhead + profit + service_sales_tax
    // We've observed two LLM failure modes in production:
    //   (a) header totals missed entirely → all-null fields
    //   (b) one field extracted but stuffed into the wrong column (e.g. RCV
    //       value written to `line_item_total`) — internally inconsistent.
    // Failure mode (b) is silent without these invariants and produces
    // contracts that don't match the source Xact. So: validate, and if it
    // fails, store nulls in canonical fields + flag the row for manual entry.
    // DO NOT substitute summed items.line_total — per-line totals include
    // tax and O&P at the line level, so their sum equals neither the printed
    // Line Item Total nor the printed RCV.
    const TOTALS_TOL = 1.00;
    const llmLIT     = Number(estimateData.line_item_total)        || 0;
    const llmMatTax  = Number(estimateData.material_sales_tax)     || 0;
    const llmSvcTax  = Number(estimateData.service_sales_tax)      || 0;
    const llmSubtot  = Number(estimateData.subtotal)               || 0;
    const llmOH      = Number(estimateData.overhead)               || 0;
    const llmProfit  = Number(estimateData.profit)                 || 0;
    const llmRCV     = Number(estimateData.replacement_cost_value) || 0;

    const allPresent     = llmLIT > 0 && llmSubtot > 0 && llmRCV > 0;
    const subtotalInvOk  = Math.abs(llmSubtot - (llmLIT + llmMatTax)) <= TOTALS_TOL;
    const rcvInvariantOk = Math.abs(llmRCV - (llmSubtot + llmOH + llmProfit + llmSvcTax)) <= TOTALS_TOL;
    const totalsValid    = allPresent && subtotalInvOk && rcvInvariantOk;

    let totalsRecoveryState;
    let canonicalTotals;
    if (totalsValid) {
      totalsRecoveryState = 'parsed';
      canonicalTotals = {
        line_item_total:        round2(llmLIT),
        material_sales_tax:     round2(llmMatTax),
        service_sales_tax:      round2(llmSvcTax),
        subtotal:               round2(llmSubtot),
        overhead:               round2(llmOH),
        profit:                 round2(llmProfit),
        replacement_cost_value: round2(llmRCV),
        net_claim:              Number(estimateData.net_claim) || round2(llmRCV),
      };
    } else {
      totalsRecoveryState = !allPresent ? 'missing' : 'invalid';
      canonicalTotals = {
        line_item_total:        null,
        material_sales_tax:     null,
        service_sales_tax:      null,
        subtotal:               null,
        overhead:               null,
        profit:                 null,
        replacement_cost_value: null,
        net_claim:              null,
      };
      console.warn('[WO Builder] LLM estimate totals failed validation — manual entry required', {
        uploadId, totalsRecoveryState,
        checks: { allPresent, subtotalInvOk, rcvInvariantOk },
        llm: { llmLIT, llmMatTax, llmSvcTax, llmSubtot, llmOH, llmProfit, llmRCV },
      });
    }

    const rcv = canonicalTotals.replacement_cost_value || 0;
    const grossProfit = rcv - componentsGrandTotal;
    const marginPct = rcv > 0 ? (grossProfit / rcv) * 100 : 0;

    // ─── 7. Update the upload row with totals + raw JSON ───
    onProgress('Saving totals…', 72);
    await sb.from('wo_builder_uploads').update({
      // Top-level estimate metadata
      estimate_number: estimateData.estimate_number || null,
      date_entered: estimateData.date_entered || null,
      date_estimated: estimateData.date_estimated || null,
      price_list: estimateData.price_list || null,
      type_of_estimate: estimateData.type_of_estimate || null,
      estimator: estimateData.estimator || null,
      // Estimate totals (canonical — written ONLY when LLM extraction
      // passed validation; nulls otherwise so downstream UI can force
      // manual entry rather than ship bad numbers into a contract).
      line_item_total:        canonicalTotals.line_item_total,
      material_sales_tax:     canonicalTotals.material_sales_tax,
      subtotal:               canonicalTotals.subtotal,
      overhead:               canonicalTotals.overhead,
      profit:                 canonicalTotals.profit,
      service_sales_tax:      canonicalTotals.service_sales_tax,
      replacement_cost_value: canonicalTotals.replacement_cost_value,
      net_claim:              canonicalTotals.net_claim,
      totals_recovery_state:  totalsRecoveryState,  // 'parsed' | 'missing' | 'invalid'
      // Component totals
      components_materials_total: materialsTotal,
      components_equipment_total: equipmentTotal,
      components_labor_total: laborTotal,
      components_misc_labor: miscLabor,
      components_grand_total: componentsGrandTotal,
      // Computed
      gross_margin_pct: round2(marginPct),
      gross_profit: round2(grossProfit),
      // Raw JSON (for debugging/re-parse)
      raw_estimate_json: estimateData,
      raw_components_json: componentsData,
      parse_status: 'parsed',
    }).eq('id', uploadId);

    // ─── 8. Insert estimate line items ───
    onProgress('Saving estimate line items…', 80);
    if (Array.isArray(estimateData.items) && estimateData.items.length) {
      const items = estimateData.items.map(item => ({
        upload_id: uploadId,
        project_id: projectId,
        line_number: item.line_number || null,
        room: item.room || null,
        section: item.section || null,
        level: item.level || null,
        description: item.description || '',
        quantity: item.quantity || null,
        unit: item.unit || null,
        unit_price: item.unit_price || null,
        line_total: item.line_total || null,
        notes: item.notes || null,
        trade_category: classifyEstimateItem(item, tradeMappings),
      }));
      await insertInChunks(sb, 'wo_builder_estimate_items', items, 200);
    }

    // ─── 9. Insert component materials ───
    onProgress('Saving component materials…', 86);
    if (Array.isArray(componentsData.materials) && componentsData.materials.length) {
      const mats = componentsData.materials.map(m => ({
        upload_id: uploadId,
        project_id: projectId,
        code: m.code,
        description: m.description || null,
        quantity: m.quantity || null,
        unit: m.unit || null,
        unit_price: m.unit_price || null,
        total: m.total || null,
        is_taxable: !!m.is_taxable,
        trade_category: classifyByCode(m.code, tradeMappings),
      }));
      await insertInChunks(sb, 'wo_builder_component_materials', mats, 200);
    }

    // ─── 10. Insert component labor ───
    onProgress('Saving component labor…', 90);
    if (Array.isArray(componentsData.labor) && componentsData.labor.length) {
      const labors = componentsData.labor.map(l => ({
        upload_id: uploadId,
        project_id: projectId,
        code: l.code,
        description: l.description || null,
        hours: l.hours || null,
        unit_price: l.unit_price || null,
        total: l.total || null,
        trade_category: classifyByCode(l.code, tradeMappings),
      }));
      await insertInChunks(sb, 'wo_builder_component_labor', labors, 200);
    }

    // ─── 11. Insert component equipment ───
    onProgress('Saving equipment…', 93);
    if (Array.isArray(componentsData.equipment) && componentsData.equipment.length) {
      const equips = componentsData.equipment.map(e => ({
        upload_id: uploadId,
        project_id: projectId,
        code: e.code,
        description: e.description || null,
        quantity: e.quantity || null,
        unit: e.unit || null,
        unit_price: e.unit_price || null,
        total: e.total || null,
        is_taxable: !!e.is_taxable,
        trade_category: classifyByCode(e.code, tradeMappings),
      }));
      await insertInChunks(sb, 'wo_builder_component_equipment', equips, 200);
    }

    onProgress('Done!', 100);
    return {
      uploadId,
      items: estimateData.items || [],       // for parity with dryRun shape
      lineItems: estimateData.items || [],   // alias
      summary: {
        rcv,
        cost: round2(componentsGrandTotal),
        materials: round2(materialsTotal),
        labor: round2(laborTotal),
        equipment: round2(equipmentTotal),
        grossProfit: round2(grossProfit),
        marginPct: round2(marginPct),
        itemCount: (estimateData.items || []).length,
        materialCount: (componentsData.materials || []).length,
        laborCount: (componentsData.labor || []).length,
        equipmentCount: (componentsData.equipment || []).length,
      },
      errors: [],
    };
  } catch (err) {
    // Mark the upload as errored so the UI shows what went wrong
    await sb.from('wo_builder_uploads').update({
      parse_status: 'error',
      parse_error: String(err.message || err),
    }).eq('id', uploadId);
    throw err;
  }
}

// Pull the JSON object/array out of a response that may be wrapped in prose.
// The model sometimes narrates ("Looking at the document, I can see...") before
// or after the JSON, or emits pure prose when it gets confused. This finds the
// first {...} or [...] block and returns the balanced substring (ignoring braces
// inside strings). Returns the original string if no opening brace is found, so
// downstream parse/recovery can decide what to do.
function extractJsonBlock(s) {
  if (!s) return s;
  const fo = s.indexOf('{');
  const fa = s.indexOf('[');
  let start;
  if (fo === -1) start = fa;
  else if (fa === -1) start = fo;
  else start = Math.min(fo, fa);
  if (start === -1) return s;
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return s.slice(start); // unbalanced (likely truncated) — let recovery handle
}

// Compress a sorted list of integers into a compact ranges string for prompts,
// e.g. [1,2,3,4,40,316] → "1-4, 40, 316". Keeps the "already extracted" list
// short even for 300+ line estimates.
function compressRanges(sorted) {
  if (!sorted || !sorted.length) return '(none yet — this is effectively the first batch)';
  const parts = [];
  let start = sorted[0], prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i];
    if (n === prev + 1) { prev = n; continue; }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = prev = n;
  }
  parts.push(start === prev ? `${start}` : `${start}-${prev}`);
  return parts.join(', ');
}

// ─── Anthropic API call ──────────────────────────────────────────────
async function callClaude(apiKey, pdfBase64, prompt, label, maxTokens) {
  const body = {
    model: MODEL,
    max_tokens: maxTokens || MAX_TOKENS,
    // Sonnet 5 uses extended thinking by default, which can consume the entire
    // token budget before emitting any JSON (stop_reason:max_tokens with no
    // text). This is pure structured extraction, not reasoning, so turn
    // thinking OFF — the whole budget then goes to the output, which is also
    // faster (no thinking tokens) and keeps each call well under the timeout.
    thinking: { type: 'disabled' },
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
        },
        { type: 'text', text: prompt },
      ],
    }],
  };
  // Retry transient failures: 524 (proxy timeout), 529 (overloaded), 5xx, and
  // network drops. One slow or busy call no longer kills the whole parse.
  const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504, 520, 522, 524, 529]);
  const MAX_RETRIES = 2;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let resp = null, json = null;
  for (let attempt = 0; ; attempt++) {
    try {
      resp = await fetch(ANTHROPIC_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // No x-api-key here — the proxy worker injects it server-side
          // before forwarding to api.anthropic.com.
        },
        body: JSON.stringify(body),
      });
    } catch (netErr) {
      if (attempt >= MAX_RETRIES) throw new Error(`Claude API network error (${label}): ${netErr.message}`);
      await sleep(1500 * Math.pow(2, attempt)); // 1.5s, 3s
      continue;
    }
    if (!resp.ok) {
      if (RETRYABLE.has(resp.status) && attempt < MAX_RETRIES) {
        await sleep(1500 * Math.pow(2, attempt));
        continue;
      }
      const errText = await resp.text();
      throw new Error(`Claude API error (${label}): ${resp.status} ${errText.slice(0, 500)}`);
    }
    // 200 OK — but the API occasionally returns an empty body with no text
    // block (transient, more likely on large document requests). Treat that as
    // retryable too, so one empty response doesn't fail the whole parse.
    json = await resp.json();
    const probe = (json.content || []).find(c => c.type === 'text')?.text;
    if (!probe || !probe.trim()) {
      if (attempt < MAX_RETRIES) {
        await sleep(1500 * Math.pow(2, attempt));
        continue;
      }
      throw new Error(`Claude returned no text (${label}) [stop_reason: ${json && json.stop_reason}]`);
    }
    break;
  }
  const text = (json.content || []).find(c => c.type === 'text')?.text;
  const cleaned = text.replace(/^```json\s*|\s*```$/g, '').trim();
  const wasTruncated = json.stop_reason === 'max_tokens';

  // The model sometimes wraps the JSON in prose ("Looking at the document...")
  // or emits markdown fences mid-string. Pull out the first balanced {...}/[...]
  // block before parsing so prose-wrapped JSON still succeeds.
  const candidate = extractJsonBlock(cleaned);

  // Try to parse the extracted block first
  try {
    const parsed = JSON.parse(candidate);
    return { parsed, wasTruncated };
  } catch (e) {
    // Not truncated, but still unparseable. Two sub-cases:
    //   (a) prose-wrapped partial JSON → try to salvage any complete items.
    //   (b) pure prose with no usable items → propagate (the caller decides;
    //       for a continuation chunk the chunk loop ends gracefully instead
    //       of failing the whole parse).
    if (!wasTruncated) {
      const salvaged = recoverTruncatedItems(candidate, label);
      if (salvaged) return { parsed: salvaged, wasTruncated: false };
      throw new Error(`Claude returned invalid JSON (${label}): ${e.message}\nFirst 300 chars: ${cleaned.slice(0, 300)}\nstop_reason: ${json.stop_reason}`);
    }

    // Truncated mid-stream. Salvage the items that DID make it through by
    // finding the last "}" that's at the same indentation as a complete item,
    // truncating the items array there, and closing the JSON.
    //
    // Strategy: walk backward to find the last "    }" (4-space indent — items
    // are indented one level inside the items array). That's the close of the
    // last fully-emitted item. Truncate just past it, then close the array
    // and object.
    const recovered = recoverTruncatedItems(candidate, label);
    if (recovered) {
      return { parsed: recovered, wasTruncated: true };
    }

    // Recovery failed — propagate
    throw new Error(`Claude returned truncated unrecoverable JSON (${label}): ${e.message}\nFirst 300 chars: ${cleaned.slice(0, 300)}\nstop_reason: ${json.stop_reason}`);
  }
}

// Salvage complete items from a truncated JSON response. Returns the parsed
// object on success, null if recovery isn't possible.
//
// The truncation always cuts mid-string (or mid-property), so we need to
// find the last point where a complete item object ended, then close the
// JSON structure ourselves.
function recoverTruncatedItems(text, label) {
  // The estimate response uses an "items" array; the components response uses
  // a "materials" array. Recover whichever one this truncated response has.
  const itemsStartMatch = text.match(/"(items|materials)"\s*:\s*\[/);
  if (!itemsStartMatch) {
    console.warn(`[parser] recoverTruncatedItems: no items/materials array found in ${label}`);
    return null;
  }
  const arrayKey = itemsStartMatch[1];
  const itemsStart = itemsStartMatch.index + itemsStartMatch[0].length;

  // Walk through the items array tracking brace depth. Every time we close
  // a top-level item (depth back to 1, meaning we're inside the array but
  // outside any single item), remember that position.
  // Note: depth 0 = outside the items array, 1 = inside array, 2+ = inside an item.
  let depth = 1;
  let lastCompleteItemEnd = -1;
  let inString = false;
  let escapeNext = false;
  for (let i = itemsStart; i < text.length; i++) {
    const ch = text[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (ch === '\\' && inString) { escapeNext = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 1) {
        // Just closed a complete item, we're back at array-level
        lastCompleteItemEnd = i + 1;
      } else if (depth === 0) {
        // Array fully closed — no truncation actually
        break;
      }
    }
  }

  if (lastCompleteItemEnd === -1) {
    console.warn(`[parser] recoverTruncatedItems: no complete items found in ${label}`);
    return null;
  }

  // Build recovered JSON: text up through last complete item + ] to close
  // the array + } to close any remaining open objects.
  // The first-chunk prompt response also has top-level metadata fields AFTER
  // items, but they're lost on truncation — recovery gives us items array
  // with whatever metadata appeared BEFORE items (estimate_number, dates, etc.)
  // and null/0 for the totals. Caller can compute totals from items.
  let recovered = text.slice(0, lastCompleteItemEnd) + ']';
  // We're now closed at array level. If there were further top-level fields
  // they're gone; close the outer object.
  recovered += '}';

  try {
    const parsed = JSON.parse(recovered);
    const itemCount = (parsed.items || parsed.materials || []).length;
    console.log(`[parser] Recovered ${itemCount} complete ${arrayKey} from truncated ${label} response`);
    return parsed;
  } catch (e) {
    console.warn(`[parser] recoverTruncatedItems parse failed for ${label}:`, e.message);
    return null;
  }
}

// Decode a base64 PDF to bytes, and encode bytes back to base64 (chunked so
// large buffers don't overflow the call stack in String.fromCharCode).
function base64ToUint8(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
function uint8ToBase64(u8) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}

// Estimate parsing by PAGE RANGES.
//
// We do NOT ask the model to paginate a long PDF itself. That approach proved
// unreliable in production — on the same 32-page estimate it returned 45, then
// 293, then 80 line items across attempts, because the model wanders, skips the
// middle, or declares itself done early. Instead we split the PDF into small
// fixed page ranges and extract every line item on each range. The model only
// ever sees ~2 pages, so it can't wander — it reads what's physically in front
// of it. Ranges run with light concurrency; items merge and de-dupe by
// (line_number|description|line_total). Totals + metadata come from one
// separate small call on the whole PDF (the printed totals live on the Summary
// page). Validated live: the estimate above comes back complete (291 items)
// and reconciles to the RCV to the penny.
const PAGES_PER_CHUNK = 2;      // ~2 pages ≈ ≤44 items, well under PAGE_MAX_TOKENS
const PAGE_MAX_TOKENS = 16000;  // generous headroom so a dense range never truncates
const PAGE_CONCURRENCY = 4;     // parallel page-range calls

async function callClaudeEstimateChunked(apiKey, pdfBase64, onProgress) {
  const PDFLib = (typeof window !== 'undefined') && window.PDFLib;
  if (!PDFLib) throw new Error('PDFLib is not loaded — cannot page-split the estimate PDF for parsing');

  // 1) Metadata + printed summary totals, from ONE small call on the whole PDF.
  if (onProgress) onProgress('Reading estimate totals…');
  let metadata = {};
  try {
    const { parsed } = await callClaude(apiKey, pdfBase64, ESTIMATE_METADATA_PROMPT, 'estimate-metadata', 2000);
    metadata = parsed || {};
    delete metadata.items; // metadata prompt shouldn't return items, but be safe
  } catch (e) {
    console.warn('[parser] metadata/totals call failed — items will still parse, totals may need manual entry:', e.message);
  }

  // 2) Split the PDF into page ranges and extract items from each range.
  const srcDoc = await PDFLib.PDFDocument.load(base64ToUint8(pdfBase64), { ignoreEncryption: true });
  const pageCount = srcDoc.getPageCount();

  async function sliceToBase64(startIdx, endIdx) {
    const sub = await PDFLib.PDFDocument.create();
    const idx = [];
    for (let i = startIdx; i < endIdx; i++) idx.push(i);
    const pages = await sub.copyPages(srcDoc, idx);
    pages.forEach(p => sub.addPage(p));
    return uint8ToBase64(await sub.save());
  }

  const ranges = [];
  for (let a = 0; a < pageCount; a += PAGES_PER_CHUNK) {
    ranges.push([a, Math.min(a + PAGES_PER_CHUNK, pageCount)]);
  }

  const seen = new Map();
  let completed = 0;
  async function processRange([a, b]) {
    let parsed;
    try {
      const b64 = await sliceToBase64(a, b);
      ({ parsed } = await callClaude(apiKey, b64, PAGE_ITEMS_PROMPT, `estimate-pages-${a + 1}-${b}`, PAGE_MAX_TOKENS));
    } catch (e) {
      // One bad range shouldn't sink the parse. Log and move on — its items
      // (if any) are simply missing; everything else still lands.
      console.warn(`[parser] estimate pages ${a + 1}-${b} failed: ${e.message}`);
      parsed = { items: [] };
    }
    for (const it of (parsed.items || [])) {
      const key = `${it.line_number}|${(it.description || '').slice(0, 48)}|${it.line_total}`;
      if (!seen.has(key)) seen.set(key, it);
    }
    completed++;
    if (onProgress) onProgress(`Parsing estimate pages (${completed}/${ranges.length})`);
  }

  // Run ranges with limited concurrency to cut wall-time without hammering the
  // proxy.
  for (let i = 0; i < ranges.length; i += PAGE_CONCURRENCY) {
    await Promise.all(ranges.slice(i, i + PAGE_CONCURRENCY).map(processRange));
  }

  const items = [...seen.values()].sort((a, b) => (Number(a.line_number) || 0) - (Number(b.line_number) || 0));
  if (!items.length) console.warn('[parser] page-range sweep produced 0 items');
  return { ...metadata, items };
}

// ─── Prompts ─────────────────────────────────────────────────────────
// Metadata + printed summary totals only (no line items). One call on the
// whole PDF; the printed totals live on the Summary/Recap page.
const ESTIMATE_METADATA_PROMPT = `You are reading an Xactimate Estimate PDF for a restoration project. Extract ONLY the estimate metadata and the printed SUMMARY TOTALS. Do NOT return any line items.

Return ONLY valid JSON (no markdown fences, no explanation) matching exactly this shape:

{
  "estimate_number": "BLANDIN-2529-REB",
  "date_entered": "2025-10-14",
  "date_estimated": "2025-10-23",
  "price_list": "WIAP8X_OCT25",
  "type_of_estimate": "Reconstruction",
  "estimator": "Anthony Alvarez",
  "line_item_total": 42968.17,
  "material_sales_tax": 363.05,
  "subtotal": 43331.22,
  "overhead": 6499.87,
  "profit": 6499.87,
  "service_sales_tax": 37.60,
  "replacement_cost_value": 56368.56,
  "net_claim": 56368.56
}

Rules:
- The totals are printed on the Summary / Recap page (usually near the front or the very end of the estimate). Read them exactly as printed.
- Xactimate invariants you can use to sanity-check: subtotal = line_item_total + material_sales_tax; replacement_cost_value = subtotal + overhead + profit + service_sales_tax.
- Numbers must be numeric (no $ signs, no commas, no quotes). Use null for any field genuinely absent.
- Do NOT include a line-item list of any kind.
`;

// Line items on SPECIFIC PAGES only. The caller splits the PDF into small page
// ranges and sends each range here, so the model never has to paginate — it
// just reads what's on the pages it's given.
const PAGE_ITEMS_PROMPT = `You are extracting line items from SPECIFIC PAGES of an Xactimate Estimate PDF. Extract EVERY detailed line item that appears on these pages.

Return ONLY valid JSON (no markdown fences, no explanation) matching this shape:

{
  "items": [
    {
      "line_number": 1,
      "level": "Main Level",
      "room": "Laundry",
      "section": "Floor",
      "description": "Stain & finish baseboard",
      "quantity": 26.54,
      "unit": "LF",
      "unit_price": 1.66,
      "line_total": 44.06,
      "notes": null
    }
  ]
}

Rules:
- Return EVERY numbered line item visible on these pages, in the order they appear. Do not skip any, and do not stop early.
- "line_number" = the leading number on each item line ("1.", "2.", "121.").
- "level" = the level header the item falls under ("Main Level", "Upper Level"); "room" = the room; "section" = the subheader inside a room (Floor, Walls, Doors, Contents, Containment, Cabinets and Countertops, Labor Minimums Applied) or null.
- "notes" = descriptive text between an item and the next (e.g. "15% waste added for Vinyl floor covering") or null.
- Do NOT return Summary / Recap / "Summary by Group" / "Summary by Trade" total rows, room dimension headers ("Height: 9'"), door/window dimension lines, or floorplan diagrams.
- Numbers must be numeric (no $ signs, no commas, no quotes). Use null for genuinely missing values.
- If these pages contain no line items (cover, summary, or diagram pages), return {"items": []}.
`;

// Kept as an alias for any external callers that referenced the old constant.
const ESTIMATE_PROMPT = ESTIMATE_METADATA_PROMPT;

const COMPONENTS_PROMPT = `You are parsing an Xactimate Components PDF (which breaks an estimate into raw material, equipment, and labor costs).

Return ONLY valid JSON (no markdown fences, no explanation) matching exactly this shape:

{
  "materials": [
    {
      "code": "CABAPPLIQ",
      "description": "Applique - 6\\" x 20\\" (approx.) - wood",
      "quantity": 0.30,
      "unit": "EA",
      "unit_price": 72.820,
      "total": 21.85,
      "is_taxable": false
    }
    // ... every row in MATERIAL COMPONENTS
  ],
  "equipment": [
    {
      "code": "DMODTRLR",
      "description": "Tandem axle dump trailer",
      "quantity": 0.12,
      "unit": "WK",
      "unit_price": 630.000,
      "total": 73.83,
      "is_taxable": true
    }
    // ... every row in EQUIPMENT COMPONENTS
  ],
  "labor": [
    {
      "code": "CARP-FNC",
      "description": "Carpenter - Finish, Trim/Cabinet",
      "hours": 131.53,
      "unit_price": 74.45,
      "total": 9792.39
    }
    // ... every row in LABOR COMPONENTS
  ],
  "materials_total": 6808.05,
  "equipment_total": 409.44,
  "labor_subtotal": 20609.50,
  "misc_labor": 143.62,
  "labor_total": 20753.12
}

Rules:
- A trailing "*" on the total (e.g. "1,588.59*") means the item is taxable — set is_taxable: true.
- For labor rows, "Quantity" is hours, and the unit is always "HR" so don't include a separate unit field.
- Numbers must be numeric (no $ signs, no commas, no quotes).
- "misc_labor" is the "Miscellaneous Labor" line at the bottom of LABOR COMPONENTS; null or 0 if not present.
- "labor_subtotal" = the labor "Subtotal" line; "labor_total" = the "Total" line under labor.
- Materials totals exclude tax (they're embedded in the unit prices, no separate tax column).
- Include ALL rows from each section, even minor ones.
`;

// ─── Trade classification helpers ────────────────────────────────────
function classifyByCode(code, mappings) {
  if (!code) return 'general';
  // Find LONGEST matching prefix (so "CARP-FNC" wins over "CARP" if both exist)
  const matched = mappings
    .filter(m => code.toUpperCase().startsWith(m.code_pattern.toUpperCase()))
    .sort((a, b) => b.code_pattern.length - a.code_pattern.length);
  return matched.length ? matched[0].trade_category : 'general';
}

function classifyEstimateItem(item, mappings) {
  // Estimate items don't have codes — match by description keywords + room context
  const desc = (item.description || '').toLowerCase();
  const section = (item.section || '').toLowerCase();

  // Section-based hints first
  if (section === 'containment') return 'containment';
  if (section === 'contents') return 'contents';
  if (section === 'labor minimums applied') return 'general';

  // Keyword-based classification
  if (/\bsupervis|project management\b/.test(desc)) return 'supervision';
  if (/\bdump trailer|landfill|debris|demoli\b/.test(desc)) return 'demo';
  if (/\bdrywall|sheetrock|gypsum|tape joint|texture/.test(desc)) return 'drywall';
  if (/\bpaint|prime|seal|stain & finish|stain and finish/.test(desc)) return 'paint';
  if (/\bcabin|countertop|sink|backsplash/.test(desc)) return 'cabinetry';
  if (/\bbaseboard|casing|shoe|crown|trim\b/.test(desc)) return 'trim';
  // Roofing and siding must be tested BEFORE flooring — roofing uses
  // "underlayment" and both can mention materials that the flooring rule
  // would otherwise swallow. Without these two rules, every roofing/siding
  // estimate item fell through to flooring or general.
  if (/\broof|shingle|ridge cap|drip edge|roof underlayment|felt paper|ice (?:&|and) water|flashing|soffit|fascia|gutter|downspout/.test(desc)) return 'roofing';
  if (/\bsiding|house ?wrap|weather ?barrier|tyvek|j-channel|starter strip|vinyl siding|lap siding|fiber cement|hardie|corner post|exterior trim board/.test(desc)) return 'siding';
  if (/\bvinyl (?:plank|tile|floor)|sheet goods|floor covering|carpet\b|tile floor|floor underlayment|floor preparation|lvp|lvt/.test(desc)) return 'flooring';
  if (/\bbatt insulation|insulation\b/.test(desc)) return 'insulation';
  if (/\binterior door|door knob|door slab|pre-hung/.test(desc)) return 'doors';
  if (/\bdoor hardware|hinge\b/.test(desc)) return 'hardware';
  if (/\bplumbing|p-trap|supply line|water heater/.test(desc)) return 'plumbing';
  if (/\belectric|outlet|switch|fixture\b/.test(desc)) return 'electrical';
  if (/\bdishwasher|refrigerator|oven|microwave|appliance/.test(desc)) return 'appliances';
  if (/\bshelv|closet rod\b/.test(desc)) return 'trim';
  if (/\bcontents.*move|protect contents|cover with plastic/.test(desc)) return 'contents';
  if (/\bfloor protection|heavy paper/.test(desc)) return 'contents';
  if (/\bcontainment|dust control|tension post/.test(desc)) return 'containment';
  if (/\bcleaning technician|final clean/.test(desc)) return 'cleaning';
  if (/\bcarpenter\b/.test(desc)) return 'trim';

  return 'general';
}

// ─── Utilities ───────────────────────────────────────────────────────
async function uploadPdfToDocuments(sb, projectId, file, uploadedByEmail) {
  // Upload to Supabase Storage + create rebuild_documents row.
  // Mirrors the pattern used in project_documents.html so files appear
  // in the Estimate/Invoices folder. Does NOT push to Albi (internal parse artifact).
  const safeName = (file.name || 'wo-builder-upload.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `projects/${projectId}/${Date.now()}-${safeName}`;

  const { error: upErr } = await sb.storage.from('rebuild-documents').upload(path, file, {
    contentType: file.type || 'application/pdf',
    upsert: false,
  });
  if (upErr) throw new Error('Storage upload failed: ' + upErr.message);

  const { data: urlData } = sb.storage.from('rebuild-documents').getPublicUrl(path);
  const publicUrl = urlData?.publicUrl || null;

  const { error: docErr } = await sb.from('rebuild_documents').insert({
    project_id: projectId,
    category: 'Estimate/Invoices',
    filename: safeName,
    file_url: publicUrl,
    file_size_bytes: file.size,
    mime_type: file.type || 'application/pdf',
    uploaded_by_email: uploadedByEmail || 'wo-builder@jg-restoration.com',
    push_status: 'skipped',  // internal parse artifact — don't push to Albi
  });
  if (docErr) throw new Error('Document row insert failed: ' + docErr.message);

  return publicUrl;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Failed to read ' + file.name));
    reader.readAsDataURL(file);
  });
}

function sum(arr, key) {
  if (!Array.isArray(arr)) return 0;
  return arr.reduce((s, r) => s + (Number(r[key]) || 0), 0);
}

function round2(n) { return Math.round(n * 100) / 100; }

async function insertInChunks(sb, table, rows, chunkSize = 200) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await sb.from(table).insert(chunk);
    if (error) throw new Error(`Insert into ${table} failed: ${error.message}`);
  }
}
