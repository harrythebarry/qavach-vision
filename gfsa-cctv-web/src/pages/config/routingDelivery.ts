import { createStore } from '../../lib/persist';
import type { AuditEntry } from '../../data/types';
import type { ChannelId, Recipient, RecipientChannel, TplLang } from '../../data/routing';

// RT-02 / RT-05: contact verification, test alerts and the delivery report.
// Test alerts and verification messages are saved as delivery rows that move
// sent → delivered → read on the channel's usual timings (a bounced email
// fails; a wheelhouse display waits for the convoy's link). Real alerts sent
// by the live engine are read back from the audit log.

// ---------- Contact verification ----------

export type VState = 'verified' | 'bounced' | 'unverified' | 'pending';

export interface VRecord {
  state: VState;
  /** ISO time of the last change. */
  at?: string;
  /** What was verified or bounced. */
  what?: 'number' | 'numbers' | 'email' | 'contact';
}

export const verifyStore = createStore<Record<string, VRecord>>('routing.verification', () => ({
  r1: { state: 'verified', at: '2026-10-03T10:12:00-03:00', what: 'number' },
  r2: { state: 'verified', at: '2026-10-03T10:14:00-03:00', what: 'number' },
  r3: { state: 'verified', at: '2026-10-03T10:20:00-03:00', what: 'number' },
  r4: { state: 'bounced', at: '2026-10-09T08:14:00-03:00', what: 'email' },
  r8: { state: 'verified', at: '2026-10-03T10:31:00-03:00', what: 'numbers' },
}));

// ---------- Delivery rows ----------

export type MsgStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';

export interface DeliveryMsg {
  id: string;
  runId: string;
  channel: RecipientChannel;
  status: MsgStatus;
  /** Scenario ms. */
  queuedAt: number;
  sentAt?: number;
  deliveredAt?: number;
  readAt?: number;
  failedAt?: number;
  /** Planned timings in ms after sending. */
  plan: { deliver: number; read?: number; fail?: number };
  /** Wheelhouse display: held on shore until this convoy has a link. */
  waitConvoy?: string;
  reason?: 'bounced';
}

export interface DeliveryRun {
  id: string;
  kind: 'test' | 'verify';
  recipientId: string;
  to: string;
  role: string;
  lang: TplLang;
  at: number;
  by: string;
  /** The outcome has been written to the audit log. */
  done?: boolean;
}

export interface DeliveryLog {
  runs: DeliveryRun[]; // newest first
  msgs: DeliveryMsg[];
}

export const deliveryStore = createStore<DeliveryLog>('routing.delivery', () => ({ runs: [], msgs: [] }));

const S = 1000;
/** Usual timings per channel: delivered after, read after (ms). */
export const TIMING: Record<RecipientChannel, { deliver: number; read?: number }> = {
  whatsapp: { deliver: 3 * S, read: 12 * S },
  sms: { deliver: 8 * S },
  email: { deliver: 11 * S, read: 20 * S },
  call: { deliver: 6 * S },
  display: { deliver: 2 * S },
};

const terminal = (m: DeliveryMsg) => m.status === 'failed' || m.status === 'read' || (m.status === 'delivered' && m.plan.read === undefined);

export interface Finished {
  run: DeliveryRun;
  msgs: DeliveryMsg[];
}

/** Moves every row along its timings; returns the new log and the runs that just finished. */
export function advance(log: DeliveryLog, now: number, linkUp: (convoyId: string) => boolean): { next: DeliveryLog; finished: Finished[] } {
  let changed = false;
  const msgs = log.msgs.map((m) => {
    if (terminal(m)) return m;
    let x = m;
    if (x.status === 'queued') {
      if (x.waitConvoy && !linkUp(x.waitConvoy)) return m;
      x = { ...x, status: 'sent', sentAt: Math.max(now, x.queuedAt) };
    }
    const sent = x.sentAt ?? x.queuedAt;
    if (x.plan.fail !== undefined) {
      if (now >= sent + x.plan.fail) x = { ...x, status: 'failed', failedAt: sent + x.plan.fail };
    } else {
      if (x.status === 'sent' && now >= sent + x.plan.deliver) x = { ...x, status: 'delivered', deliveredAt: sent + x.plan.deliver };
      if (x.status === 'delivered' && x.plan.read !== undefined && now >= sent + x.plan.read) x = { ...x, status: 'read', readAt: sent + x.plan.read };
    }
    if (x !== m) changed = true;
    return x;
  });
  const finished: Finished[] = [];
  const runs = log.runs.map((r) => {
    if (r.done) return r;
    const mine = msgs.filter((m) => m.runId === r.id);
    if (!mine.length || !mine.every(terminal)) return r;
    changed = true;
    const done = { ...r, done: true };
    finished.push({ run: done, msgs: mine });
    return done;
  });
  return { next: changed ? { runs, msgs } : log, finished };
}

/** Adds a run, keeping the 40 most recent. */
export function addRun(run: DeliveryRun, msgs: DeliveryMsg[]) {
  deliveryStore.set((l) => {
    const runs = [run, ...l.runs].slice(0, 40);
    const keep = new Set(runs.map((r) => r.id));
    return { runs, msgs: [...l.msgs.filter((m) => keep.has(m.runId)), ...msgs] };
  });
}

/** Seconds from sending to the row's latest state. */
export function secsOf(m: DeliveryMsg): number | undefined {
  const sent = m.sentAt;
  if (sent === undefined) return undefined;
  const end = m.failedAt ?? m.readAt ?? m.deliveredAt;
  return end === undefined ? undefined : Math.round((end - sent) / 1000);
}

// ---------- Real alerts from the audit log ----------

export interface AlertMsg {
  channel: ChannelId;
  at: number;
  alarmId: string;
  target: string; // lower case, "duty officer"
  escalation: boolean;
}

/** Messages the alert routing sent since the scenario started, one per channel. */
export function alertMessages(audit: AuditEntry[], since: number): AlertMsg[] {
  const out: AlertMsg[] = [];
  for (const e of audit) {
    if (e.action !== 'Sent alert' && e.action !== 'Sent reminder') continue;
    const at = new Date(e.at).getTime();
    if (at <= since || !e.details) continue;
    const d = e.details;
    const target = (/(?:to|for) the ([a-z ]+?)$/i.exec(d)?.[1] ?? '').toLowerCase();
    const escalation = /^(Not acknowledged ashore|Escalated now)/.test(d);
    const chans: ChannelId[] = [];
    if (/WhatsApp/.test(d)) chans.push('whatsapp');
    if (/\bSMS\b/.test(d)) chans.push('sms');
    if (/\bemail\b/i.test(d)) chans.push('email');
    if (/voice call/i.test(d)) chans.push('call');
    chans.forEach((channel) => out.push({ channel, at, alarmId: e.target, target, escalation }));
  }
  return out;
}

/** Whether email to the people behind a ladder target currently bounces. */
export function emailBounces(target: string, recipients: Recipient[], verify: Record<string, VRecord>): boolean {
  const t = target.replace(/ on call$/, '');
  return recipients.some((r) => r.role.toLowerCase() === t && r.channels.includes('email') && verify[r.id]?.state === 'bounced');
}
