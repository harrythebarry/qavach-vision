import { createStore } from '../lib/persist';
import { scenarioNow } from '../lib/time';
import { voyageById } from '../data/alarms';
import { vessels } from '../data/fleet';
import type { EdgeUnit } from '../data/types';
import type { SystemLog } from './AppState';
import { camStore } from './configStore';
import { convoyStore, unitStore, updateUnit } from './fleetStore';
import { markLive, registryStore, setPending } from './modelRegistry';

// EU-02 / EU-03: model rollout, pipeline restarts and remote diagnostics.
// The state is saved (edge.rollout, edge.ops) and moved along by the live
// engine's tick, so it keeps running when nobody has the Edge units screen open, so a restart
// finishes, a queued diagnostics request runs and waiting units install the
// pushed model as soon as their convoy is back in coverage (the live engine
// brings GF Humaitá back). Unit status and model version are written to the
// shared fleet store, so every screen sees them.

export interface Rollout {
  version: string;
  previous: string | null;
  draft: string | null;
  pushedAt?: number;
  pushedBy?: string;
  /** Units installing now: version and when they confirm (scenario ms). */
  installing: Record<string, { version: string; until: number }>;
}

export const rolloutStore = createStore<Rollout>('edge.rollout', () => ({ version: 'v1.4.2', previous: 'v1.4.1', draft: 'v1.4.3', installing: {} }));

export type DiagTone = 'ok' | 'warn';
export interface DiagLine {
  tone: DiagTone;
  en: string;
  es: string;
}

export interface DiagRun {
  phase: 'queued' | 'running' | 'done';
  requestedAt: number;
  by: string;
  startedAt?: number;
  doneAt?: number;
  results?: DiagLine[];
  /** Health values the unit sent with the bundle. */
  snapshot?: Pick<EdgeUnit, 'status' | 'link' | 'modelVersion' | 'modelConfirmed' | 'storagePct' | 'tempC' | 'gpuPct' | 'inferenceMs' | 'uptimeDays' | 'queue'>;
}

export interface EdgeOps {
  restarts: Record<string, { until: number; by: string }>;
  restartedAt: Record<string, number>;
  diag: Record<string, DiagRun>;
}

export const opsStore = createStore<EdgeOps>('edge.ops', () => ({ restarts: {}, restartedAt: {}, diag: {} }));

export const RESTART_MS = 5000;
export const DIAG_STEPS: [string, string][] = [
  ['Contacting the unit', 'Contactando la unidad'],
  ['Collecting logs', 'Recopilando registros'],
  ['Running GPU self-test', 'Ejecutando autoprueba de GPU'],
  ['Checking camera streams', 'Comprobando las transmisiones de cámara'],
  ['Checking storage and modem', 'Comprobando almacenamiento y módem'],
];
export const DIAG_STEP_MS = 700;
export const DIAG_MS = DIAG_STEP_MS * (DIAG_STEPS.length + 1);

const vesselOf = (u: EdgeUnit) => vessels.find((v) => v.id === u.vesselId);

/** Whether a model can be installed now: in port or on a strong link (EU-02). */
export function reachable(u: EdgeUnit): { ok: boolean; why: [string, string] } {
  const c = convoyStore.get().find((x) => x.id === u.convoyId);
  if (u.status === 'restarting') return { ok: false, why: ['restarting', 'reiniciando'] };
  if (u.status !== 'reporting') return { ok: false, why: ['no link', 'sin enlace'] };
  if (voyageById(c?.voyageId)?.status === 'in_port') return { ok: true, why: ['in port', 'en puerto'] };
  if (c?.link === 'strong') return { ok: true, why: ['strong link', 'enlace fuerte'] };
  return { ok: false, why: ['weak link', 'enlace débil'] };
}

/** What the unit's self-test reports, from its live health values and cameras. */
export function diagnose(u: EdgeUnit): DiagLine[] {
  const cams = camStore.get().cameras.filter((c) => c.edgeUnitId === u.id);
  const bad = cams.filter((c) => c.health !== 'healthy');
  const [kind, ...rest] = u.link.split(' ');
  const lines: DiagLine[] = [
    bad.length
      ? {
          tone: 'warn',
          en: `Cameras: ${cams.length - bad.length} of ${cams.length} clean · ${bad.map((c) => `${c.name} ${c.healthNote?.toLowerCase() ?? c.health}`).join('; ')}`,
          es: `Cámaras: ${cams.length - bad.length} de ${cams.length} limpias · ${bad.map((c) => `${c.name} ${c.healthNote?.toLowerCase() ?? (c.health === 'offline' ? 'sin señal' : 'degradada')}`).join('; ')}`,
        }
      : {
          tone: 'ok',
          en: `Cameras: ${cams.length} of ${cams.length} streams decoding, scene checks passing`,
          es: `Cámaras: ${cams.length} de ${cams.length} transmisiones decodificando, controles de escena correctos`,
        },
    { tone: 'ok', en: `GPU self-test passed · load ${u.gpuPct}% · ${u.inferenceMs} ms per frame`, es: `Autoprueba de GPU correcta · carga ${u.gpuPct}% · ${u.inferenceMs} ms por cuadro` },
    { tone: u.storagePct > 80 ? 'warn' : 'ok', en: `NVMe health good · ${u.storagePct}% used`, es: `NVMe en buen estado · ${u.storagePct}% usado` },
    { tone: u.tempC >= 70 ? 'warn' : 'ok', en: `Temperature ${u.tempC} °C · throttles at 80 °C`, es: `Temperatura ${u.tempC} °C · se limita a 80 °C` },
    { tone: 'ok', en: `${kind} modem · signal −87 dBm · ${rest.join(' ')} up`, es: `Módem ${kind} · señal −87 dBm · ${rest.join(' ')} de subida` },
    { tone: 'ok', en: 'Clock in sync · offset 12 ms', es: 'Reloj sincronizado · desfase 12 ms' },
    { tone: 'ok', en: 'Unit certificate valid until 3 Mar 2027', es: 'Certificado de la unidad válido hasta el 3 mar 2027' },
  ];
  if (vesselOf(u)?.kind === 'tug')
    lines.push({ tone: 'ok', en: 'Wheelhouse display connected · buzzer test passed', es: 'Pantalla del puente conectada · prueba de alarma sonora correcta' });
  if (!u.modelConfirmed)
    lines.push({ tone: 'warn', en: `Model ${u.modelVersion} not yet confirmed`, es: `Modelo ${u.modelVersion} aún sin confirmar` });
  return lines;
}

const snapshotOf = (u: EdgeUnit): DiagRun['snapshot'] => ({
  status: u.status,
  link: u.link,
  modelVersion: u.modelVersion,
  modelConfirmed: u.modelConfirmed,
  storagePct: u.storagePct,
  tempC: u.tempC,
  gpuPct: u.gpuPct,
  inferenceMs: u.inferenceMs,
  uptimeDays: u.uptimeDays,
  queue: { ...u.queue },
});

/** Starts diagnostics on a unit with a link, or queues them on shore. */
export function requestDiagnostics(u: EdgeUnit, by: string) {
  const now = scenarioNow();
  const run: DiagRun =
    u.status === 'reporting'
      ? { phase: 'running', requestedAt: now, by, startedAt: now, results: diagnose(u), snapshot: snapshotOf(u) }
      : { phase: 'queued', requestedAt: now, by };
  opsStore.set((o) => ({ ...o, diag: { ...o.diag, [u.id]: run } }));
  return run.phase;
}

export function startRestart(u: EdgeUnit, by: string) {
  const until = scenarioNow() + RESTART_MS;
  updateUnit(u.id, { status: 'restarting', statusNote: 'Pipeline restart' });
  opsStore.set((o) => ({ ...o, restarts: { ...o.restarts, [u.id]: { until, by } } }));
  tick();
}

/** Pushes (or rolls back to) a version: reachable units install now, the rest when they can. */
export function startRollout(version: string, next: Omit<Rollout, 'installing' | 'version'>): { now: string[]; waiting: string[] } {
  const units = unitStore.get();
  const ready = units.filter((u) => reachable(u).ok);
  const nowIds = ready.map((u) => u.id);
  rolloutStore.set((r) => ({ ...r, ...next, version, installing: {} }));
  // One registry for both screens: this version is now the live one.
  const prevLive = registryStore.get().versions.find((m) => m.state === 'live')?.v;
  const order = registryStore.get().versions.map((m) => m.v);
  markLive(version, prevLive && order.indexOf(version) > order.indexOf(prevLive) ? 'rollback' : prevLive ? 'forward' : undefined);
  startInstalls(ready, version);
  const waiting = units.filter((u) => !nowIds.includes(u.id)).map((u) => u.id);
  setPending(waiting);
  return { now: nowIds, waiting };
}

function startInstalls(list: EdgeUnit[], version: string) {
  if (!list.length) return;
  const now = scenarioNow();
  list.forEach((u) => updateUnit(u.id, { modelVersion: version, modelConfirmed: false }));
  rolloutStore.set((r) => ({
    ...r,
    installing: { ...r.installing, ...Object.fromEntries(list.map((u, i) => [u.id, { version, until: now + 1800 + i * 900 }])) },
  }));
}

// ---------- Watcher ----------

export interface Sink {
  logSystem: (e: SystemLog) => void;
  toast: (text: string) => void;
  es: boolean;
}

let sink: Sink | undefined;

/**
 * Connects the log and toast. The live engine (state/engine.tsx) calls this and
 * runs tick() every second in the leading window, so restarts finish, queued
 * diagnostics run and waiting units install even when nobody has this screen open.
 */
export function connectEdgeOps(s: Sink) {
  sink = s;
}

const tr = (en: string, es: string) => (sink?.es ? es : en);
const say = (en: string, es: string) => sink?.toast(tr(en, es));

export function tick() {
  const now = scenarioNow();
  const units = unitStore.get();
  const unitById = (id: string) => units.find((u) => u.id === id);

  // Pipeline restarts finish after about five seconds; uptime starts again.
  const ops = opsStore.get();
  for (const [id, r] of Object.entries(ops.restarts)) {
    if (now < r.until) continue;
    const u = unitById(id);
    opsStore.set((o) => {
      const { [id]: _done, ...rest } = o.restarts;
      void _done;
      return { ...o, restarts: rest, restartedAt: { ...o.restartedAt, [id]: r.until } };
    });
    if (u?.status === 'restarting') updateUnit(id, { status: 'reporting', statusNote: undefined, uptimeDays: 0 });
    sink?.logSystem({ action: 'Pipeline restarted', target: id, details: `${u?.cameras ?? 3} streams decoding`, source: 'Edge unit', convoyId: u?.convoyId, category: 'system' });
    say(`${id} pipeline is back · ${u?.cameras ?? 3} streams decoding.`, `El pipeline de ${id} volvió · ${u?.cameras ?? 3} transmisiones decodificando.`);
  }

  // Model installs confirm one after another.
  const ro = rolloutStore.get();
  for (const [id, ins] of Object.entries(ro.installing)) {
    if (now < ins.until) continue;
    const u = unitById(id);
    rolloutStore.set((r) => {
      const { [id]: _done, ...rest } = r.installing;
      void _done;
      return { ...r, installing: rest };
    });
    updateUnit(id, { modelVersion: ins.version, modelConfirmed: true });
    sink?.logSystem({ action: 'Model confirmed', target: id, details: `${ins.version} verified and running`, source: 'Edge unit', convoyId: u?.convoyId, category: 'system' });
    const left = Object.keys(rolloutStore.get().installing).length;
    if (!left) {
      const waiting = unitStore.get().filter((x) => x.modelVersion !== ins.version || !x.modelConfirmed).length;
      say(
        waiting
          ? `${ins.version} confirmed on every unit in reach. ${waiting} install when their link returns.`
          : `${ins.version} confirmed on every unit.`,
        waiting
          ? `${ins.version} confirmada en todas las unidades al alcance. ${waiting} se instalan cuando vuelva el enlace.`
          : `${ins.version} confirmada en todas las unidades.`,
      );
    }
  }

  // Units back in reach install the current version they are missing.
  const cur = rolloutStore.get();
  const waitingNow = unitStore
    .get()
    .filter((u) => !cur.installing[u.id] && (u.modelVersion !== cur.version || !u.modelConfirmed) && reachable(u).ok);
  if (waitingNow.length) {
    startInstalls(waitingNow, cur.version);
    setPending(registryStore.get().pending.filter((id) => !waitingNow.some((u) => u.id === id)));
    waitingNow.forEach((u) =>
      sink?.logSystem({ action: 'Model install started', target: u.id, details: `${cur.version} · link returned`, source: 'Edge unit', convoyId: u.convoyId, category: 'system' }),
    );
    say(
      `${waitingNow.length} unit${waitingNow.length === 1 ? '' : 's'} back in reach: installing ${cur.version}.`,
      `${waitingNow.length} unidad${waitingNow.length === 1 ? '' : 'es'} de nuevo al alcance: instalando ${cur.version}.`,
    );
  }

  // Diagnostics: queued requests run when the link returns; running ones finish.
  for (const [id, d] of Object.entries(opsStore.get().diag)) {
    const u = unitById(id);
    if (d.phase === 'queued' && u?.status === 'reporting') {
      opsStore.set((o) => ({ ...o, diag: { ...o.diag, [id]: { ...d, phase: 'running', startedAt: now, results: diagnose(u), snapshot: snapshotOf(u) } } }));
      sink?.logSystem({ action: 'Diagnostics started', target: id, details: 'Queued request delivered when the link returned', source: 'Edge unit', convoyId: u.convoyId, category: 'system' });
    } else if (d.phase === 'running' && d.startedAt !== undefined && now >= d.startedAt + DIAG_MS) {
      opsStore.set((o) => ({ ...o, diag: { ...o.diag, [id]: { ...d, phase: 'done', doneAt: d.startedAt! + DIAG_MS } } }));
      const warn = d.results?.filter((r) => r.tone === 'warn').length ?? 0;
      sink?.logSystem({
        action: 'Diagnostics received',
        target: id,
        details: warn ? `${warn} item${warn === 1 ? '' : 's'} need attention` : 'All checks passed',
        source: 'Edge unit',
        convoyId: u?.convoyId,
        category: 'system',
      });
      say(`Diagnostics from ${id} received.`, `Diagnóstico de ${id} recibido.`);
    }
  }
}
