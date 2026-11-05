import { useEffect } from 'react';
import { backend, isOnline, setOnline, type BackendEvent, type CameraStatus } from '../lib/backend';
import { createStore, useStore } from '../lib/persist';
import { isLeader, raiseFromEvent } from './engine';
import { activityStore, alertStore, cameraStore, removalStore, ruleStore, toast } from './store';

// Keeps the console and the detection service (../backend) in step: checks that it is up, sends it every camera and
// rule when it connects, then polls it once a second for alerts and camera status. Alerts it raises become ordinary
// alerts, so notification, escalation and Qavach records work exactly as for the sample ones.

export const serviceStore = createStore<{ online: boolean }>('service', { online: false }, { persist: false });
export const useService = () => useStore(serviceStore);

/** Where in the service's event list this console has read up to. Saved, so a reload does not repeat alerts. */
const cursorStore = createStore<{ epoch: string; seq: number }>('eventCursor', { epoch: '', seq: 0 });

/** A rule in test mode matched; nobody was told. */
export interface TestMatch {
  id: string;
  ruleId: string;
  cameraId: string;
  zoneName: string;
  at: number;
  confidence: number;
  dwell: number;
  snapshot: string;
}
export const matchStore = createStore<TestMatch[]>('testMatches', []);
export const useMatches = () => useStore(matchStore);

function ingest(ev: BackendEvent) {
  const rule = ruleStore.get().find((r) => r.id === ev.ruleId);
  const cam = cameraStore.get().find((c) => c.id === ev.cameraId);
  if (!rule || !cam) return;
  if (alertStore.get().some((a) => a.eventId === ev.id) || matchStore.get().some((m) => m.id === ev.id)) return;
  if (rule.mode === 'test') {
    matchStore.set((list) => [{ id: ev.id, ruleId: rule.id, cameraId: cam.id, zoneName: ev.zoneName, at: ev.at, confidence: ev.confidence, dwell: ev.dwell, snapshot: ev.snapshot }, ...list].slice(0, 100));
    return;
  }
  raiseFromEvent(ev, rule, cam);
}

function applyStatus(statuses: Record<string, CameraStatus>) {
  const toStatus = (s: CameraStatus['state']) => (s === 'running' ? 'online' : s === 'starting' ? 'degraded' : 'offline');
  const changed = cameraStore.get().some((c) => c.source && statuses[c.id] && toStatus(statuses[c.id].state) !== c.status);
  if (changed) cameraStore.set((list) => list.map((c) => (c.source && statuses[c.id] ? { ...c, status: toStatus(statuses[c.id].state) } : c)));
  activityStore.set((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(statuses).map(([id, s]) => [id, s.people])) }));
}

async function connect() {
  const { epoch } = await backend.health();
  if (cursorStore.get().epoch !== epoch) cursorStore.set(() => ({ epoch, seq: 0 }));
  // Things removed while the service was away go first, then everything else is added or updated (never removed).
  const gone = removalStore.get();
  for (const id of gone.cameras) await backend.deleteCamera(id).catch(() => undefined);
  for (const id of gone.rules) await backend.deleteRule(id).catch(() => undefined);
  if (gone.cameras.length || gone.rules.length) removalStore.set(() => ({ cameras: [], rules: [] }));
  const { problems } = await backend.sync(cameraStore.get(), ruleStore.get());
  if (problems.length) toast(`Detection service skipped: ${problems.join('; ')}`, { tone: 'alert' });
  setOnline(true);
  serviceStore.set(() => ({ online: true }));
}

async function pollOnce() {
  const cursor = cursorStore.get();
  const r = await backend.poll(cursor.seq);
  if (r.epoch !== cursor.epoch) {
    cursorStore.set(() => ({ epoch: r.epoch, seq: 0 })); // the service restarted: start over from its first event
    return;
  }
  for (const ev of r.events) ingest(ev);
  if (r.next !== cursor.seq) cursorStore.set(() => ({ epoch: r.epoch, seq: r.next }));
  applyStatus(r.cameras);
}

/** Mount once per window. */
export function useBackendBridge() {
  useEffect(() => {
    let busy = false;
    let lastTry = 0;
    const goOffline = () => {
      if (isOnline()) toast('Lost the detection service. Real cameras keep their last picture until it is back.', { tone: 'alert' });
      setOnline(false);
      serviceStore.set(() => ({ online: false }));
    };
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const now = Date.now();
        if (!isOnline()) {
          if (now - lastTry < 3000) return;
          lastTry = now;
          if (isLeader(now)) await connect();
          else {
            await backend.health();
            setOnline(true);
            serviceStore.set(() => ({ online: true }));
          }
        } else if (isLeader(now)) {
          await pollOnce();
        }
      } catch {
        goOffline();
      } finally {
        busy = false;
      }
    };
    const t = window.setInterval(tick, 1000);
    tick();
    return () => window.clearInterval(t);
  }, []);
}
