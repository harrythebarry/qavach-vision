import { useMemo } from 'react';
import { convoys as seedConvoys, edgeUnits as seedUnits, vessels } from '../data/fleet';
import type { Camera, Convoy, EdgeUnit, Vessel } from '../data/types';
import { createStore, useStore } from '../lib/persist';
import { camStore } from './configStore';

// Live fleet state shared by every screen: convoy link and position (OPS-02),
// edge unit health (EU-01) and the camera inventory (CAM-01, from the config
// store so cameras added on "Cameras and zones" show up everywhere).
// The live engine (state/engine.tsx) updates it as health messages arrive.

export const convoyStore = createStore<Convoy[]>('fleet.convoys', () => seedConvoys.map((c) => ({ ...c, map: { ...c.map } })));
export const unitStore = createStore<EdgeUnit[]>('fleet.units', () => seedUnits.map((u) => ({ ...u, queue: { ...u.queue } })));

export interface Fleet {
  convoys: Convoy[];
  vessels: Vessel[];
  cameras: Camera[];
  edgeUnits: EdgeUnit[];
  convoyById: (id?: string) => Convoy | undefined;
  vesselById: (id?: string) => Vessel | undefined;
  cameraById: (id?: string) => Camera | undefined;
  edgeUnitById: (id?: string) => EdgeUnit | undefined;
  vesselsOf: (convoyId: string) => Vessel[];
  camerasOf: (convoyId: string) => Camera[];
  camerasOnVessel: (vesselId: string) => Camera[];
  unitsOf: (convoyId: string) => EdgeUnit[];
  /** "Guarán F 503 · Port edge" */
  cameraLabel: (cameraId?: string) => string;
}

/** The live fleet. Prefer this over the static seed exports in data/fleet.ts. */
export function useFleet(): Fleet {
  const convoys = useStore(convoyStore);
  const edgeUnits = useStore(unitStore);
  const cameras = useStore(camStore).cameras;
  return useMemo(() => {
    const vesselById = (id?: string) => vessels.find((v) => v.id === id);
    const cameraById = (id?: string) => cameras.find((c) => c.id === id);
    return {
      convoys,
      vessels,
      cameras,
      edgeUnits,
      convoyById: (id) => convoys.find((c) => c.id === id),
      vesselById,
      cameraById,
      edgeUnitById: (id) => edgeUnits.find((u) => u.id === id),
      vesselsOf: (cid) => vessels.filter((v) => v.convoyId === cid),
      camerasOf: (cid) => cameras.filter((c) => c.convoyId === cid),
      camerasOnVessel: (vid) => cameras.filter((c) => c.vesselId === vid),
      unitsOf: (cid) => edgeUnits.filter((u) => u.convoyId === cid),
      cameraLabel: (id) => {
        const cam = cameraById(id);
        return cam ? `${vesselById(cam.vesselId)?.name ?? ''} · ${cam.name}` : '';
      },
    };
  }, [convoys, edgeUnits, cameras]);
}

// ---------- Mutations (used by the live engine and the edge units screen) ----------

export function updateConvoy(id: string, patch: Partial<Convoy>) {
  convoyStore.set((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));
}

export function updateUnit(id: string, patch: Partial<EdgeUnit> | ((u: EdgeUnit) => Partial<EdgeUnit>)) {
  unitStore.set((list) => list.map((u) => (u.id === id ? { ...u, ...(typeof patch === 'function' ? patch(u) : patch) } : u)));
}

export function updateCamera(id: string, patch: Partial<Camera>) {
  camStore.set((s) => ({ ...s, cameras: s.cameras.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
}
