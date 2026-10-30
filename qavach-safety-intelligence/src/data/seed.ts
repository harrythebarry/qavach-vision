import { defaultZones } from '../scenes/zones';
import type { Alert, Area, Camera, Policy, Rule, Team, User, Wall } from './types';

// Sample site: a container terminal with 96 cameras. All names are placeholders.

export const SITE = { name: 'North Quay Terminal', short: 'NQT' };

export const AREAS: Area[] = [
  { id: 'quay', name: 'Quay apron · Berths 1–3', scene: 'quay', highOps: true },
  { id: 'deck', name: 'Vessel deck and gangway', scene: 'deck', highOps: true },
  { id: 'yard', name: 'Container yard · Blocks A–F', scene: 'yard', highOps: false },
  { id: 'reefer', name: 'Reefer stacks', scene: 'reefer', highOps: false },
  { id: 'gate', name: 'Gate complex', scene: 'gate', highOps: true },
  { id: 'workshop', name: 'Equipment workshop', scene: 'workshop', highOps: false },
  { id: 'hazmat', name: 'IMDG hazardous cargo bay', scene: 'hazmat', highOps: true },
  { id: 'perimeter', name: 'Perimeter and berth access', scene: 'perimeter', highOps: false },
];

const NAMES: Record<string, string[]> = {
  quay: ['STS 1 · landside', 'STS 1 · waterside', 'STS 2 · landside', 'STS 2 · waterside', 'STS 3 · landside', 'STS 3 · waterside', 'Berth 1 apron', 'Berth 2 apron', 'Berth 3 apron', 'Lashing cage B1', 'Lashing cage B2', 'Hatch cover store', 'Quay road east', 'Quay road west'],
  deck: ['Berth 1 · deck port side', 'Berth 1 · deck starboard', 'Berth 2 · gangway', 'Berth 2 · deck port side', 'Berth 2 · deck starboard', 'Berth 3 · gangway', 'Berth 3 · deck port side', 'Berth 3 · lashing bridge'],
  yard: Array.from({ length: 30 }, (_, i) => `Block ${'ABCDEF'[Math.floor(i / 5)]} · row ${(i % 5) * 6 + 2}`),
  reefer: ['Reefer R1 north', 'Reefer R1 south', 'Reefer R2 north', 'Reefer R2 south', 'Reefer R3 north', 'Reefer R3 south', 'Reefer gantry 1', 'Reefer gantry 2'],
  gate: ['In-gate lane 1', 'In-gate lane 2', 'In-gate lane 3', 'In-gate lane 4', 'Out-gate lane 1', 'Out-gate lane 2', 'Out-gate lane 3', 'Out-gate lane 4', 'Gate canopy north', 'Gate canopy south', 'Driver walkway', 'Truck holding area'],
  workshop: ['Workshop bay 1', 'Workshop bay 2', 'Workshop bay 3', 'Hot work bay', 'Tyre bay', 'Parts store', 'Wash bay', 'Workshop yard'],
  hazmat: ['IMDG bay north', 'IMDG bay south', 'IMDG gate', 'IMDG spill kit', 'Class 1 enclosure', 'Class 3 row'],
  perimeter: ['Fence east 1', 'Fence east 2', 'Fence north 1', 'Fence north 2', 'Berth 1 access gate', 'Berth 3 access gate', 'Fence west 1', 'Fence west 2', 'Rail siding gate', 'Main road gate'],
};

const PREFIX: Record<string, string> = { quay: 'QUA', deck: 'DCK', yard: 'YRD', reefer: 'RFR', gate: 'GTE', workshop: 'WSH', hazmat: 'HAZ', perimeter: 'PER' };

const MAKES = ['Axis Q1786-LE', 'Hanwha XNO-8082R', 'Bosch DINION 5100i', 'Hikvision DS-2CD5A46'];

export const camId = (area: string, n: number) => `${PREFIX[area]}-${String(n).padStart(2, '0')}`;

// Cameras the admin has drawn zones on (the rest are added but not set up yet).
const ZONED = new Set([
  'QUA-01', 'QUA-02', 'QUA-03', 'QUA-04', 'QUA-05', 'QUA-06', 'QUA-07', 'QUA-08', 'QUA-09',
  'DCK-01', 'DCK-02', 'DCK-03', 'DCK-04', 'DCK-05', 'DCK-06', 'DCK-07', 'DCK-08',
  'YRD-03', 'YRD-07', 'YRD-12', 'YRD-18', 'YRD-24',
  'RFR-01', 'RFR-03', 'RFR-07',
  'GTE-01', 'GTE-02', 'GTE-03', 'GTE-04', 'GTE-11',
  'WSH-01', 'WSH-02', 'WSH-04',
  'HAZ-01', 'HAZ-02', 'HAZ-03', 'HAZ-05',
  'PER-01', 'PER-03', 'PER-05', 'PER-06',
]);
const DEGRADED = new Set(['YRD-14', 'PER-08', 'RFR-05']);
const OFFLINE = new Set(['YRD-27', 'WSH-07']);

export function seedCameras(now: number): Camera[] {
  const out: Camera[] = [];
  let ip = 20;
  for (const a of AREAS) {
    NAMES[a.id].forEach((name, i) => {
      const id = camId(a.id, i + 1);
      const variant = i;
      out.push({
        id,
        name,
        areaId: a.id,
        scene: a.scene,
        variant,
        status: OFFLINE.has(id) ? 'offline' : DEGRADED.has(id) ? 'degraded' : 'online',
        stream: `rtsp://10.40.${Math.floor(ip / 250) + 1}.${ip++ % 250}:554/stream1`,
        make: MAKES[(i + a.id.length) % MAKES.length],
        resolution: i % 3 === 0 ? '3840 × 2160' : '2560 × 1440',
        fps: i % 3 === 0 ? 15 : 20,
        zones: ZONED.has(id) ? defaultZones(a.scene, variant, id) : [],
        addedAt: now - (40 - (i % 10)) * 86400000,
        addedBy: 'u-priya',
      });
    });
  }
  return out;
}

export const TEAMS: Team[] = [
  { id: 't-quay', name: 'Quay and marine', areaIds: ['quay', 'deck', 'perimeter'] },
  { id: 't-yard', name: 'Yard and gate', areaIds: ['yard', 'reefer', 'gate'] },
  { id: 't-hse', name: 'HSE control room', areaIds: AREAS.map((a) => a.id) },
];

export const USERS: User[] = [
  { id: 'u-priya', name: 'Priya Nair', role: 'Safety admin', teamId: 't-hse', phone: '+91 98450 11021' },
  { id: 'u-arun', name: 'Arun Kumar', role: 'Control room operator', teamId: 't-quay', phone: '+91 98450 11022' },
  { id: 'u-meera', name: 'Meera Shah', role: 'Control room operator', teamId: 't-yard', phone: '+91 98450 11023' },
  { id: 'u-rahul', name: 'Rahul Verma', role: 'Shift supervisor', teamId: 't-quay', phone: '+91 98450 11024' },
  { id: 'u-sana', name: 'Sana Iqbal', role: 'Shift supervisor', teamId: 't-yard', phone: '+91 98450 11025' },
  { id: 'u-vikram', name: 'Vikram Rao', role: 'HSE manager', teamId: 't-hse', phone: '+91 98450 11026' },
  { id: 'u-daniel', name: 'Daniel Fernandes', role: 'Terminal manager', teamId: 't-hse', phone: '+91 98450 11027' },
];

const areaCams = (cams: Camera[], ...areaIds: string[]) => cams.filter((c) => areaIds.includes(c.areaId)).map((c) => c.id);

export function seedWalls(cams: Camera[]): Wall[] {
  const quayPinned = ['QUA-03', 'DCK-03', 'QUA-08', 'DCK-04'];
  const yardPinned = ['GTE-01', 'GTE-02', 'YRD-07', 'RFR-07'];
  const hsePinned = ['HAZ-01', 'DCK-03', 'QUA-03', 'WSH-04', 'GTE-01', 'HAZ-03'];
  return [
    {
      id: 'w-quay',
      name: 'Quay and deck',
      teamId: 't-quay',
      pinnedShare: 70,
      pinnedLayout: '2x2',
      pinned: quayPinned,
      rollingTiles: 3,
      rotation: areaCams(cams, 'quay', 'deck', 'perimeter').filter((id) => !quayPinned.includes(id)),
      rotateSec: 10,
      autoPinBusy: false,
      alertTakeover: true,
    },
    {
      id: 'w-yard',
      name: 'Yard and gate',
      teamId: 't-yard',
      pinnedShare: 70,
      pinnedLayout: '2x2',
      pinned: yardPinned,
      rollingTiles: 3,
      rotation: areaCams(cams, 'yard', 'reefer', 'gate').filter((id) => !yardPinned.includes(id)),
      rotateSec: 10,
      autoPinBusy: true,
      alertTakeover: true,
    },
    {
      id: 'w-hse',
      name: 'Critical areas',
      teamId: 't-hse',
      pinnedShare: 70,
      pinnedLayout: '1+5',
      pinned: hsePinned,
      rollingTiles: 4,
      rotation: cams.map((c) => c.id).filter((id) => !hsePinned.includes(id)),
      rotateSec: 15,
      autoPinBusy: false,
      alertTakeover: true,
    },
    {
      id: 'w-tour',
      name: 'All cameras tour',
      teamId: 't-hse',
      pinnedShare: 0,
      pinnedLayout: '2x2',
      pinned: [],
      rollingTiles: 16,
      rotation: cams.map((c) => c.id),
      rotateSec: 15,
      autoPinBusy: false,
      alertTakeover: false,
    },
  ];
}

const base: Pick<Rule, 'ppe' | 'crowdOver' | 'schedule' | 'mode' | 'classification' | 'updatedBy'> = {
  ppe: [],
  crowdOver: 0,
  schedule: 'always',
  mode: 'live',
  classification: 'Unsafe act',
  updatedBy: 'u-priya',
};

export function seedRules(cams: Camera[], now: number): Rule[] {
  const zoneIds = (camIds: string[], name: string) =>
    cams.filter((c) => camIds.includes(c.id)).flatMap((c) => c.zones.filter((z) => z.name === name).map((z) => z.id));
  const deckCams = ['DCK-01', 'DCK-02', 'DCK-04', 'DCK-05', 'DCK-07'];
  const gangways = ['DCK-03', 'DCK-06'];
  const cranes = ['QUA-01', 'QUA-02', 'QUA-03', 'QUA-04', 'QUA-05', 'QUA-06'];
  const aprons = ['QUA-07', 'QUA-08', 'QUA-09', ...cranes];
  const yard = ['YRD-03', 'YRD-07', 'YRD-12', 'YRD-18', 'YRD-24'];
  const haz = ['HAZ-01', 'HAZ-02', 'HAZ-03', 'HAZ-05'];
  const gate = ['GTE-01', 'GTE-02', 'GTE-03', 'GTE-04', 'GTE-11'];
  const ws = ['WSH-01', 'WSH-02', 'WSH-04'];
  const per = ['PER-01', 'PER-03', 'PER-05', 'PER-06'];
  const t = (d: number) => now - d * 86400000;
  return [
    {
      ...base,
      id: 'R-01',
      name: 'Person away from the deck walkway',
      plainText: 'Alert me when a person moves away from the deck walkway for at least 5 seconds',
      cameraIds: [...deckCams, ...gangways],
      zoneIds: zoneIds([...deckCams, ...gangways], 'Deck walkway'),
      subject: 'person',
      condition: 'outside',
      durationSec: 5,
      schedule: 'vessel-ops',
      priority: 'P2',
      qavach: 'Observation',
      updatedAt: t(3),
    },
    {
      ...base,
      id: 'R-02',
      name: 'Person at the deck edge without a life jacket',
      cameraIds: [...deckCams, ...gangways],
      zoneIds: zoneIds([...deckCams, ...gangways], 'Deck edge'),
      subject: 'person',
      condition: 'no-ppe',
      ppe: ['life jacket'],
      durationSec: 2,
      priority: 'P1',
      qavach: 'Incident',
      updatedAt: t(3),
    },
    {
      ...base,
      id: 'R-03',
      name: 'Person inside the crane exclusion zone',
      cameraIds: cranes,
      zoneIds: zoneIds(cranes, 'Crane exclusion zone'),
      subject: 'person',
      condition: 'enters',
      durationSec: 1,
      schedule: 'vessel-ops',
      priority: 'P1',
      qavach: 'Incident',
      updatedAt: t(6),
    },
    {
      ...base,
      id: 'R-04',
      name: 'No helmet or vest on the quay apron',
      cameraIds: aprons,
      zoneIds: [],
      subject: 'person',
      condition: 'no-ppe',
      ppe: ['helmet', 'vest'],
      durationSec: 3,
      priority: 'P3',
      qavach: 'Observation',
      updatedAt: t(6),
    },
    {
      ...base,
      id: 'R-05',
      name: 'Pedestrian in an RTG lane',
      cameraIds: yard,
      zoneIds: zoneIds(yard, 'RTG lane'),
      subject: 'person',
      condition: 'enters',
      durationSec: 2,
      priority: 'P2',
      qavach: 'Near miss',
      updatedAt: t(9),
    },
    {
      ...base,
      id: 'R-06',
      name: 'Unauthorised entry to the IMDG bay',
      cameraIds: haz,
      zoneIds: zoneIds(haz, 'Bay gate'),
      subject: 'person',
      condition: 'crosses',
      durationSec: 0,
      priority: 'P1',
      qavach: 'Incident',
      classification: 'Unsafe act',
      updatedAt: t(12),
    },
    {
      ...base,
      id: 'R-07',
      name: 'Smoke or flame in the workshop',
      cameraIds: ws,
      zoneIds: [],
      subject: 'any',
      condition: 'smoke',
      durationSec: 3,
      priority: 'P1',
      qavach: 'Incident',
      classification: 'Unsafe condition',
      updatedAt: t(12),
    },
    {
      ...base,
      id: 'R-08',
      name: 'Truck stopped on the pedestrian crossing',
      cameraIds: gate,
      zoneIds: zoneIds(gate, 'Pedestrian crossing'),
      subject: 'vehicle',
      condition: 'stopped',
      durationSec: 60,
      priority: 'P4',
      qavach: 'none',
      classification: 'Unsafe condition',
      updatedAt: t(15),
    },
    {
      ...base,
      id: 'R-09',
      name: 'Fence crossed at night',
      cameraIds: per,
      zoneIds: zoneIds(per, 'Fence line'),
      subject: 'person',
      condition: 'crosses',
      durationSec: 0,
      schedule: 'night',
      priority: 'P2',
      qavach: 'Incident',
      updatedAt: t(15),
    },
    {
      ...base,
      id: 'R-10',
      name: 'More than 6 people at a gangway',
      cameraIds: gangways,
      zoneIds: [],
      subject: 'person',
      condition: 'crowd',
      crowdOver: 6,
      durationSec: 30,
      priority: 'P3',
      mode: 'test',
      qavach: 'none',
      updatedAt: t(1),
    },
    {
      ...base,
      id: 'R-11',
      name: 'Person climbing the upper reefer tiers',
      cameraIds: ['RFR-01', 'RFR-03', 'RFR-07'],
      zoneIds: zoneIds(['RFR-01', 'RFR-03', 'RFR-07'], 'Upper tiers'),
      subject: 'person',
      condition: 'enters',
      durationSec: 3,
      priority: 'P2',
      mode: 'test',
      qavach: 'Observation',
      updatedAt: t(1),
    },
  ];
}

export const POLICIES: Policy[] = [
  { priority: 'P1', label: 'Critical', channels: ['wall', 'push', 'sms', 'call'], notify: ['Shift supervisor', 'HSE manager'], ackWithinMin: 2, escalateTo: 'Terminal manager', remindEveryMin: 1, qavach: 'on-acknowledge', wallTakeover: true, sound: true },
  { priority: 'P2', label: 'High', channels: ['wall', 'push', 'whatsapp'], notify: ['Shift supervisor'], ackWithinMin: 5, escalateTo: 'HSE manager', remindEveryMin: 2, qavach: 'on-acknowledge', wallTakeover: true, sound: false },
  { priority: 'P3', label: 'Medium', channels: ['wall', 'push'], notify: ['Shift supervisor'], ackWithinMin: 15, escalateTo: 'HSE manager', remindEveryMin: 5, qavach: 'reviewer-decides', wallTakeover: false, sound: false },
  { priority: 'P4', label: 'Low', channels: ['wall', 'email'], notify: ['Control room operator'], ackWithinMin: 60, escalateTo: 'none', remindEveryMin: 0, qavach: 'never', wallTakeover: false, sound: false },
];

const MIN = 60000;

export function seedAlerts(now: number): Alert[] {
  const a = (p: Partial<Alert> & Pick<Alert, 'id' | 'ruleId' | 'cameraId' | 'priority' | 'title' | 'detail' | 'at' | 'state' | 'box'>): Alert => ({
    confidence: 0.91,
    deliveries: [],
    activity: [{ at: p.at, text: 'Detected by the edge model', actor: 'system' }],
    ...p,
  });
  return [
    a({
      id: 'ALT-1041',
      ruleId: 'R-01',
      cameraId: 'DCK-04',
      zoneId: 'DCK-04-Z1',
      priority: 'P2',
      title: 'Person away from the deck walkway',
      detail: 'Outside Deck walkway for 7 s (rule: 5 s or more)',
      at: now - 3 * MIN,
      state: 'new',
      box: [36, 50, 7, 22],
      confidence: 0.93,
      deliveries: [
        { at: now - 3 * MIN, to: 'u-arun', channel: 'wall', status: 'read', reason: 'alert' },
        { at: now - 3 * MIN, to: 'u-rahul', channel: 'push', status: 'delivered', reason: 'alert' },
        { at: now - 3 * MIN, to: 'u-rahul', channel: 'whatsapp', status: 'read', reason: 'alert' },
      ],
    }),
    a({
      id: 'ALT-1040',
      ruleId: 'R-04',
      cameraId: 'QUA-08',
      priority: 'P3',
      title: 'No helmet on the quay apron',
      detail: 'Helmet not seen for 4 s (rule: 3 s or more)',
      at: now - 11 * MIN,
      state: 'acknowledged',
      ackBy: 'u-rahul',
      ackAt: now - 8 * MIN,
      ackVia: 'mobile',
      box: [55, 62, 6, 20],
      confidence: 0.88,
      deliveries: [
        { at: now - 11 * MIN, to: 'u-arun', channel: 'wall', status: 'read', reason: 'alert' },
        { at: now - 11 * MIN, to: 'u-rahul', channel: 'push', status: 'read', reason: 'alert' },
      ],
      activity: [
        { at: now - 11 * MIN, text: 'Detected by the edge model', actor: 'system' },
        { at: now - 8 * MIN, text: 'Acknowledged on the phone · "Spoke to the lasher, helmet back on"', actor: 'u-rahul' },
      ],
    }),
    a({
      id: 'ALT-1039',
      ruleId: 'R-05',
      cameraId: 'YRD-12',
      zoneId: 'YRD-12-Z1',
      priority: 'P2',
      title: 'Pedestrian in an RTG lane',
      detail: 'Entered RTG lane while the RTG was moving',
      at: now - 26 * MIN,
      state: 'acknowledged',
      ackBy: 'u-sana',
      ackAt: now - 23 * MIN,
      ackVia: 'mobile',
      box: [58, 60, 6, 20],
      confidence: 0.95,
      deliveries: [
        { at: now - 26 * MIN, to: 'u-meera', channel: 'wall', status: 'read', reason: 'alert' },
        { at: now - 26 * MIN, to: 'u-sana', channel: 'push', status: 'read', reason: 'alert' },
        { at: now - 26 * MIN, to: 'u-sana', channel: 'whatsapp', status: 'read', reason: 'alert' },
      ],
      activity: [
        { at: now - 26 * MIN, text: 'Detected by the edge model', actor: 'system' },
        { at: now - 23 * MIN, text: 'Acknowledged on the phone', actor: 'u-sana' },
        { at: now - 22 * MIN, text: 'Near miss NM-26-0187 raised in Qavach', actor: 'u-sana' },
      ],
      qavach: {
        type: 'Near miss',
        ref: 'NM-26-0187',
        title: 'Pedestrian entered RTG lane at Block C row 14',
        description: 'A worker walked into the RTG lane at Block C while the RTG was travelling. The RTG driver stopped. Seen on YRD-12 at the time of the alert.',
        classification: 'Unsafe act',
        severity: 'High',
        immediateAction: 'Worker escorted back to the walkway; RTG driver briefed.',
        createdBy: 'u-sana',
        at: now - 22 * MIN,
        source: 'mobile',
      },
    }),
    a({
      id: 'ALT-1038',
      ruleId: 'R-08',
      cameraId: 'GTE-02',
      priority: 'P4',
      title: 'Truck stopped on the pedestrian crossing',
      detail: 'Stopped 74 s on Pedestrian crossing (rule: 60 s or more)',
      at: now - 48 * MIN,
      state: 'resolved',
      ackBy: 'u-meera',
      ackAt: now - 46 * MIN,
      ackVia: 'wall',
      box: [30, 64, 22, 20],
      confidence: 0.97,
      deliveries: [{ at: now - 48 * MIN, to: 'u-meera', channel: 'wall', status: 'read', reason: 'alert' }],
      activity: [
        { at: now - 48 * MIN, text: 'Detected by the edge model', actor: 'system' },
        { at: now - 46 * MIN, text: 'Acknowledged on the video wall', actor: 'u-meera' },
        { at: now - 41 * MIN, text: 'Resolved · truck moved on', actor: 'u-meera' },
      ],
    }),
    a({
      id: 'ALT-1037',
      ruleId: 'R-03',
      cameraId: 'QUA-03',
      zoneId: 'QUA-03-Z1',
      priority: 'P1',
      title: 'Person inside the crane exclusion zone',
      detail: 'Entered Crane exclusion zone during a lift on STS 2',
      at: now - 74 * MIN,
      state: 'resolved',
      ackBy: 'u-rahul',
      ackAt: now - 73 * MIN,
      ackVia: 'mobile',
      box: [46, 66, 6, 22],
      confidence: 0.96,
      deliveries: [
        { at: now - 74 * MIN, to: 'u-arun', channel: 'wall', status: 'read', reason: 'alert' },
        { at: now - 74 * MIN, to: 'u-rahul', channel: 'push', status: 'read', reason: 'alert' },
        { at: now - 74 * MIN, to: 'u-rahul', channel: 'sms', status: 'delivered', reason: 'alert' },
        { at: now - 74 * MIN, to: 'u-vikram', channel: 'push', status: 'read', reason: 'alert' },
        { at: now - 74 * MIN, to: 'u-vikram', channel: 'call', status: 'delivered', reason: 'alert' },
      ],
      activity: [
        { at: now - 74 * MIN, text: 'Detected by the edge model', actor: 'system' },
        { at: now - 73 * MIN, text: 'Acknowledged on the phone · crane stopped by radio', actor: 'u-rahul' },
        { at: now - 73 * MIN, text: 'Incident INC-26-0412 raised in Qavach (policy: on acknowledge)', actor: 'system' },
        { at: now - 60 * MIN, text: 'Resolved · lasher removed from under the spreader', actor: 'u-rahul' },
      ],
      qavach: {
        type: 'Incident',
        ref: 'INC-26-0412',
        title: 'Person under spreader inside STS 2 exclusion zone',
        description: 'During a discharge lift on STS 2 a lasher walked into the crane exclusion zone under the spreader. The supervisor stopped the crane by radio. Seen on QUA-03.',
        classification: 'Unsafe act',
        severity: 'Critical',
        immediateAction: 'Crane stopped, lasher removed from the zone, toolbox talk with the lashing gang.',
        createdBy: 'u-rahul',
        at: now - 73 * MIN,
        source: 'auto',
      },
    }),
    a({
      id: 'ALT-1036',
      ruleId: 'R-04',
      cameraId: 'QUA-07',
      priority: 'P3',
      title: 'No vest on the quay apron',
      detail: 'Vest not seen for 5 s (rule: 3 s or more)',
      at: now - 132 * MIN,
      state: 'false-alarm',
      ackBy: 'u-arun',
      ackAt: now - 130 * MIN,
      ackVia: 'console',
      box: [62, 58, 6, 20],
      confidence: 0.71,
      deliveries: [{ at: now - 132 * MIN, to: 'u-rahul', channel: 'push', status: 'read', reason: 'alert' }],
      activity: [
        { at: now - 132 * MIN, text: 'Detected by the edge model', actor: 'system' },
        { at: now - 130 * MIN, text: 'Marked as a false alarm · vest under a rain jacket', actor: 'u-arun' },
      ],
    }),
  ];
}
