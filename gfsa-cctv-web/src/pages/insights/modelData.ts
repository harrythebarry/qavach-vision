import { TARGETS, useCaseById, useCases } from '../../data/useCases';
import { initialAlarms, initialReviewEvents } from '../../data/alarms';
import type { Alarm, Classification, EdgeUnit, ReviewEvent } from '../../data/types';
import { activeConfig, type UcRecord } from '../../state/configStore';
import { rolloutStore, startRollout as startEdgeRollout } from '../../state/edgeOps';
import { scenarioNow } from '../../lib/time';
import { seeded } from './insightsUtil';
import { reasonGroup, REASON_GROUP_TEXT, type ReasonGroup } from './reasons';

// MP-01 to MP-03: accuracy on reviewed events, false-alert reasons and the model
// registry. The reviewed history (30 days) is the design canvas's; 7-day,
// September and since-go-live figures are derived from it deterministically.
// On top of the history, every event classified in the console since (review
// queue and alarms, state/AppState) moves the numbers, and each use case's
// status comes from the use case set-up (state/configStore).

export type Period = '7d' | '30d' | 'all';
/** Report periods: the screen's three plus September for the monthly report. */
export type PerfPeriod = Period | 'sep';

export const PERIOD_DAYS: Record<PerfPeriod, number> = { '7d': 7, '30d': 30, all: 52, sep: 30 };

export const PERIOD_TEXT: Record<PerfPeriod, [string, string]> = {
  '7d': ['7 days', '7 días'],
  '30d': ['30 days', '30 días'],
  all: ['since go-live', 'desde la puesta en marcha'],
  sep: ['September', 'septiembre'],
};

/** Periods that include today, so classifications made in the console count. */
export const includesToday = (p: PerfPeriod) => p !== 'sep';

export type McStatus = 'live' | 'shadow' | 'off';

interface BaseRow {
  id: string;
  seedStatus: McStatus;
  events: number;
  unit?: 'rounds';
  precision?: number;
  recall?: number;
  fa?: number;
  /** Shown while the use case keeps the status it had in the history. */
  gateNote?: [string, string];
  /** First week with reviewed events (index into WEEKS). */
  fromWeek?: number;
}

const BASE: BaseRow[] = [
  { id: 'life-jacket', seedStatus: 'live', events: 69, precision: 0.93, recall: 0.88, fa: 0.03 },
  { id: 'hard-hat-vest', seedStatus: 'live', events: 241, precision: 0.92, recall: 0.86, fa: 0.5 },
  { id: 'smoking', seedStatus: 'shadow', events: 41, precision: 0.84, recall: 0.8, fa: 2.6, gateNote: ['false alerts above limit', 'falsas alertas sobre el límite'], fromWeek: 5 },
  { id: 'smoke-fire-deck', seedStatus: 'live', events: 4, precision: 1, recall: 1, fa: 0, gateNote: ['drill footage', 'imágenes de simulacro'] },
  { id: 'smoke-machinery', seedStatus: 'live', events: 11, precision: 0.91, recall: 0.9, fa: 0.1 },
  { id: 'obstacle', seedStatus: 'off', events: 0, gateNote: ['follows in fleet rollout', 'sigue en el despliegue a la flota'] },
  { id: 'container-doors', seedStatus: 'live', events: 302, precision: 0.94, recall: 0.89, fa: 0.4 },
  { id: 'reefer-rounds', seedStatus: 'live', events: 140, unit: 'rounds', precision: 0.96, recall: 0.95, fa: 0.1 },
  { id: 'camera-health', seedStatus: 'live', events: 36, precision: 0.97, recall: 0.92, fa: 0.1 },
  { id: 'outside-work', seedStatus: 'shadow', events: 83, precision: 0.86, recall: 0.84, fa: 1.1, gateNote: ['gate decided 25 Oct', 'se decide el 25 oct'], fromWeek: 6 },
  { id: 'person-down', seedStatus: 'off', events: 0, gateNote: ['needs drill footage', 'necesita imágenes de simulacro'] },
  { id: 'overboard', seedStatus: 'off', events: 0, gateNote: ['needs thermal cameras', 'necesita cámaras térmicas'] },
];

const FIXED_EXTRA: Record<string, [string, string]> = {
  'reefer-rounds': ['rounds from Connect', 'rondas de Connect'],
  'camera-health': ['every camera', 'todas las cámaras'],
};

export type Gate = 'met' | 'precision' | 'recall' | 'fa' | 'shadow' | 'not_run';

export interface UcPerf {
  id: string;
  status: McStatus;
  extra?: [string, string];
  /** Reviewed events (or rounds) in the period. */
  events: number;
  /** Events of this use case waiting for review now. */
  pending: number;
  /** Of the reviewed events, how many were classified in the console since the history. */
  live: number;
  unit?: 'rounds';
  precision?: number;
  recall?: number;
  fa?: number;
  gateNote?: [string, string];
  shadowGate?: [string, string];
  fromWeek?: number;
}

export function gateOf(u: Pick<UcPerf, 'status' | 'precision' | 'recall' | 'fa'>): Gate {
  if (u.status === 'off') return 'not_run';
  if (u.status === 'shadow') return 'shadow';
  if (u.precision === undefined) return 'not_run';
  if (u.precision < TARGETS.precision) return 'precision';
  if ((u.recall ?? 0) < TARGETS.recall) return 'recall';
  if ((u.fa ?? 0) > TARGETS.falseAlertsPerCamDay) return 'fa';
  return 'met';
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** The reviewed history for a period, before anything classified in the console. */
function historyFor(period: PerfPeriod): BaseRow[] {
  if (period === '30d') return BASE;
  return BASE.map((u) => {
    if (u.seedStatus === 'off' || u.precision === undefined || u.recall === undefined || u.fa === undefined) return u;
    const r = seeded(`mp|${period}|${u.id}`);
    const live = u.seedStatus === 'live';
    const met = gateOf({ status: u.seedStatus, precision: u.precision, recall: u.recall, fa: u.fa }) === 'met' || !live;
    const d = () => (Math.floor(r() * 5) - 2) / 100;
    const scale = period === '7d' ? 7 / 30 : period === 'sep' ? 0.93 : 52 / 30;
    const drift = period === 'all' ? -0.01 : period === 'sep' ? -0.01 : 0;
    let p = Math.min(1, r2(u.precision + d() + drift));
    let rc = Math.min(1, r2(u.recall + d() + drift));
    if (live) {
      if (met) {
        p = Math.max(TARGETS.precision, p);
        rc = Math.max(TARGETS.recall, rc);
      } else {
        p = Math.min(r2(TARGETS.precision - 0.01), period === '7d' ? r2(u.precision - 0.02) : p);
      }
    }
    if (u.precision === 1) p = 1;
    if (u.recall === 1) rc = 1;
    const fa = u.fa === 0 ? 0 : Math.max(0.01, r2(u.fa * (period === 'all' ? 1.25 : period === 'sep' ? 1.1 : 0.8 + r() * 0.3)));
    const events =
      u.seedStatus === 'shadow' && (period === 'all' || period === 'sep')
        ? u.events
        : Math.max(0, Math.round(u.events * scale + (r() - 0.5) * 2));
    return { ...u, events, precision: p, recall: rc, fa };
  });
}

export const FLEET: Record<PerfPeriod, { precision: number; recall: number; fa: number; reviewed: number }> = {
  '7d': { precision: 0.92, recall: 0.88, fa: 0.3, reviewed: 243 },
  '30d': { precision: 0.91, recall: 0.87, fa: 0.4, reviewed: 1041 },
  all: { precision: 0.89, recall: 0.86, fa: 0.5, reviewed: 1874 },
  sep: { precision: 0.9, recall: 0.86, fa: 0.5, reviewed: 968 },
};

// ---------- Classified in the console ----------

export interface LiveDelta {
  accepted: number;
  falseAlert: number;
  rejected: number;
  /** Waiting for review now. */
  pending: number;
  /** False alerts by reason group. */
  reasons: Partial<Record<ReasonGroup, number>>;
}

const emptyDelta = (): LiveDelta => ({ accepted: 0, falseAlert: 0, rejected: 0, pending: 0, reasons: {} });

// What the history already counts: the classification each sample event had.
const SEED_CLASS = new Map<string, Classification | undefined>([
  ...initialAlarms.map((a) => [a.id, a.classification] as const),
  ...initialReviewEvents.map((e) => [e.id, e.classification] as const),
]);

/** Per use case: what reviewers classified since the history, and what waits for review. */
export function liveDeltas(alarms: Alarm[], reviewEvents: ReviewEvent[]): Record<string, LiveDelta> {
  const out: Record<string, LiveDelta> = {};
  const alarmEvents = new Set(alarms.map((a) => a.eventId));
  const items = [
    ...alarms.map((a) => ({ id: a.id, uc: a.useCaseId, c: a.classification, reason: a.falseReason, seedReason: initialAlarms.find((x) => x.id === a.id)?.falseReason })),
    ...reviewEvents
      .filter((e) => !alarmEvents.has(e.id))
      .map((e) => ({ id: e.id, uc: e.useCaseId, c: e.classification, reason: e.falseReason, seedReason: initialReviewEvents.find((x) => x.id === e.id)?.falseReason })),
  ];
  for (const it of items) {
    const d = (out[it.uc] ??= emptyDelta());
    const seed = SEED_CLASS.get(it.id);
    if (!it.c) d.pending += 1;
    if (it.c === seed) continue;
    const bump = (c: Classification | undefined, k: 1 | -1, reason?: string) => {
      if (c === 'accepted') d.accepted += k;
      else if (c === 'rejected') d.rejected += k;
      else if (c === 'false_alert') {
        d.falseAlert += k;
        const g = reasonGroup(reason);
        d.reasons[g] = (d.reasons[g] ?? 0) + k;
      }
    };
    bump(seed, -1, it.seedReason);
    bump(it.c, 1, it.reason);
  }
  return out;
}

const camerasFor = (ucId: string, records: Record<string, UcRecord>, totalCams: number) => {
  if (ucId === 'camera-health') return totalCams;
  const uc = useCaseById(ucId);
  const rec = records[ucId];
  return uc && rec ? Math.max(1, activeConfig(uc, rec).cameraIds.length) : 1;
};

const statusOf = (s: UcRecord['status'] | undefined, seed: McStatus): McStatus =>
  s === undefined ? seed : s === 'live' ? 'live' : s === 'shadow' ? 'shadow' : 'off';

export const SHADOW_DAYS = TARGETS.shadowDays;

export interface PerfInput {
  records: Record<string, UcRecord>;
  deltas: Record<string, LiveDelta>;
  nowMs: number;
  /** Cameras in the fleet (camera health runs on all of them). */
  totalCams: number;
}

/** Applies what was classified in the console to a history row. */
function withLive<T extends { events: number; precision?: number; recall?: number; fa?: number }>(base: T, d: LiveDelta | undefined, camDays: number) {
  const accL = d?.accepted ?? 0;
  const falL = d?.falseAlert ?? 0;
  const rejL = d?.rejected ?? 0;
  if (!accL && !falL && !rejL) return { precision: base.precision, recall: base.recall, fa: base.fa, events: base.events, live: 0 };
  const n = base.events;
  const acc0 = base.precision !== undefined ? Math.round(base.precision * n) : 0;
  const fal0 = base.precision !== undefined ? n - acc0 : 0;
  const tp = acc0 + accL;
  const fp = fal0 + falL;
  const fn0 = base.recall ? acc0 * (1 / base.recall - 1) : 0;
  return {
    precision: tp + fp > 0 ? tp / (tp + fp) : base.precision,
    recall: tp > 0 ? tp / (tp + fn0) : base.recall,
    fa: (base.fa ?? 0) + falL / Math.max(1, camDays),
    events: Math.max(0, n + accL + falL + rejL),
    live: accL + falL + rejL,
  };
}

/** MP-01: every use case for a period, with its status now. */
export function perfRows(period: PerfPeriod, input: PerfInput): UcPerf[] {
  const live = includesToday(period);
  return historyFor(period).map((b) => {
    const rec = input.records[b.id];
    const status = statusOf(rec?.status, b.seedStatus);
    const d = live ? input.deltas[b.id] : undefined;
    const camDays = camerasFor(b.id, input.records, input.totalCams) * PERIOD_DAYS[period];
    const v = withLive(b, d, camDays);
    const uc = useCaseById(b.id);
    const level = uc && rec ? activeConfig(uc, rec).level : uc?.level;
    const extra: [string, string] | undefined =
      FIXED_EXTRA[b.id] ??
      (status === 'shadow' ? ['logged only', 'solo registro'] : status === 'live' && level === 'list' ? ['list only', 'solo lista'] : undefined);
    let shadowGate: [string, string] | undefined;
    if (status === 'shadow') {
      const start = rec?.shadowStart ? new Date(rec.shadowStart).getTime() : input.nowMs;
      const day = Math.max(1, Math.min(SHADOW_DAYS, Math.floor((input.nowMs - start) / 86_400_000) + 1));
      shadowGate = [`Shadow · day ${day} of ${SHADOW_DAYS}`, `Sombra · día ${day} de ${SHADOW_DAYS}`];
    }
    return {
      id: b.id,
      status,
      extra,
      events: v.events,
      pending: live ? (input.deltas[b.id]?.pending ?? 0) : 0,
      live: v.live,
      unit: b.unit,
      precision: v.precision,
      recall: v.recall,
      fa: v.fa,
      gateNote: status === b.seedStatus ? b.gateNote : undefined,
      shadowGate,
      fromWeek: b.fromWeek,
    };
  });
}

export interface FleetPerf {
  precision: number;
  recall: number;
  fa: number;
  reviewed: number;
  pending: number;
  live: number;
}

/** Fleet figures: every use case that is live now. */
export function fleetPerf(period: PerfPeriod, rows: UcPerf[], input: PerfInput): FleetPerf {
  const base = FLEET[period];
  const liveIds = rows.filter((r) => r.status === 'live').map((r) => r.id);
  const sum = emptyDelta();
  if (includesToday(period)) {
    for (const id of liveIds) {
      const d = input.deltas[id];
      if (!d) continue;
      sum.accepted += d.accepted;
      sum.falseAlert += d.falseAlert;
      sum.rejected += d.rejected;
      sum.pending += d.pending;
    }
  }
  const v = withLive({ events: base.reviewed, precision: base.precision, recall: base.recall, fa: base.fa }, sum, input.totalCams * PERIOD_DAYS[period]);
  return { precision: v.precision!, recall: v.recall!, fa: v.fa!, reviewed: v.events, pending: sum.pending, live: v.live };
}

// ---------- Weekly trend ----------

export const WEEKS = ['W35', 'W36', 'W37', 'W38', 'W39', 'W40', 'W41', 'W42'];
const FLEET_P = [84, 86, 88, 89, 90, 91, 92, 91];
const FLEET_R = [79, 81, 83, 85, 86, 86, 88, 87];

export interface Series {
  precision: (number | null)[];
  recall: (number | null)[];
}

/** Weekly precision and recall; W42 (this week) includes what was classified in the console. */
export function trendFor(useCaseId: string, d?: LiveDelta, weekEvents = 0): Series | null {
  let s: Series | null;
  if (useCaseId === 'all') s = { precision: [...FLEET_P], recall: [...FLEET_R] };
  else {
    const u = BASE.find((x) => x.id === useCaseId);
    if (!u || u.precision === undefined || u.recall === undefined) return null;
    const r = seeded(`trend|${useCaseId}`);
    const avg = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
    const offP = u.precision * 100 - avg(FLEET_P.slice(4));
    const offR = u.recall * 100 - avg(FLEET_R.slice(4));
    const from = u.fromWeek ?? 0;
    const mk = (base: number[], off: number, last: number) =>
      base.map((v, i) => {
        if (i < from) return null;
        if (i === base.length - 1 || i === base.length - 2) {
          // keep the latest weeks close to the reported figure
          return Math.min(100, Math.round(last * 100 + (i === base.length - 1 ? 0 : (r() - 0.5) * 2)));
        }
        return Math.min(100, Math.max(50, Math.round(v + off + (r() - 0.5) * 3)));
      });
    s = { precision: mk(FLEET_P, offP, u.precision), recall: mk(FLEET_R, offR, u.recall) };
  }
  const last = WEEKS.length - 1;
  const p42 = s.precision[last];
  const r42 = s.recall[last];
  if (d && (d.accepted || d.falseAlert) && p42 !== null && r42 !== null) {
    const n = Math.max(1, Math.round((weekEvents * 4) / 7));
    const acc0 = Math.round((p42 / 100) * n);
    const tp = acc0 + d.accepted;
    const fp = n - acc0 + d.falseAlert;
    const fn0 = acc0 * (100 / Math.max(1, r42) - 1);
    s.precision[last] = Math.round((tp / Math.max(1, tp + fp)) * 100);
    s.recall[last] = Math.round((tp / Math.max(1, tp + fn0)) * 100);
  }
  return s;
}

// ---------- False-alert reasons (MP-02) ----------

const REASONS: { id: ReasonGroup; byUseCase: Record<string, number> }[] = [
  { id: 'inflatable', byUseCase: { 'life-jacket': 9 } },
  { id: 'reflection', byUseCase: { 'life-jacket': 2, smoking: 3, 'smoke-machinery': 1, 'container-doors': 1 } },
  { id: 'zone', byUseCase: { 'hard-hat-vest': 3, 'outside-work': 2 } },
  { id: 'object', byUseCase: { 'container-doors': 2, smoking: 1, 'hard-hat-vest': 1 } },
  { id: 'moved', byUseCase: { 'camera-health': 1, 'reefer-rounds': 1 } },
  { id: 'other', byUseCase: {} },
];

export interface ReasonRow {
  id: ReasonGroup;
  label: [string, string];
  count: number;
  perUseCase: (readonly [string, number])[];
}

export function reasonsFor(period: PerfPeriod, useCaseId: string, deltas: Record<string, LiveDelta>): ReasonRow[] {
  const f = period === '7d' ? 0.26 : period === 'all' ? 1.75 : period === 'sep' ? 0.9 : 1;
  const live = includesToday(period);
  return REASONS.map((rs) => {
    const byUc = new Map<string, number>();
    for (const [uc, n] of Object.entries(rs.byUseCase)) byUc.set(uc, f === 1 ? n : Math.round(n * f));
    if (live) for (const [uc, d] of Object.entries(deltas)) if (d.reasons[rs.id]) byUc.set(uc, (byUc.get(uc) ?? 0) + (d.reasons[rs.id] ?? 0));
    const per = [...byUc.entries()].filter(([uc, n]) => n > 0 && (useCaseId === 'all' || uc === useCaseId)).map(([uc, n]) => [uc, n] as const);
    return { id: rs.id, label: REASON_GROUP_TEXT[rs.id], count: per.reduce((s, [, n]) => s + n, 0), perUseCase: per };
  })
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count);
}

// ---------- Consent ----------

export const CONSENT = {
  onFile: true,
  signed: '2026-10-02',
  reference: ['GFSA written consent, training use, 2 Oct 2026', 'Consentimiento escrito de GFSA, uso para entrenamiento, 2 oct 2026'] as [string, string],
  covers: ['Deck, barge-edge, reefer-row and bow cameras, faces blurred', 'Cámaras de cubierta, borde de barcaza, fila de reefers y proa, con rostros difuminados'] as [string, string],
  excludes: ['Wheelhouse and engine-room cameras', 'Cámaras del puente de mando y de la sala de máquinas'] as [string, string],
};

/** Use cases whose footage the written consent does not cover. */
export const NOT_COVERED: Record<string, [string, string]> = {
  'smoke-machinery': ['engine-room cameras', 'cámaras de la sala de máquinas'],
};

// ---------- Training sends (MP-02), saved ----------

export interface TrainingSend {
  id: string;
  at: string; // ISO
  by: string;
  period: Period;
  ucId: string;
  count: number;
  byUseCase: Record<string, number>;
}

export interface TrainingState {
  /** Labels added to the training set this month. */
  labels: number;
  sends: TrainingSend[];
}

export const TRAINING_SEED: TrainingState = { labels: 212, sends: [] };

/** Clips per use case that the consent covers, for the reasons shown. */
export function sendableByUseCase(reasons: ReasonRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of reasons) for (const [uc, n] of r.perUseCase) if (!NOT_COVERED[uc]) out[uc] = (out[uc] ?? 0) + n;
  return out;
}

/** Clips already sent for this period, per use case. */
export function sentByUseCase(sends: TrainingSend[], period: Period): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sends) if (s.period === period) for (const [uc, n] of Object.entries(s.byUseCase)) out[uc] = (out[uc] ?? 0) + n;
  return out;
}

// ---------- Registry (MP-03) ----------
// The registry and the rollout are shared with Edge units (state/modelRegistry.ts,
// state/edgeOps.ts), so both screens show the same live version.

export { registryStore, liveVersion, isOlder, type ModelVersion, type Rollback, type RegistryState, type VersionState } from '../../state/modelRegistry';

/** Pushes a signed version to every edge unit in reach; the rest wait for their link. */
export function startRollout(version: string, _units?: EdgeUnit[]): { now: string[]; waiting: string[] } {
  void _units;
  const ro = rolloutStore.get();
  return startEdgeRollout(version, { previous: ro.version, draft: ro.draft === version ? null : ro.draft, pushedAt: scenarioNow(), pushedBy: 'Model registry' });
}

export const fmtFa = (v: number) => (v > 0 && v < 0.1 ? v.toFixed(2) : v.toFixed(1));

/** Every use case in the catalogue (the table lists them in this order). */
export const useCaseIds = useCases.map((u) => u.id);
