import { convoyById, vesselById, vessels } from '../../data/fleet';
import { roleById } from '../../data/users';
import { voyages } from '../../data/alarms';
import type { RoleId, User } from '../../data/types';
import type { Lang } from '../../lib/i18n';
import { fmtDayTime, fmtTime, fmtWeekday } from '../../lib/time';
import type { PerfPeriod } from './modelData';
import { docDay, docMonth, docRange, docTr } from './insightsUtil';

// Report templates, the report library and the delivery schedules (REP-01 to REP-03).
// Records keep structure (ids, dates, keys), never display text, so every
// screen and PDF can show them in Spanish or English.

type Pair = [string, string];
const pick = (p: Pair, lang: Lang) => p[lang === 'es' ? 1 : 0];

export type TemplateId = 'daily' | 'weekly_fleet' | 'voyage' | 'camera_uptime' | 'model_perf' | 'reefer' | 'audit';

export type ScopeKey = 'per_vessel' | 'fleet' | 'per_convoy' | 'each_voyage' | 'per_camera' | 'all_use_cases' | 'tenant';

export const SCOPE_TEXT: Record<ScopeKey, Pair> = {
  per_vessel: ['Per tug and barge', 'Por remolcador y barcaza'],
  fleet: ['Fleet', 'Flota'],
  per_convoy: ['Per convoy', 'Por convoy'],
  each_voyage: ['Each voyage', 'Cada viaje'],
  per_camera: ['Per camera', 'Por cámara'],
  all_use_cases: ['All use cases', 'Todos los casos de uso'],
  tenant: ['Tenant', 'Inquilino'],
};

export interface ReportTemplate {
  id: TemplateId;
  name: Pair;
  summary: Pair;
  sections: Pair[];
  scopes: ScopeKey[];
  pages: Pair;
  /** Requirement the template answers. */
  req: string;
}

export const templates: ReportTemplate[] = [
  {
    id: 'daily',
    name: ['Daily summary', 'Resumen diario'],
    summary: ['One page per tug and barge for the day before, sent at 06:00 Asunción time.', 'Una página por remolcador y barcaza del día anterior, enviada a las 06:00 hora de Asunción.'],
    sections: [
      ['Events by use case', 'Eventos por caso de uso'],
      ['Review outcomes', 'Resultados de la revisión'],
      ['Reefer rounds', 'Rondas de reefers'],
      ['Camera uptime', 'Disponibilidad de cámaras'],
      ['Link through the day', 'Enlace durante el día'],
    ],
    scopes: ['per_vessel'],
    pages: ['1 page', '1 página'],
    req: 'REP-01',
  },
  {
    id: 'weekly_fleet',
    name: ['Weekly fleet report', 'Informe semanal de la flota'],
    summary: ['The fleet week at a glance: alarms, response times, review backlog and voyages.', 'La semana de la flota de un vistazo: alarmas, tiempos de respuesta, revisiones pendientes y viajes.'],
    sections: [
      ['Alarms by priority and convoy', 'Alarmas por prioridad y convoy'],
      ['Time to acknowledge', 'Tiempo hasta la confirmación'],
      ['Events by use case', 'Eventos por caso de uso'],
      ['Review backlog', 'Revisiones pendientes'],
      ['Voyages under way', 'Viajes en curso'],
    ],
    scopes: ['fleet', 'per_convoy'],
    pages: ['3 to 4 pages', '3 a 4 páginas'],
    req: 'REP-02',
  },
  {
    id: 'voyage',
    name: ['Voyage report', 'Informe de viaje'],
    summary: ['Built from the voyage record when the convoy arrives: every alarm, event and round.', 'Se arma con el registro del viaje cuando llega el convoy: cada alarma, evento y ronda.'],
    sections: [
      ['Route and timeline', 'Ruta y cronología'],
      ['Alarms and responses', 'Alarmas y respuestas'],
      ['Events by use case', 'Eventos por caso de uso'],
      ['Reefer rounds', 'Rondas de reefers'],
      ['Cargo differences', 'Diferencias de carga'],
    ],
    scopes: ['each_voyage'],
    pages: ['4 to 8 pages', '4 a 8 páginas'],
    req: 'REP-02',
  },
  {
    id: 'camera_uptime',
    name: ['Camera uptime', 'Disponibilidad de cámaras'],
    summary: ['Uptime and scene-check results for every camera, with the worst cameras first.', 'Disponibilidad y resultados del control de escena de cada cámara, con las peores primero.'],
    sections: [
      ['Fleet uptime', 'Disponibilidad de la flota'],
      ['Cameras below 99%', 'Cámaras por debajo del 99%'],
      ['Scene-check failures', 'Fallas del control de escena'],
      ['Edge units not reporting', 'Unidades de borde sin reportar'],
    ],
    scopes: ['per_camera', 'per_convoy'],
    pages: ['2 pages', '2 páginas'],
    req: 'REP-02',
  },
  {
    id: 'model_perf',
    name: ['Model performance', 'Rendimiento de modelos'],
    summary: ['Precision, recall and false alerts per use case against the agreed targets.', 'Precisión, exhaustividad y falsas alertas por caso de uso frente a las metas acordadas.'],
    sections: [
      ['Fleet precision and recall', 'Precisión y exhaustividad de la flota'],
      ['By use case against targets', 'Por caso de uso frente a las metas'],
      ['False-alert reasons', 'Motivos de falsas alertas'],
      ['Model versions', 'Versiones del modelo'],
    ],
    scopes: ['all_use_cases'],
    pages: ['3 pages', '3 páginas'],
    req: 'REP-02',
  },
  {
    id: 'reefer',
    name: ['Reefer round compliance', 'Cumplimiento de rondas de reefers'],
    summary: ['Every reefer round on the voyage, seen or missed, against the schedule in Connect.', 'Cada ronda de reefers del viaje, vista o perdida, frente al horario de Connect.'],
    sections: [
      ['Rounds on time', 'Rondas a tiempo'],
      ['Missed and late rounds', 'Rondas perdidas y tardías'],
      ['Rounds by barge', 'Rondas por barcaza'],
    ],
    scopes: ['each_voyage'],
    pages: ['2 pages', '2 páginas'],
    req: 'REP-02',
  },
  {
    id: 'audit',
    name: ['Audit extract', 'Extracto de auditoría'],
    summary: ['Views, downloads and changes from the hash-chained audit log, watermarked.', 'Vistas, descargas y cambios del registro de auditoría encadenado por hash, con marca de agua.'],
    sections: [
      ['Downloads and exports', 'Descargas y exportaciones'],
      ['Live views', 'Vistas en vivo'],
      ['Configuration changes', 'Cambios de configuración'],
      ['Sign-ins', 'Inicios de sesión'],
      ['Chain check', 'Verificación de la cadena'],
    ],
    scopes: ['tenant'],
    pages: ['5 to 20 pages', '5 a 20 páginas'],
    req: 'REP-02',
  },
];

export const templateById = (id: TemplateId) => templates.find((t) => t.id === id)!;
export const templateName = (id: TemplateId, lang: Lang) => pick(templateById(id).name, lang);

// ---------- Recipients ----------

export interface Recipient {
  id: string;
  name: Pair;
  detail: Pair;
  lang: Lang;
}

const ROLE_NOTE_ES: Record<string, string> = {
  'Day shift': 'Turno de día',
  'Night shift': 'Turno de noche',
  Deputy: 'Adjunto',
};

/** Named recipients: active shore users from the directory, plus the two group addresses. */
export function recipientsFrom(users: User[]): Recipient[] {
  return [
    ...users
      .filter((u) => u.role !== 'master' && u.status === 'active')
      .map((u) => {
        const role = roleById(u.role);
        return {
          id: u.id,
          name: [u.name, u.name] as Pair,
          detail: [
            `${role.name}${u.roleNote ? ` · ${u.roleNote}` : ''}`,
            `${role.nameEs}${u.roleNote ? ` · ${ROLE_NOTE_ES[u.roleNote] ?? u.roleNote}` : ''}`,
          ] as Pair,
          lang: u.language,
        };
      }),
    { id: 'masters', name: ['Master of each convoy', 'Capitán de cada convoy'], detail: ['Own convoy only · wheelhouse display and email', 'Solo su convoy · pantalla del puente y correo'], lang: 'es' },
    { id: 'mgmt', name: ['GFSA management', 'Dirección de GFSA'], detail: ['Email list · no console role', 'Lista de correo · sin rol en la consola'], lang: 'es' },
  ];
}

// ---------- Schedules ----------

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'arrival';
export type ScheduleLang = 'recipient' | 'es' | 'en';

export interface Schedule {
  id: string;
  template: TemplateId;
  scope: ScopeKey;
  frequency: Frequency;
  weekday: number; // 0 = Sunday, 1 = Monday
  time: string; // "06:00"
  recipients: string[];
  lang: ScheduleLang;
  enabled: boolean;
}

export const initialSchedules: Schedule[] = [
  { id: 's1', template: 'daily', scope: 'per_vessel', frequency: 'daily', weekday: 1, time: '06:00', recipients: ['u3', 'u4', 'masters'], lang: 'recipient', enabled: true },
  { id: 's2', template: 'weekly_fleet', scope: 'fleet', frequency: 'weekly', weekday: 1, time: '07:00', recipients: ['u5', 'mgmt'], lang: 'recipient', enabled: true },
  { id: 's3', template: 'voyage', scope: 'each_voyage', frequency: 'arrival', weekday: 1, time: '00:00', recipients: ['u3'], lang: 'recipient', enabled: true },
  { id: 's4', template: 'camera_uptime', scope: 'per_camera', frequency: 'daily', weekday: 1, time: '06:05', recipients: ['u6'], lang: 'recipient', enabled: true },
  { id: 's5', template: 'model_perf', scope: 'all_use_cases', frequency: 'monthly', weekday: 1, time: '07:00', recipients: ['u6'], lang: 'recipient', enabled: true },
];

export const DEFAULT_FREQ: Record<TemplateId, [Frequency, string]> = {
  daily: ['daily', '06:00'],
  weekly_fleet: ['weekly', '07:00'],
  voyage: ['arrival', '00:00'],
  camera_uptime: ['daily', '06:05'],
  model_perf: ['monthly', '07:00'],
  reefer: ['arrival', '00:00'],
  audit: ['monthly', '08:00'],
};

export const ARRIVAL_ONLY: TemplateId[] = ['voyage', 'reefer'];

export const WEEKDAYS: Pair[] = [
  ['Sunday', 'Domingo'],
  ['Monday', 'Lunes'],
  ['Tuesday', 'Martes'],
  ['Wednesday', 'Miércoles'],
  ['Thursday', 'Jueves'],
  ['Friday', 'Viernes'],
  ['Saturday', 'Sábado'],
];

type Tr = (en: string, es: string) => string;

export function whenText(s: Pick<Schedule, 'frequency' | 'weekday' | 'time'>, tr: Tr): string {
  switch (s.frequency) {
    case 'daily':
      return tr(`Every day ${s.time}`, `Todos los días ${s.time}`);
    case 'weekly':
      return tr(`${WEEKDAYS[s.weekday][0]} ${s.time}`, `${WEEKDAYS[s.weekday][1]} ${s.time}`);
    case 'monthly':
      return tr(`1st of the month ${s.time}`, `Día 1 de cada mes ${s.time}`);
    case 'arrival':
      return tr('At arrival · from the voyage record', 'A la llegada · desde el registro del viaje');
  }
}

// Asunción keeps UTC−3 all year.
const OFFSET = 3 * 3600_000;
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Buenos Aires due 16 Oct 22:00" → place and time. */
export function parseNextCall(s: string): { place: string; at: number } | undefined {
  const m = s.match(/^(.+) due (\d{1,2}) ([A-Z][a-z]{2}) (\d{2}):(\d{2})$/);
  if (!m) return undefined;
  const month = MONTH_ABBR.indexOf(m[3]);
  if (month < 0) return undefined;
  return { place: m[1], at: Date.UTC(2026, month, Number(m[2]), Number(m[4]), Number(m[5])) + OFFSET };
}

/** The next convoy arrival: the earliest due call of a voyage under way. */
export function nextArrival(nowMs: number): { place: string; at: number; voyageId: string } | undefined {
  return voyages
    .filter((v) => v.status === 'under_way')
    .map((v) => ({ ...parseNextCall(v.nextCall), voyageId: v.id }))
    .filter((x): x is { place: string; at: number; voyageId: string } => !!x.place && x.at! > nowMs)
    .sort((a, b) => a.at - b.at)[0];
}

/** When a schedule runs next, in epoch ms (arrival schedules follow the voyages under way). */
export function nextRunAt(s: Pick<Schedule, 'frequency' | 'weekday' | 'time'>, nowMs: number): number | undefined {
  const local = new Date(nowMs - OFFSET); // UTC fields read as Asunción wall time
  const [h, m] = s.time.split(':').map(Number);
  const y = local.getUTCFullYear();
  const mo = local.getUTCMonth();
  const day = local.getUTCDate();
  const at = (d: number, month = mo) => Date.UTC(y, month, d, h || 0, m || 0) + OFFSET;
  switch (s.frequency) {
    case 'daily': {
      const t = at(day);
      return t > nowMs ? t : at(day + 1);
    }
    case 'weekly': {
      const diff = (s.weekday - local.getUTCDay() + 7) % 7;
      const t = at(day + diff);
      return t > nowMs ? t : at(day + diff + 7);
    }
    case 'monthly': {
      const t = at(1);
      return t > nowMs ? t : at(1, mo + 1);
    }
    case 'arrival':
      return nextArrival(nowMs)?.at;
  }
}

/** "16 Oct 06:00", "Mon 19 Oct 07:00", "Buenos Aires arrival, due 16 Oct 22:00" (console language). */
export function nextRunText(s: Pick<Schedule, 'frequency' | 'weekday' | 'time'>, nowMs: number, tr: Tr): string {
  if (s.frequency === 'arrival') {
    const a = nextArrival(nowMs);
    return a
      ? tr(`${a.place} arrival, due ${fmtDayTime(a.at)}`, `Llegada a ${a.place}, prevista ${fmtDayTime(a.at)}`)
      : tr('At the next arrival', 'En la próxima llegada');
  }
  const t = nextRunAt(s, nowMs);
  if (t === undefined) return '–';
  return s.frequency === 'weekly' ? `${fmtWeekday(t)} ${fmtTime(t)}` : fmtDayTime(t);
}

export const LANG_TEXT: Record<ScheduleLang, Pair> = {
  recipient: ["Each recipient's language", 'El idioma de cada destinatario'],
  es: ['Spanish for everyone', 'Español para todos'],
  en: ['English for everyone', 'Inglés para todos'],
};

// ---------- Library ----------

export type ReportStatus = 'sent' | 'scheduled' | 'generated';

export const STATUS_TEXT: Record<ReportStatus, Pair> = {
  sent: ['Sent', 'Enviado'],
  scheduled: ['Scheduled', 'Programado'],
  generated: ['Generated', 'Generado'],
};

/** What a report covers. */
export type Subject =
  | { kind: 'vessel'; vesselId: string }
  | { kind: 'convoy'; convoyId: string; inPort?: boolean }
  | { kind: 'fleet' }
  | { kind: 'cameras'; convoyId?: string }
  | { kind: 'voyage'; voyageId: string }
  | { kind: 'barges'; voyageId: string; vesselIds: string[] }
  | { kind: 'models' }
  | { kind: 'audit' };

/** The period a report covers (calendar days are "YYYY-MM-DD", Asunción). */
export type RPeriod =
  | { kind: 'day'; date: string }
  | { kind: 'days'; from: string; to: string }
  | { kind: 'week'; week: number; from: string; to: string }
  | { kind: 'month'; month: number }
  | { kind: 'voyage'; voyageId: string; from: string; to?: string }
  | { kind: 'perf'; period: PerfPeriod };

/** Headline figures kept with an archived report, for periods the console no longer holds. */
export type StatKey = 'entries' | 'downloads' | 'config_changes' | 'chain';
export const STAT_TEXT: Record<StatKey, Pair> = {
  entries: ['entries', 'entradas'],
  downloads: ['downloads', 'descargas'],
  config_changes: ['config changes', 'cambios de configuración'],
  chain: ['chain check', 'verificación de la cadena'],
};

export interface LibraryReport {
  id: string;
  template: TemplateId;
  subject: Subject;
  /** Vessels the report covers; empty for fleet-wide reports. */
  vesselIds: string[];
  period: RPeriod;
  /** ISO time it was generated, or is due. */
  at: string;
  status: ReportStatus;
  /** Recipient tokens: "role:ops_manager", "master:tuy", "mgmt"; empty when made on demand. */
  sentTo: string[];
  daily?: { vesselId: string; date: string };
  voyageId?: string;
  /** Archived headline figures (audit extracts from before the console's log). */
  stats?: [StatKey, string][];
  /** On demand: who generated it and in which language. */
  by?: string;
  lang?: Lang;
}

const iso = (d: string, t: string) => `2026-${d}T${t}:00-03:00`;

export function subjectText(s: Subject, lang: Lang, counts: { convoys: number; cameras: number; camerasOf: (convoyId: string) => number }): string {
  const tr = docTr(lang);
  const convoyName = (id: string) => convoyById(id)?.name ?? id;
  switch (s.kind) {
    case 'vessel': {
      const v = vesselById(s.vesselId);
      if (!v) return s.vesselId;
      return v.kind === 'tug' ? tr(`${v.name} (tug)`, `${v.name} (remolcador)`) : tr(`${v.name} · ${convoyName(v.convoyId)} convoy`, `${v.name} · convoy ${convoyName(v.convoyId)}`);
    }
    case 'convoy':
      return tr(`${convoyName(s.convoyId)} convoy${s.inPort ? ' · in port' : ''}`, `Convoy ${convoyName(s.convoyId)}${s.inPort ? ' · en puerto' : ''}`);
    case 'fleet':
      return tr(`Fleet · ${counts.convoys} convoys`, `Flota · ${counts.convoys} convoyes`);
    case 'cameras':
      return s.convoyId
        ? tr(`${convoyName(s.convoyId)} convoy · ${counts.camerasOf(s.convoyId)} cameras`, `Convoy ${convoyName(s.convoyId)} · ${counts.camerasOf(s.convoyId)} cámaras`)
        : tr(`Fleet · ${counts.cameras} cameras`, `Flota · ${counts.cameras} cámaras`);
    case 'voyage': {
      const v = voyages.find((x) => x.id === s.voyageId);
      return tr(`${s.voyageId} · ${convoyName(v?.convoyId ?? '')} convoy`, `${s.voyageId} · convoy ${convoyName(v?.convoyId ?? '')}`);
    }
    case 'barges': {
      const vs = s.vesselIds.map((id) => vesselById(id)).filter(Boolean);
      return `${s.voyageId} · ${vs.map((v, i) => (i === 0 ? v!.name : v!.short)).join(', ')}`;
    }
    case 'models':
      return tr('All use cases · reviewed events', 'Todos los casos de uso · eventos revisados');
    case 'audit':
      return tr('Views, downloads and changes · watermarked', 'Vistas, descargas y cambios · con marca de agua');
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function periodText(p: RPeriod, lang: Lang, today: string): string {
  const tr = docTr(lang);
  switch (p.kind) {
    case 'day':
      return docDay(p.date, lang);
    case 'days':
      return docRange(p.from, p.to, lang);
    case 'week':
      return p.to >= today
        ? tr(`Week ${p.week} so far, ${docRange(p.from, today, lang)}`, `Semana ${p.week} hasta ahora, ${docRange(p.from, today, lang)}`)
        : tr(`Week ${p.week}, ${docRange(p.from, p.to, lang)}`, `Semana ${p.week}, ${docRange(p.from, p.to, lang)}`);
    case 'month':
      return cap(docMonth(p.month, lang));
    case 'voyage':
      return p.to ? docRange(p.from, p.to, lang) : tr(`${docDay(p.from, lang)} – arrival`, `${docDay(p.from, lang)} – llegada`);
    case 'perf':
      return p.period === 'sep'
        ? cap(docMonth(8, lang))
        : p.period === 'all'
          ? tr('Since go-live', 'Desde la puesta en marcha')
          : tr(`Last ${p.period === '7d' ? 7 : 30} days`, `Últimos ${p.period === '7d' ? 7 : 30} días`);
  }
}

export function sentToText(r: Pick<LibraryReport, 'sentTo' | 'status'>, lang: Lang): string {
  const tr = docTr(lang);
  if (r.status === 'generated' || !r.sentTo.length) return tr('On demand · not sent', 'A pedido · no enviado');
  return r.sentTo
    .map((tok) => {
      if (tok === 'mgmt') return tr('GFSA management', 'Dirección de GFSA');
      if (tok.startsWith('master:')) {
        const c = convoyById(tok.slice(7))?.name ?? '';
        return tr(`Master ${c}`, `Capitán ${c}`);
      }
      if (tok.startsWith('role:')) {
        const role = roleById(tok.slice(5) as RoleId);
        return lang === 'es' ? role.nameEs : role.name;
      }
      return tok;
    })
    .join(', ');
}

function daily(vesselId: string, date: string, id: string): LibraryReport {
  const v = vesselById(vesselId)!;
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return {
    id,
    template: 'daily',
    subject: { kind: 'vessel', vesselId },
    vesselIds: [v.id],
    period: { kind: 'day', date },
    at: iso(next.toISOString().slice(5, 10), '06:00'),
    sentTo: ['role:ops_manager', `master:${v.convoyId}`],
    status: 'sent',
    daily: { vesselId: v.id, date },
  };
}

const designRows: LibraryReport[] = [
  daily('f501', '2026-10-14', 'r01'),
  daily('f503', '2026-10-14', 'r02'),
  daily('tuy-tug', '2026-10-14', 'r03'),
  {
    id: 'r04',
    template: 'weekly_fleet',
    subject: { kind: 'fleet' },
    vesselIds: [],
    period: { kind: 'week', week: 41, from: '2026-10-05', to: '2026-10-11' },
    at: iso('10-12', '07:00'),
    sentTo: ['role:fleet_super', 'mgmt'],
    status: 'sent',
  },
  {
    id: 'r05',
    template: 'voyage',
    subject: { kind: 'voyage', voyageId: 'VOY-26-037' },
    vesselIds: ['tuy-tug', 'f501', 'f503'],
    period: { kind: 'voyage', voyageId: 'VOY-26-037', from: '2026-10-01', to: '2026-10-09' },
    at: iso('10-09', '18:22'),
    sentTo: ['role:ops_manager'],
    status: 'sent',
    voyageId: 'VOY-26-037',
  },
  {
    id: 'r06',
    template: 'camera_uptime',
    subject: { kind: 'cameras' },
    vesselIds: [],
    period: { kind: 'day', date: '2026-10-14' },
    at: iso('10-15', '06:05'),
    sentTo: ['role:safety_admin'],
    status: 'sent',
  },
  {
    id: 'r07',
    template: 'model_perf',
    subject: { kind: 'models' },
    vesselIds: [],
    period: { kind: 'perf', period: 'sep' },
    at: iso('10-01', '07:00'),
    sentTo: ['role:safety_admin', 'mgmt'],
    status: 'sent',
  },
  {
    id: 'r08',
    template: 'reefer',
    subject: { kind: 'barges', voyageId: 'VOY-26-041', vesselIds: ['f501', 'f503'] },
    vesselIds: ['f501', 'f503'],
    period: { kind: 'voyage', voyageId: 'VOY-26-041', from: '2026-10-11' },
    at: iso('10-16', '22:00'),
    sentTo: ['role:ops_manager'],
    status: 'scheduled',
    voyageId: 'VOY-26-041',
  },
  {
    id: 'r09',
    template: 'daily',
    subject: { kind: 'convoy', convoyId: 'boq', inPort: true },
    vesselIds: ['boq-tug', 'f502', 'f504'],
    period: { kind: 'day', date: '2026-10-14' },
    at: iso('10-15', '06:00'),
    sentTo: ['role:ops_manager', 'master:boq'],
    status: 'sent',
    daily: { vesselId: 'boq-tug', date: '2026-10-14' },
  },
  {
    id: 'r10',
    template: 'audit',
    subject: { kind: 'audit' },
    vesselIds: [],
    period: { kind: 'month', month: 8 },
    at: iso('10-02', '09:14'),
    sentTo: ['role:tenant_admin'],
    status: 'sent',
    stats: [
      ['entries', '4912'],
      ['downloads', '37'],
      ['config_changes', '58'],
      ['chain', 'intact'],
    ],
  },
];

// Older reports, newest first, so the library holds 47 in the last 30 days.
const humVessels = vessels.filter((v) => v.convoyId === 'hum').map((v) => v.id);
const perDay = ['tuy-tug', 'f501', 'f503', 'hum-tug', 'f505', 'f507', 'f509', 'boq-tug'];
let seq = 11;
const nid = () => `r${seq++}`;

const olderRows: LibraryReport[] = [
  ...humVessels.map((v) => daily(v, '2026-10-14', nid())),
  ...['2026-10-13', '2026-10-12', '2026-10-11'].flatMap((d) => perDay.map((v) => daily(v, d, nid()))),
  ...['13', '12', '11'].map(
    (d): LibraryReport => ({
      id: nid(),
      template: 'camera_uptime',
      subject: { kind: 'cameras' },
      vesselIds: [],
      period: { kind: 'day', date: `2026-10-${String(Number(d) - 1).padStart(2, '0')}` },
      at: iso(`10-${d}`, '06:05'),
      sentTo: ['role:safety_admin'],
      status: 'sent',
    }),
  ),
  {
    id: nid(),
    template: 'reefer',
    subject: { kind: 'barges', voyageId: 'VOY-26-037', vesselIds: ['f501', 'f503'] },
    vesselIds: ['f501', 'f503'],
    period: { kind: 'voyage', voyageId: 'VOY-26-037', from: '2026-10-01', to: '2026-10-09' },
    at: iso('10-09', '18:25'),
    sentTo: ['role:ops_manager'],
    status: 'sent',
    voyageId: 'VOY-26-037',
  },
  {
    id: nid(),
    template: 'voyage',
    subject: { kind: 'voyage', voyageId: 'VOY-26-036' },
    vesselIds: ['boq-tug', 'f502', 'f504'],
    period: { kind: 'voyage', voyageId: 'VOY-26-036', from: '2026-09-28', to: '2026-10-06' },
    at: iso('10-06', '12:10'),
    sentTo: ['role:ops_manager'],
    status: 'sent',
    voyageId: 'VOY-26-036',
  },
  {
    id: nid(),
    template: 'reefer',
    subject: { kind: 'barges', voyageId: 'VOY-26-036', vesselIds: ['f502', 'f504'] },
    vesselIds: ['f502', 'f504'],
    period: { kind: 'voyage', voyageId: 'VOY-26-036', from: '2026-09-28', to: '2026-10-06' },
    at: iso('10-06', '12:12'),
    sentTo: ['role:ops_manager'],
    status: 'sent',
    voyageId: 'VOY-26-036',
  },
  ...(
    [
      [40, '2026-09-28', '2026-10-04', '10-05'],
      [39, '2026-09-21', '2026-09-27', '09-28'],
      [38, '2026-09-14', '2026-09-20', '09-21'],
    ] as const
  ).map(
    ([w, from, to, d]): LibraryReport => ({
      id: nid(),
      template: 'weekly_fleet',
      subject: { kind: 'fleet' },
      vesselIds: [],
      period: { kind: 'week', week: w, from, to },
      at: iso(d, '07:00'),
      sentTo: ['role:fleet_super', 'mgmt'],
      status: 'sent',
    }),
  ),
];

export const initialLibrary: LibraryReport[] = [...designRows, ...olderRows];

/** ISO week number of a calendar day. */
export function isoWeek(date: string): { week: number; from: string; to: string } {
  const t = new Date(`${date}T12:00:00Z`);
  const wd = (t.getUTCDay() + 6) % 7; // Monday 0
  const monday = new Date(t);
  monday.setUTCDate(t.getUTCDate() - wd);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  const jan1 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday.getTime() - jan1.getTime()) / 86_400_000 + 1) / 7);
  return { week, from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}

/** "Under way · day 5 of 7" and similar voyage notes, in a language. */
export function voyageNote(note: string, lang: Lang): string {
  if (lang === 'en') return note;
  return note
    .replace('Under way', 'En navegación')
    .replace(/day (\d+) of (\d+)/, 'día $1 de $2')
    .replace('out of coverage', 'sin cobertura')
    .replace('In port', 'En puerto')
    .replace('cargo operations', 'operaciones de carga')
    .replace(/Completed (\d+) (\w{3})/, (_, d, m) => `Completado ${d} ${m.toLowerCase()}`);
}

/** "Buenos Aires due 16 Oct 22:00" and similar calls, in a language. */
export function nextCallText(call: string, lang: Lang): string {
  const p = parseNextCall(call);
  if (p) return lang === 'es' ? `${p.place}, prevista ${docDay(p.at, lang)} ${call.slice(-5)}` : call;
  if (lang === 'en') return call;
  return call
    .replace(/^Departs (.+) (\d+) (\w{3}) (\d{2}:\d{2})$/, (_, pl, d, m, t) => `Sale de ${pl} ${d} ${m.toLowerCase()} ${t}`)
    .replace(/^Arrived (.+) (\d+) (\w{3}) (\d{2}:\d{2})$/, (_, pl, d, m, t) => `Llegó a ${pl} ${d} ${m.toLowerCase()} ${t}`);
}
