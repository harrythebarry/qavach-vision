import { SCENARIO_START, initialAlarms, initialReviewEvents, voyages } from '../../data/alarms';
// The voyage history below is built once from the Connect snapshot at 14:36:20
// (the seed fleet), so it is the same on every reload. Everything that changes
// while the console runs (link, queued events, new alarms, reviews) comes from
// the live stores through liveVoyage().
import { cameras as snapshotCameras, convoys as snapshotConvoys, vessels } from '../../data/fleet';
import { useCaseById } from '../../data/useCases';
import { ARCHIVED_ALARMS } from '../alarms/alarmConsoleData';
import type { Alarm, AuditEntry, Classification, Convoy, LinkState, Priority, ReviewEvent, Vessel, Voyage } from '../../data/types';
import { fmtDay, fmtDayTime, fmtTime, fmtWeekday } from '../../lib/time';

// Voyage detail as it would arrive from Connect (schedule, calls, cargo lists,
// reefer round times) joined with what the cameras saw (port times, rounds,
// container counts, events). VOY-26-041 follows the design canvas exactly; the
// other voyages are built from the same kind of spec so every record is complete.

export type Tr = (en: string, es: string) => string;
export type Lang = 'en' | 'es';

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
/** Asunción is UTC−3 all year. */
const TZ_OFFSET = -3 * HOUR;

export const SNAPSHOT = new Date(SCENARIO_START).getTime();
/** VOY-03: a round is on time when someone is seen within this many minutes. */
export const TOLERANCE_MIN = 15;
/** An unseen round counts as missed this long after the schedule. */
export const MISSED_AFTER_MIN = 60;
export const ROUND_EVERY_H = 6;
export const SYNC_EVERY_MIN = 5;

const at = (monthDay: string, hm: string) => new Date(`2026-${monthDay}T${hm}:00-03:00`).getTime();

const mod = (a: number, b: number) => ((a % b) + b) % b;
/** Start of the local (Asunción) block of `step` ms that contains `ms`. */
export const alignLocal = (ms: number, step: number) => ms - mod(ms + TZ_OFFSET, step);

export function hashInt(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** "+10 min", "−40 min", "+1 h 45 min", "on schedule" */
export function fmtDelta(ms: number, tr: Tr): string {
  const m = Math.round(ms / MIN);
  const sign = m < 0 ? '−' : '+';
  const a = Math.abs(m);
  if (a === 0) return tr('on schedule', 'según horario');
  if (a < 60) return `${sign}${a} min`;
  return `${sign}${Math.floor(a / 60)} h${a % 60 ? ` ${a % 60} min` : ''}`;
}

/** Last Connect sync, every 5 minutes. */
export const lastSync = (now: number) => now - mod(now, SYNC_EVERY_MIN * MIN);
/** The sync that carries something received at `t`. */
export const syncAfter = (t: number) => t - mod(t, SYNC_EVERY_MIN * MIN) + SYNC_EVERY_MIN * MIN;

// ---------- Types ----------

export interface ScheduleSeg {
  kind: 'port' | 'underway';
  from: number;
  to: number;
  label: string;
  labelEs: string;
  cargoOps?: boolean;
}

export interface PortCall {
  port: string;
  kind: 'departure' | 'arrival';
  scheduled: number;
  /** Actual time from video (VOY-05). */
  actual?: number;
  sentAt?: number;
}

export interface LinkSeg {
  state: LinkState;
  from: number;
  /** null = still in this state now */
  to: number | null;
}

export interface CargoDiff {
  container: string;
  kind: 'not_seen' | 'not_listed';
}

export interface CargoCheck {
  bargeId: string;
  list: number;
  counted: number;
  countedAt: number;
  port: string;
  cameraId: string;
  differences: CargoDiff[];
  /** Sent to Connect by the event service at departure. */
  sentAt?: number;
  /** The cargo list as Connect holds it. */
  containers: string[];
}

interface RoundSpec {
  bargeId: string;
  first: number;
  count: number;
  /** Minutes after schedule someone was seen; null = not seen. Defaults to a few minutes. */
  seen?: Record<number, number | null>;
}

export type RoundResult = 'on_time' | 'late' | 'missed' | 'overdue' | 'due' | 'queued';

export interface Round {
  key: string;
  bargeId: string;
  cameraId: string;
  scheduled: number;
  seen?: number;
  result: RoundResult;
  /** Late by / overdue by, in minutes. */
  minutes?: number;
}

export type EventStatus = 'alarm' | 'to_review' | 'accepted' | 'rejected' | 'false_alert';

export interface VoyageEvent {
  /** Unique row key: the alarm id for alarm events, else the event id. */
  key: string;
  id: string;
  at: number;
  useCaseId: string;
  vesselId: string;
  cameraId: string;
  status: EventStatus;
  alarmId?: string;
  confidence: number;
  /** history: on the record before the console opened; alarm/review: arrived while it runs. */
  source: 'history' | 'alarm' | 'review';
  shadow?: boolean;
  /** Arrived ashore late, queued on board while the convoy was out of coverage. */
  late?: boolean;
  receivedAt?: number;
  falseReason?: string;
}

export type ArchivedOutcome = { kind: 'accepted'; briefed?: boolean } | { kind: 'late'; seenAt: number; minutes: number } | { kind: 'missed' };

/** An alarm on the voyage that is no longer in the live alarm store (closed and archived with the voyage). */
export interface ArchivedAlarm {
  id: string;
  priority: Priority;
  title: string;
  titleEs: string;
  useCaseId: string;
  raisedAt: number;
  vesselId: string;
  cameraId: string;
  outcome: ArchivedOutcome;
}

interface VoyageSpec {
  id: string;
  windowStart: number;
  windowEnd: number;
  schedule: ScheduleSeg[];
  calls: PortCall[];
  rounds: RoundSpec[];
  link: [number, number | null, LinkState][];
  cargo: Omit<CargoCheck, 'cameraId' | 'containers'>[];
  /** Events per local 6-hour block, from the block holding the first departure. */
  eventBlocks?: number[];
  reportSentAt?: number;
}

export interface VoyageRecord {
  voyage: Voyage;
  tug?: Vessel;
  barges: Vessel[];
  window: { start: number; end: number };
  schedule: ScheduleSeg[];
  calls: PortCall[];
  roundSpecs: RoundSpec[];
  /** Link to shore up to the snapshot; liveVoyage() extends it. */
  link: LinkSeg[];
  cargo: CargoCheck[];
  /** Events on the record at the snapshot, newest first. */
  events: VoyageEvent[];
  archivedAlarms: ArchivedAlarm[];
  /** Closed alarms the alarm console keeps for this voyage (readable there). */
  consoleAlarms: Alarm[];
  departure: number;
  /** Scheduled days from departure to the last arrival. */
  plannedDays: number;
  reportSentAt?: number;
  arrivalPort: string;
  departurePort: string;
}

// ---------- Specs ----------

const inPort = (place: string, from: number, to: number, cargoOps = false): ScheduleSeg => ({
  kind: 'port',
  from,
  to,
  cargoOps,
  label: `In port, ${place}${cargoOps ? ' · cargo operations' : ''}`,
  labelEs: `En puerto, ${place}${cargoOps ? ' · operaciones de carga' : ''}`,
});
const underWay = (a: string, b: string, from: number, to: number): ScheduleSeg => ({
  kind: 'underway',
  from,
  to,
  label: `Under way, ${a} to ${b}`,
  labelEs: `Navegando, ${a} a ${b}`,
});

const specs: VoyageSpec[] = [
  {
    id: 'VOY-26-041',
    windowStart: at('10-11', '00:00'),
    windowEnd: at('10-18', '00:00'),
    schedule: [
      inPort('Asunción', at('10-11', '00:00'), at('10-11', '06:00')),
      underWay('Asunción', 'Buenos Aires', at('10-11', '06:00'), at('10-16', '22:00')),
      inPort('Buenos Aires', at('10-16', '22:00'), at('10-17', '06:00')),
      underWay('Buenos Aires', 'Montevideo', at('10-17', '06:00'), at('10-17', '18:00')),
      inPort('Montevideo', at('10-17', '18:00'), at('10-18', '00:00')),
    ],
    calls: [
      { port: 'Asunción', kind: 'departure', scheduled: at('10-11', '06:00'), actual: at('10-11', '06:10'), sentAt: at('10-11', '06:12') },
      { port: 'Buenos Aires', kind: 'arrival', scheduled: at('10-16', '22:00') },
      { port: 'Montevideo', kind: 'arrival', scheduled: at('10-17', '18:00') },
    ],
    rounds: [
      { bargeId: 'f501', first: at('10-11', '08:00'), count: 27, seen: { 10: 41, 11: null, 17: null } },
      { bargeId: 'f503', first: at('10-11', '08:00'), count: 27 },
    ],
    link: [
      [at('10-11', '06:10'), at('10-11', '15:00'), 'strong'],
      [at('10-11', '15:00'), at('10-11', '20:10'), 'weak'],
      [at('10-11', '20:10'), at('10-12', '03:00'), 'none'],
      [at('10-12', '03:00'), at('10-13', '02:30'), 'strong'],
      [at('10-13', '02:30'), at('10-13', '07:30'), 'weak'],
      [at('10-13', '07:30'), at('10-13', '15:45'), 'strong'],
      [at('10-13', '15:45'), at('10-13', '20:50'), 'none'],
      [at('10-13', '20:50'), at('10-15', '01:30'), 'strong'],
      [at('10-15', '01:30'), at('10-15', '04:50'), 'weak'],
      [at('10-15', '04:50'), null, 'strong'],
    ],
    cargo: [
      { bargeId: 'f501', list: 46, counted: 46, countedAt: at('10-11', '06:35'), port: 'Asunción', differences: [] },
      {
        bargeId: 'f503',
        list: 38,
        counted: 37,
        countedAt: at('10-11', '06:35'),
        port: 'Asunción',
        differences: [{ container: 'GFSU 418220-3', kind: 'not_seen' }],
        sentAt: at('10-11', '06:42'),
      },
    ],
    // 41 events at the snapshot, as on the design canvas: the last block holds 4 alarms and 4 of
    // the 6 events waiting in the review queue, so it counts 8.
    eventBlocks: [1, 2, 2, 1, 2, 3, 2, 1, 2, 2, 1, 3, 2, 2, 3, 1, 3, 4],
  },
  {
    id: 'VOY-26-039',
    windowStart: at('10-12', '00:00'),
    windowEnd: at('10-21', '00:00'),
    schedule: [
      inPort('Montevideo', at('10-12', '00:00'), at('10-12', '19:15')),
      underWay('Montevideo', 'Asunción', at('10-12', '19:15'), at('10-20', '08:00')),
      inPort('Asunción', at('10-20', '08:00'), at('10-21', '00:00')),
    ],
    calls: [
      { port: 'Montevideo', kind: 'departure', scheduled: at('10-12', '19:15'), actual: at('10-12', '19:30'), sentAt: at('10-12', '19:33') },
      { port: 'Asunción', kind: 'arrival', scheduled: at('10-20', '08:00') },
    ],
    rounds: [
      { bargeId: 'f505', first: at('10-12', '20:00'), count: 30 },
      { bargeId: 'f507', first: at('10-12', '20:00'), count: 30 },
    ],
    link: [
      [at('10-12', '19:30'), at('10-13', '09:00'), 'strong'],
      [at('10-13', '09:00'), at('10-13', '14:00'), 'weak'],
      [at('10-13', '14:00'), at('10-14', '18:00'), 'strong'],
      [at('10-14', '18:00'), at('10-14', '22:30'), 'none'],
      [at('10-14', '22:30'), at('10-15', '11:30'), 'strong'],
      [at('10-15', '11:30'), at('10-15', '13:49'), 'weak'],
      [at('10-15', '13:49'), null, 'none'],
    ],
    cargo: [
      { bargeId: 'f505', list: 52, counted: 52, countedAt: at('10-12', '19:50'), port: 'Montevideo', differences: [] },
      { bargeId: 'f507', list: 40, counted: 40, countedAt: at('10-12', '19:50'), port: 'Montevideo', differences: [] },
      { bargeId: 'f509', list: 36, counted: 36, countedAt: at('10-12', '19:50'), port: 'Montevideo', differences: [] },
    ],
  },
  {
    id: 'VOY-26-040',
    windowStart: at('10-08', '00:00'),
    windowEnd: at('10-17', '00:00'),
    schedule: [
      inPort('Asunción', at('10-08', '00:00'), at('10-08', '05:30')),
      underWay('Asunción', 'Buenos Aires', at('10-08', '05:30'), at('10-13', '16:00')),
      inPort('Buenos Aires', at('10-13', '16:00'), at('10-16', '06:00'), true),
    ],
    calls: [
      { port: 'Asunción', kind: 'departure', scheduled: at('10-08', '05:30'), actual: at('10-08', '05:40'), sentAt: at('10-08', '05:43') },
      { port: 'Buenos Aires', kind: 'arrival', scheduled: at('10-13', '16:00'), actual: at('10-13', '15:20'), sentAt: at('10-13', '15:24') },
      { port: 'Buenos Aires', kind: 'departure', scheduled: at('10-16', '06:00') },
    ],
    rounds: [
      { bargeId: 'f502', first: at('10-08', '08:00'), count: 21 },
      { bargeId: 'f504', first: at('10-08', '14:00'), count: 20, seen: { 7: 24 } },
    ],
    link: [
      [at('10-08', '05:40'), at('10-09', '10:00'), 'strong'],
      [at('10-09', '10:00'), at('10-09', '16:00'), 'weak'],
      [at('10-09', '16:00'), at('10-11', '03:00'), 'strong'],
      [at('10-11', '03:00'), at('10-11', '07:00'), 'none'],
      [at('10-11', '07:00'), null, 'strong'],
    ],
    cargo: [
      { bargeId: 'f502', list: 44, counted: 44, countedAt: at('10-08', '06:05'), port: 'Asunción', differences: [] },
      { bargeId: 'f504', list: 50, counted: 50, countedAt: at('10-08', '06:05'), port: 'Asunción', differences: [] },
    ],
  },
  {
    id: 'VOY-26-037',
    windowStart: at('10-01', '00:00'),
    windowEnd: at('10-10', '00:00'),
    schedule: [
      inPort('Montevideo', at('10-01', '00:00'), at('10-01', '06:30')),
      underWay('Montevideo', 'Buenos Aires', at('10-01', '06:30'), at('10-02', '06:00')),
      inPort('Buenos Aires', at('10-02', '06:00'), at('10-02', '18:00')),
      underWay('Buenos Aires', 'Asunción', at('10-02', '18:00'), at('10-09', '10:00')),
      inPort('Asunción', at('10-09', '10:00'), at('10-10', '00:00')),
    ],
    calls: [
      { port: 'Montevideo', kind: 'departure', scheduled: at('10-01', '06:30'), actual: at('10-01', '07:00'), sentAt: at('10-01', '07:03') },
      { port: 'Buenos Aires', kind: 'arrival', scheduled: at('10-02', '06:00'), actual: at('10-02', '06:25'), sentAt: at('10-02', '06:28') },
      { port: 'Buenos Aires', kind: 'departure', scheduled: at('10-02', '18:00'), actual: at('10-02', '18:05'), sentAt: at('10-02', '18:08') },
      { port: 'Asunción', kind: 'arrival', scheduled: at('10-09', '10:00'), actual: at('10-09', '11:20'), sentAt: at('10-09', '11:23') },
    ],
    rounds: [
      { bargeId: 'f501', first: at('10-02', '20:00'), count: 23, seen: { 3: 27 } },
      { bargeId: 'f503', first: at('10-02', '20:00'), count: 23, seen: { 9: null } },
    ],
    link: [
      [at('10-01', '07:00'), at('10-03', '04:00'), 'strong'],
      [at('10-03', '04:00'), at('10-03', '09:00'), 'none'],
      [at('10-03', '09:00'), at('10-05', '22:00'), 'strong'],
      [at('10-05', '22:00'), at('10-06', '03:00'), 'weak'],
      [at('10-06', '03:00'), at('10-09', '11:20'), 'strong'],
    ],
    cargo: [
      {
        bargeId: 'f501',
        list: 46,
        counted: 45,
        countedAt: at('10-02', '18:20'),
        port: 'Buenos Aires',
        differences: [{ container: 'GFSU 402117-6', kind: 'not_seen' }],
        sentAt: at('10-02', '18:31'),
      },
      {
        bargeId: 'f503',
        list: 40,
        counted: 41,
        countedAt: at('10-02', '18:20'),
        port: 'Buenos Aires',
        differences: [{ container: 'TCLU 778301-2', kind: 'not_listed' }],
        sentAt: at('10-02', '18:31'),
      },
    ],
    reportSentAt: at('10-09', '11:50'),
  },
  {
    id: 'VOY-26-036',
    windowStart: at('09-28', '00:00'),
    windowEnd: at('10-07', '00:00'),
    schedule: [
      inPort('Buenos Aires', at('09-28', '00:00'), at('09-28', '15:30')),
      underWay('Buenos Aires', 'Asunción', at('09-28', '15:30'), at('10-06', '08:00')),
      inPort('Asunción', at('10-06', '08:00'), at('10-07', '00:00')),
    ],
    calls: [
      { port: 'Buenos Aires', kind: 'departure', scheduled: at('09-28', '15:30'), actual: at('09-28', '16:00'), sentAt: at('09-28', '16:04') },
      { port: 'Asunción', kind: 'arrival', scheduled: at('10-06', '08:00'), actual: at('10-06', '09:45'), sentAt: at('10-06', '09:49') },
    ],
    rounds: [
      { bargeId: 'f502', first: at('09-28', '20:00'), count: 19 },
      { bargeId: 'f504', first: at('09-28', '20:00'), count: 19 },
    ],
    link: [
      [at('09-28', '16:00'), at('09-30', '12:00'), 'strong'],
      [at('09-30', '12:00'), at('09-30', '18:00'), 'weak'],
      [at('09-30', '18:00'), at('10-03', '01:00'), 'strong'],
      [at('10-03', '01:00'), at('10-03', '06:00'), 'none'],
      [at('10-03', '06:00'), at('10-06', '09:45'), 'strong'],
    ],
    cargo: [
      { bargeId: 'f502', list: 42, counted: 42, countedAt: at('09-28', '16:20'), port: 'Buenos Aires', differences: [] },
      { bargeId: 'f504', list: 48, counted: 48, countedAt: at('09-28', '16:20'), port: 'Buenos Aires', differences: [] },
    ],
    reportSentAt: at('10-06', '10:15'),
  },
];

/** A plain record for a voyage Connect sends without a detailed spec here. */
function fallbackSpec(v: Voyage): VoyageSpec {
  const dep = new Date(v.departedAt).getTime();
  const start = alignLocal(dep, DAY);
  const end = start + 8 * DAY;
  const [from, to] = v.route.split(' to ');
  const barges = vessels.filter((x) => x.convoyId === v.convoyId && x.kind === 'barge');
  return {
    id: v.id,
    windowStart: start,
    windowEnd: end,
    schedule: [underWay(from ?? '', to ?? '', dep, end - 12 * HOUR)],
    calls: [
      { port: from ?? '—', kind: 'departure', scheduled: dep, actual: dep },
      { port: to ?? '—', kind: 'arrival', scheduled: end - 12 * HOUR },
    ],
    rounds: barges.slice(0, 1).map((b) => ({ bargeId: b.id, first: dep + 2 * HOUR, count: v.reeferOnTime[1] })),
    link: [[dep, null, 'strong']],
    cargo: [],
  };
}

// ---------- Container numbers (ISO 6346) for the cargo lists Connect holds ----------

const LETTER: Record<string, number> = {};
(() => {
  let n = 10;
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    if (n % 11 === 0) n += 1;
    LETTER[ch] = n;
    n += 1;
  }
})();

function containerNumber(owner: string, serial: number): string {
  const s = String(serial).padStart(6, '0');
  const chars = `${owner}${s}`;
  let sum = 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const v = /\d/.test(c) ? Number(c) : LETTER[c];
    sum += v * 2 ** i;
  }
  return `${owner} ${s}-${(sum % 11) % 10}`;
}

const OWNERS = ['GFSU', 'GFSU', 'GFSU', 'TCLU', 'MSCU', 'CMAU'];

function cargoList(voyageId: string, c: Omit<CargoCheck, 'cameraId' | 'containers'>): string[] {
  const out = c.differences.filter((d) => d.kind === 'not_seen').map((d) => d.container);
  const skip = new Set(c.differences.map((d) => d.container));
  let k = 0;
  while (out.length < c.list) {
    const h = hashInt(`${voyageId}-${c.bargeId}-${k++}`);
    const num = containerNumber(OWNERS[h % OWNERS.length], 100000 + (h % 899999));
    if (!skip.has(num) && !out.includes(num)) out.push(num);
  }
  return out.sort();
}

// ---------- Builder ----------

const usedAlarmIds = new Set([...initialAlarms, ...ARCHIVED_ALARMS].map((a) => a.id));

const EVENT_USE_CASES = ['hard-hat-vest', 'container-doors', 'outside-work', 'hard-hat-vest', 'smoking', 'container-doors', 'obstacle', 'outside-work'];
const ARCHIVE_USE_CASES = ['hard-hat-vest', 'container-doors', 'obstacle'];
const ARCHIVE_TITLES: Record<string, [string, string]> = {
  'hard-hat-vest': ['Hard hat missing', 'Falta casco'],
  'container-doors': ['Container doors open', 'Puertas de contenedor abiertas'],
  obstacle: ['Obstacle ahead', 'Obstáculo adelante'],
};
const EVENT_BASE: Record<string, number> = {
  'VOY-26-036': 120,
  'VOY-26-037': 170,
  'VOY-26-040': 230,
  'VOY-26-039': 286,
  'VOY-26-041': 269,
};

const pad4 = (n: number) => String(n).padStart(4, '0');
const numOf = (id: string) => Number(id.slice(-4));

function cameraFor(vesselId: string, useCaseId: string): string {
  const cams = snapshotCameras.filter((c) => c.vesselId === vesselId);
  const v = vessels.find((x) => x.id === vesselId);
  if (v?.kind === 'tug') return cams[2]?.id ?? cams[0]?.id ?? '';
  const idx = useCaseId === 'reefer-rounds' ? 2 : useCaseId === 'outside-work' || useCaseId === 'life-jacket' ? 1 : 0;
  return cams[idx]?.id ?? cams[0]?.id ?? '';
}

/** Reefer row camera on a barge. */
export const reeferCamera = (bargeId: string) => cameraFor(bargeId, 'reefer-rounds');

function defaultSeenOffset(bargeId: string, i: number) {
  return 1 + (hashInt(`${bargeId}-${i}`) % 11);
}

interface AlarmSeed {
  at: number;
  useCaseId: string;
  vesselId: string;
  cameraId: string;
  id: string;
  eventId?: string;
}

/** Event id prefix for a voyage: EV-26-041- */
export const eventPrefix = (voyageId: string) => `EV-26-${voyageId.slice(-3)}-`;

function build(v: Voyage, spec: VoyageSpec): VoyageRecord {
  const snapConvoy = snapshotConvoys.find((c) => c.id === v.convoyId);
  const vs = vessels.filter((x) => x.convoyId === v.convoyId);
  const tug = vs.find((x) => x.kind === 'tug');
  const barges = vs.filter((x) => x.kind === 'barge');
  // At the snapshot GF Humaitá is out of coverage: its record stops at the last health message.
  const queuedAtSnapshot = snapConvoy && snapConvoy.link === 'none' && v.status !== 'completed' ? new Date(snapConvoy.lastSeen).getTime() : undefined;
  const lastArrival = spec.calls.filter((c) => c.kind === 'arrival' && c.actual).at(-1)?.actual;
  const eventsUntil = v.status === 'completed' && lastArrival ? Math.min(lastArrival, SNAPSHOT) : (queuedAtSnapshot ?? SNAPSHOT);
  const departureCall = spec.calls.find((c) => c.kind === 'departure');
  const departure = departureCall?.actual ?? new Date(v.departedAt).getTime();
  const prefix = eventPrefix(v.id);

  // Alarm seeds: real alarms (store and console archive), then reefer exceptions without one, then archived ones.
  const real = [...initialAlarms, ...ARCHIVED_ALARMS.filter((x) => !initialAlarms.some((a) => a.id === x.id))].filter((a) => a.voyageId === v.id);
  const seeds: AlarmSeed[] = real.map((a) => ({
    at: new Date(a.raisedAt).getTime(),
    useCaseId: a.useCaseId,
    vesselId: a.vesselId ?? tug?.id ?? '',
    cameraId: a.cameraId ?? '',
    id: a.id,
    eventId: a.eventId,
  }));
  // Events already in the review queue at the snapshot belong to the record too; they come from the live store.
  const queueSeeds = initialReviewEvents.filter((e) => e.id.startsWith(prefix)).map((e) => new Date(e.at).getTime());

  const archived: ArchivedAlarm[] = [];
  const nextAlarmId = (near: number) => {
    let n = near;
    while (usedAlarmIds.has(`ALM-26-${pad4(n)}`)) n += 1;
    const id = `ALM-26-${pad4(n)}`;
    usedAlarmIds.add(id);
    return id;
  };

  // Reefer round exceptions in the past need an alarm on record.
  spec.rounds.forEach((r) => {
    for (let i = 0; i < r.count; i++) {
      const sched = r.first + i * ROUND_EVERY_H * HOUR;
      const raised = sched + TOLERANCE_MIN * MIN;
      if (raised > eventsUntil) break;
      const s = r.seen?.[i];
      const isLate = typeof s === 'number' && s > TOLERANCE_MIN;
      const isMissed = s === null && sched + MISSED_AFTER_MIN * MIN <= eventsUntil;
      if (!isLate && !isMissed) continue;
      const exists = real.some((a) => a.useCaseId === 'reefer-rounds' && a.vesselId === r.bargeId && Math.abs(new Date(a.raisedAt).getTime() - raised) < MIN);
      if (exists) continue;
      const id = nextAlarmId((EVENT_BASE[v.id] ?? 100) + 40 + archived.length * 3);
      const cameraId = reeferCamera(r.bargeId);
      archived.push({
        id,
        priority: 'P3',
        title: `${fmtTime(sched)} reefer round not seen`,
        titleEs: `Ronda de reefers de las ${fmtTime(sched)} no vista`,
        useCaseId: 'reefer-rounds',
        raisedAt: raised,
        vesselId: r.bargeId,
        cameraId,
        outcome: isLate ? { kind: 'late', seenAt: sched + (s as number) * MIN, minutes: s as number } : { kind: 'missed' },
      });
      seeds.push({ at: raised, useCaseId: 'reefer-rounds', vesselId: r.bargeId, cameraId, id });
    }
  });

  // Blocks of 6 hours from the first departure.
  const firstBlock = alignLocal(departure, ROUND_EVERY_H * HOUR);
  const blocks: number[] = [];
  for (let b = firstBlock; b < eventsUntil; b += ROUND_EVERY_H * HOUR) blocks.push(b);
  const blockOf = (t: number) => Math.max(0, Math.min(blocks.length - 1, Math.floor((t - firstBlock) / (ROUND_EVERY_H * HOUR))));

  // Archived alarms fill up to the alarm total Connect reports.
  const archivedNeeded = Math.max(0, v.alarms - seeds.length);
  for (let k = 0; k < archivedNeeded; k++) {
    const span = eventsUntil - departure;
    const t = Math.round(departure + (span * (k + 0.5)) / archivedNeeded + ((hashInt(`${v.id}-a${k}`) % 120) - 60) * MIN);
    const useCaseId = ARCHIVE_USE_CASES[hashInt(`${v.id}-u${k}`) % ARCHIVE_USE_CASES.length];
    const vesselId = useCaseId === 'obstacle' ? (tug?.id ?? barges[0]?.id ?? '') : (barges[hashInt(`${v.id}-b${k}`) % Math.max(1, barges.length)]?.id ?? '');
    const cameraId = cameraFor(vesselId, useCaseId);
    const id = nextAlarmId((EVENT_BASE[v.id] ?? 100) + 5 + k * 6);
    const [title, titleEs] = ARCHIVE_TITLES[useCaseId] ?? ['Alarm', 'Alarma'];
    archived.push({ id, priority: 'P3', title, titleEs, useCaseId, raisedAt: t, vesselId, cameraId, outcome: { kind: 'accepted', briefed: k % 3 === 1 } });
    seeds.push({ at: t, useCaseId, vesselId, cameraId, id });
  }

  // Events per block (alarms and queued review events count towards the block total).
  const fixed = blocks.map(() => 0);
  seeds.forEach((s) => (fixed[blockOf(s.at)] += 1));
  queueSeeds.forEach((t) => (fixed[blockOf(t)] += 1));
  const counts = [...fixed];
  if (spec.eventBlocks && spec.eventBlocks.length === blocks.length) {
    spec.eventBlocks.forEach((n, i) => (counts[i] = Math.max(n, fixed[i])));
  } else {
    const remaining = Math.max(0, v.events - seeds.length - queueSeeds.length);
    const weights = blocks.map((_, i) => 1 + (hashInt(`${v.id}-w${i}`) % 4));
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    const shares = weights.map((w) => (remaining * w) / total);
    const floors = shares.map(Math.floor);
    let left = remaining - floors.reduce((a, b) => a + b, 0);
    const order = shares.map((s, i) => [s - Math.floor(s), i] as const).sort((a, b) => b[0] - a[0]);
    for (const [, i] of order) {
      if (left <= 0) break;
      floors[i] += 1;
      left -= 1;
    }
    floors.forEach((n, i) => (counts[i] += n));
  }

  // Generated events inside each block, spread evenly around the alarms. All of them were reviewed;
  // what still waits for review is in the live review queue.
  type Draft = Omit<VoyageEvent, 'id' | 'key' | 'status' | 'source'> & { status?: EventStatus; eventId?: string };
  const drafts: Draft[] = seeds.map((s) => ({
    at: s.at,
    useCaseId: s.useCaseId,
    vesselId: s.vesselId,
    cameraId: s.cameraId,
    status: 'alarm',
    alarmId: s.id,
    eventId: s.eventId,
    confidence: 0.7 + (hashInt(s.id) % 25) / 100,
  }));
  blocks.forEach((b, i) => {
    const n = counts[i] - fixed[i];
    const lo = Math.max(b, departure);
    const hi = Math.min(b + ROUND_EVERY_H * HOUR, eventsUntil);
    for (let k = 0; k < n; k++) {
      const key = `${v.id}-e${i}-${k}`;
      const t = Math.round(lo + ((hi - lo) * (k + 0.5)) / Math.max(1, n) + ((hashInt(key) % 40) - 20) * MIN);
      const useCaseId = EVENT_USE_CASES[hashInt(`${key}u`) % EVENT_USE_CASES.length];
      const vesselId = useCaseId === 'obstacle' ? (tug?.id ?? '') : (barges[hashInt(`${key}b`) % Math.max(1, barges.length)]?.id ?? '');
      drafts.push({
        at: Math.max(lo, Math.min(hi - MIN, t)),
        useCaseId,
        vesselId,
        cameraId: cameraFor(vesselId, useCaseId),
        confidence: 0.62 + (hashInt(`${key}c`) % 33) / 100,
      });
    }
  });
  drafts.sort((a, b) => a.at - b.at);
  drafts
    .filter((d) => !d.status)
    .forEach((d, i) => {
      d.status = i % 5 === 3 ? 'false_alert' : 'accepted';
    });

  // Event numbers: alarms keep theirs, the rest count up around them (skipping the review queue's).
  const usedNums = new Set([
    ...drafts.filter((d) => d.eventId || d.alarmId).map((d) => numOf(d.eventId ?? d.alarmId ?? '')),
    ...initialReviewEvents.filter((e) => e.id.startsWith(prefix)).map((e) => numOf(e.id)),
  ]);
  let counter = EVENT_BASE[v.id] ?? 100;
  const events: VoyageEvent[] = drafts.map((d) => {
    let id: string;
    if (d.eventId) id = d.eventId;
    else if (d.alarmId) id = `${prefix}${d.alarmId.slice(-4)}`;
    else {
      counter += 1;
      while (usedNums.has(counter)) counter += 1;
      id = `${prefix}${pad4(counter)}`;
    }
    return {
      key: d.alarmId ?? id,
      id,
      at: d.at,
      useCaseId: d.useCaseId,
      vesselId: d.vesselId,
      cameraId: d.cameraId,
      status: d.status ?? 'accepted',
      alarmId: d.alarmId,
      confidence: Math.min(0.97, d.confidence),
      source: 'history',
    };
  });

  const cargo: CargoCheck[] = spec.cargo.map((c) => ({ ...c, cameraId: cameraFor(c.bargeId, 'container-doors'), containers: cargoList(v.id, c) }));
  const link: LinkSeg[] = spec.link.map(([from, to, state]) => ({ from, to, state }));
  const arrivalPort = spec.calls.filter((c) => c.kind === 'arrival').at(-1)?.port ?? v.route.split(' to ').at(-1) ?? '';
  const lastScheduledArrival = spec.calls.filter((c) => c.kind === 'arrival').at(-1)?.scheduled ?? spec.windowEnd;

  return {
    voyage: v,
    tug,
    barges,
    window: { start: spec.windowStart, end: spec.windowEnd },
    schedule: spec.schedule,
    calls: spec.calls,
    roundSpecs: spec.rounds,
    link,
    cargo,
    events: events.reverse(),
    archivedAlarms: archived.sort((a, b) => b.raisedAt - a.raisedAt),
    consoleAlarms: ARCHIVED_ALARMS.filter((a) => a.voyageId === v.id),
    departure,
    plannedDays: Math.max(1, Math.ceil((lastScheduledArrival - departure) / DAY)),
    reportSentAt: spec.reportSentAt,
    arrivalPort,
    departurePort: departureCall?.port ?? v.route.split(' to ')[0] ?? '',
  };
}

const records = new Map<string, VoyageRecord>();
voyages.forEach((v) => records.set(v.id, build(v, specs.find((s) => s.id === v.id) ?? fallbackSpec(v))));

export const voyageRecord = (id?: string) => (id ? records.get(id) : undefined);
export const allVoyageRecords = () => [...records.values()];

// ---------- Live layer ----------

export interface LiveCtx {
  /** The convoy from useFleet() (live link, last position, queued events). */
  convoy?: Convoy;
  alarms: Alarm[];
  reviewEvents: ReviewEvent[];
  audit: AuditEntry[];
  now: number;
}

export interface LiveVoyage {
  convoy?: Convoy;
  /** The convoy is on this voyage now (not completed). */
  current: boolean;
  /** Out of coverage now: events wait on board. */
  offline: boolean;
  /** Last health message while out of coverage. */
  queuedAfter?: number;
  queuedEvents: number;
  /** When the convoy last came back into coverage on this voyage. */
  reconnectedAt?: number;
  link: LinkSeg[];
  /** Every event on the voyage, newest first: history, live alarms and the review queue. */
  events: VoyageEvent[];
  toReview: number;
  /** Events that arrived late from store and forward. */
  arrivedLate: number;
  /** Alarms on this voyage in the live store, newest first. */
  alarms: Alarm[];
}

const statusOf = (c?: Classification): EventStatus => (c === 'accepted' ? 'accepted' : c === 'rejected' ? 'rejected' : c === 'false_alert' ? 'false_alert' : 'to_review');

export function liveVoyage(rec: VoyageRecord, ctx: LiveCtx): LiveVoyage {
  const v = rec.voyage;
  const convoy = ctx.convoy;
  const current = v.status !== 'completed' && convoy?.voyageId === v.id;
  const offline = current && convoy?.link === 'none';
  const lastSeen = convoy ? new Date(convoy.lastSeen).getTime() : ctx.now;
  const back = ctx.audit.find((e) => e.action === 'Convoy back in coverage' && e.convoyId === v.convoyId && new Date(e.at).getTime() >= rec.departure);
  const reconnectedAt = back ? new Date(back.at).getTime() : undefined;

  // Link to shore: the record up to the snapshot, then what the health messages say now.
  const link = rec.link.map((s) => ({ ...s }));
  const last = link.at(-1);
  if (current && convoy && last && last.to === null && last.state !== convoy.link) {
    const changedAt = convoy.link !== 'none' ? (reconnectedAt ?? lastSeen) : lastSeen;
    const t = Math.max(last.from, Math.min(ctx.now, changedAt));
    last.to = t;
    link.push({ state: convoy.link, from: t, to: null });
  }

  // Events: the history, live alarms on the voyage and the review queue, deduplicated by id.
  const prefix = eventPrefix(v.id);
  const alarms = ctx.alarms.filter((a) => a.voyageId === v.id).sort((a, b) => b.raisedAt.localeCompare(a.raisedAt));
  const byKey = new Map(rec.events.map((e) => [e.key, e]));
  for (const a of alarms) {
    const hist = byKey.get(a.id);
    byKey.set(a.id, {
      key: a.id,
      id: a.eventId || hist?.id || `${prefix}${a.id.slice(-4)}`,
      at: new Date(a.raisedAt).getTime(),
      useCaseId: a.useCaseId,
      vesselId: a.vesselId ?? hist?.vesselId ?? rec.tug?.id ?? '',
      cameraId: a.cameraId ?? hist?.cameraId ?? '',
      status: 'alarm',
      alarmId: a.id,
      confidence: a.detection?.confidence ?? hist?.confidence ?? 0.8,
      source: hist ? 'history' : 'alarm',
    });
  }
  for (const e of ctx.reviewEvents) {
    const t = new Date(e.at).getTime();
    const mine = e.id.startsWith(prefix) || (current && e.convoyId === v.convoyId && t >= rec.departure);
    if (!mine) continue;
    byKey.set(e.id, {
      key: e.id,
      id: e.id,
      at: t,
      useCaseId: e.useCaseId,
      vesselId: e.vesselId,
      cameraId: e.cameraId,
      status: statusOf(e.classification),
      confidence: e.confidence,
      source: 'review',
      shadow: e.shadow,
      late: e.queued,
      receivedAt: e.queued ? (reconnectedAt ?? t) : undefined,
      falseReason: e.falseReason,
    });
  }
  const events = [...byKey.values()].sort((a, b) => b.at - a.at);

  return {
    convoy,
    current,
    offline,
    queuedAfter: offline ? lastSeen : undefined,
    queuedEvents: offline ? (convoy?.queuedEvents ?? 0) : 0,
    reconnectedAt,
    link,
    events,
    toReview: events.filter((e) => e.status === 'to_review').length,
    arrivedLate: events.filter((e) => e.late).length,
    alarms,
  };
}

/** VOY-03: every round with its result at `now`. Rounds after `queuedAfter` wait on board. */
export function roundsFor(rec: VoyageRecord, now: number, queuedAfter?: number): Round[] {
  const out: Round[] = [];
  const known = queuedAfter ?? now;
  rec.roundSpecs.forEach((r) => {
    const cameraId = reeferCamera(r.bargeId);
    for (let i = 0; i < r.count; i++) {
      const scheduled = r.first + i * ROUND_EVERY_H * HOUR;
      let seenMin: number | null | undefined = r.seen?.[i];
      if (seenMin === undefined) {
        const off = defaultSeenOffset(r.bargeId, i);
        seenMin = scheduled + off * MIN <= known ? off : undefined;
      }
      const round: Round = { key: `${r.bargeId}-${i}`, bargeId: r.bargeId, cameraId, scheduled, result: 'due' };
      if (typeof seenMin === 'number' && scheduled + seenMin * MIN <= known) {
        round.seen = scheduled + seenMin * MIN;
        round.result = seenMin > TOLERANCE_MIN ? 'late' : 'on_time';
        if (round.result === 'late') round.minutes = seenMin;
      } else if (queuedAfter && scheduled + TOLERANCE_MIN * MIN > queuedAfter && scheduled <= now) {
        round.result = 'queued';
      } else if (now < scheduled + TOLERANCE_MIN * MIN) {
        round.result = 'due';
      } else if (now < scheduled + MISSED_AFTER_MIN * MIN) {
        round.result = 'overdue';
        round.minutes = Math.floor((now - scheduled) / MIN);
      } else {
        round.result = 'missed';
      }
      out.push(round);
    }
  });
  return out;
}

export interface RoundStats {
  judged: number;
  onTime: number;
  late: number;
  missed: number;
  overdue: number;
  due: number;
  queued: number;
}

export function roundStats(rounds: Round[]): RoundStats {
  const n = (r: RoundResult) => rounds.filter((x) => x.result === r).length;
  const s = { onTime: n('on_time'), late: n('late'), missed: n('missed'), overdue: n('overdue'), due: n('due'), queued: n('queued') };
  return { ...s, judged: s.onTime + s.late + s.missed };
}

export function exceptionSummary(s: RoundStats, tr: Tr): string {
  const parts = [
    s.late && tr(`${s.late} late`, `${s.late} tarde`),
    s.missed && tr(`${s.missed} missed`, `${s.missed} ${s.missed === 1 ? 'perdida' : 'perdidas'}`),
    s.overdue && tr(`${s.overdue} overdue`, `${s.overdue} ${s.overdue === 1 ? 'vencida' : 'vencidas'}`),
    s.queued && tr(`${s.queued} queued on board`, `${s.queued} en cola a bordo`),
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : tr('All on time', 'Todas a tiempo');
}

export const ROUND_LABEL: Record<RoundResult, [string, string]> = {
  on_time: ['On time', 'A tiempo'],
  late: ['Late', 'Tarde'],
  missed: ['Missed', 'Perdida'],
  overdue: ['Overdue', 'Vencida'],
  due: ['Due', 'Pendiente'],
  queued: ['Queued on board', 'En cola a bordo'],
};

export const callLabel = (c: PortCall, tr: Tr) => (c.kind === 'departure' ? tr('Left berth', 'Salida del muelle') : tr('Arrival', 'Llegada'));

export const vesselName = (id?: string) => vessels.find((v) => v.id === id)?.name ?? '';
export const vesselShort = (id?: string, tr?: Tr) => {
  const s = vessels.find((v) => v.id === id)?.short ?? '';
  return tr && s === 'Tug' ? tr('Tug', 'Remolcador') : s;
};

/** "Thu 15 Oct" / "jue 15 oct" (without the comma Spanish dates carry). */
export const fmtWeekdayShort = (ms: number) => fmtWeekday(ms).replace(',', '');

/** "Tue 13 Oct 20:00" / "mar 13 oct 20:00" */
export const fmtRoundTime = (ms: number) => `${fmtWeekdayShort(ms)} ${fmtTime(ms)}`;

/** "today" when it is the scenario's today, else "on 15 Oct". */
export const dayWord = (ms: number, now: number, tr: Tr) => (fmtDay(ms) === fmtDay(now) ? tr('today', 'hoy') : tr(`on ${fmtDay(ms)}`, `el ${fmtDay(ms)}`));

export const useCaseName = (id: string, lang: Lang) => {
  const u = useCaseById(id);
  return u ? (lang === 'es' ? u.nameEs : u.name) : id;
};

/** "Asunción to Montevideo" / "Asunción a Montevideo" */
export const routeText = (route: string, tr: Tr) => tr(route, route.replace(' to ', ' a '));

/** "Under way · day 5 of 7", "In port · cargo operations", "Completed 9 Oct" */
export function statusText(rec: VoyageRecord, live: LiveVoyage, now: number, tr: Tr): string {
  const v = rec.voyage;
  if (v.status === 'completed') {
    const end = rec.calls.filter((c) => c.kind === 'arrival' && c.actual).at(-1)?.actual ?? rec.window.end;
    return tr(`Completed ${fmtDay(end)}`, `Completado ${fmtDay(end)}`);
  }
  if (v.status === 'in_port') {
    const seg = rec.schedule.find((s) => s.kind === 'port' && s.from <= now && now < s.to);
    return seg?.cargoOps || !seg ? tr('In port · cargo operations', 'En puerto · operaciones de carga') : tr('In port', 'En puerto');
  }
  const day = Math.min(rec.plannedDays, Math.floor((now - rec.departure) / DAY) + 1);
  return [tr(`Under way · day ${day} of ${rec.plannedDays}`, `Navegando · día ${day} de ${rec.plannedDays}`), live.offline ? tr('out of coverage', 'sin cobertura') : '']
    .filter(Boolean)
    .join(' · ');
}

/** "Buenos Aires due 16 Oct 22:00", "Departs Buenos Aires 16 Oct 06:00", "Arrived Asunción 9 Oct 11:20" */
export function nextCallText(rec: VoyageRecord, tr: Tr): string {
  if (rec.voyage.status === 'completed') {
    const c = rec.calls.filter((x) => x.kind === 'arrival' && x.actual).at(-1);
    if (c?.actual) return tr(`Arrived ${c.port} ${fmtDayTime(c.actual)}`, `Llegó a ${c.port} ${fmtDayTime(c.actual)}`);
  }
  const next = rec.calls.find((c) => !c.actual);
  if (!next) return '—';
  return next.kind === 'departure'
    ? tr(`Departs ${next.port} ${fmtDayTime(next.scheduled)}`, `Sale de ${next.port} ${fmtDayTime(next.scheduled)}`)
    : tr(`${next.port} due ${fmtDayTime(next.scheduled)}`, `${next.port}, llegada prevista ${fmtDayTime(next.scheduled)}`);
}

/** The archived alarm's outcome in words. */
export function outcomeText(o: ArchivedOutcome, tr: Tr): string {
  if (o.kind === 'late') return tr(`Seen ${fmtTime(o.seenAt)}, ${o.minutes} min late`, `Vista ${fmtTime(o.seenAt)}, ${o.minutes} min tarde`);
  if (o.kind === 'missed') return tr('Missed · sent to Connect', 'Perdida · enviada a Connect');
  return o.briefed ? tr('Accepted · crew briefed', 'Aceptada · tripulación instruida') : tr('Accepted', 'Aceptada');
}

export const diffText = (d: CargoDiff, tr: Tr) =>
  d.kind === 'not_seen'
    ? tr('On the cargo list, not seen by the deck cameras at departure', 'En la lista de carga, no visto por las cámaras de cubierta a la salida')
    : tr('Seen on deck, not on the cargo list', 'Visto en cubierta, no está en la lista de carga');

/** Link time per state between two instants (for the report). */
export function linkTime(link: LinkSeg[], from: number, to: number, now: number): Record<LinkState, number> {
  const out: Record<LinkState, number> = { strong: 0, weak: 0, none: 0 };
  for (const s of link) {
    const a = Math.max(s.from, from);
    const b = Math.min(s.to ?? now, to);
    if (b > a) out[s.state] += b - a;
  }
  return out;
}

/**
 * "near Rosario" / "cerca de Rosario", "near Goya at 13:49" / "cerca de Goya a las 13:49".
 * Pass reporting=true when the convoy reports again: a last-seen time in the label is stale then.
 */
export const positionText = (label: string | undefined, tr: Tr, reporting = false) => {
  if (!label) return '';
  const l = reporting ? label.replace(/ at \d{1,2}:\d{2}$/, '') : label;
  return tr(l, l.replace(/^near /, 'cerca de ').replace(/ at (\d)/, ' a las $1'));
};
