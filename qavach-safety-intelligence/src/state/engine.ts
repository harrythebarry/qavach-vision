import { useEffect } from 'react';
import { draftRecord } from '../lib/qai';
import { hm } from '../lib/time';
import type { Alert, Camera, Delivery, Policy, Rule, Zone } from '../data/types';
import {
  acknowledge,
  activityStore,
  addAlert,
  addDeliveries,
  alertStore,
  AREAS_BY_ID,
  cameraStore,
  escalate,
  nextAlertId,
  peopleFor,
  policyStore,
  raiseInQavach,
  ruleStore,
  sessionStore,
  toast,
  userName,
} from './store';

// Stands in for the event service and the notification service. It raises
// alerts from the live rules, follows the saved notification policy for each
// alert level (who is told, on which channel, reminders, escalation when no
// one acknowledges in time) and has supervisors acknowledge some alerts from
// their phones. Screens react to the stores it writes.

const SEC = 1000;
const LEADER_KEY = 'qsi.v1.engine.leader';
const me = Math.random().toString(36).slice(2);

/** Only one window generates events; the others follow through storage events. */
function isLeader(now: number) {
  try {
    const raw = window.localStorage.getItem(LEADER_KEY);
    const cur = raw ? (JSON.parse(raw) as { id: string; ts: number }) : null;
    if (!cur || cur.id === me || now - cur.ts > 4 * SEC) {
      window.localStorage.setItem(LEADER_KEY, JSON.stringify({ id: me, ts: now }));
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

const BASE_ACTIVITY: Record<string, number> = { quay: 7, deck: 5, yard: 2, reefer: 2, gate: 6, workshop: 3, hazmat: 1, perimeter: 1 };
const WEIGHT: Record<string, number> = { P1: 1, P2: 3, P3: 3, P4: 2 };
const MAX_OPEN = 6;

export function scheduleActive(rule: Rule, now: number) {
  const h = new Date(now).getHours();
  if (rule.schedule === 'night') return h >= 18 || h < 6;
  if (rule.schedule === 'day') return h >= 6 && h < 18;
  return true;
}

function centroid(z: Zone): [number, number] {
  const n = z.points.length;
  return [z.points.reduce((s, p) => s + p[0], 0) / n, z.points.reduce((s, p) => s + p[1], 0) / n];
}

function boxFor(rule: Rule, zone: Zone | undefined): [number, number, number, number] {
  let [x, y] = zone ? centroid(zone) : [30 + Math.random() * 40, 62 + Math.random() * 20];
  if (zone && rule.condition === 'outside') {
    const xs = zone.points.map((p) => p[0]);
    const w = Math.max(...xs) - Math.min(...xs);
    x = x + (x > 50 ? -1 : 1) * (w * 0.45 + 6);
    y = Math.min(92, y + 6);
  }
  if (zone && zone.kind === 'polygon' && rule.condition !== 'outside') y = Math.min(94, y + 8);
  if (rule.condition === 'smoke') return [x - 8, y - 26, 16, 26];
  const h = 7 + y * 0.17;
  const w = rule.subject === 'vehicle' ? h * 2.4 : h * 0.34;
  const clampX = Math.min(98 - w, Math.max(2, x - w / 2));
  return [round(clampX), round(Math.max(2, y - h)), round(w), round(h)];
}
const round = (n: number) => Math.round(n * 10) / 10;

function alertText(rule: Rule, zone: Zone | undefined): { title: string; detail: string } {
  const seen = rule.durationSec + 1 + Math.floor(Math.random() * 5);
  const zn = zone?.name ?? 'the camera view';
  const need = rule.durationSec > 0 ? ` (rule: ${rule.durationSec} s or more)` : '';
  switch (rule.condition) {
    case 'outside':
      return { title: rule.name, detail: `Outside ${zn} for ${seen} s${need}` };
    case 'enters':
      return { title: rule.name, detail: `Inside ${zn} for ${seen} s${need}` };
    case 'dwells':
      return { title: rule.name, detail: `Stayed in ${zn} for ${seen} s${need}` };
    case 'crosses':
      return { title: rule.name, detail: `Crossed ${zn}` };
    case 'no-ppe':
      return { title: rule.name, detail: `${rule.ppe.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' and ')} not seen for ${seen} s${need}` };
    case 'crowd':
      return { title: rule.name, detail: `${rule.crowdOver + 1 + Math.floor(Math.random() * 3)} people in ${zn} for ${seen} s` };
    case 'smoke':
      return { title: rule.name, detail: `Smoke seen in ${zn} for ${seen} s${need}` };
    case 'stopped':
      return { title: rule.name, detail: `Vehicle stopped ${seen} s in ${zn}${need}` };
  }
}

export function deliveriesFor(policy: Policy, cam: Camera, at: number): Delivery[] {
  const out: Delivery[] = [];
  if (policy.channels.includes('wall')) for (const u of peopleFor('Control room operator', cam)) out.push({ at, to: u.id, channel: 'wall', status: 'delivered', reason: 'alert' });
  for (const role of policy.notify)
    for (const u of peopleFor(role, cam))
      for (const ch of policy.channels) if (ch !== 'wall') out.push({ at, to: u.id, channel: ch, status: ch === 'call' ? 'sent' : 'delivered', reason: 'alert' });
  return out;
}

/** Raises one alert for a rule on a camera (used by the engine and by "Test on the wall"). */
export function raiseFor(rule: Rule, cam: Camera, opts: { quiet?: boolean } = {}): Alert {
  const now = Date.now();
  const zones = cam.zones.filter((z) => rule.zoneIds.includes(z.id));
  const zone = zones[Math.floor(Math.random() * zones.length)];
  const policy = policyStore.get().find((p) => p.priority === rule.priority)!;
  const { title, detail } = alertText(rule, zone);
  const alert: Alert = {
    id: nextAlertId(),
    ruleId: rule.id,
    cameraId: cam.id,
    zoneId: zone?.id,
    priority: rule.priority,
    title,
    detail,
    at: now,
    state: 'new',
    box: boxFor(rule, zone),
    confidence: 0.82 + Math.random() * 0.16,
    deliveries: deliveriesFor(policy, cam, now),
    activity: [{ at: now, text: 'Detected by the edge model', actor: 'system' }],
  };
  addAlert(alert);
  if (!opts.quiet) toast(`${alert.priority} · ${title} · ${cam.id} ${cam.name}`, { tone: alert.priority === 'P1' || alert.priority === 'P2' ? 'alert' : undefined, link: `/alerts/${alert.id}` });
  return alert;
}

function generate(now: number) {
  const cams = cameraStore.get();
  const camById = new Map(cams.map((c) => [c.id, c]));
  const openNow = alertStore.get().filter((a) => a.state === 'new' || a.state === 'escalated');
  // Keep the demo readable: no new alerts while plenty are still waiting.
  if (openNow.length >= MAX_OPEN) return;
  const busy = new Set(openNow.map((a) => a.cameraId));
  const live = ruleStore.get().filter((r) => r.mode === 'live' && r.cameraIds.length && scheduleActive(r, now));
  const pool = live.flatMap((r) => Array.from({ length: WEIGHT[r.priority] }, () => r));
  for (let tries = 0; tries < 6 && pool.length; tries++) {
    const rule = pool[Math.floor(Math.random() * pool.length)];
    const options = rule.cameraIds.map((id) => camById.get(id)).filter((c): c is Camera => !!c && c.status !== 'offline' && !busy.has(c.id));
    if (!options.length) continue;
    raiseFor(rule, options[Math.floor(Math.random() * options.length)]);
    return;
  }
}

function followUp(now: number) {
  const policies = new Map(policyStore.get().map((p) => [p.priority, p]));
  const cams = new Map(cameraStore.get().map((c) => [c.id, c]));
  const rules = new Map(ruleStore.get().map((r) => [r.id, r]));
  for (const a of alertStore.get()) {
    if (a.state !== 'new' && a.state !== 'escalated') continue;
    const p = policies.get(a.priority);
    const cam = cams.get(a.cameraId);
    if (!p || !cam) continue;
    const age = now - a.at;

    // Escalate when no one acknowledges in time.
    if (a.state === 'new' && p.escalateTo !== 'none' && age > p.ackWithinMin * 60 * SEC) {
      const to = peopleFor(p.escalateTo, cam)[0];
      if (to) {
        escalate(a.id, to.id, 'system', `not acknowledged within ${p.ackWithinMin} min`);
        toast(`${a.id} escalated to ${to.name} (${to.role})`, { tone: 'alert', link: `/alerts/${a.id}` });
      }
      continue;
    }

    // Reminders to the people told first, three at most.
    if (p.remindEveryMin > 0) {
      const reminders = a.deliveries.filter((d) => d.reason === 'reminder');
      const sent = new Set(reminders.map((d) => d.at)).size;
      const last = Math.max(a.at, ...reminders.map((d) => d.at));
      if (sent < 3 && now - last >= p.remindEveryMin * 60 * SEC) {
        const to = p.notify.flatMap((role) => peopleFor(role, cam));
        addDeliveries(
          a.id,
          to.map((u) => ({ at: now, to: u.id, channel: 'push' as const, status: 'delivered' as const, reason: 'reminder' as const })),
          { at: now, actor: 'system', text: `Reminder ${sent + 1} of 3 sent to ${to.map((u) => u.name).join(', ')}` },
        );
      }
    }

    // A supervisor acknowledges some medium and high alerts from the phone.
    const n = Number(a.id.replace(/\D/g, ''));
    if (a.state === 'new' && (a.priority === 'P2' || a.priority === 'P3') && n % 2 === 1 && n > 1042 && age > 150 * SEC) {
      const sup = peopleFor('Shift supervisor', cam)[0];
      if (!sup) continue;
      acknowledge(a.id, sup.id, 'mobile', 'On my way');
      const rule = rules.get(a.ruleId);
      if (p.qavach === 'on-acknowledge' && rule && rule.qavach !== 'none') {
        const d = draftRecord(a, cam, rule, AREAS_BY_ID[cam.areaId], hm(a.at));
        const ref = raiseInQavach(a.id, { ...d, createdBy: sup.id, source: 'mobile' });
        toast(`${userName(sup.id)} acknowledged ${a.id} on the phone · ${ref} raised in Qavach`, { link: `/alerts/${a.id}` });
      } else toast(`${userName(sup.id)} acknowledged ${a.id} on the phone`, { link: `/alerts/${a.id}` });
    }
  }
}

function updateActivity() {
  const prev = activityStore.get();
  const next: Record<string, number> = {};
  for (const c of cameraStore.get()) {
    if (c.status === 'offline') {
      next[c.id] = 0;
      continue;
    }
    const base = BASE_ACTIVITY[c.areaId] ?? 2;
    const cur = prev[c.id] ?? Math.round(base * (0.4 + ((c.variant * 37) % 10) / 8));
    const drift = Math.round((Math.random() - 0.5) * 3);
    next[c.id] = Math.max(0, Math.min(base * 2 + 4, cur + drift + (cur < base / 2 ? 1 : 0)));
  }
  activityStore.set(() => next);
}

/** Mount once per window. */
export function useEngine() {
  useEffect(() => {
    let nextAt = Date.now() + 15 * SEC;
    let tick = 0;
    updateActivity();
    const t = window.setInterval(() => {
      const now = Date.now();
      tick++;
      if (tick % 4 === 0) updateActivity();
      if (!sessionStore.get().live || !isLeader(now)) return;
      if (now >= nextAt) {
        generate(now);
        nextAt = now + (45 + Math.random() * 30) * SEC;
      }
      followUp(now);
    }, SEC);
    return () => window.clearInterval(t);
  }, []);
}
