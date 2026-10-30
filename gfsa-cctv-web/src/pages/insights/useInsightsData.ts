import { useCallback, useMemo } from 'react';
import { useApp } from '../../state/AppState';
import { useFleet } from '../../state/fleetStore';
import { camStore, ucStore, useStore } from '../../state/configStore';
import type { Lang } from '../../lib/i18n';
import { useNow } from '../../lib/time';
import { dailySummary, liveDailySummary, type DailySummary } from './dailyData';
import { liveDeltas, registryStore, type PerfInput } from './modelData';
import type { ReportCtx } from './reportContent';
import { dateOf, scenarioToday } from './insightsUtil';

/**
 * Live inputs for the insights screens: the daily summary of any vessel and day
 * (today built from the console's alarms, review queue, cameras and link), the
 * model performance inputs and a report context in a chosen language.
 */
export function useInsightsData() {
  const { state } = useApp();
  const fleet = useFleet();
  const records = useStore(ucStore);
  const cams = useStore(camStore);
  const registry = useStore(registryStore);
  const now = useNow(30_000);
  const today = scenarioToday(now);

  const summary = useMemo(() => {
    const cache = new Map<string, DailySummary>();
    const isShadow = (id: string) => records[id]?.status === 'shadow';
    return (vesselId: string, date: string): DailySummary => {
      const key = `${vesselId}|${date}`;
      const hit = cache.get(key);
      if (hit) return hit;
      // Cameras added on "Cameras and zones" count from the day they were added.
      const onVessel = fleet.camerasOnVessel(vesselId).filter((c) => !cams.addedAt[c.id] || dateOf(cams.addedAt[c.id]) <= date);
      const vessel = fleet.vesselById(vesselId);
      const convoy = vessel ? fleet.convoyById(vessel.convoyId) : undefined;
      const s =
        date === today && convoy
          ? liveDailySummary(vesselId, date, { nowMs: now, alarms: state.alarms, reviewEvents: state.reviewEvents, cameras: onVessel, convoy, isShadow })
          : dailySummary(vesselId, date, onVessel);
      cache.set(key, s);
      return s;
    };
  }, [fleet, cams.addedAt, records, state.alarms, state.reviewEvents, now, today]);

  const deltas = useMemo(() => liveDeltas(state.alarms, state.reviewEvents), [state.alarms, state.reviewEvents]);
  const perf: PerfInput = useMemo(() => ({ records, deltas, nowMs: now, totalCams: fleet.cameras.length }), [records, deltas, now, fleet.cameras.length]);

  const ctxFor = useCallback(
    (lang: Lang): ReportCtx => ({
      lang,
      nowMs: now,
      today,
      fleet,
      summary,
      alarms: state.alarms,
      reviewEvents: state.reviewEvents,
      audit: state.audit,
      perf,
      registry,
    }),
    [now, today, fleet, summary, state.alarms, state.reviewEvents, state.audit, perf, registry],
  );

  return { now, today, fleet, records, registry, summary, deltas, perf, ctxFor };
}
