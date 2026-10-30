import type { Camera, Convoy, EdgeUnit, Vessel } from './types';

// Sample data. Vessel names are placeholders, as on the design canvas.

const media = (name: string) => `/media/${name}.svg`;

export const convoys: Convoy[] = [
  {
    id: 'tuy',
    name: 'GF Tuyutí',
    tugId: 'tuy-tug',
    bargeIds: ['f501', 'f503'],
    voyageId: 'VOY-26-041',
    link: 'strong',
    linkLabel: '4G',
    linkMbps: 10,
    liveBudgetMbps: 2,
    lastSeen: '2026-10-15T14:36:01-03:00',
    positionLabel: 'near Rosario',
    map: { x: 13, y: 76.9 },
    queuedEvents: 0,
  },
  {
    id: 'hum',
    name: 'GF Humaitá',
    tugId: 'hum-tug',
    bargeIds: ['f505', 'f507', 'f509'],
    voyageId: 'VOY-26-039',
    link: 'none',
    linkLabel: 'None · 47 min',
    linkMbps: 0,
    liveBudgetMbps: 0,
    lastSeen: '2026-10-15T13:49:00-03:00',
    positionLabel: 'near Goya at 13:49',
    map: { x: 37.5, y: 37.7 },
    queuedEvents: 12,
  },
  {
    id: 'boq',
    name: 'GF Boquerón',
    tugId: 'boq-tug',
    bargeIds: ['f502', 'f504'],
    voyageId: 'VOY-26-040',
    link: 'strong',
    linkLabel: '4G',
    linkMbps: 10,
    liveBudgetMbps: 2,
    lastSeen: '2026-10-15T14:36:01-03:00',
    positionLabel: 'Buenos Aires',
    map: { x: 50.5, y: 90.4 },
    queuedEvents: 0,
  },
];

export const vessels: Vessel[] = [
  { id: 'tuy-tug', name: 'GF Tuyutí', short: 'Tug', kind: 'tug', convoyId: 'tuy', edgeUnitId: 'TUY-EU-01' },
  { id: 'f501', name: 'Guarán F 501', short: 'F 501', kind: 'barge', convoyId: 'tuy', edgeUnitId: 'F501-EU-01' },
  { id: 'f503', name: 'Guarán F 503', short: 'F 503', kind: 'barge', convoyId: 'tuy', edgeUnitId: 'F503-EU-01' },
  { id: 'hum-tug', name: 'GF Humaitá', short: 'Tug', kind: 'tug', convoyId: 'hum', edgeUnitId: 'HUM-EU-01' },
  { id: 'f505', name: 'Guarán F 505', short: 'F 505', kind: 'barge', convoyId: 'hum', edgeUnitId: 'F505-EU-01' },
  { id: 'f507', name: 'Guarán F 507', short: 'F 507', kind: 'barge', convoyId: 'hum', edgeUnitId: 'F507-EU-01' },
  { id: 'f509', name: 'Guarán F 509', short: 'F 509', kind: 'barge', convoyId: 'hum', edgeUnitId: 'F509-EU-01' },
  { id: 'boq-tug', name: 'GF Boquerón', short: 'Tug', kind: 'tug', convoyId: 'boq', edgeUnitId: 'BOQ-EU-01' },
  { id: 'f502', name: 'Guarán F 502', short: 'F 502', kind: 'barge', convoyId: 'boq', edgeUnitId: 'F502-EU-01' },
  { id: 'f504', name: 'Guarán F 504', short: 'F 504', kind: 'barge', convoyId: 'boq', edgeUnitId: 'F504-EU-01' },
];

type CamSeed = Omit<Camera, 'vesselId' | 'convoyId' | 'edgeUnitId' | 'lastCheck'> & { lastCheck?: string };

const tugCams = (prefix: string): CamSeed[] => [
  { id: `${prefix}-CAM-01`, name: 'Wheelhouse', position: 'Tug, wheelhouse', facing: 'Forward-facing', stream: '1080p30', fpsToAi: 5, health: 'healthy', zones: 0, useCases: 1, image: media('cam-wheelhouse') },
  { id: `${prefix}-CAM-02`, name: 'Engine room', position: 'Tug, engine room', facing: 'Overhead', stream: '1080p30', fpsToAi: 5, health: 'healthy', zones: 1, useCases: 2, image: media('cam-engine-room') },
  { id: `${prefix}-CAM-03`, name: 'Bow forward', position: 'Tug, bow', facing: 'Forward-facing', stream: '1080p30', fpsToAi: 12, health: 'healthy', zones: 1, useCases: 2, image: media('cam-bow-forward') },
];

const bargeCams = (prefix: string, reeferRow: number): CamSeed[] => [
  { id: `${prefix}-CAM-01`, name: 'Deck forward', position: 'Barge, deck', facing: 'Forward-facing', stream: '1080p30', fpsToAi: 5, health: 'healthy', zones: 2, useCases: 4, image: media('cam-deck-forward') },
  { id: `${prefix}-CAM-02`, name: 'Port edge', position: 'Barge, port side', facing: 'Aft-facing', stream: '1080p30', fpsToAi: 5, health: 'healthy', zones: 2, useCases: 3, image: media('cam-port-edge') },
  { id: `${prefix}-CAM-03`, name: `Reefer row ${reeferRow}`, position: 'Barge, reefer row', facing: 'Aft-facing', stream: '1080p30', fpsToAi: 5, health: 'healthy', zones: 1, useCases: 4, image: media('cam-reefer-row') },
];

const prefixes: Record<string, string> = {
  'tuy-tug': 'TUY', f501: 'F501', f503: 'F503',
  'hum-tug': 'HUM', f505: 'F505', f507: 'F507', f509: 'F509',
  'boq-tug': 'BOQ', f502: 'F502', f504: 'F504',
};

let reefer = 0;
export const cameras: Camera[] = vessels.flatMap((v) => {
  const prefix = prefixes[v.id];
  if (v.kind === 'barge') reefer += 1;
  const seeds = v.kind === 'tug' ? tugCams(prefix) : bargeCams(prefix, v.convoyId === 'tuy' ? reefer : 1);
  return seeds.map((c) => ({
    ...c,
    vesselId: v.id,
    convoyId: v.convoyId,
    edgeUnitId: v.edgeUnitId,
    lastCheck: v.convoyId === 'hum' ? '13:30' : '14:30',
  }));
});

// The two cameras the designs single out.
const bow = cameras.find((c) => c.id === 'TUY-CAM-03');
if (bow) {
  bow.health = 'degraded';
  bow.healthNote = 'Blurred since 13:20';
}
const alarmCam = cameras.find((c) => c.id === 'F503-CAM-02');
if (alarmCam) alarmCam.image = media('cam-barge-port-edge-alarm');

const unit = (
  id: string,
  vesselId: string,
  convoyId: string,
  rest: Partial<EdgeUnit>,
): EdgeUnit => ({
  id,
  vesselId,
  convoyId,
  module: 'Orin NX 16GB',
  cameras: 3,
  status: 'reporting',
  link: '4G 0.4 Mbps',
  queue: { events: 0, clips: 0 },
  modelVersion: 'v1.4.2',
  modelConfirmed: true,
  storagePct: 30,
  tempC: 50,
  uptimeDays: 41,
  gpuPct: 58,
  inferenceMs: 8,
  ...rest,
});

const offline: Partial<EdgeUnit> = {
  status: 'out_of_coverage',
  statusNote: 'Out of coverage since 13:49',
  link: 'None 47 min',
  modelVersion: 'v1.4.1',
  modelConfirmed: false,
  uptimeDays: 63,
};

export const edgeUnits: EdgeUnit[] = [
  unit('TUY-EU-01', 'tuy-tug', 'tuy', { link: '4G 0.5 Mbps', storagePct: 28, tempC: 52 }),
  unit('F501-EU-01', 'f501', 'tuy', { storagePct: 34, tempC: 49 }),
  unit('F503-EU-01', 'f503', 'tuy', { storagePct: 29, tempC: 51, gpuPct: 61 }),
  unit('HUM-EU-01', 'hum-tug', 'hum', { ...offline, queue: { events: 4, clips: 2 }, storagePct: 36, tempC: 54 }),
  unit('F505-EU-01', 'f505', 'hum', { ...offline, queue: { events: 3, clips: 1 }, storagePct: 33, tempC: 50 }),
  unit('F507-EU-01', 'f507', 'hum', { ...offline, queue: { events: 2, clips: 1 }, storagePct: 31, tempC: 50 }),
  unit('F509-EU-01', 'f509', 'hum', { ...offline, queue: { events: 3, clips: 1 }, storagePct: 30, tempC: 53 }),
  unit('BOQ-EU-01', 'boq-tug', 'boq', { link: '4G 0.3 Mbps', storagePct: 27, tempC: 47, uptimeDays: 12 }),
  unit('F502-EU-01', 'f502', 'boq', { link: '4G 0.3 Mbps', storagePct: 32, tempC: 46, uptimeDays: 12 }),
  unit('F504-EU-01', 'f504', 'boq', { cameras: 4, link: '4G 0.2 Mbps', storagePct: 30, tempC: 48, uptimeDays: 12 }),
];

// ---------- Lookups ----------

export const convoyById = (id?: string) => convoys.find((c) => c.id === id);
export const vesselById = (id?: string) => vessels.find((v) => v.id === id);
export const cameraById = (id?: string) => cameras.find((c) => c.id === id);
export const edgeUnitById = (id?: string) => edgeUnits.find((u) => u.id === id);

export const vesselsOf = (convoyId: string) => vessels.filter((v) => v.convoyId === convoyId);
export const camerasOf = (convoyId: string) => cameras.filter((c) => c.convoyId === convoyId);
export const camerasOnVessel = (vesselId: string) => cameras.filter((c) => c.vesselId === vesselId);

/** "Guarán F 503 · Port edge" */
export const cameraLabel = (cameraId?: string) => {
  const cam = cameraById(cameraId);
  if (!cam) return '';
  return `${vesselById(cam.vesselId)?.name ?? ''} · ${cam.name}`;
};
