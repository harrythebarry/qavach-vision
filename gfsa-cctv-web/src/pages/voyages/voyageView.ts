import { roles } from '../../data/users';
import type { Alarm, AlarmState, Classification, Priority, User } from '../../data/types';
import type { Fleet } from '../../state/fleetStore';
import { fmtCountdown, fmtTime } from '../../lib/time';
import { MIN, outcomeText, type Lang, type LiveVoyage, type Tr, type VoyageRecord } from './voyageData';

// What the voyage record shows about each alarm, from the live store or the
// voyage archive, in the current language. Shared by the record and the report.

export const STATE_TEXT: Record<AlarmState, [string, string]> = {
  raised: ['New', 'Nueva'],
  ack_board: ['Acknowledged on board', 'Confirmada a bordo'],
  ack_shore: ['In progress', 'En curso'],
  resolved: ['Resolved', 'Resuelta'],
  closed: ['Closed', 'Cerrada'],
};

const STATE_LABEL_ES: Record<string, string> = {
  New: 'Nueva',
  'In progress': 'En curso',
  Monitoring: 'En seguimiento',
  Acknowledged: 'Confirmada',
};

export const CLASS_TEXT: Record<Classification, [string, string]> = {
  accepted: ['Accepted', 'Aceptada'],
  rejected: ['Rejected', 'Rechazada'],
  false_alert: ['False alert', 'Falsa alerta'],
};

/** Short notes the event service and the duty officers write on alarms. */
const PHRASE_ES: Record<string, string> = {
  'Crew cleaning lens': 'La tripulación limpia la lente',
  'Clears on reconnect': 'Se cierra al reconectar',
  'Cleared on reconnect': 'Cerrada al reconectar',
  'Missed · sent to Connect': 'Perdida · enviada a Connect',
  'Crew briefed': 'Tripulación instruida',
  'crew briefed': 'tripulación instruida',
  'Missed at 15:00': 'Perdida a las 15:00',
};

export function phrase(s: string | undefined, lang: Lang): string | undefined {
  if (!s || lang === 'en') return s;
  if (PHRASE_ES[s]) return PHRASE_ES[s];
  return s
    .replace(/^Seen (\S+), (\d+) min late$/, 'Vista $1, $2 min tarde')
    .replace(/^Missed at (\S+)$/, 'Perdida a las $1');
}

/** Role name for an owner, in the current language. */
export function roleOfName(name: string | undefined, users: User[], lang: Lang): string | undefined {
  if (!name) return undefined;
  if (name === 'System') return lang === 'es' ? 'Sistema' : 'System';
  const u = users.find((x) => x.name === name);
  const r = u ? roles.find((x) => x.id === u.role) : undefined;
  return r ? (lang === 'es' ? r.nameEs : r.name) : name;
}

/** One row of "Alarms on this voyage", from the live store or the archive. */
export interface AlarmRow {
  id: string;
  priority: Priority;
  title: string;
  raisedAt: number;
  where: string;
  open: boolean;
  /** Opens in the alarm console. */
  linkable: boolean;
  /** Archived with the voyage (not in the alarm console). */
  archived: boolean;
  stateText: string;
  stateSub?: string;
  subTone?: 'bad';
  owner?: string;
  vesselId?: string;
  useCaseId?: string;
  /** Raised while the console runs. */
  arrived?: boolean;
}

function liveRow(a: Alarm, now: number, fleet: Fleet, users: User[], lang: Lang, tr: Tr, historyIds: Set<string>): AlarmRow {
  const es = lang === 'es';
  const raised = new Date(a.raisedAt).getTime();
  const convoyName = fleet.convoyById(a.convoyId)?.name ?? '';
  const where = fleet.cameraLabel(a.cameraId) || tr(`${convoyName} convoy`, `Convoy ${convoyName}`);
  const row: AlarmRow = {
    id: a.id,
    priority: a.priority,
    title: es && a.titleEs ? a.titleEs : a.title,
    raisedAt: raised,
    where,
    open: a.state !== 'closed',
    linkable: true,
    archived: false,
    stateText: '',
    owner: a.owner === 'System' ? tr('System', 'Sistema') : a.owner,
    vesselId: a.vesselId,
    useCaseId: a.useCaseId,
    arrived: !historyIds.has(a.id),
  };
  const label = (fallback: AlarmState) => (a.stateLabel ? (es ? (STATE_LABEL_ES[a.stateLabel] ?? a.stateLabel) : a.stateLabel) : tr(...STATE_TEXT[fallback]));
  const escalation = () => {
    if (!a.escalatesAt) return undefined;
    const left = new Date(a.escalatesAt).getTime() - now;
    const to = a.escalatesTo ?? tr('the next step', 'el siguiente paso');
    return left > 0 ? tr(`Escalates in ${fmtCountdown(left)}`, `Escala en ${fmtCountdown(left)}`) : tr(`Escalated to ${to}`, `Escalada a ${to}`);
  };
  switch (a.state) {
    case 'closed': {
      row.stateText = tr('Closed', 'Cerrada');
      const cls = a.classification ? tr(...CLASS_TEXT[a.classification]) : undefined;
      const resp = phrase(a.response, lang);
      row.stateSub =
        a.useCaseId === 'reefer-rounds' && resp ? resp : [cls, resp && (cls ? resp.toLowerCase() : resp)].filter(Boolean).join(' · ') || undefined;
      break;
    }
    case 'ack_board':
      row.stateText = tr(...STATE_TEXT.ack_board);
      row.stateSub = escalation();
      row.subTone = row.stateSub ? 'bad' : undefined;
      break;
    case 'raised':
      row.stateText = label('raised');
      if (a.useCaseId === 'reefer-rounds') {
        const missAt = fmtTime(raised + 45 * MIN);
        row.stateSub = tr(`Counts as missed at ${missAt}`, `Cuenta como perdida a las ${missAt}`);
      } else {
        row.stateSub = escalation();
        row.subTone = row.stateSub ? 'bad' : undefined;
      }
      break;
    case 'ack_shore':
      row.stateText = label('ack_shore');
      row.stateSub = a.owner && a.owner !== 'System' ? roleOfName(a.owner, users, lang) : phrase(a.response, lang);
      break;
    case 'resolved':
      row.stateText = tr(...STATE_TEXT.resolved);
      row.stateSub = roleOfName(a.owner, users, lang);
      break;
  }
  return row;
}

/** Every alarm on the voyage, latest first: live store, the console archive and the voyage archive. */
export function buildAlarmRows(rec: VoyageRecord, live: LiveVoyage, now: number, fleet: Fleet, users: User[], lang: Lang, tr: Tr): AlarmRow[] {
  const historyIds = new Set(rec.events.filter((e) => e.alarmId).map((e) => e.alarmId!));
  const liveIds = new Set(live.alarms.map((a) => a.id));
  return [
    ...live.alarms.map((a) => liveRow(a, now, fleet, users, lang, tr, historyIds)),
    ...rec.consoleAlarms.filter((a) => !liveIds.has(a.id)).map((a) => liveRow(a, now, fleet, users, lang, tr, historyIds)),
    ...rec.archivedAlarms.map<AlarmRow>((a) => ({
      id: a.id,
      priority: a.priority,
      title: lang === 'es' ? a.titleEs : a.title,
      raisedAt: a.raisedAt,
      where: fleet.cameraLabel(a.cameraId),
      open: false,
      linkable: false,
      archived: true,
      stateText: tr('Closed', 'Cerrada'),
      stateSub: outcomeText(a.outcome, tr),
      vesselId: a.vesselId,
      useCaseId: a.useCaseId,
    })),
  ].sort((a, b) => b.raisedAt - a.raisedAt);
}
