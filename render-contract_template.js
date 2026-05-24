// AUTO-GENERATED — do not edit by hand.
// Source: jgimprovements-arch/jg-dispatch/main/JG_Contract_Template.html
// Regenerated: 2026-05-24 — logo embedded as base64 data URI; exhibit-hero margin fix.

export const CONTRACT_TEMPLATE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>JG Restoration — Residential Home Improvement Contract</title>
<style>
/* =====================================================================
   JG RESTORATION — RESIDENTIAL CONTRACT
   Design system: Navy + Orange brand, modern professional
   ===================================================================== */

@page {
  size: Letter;
  margin: 0.75in 0.7in 0.95in 0.7in;

  @bottom-left {
    content: "JG RESTORATION  |  Residential Home Improvement Contract";
    font-family: 'Helvetica Neue', 'Arial', sans-serif;
    font-size: 7.5pt;
    color: #6B7280;
    letter-spacing: 0.05em;
    padding-bottom: 4pt;
  }
  @bottom-right {
    content: "Page " counter(page) " of " counter(pages);
    font-family: 'Helvetica Neue', 'Arial', sans-serif;
    font-size: 7.5pt;
    color: #6B7280;
    padding-bottom: 4pt;
  }
}

@page :first {
  margin: 0;
  @bottom-left { content: ""; }
  @bottom-right { content: ""; }
}

* { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --navy: #1B2B5C;
  --navy-deep: #0F1A3E;
  --navy-light: #2C4078;
  --orange: #E8743C;
  --orange-soft: #F4A574;
  --ink: #1A1F36;
  --slate: #4A5568;
  --slate-light: #6B7280;
  --rule: #D6DAE0;
  --rule-soft: #EEF0F4;
  --cream: #FAF8F4;
  --paper: #FFFFFF;
}

html, body {
  font-family: 'Georgia', 'Times New Roman', serif;
  font-size: 10.5pt;
  line-height: 1.55;
  color: var(--ink);
  background: var(--paper);
  -webkit-font-smoothing: antialiased;
}

/* ====================== COVER PAGE ====================== */

.cover {
  page-break-after: always;
  height: 100vh;
  background: linear-gradient(165deg, var(--navy-deep) 0%, var(--navy) 55%, var(--navy-light) 100%);
  position: relative;
  color: white;
  padding: 0.75in 0.75in 0.75in 0.75in;
  display: flex;
  flex-direction: column;
}

.cover::before {
  content: "";
  position: absolute;
  top: 0; right: 0;
  width: 320px;
  height: 320px;
  background: radial-gradient(circle, rgba(232,116,60,0.18) 0%, transparent 70%);
  pointer-events: none;
}

.cover::after {
  content: "";
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 8px;
  background: var(--orange);
}

.cover-logo {
  width: 240px;
  height: auto;
  margin-bottom: 0.4in;
}

.cover-eyebrow {
  font-family: 'Helvetica Neue', sans-serif;
  font-size: 9pt;
  font-weight: 600;
  letter-spacing: 0.28em;
  color: var(--orange-soft);
  text-transform: uppercase;
  margin-bottom: 14pt;
}

.cover-title {
  font-family: 'Georgia', serif;
  font-size: 38pt;
  font-weight: 400;
  line-height: 1.1;
  letter-spacing: -0.01em;
  margin-bottom: 8pt;
  max-width: 6.5in;
}

.cover-subtitle {
  font-family: 'Helvetica Neue', sans-serif;
  font-size: 12pt;
  font-weight: 300;
  color: rgba(255,255,255,0.75);
  letter-spacing: 0.02em;
  max-width: 5.5in;
  line-height: 1.4;
}

.cover-divider {
  width: 60px;
  height: 3px;
  background: var(--orange);
  margin: 28pt 0;
}

.cover-meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14pt 24pt;
  margin-top: 0.3in;
  max-width: 6.5in;
}

.cover-meta-block {
  border-left: 2px solid var(--orange);
  padding-left: 12pt;
}

.cover-meta-label {
  font-family: 'Helvetica Neue', sans-serif;
  font-size: 7.5pt;
  font-weight: 600;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--orange-soft);
  margin-bottom: 6pt;
}

.cover-meta-value {
  background: rgba(255,255,255,0.95);
  color: var(--navy);
  font-family: 'Georgia', serif;
  font-size: 11pt;
  line-height: 1.3;
  padding: 7pt 10pt;
  min-height: 28pt;
  border-radius: 2px;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.cover-meta-value.small {
  font-size: 10pt;
}

.cover-spacer { flex: 1; }

.cover-footer {
  border-top: 1px solid rgba(255,255,255,0.15);
  padding-top: 16pt;
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  font-family: 'Helvetica Neue', sans-serif;
}

.cover-footer-left {
  font-size: 8.5pt;
  color: rgba(255,255,255,0.7);
  line-height: 1.5;
}

.cover-footer-left strong {
  color: white;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.cover-footer-right {
  text-align: right;
  font-size: 8pt;
  color: rgba(255,255,255,0.6);
  letter-spacing: 0.1em;
}

/* ====================== BODY PAGES ====================== */

.page {
  page-break-before: always;
}

.page:first-of-type { page-break-before: auto; }

/* Page header band (small, on each page) */
.page-band {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 2px solid var(--navy);
  padding-bottom: 6pt;
  margin-bottom: 22pt;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.page-band-brand {
  font-family: 'Helvetica Neue', sans-serif;
  font-size: 8pt;
  font-weight: 700;
  letter-spacing: 0.22em;
  color: var(--navy);
  text-transform: uppercase;
}

.page-band-brand .orange-dot {
  color: var(--orange);
  margin: 0 4pt;
}

.page-band-ref {
  font-family: 'Helvetica Neue', sans-serif;
  font-size: 7.5pt;
  color: var(--slate-light);
  letter-spacing: 0.08em;
}

/* Section markers */
.section-header {
  font-family: 'Georgia', serif;
  font-size: 14pt;
  font-weight: 700;
  color: var(--navy);
  letter-spacing: 0.01em;
  margin: 22pt 0 4pt 0;
  page-break-after: avoid;
}

.section-header.first { margin-top: 0; }

.section-rule {
  width: 36pt;
  height: 2.5pt;
  background: var(--orange);
  margin-bottom: 14pt;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* Clause numbering */
.clause {
  margin-bottom: 12pt;
  text-align: justify;
}

.clause-title {
  font-family: 'Helvetica Neue', sans-serif;
  font-weight: 700;
  color: var(--navy);
  font-size: 10pt;
  letter-spacing: 0.02em;
}

.clause-num {
  color: var(--orange);
  font-weight: 700;
  margin-right: 4pt;
}

/* Parties & project info card */
.info-card {
  background: var(--cream);
  border-left: 4px solid var(--orange);
  padding: 16pt 20pt;
  margin: 14pt 0 20pt 0;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.info-card-title {
  font-family: 'Helvetica Neue', sans-serif;
  font-size: 8pt;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--orange);
  margin-bottom: 8pt;
}

.info-card-body {
  font-family: 'Georgia', serif;
  font-size: 10.5pt;
  line-height: 1.6;
}

.info-card-body strong {
  color: var(--navy);
  font-weight: 700;
}

.fill-line {
  display: inline-block;
  min-width: 200pt;
  border-bottom: 1px solid var(--slate);
  line-height: 1.4;
  padding: 0 4pt;
  color: var(--slate);
}

.fill-line.short { min-width: 90pt; }
.fill-line.medium { min-width: 150pt; }
.fill-line.long { min-width: 340pt; }
.fill-line.fullw { min-width: 100%; display: block; margin-top: 4pt; }

/* Payment schedule special box */
.payment-box {
  background: linear-gradient(135deg, #FFFBF6 0%, #FAF8F4 100%);
  border: 1px solid var(--rule);
  border-top: 4px solid var(--orange);
  padding: 18pt 22pt;
  margin: 16pt 0;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
  page-break-inside: avoid;
  break-inside: avoid;
}

/* Draw schedule table inside payment box */
.draw-table {
  width: 100%;
  border-collapse: collapse;
  margin: 6pt 0;
  font-family: 'Helvetica Neue', sans-serif;
  font-size: 9.5pt;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.draw-table th {
  background: var(--navy);
  color: white;
  padding: 7pt 10pt;
  text-align: left;
  font-weight: 700;
  font-size: 7.5pt;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.draw-table td {
  border: 1px solid var(--rule);
  padding: 9pt 10pt;
  vertical-align: middle;
  background: white;
  height: 22pt;
  color: var(--ink);
}
.draw-table td:nth-child(2) { color: var(--orange); font-weight: 700; }
.draw-table td:nth-child(3) { color: var(--navy); font-weight: 700; font-variant-numeric: tabular-nums; }

.payment-box-title {
  font-family: 'Helvetica Neue', sans-serif;
  font-size: 9pt;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--navy);
  margin-bottom: 10pt;
}

.payment-row {
  display: flex;
  align-items: center;
  padding: 6pt 0;
  border-bottom: 1px dashed var(--rule);
  font-family: 'Georgia', serif;
  font-size: 10.5pt;
}

.payment-row:last-child { border-bottom: none; }

.payment-amount {
  font-family: 'Helvetica Neue', sans-serif;
  color: var(--navy);
  font-weight: 700;
  width: 110pt;
  font-variant-numeric: tabular-nums;
}

.payment-pct {
  color: var(--orange);
  font-weight: 700;
  margin-right: 8pt;
}

.payment-label { flex: 1; }

.payment-when {
  border-bottom: 1px solid var(--slate-light);
  min-width: 110pt;
  padding: 0 4pt;
  color: var(--slate);
}

/* Signature blocks */
.signature-section {
  margin-top: 30pt;
  page-break-inside: avoid;
}

.signature-prelude {
  background: var(--navy);
  color: white;
  padding: 14pt 18pt;
  font-family: 'Helvetica Neue', sans-serif;
  font-size: 9.5pt;
  line-height: 1.55;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
  margin-bottom: 20pt;
  border-radius: 2px;
}

.signature-prelude strong {
  color: var(--orange-soft);
  letter-spacing: 0.02em;
}

.sig-block {
  margin-top: 20pt;
  page-break-inside: avoid;
}

.sig-block-label {
  font-family: 'Helvetica Neue', sans-serif;
  font-size: 8pt;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--orange);
  margin-bottom: 10pt;
}

.sig-block-name {
  font-family: 'Georgia', serif;
  font-size: 11pt;
  color: var(--navy);
  font-weight: 700;
  margin-bottom: 14pt;
}

.sig-row {
  display: flex;
  gap: 24pt;
  margin-bottom: 12pt;
}

.sig-field {
  flex: 1;
}

.sig-field.narrow { flex: 0.5; }

.sig-field-line {
  border-bottom: 1px solid var(--navy);
  height: 22pt;
}

.sig-field-label {
  font-family: 'Helvetica Neue', sans-serif;
  font-size: 7.5pt;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--slate-light);
  margin-top: 3pt;
}

/* Exhibit pages */
.exhibit-page {
  page-break-before: always;
}

.exhibit-hero {
  background: linear-gradient(135deg, var(--navy) 0%, var(--navy-light) 100%);
  color: white;
  padding: 28pt 30pt;
  margin: 0 0 28pt 0;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
  border-bottom: 4pt solid var(--orange);
  border-radius: 4pt;
}

.exhibit-letter {
  font-family: 'Helvetica Neue', sans-serif;
  font-size: 9pt;
  font-weight: 700;
  letter-spacing: 0.3em;
  color: var(--orange-soft);
  text-transform: uppercase;
  margin-bottom: 8pt;
}

.exhibit-title {
  font-family: 'Georgia', serif;
  font-size: 22pt;
  font-weight: 400;
  line-height: 1.15;
  margin-bottom: 6pt;
}

.exhibit-blurb {
  font-family: 'Helvetica Neue', sans-serif;
  font-size: 9.5pt;
  font-weight: 300;
  color: rgba(255,255,255,0.8);
  max-width: 5.5in;
  margin-top: 6pt;
  line-height: 1.5;
}

/* Tables in exhibits */
.exhibit-table {
  width: 100%;
  border-collapse: collapse;
  margin: 12pt 0;
  font-family: 'Helvetica Neue', sans-serif;
  font-size: 9pt;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.exhibit-table th {
  background: var(--navy);
  color: white;
  padding: 8pt 10pt;
  text-align: left;
  font-weight: 600;
  font-size: 8pt;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.exhibit-table td {
  border: 1px solid var(--rule);
  padding: 10pt;
  vertical-align: top;
  background: white;
  height: 24pt;
}

.exhibit-table tr:nth-child(even) td {
  background: var(--rule-soft);
}

.exhibit-subhead {
  font-family: 'Helvetica Neue', sans-serif;
  font-size: 10pt;
  font-weight: 700;
  color: var(--navy);
  letter-spacing: 0.02em;
  margin: 16pt 0 8pt 0;
}

/* SOV-specific styles */
.sov-summary {
  background: var(--cream);
  border-left: 4px solid var(--orange);
  padding: 12pt 16pt;
  margin-bottom: 18pt;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.sov-summary-row {
  display: flex;
  align-items: center;
  padding: 4pt 0;
  font-family: 'Helvetica Neue', sans-serif;
  font-size: 9.5pt;
}

.sov-summary-label {
  font-weight: 700;
  color: var(--navy);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  font-size: 8pt;
  width: 200pt;
}

.sov-summary-value {
  flex: 1;
  border-bottom: 1px solid var(--slate-light);
  min-height: 14pt;
  padding-left: 6pt;
}

.sov-table td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: var(--navy);
}

.sov-phase-row {
  background: var(--navy-light) !important;
  color: white !important;
  font-family: 'Helvetica Neue', sans-serif;
  font-size: 8pt;
  font-weight: 700;
  letter-spacing: 0.15em;
  padding: 7pt 10pt !important;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.sov-totals {
  width: 50%;
  margin-left: auto;
  margin-top: 14pt;
  border-collapse: collapse;
  font-family: 'Helvetica Neue', sans-serif;
  font-size: 10pt;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.sov-totals td {
  padding: 6pt 10pt;
  border-bottom: 1px solid var(--rule);
}

.sov-totals td:first-child {
  color: var(--slate);
  font-weight: 600;
}

.sov-totals td.num {
  text-align: right;
  color: var(--navy);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  width: 45%;
}

.sov-totals tr.grand td {
  background: var(--navy);
  color: white;
  font-size: 11pt;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 10pt;
  border: none;
}

.sov-totals tr.grand td.num {
  color: white;
}

.sov-callout {
  background: var(--cream);
  border-left: 3pt solid var(--orange);
  padding: 12pt 16pt;
  margin: 18pt 0;
  font-family: 'Helvetica Neue', sans-serif;
  font-size: 9pt;
  line-height: 1.55;
  color: var(--slate);
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.sov-callout strong {
  color: var(--navy);
  font-weight: 700;
}

/* Legal notice (all-caps lien notice) */
.legal-notice {
  background: var(--cream);
  border: 1px solid var(--rule);
  padding: 18pt 22pt;
  margin: 14pt 0;
  font-family: 'Helvetica Neue', sans-serif;
  font-size: 9pt;
  line-height: 1.6;
  letter-spacing: 0.01em;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.legal-notice.urgent {
  border-left: 4pt solid var(--orange);
}

/* Inline list */
.numbered-list {
  margin: 8pt 0 8pt 16pt;
}
.numbered-list li {
  margin-bottom: 6pt;
}

/* Checkbox styling */
.checkbox-row {
  display: flex;
  align-items: flex-start;
  margin: 8pt 0;
  font-family: 'Helvetica Neue', sans-serif;
  font-size: 9.5pt;
  line-height: 1.5;
}

.checkbox {
  display: inline-block;
  width: 11pt;
  height: 11pt;
  border: 1.5pt solid var(--navy);
  margin-right: 8pt;
  flex-shrink: 0;
  margin-top: 2pt;
}

/* Address block (contractor) */
.address-block {
  font-family: 'Helvetica Neue', sans-serif;
  font-size: 9.5pt;
  line-height: 1.55;
  color: var(--slate);
}
.address-block strong {
  color: var(--navy);
  font-weight: 700;
}

/* Cancellation form box */
.cancel-form {
  border: 2pt solid var(--navy);
  padding: 20pt 24pt;
  margin-top: 16pt;
  font-family: 'Georgia', serif;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.cancel-form-banner {
  background: var(--orange);
  color: white;
  padding: 8pt 12pt;
  margin: -20pt -24pt 16pt -24pt;
  font-family: 'Helvetica Neue', sans-serif;
  font-size: 9pt;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

p { margin-bottom: 8pt; }
.tight p { margin-bottom: 6pt; }

/* Right to Cure brochure styling */
.brochure {
  page-break-before: always;
}

.brochure-headline {
  font-family: 'Georgia', serif;
  font-size: 20pt;
  color: var(--navy);
  font-weight: 700;
  line-height: 1.1;
  margin-bottom: 4pt;
}

.brochure-sub {
  font-family: 'Helvetica Neue', sans-serif;
  font-size: 10pt;
  color: var(--orange);
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-bottom: 18pt;
}

.brochure-grid {
  display: grid;
  grid-template-columns: 2fr 1.2fr;
  gap: 24pt;
  margin-top: 12pt;
}

.brochure-step {
  border-left: 3pt solid var(--orange);
  padding: 6pt 0 6pt 12pt;
  margin-bottom: 10pt;
  font-family: 'Helvetica Neue', sans-serif;
  font-size: 9pt;
  line-height: 1.5;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.brochure-step-num {
  font-weight: 700;
  color: var(--navy);
  letter-spacing: 0.05em;
}

</style>
</head>
<body>

<!-- ==================================================================
     COVER PAGE
     ================================================================== -->
<section class="cover">
  <img src="data:image/png;base64,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" alt="JG Restoration" class="cover-logo">

  <div class="cover-eyebrow">Residential Construction Agreement</div>
  <h1 class="cover-title">Residential Home<br>Improvement Contract</h1>
  <div class="cover-divider"></div>
  <p class="cover-subtitle">Prepared in accordance with Wisconsin Administrative Code ATCP 110 and Wisconsin Statutes § 100.20 for the property owner identified herein.</p>

  <div class="cover-meta">
    <div class="cover-meta-block">
      <div class="cover-meta-label">Property Owner</div>
      <div class="cover-meta-value" id="cover_owner_name">&nbsp;</div>
    </div>
    <div class="cover-meta-block">
      <div class="cover-meta-label">Project Site</div>
      <div class="cover-meta-value" id="cover_project_site">&nbsp;</div>
    </div>
    <div class="cover-meta-block">
      <div class="cover-meta-label">Contract Date</div>
      <div class="cover-meta-value" id="cover_contract_date">&nbsp;</div>
    </div>
    <div class="cover-meta-block">
      <div class="cover-meta-label">Project Reference</div>
      <div class="cover-meta-value" id="cover_project_ref">&nbsp;</div>
    </div>
  </div>

  <div class="cover-spacer"></div>

  <div class="cover-footer">
    <div class="cover-footer-left">
      <strong>J.J. GREIL ENTERPRISES, LLC</strong> <em>d/b/a</em> JG Restoration<br>
      1720 N. Silverspring Dr., Appleton, WI 54913<br>
      (920) 313-3811 &nbsp;·&nbsp; sales@jg-restoration.com
    </div>
    <div class="cover-footer-right">
      DWELLING CONTRACTOR<br>
      DC-011000010
    </div>
  </div>
</section>

<!-- ==================================================================
     PAGE 2 — PARTIES, PROJECT, PAYMENT
     ================================================================== -->
<section class="page">
  <div class="page-band">
    <div class="page-band-brand">JG Restoration <span class="orange-dot">●</span> Fire <span class="orange-dot">●</span> Water <span class="orange-dot">●</span> Mold</div>
    <div class="page-band-ref">Residential Home Improvement Contract</div>
  </div>

  <h2 class="section-header first">Parties &amp; Project</h2>
  <div class="section-rule"></div>

  <p>This Residential Home Improvement Contract (the &ldquo;<strong>Contract</strong>&rdquo;) is entered into by and between the following contractor (the &ldquo;<strong>Contractor</strong>&rdquo;) and owner/customer (the &ldquo;<strong>Owner</strong>&rdquo;) for residential home improvement work at the Property identified below.</p>

  <div class="info-card">
    <div class="info-card-title">Contractor</div>
    <div class="info-card-body">
      <strong>J.J. Greil Enterprises, LLC</strong> <em>d/b/a</em> JG Restoration<br>
      1720 N. Silverspring Dr., Appleton, WI 54913<br>
      Phone: (920) 313-3811 &nbsp;·&nbsp; Email: sales@jg-restoration.com<br>
      <span style="font-size:9pt;color:var(--slate-light);">Sales Representative: <span class="fill-line medium" id="sales_rep_name"></span></span>
    </div>
  </div>

  <div class="info-card">
    <div class="info-card-title">Owner</div>
    <div class="info-card-body">
      Name: <span class="fill-line long" id="owner_name"></span><br>
      Address: <span class="fill-line long" id="owner_address"></span><br>
      Phone: <span class="fill-line medium" id="owner_phone"></span> &nbsp; Email: <span class="fill-line medium" id="owner_email"></span>
    </div>
  </div>

  <div class="info-card">
    <div class="info-card-title">Project Site</div>
    <div class="info-card-body">
      <span class="fill-line fullw" id="project_site_addr_1"></span>
      <span class="fill-line fullw" id="project_site_addr_2"></span>
    </div>
  </div>

  <p><strong>Work Scope</strong> (the &ldquo;Work&rdquo;): see attached <em>Exhibit A &mdash; Schedule of Values &amp; Scope of Work</em>.</p>

  <div class="payment-box">
    <div class="payment-box-title">Contract Price &amp; Progress Payment Schedule</div>
    <p style="margin-bottom:14pt;"><strong>Contract Price:</strong> $ <span class="fill-line medium" id="contract_price"></span></p>
    <p style="margin-bottom:10pt;font-size:9.5pt;color:var(--slate);">Owner agrees to pay the Contract Price to Contractor in the following draws, each released upon the corresponding trigger event:</p>

    <table class="draw-table">
      <thead>
        <tr>
          <th style="width:14%;">Draw</th>
          <th style="width:14%;">%</th>
          <th style="width:22%;">Amount</th>
          <th>Trigger Event</th>
        </tr>
      </thead>
      <tbody id="draw_table_body">
        <tr><td>&nbsp;</td><td>&nbsp;</td><td>$</td><td>&nbsp;</td></tr>
        <tr><td>&nbsp;</td><td>&nbsp;</td><td>$</td><td>&nbsp;</td></tr>
        <tr><td>&nbsp;</td><td>&nbsp;</td><td>$</td><td>&nbsp;</td></tr>
        <tr><td>&nbsp;</td><td>&nbsp;</td><td>$</td><td>&nbsp;</td></tr>
        <tr><td>&nbsp;</td><td>&nbsp;</td><td>$</td><td>&nbsp;</td></tr>
      </tbody>
    </table>

    <p style="font-size:8.5pt;color:var(--slate-light);font-style:italic;margin-top:10pt;line-height:1.45;">
      The draw schedule above is derived from the Schedule of Values attached as Exhibit A and may be auto-generated by Contractor&rsquo;s project management system. Each draw is tied to a specific construction milestone or deliverable. Payment is due within five (5) business days of Contractor&rsquo;s written request following the trigger event, subject to Owner&rsquo;s right to request lien waivers and to withhold for disputed items per Section 11.
    </p>
  </div>

  <p><strong>Escrow Required:</strong> &nbsp; <span class="checkbox"></span> Yes &nbsp;&nbsp; <span class="checkbox"></span> No</p>

  <div class="info-card">
    <div class="info-card-title">Project Timeline</div>
    <div class="info-card-body">
      Work Commencement Date: <span class="fill-line medium" id="commencement_date"></span><br>
      Estimated Completion Date: <span class="fill-line medium" id="completion_date"></span>
    </div>
  </div>

</section>

<!-- ==================================================================
     PAGE 3+ — TERMS & CONDITIONS
     ================================================================== -->
<section class="page">
  <div class="page-band">
    <div class="page-band-brand">JG Restoration <span class="orange-dot">●</span> Fire <span class="orange-dot">●</span> Water <span class="orange-dot">●</span> Mold</div>
    <div class="page-band-ref">Terms &amp; Conditions</div>
  </div>

  <h2 class="section-header first">Contract Terms and Conditions</h2>
  <div class="section-rule"></div>

  <p class="clause"><span class="clause-title"><span class="clause-num">1.</span>Authorization.</span> Owner expressly grants Contractor the right to contact Owner&rsquo;s homeowners&rsquo; insurance company to discuss matters related to this project, including: (a) providing documentation related to damage sustained by Owner&rsquo;s property; (b) discussing options for constructing, reconstructing, or repairing Owner&rsquo;s property; (c) providing estimates for constructing, reconstructing, or repairing Owner&rsquo;s property; and (d) discussing technical information about materials, methods, and specifications. Contractor acknowledges and agrees that: (a) Contractor has NOT, at any time, represented, offered to represent, or advertised any intent to represent Owner with respect to any insurance claim; (b) Contractor has NOT negotiated, offered to negotiate, or advertised any intent to negotiate on behalf of Owner regarding any insurance claim; (c) all discussions between Contractor and Owner&rsquo;s insurance company are informational only and do NOT constitute representation or negotiation on Owner&rsquo;s behalf; (d) Owner remains solely responsible for all communications, claims, and negotiations with Owner&rsquo;s insurance company; and (e) all decisions regarding insurance claims, coverage, deductibles, and settlement remain solely within Owner&rsquo;s control. Owner acknowledges that Owner understands Contractor&rsquo;s role is to provide information and estimates to Owner&rsquo;s insurance company upon Owner&rsquo;s request, not to represent or negotiate on Owner&rsquo;s behalf.</p>

  <p class="clause"><span class="clause-title"><span class="clause-num">2.</span>Contract Documents.</span> This Contract consists of this document and the following attached exhibits, all of which are hereby incorporated by reference:</p>
  <ul class="numbered-list" style="font-size:10pt;">
    <li><strong>Exhibit A</strong> &mdash; Schedule of Values &amp; Scope of Work</li>
    <li><strong>Exhibit B</strong> &mdash; Wisconsin Construction Lien Notice</li>
    <li><strong>Exhibit C</strong> &mdash; Notice of Consumer&rsquo;s Right to Receive Lien Waivers</li>
    <li><strong>Exhibit D</strong> &mdash; Consumer&rsquo;s Right to Cancel / Three-Business-Day Cancellation Notice</li>
    <li><strong>Exhibit E</strong> &mdash; Wisconsin Right to Cure Law Brochure / Acknowledgment</li>
    <li><strong>Exhibit F</strong> &mdash; Insurance Claim Questionnaire and Insurance-Related Cancellation Notice</li>
    <li><strong>Exhibit G</strong> &mdash; Personal Guaranty (optional; use only if a guarantor signs separately)</li>
    <li>Other incorporated documents: <span class="fill-line long" id="other_incorporated_docs"></span></li>
  </ul>
  <p class="clause">Selections of materials, fixtures, finishes, and allowance items, and any written Change Orders, are documented separately in Contractor&rsquo;s project management system and made accessible to Owner through a secure customer portal. Selection records and approved Change Orders are incorporated into this Contract by reference upon Owner&rsquo;s written or electronic approval. This Contract is the parties&rsquo; final written agreement for the Work, except for later written change orders or amendments signed or expressly approved in writing by Owner and Contractor. No oral statement, sales literature, proposal, estimate, representation, or understanding is part of this Contract unless expressly incorporated in writing. If there is a conflict, the order of precedence is: (a) written Change Orders signed or otherwise expressly approved by Owner and Contractor; (b) this Contract; (c) Exhibit A; and (d) other incorporated documents. No provision of this Contract authorizes Contractor to substitute products or materials, reduce quality or value, increase price, alter Work, or change performance deadlines except as permitted by ATCP 110 and this Contract.</p>

  <p class="clause"><span class="clause-title"><span class="clause-num">3.</span>Scope of Work, Plans and Specifications.</span> The Schedule of Values and detailed scope from which the Work will be constructed are attached as <strong>Exhibit A &mdash; Schedule of Values &amp; Scope of Work</strong> and incorporated into this Contract. The Schedule of Values itemizes the Work by trade discipline and construction phase, with corresponding values that comprise the Contract Price. Contractor shall not begin Work or accept payment unless Owner has received a completed copy of this Contract and all required exhibits. Owner and Contractor acknowledge that Exhibit A accurately depicts the Work to be performed. Principal products, materials, fixtures, and finishes are documented separately through Contractor&rsquo;s selections process and recorded in Contractor&rsquo;s project management system, including: (a) manufacturer name, brand, model, and model year; (b) size, capacity, dimensions, color, grade, and quality; (c) quantity; and (d) warranty information, to the extent such details are determined at the time of selection. Building and construction materials are described by: (a) material type and specifications; (b) quality and grade; (c) size and quantity; and (d) source or manufacturer (if specified). All specifications in Exhibit A and the selections record supersede any less specific references and control the Work. Owner acknowledges that Owner has: (a) received and reviewed the Schedule of Values and scope; (b) had opportunity to ask questions; (c) confirmed Exhibit A accurately reflects what Owner requested and what Contractor will construct; and (d) approved the scope and any product selections completed at the time of contracting. Contractor has sole control of construction methods and techniques (provided compliance with building codes and contract specifications), work sequencing and scheduling, coordination of subcontractors and suppliers, and daily site operations.</p>

  <p class="clause"><span class="clause-title"><span class="clause-num">4.</span>Materials and Selections.</span> Owner shall timely select all materials, appliances, colors, finishes, and allowance items not identified at the time of contracting, within deadlines reasonably established by Contractor in writing. Selections are documented through Contractor&rsquo;s project management system, which provides Owner with a secure customer portal to review, approve, and acknowledge selections electronically. Each approved selection becomes part of the Contract Documents upon Owner&rsquo;s written or electronic confirmation. Failure by Owner to make required selections by stated deadlines may result in a day-for-day extension of the Substantial Completion date, provided Contractor gives Owner written notice identifying the missing selections, resulting delay, and any revised completion date in accordance with the &ldquo;Delays&rdquo; section of this Contract. Contractor shall not substitute products or materials without Owner&rsquo;s prior written consent in a signed change order that clearly describes the substituted product or material (including make, model, color, grade, and finish) and any resulting change in price or schedule. Contractor will make reasonable efforts to match new materials to existing construction, but Owner understands that natural characteristics of building materials may result in color, texture, and finish variations, and perfect matches are not guaranteed. Variations inherent in the material type and within applicable industry standards (including minor shade variations, natural mineral marks, typical seams, and minor surface blemishes that do not affect performance) are not defects, provided materials otherwise conform to products, brands, models, and grades specified in this Contract or signed change orders. Excess materials delivered to the Project Site and not needed to complete the Work remain Contractor&rsquo;s property and may be removed at or after completion, unless the parties agree in writing that specific excess materials will be left for Owner.</p>

  <p class="clause"><span class="clause-title"><span class="clause-num">5.</span>Owner Duties.</span> Owner shall, at Owner&rsquo;s expense, provide and remain responsible for the following, to the extent applicable: (a) reasonable and safe access to the Project Site during normal construction hours; (b) identifying, testing, and lawful removal or remediation of existing hazardous materials or environmental conditions (including asbestos, lead, PCBs, mold, or fungi) not created by Contractor; (c) keeping children, pets, and occupants away from active Work areas; (d) identifying known private utilities and cooperating with necessary utility relocation; (e) providing temporary electricity, water, and toilet facilities for Contractor and subcontractors, unless otherwise stated; (f) if requested, providing an accurate survey showing known above-ground and underground structures and any recorded easements or site restrictions; (g) providing reasonably secure storage areas for Contractor&rsquo;s materials and equipment, if available; (h) removing, protecting, and reinstalling Owner&rsquo;s personal property affected by the Work, unless expressly included in the scope of Work; (i) except where damage is caused by Contractor&rsquo;s negligence or failure to exercise reasonable care, repairing normal wear or damage to access routes used by construction equipment, and performing finish grading, seeding, landscaping, walks, driveways, septic components, and utility repairs not included in the Work; (j) providing reasonable cooperation for Contractor to manage and conduct the Work, while retaining the right to communicate questions or concerns to Contractor&rsquo;s designated representative; and (k) if this Contract specifies Owner-furnished labor or materials, performing such work and furnishing such materials within a reasonable time after written notice from Contractor identifying what is required and when needed. Owner-furnished labor and materials shall conform to the Contract Documents, be of good and workmanlike quality, and meet all applicable codes. If unmarked or inaccurately marked underground utilities are damaged that were not disclosed to Contractor and could not reasonably have been detected by visual inspection, Owner shall be responsible for repair costs to the extent consistent with applicable Wisconsin law and only to the extent such responsibility does not limit Contractor&rsquo;s liability for its own negligence. This provision does not limit tort liability that cannot be waived under Wis. Stat. &sect; 895.447, and nothing in this Contract relieves Contractor from liability for damage caused by Contractor&rsquo;s failure to use reasonable care. Contractor does not guarantee against post-construction settling of fill around foundations, utility laterals, or other excavated areas where the Work was completed in accordance with this Contract and applicable standards, but remains responsible for correcting settlement-related conditions resulting from Contractor&rsquo;s failure to perform the Work in a proper and workmanlike manner.</p>

  <p class="clause"><span class="clause-title"><span class="clause-num">6.</span>Owner-Furnished Labor or Materials.</span> Owner is responsible for selecting and contracting with any third parties (other than Contractor and Contractor&rsquo;s subcontractors) who perform labor or supply materials, and for confirming such third parties carry appropriate insurance. This Contract does not require Owner to maintain or procure insurance for Contractor&rsquo;s benefit. To the extent permitted by Wisconsin law, Owner shall be responsible for losses, damages, or claims caused by the negligent or wrongful acts of Owner or Owner&rsquo;s separate contractors in connection with Owner-furnished work or materials, provided this responsibility shall not apply to any loss caused in whole or in part by Contractor&rsquo;s negligence or breach of contract. Owner is responsible for protecting and repairing damage to labor or materials supplied by Owner or Owner&rsquo;s separate contractors, except to the extent such damage is caused by Contractor&rsquo;s failure to exercise reasonable care. Work performed by Owner or Owner&rsquo;s separate contractors, and any defects or damage caused by them, is excluded from Contractor&rsquo;s limited warranty, but this exclusion does not affect any warranty Contractor has expressly provided for Contractor-furnished labor or materials, nor does it limit any statutory warranty, remedy, or claim Owner may have under Wisconsin law.</p>

  <p class="clause"><span class="clause-title"><span class="clause-num">7.</span>Permits.</span> Contractor shall, unless this Contract expressly provides otherwise, obtain all required state and local building permits, licenses, certifications, approvals, and legally required inspections necessary to perform the Work. The reasonable cost of permits and inspections shall be included as a separately identified charge in the Contract Price or in an approved change order. Before Owner signs this Contract, Contractor shall identify in writing the building or construction permits that Contractor reasonably understands are required for the home improvement based on the agreed Scope of Work. Contractor shall not start work until all required permits identified as Contractor&rsquo;s responsibility have been issued. Owner shall reasonably cooperate in obtaining permits and scheduling inspections, including signing permit applications when required by the permitting authority, but nothing in this Contract requires Owner to act as the permit holder in place of Contractor unless the Contract clearly and conspicuously states that Owner will obtain specific permits and explains the consequences of doing so.</p>

  <p class="clause"><span class="clause-title"><span class="clause-num">8.</span>Hazardous Materials.</span> If any hazardous material or environmental condition is discovered at the Project Site (including asbestos, lead, PCBs, mold, fungi, or similar hazards), Contractor may suspend work in affected areas until the condition has been inspected and, if necessary, removed, remediated, or rendered harmless by a qualified and licensed contractor or testing laboratory in compliance with applicable law, at Owner&rsquo;s expense unless the condition was caused by Contractor. Owner shall arrange and pay for investigation, testing, removal, remediation, and disposal of hazardous materials not created by Contractor, and shall provide Contractor with written documentation from a qualified professional that the affected area is safe for construction to resume. Contractor remains responsible for any hazardous material condition that Contractor introduces or causes through its own work. To the extent permitted by Wisconsin law, Owner shall be responsible for losses, costs, or damages caused by Owner&rsquo;s or Owner&rsquo;s separate contractors&rsquo; negligent handling of hazardous materials, provided this responsibility does not apply to any loss caused in whole or in part by Contractor&rsquo;s negligence or breach of contract, and does not limit tort liability under Wis. Stat. &sect; 895.447. Any suspension reasonably necessary due to hazardous materials not caused by Contractor shall entitle Contractor to a day-for-day extension of the Substantial Completion date for the period of delay, provided Contractor documents the suspension and revised completion date in writing per the &ldquo;Delays&rdquo; section. Owner represents, to the best of Owner&rsquo;s knowledge, that Owner is not aware of any underground storage tanks or environmental conditions at the Project Site that would reasonably cause delay or require remediation under environmental laws, other than those specifically disclosed in writing in this Contract.</p>

  <p class="clause"><span class="clause-title"><span class="clause-num">9.</span>Concealed, Latent, or Unforeseen Conditions.</span> Contractor shall not be responsible for costs, expenses, delays, or additional work arising from concealed, latent, hidden, unforeseen, uncovered, or otherwise unknown conditions at the Project Site that were not reasonably discoverable, disclosed, or anticipated at the time of contracting, including conditions behind walls, under floors, above ceilings, within building cavities, or otherwise concealed from reasonable visual inspection. Any work, materials, services, or costs not expressly included in the Scope of Work are excluded from the Contract Price unless added by written change order or other written amendment approved by Owner and Contractor as required by this Contract and applicable Wisconsin law. If Contractor discovers a concealed, latent, hidden, unforeseen, uncovered, or otherwise unknown condition, Contractor shall promptly notify Owner in writing and identify, to the extent reasonably practicable, the condition discovered, the anticipated effect on the Work, and any proposed additional work, cost, or time adjustment. Except for emergency measures reasonably necessary to protect persons or property, comply with law, or prevent further damage, Contractor shall have no obligation to perform additional work arising from such condition, and Owner shall not be obligated to pay for such additional work, unless the additional work, price adjustment, and any schedule adjustment are approved in a written change order or other written amendment before the additional work is performed. Nothing in this section limits Contractor&rsquo;s obligation to perform the Work properly and in a good and workmanlike manner, comply with permits, codes, ATCP 110, and applicable Wisconsin law, or remain responsible for conditions caused by Contractor&rsquo;s own negligence, breach of contract, or failure to exercise reasonable care.</p>

  <p class="clause"><span class="clause-title"><span class="clause-num">10.</span>Insurance.</span> Owner and Contractor shall each maintain insurance consistent with their respective roles and obligations under this Contract and applicable Wisconsin law. Owner is responsible for maintaining property insurance in amounts and coverages Owner deems appropriate, insuring the Project Site and existing structures against risks of physical loss or damage (including fire, wind, theft, vandalism, and collapse) during performance of the Work, except to the extent such loss is caused by Contractor&rsquo;s failure to exercise reasonable care. Contractor shall maintain workers&rsquo; compensation insurance to the extent required by applicable Wisconsin law and commercial general liability insurance in customary amounts providing coverage for bodily injury and property damage arising out of Contractor&rsquo;s performance of the Work. Upon request by either party, each party shall provide reasonable evidence (including a certificate of insurance) that required coverages are in effect; however, failure to request or provide such evidence does not waive any insurance obligation stated in this Contract.</p>

  <p class="clause"><span class="clause-title"><span class="clause-num">11.</span>Payments.</span> Owner shall pay each properly issued invoice within five (5) business days after receipt, including amounts due for approved written changes and allowance overages clearly described and priced in writing. Charges for changes or allowance overages shall be based on a written change order or selection document signed or expressly approved by Owner before the additional Work is performed, and shall be separately itemized on the invoice. Allowance overages shall be invoiced when each item is selected or as soon thereafter as reasonably practicable, and allowance underages shall be clearly identified in writing and credited against Final Payment or, if agreed, against an earlier invoice. Owner shall pay a finance charge of 1.5% per month (pro-rated for partial months) on past due amounts, plus reasonable costs of collection actually incurred, including attorney&rsquo;s fees, as allowed under Wisconsin law. Before making any payment, Owner is entitled to request written lien waivers as provided in ATCP 110.025. If Owner requests lien waivers, Contractor shall provide lien waivers from Contractor and, as applicable, from subcontractors and material suppliers for the proportionate value of labor, services, and materials furnished as of each payment. Owner may request lien waivers for final payment only or for each partial payment. Providing or receiving lien waivers does not waive any contractual rights or defenses of either party. Owner may withhold from any payment, including Final Payment, a reasonable amount necessary to address incomplete or defective items, disputed charges, or other bona fide claims, consistent with ATCP 110 and Wisconsin law. If the parties agree to withhold a specific amount for identified punch-list items, they shall document the items, amount withheld, and reasonable date for completion and payment. Final Payment and signing of any completion document shall not waive any claims, defenses, or remedies Owner may have under this Contract, ATCP 110, or Wis. Stat. &sect; 100.20, including warranty claims, lien-related rights, or remedies for Contractor&rsquo;s failure to perform, all of which are expressly preserved.</p>

  <p class="clause"><span class="clause-title"><span class="clause-num">12.</span>Allowances.</span> Allowances listed in Exhibit A or elsewhere in this Contract are estimates for specified items that have not been finally selected, priced, or purchased at the time of contracting. Unless this Contract expressly states otherwise, each allowance amount includes Contractor&rsquo;s anticipated cost for the applicable item plus Contractor&rsquo;s overhead and profit margin, and is intended solely as an estimated amount for that specified allowance item. If the actual cost of an allowance item exceeds the stated allowance amount, Owner shall be responsible for the overage. The allowance overage shall consist of the difference between the stated allowance amount and the actual cost incurred, together with Contractor&rsquo;s overhead and profit applied to the overage at the same rate included in the original allowance, unless otherwise expressly agreed in writing. Under no circumstances shall Contractor be required to absorb allowance overruns, reduce its disclosed profit margin, or perform allowance work at cost. Charges for allowance overages shall be clearly described and priced in writing and shall be approved by written change order, selection document, or other written approval by Owner before the applicable item is ordered, procured, installed, or otherwise incorporated into the Work, except to the extent otherwise permitted by ATCP 110 and applicable Wisconsin law. Payment of allowance overages, including applicable overhead and profit, shall be due upon invoicing and may be required before ordering, procurement, or installation of the applicable allowance item. Allowance underages shall be clearly identified in writing and credited as provided in Section 11, above.</p>

  <p class="clause"><span class="clause-title"><span class="clause-num">13.</span>Escrow.</span> If Escrow is required under this Contract, the portion of the Contract Price not paid as a down payment shall be deposited into an escrow account with a lender or escrow agent mutually acceptable to Owner and Contractor, and shall be disbursed in installments as construction progresses per the progress payment schedule in this Contract. The escrow arrangement does not alter Owner&rsquo;s rights under Wisconsin home improvement law, including Owner&rsquo;s right to request lien waivers and Owner&rsquo;s remedies under ATCP 110 if Contractor fails to perform timely or as agreed. When Contractor submits a progress payment request consistent with the agreed schedule and the described Work has been performed, Owner shall promptly authorize the escrow agent to release the corresponding payment to Contractor, generally within two (2) business days after receiving the request, unless Owner in good faith disputes all or part of the requested amount. Owner may withhold only the disputed portion while releasing the undisputed portion, and shall promptly notify Contractor in writing of the specific reasons for the dispute. No Escrow funds designated for the original scope of Work shall be applied to Changes or extras unless the Change has been approved in a written change order signed or expressly approved by both parties, and the change order clearly states whether and to what extent Escrow will fund that Change.</p>

  <p class="clause"><span class="clause-title"><span class="clause-num">14.</span>Lien Waivers.</span> Owner is entitled to request written lien waivers at any time before or at the time of any payment under this Contract, as provided in ATCP 110.025. If Owner requests lien waivers, Contractor shall provide lien waivers from Contractor and, as applicable, from all subcontractors and material suppliers for the proportionate value of all labor, services, and materials furnished or delivered as of the date of each progress payment. As a condition of receiving Final Payment, Contractor shall provide Owner with lien waivers from Contractor and, as applicable, from all subcontractors and material suppliers for the full amount of their respective labor, services, and materials furnished for the Project, so that Owner receives lien waivers covering the entire Work upon Final Payment. These lien waiver rights and obligations comply with ATCP 110.025 and do not limit any additional lien-related rights Owner may have under Wisconsin law.</p>

  <p class="clause"><span class="clause-title"><span class="clause-num">15.</span>Changes.</span> Any change affecting the description of Work, materials, Contract Price, or time for performance must be documented in a written change order signed or expressly approved by Owner before the changed Work is performed. Change Orders are issued through Contractor&rsquo;s project management system, which generates a written Change Order document delivered to Owner through a secure customer portal for review and electronic or written approval. Each approved Change Order is incorporated into this Contract upon Owner&rsquo;s confirmation. Contractor may not unilaterally substitute products or materials, or alter the scope of Work, if the change would reduce quality, grade, or value, or contradict specific products identified in this Contract, without Owner&rsquo;s prior written consent. Minor field adjustments that do not increase the Contract Price, do not reduce quality or value, and are consistent with specified products, brands, and grades may be made by Contractor, provided Contractor documents and reports such adjustments to Owner before requesting Final Payment. All other changes shall be set forth in a written Change Order that: (a) describes the Work added, deleted, or revised; (b) states the resulting price change or method for calculating it (including any markup for overhead and profit); and (c) states any adjustment to the time for Substantial Completion. Any markup for changes shall be clearly disclosed in this Contract or in the Change Order itself. Owner is not required to approve a proposed Change Order and may decline any requested change not required to meet code or safety standards.</p>

  <p class="clause"><span class="clause-title"><span class="clause-num">16.</span>Delays.</span> If Contractor is delayed due to: (a) Owner&rsquo;s failure to timely provide required information, approvals, or materials; (b) Owner&rsquo;s failure to make payments when due; (c) Owner-directed changes; (d) delays by governmental authorities, utilities, or third parties outside Contractor&rsquo;s control; (e) adverse weather or acts of nature making performance impracticable or unsafe; (f) suspension for hazardous materials remediation not created by Contractor; or (g) vandalism, fire, or damage not caused by Contractor, then Contractor shall be entitled to a reasonable, day-for-day extension of the Substantial Completion deadline for the period of delay, plus reasonable time for rescheduling and mobilizing subcontractors. Any extension and reasons shall be documented in writing, and no deadline change is effective unless Owner agrees in writing. If an excusable delay results in demonstrable, reasonable additional costs to Contractor (such as extended equipment rental, remobilization, or documented increases in labor or material costs directly caused by the delay), Contractor may request an equitable adjustment to the Contract Price, but only if costs are itemized in a written change order approved by Owner. Upon Owner&rsquo;s request, Contractor shall provide reasonable documentation supporting such costs. Owner and Contractor agree to communicate in a reasonable and cooperative manner. Owner may raise questions or concerns but agrees not to unreasonably interfere with or obstruct performance. If Owner suspends the Work for Owner&rsquo;s convenience or fails to make the Project Site reasonably available for thirty (30) days or more, and such suspension is not required for remediation of Contractor-caused conditions or exercise of Owner&rsquo;s rights under ATCP 110, Contractor may, after written notice and reasonable opportunity to cure, elect to terminate this Contract under the &ldquo;Termination&rdquo; section. This section does not waive Owner&rsquo;s remedies under ATCP 110.07 if Contractor fails to perform timely or give required delay notices.</p>

  <p class="clause"><span class="clause-title"><span class="clause-num">17.</span>Warranty.</span> Contractor warrants that all materials and equipment it furnishes will be new (unless otherwise specified), of good quality, in conformance with the Contract Documents, free from defective workmanship and materials, and that the Work will be performed in a good and workmanlike manner consistent with applicable building codes and industry standards. This warranty does not apply to: (a) defects caused by work or design furnished by others; (b) normal wear and tear or natural aging of materials; (c) misuse or use for unintended purposes; (d) lack of reasonable or manufacturer-recommended maintenance; (e) alterations or repairs by Owner or Owner&rsquo;s contractors after completion; or (f) defects in products covered by manufacturer warranty and not caused by Contractor&rsquo;s installation. These exclusions do not limit Owner&rsquo;s nonwaivable statutory rights under Wisconsin law. Contractor shall provide Owner with copies of manufacturer warranties reasonably available to Contractor for principal products, fixtures, appliances, equipment, windows, doors, roofing materials, siding, and other major materials incorporated into the Work. Contractor is not required to provide separate warranty documentation for incidental, consumable, commodity, or minor materials, including fasteners, bulbs, adhesives, sealants, or similar items, unless specifically requested by Owner and reasonably available to Contractor. Manufacturer warranties are in addition to Contractor&rsquo;s warranty obligations under this Contract and Wisconsin law. Contractor&rsquo;s warranty for its labor and materials shall commence upon Substantial Completion and continue for twelve (12) months, unless a longer period is expressly provided for particular items. This warranty extends to Owner and any subsequent purchaser of the Property during the warranty period to the extent required by Wisconsin law. If Owner discovers a condition constituting a defect, Owner shall notify Contractor within a reasonable time after discovery, describing the condition with sufficient detail. Contractor shall have a reasonable opportunity to inspect and correct the condition.</p>

  <p class="clause"><span class="clause-title"><span class="clause-num">18.</span>Dispute Resolution.</span> This Contract is governed by Wisconsin law, including ATCP 110 and Wis. Stat. &sect; 100.20. Nothing in this provision limits Owner&rsquo;s nonwaivable rights or remedies under those laws, including the right to seek statutory damages, attorneys&rsquo; fees, or other relief in court. Owner and Contractor agree to first attempt to resolve disputes through good-faith direct discussions and, if both parties agree in writing, through voluntary mediation. Mediation is nonbinding, and either party may end mediation if it does not appear likely to resolve the dispute. If the parties have a written agreement to submit disputes to binding arbitration, arbitration shall be conducted in Wisconsin under Wis. Stat. Chapter 788. The arbitrator&rsquo;s written decision shall be final and binding to the extent allowed by Wisconsin law and may be confirmed and enforced in court. This provision does not prohibit Owner from filing a complaint with DATCP or seeking statutory remedies that cannot be waived under Wisconsin law. Each party shall bear its own attorneys&rsquo; fees and costs except where a statute or court rule expressly allows recovery by a prevailing party, consistent with Owner&rsquo;s statutory rights under Wis. Stat. &sect; 100.20(5).</p>

  <p class="clause"><span class="clause-title"><span class="clause-num">19.</span>Termination.</span> Owner acknowledges receipt of the &ldquo;Notice of Cancellation&rdquo; (Exhibit E) describing Owner&rsquo;s three-business-day right to cancel. Owner may cancel this Contract without penalty by giving written notice to Contractor within three (3) business days after signing, as described in Exhibit E. If Owner timely exercises this right, Contractor shall promptly refund all payments, except amounts Wisconsin law permits Contractor to retain for emergency services expressly requested in writing during that period. If Owner terminates after the three-day period and not pursuant to statutory cancellation rights (including ATCP 110.07 remedies), Contractor shall be entitled to payment for: (a) reasonable value of Work properly performed; (b) reasonable cost of materials specially ordered that cannot be returned or reused, less salvage value; and (c) reasonable overhead and profit on Work actually performed, to the extent consistent with Wisconsin law and not constituting an unlawful penalty. Amounts shall be documented in writing and provided to Owner upon request. Contractor may terminate for cause if Owner materially breaches this Contract, provided Contractor first gives Owner written notice and reasonable opportunity to cure. If Contractor terminates for cause, Owner shall owe the same amounts described above, subject to defenses or statutory remedies available under Wisconsin law. Nothing in this section limits Owner&rsquo;s statutory rights to cancel, rescind, or demand return of payments under ATCP 110.07 or other Wisconsin law.</p>

  <p class="clause"><span class="clause-title"><span class="clause-num">20.</span>Indemnification.</span> Owner shall be responsible, to the extent permitted by Wisconsin law, for losses, claims, or damages for bodily injury or property damage caused by the negligent or intentional acts of Owner, Owner&rsquo;s agents, or persons invited to the Project Site by Owner, and shall indemnify Contractor only to the extent such losses are actually caused by those acts. This indemnity does not apply to any loss caused in whole or in part by Contractor&rsquo;s negligence, breach of contract, or other fault, and does not limit tort liability under Wis. Stat. &sect; 895.447 or Owner&rsquo;s rights under ATCP 110.</p>

  <p class="clause"><span class="clause-title"><span class="clause-num">21.</span>Marketing.</span> Owner agrees that Contractor may display a temporary job sign at the Project Site during the Work, provided it complies with applicable laws and is removed within a reasonable time after completion. Contractor shall not represent that Owner is receiving special pricing or compensation for allowing the property to be used as a &ldquo;model&rdquo; or &ldquo;advertising job&rdquo; unless that compensation is clearly disclosed in this Contract per ATCP 110. Owner grants Contractor permission to photograph or video the Work and Project Site for documenting the Work and for portfolio, website, social media, advertising and marketing purposes. Photographs used for advertising that include identifiable persons shall not be used without written consent as required by Wisconsin privacy law. Contractor shall take reasonable steps to avoid displaying personal identifying information without Owner&rsquo;s consent.</p>

  <p class="clause"><span class="clause-title"><span class="clause-num">22.</span>Concurrent Projects.</span> Owner may hire other contractors to perform work at the Project Site, provided such work does not unreasonably interfere with or delay Contractor&rsquo;s performance and Owner provides reasonable advance notice to Contractor. Owner agrees to consult with Contractor before engaging other contractors for work that directly overlaps with this Work. Nothing in this Contract grants Contractor exclusive rights to perform all construction work at the Property.</p>

  <p class="clause"><span class="clause-title"><span class="clause-num">23.</span>Project Site Conditions.</span> Owner understands that the Work will generate noise, dust, fumes, vapors, odors, and debris typical for the type of work performed. Contractor shall use reasonable care and customary practices to limit and manage such conditions consistent with applicable codes. To the extent permitted by Wisconsin law, Owner shall be responsible for claims by third parties arising solely from ordinary and non-negligent construction impacts inherent in the Work. This does not relieve Contractor of responsibility for negligent or unlawful acts, does not limit tort liability under Wis. Stat. &sect; 895.447, and does not waive Owner&rsquo;s rights under ATCP 110.</p>

  <p class="clause"><span class="clause-title"><span class="clause-num">24.</span>Property Damage Risk from Roof and Structure Removal.</span> The Project may require removal of roofing materials, which can temporarily expose the interior to weather. Contractor shall use reasonable care and customary roofing practices to provide temporary protection (including tarps and staging work in light of forecasts), but Owner understands temporary measures are not completely weather-tight under all conditions. Owner is encouraged to remove or protect personal property in areas that could be affected. Contractor remains responsible for damage resulting from Contractor&rsquo;s failure to exercise reasonable care in providing temporary protection or scheduling the Work, but is not responsible for damage caused solely by unexpected or severe weather despite reasonable protective measures, unless otherwise required by Wisconsin law.</p>

  <p class="clause"><span class="clause-title"><span class="clause-num">25.</span>Substantial Completion.</span> Substantial Completion means the stage when the Work is sufficiently complete per the Contract Documents so Owner can reasonably use or occupy the improved area for its intended purpose, subject only to minor punch-list items that do not materially impair use. If an occupancy permit is required, Substantial Completion occurs when such permit is issued, provided Contractor has completed required Work. Substantial Completion is targeted for the Estimated Completion Date, subject to written extensions complying with ATCP 110.04, including the requirement that deadline changes be agreed to in writing by Owner after Contractor provides written delay notice stating reasons and new proposed deadlines. Final completion, including all punch-list items, cleanup, and close-out documents, shall occur within a reasonable time after Substantial Completion, consistent with Owner&rsquo;s rights under ATCP 110.</p>

  <p class="clause"><span class="clause-title"><span class="clause-num">26.</span>Miscellaneous.</span> The Contract Documents are essential parts of this Contract, and requirements stated in one are binding as though stated in all. Inconsistencies shall be resolved in the following order: (a) this Contract (including amendments and Change Orders); (b) written specifications and plans; and (c) other Contract Documents. This does not authorize Contractor to substitute products or materials without Owner&rsquo;s consent per ATCP 110. Failure to insist upon strict performance or delay in exercising rights shall not constitute waiver. Provisions intended to apply after completion (including warranty, indemnity, dispute resolution, and lien provisions) survive termination to the extent permitted by Wisconsin law. This Contract is the final written expression of the parties&rsquo; agreement, but does not disclaim, limit, or waive nonwaivable rights based on false, deceptive, or misleading representations violating ATCP 110 or Wis. Stat. &sect; 100.20. Neither party may assign this Contract without the other&rsquo;s written consent, except Contractor may assign its right to receive payments to a lender without relieving Contractor of performance obligations. Any assignment is subject to all claims and defenses Owner may have under this Contract and Wisconsin law. In the event of conflict between this Contract and ATCP 110 or Wisconsin consumer protection law, Wisconsin law controls.</p>

  <!-- ========== EXECUTION ========== -->
  <div class="signature-section">
    <div class="signature-prelude">
      <strong>By signing below,</strong> Owner acknowledges that Owner received a completed copy of this Contract and all required exhibits before Contractor began Work or accepted payment.
    </div>

    <div class="sig-block">
      <div class="sig-block-label">Contractor</div>
      <div class="sig-block-name">J.J. Greil Enterprises, LLC <em>d/b/a</em> JG Restoration</div>
      <div class="sig-row">
        <div class="sig-field" style="flex:2;">
          <div class="sig-field-line"></div>
          <div class="sig-field-label">By &mdash; Authorized Signature</div>
        </div>
        <div class="sig-field">
          <div class="sig-field-line"></div>
          <div class="sig-field-label">Title</div>
        </div>
        <div class="sig-field narrow">
          <div class="sig-field-line"></div>
          <div class="sig-field-label">Date</div>
        </div>
      </div>
    </div>

    <div class="sig-block">
      <div class="sig-block-label">Owner</div>
      <div class="sig-row">
        <div class="sig-field" style="flex:2;">
          <div class="sig-field-line"></div>
          <div class="sig-field-label">Signature</div>
        </div>
        <div class="sig-field">
          <div class="sig-field-line"></div>
          <div class="sig-field-label">Printed Name</div>
        </div>
        <div class="sig-field narrow">
          <div class="sig-field-line"></div>
          <div class="sig-field-label">Date</div>
        </div>
      </div>
    </div>

    <div class="sig-block">
      <div class="sig-block-label">Owner (if joint)</div>
      <div class="sig-row">
        <div class="sig-field" style="flex:2;">
          <div class="sig-field-line"></div>
          <div class="sig-field-label">Signature</div>
        </div>
        <div class="sig-field">
          <div class="sig-field-line"></div>
          <div class="sig-field-label">Printed Name</div>
        </div>
        <div class="sig-field narrow">
          <div class="sig-field-line"></div>
          <div class="sig-field-label">Date</div>
        </div>
      </div>
    </div>
  </div>

</section>

<!-- ==================================================================
     EXHIBIT A — SCHEDULE OF VALUES & SCOPE OF WORK (SOV-DRIVEN)
     ================================================================== -->
<section class="exhibit-page">
  <div class="exhibit-hero">
    <div class="exhibit-letter">Exhibit A</div>
    <h2 class="exhibit-title">Schedule of Values &amp; Scope of Work</h2>
    <p class="exhibit-blurb">This Schedule of Values itemizes the Work by trade and construction phase. The total of all line items, together with applicable tax, overhead, and profit as identified below, comprises the Contract Price stated on page 2.</p>
  </div>

  <div class="sov-summary">
    <div class="sov-summary-row">
      <span class="sov-summary-label">Project Reference</span>
      <span class="sov-summary-value" id="sov_project_ref">&nbsp;</span>
    </div>
    <div class="sov-summary-row">
      <span class="sov-summary-label">Schedule of Values Version / Date</span>
      <span class="sov-summary-value" id="sov_version_date">&nbsp;</span>
    </div>
    <div class="sov-summary-row">
      <span class="sov-summary-label">Source Estimate</span>
      <span class="sov-summary-value" id="sov_source_estimate">&nbsp;</span>
    </div>
  </div>

  <div class="exhibit-subhead">Schedule of Values by Trade</div>
  <table class="exhibit-table sov-table">
    <thead>
      <tr>
        <th style="width:7%;">#</th>
        <th style="width:30%;">Trade / Division</th>
        <th>Scope Description</th>
        <th style="width:16%;text-align:right;">Value</th>
      </tr>
    </thead>
    <tbody id="sov_phase_table_body">
      <tr><td colspan="4" class="sov-phase-row">PHASE 1 &mdash; PRE-CONSTRUCTION &amp; GENERAL CONDITIONS</td></tr>
      <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td class="num">$</td></tr>
      <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td class="num">$</td></tr>

      <tr><td colspan="4" class="sov-phase-row">PHASE 2 &mdash; DEMOLITION &amp; STRUCTURAL</td></tr>
      <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td class="num">$</td></tr>
      <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td class="num">$</td></tr>

      <tr><td colspan="4" class="sov-phase-row">PHASE 3 &mdash; ROOFING &amp; EXTERIOR ENVELOPE</td></tr>
      <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td class="num">$</td></tr>
      <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td class="num">$</td></tr>

      <tr><td colspan="4" class="sov-phase-row">PHASE 4 &mdash; WINDOWS &amp; EXTERIOR DOORS</td></tr>
      <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td class="num">$</td></tr>

      <tr><td colspan="4" class="sov-phase-row">PHASE 5 &mdash; MEP (MECHANICAL, ELECTRICAL, PLUMBING)</td></tr>
      <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td class="num">$</td></tr>
      <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td class="num">$</td></tr>

      <tr><td colspan="4" class="sov-phase-row">PHASE 6 &mdash; INSULATION, DRYWALL &amp; PAINT</td></tr>
      <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td class="num">$</td></tr>
      <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td class="num">$</td></tr>

      <tr><td colspan="4" class="sov-phase-row">PHASE 7 &mdash; FINISH CARPENTRY, FLOORING &amp; SPECIALTIES</td></tr>
      <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td class="num">$</td></tr>
      <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td class="num">$</td></tr>
    </tbody>
  </table>

  <table class="sov-totals">
    <tr><td>Subtotal &mdash; Schedule of Values</td><td class="num" id="sov_subtotal">$</td></tr>
    <tr><td>Material Sales Tax</td><td class="num" id="sov_tax">$</td></tr>
    <tr><td>Overhead</td><td class="num" id="sov_overhead">$</td></tr>
    <tr><td>Profit</td><td class="num" id="sov_profit">$</td></tr>
    <tr class="grand"><td>CONTRACT PRICE</td><td class="num" id="sov_contract_price">$</td></tr>
  </table>

  <div class="sov-callout">
    <strong>Auto-Generation Notice.</strong> This Schedule of Values is generated by Contractor&rsquo;s project management system from the source construction estimate identified above. Trade groupings, phase ordering, and value totals tie directly to the source estimate. Selections of materials, fixtures, and finishes; allowance items; and any subsequent Change Orders are documented separately and made accessible to Owner through a secure customer portal.
  </div>

  <div class="exhibit-subhead">Exclusions / Owner-Furnished Items</div>
  <table class="exhibit-table">
    <tr><td style="height:80pt;" id="sov_exclusions"></td></tr>
  </table>
</section>

<!-- ==================================================================
     EXHIBIT B — WISCONSIN CONSTRUCTION LIEN NOTICE
     ================================================================== -->
<section class="exhibit-page">
  <div class="exhibit-hero">
    <div class="exhibit-letter">Exhibit B</div>
    <h2 class="exhibit-title">Wisconsin Construction Lien Notice</h2>
    <p class="exhibit-blurb">Statutory notice required by the Wisconsin Construction Lien Law concerning potential lien rights of contractors, subcontractors, and material suppliers.</p>
  </div>

  <div class="legal-notice urgent">
    AS REQUIRED BY THE WISCONSIN CONSTRUCTION LIEN LAW, CLAIMANT HEREBY NOTIFIES OWNER THAT PERSONS OR COMPANIES PERFORMING, FURNISHING, OR PROCURING LABOR, SERVICES, MATERIALS, PLANS, OR SPECIFICATIONS FOR THE CONSTRUCTION ON OWNER&rsquo;S LAND MAY HAVE LIEN RIGHTS ON OWNER&rsquo;S LAND AND BUILDINGS IF NOT PAID. THOSE ENTITLED TO LIEN RIGHTS, IN ADDITION TO THE UNDERSIGNED CLAIMANT, ARE THOSE WHO CONTRACT DIRECTLY WITH THE OWNER OR THOSE WHO GIVE THE OWNER NOTICE WITHIN 60 DAYS AFTER THEY FIRST PERFORM, FURNISH, OR PROCURE LABOR, SERVICES, MATERIALS, PLANS OR SPECIFICATIONS FOR THE CONSTRUCTION. ACCORDINGLY, OWNER PROBABLY WILL RECEIVE NOTICES FROM THOSE WHO PERFORM, FURNISH, OR PROCURE LABOR, SERVICES, MATERIALS, PLANS, OR SPECIFICATIONS FOR THE CONSTRUCTION, AND SHOULD GIVE A COPY OF EACH NOTICE RECEIVED TO THE MORTGAGE LENDER, IF ANY. CLAIMANT AGREES TO COOPERATE WITH THE OWNER AND THE OWNER&rsquo;S LENDER, IF ANY, TO SEE THAT ALL POTENTIAL LIEN CLAIMANTS ARE DULY PAID.
  </div>

  <div class="sig-block">
    <div class="sig-row">
      <div class="sig-field" style="flex:2;"><div class="sig-field-line"></div><div class="sig-field-label">Owner Acknowledgment</div></div>
      <div class="sig-field narrow"><div class="sig-field-line"></div><div class="sig-field-label">Date</div></div>
    </div>
    <div class="sig-row">
      <div class="sig-field" style="flex:2;"><div class="sig-field-line"></div><div class="sig-field-label">Owner Acknowledgment (if joint)</div></div>
      <div class="sig-field narrow"><div class="sig-field-line"></div><div class="sig-field-label">Date</div></div>
    </div>
  </div>
</section>

<!-- ==================================================================
     EXHIBIT C — LIEN WAIVER RIGHT NOTICE
     ================================================================== -->
<section class="exhibit-page">
  <div class="exhibit-hero">
    <div class="exhibit-letter">Exhibit C</div>
    <h2 class="exhibit-title">Notice of Consumer&rsquo;s Right to Receive Lien Waivers</h2>
  </div>

  <p>If a consumer requests lien waivers, a seller of home improvement services must provide lien waivers from all contractors, subcontractors, and material suppliers. This Wisconsin law protects consumers from having liens filed against their property. Lien waivers prevent the filing of a lien on your home in the event that a contractor does not pay suppliers or subcontractors.</p>

  <p style="margin-top:12pt;">For more information about home improvement law, contact the <strong>Wisconsin Consumer Protection Bureau</strong> at <strong>1-800-422-7128</strong> or <strong>www.datcp.wi.gov</strong>. By signing below, Owner acknowledges receipt of this separate notice before entering into the Contract.</p>

  <div class="sig-block" style="margin-top:30pt;">
    <div class="sig-row">
      <div class="sig-field" style="flex:2;"><div class="sig-field-line"></div><div class="sig-field-label">Owner Signature</div></div>
      <div class="sig-field narrow"><div class="sig-field-line"></div><div class="sig-field-label">Date</div></div>
    </div>
    <div class="sig-row">
      <div class="sig-field" style="flex:2;"><div class="sig-field-line"></div><div class="sig-field-label">Owner Signature (if joint)</div></div>
      <div class="sig-field narrow"><div class="sig-field-line"></div><div class="sig-field-label">Date</div></div>
    </div>
  </div>
</section>

<!-- ==================================================================
     EXHIBIT D — RIGHT TO CANCEL
     ================================================================== -->
<section class="exhibit-page">
  <div class="exhibit-hero">
    <div class="exhibit-letter">Exhibit D</div>
    <h2 class="exhibit-title">Consumer&rsquo;s Right to Cancel</h2>
    <p class="exhibit-blurb">Three-business-day cancellation notice as required by Wisconsin law.</p>
  </div>

  <p>You may cancel the attached Residential Home Improvement Contract by mailing or delivering a written notice to Contractor at the following address:</p>

  <div class="info-card" style="margin-top:12pt;">
    <div class="info-card-body address-block">
      <strong>J.J. Greil Enterprises, LLC</strong> <em>d/b/a</em> JG Restoration<br>
      1720 N. Silverspring Dr.<br>
      Appleton, WI 54913<br>
      Phone: (920) 313-3811<br>
      Email: sales@jg-restoration.com
    </div>
  </div>

  <p>before midnight of the third business day after you signed the Contract. If you wish, you may use this page as that notice by writing &ldquo;I hereby cancel&rdquo; and adding your name, address, signature, and date below. Contractor should provide Owner with duplicate copies of this notice where required by law.</p>

  <div class="cancel-form">
    <div class="cancel-form-banner">Notice of Cancellation</div>
    <p style="font-family:'Helvetica Neue',sans-serif;font-size:9.5pt;font-weight:600;color:var(--navy);margin-bottom:14pt;letter-spacing:0.02em;">OWNER HEREBY CANCELS THE RESIDENTIAL HOME IMPROVEMENT CONTRACT DATED <span class="fill-line medium" id="cancellation_contract_date"></span></p>

    <div class="sig-row" style="margin-top:14pt;">
      <div class="sig-field" style="flex:1;"><div class="sig-field-line"></div><div class="sig-field-label">Date</div></div>
      <div class="sig-field" style="flex:2;"><div class="sig-field-line"></div><div class="sig-field-label">Name</div></div>
    </div>
    <div class="sig-row">
      <div class="sig-field" style="flex:3;"><div class="sig-field-line"></div><div class="sig-field-label">Address</div></div>
    </div>
    <div class="sig-row">
      <div class="sig-field" style="flex:3;"><div class="sig-field-line"></div><div class="sig-field-label">Signature</div></div>
    </div>
  </div>
</section>

<!-- ==================================================================
     EXHIBIT E — RIGHT TO CURE ACKNOWLEDGMENT
     ================================================================== -->
<section class="exhibit-page">
  <div class="exhibit-hero">
    <div class="exhibit-letter">Exhibit E</div>
    <h2 class="exhibit-title">Wisconsin Right to Cure Law Acknowledgment</h2>
  </div>

  <p>Owner acknowledges receipt, at the time of contracting, of the Wisconsin &ldquo;Right to Cure Law&rdquo; brochure/notice concerning construction defects. The notice explains that Wisconsin law contains requirements that must be followed before a lawsuit or arbitration is commenced for alleged defective construction, including written notice of alleged defects and an opportunity for Contractor to respond, inspect, and offer repair or other remedy.</p>

  <div class="sig-block" style="margin-top:30pt;">
    <div class="sig-row">
      <div class="sig-field" style="flex:2;"><div class="sig-field-line"></div><div class="sig-field-label">Owner Signature</div></div>
      <div class="sig-field narrow"><div class="sig-field-line"></div><div class="sig-field-label">Date</div></div>
    </div>
    <div class="sig-row">
      <div class="sig-field" style="flex:2;"><div class="sig-field-line"></div><div class="sig-field-label">Owner Signature (if joint)</div></div>
      <div class="sig-field narrow"><div class="sig-field-line"></div><div class="sig-field-label">Date</div></div>
    </div>
    <div class="sig-row">
      <div class="sig-field" style="flex:2;"><div class="sig-field-line"></div><div class="sig-field-label">Contractor Signature</div></div>
      <div class="sig-field narrow"><div class="sig-field-line"></div><div class="sig-field-label">Date</div></div>
    </div>
  </div>
</section>

<!-- ==================================================================
     EXHIBIT F — INSURANCE CLAIM QUESTIONNAIRE
     ================================================================== -->
<section class="exhibit-page">
  <div class="exhibit-hero">
    <div class="exhibit-letter">Exhibit F</div>
    <h2 class="exhibit-title">Insurance Claim Questionnaire &amp; Insurance-Related Cancellation</h2>
    <p class="exhibit-blurb">Use for any contract to repair or replace a roof system or to perform exterior repair, replacement, construction, or reconstruction of residential real estate.</p>
  </div>

  <div class="exhibit-subhead">A. Insurance Coverage Questionnaire</div>
  <p>Please indicate whether, to the best of your knowledge, the work contemplated by this contract is related to a claim under a property insurance policy:</p>

  <div class="checkbox-row" style="margin-top:14pt;">
    <span class="checkbox"></span><strong style="margin-right:6pt;">YES,</strong> to the best of my knowledge, the work contemplated by this contract is related to a claim under a property insurance policy.
  </div>
  <div class="checkbox-row">
    <span class="checkbox"></span><strong style="margin-right:6pt;">NO,</strong> to the best of my knowledge, the work contemplated by this contract is not related to a claim under a property insurance policy.
  </div>

  <div class="sig-block" style="margin-top:18pt;">
    <div class="sig-row">
      <div class="sig-field narrow"><div class="sig-field-line"></div><div class="sig-field-label">Date</div></div>
      <div class="sig-field" style="flex:2;"><div class="sig-field-line"></div><div class="sig-field-label">Customer Signature</div></div>
    </div>
    <div class="sig-row">
      <div class="sig-field" style="flex:2;"><div class="sig-field-line"></div><div class="sig-field-label">Residential Contractor Signature</div></div>
      <div class="sig-field narrow"><div class="sig-field-line"></div><div class="sig-field-label">Date</div></div>
    </div>
  </div>

  <p style="margin-top:18pt;font-size:9.5pt;font-style:italic;color:var(--slate);">You may cancel this contract at any time before midnight on the third business day after you have received written notice from your insurer that the claim has been denied in whole or in part under the property insurance policy. See the attached notice of cancellation form for an explanation of this right.</p>

  <div class="exhibit-subhead">B. Limited Insurance Communication Authorization</div>
  <p>Owner expressly consents to Contractor communicating with Owner&rsquo;s insurance company <strong>only</strong> for the following limited purposes: (a) discussing damage to the property; (b) preparing and providing repair, replacement, construction, or reconstruction estimates; (c) submitting estimates to the insurance company; and (d) discussing repair or reconstruction options, materials, methods, and specifications.</p>

  <p style="margin-top:10pt;">Contractor will not represent Owner, negotiate on Owner&rsquo;s behalf, agree to insurance coverage terms, agree to deductible or settlement amounts, or make insurance claim decisions for Owner.</p>

  <div class="sig-block" style="margin-top:18pt;">
    <div class="sig-row">
      <div class="sig-field" style="flex:2;"><div class="sig-field-line"></div><div class="sig-field-label">Owner Signature</div></div>
      <div class="sig-field narrow"><div class="sig-field-line"></div><div class="sig-field-label">Date</div></div>
    </div>
    <div class="sig-row">
      <div class="sig-field" style="flex:2;"><div class="sig-field-line"></div><div class="sig-field-label">Contractor Signature</div></div>
      <div class="sig-field narrow"><div class="sig-field-line"></div><div class="sig-field-label">Date</div></div>
    </div>
  </div>
</section>

<!-- Exhibit G Part C continued -->
<section class="exhibit-page">
  <div class="page-band">
    <div class="page-band-brand">JG Restoration <span class="orange-dot">●</span> Fire <span class="orange-dot">●</span> Water <span class="orange-dot">●</span> Mold</div>
    <div class="page-band-ref">Exhibit F &mdash; Part C</div>
  </div>

  <div class="exhibit-subhead">C. Notice of Cancellation After Insurance Denial</div>

  <div class="cancel-form">
    <div class="cancel-form-banner">Notice of Cancellation</div>
    <p>If you are notified by your insurer that the claim under the property insurance policy has been denied in whole or in part, you may cancel the contract by personal delivery or by mailing by 1st class mail a signed and dated copy of this cancellation notice or other written notice to:</p>

    <div style="background:white;padding:14pt 16pt;margin:14pt 0;border-left:3pt solid var(--orange);font-family:'Helvetica Neue',sans-serif;font-size:9.5pt;line-height:1.55;">
      <strong style="color:var(--navy);">J.J. Greil Enterprises, LLC</strong> <em>d/b/a</em> JG Restoration<br>
      1720 N. Silverspring Dr., Appleton, WI 54913<br>
      Phone: (920) 313-3811 &nbsp;·&nbsp; sales@jg-restoration.com
    </div>

    <p style="font-size:10pt;">at any time before midnight on the third business day after you have received the notice from your insurer. If you cancel the contract, any payments made by you under the contract, except for certain emergency work already performed by the contractor, will be returned to you within 10 days following receipt by the contractor of your cancellation notice.</p>

    <p style="font-family:'Helvetica Neue',sans-serif;font-weight:700;font-size:11pt;color:var(--navy);margin-top:18pt;letter-spacing:0.04em;">I CANCEL THIS CONTRACT.</p>

    <div class="sig-row" style="margin-top:14pt;">
      <div class="sig-field narrow"><div class="sig-field-line"></div><div class="sig-field-label">Date</div></div>
      <div class="sig-field" style="flex:2;"><div class="sig-field-line"></div><div class="sig-field-label">Customer Signature</div></div>
    </div>
  </div>
</section>

<!-- ==================================================================
     EXHIBIT G — PERSONAL GUARANTY
     ================================================================== -->
<section class="exhibit-page">
  <div class="exhibit-hero">
    <div class="exhibit-letter">Exhibit G</div>
    <h2 class="exhibit-title">Optional Personal Guaranty</h2>
    <p class="exhibit-blurb">Use only if a separate guarantor voluntarily agrees to guarantee payment obligations.</p>
  </div>

  <p>The undersigned individual (the &ldquo;<strong>Guarantor</strong>&rdquo;) personally and unconditionally guarantees to Contractor the full and prompt payment of all amounts that Owner is legally obligated to pay Contractor under the Residential Home Improvement Contract dated <span class="fill-line medium" id="guaranty_contract_date"></span> for the Project Site at <span class="fill-line long" id="guaranty_project_site"></span> (the &ldquo;<strong>Guaranteed Obligations</strong>&rdquo;), together with lawful interest and court-awarded costs, but only to the extent such amounts are validly owed under the Contract and Wisconsin law.</p>

  <p style="margin-top:10pt;">Guarantor&rsquo;s liability shall not exceed the unpaid Contract Price and approved written Change Orders, as adjusted under the Contract and Wisconsin law. Guarantor has all defenses, claims, and rights that Owner has or may have against Contractor arising from the Contract. Nothing in this Guaranty waives or limits any nonwaivable consumer protection rights or remedies available to Owner or Guarantor under Wisconsin law, including Wisconsin Administrative Code chapter ATCP 110 and Wisconsin Statutes section 100.20.</p>

  <p style="margin-top:10pt;">This Guaranty does not obligate Guarantor to pay any amount not enforceable against Owner and does not release Contractor from any duty to perform the Work properly, comply with permits, codes, ATCP 110, warranties, or statutory obligations. Any payment by Guarantor reduces Owner&rsquo;s corresponding obligation.</p>

  <p style="margin-top:10pt;">If Guarantor is married and this obligation is incurred in the interest of the marriage or family, Guarantor acknowledges that this Guaranty may constitute a marital or family purpose obligation under Wisconsin marital property laws. Any required marital property or marital purpose notices shall be given separately as required by law.</p>

  <p style="margin-top:10pt;">This Guaranty is governed by Wisconsin law. Any dispute shall be resolved in the same forum as disputes under the Contract, subject to all nonwaivable rights and remedies under Wisconsin law.</p>

  <div class="sig-block" style="margin-top:30pt;">
    <div class="sig-row">
      <div class="sig-field" style="flex:2;"><div class="sig-field-line"></div><div class="sig-field-label">Guarantor Signature</div></div>
      <div class="sig-field narrow"><div class="sig-field-line"></div><div class="sig-field-label">Date</div></div>
    </div>
    <div class="sig-row">
      <div class="sig-field" style="flex:3;"><div class="sig-field-line"></div><div class="sig-field-label">Printed Name</div></div>
    </div>
    <div class="sig-row">
      <div class="sig-field" style="flex:3;"><div class="sig-field-line"></div><div class="sig-field-label">Address</div></div>
    </div>
  </div>
</section>

<!-- ==================================================================
     RIGHT TO CURE BROCHURE
     ================================================================== -->
<section class="brochure">
  <div class="exhibit-hero">
    <div class="exhibit-letter">Required Disclosure</div>
    <h2 class="exhibit-title">Wisconsin &ldquo;Right to Cure Law&rdquo;</h2>
    <p class="exhibit-blurb">Steps and timetables for resolving claims of dwelling construction defects against contractors or suppliers.</p>
  </div>

  <p class="brochure-headline" style="margin-top:14pt;">Before you file a lawsuit.</p>
  <p class="brochure-sub">2005 Wisconsin Act 201</p>

  <p>The &ldquo;Right to Cure Law&rdquo; provides the steps and timetables to be followed in resolving any claims of dwelling construction defects by consumers against contractors or suppliers. Claims must be pursued through the &ldquo;Right to Cure Law&rdquo; process before arbitration or before legal action.</p>

  <p style="margin-top:10pt;">The 2005 Wisconsin Act 201, the &ldquo;Right to Cure Law,&rdquo; says that consumers at the time of contracting for construction or remodeling work for dwellings must be provided with this brochure describing requirements for making any future claims of construction defects.</p>

  <p style="margin-top:10pt;">People who feel they have a claim concerning defective workmanship or materials need to provide written notice to contractors or suppliers before any legal action may be filed. The contractors and suppliers have the opportunity and the responsibility to respond to claims.</p>

  <p style="margin-top:10pt;">Construction defects can involve workmanship, materials, or code requirements in new construction or remodeling, but not maintenance or repairs. Claims may be made by owners, tenants, or property associations.</p>

  <div class="brochure-grid">
    <div>
      <div class="exhibit-subhead">Notice Concerning Construction Defects</div>
      <p style="font-size:9.5pt;">Wisconsin law contains important requirements you must follow before you may file a lawsuit for defective construction against the contractor who constructed your dwelling or completed your remodeling project or against a window or door supplier or manufacturer. Section 895.07 (2) and (3) of the Wisconsin statutes requires you to deliver to the contractor a written notice of any construction conditions you allege are defective before you file your lawsuit, and you must provide your contractor or window or door supplier the opportunity to make an offer to repair or remedy the alleged construction defects. You are not obligated to accept any offer made by the contractor or window or door supplier. All parties are bound by applicable warranty provisions.</p>

      <div class="exhibit-subhead">Highlights</div>
      <ul style="font-size:9pt;line-height:1.55;padding-left:14pt;">
        <li>Claimants may accept settlement offers, accept them in part, or reject offers, doing so via detailed written notice.</li>
        <li>The law does not apply where there is no contract to construct, as in the case of purchasing an existing home.</li>
        <li>Contractors and suppliers have the right to inspect and, as appropriate, test alleged defects.</li>
        <li>Access must be provided in a timely fashion for inspections, tests, and repairs.</li>
        <li>Additional claims made or discovered after an original claim are treated as separate in terms of time and process.</li>
        <li>Failure by the claimant, contractor, or supplier to follow the &ldquo;Right to Cure Law&rdquo; can result in delay or dismissal of legal or arbitration actions.</li>
      </ul>
    </div>

    <div>
      <div class="exhibit-subhead" style="color:var(--orange);">Step-by-Step Process</div>

      <div class="brochure-step">
        <div class="brochure-step-num">Step 1 &mdash; Notice of Claim</div>
        At least 90 working days before commencing an action, a claimant must deliver a written notice of the alleged defect to the contractor.
      </div>

      <div class="brochure-step">
        <div class="brochure-step-num">Step 2 &mdash; Contractor&rsquo;s Response</div>
        Contractor has 15 working days (25 for window/door supplier issues) to provide a written: (1) offer to repair; (2) offer to settle with payment; (3) combination of 1 &amp; 2; (4) rejection with reasons; or (5) proposal to inspect/test.
      </div>

      <div class="brochure-step">
        <div class="brochure-step-num">Step 3 &mdash; Claimant&rsquo;s Response</div>
        If rejected, claimant may commence action. Claimant must serve written notice within 15 working days to accept or reject an offer.
      </div>

      <div class="brochure-step">
        <div class="brochure-step-num">Step 4 &mdash; Contractor&rsquo;s Supplemental Response</div>
        If offer is rejected, contractor has 5 working days to provide a supplemental offer or notice that no additional offer will be made.
      </div>

      <div class="brochure-step">
        <div class="brochure-step-num">Step 5 &mdash; Final Response</div>
        If no additional offer, claimant may commence a lawsuit. If supplemental offer is received, claimant must respond within 15 working days.
      </div>
    </div>
  </div>

  <p style="margin-top:18pt;font-size:8.5pt;font-style:italic;color:var(--slate-light);">This document highlights some of the provisions of the &ldquo;Right to Cure Law,&rdquo; and is not a complete description of the law, and is not a substitute for legal representation. The Department of Safety and Professional Services prepared this brochure but does not investigate, arbitrate, or judge consumer-contractor/supplier disputes.</p>
</section>

</body>
</html>
`;
