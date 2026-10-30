import type { Pt, SceneKind, Zone, ZonePurpose } from '../data/types';

// Zones the safety admin drew on the sample cameras, lined up with the
// drawings in Scene.tsx (% of the view). Mirrored variants flip x.

type ZoneSeed = { name: string; purpose: ZonePurpose; kind?: 'polygon' | 'line'; points: Pt[] };

const SEEDS: Record<SceneKind, ZoneSeed[]> = {
  quay: [
    { name: 'Crane exclusion zone', purpose: 'exclusion', points: [[28, 62], [72, 60], [76, 94], [24, 96]] },
    { name: 'Apron walkway', purpose: 'walkway', points: [[80, 58], [95, 57], [100, 100], [86, 100]] },
    { name: 'Quay edge', purpose: 'line', kind: 'line', points: [[0, 55.5], [100, 52.8]] },
  ],
  deck: [
    { name: 'Deck walkway', purpose: 'walkway', points: [[59.4, 100], [84.4, 100], [54.4, 44.4], [51.6, 44.4]] },
    { name: 'Deck edge', purpose: 'deck-edge', kind: 'line', points: [[87.5, 100], [54.7, 43.9]] },
    { name: 'Lashing area', purpose: 'restricted', points: [[0, 72], [36, 62], [40, 84], [0, 100]] },
  ],
  yard: [
    { name: 'RTG lane', purpose: 'vehicle-lane', points: [[45.3, 46], [54.7, 46], [100, 100], [0, 100]] },
    { name: 'Pedestrian walkway', purpose: 'walkway', points: [[0, 83], [44.7, 47.8], [46.6, 47.8], [9.4, 100], [0, 100]] },
  ],
  reefer: [
    { name: 'Reefer gantry', purpose: 'work-area', points: [[0, 54], [100, 54], [100, 63], [0, 63]] },
    { name: 'Upper tiers', purpose: 'restricted', points: [[2, 20], [98, 20], [98, 52], [2, 52]] },
  ],
  gate: [
    { name: 'Pedestrian crossing', purpose: 'walkway', points: [[1, 79], [99, 79], [99, 88], [1, 88]] },
    { name: 'Truck lanes', purpose: 'vehicle-lane', points: [[0, 60], [100, 60], [100, 76], [0, 76]] },
    { name: 'Stop line', purpose: 'line', kind: 'line', points: [[0, 74.4], [100, 74.4]] },
  ],
  workshop: [
    { name: 'Lifting area', purpose: 'exclusion', points: [[33, 50], [80, 50], [80, 69], [33, 69]] },
    { name: 'Workshop walkway', purpose: 'walkway', points: [[0, 70], [100, 70], [100, 89], [0, 89]] },
    { name: 'Hot work bay', purpose: 'restricted', points: [[9, 19], [36, 19], [36, 50], [9, 50]] },
  ],
  hazmat: [
    { name: 'IMDG fenced bay', purpose: 'restricted', points: [[9.4, 83], [18.8, 47], [81.2, 47], [90.6, 83]] },
    { name: 'Bay gate', purpose: 'line', kind: 'line', points: [[39, 83.5], [61, 83.5]] },
  ],
  perimeter: [
    { name: 'Fence line', purpose: 'line', kind: 'line', points: [[0, 64], [100, 44.4]] },
    { name: 'Buffer zone', purpose: 'restricted', points: [[0, 64], [100, 44.4], [100, 58], [0, 91.6]] },
  ],
};

export function defaultZones(scene: SceneKind, variant: number, cameraId: string): Zone[] {
  const mirror = variant % 2 === 1;
  return SEEDS[scene].map((z, i) => ({
    id: `${cameraId}-Z${i + 1}`,
    name: z.name,
    purpose: z.purpose,
    kind: z.kind ?? 'polygon',
    points: z.points.map(([x, y]) => [mirror ? Math.round((100 - x) * 10) / 10 : x, y] as Pt),
  }));
}

export const ZONE_COLORS: Record<ZonePurpose, string> = {
  walkway: '#3DD68C',
  restricted: '#FF5C7A',
  exclusion: '#FFB45C',
  'deck-edge': '#FF5C7A',
  'work-area': '#7D9BFF',
  'vehicle-lane': '#FFD166',
  line: '#FF5C7A',
};

export const PURPOSE_LABEL: Record<ZonePurpose, string> = {
  walkway: 'Walkway (safe path)',
  restricted: 'Restricted area',
  exclusion: 'Exclusion zone',
  'deck-edge': 'Deck or quay edge',
  'work-area': 'Work area',
  'vehicle-lane': 'Vehicle lane',
  line: 'Line to cross',
};
