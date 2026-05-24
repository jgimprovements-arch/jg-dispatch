// rebuild-utils.js
// Pure helper functions extracted from rebuild.html.
// All functions are attached to global scope (no module wrapper) so they
// remain callable from inline event handlers in template strings.
//
// Depends on globals defined in rebuild.html:
//   - VALID_SUFFIXES (Set)
//
// No state coupling. Safe to load early in the script chain.

// ============================================================================
// Job number / market helpers
// ============================================================================

function suffixOf(jobNumber) {
  if (!jobNumber) return null;
  const m = String(jobNumber).match(/([A-Za-z]{3})$/);
  if (!m) return null;
  const s = m[1].toUpperCase();
  return VALID_SUFFIXES.has(s) ? s : null;
}

function marketFromLocation(loc) {
  const s = String(loc || '').toLowerCase();
  if (s.includes('stevens') || s.includes('point')) return 'stevens_point';
  if (s.includes('appleton')) return 'appleton';
  return 'appleton'; // default
}

// ============================================================================
// Filename helpers
// ============================================================================

function cleanFilename(name) {
  if (!name) return '';
  // Strip leading timestamp prefixes: "1777855535941-", "638936327385843321_", etc.
  return name.replace(/^\d{8,}[_-]+/, '');
}

function friendlyDocTitle(filename) {
  const clean = cleanFilename(filename || '').replace(/\.pdf$/i, '');
  if (/^work_auth/i.test(clean)) return 'Authorization to Perform Services & Direction of Payment';
  if (/^ins_recovery/i.test(clean)) return 'Insurance Recovery Agreement';
  if (/^cos(_|$)/i.test(clean)) return 'Certificate of Satisfaction';
  return clean.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function mimeFromFilename(filename) {
  const ext = (filename || '').toLowerCase().split('.').pop();
  const map = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
    heic: 'image/heic', heif: 'image/heif',
    pdf: 'application/pdf',
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav',
    txt: 'text/plain', csv: 'text/csv',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return map[ext] || 'application/octet-stream';
}

// ============================================================================
// Money / number formatting
// ============================================================================

function usdRound(n) {
  return Math.round(Number(n) || 0).toLocaleString();
}

function round2(n) { return Math.round(n * 100) / 100; }

function parseUsd(text) {
  return Number(String(text).replace(/[^0-9.-]/g, '')) || 0;
}

function usdCompact(n) {
  const v = Number(n) || 0;
  return '$' + v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ============================================================================
// Time / date formatting
// ============================================================================

function fmtRel(when) {
  if (!when) return 'never';
  const ms = Date.now() - new Date(when).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(when).toLocaleDateString();
}

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  if (s < 604800) return Math.floor(s/86400) + 'd ago';
  return new Date(iso).toLocaleDateString();
}

// ============================================================================
// HTML escaping
// ============================================================================

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
