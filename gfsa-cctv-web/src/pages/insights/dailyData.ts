import { camerasOnVessel, convoyById, vesselById } from '../../data/fleet';
import { useCaseById } from '../../data/useCases';
import { voyageById } from '../../data/alarms';
import type { Alarm, Camera, Convoy, ReviewEvent } from '../../data/types';
import type { PdfBlock } from '../../lib/download';
import { dateOf, minsOfDay, seeded } from './insightsUtil';
import { reasonPair } from './reasons';

// REP-01: the daily summary per tug and barge, generated at 06:00 Asunción time
// for the day before. Finished days are history: Guarán F 501 on 14 Oct carries
// the design canvas's numbers and every other vessel and day is derived
// deterministically from a seed. Today is live: the summary so far is built from
// the alarms and review queue in the console, the cameras and the convoy link.

export type ReportLang = 'en' | 'es';

export const DAILY_MIN = '2026-10-01';
/** The last finished day in the sample data (its summary went out 15 Oct 06:00). */
export const DAILY_MAX = '2026-10-14';
export const DAILY_DEFAULT_VESSEL = 'f501';

export interface DailyEventRow {
  useCaseId: string;
  count: number;
  shadow: boolean;
}

export interface DailyRound {
  due: string;
  seen?: string;
  /** "upcoming": today, not due yet or still inside the 15 min tolerance. */
  result: 'on_time' | 'late' | 'missed' | 'upcoming';
}

export interface DailyUptime {
  cameraId: string;
  name: string;
  pct: number;
  /** Minutes offline and when it started (minutes after midnight). */
  down?: { from: number; mins: number };
  /** Today: still offline or degraded now. */
  ongoing?: boolean;
}

export type LinkKind = 'good' | 'weak' | 'none';

export interface LinkSeg {
  kind: LinkKind;
  from: number; // minutes after midnight
  to: number;
}

export type FalseReason = 'reflection' | 'jacket_door' | 'inflatable' | 'shadow' | 'outside_zone' | 'glare' | 'cargo_net';

export interface DailySummary {
  vesselId: string;
  date: string;
  vesselName: string;
  isTug: boolean;
  convoyName: string;
  voyageId?: string;
  route?: string;
  portNote?: { en: string; es: string };
  events: DailyEventRow[];
  total: number;
  alertsSent: number;
  outcomes: { accepted: number; falseAlert: number; rejected: number; pending: number };
  /** Each reason in English and Spanish. */
  falseReasons: [string, string][];
  rounds: DailyRound[] | null;
  uptime: DailyUptime[];
  uptimePct: number;
  link: LinkSeg[];
  linkTotals: Record<LinkKind, number>;
  longestWait: number;
  /** Today: the summary so far, up to this minute of the day. */
  live?: { upTo: number };
}

// ---------- Voyages by date ----------

const SPANS: { id: string; convoy: string; from: string; to: string; portFrom?: string; port?: [string, string] }[] = [
  { id: 'VOY-26-037', convoy: 'tuy', from: '2026-10-01', to: '2026-10-09' },
  { id: 'VOY-26-041', convoy: 'tuy', from: '2026-10-11', to: '2026-12-31' },
  { id: 'VOY-26-036', convoy: 'boq', from: '2026-09-28', to: '2026-10-06' },
  { id: 'VOY-26-040', convoy: 'boq', from: '2026-10-08', to: '2026-12-31', portFrom: '2026-10-13', port: ['In port, Buenos Aires · cargo operations', 'En puerto, Buenos Aires · operaciones de carga'] },
  { id: 'VOY-26-039', convoy: 'hum', from: '2026-10-12', to: '2026-12-31' },
];

/** The voyage a convoy was on that day, if any. */
export const voyageOn = (convoyId: string, date: string) => SPANS.find((s) => s.convoy === convoyId && date >= s.from && date <= s.to)?.id;

const HOME_PORT: Record<string, [string, string]> = {
  tuy: ['In port, Asunción', 'En puerto, Asunción'],
  boq: ['In port, Asunción', 'En puerto, Asunción'],
  hum: ['In port, Montevideo', 'En puerto, Montevideo'],
};

// ---------- Fixed numbers from the design (Guarán F 501, 14 Oct) ----------

const TUY_14_LINK: LinkSeg[] = [
  { kind: 'good', from: 0, to: 390 },
  { kind: 'weak', from: 390, to: 455 },
  { kind: 'none', from: 455, to: 590 },
  { kind: 'good', from: 590, to: 900 },
  { kind: 'weak', from: 900, to: 960 },
  { kind: 'good', from: 960, to: 1440 },
];

export const ROUND_TIMES = ['02:00', '08:00', '14:00', '20:00'];

const hm = (mins: number) => `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
const toMins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

function deriveLink(convoy: string, date: string, inPort: boolean): LinkSeg[] {
  if (convoy === 'tuy' && date === '2026-10-14') return TUY_14_LINK;
  if (inPort) return [{ kind: 'good', from: 0, to: 1440 }];
  const r = seeded(`link|${convoy}|${date}`);
  const segs: LinkSeg[] = [];
  let t = 0;
  // Two or three stretches of weak or no coverage along the river.
  const gaps = 2 + Math.floor(r() * 2);
  for (let g = 0; g < gaps && t < 1300; g++) {
    const goodLen = 150 + Math.floor(r() * 260);
    const start = Math.min(1380, t + goodLen);
    segs.push({ kind: 'good', from: t, to: start });
    const weakLen = 20 + Math.floor(r() * 50);
    const noneLen = convoy === 'hum' ? 60 + Math.floor(r() * 120) : r() < 0.5 ? 0 : 20 + Math.floor(r() * 90);
    let s = start;
    if (s < 1440) {
      const e = Math.min(1440, s + weakLen);
      segs.push({ kind: 'weak', from: s, to: e });
      s = e;
    }
    if (noneLen && s < 1440) {
      const e = Math.min(1440, s + noneLen);
      segs.push({ kind: 'none', from: s, to: e });
      s = e;
    }
    t = s;
  }
  if (t < 1440) segs.push({ kind: 'good', from: t, to: 1440 });
  return segs.filter((s) => s.to > s.from);
}

function mergeSegs(segs: LinkSeg[]): LinkSeg[] {
  const out: LinkSeg[] = [];
  for (const s of [...segs].sort((a, b) => a.from - b.from)) {
    if (s.to <= s.from) continue;
    const last = out[out.length - 1];
    if (last && last.kind === s.kind && last.to >= s.from) last.to = Math.max(last.to, s.to);
    else out.push({ ...s });
  }
  return out;
}

/** Paints [from, to) with one kind over the existing segments. */
function overlay(segs: LinkSeg[], from: number, to: number, kind: LinkKind): LinkSeg[] {
  if (to <= from) return segs;
  const out: LinkSeg[] = [];
  for (const s of segs) {
    if (s.to <= from || s.from >= to) {
      out.push(s);
      continue;
    }
    if (s.from < from) out.push({ kind: s.kind, from: s.from, to: from });
    if (s.to > to) out.push({ kind: s.kind, from: to, to: s.to });
  }
  out.push({ kind, from, to });
  return mergeSegs(out);
}

function totalsOf(link: LinkSeg[]) {
  const linkTotals: Record<LinkKind, number> = { good: 0, weak: 0, none: 0 };
  for (const s of link) linkTotals[s.kind] += s.to - s.from;
  const longestWait = Math.max(0, ...link.filter((s) => s.kind === 'none').map((s) => s.to - s.from));
  return { linkTotals, longestWait };
}

// ---------- Main derivation ----------

const BARGE_POOL: [string, number, number][] = [
  // use case, max count, chance of any
  ['container-doors', 4, 0.8],
  ['outside-work', 3, 0.75],
  ['smoking', 2, 0.45],
  ['hard-hat-vest', 2, 0.5],
  ['life-jacket', 1, 0.25],
  ['camera-health', 1, 0.3],
];
const TUG_POOL: [string, number, number][] = [
  ['hard-hat-vest', 2, 0.55],
  ['smoking', 1, 0.35],
  ['smoke-machinery', 1, 0.12],
  ['camera-health', 1, 0.4],
];

const REASONS_BY_USE_CASE: Record<string, FalseReason[]> = {
  'container-doors': ['jacket_door', 'cargo_net'],
  'outside-work': ['outside_zone'],
  smoking: ['glare'],
  'hard-hat-vest': ['shadow', 'outside_zone'],
  'life-jacket': ['inflatable', 'reflection'],
  'camera-health': ['glare'],
  'smoke-machinery': ['reflection'],
};

export const REASON_TEXT: Record<FalseReason, [string, string]> = {
  reflection: ['a reflection on the water', 'un reflejo en el agua'],
  jacket_door: ["a crew member's jacket read as an open door", 'la chaqueta de un tripulante leída como una puerta abierta'],
  inflatable: ['an inflatable life jacket not recognised', 'un chaleco salvavidas inflable no reconocido'],
  shadow: ['a shadow read as a person without a hard hat', 'una sombra leída como una persona sin casco'],
  outside_zone: ['a person just outside the zone', 'una persona justo fuera de la zona'],
  glare: ['sun glare on the lens', 'reflejo del sol en la lente'],
  cargo_net: ['a loose cargo net read as an open door', 'una red de carga suelta leída como una puerta abierta'],
};

export function isDailyVessel(id: string | null | undefined): boolean {
  return !!id && !!vesselById(id);
}

export function clampDate(d: string | null | undefined, max = DAILY_MAX): string {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return max;
  if (d < DAILY_MIN) return DAILY_MIN;
  if (d > max) return max;
  return d;
}

export function shiftDate(d: string, days: number): string {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** A finished day, from the history (deterministic). Pass the vessel's cameras from the fleet store. */
export function dailySummary(vesselId: string, date: string, cams: Camera[] = camerasOnVessel(vesselId)): DailySummary {
  const vessel = vesselById(vesselId)!;
  const convoy = convoyById(vessel.convoyId)!;
  const isTug = vessel.kind === 'tug';
  const span = SPANS.find((s) => s.convoy === convoy.id && date >= s.from && date <= s.to);
  const voyage = span ? voyageById(span.id) : undefined;
  const inPortOnVoyage = !!(span?.portFrom && date >= span.portFrom);
  const inPort = !span || inPortOnVoyage;
  const portNote = !span
    ? { en: HOME_PORT[convoy.id][0], es: HOME_PORT[convoy.id][1] }
    : inPortOnVoyage && span.port
      ? { en: span.port[0], es: span.port[1] }
      : undefined;

  const fixed = vesselId === 'f501' && date === '2026-10-14';
  const r = seeded(`daily|${vesselId}|${date}`);

  // Events by use case
  let events: DailyEventRow[];
  if (fixed) {
    events = [
      { useCaseId: 'container-doors', count: 3, shadow: false },
      { useCaseId: 'outside-work', count: 2, shadow: true },
      { useCaseId: 'smoking', count: 1, shadow: true },
      { useCaseId: 'camera-health', count: 1, shadow: false },
    ];
  } else {
    const pool = isTug ? TUG_POOL : BARGE_POOL;
    events = pool
      .map(([id, max, chance]) => {
        const n = r() < chance * (inPort ? 0.7 : 1) ? 1 + Math.floor(r() * max) : 0;
        return { useCaseId: id, count: n, shadow: useCaseById(id)?.status === 'shadow' };
      })
      .filter((e) => e.count > 0)
      .sort((a, b) => b.count - a.count);
  }
  const total = events.reduce((s, e) => s + e.count, 0);
  const alertsSent = fixed
    ? 0
    : events
        .filter((e) => {
          const uc = useCaseById(e.useCaseId);
          return uc?.level === 'alert' && uc.status === 'live' && uc.id !== 'camera-health';
        })
        .reduce((s, e) => s + e.count, 0);

  // Review outcomes
  let outcomes = { accepted: 0, falseAlert: 0, rejected: 0, pending: 0 };
  let falseReasons: FalseReason[] = [];
  if (fixed) {
    outcomes = { accepted: 4, falseAlert: 2, rejected: 1, pending: 0 };
    falseReasons = ['reflection', 'jacket_door'];
  } else {
    for (const e of events) {
      for (let i = 0; i < e.count; i++) {
        const x = r();
        if (date === DAILY_MAX && convoy.id === 'hum' && x < 0.12) outcomes.pending += 1;
        else if (x < 0.62) outcomes.accepted += 1;
        else if (x < 0.84) {
          outcomes.falseAlert += 1;
          const pool = REASONS_BY_USE_CASE[e.useCaseId] ?? ['reflection'];
          const reason = pool[Math.floor(r() * pool.length)];
          if (!falseReasons.includes(reason)) falseReasons.push(reason);
        } else outcomes.rejected += 1;
      }
    }
  }

  // Reefer rounds (barges only; the reefer row camera checks each round)
  let rounds: DailyRound[] | null = null;
  if (!isTug) {
    if (fixed) {
      rounds = [
        { due: '02:00', result: 'missed' },
        { due: '08:00', seen: '08:09', result: 'on_time' },
        { due: '14:00', seen: '14:02', result: 'on_time' },
        { due: '20:00', seen: '20:05', result: 'on_time' },
      ];
    } else {
      rounds = ROUND_TIMES.map((due) => {
        const x = r();
        if (x < 0.07) return { due, result: 'missed' as const };
        if (x < 0.14) return { due, seen: hm(toMins(due) + 17 + Math.floor(r() * 18)), result: 'late' as const };
        return { due, seen: hm(toMins(due) + Math.floor(r() * 13)), result: 'on_time' as const };
      });
    }
  }

  // Camera uptime
  const uptime: DailyUptime[] = cams.map((c) => {
    if (fixed) {
      return c.name.startsWith('Reefer')
        ? { cameraId: c.id, name: c.name, pct: 97.9, down: { from: 680, mins: 30 } }
        : { cameraId: c.id, name: c.name, pct: 100 };
    }
    if (r() < 0.82) return { cameraId: c.id, name: c.name, pct: 100 };
    const mins = 6 + Math.floor(r() * 55);
    const from = 30 + Math.floor(r() * 1300);
    return { cameraId: c.id, name: c.name, pct: Math.round((1 - mins / 1440) * 1000) / 10, down: { from, mins } };
  });
  const uptimePct = fixed ? 99.3 : avgUptime(uptime);

  // Link through the day (shared by the convoy: the vessels travel together)
  const link = deriveLink(convoy.id, date, inPort);

  return {
    vesselId,
    date,
    vesselName: vessel.name,
    isTug,
    convoyName: convoy.name,
    voyageId: inPort && !span ? undefined : voyage?.id,
    route: inPort && !span ? undefined : voyage?.route,
    portNote,
    events,
    total,
    alertsSent,
    outcomes,
    falseReasons: falseReasons.map((x) => REASON_TEXT[x]),
    rounds,
    uptime,
    uptimePct,
    link,
    ...totalsOf(link),
  };
}

const avgUptime = (u: DailyUptime[]) => Math.round((u.reduce((s, x) => s + x.pct, 0) / Math.max(1, u.length)) * 10) / 10;

// ---------- Today, live ----------

export interface LiveDay {
  nowMs: number;
  alarms: Alarm[];
  reviewEvents: ReviewEvent[];
  /** The vessel's cameras now (fleet store). */
  cameras: Camera[];
  /** The convoy now: link and last health message (fleet store). */
  convoy: Convoy;
  /** Use case status now (config store). */
  isShadow: (useCaseId: string) => boolean;
}

/** Today so far, from what the console holds now. */
export function liveDailySummary(vesselId: string, date: string, live: LiveDay): DailySummary {
  const base = dailySummary(vesselId, date, live.cameras);
  const upTo = Math.max(1, Math.min(1440, minsOfDay(live.nowMs)));
  const onDay = (iso?: string) => !!iso && dateOf(iso) === date;

  // Events and alarms on this vessel today. An alarm and its event count once.
  const alarms = live.alarms.filter((a) => a.vesselId === vesselId && onDay(a.raisedAt));
  const alarmEvents = new Set(live.alarms.map((a) => a.eventId));
  const queue = live.reviewEvents.filter((e) => e.vesselId === vesselId && onDay(e.at) && !alarmEvents.has(e.id));
  const items = [
    ...alarms.map((a) => ({ uc: a.useCaseId, shadow: false, c: a.classification, reason: a.falseReason })),
    ...queue.map((e) => ({ uc: e.useCaseId, shadow: e.shadow, c: e.classification, reason: e.falseReason })),
  ];

  const byUc = new Map<string, DailyEventRow & { allShadow: boolean }>();
  for (const it of items) {
    const row = byUc.get(it.uc) ?? { useCaseId: it.uc, count: 0, shadow: false, allShadow: true };
    row.count += 1;
    row.allShadow = row.allShadow && it.shadow;
    byUc.set(it.uc, row);
  }
  const events: DailyEventRow[] = [...byUc.values()]
    .map((r) => ({ useCaseId: r.useCaseId, count: r.count, shadow: r.allShadow || live.isShadow(r.useCaseId) }))
    .sort((a, b) => b.count - a.count);

  const outcomes = { accepted: 0, falseAlert: 0, rejected: 0, pending: 0 };
  const reasons: [string, string][] = [];
  for (const it of items) {
    if (it.c === 'accepted') outcomes.accepted += 1;
    else if (it.c === 'rejected') outcomes.rejected += 1;
    else if (it.c === 'false_alert') {
      outcomes.falseAlert += 1;
      const pair = reasonPair(it.reason);
      const lower: [string, string] = [pair[0].charAt(0).toLowerCase() + pair[0].slice(1), pair[1].charAt(0).toLowerCase() + pair[1].slice(1)];
      if (!reasons.some((r) => r[0] === lower[0])) reasons.push(lower);
    } else outcomes.pending += 1;
  }

  // Reefer rounds: a round not seen raises an alarm 15 min after it is due.
  let rounds: DailyRound[] | null = null;
  if (base.rounds) {
    rounds = base.rounds.map((r) => {
      const due = toMins(r.due);
      const alarm = alarms.find((a) => a.useCaseId === 'reefer-rounds' && minsOfDay(a.raisedAt) >= due && minsOfDay(a.raisedAt) < due + 120);
      if (alarm) return alarm.classification === 'false_alert' ? { due: r.due, result: 'on_time' as const } : { due: r.due, result: 'missed' as const };
      if (upTo < due + 15) return { due: r.due, result: 'upcoming' as const };
      if (r.result === 'missed') return { due: r.due, seen: hm(due + 6), result: 'on_time' as const };
      return r;
    });
  }

  // Camera uptime so far: scene-check alarms and the cameras' health now.
  const uptime: DailyUptime[] = live.cameras.map((c) => {
    const camAlarms = live.alarms.filter((a) => a.cameraId === c.id && a.useCaseId === 'camera-health' && onDay(a.raisedAt));
    let down = 0;
    let first: DailyUptime['down'];
    for (const a of camAlarms) {
      const from = minsOfDay(a.raisedAt);
      const endIso = a.stateTimes.resolved ?? a.stateTimes.closed;
      const to = onDay(endIso) ? minsOfDay(endIso!) : c.health === 'healthy' ? Math.min(upTo, from + 15) : upTo;
      down += Math.max(0, to - from);
      if (!first) first = { from, mins: Math.max(0, to - from) };
    }
    if (!camAlarms.length && c.health !== 'healthy') {
      const m = c.healthNote?.match(/(\d{2}):(\d{2})/);
      const from = m ? Math.min(upTo, Number(m[1]) * 60 + Number(m[2])) : Math.max(0, upTo - 30);
      down = upTo - from;
      first = { from, mins: down };
    }
    if (!down) return { cameraId: c.id, name: c.name, pct: 100 };
    return {
      cameraId: c.id,
      name: c.name,
      pct: Math.max(0, Math.round((1 - down / upTo) * 1000) / 10),
      down: first,
      ongoing: c.health !== 'healthy',
    };
  });

  // Link so far: the day's pattern, with the outages the event service recorded.
  let link = mergeSegs(base.link.filter((s) => s.from < upTo).map((s) => ({ ...s, to: Math.min(s.to, upTo) })));
  for (const a of live.alarms) {
    if (a.convoyId !== live.convoy.id || a.cameraId || a.vesselId || a.useCaseId !== 'camera-health' || !onDay(a.raisedAt)) continue;
    const endIso = a.stateTimes.resolved ?? a.stateTimes.closed;
    link = overlay(link, minsOfDay(a.raisedAt), onDay(endIso) ? minsOfDay(endIso!) : upTo, 'none');
  }
  if (live.convoy.link === 'none') link = overlay(link, onDay(live.convoy.lastSeen) ? minsOfDay(live.convoy.lastSeen) : 0, upTo, 'none');

  return {
    ...base,
    events,
    total: items.length,
    alertsSent: alarms.length,
    outcomes,
    falseReasons: reasons,
    rounds,
    uptime,
    uptimePct: avgUptime(uptime),
    link,
    ...totalsOf(link),
    live: { upTo },
  };
}

// ---------- Copy in both report languages (REP-03) ----------

export const useCaseName = (id: string, lang: ReportLang) => {
  const uc = useCaseById(id);
  return (lang === 'es' ? uc?.nameEs : uc?.name) ?? id;
};

const CAM_ES: Record<string, string> = {
  'Deck forward': 'Cubierta, proa',
  'Port edge': 'Borde de babor',
  'Starboard edge': 'Borde de estribor',
  Wheelhouse: 'Puente de mando',
  'Engine room': 'Sala de máquinas',
  'Bow forward': 'Proa, hacia adelante',
};

export const cameraName = (name: string, lang: ReportLang) => {
  if (lang === 'en') return name;
  if (name.startsWith('Reefer row')) return name.replace('Reefer row', 'Fila de reefers');
  return CAM_ES[name] ?? name;
};

const WEEKDAYS: Record<ReportLang, string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  es: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'],
};
const MONTHS: Record<ReportLang, string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
};

/** "Wednesday 14 October 2026" / "Miércoles 14 de octubre de 2026" */
export function longDate(d: string, lang: ReportLang): string {
  const t = new Date(`${d}T12:00:00Z`);
  const wd = WEEKDAYS[lang][t.getUTCDay()];
  const m = MONTHS[lang][t.getUTCMonth()];
  return lang === 'es'
    ? `${wd} ${t.getUTCDate()} de ${m} de ${t.getUTCFullYear()}`
    : `${wd} ${t.getUTCDate()} ${m} ${t.getUTCFullYear()}`;
}

/** "14 Oct" / "14 oct" */
export function shortDate(d: string, lang: ReportLang = 'en'): string {
  const t = new Date(`${d}T12:00:00Z`);
  const m = MONTHS[lang][t.getUTCMonth()].slice(0, 3);
  return `${t.getUTCDate()} ${lang === 'en' ? m[0].toUpperCase() + m.slice(1) : m}`;
}

/** "2 h 15 min" */
export function hMin(mins: number): string {
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} min`;
}

export { hm as minsToHm };

export const T = {
  kicker: ['GFSA · CCTV daily summary', 'GFSA · Resumen diario CCTV'],
  tz: ['Asunción time', 'hora de Asunción'],
  convoy: ['{c} convoy', 'Convoy {c}'],
  voyage: ['Voyage {v}', 'Viaje {v}'],
  noVoyage: ['No voyage', 'Sin viaje'],
  soFar: ['So far, up to {t}', 'Hasta ahora, a las {t}'],
  eventsLogged: ['Events logged', 'Eventos registrados'],
  alertsSent: ['Alerts sent', 'Alertas enviadas'],
  roundsOnTime: ['Rounds on time', 'Rondas a tiempo'],
  cameraUptime: ['Camera uptime', 'Disponibilidad de cámaras'],
  of: ['{a} of {b}', '{a} de {b}'],
  noReefers: ['no reefer row', 'sin fila de reefers'],
  eventsByUseCase: ['Events by use case', 'Eventos por caso de uso'],
  shadow: ['Shadow run, logged only', 'Ejecución en sombra, solo registro'],
  noEvents: ['No events logged on this day.', 'No se registraron eventos este día.'],
  noEventsYet: ['No events logged so far today.', 'Todavía no se registraron eventos hoy.'],
  reviewOutcomes: ['Review outcomes', 'Resultados de la revisión'],
  allReviewed: ['All {n} events reviewed', 'Los {n} eventos revisados'],
  someReviewed: ['{a} of {b} events reviewed', '{a} de {b} eventos revisados'],
  nothingToReview: ['Nothing to review', 'Nada que revisar'],
  accepted: ['Accepted', 'Aceptado'],
  falseAlert: ['False alert', 'Falsa alerta'],
  rejected: ['Rejected', 'Rechazado'],
  pending: ['Waiting for review', 'Pendiente de revisión'],
  falseAlerts: ['False alerts: {r}.', 'Falsas alertas: {r}.'],
  noFalse: ['No false alerts.', 'Sin falsas alertas.'],
  reeferRounds: ['Reefer rounds', 'Rondas de reefers'],
  due: ['Due', 'Prevista'],
  seen: ['Seen', 'Vista'],
  result: ['Result', 'Resultado'],
  notSeen: ['Not seen', 'No vista'],
  missed: ['Missed', 'Perdida'],
  onTime: ['On time', 'A tiempo'],
  late: ['Late', 'Tarde'],
  upcoming: ['Not due yet', 'Aún no corresponde'],
  roundsNoteMissed: ['Schedule from Connect. The missed round was sent to the voyage record.', 'Horario de Connect. La ronda perdida se envió al registro del viaje.'],
  roundsNoteMissedN: ['Schedule from Connect. The missed rounds were sent to the voyage record.', 'Horario de Connect. Las rondas perdidas se enviaron al registro del viaje.'],
  roundsNoteLate: ['Schedule from Connect. Late means seen after the 15 min tolerance.', 'Horario de Connect. Tarde significa vista después de la tolerancia de 15 min.'],
  roundsNoteOk: ['Schedule from Connect. Every round seen within the 15 min tolerance.', 'Horario de Connect. Todas las rondas vistas dentro de la tolerancia de 15 min.'],
  roundsNoteToday: ['Schedule from Connect. A round not seen within 15 min of the time due raises an alarm.', 'Horario de Connect. Una ronda no vista dentro de los 15 min de la hora prevista genera una alarma.'],
  tugNoRounds: ['The tug carries no reefers. Rounds are checked on the barges of the convoy.', 'El remolcador no lleva reefers. Las rondas se controlan en las barcazas del convoy.'],
  offlineNote: ['Offline {a} to {b}, back without a restart', 'Sin imagen de {a} a {b}, volvió sin reinicio'],
  offlineSince: ['Offline or degraded since {a}, not back yet', 'Sin imagen o degradada desde las {a}, aún sin volver'],
  link: ['Link through the day', 'Enlace durante el día'],
  linkSoFar: ['Link so far today', 'Enlace hasta ahora'],
  longestWait: ['Longest wait on board before sending: {d}', 'Espera más larga a bordo antes de enviar: {d}'],
  noWait: ['Connected all day, nothing waited on board', 'Conectado todo el día, nada esperó a bordo'],
  noWaitYet: ['Connected so far, nothing waited on board', 'Conectado hasta ahora, nada esperó a bordo'],
  good: ['4G', '4G'],
  weak: ['Weak', 'Débil'],
  none: ['No coverage', 'Sin cobertura'],
  rest: ['Rest of the day', 'Resto del día'],
  now: ['now', 'ahora'],
  camera: ['Camera', 'Cámara'],
  uptime: ['Uptime', 'Disponibilidad'],
  note: ['Note', 'Nota'],
  from: ['From', 'Desde'],
  to: ['To', 'Hasta'],
  linkCol: ['Link', 'Enlace'],
  generated: ['Generated {d} 06:00 by the CCTV event service · footage belongs to GFSA', 'Generado el {d} 06:00 por el servicio de eventos CCTV · las imágenes pertenecen a GFSA'],
  liveFoot: ['Preview at {t}, the day so far · sent {d} 06:00 · footage belongs to GFSA', 'Vista previa a las {t}, el día hasta ahora · se envía el {d} 06:00 · imágenes de GFSA'],
  page: ['Page 1 of 1', 'Página 1 de 1'],
  confidential: ['GFSA confidential', 'Confidencial GFSA'],
} satisfies Record<string, [string, string]>;

export function t(key: keyof typeof T, lang: ReportLang, vars: Record<string, string | number> = {}): string {
  let s: string = T[key][lang === 'es' ? 1 : 0];
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

/** "Asunción to Montevideo" → "Asunción a Montevideo" */
export const routeText = (route: string, lang: ReportLang) => (lang === 'es' ? route.replace(' to ', ' a ') : route);

// ---------- PDF (REP-03) ----------

export const roundResultText = (r: DailyRound, lang: ReportLang) =>
  t(r.result === 'on_time' ? 'onTime' : r.result === 'late' ? 'late' : r.result === 'missed' ? 'missed' : 'upcoming', lang);

export function roundsNote(s: DailySummary, lang: ReportLang): string {
  if (!s.rounds) return t('tugNoRounds', lang);
  const missed = s.rounds.filter((r) => r.result === 'missed').length;
  const late = s.rounds.filter((r) => r.result === 'late').length;
  if (missed > 1) return t('roundsNoteMissedN', lang);
  if (missed === 1) return t('roundsNoteMissed', lang);
  if (late) return t('roundsNoteLate', lang);
  if (s.live) return t('roundsNoteToday', lang);
  return t('roundsNoteOk', lang);
}

/** Header line under the vessel name: convoy, voyage, route, port. */
export function dailyMetaLine(s: DailySummary, lang: ReportLang): string {
  return [
    t('convoy', lang, { c: s.convoyName }),
    s.voyageId ? t('voyage', lang, { v: s.voyageId }) : t('noVoyage', lang),
    s.route ? routeText(s.route, lang) : '',
    s.portNote ? s.portNote[lang] : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The daily summary as PDF content in the report's language. */
export function dailyDoc(s: DailySummary, lang: ReportLang): { title: string; subtitle: string; blocks: PdfBlock[] } {
  const onTime = s.rounds?.filter((r) => r.result === 'on_time').length ?? 0;
  const counted = s.rounds?.filter((r) => r.result !== 'upcoming').length ?? 0;
  const reviewed = s.total - s.outcomes.pending;
  const genDate = shiftDate(s.date, 1);
  const genLabel = `${shortDate(genDate, lang)} ${genDate.slice(0, 4)}`;
  const blocks: PdfBlock[] = [
    { kind: 'meta', text: dailyMetaLine(s, lang) },
    {
      kind: 'kv',
      rows: [
        [t('eventsLogged', lang), String(s.total)],
        [t('alertsSent', lang), String(s.alertsSent)],
        [t('roundsOnTime', lang), s.rounds ? t('of', lang, { a: onTime, b: counted }) : `– (${t('noReefers', lang)})`],
        [t('cameraUptime', lang), `${s.uptimePct.toFixed(1)}%`],
      ],
    },
    { kind: 'h2', text: t('eventsByUseCase', lang) },
    s.events.length
      ? { kind: 'bars', rows: s.events.map((e) => ({ label: useCaseName(e.useCaseId, lang), value: e.count, note: e.shadow ? t('shadow', lang) : undefined })) }
      : { kind: 'p', text: s.live ? t('noEventsYet', lang) : t('noEvents', lang) },
    { kind: 'h2', text: t('reviewOutcomes', lang) },
    {
      kind: 'meta',
      text:
        s.total === 0
          ? t('nothingToReview', lang)
          : s.outcomes.pending
            ? t('someReviewed', lang, { a: reviewed, b: s.total })
            : t('allReviewed', lang, { n: s.total }),
    },
  ];
  if (s.total > 0) {
    blocks.push({
      kind: 'kv',
      rows: [
        [t('accepted', lang), String(s.outcomes.accepted)],
        [t('falseAlert', lang), String(s.outcomes.falseAlert)],
        [t('rejected', lang), String(s.outcomes.rejected)],
        ...(s.outcomes.pending ? ([[t('pending', lang), String(s.outcomes.pending)]] as [string, string][]) : []),
      ],
    });
  }
  blocks.push({
    kind: 'p',
    text: s.falseReasons.length ? t('falseAlerts', lang, { r: s.falseReasons.map((r) => r[lang === 'es' ? 1 : 0]).join(', ') }) : t('noFalse', lang),
  });

  blocks.push({ kind: 'h2', text: t('reeferRounds', lang) });
  if (s.rounds) {
    blocks.push({
      kind: 'table',
      columns: [
        { label: t('due', lang), width: 1 },
        { label: t('seen', lang), width: 1 },
        { label: t('result', lang), width: 2 },
      ],
      rows: s.rounds.map((r) => [r.due, r.seen ?? (r.result === 'missed' ? t('notSeen', lang) : '–'), roundResultText(r, lang)]),
    });
  }
  blocks.push({ kind: 'meta', text: roundsNote(s, lang) });

  blocks.push({ kind: 'h2', text: t('cameraUptime', lang) });
  blocks.push({
    kind: 'table',
    columns: [
      { label: t('camera', lang), width: 2 },
      { label: t('uptime', lang), width: 1, align: 'right' },
      { label: t('note', lang), width: 3 },
    ],
    rows: s.uptime.map((u) => [
      cameraName(u.name, lang),
      u.pct === 100 ? '100%' : `${u.pct.toFixed(1)}%`,
      u.down
        ? u.ongoing
          ? t('offlineSince', lang, { a: hm(u.down.from) })
          : t('offlineNote', lang, { a: hm(u.down.from), b: hm(u.down.from + u.down.mins) })
        : '',
    ]),
  });

  blocks.push({ kind: 'h2', text: s.live ? t('linkSoFar', lang) : t('link', lang) });
  blocks.push({
    kind: 'meta',
    text: s.longestWait ? t('longestWait', lang, { d: hMin(s.longestWait) }) : s.live ? t('noWaitYet', lang) : t('noWait', lang),
  });
  blocks.push({
    kind: 'table',
    columns: [
      { label: t('from', lang), width: 1 },
      { label: t('to', lang), width: 1 },
      { label: t('linkCol', lang), width: 2 },
    ],
    rows: s.link.map((seg) => [hm(seg.from), seg.to === 1440 ? '24:00' : hm(seg.to), t(seg.kind, lang)]),
  });
  blocks.push({ kind: 'kv', rows: (['good', 'weak', 'none'] as LinkKind[]).map((k) => [t(k, lang), hMin(s.linkTotals[k])]) });
  blocks.push({ kind: 'space' });
  blocks.push({
    kind: 'meta',
    text: s.live ? t('liveFoot', lang, { t: hm(s.live.upTo), d: genLabel }) : t('generated', lang, { d: genLabel }),
  });

  return {
    title: `${t('kicker', lang)} · ${s.vesselName}`,
    subtitle: `${longDate(s.date, lang)} · ${t('tz', lang)}${s.live ? ` · ${t('soFar', lang, { t: hm(s.live.upTo) })}` : ''}`,
    blocks,
  };
}
