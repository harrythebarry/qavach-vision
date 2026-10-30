import { useEffect, type ReactNode } from 'react';
import { Scene, SCENE_H, SCENE_W } from '../scenes/Scene';
import { ZONE_COLORS } from '../scenes/zones';
import type { Alert, AlertState, Camera, Channel, Priority, Zone } from '../data/types';
import { hms } from '../lib/time';
import { Icon, type IconName } from './Icon';
import './ui.css';

export const PRIORITY_NAME: Record<Priority, string> = { P1: 'Critical', P2: 'High', P3: 'Medium', P4: 'Low' };

export function PriorityBadge({ p, short }: { p: Priority; short?: boolean }) {
  return (
    <span className={`prio prio--${p}`}>
      {p === 'P1' && <Icon name="warning" size={13} stroke={2.2} />}
      {p}
      {!short && ` ${PRIORITY_NAME[p]}`}
    </span>
  );
}

const STATE: Record<AlertState, [string, string]> = {
  new: ['New', 'chip--danger'],
  escalated: ['Escalated', 'chip--rising'],
  acknowledged: ['Acknowledged', 'chip--warn'],
  resolved: ['Resolved', 'chip--good'],
  'false-alarm': ['False alarm', ''],
};
export function StateChip({ state }: { state: AlertState }) {
  const [label, cls] = STATE[state];
  return <span className={`chip ${cls}`}>{label}</span>;
}

export const CHANNEL: Record<Channel, { label: string; icon: IconName }> = {
  wall: { label: 'Video wall', icon: 'wall' },
  push: { label: 'Mobile push', icon: 'mobile' },
  sms: { label: 'SMS', icon: 'sms' },
  whatsapp: { label: 'WhatsApp', icon: 'chat' },
  email: { label: 'Email', icon: 'mail' },
  call: { label: 'Phone call', icon: 'phone' },
};

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch__track" />
      {label && <span>{label}</span>}
    </label>
  );
}

export function Seg<T extends string | number>({ options, value, onChange, small, label }: { options: { value: T; label: ReactNode; title?: string }[]; value: T; onChange: (v: T) => void; small?: boolean; label: string }) {
  return (
    <div className={`seg${small ? ' seg--sm' : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
}

export function Modal({ title, onClose, children, footer, wide, icon }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; icon?: ReactNode }) {
  useEscape(onClose);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' modal--wide' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="modal__head">
          {icon}
          <h2>{title}</h2>
          <span className="spacer" />
          <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ title, onClose, children, footer, wide, sub }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEscape(onClose);
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className={`drawer${wide ? ' drawer--wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal__head">
          <div className="stack" style={{ gap: 2 }}>
            <h2>{title}</h2>
            {sub && <span className="meta">{sub}</span>}
          </div>
          <span className="spacer" />
          <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="modal__body" style={{ flex: 1 }}>
          {children}
        </div>
        {footer && <div className="modal__foot">{footer}</div>}
      </aside>
    </>
  );
}

// Overlays share the scene's 640 × 360 space and its "slice" crop, so zones
// and boxes stay on the right spot whatever shape the tile is.
const W = SCENE_W / 100;
const H = SCENE_H / 100;
const pts = (z: Zone) => z.points.map((p) => `${p[0] * W},${p[1] * H}`).join(' ');

export function ZoneOverlay({ zones, highlight, box }: { zones: Zone[]; highlight?: string[]; box?: Alert }) {
  return (
    <svg className="camview__zones" viewBox={`0 0 ${SCENE_W} ${SCENE_H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {zones.map((z) => {
        const c = ZONE_COLORS[z.purpose];
        const on = !highlight || highlight.includes(z.id);
        return z.kind === 'line' ? (
          <polyline key={z.id} points={pts(z)} fill="none" stroke={c} strokeWidth={on ? 3 : 1.5} strokeDasharray="8 5" vectorEffect="non-scaling-stroke" opacity={on ? 1 : 0.45} />
        ) : (
          <polygon key={z.id} points={pts(z)} fill={c} fillOpacity={on ? 0.22 : 0.08} stroke={c} strokeWidth={on ? 2 : 1} vectorEffect="non-scaling-stroke" opacity={on ? 1 : 0.55} />
        );
      })}
      {box && <DetectionBox alert={box} />}
    </svg>
  );
}

const BOX_COLOR: Record<Priority, [string, string]> = { P1: ['#FF5C7A', '#B42341'], P2: ['#FFB45C', '#B9520C'], P3: ['#FFD166', '#8A6400'], P4: ['#FFD166', '#8A6400'] };

function DetectionBox({ alert }: { alert: Alert }) {
  const [x, y, w, h] = alert.box;
  const [stroke, fill] = BOX_COLOR[alert.priority];
  const label = `${Math.round(alert.confidence * 100)}%`;
  return (
    <g>
      <rect x={x * W} y={y * H} width={w * W} height={h * H} rx={3} fill="none" stroke="#000" strokeOpacity={0.35} strokeWidth={4} vectorEffect="non-scaling-stroke" />
      <rect x={x * W} y={y * H} width={w * W} height={h * H} rx={3} fill="none" stroke={stroke} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
      <rect x={x * W - 1} y={y * H - 16} width={label.length * 7 + 8} height={14} rx={2} fill={fill} />
      <text x={x * W + 3} y={y * H - 5} fill="#fff" fontSize={10.5} fontWeight={600} fontFamily="JetBrains Mono, monospace">
        {label}
      </text>
    </g>
  );
}

export function ZoneLabels({ zones, highlight }: { zones: Zone[]; highlight?: string[] }) {
  return (
    <>
      {zones
        .filter((z) => !highlight || highlight.includes(z.id))
        .map((z) => {
          const n = z.points.length;
          const x = z.points.reduce((s, p) => s + p[0], 0) / n;
          const y = Math.min(...z.points.map((p) => p[1]));
          return (
            <span key={z.id} className="camview__zone-label" style={{ left: `${Math.min(86, Math.max(2, x))}%`, top: `${Math.max(2, y - 7)}%`, borderColor: ZONE_COLORS[z.purpose] }}>
              {z.name}
            </span>
          );
        })}
    </>
  );
}

/** A camera picture with its caption, and optionally zones and an alert's detection box. */
export function CameraView({
  cam,
  still,
  alert,
  zones,
  highlightZones,
  showZoneLabels,
  caption = true,
  now,
  className,
  children,
}: {
  cam: Camera;
  still?: boolean;
  alert?: Alert;
  zones?: Zone[];
  highlightZones?: string[];
  showZoneLabels?: boolean;
  caption?: boolean;
  now?: number;
  className?: string;
  children?: ReactNode;
}) {
  const subjType = alert ? (alert.title.toLowerCase().includes('smoke') ? 'smoke' : alert.title.toLowerCase().includes('truck') || alert.title.toLowerCase().includes('vehicle') ? 'vehicle' : 'person') : undefined;
  return (
    <div className={`camview${className ? ` ${className}` : ''}`}>
      <Scene
        kind={cam.scene}
        variant={cam.variant}
        still={still}
        offline={cam.status === 'offline'}
        title={`${cam.id} ${cam.name}`}
        subject={alert && subjType ? { box: alert.box, type: subjType, noPpe: /helmet|vest|life jacket|ppe/i.test(alert.title + alert.detail) } : undefined}
      />
      {((zones && zones.length > 0) || alert) && <ZoneOverlay zones={zones ?? []} highlight={highlightZones} box={alert} />}
      {zones && showZoneLabels && <ZoneLabels zones={zones} highlight={highlightZones} />}
      {caption && (
        <div className="camview__caption">
          <span className="camview__id">{cam.id}</span>
          <span className="ellipsis">{cam.name}</span>
          <span className="spacer" />
          {cam.status !== 'offline' && <span className="camview__rec" aria-label="Live" />}
          {now !== undefined && <span className="camview__time">{hms(now)}</span>}
        </div>
      )}
      {cam.status === 'degraded' && <span className="camview__degraded">Degraded · low light</span>}
      {children}
    </div>
  );
}

export function Empty({ icon = 'info', title, children }: { icon?: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} />
      <strong style={{ color: 'var(--q-ink)' }}>{title}</strong>
      {children}
    </div>
  );
}

export function QaiLabel({ children = 'QAI draft' }: { children?: ReactNode }) {
  return (
    <span className="qai__label">
      <Icon name="spark" size={15} />
      {children}
    </span>
  );
}
