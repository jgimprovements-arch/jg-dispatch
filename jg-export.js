/**
 * JG Restoration — Branded Export Utility
 * =========================================
 * Shared module for generating branded PDF and CSV exports across the platform.
 *
 * USAGE: Add to any page:
 *   <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
 *   <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js"></script>
 *   <script src="jg-export.js"></script>
 *
 * Then call:
 *   JGExport.pdf({
 *     title: 'Phase Schedule — Lam-2214-FRE',
 *     subtitle: 'Rebuild progress as of Apr 27, 2026',
 *     sections: [
 *       { heading: 'Project Info', kv: [['Customer','Janet Lam'], ['Address','...']] },
 *       { heading: 'Phases', table: { headers: [...], rows: [...] } },
 *       { heading: 'Notes', text: '...' }
 *     ],
 *     filename: 'phase-schedule-lam-2214.pdf'
 *   });
 *
 *   JGExport.csv({
 *     filename: 'phases-lam-2214.csv',
 *     headers: ['Sequence','Phase','Sub','Status','Scheduled Start','Actual Start'],
 *     rows: [...arrays of cells]
 *   });
 *
 * The PDF helper handles the JG-Restoration logo (canvas-composited per existing
 * platform pattern: fill background before drawing the transparent PNG, export as
 * JPEG to avoid the alpha-channel rendering issues in jsPDF).
 */
(function (global) {
  'use strict';

  // ── Brand tokens ────────────────────────────────────────────────────────
  var BRAND = {
    navy:   '#0d2d5e',
    orange: '#e85d04',
    gold:   '#f5a623',
    text:   '#1c2333',
    muted:  '#6b7385',
    line:   '#e2e6ee',
    company: 'JG Restoration',
    tagline: 'FIRE  ·  WATER  ·  MOLD',
    phone:  '(920) 428-4200',
    site:   'jg-restoration.com',
    logoUrl: 'https://jgimprovements-arch.github.io/jg-dispatch/logo.png'
  };

  // ── Cache logo as data URL (single fetch per session) ───────────────────
  var _logoDataUrl = null;
  function loadLogoAsDataUrl() {
    return new Promise(function (resolve) {
      if (_logoDataUrl) return resolve(_logoDataUrl);
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        // Canvas composite — fill white BG first to handle transparent PNG/JPEG-as-png
        // (per JG memory: logo is JPEG saved as .png; without bg-fill jsPDF mishandles)
        var canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 1500;
        canvas.height = img.naturalHeight || 1093;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        _logoDataUrl = canvas.toDataURL('image/jpeg', 0.92);
        resolve(_logoDataUrl);
      };
      img.onerror = function () {
        console.warn('JGExport: logo failed to load, exports will be text-only');
        resolve(null);
      };
      img.src = BRAND.logoUrl;
    });
  }

  // ── PDF helpers ─────────────────────────────────────────────────────────
  function hexToRgb(hex) {
    var h = hex.replace('#', '');
    return [
      parseInt(h.substring(0, 2), 16),
      parseInt(h.substring(2, 4), 16),
      parseInt(h.substring(4, 6), 16)
    ];
  }

  function drawHeader(doc, opts, logoDataUrl) {
    // Top color band
    var navy = hexToRgb(BRAND.navy);
    doc.setFillColor(navy[0], navy[1], navy[2]);
    doc.rect(0, 0, 215.9, 28, 'F');  // Letter width 215.9mm, header band 28mm

    // Orange accent line just below the band
    var orange = hexToRgb(BRAND.orange);
    doc.setFillColor(orange[0], orange[1], orange[2]);
    doc.rect(0, 28, 215.9, 1.2, 'F');

    // Logo on the left of the navy band
    if (logoDataUrl) {
      try {
        // 1500x1093 source → preserve ratio at ~22mm height
        doc.addImage(logoDataUrl, 'JPEG', 10, 4, 30, 21.9);
      } catch (e) { console.warn('JGExport: logo embed failed', e); }
    }

    // Title block (right-aligned text in white on navy)
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(15);
    doc.setFont('helvetica', 'bold');
    doc.text(opts.title || 'JG Restoration Document', 205.9, 12, { align: 'right' });

    if (opts.subtitle) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(245, 166, 35);  // gold
      doc.text(opts.subtitle, 205.9, 18, { align: 'right' });
    }

    // Tagline beneath subtitle
    doc.setFontSize(7);
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'normal');
    doc.text(BRAND.tagline, 205.9, 23.5, { align: 'right' });
  }

  function drawFooter(doc, pageNum, pageCount) {
    var pageH = doc.internal.pageSize.getHeight();
    var pageW = doc.internal.pageSize.getWidth();
    var muted = hexToRgb(BRAND.muted);

    // Thin orange accent
    var orange = hexToRgb(BRAND.orange);
    doc.setDrawColor(orange[0], orange[1], orange[2]);
    doc.setLineWidth(0.4);
    doc.line(10, pageH - 14, pageW - 10, pageH - 14);

    doc.setFontSize(8);
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.setFont('helvetica', 'normal');

    // Left: company + phone
    doc.text(BRAND.company + '  ·  ' + BRAND.phone, 10, pageH - 8);

    // Center: site
    doc.text(BRAND.site, pageW / 2, pageH - 8, { align: 'center' });

    // Right: page numbering
    doc.text('Page ' + pageNum + ' of ' + pageCount, pageW - 10, pageH - 8, { align: 'right' });
  }

  function drawSectionHeading(doc, text, y) {
    var navy = hexToRgb(BRAND.navy);
    var orange = hexToRgb(BRAND.orange);
    doc.setDrawColor(orange[0], orange[1], orange[2]);
    doc.setLineWidth(0.7);
    doc.line(10, y - 1, 14, y - 1);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(navy[0], navy[1], navy[2]);
    doc.text(text, 16, y + 2);
    return y + 7;
  }

  function drawKVList(doc, kv, y) {
    var navy = hexToRgb(BRAND.navy);
    var text = hexToRgb(BRAND.text);
    doc.setFontSize(9);
    kv.forEach(function (pair) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(navy[0], navy[1], navy[2]);
      doc.text(String(pair[0] || '') + ':', 14, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(text[0], text[1], text[2]);
      doc.text(String(pair[1] == null ? '—' : pair[1]), 50, y);
      y += 5;
    });
    return y + 3;
  }

  function drawTable(doc, table, y) {
    if (!doc.autoTable) {
      console.warn('JGExport: jspdf-autotable plugin not loaded; tables will be skipped');
      return y;
    }
    doc.autoTable({
      startY: y,
      head: [table.headers],
      body: table.rows,
      theme: 'striped',
      headStyles: {
        fillColor: hexToRgb(BRAND.navy),
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 9
      },
      bodyStyles: { fontSize: 9, textColor: hexToRgb(BRAND.text) },
      alternateRowStyles: { fillColor: [248, 249, 252] },
      margin: { left: 10, right: 10 },
      didDrawPage: function () { /* footer drawn after */ }
    });
    return doc.lastAutoTable.finalY + 6;
  }

  function drawTextBlock(doc, text, y) {
    var textColor = hexToRgb(BRAND.text);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(textColor[0], textColor[1], textColor[2]);
    var pageW = doc.internal.pageSize.getWidth();
    var lines = doc.splitTextToSize(String(text || ''), pageW - 20);
    lines.forEach(function (line) {
      if (y > doc.internal.pageSize.getHeight() - 20) {
        doc.addPage();
        y = 35;
      }
      doc.text(line, 10, y);
      y += 4.6;
    });
    return y + 3;
  }

  // ── Main PDF generator ──────────────────────────────────────────────────
  function pdf(opts) {
    if (!global.jspdf || !global.jspdf.jsPDF) {
      alert('PDF library not loaded. Add jsPDF + autotable scripts to the page.');
      return Promise.reject(new Error('jsPDF missing'));
    }
    return loadLogoAsDataUrl().then(function (logoDataUrl) {
      var jsPDF = global.jspdf.jsPDF;
      var doc = new jsPDF({ unit: 'mm', format: 'letter' });

      drawHeader(doc, opts, logoDataUrl);
      var y = 38;

      (opts.sections || []).forEach(function (section) {
        if (y > doc.internal.pageSize.getHeight() - 30) {
          doc.addPage();
          drawHeader(doc, opts, logoDataUrl);
          y = 38;
        }
        if (section.heading) y = drawSectionHeading(doc, section.heading, y);
        if (section.kv)     y = drawKVList(doc, section.kv, y);
        if (section.table)  y = drawTable(doc, section.table, y);
        if (section.text)   y = drawTextBlock(doc, section.text, y);
      });

      // Footer on every page
      var pageCount = doc.internal.getNumberOfPages();
      for (var i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        drawFooter(doc, i, pageCount);
      }

      doc.save(opts.filename || ('jg-export-' + Date.now() + '.pdf'));
      return doc;
    });
  }

  // ── CSV export with branded preamble ────────────────────────────────────
  function csv(opts) {
    var headers = opts.headers || [];
    var rows = opts.rows || [];
    var filename = opts.filename || ('jg-export-' + Date.now() + '.csv');

    function esc(v) {
      if (v == null) return '';
      var s = String(v);
      if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }

    // Branded preamble (commented lines that Excel/Sheets will treat as data
    // but identify provenance — outsmart move: any sub or adjuster who gets the
    // CSV can never claim it's not from JG)
    var preamble = [
      '# JG Restoration · Fire · Water · Mold',
      '# ' + (opts.title || 'Data Export'),
      '# Generated ' + new Date().toLocaleString('en-US'),
      '# Source: jg-restoration.com  ·  (920) 428-4200',
      ''
    ].join('\n');

    var body = headers.map(esc).join(',') + '\n' +
               rows.map(function (r) { return r.map(esc).join(','); }).join('\n');

    var blob = new Blob([preamble + body], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  // ── HTML print-view helper (for browser print → PDF without jsPDF) ──────
  function htmlPrintView(opts) {
    return loadLogoAsDataUrl().then(function (logoDataUrl) {
      var w = window.open('', '_blank', 'width=900,height=1100');
      if (!w) { alert('Pop-up blocked. Allow pop-ups for jg-restoration platform.'); return; }
      var sectionsHtml = (opts.sections || []).map(function (s) {
        var bits = [];
        if (s.heading) bits.push('<h2>' + s.heading + '</h2>');
        if (s.kv) bits.push('<dl>' + s.kv.map(function(p){
          return '<dt>'+(p[0]||'')+'</dt><dd>'+(p[1]==null?'—':p[1])+'</dd>';
        }).join('') + '</dl>');
        if (s.table) {
          bits.push('<table><thead><tr>' + s.table.headers.map(function(h){return '<th>'+h+'</th>';}).join('') +
                    '</tr></thead><tbody>' + s.table.rows.map(function(r){
            return '<tr>' + r.map(function(c){return '<td>'+(c==null?'':c)+'</td>';}).join('') + '</tr>';
          }).join('') + '</tbody></table>');
        }
        if (s.text) bits.push('<p>' + String(s.text).replace(/\n/g, '<br>') + '</p>');
        return '<section>' + bits.join('') + '</section>';
      }).join('');

      w.document.write(
        '<!doctype html><html><head><meta charset="utf-8"><title>' +
        (opts.title || 'JG Restoration') + '</title>' +
        '<style>' +
        'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2333;margin:0;}' +
        '.head{background:#0d2d5e;color:#fff;padding:18px 28px;display:flex;align-items:center;gap:18px;border-bottom:3px solid #e85d04;}' +
        '.head img{height:54px;}' +
        '.head .ttl{flex:1;text-align:right;}' +
        '.head h1{margin:0;font-size:18px;}' +
        '.head .sub{font-size:11px;color:#f5a623;margin-top:3px;}' +
        '.head .tag{font-size:9px;letter-spacing:1px;margin-top:5px;color:#fff;opacity:.7;}' +
        '.body{padding:24px 28px;}' +
        'h2{color:#0d2d5e;font-size:13px;border-left:3px solid #e85d04;padding-left:8px;margin:18px 0 8px;text-transform:uppercase;letter-spacing:.4px;}' +
        'dl{display:grid;grid-template-columns:130px 1fr;gap:4px 12px;font-size:12px;margin:0 0 8px;}' +
        'dt{font-weight:700;color:#0d2d5e;}' +
        'dd{margin:0;}' +
        'table{border-collapse:collapse;width:100%;font-size:11px;margin:0 0 8px;}' +
        'thead th{background:#0d2d5e;color:#fff;padding:6px 8px;text-align:left;}' +
        'tbody td{border-bottom:1px solid #e2e6ee;padding:5px 8px;}' +
        'tbody tr:nth-child(even){background:#f8f9fc;}' +
        'p{font-size:12px;line-height:1.5;}' +
        '.foot{border-top:1px solid #e85d04;padding:10px 28px;font-size:10px;color:#6b7385;display:flex;justify-content:space-between;}' +
        '@media print{.head{-webkit-print-color-adjust:exact;print-color-adjust:exact;} thead th{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}' +
        '</style></head><body>' +
        '<div class="head">' +
          (logoDataUrl ? '<img src="'+logoDataUrl+'" alt="JG">' : '') +
          '<div class="ttl"><h1>' + (opts.title||'JG Restoration') + '</h1>' +
          (opts.subtitle?'<div class="sub">'+opts.subtitle+'</div>':'') +
          '<div class="tag">FIRE · WATER · MOLD</div></div>' +
        '</div>' +
        '<div class="body">' + sectionsHtml + '</div>' +
        '<div class="foot"><span>JG Restoration · (920) 428-4200</span><span>jg-restoration.com</span></div>' +
        '<script>setTimeout(function(){window.print();},400);</script>' +
        '</body></html>'
      );
      w.document.close();
    });
  }

  // ── Public API ──────────────────────────────────────────────────────────
  global.JGExport = {
    pdf: pdf,
    csv: csv,
    print: htmlPrintView,
    BRAND: BRAND,
    _loadLogo: loadLogoAsDataUrl  // exposed for testing
  };
})(window);
