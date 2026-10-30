import { useCallback, useEffect } from 'react';
import type { Convoy } from '../../data/types';
import { createStore, usePersistentState } from '../../lib/persist';
import { fmtTime, scenarioNow } from '../../lib/time';
import { useApp } from '../../state/AppState';
import { useFleet } from '../../state/fleetStore';

// ALM-05: "Request 2 min from the recorder". The request is saved; it waits on
// board while the convoy has no link, leaves when the link is up (or when the
// convoy comes back into coverage) and the footage arrives about 3 scenario
// minutes later. Arrival is written to the audit log and the alarm's trail.

export const FOOTAGE_DELAY_MS = 3 * 60_000;
const KEY = 'alarms.footage';

export interface FootageRequest {
  targetId: string;
  kind: 'alarm' | 'event';
  convoyId: string;
  vesselId?: string;
  cameraId?: string;
  /** Scenario time of the request (epoch ms). */
  requestedAt: number;
  by: string;
  /** When the request left shore over the link. */
  sentAt?: number;
  arrivedAt?: number;
}

type Requests = Record<string, FootageRequest>;

const footageStore = createStore<Requests>(KEY, {});

export type FootageStatus =
  | { kind: 'queued' }
  | { kind: 'sending'; dueAt: number; paused: boolean }
  | { kind: 'arrived'; at: number };

export function footageStatus(r: FootageRequest, convoy: Convoy | undefined, now: number, simulation: boolean): FootageStatus {
  if (r.arrivedAt) return { kind: 'arrived', at: r.arrivedAt };
  if (!convoy || convoy.link === 'none') return { kind: 'queued' };
  const dueAt = (r.sentAt ?? now) + FOOTAGE_DELAY_MS;
  return { kind: 'sending', dueAt, paused: !simulation && now >= dueAt };
}

/** The saved requests and a function to make one. */
export function useFootage() {
  const { state, can, log, addActivity, toast } = useApp();
  const fleet = useFleet();
  const [requests, setRequests] = usePersistentState<Requests>(KEY, {});
  const es = state.lang === 'es';

  const request = useCallback(
    (target: { id: string; kind: 'alarm' | 'event'; convoyId: string; vesselId?: string; cameraId?: string }) => {
      if (!can('view_clips') || footageStore.get()[target.id]) return;
      const convoy = fleet.convoyById(target.convoyId);
      const up = Boolean(convoy && convoy.link !== 'none');
      const now = scenarioNow();
      setRequests((m) =>
        m[target.id]
          ? m
          : {
              ...m,
              [target.id]: {
                targetId: target.id,
                kind: target.kind,
                convoyId: target.convoyId,
                vesselId: target.vesselId,
                cameraId: target.cameraId,
                requestedAt: now,
                by: state.user.name,
                sentAt: up ? now : undefined,
              },
            },
      );
      const vessel = fleet.vesselById(target.vesselId)?.name ?? convoy?.name ?? '';
      log(
        'Requested recorder footage',
        target.id,
        `2 min · ${target.cameraId ?? vessel} · ${up ? `over ${convoy?.linkLabel}` : `queued until ${convoy?.name} reconnects`}`,
        target.convoyId,
      );
      if (target.kind === 'alarm') {
        addActivity(
          target.id,
          up ? `Requested 2 min from the recorder on ${vessel}` : `Requested 2 min from the recorder on ${vessel}: queued until the convoy reconnects`,
          up ? `Se pidieron 2 min al grabador de ${vessel}` : `Se pidieron 2 min al grabador de ${vessel}: en cola hasta que el convoy vuelva a tener cobertura`,
        );
      }
      toast(
        up
          ? es
            ? `Se pidieron 2 min al grabador de ${vessel}. Unos 25 MB por ${convoy?.linkLabel}; llegan en unos 3 min.`
            : `Requested 2 min from the recorder on ${vessel}. About 25 MB over ${convoy?.linkLabel}; it arrives in about 3 min.`
          : es
            ? `Pedido de 2 min en cola para ${convoy?.name}. Se envía cuando el convoy vuelva a tener cobertura.`
            : `2 min request queued for ${convoy?.name}. It is sent when the convoy reconnects.`,
      );
    },
    [can, fleet, setRequests, state.user.name, log, addActivity, toast, es],
  );

  return { requests, request };
}

/**
 * Moves saved requests along while the console is open: send when the link is
 * up, arrive 3 min later. Times are worked out from the saved request and the
 * convoy's "back in coverage" line in the audit log, so a request made before
 * leaving the console arrives at the right time when you come back.
 */
export function useFootageDelivery(now: number) {
  const { state, logSystem, patchAlarm, toast } = useApp();
  const fleet = useFleet();
  const es = state.lang === 'es';

  useEffect(() => {
    if (!state.signedIn) return;
    const reqs = footageStore.get();
    const changes: Requests = {};
    const after: (() => void)[] = [];
    for (const r of Object.values(reqs)) {
      if (r.arrivedAt) continue;
      const convoy = fleet.convoyById(r.convoyId);
      if (!convoy || convoy.link === 'none') {
        // Link lost before the footage arrived: it waits on board again.
        if (r.sentAt !== undefined) changes[r.targetId] = { ...r, sentAt: undefined };
        continue;
      }
      let sentAt = r.sentAt;
      if (sentAt === undefined) {
        const back = state.audit
          .filter((e) => e.action === 'Convoy back in coverage' && e.convoyId === r.convoyId && new Date(e.at).getTime() >= r.requestedAt)
          .map((e) => new Date(e.at).getTime())
          .sort((a, b) => a - b)[0];
        sentAt = back ?? now;
        after.push(() =>
          logSystem({
            action: 'Sent footage request',
            target: r.targetId,
            details: `${convoy.name} back in coverage · 2 min from ${r.cameraId ?? 'the recorder'}`,
            source: 'Event service',
            convoyId: r.convoyId,
            category: 'system',
          }),
        );
      }
      const due = sentAt + FOOTAGE_DELAY_MS;
      if (now >= due && state.simulation) {
        changes[r.targetId] = { ...r, sentAt, arrivedAt: due };
        after.push(() => {
          logSystem({
            action: 'Received recorder footage',
            target: r.targetId,
            details: `2 min · 24.6 MB · ${r.cameraId ?? ''} · requested by ${r.by}`,
            source: 'Event service',
            convoyId: r.convoyId,
            category: 'system',
          });
          if (r.kind === 'alarm') {
            const at = new Date(due).toISOString();
            patchAlarm(r.targetId, (a) => ({
              ...a,
              activity: [
                ...a.activity,
                { at, text: `Recorder footage received: 2 min, 24.6 MB over ${convoy.linkLabel}`, textEs: `Video del grabador recibido: 2 min, 24,6 MB por ${convoy.linkLabel}`, actor: 'Event service' },
              ],
            }));
          }
          toast(
            es
              ? `Llegaron los 2 min del grabador para ${r.targetId} (${fmtTime(due)}). Están en la evidencia.`
              : `2 min of recorder footage for ${r.targetId} arrived (${fmtTime(due)}). It is listed in evidence.`,
          );
        });
      } else if (sentAt !== r.sentAt) {
        changes[r.targetId] = { ...r, sentAt };
      }
    }
    if (Object.keys(changes).length) {
      footageStore.set((m) => ({ ...m, ...changes }));
      after.forEach((f) => f());
    }
  }, [now, fleet, state.signedIn, state.simulation, state.audit, logSystem, patchAlarm, toast, es]);
}
