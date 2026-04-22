// ═══════════════════════════════════════════════════════════════════════════
// JG Restoration — Nightly Rebuttal Enrichment
// ═══════════════════════════════════════════════════════════════════════════
// Runs nightly at 3 AM Central. Finds rebuttals where payment outcome is not
// yet known, queries QuickBooks Online for matching invoices by project name
// in the invoice memo, and writes back payment_received_amount, days_to_pay,
// and final_outcome.
//
// QBO OAuth refresh tokens rotate on every refresh (every 100 days worst
// case). We store the current refresh_token in Supabase and atomically swap
// it after each successful refresh so the function is self-healing as long
// as it runs at least every 100 days.
//
// Required env vars (set in Vercel dashboard):
//   QBO_CLIENT_ID        — from Intuit developer console
//   QBO_CLIENT_SECRET    — from Intuit developer console
//   QBO_REALM_ID         — your company ID
//   QBO_ENVIRONMENT      — 'production' or 'sandbox' (default production)
//   SUPABASE_URL         — already set in existing proxy
//   SUPABASE_SERVICE_KEY — service role key (required to write — NOT the anon
//                          key; anon key works but is a weaker guarantee)
//   CRON_SECRET          — shared secret that Vercel cron passes in header,
//                          prevents public invocation
// ═══════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  // ── Cron auth gate ─────────────────────────────────────────────────────
  // Vercel cron sets 'authorization: Bearer <CRON_SECRET>' automatically
  // when configured. Reject unauthorized invocations.
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const startedAt = new Date().toISOString();
  const log = { started_at: startedAt, steps: [], errors: [] };

  try {
    // ── Config check ─────────────────────────────────────────────────────
    const required = ['QBO_CLIENT_ID','QBO_CLIENT_SECRET','QBO_REALM_ID','SUPABASE_URL','SUPABASE_SERVICE_KEY'];
    const missing = required.filter(k => !process.env[k]);
    if (missing.length) {
      log.errors.push({ step: 'config', missing });
      return res.status(500).json({ ok: false, error: 'missing env vars', missing, log });
    }

    const SB = {
      url: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_SERVICE_KEY,
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json'
      }
    };

    // ── Pull pending rebuttals ───────────────────────────────────────────
    // Criteria: no final_outcome yet, created within last 180 days.
    // Older ones we give up on — if QBO hasn't seen payment in 6 months,
    // it's either written off or the memo doesn't match.
    const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
    const pendingRes = await fetch(
      `${SB.url}/rest/v1/adjuster_rebuttals?select=id,project_name,created_at,jg_total&final_outcome=is.null&created_at=gte.${cutoff}&order=created_at.asc`,
      { headers: SB.headers }
    );
    if (!pendingRes.ok) throw new Error(`supabase pending fetch failed: ${pendingRes.status}`);
    const pending = await pendingRes.json();
    log.steps.push({ step: 'pending_count', value: pending.length });

    if (pending.length === 0) {
      log.steps.push({ step: 'done', reason: 'nothing to enrich' });
      await writeLog(SB, log, 'success');
      return res.status(200).json({ ok: true, enriched: 0, log });
    }

    // ── Refresh QBO access token ─────────────────────────────────────────
    const accessToken = await refreshQBOToken(SB, log);
    if (!accessToken) {
      await writeLog(SB, log, 'failed');
      return res.status(500).json({ ok: false, error: 'qbo token refresh failed', log });
    }

    // ── Enrich each rebuttal ─────────────────────────────────────────────
    let enrichedCount = 0;
    let noMatchCount = 0;

    for (const reb of pending) {
      try {
        const invoice = await findInvoiceByProject(
          accessToken,
          process.env.QBO_REALM_ID,
          process.env.QBO_ENVIRONMENT || 'production',
          reb.project_name
        );

        if (!invoice) {
          noMatchCount++;
          continue;
        }

        const outcome = classifyInvoice(invoice, reb);
        if (!outcome) {
          // Invoice exists but still open — skip, we'll check again tomorrow
          continue;
        }

        const updateRes = await fetch(
          `${SB.url}/rest/v1/adjuster_rebuttals?id=eq.${reb.id}`,
          {
            method: 'PATCH',
            headers: { ...SB.headers, Prefer: 'return=minimal' },
            body: JSON.stringify({
              payment_received_amount: outcome.payment_received_amount,
              payment_received_date:   outcome.payment_received_date,
              days_to_payment:         outcome.days_to_payment,
              final_outcome:           outcome.final_outcome,
              outcome_notes:           outcome.notes
            })
          }
        );

        if (updateRes.ok) {
          enrichedCount++;
          log.steps.push({ step: 'enriched', project: reb.project_name, outcome: outcome.final_outcome, paid: outcome.payment_received_amount });
        } else {
          log.errors.push({ step: 'supabase_update_failed', project: reb.project_name, status: updateRes.status });
        }
      } catch (e) {
        log.errors.push({ step: 'enrich_row_failed', project: reb.project_name, message: e.message });
      }
    }

    log.steps.push({ step: 'summary', pending: pending.length, enriched: enrichedCount, no_match: noMatchCount, errors: log.errors.length });
    await writeLog(SB, log, 'success');
    return res.status(200).json({ ok: true, enriched: enrichedCount, no_match: noMatchCount, pending: pending.length });
  } catch (e) {
    log.errors.push({ step: 'fatal', message: e.message, stack: e.stack });
    try {
      await writeLog({ url: process.env.SUPABASE_URL, headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' } }, log, 'failed');
    } catch (_) {}
    return res.status(500).json({ ok: false, error: e.message, log });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// QBO OAuth: refresh access token, rotate refresh token in Supabase
// ─────────────────────────────────────────────────────────────────────────
async function refreshQBOToken(SB, log) {
  // Load current refresh_token
  const tokRes = await fetch(
    `${SB.url}/rest/v1/platform_settings?key=eq.qbo_refresh_token&select=value&limit=1`,
    { headers: SB.headers }
  );
  if (!tokRes.ok) {
    log.errors.push({ step: 'qbo_token_load_failed', status: tokRes.status });
    return null;
  }
  const tokRows = await tokRes.json();
  if (!tokRows.length || !tokRows[0].value) {
    log.errors.push({ step: 'qbo_token_missing', message: 'no refresh token in platform_settings — run QBO_ONBOARDING.md first' });
    return null;
  }
  const currentRefresh = tokRows[0].value;

  // Exchange for new access token (also gets a new refresh token)
  const basic = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString('base64');
  const refreshRes = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(currentRefresh)}`
  });

  if (!refreshRes.ok) {
    const errBody = await refreshRes.text();
    log.errors.push({ step: 'qbo_refresh_failed', status: refreshRes.status, body: errBody });
    return null;
  }

  const tokens = await refreshRes.json();
  // Write the NEW refresh_token back before returning the access token —
  // this is what keeps the chain alive.
  const newRefresh = tokens.refresh_token;
  const upsertRes = await fetch(
    `${SB.url}/rest/v1/platform_settings?key=eq.qbo_refresh_token`,
    {
      method: 'PATCH',
      headers: { ...SB.headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ value: newRefresh, updated_at: new Date().toISOString() })
    }
  );
  if (!upsertRes.ok) {
    log.errors.push({ step: 'qbo_token_rotate_failed', status: upsertRes.status, critical: 'new refresh token NOT saved — next run will fail' });
    // Don't return null — use this access token while we can, but flag loudly
  } else {
    log.steps.push({ step: 'qbo_token_rotated' });
  }

  return tokens.access_token;
}

// ─────────────────────────────────────────────────────────────────────────
// QBO invoice lookup by project name in memo/description/customer
// ─────────────────────────────────────────────────────────────────────────
async function findInvoiceByProject(accessToken, realmId, env, projectName) {
  const host = env === 'sandbox'
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com';

  // Escape single quotes in project name for SQL-ish QBO query
  const safe = projectName.replace(/'/g, "\\'");

  // QBO supports LIKE on PrivateNote (memo) and DocNumber.
  // Query the most recent invoice matching the project name.
  const query = `SELECT * FROM Invoice WHERE PrivateNote LIKE '%${safe}%' OR CustomerMemo LIKE '%${safe}%' ORDER BY MetaData.CreateTime DESC MAXRESULTS 5`;

  const url = `${host}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=75`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    }
  });

  if (!r.ok) {
    const body = await r.text();
    throw new Error(`qbo query failed ${r.status}: ${body.slice(0, 200)}`);
  }

  const data = await r.json();
  const invoices = data?.QueryResponse?.Invoice || [];
  if (!invoices.length) return null;

  // Best match: most recent invoice (QBO already sorted DESC by CreateTime)
  return invoices[0];
}

// ─────────────────────────────────────────────────────────────────────────
// Classify an invoice into our outcome schema
// ─────────────────────────────────────────────────────────────────────────
function classifyInvoice(invoice, rebuttal) {
  const totalAmt = Number(invoice.TotalAmt || 0);
  const balance = Number(invoice.Balance || 0);
  const paid = totalAmt - balance;

  // Still open? Skip — we'll check again tomorrow
  if (balance > 0.01 && paid < 0.01) {
    return null;
  }

  const rebuttalCreated = new Date(rebuttal.created_at);
  const invoicePaidDate = invoice.MetaData?.LastUpdatedTime
    ? new Date(invoice.MetaData.LastUpdatedTime)
    : new Date();

  const daysToPayment = Math.round((invoicePaidDate - rebuttalCreated) / (1000 * 60 * 60 * 24));

  // Parse the JG total off the rebuttal so we can compare
  const jgTotalNum = Number(String(rebuttal.jg_total || '').replace(/[^0-9.]/g, '')) || 0;

  let outcome;
  if (balance <= 0.01 && paid >= jgTotalNum * 0.98) {
    outcome = 'paid_full';
  } else if (paid > 0 && balance <= 0.01) {
    // Invoice closed but paid less than JG billed — write-off / short-pay
    outcome = 'paid_partial';
  } else if (paid > 0) {
    outcome = 'paid_partial';
  } else {
    outcome = 'denied';
  }

  return {
    payment_received_amount: `$${paid.toFixed(2)}`,
    payment_received_date: invoicePaidDate.toISOString().slice(0, 10),
    days_to_payment: daysToPayment >= 0 ? daysToPayment : null,
    final_outcome: outcome,
    notes: `QBO Invoice ${invoice.DocNumber || invoice.Id}; total billed $${totalAmt.toFixed(2)}; paid $${paid.toFixed(2)}; balance $${balance.toFixed(2)}`
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Write run log to audit table
// ─────────────────────────────────────────────────────────────────────────
async function writeLog(SB, log, status) {
  try {
    await fetch(`${SB.url}/rest/v1/enrichment_runs`, {
      method: 'POST',
      headers: { ...SB.headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        status,
        steps: log.steps,
        errors: log.errors,
        started_at: log.started_at,
        finished_at: new Date().toISOString()
      })
    });
  } catch (e) {
    console.error('writeLog failed:', e);
  }
}
