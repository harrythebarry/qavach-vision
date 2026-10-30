import { channelById, type ChannelId, type Step } from '../data/routing';
import type { Alarm } from '../data/types';
import { readSaved } from '../lib/persist';
import { escalationSteps, routingStore } from './routingStore';

// Channels turned off on Integrations send nothing (WhatsApp, SMS, email, voice call).
const INTEGRATION_FOR: Record<ChannelId, string> = { whatsapp: 'whatsapp', sms: 'sms', email: 'email', call: 'voice' };

/** Splits a step's channels into those that can send now and those turned off on Integrations. */
export function splitChannels(ids: ChannelId[]): { on: ChannelId[]; off: ChannelId[] } {
  const states = readSaved<Record<string, { enabled?: boolean }>>('integrations.state') ?? {};
  const on = ids.filter((id) => states[INTEGRATION_FOR[id]]?.enabled !== false);
  return { on, off: ids.filter((id) => !on.includes(id)) };
}

/** "WhatsApp and SMS sent to the duty officer" / "Aviso por WhatsApp y SMS al oficial de guardia", noting channels that are off. */
export function deliveryText(ids: ChannelId[], target: string): { en: string; es: string; sent: boolean } {
  const { on, off } = splitChannels(ids);
  const offEn = off.length ? ` (${joinEn(off)} off on Integrations)` : '';
  const offEs = off.length ? ` (${joinEs(off)} apagado en Integraciones)` : '';
  if (!on.length && ids.length) {
    return {
      en: `nothing sent to the ${target.toLowerCase()}: ${joinEn(off)} turned off on Integrations`,
      es: `no se envió nada ${toRoleEs(target)}: ${joinEs(off)} apagado en Integraciones`,
      sent: false,
    };
  }
  return { en: `${joinEn(on)} sent to the ${target.toLowerCase()}${offEn}`, es: `aviso por ${joinEs(on)} ${toRoleEs(target)}${offEs}`, sent: true };
}

// ALM-03 / RT-01: escalate an alarm along the saved ladder for its priority.
// Timers count from `escalationBase` (the moment the alarm reached shore).
// Shared by the live engine (timer runs out) and "Escalate now".

const ROLE_ES: Record<string, string> = {
  'Duty officer': 'el oficial de guardia',
  'Operations manager': 'el gerente de operaciones',
  'Fleet superintendent': 'el superintendente de flota',
  'Safety administrator': 'el administrador de seguridad',
  'GFSA management on call': 'la gerencia de GFSA de guardia',
};

const CHANNEL_ES: Record<ChannelId, string> = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'correo', call: 'llamada de voz' };

const joinEn = (ids: ChannelId[]) => {
  const w = ids.map((id) => channelById(id).word);
  return w.length <= 1 ? (w[0] ?? 'console') : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`;
};
const joinEs = (ids: ChannelId[]) => {
  const w = ids.map((id) => CHANNEL_ES[id]);
  return w.length <= 1 ? (w[0] ?? 'consola') : `${w.slice(0, -1).join(', ')} y ${w[w.length - 1]}`;
};

export const roleEs = (role: string) => ROLE_ES[role] ?? role;

/** "al oficial de guardia", "a la gerencia de GFSA de guardia" (a + el contracts to al). */
export const toRoleEs = (role: string) => {
  const r = roleEs(role);
  return r.startsWith('el ') ? `al ${r.slice(3)}` : `a ${r}`;
};

export interface EscalationResult {
  alarm: Alarm;
  /** Who was messaged now, if anyone. */
  sent?: { target: string; channels: ChannelId[]; en: string; es: string };
}

/** The next step on the ladder that has not been messaged yet. */
export function nextStep(a: Alarm): Step | undefined {
  const done = new Set(a.escalatedTo ?? []);
  return escalationSteps(a.priority).find((s) => !done.has(s.target));
}

/** When the next step fires (ISO), or undefined when the ladder is used up. */
export function nextEscalationAt(a: Alarm, step = nextStep(a)): string | undefined {
  if (!step) return undefined;
  const base = new Date(a.escalationBase ?? a.raisedAt).getTime();
  return new Date(base + step.minutes * 60_000).toISOString();
}

/**
 * Messages the next step now and points the alarm at the step after it.
 * `manual` is "Escalate now" by a person; otherwise the timer ran out.
 */
export function escalate(a: Alarm, nowIso: string, manual?: { by: string }): EscalationResult {
  const step = nextStep(a);
  if (!step) return { alarm: { ...a, escalatesAt: undefined, escalatesTo: undefined } };
  const escalatedTo = [...(a.escalatedTo ?? []), step.target];
  const after = { ...a, escalatedTo };
  const following = nextStep(after);
  let nextAt = nextEscalationAt(after, following);
  // After a manual escalation the next timer never fires in the past.
  if (nextAt && new Date(nextAt).getTime() <= new Date(nowIso).getTime()) {
    nextAt = new Date(new Date(nowIso).getTime() + 60_000).toISOString();
  }
  const d = deliveryText(step.channels, step.target);
  const en = manual ? `Escalated now by ${manual.by}: ${d.en}` : `Not acknowledged ashore in ${step.minutes} min: ${d.en}`;
  const es = manual ? `Escalada ahora por ${manual.by}: ${d.es}` : `Sin confirmación en tierra en ${step.minutes} min: ${d.es}`;
  return {
    alarm: {
      ...after,
      escalatesAt: nextAt,
      escalatesTo: following?.target,
      activity: [...a.activity, { at: nowIso, text: en, textEs: es, actor: manual ? manual.by : 'Alert routing' }],
    },
    sent: { target: step.target, channels: step.channels, en, es },
  };
}

/** Sets the escalation clock on a new alarm that just reached shore. */
export function startEscalation(a: Alarm, receivedAshoreIso: string): Alarm {
  const config = routingStore.get();
  const first = config.ladders[a.priority].find((s) => s.when === 'now');
  const withBase: Alarm = { ...a, escalationBase: receivedAshoreIso, escalatedTo: first && first.channels.length ? [first.target] : [], reminders: 0 };
  const step = nextStep(withBase);
  return { ...withBase, escalatesAt: nextEscalationAt(withBase, step), escalatesTo: step?.target };
}

/** RT-03: the first shore recipient and its channels, for reminder messages. */
export function firstRecipient(a: Alarm): Step | undefined {
  return routingStore.get().ladders[a.priority].find((s) => s.when === 'now' && s.channels.length > 0);
}

export const channelsText = { en: joinEn, es: joinEs };
