import { initialConfig, type RoutingConfig, type Step } from '../data/routing';
import type { Priority } from '../data/types';
import { createStore, useStore } from '../lib/persist';

// The saved alert routing (RT-01 to RT-05). The Alert routing screen edits a
// draft and writes here on Save; the live engine reads the escalation ladder
// from here, so a changed timer changes when real alarms escalate.

export const routingStore = createStore<RoutingConfig>('routing', () => structuredClone(initialConfig));

export const useRouting = () => useStore(routingStore);

export function saveRouting(config: RoutingConfig) {
  routingStore.set(() => config);
}

/** The "Not acknowledged in N min" steps for a priority, earliest first. */
export function escalationSteps(p: Priority, config = routingStore.get()): Step[] {
  return config.ladders[p].filter((s) => s.when === 'after').sort((a, b) => a.minutes - b.minutes);
}

/** The step that fires first ashore ("At once, ashore"). */
export function firstShoreStep(p: Priority, config = routingStore.get()): Step | undefined {
  return config.ladders[p].find((s) => s.when === 'now');
}
