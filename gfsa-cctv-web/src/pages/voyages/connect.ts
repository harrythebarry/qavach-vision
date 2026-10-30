import { usePersistentState } from '../../lib/persist';
import { fmtDayTime, fmtTime } from '../../lib/time';
import {
  MIN,
  MISSED_AFTER_MIN,
  callLabel,
  fmtDelta,
  fmtRoundTime,
  hashInt,
  lastSync,
  syncAfter,
  useCaseName,
  vesselName,
  type CargoCheck,
  type Lang,
  type LiveVoyage,
  type PortCall,
  type Round,
  type Tr,
  type VoyageRecord,
} from './voyageData';

// What the console writes back to Connect for a voyage (PRD: Connect, both
// directions). The event service sends events, port times from video and
// round exceptions on its own; people on the voyage record can send the
// container differences and the port times again. What people send is saved
// in 'voyages.connectOutbox' so it survives navigation and reloads.

export interface SentDiff {
  bargeId: string;
  container: string;
  kind: 'not_seen' | 'not_listed';
}

export interface SentCall {
  port: string;
  kind: 'departure' | 'arrival';
  scheduled: number;
  actual: number;
}

/** One send from the voyage record to Connect. */
export interface SentItem {
  id: string;
  voyageId: string;
  /** ISO, scenario time. */
  at: string;
  kind: 'cargo' | 'port_times';
  by: string;
  /** Connect's acknowledgement for the write. */
  ref: string;
  diffs?: SentDiff[];
  calls?: SentCall[];
}

export const useConnectOutbox = () => usePersistentState<SentItem[]>('voyages.connectOutbox', []);

/** Connect's record id for a write, e.g. "CX-4K7Q2M". */
export const connectRef = (seed: string) => `CX-${(hashInt(seed) % 2_000_000_000).toString(36).toUpperCase().padStart(6, '0').slice(-6)}`;

const callKey = (c: { port: string; kind: string; scheduled: number }) => `${c.port}|${c.kind}|${c.scheduled}`;

/** Latest time each barge's differences reached Connect (event service at departure, or a person since). */
export function cargoSentAt(cargo: CargoCheck[], sent: SentItem[]): Record<string, number | undefined> {
  const out: Record<string, number | undefined> = {};
  for (const c of cargo) {
    const mine = sent.filter((s) => s.kind === 'cargo' && s.diffs?.some((d) => d.bargeId === c.bargeId)).map((s) => new Date(s.at).getTime());
    out[c.bargeId] = Math.max(c.sentAt ?? 0, ...mine) || undefined;
  }
  return out;
}

/** Latest time each port call's actual time reached Connect. */
export function callSentAt(calls: PortCall[], sent: SentItem[]): Record<string, number | undefined> {
  const out: Record<string, number | undefined> = {};
  for (const c of calls) {
    const mine = sent.filter((s) => s.kind === 'port_times' && s.calls?.some((x) => callKey(x) === callKey(c))).map((s) => new Date(s.at).getTime());
    out[callKey(c)] = Math.max(c.sentAt ?? 0, ...mine) || undefined;
  }
  return out;
}
export const sentFor = (map: Record<string, number | undefined>, c: PortCall) => map[callKey(c)];

export type OutboxKind = 'events' | 'port_times' | 'cargo' | 'round' | 'report';

export const OUTBOX_KIND: Record<OutboxKind, [string, string]> = {
  events: ['Events', 'Eventos'],
  port_times: ['Port times', 'Horas de puerto'],
  cargo: ['Count differences', 'Diferencias de conteo'],
  round: ['Reefer round', 'Ronda de reefers'],
  report: ['Voyage report', 'Informe de viaje'],
};

export interface OutboxRow {
  key: string;
  at: number;
  kind: OutboxKind;
  what: string;
  detail?: string;
  by: string;
  ref?: string;
  /** Events in a sync batch. */
  count?: number;
  /** Waits for the next sync. */
  pending?: boolean;
  /** Sent by a person from the voyage record. */
  manual?: boolean;
}

/**
 * Everything this app sent to Connect for the voyage, newest first: event
 * batches at each sync, port times, count differences, round exceptions, the
 * report at arrival, and what people sent from the voyage record.
 */
export function outboxRows(rec: VoyageRecord, live: LiveVoyage, rounds: Round[], sent: SentItem[], now: number, lang: Lang, tr: Tr): OutboxRow[] {
  const sys = tr('Event service', 'Servicio de eventos');
  const rows: OutboxRow[] = [];

  // Events go with the next sync after they reach shore; late ones when the link returned.
  const batches = new Map<number, typeof live.events>();
  for (const e of live.events) {
    const t = syncAfter(e.receivedAt ?? e.at);
    batches.set(t, [...(batches.get(t) ?? []), e]);
  }
  for (const [t, evs] of batches) {
    const late = evs.filter((e) => e.late).length;
    const kinds = [...new Set(evs.map((e) => useCaseName(e.useCaseId, lang)))];
    rows.push({
      key: `ev-${t}`,
      at: t,
      kind: 'events',
      what: tr(`${evs.length} event${evs.length === 1 ? '' : 's'} on the voyage record`, `${evs.length} evento${evs.length === 1 ? '' : 's'} en el registro del viaje`),
      detail: [late ? tr(`${late} arrived late from store and forward`, `${late} llegaron tarde por almacenar y reenviar`) : '', kinds.slice(0, 3).join(', ')]
        .filter(Boolean)
        .join(' · '),
      by: sys,
      count: evs.length,
      pending: t > now,
    });
  }

  rec.calls
    .filter((c) => c.actual && c.sentAt)
    .forEach((c, i) =>
      rows.push({
        key: `call-${i}`,
        at: c.sentAt!,
        kind: 'port_times',
        what: `${c.port} · ${callLabel(c, tr).toLowerCase()} ${fmtTime(c.actual!)}`,
        detail: tr(`Schedule ${fmtDayTime(c.scheduled)} (${fmtDelta(c.actual! - c.scheduled, tr)})`, `Horario ${fmtDayTime(c.scheduled)} (${fmtDelta(c.actual! - c.scheduled, tr)})`),
        by: sys,
        ref: connectRef(`${rec.voyage.id}-call-${i}`),
      }),
    );

  rec.cargo
    .filter((c) => c.differences.length && c.sentAt)
    .forEach((c) =>
      rows.push({
        key: `cargo-${c.bargeId}`,
        at: c.sentAt!,
        kind: 'cargo',
        what: tr(
          `${c.differences.length} container difference${c.differences.length === 1 ? '' : 's'} · ${vesselName(c.bargeId)}`,
          `${c.differences.length} diferencia${c.differences.length === 1 ? '' : 's'} de contenedores · ${vesselName(c.bargeId)}`,
        ),
        detail: c.differences.map((d) => d.container).join(', '),
        by: sys,
        ref: connectRef(`${rec.voyage.id}-cargo-${c.bargeId}`),
      }),
    );

  rounds
    .filter((r) => r.result === 'missed' || r.result === 'late')
    .forEach((r) => {
      const t = r.result === 'missed' ? r.scheduled + MISSED_AFTER_MIN * MIN : r.seen!;
      if (t > now) return;
      rows.push({
        key: `round-${r.key}`,
        at: t,
        kind: 'round',
        what:
          r.result === 'missed'
            ? tr(`Missed round · ${vesselName(r.bargeId)} ${fmtRoundTime(r.scheduled)}`, `Ronda perdida · ${vesselName(r.bargeId)} ${fmtRoundTime(r.scheduled)}`)
            : tr(`Late round · ${vesselName(r.bargeId)} ${fmtRoundTime(r.scheduled)}`, `Ronda tarde · ${vesselName(r.bargeId)} ${fmtRoundTime(r.scheduled)}`),
        detail:
          r.result === 'missed'
            ? tr('Nobody seen in the reefer row within an hour', 'Nadie visto en la fila de reefers en una hora')
            : tr(`Seen ${fmtTime(r.seen!)}, ${r.minutes} min late`, `Vista ${fmtTime(r.seen!)}, ${r.minutes} min tarde`),
        by: sys,
        ref: connectRef(`${rec.voyage.id}-round-${r.key}`),
      });
    });

  if (rec.reportSentAt)
    rows.push({
      key: 'report',
      at: rec.reportSentAt,
      kind: 'report',
      what: tr('Final voyage report at arrival', 'Informe final del viaje a la llegada'),
      detail: tr('Also sent to the operations manager', 'También enviado al gerente de operaciones'),
      by: sys,
      ref: connectRef(`${rec.voyage.id}-report`),
    });

  sent
    .filter((s) => s.voyageId === rec.voyage.id)
    .forEach((s) => {
      const t = new Date(s.at).getTime();
      if (s.kind === 'cargo') {
        const n = s.diffs?.length ?? 0;
        rows.push({
          key: s.id,
          at: t,
          kind: 'cargo',
          what: tr(`${n} container difference${n === 1 ? '' : 's'}`, `${n} diferencia${n === 1 ? '' : 's'} de contenedores`),
          detail: s.diffs?.map((d) => `${vesselName(d.bargeId)} ${d.container}`).join(', '),
          by: s.by,
          ref: s.ref,
          manual: true,
        });
      } else {
        const n = s.calls?.length ?? 0;
        rows.push({
          key: s.id,
          at: t,
          kind: 'port_times',
          what: tr(`${n} port time${n === 1 ? '' : 's'} from video`, `${n} hora${n === 1 ? '' : 's'} de puerto del video`),
          detail: s.calls?.map((c) => `${c.port} ${fmtTime(c.actual)}`).join(', '),
          by: s.by,
          ref: s.ref,
          manual: true,
        });
      }
    });

  return rows.sort((a, b) => b.at - a.at);
}

/** Last write to Connect that has gone out (not waiting for the next sync). */
export const lastWrite = (rows: OutboxRow[]) => rows.find((r) => !r.pending);

/** Last read from Connect: voyage, make-up, schedule, cargo lists and round times every 5 minutes. */
export const lastRead = (now: number) => lastSync(now);
