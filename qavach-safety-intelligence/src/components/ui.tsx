import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Scene, SCENE_H, SCENE_W } from '../scenes/Scene';
import { ZONE_COLORS } from '../scenes/zones';
import type { Alert, AlertState, Camera, Channel, Priority, Zone } from '../data/types';
import { apiUrl, streamUrl, stillUrl } from '../lib/backend';
import { hms } from '../lib/time';
import { useService } from '../state/bridge';
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

// Overlays share the picture's space and its "slice" crop, so zones and boxes stay on the right spot whatever shape
// the tile is. The drawn scenes are 640 × 360; a real camera uses its own width to height ratio.
const sizeFor = (aspect: number) => ({ vw: SCENE_H * aspect, W: (SCENE_H * aspect) / 100, H: SCENE_H / 100 });

export function ZoneOverlay({ zones, highlight, box, aspect = SCENE_W / SCENE_H }: { zones: Zone[]; highlight?: string[]; box?: Alert; aspect?: number }) {
  const { vw, W, H } = sizeFor(aspect);
  const pts = (z: Zone) => z.points.map((p) => `${p[0] * W},${p[1] * H}`).join(' ');
  return (
    <svg className="camview__zones" viewBox={`0 0 ${vw} ${SCENE_H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {zones.map((z) => {
        const c = ZONE_COLORS[z.purpose];
        const on = !highlight || highlight.includes(z.id);
        return z.kind === 'line' ? (
          <polyline key={z.id} points={pts(z)} fill="none" stroke={c} strokeWidth={on ? 3 : 1.5} strokeDasharray="8 5" vectorEffect="non-scaling-stroke" opacity={on ? 1 : 0.45} />
        ) : (
          <polygon key={z.id} points={pts(z)} fill={c} fillOpacity={on ? 0.22 : 0.08} stroke={c} strokeWidth={on ? 2 : 1} vectorEffect="non-scaling-stroke" opacity={on ? 1 : 0.55} />
        );
      })}
      {box && <DetectionBox alert={box} W={W} H={H} />}
    </svg>
  );
}

const BOX_COLOR: Record<Priority, [string, string]> = { P1: ['#FF5C7A', '#B42341'], P2: ['#FFB45C', '#B9520C'], P3: ['#FFD166', '#8A6400'], P4: ['#FFD166', '#8A6400'] };

// A person on a wide camera is often 10 to 20 px tall, so a box drawn exactly on them is smaller than its own
// outline and reads as a blob. The box is grown around the person to a minimum size (in the overlay's 360-high units,
// about 4 % of the picture's height for the smallest) so it is always a clear rectangle with the person inside.
const BOX_PAD = 5;
const BOX_MIN_W = 20;
const BOX_MIN_H = 30;

function DetectionBox({ alert, W, H }: { alert: Alert; W: number; H: number }) {
  const [x, y, w, h] = alert.box;
  const [stroke, fill] = BOX_COLOR[alert.priority];
  const vw = 100 * W;
  const vh = 100 * H;
  const bw = Math.max(w * W + 2 * BOX_PAD, BOX_MIN_W);
  const bh = Math.max(h * H + 2 * BOX_PAD, BOX_MIN_H);
  const bx = Math.min(vw - bw, Math.max(0, (x + w / 2) * W - bw / 2));
  const by = Math.min(vh - bh, Math.max(0, (y + h / 2) * H - bh / 2));
  const label = `${Math.round(alert.confidence * 100)}%`;
  const lw = label.length * 6 + 8;
  const lh = 13;
  const ly = by - lh >= 0 ? by - lh : by + bh; // above the box, or below it when the box touches the top edge
  const lx = Math.min(vw - lw, bx);
  return (
    <g>
      <rect x={bx} y={by} width={bw} height={bh} fill="none" stroke="#000" strokeOpacity={0.45} strokeWidth={3.5} vectorEffect="non-scaling-stroke" />
      <rect x={bx} y={by} width={bw} height={bh} fill="none" stroke={stroke} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      <rect x={lx} y={ly} width={lw} height={lh} fill={fill} />
      <text x={lx + 4} y={ly + lh - 3.5} fill="#fff" fontSize={9} fontWeight={600} fontFamily="JetBrains Mono, monospace">
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

/** How often a still tile of a real camera fetches a fresh frame. */
const STILL_REFRESH_MS = 4000;

/** The picture of a real camera:
 *  - live (not `still`): the live preview from the detection service, running like the camera itself;
 *  - `still`: the latest frame, refreshed every few seconds, so a thumbnail follows the camera;
 *  - `frozen`: the frame taken when the camera was connected, for drawing zones on;
 *  - an alert's snapshot, when one is given (the moment it was raised).
 *  Every one of these is served by the detection service, so when it is not running nothing can load: say so,
 *  and tell the parent so it does not draw an alert's box over an empty frame. */
function RealPicture({ cam, still, frozen, snapshot, serviceUp, onMissing }: { cam: Camera; still?: boolean; frozen?: boolean; snapshot?: string; serviceUp: boolean; onMissing: (missing: boolean) => void }) {
  const [broken, setBroken] = useState(false); // the live preview would not load
  const [bump, setBump] = useState(0);
  const [badBump, setBadBump] = useState(-1); // the refresh that found no picture yet
  const [failed, setFailed] = useState<string | null>(null); // the last address that could not be loaded at all
  const refreshing = !!still && !frozen && !snapshot && serviceUp;
  useEffect(() => {
    setBroken(false);
    setFailed(null);
  }, [cam.id, serviceUp]);
  useEffect(() => {
    if (!refreshing) return;
    const t = window.setInterval(() => setBump((n) => n + 1), STILL_REFRESH_MS);
    return () => window.clearInterval(t);
  }, [refreshing]);
  const fallback = stillUrl(cam);
  const latest = refreshing && badBump !== bump ? `${apiUrl(`/api/cameras/${encodeURIComponent(cam.id)}/frame.jpg`)}?t=${bump}` : undefined;
  const src = snapshot ? apiUrl(snapshot) : !still && !frozen && serviceUp && !broken ? streamUrl(cam) : (latest ?? fallback);
  const missing = !src || failed === src;
  useEffect(() => onMissing(missing), [missing, onMissing]);
  if (missing)
    return (
      <div className="camview__nopic">
        <Icon name="camera" size={22} />
        <span>{serviceUp ? 'No picture from this camera' : 'No picture: the detection service is not running'}</span>
        {!serviceUp && <small>Start it with backend/run.sh</small>}
      </div>
    );
  const onError = () => {
    if (src === fallback || src === (snapshot ? apiUrl(snapshot) : '')) setFailed(src);
    else if (src === latest) setBadBump(bump);
    else setBroken(true);
  };
  return <img className="camview__img" src={src} alt="" onError={onError} draggable={false} />;
}

/** A camera picture with its caption, and optionally zones and an alert's detection box. */
export function CameraView({
  cam,
  still,
  frozen,
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
  /** Real cameras: keep the frame taken at connection (zone drawing) instead of following the camera. */
  frozen?: boolean;
  alert?: Alert;
  zones?: Zone[];
  highlightZones?: string[];
  showZoneLabels?: boolean;
  caption?: boolean;
  now?: number;
  className?: string;
  children?: ReactNode;
}) {
  const service = useService();
  const [noPicture, setNoPicture] = useState(false);
  // An alert's snapshot shows only where the picture is a still (or the service is down). In a live view the
  // picture is the camera now, and the service draws the people it sees on it, so an old box would be wrong.
  const liveReal = !!cam.source && !still && !frozen && service.online;
  const snapshot = cam.source && !liveReal ? alert?.snapshot : undefined;
  const aspect = cam.source?.width && cam.source?.height ? cam.source.width / cam.source.height : undefined;
  const subjType = alert ? (alert.title.toLowerCase().includes('smoke') ? 'smoke' : alert.title.toLowerCase().includes('truck') || alert.title.toLowerCase().includes('vehicle') ? 'vehicle' : 'person') : undefined;
  return (
    <div className={`camview${className ? ` ${className}` : ''}`} style={aspect ? ({ '--ar': aspect } as CSSProperties) : undefined}>
      {cam.source ? (
        <RealPicture cam={cam} still={still} frozen={frozen} snapshot={snapshot} serviceUp={service.online} onMissing={setNoPicture} />
      ) : (
        <Scene
          kind={cam.scene}
          variant={cam.variant}
          still={still}
          offline={cam.status === 'offline'}
          title={`${cam.id} ${cam.name}`}
          subject={alert && subjType ? { box: alert.box, type: subjType, noPpe: /helmet|vest|life jacket|ppe/i.test(alert.title + alert.detail) } : undefined}
        />
      )}
      {((zones && zones.length > 0) || alert) && <ZoneOverlay zones={zones ?? []} highlight={highlightZones} box={liveReal || (cam.source && noPicture) ? undefined : alert} aspect={aspect} />}
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
