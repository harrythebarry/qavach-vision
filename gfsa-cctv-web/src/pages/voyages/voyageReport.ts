import type { Priority } from '../../data/types';
import type { PdfBlock, PdfDoc } from '../../lib/download';
import { slug } from '../../lib/download';
import { fmtDay, fmtDayTime, fmtDuration, fmtTime } from '../../lib/time';
import type { Fleet } from '../../state/fleetStore';
import { OUTBOX_KIND, sentFor, type OutboxRow } from './connect';
import {
  DAY,
  MIN,
  ROUND_LABEL,
  TOLERANCE_MIN,
  alignLocal,
  callLabel,
  diffText,
  exceptionSummary,
  fmtDelta,
  fmtRoundTime,
  fmtWeekdayShort,
  lastSync,
  linkTime,
  nextCallText,
  positionText,
  roundStats,
  routeText,
  statusText,
  vesselName,
  type Lang,
  type LiveVoyage,
  type Round,
  type Tr,
  type VoyageRecord,
} from './voyageData';
import type { AlarmRow } from './voyageView';

// VOY-06: the voyage report. A draft while the voyage is under way or in port,
// final once it is completed (the final one went to Connect and the operations
// manager at arrival). Every section of the voyage record is in it.

export interface ReportInput {
  rec: VoyageRecord;
  live: LiveVoyage;
  rows: AlarmRow[];
  rounds: Round[];
  outbox: OutboxRow[];
  cargoSent: Record<string, number | undefined>;
  callSent: Record<string, number | undefined>;
  now: number;
  lang: Lang;
  tr: Tr;
  fleet: Fleet;
  prioName: (p: Priority) => string;
}

export function reportFilename(rec: VoyageRecord, final: boolean, tr: Tr) {
  return `${slug(tr('voyage-report', 'informe-de-viaje'))}-${slug(rec.voyage.id)}-${final ? tr('final', 'final') : tr('draft', 'borrador')}.pdf`;
}

export function buildVoyageReport(input: ReportInput): Omit<PdfDoc, 'watermark'> & { final: boolean } {
  const { rec, live, rows, rounds, outbox, cargoSent, callSent, now, lang, tr, fleet, prioName } = input;
  const v = rec.voyage;
  const final = v.status === 'completed';
  const convoy = fleet.convoyById(v.convoyId);
  const lastArrival = rec.calls.filter((c) => c.kind === 'arrival' && c.actual).at(-1)?.actual;
  const until = final ? (lastArrival ?? rec.window.end) : now;
  const rs = roundStats(rounds.filter((r) => r.scheduled <= until));
  const open = rows.filter((r) => r.open);
  const openByP = (['P1', 'P2', 'P3', 'P4'] as const).map((p) => ({ p, n: open.filter((r) => r.priority === p).length })).filter((x) => x.n);
  const diffs = rec.cargo.reduce((n, c) => n + c.differences.length, 0);
  const actualCalls = rec.calls.filter((c) => c.actual);
  const bargeNames = rec.barges.map((b) => b.name);
  const makeUp = tr(
    `${rec.tug?.name ?? convoy?.name ?? ''} pushing ${bargeNames.join(', ')}`,
    `${rec.tug?.name ?? convoy?.name ?? ''} empujando ${bargeNames.join(', ')}`,
  );
  const sched = (s: { label: string; labelEs: string }) => (lang === 'es' ? s.labelEs : s.label);
  const linkNow = !live.current
    ? '—'
    : live.offline
      ? tr(`No link since ${fmtTime(live.queuedAfter!)} · ${live.queuedEvents} events queued on board`, `Sin enlace desde las ${fmtTime(live.queuedAfter!)} · ${live.queuedEvents} eventos en cola a bordo`)
      : `${convoy?.linkLabel ?? ''} · ${positionText(convoy?.positionLabel, tr, true)}`;

  const blocks: PdfBlock[] = [];

  blocks.push({
    kind: 'p',
    text: final
      ? tr(
          `Final report. It went to Connect and the operations manager at arrival${rec.reportSentAt ? `, ${fmtDayTime(rec.reportSentAt)}` : ''}.`,
          `Informe final. Se envió a Connect y al gerente de operaciones a la llegada${rec.reportSentAt ? `, ${fmtDayTime(rec.reportSentAt)}` : ''}.`,
        )
      : tr(
          `Draft. The voyage is not over: figures run to ${fmtDayTime(now)}. The final report goes to Connect and the operations manager at arrival in ${rec.arrivalPort}.`,
          `Borrador. El viaje no terminó: las cifras llegan hasta ${fmtDayTime(now)}. El informe final va a Connect y al gerente de operaciones a la llegada a ${rec.arrivalPort}.`,
        ),
  });

  // ---------- Summary ----------
  blocks.push({ kind: 'h2', text: tr('Summary', 'Resumen') });
  blocks.push({
    kind: 'kv',
    rows: [
      [tr('Voyage', 'Viaje'), `${v.id} · ${routeText(v.route, tr)}`],
      [tr('Convoy', 'Convoy'), makeUp],
      [tr('Status', 'Estado'), statusText(rec, live, now, tr)],
      [tr('Departed', 'Salida'), `${rec.departurePort} ${fmtDayTime(rec.departure)}`],
      [final ? tr('Arrived', 'Llegada') : tr('Next call', 'Próxima escala'), nextCallText(rec, tr)],
      [
        tr('Events', 'Eventos'),
        tr(
          `${live.events.length} · ${live.toReview} waiting for review${live.arrivedLate ? ` · ${live.arrivedLate} arrived late` : ''}`,
          `${live.events.length} · ${live.toReview} pendientes de revisión${live.arrivedLate ? ` · ${live.arrivedLate} llegaron tarde` : ''}`,
        ),
      ],
      [
        tr('Alarms', 'Alarmas'),
        tr(
          `${rows.length} · ${open.length} open${openByP.map((x) => ` · ${x.n} ${x.p}`).join('')}`,
          `${rows.length} · ${open.length} abiertas${openByP.map((x) => ` · ${x.n} ${x.p}`).join('')}`,
        ),
      ],
      [tr('Reefer rounds on time', 'Rondas de reefers a tiempo'), tr(`${rs.onTime} of ${rs.judged} · ${exceptionSummary(rs, tr)}`, `${rs.onTime} de ${rs.judged} · ${exceptionSummary(rs, tr)}`)],
      [
        tr('Cargo list check', 'Control de la lista de carga'),
        diffs ? tr(`${diffs} difference${diffs === 1 ? '' : 's'}, sent to Connect`, `${diffs} diferencia${diffs === 1 ? '' : 's'}, enviada${diffs === 1 ? '' : 's'} a Connect`) : tr('Every barge matches its cargo list', 'Todas las barcazas coinciden con su lista de carga'),
      ],
      [tr('Port times from video', 'Horas de puerto del video'), tr(`${actualCalls.length} of ${rec.calls.length}`, `${actualCalls.length} de ${rec.calls.length}`)],
      ...(final ? [] : ([[tr('Link to shore now', 'Enlace con tierra ahora'), linkNow]] as [string, string][])),
    ],
  });

  // ---------- Timeline by day ----------
  blocks.push({ kind: 'h2', text: tr('Timeline by day', 'Cronología por día') });
  const dayRows: string[][] = [];
  for (let d = alignLocal(rec.departure, DAY); d < until; d += DAY) {
    const e = d + DAY;
    const segs = rec.schedule.filter((s) => s.from < e && s.to > d).map(sched);
    const evs = live.events.filter((x) => x.at >= d && x.at < e).length;
    const alm = rows.filter((x) => x.raisedAt >= d && x.raisedAt < e).length;
    const dayRounds = rounds.filter((r) => r.scheduled >= d && r.scheduled < e && r.scheduled <= until);
    const ds = roundStats(dayRounds);
    const lt = linkTime(live.link, d, Math.min(e, until), now);
    dayRows.push([
      fmtWeekdayShort(d),
      segs.join('; '),
      String(evs),
      String(alm),
      dayRounds.length ? `${ds.onTime}/${ds.judged}${ds.late + ds.missed + ds.overdue + ds.queued ? ` · ${exceptionSummary(ds, tr)}` : ''}` : '—',
      lt.none ? fmtDuration(lt.none) : '—',
    ]);
  }
  blocks.push({
    kind: 'table',
    columns: [
      { label: tr('Day', 'Día'), width: 1.2 },
      { label: tr('Schedule (Connect)', 'Horario (Connect)'), width: 3 },
      { label: tr('Events', 'Eventos'), width: 0.8, align: 'right' },
      { label: tr('Alarms', 'Alarmas'), width: 0.8, align: 'right' },
      { label: tr('Rounds on time', 'Rondas a tiempo'), width: 1.8 },
      { label: tr('No link', 'Sin enlace'), width: 1.1 },
    ],
    rows: dayRows,
  });

  // ---------- Alarms ----------
  blocks.push({ kind: 'h2', text: tr('Alarms', 'Alarmas') });
  blocks.push(
    rows.length
      ? {
          kind: 'table',
          columns: [
            { label: tr('Priority', 'Prioridad'), width: 1.1 },
            { label: tr('Alarm', 'Alarma'), width: 3.4 },
            { label: tr('Raised', 'Generada'), width: 1.3 },
            { label: tr('State', 'Estado'), width: 2 },
          ],
          rows: rows.map((r) => [prioName(r.priority), `${r.id} · ${r.title} · ${r.where}`, fmtDayTime(r.raisedAt), [r.stateText, r.stateSub].filter(Boolean).join(' · ')]),
        }
      : { kind: 'p', text: tr('No alarms on this voyage.', 'No hay alarmas en este viaje.') },
  );

  // ---------- Reefer round exceptions per barge ----------
  blocks.push({ kind: 'h2', text: tr('Reefer round exceptions', 'Excepciones de rondas de reefers') });
  blocks.push({
    kind: 'meta',
    text: tr(
      `Checked against the Connect schedule. On time when someone is seen in the reefer row within ${TOLERANCE_MIN} minutes.`,
      `Comparadas con el horario de Connect. A tiempo cuando se ve a alguien en la fila de reefers dentro de ${TOLERANCE_MIN} minutos.`,
    ),
  });
  if (!rec.roundSpecs.length) blocks.push({ kind: 'p', text: tr('No reefer rounds are scheduled on this voyage.', 'No hay rondas de reefers programadas en este viaje.') });
  rec.roundSpecs.forEach(({ bargeId }) => {
    const mine = rounds.filter((r) => r.bargeId === bargeId && r.scheduled <= until);
    const s = roundStats(mine);
    const ex = mine.filter((r) => r.result !== 'on_time' && r.result !== 'due').sort((a, b) => a.scheduled - b.scheduled);
    blocks.push({
      kind: 'p',
      text: tr(
        `${vesselName(bargeId)}: ${s.onTime} of ${s.judged} on time · ${exceptionSummary(s, tr)}`,
        `${vesselName(bargeId)}: ${s.onTime} de ${s.judged} a tiempo · ${exceptionSummary(s, tr)}`,
      ),
    });
    if (ex.length)
      blocks.push({
        kind: 'table',
        columns: [
          { label: tr('Scheduled', 'Programada'), width: 1.6 },
          { label: tr('Seen on video', 'Vista en video'), width: 1.4 },
          { label: tr('Result', 'Resultado'), width: 1.6 },
          { label: 'Connect', width: 1.2 },
        ],
        rows: ex.map((r) => [
          fmtRoundTime(r.scheduled),
          r.seen
            ? fmtTime(r.seen)
            : r.result === 'queued'
              ? tr('Queued on board', 'En cola a bordo')
              : r.result === 'overdue'
                ? tr('Not yet', 'Todavía no')
                : tr('Not seen', 'No vista'),
          `${tr(...ROUND_LABEL[r.result])}${r.minutes ? ` · ${r.minutes} min` : ''}`,
          r.result === 'missed' || r.result === 'late' ? tr('Sent', 'Enviada') : '—',
        ]),
      });
  });

  // ---------- Cargo check ----------
  blocks.push({ kind: 'h2', text: tr('Containers against the cargo list', 'Contenedores contra la lista de carga') });
  if (rec.cargo.length) {
    blocks.push({
      kind: 'table',
      columns: [
        { label: tr('Barge', 'Barcaza'), width: 1.6 },
        { label: tr('List', 'Lista'), width: 0.7, align: 'right' },
        { label: tr('Counted', 'Contados'), width: 0.9, align: 'right' },
        { label: tr('Counted at', 'Contados el'), width: 1.8 },
        { label: tr('Result', 'Resultado'), width: 1.4 },
        { label: 'Connect', width: 1.4 },
      ],
      rows: rec.cargo.map((c) => [
        vesselName(c.bargeId),
        String(c.list),
        String(c.counted),
        `${fmtDayTime(c.countedAt)} · ${c.port}`,
        c.differences.length ? tr(`${c.differences.length} difference${c.differences.length === 1 ? '' : 's'}`, `${c.differences.length} diferencia${c.differences.length === 1 ? '' : 's'}`) : tr('Match', 'Coincide'),
        c.differences.length ? (cargoSent[c.bargeId] ? tr(`Sent ${fmtDayTime(cargoSent[c.bargeId]!)}`, `Enviada ${fmtDayTime(cargoSent[c.bargeId]!)}`) : tr('Not sent', 'No enviada')) : '—',
      ]),
    });
    const all = rec.cargo.flatMap((c) => c.differences.map((d) => ({ c, d })));
    if (all.length)
      blocks.push({
        kind: 'table',
        columns: [
          { label: tr('Barge', 'Barcaza'), width: 1.4 },
          { label: tr('Container', 'Contenedor'), width: 1.5 },
          { label: tr('Difference', 'Diferencia'), width: 4 },
        ],
        rows: all.map(({ c, d }) => [vesselName(c.bargeId), d.container, diffText(d, tr)]),
      });
  } else blocks.push({ kind: 'p', text: tr('Connect has not sent cargo lists for this voyage.', 'Connect no envió listas de carga para este viaje.') });

  // ---------- Port times ----------
  blocks.push({ kind: 'h2', text: tr('Port times from video', 'Horas de puerto del video') });
  blocks.push({
    kind: 'table',
    columns: [
      { label: tr('Call', 'Escala'), width: 2 },
      { label: tr('Schedule', 'Horario'), width: 1.4 },
      { label: tr('Video', 'Video'), width: 1.2 },
      { label: tr('Difference', 'Diferencia'), width: 1.2 },
      { label: tr('Sent to Connect', 'Enviada a Connect'), width: 1.4 },
    ],
    rows: rec.calls.map((c) => {
      const sent = sentFor(callSent, c);
      return [
        `${c.port} · ${callLabel(c, tr)}`,
        fmtDayTime(c.scheduled),
        c.actual ? fmtDayTime(c.actual) : tr('Pending', 'Pendiente'),
        c.actual ? fmtDelta(c.actual - c.scheduled, tr) : '—',
        sent ? fmtDayTime(sent) : '—',
      ];
    }),
  });

  // ---------- Connect sync ----------
  const out = outbox.filter((r) => !r.pending && r.at <= until + 30 * MIN);
  const evRows = out.filter((r) => r.kind === 'events');
  const other = out.filter((r) => r.kind !== 'events');
  blocks.push({ kind: 'h2', text: tr('Connect sync', 'Sincronización con Connect') });
  blocks.push({
    kind: 'kv',
    rows: [
      [tr('Last read from Connect', 'Última lectura de Connect'), `${fmtDayTime(lastSync(Math.min(now, until + 30 * MIN)))} · ${tr('voyage, make-up, schedule, cargo lists, round times', 'viaje, composición, horario, listas de carga, horas de ronda')}`],
      [tr('Last write to Connect', 'Última escritura en Connect'), out[0] ? `${fmtDayTime(out[0].at)} · ${out[0].what}` : '—'],
      [tr('Events on the voyage record', 'Eventos en el registro del viaje'), tr(`${live.events.length} in ${evRows.length} syncs`, `${live.events.length} en ${evRows.length} sincronizaciones`)],
      [tr('Actual port times', 'Horas de puerto reales'), String(actualCalls.length)],
      [tr('Container differences', 'Diferencias de contenedores'), String(diffs)],
      [tr('Reefer round exceptions', 'Excepciones de rondas'), String(rs.missed + rs.late)],
    ],
  });
  if (other.length)
    blocks.push({
      kind: 'table',
      columns: [
        { label: tr('Sent', 'Enviado'), width: 1.3 },
        { label: tr('What', 'Qué'), width: 1.4 },
        { label: tr('Details', 'Detalle'), width: 3.6 },
        { label: tr('By', 'Por'), width: 1.4 },
      ],
      rows: other.map((r) => [fmtDayTime(r.at), tr(...OUTBOX_KIND[r.kind]), [r.what, r.detail, r.ref].filter(Boolean).join(' · '), r.by]),
    });

  return {
    final,
    title: final ? tr(`Voyage report · ${v.id}`, `Informe de viaje · ${v.id}`) : tr(`Voyage report (draft) · ${v.id}`, `Informe de viaje (borrador) · ${v.id}`),
    subtitle: `${routeText(v.route, tr)} · ${convoy?.name ?? ''} · ${tr('generated', 'generado')} ${fmtDay(now)} ${fmtTime(now)} Asunción`,
    blocks,
    footer: tr('GFSA · CCTV Monitoring · Voyage report', 'GFSA · Monitoreo CCTV · Informe de viaje'),
  };
}
