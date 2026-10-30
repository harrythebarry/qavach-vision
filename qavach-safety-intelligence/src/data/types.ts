export type Pt = [number, number]; // % of the camera view, so zones survive any display size

export type SceneKind = 'quay' | 'deck' | 'yard' | 'reefer' | 'gate' | 'workshop' | 'hazmat' | 'perimeter';

export interface Area {
  id: string;
  name: string;
  scene: SceneKind;
  /** High-operational areas are pinned on walls by default. */
  highOps: boolean;
}

export type ZonePurpose = 'walkway' | 'restricted' | 'exclusion' | 'deck-edge' | 'work-area' | 'vehicle-lane' | 'line';

export interface Zone {
  id: string;
  name: string;
  purpose: ZonePurpose;
  kind: 'polygon' | 'line';
  points: Pt[];
}

export type CameraStatus = 'online' | 'degraded' | 'offline';

export interface Camera {
  id: string;
  name: string;
  areaId: string;
  scene: SceneKind;
  /** Varies the sample picture so cameras in one area don't look identical. */
  variant: number;
  status: CameraStatus;
  stream: string;
  make: string;
  resolution: string;
  fps: number;
  zones: Zone[];
  addedAt: number;
  addedBy: string;
}

export type Priority = 'P1' | 'P2' | 'P3' | 'P4';

export type Subject = 'person' | 'vehicle' | 'any';

export type Condition =
  | 'enters' // enters the zone
  | 'outside' // moves away from / is outside the zone
  | 'dwells' // stays inside the zone
  | 'crosses' // crosses a line
  | 'no-ppe' // inside the zone without the required PPE
  | 'crowd' // more than N in the zone
  | 'smoke' // smoke or flame
  | 'stopped'; // vehicle stopped

export type Ppe = 'helmet' | 'vest' | 'life jacket';

export type Schedule = 'always' | 'day' | 'night' | 'vessel-ops';

export type QavachRecordType = 'Incident' | 'Observation' | 'Near miss';
export type Classification = 'Unsafe act' | 'Unsafe condition';

export interface Rule {
  id: string;
  name: string;
  /** What the admin typed, if the rule was drafted from plain words. */
  plainText?: string;
  cameraIds: string[];
  /** Zone ids across the chosen cameras. Empty means the whole view. */
  zoneIds: string[];
  subject: Subject;
  condition: Condition;
  durationSec: number;
  ppe: Ppe[];
  crowdOver: number;
  schedule: Schedule;
  priority: Priority;
  mode: 'live' | 'test';
  qavach: QavachRecordType | 'none';
  classification: Classification;
  updatedAt: number;
  updatedBy: string;
}

export type AlertState = 'new' | 'escalated' | 'acknowledged' | 'resolved' | 'false-alarm';

export type Channel = 'wall' | 'push' | 'sms' | 'whatsapp' | 'email' | 'call';

export interface Delivery {
  at: number;
  to: string; // user id
  channel: Channel;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  reason: 'alert' | 'escalation' | 'reminder';
}

export interface ActivityEntry {
  at: number;
  text: string;
  actor: string;
}

export interface QavachRecord {
  type: QavachRecordType;
  ref: string;
  title: string;
  description: string;
  classification: Classification;
  severity: 'Low' | 'Medium' | 'High' | 'Critical';
  immediateAction: string;
  createdBy: string;
  at: number;
  /** 'auto' when the notification policy raised it on acknowledgement. */
  source: 'manual' | 'auto' | 'mobile';
}

export interface Alert {
  id: string;
  ruleId: string;
  cameraId: string;
  zoneId?: string;
  priority: Priority;
  title: string;
  detail: string;
  at: number;
  state: AlertState;
  /** Detection box, % of the camera view. */
  box: [number, number, number, number];
  confidence: number;
  ackBy?: string;
  ackAt?: number;
  ackVia?: 'wall' | 'console' | 'mobile';
  assignee?: string;
  escalatedTo?: string;
  deliveries: Delivery[];
  activity: ActivityEntry[];
  qavach?: QavachRecord;
}

export type PinnedLayout = '1' | '2x2' | '1+5' | '2x3' | '3x3';

export interface Wall {
  id: string;
  name: string;
  teamId: string;
  /** Share of the wall width given to pinned cameras; 100 means nothing rolls, 0 means everything does. */
  pinnedShare: 0 | 60 | 70 | 80 | 100;
  pinnedLayout: PinnedLayout;
  pinned: (string | null)[];
  rollingTiles: 3 | 4 | 6 | 9 | 16;
  rotation: string[];
  rotateSec: 10 | 15 | 30 | 60;
  /** Keeps the last pinned slot on whichever camera is busiest right now. */
  autoPinBusy: boolean;
  /** A camera with an open alert jumps into the first pinned slot until someone acknowledges it. */
  alertTakeover: boolean;
}

export type Role = 'Safety admin' | 'Control room operator' | 'Shift supervisor' | 'HSE manager' | 'Terminal manager';

export interface Team {
  id: string;
  name: string;
  areaIds: string[];
}

export interface User {
  id: string;
  name: string;
  role: Role;
  teamId: string;
  phone: string;
}

export interface Policy {
  priority: Priority;
  label: string;
  channels: Channel[];
  /** Roles told first; the alert goes to the people in that role on the camera's team. */
  notify: Role[];
  ackWithinMin: number;
  escalateTo: Role | 'none';
  remindEveryMin: number;
  /** When the Qavach record is raised. */
  qavach: 'on-acknowledge' | 'reviewer-decides' | 'never';
  wallTakeover: boolean;
  sound: boolean;
}
