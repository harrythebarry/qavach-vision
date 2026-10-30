import { createStore, uid, useStore } from '../lib/persist';
import { POLICIES, TEAMS, USERS, seedAlerts, seedCameras, seedRules, seedWalls, AREAS } from '../data/seed';
import type { ActivityEntry, Alert, Camera, Policy, QavachRecord, QavachRecordType, Rule, User, Wall } from '../data/types';

// Shared state for every screen. Seed times are relative to the first time the
// prototype opens, so the sample alerts always look recent.

const startedAt = createStore<number>('startedAt', () => Date.now());
const T0 = startedAt.get();

export const cameraStore = createStore<Camera[]>('cameras', () => seedCameras(T0));
export const ruleStore = createStore<Rule[]>('rules', () => seedRules(cameraStore.get(), T0));
export const alertStore = createStore<Alert[]>('alerts', () => seedAlerts(T0));
export const wallStore = createStore<Wall[]>('walls', () => seedWalls(cameraStore.get()));
export const policyStore = createStore<Policy[]>('policies', () => POLICIES);
export const sessionStore = createStore<{ userId: string; live: boolean }>('session', { userId: 'u-priya', live: true });
const counters = createStore<{ alert: number; Incident: number; Observation: number; 'Near miss': number }>('counters', {
  alert: 1042,
  Incident: 413,
  Observation: 1260,
  'Near miss': 188,
});

/** Live people/vehicle counts per camera, from the engine. Memory only. */
export const activityStore = createStore<Record<string, number>>('activity', {}, { persist: false });

export const useCameras = () => useStore(cameraStore);
export const useRules = () => useStore(ruleStore);
export const useAlerts = () => useStore(alertStore);
export const useWalls = () => useStore(wallStore);
export const usePolicies = () => useStore(policyStore);
export const useSession = () => useStore(sessionStore);
export const useActivity = () => useStore(activityStore);

export const TEAMS_BY_ID = Object.fromEntries(TEAMS.map((t) => [t.id, t]));
export const USERS_BY_ID = Object.fromEntries(USERS.map((u) => [u.id, u]));
export const AREAS_BY_ID = Object.fromEntries(AREAS.map((a) => [a.id, a]));

export const userName = (id?: string) => (id === 'system' ? 'System' : id ? (USERS_BY_ID[id]?.name ?? id) : '');

export function useMe(): User {
  const { userId } = useSession();
  return USERS_BY_ID[userId] ?? USERS[0];
}

export const isAdmin = (u: User) => u.role === 'Safety admin';

/** A role name inside a sentence: lower case, but HSE stays HSE. */
export const roleText = (r: string) => r.toLowerCase().replace('hse', 'HSE');

export const teamOfCamera = (cam: Camera) => TEAMS.find((t) => t.id !== 't-hse' && t.areaIds.includes(cam.areaId))?.id ?? 't-hse';

/** People of a role who look after a camera's area: its team first, otherwise anyone with that role. */
export function peopleFor(role: string, cam: Camera): User[] {
  const team = teamOfCamera(cam);
  const inTeam = USERS.filter((u) => u.role === role && u.teamId === team);
  return inTeam.length ? inTeam : USERS.filter((u) => u.role === role);
}

// ── Toasts (memory only) ──────────────────────────────────────────
export interface Toast {
  id: string;
  text: string;
  tone?: 'alert';
  link?: string;
}
export const toastStore = createStore<Toast[]>('toasts', [], { persist: false });
export function toast(text: string, opts: { tone?: 'alert'; link?: string } = {}) {
  const t = { id: uid('t'), text, ...opts };
  toastStore.set((s) => [...s.slice(-3), t]);
  window.setTimeout(() => toastStore.set((s) => s.filter((x) => x.id !== t.id)), opts.tone ? 9000 : 4500);
}

// ── Alerts ────────────────────────────────────────────────────────
function patch(id: string, fn: (a: Alert) => Alert) {
  alertStore.set((list) => list.map((a) => (a.id === id ? fn(a) : a)));
}
const note = (a: Alert, e: ActivityEntry): Alert => ({ ...a, activity: [...a.activity, e] });

export function nextAlertId() {
  let n = 0;
  counters.set((c) => {
    n = c.alert;
    return { ...c, alert: c.alert + 1 };
  });
  return `ALT-${n}`;
}

export function nextQavachRef(type: QavachRecordType) {
  let n = 0;
  counters.set((c) => {
    n = c[type];
    return { ...c, [type]: c[type] + 1 };
  });
  const p = type === 'Incident' ? 'INC' : type === 'Observation' ? 'OBS' : 'NM';
  return `${p}-26-${String(n).padStart(4, '0')}`;
}

export function addAlert(a: Alert) {
  alertStore.set((list) => [a, ...list]);
}

export function acknowledge(id: string, by: string, via: Alert['ackVia'], text?: string) {
  patch(id, (a) =>
    note(
      { ...a, state: 'acknowledged', ackBy: by, ackAt: Date.now(), ackVia: via },
      { at: Date.now(), actor: by, text: `Acknowledged ${via === 'mobile' ? 'on the phone' : via === 'wall' ? 'on the video wall' : 'in the console'}${text ? ` · "${text}"` : ''}` },
    ),
  );
}

export function raiseInQavach(id: string, rec: Omit<QavachRecord, 'ref' | 'at'>) {
  const ref = nextQavachRef(rec.type);
  patch(id, (a) =>
    note({ ...a, qavach: { ...rec, ref, at: Date.now() } }, { at: Date.now(), actor: rec.createdBy, text: `${rec.type} ${ref} raised in Qavach` }),
  );
  return ref;
}

export function assign(id: string, to: string, by: string) {
  patch(id, (a) => note({ ...a, assignee: to }, { at: Date.now(), actor: by, text: `Assigned to ${userName(to)}` }));
}

export function escalate(id: string, to: string, by: string, reason: string) {
  patch(id, (a) =>
    note(
      {
        ...a,
        state: a.state === 'new' ? 'escalated' : a.state,
        escalatedTo: to,
        deliveries: [...a.deliveries, { at: Date.now(), to, channel: 'push', status: 'delivered', reason: 'escalation' }, { at: Date.now(), to, channel: 'call', status: 'sent', reason: 'escalation' }],
      },
      { at: Date.now(), actor: by, text: `Escalated to ${userName(to)} · ${reason}` },
    ),
  );
}

export function resolve(id: string, by: string, text: string) {
  patch(id, (a) => note({ ...a, state: 'resolved' }, { at: Date.now(), actor: by, text: `Resolved${text ? ` · ${text}` : ''}` }));
}

export function markFalse(id: string, by: string, text: string) {
  patch(id, (a) =>
    note({ ...a, state: 'false-alarm', ackBy: a.ackBy ?? by, ackAt: a.ackAt ?? Date.now() }, { at: Date.now(), actor: by, text: `Marked as a false alarm${text ? ` · ${text}` : ''}` }),
  );
}

export function addDeliveries(id: string, d: Alert['deliveries'], entry?: ActivityEntry) {
  patch(id, (a) => {
    const next = { ...a, deliveries: [...a.deliveries, ...d] };
    return entry ? note(next, entry) : next;
  });
}

export const isOpen = (a: Alert) => a.state === 'new' || a.state === 'escalated';

// ── Cameras, rules, walls, policies ───────────────────────────────
export function saveCamera(cam: Camera) {
  cameraStore.set((list) => (list.some((c) => c.id === cam.id) ? list.map((c) => (c.id === cam.id ? cam : c)) : [...list, cam]));
}
export function removeCamera(id: string) {
  cameraStore.set((list) => list.filter((c) => c.id !== id));
  ruleStore.set((list) => list.map((r) => ({ ...r, cameraIds: r.cameraIds.filter((c) => c !== id), zoneIds: r.zoneIds.filter((z) => !z.startsWith(`${id}-`)) })));
  wallStore.set((list) => list.map((w) => ({ ...w, pinned: w.pinned.map((p) => (p === id ? null : p)), rotation: w.rotation.filter((c) => c !== id) })));
}
export function saveRule(rule: Rule) {
  ruleStore.set((list) => (list.some((r) => r.id === rule.id) ? list.map((r) => (r.id === rule.id ? rule : r)) : [...list, rule]));
}
export function deleteRule(id: string) {
  ruleStore.set((list) => list.filter((r) => r.id !== id));
}
export function saveWall(wall: Wall) {
  wallStore.set((list) => (list.some((w) => w.id === wall.id) ? list.map((w) => (w.id === wall.id ? wall : w)) : [...list, wall]));
}
export function deleteWall(id: string) {
  wallStore.set((list) => list.filter((w) => w.id !== id));
}
export function savePolicies(p: Policy[]) {
  policyStore.set(() => p);
}

export function nextRuleId(rules: Rule[]) {
  const n = rules.reduce((m, r) => Math.max(m, Number(r.id.replace(/\D/g, '')) || 0), 0) + 1;
  return `R-${String(n).padStart(2, '0')}`;
}
