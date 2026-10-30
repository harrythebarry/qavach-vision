import type { PdfWatermark } from '../../lib/download';
import { TZ } from '../../lib/time';

// Real evidence files for ALM-08. The clip is a playable animated SVG (SMIL):
// the camera frame, a running timecode, the detection box and label appearing
// at the detection second, head regions blurred and the watermark burned in.
// It loops in any browser that opens the file.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const hms = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const pos = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** The camera frame as a data URI (camera images in the demo are SVG files). */
export async function frameDataUri(src: string): Promise<string> {
  if (src.startsWith('data:')) return src;
  const res = await fetch(src);
  if (!res.ok) throw new Error(`Camera image ${res.status}`);
  const type = res.headers.get('content-type') ?? 'image/svg+xml';
  if (type.includes('svg')) {
    const raw = await res.text();
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(raw)))}`;
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return `data:${type};base64,${btoa(bin)}`;
}

export interface ClipSpec {
  /** "ALM-26-0318 · Life jacket missing near the water" */
  title: string;
  cameraId: string;
  /** "Guarán F 503 · Port edge" */
  cameraLabel: string;
  frame: string; // data URI
  /** Epoch ms of second 0 of the clip. */
  startMs: number;
  duration: number;
  /** Second the detection box appears. */
  detectAt: number;
  /** Second the alarm (or event) was raised. */
  markAt: number;
  box?: { x: number; y: number; w: number; h: number };
  label?: string;
  zone?: string;
  blurHeads: boolean;
  watermark: PdfWatermark;
  text: { raised: string; segment: string; facesBlurred: string };
}

/** A looping, self-contained animated SVG of the clip. */
export function buildClipSvg(c: ClipSpec): string {
  const W = 1280;
  const H = 720;
  const D = c.duration;
  const k = (s: number) => +(s / D).toFixed(5);

  /** Visible during [from, to) of every loop. */
  const during = (from: number, to = D) => {
    const vals: string[] = [];
    const keys: number[] = [];
    if (from > 0) {
      vals.push('hidden');
      keys.push(0);
    }
    vals.push('visible');
    keys.push(k(from));
    if (to < D) {
      vals.push('hidden');
      keys.push(k(to));
    }
    return `<animate attributeName="visibility" values="${vals.join(';')}" keyTimes="${keys.join(';')}" calcMode="discrete" dur="${D}s" repeatCount="indefinite"/>`;
  };

  // Detection box in pixels, drifting a little as the person moves.
  const b = c.box && { x: (c.box.x / 100) * W, y: (c.box.y / 100) * H, w: (c.box.w / 100) * W, h: (c.box.h / 100) * H };
  const drift = [0, 6, 2, 9, 4, 0];
  const driftY = [0, -2, 1, 0, -1, 0];
  const driftVals = (base: number, d: number[]) => d.map((v) => (base + v).toFixed(1)).join(';');
  const driftAnim = (attr: string, base: number, d: number[]) =>
    `<animate attributeName="${attr}" values="${driftVals(base, d)}" dur="${D}s" repeatCount="indefinite"/>`;
  const translate = `<animateTransform attributeName="transform" type="translate" values="${drift.map((v, i) => `${v} ${driftY[i]}`).join(';')}" dur="${D}s" repeatCount="indefinite"/>`;

  // Head region (top of the person box) for blurring.
  const head = b && { x: b.x - b.w * 0.15, y: b.y - b.h * 0.04, w: b.w * 1.3, h: b.h * 0.32 };

  const zonePts = c.zone
    ?.split(' ')
    .map((p) => {
      const [x, y] = p.split(',').map(Number);
      return `${((x / 100) * W).toFixed(1)},${((y / 100) * H).toFixed(1)}`;
    })
    .join(' ');

  // Running timecode: one group per second, shown only during its second.
  const ticks = Array.from({ length: Math.ceil(D) }, (_, i) => {
    const ms = c.startMs + i * 1000;
    return `<g visibility="${i === 0 ? 'visible' : 'hidden'}">${during(i, i + 1)}<text x="22" y="40" class="tc">${esc(`${ymd.format(ms)} ${hms.format(ms)} · ${c.cameraId}`)}</text><text x="22" y="${H - 34 - 15}" class="pos">${pos(i)} / ${pos(D)}</text></g>`;
  }).join('\n');

  // Timeline under the frame.
  const x0 = 140;
  const x1 = W - 26;
  const ty = H - 34 - 22;
  const tx = (s: number) => x0 + ((x1 - x0) * s) / D;
  const wm = c.watermark;
  const footer = `GFSA · ${wm.user} · ${wm.at} · ${wm.id}${wm.note ? ` · ${wm.note}` : ''}`;
  const markText = `${c.text.raised} · ${hms.format(c.startMs + c.markAt * 1000)}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<title>${esc(c.title)}</title>
<desc>${esc(`${c.cameraLabel} · ${c.cameraId} · ${D} s from ${ymd.format(c.startMs)} ${hms.format(c.startMs)} Asunción · ${footer}`)}</desc>
<metadata>${esc(JSON.stringify({ watermark: wm.id, user: wm.user, at: wm.at, camera: c.cameraId, start: new Date(c.startMs).toISOString(), seconds: D }))}</metadata>
<defs>
  <image id="frame" href="${c.frame}" xlink:href="${c.frame}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>
  <filter id="blur" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="9"/></filter>
  ${
    head && c.blurHeads
      ? `<clipPath id="head" clipPathUnits="userSpaceOnUse"><rect x="${head.x.toFixed(1)}" y="${head.y.toFixed(1)}" width="${head.w.toFixed(1)}" height="${head.h.toFixed(1)}" rx="${(head.w / 2).toFixed(1)}">${driftAnim('x', head.x, drift)}${driftAnim('y', head.y, driftY)}</rect></clipPath>`
      : ''
  }
  <style>
    text { font-family: Helvetica, Arial, sans-serif; }
    .tc { font-size: 20px; fill: #fff; font-variant-numeric: tabular-nums; }
    .pos { font-size: 16px; fill: #fff; font-variant-numeric: tabular-nums; }
    .tag { font-size: 16px; fill: #fff; }
    .lbl { font-size: 18px; font-weight: 700; fill: #1A0E08; }
    .wm { font-size: 40px; font-weight: 700; fill: #fff; }
    .foot { font-size: 16px; fill: #fff; }
  </style>
</defs>
<rect width="${W}" height="${H}" fill="#000"/>
<use href="#frame" xlink:href="#frame"/>
${head && c.blurHeads ? `<g clip-path="url(#head)"><use href="#frame" xlink:href="#frame" filter="url(#blur)"/></g>` : ''}
${zonePts ? `<polygon points="${zonePts}" fill="#FF8A4C" fill-opacity="0.16" stroke="#FF8A4C" stroke-width="3" stroke-dasharray="12 8"/>` : ''}
${
  b
    ? `<g visibility="hidden">${during(c.detectAt)}<g>${translate}
  <rect x="${b.x.toFixed(1)}" y="${b.y.toFixed(1)}" width="${b.w.toFixed(1)}" height="${b.h.toFixed(1)}" fill="none" stroke="#FF8A4C" stroke-width="4" rx="3"/>
  ${
    c.label
      ? `<rect x="${b.x.toFixed(1)}" y="${(b.y - 32).toFixed(1)}" width="${c.label.length * 10.5 + 20}" height="26" rx="4" fill="#FF8A4C"/><text x="${(b.x + 10).toFixed(1)}" y="${(b.y - 13).toFixed(1)}" class="lbl">${esc(c.label)}</text>`
      : ''
  }
</g></g>`
    : ''
}
<g visibility="hidden">${during(c.markAt)}
  <rect x="${W / 2 - 170}" y="16" width="340" height="34" rx="6" fill="#C2410C"/>
  <text x="${W / 2}" y="40" text-anchor="middle" class="tag" style="font-weight:700">${esc(markText)}</text>
</g>
<rect x="12" y="14" width="${(c.cameraId.length + 22) * 11}" height="36" rx="5" fill="rgba(6,11,16,0.8)"/>
<rect x="${W - 210}" y="14" width="196" height="36" rx="5" fill="rgba(6,11,16,0.8)"/>
<text x="${W - 112}" y="38" text-anchor="middle" class="tag">${esc(c.text.facesBlurred)}</text>
<rect x="0" y="${H - 34 - 44}" width="${W}" height="44" fill="rgba(6,11,16,0.72)"/>
<rect x="${x0}" y="${ty}" width="${x1 - x0}" height="6" rx="3" fill="#fff" fill-opacity="0.3"/>
<rect x="${tx(c.detectAt).toFixed(1)}" y="${ty}" width="${(x1 - tx(c.detectAt)).toFixed(1)}" height="6" rx="3" fill="#FF8A4C"><title>${esc(c.text.segment)}</title></rect>
<rect x="${x0}" y="${ty}" width="0" height="6" rx="3" fill="#fff"><animate attributeName="width" from="0" to="${x1 - x0}" dur="${D}s" repeatCount="indefinite"/></rect>
<rect x="${(tx(c.markAt) - 1.5).toFixed(1)}" y="${ty - 7}" width="3" height="20" fill="#fff"/>
<circle cx="${x0}" cy="${ty + 3}" r="8" fill="#fff"><animate attributeName="cx" from="${x0}" to="${x1}" dur="${D}s" repeatCount="indefinite"/></circle>
${ticks}
<g opacity="0.22" transform="rotate(-24 640 360)">
${[0, 1, 2, 3].map((i) => `<text x="${-200 + (i % 2) * 120}" y="${120 + i * 190}" class="wm">${esc(`GFSA · ${wm.user} · ${wm.id}`)}</text>`).join('\n')}
</g>
<rect x="0" y="${H - 34}" width="${W}" height="34" fill="rgba(6,11,16,0.85)"/>
<text x="14" y="${H - 12}" class="foot">${esc(footer)}</text>
</svg>
`;
}
