import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Icon } from '../../components/Icon';
import { CameraView } from '../../components/ui';
import type { Camera, Pt, Zone, ZonePurpose } from '../../data/types';
import { uid } from '../../lib/persist';
import { ZONE_COLORS } from '../../scenes/zones';

// The admin draws every zone by hand on the camera's picture: areas as
// polygons, edges and gates as lines. Nothing is detected automatically.
// Points are kept in % of the view so zones survive any screen size.

type Tool = 'select' | 'polygon' | 'line';

const clamp = (v: number) => Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;
const near = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < 2.2 && Math.abs(a[1] - b[1]) < 3.5;
const pts = (p: Pt[]) => p.map((q) => `${q[0]},${q[1]}`).join(' ');

export function ZoneEditor({ cam, zones, onChange, selectedId, onSelect, readOnly }: { cam: Camera; zones: Zone[]; onChange: (z: Zone[]) => void; selectedId?: string; onSelect: (id?: string) => void; readOnly?: boolean }) {
  const [tool, setTool] = useState<Tool>('select');
  const [draft, setDraft] = useState<Pt[]>([]);
  const [hover, setHover] = useState<Pt | null>(null);
  const drag = useRef<{ zone: string; i: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  const toPct = (e: { clientX: number; clientY: number }): Pt => {
    const r = svg.current!.getBoundingClientRect();
    return [clamp(((e.clientX - r.left) / r.width) * 100), clamp(((e.clientY - r.top) / r.height) * 100)];
  };

  const finish = (points: Pt[], kind: 'polygon' | 'line') => {
    const n = zones.length + 1;
    const purpose: ZonePurpose = kind === 'line' ? 'line' : 'restricted';
    const z: Zone = { id: `${cam.id}-${uid('Z')}`, name: kind === 'line' ? `Line ${n}` : `Zone ${n}`, purpose, kind, points };
    onChange([...zones, z]);
    onSelect(z.id);
    setDraft([]);
    setTool('select');
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (tool === 'select') return;
      if (e.key === 'Escape') {
        setDraft([]);
        setTool('select');
      }
      if (e.key === 'Enter' && tool === 'polygon' && draft.length >= 3) finish(draft, 'polygon');
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const down = (e: PointerEvent<SVGSVGElement>) => {
    if (readOnly) return;
    const p = toPct(e);
    if (tool === 'polygon') {
      if (draft.length >= 3 && near(p, draft[0])) finish(draft, 'polygon');
      else setDraft([...draft, p]);
    } else if (tool === 'line') {
      if (draft.length === 1) finish([draft[0], p], 'line');
      else setDraft([p]);
    } else {
      const handle = (e.target as Element).getAttribute('data-handle');
      if (handle) {
        const [zone, i] = handle.split('|');
        drag.current = { zone, i: Number(i) };
        svg.current?.setPointerCapture(e.pointerId);
        return;
      }
      const zid = (e.target as Element).getAttribute('data-zone');
      onSelect(zid ?? undefined);
    }
  };

  const move = (e: PointerEvent<SVGSVGElement>) => {
    const p = toPct(e);
    if (drag.current) {
      const { zone, i } = drag.current;
      onChange(zones.map((z) => (z.id === zone ? { ...z, points: z.points.map((q, j) => (j === i ? p : q)) } : z)));
      return;
    }
    if (tool !== 'select') setHover(p);
  };

  const up = () => {
    drag.current = null;
  };

  const selected = zones.find((z) => z.id === selectedId);

  return (
    <div className="zedit">
      {!readOnly && (
        <div className="zedit__tools" role="toolbar" aria-label="Zone tools">
          <button type="button" aria-pressed={tool === 'select'} onClick={() => setTool('select')}>
            <Icon name="cursor" size={16} />
            Select and move
          </button>
          <button
            type="button"
            aria-pressed={tool === 'polygon'}
            onClick={() => {
              setTool('polygon');
              setDraft([]);
            }}
          >
            <Icon name="polygon" size={16} />
            Draw an area
          </button>
          <button
            type="button"
            aria-pressed={tool === 'line'}
            onClick={() => {
              setTool('line');
              setDraft([]);
            }}
          >
            <Icon name="line" size={16} />
            Draw a line
          </button>
          <span className="spacer" />
          {selected && (
            <button
              type="button"
              onClick={() => {
                onChange(zones.filter((z) => z.id !== selected.id));
                onSelect(undefined);
              }}
            >
              <Icon name="trash" size={16} />
              Delete {selected.name}
            </button>
          )}
        </div>
      )}
      <div className={`zedit__canvas zedit__canvas--${tool}`}>
        <CameraView cam={cam} still caption />
        <svg ref={svg} className="zedit__svg" viewBox="0 0 100 100" preserveAspectRatio="none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => setHover(null)} onDoubleClick={() => tool === 'polygon' && draft.length >= 3 && finish(draft, 'polygon')}>
          {zones.map((z) => {
            const c = ZONE_COLORS[z.purpose];
            const sel = z.id === selectedId;
            return z.kind === 'line' ? (
              <g key={z.id}>
                <polyline points={pts(z.points)} fill="none" stroke="transparent" strokeWidth={14} vectorEffect="non-scaling-stroke" data-zone={z.id} />
                <polyline points={pts(z.points)} fill="none" stroke={c} strokeWidth={sel ? 4 : 3} strokeDasharray="8 5" vectorEffect="non-scaling-stroke" pointerEvents="none" />
              </g>
            ) : (
              <polygon key={z.id} points={pts(z.points)} fill={c} fillOpacity={sel ? 0.32 : 0.2} stroke={c} strokeWidth={sel ? 3 : 2} vectorEffect="non-scaling-stroke" data-zone={z.id} />
            );
          })}
          {selected &&
            !readOnly &&
            selected.points.map((p, i) => <ellipse key={i} cx={p[0]} cy={p[1]} rx={1.1} ry={1.9} className="zedit__handle" data-handle={`${selected.id}|${i}`} />)}
          {draft.length > 0 && (
            <>
              <polyline points={pts(hover ? [...draft, hover] : draft)} fill="none" stroke="#7D9BFF" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
              {draft.map((p, i) => (
                <ellipse key={i} cx={p[0]} cy={p[1]} rx={0.9} ry={1.6} fill={i === 0 ? '#fff' : '#7D9BFF'} stroke="#2D5BFF" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              ))}
            </>
          )}
        </svg>
        {zones.map((z) => {
          const n = z.points.length;
          const x = z.points.reduce((s, p) => s + p[0], 0) / n;
          const y = Math.min(...z.points.map((p) => p[1]));
          return (
            <span key={z.id} className={`camview__zone-label${z.id === selectedId ? ' is-sel' : ''}`} style={{ left: `${Math.min(88, Math.max(6, x))}%`, top: `${Math.max(2, y - 7)}%`, borderColor: ZONE_COLORS[z.purpose] }}>
              {z.name}
            </span>
          );
        })}
      </div>
      {!readOnly && (
        <p className="meta">
          {tool === 'polygon'
            ? draft.length < 3
              ? 'Click to place corners. Three or more make an area.'
              : 'Click the first corner, double-click or press Enter to finish. Esc cancels.'
            : tool === 'line'
              ? draft.length === 0
                ? 'Click where the line starts.'
                : 'Click where the line ends.'
              : 'Click a zone to select it, then drag its corners. Pick a tool to draw a new one.'}
        </p>
      )}
    </div>
  );
}
