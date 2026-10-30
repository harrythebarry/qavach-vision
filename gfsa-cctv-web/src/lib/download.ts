// Real files for every download in the demo: CSV, PDF and watermarked images.
// REP-03 / ALM-08: every document and clip that leaves the console carries a
// watermark naming who downloaded it and when, and the download is logged
// (see lib/exporting.ts, which wraps these with the audit log and a toast).

/** Starts a browser download of in-memory content. */
export function downloadBlob(filename: string, content: BlobPart, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** RFC 4180 CSV with a BOM so Excel opens accents correctly. */
export function toCsv(rows: (string | number | boolean | undefined | null)[][]): string {
  const cell = (v: string | number | boolean | undefined | null) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function downloadCsv(filename: string, rows: (string | number | boolean | undefined | null)[][]) {
  downloadBlob(filename, toCsv(rows), 'text/csv;charset=utf-8');
}

/** "life jacket near the water" → "life-jacket-near-the-water" */
export const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// ---------- PDF ----------

export type PdfBlock =
  | { kind: 'h1'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'meta'; text: string }
  | { kind: 'kv'; rows: [string, string][] }
  | { kind: 'table'; columns: { label: string; width: number; align?: 'left' | 'right' }[]; rows: string[][] }
  | { kind: 'bars'; rows: { label: string; value: number; note?: string }[]; unit?: string }
  | { kind: 'space'; size?: number };

export interface PdfWatermark {
  id: string; // WM-26-1188
  user: string;
  at: string; // already formatted
  /** Extra line, such as "Faces blurred · shared outside GFSA". */
  note?: string;
}

export interface PdfDoc {
  title: string;
  subtitle?: string;
  blocks: PdfBlock[];
  watermark: PdfWatermark;
  /** Page footer label, default "GFSA · CCTV Monitoring". */
  footer?: string;
}

// WinAnsi (Windows-1252) so Spanish accents print with the standard Helvetica font.
const WINANSI: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89,
  'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95,
  '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};
const REPLACE: Record<string, string> = { '−': '-', '→': '->', '←': '<-', '≥': '>=', '≤': '<=', '✓': 'v', '×': 'x' };

function encodeText(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const r = REPLACE[ch];
    if (r) {
      for (const c of r) out.push(c.charCodeAt(0));
      continue;
    }
    const code = ch.charCodeAt(0);
    if (WINANSI[ch] !== undefined) out.push(WINANSI[ch]);
    else if (code < 256) out.push(code);
    else out.push(0x3f); // ?
  }
  return out;
}

/** PDF string literal bytes with escapes. */
function pdfString(s: string): number[] {
  const bytes = encodeText(s);
  const out: number[] = [0x28];
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) out.push(0x5c);
    out.push(b);
  }
  out.push(0x29);
  return out;
}

// Approximate Helvetica widths (per 1000 em) for wrapping and right-aligning.
const narrow = "iIjl.,:;'|!";
const wide = 'MWmw@';
function textWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) w += narrow.includes(ch) ? 260 : wide.includes(ch) ? 850 : ch === ' ' ? 280 : /[A-Z]/.test(ch) ? 660 : 540;
  return (w / 1000) * size;
}

function wrap(text: string, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (textWidth(next, size) > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 56;
const CONTENT_W = PAGE_W - MARGIN * 2;

type Op = { font: 'F1' | 'F2'; size: number; x: number; y: number; text: string; gray?: number } | { rect: [number, number, number, number]; gray: number };

/** Builds a real, multi-page A4 PDF with a watermark on every page. */
export function buildPdf(doc: PdfDoc): Uint8Array {
  const pages: Op[][] = [[]];
  let y = PAGE_H - MARGIN;
  const page = () => pages[pages.length - 1];
  const ensure = (h: number) => {
    if (y - h < MARGIN + 30) {
      pages.push([]);
      y = PAGE_H - MARGIN;
    }
  };
  const text = (t: string, size: number, bold = false, x = MARGIN, gray?: number) => {
    page().push({ font: bold ? 'F2' : 'F1', size, x, y, text: t, gray });
  };

  // Title block
  for (const l of wrap(doc.title, 18, CONTENT_W)) {
    ensure(24);
    text(l, 18, true);
    y -= 24;
  }
  if (doc.subtitle) {
    for (const l of wrap(doc.subtitle, 10, CONTENT_W)) {
      ensure(14);
      text(l, 10, false, MARGIN, 0.35);
      y -= 14;
    }
  }
  y -= 10;

  for (const b of doc.blocks) {
    switch (b.kind) {
      case 'h1':
      case 'h2': {
        const size = b.kind === 'h1' ? 14 : 12;
        y -= 6;
        ensure(size + 8);
        text(b.text, size, true);
        y -= size + 6;
        break;
      }
      case 'p':
      case 'meta': {
        const size = b.kind === 'p' ? 10 : 9;
        for (const l of wrap(b.text, size, CONTENT_W)) {
          ensure(size + 4);
          text(l, size, false, MARGIN, b.kind === 'meta' ? 0.35 : undefined);
          y -= size + 4;
        }
        y -= 4;
        break;
      }
      case 'kv': {
        for (const [k, v] of b.rows) {
          const lines = wrap(v, 10, CONTENT_W - 170);
          ensure(14 * lines.length);
          text(k, 10, false, MARGIN, 0.35);
          lines.forEach((l, i) => page().push({ font: 'F1', size: 10, x: MARGIN + 170, y: y - i * 14, text: l }));
          y -= 14 * lines.length;
        }
        y -= 6;
        break;
      }
      case 'table': {
        const total = b.columns.reduce((s, c) => s + c.width, 0);
        const xs: number[] = [];
        let acc = MARGIN;
        b.columns.forEach((c) => {
          xs.push(acc);
          acc += (c.width / total) * CONTENT_W;
        });
        const colW = (i: number) => (b.columns[i].width / total) * CONTENT_W - 6;
        const drawRow = (cells: string[], bold: boolean) => {
          const wrapped = cells.map((c, i) => wrap(c ?? '', 9, colW(i)));
          const h = Math.max(...wrapped.map((w) => w.length)) * 12 + 4;
          ensure(h);
          if (bold) page().push({ rect: [MARGIN - 4, y - h + 9, CONTENT_W + 8, h], gray: 0.93 });
          wrapped.forEach((lines, i) =>
            lines.forEach((l, j) => {
              const right = b.columns[i].align === 'right';
              const x = right ? xs[i] + colW(i) - textWidth(l, 9) : xs[i];
              page().push({ font: bold ? 'F2' : 'F1', size: 9, x, y: y - j * 12, text: l });
            }),
          );
          y -= h;
        };
        drawRow(b.columns.map((c) => c.label), true);
        b.rows.forEach((r) => drawRow(r, false));
        y -= 8;
        break;
      }
      case 'bars': {
        const max = Math.max(1, ...b.rows.map((r) => r.value));
        for (const r of b.rows) {
          ensure(16);
          text(r.label, 9, false);
          const w = (r.value / max) * (CONTENT_W - 230);
          page().push({ rect: [MARGIN + 180, y - 2, Math.max(1, w), 9], gray: 0.45 });
          text(`${r.value}${b.unit ?? ''}${r.note ? `  ${r.note}` : ''}`, 9, true, MARGIN + 186 + w);
          y -= 16;
        }
        y -= 6;
        break;
      }
      case 'space':
        y -= b.size ?? 10;
        break;
    }
  }

  const wm = doc.watermark;
  const footer = doc.footer ?? 'GFSA · CCTV Monitoring';
  const bytes: number[] = [];
  const push = (s: string) => {
    for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i));
  };
  const pushBytes = (b: number[]) => {
    for (const x of b) bytes.push(x);
  };

  // Object numbering: 1 catalog, 2 pages, 3 F1, 4 F2, 5 GS, then per page: page, contents
  const n = pages.length;
  const offsets: number[] = [];
  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  const obj = (num: number, body: () => void) => {
    offsets[num] = bytes.length;
    push(`${num} 0 obj\n`);
    body();
    push('\nendobj\n');
  };
  const kids = pages.map((_, i) => `${6 + i * 2} 0 R`).join(' ');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`));
  obj(3, () => push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));
  obj(4, () => push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'));
  obj(5, () => push('<< /Type /ExtGState /ca 0.10 /CA 0.10 >>'));

  pages.forEach((ops, i) => {
    const content: number[] = [];
    const c = (s: string) => {
      for (let k = 0; k < s.length; k++) content.push(s.charCodeAt(k));
    };
    // Diagonal watermark, behind the content
    c('q /GS1 gs 0.1 0.2 0.35 rg BT /F2 34 Tf\n');
    for (let row = 0; row < 4; row++) {
      const ty = 150 + row * 190;
      c(`0.819 0.574 -0.574 0.819 ${60 + (row % 2) * 40} ${ty} Tm `);
      for (const b of pdfString(`GFSA · ${wm.user} · ${wm.id}`)) content.push(b);
      c(' Tj\n');
    }
    c('ET Q\n');
    for (const op of ops) {
      if ('rect' in op) {
        const [x, ry, w, h] = op.rect;
        c(`q ${op.gray} g ${x.toFixed(1)} ${ry.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f Q\n`);
      } else {
        c(`BT ${op.gray !== undefined ? `${op.gray} g ` : '0 g '}/${op.font} ${op.size} Tf ${op.x.toFixed(1)} ${op.y.toFixed(1)} Td `);
        for (const b of pdfString(op.text)) content.push(b);
        c(' Tj ET\n');
      }
    }
    // Footer: watermark id, who, when, page
    const foot = `${footer} · ${wm.id} · ${wm.user} · ${wm.at}${wm.note ? ` · ${wm.note}` : ''}`;
    c('BT 0.35 g /F1 8 Tf ' + `${MARGIN} 30 Td `);
    for (const b of pdfString(foot)) content.push(b);
    c(` Tj ET\nBT 0.35 g /F1 8 Tf ${PAGE_W - MARGIN - 40} 30 Td `);
    for (const b of pdfString(`${i + 1} / ${n}`)) content.push(b);
    c(' Tj ET\n');

    obj(6 + i * 2, () =>
      push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${7 + i * 2} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /ExtGState << /GS1 5 0 R >> >> >>`,
      ),
    );
    obj(7 + i * 2, () => {
      push(`<< /Length ${content.length} >>\nstream\n`);
      pushBytes(content);
      push('\nendstream');
    });
  });

  const total = 5 + n * 2;
  const xref = bytes.length;
  push(`xref\n0 ${total + 1}\n0000000000 65535 f \n`);
  for (let k = 1; k <= total; k++) push(`${String(offsets[k]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R /Info << /Producer (CCTV Monitoring) >> >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Uint8Array(bytes);
}

export function downloadPdf(filename: string, doc: PdfDoc) {
  downloadBlob(filename, buildPdf(doc) as BlobPart, 'application/pdf');
}

// ---------- Images ----------

/**
 * Downloads a camera snapshot as an SVG with the watermark burned in, plus an
 * optional detection box. The camera images in the demo are SVG files.
 */
export async function downloadWatermarkedImage(
  src: string,
  filename: string,
  watermark: PdfWatermark,
  box?: { x: number; y: number; w: number; h: number; label?: string },
) {
  const res = await fetch(src);
  const raw = await res.text();
  const b64 = btoa(unescape(encodeURIComponent(raw)));
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const W = 1280;
  const H = 720;
  const line = `GFSA · ${watermark.user} · ${watermark.at} · ${watermark.id}${watermark.note ? ` · ${watermark.note}` : ''}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<image href="data:image/svg+xml;base64,${b64}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>
${
  // Privacy: faces blurred in clips shared outside GFSA. Blur the head region of
  // the detected person (top quarter of the box, a little wider than it).
  box && box.h < 80
    ? `<defs><filter id="faceblur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="9"/></filter>
<clipPath id="facearea"><rect x="${((box.x - box.w * 0.15) / 100) * W}" y="${(box.y / 100) * H}" width="${((box.w * 1.3) / 100) * W}" height="${((box.h * 0.28) / 100) * H}" rx="10"/></clipPath></defs>
<g clip-path="url(#facearea)"><image href="data:image/svg+xml;base64,${b64}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" filter="url(#faceblur)"/></g>`
    : ''
}
${
  box
    ? `<rect x="${(box.x / 100) * W}" y="${(box.y / 100) * H}" width="${(box.w / 100) * W}" height="${(box.h / 100) * H}" fill="none" stroke="#FF8A4C" stroke-width="4"/>${
        box.label ? `<rect x="${(box.x / 100) * W}" y="${(box.y / 100) * H - 30}" width="${box.label.length * 11 + 16}" height="26" fill="#FF8A4C"/><text x="${(box.x / 100) * W + 8}" y="${(box.y / 100) * H - 11}" font-family="Helvetica, Arial, sans-serif" font-size="18" font-weight="700" fill="#1A0E08">${esc(box.label)}</text>` : ''
      }`
    : ''
}
<g opacity="0.22" font-family="Helvetica, Arial, sans-serif" font-size="40" font-weight="700" fill="#FFFFFF" transform="rotate(-24 640 360)">
${[0, 1, 2, 3].map((i) => `<text x="${-200 + (i % 2) * 120}" y="${120 + i * 190}">${esc(`GFSA · ${watermark.user} · ${watermark.id}`)}</text>`).join('\n')}
</g>
<rect x="0" y="${H - 34}" width="${W}" height="34" fill="rgba(6,11,16,0.8)"/>
<text x="14" y="${H - 12}" font-family="Helvetica, Arial, sans-serif" font-size="16" fill="#FFFFFF">${esc(line)}</text>
</svg>`;
  downloadBlob(filename, svg, 'image/svg+xml');
}
