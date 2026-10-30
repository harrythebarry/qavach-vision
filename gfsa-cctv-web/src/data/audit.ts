import { auditHash } from '../lib/hash';
import type { AuditCategory, AuditEntry } from './types';

type Seed = [
  time: string,
  actor: string,
  role: string,
  action: string,
  target: string,
  details: string,
  source: string,
  category: AuditCategory,
  convoyId?: string,
  result?: 'ok' | 'failed',
];

// Oldest first; the chain is built in this order and shown newest first.
const seeds: Seed[] = [
  ['06:00:00', 'System', 'Automated', 'Sent report', 'Daily summary × 10', '14 Oct, to Operations manager and masters', 'Reports', 'report'],
  ['07:45:12', 'Lucía Ortiz', 'Operations manager', 'Sign-in attempt', 'Console', 'Wrong MFA code', 'Console 10.20.4.40', 'signin', undefined, 'failed'],
  ['07:45:40', 'Lucía Ortiz', 'Operations manager', 'Signed in', 'Console', 'Single sign-on, MFA', 'Console 10.20.4.40', 'signin'],
  ['09:12:44', 'Diego Rojas', 'Tenant administrator', 'Invited user', 'Sofía Martínez', 'Role Reviewer', 'Console 10.20.4.12', 'user'],
  ['11:02:16', 'Lucía Ortiz', 'Operations manager', 'Closed alarm', 'ALM-26-0311', 'Crew briefed', 'Console 10.20.4.40', 'alarm', 'tuy'],
  ['12:41:05', 'Julio Franco', 'Reviewer', 'Classified event', 'ALM-26-0312', 'False alert, reflection', 'Console 10.20.4.22', 'review', 'boq'],
  ['12:47:30', 'Julio Franco', 'Reviewer', 'Classified event', 'ALM-26-0313', 'Accepted', 'Console 10.20.4.22', 'review', 'tuy'],
  ['12:58:21', 'Julio Franco', 'Reviewer', 'Exported clip', 'ALM-26-0313', 'Watermark WM-26-1187, 3.1 MB', 'Console 10.20.4.22', 'export', 'tuy'],
  ['13:49:10', 'System', 'Automated', 'Convoy out of coverage', 'GF Humaitá convoy', 'Last position near Goya', 'Event service', 'system', 'hum'],
  ['13:52:40', 'Marta Benítez', 'Duty officer', 'Assigned alarm', 'ALM-26-0314', 'To herself', 'Console 10.20.4.17', 'alarm', 'tuy'],
  ['14:15:00', 'System', 'Automated', 'Raised alarm', 'ALM-26-0317', '14:00 reefer round not seen', 'Event service', 'alarm', 'tuy'],
  ['14:21:14', 'Ana Cáceres', 'Safety administrator', 'Saved draft', 'Life jacket near the water v1.4.3', 'Confidence 0.60, repeat 10 min', 'Console 10.20.4.31', 'config'],
  ['14:30:00', 'System', 'Automated', 'Scene check', '30 cameras', '29 passed, TUY-CAM-03 degraded', 'Scene checks', 'system'],
  ['14:32:09', 'Pedro Acosta', 'Master', 'Acknowledged alarm', 'ALM-26-0318', 'On the wheelhouse display', 'Wheelhouse, GF Tuyutí', 'alarm', 'tuy'],
  ['14:32:51', 'System', 'Automated', 'Received event', 'EV-26-041-0318', 'From F503-EU-01 over 4G', 'Event service', 'system', 'tuy'],
  ['14:32:52', 'System', 'Automated', 'Sent alert', 'ALM-26-0318', 'WhatsApp and SMS to the duty officer', 'Alert routing', 'alert', 'tuy'],
  ['14:34:58', 'Marta Benítez', 'Duty officer', 'Viewed clip', 'ALM-26-0318', '15 s clip on the phone page', 'Phone page', 'view', 'tuy'],
  ['14:36:02', 'Marta Benítez', 'Duty officer', 'Viewed live', 'F503-CAM-02', 'Video wall, focus tile', 'Console 10.20.4.17', 'view', 'tuy'],
];

const chain: AuditEntry[] = [];
let prev = '0'.repeat(64);
seeds.forEach(([time, actor, role, action, target, details, source, category, convoyId, result], i) => {
  const at = `2026-10-15T${time}-03:00`;
  const seq = 18_400 + i;
  const fields = { seq, at, actor, role, action, target, details, source, result: result ?? 'ok', category, convoyId };
  const hash = auditHash(fields, prev);
  chain.push({ ...fields, hash, prevHash: prev });
  prev = hash;
});

export const initialAudit: AuditEntry[] = chain.reverse();
