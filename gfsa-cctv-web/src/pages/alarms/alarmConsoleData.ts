import { useMemo } from 'react';
import type {
  ActivityEntry,
  Alarm,
  AlarmState,
  AuditEntry,
  Classification,
  ReviewEvent,
  UseCase,
  UseCaseLevel,
  Voyage,
} from '../../data/types';
import { fakeHash, shortHash } from '../../lib/hash';
import { useApp } from '../../state/AppState';
import { roleEs } from '../../state/escalation';
import { useFleet, type Fleet } from '../../state/fleetStore';

// Page-local sample data, translations and helpers for the alarm console (ALM-01 to ALM-10).
// Alarms, review events and the fleet are read live from the shared stores; the
// only page-local record is the archived alarm below.

export type Tr = (en: string, es: string) => string;
type Pair = [string, string];

const t = (hhmmss: string, day = '2026-10-15') => `${day}T${hhmmss}-03:00`;

/**
 * Closed alarm shown in the design's "Closed today" list that the shared store
 * does not carry. It is an archived record: readable, never changed from here.
 */
export const ARCHIVED_ALARMS: Alarm[] = [
  {
    id: 'ALM-26-0312',
    eventId: 'EV-26-040-0312',
    priority: 'P3',
    title: 'Smoke or haze in the engine room',
    titleEs: 'Humo o neblina en la sala de máquinas',
    description: 'Haze seen in the engine room of the GF Boquerón tug during cargo operations.',
    descriptionEs: 'Neblina vista en la sala de máquinas del remolcador GF Boquerón durante las operaciones de carga.',
    useCaseId: 'smoke-machinery',
    convoyId: 'boq',
    vesselId: 'boq-tug',
    cameraId: 'BOQ-CAM-02',
    voyageId: 'VOY-26-040',
    raisedAt: t('12:40:00'),
    state: 'closed',
    stateTimes: {
      raised: t('12:40:00'),
      ack_board: t('12:40:04'),
      ack_shore: t('12:40:38'),
      resolved: t('12:41:20'),
      closed: t('12:41:40'),
    },
    owner: 'Marta Benítez',
    classification: 'false_alert',
    falseReason: 'Reflection or light',
    stepsDone: {
      0: { by: 'Wheelhouse', at: t('12:40:20') },
      1: { by: 'Marta Benítez', at: t('12:40:52') },
      2: { by: 'Julio Franco', at: t('12:41:05') },
    },
    detection: { label: 'Haze', confidence: 0.71, box: { x: 38, y: 22, w: 30, h: 34 } },
    models: 'Base detector v2.1 · Fire and smoke v1.1',
    evidence: [
      { name: 'Clip, 15 s · 2.6 MB', meta: 'MP4 · 720p', hash: 'sha256 b7e2…19c4' },
      { name: 'Snapshot 12:40:00 · 47 KB', meta: 'JPEG', hash: 'sha256 5a0f…d3e8' },
      { name: 'Detection record', meta: '2 KB · JSON', hash: 'sha256 c4d1…7a2f' },
    ],
    activity: [
      { at: t('12:40:00'), text: 'Detected on board by the AI unit on GF Boquerón', textEs: 'Detectada a bordo por la unidad de IA de GF Boquerón', actor: 'System' },
      { at: t('12:40:04'), text: 'Acknowledged on board', textEs: 'Confirmada a bordo', actor: 'Wheelhouse' },
      { at: t('12:40:20'), text: 'Engineer sent to the engine room', textEs: 'Se envió al maquinista a la sala de máquinas', actor: 'Wheelhouse' },
      { at: t('12:40:38'), text: 'Acknowledged ashore and assigned', textEs: 'Confirmada en tierra y asignada', actor: 'Marta Benítez' },
      { at: t('12:40:52'), text: 'Master confirmed: sunlight through the vent, no smoke', textEs: 'El capitán confirmó: luz del sol por la ventilación, sin humo', actor: 'Marta Benítez' },
      { at: t('12:41:05'), text: 'Classified as false alert (Reflection or light)', textEs: 'Clasificada como falsa alerta (Reflection or light)', actor: 'Julio Franco' },
      { at: t('12:41:20'), text: 'Resolved', textEs: 'Resuelta', actor: 'Marta Benítez' },
      { at: t('12:41:40'), text: 'Closed · false alert', textEs: 'Cerrada · falsa alerta', actor: 'Marta Benítez' },
    ],
  },
];

// ---------- Wheelhouse phones (sample numbers, one per convoy) ----------

export interface WheelhouseLine {
  /** E.164 for the tel: link */
  tel: string;
  display: string;
}

export const WHEELHOUSE_PHONE: Record<string, WheelhouseLine> = {
  tuy: { tel: '+59521000501', display: '+595 21 000 501' },
  hum: { tel: '+59521000502', display: '+595 21 000 502' },
  boq: { tel: '+59521000503', display: '+595 21 000 503' },
};

// ---------- Names (English, Spanish) ----------

export const STATE_ORDER: AlarmState[] = ['raised', 'ack_board', 'ack_shore', 'resolved', 'closed'];

export const STATE_NAME: Record<AlarmState, Pair> = {
  raised: ['Raised', 'Generada'],
  ack_board: ['Acknowledged on board', 'Confirmada a bordo'],
  ack_shore: ['Acknowledged ashore', 'Confirmada en tierra'],
  resolved: ['Resolved', 'Resuelta'],
  closed: ['Closed', 'Cerrada'],
};

/** What each step still waits for, shown under a future step. */
export const STATE_HINT: Record<AlarmState, Pair> = {
  raised: ['Detected on board', 'Detectada a bordo'],
  ack_board: ['Wheelhouse display', 'Pantalla del puente'],
  ack_shore: ['Duty officer', 'Oficial de guardia'],
  resolved: ['Crew confirmed', 'Tripulación confirmó'],
  closed: ['With classification', 'Con clasificación'],
};

export const STATE_SHORT: Record<AlarmState, Pair> = {
  raised: ['New', 'Nueva'],
  ack_board: ['Acknowledged', 'Confirmada'],
  ack_shore: ['In progress', 'En curso'],
  resolved: ['Resolved', 'Resuelta'],
  closed: ['Closed', 'Cerrada'],
};

export const LEVEL_NAME: Record<UseCaseLevel, Pair> = {
  list: ['Record and list', 'Registrar y listar'],
  alert: ['Record and alert', 'Registrar y alertar'],
  act: ['Record, alert and act', 'Registrar, alertar y actuar'],
};

export const CLASS_NAME: Record<Classification, Pair> = {
  accepted: ['accepted', 'aceptada'],
  rejected: ['rejected', 'rechazada'],
  false_alert: ['false alert', 'falsa alerta'],
};

export const TALLY_NAME: Record<Classification, Pair> = {
  accepted: ['Accepted', 'Aceptados'],
  rejected: ['Rejected', 'Rechazados'],
  false_alert: ['False alert', 'Falsa alerta'],
};

/** Reasons offered for a false alert, per use case (ALM-06). The English text is stored. */
const FALSE_REASONS: Record<string, Pair[]> = {
  'life-jacket': [
    ['Inflatable life jacket worn', 'Lleva chaleco inflable'],
    ['Reflection or shadow', 'Reflejo o sombra'],
    ['Outside the zone', 'Fuera de la zona'],
    ['Wrong object', 'Objeto equivocado'],
  ],
  'hard-hat-vest': [
    ['Hard hat worn, not seen', 'Lleva casco, no se vio'],
    ['Reflection or shadow', 'Reflejo o sombra'],
    ['Outside the zone', 'Fuera de la zona'],
    ['Wrong object', 'Objeto equivocado'],
  ],
  smoking: [
    ['Not smoking (breath or steam)', 'No fumaba (aliento o vapor)'],
    ['Reflection or shadow', 'Reflejo o sombra'],
    ['Outside the zone', 'Fuera de la zona'],
    ['Wrong object', 'Objeto equivocado'],
  ],
  'container-doors': [
    ['Cargo operations under way', 'Operaciones de carga en curso'],
    ['Door was closed', 'La puerta estaba cerrada'],
    ['Reflection or shadow', 'Reflejo o sombra'],
    ['Wrong object', 'Objeto equivocado'],
  ],
  'outside-work': [
    ['Work was planned', 'El trabajo estaba planificado'],
    ['Not a person', 'No es una persona'],
    ['Outside the zone', 'Fuera de la zona'],
    ['Wrong object', 'Objeto equivocado'],
  ],
  'smoke-machinery': [
    ['Steam from the exhaust', 'Vapor del escape'],
    ['Dust from cleaning', 'Polvo de limpieza'],
    ['Reflection or light', 'Reflejo o luz'],
    ['Wrong object', 'Objeto equivocado'],
  ],
  'smoke-fire-deck': [
    ['Steam from the exhaust', 'Vapor del escape'],
    ['Dust or spray', 'Polvo o rocío'],
    ['Reflection or light', 'Reflejo o luz'],
    ['Wrong object', 'Objeto equivocado'],
  ],
  'reefer-rounds': [
    ['Round was done, not seen', 'La ronda se hizo, no se vio'],
    ['Round moved in Connect', 'Ronda movida en Connect'],
    ['View blocked', 'Vista bloqueada'],
    ['Wrong person', 'Persona equivocada'],
  ],
  'camera-health': [
    ['Lens was clean', 'La lente estaba limpia'],
    ['Night or low light', 'Noche o poca luz'],
    ['Glare from the sun', 'Reflejo del sol'],
    ['Camera fault', 'Falla de la cámara'],
  ],
};
const DEFAULT_REASONS: Pair[] = [
  ['Reflection or shadow', 'Reflejo o sombra'],
  ['Outside the zone', 'Fuera de la zona'],
  ['Wrong object', 'Objeto equivocado'],
  ['Camera fault', 'Falla de la cámara'],
];
export const falseReasonsFor = (useCaseId: string): Pair[] => FALSE_REASONS[useCaseId] ?? DEFAULT_REASONS;

const REASON_ES = new Map<string, string>([...Object.values(FALSE_REASONS).flat(), ...DEFAULT_REASONS]);

/** Spanish for a stored (English) false-alert reason; free text stays as typed. */
export const reasonEs = (reason: string) => REASON_ES.get(reason) ?? reason;

/** Replaces "(reason)" in a Spanish activity line with the Spanish reason. */
const localizeReasons = (textEs: string) =>
  textEs
    .replace(/\(([^)]+)\)/g, (m, r: string) => (REASON_ES.has(r) ? `(${REASON_ES.get(r)})` : m))
    // Contractions the shared alert texts leave open ("a el oficial" → "al oficial").
    .replace(/\ba el\b/g, 'al')
    .replace(/\bde el\b/g, 'del');

/** Legend for the orange part of the clip timeline. */
const SEGMENT: Record<string, Pair> = {
  'life-jacket': ['In the zone without a life jacket', 'En la zona sin chaleco salvavidas'],
  'hard-hat-vest': ['On deck without a hard hat or vest', 'En cubierta sin casco o chaleco'],
  smoking: ['Person smoking', 'Persona fumando'],
  'container-doors': ['Container door open', 'Puerta de contenedor abierta'],
  'outside-work': ['Person outside planned work', 'Persona fuera del trabajo planificado'],
  'smoke-machinery': ['Haze in view', 'Neblina a la vista'],
  'smoke-fire-deck': ['Smoke in view', 'Humo a la vista'],
  'reefer-rounds': ['Reefer row empty', 'Fila de reefers vacía'],
  'camera-health': ['Image blurred', 'Imagen desenfocada'],
};
export const segmentLabelFor = (useCaseId: string): Pair => SEGMENT[useCaseId] ?? ['Detection in view', 'Detección a la vista'];

/** Use cases that look at people: exports blur the head region. */
export const PEOPLE_USE_CASES = new Set(['life-jacket', 'hard-hat-vest', 'smoking', 'outside-work', 'reefer-rounds', 'person-down']);

const DETECTION_ES: Record<string, string> = {
  'No life jacket': 'Sin chaleco salvavidas',
  'No hard hat': 'Sin casco',
  Smoking: 'Fumando',
  Smoke: 'Humo',
  Haze: 'Neblina',
  'Door open': 'Puerta abierta',
  Person: 'Persona',
  'Blurred image': 'Imagen desenfocada',
  Detection: 'Detección',
};

const ACTOR_ES: Record<string, string> = {
  System: 'Sistema',
  Wheelhouse: 'Puente',
  'Event service': 'Servicio de eventos',
  'Alert routing': 'Enrutamiento de alertas',
  'Duty officer': 'Oficial de guardia',
  Pending: 'Pendiente',
  'Connect integration': 'Integración con Connect',
};

/** Short state labels and response notes carried on the seed alarms. */
const PHRASE_ES: Record<string, string> = {
  New: 'Nueva',
  'In progress': 'En curso',
  Monitoring: 'En seguimiento',
  'Crew cleaning lens': 'Tripulación limpiando la lente',
  'Missed at 15:00': 'Perdida a las 15:00',
  'Clears on reconnect': 'Se cierra al reconectar',
  'Cleared on reconnect': 'Cerrada al reconectar',
  'Missed · sent to Connect': 'Perdida · enviada a Connect',
  'Crew briefed': 'Tripulación informada',
};

/** Seed activity lines that came without Spanish. */
const ACTIVITY_ES: [RegExp, string][] = [
  [/^Detected on board by the AI unit on (.+)$/, 'Detectada a bordo por la unidad de IA de $1'],
  [/^Shown on the wheelhouse display$/, 'Mostrada en la pantalla del puente'],
  [/^Acknowledged on board$/, 'Confirmada a bordo'],
  [/^Acknowledged ashore and assigned$/, 'Confirmada en tierra y asignada'],
  [/^Received ashore over (.+)$/, 'Recibida en tierra por $1'],
  [/^WhatsApp and SMS sent to the duty officer$/, 'WhatsApp y SMS enviados al oficial de guardia'],
  [/^15 s clip received, (.+)$/, 'Clip de 15 s recibido, $1'],
  [/^Clip viewed on phone$/, 'Clip visto en el teléfono'],
  [/^Round due (\S+) not seen within the (\d+) min tolerance$/, 'Ronda de las $1 no vista dentro de la tolerancia de $2 min'],
  [/^Scene check failed: blur$/, 'Control de escena fallido: desenfoque'],
  [/^Asked the crew to clean the lens$/, 'Se pidió a la tripulación limpiar la lente'],
  [/^Last health message from (\S+), near (.+)$/, 'Último mensaje de estado de $1, cerca de $2'],
  [/^Convoy marked out of coverage$/, 'Convoy marcado sin cobertura'],
  [/^Closed · accepted · crew briefed$/, 'Cerrada · aceptada · tripulación informada'],
  [/^Closed · accepted$/, 'Cerrada · aceptada'],
  [/^Closed · false alert$/, 'Cerrada · falsa alerta'],
];

const MONTH_ES: Record<string, string> = {
  Jan: 'ene', Feb: 'feb', Mar: 'mar', Apr: 'abr', May: 'may', Jun: 'jun',
  Jul: 'jul', Aug: 'ago', Sep: 'sept', Oct: 'oct', Nov: 'nov', Dec: 'dic',
};
const monthsEs = (s: string) => s.replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g, (m) => MONTH_ES[m]);

const UC_STATUS_ES: [RegExp, string][] = [
  [/^Live · alerts on since (.+)$/, 'En vivo · alertas activas desde el $1'],
  [/^Live · record and list$/, 'En vivo · registrar y listar'],
  [/^Live · (\d+) min tolerance$/, 'En vivo · tolerancia de $1 min'],
  [/^Live · scene check every hour$/, 'En vivo · control de escena cada hora'],
  [/^Shadow run · day (\d+) of (\d+) · logged only$/, 'Ejecución en sombra · día $1 de $2 · solo registro'],
  [/^Shadow run · day (\d+) of (\d+)$/, 'Ejecución en sombra · día $1 de $2'],
  [/^Blocked · needs consented drill footage$/, 'Bloqueado · requiere video de simulacro con consentimiento'],
  [/^Blocked · needs thermal cameras for night$/, 'Bloqueado · requiere cámaras térmicas para la noche'],
  [/^Off · follows in fleet rollout$/, 'Apagado · llega con el despliegue en la flota'],
];

const VOYAGE_ES: [RegExp, string][] = [
  [/^Under way · day (\d+) of (\d+) · out of coverage$/, 'En navegación · día $1 de $2 · sin cobertura'],
  [/^Under way · day (\d+) of (\d+)$/, 'En navegación · día $1 de $2'],
  [/^In port · cargo operations$/, 'En puerto · operaciones de carga'],
  [/^Completed (.+)$/, 'Completado $1'],
  [/^(.+) due (.+)$/, '$1, llegada prevista $2'],
  [/^Departs (.+?) (\d.+)$/, 'Sale de $1 $2'],
  [/^Arrived (.+?) (\d.+)$/, 'Llegó a $1 $2'],
  [/^(.+) to (.+)$/, '$1 a $2'],
];

const translateBy = (rules: [RegExp, string][], s: string) => {
  for (const [re, out] of rules) if (re.test(s)) return monthsEs(s.replace(re, out));
  return s;
};

const TARGET_ES: Record<string, string> = {
  'Wheelhouse display': 'Pantalla del puente',
  'Wheelhouse list': 'Lista del puente',
  'Console only': 'Solo consola',
  'Daily summary': 'Resumen diario',
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const TARGET_TO_ES: Record<string, string> = {
  'Wheelhouse display': 'a la pantalla del puente',
  'Wheelhouse list': 'a la lista del puente',
  'Console only': 'solo a la consola',
  'Daily summary': 'al resumen diario',
};

/** "al gerente de operaciones", "a la gerencia de GFSA de guardia" */
export const roleToEs = (role: string) => TARGET_TO_ES[role] ?? `a ${roleEs(role)}`.replace(/^a el /, 'al ');

/** "Gerente de operaciones" */
export const roleNameEs = (role: string) => TARGET_ES[role] ?? cap(roleEs(role).replace(/^(el|la) /, ''));

/** "Guarán F 503 · Port edge", or the convoy when the alarm has no camera. */
export function whereOf(fleet: Fleet, tr: Tr, a: { cameraId?: string; vesselId?: string; convoyId: string }): string {
  const cam = fleet.cameraById(a.cameraId);
  if (cam) return `${fleet.vesselById(a.vesselId ?? cam.vesselId)?.name ?? ''} · ${cam.name}`;
  const name = fleet.convoyById(a.convoyId)?.name ?? '';
  return tr(`${name} convoy`, `Convoy ${name}`);
}

/**
 * Every label the alarm console shows, in the signed-in user's language, bound
 * to the live fleet. Data carries its own Spanish where it has it (titleEs,
 * descriptionEs, textEs, nameEs); the rest is translated here.
 */
export function useAlarmText() {
  const { state } = useApp();
  const fleet = useFleet();
  const es = state.lang === 'es';
  return useMemo(() => {
    const tr: Tr = (en, sp) => (es ? sp : en);
    const p = (pair: Pair) => pair[es ? 1 : 0];
    const convoyName = (id?: string) => fleet.convoyById(id)?.name ?? '';
    const reason = (r?: string) => (r ? (es ? reasonEs(r) : r) : '');
    return {
      es,
      tr,
      p,
      fleet,
      title: (a: Pick<Alarm, 'title' | 'titleEs'>) => (es && a.titleEs ? a.titleEs : a.title),
      description: (a: Pick<Alarm, 'description' | 'descriptionEs'>) => (es && a.descriptionEs ? a.descriptionEs : a.description),
      ucName: (uc: UseCase | undefined, fallback = '') => (uc ? (es ? uc.nameEs : uc.name) : fallback),
      ucRule: (uc: UseCase) => (es ? uc.ruleEs : uc.rule),
      ucStatus: (note: string) => (es ? translateBy(UC_STATUS_ES, note) : note),
      where: (a: { cameraId?: string; vesselId?: string; convoyId: string }) => whereOf(fleet, tr, a),
      vesselShort: (vesselId?: string) => {
        const v = fleet.vesselById(vesselId);
        if (!v) return '';
        return v.kind === 'tug' ? v.name : v.short;
      },
      convoyName,
      convoyLabel: (id?: string) => tr(`${convoyName(id)} convoy`, `Convoy ${convoyName(id)}`),
      reason,
      classText: (c: Classification, r?: string) =>
        c === 'false_alert' && r ? tr(`false alert (${r})`, `falsa alerta (${reason(r)})`) : p(CLASS_NAME[c]),
      activity: (e: ActivityEntry) => (es ? (e.textEs ? localizeReasons(e.textEs) : translateBy(ACTIVITY_ES, e.text)) : e.text),
      actor: (name: string) => (es ? (ACTOR_ES[name] ?? name) : name),
      phrase: (s: string) => (es ? (PHRASE_ES[s] ?? s.replace(/^Seen (\S+), (\d+) min late$/, 'Vista a las $1, $2 min tarde')) : s),
      detLabel: (label: string) => (es ? (DETECTION_ES[label] ?? label) : label),
      evidence: (item: { name: string }) => evidenceLabel(item.name, es),
      voyageText: (v: Voyage) => ({
        route: es ? translateBy(VOYAGE_ES.slice(-1), v.route) : v.route,
        status: es ? translateBy(VOYAGE_ES, v.statusNote) : v.statusNote,
        nextCall: es ? translateBy(VOYAGE_ES.slice(4, 7), v.nextCall) : v.nextCall,
      }),
      linkLabel: (label?: string) => (label ? (es ? label.replace(/^None/, 'Sin enlace') : label) : ''),
      /** "the operations manager" / "al gerente de operaciones" */
      roleTo: (role: string) => (es ? roleToEs(role) : `the ${role.toLowerCase()}`),
      /** "Operations manager" / "Gerente de operaciones" */
      roleName: (role: string) => (es ? roleNameEs(role) : role),
    };
  }, [es, fleet]);
}

export type AlarmText = ReturnType<typeof useAlarmText>;

// ---------- Derived alarm data ----------

export interface Escalation {
  at: number;
  left: number;
  to?: string;
}

/** ALM-03: countdown to the next escalation step, from the engine-owned `escalatesAt`. */
export function escalationOf(a: Alarm, now: number): Escalation | null {
  if (!a.escalatesAt || (a.state !== 'raised' && a.state !== 'ack_board')) return null;
  const at = new Date(a.escalatesAt).getTime();
  return { at, left: at - now, to: a.escalatesTo };
}

/** Activity plus the pending escalation line (the engine writes the real one when it fires). */
export function activityOf(a: Alarm, now: number): ActivityEntry[] {
  const list = [...a.activity];
  const esc = escalationOf(a, now);
  if (esc && esc.left > 0 && esc.to) {
    list.push({
      at: new Date(esc.at).toISOString(),
      text: `Escalates to the ${esc.to.toLowerCase()} if nobody acknowledges`,
      textEs: `Se escala ${roleToEs(esc.to)} si nadie la confirma`,
      actor: 'Pending',
      pending: true,
    });
  }
  return list.sort((x, y) => x.at.localeCompare(y.at));
}

/** Text for the state badge on the alarm header. */
export function stateBadgeText(a: Alarm, tx: AlarmText): string {
  const { tr } = tx;
  switch (a.state) {
    case 'raised':
      return tr('Raised · not acknowledged', 'Generada · sin confirmar');
    case 'ack_board':
      return tr('Acknowledged on board · open ashore', 'Confirmada a bordo · abierta en tierra');
    case 'ack_shore': {
      const label = tx.phrase(a.stateLabel ?? 'In progress');
      return tr(`Acknowledged ashore · ${label.toLowerCase()}`, `Confirmada en tierra · ${label.toLowerCase()}`);
    }
    case 'resolved':
      return a.classification ? tr('Resolved · ready to close', 'Resuelta · lista para cerrar') : tr('Resolved · classify, then close', 'Resuelta · clasifique y luego cierre');
    case 'closed':
      return a.classification ? `${tr('Closed', 'Cerrada')} · ${tx.classText(a.classification, a.falseReason)}` : tr('Closed', 'Cerrada');
  }
}

// ---------- Evidence (ALM-05, ALM-08) ----------

export interface EvidenceItem {
  /** Stored English name, e.g. "Clip, 15 s · 3.1 MB" */
  name: string;
  meta: string;
  hash?: string;
  kind: 'clip' | 'snapshot' | 'record' | 'footage';
}

const kindOf = (name: string): EvidenceItem['kind'] =>
  name.startsWith('Clip') ? 'clip' : name.startsWith('Snapshot') ? 'snapshot' : name.startsWith('Recorder') ? 'footage' : 'record';

/** "Snapshot 14:32:06 · 52 KB" → "Captura 14:32:06 · 52 KB" */
export function evidenceLabel(name: string, es: boolean): string {
  if (!es) return name;
  const dec = (s: string) => s.replace(/(\d)\.(\d)/g, '$1,$2');
  if (name.startsWith('Snapshot')) return dec(name.replace(/^Snapshot/, 'Captura'));
  if (name.startsWith('Clip')) return dec(name);
  if (name.startsWith('Recorder footage')) return dec(name.replace(/^Recorder footage/, 'Video del grabador'));
  if (name === 'Detection record') return 'Registro de detección';
  if (name === 'Scene check record') return 'Registro del control de escena';
  if (name === 'Evidence package') return 'Paquete de evidencia';
  return name;
}

/** Length of the footage asked from the on-board recorder, and how it lines up with the event. */
export const FOOTAGE_SECONDS = 120;
export const FOOTAGE_LEAD = 60; // seconds before the alarm

export function footageItem(id: string): EvidenceItem {
  return {
    name: 'Recorder footage, 2 min · 24.6 MB',
    meta: 'MP4 · 720p',
    hash: `sha256 ${shortHash(fakeHash(`${id}|recorder`))}`,
    kind: 'footage',
  };
}

/** ALM-08: evidence with hashes, plus recorder footage once it has arrived. */
export function evidenceOf(a: Alarm, footageArrived: boolean): EvidenceItem[] {
  const list: EvidenceItem[] = a.evidence.map((e) => ({ ...e, kind: kindOf(e.name) }));
  if (footageArrived) list.push(footageItem(a.id));
  return list;
}

/** Review events carry a standard 15 s clip, snapshot and detection record. */
export function eventEvidence(e: ReviewEvent, footageArrived: boolean): EvidenceItem[] {
  const h = (k: string) => `sha256 ${shortHash(fakeHash(`${e.id}|${k}`))}`;
  const list: EvidenceItem[] = [
    { name: 'Clip, 15 s · 2.9 MB', meta: 'MP4 · 720p', hash: h('clip'), kind: 'clip' },
    { name: 'Snapshot · 50 KB', meta: 'JPEG', hash: h('snapshot'), kind: 'snapshot' },
    { name: 'Detection record', meta: '2 KB · JSON', hash: h('record'), kind: 'record' },
  ];
  if (footageArrived) list.push(footageItem(e.id));
  return list;
}

/** One export of one evidence file (ALM-08), saved per alarm or event. */
export interface ExportRecord {
  /** English evidence name */
  item: string;
  file: string;
  wm: string;
  at: number;
  by: string;
}

// ---------- Store and forward ----------

/** When a queued event reached shore: the convoy's "back in coverage" line in the audit log. */
export function arrivedAshoreAt(e: ReviewEvent, audit: AuditEntry[]): string | undefined {
  if (!e.queued) return undefined;
  const back = audit
    .filter((x) => x.action === 'Convoy back in coverage' && x.convoyId === e.convoyId && x.at >= e.at)
    .map((x) => x.at)
    .sort();
  return back[0];
}

// ---------- Related (ALM-10) ----------

export interface RelatedItem {
  id: string;
  kind: 'alarm' | 'event';
  title: string;
  where: string;
  at: string;
  status: string;
  to: string;
}

const RELATED_WINDOW_MS = 2 * 3600_000;

/** ALM-10: alarms and events on the same vessel (or convoy) within two hours either side. */
export function relatedOf(a: Alarm, alarms: Alarm[], events: ReviewEvent[], tx: AlarmText, ucName: (id: string) => string): RelatedItem[] {
  const { tr, p } = tx;
  const at = new Date(a.raisedAt).getTime();
  const near = (iso: string) => Math.abs(new Date(iso).getTime() - at) <= RELATED_WINDOW_MS;
  const same = (x: { vesselId?: string; convoyId: string }) => (a.vesselId ? x.vesselId === a.vesselId : x.convoyId === a.convoyId);
  const fromAlarms: RelatedItem[] = alarms
    .filter((x) => x.id !== a.id && same(x) && near(x.raisedAt))
    .map((x) => ({
      id: x.id,
      kind: 'alarm',
      title: tx.title(x),
      where: tx.where(x),
      at: x.raisedAt,
      status: x.state === 'closed' ? `${tr('Closed', 'Cerrada')}${x.classification ? ` · ${tx.classText(x.classification)}` : ''}` : p(STATE_SHORT[x.state]),
      to: `/alarms/${x.id}`,
    }));
  const fromEvents: RelatedItem[] = events
    .filter((e) => same(e) && near(e.at))
    .map((e) => ({
      id: e.id,
      kind: 'event',
      title: ucName(e.useCaseId),
      where: tx.where(e),
      at: e.at,
      status: e.classification
        ? `${tr('Reviewed', 'Revisado')} · ${tx.classText(e.classification)}`
        : e.shadow
          ? tr('To review · shadow run', 'Por revisar · ejecución en sombra')
          : tr('To review', 'Por revisar'),
      to: `/alarms?tab=review&event=${e.id}`,
    }));
  return [...fromAlarms, ...fromEvents].sort((x, y) => y.at.localeCompare(x.at));
}
