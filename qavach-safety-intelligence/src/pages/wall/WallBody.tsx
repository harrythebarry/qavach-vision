import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { Icon } from '../../components/Icon';
import { CameraView, PRIORITY_NAME } from '../../components/ui';
import type { Alert, Camera, PinnedLayout, Wall } from '../../data/types';
import { ago, useNow } from '../../lib/time';
import { isOpen, useActivity, useAlerts, useCameras, usePolicies } from '../../state/store';
import './wall.css';

// Draws one wall: pinned cameras on the left (the high-operational areas),
// a rolling section on the right that steps through the rest, alert takeover
// and the auto-pinned busiest camera. Used by the console page and by the
// full-screen second-screen view.

export const LAYOUT_SLOTS: Record<PinnedLayout, number> = { '1': 1, '2x2': 4, '1+5': 6, '2x3': 6, '3x3': 9 };

const PRIO_RANK = { P1: 0, P2: 1, P3: 2, P4: 3 };

export interface WallModel {
  pinned: { cam: Camera | null; reason: 'pinned' | 'alert' | 'busy'; slot: number }[];
  rolling: Camera[];
  pool: Camera[];
  page: number;
  pages: number;
  alertsByCam: Map<string, Alert>;
  scopeAlerts: Alert[];
}

/** Works out what each tile shows right now. */
export function useWallModel(wall: Wall, paused: boolean): WallModel & { secsLeft: number; paused: boolean } {
  const cams = useCameras();
  const alerts = useAlerts();
  const policies = usePolicies();
  const activity = useActivity();
  const now = useNow(1000);
  const byId = useMemo(() => new Map(cams.map((c) => [c.id, c])), [cams]);

  const scope = useMemo(() => new Set([...wall.pinned.filter(Boolean), ...wall.rotation] as string[]), [wall]);
  const scopeAlerts = useMemo(
    () => alerts.filter((a) => isOpen(a) && scope.has(a.cameraId)).sort((a, b) => PRIO_RANK[a.priority] - PRIO_RANK[b.priority] || b.at - a.at),
    [alerts, scope],
  );
  const alertsByCam = useMemo(() => {
    const m = new Map<string, Alert>();
    for (const a of scopeAlerts) if (!m.has(a.cameraId)) m.set(a.cameraId, a);
    return m;
  }, [scopeAlerts]);

  const takeover = useMemo(() => {
    if (!wall.alertTakeover) return [] as string[];
    const allowed = new Set(policies.filter((p) => p.wallTakeover).map((p) => p.priority));
    return [...new Set(scopeAlerts.filter((a) => allowed.has(a.priority)).map((a) => a.cameraId))];
  }, [wall.alertTakeover, scopeAlerts, policies]);

  // Busiest camera, re-checked every 30 s so the auto slot doesn't flicker.
  const busyBucket = Math.floor(now / 30000);
  const busiest = useMemo(() => {
    if (!wall.autoPinBusy) return undefined;
    const pinnedSet = new Set(wall.pinned);
    return wall.rotation
      .filter((id) => !pinnedSet.has(id) && byId.get(id)?.status !== 'offline')
      .sort((a, b) => (activity[b] ?? 0) - (activity[a] ?? 0))[0];
  }, [wall, busyBucket, byId]);

  const slots = wall.pinnedShare === 0 ? 0 : LAYOUT_SLOTS[wall.pinnedLayout];
  const pinned: WallModel['pinned'] = [];
  const used = new Set<string>();
  for (const id of takeover) {
    if (pinned.length >= slots) break;
    pinned.push({ cam: byId.get(id) ?? null, reason: 'alert', slot: pinned.length });
    used.add(id);
  }
  const base = wall.pinned.slice(0, slots);
  const reserveBusy = !!busiest && slots > 1;
  for (let i = 0; i < base.length && pinned.length < slots - (reserveBusy ? 1 : 0); i++) {
    const id = base[i];
    if (id && used.has(id)) continue;
    pinned.push({ cam: id ? (byId.get(id) ?? null) : null, reason: 'pinned', slot: i });
    if (id) used.add(id);
  }
  while (pinned.length < slots - (reserveBusy ? 1 : 0)) pinned.push({ cam: null, reason: 'pinned', slot: pinned.length });
  if (reserveBusy && busiest && !used.has(busiest)) {
    pinned.push({ cam: byId.get(busiest) ?? null, reason: 'busy', slot: slots - 1 });
    used.add(busiest);
  } else if (reserveBusy) pinned.push({ cam: null, reason: 'pinned', slot: slots - 1 });

  // Cameras pushed off the pinned area by an alert roll first.
  const displaced = base.filter((id): id is string => !!id && !used.has(id));
  const pool = [...displaced, ...wall.rotation.filter((id) => !used.has(id) && !displaced.includes(id))]
    .map((id) => byId.get(id))
    .filter((c): c is Camera => !!c);

  // Rolling section: alert cameras that did not fit stay at the front.
  const n = wall.rollingTiles;
  const pages = Math.max(1, Math.ceil(pool.length / n));
  const [page, setPage] = useState(0);
  const [tickAt, setTickAt] = useState(() => Date.now());
  useEffect(() => {
    if (paused) return;
    const t = window.setInterval(() => {
      setPage((p) => p + 1);
      setTickAt(Date.now());
    }, wall.rotateSec * 1000);
    return () => window.clearInterval(t);
  }, [wall.rotateSec, paused, wall.id]);
  const p = page % pages;
  const stickyAlerts = pool.filter((c) => alertsByCam.has(c.id));
  const rest = pool.filter((c) => !alertsByCam.has(c.id));
  const restPages = Math.max(1, Math.ceil(rest.length / Math.max(1, n - stickyAlerts.length)));
  const per = Math.max(0, n - stickyAlerts.length);
  const start = (page % restPages) * per;
  const rolling = [...stickyAlerts.slice(0, n), ...Array.from({ length: Math.min(per, rest.length) }, (_, i) => rest[(start + i) % rest.length])];
  const secsLeft = paused ? wall.rotateSec : Math.max(0, wall.rotateSec - Math.floor((now - tickAt) / 1000));

  return { pinned, rolling, pool, page: p, pages, alertsByCam, scopeAlerts, secsLeft, paused };
}

function gridStyle(layout: PinnedLayout) {
  switch (layout) {
    case '1':
      return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' };
    case '2x2':
      return { gridTemplateColumns: 'repeat(2, 1fr)', gridTemplateRows: 'repeat(2, 1fr)' };
    case '1+5':
      return { gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(3, 1fr)' };
    case '2x3':
      return { gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(2, 1fr)' };
    case '3x3':
      return { gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(3, 1fr)' };
  }
}

function rollingGrid(n: number, solo: boolean) {
  if (solo) {
    const cols = n >= 16 ? 4 : n >= 9 ? 3 : n >= 4 ? 2 : n;
    return { gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${Math.ceil(n / cols)}, 1fr)` };
  }
  const cols = n >= 6 ? 2 : 1;
  return { gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${Math.ceil(n / cols)}, 1fr)` };
}

export function WallBody({
  wall,
  model,
  editing,
  onAck,
  onOpen,
  onPinToggle,
  onDropCam,
  onClearSlot,
  height,
}: {
  wall: Wall;
  model: WallModel & { secsLeft: number; paused: boolean };
  editing?: boolean;
  onAck?: (a: Alert) => void;
  onOpen?: (cam: Camera) => void;
  onPinToggle?: (cam: Camera, pinned: boolean) => void;
  onDropCam?: (slot: number, camId: string) => void;
  onClearSlot?: (slot: number) => void;
  height: string;
}) {
  const now = useNow(1000);
  const activity = useActivity();
  const solo = wall.pinnedShare === 0;
  const allPinned = wall.pinnedShare === 100;
  const animate = model.pinned.length + (allPinned ? 0 : model.rolling.length) <= 10;
  const [over, setOver] = useState<number | null>(null);

  const tile = (cam: Camera | null, key: string, opts: { reason?: 'pinned' | 'alert' | 'busy' | 'rolling'; slot?: number; big?: boolean }) => {
    const alert = cam ? model.alertsByCam.get(cam.id) : undefined;
    const drop =
      editing && opts.slot !== undefined
        ? {
            onDragOver: (e: DragEvent) => {
              e.preventDefault();
              setOver(opts.slot!);
            },
            onDragLeave: () => setOver(null),
            onDrop: (e: DragEvent) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData('text/camera');
              if (id) onDropCam?.(opts.slot!, id);
            },
          }
        : {};
    const cls = ['wtile', opts.big ? 'wtile--big' : '', alert ? `wtile--alert wtile--${alert.priority}` : '', editing && over === opts.slot ? 'wtile--over' : ''].filter(Boolean).join(' ');
    if (!cam)
      return (
        <div key={key} className={`${cls} wtile--empty`} {...drop}>
          <Icon name="plus" size={22} />
          <span>{editing ? 'Drag a camera here' : 'Empty slot'}</span>
        </div>
      );
    return (
      <div key={key} className={cls} {...drop}>
        <CameraView cam={cam} still={!animate} alert={alert} now={now} className="wtile__view" />
        <div className="wtile__top">
          {opts.reason === 'alert' && (
            <span className="wtile__tag wtile__tag--alert">
              <Icon name="warning" size={13} stroke={2.2} />
              Alert takeover
            </span>
          )}
          {opts.reason === 'pinned' && (
            <span className="wtile__tag" title="Pinned: high-operational area">
              <Icon name="pin" size={13} />
              Pinned
            </span>
          )}
          {opts.reason === 'busy' && (
            <span className="wtile__tag wtile__tag--busy" title="Auto-pinned: the busiest camera on this wall right now">
              <Icon name="activity" size={13} />
              Busiest now
            </span>
          )}
          <span className="spacer" />
          {cam.status !== 'offline' && (
            <span className="wtile__tag" title="People and vehicles in view">
              <Icon name="user" size={13} />
              {activity[cam.id] ?? 0}
            </span>
          )}
          {!editing && (
            <span className="wtile__actions">
              {onPinToggle && opts.reason !== 'alert' && (
                <button type="button" title={opts.reason === 'pinned' ? 'Unpin from this wall' : 'Pin to this wall'} aria-label={opts.reason === 'pinned' ? `Unpin ${cam.id}` : `Pin ${cam.id}`} onClick={() => onPinToggle(cam, opts.reason === 'pinned')}>
                  <Icon name={opts.reason === 'pinned' ? 'unpin' : 'pin'} size={15} />
                </button>
              )}
              {onOpen && (
                <button type="button" title="Open camera" aria-label={`Open ${cam.id}`} onClick={() => onOpen(cam)}>
                  <Icon name="expand" size={15} />
                </button>
              )}
            </span>
          )}
          {editing && opts.slot !== undefined && opts.reason === 'pinned' && (
            <span className="wtile__actions wtile__actions--on">
              <button type="button" aria-label={`Remove ${cam.id} from slot`} title="Remove from this slot" onClick={() => onClearSlot?.(opts.slot!)}>
                <Icon name="close" size={15} />
              </button>
            </span>
          )}
        </div>
        {alert && (
          <div className="wtile__alert">
            <span className={`prio prio--${alert.priority}`}>
              {alert.priority} {PRIORITY_NAME[alert.priority]}
            </span>
            <span className="ellipsis wtile__alert-text">
              <strong>{alert.title}</strong>
              <span>
                {alert.state === 'escalated' ? 'Escalated · ' : ''}
                {ago(alert.at, now)}
              </span>
            </span>
            {onAck && (
              <button type="button" className="btn btn--sm" onClick={() => onAck(alert)}>
                Acknowledge
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const rollingSlots = Math.max(model.rolling.length, Math.min(wall.rollingTiles, model.pool.length));

  return (
    <div className={`wall${editing ? ' wall--editing' : ''}`} style={{ height }}>
      {!solo && (
        <section className="wall__pinned" style={{ flexBasis: allPinned ? '100%' : `${wall.pinnedShare}%`, ...gridStyle(wall.pinnedLayout) }} aria-label="Pinned cameras">
          {model.pinned.map((p, i) => tile(p.cam, `p${i}`, { reason: p.reason, slot: p.reason === 'pinned' ? p.slot : undefined, big: wall.pinnedLayout === '1+5' && i === 0 }))}
        </section>
      )}
      {!allPinned && (
        <section className="wall__rolling" style={{ flexBasis: solo ? '100%' : `${100 - wall.pinnedShare}%` }} aria-label="Rolling cameras">
          <div className="wall__rolling-grid" style={rollingGrid(wall.rollingTiles, solo)}>
            {Array.from({ length: Math.min(wall.rollingTiles, Math.max(rollingSlots, 1)) }).map((_, i) => {
              const cam = model.rolling[i];
              return cam ? tile(cam, `r${cam.id}`, { reason: model.alertsByCam.has(cam.id) ? 'alert' : 'rolling' }) : <div key={`re${i}`} className="wtile wtile--empty" />;
            })}
          </div>
          <div className="wall__progress" aria-hidden="true">
            <span key={`${model.page}-${wall.rotateSec}`} style={{ animationDuration: `${wall.rotateSec}s`, animationPlayState: model.paused ? 'paused' : 'running' }} />
          </div>
        </section>
      )}
    </div>
  );
}
