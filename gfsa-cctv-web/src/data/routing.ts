import { uid } from '../lib/persist';
import type { Priority } from './types';

// Local sample configuration for the Alert routing screen (RT-01 to RT-05).

export type ChannelId = 'whatsapp' | 'sms' | 'email' | 'call';

export const CHANNELS: { id: ChannelId; label: string; chip: string; word: string }[] = [
  { id: 'whatsapp', label: 'WhatsApp', chip: 'WhatsApp', word: 'WhatsApp' },
  { id: 'sms', label: 'SMS', chip: 'SMS', word: 'SMS' },
  { id: 'email', label: 'Email', chip: 'Email', word: 'email' },
  { id: 'call', label: 'Voice call', chip: 'Call', word: 'voice call' },
];

export const channelById = (id: ChannelId) => CHANNELS.find((c) => c.id === id)!;

/** "WhatsApp, SMS and voice call" */
export function joinChannels(ids: ChannelId[]): string {
  const words = ids.map((id) => channelById(id).word);
  if (!words.length) return '';
  const s = words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- RT-01 escalation ladder ----------

export type StepWhen = 'onboard' | 'now' | 'after' | 'unreviewed' | 'summary';

export const WHEN_OPTIONS: { value: StepWhen; label: string }[] = [
  { value: 'onboard', label: 'At once, on board' },
  { value: 'now', label: 'At once, ashore' },
  { value: 'after', label: 'Not acknowledged in …' },
  { value: 'unreviewed', label: 'Unreviewed for …' },
  { value: 'summary', label: 'Next daily summary' },
];

export interface Step {
  id: string;
  when: StepWhen;
  minutes: number;
  target: string;
  channels: ChannelId[];
  /** Sent as a digest rather than one message per alarm. */
  digest?: boolean;
  /** Extra note shown after the channels, e.g. "24 h". */
  extra?: string;
}

/** Targets that do not take messages; their channel is fixed. */
export const FIXED_TARGETS: Record<string, string> = {
  'Wheelhouse display': 'Screen and buzzer, works without the link',
  'Wheelhouse list': 'On the display list, no buzzer',
  'Console only': 'Listed in the alarm console, no message',
  'Daily summary': 'Included in the daily report by email',
};

export const MESSAGE_TARGETS = [
  'Duty officer',
  'Operations manager',
  'Fleet superintendent',
  'Safety administrator',
  'GFSA management on call',
];

export const ALL_TARGETS = [...Object.keys(FIXED_TARGETS), ...MESSAGE_TARGETS];

export function whenLabel(s: Step): string {
  switch (s.when) {
    case 'onboard':
      return 'At once, on board';
    case 'now':
      return 'At once, ashore';
    case 'after':
      return `Not acknowledged in ${s.minutes} min`;
    case 'unreviewed':
      return `Unreviewed for ${s.minutes} min`;
    case 'summary':
      return 'Next daily summary';
  }
}

export function stepDetail(s: Step): string {
  if (FIXED_TARGETS[s.target]) return FIXED_TARGETS[s.target];
  if (!s.channels.length) return 'In the console queue, no message';
  return `${joinChannels(s.channels)}${s.digest ? ' digest' : ''}${s.extra ? ` · ${s.extra}` : ''}`;
}


export const newStepId = () => uid('step');

const st = (when: StepWhen, target: string, channels: ChannelId[] = [], minutes = 0, more: Partial<Step> = {}): Step => ({
  id: newStepId(),
  when,
  minutes,
  target,
  channels,
  ...more,
});

export type Ladders = Record<Priority, Step[]>;

export const initialLadders: Ladders = {
  P1: [
    st('onboard', 'Wheelhouse display'),
    st('now', 'Duty officer', ['whatsapp', 'sms', 'call']),
    st('after', 'Operations manager', ['call', 'whatsapp'], 2),
    st('after', 'Fleet superintendent', ['call', 'sms'], 5),
    st('after', 'GFSA management on call', ['sms'], 10),
  ],
  P2: [
    st('onboard', 'Wheelhouse display'),
    st('now', 'Duty officer', ['whatsapp', 'sms'], 0, { extra: '24 h' }),
    st('after', 'Operations manager', ['whatsapp', 'email'], 5),
    st('after', 'Fleet superintendent', ['sms', 'email'], 15),
  ],
  P3: [
    st('onboard', 'Wheelhouse list'),
    st('now', 'Duty officer', []),
    st('unreviewed', 'Operations manager', ['email'], 60, { digest: true }),
  ],
  P4: [st('now', 'Console only'), st('summary', 'Daily summary')],
};

// ---------- RT-02 recipients ----------

export type Shift = '' | 'Day shift' | 'Night shift' | 'On call';
export type RecipientChannel = ChannelId | 'display';

export interface Recipient {
  id: string;
  role: string;
  shift: Shift;
  /** 'all' or a convoy id */
  scope: string;
  p1Only: boolean;
  /** user id, or '' for a rota */
  personId: string;
  rotaLabel?: string;
  channels: RecipientChannel[];
  hours: string;
  phone?: string;
  email?: string;
}

export const RECIPIENT_ROLES = [
  'Duty officer',
  'Operations manager',
  'Fleet superintendent',
  'Safety administrator',
  'Master',
  'GFSA management',
];

export const HOURS_OPTIONS = ['24 h', '07:00–19:00', '19:00–07:00', 'On-call rota'];

export const initialRecipients: Recipient[] = [
  { id: 'r1', role: 'Duty officer', shift: 'Day shift', scope: 'all', p1Only: false, personId: 'u1', channels: ['whatsapp', 'sms', 'call'], hours: '07:00–19:00', phone: '+595 981 ••• 214' },
  { id: 'r2', role: 'Duty officer', shift: 'Night shift', scope: 'all', p1Only: false, personId: 'u2', channels: ['whatsapp', 'sms', 'call'], hours: '19:00–07:00', phone: '+595 982 ••• 377' },
  { id: 'r3', role: 'Operations manager', shift: '', scope: 'all', p1Only: false, personId: 'u3', channels: ['whatsapp', 'email', 'call'], hours: '24 h', phone: '+595 981 ••• 902', email: 'l.ortiz@gfsa.example' },
  { id: 'r4', role: 'Fleet superintendent', shift: '', scope: 'all', p1Only: false, personId: 'u5', channels: ['sms', 'email', 'call'], hours: '24 h', phone: '+595 983 ••• 145', email: 'r.villalba@gfsa.example' },
  { id: 'r5', role: 'Master', shift: '', scope: 'tuy', p1Only: false, personId: 'u11', channels: ['display'], hours: '24 h' },
  { id: 'r6', role: 'Master', shift: '', scope: 'hum', p1Only: false, personId: 'u12', channels: ['display'], hours: '24 h' },
  { id: 'r7', role: 'Master', shift: '', scope: 'boq', p1Only: false, personId: 'u13', channels: ['display'], hours: '24 h' },
  { id: 'r8', role: 'GFSA management', shift: 'On call', scope: 'all', p1Only: true, personId: '', rotaLabel: 'Rota · 2 people', channels: ['sms'], hours: 'On-call rota', phone: '2 numbers' },
];

export type VerifyState = 'verified' | 'bounced' | 'unverified' | 'pending' | 'display' | 'display_off';

export interface Verification {
  state: VerifyState;
  text: string;
}

export const initialVerification: Record<string, Verification> = {
  r1: { state: 'verified', text: 'Number verified 3 Oct' },
  r2: { state: 'verified', text: 'Number verified 3 Oct' },
  r3: { state: 'verified', text: 'Number verified 3 Oct' },
  r4: { state: 'bounced', text: 'Email bounced 9 Oct' },
  r5: { state: 'display', text: 'Display reachable' },
  r6: { state: 'display_off', text: 'Last seen 13:49 · no link' },
  r7: { state: 'display', text: 'Display reachable' },
  r8: { state: 'verified', text: 'Numbers verified 3 Oct' },
};

// ---------- RT-03 rota and delivery rules ----------

export interface RotaDay {
  label: string; // "Mon 12"
  date: number; // day of month, October 2026
  day: string; // user id, 07:00–19:00
  night: string; // user id, 19:00–07:00
}

export const initialRota: RotaDay[] = [
  { label: 'Mon 12', date: 12, day: 'u1', night: 'u2' },
  { label: 'Tue 13', date: 13, day: 'u1', night: 'u2' },
  { label: 'Wed 14', date: 14, day: 'u1', night: 'u2' },
  { label: 'Thu 15', date: 15, day: 'u1', night: 'u2' },
  { label: 'Fri 16', date: 16, day: 'u1', night: 'u2' },
  { label: 'Sat 17', date: 17, day: 'u7', night: 'u2' },
  { label: 'Sun 18', date: 18, day: 'u7', night: 'u2' },
];

export interface Rules {
  language: 'recipient' | 'es' | 'en';
  reminderEvery: number;
  reminderMax: number;
  rateLimit: boolean;
  digestFrom: string;
  digestTo: string;
}

export const initialRules: Rules = {
  language: 'recipient',
  reminderEvery: 2,
  reminderMax: 3,
  rateLimit: true,
  digestFrom: '07:00',
  digestTo: '22:00',
};

// ---------- RT-04 message template ----------

export type TplLang = 'es' | 'en';

export const PLACEHOLDERS: { key: string; label: string }[] = [
  { key: 'priority', label: 'Priority' },
  { key: 'use_case', label: 'Use case' },
  { key: 'vessel', label: 'Vessel' },
  { key: 'camera', label: 'Camera' },
  { key: 'time', label: 'Time' },
  { key: 'onboard_status', label: 'On-board status' },
  { key: 'alarm_id', label: 'Alarm ID' },
  { key: 'link', label: 'Clip link' },
];

export const initialTemplates: Record<TplLang, string> = {
  es: 'ALARMA {priority} · {use_case}\n{vessel} · {camera} · {time} Asunción\n{onboard_status}\nVer clip de 15 s y confirmar: {link}',
  en: 'ALARM {priority} · {use_case}\n{vessel} · {camera} · {time} Asunción\n{onboard_status}\nView the 15 s clip and acknowledge: {link}',
};

/** Values from the open P2 alarm (ALM-26-0318) used for the live preview. */
export const sampleValues: Record<TplLang, Record<string, string>> = {
  es: {
    priority: 'P2 ALTA',
    use_case: 'Chaleco salvavidas ausente cerca del agua',
    vessel: 'Guarán F 503',
    camera: 'Borde de babor',
    time: '14:32',
    onboard_status: 'Confirmada a bordo 14:32. Pendiente de confirmar en tierra.',
    alarm_id: 'ALM-26-0318',
    link: 'cctv.gfsa.example/a/ALM-26-0318',
  },
  en: {
    priority: 'P2 HIGH',
    use_case: 'Life jacket missing near the water',
    vessel: 'Guarán F 503',
    camera: 'Port edge',
    time: '14:32',
    onboard_status: 'Acknowledged on board 14:32. Not yet acknowledged ashore.',
    alarm_id: 'ALM-26-0318',
    link: 'cctv.gfsa.example/a/ALM-26-0318',
  },
};

export const emailSubject: Record<TplLang, string> = {
  es: '[P2] Chaleco salvavidas · Guarán F 503 · 14:32',
  en: '[P2] Life jacket · Guarán F 503 · 14:32',
};

// ---------- RT-05 delivery ----------

export interface DeliveryRow {
  channel: string;
  sent: number;
  delivered: number | null;
  read: number | null;
  failed: number | null;
  median: string;
}

export const delivery7d: DeliveryRow[] = [
  { channel: 'WhatsApp', sent: 142, delivered: 141, read: 128, failed: 1, median: '4 s' },
  { channel: 'SMS', sent: 142, delivered: 140, read: null, failed: 2, median: '9 s' },
  { channel: 'Email', sent: 61, delivered: 61, read: 44, failed: 0, median: '12 s' },
  { channel: 'Voice call', sent: 0, delivered: null, read: null, failed: null, median: '–' },
];

export interface RoutingConfig {
  ladders: Ladders;
  recipients: Recipient[];
  rota: RotaDay[];
  rules: Rules;
  templates: Record<TplLang, string>;
}

export const initialConfig: RoutingConfig = {
  ladders: initialLadders,
  recipients: initialRecipients,
  rota: initialRota,
  rules: initialRules,
  templates: initialTemplates,
};
