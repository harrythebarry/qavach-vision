import { CATEGORY_ES, TARGETS } from '../../data/useCases';
import { FIXED_TARGETS, stepDetail, type Recipient, type Step } from '../../data/routing';
import type { UseCase, UseCaseCategory, UseCaseLevel, UseCasePhase, UseCaseStatus } from '../../data/types';
import { channelsText } from '../../state/escalation';
import { activeConfig, sameZones, SHADOW_DAY_MS, type Schedule, type UcConfig, type UcRecord } from '../../state/configStore';
import { fmtDay } from '../../lib/time';

// Reference copy, sample figures and Spanish/English wording shared by
// "Use case set-up" and "Cameras and zones". Pairs are [English, Español];
// screens pass them to tr(...pair).

export type Bi = [string, string];

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const dec = (n: number, es: boolean) => (es ? n.toFixed(2).replace('.', ',') : n.toFixed(2));

export const LEVELS: { value: UseCaseLevel; label: Bi; text: Bi }[] = [
  { value: 'list', label: ['Record and list', 'Registrar y listar'], text: ['Log each event with a clip. No alerts.', 'Registra cada evento con un clip. Sin alertas.'] },
  { value: 'alert', label: ['Record and alert', 'Registrar y alertar'], text: ['Also alert the people in step 5 in real time.', 'Además alerta en tiempo real a las personas del paso 5.'] },
  {
    value: 'act',
    label: ['Record and act', 'Registrar y actuar'],
    text: ['Raise a task in Connect. Opens once the pilot proves accuracy.', 'Crea una tarea en Connect. Se habilita cuando el piloto demuestre la precisión.'],
  },
];

export const LEVEL_SHORT: Record<UseCaseLevel, Bi> = {
  list: ['Record and list', 'Registrar y listar'],
  alert: ['Record and alert', 'Registrar y alertar'],
  act: ['Record and act', 'Registrar y actuar'],
};

export const SCHEDULES: { value: Schedule; label: Bi; runs: Bi }[] = [
  { value: 'always', label: ['Always', 'Siempre'], runs: ['runs always', 'funciona siempre'] },
  { value: 'underway', label: ['Under way or mooring', 'En navegación o amarrando'], runs: ['runs under way or mooring', 'funciona en navegación o al amarrar'] },
  { value: 'cargo', label: ['Cargo operations', 'Operaciones de carga'], runs: ['runs during cargo operations', 'funciona durante las operaciones de carga'] },
  { value: 'hours', label: ['Set hours', 'Horario fijo'], runs: ['runs at set hours', 'funciona en horario fijo'] },
];

export const STATUS_LABEL: Record<UseCaseStatus, Bi> = {
  off: ['Off', 'Apagado'],
  shadow: ['Shadow run', 'Ejecución en sombra'],
  live: ['Live', 'En vivo'],
  blocked: ['Blocked', 'Bloqueado'],
};
export const STATUS_TONE: Record<UseCaseStatus, 'ok' | 'warn' | 'neutral' | 'bad'> = { live: 'ok', shadow: 'warn', off: 'neutral', blocked: 'bad' };

export const PHASE_LABEL: Record<UseCasePhase, Bi> = { Pilot: ['Pilot', 'Piloto'], Rollout: ['Rollout', 'Despliegue'], Blocked: ['Blocked', 'Bloqueado'] };

export const categoryText = (c: string): Bi => [c, CATEGORY_ES[c] ?? c];

export const MODEL_LINE: Record<UseCaseCategory, Bi> = {
  'Crew safety': ['Base detector v2.1 → Crew safety attributes v1.4', 'Detector base v2.1 → Atributos de seguridad de la tripulación v1.4'],
  'Fire and smoke': ['Fire and smoke v1.2', 'Fuego y humo v1.2'],
  'Water and navigation': ['Base detector v2.1 → Water and navigation v0.9', 'Detector base v2.1 → Agua y navegación v0.9'],
  'Cargo and operations': ['Base detector v2.1 → Cargo v1.1', 'Detector base v2.1 → Carga v1.1'],
  'Scene checks': ['Scene checks v1.0 · image-quality rules', 'Controles de escena v1.0 · reglas de calidad de imagen'],
};

/** Camera types a use case needs (the catalogue's "Cameras" column). */
const CAMERA_TYPES_ES: Record<string, string> = {
  Deck: 'Cubierta',
  'Barge edge': 'Borde de barcaza',
  'Barge edge, thermal': 'Borde de barcaza, térmica',
  'Engine room': 'Sala de máquinas',
  'Bow, 10 to 15 frames a second': 'Proa, 10 a 15 imágenes por segundo',
  'Reefer row': 'Fila de reefers',
  'Deck, barge edge': 'Cubierta, borde de barcaza',
  'Every camera': 'Todas las cámaras',
};
export const cameraTypesText = (uc: UseCase): Bi => [uc.cameras, CAMERA_TYPES_ES[uc.cameras] ?? uc.cameras];

const BLOCKED_ES: Record<string, string> = {
  'Needs consented drill footage to train': 'Necesita imágenes de simulacros con consentimiento para entrenar',
  'Needs thermal cameras for night': 'Necesita cámaras térmicas para la noche',
};
export const blockedText = (uc: UseCase): Bi => [uc.blockedReason ?? '', BLOCKED_ES[uc.blockedReason ?? ''] ?? uc.blockedReason ?? ''];

/** Date each live use case passed its 14-day shadow run. */
export const GATE_PASSED: Record<string, string> = {
  'hard-hat-vest': '2026-10-07T12:00:00-03:00',
  'life-jacket': '2026-10-05T12:00:00-03:00',
  'smoke-fire-deck': '2026-10-08T12:00:00-03:00',
  'smoke-machinery': '2026-10-08T12:00:00-03:00',
  'container-doors': '2026-10-08T12:00:00-03:00',
  'reefer-rounds': '2026-10-08T12:00:00-03:00',
  'camera-health': '2026-10-04T12:00:00-03:00',
};

// ---------- Status and the accuracy gate (UC-06) ----------

export function shadowDay(rec: UcRecord, now: number) {
  if (!rec.shadowStart) return 0;
  return Math.min(TARGETS.shadowDays, Math.max(1, Math.floor((now - new Date(rec.shadowStart).getTime()) / SHADOW_DAY_MS) + 1));
}

/** The shadow run has run its full 14 days. */
export const shadowComplete = (rec: UcRecord, now: number) => !!rec.shadowStart && now - new Date(rec.shadowStart).getTime() >= TARGETS.shadowDays * SHADOW_DAY_MS;
export const shadowEnd = (rec: UcRecord) => (rec.shadowStart ? new Date(rec.shadowStart).getTime() + TARGETS.shadowDays * SHADOW_DAY_MS : 0);

export function statusText(uc: UseCase, rec: UcRecord, now: number): Bi {
  const cfg = activeConfig(uc, rec);
  switch (rec.status) {
    case 'shadow': {
      const day = shadowDay(rec, now);
      const only = uc.id === 'outside-work';
      return [`Shadow run · day ${day} of ${TARGETS.shadowDays}${only ? ' · logged only' : ''}`, `Ejecución en sombra · día ${day} de ${TARGETS.shadowDays}${only ? ' · solo registro' : ''}`];
    }
    case 'blocked': {
      const [en, es] = blockedText(uc);
      return [`Blocked · ${en.toLowerCase()}`, `Bloqueado · ${es.toLowerCase()}`];
    }
    case 'off':
      return ['Off · follows in fleet rollout', 'Apagado · sigue en el despliegue a la flota'];
    case 'live': {
      if (uc.id === 'camera-health') return ['Live · scene check every hour', 'En vivo · control de escena cada hora'];
      if (cfg.level === 'alert')
        return rec.alertsSince ? [`Live · alerts on since ${fmtDay(rec.alertsSince)}`, `En vivo · alertas activas desde el ${fmtDay(rec.alertsSince)}`] : ['Live · alerts on', 'En vivo · alertas activas'];
      if (uc.id === 'reefer-rounds') {
        const min = cfg.rule.item?.match(/^(\d+) min/)?.[1] ?? '15';
        return [`Live · ${min} min tolerance`, `En vivo · tolerancia de ${min} min`];
      }
      return ['Live · record and list', 'En vivo · registrar y listar'];
    }
  }
}

export interface Gate {
  precision?: boolean;
  recall?: boolean;
  falseAlerts?: boolean;
  /** Scores exist and all three targets are met. */
  met: boolean;
  scored: boolean;
}

export function gateOf(uc: UseCase): Gate {
  const precision = uc.precision !== undefined ? uc.precision >= TARGETS.precision : undefined;
  const recall = uc.recall !== undefined ? uc.recall >= TARGETS.recall : undefined;
  const falseAlerts = uc.falseAlertsPerCamDay !== undefined ? uc.falseAlertsPerCamDay <= TARGETS.falseAlertsPerCamDay : undefined;
  const scored = precision !== undefined && recall !== undefined && falseAlerts !== undefined;
  return { precision, recall, falseAlerts, scored, met: scored && !!precision && !!recall && !!falseAlerts };
}

/** What still has to happen before alerts can switch on, in plain words. */
export function gateMissing(uc: UseCase, es: boolean): string[] {
  const g = gateOf(uc);
  const out: string[] = [];
  const pct = (v?: number) => `${Math.round((v ?? 0) * 100)}%`;
  if (!g.scored) out.push(es ? 'el conjunto de prueba de GFSA dé resultados' : 'the GFSA test set produces scores');
  if (g.precision === false) out.push(es ? `la precisión llegue al ${pct(TARGETS.precision)} (ahora ${pct(uc.precision)})` : `precision reaches ${pct(TARGETS.precision)} (now ${pct(uc.precision)})`);
  if (g.recall === false) out.push(es ? `la exhaustividad llegue al ${pct(TARGETS.recall)} (ahora ${pct(uc.recall)})` : `recall reaches ${pct(TARGETS.recall)} (now ${pct(uc.recall)})`);
  if (g.falseAlerts === false)
    out.push(
      es
        ? `las falsas alertas bajen a ${TARGETS.falseAlertsPerCamDay} o menos por cámara y día (ahora ${dec(uc.falseAlertsPerCamDay ?? 0, true)})`
        : `false alerts fall to ${TARGETS.falseAlertsPerCamDay} or fewer per camera per day (now ${dec(uc.falseAlertsPerCamDay ?? 0, false)})`,
    );
  return out;
}

/** "a, b and c" / "a, b y c" */
export const joinList = (items: string[], es: boolean) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} ${es ? 'y' : 'and'} ${items[items.length - 1]}`;

export interface Accuracy {
  precisionNote: Bi;
  recallNote: Bi;
  falseNote: Bi;
}

export function accuracyNotes(uc: UseCase, rec: UcRecord, cameras: number): Accuracy {
  if (uc.id === 'life-jacket') {
    return {
      precisionNote: ['25 of 27 alarms accepted since 6 Oct', '25 de 27 alarmas aceptadas desde el 6 oct'],
      recallNote: ['412 held-out GFSA clips', '412 clips de prueba reservados de GFSA'],
      falseNote: ['2 false alerts on 7 cameras in 9 days live', '2 falsas alertas en 7 cámaras en 9 días en vivo'],
    };
  }
  const shadow = rec.status === 'shadow';
  return {
    precisionNote: ['Share of reviewed events accepted by reviewers', 'Proporción de eventos revisados que los revisores aceptaron'],
    recallNote: ['Held-out GFSA clips from the pilot convoy', 'Clips de prueba reservados de GFSA del convoy piloto'],
    falseNote: [
      `Average over ${cameras} camera${cameras === 1 ? '' : 's'} ${shadow ? 'in the shadow run so far' : 'over the last 7 days'}`,
      `Promedio en ${cameras} cámara${cameras === 1 ? '' : 's'} ${shadow ? 'en lo que va de la ejecución en sombra' : 'en los últimos 7 días'}`,
    ],
  };
}

export const FALSE_REASONS: Record<string, { since: Bi; reasons: [Bi, number][]; note: Bi }> = {
  'life-jacket': {
    since: ['6 false alerts since 22 Sep, shadow run included', '6 falsas alertas desde el 22 sep, incluida la ejecución en sombra'],
    reasons: [
      [['Inflatable life jacket worn', 'Chaleco salvavidas inflable puesto'], 3],
      [['Reflection or shadow', 'Reflejo o sombra'], 2],
      [['Outside the zone', 'Fuera de la zona'], 1],
    ],
    note: ['Inflatable jackets are in the training set for the next model update.', 'Los chalecos inflables están en el conjunto de entrenamiento de la próxima actualización del modelo.'],
  },
  'hard-hat-vest': {
    since: ['9 false alerts since 25 Sep', '9 falsas alertas desde el 25 sep'],
    reasons: [
      [['Cap mistaken for a hard hat', 'Gorra confundida con un casco'], 4],
      [['Vest under a raincoat', 'Chaleco bajo un impermeable'], 3],
      [['Person partly hidden', 'Persona parcialmente oculta'], 2],
    ],
    note: ['Raincoat clips from the pilot convoy are waiting for consent.', 'Los clips con impermeable del convoy piloto esperan el consentimiento.'],
  },
  smoking: {
    since: ['20 false alerts since 7 Oct, shadow run', '20 falsas alertas desde el 7 oct, ejecución en sombra'],
    reasons: [
      [['Breath vapour in cold air', 'Vaho al respirar en aire frío'], 9],
      [['Hand to mouth, eating', 'Mano a la boca, comiendo'], 7],
      [['Exhaust in view', 'Escape de motor a la vista'], 4],
    ],
    note: ['Too many false alerts to switch alerts on. More negatives are needed.', 'Demasiadas falsas alertas para activar las alertas. Se necesitan más ejemplos negativos.'],
  },
  'smoke-fire-deck': {
    since: ['3 false alerts since 25 Sep', '3 falsas alertas desde el 25 sep'],
    reasons: [
      [['Engine exhaust', 'Escape del motor'], 2],
      [['Dust from cargo', 'Polvo de la carga'], 1],
    ],
    note: ['Exhaust plumes are masked on two bow cameras.', 'Las columnas de escape están enmascaradas en dos cámaras de proa.'],
  },
  'smoke-machinery': {
    since: ['3 false alerts since 25 Sep', '3 falsas alertas desde el 25 sep'],
    reasons: [
      [['Steam from a leak check', 'Vapor de una prueba de fugas'], 2],
      [['Lens haze', 'Lente empañada'], 1],
    ],
    note: ['Lens haze is also caught by the hourly scene check.', 'La lente empañada también la detecta el control de escena horario.'],
  },
  'container-doors': {
    since: ['9 false alerts since 25 Sep', '9 falsas alertas desde el 25 sep'],
    reasons: [
      [['Door shadow', 'Sombra de la puerta'], 5],
      [['Opened by plan, missing in Connect', 'Abierta según el plan, falta en Connect'], 4],
    ],
    note: ['Cargo plans now sync from Connect every 5 minutes.', 'Los planes de carga ahora se sincronizan desde Connect cada 5 minutos.'],
  },
  'reefer-rounds': {
    since: ['2 false alerts since 25 Sep', '2 falsas alertas desde el 25 sep'],
    reasons: [[['Round recorded late in Connect', 'Ronda registrada tarde en Connect'], 2]],
    note: ['Both were rounds done on time but logged late.', 'Ambas fueron rondas hechas a tiempo pero registradas tarde.'],
  },
  'outside-work': {
    since: ['13 false alerts since 12 Oct, shadow run', '13 falsas alertas desde el 12 oct, ejecución en sombra'],
    reasons: [
      [['Work not yet in Connect', 'Trabajo aún no cargado en Connect'], 6],
      [['Crew passing through', 'Tripulación de paso'], 5],
      [['Reflection', 'Reflejo'], 2],
    ],
    note: ['Most false alerts come from the work plan, not the model.', 'La mayoría de las falsas alertas vienen del plan de trabajo, no del modelo.'],
  },
  'camera-health': {
    since: ['1 false alert since 20 Sep', '1 falsa alerta desde el 20 sep'],
    reasons: [[['Rain on the lens, cleared', 'Lluvia en la lente, despejada'], 1]],
    note: ['Rain that clears within the hour is not raised again.', 'La lluvia que se despeja dentro de la hora no se vuelve a generar.'],
  },
};

// ---------- Rule sentence (UC-04) ----------

const RULE_ES: Record<string, string> = {
  // objects (with their article)
  person: 'una persona',
  'smoke or flame': 'humo o llamas',
  smoke: 'humo',
  flame: 'llamas',
  'smoke or haze': 'humo o neblina',
  'floating debris or a vessel': 'restos flotantes o una embarcación',
  'floating debris': 'restos flotantes',
  vessel: 'una embarcación',
  'container door': 'una puerta de contenedor',
  image: 'la imagen',
  // verbs
  'is inside': 'está dentro de',
  'is seen in': 'se ve en',
  crosses: 'cruza',
  'is open in': 'está abierta en',
  'is not seen in': 'no se ve en',
  is: 'está',
  // qualifiers
  'without a': 'sin',
  while: 'mientras',
  into: 'hacia',
  outside: 'fuera de',
  within: 'dentro de',
  // items
  'hard hat or vest': 'casco o chaleco',
  'hard hat': 'casco',
  vest: 'chaleco',
  'life jacket': 'chaleco salvavidas',
  smoking: 'fuma',
  'using a phone': 'usa el teléfono',
  'lying still': 'está tendida e inmóvil',
  'the water': 'el agua',
  'cargo operations': 'las operaciones de carga',
  'port calls': 'las escalas en puerto',
  '10 min of a planned round': '10 min de una ronda planificada',
  '15 min of a planned round': '15 min de una ronda planificada',
  '30 min of a planned round': '30 min de una ronda planificada',
  'work planned in Connect': 'el trabajo planificado en Connect',
  'blurred, wet, moved or missing': 'desenfocada, mojada, movida o ausente',
  missing: 'ausente',
  'at the hourly scene check': 'en el control de escena horario',
  'Anywhere in view': 'Cualquier parte de la imagen',
};

/** A rule word in the current language (Spanish carries its own article). */
export const ruleWord = (w: string, es: boolean) => (es ? (RULE_ES[w] ?? w) : w);
export const ANYWHERE = 'Anywhere in view';

/** "a" / "the" / "" before an English rule object. */
export const ruleArticle = (o: string) => (o === 'image' ? 'the' : o.startsWith('smoke') || o.startsWith('floating') || o === 'flame' ? '' : 'a');

// ---------- Zones and cameras ----------

const ZONE_NOTE_ES: Record<string, string> = {
  'around the main engines': 'alrededor de los motores principales',
  'water ahead of the bow': 'el agua delante de la proa',
  'where crew walk and work': 'por donde la tripulación camina y trabaja',
  'container doors and lashing': 'puertas de contenedores y trincado',
  'along the hull line': 'a lo largo de la línea del casco',
  'used by objects thrown overboard': 'la usan los objetos arrojados por la borda',
  'the aisle between reefer units': 'el pasillo entre los reefers',
  'drawn before the camera moved': 'dibujada antes de que la cámara se moviera',
};
export const zoneNoteText = (note: string | undefined, es: boolean) => (note ? (es ? (ZONE_NOTE_ES[note] ?? note) : note) : undefined);

const POSITION_ES: Record<string, string> = {
  'Tug, wheelhouse': 'Remolcador, puente',
  'Tug, engine room': 'Remolcador, sala de máquinas',
  'Tug, bow': 'Remolcador, proa',
  'Barge, deck': 'Barcaza, cubierta',
  'Barge, port side': 'Barcaza, banda de babor',
  'Barge, starboard side': 'Barcaza, banda de estribor',
  'Barge, reefer row': 'Barcaza, fila de reefers',
};
const FACING_ES: Record<string, string> = { 'Forward-facing': 'Hacia proa', 'Aft-facing': 'Hacia popa', Overhead: 'Cenital' };
export const positionText = (p: string, es: boolean) => (es ? (POSITION_ES[p] ?? p) : p);
export const facingText = (f: string, es: boolean) => (es ? (FACING_ES[f] ?? f) : f);
export const kindText = (k: 'tug' | 'barge', es: boolean) => (es ? (k === 'tug' ? 'remolcador' : 'barcaza') : k);

/** "near Rosario" → "cerca de Rosario" */
export function placeText(label: string, es: boolean): string {
  if (!es) return label;
  const near = label.match(/^near (.+?)(?: at (\d\d:\d\d))?$/);
  if (near) return `cerca de ${near[1]}${near[2] ? ` a las ${near[2]}` : ''}`;
  const port = label.match(/^in port, (.+)$/);
  if (port) return `en puerto, ${port[1]}`;
  return label;
}

/** "None · 47 min" → "Sin enlace · 47 min" */
export const linkText = (label: string, es: boolean) => (es ? label.replace(/^None/, 'Sin enlace') : label);

const FLAG_ES: Record<string, string> = {
  Blurred: 'Desenfocada',
  'Lens wet': 'Lente mojada',
  'Wet lens': 'Lente mojada',
  Glare: 'Reflejos',
  'Camera moved': 'Cámara movida',
  Moved: 'Movida',
  'No image': 'Sin imagen',
  Degraded: 'Degradada',
};
export const flagText = (note: string, es: boolean) => (es ? (FLAG_ES[note] ?? note) : note);

/** A camera's health note ("Blurred since 13:20") in the current language. */
export function healthNoteText(note: string | undefined, es: boolean): string | undefined {
  if (!note || !es) return note;
  if (note === 'Added · waiting for the first scene check') return 'Agregada · esperando su primer control de escena';
  const held = note.match(/^Moved · zones held since (\d\d:\d\d)$/);
  if (held) return `Movida · zonas retenidas desde las ${held[1]}`;
  const since = note.match(/^(.+) since (\d\d:\d\d)$/);
  if (since) return `${FLAG_ES[since[1]] ?? since[1]} desde las ${since[2]}`;
  return FLAG_ES[note] ?? note;
}

// ---------- Who gets the alarm (from the saved alert routing) ----------

const TARGET_ES: Record<string, string> = {
  'Wheelhouse display': 'Pantalla del puente',
  'Wheelhouse list': 'Lista en el puente',
  'Console only': 'Solo consola',
  'Daily summary': 'Resumen diario',
  'Duty officer': 'Oficial de guardia',
  'Operations manager': 'Gerente de operaciones',
  'Fleet superintendent': 'Superintendente de flota',
  'Safety administrator': 'Administrador de seguridad',
  'GFSA management on call': 'Gerencia de GFSA de guardia',
};
const FIXED_ES: Record<string, string> = {
  'Screen and buzzer, works without the link': 'Pantalla y zumbador, funciona sin enlace',
  'On the display list, no buzzer': 'En la lista de la pantalla, sin zumbador',
  'Listed in the alarm console, no message': 'En la consola de alarmas, sin mensaje',
  'Included in the daily report by email': 'Incluida en el informe diario por correo',
};

export const targetText = (t: string): Bi => [t, TARGET_ES[t] ?? t];

export function whenText(s: Step): Bi {
  switch (s.when) {
    case 'onboard':
      return ['At once, on board', 'De inmediato, a bordo'];
    case 'now':
      return ['At once, ashore', 'De inmediato, en tierra'];
    case 'after':
      return [`Not acknowledged in ${s.minutes} min`, `Sin confirmar en ${s.minutes} min`];
    case 'unreviewed':
      return [`Unreviewed for ${s.minutes} min`, `Sin revisar durante ${s.minutes} min`];
    case 'summary':
      return ['Next daily summary', 'Próximo resumen diario'];
  }
}

export function howText(s: Step): Bi {
  const fixed = FIXED_TARGETS[s.target];
  if (fixed) return [fixed, FIXED_ES[fixed] ?? fixed];
  if (!s.channels.length) return ['In the console queue, no message', 'En la cola de la consola, sin mensaje'];
  return [stepDetail(s), `${cap(channelsText.es(s.channels))}${s.digest ? ' en resumen' : ''}${s.extra ? ` · ${s.extra}` : ''}`];
}

export function hoursText(s: Step, recipients: Recipient[]): Bi {
  if (FIXED_TARGETS[s.target]) return ['Always', 'Siempre'];
  const role = s.target.replace(/ on call$/, '');
  const hours = [...new Set(recipients.filter((r) => r.role === role).map((r) => r.hours))];
  if (!hours.length) return ['—', '—'];
  if (hours.length === 2 && hours.includes('07:00–19:00') && hours.includes('19:00–07:00')) return ['24 h, day and night shift', '24 h, turno de día y de noche'];
  return [hours.join(' · '), hours.map((h) => (h === 'On-call rota' ? 'Rota de guardia' : h)).join(' · ')];
}

// ---------- Version notes (UC-07) ----------

/** What changed between two configurations, in both languages. */
export function diffSummary(a: UcConfig, b: UcConfig): Bi {
  const en: string[] = [];
  const es: string[] = [];
  const add = (e: string, s: string) => {
    en.push(e);
    es.push(s);
  };
  if (a.level !== b.level) add(LEVEL_SHORT[b.level][0], LEVEL_SHORT[b.level][1]);
  if (a.priority !== b.priority) add(`priority ${b.priority}`, `prioridad ${b.priority}`);
  if (a.cameraIds.join() !== b.cameraIds.join()) {
    const added = b.cameraIds.filter((c) => !a.cameraIds.includes(c)).length;
    const removed = a.cameraIds.filter((c) => !b.cameraIds.includes(c)).length;
    add(
      [added && `${added} camera${added > 1 ? 's' : ''} added`, removed && `${removed} removed`].filter(Boolean).join(', ') || 'cameras reordered',
      [added && `${added} cámara${added > 1 ? 's' : ''} añadida${added > 1 ? 's' : ''}`, removed && `${removed} quitada${removed > 1 ? 's' : ''}`].filter(Boolean).join(', ') || 'cámaras reordenadas',
    );
  }
  const zoneCams = Object.keys(b.zones).filter((k) => !sameZones(a.zones[k], b.zones[k]));
  if (zoneCams.length) add(`zones on ${zoneCams.join(', ')}`, `zonas en ${zoneCams.join(', ')}`);
  if (JSON.stringify(a.rule) !== JSON.stringify(b.rule)) add('rule changed', 'regla cambiada');
  if (a.confidence !== b.confidence) add(`confidence ${dec(b.confidence, false)}`, `confianza ${dec(b.confidence, true)}`);
  if (a.repeatMin !== b.repeatMin) add(`repeat ${b.repeatMin} min`, `repetición ${b.repeatMin} min`);
  if (a.schedule !== b.schedule || JSON.stringify(a.hours) !== JSON.stringify(b.hours)) {
    if (b.schedule === 'hours') add(`runs ${b.hours.from} to ${b.hours.to}`, `funciona de ${b.hours.from} a ${b.hours.to}`);
    else {
      const s = SCHEDULES.find((x) => x.value === b.schedule)!;
      add(s.runs[0], s.runs[1]);
    }
  }
  if (
    a.steps.join('|') !== b.steps.join('|') ||
    (a.stepsEs ?? []).join('|') !== (b.stepsEs ?? []).join('|') ||
    a.nextStep !== b.nextStep ||
    (a.nextStepEs ?? '') !== (b.nextStepEs ?? '')
  )
    add('response steps', 'pasos de respuesta');
  return en.length ? [cap(en.join(', ')), cap(es.join(', '))] : ['No changes', 'Sin cambios'];
}
