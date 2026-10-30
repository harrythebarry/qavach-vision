import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { SCENARIO_START } from '../data/alarms';
import type { Alarm, Camera, Convoy } from '../data/types';
import { CameraFrame, Meter, NoAccess, PageHeader, Segmented, healthTone, usePriorityName } from '../components/ui';
import { Icon } from '../components/Icon';
import { useApp, useInScope } from '../state/AppState';
import { useFleet } from '../state/fleetStore';
import { usePersistentState } from '../lib/persist';
import { pick, useTr } from '../lib/i18n';
import { useExporter } from '../lib/exporting';
import { fmtCountdown, fmtTime, fmtTimeSec, scenarioNow, useNow } from '../lib/time';
import { detectionIn, detectionLabel, healthNote, healthShort, isMirrored, positionText, toTarget } from './screenText';
import './VideoWall.css';

// VW-01 to VW-05: live tiles per convoy, inside the convoy's bandwidth budget.
// The layout per convoy, the focus tile and the overlay toggle are saved and
// shared with the wall on a second screen (/wall), which reuses the pieces below.

export type Layout = 'focus8' | 'g3' | 'g4';
export type Mode = 'hd' | 'sd' | 'snap' | 'nolink' | 'offline';

export const LAYOUTS: { value: Layout; label: [string, string]; slots: number }[] = [
  { value: 'focus8', label: ['Focus + 8', 'Foco + 8'], slots: 9 },
  { value: 'g3', label: ['3 × 3', '3 × 3'], slots: 9 },
  { value: 'g4', label: ['4 × 4', '4 × 4'], slots: 16 },
];

/** Bitrates used to plan the wall (VW-02). */
const HD_MBPS = 0.9;
const SD_MBPS = 0.15;
/** Share of the budget the planner fills, leaving room for bitrate peaks. */
const FILL = 0.9;
/** Alarms raised after the sample snapshot count as new for pinning (VW-03). */
const START_MS = new Date(SCENARIO_START).getTime();

export const isUrgent = (a: Alarm) => (a.priority === 'P1' || a.priority === 'P2') && a.state !== 'resolved' && a.state !== 'closed';
const isOpen = (a: Alarm) => a.state !== 'closed';

export interface Focus {
  cameraId: string;
  /** Alarm that pinned the camera to the focus tile (VW-03). */
  pinnedBy?: string;
}

export interface WallPlan {
  modes: Map<string, Mode>;
  used: number;
  hd: number;
  sd: number;
  snap: number;
  offline: number;
}

/** VW-02: focus in HD, then SD while it fits, alarm cameras first; the rest on snapshot. */
function planWall(onWall: Camera[], convoy: Convoy, focusId: string | undefined, hasAlarm: (camId: string) => boolean): WallPlan {
  const modes = new Map<string, Mode>();
  let offline = 0;
  onWall.forEach((c) => {
    if (c.health === 'offline') {
      modes.set(c.id, 'offline');
      offline += 1;
    }
  });
  const streamable = onWall.filter((c) => !modes.has(c.id));
  if (convoy.link === 'none') {
    streamable.forEach((c) => modes.set(c.id, 'nolink'));
    return { modes, used: 0, hd: 0, sd: 0, snap: streamable.length, offline };
  }
  const cap = convoy.liveBudgetMbps * FILL;
  let used = 0;
  let hd = 0;
  if (focusId && streamable.some((c) => c.id === focusId) && HD_MBPS <= cap) {
    modes.set(focusId, 'hd');
    used += HD_MBPS;
    hd = 1;
  }
  let sd = 0;
  let snap = 0;
  streamable
    .filter((c) => !modes.has(c.id))
    .map((c, i) => ({ c, i, rank: c.id === focusId ? -1 : hasAlarm(c.id) ? 0 : 1 }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .forEach(({ c }) => {
      if (used + SD_MBPS <= cap + 1e-9) {
        modes.set(c.id, 'sd');
        used += SD_MBPS;
        sd += 1;
      } else {
        modes.set(c.id, 'snap');
        snap += 1;
      }
    });
  return { modes, used, hd, sd, snap, offline };
}

/** The convoy a wall shows: the one asked for in the URL when in scope, else the header scope, else GF Tuyutí. */
export function useWallConvoy(asked?: string | null): { convoy: Convoy | undefined; choices: Convoy[] } {
  const { state } = useApp();
  const fleet = useFleet();
  const inScope = useInScope();
  const choices = fleet.convoys.filter((c) => inScope(c.id));
  const convoy =
    (asked && inScope(asked) ? fleet.convoyById(asked) : undefined) ??
    (state.scope !== 'all' ? fleet.convoyById(state.scope) : undefined) ??
    fleet.convoyById('tuy') ??
    choices[0];
  return { convoy, choices };
}

/**
 * Everything one wall needs, shared by the console page and the second screen:
 * saved layout, focus and overlays; the pin-on-new-alarm rule; the budget plan;
 * the audit lines for live views; the watermarked snapshot export.
 */
export function useWall(convoy: Convoy, where: 'console' | 'second screen') {
  const { state, can, log, toast } = useApp();
  const fleet = useFleet();
  const tr = useTr();
  const lang = state.lang;
  const inScope = useInScope();
  const ex = useExporter();

  const [layouts, setLayouts] = usePersistentState<Record<string, Layout>>('wall.layouts', {});
  const [focusMap, setFocusMap] = usePersistentState<Record<string, Focus>>('wall.focus', {});
  const [overlays, setOverlays] = usePersistentState<boolean>('wall.overlays', true);
  const [pinned, setPinned] = usePersistentState<string[]>('wall.pinned', []);

  const layout: Layout = layouts[convoy.id] ?? 'focus8';
  const setLayout = (v: Layout) => setLayouts((m) => ({ ...m, [convoy.id]: v }));
  const convoyCams = useMemo(() => fleet.camerasOf(convoy.id), [fleet, convoy.id]);
  const convoyVessels = useMemo(() => fleet.vesselsOf(convoy.id), [fleet, convoy.id]);

  const urgent = useMemo(
    () => state.alarms.filter((a) => isUrgent(a) && a.cameraId).sort((a, b) => b.raisedAt.localeCompare(a.raisedAt)),
    [state.alarms],
  );

  // VW-03: a new P1/P2 alarm pins its camera to the focus tile of its convoy, once.
  // Pinned alarm ids are saved, so an alarm that arrived while the wall was closed
  // pins when it opens, and the second screen does not pin it twice.
  useEffect(() => {
    const fresh = urgent.filter((a) => !pinned.includes(a.id) && new Date(a.raisedAt).getTime() > START_MS && fleet.cameraById(a.cameraId));
    if (!fresh.length) return;
    setPinned((p) => Array.from(new Set([...p, ...fresh.map((a) => a.id)])).sort());
    const winners = new Map<string, Alarm>();
    [...fresh]
      .sort((a, b) => a.priority.localeCompare(b.priority) || b.raisedAt.localeCompare(a.raisedAt))
      .forEach((a) => {
        if (!winners.has(a.convoyId)) winners.set(a.convoyId, a);
      });
    setFocusMap((m) => {
      const next = { ...m };
      winners.forEach((a, cid) => {
        next[cid] = { cameraId: a.cameraId!, pinnedBy: a.id };
      });
      return next;
    });
    winners.forEach((a) => {
      if (!inScope(a.convoyId)) return;
      const label = fleet.cameraLabel(a.cameraId);
      toast(tr(`${a.priority} alarm ${a.id} pinned to the focus tile: ${label}.`, `Alarma ${a.priority} ${a.id} fijada en el foco: ${label}.`));
    });
  }, [urgent, pinned, setPinned, setFocusMap, fleet, inScope, toast, tr]);

  const saved = focusMap[convoy.id];
  const focus: Focus = (() => {
    if (saved && convoyCams.some((c) => c.id === saved.cameraId)) return saved;
    const a = urgent.find((x) => x.convoyId === convoy.id && convoyCams.some((c) => c.id === x.cameraId));
    if (a?.cameraId) return { cameraId: a.cameraId, pinnedBy: a.id };
    return { cameraId: convoyCams[0]?.id ?? '' };
  })();
  const focusCam = convoyCams.find((c) => c.id === focus.cameraId) ?? convoyCams[0];
  const focusOn = (cam: Camera) => setFocusMap((m) => ({ ...m, [cam.convoyId]: { cameraId: cam.id } }));

  // Tiles on the wall for the current layout.
  const tiles: (Camera | null)[] = useMemo(() => {
    const slots = LAYOUTS.find((l) => l.value === layout)!.slots;
    let list: Camera[] = [];
    if (focusCam) {
      if (layout === 'focus8') {
        list = [focusCam, ...convoyCams.filter((c) => c.id !== focusCam.id)].slice(0, slots);
      } else {
        list = convoyCams.slice(0, slots);
        if (!list.some((c) => c.id === focusCam.id)) list[list.length - 1] = focusCam;
      }
    }
    const padded: (Camera | null)[] = [...list];
    while (padded.length < slots) padded.push(null);
    return padded;
  }, [layout, focusCam, convoyCams]);

  const openAlarms = useMemo(
    () =>
      state.alarms
        .filter((a) => isOpen(a) && a.convoyId === convoy.id)
        .sort((a, b) => a.priority.localeCompare(b.priority) || b.raisedAt.localeCompare(a.raisedAt)),
    [state.alarms, convoy.id],
  );
  const alarmOn = (camId: string) => openAlarms.find((a) => a.cameraId === camId);

  const plan = useMemo(
    () =>
      planWall(
        tiles.filter((c): c is Camera => !!c),
        convoy,
        focusCam?.id,
        (id) => openAlarms.some((a) => a.cameraId === id),
      ),
    [tiles, convoy, focusCam?.id, openAlarms],
  );

  const pinnedAlarm = focus.pinnedBy ? state.alarms.find((a) => a.id === focus.pinnedBy) : undefined;
  const pinActive = !!pinnedAlarm && isUrgent(pinnedAlarm) && pinnedAlarm.cameraId === focusCam?.id;
  const focusAlarm = urgent.find((a) => a.cameraId === focusCam?.id) ?? (pinActive ? pinnedAlarm : undefined);

  // VW-05: every live view is written to the audit log: the focus tile when it
  // changes, and the set of other live tiles when it changes.
  const allowed = can('view_live');
  const focusMode = focusCam ? plan.modes.get(focusCam.id) : undefined;
  const liveOthers = tiles
    .filter((c): c is Camera => !!c && c.id !== focusCam?.id && (plan.modes.get(c.id) === 'hd' || plan.modes.get(c.id) === 'sd'))
    .map((c) => c.id)
    .sort()
    .join(', ');
  const lastFocusLog = useRef('');
  const lastWallLog = useRef('');
  const whereText = where === 'console' ? 'Video wall' : 'Video wall, second screen';
  useEffect(() => {
    if (!allowed || !focusCam || !focusMode) return;
    const key = `${focusCam.id}|${focusMode}`;
    if (lastFocusLog.current === key) return;
    lastFocusLog.current = key;
    const live = focusMode === 'hd' || focusMode === 'sd';
    if (focusMode === 'offline') return;
    const modeText = { hd: 'HD', sd: 'SD', snap: 'snapshot, held to stay in budget', nolink: 'last snapshot, no link to shore', offline: 'no image' }[focusMode];
    log(live ? 'Viewed live' : 'Viewed snapshot', focusCam.id, `${whereText} · focus tile · ${modeText}`, convoy.id);
  }, [allowed, focusCam, focusMode, log, convoy.id, whereText]);
  useEffect(() => {
    if (!allowed) return;
    const key = `${convoy.id}|${liveOthers}`;
    if (lastWallLog.current === key) return;
    lastWallLog.current = key;
    if (!liveOthers) return;
    log('Viewed live', `${convoy.name} convoy`, `${whereText} · ${liveOthers.split(', ').length} tiles in SD: ${liveOthers}`, convoy.id);
  }, [allowed, convoy.id, convoy.name, liveOthers, log, whereText]);

  const canExport = can('export_clips');
  const saveSnapshot = async (cam: Camera) => {
    const alarm = alarmOn(cam.id);
    const det = alarm?.detection && alarm.detection.box.w < 90 ? alarm.detection : undefined;
    const stamp = fmtTimeSec(scenarioNow()).replace(/:/g, '');
    await ex.image(cam.image, `${cam.id}-snapshot-${stamp}.svg`, {
      action: 'Exported snapshot',
      target: alarm?.id ?? cam.id,
      details: `${fleet.cameraLabel(cam.id)} · ${whereText}`,
      convoyId: cam.convoyId,
      note: 'Faces blurred',
      box: overlays && det ? { ...det.box, label: `${detectionLabel(det.label, lang)} ${det.confidence.toFixed(2)}` } : undefined,
    });
  };

  return {
    convoy,
    convoyCams,
    convoyVessels,
    layout,
    setLayout,
    overlays,
    setOverlays,
    focus,
    focusCam,
    focusOn,
    tiles,
    plan,
    openAlarms,
    alarmOn,
    urgent,
    focusAlarm,
    pinActive,
    allowed,
    canExport,
    saveSnapshot,
  };
}

export type WallModel = ReturnType<typeof useWall>;

/** "Focus in HD, 3 tiles in SD at 150 kbps, 5 on snapshot" */
function useBudgetSummary(wall: WallModel) {
  const tr = useTr();
  const { convoy, plan } = wall;
  if (convoy.link === 'none') {
    return tr(`No link since ${fmtTime(convoy.lastSeen)} · showing the last snapshots`, `Sin enlace desde las ${fmtTime(convoy.lastSeen)} · se muestran las últimas fotos`);
  }
  return [
    plan.hd ? tr('Focus in HD', 'Foco en HD') : tr('Focus in SD', 'Foco en SD'),
    plan.sd ? tr(`${plan.sd} tile${plan.sd === 1 ? '' : 's'} in SD at 150 kbps`, `${plan.sd} mosaico${plan.sd === 1 ? '' : 's'} en SD a 150 kbps`) : '',
    plan.snap ? tr(`${plan.snap} on snapshot`, `${plan.snap} en foto fija`) : '',
    plan.offline ? tr(`${plan.offline} offline`, `${plan.offline} sin imagen`) : '',
  ]
    .filter(Boolean)
    .join(', ');
}

/** VW-02: budget use for the convoy's live viewing. */
export function BudgetMeter({ wall, dark = false }: { wall: WallModel; dark?: boolean }) {
  const tr = useTr();
  const { convoy, plan } = wall;
  const noLink = convoy.link === 'none';
  const share = convoy.linkMbps ? Math.round((convoy.liveBudgetMbps / convoy.linkMbps) * 100) : 0;
  const pct = convoy.liveBudgetMbps ? (plan.used / convoy.liveBudgetMbps) * 100 : 0;
  const summary = useBudgetSummary(wall);
  return (
    <div className={`vw-budget${dark ? ' vw-budget--dark' : ''}`}>
      <div className="vw-budget__line">
        <span>
          <strong>{tr('Live budget', 'Presupuesto en vivo')}</strong> ·{' '}
          {noLink
            ? tr('no link to shore', 'sin enlace a tierra')
            : tr(`${share}% of a ${convoy.linkMbps} Mbps ${convoy.linkLabel} link`, `${share}% de un enlace ${convoy.linkLabel} de ${convoy.linkMbps} Mbps`)}
        </span>
        <span className="mono">
          {plan.used.toFixed(1)} / {convoy.liveBudgetMbps.toFixed(1)} Mbps
        </span>
      </div>
      <Meter pct={pct} label={tr('Live budget used', 'Presupuesto en vivo usado')} />
      <div className="vw-budget__sub">{summary}</div>
    </div>
  );
}

/** The grid of tiles, with the focus tile, overlays, stream state and alarm banner (VW-01 to VW-04). */
export function WallGrid({ wall, now, fill = false, alarmLinkTarget }: { wall: WallModel; now: number; fill?: boolean; alarmLinkTarget?: string }) {
  const { state } = useApp();
  const lang = state.lang;
  const tr = useTr();
  const fleet = useFleet();
  const prio = usePriorityName();
  const [saving, setSaving] = useState(false);
  const { convoy, tiles, plan, focusCam, layout, overlays, alarmOn, focusAlarm, pinActive, focus, focusOn, convoyVessels } = wall;

  if (!focusCam) {
    return (
      <div className="vw-wall-wrap">
        <div className="vw-wall vw-wall--none">
          <span>{tr('No cameras on this convoy yet', 'Este convoy aún no tiene cámaras')}</span>
          <span>{tr('Add them on Cameras and zones; they show here at once.', 'Agréguelas en Cámaras y zonas; aparecen aquí de inmediato.')}</span>
        </div>
      </div>
    );
  }

  const snapshot = async (cam: Camera) => {
    setSaving(true);
    try {
      await wall.saveSnapshot(cam);
    } finally {
      setSaving(false);
    }
  };

  const streamText = (m: Mode, long: boolean) =>
    m === 'hd'
      ? long
        ? tr('LIVE HD', 'EN VIVO HD')
        : 'HD'
      : m === 'sd'
        ? long
          ? tr('LIVE SD', 'EN VIVO SD')
          : 'SD'
        : m === 'nolink'
          ? tr('NO LINK', 'SIN ENLACE')
          : m === 'offline'
            ? tr('OFFLINE', 'SIN IMAGEN')
            : tr('SNAP', 'FOTO');

  return (
    <div className="vw-wall-wrap">
      <div className={`vw-wall vw-wall--${layout}${fill ? ' vw-wall--fill' : ''}`}>
        {tiles.map((cam, i) => {
          if (!cam) {
            return (
              <div key={`empty-${i}`} className="vw-tile vw-tile--empty">
                <span>{tr('Empty slot', 'Espacio libre')}</span>
                <span>
                  {fill
                    ? tr('This convoy has no more cameras', 'Este convoy no tiene más cámaras')
                    : tr('Every camera on this convoy is on the wall', 'Todas las cámaras de este convoy están en el videowall')}
                </span>
              </div>
            );
          }
          const mode = plan.modes.get(cam.id) ?? 'snap';
          const isFocus = cam.id === focusCam.id;
          const big = isFocus && layout === 'focus8';
          const alarm = alarmOn(cam.id);
          const banner = isFocus ? focusAlarm : undefined;
          const degraded = cam.health !== 'healthy';
          const vessel = fleet.vesselById(cam.vesselId);
          const live = mode === 'hd' || mode === 'sd';
          const info = vessel?.kind === 'tug' && cam.name === 'Wheelhouse' ? { label: detectionLabel('Watchkeeper present', lang), box: { x: 81.5, y: 43.5, w: 12, h: 38 } } : undefined;
          const stamp = live
            ? fmtTimeSec(now - (mode === 'hd' ? 1500 : 2500 + (i % 3) * 400))
            : mode === 'nolink'
              ? fmtTime(convoy.lastSeen)
              : fmtTime(Math.floor((now - 20_000 - i * 9_000) / 60_000) * 60_000);
          const classes = [
            'vw-tile',
            big ? 'vw-tile--focus' : '',
            isFocus && !big ? 'vw-tile--focus-ring' : '',
            !live ? 'vw-tile--snap' : '',
            isMirrored(cam, convoyVessels) ? 'vw-tile--mirror' : '',
            banner ? 'vw-tile--alarm' : degraded ? 'vw-tile--degraded' : '',
          ]
            .filter(Boolean)
            .join(' ');
          const altBase = `${vessel?.name} · ${cam.name}`;
          const det = alarm?.detection && alarm.detection.box.w < 90 ? detectionIn(alarm.detection, lang) : undefined;
          return (
            <figure key={cam.id} className={classes}>
              {mode === 'offline' ? (
                <div className="vw-tile__offline">
                  <Icon name="wifiOff" size={22} />
                  <span>{tr('No image from this camera', 'Sin imagen de esta cámara')}</span>
                </div>
              ) : (
                <CameraFrame
                  src={cam.image}
                  alt={live ? tr(`Live view of ${altBase}`, `Vista en vivo de ${altBase}`) : tr(`Latest snapshot of ${altBase}`, `Última foto de ${altBase}`)}
                  detection={det}
                  overlays={overlays}
                  degraded={degraded}
                  rounded={6}
                >
                  {overlays && det?.zoneName && big && (
                    <span className="vw-zone-label" style={{ left: '61%', top: '26%' }}>
                      {tr(`${det.zoneName.replace(', port', '')} zone`, `Zona ${det.zoneName.replace(', babor', '').toLowerCase()}`)}
                    </span>
                  )}
                  {overlays && info && (
                    <>
                      <span className="vw-info-box" style={{ left: `${info.box.x}%`, top: `${info.box.y}%`, width: `${info.box.w}%`, height: `${info.box.h}%` }} />
                      <span className="vw-info-label" style={{ top: `calc(${info.box.y}% - 22px)` }}>
                        {info.label}
                      </span>
                    </>
                  )}
                </CameraFrame>
              )}

              {!isFocus && (
                <button type="button" className="vw-tile__hit" aria-label={tr(`Put ${altBase} in focus`, `Poner ${altBase} en el foco`)} onClick={() => focusOn(cam)} />
              )}

              {/* Top-left: title on the focus tile, otherwise a badge when something needs attention. */}
              {big ? (
                <span className="vw-tag vw-tag--title" style={{ left: 10, top: 10 }}>
                  {vessel?.name} · {cam.name}
                  {pinActive && focus.cameraId === cam.id && <span className="vw-tag__muted">{tr('pinned by alarm', 'fijada por alarma')}</span>}
                </span>
              ) : degraded ? (
                <span className="vw-tag vw-tag--warn" style={{ left: 8, top: 8 }}>
                  {alarm ? `${alarm.priority} · ` : ''}
                  {healthNote(cam, lang)}
                </span>
              ) : alarm && !banner ? (
                <span className={`vw-tag ${alarm.priority <= 'P2' ? 'vw-tag--bad' : 'vw-tag--warn'}`} style={{ left: 8, top: 8 }}>
                  {alarm.priority} · {pick(lang, alarm.title, alarm.titleEs)}
                </span>
              ) : mode === 'snap' ? (
                <span className="vw-tag" style={{ left: 8, top: 8 }}>
                  {tr('Held at snapshot to stay in budget', 'En foto fija para no pasar el presupuesto')}
                </span>
              ) : mode === 'nolink' && i === 0 ? (
                <span className="vw-tag" style={{ left: 8, top: 8 }}>
                  {tr('No link · last snapshot', 'Sin enlace · última foto')}
                </span>
              ) : null}

              {/* Stream state; on small tiles it shares one bottom row with the caption so the two never overlap */}
              {big ? (
                <span className="vw-tag mono vw-tag--stream-lg" style={{ right: 10, top: 10 }}>
                  <span className={`vw-live-dot${live ? '' : ' vw-live-dot--off'}`} aria-hidden="true" />
                  {streamText(mode, true)} · {stamp}
                </span>
              ) : (
                <div className="vw-tilefoot">
                  <figcaption className="vw-tag vw-tag--caption vw-tilefoot__name">
                    {vessel?.short} · {cam.name}
                  </figcaption>
                  <span className="vw-tag mono vw-tilefoot__stream" title={stamp}>
                    <span className={`vw-live-dot${live ? '' : ' vw-live-dot--off'}`} aria-hidden="true" />
                    {streamText(mode, false)}
                  </span>
                </div>
              )}
              {big && !banner && (
                <figcaption className="sr-only">
                  {vessel?.name} · {cam.name}
                </figcaption>
              )}

              {isFocus && wall.canExport && mode !== 'offline' && (
                <button
                  type="button"
                  className={`vw-tile__tool${big ? '' : ' vw-tile__tool--sm'}`}
                  disabled={saving}
                  aria-label={tr(`Save a watermarked snapshot of ${altBase}`, `Guardar una foto con marca de agua de ${altBase}`)}
                  title={saving ? tr('Saving…', 'Guardando…') : tr('Save a watermarked snapshot', 'Guardar una foto con marca de agua')}
                  onClick={() => void snapshot(cam)}
                >
                  <Icon name="download" size={18} />
                </button>
              )}

              {banner && (
                <div className={`vw-banner${big ? '' : ' vw-banner--compact'}`}>
                  <span className={`badge badge--${banner.priority.toLowerCase()}`}>{prio(banner.priority)}</span>
                  <span className="vw-banner__text">
                    <strong>{pick(lang, banner.title, banner.titleEs)}</strong>
                    <span>
                      {fmtTimeSec(banner.raisedAt)} ·{' '}
                      {banner.state === 'ack_shore'
                        ? banner.owner
                          ? tr(`acknowledged ashore by ${banner.owner}`, `confirmada en tierra por ${banner.owner}`)
                          : tr('acknowledged ashore', 'confirmada en tierra')
                        : banner.state === 'ack_board'
                          ? tr('acknowledged on board, not yet ashore', 'confirmada a bordo, aún no en tierra')
                          : tr('not acknowledged', 'sin confirmar')}
                    </span>
                  </span>
                  {alarmLinkTarget ? (
                    <a href={`/alarms/${banner.id}`} target={alarmLinkTarget} className="vw-banner__btn">
                      {tr('Open alarm', 'Abrir alarma')}
                    </a>
                  ) : (
                    <Link to={`/alarms/${banner.id}`} className="vw-banner__btn">
                      {tr('Open alarm', 'Abrir alarma')}
                    </Link>
                  )}
                </div>
              )}
            </figure>
          );
        })}
      </div>
    </div>
  );
}

export function VideoWallPage() {
  const { can } = useApp();
  const tr = useTr();
  const [params] = useSearchParams();
  const { convoy, choices } = useWallConvoy(params.get('convoy'));
  if (!can('view_live') || !convoy) return <NoAccess what={tr('the video wall', 'el videowall')} />;
  return <VideoWallView convoy={convoy} choices={choices} />;
}

function VideoWallView({ convoy, choices }: { convoy: Convoy; choices: Convoy[] }) {
  const { state, log, toast, acknowledgeAshore, can } = useApp();
  const lang = state.lang;
  const tr = useTr();
  const fleet = useFleet();
  const [, setParams] = useSearchParams();
  const now = useNow();
  const wall = useWall(convoy, 'console');
  const { focusCam, plan, urgent, openAlarms, tiles } = wall;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState('');
  const noLink = convoy.link === 'none';

  const setConvoy = (id: string) => setParams({ convoy: id }, { replace: true });
  const focusOn = (cam: Camera) => {
    wall.focusOn(cam);
    if (cam.convoyId !== convoy.id) setConvoy(cam.convoyId);
  };

  const openSecondScreen = () => {
    try {
      // Lets "Open alarm" on the second screen bring the alarm up in this window.
      if (!window.name) window.name = 'gfsa-console';
    } catch {
      /* ignore */
    }
    const w = window.open(`/wall?convoy=${convoy.id}`, 'gfsa-wall', 'popup,width=1600,height=900');
    if (!w) {
      toast(
        tr(
          'The browser blocked the second window. Allow pop-ups for this site, then try again.',
          'El navegador bloqueó la segunda ventana. Permita las ventanas emergentes para este sitio y vuelva a intentarlo.',
        ),
      );
      return;
    }
    w.focus();
    log('Opened video wall on a second screen', `${convoy.name} convoy`, `Layout ${wall.layout}`, convoy.id);
    toast(
      tr(
        'Video wall opened in its own window. Move it to the second screen: it shares this layout, focus and overlays.',
        'El videowall se abrió en su propia ventana. Muévala a la segunda pantalla: comparte este diseño, foco y superposiciones.',
      ),
    );
  };

  const q = filter.trim().toLowerCase();
  const camMatches = (c: Camera) =>
    !q || c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q) || (fleet.vesselById(c.vesselId)?.name.toLowerCase().includes(q) ?? false);
  const treeCams = fleet.cameras.filter((c) => choices.some((x) => x.id === c.convoyId));
  const streamingUnits = new Set(
    tiles.filter((c): c is Camera => !!c && (plan.modes.get(c.id) === 'hd' || plan.modes.get(c.id) === 'sd')).map((c) => c.edgeUnitId),
  ).size;
  const convoyLabel = (c: Convoy) => tr(`${c.name} convoy`, `Convoy ${c.name}`);

  return (
    <div className="vw">
      <aside className="vw-tree" aria-labelledby="vw-tree-title">
        <div className="vw-tree__head">
          <div className="vw-tree__title">
            <h2 id="vw-tree-title">{tr('Cameras', 'Cámaras')}</h2>
            <span>
              {tr(
                `${treeCams.length} on ${choices.length} convoy${choices.length === 1 ? '' : 's'}`,
                `${treeCams.length} en ${choices.length} convoy${choices.length === 1 ? '' : 'es'}`,
              )}
            </span>
          </div>
          <label className="vw-tree__filter">
            <Icon name="filter" size={16} />
            <span className="sr-only">{tr('Filter cameras', 'Filtrar cámaras')}</span>
            <input type="search" placeholder={tr('Filter cameras', 'Filtrar cámaras')} value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
        </div>
        <ul className="vw-tree__list" aria-label={tr('Cameras by convoy and vessel', 'Cámaras por convoy y buque')}>
          {choices.map((c, ci) => {
            const isOpenNode = expanded[c.id] ?? (c.id === convoy.id || !!q);
            const off = c.link === 'none';
            return (
              <li key={c.id} className={ci > 0 ? 'vw-tree__convoy vw-tree__convoy--sep' : 'vw-tree__convoy'}>
                <button type="button" className="vw-tree__convoy-btn" aria-expanded={isOpenNode} onClick={() => setExpanded((m) => ({ ...m, [c.id]: !isOpenNode }))}>
                  <Icon name={isOpenNode ? 'chevronDown' : 'chevronRight'} size={16} strokeWidth={2} />
                  <span className="grow-1">{convoyLabel(c)}</span>
                  <span className="vw-tree__link">
                    <span className={`dot${off ? ' dot--off' : c.link === 'weak' ? ' dot--warn' : ''}`} aria-hidden="true" />
                    {off ? tr('No link', 'Sin enlace') : c.linkLabel}
                  </span>
                </button>
                {isOpenNode && (
                  <ul>
                    {fleet.vesselsOf(c.id).map((v) => {
                      const cams = fleet.camerasOnVessel(v.id).filter(camMatches);
                      if (!cams.length) return null;
                      return (
                        <li key={v.id}>
                          <span className="vw-tree__vessel">
                            {v.name}
                            {v.kind === 'tug' ? tr(' · tug', ' · remolcador') : ''}
                          </span>
                          <ul>
                            {cams.map((cam) => {
                              const isFocus = c.id === convoy.id && cam.id === focusCam?.id;
                              const urg = urgent.find((a) => a.cameraId === cam.id);
                              const mode = c.id === convoy.id ? plan.modes.get(cam.id) : undefined;
                              let note: string;
                              let tone = '';
                              if (urg) {
                                note = tr(`${urg.priority} alarm`, `alarma ${urg.priority}`);
                                tone = 'vw-tree__note--alarm';
                              } else if (cam.health !== 'healthy') {
                                note = healthShort(cam, lang);
                                tone = 'vw-tree__note--warn';
                              } else if (off) note = tr('no link', 'sin enlace');
                              else if (mode === 'hd') note = tr('live HD', 'en vivo HD');
                              else if (mode === 'sd') note = tr('live', 'en vivo');
                              else if (mode === 'snap') note = tr('snapshot', 'foto fija');
                              else note = c.id === convoy.id ? tr('off wall', 'fuera del videowall') : '';
                              return (
                                <li key={cam.id}>
                                  <button
                                    type="button"
                                    className={`vw-tree__cam${isFocus ? ' is-focus' : ''}${urg ? ' is-alarm' : ''}`}
                                    aria-current={isFocus ? 'true' : undefined}
                                    onClick={() => focusOn(cam)}
                                    title={tr(`Put ${v.name} · ${cam.name} in focus`, `Poner ${v.name} · ${cam.name} en el foco`)}
                                  >
                                    <span className={`dot${urg ? ' dot--bad' : cam.health === 'healthy' ? '' : ` dot--${healthTone(cam.health)}`}`} aria-hidden="true" />
                                    <span className="grow-1">{cam.name}</span>
                                    {note && <span className={`vw-tree__note ${tone}`}>{note}</span>}
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </aside>

      <div className="page page--fluid vw-main">
        <PageHeader
          crumbs={[{ label: tr('Operations', 'Operaciones'), to: '/' }]}
          title={tr('Video wall', 'Videowall')}
          meta={
            <label className="vw-layout-pick">
              <span className="vw-layout-pick__label">{tr('Layout', 'Diseño')}</span>
              <select value={convoy.id} onChange={(e) => setConvoy(e.target.value)} aria-label={tr('Layout for convoy', 'Diseño para el convoy')}>
                {choices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {convoyLabel(c)}
                  </option>
                ))}
              </select>
              <Icon name="chevronDown" size={14} strokeWidth={2} />
            </label>
          }
          actions={
            <div className="vw-controls">
              <Segmented<Layout>
                label={tr('Grid', 'Cuadrícula')}
                value={wall.layout}
                onChange={wall.setLayout}
                options={LAYOUTS.map((l) => ({ value: l.value, label: tr(l.label[0], l.label[1]) }))}
              />
              <label className="check vw-overlay-toggle">
                <input type="checkbox" checked={wall.overlays} onChange={(e) => wall.setOverlays(e.target.checked)} />
                {tr('AI overlays', 'Superposiciones de IA')}
              </label>
              <BudgetMeter wall={wall} />
              <button
                type="button"
                className="btn btn--icon"
                aria-label={tr('Open on a second screen', 'Abrir en una segunda pantalla')}
                title={tr('Open on a second screen', 'Abrir en una segunda pantalla')}
                onClick={openSecondScreen}
              >
                <Icon name="screen" size={20} />
              </button>
            </div>
          }
        />

        {noLink && (
          <div className="callout callout--warn" role="status">
            <Icon name="wifiOff" size={18} style={{ color: 'var(--warn-text)', marginTop: 1 }} />
            <span>
              {lang === 'es' ? (
                <>
                  <strong>{convoy.name} no tiene enlace a tierra</strong> desde las {fmtTime(convoy.lastSeen)} ({positionText(convoy.positionLabel, lang, true)}). Los mosaicos
                  muestran las últimas fotos recibidas. Las alertas siguen llegando a la pantalla del puente, y hay {convoy.queuedEvents} eventos en cola a
                  bordo. Cuando vuelva la cobertura, las cámaras pasan a vivo dentro del presupuesto.
                </>
              ) : (
                <>
                  <strong>{convoy.name} has no link to shore</strong> since {fmtTime(convoy.lastSeen)} ({positionText(convoy.positionLabel, 'en', true)}). Tiles show the last snapshots
                  received. Alerts still reach the wheelhouse display, and {convoy.queuedEvents} events are queued on board. When coverage returns, the cameras
                  go live within the budget.
                </>
              )}
            </span>
          </div>
        )}

        <WallGrid wall={wall} now={now} />

        <section className="card" aria-labelledby="vw-strip-title">
          <div className="card__head">
            <div className="card__title">
              <h2 id="vw-strip-title">{tr('Alarms on this layout', 'Alarmas en este diseño')}</h2>
              <span className="card__hint">{tr(`${openAlarms.length} open`, `${openAlarms.length} abiertas`)}</span>
            </div>
            <Link to="/alarms" className="card__link">
              {tr('Alarm console', 'Consola de alarmas')}
            </Link>
          </div>
          {openAlarms.length === 0 ? (
            <div className="empty">{tr('No open alarms on this convoy.', 'No hay alarmas abiertas en este convoy.')}</div>
          ) : (
            <ul className="vw-strip">
              {openAlarms.map((a) => {
                const cam = fleet.cameraById(a.cameraId);
                const left = a.escalatesAt ? new Date(a.escalatesAt).getTime() - now : undefined;
                const hot = isUrgent(a) && a.state !== 'ack_shore';
                const where = cam ? `${fleet.vesselById(cam.vesselId)?.short} · ${cam.name}` : convoyLabel(convoy);
                const tail =
                  left !== undefined && a.state !== 'ack_shore' && a.state !== 'resolved'
                    ? left > 0
                      ? tr(`escalates in ${fmtCountdown(left)}`, `escala en ${fmtCountdown(left)}`)
                      : tr(`escalating to ${toTarget(a.escalatesTo, 'en')}`, `escalando ${toTarget(a.escalatesTo, 'es')}`)
                    : a.owner && a.owner !== 'System'
                      ? a.owner
                      : a.state === 'resolved'
                        ? tr('resolved', 'resuelta')
                        : (((state.lang === 'es' ? a.responseEs : undefined) ?? a.response)?.toLowerCase() ?? '');
                return (
                  <li key={a.id} className={hot ? 'is-hot' : undefined}>
                    <span className={`badge badge--${a.priority.toLowerCase()}`}>{a.priority}</span>
                    <span className="vw-strip__text">
                      <Link to={`/alarms/${a.id}`}>{pick(lang, a.title, a.titleEs)}</Link>
                      <span>
                        {where}
                        {tail ? ` · ${tail}` : ''}
                      </span>
                    </span>
                    {cam && cam.id !== focusCam?.id && (
                      <button
                        type="button"
                        className="btn btn--ghost btn--icon"
                        aria-label={tr(`Show ${where} in focus`, `Mostrar ${where} en el foco`)}
                        title={tr('Show in focus', 'Mostrar en el foco')}
                        onClick={() => focusOn(cam)}
                      >
                        <Icon name="eye" size={18} />
                      </button>
                    )}
                    {hot && can('acknowledge') && (
                      <button type="button" className="btn btn--primary btn--sm" onClick={() => acknowledgeAshore(a.id)}>
                        {tr('Acknowledge', 'Confirmar')}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <p className="vw-foot">
          <span className="with-dot">
            <span className={`dot${noLink ? ' dot--off' : ''}`} aria-hidden="true" />
            {noLink
              ? tr('No edge unit streaming · last snapshots only', 'Ninguna unidad de borde transmite · solo últimas fotos')
              : tr(`Streaming from ${streamingUnits} edge unit${streamingUnits === 1 ? '' : 's'}`, `Transmitiendo desde ${streamingUnits} unidad${streamingUnits === 1 ? '' : 'es'} de borde`)}
          </span>
          <span>{tr('Every live view is written to the audit log', 'Cada vista en vivo queda en el registro de auditoría')}</span>
        </p>
      </div>
    </div>
  );
}
