import { memo, useId, type ReactNode, type SVGProps } from 'react';
import type { SceneKind } from '../data/types';

// Sample camera pictures. There is no video in the prototype, so each camera
// shows a drawn terminal scene (640 × 360) with a few workers and vehicles
// moving on it. `variant` mirrors the view and changes palette and light, so
// cameras in one area don't look identical. Default zones in ./zones.ts are
// drawn against the same geometry.

export const SCENE_W = 640;
export const SCENE_H = 360;

const BOX_PALETTES = [
  ['#2F6DA3', '#B4432F', '#D9A13B', '#3E8A5B', '#7A8794', '#8C3D63'],
  ['#C2552B', '#28597F', '#6F8E3C', '#C9A227', '#55606B', '#9B3B3B'],
  ['#3D7DB8', '#D07A2A', '#4C6F55', '#A93A46', '#C7B79A', '#2E4F6E'],
];

const rnd = (seed: number) => {
  let s = (seed * 9301 + 49297) % 233280;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
};

function Person({ s = 1, vest = '#F28C28', helmet = '#F4F4F2', noPpe = false }: { s?: number; vest?: string; helmet?: string; noPpe?: boolean }) {
  return (
    <g transform={`scale(${s})`}>
      <ellipse cx="0" cy="0" rx="7" ry="2" fill="#000" opacity=".25" />
      <path d="M-3.2 0 L-2.2 -12 M3.2 0 L2.2 -12" stroke="#2A3340" strokeWidth="2.6" strokeLinecap="round" />
      <rect x="-4.6" y="-23" width="9.2" height="12.5" rx="2.5" fill={noPpe ? '#4C5A6B' : vest} />
      {!noPpe && <path d="M-4.6 -17.5 H4.6 M-4.6 -14.5 H4.6" stroke="#E9F1A8" strokeWidth="1.1" />}
      <circle cx="0" cy="-27" r="3.6" fill="#B98563" />
      {!noPpe && <path d="M-4.3 -27.6 a4.3 4.3 0 0 1 8.6 0 z" fill={helmet} />}
    </g>
  );
}

function Truck({ s = 1, cab = '#C8452D', box }: { s?: number; cab?: string; box?: string }) {
  return (
    <g transform={`scale(${s})`}>
      <ellipse cx="0" cy="2" rx="44" ry="4" fill="#000" opacity=".22" />
      {box && <rect x="-40" y="-30" width="58" height="24" fill={box} stroke="#000" strokeOpacity=".3" />}
      {box && <path d="M-30 -30 v24 M-20 -30 v24 M-10 -30 v24 M0 -30 v24 M10 -30 v24" stroke="#000" strokeOpacity=".18" />}
      <rect x="-42" y="-7" width="62" height="5" fill="#2B2F33" />
      <path d="M20 -2 V-24 h12 l8 9 V-2 z" fill={cab} />
      <rect x="27" y="-21" width="8" height="7" fill="#9EC2D8" opacity=".85" />
      {[-32, -18, 8, 30].map((x) => (
        <circle key={x} cx={x} cy="0" r="4.2" fill="#1C1F22" />
      ))}
    </g>
  );
}

function Forklift({ s = 1 }: { s?: number }) {
  return (
    <g transform={`scale(${s})`}>
      <ellipse cx="0" cy="2" rx="18" ry="3" fill="#000" opacity=".22" />
      <rect x="-12" y="-16" width="20" height="14" rx="2" fill="#E0A423" />
      <path d="M-8 -16 v-10 h12 v10" fill="none" stroke="#2B2F33" strokeWidth="1.6" />
      <path d="M10 -28 V0 M10 -2 h10" stroke="#40464C" strokeWidth="2.4" />
      <circle cx="-7" cy="0" r="3.6" fill="#1C1F22" />
      <circle cx="5" cy="0" r="3.6" fill="#1C1F22" />
    </g>
  );
}

/** Text that stays readable when the scene is mirrored. */
function Label({ x, y, mirror, children, ...rest }: { x: number; y: number; mirror?: boolean; children: ReactNode } & Omit<SVGProps<SVGTextElement>, 'x' | 'y'>) {
  return (
    <text x={x} y={y} textAnchor="middle" transform={mirror ? `translate(${2 * x} 0) scale(-1 1)` : undefined} {...rest}>
      {children}
    </text>
  );
}

/** One actor moving along a path; when `still`, it sits at the path's start. */
function Mover({ path, dur, begin = 0, still, children }: { path: string; dur: number; begin?: number; still?: boolean; children: ReactNode }) {
  if (still) {
    const m = /M\s*([-\d.]+)[ ,]([-\d.]+)/.exec(path);
    return <g transform={`translate(${m?.[1] ?? 0} ${m?.[2] ?? 0})`}>{children}</g>;
  }
  return (
    <g>
      <animateMotion dur={`${dur}s`} begin={`${-begin}s`} repeatCount="indefinite" path={path} />
      {children}
    </g>
  );
}

function containerStack(x: number, baseY: number, w: number, tierH: number, tiers: number, pal: string[], r: () => number, key: string) {
  const out: ReactNode[] = [];
  for (let t = 0; t < tiers; t++) {
    const c = pal[Math.floor(r() * pal.length)];
    const y = baseY - (t + 1) * tierH;
    out.push(
      <g key={`${key}-${t}`}>
        <rect x={x} y={y} width={w} height={tierH} fill={c} stroke="#000" strokeOpacity=".35" strokeWidth=".8" />
        <path d={`M${x + w * 0.25} ${y + 2} v${tierH - 4} M${x + w * 0.5} ${y + 2} v${tierH - 4} M${x + w * 0.75} ${y + 2} v${tierH - 4}`} stroke="#000" strokeOpacity=".16" />
      </g>,
    );
  }
  return out;
}

interface SceneProps {
  kind: SceneKind;
  variant?: number;
  /** No movement: for thumbnails, snapshots and many-tile grids. */
  still?: boolean;
  /** Draws the person or vehicle an alert is about inside its box (% of the view). */
  subject?: { box: [number, number, number, number]; type: 'person' | 'vehicle' | 'smoke'; noPpe?: boolean };
  offline?: boolean;
  className?: string;
  title?: string;
}

function SceneImpl({ kind, variant = 0, still, subject, offline, className, title }: SceneProps) {
  const uid = useId().replace(/:/g, '');
  const mirror = variant % 2 === 1;
  const pal = BOX_PALETTES[variant % BOX_PALETTES.length];
  const r = rnd(variant * 31 + kind.length * 7);
  const night = kind === 'perimeter' ? variant % 3 === 2 : variant % 7 === 5;
  const id = (n: string) => `${uid}-${n}`;

  let body: ReactNode;
  switch (kind) {
    case 'quay':
      body = <Quay mirror={mirror} id={id} pal={pal} r={r} still={still} />;
      break;
    case 'deck':
      body = <Deck id={id} pal={pal} r={r} still={still} />;
      break;
    case 'yard':
      body = <Yard id={id} pal={pal} r={r} still={still} />;
      break;
    case 'reefer':
      body = <Reefer id={id} r={r} still={still} />;
      break;
    case 'gate':
      body = <Gate mirror={mirror} id={id} pal={pal} still={still} />;
      break;
    case 'workshop':
      body = <Workshop id={id} still={still} />;
      break;
    case 'hazmat':
      body = <Hazmat mirror={mirror} id={id} pal={pal} still={still} />;
      break;
    case 'perimeter':
      body = <Perimeter id={id} still={still} night={night} />;
      break;
  }

  let subj: ReactNode = null;
  if (subject) {
    const [x, y, w, h] = subject.box;
    const cx = ((x + w / 2) / 100) * SCENE_W;
    const by = ((y + h) / 100) * SCENE_H;
    const s = Math.max(0.6, ((h / 100) * SCENE_H) / 30);
    subj =
      subject.type === 'person' ? (
        <g transform={`translate(${mirror ? SCENE_W - cx : cx} ${by - 2})`}>
          <Person s={s} noPpe={subject.noPpe} />
        </g>
      ) : subject.type === 'vehicle' ? (
        <g transform={`translate(${mirror ? SCENE_W - cx : cx} ${by - 4})`}>
          <Truck s={Math.min(1.3, s * 0.45)} cab="#3D6FA3" box={pal[2]} />
        </g>
      ) : (
        <g transform={`translate(${mirror ? SCENE_W - cx : cx} ${by})`} opacity=".85">
          <ellipse cx="0" cy="-30" rx="40" ry="26" fill="#9AA0A6" opacity=".7" />
          <ellipse cx="-14" cy="-56" rx="30" ry="20" fill="#B8BDC2" opacity=".6" />
          <path d="M-8 0 q8 -22 0 -30 q14 10 10 30 z" fill="#F08A24" />
        </g>
      );
  }

  return (
    <svg className={className} viewBox={`0 0 ${SCENE_W} ${SCENE_H}`} preserveAspectRatio="xMidYMid slice" role="img" aria-label={title ?? `${kind} camera view`}>
      <defs>
        <radialGradient id={id('vig')} cx=".5" cy=".5" r=".75">
          <stop offset=".6" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".5" />
        </radialGradient>
        <pattern id={id('scan')} width="4" height="4" patternUnits="userSpaceOnUse">
          <rect width="4" height="1" fill="#000" opacity=".07" />
        </pattern>
      </defs>
      <g transform={mirror ? `translate(${SCENE_W} 0) scale(-1 1)` : undefined}>
        {body}
        {subj}
      </g>
      {night && <rect width={SCENE_W} height={SCENE_H} fill="#061226" opacity=".5" style={{ mixBlendMode: 'multiply' }} />}
      <rect width={SCENE_W} height={SCENE_H} fill={`url(#${id('scan')})`} />
      <rect width={SCENE_W} height={SCENE_H} fill={`url(#${id('vig')})`} />
      {offline && (
        <g>
          <rect width={SCENE_W} height={SCENE_H} fill="#0B1828" opacity=".88" />
          <text x={SCENE_W / 2} y={SCENE_H / 2} textAnchor="middle" fill="#9FB1C6" fontSize="22" fontFamily="JetBrains Mono, monospace">
            NO SIGNAL
          </text>
        </g>
      )}
    </svg>
  );
}

export const Scene = memo(SceneImpl);

type DrawProps = { id: (n: string) => string; pal?: string[]; r?: () => number; still?: boolean; mirror?: boolean };

function Sky({ id, top = '#8FA3B5', bottom = '#CBD4DC', h = 160 }: { id: (n: string) => string; top?: string; bottom?: string; h?: number }) {
  return (
    <>
      <defs>
        <linearGradient id={id('sky')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={top} />
          <stop offset="1" stopColor={bottom} />
        </linearGradient>
      </defs>
      <rect width={SCENE_W} height={h} fill={`url(#${id('sky')})`} />
    </>
  );
}

function Quay({ id, pal = BOX_PALETTES[0], r = Math.random, still, mirror }: DrawProps) {
  const stacks: ReactNode[] = [];
  for (let i = 0; i < 15; i++) stacks.push(...containerStack(10 + i * 42, 96, 40, 15, 2 + Math.floor(r() * 3), pal, r, `q${i}`));
  return (
    <>
      <Sky id={id} />
      <rect y="118" width={SCENE_W} height="40" fill="#4E6475" />
      {stacks}
      <path d="M0 96 L640 84 L640 186 L0 198 Z" fill="#1F3247" />
      <path d="M0 186 L640 174 L640 186 L0 198 Z" fill="#7A2A2A" />
      <Label x={510} y={150} mirror={mirror} fill="#E8EDF3" opacity=".55" fontSize="20" fontFamily="Instrument Sans, sans-serif" fontWeight="700" letterSpacing="4">
        NORDIC STAR
      </Label>
      <defs>
        <linearGradient id={id('apron')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8C9196" />
          <stop offset="1" stopColor="#575C61" />
        </linearGradient>
      </defs>
      <path d="M0 200 L640 190 L640 360 L0 360 Z" fill={`url(#${id('apron')})`} />
      <path d="M0 200 L640 190" stroke="#E2B227" strokeWidth="3" />
      {[40, 150, 260, 370, 480, 590].map((x) => (
        <rect key={x} x={x} y={190 + (640 - x) / 64} width="12" height="9" rx="2" fill="#2B2F33" />
      ))}
      <path d="M0 232 L640 224 M0 330 L640 322" stroke="#3B4045" strokeWidth="3" />
      <path d="M0 268 L640 260 M0 296 L640 290" stroke="#F1F1EE" strokeOpacity=".6" strokeWidth="2" strokeDasharray="22 16" />
      {/* STS crane */}
      <g fill="#D8A11F" stroke="#9A6E10" strokeWidth="1">
        <path d="M170 330 L186 330 L208 40 L198 40 Z" />
        <path d="M452 322 L468 322 L442 40 L432 40 Z" />
        <rect x="100" y="28" width="540" height="16" />
        <rect x="190" y="118" width="262" height="12" />
        <path d="M200 44 L310 118 M440 44 L330 118" strokeWidth="5" stroke="#C8901A" fill="none" />
      </g>
      <rect x="292" y="44" width="40" height="18" fill="#3A3F45" />
      <path d="M302 62 V150 M322 62 V150" stroke="#2B2F33" strokeWidth="1.5" />
      <rect x="284" y="150" width="56" height="16" fill={pal[1]} stroke="#000" strokeOpacity=".35" />
      <rect x="520" y="210" width="70" height="30" fill="#6E747A" stroke="#3B4045" />
      <path d="M520 220 h70 M520 230 h70" stroke="#3B4045" />
      <Mover path="M700 278 L-80 286" dur={22} begin={4} still={still}>
        <Truck s={0.9} cab="#C8452D" box={pal[0]} />
      </Mover>
      <Mover path="M600 252 L60 258 L600 252" dur={30} begin={9} still={still}>
        <Person s={1.05} />
      </Mover>
      <Mover path="M120 312 L300 310 L120 312" dur={18} begin={2} still={still}>
        <Person s={1.35} vest="#E8D33A" />
      </Mover>
      <Mover path="M560 236 L590 236 L560 236" dur={9} still={still}>
        <Person s={0.9} />
      </Mover>
    </>
  );
}

function Deck({ id, pal = BOX_PALETTES[0], r = Math.random, still }: DrawProps) {
  const bay = (x: number, base: number, w: number, tierH: number, tiers: number, cols: number, key: string) => {
    const out: ReactNode[] = [];
    for (let c = 0; c < cols; c++) out.push(...containerStack(x + c * (w / cols), base, w / cols, tierH, tiers - (c % 2), pal, r, `${key}${c}`));
    return out;
  };
  return (
    <>
      <Sky id={id} top="#7F94A7" bottom="#C3CDD6" h={170} />
      <defs>
        <linearGradient id={id('sea')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4A6578" />
          <stop offset="1" stopColor="#253847" />
        </linearGradient>
        <linearGradient id={id('plate')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#626970" />
          <stop offset="1" stopColor="#3C4248" />
        </linearGradient>
      </defs>
      <rect y="150" width={SCENE_W} height="210" fill={`url(#${id('sea')})`} />
      <path d="M0 150 H640" stroke="#9DB0C0" strokeOpacity=".6" />
      <path d="M0 360 L560 360 L350 158 L300 158 L0 240 Z" fill={`url(#${id('plate')})`} />
      {bay(0, 300, 230, 34, 6, 5, 'a')}
      {bay(206, 216, 96, 18, 5, 4, 'b')}
      {bay(288, 176, 46, 9, 4, 3, 'c')}
      <path d="M232 300 V95 M300 216 V124 M334 176 V140" stroke="#2B2F33" strokeWidth="3" />
      <path d="M380 360 L540 360 L348 160 L330 160 Z" fill="#737B83" />
      <path d="M380 360 L330 160 M540 360 L348 160" stroke="#E2B227" strokeWidth="3" />
      <path d="M560 360 L350 158" stroke="#2A2F35" strokeWidth="4" />
      <path d="M598 262 L356 140" stroke="#C9CED3" strokeWidth="3" />
      <path d="M580 300 L354 150" stroke="#C9CED3" strokeWidth="2" />
      {[0, 0.12, 0.24, 0.36, 0.48, 0.6, 0.72, 0.84].map((t) => {
        const bx = 560 - t * 210;
        const by = 360 - t * 202;
        const tx = 598 - t * 242;
        const ty = 262 - t * 122;
        return <path key={t} d={`M${bx} ${by} L${tx} ${ty}`} stroke="#C9CED3" strokeWidth={3 - t * 2} />;
      })}
      <Mover path="M420 268 L392 214 L420 268" dur={16} begin={3} still={still}>
        <Person s={1.1} />
      </Mover>
      <Mover path="M372 196 L362 178 L372 196" dur={11} begin={6} still={still}>
        <Person s={0.6} vest="#E8D33A" />
      </Mover>
      <Mover path="M180 330 L120 334 L180 330" dur={14} still={still}>
        <Person s={1.7} />
      </Mover>
    </>
  );
}

function Yard({ id, pal = BOX_PALETTES[0], r = Math.random, still }: DrawProps) {
  const rows: ReactNode[] = [];
  const depth = [
    { y: 300, h: 30, w: 70, n: 4 },
    { y: 250, h: 22, w: 52, n: 4 },
    { y: 214, h: 16, w: 38, n: 4 },
    { y: 188, h: 12, w: 28, n: 4 },
    { y: 170, h: 8, w: 20, n: 4 },
  ];
  depth.forEach((d, i) => {
    const leftEnd = 280 - i * 4 - (4 - i) * 0;
    const xL = leftEnd - d.w * (4 - i * 0.4);
    for (let c = 0; c < 3; c++) rows.push(...containerStack(xL + c * d.w * 0.9 - i * 30, d.y, d.w * 0.9, d.h, d.n - (c % 2), pal, r, `l${i}${c}`));
    const xR = 360 + i * 4;
    for (let c = 0; c < 3; c++) rows.push(...containerStack(xR + c * d.w * 0.9 + i * 30, d.y, d.w * 0.9, d.h, d.n - ((c + 1) % 2), pal, r, `r${i}${c}`));
  });
  return (
    <>
      <Sky id={id} h={170} />
      <rect y="160" width={SCENE_W} height="200" fill="#5D6267" />
      <path d="M290 165 L350 165 L640 360 L0 360 Z" fill="#6B7075" />
      <path d="M320 168 V360" stroke="#F1F1EE" strokeOpacity=".7" strokeWidth="3" strokeDasharray="18 14" />
      <path d="M0 300 L286 172 L298 172 L60 360 L0 360 Z" fill="#3F7A5A" opacity=".75" />
      <path d="M0 300 L286 172 M60 360 L298 172" stroke="#E2B227" strokeWidth="2" />
      {rows}
      {/* RTG portal */}
      <g fill="#D8A11F" stroke="#9A6E10">
        <rect x="150" y="60" width="12" height="230" />
        <rect x="478" y="60" width="12" height="230" />
        <rect x="140" y="52" width="360" height="16" />
      </g>
      <rect x="300" y="68" width="44" height="14" fill="#3A3F45" />
      <path d="M310 82 V130 M334 82 V130" stroke="#2B2F33" />
      <rect x="292" y="130" width="60" height="18" fill={pal[3]} stroke="#000" strokeOpacity=".3" />
      <Mover path="M322 380 L322 190 L322 380" dur={26} begin={5} still={still}>
        <Truck s={0.55} cab="#3D6FA3" box={pal[0]} />
      </Mover>
      <Mover path="M40 340 L230 210 L40 340" dur={24} begin={8} still={still}>
        <Person s={1} />
      </Mover>
    </>
  );
}

function Reefer({ id, r = Math.random, still }: DrawProps) {
  const white = ['#E9ECEE', '#DCE1E4', '#F2F3F4', '#D3D9DD'];
  const stacks: ReactNode[] = [];
  for (let i = 0; i < 9; i++) stacks.push(...containerStack(20 + i * 66, 310, 64, 44, 3 + (i % 2), white, r, `rf${i}`));
  return (
    <>
      <Sky id={id} top="#93A6B6" bottom="#D2DAE1" h={130} />
      <rect y="120" width={SCENE_W} height="240" fill="#5F6469" />
      {stacks}
      {Array.from({ length: 9 }).map((_, i) => (
        <g key={i}>
          <rect x={36 + i * 66} y={150 + (i % 2 ? 44 : 0)} width="18" height="14" fill="#5A6C7A" />
          <path d={`M45 ${164} q6 30 -4 60`} transform={`translate(${i * 66} ${i % 2 ? 44 : 0})`} stroke="#1F5FA8" strokeWidth="2" fill="none" />
        </g>
      ))}
      {/* gantry walkway */}
      <rect x="0" y="216" width={SCENE_W} height="8" fill="#C9A227" />
      <path d="M0 200 H640" stroke="#C9A227" strokeWidth="2" />
      {Array.from({ length: 17 }).map((_, i) => (
        <path key={i} d={`M${i * 40} 200 V216`} stroke="#C9A227" strokeWidth="2" />
      ))}
      <path d="M560 224 L610 310 M575 224 L625 310" stroke="#8F7A1C" strokeWidth="3" />
      <rect y="310" width={SCENE_W} height="50" fill="#4E5358" />
      <Mover path="M60 214 L520 214 L60 214" dur={34} begin={6} still={still}>
        <Person s={0.95} />
      </Mover>
      <Mover path="M520 350 L120 350 L520 350" dur={28} still={still}>
        <Person s={1.2} vest="#E8D33A" />
      </Mover>
    </>
  );
}

function Gate({ id, pal = BOX_PALETTES[0], still, mirror }: DrawProps) {
  return (
    <>
      <Sky id={id} h={130} />
      <rect y="110" width={SCENE_W} height="250" fill="#666B70" />
      <rect x="0" y="34" width={SCENE_W} height="40" fill="#C8CDD2" />
      <rect x="0" y="74" width={SCENE_W} height="6" fill="#8D949B" />
      {[60, 220, 380, 540].map((x) => (
        <g key={x}>
          <rect x={x} y="80" width="10" height="170" fill="#9AA1A8" />
          <rect x={x - 22} y="160" width="54" height="56" fill="#E6E9EC" stroke="#9AA1A8" />
          <rect x={x - 14} y="170" width="38" height="18" fill="#7EA8C8" />
          <path d={`M${x + 32} 200 H${x + 120}`} stroke="#D33B2C" strokeWidth="4" strokeDasharray="12 10" />
        </g>
      ))}
      {[[0, 140], [140, 300], [300, 460], [460, 640]].map(([a, b], i) => (
        <Label key={i} x={(a + b) / 2} y={62} mirror={mirror} fill="#2B2F33" fontSize="16" fontWeight="700" fontFamily="Instrument Sans, sans-serif">
          LANE {mirror ? 4 - i : i + 1}
        </Label>
      ))}
      <path d="M0 268 H640" stroke="#F1F1EE" strokeWidth="5" />
      <path d="M10 300 H630" stroke="#F1F1EE" strokeWidth="14" strokeDasharray="20 16" opacity=".85" />
      <Mover path="M110 250 L110 250" dur={10} still>
        <Truck s={0.95} cab="#C8452D" box={pal[0]} />
      </Mover>
      <Mover path="M420 252 L430 252" dur={10} still>
        <Truck s={0.95} cab="#2F6DA3" box={pal[4]} />
      </Mover>
      <Mover path="M720 350 L-80 350" dur={20} begin={6} still={still}>
        <Truck s={1.15} cab="#3E8A5B" box={pal[1]} />
      </Mover>
      <Mover path="M180 300 L460 300 L180 300" dur={26} begin={3} still={still}>
        <Person s={1.1} />
      </Mover>
    </>
  );
}

function Workshop({ id, still }: DrawProps) {
  return (
    <>
      <defs>
        <linearGradient id={id('wall')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7C8691" />
          <stop offset="1" stopColor="#5C656F" />
        </linearGradient>
        <pattern id={id('rib')} width="18" height="10" patternUnits="userSpaceOnUse">
          <rect width="2" height="10" fill="#000" opacity=".12" />
        </pattern>
      </defs>
      <rect width={SCENE_W} height="180" fill={`url(#${id('wall')})`} />
      <rect width={SCENE_W} height="180" fill={`url(#${id('rib')})`} />
      <path d="M0 180 L640 180 L640 360 L0 360 Z" fill="#59716A" />
      {[80, 240, 400, 560].map((x) => (
        <g key={x}>
          <rect x={x - 30} y="10" width="60" height="6" fill="#DDE3E8" />
          <path d={`M${x - 30} 16 L${x - 70} 120 L${x + 70} 120 L${x + 30} 16 Z`} fill="#FFF8DA" opacity=".08" />
        </g>
      ))}
      <rect x="60" y="70" width="170" height="110" fill="#4A5560" stroke="#3A434C" />
      <rect x="70" y="80" width="150" height="90" fill="#2F3942" />
      <path d="M0 250 H640 M0 320 H640" stroke="#E2B227" strokeWidth="3" />
      <path d="M380 180 L380 250 M520 180 L520 250" stroke="#E2B227" strokeWidth="2" strokeDasharray="8 6" />
      {/* reach stacker in a bay */}
      <g transform="translate(300 240)">
        <rect x="-70" y="-40" width="110" height="34" rx="4" fill="#C8452D" />
        <rect x="-40" y="-70" width="34" height="30" fill="#9EC2D8" stroke="#2B2F33" />
        <path d="M30 -30 L140 -110" stroke="#C8452D" strokeWidth="14" />
        <circle cx="-48" cy="-4" r="14" fill="#1C1F22" />
        <circle cx="16" cy="-4" r="14" fill="#1C1F22" />
      </g>
      <rect x="560" y="120" width="60" height="60" fill="#5B6670" stroke="#3A434C" />
      <path d="M566 135 h48 M566 150 h48 M566 165 h48" stroke="#AAB4BC" />
      <Mover path="M420 300 L600 300 L420 300" dur={20} begin={2} still={still}>
        <Person s={1.2} />
      </Mover>
      <Mover path="M100 300 L260 290 L100 300" dur={24} begin={8} still={still}>
        <Forklift s={1.3} />
      </Mover>
    </>
  );
}

function Hazmat({ id, pal = BOX_PALETTES[0], still, mirror }: DrawProps) {
  const placard = (x: number, y: number, c: string) => (
    <g transform={`translate(${x} ${y}) rotate(45)`}>
      <rect x="-7" y="-7" width="14" height="14" fill={c} stroke="#000" strokeWidth=".6" />
    </g>
  );
  return (
    <>
      <Sky id={id} h={150} />
      <defs>
        <pattern id={id('mesh')} width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M0 0 L10 10 M10 0 L0 10" stroke="#C9CED3" strokeWidth=".8" opacity=".7" />
        </pattern>
      </defs>
      <rect y="140" width={SCENE_W} height="220" fill="#6A6F74" />
      <path d="M60 300 L580 300 L520 170 L120 170 Z" fill="#7A7468" />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x={160 + i * 110} y={196} width="96" height="40" fill={pal[i + 1]} stroke="#000" strokeOpacity=".35" />
          <rect x={150 + i * 120} y={244} width="104" height="44" fill={pal[(i + 3) % pal.length]} stroke="#000" strokeOpacity=".35" />
          {placard(208 + i * 110, 216, i === 1 ? '#D33B2C' : '#E6C229')}
          {placard(202 + i * 120, 266, '#F2F3F4')}
        </g>
      ))}
      <path d="M60 300 L120 170 L520 170 L580 300" fill="none" stroke="#9AA1A8" strokeWidth="3" />
      <path d="M60 300 L60 236 L120 120 L120 170" fill={`url(#${id('mesh')})`} stroke="#9AA1A8" strokeWidth="2" />
      <path d="M580 300 L580 236 L520 120 L520 170" fill={`url(#${id('mesh')})`} stroke="#9AA1A8" strokeWidth="2" />
      <path d="M120 120 L520 120 L520 170 L120 170 Z" fill={`url(#${id('mesh')})`} />
      <path d="M60 236 L250 236 L250 300 L60 300 Z" fill={`url(#${id('mesh')})`} stroke="#9AA1A8" strokeWidth="2" />
      <path d="M390 236 L580 236 L580 300 L390 300 Z" fill={`url(#${id('mesh')})`} stroke="#9AA1A8" strokeWidth="2" />
      <rect x="290" y="306" width="62" height="34" fill="#F2F3F4" stroke="#2B2F33" />
      <Label x={321} y={320} mirror={mirror} fontSize="9" fontWeight="700" fill="#B42341" fontFamily="Instrument Sans, sans-serif">
        IMDG
      </Label>
      <Label x={321} y={333} mirror={mirror} fontSize="7" fill="#2B2F33" fontFamily="Instrument Sans, sans-serif">
        AUTHORISED ONLY
      </Label>
      <Mover path="M120 346 L560 340 L120 346" dur={30} begin={4} still={still}>
        <Person s={1.15} />
      </Mover>
    </>
  );
}

function Perimeter({ id, still, night }: DrawProps & { night?: boolean }) {
  return (
    <>
      <Sky id={id} top={night ? '#1A2738' : '#93A6B6'} bottom={night ? '#34465C' : '#D2DAE1'} h={170} />
      <defs>
        <pattern id={id('fence')} width="12" height="12" patternUnits="userSpaceOnUse">
          <path d="M0 0 L12 12 M12 0 L0 12" stroke="#B5BCC3" strokeWidth=".9" />
        </pattern>
      </defs>
      <rect y="150" width={SCENE_W} height="210" fill="#5E6E58" />
      <path d="M0 230 L640 160 L640 210 L0 330 Z" fill="#6B7075" />
      <path d="M0 330 L640 210" stroke="#E9ECEE" strokeWidth="2" strokeDasharray="20 14" opacity=".7" />
      <path d="M0 120 L640 96 L640 160 L0 230 Z" fill={`url(#${id('fence')})`} />
      <path d="M0 120 L640 96 M0 230 L640 160" stroke="#9AA1A8" strokeWidth="2" />
      {Array.from({ length: 9 }).map((_, i) => {
        const x = i * 80;
        return <path key={i} d={`M${x} ${120 - i * 3} V${230 - i * 8.6}`} stroke="#8D949B" strokeWidth="3" />;
      })}
      {[120, 420].map((x) => (
        <g key={x}>
          <path d={`M${x} 250 V40`} stroke="#8D949B" strokeWidth="4" />
          <rect x={x - 14} y="34" width="28" height="10" fill="#DDE3E8" />
          {night && <path d={`M${x - 12} 44 L${x - 90} 330 L${x + 90} 330 L${x + 12} 44 Z`} fill="#FFF3C4" opacity=".16" />}
        </g>
      ))}
      <Mover path="M-60 300 L700 190" dur={18} begin={7} still={still}>
        <Truck s={0.7} cab="#55606B" />
      </Mover>
      <Mover path="M500 255 L560 248 L500 255" dur={16} still={still}>
        <Person s={0.9} />
      </Mover>
    </>
  );
}
