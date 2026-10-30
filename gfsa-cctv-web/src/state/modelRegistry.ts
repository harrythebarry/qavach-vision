import { createStore } from '../lib/persist';
import { scenarioNow } from '../lib/time';

// MP-03 / EU-02: the model registry, shared by Model performance and Edge units.
// One record of which signed version is live, so both screens agree; the
// rollout itself (installs, units waiting for their link) is in state/edgeOps.ts.

export type VersionState = 'draft' | 'live' | 'previous';

export interface ModelVersion {
  v: string;
  state: VersionState;
  label?: [string, string];
  signed?: string; // ISO
  pushed?: string; // ISO
  replaced?: string; // ISO
  /** How it became live, when that was a rollback or a return to a newer version. */
  via?: 'rollback' | 'forward';
}

export interface Rollback {
  id: string;
  at: string;
  by: string;
  from: string;
  to: string;
  now: number;
  waiting: number;
}

export interface RegistryState {
  versions: ModelVersion[]; // newest first
  rollbacks: Rollback[]; // newest first
  /** Edge units that install the live version when their link returns. */
  pending: string[];
}

const d = (s: string) => `2026-${s}:00-03:00`;

export const registryStore = createStore<RegistryState>('models.registry', () => ({
  versions: [
    { v: 'v1.4.3', state: 'draft', label: ['crew safety attributes', 'atributos de seguridad de la tripulación'] },
    { v: 'v1.4.2', state: 'live', signed: d('10-12T09:40'), pushed: d('10-12T10:05') },
    { v: 'v1.4.1', state: 'previous', signed: d('10-05T16:10') },
  ],
  rollbacks: [],
  pending: ['HUM-EU-01', 'F505-EU-01', 'F507-EU-01', 'F509-EU-01'],
}));

export const liveVersion = (s: RegistryState) => s.versions.find((m) => m.state === 'live')!;

/** True when version a is older than b (the registry is listed newest first). */
export const isOlder = (versions: ModelVersion[], a: string, b: string) => versions.findIndex((m) => m.v === a) > versions.findIndex((m) => m.v === b);


/** Marks a version live (the previous live one becomes "previous"); used by every push and rollback. */
export function markLive(version: string, via?: 'rollback' | 'forward') {
  const at = new Date(scenarioNow()).toISOString();
  registryStore.set((s) => {
    const cur = s.versions.find((m) => m.state === 'live');
    if (cur?.v === version) return s;
    return {
      ...s,
      versions: s.versions.map((m) =>
        m.v === version
          ? { ...m, state: 'live', pushed: at, replaced: undefined, via }
          : m.state === 'live'
            ? { ...m, state: 'previous', replaced: at, via: undefined }
            : m,
      ),
    };
  });
}

/** Units that install the live version when their link returns. */
export function setPending(ids: string[]) {
  registryStore.set((s) => ({ ...s, pending: ids }));
}
