import { createStore, uid } from '../lib/persist';
import { cameras as fleetCameras, edgeUnits } from '../data/fleet';
import { useCases } from '../data/useCases';
import type { Camera, Priority, UseCase, UseCaseLevel, UseCaseStatus } from '../data/types';
import { fmtTime, scenarioNow, TZ } from '../lib/time';
// fleetStore imports camStore from here; both sides only use the other inside functions.
import { convoyStore, unitStore } from './fleetStore';

// Configuration state shared by "Use case set-up" and "Cameras and zones":
// cameras, zones, holds and scene-check runs; use case records and their
// signed versions; edits in progress. Saved by lib/persist, so it is shared
// across screens and windows and kept across reloads. The live engine reads
// ucStore (status, and the live version's level, priority and cameras) to
// decide what new events become. In production these become API resources.

// ---------- Stores ----------

export type { Store } from '../lib/persist';
export { useStore } from '../lib/persist';

export const isoNow = (ms = scenarioNow()) => new Date(ms).toISOString();
const d = (s: string) => `2026-${s}:00-03:00`;
const enDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: TZ });

// ---------- Zones ----------

export type Pt = [number, number];

export interface Zone {
  id: string;
  name: string;
  kind: 'polygon' | 'line';
  /** Points in % of the reference view. */
  points: Pt[];
  note?: string;
}

export const newZoneId = () => uid('zone');

export const cloneZones = (zones: Zone[] = []): Zone[] => zones.map((z) => ({ ...z, points: z.points.map((p) => [...p] as Pt) }));

/** Same zones on the vessel, ignoring ids (a copy of a zone is the same zone). */
export function sameZones(a: Zone[] = [], b: Zone[] = []): boolean {
  const key = (zs: Zone[]) => JSON.stringify(zs.map((z) => [z.name, z.kind, z.points]));
  return key(a) === key(b);
}

export type CamSlot = 'wheelhouse' | 'engine' | 'bow' | 'deck' | 'edge' | 'reefer';

export function slotOf(c: Pick<Camera, 'position'>): CamSlot {
  const p = c.position.toLowerCase();
  if (p.includes('wheelhouse')) return 'wheelhouse';
  if (p.includes('engine')) return 'engine';
  if (p.includes('bow')) return 'bow';
  if (p.includes('reefer')) return 'reefer';
  if (p.includes('side')) return 'edge';
  return 'deck';
}

export const SLOT_LABEL: Record<CamSlot, [string, string]> = {
  wheelhouse: ['wheelhouse', 'del puente'],
  engine: ['engine room', 'de sala de máquinas'],
  bow: ['bow', 'de proa'],
  deck: ['deck', 'de cubierta'],
  edge: ['barge edge', 'de borde de barcaza'],
  reefer: ['reefer row', 'de fila de reefers'],
};

type ZoneSeed = Omit<Zone, 'id'>;

const SLOT_ZONES: Record<CamSlot, ZoneSeed[]> = {
  wheelhouse: [],
  engine: [{ name: 'Engine room floor', kind: 'polygon', points: [[16, 96], [84, 96], [70, 50], [30, 50]], note: 'around the main engines' }],
  bow: [{ name: 'Forward zone', kind: 'polygon', points: [[28, 34], [72, 34], [94, 62], [6, 62]], note: 'water ahead of the bow' }],
  deck: [
    { name: 'Deck walkway', kind: 'polygon', points: [[20, 98], [62, 98], [62, 40], [52, 40]], note: 'where crew walk and work' },
    { name: 'Container stack', kind: 'polygon', points: [[64, 30], [96, 20], [96, 82], [66, 72]], note: 'container doors and lashing' },
  ],
  edge: [
    { name: 'Water edge, port', kind: 'polygon', points: [[17.19, 100], [45.31, 100], [60.31, 27.78], [58.75, 27.78]], note: 'along the hull line' },
    { name: 'Hull line', kind: 'line', points: [[14.5, 99], [58.2, 28.5]], note: 'used by objects thrown overboard' },
  ],
  reefer: [{ name: 'Reefer row', kind: 'polygon', points: [[28, 98], [72, 98], [57, 38], [43, 38]], note: 'the aisle between reefer units' }],
};

const seedZones = (c: Camera): Zone[] => SLOT_ZONES[slotOf(c)].map((z) => ({ ...z, points: z.points.map((p) => [...p] as Pt), id: newZoneId() }));

// ---------- Cameras, holds and scene checks ----------

export interface Hold {
  since: string; // ISO
  reason: string;
  reasonEs?: string;
}

export interface SceneFlag {
  cameraId: string;
  /** "Blurred", "Lens wet", "Camera moved", "No image" */
  note: string;
  cleared?: string; // "06:48"
  /** Not flagged by the run before: a new problem. */
  fresh?: boolean;
}

export interface SceneRun {
  id: string;
  at: string; // ISO
  by: string; // "Schedule" or a person
  checked: number;
  flags: SceneFlag[];
  /** Convoys out of coverage: the check runs on board and the results wait for the link. */
  queued: { convoyId: string; cameras: number; since: string; delivered?: string }[];
  /** Cameras flagged before that passed this run. */
  cleared?: string[];
}

export interface CamState {
  cameras: Camera[];
  zones: Record<string, Zone[]>;
  holds: Record<string, Hold>;
  sources: Record<string, string>;
  addedAt: Record<string, string>;
  runs: SceneRun[];
  /** Crew reports a camera cleaned or reset; the next scene check confirms it. */
  serviced?: Record<string, { at: string; by: string }>;
}

/** CAM-03 sample: a camera knocked out of position, its zones held for review. */
const movedSample: Camera = {
  id: 'F504-CAM-04',
  name: 'Starboard edge',
  vesselId: 'f504',
  convoyId: 'boq',
  edgeUnitId: 'F504-EU-01',
  position: 'Barge, starboard side',
  facing: 'Aft-facing',
  stream: '1080p30',
  fpsToAi: 5,
  health: 'degraded',
  healthNote: 'Moved · zones held since 11:30',
  zones: 2,
  useCases: 3,
  lastCheck: '14:30',
  image: '/media/cam-port-edge.svg',
};

const initialCameras: Camera[] = [...fleetCameras.map((c) => ({ ...c })), movedSample];

const initialZones: Record<string, Zone[]> = Object.fromEntries(initialCameras.map((c) => [c.id, seedZones(c)]));
// The moved camera's zones no longer line up with its view.
initialZones['F504-CAM-04'] = [
  { id: newZoneId(), name: 'Water edge, starboard', kind: 'polygon', points: [[26, 100], [54, 100], [68, 34], [66, 34]], note: 'drawn before the camera moved' },
  { id: newZoneId(), name: 'Hull line', kind: 'line', points: [[23, 99], [66, 35]], note: 'drawn before the camera moved' },
];

function seedRuns(): SceneRun[] {
  const runs: SceneRun[] = [];
  const total = initialCameras.length;
  const hum = initialCameras.filter((c) => c.convoyId === 'hum').length;
  for (let h = 6; h <= 14; h++) {
    const hh = String(h).padStart(2, '0');
    const flags: SceneFlag[] = [];
    if (h === 6) flags.push({ cameraId: 'F503-CAM-02', note: 'Lens wet', cleared: '06:48' });
    if (h >= 11) flags.push({ cameraId: 'F504-CAM-04', note: 'Camera moved', fresh: h === 11 });
    if (h >= 13) flags.push({ cameraId: 'TUY-CAM-03', note: 'Blurred', fresh: h === 13 });
    const queued = h === 14 ? [{ convoyId: 'hum', cameras: hum, since: d('10-15T13:49') }] : [];
    runs.push({
      id: `run-${hh}`,
      at: d(`10-15T${hh}:30`),
      by: 'Schedule',
      checked: total - (h === 14 ? hum : 0),
      flags,
      queued,
    });
  }
  return runs.reverse();
}

export const camStore = createStore<CamState>('config.cameras', () => ({
  cameras: initialCameras,
  zones: initialZones,
  holds: {
    'F504-CAM-04': {
      since: d('10-15T11:30'),
      reason: 'The 11:30 scene check found the view shifted about 6% to the right.',
      reasonEs: 'El control de escena de las 11:30 encontró la imagen desplazada cerca de un 6 % hacia la derecha.',
    },
  },
  sources: {},
  addedAt: {},
  runs: seedRuns(),
  serviced: {},
}));

export const sourceOf = (s: CamState, c: Camera) => s.sources[c.id] ?? `Recorder RTSP · ${c.stream}`;

/** What a scene check reports for a camera that does not pass. */
function flagNote(c: Camera, held: boolean): string {
  if (held) return 'Camera moved';
  if (c.health === 'offline') return 'No image';
  return (c.healthNote ?? 'Degraded').split(' since')[0].split(' · ')[0] || 'Degraded';
}

const clearFlags = (runs: SceneRun[], cameraIds: string[], hhmm: string): SceneRun[] =>
  cameraIds.length
    ? runs.map((r) =>
        r.flags.some((f) => cameraIds.includes(f.cameraId) && !f.cleared)
          ? { ...r, flags: r.flags.map((f) => (cameraIds.includes(f.cameraId) && !f.cleared ? { ...f, cleared: hhmm } : f)) }
          : r,
      )
    : runs;

/**
 * CAM-02: one scene check on every camera. Cameras on connected convoys get a
 * new last-check time; cameras on convoys without a link run the check on board
 * and their results are queued until the link returns. Degraded, offline and
 * held cameras are flagged; cameras the crew reported fixed pass and turn healthy.
 * Used by "Run scene check" and, hourly, by the live engine.
 */
export function runSceneCheck(by: string): SceneRun {
  const s = camStore.get();
  const at = isoNow();
  const hhmm = fmtTime(at);
  const convoys = convoyStore.get();
  const off = new Set(convoys.filter((c) => c.link === 'none').map((c) => c.id));
  const prevOpen = new Set((s.runs[0]?.flags ?? []).filter((f) => !f.cleared).map((f) => f.cameraId));
  const serviced = { ...(s.serviced ?? {}) };
  const flags: SceneFlag[] = [];
  const cleared: string[] = [];
  let checked = 0;

  const cameras = s.cameras.map((c): Camera => {
    if (off.has(c.convoyId)) return c;
    checked += 1;
    const held = !!s.holds[c.id];
    if (!held && c.health !== 'healthy' && serviced[c.id]) {
      cleared.push(c.id);
      delete serviced[c.id];
      return { ...c, health: 'healthy', healthNote: undefined, lastCheck: hhmm };
    }
    if (held || c.health !== 'healthy') {
      flags.push({ cameraId: c.id, note: flagNote(c, held), fresh: !prevOpen.has(c.id) });
      return { ...c, lastCheck: hhmm };
    }
    if (prevOpen.has(c.id)) cleared.push(c.id);
    delete serviced[c.id];
    // A camera added today has had its first check now.
    return { ...c, lastCheck: hhmm, healthNote: c.healthNote?.startsWith('Added') ? undefined : c.healthNote };
  });

  const queued = [...off]
    .map((id) => ({ convoyId: id, cameras: s.cameras.filter((c) => c.convoyId === id).length, since: convoys.find((c) => c.id === id)?.lastSeen ?? at }))
    .filter((q) => q.cameras > 0);

  const run: SceneRun = { id: uid('run'), at, by, checked, flags, queued, cleared };
  camStore.set((st) => ({ ...st, cameras, serviced, runs: [run, ...clearFlags(st.runs, cleared, hhmm)].slice(0, 48) }));
  return run;
}

/** The crew reports the lens cleaned or the camera reset: the next scene check confirms it. */
export function markServiced(cameraId: string, by: string) {
  camStore.set((s) => ({ ...s, serviced: { ...(s.serviced ?? {}), [cameraId]: { at: isoNow(), by } } }));
}

/** CAM-03: approve a moved camera's zones as they are, or replace them with redrawn ones. */
export function releaseHold(cameraId: string, zones?: Zone[]) {
  const hhmm = fmtTime(isoNow());
  camStore.set((s) => {
    const holds = { ...s.holds };
    delete holds[cameraId];
    const nextZones = zones ? { ...s.zones, [cameraId]: cloneZones(zones) } : s.zones;
    return {
      ...s,
      holds,
      zones: nextZones,
      runs: clearFlags(s.runs, [cameraId], hhmm),
      cameras: s.cameras.map((c) => (c.id === cameraId ? { ...c, health: 'healthy', healthNote: undefined, zones: nextZones[cameraId]?.length ?? 0 } : c)),
    };
  });
}

/** Results of on-board scene checks reach shore when a convoy's link returns. */
function deliverQueuedChecks() {
  const convoys = convoyStore.get();
  const up = new Set(convoys.filter((c) => c.link !== 'none').map((c) => c.id));
  const s = camStore.get();
  const latest = s.runs[0];
  if (!latest || !latest.queued.some((q) => !q.delivered && up.has(q.convoyId))) return;
  const at = isoNow();
  const arrived = latest.queued.filter((q) => !q.delivered && up.has(q.convoyId));
  const hhmm = fmtTime(latest.at);
  camStore.set((st) => ({
    ...st,
    cameras: st.cameras.map((c) => (arrived.some((q) => q.convoyId === c.convoyId) ? { ...c, lastCheck: hhmm } : c)),
    runs: st.runs.map((r, i) =>
      i === 0
        ? {
            ...r,
            checked: r.checked + arrived.reduce((n, q) => n + q.cameras, 0),
            queued: r.queued.map((q) => (!q.delivered && up.has(q.convoyId) ? { ...q, delivered: at } : q)),
          }
        : r,
    ),
  }));
}

// ---------- Use case set-up ----------

/** Which camera positions each use case can run on. */
export const UC_SLOTS: Record<string, CamSlot[]> = {
  'hard-hat-vest': ['deck'],
  'life-jacket': ['edge'],
  smoking: ['reefer'],
  'person-down': ['deck'],
  'smoke-fire-deck': ['deck'],
  'smoke-machinery': ['engine'],
  overboard: ['edge'],
  obstacle: ['bow'],
  'container-doors': ['reefer'],
  'reefer-rounds': ['reefer'],
  'outside-work': ['deck', 'edge'],
  'camera-health': ['wheelhouse', 'engine', 'bow', 'deck', 'edge', 'reefer'],
};

export const eligibleCameras = (ucId: string, cams: Camera[]) => cams.filter((c) => (UC_SLOTS[ucId] ?? []).includes(slotOf(c)));

export interface Rule {
  object: string;
  objects: string[];
  verb: string;
  /** Undefined when the rule looks at the whole image. */
  zone?: string;
  qualifier?: string;
  item?: string;
  items?: string[];
  /** Undefined when the rule has no dwell time. */
  seconds?: number;
  suffix?: string;
}

export type Schedule = 'always' | 'underway' | 'cargo' | 'hours';

export interface UcConfig {
  level: UseCaseLevel;
  priority: Priority;
  cameraIds: string[];
  /**
   * Draft: the zone edits made in this version, by camera (cameras without an
   * entry keep the zones on the vessel). Pushed versions: the zones on each of
   * its cameras when it went live, so a rollback can restore them.
   */
  zones: Record<string, Zone[]>;
  rule: Rule;
  confidence: number;
  repeatMin: number;
  schedule: Schedule;
  hours: { from: string; to: string };
  steps: string[];
  stepsEs?: string[];
  nextStep: string;
  nextStepEs?: string;
}

const PERSON = ['person'];

const RULES: Record<string, Rule> = {
  'hard-hat-vest': { object: 'person', objects: PERSON, verb: 'is inside', zone: 'Deck walkway', qualifier: 'without a', item: 'hard hat or vest', items: ['hard hat or vest', 'hard hat', 'vest'], seconds: 5 },
  'life-jacket': { object: 'person', objects: PERSON, verb: 'is inside', zone: 'Water edge, port', qualifier: 'without a', item: 'life jacket', items: ['life jacket', 'hard hat', 'vest'], seconds: 5 },
  smoking: { object: 'person', objects: PERSON, verb: 'is inside', zone: 'Reefer row', qualifier: 'while', item: 'smoking', items: ['smoking', 'using a phone'], seconds: 3 },
  'person-down': { object: 'person', objects: PERSON, verb: 'is inside', zone: 'Deck walkway', qualifier: 'while', item: 'lying still', items: ['lying still'], seconds: 10 },
  'smoke-fire-deck': { object: 'smoke or flame', objects: ['smoke or flame', 'smoke', 'flame'], verb: 'is seen in', zone: 'Anywhere in view', seconds: 3 },
  'smoke-machinery': { object: 'smoke or haze', objects: ['smoke or haze', 'smoke', 'flame'], verb: 'is seen in', zone: 'Engine room floor', seconds: 5 },
  overboard: { object: 'person', objects: PERSON, verb: 'crosses', zone: 'Hull line', qualifier: 'into', item: 'the water', items: ['the water'], seconds: 1 },
  obstacle: { object: 'floating debris or a vessel', objects: ['floating debris or a vessel', 'floating debris', 'vessel'], verb: 'is inside', zone: 'Forward zone', seconds: 2 },
  'container-doors': { object: 'container door', objects: ['container door'], verb: 'is open in', zone: 'Reefer row', qualifier: 'outside', item: 'cargo operations', items: ['cargo operations', 'port calls'], seconds: 30 },
  'reefer-rounds': { object: 'person', objects: PERSON, verb: 'is not seen in', zone: 'Reefer row', qualifier: 'within', item: '15 min of a planned round', items: ['10 min of a planned round', '15 min of a planned round', '30 min of a planned round'] },
  'outside-work': { object: 'person', objects: PERSON, verb: 'is inside', zone: 'Deck walkway', qualifier: 'outside', item: 'work planned in Connect', items: ['work planned in Connect'], seconds: 10 },
  'camera-health': { object: 'image', objects: ['image'], verb: 'is', qualifier: '', item: 'blurred, wet, moved or missing', items: ['blurred, wet, moved or missing', 'missing'], suffix: 'at the hourly scene check' },
};

const CONFIDENCE: Record<string, number> = { 'smoke-fire-deck': 0.5, 'smoke-machinery': 0.5, smoking: 0.65, 'camera-health': 0.8 };
const SCHEDULE: Record<string, Schedule> = { 'life-jacket': 'underway', 'hard-hat-vest': 'cargo', obstacle: 'underway' };

export const usesZones = (cfg: Pick<UcConfig, 'rule'>) => cfg.rule.zone !== undefined;

export function defaultConfig(uc: UseCase, cams: Camera[] = initialCameras): UcConfig {
  return {
    level: uc.level,
    priority: uc.priority,
    cameraIds: uc.status === 'blocked' ? [] : eligibleCameras(uc.id, cams).map((c) => c.id),
    zones: {},
    rule: { ...RULES[uc.id] },
    confidence: CONFIDENCE[uc.id] ?? 0.6,
    repeatMin: 10,
    schedule: SCHEDULE[uc.id] ?? 'always',
    hours: { from: '06:00', to: '18:00' },
    steps: [...uc.responseSteps],
    stepsEs: [...uc.responseStepsEs],
    nextStep: uc.nextStep,
    nextStepEs: uc.nextStepEs,
  };
}

export interface UnitPush {
  unitId: string;
  waiting: boolean;
  confirmAt?: string; // ISO
}

export interface UcVersion {
  version: string;
  state: 'draft' | 'live' | 'signed';
  at: string; // ISO saved or signed
  by: string;
  note: string;
  noteEs?: string;
  config: UcConfig;
  push?: { at: string; by: string; units: UnitPush[] };
}

export interface UcRecord {
  id: string;
  status: UseCaseStatus;
  /** English summary for records; screens build the text in the viewer's language. */
  statusNote: string;
  shadowStart?: string;
  /** When record and alert went live. */
  alertsSince?: string;
  versions: UcVersion[]; // newest first
  trainingSent?: string;
  trainingBy?: string;
  trainingClips?: number;
}

const ANA = 'Ana Cáceres';

const unitsConfirmed = (at: string, waitingConvoys: string[] = []): UnitPush[] =>
  edgeUnits.map((u, i) => ({
    unitId: u.id,
    waiting: waitingConvoys.includes(u.convoyId),
    confirmAt: waitingConvoys.includes(u.convoyId) ? undefined : new Date(new Date(at).getTime() + (i + 1) * 4 * 60_000).toISOString(),
  }));

/** Units that would receive a push now: units on a convoy without a link wait for it. */
export function unitsForPushNow(nowMs = scenarioNow()): UnitPush[] {
  const convoys = convoyStore.get();
  let k = 0;
  return unitStore.get().map((u) => {
    const off = convoys.find((c) => c.id === u.convoyId)?.link === 'none' || u.status === 'out_of_coverage';
    if (off) return { unitId: u.id, waiting: true };
    k += 1;
    return { unitId: u.id, waiting: false, confirmAt: new Date(nowMs + 1200 + k * 900).toISOString() };
  });
}

/** Live versions waiting for a convoy's link install once it is back. */
function settlePushes() {
  const convoys = convoyStore.get();
  const units = unitStore.get();
  const up = (unitId: string) => {
    const u = units.find((x) => x.id === unitId);
    return !!u && convoys.find((c) => c.id === u.convoyId)?.link !== 'none';
  };
  const records = ucStore.get();
  if (!Object.values(records).some((r) => r.versions.some((v) => v.state === 'live' && v.push?.units.some((u) => u.waiting && up(u.unitId))))) return;
  const now = scenarioNow();
  ucStore.set((all) =>
    Object.fromEntries(
      Object.entries(all).map(([id, r]) => [
        id,
        {
          ...r,
          versions: r.versions.map((v) => {
            if (v.state !== 'live' || !v.push?.units.some((u) => u.waiting && up(u.unitId))) return v;
            let k = 0;
            const unitsNext = v.push.units.map((u) => {
              if (!u.waiting || !up(u.unitId)) return u;
              k += 1;
              return { ...u, waiting: false, confirmAt: new Date(now + 2000 + k * 1500).toISOString() };
            });
            return { ...v, push: { ...v.push, units: unitsNext } };
          }),
        },
      ]),
    ),
  );
}

const ALERTS_SINCE = (uc: UseCase) => {
  const m = uc.statusNote.match(/alerts on since (\d+) Oct/);
  return m ? d(`10-${m[1].padStart(2, '0')}T09:00`) : undefined;
};

/** The zones on each of a version's cameras, from the vessels' zones plus the version's edits. */
function zoneSnapshot(cfg: UcConfig, vesselZones: Record<string, Zone[]>): Record<string, Zone[]> {
  if (!usesZones(cfg)) return Object.fromEntries(Object.entries(cfg.zones).map(([k, z]) => [k, cloneZones(z)]));
  const ids = new Set([...cfg.cameraIds, ...Object.keys(cfg.zones)]);
  return Object.fromEntries([...ids].map((id) => [id, cloneZones(cfg.zones[id] ?? vesselZones[id] ?? [])]));
}

function seedVersions(uc: UseCase): UcVersion[] {
  const base = defaultConfig(uc);
  // Pushed and signed versions keep the zones they ran with.
  const cfg: UcConfig = { ...base, zones: zoneSnapshot(base, initialZones) };
  if (uc.id === 'life-jacket') {
    const live: UcConfig = { ...cfg, confidence: 0.55, repeatMin: 5 };
    const listing: UcConfig = { ...live, level: 'list', confidence: 0.5 };
    return [
      { version: 'v1.4.3', state: 'draft', at: '2026-10-15T14:21:14-03:00', by: ANA, note: 'Confidence 0.60, repeat 10 min', noteEs: 'Confianza 0,60, repetición 10 min', config: { ...live, zones: {}, confidence: 0.6, repeatMin: 10 } },
      { version: 'v1.4.2', state: 'live', at: d('10-12T09:40'), by: ANA, note: 'Zone redrawn on F 505 after a camera move', noteEs: 'Zona redibujada en F 505 tras mover una cámara', config: live, push: { at: d('10-12T10:05'), by: ANA, units: unitsConfirmed(d('10-12T10:05'), ['hum']) } },
      { version: 'v1.4.1', state: 'signed', at: d('10-05T16:10'), by: ANA, note: 'Passed the shadow run · alerts on from 6 Oct', noteEs: 'Superó la ejecución en sombra · alertas activas desde el 6 oct', config: { ...live, confidence: 0.5 } },
      { version: 'v1.4.0', state: 'signed', at: d('09-28T11:22'), by: ANA, note: 'Crew safety attributes v1.4', noteEs: 'Atributos de seguridad de la tripulación v1.4', config: listing },
      { version: 'v1.3.1', state: 'signed', at: d('09-22T08:00'), by: ANA, note: '14-day shadow run started', noteEs: 'Inicio de la ejecución en sombra de 14 días', config: listing },
      { version: 'v1.3.0', state: 'signed', at: d('09-15T15:30'), by: ANA, note: 'First set-up from the GFSA workbook', noteEs: 'Primera configuración desde el libro de trabajo de GFSA', config: { ...listing, confidence: 0.45 } },
    ];
  }
  if (uc.status === 'blocked') return [];
  if (uc.status === 'off') {
    return [{ version: 'v0.9.0', state: 'signed', at: d('10-01T10:00'), by: ANA, note: 'Ready for the fleet rollout · not pushed', noteEs: 'Lista para el despliegue a la flota · no enviada', config: cfg }];
  }
  if (uc.status === 'shadow') {
    const start = uc.id === 'smoking' ? d('10-07T08:00') : d('10-12T08:00');
    return [
      { version: 'v1.0.1', state: 'live', at: start, by: ANA, note: 'Shadow run, alerts off', noteEs: 'Ejecución en sombra, alertas apagadas', config: { ...cfg, level: 'list' }, push: { at: start, by: ANA, units: unitsConfirmed(start) } },
      { version: 'v1.0.0', state: 'signed', at: d('10-01T14:00'), by: ANA, note: 'First set-up from the GFSA workbook', noteEs: 'Primera configuración desde el libro de trabajo de GFSA', config: { ...cfg, level: 'list', confidence: 0.55 } },
    ];
  }
  return [
    { version: 'v1.2.0', state: 'live', at: d('10-09T09:00'), by: ANA, note: cfg.level === 'alert' ? 'Alerts on after the shadow run' : 'Live after the shadow run, record and list', noteEs: cfg.level === 'alert' ? 'Alertas activas tras la ejecución en sombra' : 'En vivo tras la ejecución en sombra, registrar y listar', config: cfg, push: { at: d('10-09T09:30'), by: ANA, units: unitsConfirmed(d('10-09T09:30')) } },
    { version: 'v1.1.0', state: 'signed', at: d('09-25T10:00'), by: ANA, note: '14-day shadow run started', noteEs: 'Inicio de la ejecución en sombra de 14 días', config: { ...cfg, level: 'list' } },
    { version: 'v1.0.0', state: 'signed', at: d('09-18T10:00'), by: ANA, note: 'First set-up from the GFSA workbook', noteEs: 'Primera configuración desde el libro de trabajo de GFSA', config: { ...cfg, level: 'list', confidence: 0.55 } },
  ];
}

export const ucStore = createStore<Record<string, UcRecord>>('config.useCases', () =>
  Object.fromEntries(
    useCases.map((uc) => [
      uc.id,
      {
        id: uc.id,
        status: uc.status,
        statusNote: uc.statusNote,
        shadowStart: uc.status === 'shadow' ? (uc.id === 'smoking' ? d('10-07T08:00') : d('10-12T08:00')) : undefined,
        alertsSince: uc.status === 'live' ? ALERTS_SINCE(uc) : undefined,
        versions: seedVersions(uc),
      } satisfies UcRecord,
    ]),
  ),
);

export const draftOf = (r: UcRecord) => r.versions.find((v) => v.state === 'draft');
export const liveOf = (r: UcRecord) => r.versions.find((v) => v.state === 'live');

/** The configuration currently on the vessels (or the latest signed one). */
export const activeConfig = (uc: UseCase, r: UcRecord) => liveOf(r)?.config ?? r.versions.find((v) => v.state === 'signed')?.config ?? defaultConfig(uc);

/** A configuration to edit from: the active one, with the zones left on the vessels. */
export const editableFrom = (cfg: UcConfig): UcConfig => ({ ...cfg, zones: {} });

export function bumpVersion(v?: string): string {
  if (!v) return 'v0.1.0';
  const m = v.match(/^v(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return `${v}.1`;
  return `v${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

/** The next version number after every version of a use case. */
export const nextVersion = (r: UcRecord) => bumpVersion(r.versions.map((v) => v.version).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0]);

/** Use cases whose vessel configuration runs on a camera (excludes blocked and off). */
export function useCasesOnCamera(records: Record<string, UcRecord>, cameraId: string): UseCase[] {
  return useCases.filter((uc) => {
    const r = records[uc.id];
    if (!r || r.status === 'blocked') return false;
    return activeConfig(uc, r).cameraIds.includes(cameraId);
  });
}

export const SHADOW_DAY_MS = 24 * 60 * 60 * 1000;

/** Keeps each camera's zone and use case counts (shown on other screens) in step. */
function syncCameraCounts() {
  const records = ucStore.get();
  camStore.set((s) => {
    let changed = false;
    const cameras = s.cameras.map((c) => {
      const zones = s.zones[c.id]?.length ?? 0;
      const ucs = useCasesOnCamera(records, c.id).length;
      if (c.zones === zones && c.useCases === ucs) return c;
      changed = true;
      return { ...c, zones, useCases: ucs };
    });
    return changed ? { ...s, cameras } : s;
  });
}

function englishStatus(uc: UseCase, r: UcRecord): string {
  const cfg = activeConfig(uc, r);
  if (r.status === 'shadow') return 'Shadow run · day 1 of 14';
  if (r.status === 'live') return cfg.level === 'alert' ? `Live · alerts on${r.alertsSince ? ` since ${enDay(r.alertsSince)}` : ''}` : 'Live · record and list';
  return r.statusNote;
}

/**
 * UC-07: sign a version and send it to every edge unit. It becomes the live
 * version (the engine uses its level, priority and cameras from the next event);
 * its zones are written onto the cameras; units on a convoy without a link
 * install when the link returns.
 *  - `version` names the draft or an earlier signed version (a rollback);
 *  - with `config`, a new version is made from it (shadow run, alerts on).
 */
export function goLive(
  ucId: string,
  o: {
    by: string;
    version: string;
    config?: UcConfig;
    note?: [string, string];
    status?: UseCaseStatus;
    shadowStart?: string;
  },
): UcVersion | undefined {
  const uc = useCases.find((u) => u.id === ucId);
  const rec = ucStore.get()[ucId];
  if (!uc || !rec) return undefined;
  const existing = rec.versions.find((v) => v.version === o.version);
  const cfg = o.config ?? existing?.config;
  if (!cfg) return undefined;
  const at = isoNow();
  const units = unitsForPushNow();

  // Zones: the version's zones go onto the cameras.
  const vessel = camStore.get().zones;
  const writes = Object.fromEntries(Object.entries(cfg.zones).map(([k, z]) => [k, cloneZones(z)]));
  const after = { ...vessel, ...writes };
  if (Object.keys(writes).length) camStore.set((s) => ({ ...s, zones: { ...s.zones, ...writes } }));
  const liveCfg: UcConfig = { ...cfg, zones: zoneSnapshot({ ...cfg, zones: {} }, after) };

  const prevLevel = activeConfig(uc, rec).level;
  const push = { at, by: o.by, units };
  let result: UcVersion | undefined;
  ucStore.set((all) => {
    const r = all[ucId];
    const demote = (v: UcVersion): UcVersion => (v.state === 'live' ? { ...v, state: 'signed' } : v);
    let versions: UcVersion[];
    if (existing && !o.config) {
      versions = r.versions.map((v) => (v.version === o.version ? (result = { ...v, state: 'live', config: liveCfg, push }) : demote(v)));
    } else {
      result = {
        version: o.version,
        state: 'live',
        at,
        by: o.by,
        note: o.note?.[0] ?? existing?.note ?? '',
        noteEs: o.note?.[1] ?? existing?.noteEs,
        config: liveCfg,
        push,
      };
      versions = [result, ...r.versions.filter((v) => v.version !== o.version).map(demote)];
    }
    const status = o.status ?? r.status;
    const next: UcRecord = {
      ...r,
      versions,
      status,
      shadowStart: status === 'shadow' ? (o.shadowStart ?? r.shadowStart ?? at) : r.shadowStart,
      alertsSince: status === 'live' && liveCfg.level === 'alert' ? (prevLevel === 'alert' && r.status === 'live' ? (r.alertsSince ?? at) : at) : undefined,
    };
    next.statusNote = englishStatus(uc, next);
    return { ...all, [ucId]: next };
  });
  syncCameraCounts();
  return result;
}

// ---------- Edits in progress ----------
// Changes not yet saved as a draft, kept so a reload or a crash loses nothing.
// The set-up screens still warn before leaving with them.

export interface ConfigEdits {
  /** By use case: the working copy of its configuration. */
  useCases: Record<string, UcConfig>;
  /** By camera: zones being redrawn after a move. */
  redraws: Record<string, Zone[]>;
}

export const editStore = createStore<ConfigEdits>('config.edits', () => ({ useCases: {}, redraws: {} }));

export function setUcEdit(ucId: string, cfg: UcConfig | undefined) {
  editStore.set((s) => {
    const useCasesNext = { ...s.useCases };
    if (cfg) useCasesNext[ucId] = cfg;
    else if (useCasesNext[ucId]) delete useCasesNext[ucId];
    else return s;
    return { ...s, useCases: useCasesNext };
  });
}

export function setRedraw(cameraId: string, zones: Zone[] | undefined) {
  editStore.set((s) => {
    const redraws = { ...(s.redraws ?? {}) };
    if (zones) redraws[cameraId] = zones;
    else if (redraws[cameraId]) delete redraws[cameraId];
    else return s;
    return { ...s, redraws };
  });
}

// Follow the fleet: pushes and scene-check results waiting for a link complete
// when a convoy comes back into coverage. Deferred until every module has loaded.
if (typeof window !== 'undefined') {
  window.setTimeout(() => {
    const follow = () => {
      settlePushes();
      deliverQueuedChecks();
    };
    convoyStore.subscribe(follow);
    follow();
  }, 0);
}
