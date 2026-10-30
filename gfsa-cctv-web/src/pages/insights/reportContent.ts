import { voyages } from '../../data/alarms';
import { TARGETS, useCaseById } from '../../data/useCases';
import type { Alarm, AlarmState, AuditEntry, Classification, Priority, ReviewEvent, Vessel } from '../../data/types';
import { PRIORITY_NAME, PRIORITY_NAME_ES } from '../../components/ui';
import type { Fleet } from '../../state/fleetStore';
import type { Lang } from '../../lib/i18n';
import { slug, type PdfBlock } from '../../lib/download';
import {
  ROUND_TIMES,
  cameraName,
  dailyDoc,
  hMin,
  longDate,
  minsToHm,
  routeText,
  t,
  useCaseName,
  voyageOn,
  type DailySummary,
} from './dailyData';
import {
  CONSENT,
  PERIOD_TEXT,
  fleetPerf,
  fmtFa,
  gateOf,
  isOlder,
  liveVersion,
  perfRows,
  reasonsFor,
  type PerfInput,
  type PerfPeriod,
  type RegistryState,
  type UcPerf,
} from './modelData';
import {
  STAT_TEXT,
  nextCallText,
  periodText,
  sentToText,
  subjectText,
  templateName,
  voyageNote,
  type LibraryReport,
  type RPeriod,
  type Subject,
  type TemplateId,
} from './reportsData';
import { apportion, dateOf, daysBetween, docDay, docDayTime, docTr, fmtInt, pct, seeded } from './insightsUtil';

// REP-02 / REP-03: the content of every report, as PDF blocks in the report's
// language and as the key figures shown on the library preview. Finished days
// come from the daily history; today and the model numbers include what the
// console holds now (alarms, review queue, audit log, fleet, use case status).

export interface ReportCtx {
  lang: Lang;
  nowMs: number;
  today: string;
  fleet: Fleet;
  /** The daily summary of a vessel on a day (today is live). */
  summary: (vesselId: string, date: string) => DailySummary;
  alarms: Alarm[];
  reviewEvents: ReviewEvent[];
  audit: AuditEntry[];
  perf: PerfInput;
  registry: RegistryState;
}

export interface ReportContent {
  title: string;
  subtitle: string;
  kpis: [string, string][];
  blocks: PdfBlock[];
  file: string;
}

const STATE_TEXT: Record<AlarmState, [string, string]> = {
  raised: ['Raised', 'Generada'],
  ack_board: ['Acknowledged on board', 'Confirmada a bordo'],
  ack_shore: ['Acknowledged ashore', 'Confirmada en tierra'],
  resolved: ['Resolved', 'Resuelta'],
  closed: ['Closed', 'Cerrada'],
};

const CLASS_TEXT: Record<Classification, [string, string]> = {
  accepted: ['Accepted', 'Aceptada'],
  rejected: ['Rejected', 'Rechazada'],
  false_alert: ['False alert', 'Falsa alerta'],
};

const prio = (p: Priority, lang: Lang) => `${p} ${(lang === 'es' ? PRIORITY_NAME_ES : PRIORITY_NAME)[p]}`;

const counts = (fleet: Fleet) => ({
  convoys: fleet.convoys.length,
  cameras: fleet.cameras.length,
  camerasOf: (id: string) => fleet.camerasOf(id).length,
});

function vesselsIn(subject: Subject, fleet: Fleet, vesselIds: string[]): Vessel[] {
  if (subject.kind === 'convoy' || (subject.kind === 'cameras' && subject.convoyId)) return fleet.vesselsOf(subject.kind === 'convoy' ? subject.convoyId : subject.convoyId!);
  if (vesselIds.length) return vesselIds.map((id) => fleet.vesselById(id)).filter((v): v is Vessel => !!v);
  return fleet.vessels;
}

/** Calendar days a period covers, up to today. */
export function periodDays(p: RPeriod, today: string): string[] {
  const upTo = (d: string) => (d > today ? today : d);
  switch (p.kind) {
    case 'day':
      return [p.date];
    case 'days':
      return daysBetween(p.from, upTo(p.to));
    case 'week':
      return daysBetween(p.from, upTo(p.to));
    case 'voyage':
      return daysBetween(p.from, upTo(p.to ?? today));
    case 'month': {
      const from = `2026-${String(p.month + 1).padStart(2, '0')}-01`;
      const last = new Date(Date.UTC(2026, p.month + 1, 0)).getUTCDate();
      return daysBetween(from, upTo(`2026-${String(p.month + 1).padStart(2, '0')}-${last}`));
    }
    case 'perf':
      return [];
  }
}

const fmtAck = (ms: number) => `${Math.floor(ms / 60000)} m ${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')} s`;

export function reportFile(r: LibraryReport, lang: Lang, ctx: ReportCtx, prefix = ''): string {
  const parts = [prefix, templateName(r.template, 'en'), subjectText(r.subject, 'en', counts(ctx.fleet)).split(' · ')[0], periodText(r.period, 'en', ctx.today), lang];
  return `${parts.filter(Boolean).map(slug).join('-').slice(0, 110)}.pdf`;
}

/** Title, subtitle, key figures and PDF blocks for a library report. */
export function reportContent(r: LibraryReport, ctx: ReportCtx): ReportContent {
  const { lang } = ctx;
  const tr = docTr(lang);
  const name = templateName(r.template, lang);
  const subject = subjectText(r.subject, lang, counts(ctx.fleet));
  const period = periodText(r.period, lang, ctx.today);
  const head: PdfBlock[] = [
    {
      kind: 'meta',
      text:
        r.status === 'scheduled'
          ? tr(`Scheduled · ${sentToText(r, lang)} · this copy shows the voyage so far`, `Programado · ${sentToText(r, lang)} · esta copia muestra el viaje hasta ahora`)
          : r.status === 'generated'
            ? tr(`Generated on demand ${docDayTime(r.at, lang)}${r.by ? ` by ${r.by}` : ''} · not sent`, `Generado a pedido el ${docDayTime(r.at, lang)}${r.by ? ` por ${r.by}` : ''} · no enviado`)
            : tr(`Generated ${docDayTime(r.at, lang)} Asunción · sent to ${sentToText(r, lang)}`, `Generado el ${docDayTime(r.at, lang)} hora de Asunción · enviado a ${sentToText(r, lang)}`),
    },
  ];
  const base = { file: reportFile(r, lang, ctx) };
  const built = build(r.template, r, ctx);
  return {
    ...base,
    title: built.title ?? `${name} · ${subject}`,
    subtitle: built.subtitle ?? period,
    kpis: built.kpis,
    blocks: [...head, ...built.blocks],
  };
}

type Built = { title?: string; subtitle?: string; kpis: [string, string][]; blocks: PdfBlock[] };

function build(tpl: TemplateId, r: LibraryReport, ctx: ReportCtx): Built {
  switch (tpl) {
    case 'daily':
      return dailyContent(r, ctx);
    case 'weekly_fleet':
      return weeklyContent(r, ctx);
    case 'voyage':
      return voyageContent(r, ctx);
    case 'camera_uptime':
      return uptimeContent(r, ctx);
    case 'model_perf':
      return modelContent(r, ctx);
    case 'reefer':
      return reeferContent(r, ctx);
    case 'audit':
      return auditContent(r, ctx);
  }
}

// ---------- Daily summary ----------

function dailyContent(r: LibraryReport, ctx: ReportCtx): Built {
  const { lang } = ctx;
  const tr = docTr(lang);
  const date = r.daily?.date ?? (r.period.kind === 'day' ? r.period.date : ctx.today);
  const ids = r.vesselIds.length ? r.vesselIds : [r.daily!.vesselId];
  const sums = ids.map((id) => ctx.summary(id, date));
  const on = sums.reduce((s, x) => s + (x.rounds?.filter((q) => q.result === 'on_time').length ?? 0), 0);
  const counted = sums.reduce((s, x) => s + (x.rounds?.filter((q) => q.result !== 'upcoming').length ?? 0), 0);
  const kpis: [string, string][] = [
    [tr('events', 'eventos'), String(sums.reduce((s, x) => s + x.total, 0))],
    [tr('accepted', 'aceptados'), String(sums.reduce((s, x) => s + x.outcomes.accepted, 0))],
    [tr('false alerts', 'falsas alertas'), String(sums.reduce((s, x) => s + x.outcomes.falseAlert, 0))],
    [tr('rounds on time', 'rondas a tiempo'), sums.some((x) => x.rounds) ? t('of', lang, { a: on, b: counted }) : '–'],
  ];
  if (sums.length === 1) {
    const d = dailyDoc(sums[0], lang);
    return { title: d.title, subtitle: d.subtitle, kpis, blocks: d.blocks };
  }
  return {
    title: `${t('kicker', lang)} · ${subjectText(r.subject, lang, counts(ctx.fleet))}`,
    subtitle: `${longDate(date, lang)} · ${t('tz', lang)}`,
    kpis,
    blocks: sums.flatMap((s) => [{ kind: 'h1', text: s.vesselName } as PdfBlock, ...dailyDoc(s, lang).blocks]),
  };
}

// ---------- Weekly fleet report ----------

function weeklyContent(r: LibraryReport, ctx: ReportCtx): Built {
  const { lang, fleet, today } = ctx;
  const tr = docTr(lang);
  const days = periodDays(r.period, today);
  const vs = vesselsIn(r.subject, fleet, r.vesselIds);
  const convoyIds = [...new Set(vs.map((v) => v.convoyId))];
  const sums = days.flatMap((d) => vs.map((v) => ctx.summary(v.id, d)));

  // Alarms: history from the alert-level use cases, today from the console.
  const alarms: { p: Priority; convoyId: string }[] = [];
  for (const s of sums) {
    if (s.live) continue;
    const convoyId = fleet.vesselById(s.vesselId)?.convoyId ?? '';
    for (const e of s.events) {
      const uc = useCaseById(e.useCaseId);
      if (uc?.level === 'alert' && uc.status === 'live' && uc.id !== 'camera-health') for (let k = 0; k < e.count; k++) alarms.push({ p: uc.priority, convoyId });
    }
  }
  const todayAlarms = days.includes(today) ? ctx.alarms.filter((a) => dateOf(a.raisedAt) === today && convoyIds.includes(a.convoyId)) : [];
  todayAlarms.forEach((a) => alarms.push({ p: a.priority, convoyId: a.convoyId }));

  // Time to acknowledge: measured from the console this week, otherwise the week's record.
  const acks = ctx.alarms
    .filter((a) => convoyIds.includes(a.convoyId) && a.stateTimes.ack_shore && a.owner !== 'System' && days.includes(dateOf(a.raisedAt)))
    .map((a) => new Date(a.stateTimes.ack_shore!).getTime() - new Date(a.escalationBase ?? a.raisedAt).getTime())
    .filter((ms) => ms > 0)
    .sort((a, b) => a - b);
  const week = r.period.kind === 'week' ? r.period.week : 0;
  const median = acks.length ? acks[Math.floor(acks.length / 2)] : (85 + Math.floor(seeded(`ack|${week}|${convoyIds.join()}`)() * 70)) * 1000;

  const reviewed = sums.reduce((s, x) => s + x.total - x.outcomes.pending, 0);
  const pending = sums.reduce((s, x) => s + x.outcomes.pending, 0);
  const uptime = sums.length ? Math.round((sums.reduce((s, x) => s + x.uptimePct, 0) / sums.length) * 10) / 10 : 100;
  const byUc = new Map<string, number>();
  for (const s of sums) for (const e of s.events) byUc.set(e.useCaseId, (byUc.get(e.useCaseId) ?? 0) + e.count);

  const under = voyages.filter((v) => convoyIds.includes(v.convoyId) && days.some((d) => voyageOn(v.convoyId, d) === v.id));
  const prios: Priority[] = ['P1', 'P2', 'P3', 'P4'];

  return {
    kpis: [
      [tr('alarms', 'alarmas'), String(alarms.length)],
      [tr('median to acknowledge', 'mediana hasta confirmar'), fmtAck(median)],
      [tr('events reviewed', 'eventos revisados'), String(reviewed)],
      [tr('camera uptime', 'disponibilidad de cámaras'), `${uptime.toFixed(1)}%`],
    ],
    blocks: [
      {
        kind: 'kv',
        rows: [
          [tr('Alarms', 'Alarmas'), String(alarms.length)],
          [tr('Median time to acknowledge', 'Mediana de tiempo hasta confirmar'), `${fmtAck(median)} · ${tr(`target ${TARGETS.ackMinutes} min`, `meta ${TARGETS.ackMinutes} min`)}`],
          [tr('Events reviewed', 'Eventos revisados'), String(reviewed)],
          [tr('Camera uptime', 'Disponibilidad de cámaras'), `${uptime.toFixed(1)}%`],
        ],
      },
      { kind: 'h2', text: tr('Alarms by priority and convoy', 'Alarmas por prioridad y convoy') },
      {
        kind: 'table',
        columns: [
          { label: tr('Priority', 'Prioridad'), width: 1.4 },
          ...convoyIds.map((id) => ({ label: fleet.convoyById(id)?.name ?? id, width: 1, align: 'right' as const })),
          { label: tr('Total', 'Total'), width: 0.8, align: 'right' as const },
        ],
        rows: prios.map((p) => [
          prio(p, lang),
          ...convoyIds.map((id) => String(alarms.filter((a) => a.p === p && a.convoyId === id).length)),
          String(alarms.filter((a) => a.p === p).length),
        ]),
      },
      { kind: 'h2', text: tr('Time to acknowledge', 'Tiempo hasta la confirmación') },
      {
        kind: 'p',
        text: acks.length
          ? tr(
              `Median ${fmtAck(median)} over ${acks.length} alarms acknowledged ashore in the console this week. The target is ${TARGETS.ackMinutes} minutes.`,
              `Mediana de ${fmtAck(median)} sobre ${acks.length} alarmas confirmadas en tierra en la consola esta semana. La meta es de ${TARGETS.ackMinutes} minutos.`,
            )
          : tr(`Median ${fmtAck(median)} from the alert routing record. The target is ${TARGETS.ackMinutes} minutes.`, `Mediana de ${fmtAck(median)} según el registro del enrutamiento de alertas. La meta es de ${TARGETS.ackMinutes} minutos.`),
      },
      { kind: 'h2', text: tr('Events by use case', 'Eventos por caso de uso') },
      {
        kind: 'bars',
        rows: [...byUc.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ label: useCaseName(id, lang), value: n })),
      },
      { kind: 'h2', text: tr('Review backlog', 'Revisiones pendientes') },
      {
        kind: 'p',
        text: pending
          ? tr(`${pending} events waiting for review at the end of the period.`, `${pending} eventos pendientes de revisión al final del período.`)
          : tr('Every event in the period was reviewed.', 'Todos los eventos del período fueron revisados.'),
      },
      { kind: 'h2', text: tr('Voyages under way', 'Viajes en curso') },
      under.length
        ? {
            kind: 'table',
            columns: [
              { label: tr('Voyage', 'Viaje'), width: 1.2 },
              { label: tr('Convoy', 'Convoy'), width: 1.2 },
              { label: tr('Route', 'Ruta'), width: 2 },
              { label: tr('Status', 'Estado'), width: 2 },
            ],
            rows: under.map((v) => [v.id, fleet.convoyById(v.convoyId)?.name ?? '', routeText(v.route, lang), voyageNote(v.statusNote, lang)]),
          }
        : { kind: 'p', text: tr('No voyages in this period.', 'Sin viajes en este período.') },
    ],
  };
}

// ---------- Voyage report ----------

function voyageContent(r: LibraryReport, ctx: ReportCtx): Built {
  const { lang, fleet, today } = ctx;
  const tr = docTr(lang);
  const v = voyages.find((x) => x.id === r.voyageId);
  if (!v) return { kpis: [], blocks: [{ kind: 'p', text: tr('The voyage record is not available.', 'El registro del viaje no está disponible.') }] };
  const days = periodDays(r.period, today);
  const vs = fleet.vesselsOf(v.convoyId);
  const sums = days.flatMap((d) => vs.map((x) => ctx.summary(x.id, d)));
  const byUc = new Map<string, number>();
  for (const s of sums) for (const e of s.events) byUc.set(e.useCaseId, (byUc.get(e.useCaseId) ?? 0) + e.count);
  const ucs = [...byUc.keys()];
  const parts = apportion(v.events, ucs.map((id) => byUc.get(id) ?? 0));
  const alarms = ctx.alarms.filter((a) => a.voyageId === v.id).sort((a, b) => a.raisedAt.localeCompare(b.raisedAt));
  const [on, total] = v.reeferOnTime;

  return {
    kpis: [
      [tr('events', 'eventos'), String(v.events)],
      [tr('alarms', 'alarmas'), String(v.alarms)],
      [tr('rounds on time', 'rondas a tiempo'), t('of', lang, { a: on, b: total })],
      [tr('cargo differences', 'diferencias de carga'), String(v.cargoDifferences)],
    ],
    blocks: [
      { kind: 'h2', text: tr('Route and timeline', 'Ruta y cronología') },
      {
        kind: 'kv',
        rows: [
          [tr('Route', 'Ruta'), routeText(v.route, lang)],
          [tr('Convoy', 'Convoy'), `${fleet.convoyById(v.convoyId)?.name ?? ''} · ${vs.map((x) => x.short === 'Tug' ? tr('tug', 'remolcador') : x.short).join(', ')}`],
          [tr('Departed', 'Salida'), `${docDayTime(v.departedAt, lang)} Asunción`],
          [tr('Status', 'Estado'), voyageNote(v.statusNote, lang)],
          [v.status === 'completed' ? tr('Arrival', 'Llegada') : tr('Next call', 'Próxima escala'), nextCallText(v.nextCall, lang)],
          [tr('Days covered', 'Días cubiertos'), String(days.length)],
        ],
      },
      { kind: 'h2', text: tr('Alarms and responses', 'Alarmas y respuestas') },
      alarms.length
        ? {
            kind: 'table',
            columns: [
              { label: tr('Alarm', 'Alarma'), width: 1.3 },
              { label: tr('Priority', 'Prioridad'), width: 1.1 },
              { label: tr('What', 'Qué'), width: 2.6 },
              { label: tr('Raised', 'Generada'), width: 1.2 },
              { label: tr('State', 'Estado'), width: 1.5 },
            ],
            rows: alarms.map((a) => [
              a.id,
              prio(a.priority, lang),
              lang === 'es' && a.titleEs ? a.titleEs : a.title,
              docDayTime(a.raisedAt, lang),
              `${STATE_TEXT[a.state][lang === 'es' ? 1 : 0]}${a.classification ? ` · ${CLASS_TEXT[a.classification][lang === 'es' ? 1 : 0]}` : ''}`,
            ]),
          }
        : { kind: 'p', text: tr('No alarms from this voyage are held in the console.', 'La consola no tiene alarmas de este viaje.') },
      ...(alarms.length < v.alarms
        ? [
            {
              kind: 'meta',
              text: tr(
                `${v.alarms} alarms on the voyage; ${v.alarms - alarms.length} earlier ones are summarised in the voyage record.`,
                `${v.alarms} alarmas en el viaje; las ${v.alarms - alarms.length} anteriores están resumidas en el registro del viaje.`,
              ),
            } as PdfBlock,
          ]
        : []),
      { kind: 'h2', text: tr('Events by use case', 'Eventos por caso de uso') },
      { kind: 'bars', rows: ucs.map((id, i) => ({ label: useCaseName(id, lang), value: parts[i] })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value) },
      { kind: 'h2', text: tr('Reefer rounds', 'Rondas de reefers') },
      {
        kind: 'kv',
        rows: [
          [tr('Rounds', 'Rondas'), String(total)],
          [tr('On time', 'A tiempo'), String(on)],
          [tr('Missed or late', 'Perdidas o tardías'), String(total - on)],
        ],
      },
      { kind: 'h2', text: tr('Cargo differences', 'Diferencias de carga') },
      {
        kind: 'p',
        text: v.cargoDifferences
          ? tr(
              `${v.cargoDifferences} difference${v.cargoDifferences === 1 ? '' : 's'} between the manifest in Connect and what the cameras recorded. Each is in the voyage record with its clip.`,
              `${v.cargoDifferences} diferencia${v.cargoDifferences === 1 ? '' : 's'} entre el manifiesto de Connect y lo que registraron las cámaras. Cada una está en el registro del viaje con su clip.`,
            )
          : tr('No cargo differences recorded.', 'No se registraron diferencias de carga.'),
      },
    ],
  };
}

// ---------- Reefer round compliance ----------

function reeferContent(r: LibraryReport, ctx: ReportCtx): Built {
  const { lang, fleet, today } = ctx;
  const tr = docTr(lang);
  const v = voyages.find((x) => x.id === r.voyageId);
  if (!v) return { kpis: [], blocks: [{ kind: 'p', text: tr('The voyage record is not available.', 'El registro del viaje no está disponible.') }] };
  const days = periodDays(r.period, today);
  const barges = r.vesselIds.map((id) => fleet.vesselById(id)).filter((x): x is Vessel => !!x);
  const [on, total] = v.reeferOnTime;
  const off = total - on;

  // The rounds not on time, from the daily history of each barge.
  const misses: { date: string; vesselId: string; due: string; seen?: string; result: 'missed' | 'late' }[] = [];
  for (const d of days)
    for (const b of barges)
      for (const q of ctx.summary(b.id, d).rounds ?? []) if (q.result === 'missed' || q.result === 'late') misses.push({ date: d, vesselId: b.id, due: q.due, seen: q.seen, result: q.result });
  const chosen = misses.slice(0, off);
  const rnd = seeded(`reefer|${v.id}`);
  while (chosen.length < off && days.length && barges.length) {
    const due = ROUND_TIMES[Math.floor(rnd() * ROUND_TIMES.length)];
    chosen.push({ date: days[Math.floor(rnd() * days.length)], vesselId: barges[Math.floor(rnd() * barges.length)].id, due, seen: minsToHm(Number(due.slice(0, 2)) * 60 + 18 + Math.floor(rnd() * 20)), result: 'late' });
  }
  chosen.sort((a, b) => a.date.localeCompare(b.date) || a.due.localeCompare(b.due));
  const perBarge = apportion(total, barges.map(() => 1));
  const soFar = v.status !== 'completed';

  return {
    title: `${templateName('reefer', lang)} · ${subjectText(r.subject, lang, counts(fleet))}${r.status === 'scheduled' ? tr(' (so far)', ' (hasta ahora)') : ''}`,
    kpis: [
      [soFar ? tr('rounds so far', 'rondas hasta ahora') : tr('rounds', 'rondas'), String(total)],
      [tr('on time', 'a tiempo'), String(on)],
      [tr('missed or late', 'perdidas o tardías'), String(off)],
    ],
    blocks: [
      { kind: 'h2', text: tr('Rounds on time', 'Rondas a tiempo') },
      {
        kind: 'kv',
        rows: [
          [tr('Rounds in the Connect schedule', 'Rondas en el horario de Connect'), String(total)],
          [tr('Seen on time', 'Vistas a tiempo'), `${on} · ${total ? Math.round((on / total) * 100) : 100}%`],
          [tr('Missed or late', 'Perdidas o tardías'), String(off)],
          [tr('Tolerance', 'Tolerancia'), '15 min'],
        ],
      },
      { kind: 'h2', text: tr('Missed and late rounds', 'Rondas perdidas y tardías') },
      chosen.length
        ? {
            kind: 'table',
            columns: [
              { label: tr('Day', 'Día'), width: 1 },
              { label: tr('Barge', 'Barcaza'), width: 1.6 },
              { label: t('due', lang), width: 1 },
              { label: t('seen', lang), width: 1 },
              { label: t('result', lang), width: 1.2 },
            ],
            rows: chosen.map((m) => [docDay(m.date, lang), fleet.vesselById(m.vesselId)?.name ?? m.vesselId, m.due, m.seen ?? t('notSeen', lang), t(m.result === 'missed' ? 'missed' : 'late', lang)]),
          }
        : { kind: 'p', text: tr('Every round was seen within the 15 min tolerance.', 'Todas las rondas se vieron dentro de la tolerancia de 15 min.') },
      { kind: 'h2', text: tr('Rounds by barge', 'Rondas por barcaza') },
      {
        kind: 'table',
        columns: [
          { label: tr('Barge', 'Barcaza'), width: 2 },
          { label: tr('Rounds', 'Rondas'), width: 1, align: 'right' },
          { label: tr('On time', 'A tiempo'), width: 1, align: 'right' },
          { label: tr('Missed or late', 'Perdidas o tardías'), width: 1.3, align: 'right' },
        ],
        rows: barges.map((b, i) => {
          const missed = chosen.filter((m) => m.vesselId === b.id).length;
          return [b.name, String(perBarge[i]), String(Math.max(0, perBarge[i] - missed)), String(missed)];
        }),
      },
      { kind: 'meta', text: tr('Schedule from Connect. Missed rounds were sent to the voyage record.', 'Horario de Connect. Las rondas perdidas se enviaron al registro del viaje.') },
    ],
  };
}

// ---------- Camera uptime ----------

function uptimeContent(r: LibraryReport, ctx: ReportCtx): Built {
  const { lang, fleet, today } = ctx;
  const tr = docTr(lang);
  const days = periodDays(r.period, today);
  const vs = vesselsIn(r.subject, fleet, r.vesselIds);
  const cams = new Map<string, { vesselId: string; name: string; pcts: number[]; down: number }>();
  const outages: { date: string; cameraId: string; vesselId: string; name: string; from: number; mins: number; ongoing?: boolean }[] = [];
  const silent: { date: string; convoyId: string; units: number; gap: number }[] = [];
  for (const d of days) {
    const convoysSeen = new Set<string>();
    for (const v of vs) {
      const s = ctx.summary(v.id, d);
      for (const u of s.uptime) {
        const c = cams.get(u.cameraId) ?? { vesselId: v.id, name: u.name, pcts: [], down: 0 };
        c.pcts.push(u.pct);
        c.down += u.down?.mins ?? 0;
        cams.set(u.cameraId, c);
        if (u.down) outages.push({ date: d, cameraId: u.cameraId, vesselId: v.id, name: u.name, from: u.down.from, mins: u.down.mins, ongoing: u.ongoing });
      }
      if (!convoysSeen.has(v.convoyId)) {
        convoysSeen.add(v.convoyId);
        if (d === today) {
          const n = fleet.unitsOf(v.convoyId).filter((u) => u.status !== 'reporting').length;
          if (n) silent.push({ date: d, convoyId: v.convoyId, units: n, gap: s.longestWait });
        } else if (s.longestWait >= 60) silent.push({ date: d, convoyId: v.convoyId, units: fleet.unitsOf(v.convoyId).length, gap: s.longestWait });
      }
    }
  }
  const rows = [...cams.entries()].map(([id, c]) => ({ id, ...c, pct: Math.round((c.pcts.reduce((a, x) => a + x, 0) / c.pcts.length) * 10) / 10 })).sort((a, b) => a.pct - b.pct);
  const fleetPct = rows.length ? Math.round((rows.reduce((a, x) => a + x.pct, 0) / rows.length) * 10) / 10 : 100;
  const below = rows.filter((x) => x.pct < 99);
  const unitsSilent = silent.reduce((m, x) => Math.max(m, x.units), 0);

  return {
    kpis: [
      [tr('fleet uptime', 'disponibilidad de la flota'), `${fleetPct.toFixed(1)}%`],
      [tr('below 99%', 'por debajo del 99%'), tr(`${below.length} camera${below.length === 1 ? '' : 's'}`, `${below.length} cámara${below.length === 1 ? '' : 's'}`)],
      [tr('scene checks failed', 'controles de escena fallidos'), String(outages.length)],
      [tr('units not reporting', 'unidades sin reportar'), String(unitsSilent)],
    ],
    blocks: [
      { kind: 'h2', text: tr('Fleet uptime', 'Disponibilidad de la flota') },
      {
        kind: 'kv',
        rows: [
          [tr('Cameras', 'Cámaras'), String(rows.length)],
          [tr('Average uptime', 'Disponibilidad promedio'), `${fleetPct.toFixed(1)}%`],
          [tr('Days', 'Días'), String(days.length)],
        ],
      },
      { kind: 'h2', text: tr('Cameras below 99%', 'Cámaras por debajo del 99%') },
      below.length
        ? {
            kind: 'table',
            columns: [
              { label: tr('Camera', 'Cámara'), width: 1.4 },
              { label: tr('Vessel', 'Embarcación'), width: 1.6 },
              { label: tr('Position', 'Ubicación'), width: 1.6 },
              { label: tr('Uptime', 'Disponibilidad'), width: 1, align: 'right' },
              { label: tr('Offline', 'Sin imagen'), width: 1, align: 'right' },
            ],
            rows: below.map((x) => [x.id, fleet.vesselById(x.vesselId)?.name ?? '', cameraName(x.name, lang), `${x.pct.toFixed(1)}%`, hMin(x.down)]),
          }
        : { kind: 'p', text: tr('Every camera was at 99% or more.', 'Todas las cámaras estuvieron al 99% o más.') },
      { kind: 'h2', text: tr('Scene-check failures', 'Fallas del control de escena') },
      outages.length
        ? {
            kind: 'table',
            columns: [
              { label: tr('Day', 'Día'), width: 0.9 },
              { label: tr('Camera', 'Cámara'), width: 1.4 },
              { label: tr('Position', 'Ubicación'), width: 1.8 },
              { label: tr('Offline', 'Sin imagen'), width: 2 },
            ],
            rows: outages
              .sort((a, b) => a.date.localeCompare(b.date) || a.from - b.from)
              .map((o) => [
                docDay(o.date, lang),
                o.cameraId,
                `${fleet.vesselById(o.vesselId)?.short === 'Tug' ? fleet.vesselById(o.vesselId)?.name : fleet.vesselById(o.vesselId)?.short} · ${cameraName(o.name, lang)}`,
                o.ongoing ? tr(`since ${minsToHm(o.from)}, not back yet`, `desde las ${minsToHm(o.from)}, aún sin volver`) : `${minsToHm(o.from)}–${minsToHm(o.from + o.mins)} · ${hMin(o.mins)}`,
              ]),
          }
        : { kind: 'p', text: tr('No scene check failed.', 'Ningún control de escena falló.') },
      { kind: 'h2', text: tr('Edge units not reporting', 'Unidades de borde sin reportar') },
      silent.length
        ? {
            kind: 'table',
            columns: [
              { label: tr('Day', 'Día'), width: 1 },
              { label: tr('Convoy', 'Convoy'), width: 1.6 },
              { label: tr('Units', 'Unidades'), width: 0.8, align: 'right' },
              { label: tr('Longest without a health message', 'Mayor tiempo sin mensaje de estado'), width: 2.4 },
            ],
            rows: silent.map((x) => [docDay(x.date, lang), fleet.convoyById(x.convoyId)?.name ?? x.convoyId, String(x.units), hMin(x.gap)]),
          }
        : { kind: 'p', text: tr('Every edge unit reported throughout.', 'Todas las unidades de borde reportaron todo el tiempo.') },
      { kind: 'meta', text: tr('Out of coverage, units keep recording and send their queue when the link returns.', 'Sin cobertura, las unidades siguen grabando y envían su cola cuando vuelve el enlace.') },
    ],
  };
}

// ---------- Model performance ----------

export function perfLabel(p: PerfPeriod, lang: Lang) {
  return PERIOD_TEXT[p][lang === 'es' ? 1 : 0];
}

function gateText(u: UcPerf, lang: Lang): string {
  const tr = docTr(lang);
  const g = gateOf(u);
  switch (g) {
    case 'met':
      return tr('Met', 'Cumplida');
    case 'precision':
      return tr('Precision below target', 'Precisión bajo la meta');
    case 'recall':
      return tr('Recall below target', 'Exhaustividad bajo la meta');
    case 'fa':
      return tr('Too many false alerts', 'Demasiadas falsas alertas');
    case 'shadow':
      return u.shadowGate ? u.shadowGate[lang === 'es' ? 1 : 0] : tr('Shadow run', 'Ejecución en sombra');
    case 'not_run':
      return tr('Not run', 'Sin ejecutar');
  }
}

export const statusText = (s: UcPerf['status'], lang: Lang) =>
  docTr(lang)(s === 'live' ? 'Live' : s === 'shadow' ? 'Shadow run' : 'Off', s === 'live' ? 'En vivo' : s === 'shadow' ? 'Ejecución en sombra' : 'Apagado');

/** The model performance content, shared by the screen's export and the monthly report. */
export function modelDoc(period: PerfPeriod, ucId: string, ctx: Pick<ReportCtx, 'lang' | 'perf' | 'registry'>): { kpis: [string, string][]; blocks: PdfBlock[] } {
  const { lang } = ctx;
  const tr = docTr(lang);
  const rows = perfRows(period, ctx.perf);
  const fleet = fleetPerf(period, rows, ctx.perf);
  const uc = ucId === 'all' ? undefined : rows.find((x) => x.id === ucId);
  const reasons = reasonsFor(period, ucId, ctx.perf.deltas);
  const stat = uc ? { precision: uc.precision, recall: uc.recall, fa: uc.fa, reviewed: uc.events } : fleet;
  const live = liveVersion(ctx.registry);
  const show = uc ? [uc] : rows;
  const shown = (v: number | undefined) => (v === undefined ? '–' : pct(v));
  return {
    kpis: [
      [tr('precision', 'precisión'), shown(stat.precision)],
      [tr('recall', 'exhaustividad'), shown(stat.recall)],
      [tr('false alerts per camera-day', 'falsas alertas por cámara y día'), stat.fa === undefined ? '–' : fmtFa(stat.fa)],
      [tr('reviewed events', 'eventos revisados'), fmtInt(stat.reviewed, lang)],
    ],
    blocks: [
      { kind: 'h2', text: uc ? useCaseName(uc.id, lang) : tr('Fleet precision and recall', 'Precisión y exhaustividad de la flota') },
      {
        kind: 'kv',
        rows: [
          [tr('Precision', 'Precisión'), `${shown(stat.precision)} · ${tr(`target ${pct(TARGETS.precision)} or more`, `meta ${pct(TARGETS.precision)} o más`)}`],
          [tr('Recall', 'Exhaustividad'), `${shown(stat.recall)} · ${tr(`target ${pct(TARGETS.recall)} or more`, `meta ${pct(TARGETS.recall)} o más`)}`],
          [tr('False alerts per camera per day', 'Falsas alertas por cámara por día'), `${stat.fa === undefined ? '–' : fmtFa(stat.fa)} · ${tr(`limit ${TARGETS.falseAlertsPerCamDay} or fewer`, `límite ${TARGETS.falseAlertsPerCamDay} o menos`)}`],
          [tr('Reviewed events', 'Eventos revisados'), fmtInt(stat.reviewed, lang)],
          [tr('Model on the vessels', 'Modelo en las embarcaciones'), live.v],
        ],
      },
      { kind: 'h2', text: tr('By use case against targets', 'Por caso de uso frente a las metas') },
      {
        kind: 'table',
        columns: [
          { label: tr('Use case', 'Caso de uso'), width: 2.6 },
          { label: tr('Status', 'Estado'), width: 1.3 },
          { label: tr('Events', 'Eventos'), width: 0.9, align: 'right' },
          { label: tr('Precision', 'Precisión'), width: 0.9, align: 'right' },
          { label: tr('Recall', 'Exhaust.'), width: 0.9, align: 'right' },
          { label: tr('False/cam-day', 'Falsas/cám-día'), width: 1.1, align: 'right' },
          { label: tr('Gate', 'Compuerta'), width: 1.7 },
        ],
        rows: show.map((u) => [
          useCaseName(u.id, lang),
          statusText(u.status, lang),
          `${u.events}${u.unit ? tr(' rounds', ' rondas') : ''}`,
          shown(u.precision),
          shown(u.recall),
          u.fa === undefined ? '–' : fmtFa(u.fa),
          gateText(u, lang),
        ]),
      },
      {
        kind: 'meta',
        text: tr(
          'Measured on events a reviewer accepted or marked as a false alert, including those classified in the console today.',
          'Medido sobre eventos que un revisor aceptó o marcó como falsa alerta, incluidos los clasificados hoy en la consola.',
        ),
      },
      { kind: 'h2', text: tr('False-alert reasons', 'Motivos de falsas alertas') },
      reasons.length
        ? { kind: 'bars', rows: reasons.map((x) => ({ label: x.label[lang === 'es' ? 1 : 0], value: x.count })) }
        : { kind: 'p', text: tr('No false alerts for this selection.', 'Sin falsas alertas para esta selección.') },
      {
        kind: 'meta',
        text: tr(
          `Clips go to training only with GFSA's written consent (signed ${docDay(CONSENT.signed, lang)} 2026), faces blurred.`,
          `Los clips van a entrenamiento solo con el consentimiento escrito de GFSA (firmado el ${docDay(CONSENT.signed, lang)} 2026), con rostros difuminados.`,
        ),
      },
      { kind: 'h2', text: tr('Model versions', 'Versiones del modelo') },
      {
        kind: 'table',
        columns: [
          { label: tr('Version', 'Versión'), width: 1 },
          { label: tr('State', 'Estado'), width: 1.2 },
          { label: tr('Signed', 'Firmada'), width: 1.2 },
          { label: tr('On the vessels', 'En las embarcaciones'), width: 2.4 },
        ],
        rows: ctx.registry.versions.map((m) => [
          m.v,
          m.state === 'draft' ? tr('Draft', 'Borrador') : m.state === 'live' ? tr('Live', 'En vivo') : tr('Previous', 'Anterior'),
          m.signed ? docDay(m.signed, lang) : '–',
          m.state === 'draft'
            ? tr('Not pushed', 'Sin enviar')
            : m.state === 'live'
              ? tr(`Since ${docDayTime(m.pushed ?? m.signed ?? '', lang)}`, `Desde el ${docDayTime(m.pushed ?? m.signed ?? '', lang)}`)
              : isOlder(ctx.registry.versions, m.v, live.v)
                ? tr('Rollback available', 'Reversión disponible')
                : tr('Previous version', 'Versión anterior'),
        ]),
      },
      ...(ctx.registry.rollbacks.length
        ? [
            {
              kind: 'table',
              columns: [
                { label: tr('When', 'Cuándo'), width: 1.2 },
                { label: tr('Change', 'Cambio'), width: 1.4 },
                { label: tr('By', 'Por'), width: 1.4 },
                { label: tr('Edge units', 'Unidades de borde'), width: 1.8 },
              ],
              rows: ctx.registry.rollbacks.map((x) => [
                docDayTime(x.at, lang),
                `${x.from} → ${x.to}`,
                x.by,
                tr(`${x.now} switched, ${x.waiting} waiting for link`, `${x.now} cambiadas, ${x.waiting} esperan enlace`),
              ]),
            } as PdfBlock,
          ]
        : []),
    ],
  };
}

function modelContent(r: LibraryReport, ctx: ReportCtx): Built {
  const p: PerfPeriod = r.period.kind === 'perf' ? r.period.period : '30d';
  return modelDoc(p, 'all', ctx);
}

// ---------- Audit extract ----------

function auditContent(r: LibraryReport, ctx: ReportCtx): Built {
  const { lang } = ctx;
  const tr = docTr(lang);
  const days = new Set(periodDays(r.period, ctx.today));
  const entries = ctx.audit.filter((e) => days.has(dateOf(e.at)));
  // The chain: each entry carries the hash of the one before it.
  const broken = ctx.audit.findIndex((e, i) => i < ctx.audit.length - 1 && e.prevHash !== ctx.audit[i + 1].hash);
  const chain = broken < 0 ? tr('intact', 'íntegra') : tr(`broken at entry ${ctx.audit[broken].seq}`, `rota en la entrada ${ctx.audit[broken].seq}`);

  if (!entries.length && r.stats) {
    const val = (k: string) => r.stats!.find(([x]) => x === k)?.[1] ?? '–';
    const stat = (k: 'entries' | 'downloads' | 'config_changes' | 'chain') =>
      [STAT_TEXT[k][lang === 'es' ? 1 : 0], k === 'chain' ? (val(k) === 'intact' ? tr('intact', 'íntegra') : val(k)) : fmtInt(Number(val(k)), lang)] as [string, string];
    const kpis = [stat('entries'), stat('downloads'), stat('config_changes'), stat('chain')];
    return {
      kpis,
      blocks: [
        { kind: 'kv', rows: kpis.map(([k, v]) => [k.charAt(0).toUpperCase() + k.slice(1), v]) },
        {
          kind: 'p',
          text: tr(
            'This is the archived extract as sent. The entry-by-entry lists for this period are in the archive delivered with it; the console keeps the live hash chain from 15 Oct 2026.',
            'Este es el extracto archivado tal como se envió. Las listas entrada por entrada de este período están en el archivo entregado con él; la consola conserva la cadena de hash en vivo desde el 15 oct 2026.',
          ),
        },
      ],
    };
  }

  const cat = (c: AuditEntry['category']) => entries.filter((e) => e.category === c);
  const table = (list: AuditEntry[]): PdfBlock =>
    list.length
      ? {
          kind: 'table',
          columns: [
            { label: tr('When', 'Cuándo'), width: 1.1 },
            { label: tr('Who', 'Quién'), width: 1.5 },
            { label: tr('Action', 'Acción'), width: 1.5 },
            { label: tr('Object', 'Objeto'), width: 1.5 },
            { label: tr('Details', 'Detalles'), width: 2.4 },
          ],
          rows: list.slice(0, 80).map((e) => [docDayTime(e.at, lang), e.actor, e.action, e.target, e.details ?? '']),
        }
      : { kind: 'p', text: tr('None in this period.', 'Ninguna en este período.') };
  const more = (list: AuditEntry[]): PdfBlock[] =>
    list.length > 80 ? [{ kind: 'meta', text: tr(`… and ${list.length - 80} more in the audit log.`, `… y ${list.length - 80} más en el registro de auditoría.`) }] : [];
  const exports = cat('export');
  const views = cat('view');
  const config = cat('config');
  const signins = cat('signin');
  return {
    kpis: [
      [tr('entries', 'entradas'), fmtInt(entries.length, lang)],
      [tr('downloads', 'descargas'), String(exports.length)],
      [tr('config changes', 'cambios de configuración'), String(config.length)],
      [tr('chain check', 'verificación de la cadena'), chain],
    ],
    blocks: [
      {
        kind: 'kv',
        rows: [
          [tr('Entries', 'Entradas'), fmtInt(entries.length, lang)],
          [tr('Downloads and exports', 'Descargas y exportaciones'), String(exports.length)],
          [tr('Live views', 'Vistas en vivo'), String(views.length)],
          [tr('Configuration changes', 'Cambios de configuración'), String(config.length)],
          [tr('Sign-ins', 'Inicios de sesión'), String(signins.length)],
        ],
      },
      { kind: 'meta', text: tr('Actions and objects are quoted as recorded in the log.', 'Las acciones y los objetos se citan tal como quedaron en el registro.') },
      { kind: 'h2', text: tr('Downloads and exports', 'Descargas y exportaciones') },
      table(exports),
      ...more(exports),
      { kind: 'h2', text: tr('Live views', 'Vistas en vivo') },
      table(views),
      ...more(views),
      { kind: 'h2', text: tr('Configuration changes', 'Cambios de configuración') },
      table(config),
      ...more(config),
      { kind: 'h2', text: tr('Sign-ins', 'Inicios de sesión') },
      table(signins),
      ...more(signins),
      { kind: 'h2', text: tr('Chain check', 'Verificación de la cadena') },
      {
        kind: 'p',
        text:
          broken < 0
            ? tr(
                `All ${ctx.audit.length} entries in the log link to the one before by its hash. The chain is intact.`,
                `Las ${ctx.audit.length} entradas del registro se enlazan con la anterior por su hash. La cadena está íntegra.`,
              )
            : tr(`The chain breaks at entry ${ctx.audit[broken].seq}. Report this to the tenant administrator.`, `La cadena se rompe en la entrada ${ctx.audit[broken].seq}. Informe al administrador del inquilino.`),
      },
    ],
  };
}

// ---------- Samples ----------

/** A template's sample: its latest report in the library, marked as a sample. */
export function sampleContent(tpl: TemplateId, library: LibraryReport[], ctx: ReportCtx, fallback: LibraryReport): ReportContent {
  const tr = docTr(ctx.lang);
  const r = library.find((x) => x.template === tpl && x.status !== 'scheduled') ?? fallback;
  const c = reportContent(r, ctx);
  return {
    ...c,
    title: `${tr('Sample', 'Muestra')} · ${c.title}`,
    subtitle: `${c.subtitle} · ${tr('a recent report shown as a sample of the template', 'un informe reciente mostrado como muestra de la plantilla')}`,
    file: reportFile(r, ctx.lang, ctx, 'sample'),
  };
}
