import {
  FIXED_TARGETS,
  type ChannelId,
  type RecipientChannel,
  type Shift,
  type Step,
  type StepWhen,
} from '../../data/routing';
import type { RoleId } from '../../data/types';

// Spanish and English wording for the alert routing data (RT-01 to RT-05).
// The saved configuration keeps English keys (targets, shifts, hours); these
// helpers turn them into the interface language.

export type Tr = (en: string, es: string) => string;

const TARGET_ES: Record<string, string> = {
  'Wheelhouse display': 'Pantalla del puente',
  'Wheelhouse list': 'Lista del puente',
  'Console only': 'Solo consola',
  'Daily summary': 'Resumen diario',
  'Duty officer': 'Oficial de guardia',
  'Operations manager': 'Gerente de operaciones',
  'Fleet superintendent': 'Superintendente de flota',
  'Safety administrator': 'Administrador de seguridad',
  'GFSA management on call': 'Gerencia de GFSA de guardia',
  'GFSA management': 'Gerencia de GFSA',
  Master: 'Capitán',
};

/** A ladder target or recipient role in the interface language. */
export const targetName = (t: string, tr: Tr) => tr(t, TARGET_ES[t] ?? t);

const FIXED_ES: Record<string, string> = {
  'Wheelhouse display': 'Pantalla y alarma sonora, funciona sin enlace',
  'Wheelhouse list': 'En la lista de la pantalla, sin alarma sonora',
  'Console only': 'En la consola de alarmas, sin mensaje',
  'Daily summary': 'Incluida en el informe diario por correo',
};

export const fixedDetail = (t: string, tr: Tr) => tr(FIXED_TARGETS[t] ?? '', FIXED_ES[t] ?? FIXED_TARGETS[t] ?? '');

/** "WhatsApp", "Email" / "Correo", "Voice call" / "Llamada de voz", "Wheelhouse display". */
export function channelName(c: RecipientChannel, tr: Tr): string {
  switch (c) {
    case 'whatsapp':
      return 'WhatsApp';
    case 'sms':
      return 'SMS';
    case 'email':
      return tr('Email', 'Correo');
    case 'call':
      return tr('Voice call', 'Llamada de voz');
    case 'display':
      return tr('Wheelhouse display', 'Pantalla del puente');
  }
}

/** Short form for chips: "Call" / "Llamada". */
export const channelChip = (c: RecipientChannel, tr: Tr) => (c === 'call' ? tr('Call', 'Llamada') : channelName(c, tr));

const channelWord = (c: ChannelId, tr: Tr) =>
  c === 'email' ? tr('email', 'correo') : c === 'call' ? tr('voice call', 'llamada de voz') : channelName(c, tr);

/** "WhatsApp, SMS and voice call" / "WhatsApp, SMS y llamada de voz" */
export function joinChannels(ids: ChannelId[], tr: Tr): string {
  const w = ids.map((id) => channelWord(id, tr));
  if (!w.length) return '';
  const s = w.length === 1 ? w[0] : `${w.slice(0, -1).join(', ')}${tr(' and ', ' y ')}${w[w.length - 1]}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "Not acknowledged in 5 min" / "Sin confirmar en 5 min" */
export function whenText(s: Pick<Step, 'when' | 'minutes'>, tr: Tr): string {
  switch (s.when) {
    case 'onboard':
      return tr('At once, on board', 'De inmediato, a bordo');
    case 'now':
      return tr('At once, ashore', 'De inmediato, en tierra');
    case 'after':
      return tr(`Not acknowledged in ${s.minutes} min`, `Sin confirmar en ${s.minutes} min`);
    case 'unreviewed':
      return tr(`Unreviewed for ${s.minutes} min`, `Sin revisar durante ${s.minutes} min`);
    case 'summary':
      return tr('Next daily summary', 'Próximo resumen diario');
  }
}

/** Options of the "When" select in the ladder editor. */
export function whenOption(v: StepWhen, tr: Tr): string {
  if (v === 'after') return tr('Not acknowledged in …', 'Sin confirmar en …');
  if (v === 'unreviewed') return tr('Unreviewed for …', 'Sin revisar durante …');
  return whenText({ when: v, minutes: 0 }, tr);
}

/** The line under a step: channels, digest, extra note, or what a fixed target does. */
export function stepDetailText(s: Step, tr: Tr): string {
  if (FIXED_TARGETS[s.target]) return fixedDetail(s.target, tr);
  if (!s.channels.length) return tr('In the console queue, no message', 'En la cola de la consola, sin mensaje');
  return `${joinChannels(s.channels, tr)}${s.digest ? tr(' digest', ' en resumen') : ''}${s.extra ? ` · ${s.extra}` : ''}`;
}

export function shiftName(s: Shift, tr: Tr): string {
  switch (s) {
    case 'Day shift':
      return tr('Day shift', 'Turno de día');
    case 'Night shift':
      return tr('Night shift', 'Turno de noche');
    case 'On call':
      return tr('On call', 'De guardia');
    default:
      return tr('No shift', 'Sin turno');
  }
}

export const hoursName = (h: string, tr: Tr) => (h === 'On-call rota' ? tr('On-call rota', 'Rota de guardia') : h);

const WEEKDAY_ES: Record<string, string> = { Mon: 'lun', Tue: 'mar', Wed: 'mié', Thu: 'jue', Fri: 'vie', Sat: 'sáb', Sun: 'dom' };

/** Rota day label "Mon 12" / "lun 12". */
export function dayLabel(label: string, tr: Tr): string {
  const [wd, n] = label.split(' ');
  return tr(label, `${WEEKDAY_ES[wd] ?? wd} ${n}`);
}

/** The directory role behind a recipient role, for picking people. */
export const RECIPIENT_ROLE_ID: Record<string, RoleId | undefined> = {
  'Duty officer': 'duty_officer',
  'Operations manager': 'ops_manager',
  'Fleet superintendent': 'fleet_super',
  'Safety administrator': 'safety_admin',
  Master: 'master',
  'GFSA management': undefined,
};
