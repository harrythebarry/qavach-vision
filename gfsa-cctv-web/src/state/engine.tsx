import { useEffect, useRef } from 'react';
import { useCaseById, useCases } from '../data/useCases';
import { vessels } from '../data/fleet';
import type { Alarm, Camera, Detection, ReviewEvent } from '../data/types';
import { createStore } from '../lib/persist';
import { fmtTime, scenarioElapsed, scenarioNow } from '../lib/time';
import { useApp } from './AppState';
import { activeConfig, camStore, runSceneCheck, ucStore } from './configStore';
import { channelsText, deliveryText, escalate, firstRecipient, roleEs, startEscalation, toRoleEs } from './escalation';
import { connectEdgeOps, tick as edgeTick } from './edgeOps';
import { convoyStore, unitStore, updateConvoy } from './fleetStore';
import { routingStore } from './routingStore';

// The live side of the demo, standing in for the event service and alert routing:
//  - ALM-03  escalates unacknowledged alarms along the saved ladder, on time
//  - RT-03   sends reminders every N min to the first recipient, at most M
//  - new events arrive from the edge units, following each use case's saved
//            level, priority and cameras (off and blocked use cases stay quiet)
//  - store and forward: GF Humaitá comes back into coverage and its queued
//            events arrive with their original times
//  - health messages every minute keep each convoy's last position current
// Everything it does is written to the alarm's activity trail and the audit log.

interface SimState {
  done: string[];
  alarmSeq: number;
  eventSeq: number;
  lastPeriodic: number;
}

const simStore = createStore<SimState>('sim', () => ({ done: [], alarmSeq: 318, eventSeq: 400, lastPeriodic: 0 }));

const MIN = 60_000;
const iso = (ms = scenarioNow()) => new Date(ms).toISOString();

/** Deterministic pseudo-random in [0, 1) for a slot number, so a reload replays the same choices. */
const rand = (n: number) => {
  const x = Math.sin(n * 9301 + 49297) * 233280;
  return x - Math.floor(x);
};

const DETECTION: Record<string, { label: string; box: Detection['box']; zone?: string; zoneName?: string }> = {
  'hard-hat-vest': { label: 'No hard hat', box: { x: 46, y: 44, w: 7, h: 26 } },
  'life-jacket': { label: 'No life jacket', box: { x: 43.4, y: 50.5, w: 7, h: 24 }, zone: '17.19,100 45.31,100 60.31,27.78 58.75,27.78', zoneName: 'Water edge' },
  smoking: { label: 'Smoking', box: { x: 52, y: 42, w: 6, h: 24 } },
  'smoke-machinery': { label: 'Smoke', box: { x: 30, y: 18, w: 38, h: 34 } },
  'smoke-fire-deck': { label: 'Smoke', box: { x: 34, y: 20, w: 30, h: 30 } },
  'container-doors': { label: 'Door open', box: { x: 60, y: 30, w: 12, h: 36 } },
  'outside-work': { label: 'Person', box: { x: 38, y: 46, w: 7, h: 26 } },
  'reefer-rounds': { label: 'Person', box: { x: 48, y: 46, w: 7, h: 26 } },
};

const TITLES: Record<string, [string, string, string, string]> = {
  // title, título, description, descripción
  'hard-hat-vest': ['Hard hat missing', 'Falta casco', 'A person on deck without a hard hat.', 'Una persona en cubierta sin casco.'],
  'life-jacket': [
    'Life jacket missing near the water',
    'Falta chaleco salvavidas cerca del agua',
    'A crew member has been in the water edge zone without a life jacket for 5 seconds.',
    'Un tripulante lleva 5 segundos en la zona del borde del agua sin chaleco salvavidas.',
  ],
  'smoke-machinery': [
    'Smoke in the engine room',
    'Humo en la sala de máquinas',
    'Smoke or haze detected in the engine room.',
    'Humo o neblina detectados en la sala de máquinas.',
  ],
  'smoke-fire-deck': ['Smoke on deck', 'Humo en cubierta', 'Smoke detected on deck.', 'Humo detectado en cubierta.'],
  smoking: ['Smoking in a no-smoking zone', 'Fumando en zona prohibida', 'A person smoking in a no-smoking zone.', 'Una persona fumando en una zona donde no se permite.'],
  'camera-health': [
    'Camera offline or degraded',
    'Cámara sin señal o degradada',
    'The hourly scene check flagged this camera.',
    'El control de escena horario marcó esta cámara.',
  ],
  'container-doors': ['Container door open', 'Puerta de contenedor abierta', 'A container door is open outside cargo operations.', 'Una puerta de contenedor está abierta fuera de las operaciones de carga.'],
};

const capital = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

const voyageOf = (convoyId: string) => convoyStore.get().find((c) => c.id === convoyId)?.voyageId;

/** What a use case does with a detection right now, from its saved configuration. */
function routeFor(ucId: string): { kind: 'alarm' | 'event' | 'shadow' | 'none'; priority: Alarm['priority']; cameraIds: string[] } {
  const uc = useCaseById(ucId);
  const rec = ucStore.get()[ucId];
  if (!uc || !rec) return { kind: 'none', priority: 'P3', cameraIds: [] };
  const cfg = activeConfig(uc, rec);
  if (rec.status === 'off' || rec.status === 'blocked') return { kind: 'none', priority: cfg.priority, cameraIds: cfg.cameraIds };
  if (rec.status === 'shadow') return { kind: 'shadow', priority: cfg.priority, cameraIds: cfg.cameraIds };
  return { kind: cfg.level === 'list' ? 'event' : 'alarm', priority: cfg.priority, cameraIds: cfg.cameraIds };
}

function connectedCameras(ids: string[]): Camera[] {
  const up = new Set(convoyStore.get().filter((c) => c.link !== 'none').map((c) => c.id));
  return camStore.get().cameras.filter((c) => ids.includes(c.id) && up.has(c.convoyId) && c.health !== 'offline');
}

export function LiveEngine() {
  const app = useApp();
  const ref = useRef(app);
  ref.current = app;
  const autoAck = useRef(new Map<string, number>());

  useEffect(() => {
    // Only one window runs the engine (the console, not the second screen):
    // windows hold a heartbeat in localStorage and the first one alive leads.
    const me = Math.random().toString(36).slice(2);
    const LEAD = 'gfsa.v1.engineLeader';
    const isLeader = () => {
      try {
        const raw = window.localStorage.getItem(LEAD);
        const cur = raw ? (JSON.parse(raw) as { id: string; ts: number }) : undefined;
        if (!cur || cur.id === me || Date.now() - cur.ts > 3500) {
          window.localStorage.setItem(LEAD, JSON.stringify({ id: me, ts: Date.now() }));
          return true;
        }
        return false;
      } catch {
        return true;
      }
    };

    const tick = () => {
      const { state, patchAlarm, logSystem, toast, raiseAlarm, addReviewEvents } = ref.current;
      if (!state.signedIn) return;
      if (!isLeader()) return;
      // Work people started (restarts, installs, diagnostics) finishes even with live events paused.
      connectEdgeOps({ logSystem, toast, es: state.lang === 'es' });
      edgeTick();
      if (!state.simulation) return;
      const now = scenarioNow();
      const nowIso = iso(now);
      const es = state.lang === 'es';
      const tr = (en: string, sp: string) => (es ? sp : en);
      const sim = simStore.get();
      const once = (id: string, fn: () => void) => {
        if (simStore.get().done.includes(id)) return;
        simStore.set((s) => ({ ...s, done: [...s.done, id] }));
        fn();
      };

      // ---------- Escalation, reminders and digests (ALM-03, RT-01, RT-03) ----------
      const rules = routingStore.get().rules;
      for (const a of state.alarms) {
        const open = a.state === 'raised' || a.state === 'ack_board';
        if (!open) continue;

        if (a.escalatesAt && new Date(a.escalatesAt).getTime() <= now) {
          const key = `esc:${a.id}:${a.escalatesAt}`;
          once(key, () => {
            const { sent } = escalate(a, nowIso);
            patchAlarm(a.id, (x) => (x.escalatesAt === a.escalatesAt ? escalate(x, nowIso).alarm : x));
            if (sent) {
              logSystem({ action: 'Sent alert', target: a.id, details: sent.en, source: 'Alert routing', convoyId: a.convoyId, category: 'alert' });
              toast(tr(`${a.id} escalated to the ${sent.target.toLowerCase()}: nobody acknowledged it ashore in time.`, `${a.id} escalada ${toRoleEs(sent.target)}: nadie la confirmó en tierra a tiempo.`));
            }
          });
        }

        // Reminders to the first recipient until someone acknowledges ashore.
        const first = firstRecipient(a);
        if (first && a.escalationBase) {
          const base = new Date(a.escalationBase).getTime();
          const sentSoFar = a.reminders ?? 0;
          const k = sentSoFar + 1;
          if (k <= rules.reminderMax && base + k * rules.reminderEvery * MIN <= now) {
            once(`rem:${a.id}:${k}`, () => {
              const d = deliveryText(first.channels, first.target);
              const en = `Reminder ${k} of ${rules.reminderMax}: ${d.en}`;
              const sp = `Recordatorio ${k} de ${rules.reminderMax}: ${d.es}`;
              patchAlarm(a.id, (x) => ({ ...x, reminders: k, activity: [...x.activity, { at: nowIso, text: en, textEs: sp, actor: 'Alert routing' }] }));
              logSystem({ action: 'Sent reminder', target: a.id, details: en, source: 'Alert routing', convoyId: a.convoyId, category: 'alert' });
            });
          }
        }

        // "Unreviewed for N min" steps (P3 digest to the operations manager).
        for (const step of routingStore.get().ladders[a.priority].filter((s) => s.when === 'unreviewed')) {
          if (new Date(a.raisedAt).getTime() + step.minutes * MIN <= now && !(a.escalatedTo ?? []).includes(step.target)) {
            once(`unrev:${a.id}:${step.target}`, () => {
              const en = `Unreviewed for ${step.minutes} min: added to the ${channelsText.en(step.channels)} digest for the ${step.target.toLowerCase()}`;
              const sp = `Sin revisar durante ${step.minutes} min: incluida en el resumen por ${channelsText.es(step.channels)} para ${roleEs(step.target)}`;
              patchAlarm(a.id, (x) => ({ ...x, escalatedTo: [...(x.escalatedTo ?? []), step.target], activity: [...x.activity, { at: nowIso, text: en, textEs: sp, actor: 'Alert routing' }] }));
              logSystem({ action: 'Sent alert', target: a.id, details: en, source: 'Alert routing', convoyId: a.convoyId, category: 'alert' });
            });
          }
        }
      }

      // Wheelhouse acknowledges new alarms on board after a few seconds,
      // unless the signed-in user is that convoy's master (they do it on /wheelhouse).
      for (const [id, due] of autoAck.current) {
        if (due > Date.now()) continue;
        autoAck.current.delete(id);
        const a = state.alarms.find((x) => x.id === id);
        if (!a || a.state !== 'raised') continue;
        if (state.role === 'master' && state.user.convoyId === a.convoyId) continue;
        patchAlarm(id, (x) =>
          x.state === 'raised'
            ? { ...x, state: 'ack_board', stateTimes: { ...x.stateTimes, ack_board: nowIso }, activity: [...x.activity, { at: nowIso, text: 'Acknowledged on board', textEs: 'Confirmada a bordo', actor: 'Wheelhouse' }] }
            : x,
        );
        logSystem({ action: 'Acknowledged alarm', target: id, details: 'On the wheelhouse display', source: 'Wheelhouse', convoyId: a.convoyId, category: 'alarm' });
      }

      // ---------- New alarms and events from the edge units ----------
      const raise = (ucId: string, cam: Camera, opts: { at?: number; quiet?: boolean; note?: [string, string] } = {}) => {
        const route = routeFor(ucId);
        const uc = useCaseById(ucId)!;
        const t = TITLES[ucId] ?? [uc.name, uc.nameEs, uc.rule, uc.ruleEs];
        const det = DETECTION[ucId] ?? { label: 'Detection', box: { x: 40, y: 40, w: 10, h: 25 } };
        const confidence = 0.7 + rand(now / 1000) * 0.25;
        const detection: Detection = { ...det, confidence: Math.round(confidence * 100) / 100 };
        const voyageId = voyageOf(cam.convoyId);
        const vessel = vessels.find((v) => v.id === cam.vesselId);
        if (route.kind === 'none') return;
        if (route.kind === 'alarm') {
          const seq = simStore.get().alarmSeq + 1;
          simStore.set((s) => ({ ...s, alarmSeq: seq }));
          const id = `ALM-26-${String(seq).padStart(4, '0')}`;
          const detectedAt = (opts.at ?? now) - 30_000;
          const first = routingStore.get().ladders[route.priority].find((s) => s.when === 'now');
          let alarm: Alarm = {
            id,
            eventId: `EV-26-${(voyageId ?? 'VOY-26-000').slice(-3)}-${String(seq).padStart(4, '0')}`,
            priority: route.priority,
            title: t[0],
            titleEs: t[1],
            description: opts.note ? `${t[2]} ${opts.note[0]}.` : t[2],
            descriptionEs: opts.note ? `${t[3]} ${opts.note[1]}.` : t[3],
            useCaseId: ucId,
            convoyId: cam.convoyId,
            vesselId: cam.vesselId,
            cameraId: cam.id,
            voyageId,
            raisedAt: iso(detectedAt),
            state: 'raised',
            stateTimes: { raised: iso(detectedAt) },
            stepsDone: {},
            detection,
            position: '—',
            models: 'Base detector v2.1 · Crew safety v1.4',
            evidence: [
              { name: 'Clip, 15 s · 3.0 MB', meta: 'MP4 · 720p', hash: `sha256 ${id.slice(-4)}…${Math.floor(confidence * 9999)}` },
              { name: `Snapshot ${fmtTime(detectedAt)} · 50 KB`, meta: 'JPEG' },
              { name: 'Detection record', meta: '2 KB · JSON' },
            ],
            activity: [
              { at: iso(detectedAt), text: `Detected on board by the AI unit on ${vessel?.name ?? cam.vesselId}`, textEs: `Detectada a bordo por la unidad de IA de ${vessel?.name ?? cam.vesselId}`, actor: 'System' },
              { at: iso(detectedAt + 1000), text: 'Shown on the wheelhouse display', textEs: 'Mostrada en la pantalla del puente', actor: 'Wheelhouse' },
              { at: nowIso, text: 'Received ashore over 4G', textEs: 'Recibida en tierra por 4G', actor: 'Event service' },
              ...(first && first.channels.length
                ? [{ at: nowIso, text: capital(deliveryText(first.channels, first.target).en), textEs: capital(deliveryText(first.channels, first.target).es), actor: 'Alert routing' }]
                : []),
            ],
          };
          alarm = startEscalation(alarm, nowIso);
          raiseAlarm(alarm);
          autoAck.current.set(id, Date.now() + 4000 + rand(seq) * 4000);
          logSystem({ action: 'Raised alarm', target: id, details: `${t[0]} · ${vessel?.name} · ${cam.name}`, convoyId: cam.convoyId, category: 'alarm' });
          if (first && first.channels.length) {
            logSystem({ action: 'Sent alert', target: id, details: capital(deliveryText(first.channels, first.target).en), source: 'Alert routing', convoyId: cam.convoyId, category: 'alert' });
          }
          if (!opts.quiet) toast(tr(`New ${route.priority} alarm ${id}: ${t[0]} · ${vessel?.name} · ${cam.name}`, `Nueva alarma ${route.priority} ${id}: ${t[1]} · ${vessel?.name} · ${cam.name}`));
        } else {
          const seq = simStore.get().eventSeq + 1;
          simStore.set((s) => ({ ...s, eventSeq: seq }));
          const ev: ReviewEvent = {
            id: `EV-26-${(voyageId ?? 'VOY-26-000').slice(-3)}-${String(seq).padStart(4, '0')}`,
            useCaseId: ucId,
            convoyId: cam.convoyId,
            vesselId: cam.vesselId,
            cameraId: cam.id,
            at: iso(opts.at ?? now),
            confidence: detection.confidence,
            shadow: route.kind === 'shadow',
            detection,
          };
          addReviewEvents([ev]);
          logSystem({ action: 'Received event', target: ev.id, details: `${uc.name}${ev.shadow ? ' · shadow run' : ''} · ${cam.id}`, convoyId: cam.convoyId, category: 'system' });
        }
      };

      const pickCamera = (ucId: string, n: number): Camera | undefined => {
        const cams = connectedCameras(routeFor(ucId).cameraIds);
        return cams.length ? cams[Math.floor(rand(n) * cams.length)] : undefined;
      };

      const elapsed = scenarioElapsed();

      // Scripted moments, once each.
      if (elapsed > 1.5 * MIN)
        once('script:hardhat', () => {
          const cam = camStore.get().cameras.find((c) => c.id === 'F501-CAM-01');
          if (cam) raise('hard-hat-vest', cam);
        });
      if (elapsed > 3 * MIN)
        once('script:doors', () => {
          const cam = camStore.get().cameras.find((c) => c.id === 'F502-CAM-03') ?? pickCamera('container-doors', 3);
          if (cam) raise('container-doors', cam);
        });
      if (elapsed > 4 * MIN)
        once('script:hum-reconnect', () => {
          const hum = convoyStore.get().find((c) => c.id === 'hum');
          if (!hum || hum.link !== 'none') return;
          const since = new Date(hum.lastSeen).getTime();
          updateConvoy('hum', { link: 'strong', linkLabel: '4G', linkMbps: 8, liveBudgetMbps: 1.6, lastSeen: nowIso, queuedEvents: 0, positionLabel: 'near Goya' });
          unitStore.set((list) =>
            list.map((u) => (u.convoyId === 'hum' ? { ...u, status: 'reporting', statusNote: undefined, link: '4G 0.3 Mbps', queue: { events: 0, clips: 0 } } : u)),
          );
          // Store and forward: the 12 queued events arrive with their original times.
          const humCams = camStore.get().cameras.filter((c) => c.convoyId === 'hum');
          const mix = ['container-doors', 'outside-work', 'container-doors', 'smoking', 'outside-work', 'container-doors'];
          const queued: ReviewEvent[] = Array.from({ length: hum.queuedEvents || 12 }, (_, i) => {
            const ucId = mix[i % mix.length];
            const cam = humCams[(i * 5) % humCams.length];
            const at = since + ((now - since) * (i + 1)) / 13;
            const route = routeFor(ucId);
            return {
              id: `EV-26-039-${String(600 + i).padStart(4, '0')}`,
              useCaseId: ucId,
              convoyId: 'hum',
              vesselId: cam.vesselId,
              cameraId: cam.id,
              at: iso(at),
              confidence: 0.66 + rand(i + 40) * 0.3,
              shadow: route.kind === 'shadow',
              queued: true,
              detection: { ...(DETECTION[ucId] ?? DETECTION['outside-work']), confidence: 0.66 + rand(i + 40) * 0.3 },
            };
          });
          addReviewEvents(queued);
          patchAlarm('ALM-26-0316', (x) =>
            x.state === 'closed'
              ? x
              : {
                  ...x,
                  state: 'closed',
                  stateLabel: undefined, stateLabelEs: undefined,
                  response: 'Cleared on reconnect',
                  responseEs: 'Cerrada al reconectar',
                  classification: 'accepted',
                  stateTimes: { ...x.stateTimes, resolved: nowIso, closed: nowIso },
                  activity: [
                    ...x.activity,
                    { at: nowIso, text: `Back in coverage over 4G. ${queued.length} queued events received with their original times`, textEs: `De nuevo con cobertura por 4G. ${queued.length} eventos en cola recibidos con su hora original`, actor: 'Event service' },
                    { at: nowIso, text: 'Closed automatically: the convoy is reporting again', textEs: 'Cerrada automáticamente: el convoy vuelve a reportar', actor: 'System' },
                  ],
                },
          );
          logSystem({ action: 'Convoy back in coverage', target: 'GF Humaitá convoy', details: `4G · ${queued.length} queued events received`, convoyId: 'hum', category: 'system' });
          toast(tr(`GF Humaitá is back in coverage. ${queued.length} queued events arrived with their original times.`, `GF Humaitá vuelve a tener cobertura. Llegaron ${queued.length} eventos en cola con su hora original.`));
        });
      if (elapsed > 6 * MIN)
        once('script:smoke', () => {
          const cam = camStore.get().cameras.find((c) => c.id === 'BOQ-CAM-02') ?? pickCamera('smoke-machinery', 6);
          if (cam) raise('smoke-machinery', cam);
        });

      // CAM-02: a scene check on every camera at half past each hour; a new problem raises
      // "Camera offline or degraded" (P3) through the use case's saved routing.
      const halfHour = Math.floor((now - 30 * MIN) / (60 * MIN)) * 60 * MIN + 30 * MIN;
      if (halfHour > new Date('2026-10-15T14:36:20-03:00').getTime())
        once(`scene:${halfHour}`, () => {
          const run = runSceneCheck('Schedule');
          const fresh = run.flags.filter((f) => f.fresh);
          logSystem({
            action: 'Scene check',
            target: `${run.checked} cameras`,
            details: fresh.length ? `${fresh.length} new: ${fresh.map((f) => `${f.cameraId} ${f.note.toLowerCase()}`).join(', ')}` : `${run.flags.length} still flagged, no new problems`,
            source: 'Scene checks',
            category: 'system',
          });
          const NOTE_ES: Record<string, string> = { Blurred: 'Desenfocada', 'Lens wet': 'Lente mojada', 'Camera moved': 'Cámara movida', 'No image': 'Sin imagen', Glare: 'Reflejos' };
          for (const f of fresh) {
            const cam = camStore.get().cameras.find((c) => c.id === f.cameraId);
            if (cam) raise('camera-health', cam, { note: [`Scene check: ${f.note.toLowerCase()}`, `Control de escena: ${(NOTE_ES[f.note] ?? f.note).toLowerCase()}`] });
          }
        });

      // ALM-26-0317: the 14:00 reefer round counts as missed at 15:00 and goes to Connect.
      if (now >= new Date('2026-10-15T15:00:00-03:00').getTime())
        once('script:reefer-missed', () => {
          const a = state.alarms.find((x) => x.id === 'ALM-26-0317');
          if (!a || a.state === 'closed') return;
          patchAlarm('ALM-26-0317', (x) => ({
            ...x,
            response: 'Missed · sent to Connect',
            responseEs: 'Perdida · enviada a Connect',
            activity: [...x.activity, { at: nowIso, text: '15:00: the 14:00 round counts as missed and was sent to Connect', textEs: '15:00: la ronda de las 14:00 cuenta como perdida y se envió a Connect', actor: 'System' }],
          }));
          logSystem({ action: 'Sent to Connect', target: 'VOY-26-041', details: 'Missed reefer round 14:00 · Guarán F 501 · row 1', source: 'Connect integration', convoyId: 'tuy', category: 'system' });
        });

      // From 8 minutes on, something arrives every 2.5 minutes.
      if (elapsed > 8 * MIN) {
        const slot = Math.floor((elapsed - 8 * MIN) / (2.5 * MIN));
        if (slot >= sim.lastPeriodic) {
          simStore.set((s) => ({ ...s, lastPeriodic: slot + 1 }));
          const r = rand(slot + 7);
          const openCount = state.alarms.filter((a) => a.state !== 'closed').length;
          const alarmUc = r < 0.5 ? 'hard-hat-vest' : 'life-jacket';
          const eventUcs = useCases.filter((u) => ['container-doors', 'outside-work', 'smoking', 'hard-hat-vest'].includes(u.id)).map((u) => u.id);
          const ucId = r < 0.28 && openCount < 7 ? alarmUc : eventUcs[Math.floor(rand(slot + 11) * eventUcs.length)];
          const cam = pickCamera(ucId, slot + 3);
          if (cam) raise(ucId, cam);
        }
      }

      // Health messages every minute: last position and a little progress along the route.
      once(`health:${Math.floor(elapsed / MIN)}`, () => {
        convoyStore.set((list) =>
          list.map((c) => {
            if (c.link === 'none') return c;
            const drift = c.id === 'tuy' ? { x: 0.03, y: 0.012 } : c.id === 'hum' ? { x: 0.004, y: -0.02 } : { x: 0, y: 0 };
            return { ...c, lastSeen: nowIso, map: { x: Math.min(50, c.map.x + drift.x), y: Math.max(5, Math.min(92, c.map.y + drift.y)) } };
          }),
        );
      });


    };

    const id = window.setInterval(tick, 1000);
    tick();
    const release = () => {
      try {
        const raw = window.localStorage.getItem(LEAD);
        if (raw && (JSON.parse(raw) as { id: string }).id === me) window.localStorage.removeItem(LEAD);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('beforeunload', release);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('beforeunload', release);
      release();
    };
  }, []);

  return null;
}

/** Restarts the simulator script (used by Reset demo data via the persisted keys). */
export const resetSimulator = () => simStore.reset();
