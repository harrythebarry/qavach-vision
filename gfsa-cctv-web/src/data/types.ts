// Domain types for CCTV Monitoring. Field names follow the PRD's event record
// and glossary so the mock layer can be swapped for the real API later.

export type Priority = 'P1' | 'P2' | 'P3' | 'P4';

export type LinkState = 'strong' | 'weak' | 'none';

export type CameraHealth = 'healthy' | 'degraded' | 'offline';

export type VesselKind = 'tug' | 'barge';

export interface Convoy {
  id: string;
  name: string; // "GF Tuyutí"
  tugId: string;
  bargeIds: string[];
  voyageId: string;
  link: LinkState;
  linkLabel: string; // "4G", "None · 47 min"
  linkMbps: number; // link capacity
  liveBudgetMbps: number; // 20% of the link by default
  lastSeen: string; // ISO time of last health message
  positionLabel: string; // "near Rosario"
  /** Position on the schematic route map, in % of the map box. */
  map: { x: number; y: number };
  queuedEvents: number;
}

export interface Vessel {
  id: string;
  name: string; // "Guarán F 503"
  short: string; // "F 503"
  kind: VesselKind;
  convoyId: string;
  edgeUnitId: string;
}

export interface Camera {
  id: string; // "F503-CAM-02"
  name: string; // "Port edge"
  vesselId: string;
  convoyId: string;
  edgeUnitId: string;
  position: string; // "Barge, port side"
  facing: string; // "Aft-facing"
  stream: string; // "1080p30"
  fpsToAi: number;
  health: CameraHealth;
  healthNote?: string; // "Blurred since 13:20"
  zones: number;
  useCases: number;
  lastCheck: string; // "14:30"
  image: string; // snapshot URL
  thermal?: boolean;
}

export type EdgeUnitStatus = 'reporting' | 'out_of_coverage' | 'restarting' | 'fault';

export interface EdgeUnit {
  id: string; // "F503-EU-01"
  vesselId: string;
  convoyId: string;
  module: string; // "Orin NX 16GB"
  cameras: number;
  status: EdgeUnitStatus;
  statusNote?: string;
  link: string; // "4G 0.4 Mbps" | "None 47 min"
  queue: { events: number; clips: number };
  modelVersion: string;
  modelConfirmed: boolean;
  storagePct: number;
  tempC: number;
  uptimeDays: number;
  gpuPct: number;
  inferenceMs: number;
}

export type UseCaseCategory =
  | 'Crew safety'
  | 'Fire and smoke'
  | 'Water and navigation'
  | 'Cargo and operations'
  | 'Scene checks';

export type UseCaseLevel = 'list' | 'alert' | 'act';
export type UseCaseStatus = 'off' | 'shadow' | 'live' | 'blocked';
export type UseCasePhase = 'Pilot' | 'Rollout' | 'Blocked';

export interface UseCase {
  id: string;
  name: string;
  nameEs: string;
  ruleEs: string;
  nextStepEs: string;
  responseStepsEs: string[];
  category: UseCaseCategory;
  rule: string;
  cameras: string; // camera types: "Barge edge"
  level: UseCaseLevel;
  priority: Priority;
  phase: UseCasePhase;
  status: UseCaseStatus;
  statusNote: string; // "Live · alerts on since 6 Oct" | "Shadow run · day 4 of 14"
  precision?: number; // 0..1
  recall?: number;
  falseAlertsPerCamDay?: number;
  events24h: number;
  responseSteps: string[];
  nextStep: string; // shown on the wheelhouse display
  blockedReason?: string;
}

/** ALM-02: raised → acknowledged on board → acknowledged ashore → resolved → closed */
export type AlarmState = 'raised' | 'ack_board' | 'ack_shore' | 'resolved' | 'closed';

export type Classification = 'accepted' | 'rejected' | 'false_alert';

export interface ActivityEntry {
  at: string; // ISO
  text: string;
  textEs?: string;
  actor: string;
  pending?: boolean;
}

export interface Detection {
  label: string; // "No life jacket"
  confidence: number;
  /** Bounding box in % of the frame. */
  box: { x: number; y: number; w: number; h: number };
  /** Zone polygon in % of the frame ("x,y x,y …"). */
  zone?: string;
  zoneName?: string;
}

export interface Alarm {
  id: string; // "ALM-26-0318"
  eventId: string; // "EV-26-041-0318"
  priority: Priority;
  title: string;
  titleEs?: string;
  description: string;
  descriptionEs?: string;
  useCaseId: string;
  convoyId: string;
  vesselId?: string;
  cameraId?: string;
  voyageId?: string;
  raisedAt: string; // ISO
  state: AlarmState;
  stateTimes: Partial<Record<AlarmState, string>>;
  /** Human-readable state shown in tables when it differs from the ladder. */
  stateLabel?: string;
  stateLabelEs?: string;
  owner?: string; // user name, or "System"
  /** ISO time the next escalation step fires, when it applies. */
  escalatesAt?: string;
  escalatesTo?: string;
  /** Start of the shore escalation clock (alarm received ashore); ladder timers count from here. */
  escalationBase?: string;
  /** Who has been messaged so far on the ladder (RT-01). */
  escalatedTo?: string[];
  /** Reminders sent to the current step (RT-03: every 2 min, 3 at most). */
  reminders?: number;
  response?: string; // short note: "Crew cleaning lens"
  responseEs?: string;
  classification?: Classification;
  falseReason?: string;
  stepsDone: Record<number, { by: string; at: string }>;
  activity: ActivityEntry[];
  detection?: Detection;
  position?: string; // "−32.95, −60.62"
  models?: string;
  evidence: { name: string; meta: string; hash?: string }[];
}

/** An event waiting in the review queue (not necessarily an alarm). */
export interface ReviewEvent {
  id: string;
  /** Arrived late from a convoy that was out of coverage (store and forward). */
  queued?: boolean;
  useCaseId: string;
  convoyId: string;
  vesselId: string;
  cameraId: string;
  at: string;
  confidence: number;
  shadow: boolean; // raised by a use case still in its shadow run
  classification?: Classification;
  falseReason?: string;
  detection?: Detection;
}

export type RoleId =
  | 'duty_officer'
  | 'ops_manager'
  | 'fleet_super'
  | 'safety_admin'
  | 'reviewer'
  | 'master'
  | 'tenant_admin';

export interface Role {
  id: RoleId;
  name: string;
  nameEs: string;
  short: string; // "DO"
  where: string;
}

export type Permission =
  | 'view_live'
  | 'view_clips'
  | 'acknowledge'
  | 'classify'
  | 'export_clips'
  | 'edit_use_cases'
  | 'push_models'
  | 'manage_users'
  | 'plan_billing'
  | 'read_audit';

export interface User {
  id: string;
  name: string;
  initials: string;
  email: string;
  role: RoleId;
  roleNote?: string; // "Day shift", "GF Tuyutí convoy only"
  convoyId?: string; // masters only
  channels: string[];
  mfa: 'on' | 'not_enrolled' | 'device_bound';
  lastActive: string;
  status: 'active' | 'invited' | 'suspended';
  language: 'es' | 'en';
}

export type VoyageStatus = 'under_way' | 'in_port' | 'completed';

export interface Voyage {
  id: string; // "VOY-26-041"
  convoyId: string;
  route: string; // "Asunción to Montevideo"
  status: VoyageStatus;
  statusNote: string; // "Under way · day 5 of 7"
  departedAt: string;
  nextCall: string; // "Buenos Aires due 16 Oct 22:00"
  events: number;
  toReview: number;
  alarms: number;
  openAlarms: number;
  reeferOnTime: [number, number];
  cargoDifferences: number;
}

export type AuditCategory =
  | 'view'
  | 'export'
  | 'review'
  | 'alarm'
  | 'config'
  | 'user'
  | 'signin'
  | 'alert'
  | 'report'
  | 'system';

export interface AuditEntry {
  seq: number;
  at: string;
  actor: string;
  role: string; // "Duty officer" | "Automated"
  action: string; // "Viewed live", "Exported clip"
  target: string; // object: "F503-CAM-02", "ALM-26-0318"
  details?: string;
  source?: string; // "Console 10.20.4.17", "Phone page"
  ip?: string;
  result?: 'ok' | 'failed';
  category?: AuditCategory;
  convoyId?: string;
  hash: string;
  prevHash: string;
}
