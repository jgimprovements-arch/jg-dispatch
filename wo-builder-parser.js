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

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-4-5'; // best for structured document extraction
const MAX_TOKENS = 16000;

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
  const apiKey = localStorage.getItem('jg_key');
  if (!apiKey) {
    throw new Error('No Anthropic API key found in browser storage (jg_key). Set one on adjuster.html first.');
  }

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
    const [estimateData, componentsData] = await Promise.all([
      callClaude(apiKey, estimateB64, ESTIMATE_PROMPT, 'estimate'),
      callClaude(apiKey, componentsB64, COMPONENTS_PROMPT, 'components'),
    ]);
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

  // ─── 1. Mark older uploads for this project as not-current ───
  onProgress('Preparing upload session…', 5);
  await sb.from('wo_builder_uploads')
    .update({ is_current: false })
    .eq('project_id', projectId)
    .is('deleted_at', null);

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
    const [estimateData, componentsData] = await Promise.all([
      callClaude(apiKey, estimateB64, ESTIMATE_PROMPT, 'estimate'),
      callClaude(apiKey, componentsB64, COMPONENTS_PROMPT, 'components'),
    ]);
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
    const rcv = estimateData.replacement_cost_value || 0;
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
      // Estimate totals
      line_item_total: estimateData.line_item_total || null,
      material_sales_tax: estimateData.material_sales_tax || null,
      subtotal: estimateData.subtotal || null,
      overhead: estimateData.overhead || null,
      profit: estimateData.profit || null,
      service_sales_tax: estimateData.service_sales_tax || null,
      replacement_cost_value: rcv,
      net_claim: estimateData.net_claim || null,
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

// ─── Anthropic API call ──────────────────────────────────────────────
async function callClaude(apiKey, pdfBase64, prompt, label) {
  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
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
  const resp = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Claude API error (${label}): ${resp.status} ${text.slice(0, 500)}`);
  }
  const json = await resp.json();
  // Extract first text content block
  const text = (json.content || []).find(c => c.type === 'text')?.text;
  if (!text) throw new Error(`Claude returned no text (${label})`);
  // Strip ```json fences if present
  const cleaned = text.replace(/^```json\s*|\s*```$/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Claude returned invalid JSON (${label}): ${e.message}\nFirst 300 chars: ${cleaned.slice(0, 300)}`);
  }
}

// ─── Prompts ─────────────────────────────────────────────────────────
const ESTIMATE_PROMPT = `You are parsing an Xactimate Estimate PDF for a restoration project.
Extract EVERY line item across all rooms and sections, plus the top-level totals.

Return ONLY valid JSON (no markdown fences, no explanation) matching exactly this shape:

{
  "estimate_number": "BLANDIN-2529-REB",
  "date_entered": "2025-10-14",
  "date_estimated": "2025-10-23",
  "price_list": "WIAP8X_OCT25",
  "type_of_estimate": "Reconstruction",
  "estimator": "Anthony Alvarez",
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
    // ... ALL line items, in order, NEVER skip any
  ],
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
- The PDF is grouped into rooms, with each room having sections (Floor, Walls, Doors, Contents, Containment, etc.). Track the current room and section as you go.
- "level" tracks "Main Level", "Upper Level", etc. (it appears as a bold header above rooms).
- "line_number" = the leading number on each line ("1.", "2.", "121.", etc.)
- "section" = subheaders inside a room ("Floor", "Walls", "Doors", "Contents", "Containment", "Cabinets and Countertops", "Labor Minimums Applied"). If no section, use null.
- "notes" = any descriptive text that appears between a line item and the next line item (e.g. "15 % waste added for Vinyl floor covering"). null if none.
- Numbers must be numeric (no $ signs, no commas, no quotes).
- If a value is genuinely missing, use null. Do not invent values.
- Include EVERY numbered line item, even tiny ones like "Insulation labor minimum".
- Do NOT include room dimension headers ("Height: 9'") or door/window dimension lines.
- Do NOT include the floorplan diagrams.
`;

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
  if (/\bvinyl|sheet goods|underlayment|floor cover|carpet|tile floor/.test(desc)) return 'flooring';
  if (/\bfloor preparation\b/.test(desc)) return 'flooring';
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
