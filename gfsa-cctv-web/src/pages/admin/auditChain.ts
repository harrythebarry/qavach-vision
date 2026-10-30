import { auditHashBase, fakeHash } from '../../lib/hash';
import type { AuditCategory, AuditEntry } from '../../data/types';

export type ChainResult =
  | { ok: true; count: number; first: number; last: number }
  | { ok: false; count: number; first: number; brokenSeq: number; reason: string; reasonEs: string };

/**
 * What each hash covers: every recorded field (seq, time, actor, role, action,
 * object, details, source, result, category, convoy) and then the previous
 * entry's hash — the same input as the seed chain (data/audit.ts) and live
 * entries (appendAudit in state/AppState.tsx), from lib/hash.ts. Editing any
 * field of an entry breaks the chain at that entry.
 */
export const hashBase = (e: AuditEntry) => auditHashBase(e);

/** The hash the entry's contents produce now (compare with the stored one). */
export const recomputeHash = (e: AuditEntry) => fakeHash(hashBase(e) + e.prevHash);

/** ADM-03: recompute the hash chain oldest first. */
export function verifyChain(newestFirst: AuditEntry[]): ChainResult {
  const list = [...newestFirst].reverse();
  const first = list[0]?.seq ?? 0;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const prev = list[i - 1];
    const broken = (reason: string, reasonEs: string): ChainResult => ({ ok: false, count: i, first, brokenSeq: e.seq, reason, reasonEs });
    if (prev) {
      if (e.seq !== prev.seq + 1) return broken(`Sequence gap: expected ${prev.seq + 1}`, `Salto de secuencia: se esperaba ${prev.seq + 1}`);
      if (e.prevHash !== prev.hash)
        return broken(`Previous hash does not match entry ${prev.seq}`, `El hash anterior no coincide con la entrada ${prev.seq}`);
    }
    const matches = recomputeHash(e) === e.hash || (!prev && fakeHash(hashBase(e)) === e.hash);
    if (!matches) return broken('Stored hash does not match the entry contents', 'El hash guardado no coincide con el contenido de la entrada');
  }
  return { ok: true, count: list.length, first, last: list[list.length - 1]?.seq ?? 0 };
}

// ---------- Tamper demo ----------

export type TamperField = 'actor' | 'action' | 'target';

export interface TamperCase {
  /** What was changed in the copy. */
  edit: { seq: number; field: TamperField; from: string; to: string };
  /** Edited only: the stored hash no longer matches. */
  edited: ChainResult;
  storedHash: string;
  recomputedHash: string;
  /** Edited and re-hashed: the next entry's previous hash no longer matches. Absent for the newest entry. */
  rehashed?: ChainResult;
}

/**
 * Demo only: verifies a copy of the log with one entry altered, the way someone
 * covering their tracks would (an export turned into a view, or another actor).
 * The real log is never touched.
 */
export function tamperedCopyCheck(newestFirst: AuditEntry[], seq: number): TamperCase | undefined {
  const original = newestFirst.find((e) => e.seq === seq);
  if (!original) return undefined;
  let field: TamperField;
  let to: string;
  if (/^Exported/.test(original.action)) {
    field = 'action';
    to = original.action.replace(/^Exported/, 'Viewed');
  } else {
    field = 'actor';
    to = newestFirst.find((e) => e.actor !== original.actor && e.actor !== 'System')?.actor ?? 'Someone else';
  }
  const altered: AuditEntry = { ...original, [field]: to };
  const copy = newestFirst.map((e) => (e.seq === seq ? altered : e));
  const isNewest = newestFirst[0]?.seq === seq;
  const rehashedEntry: AuditEntry = { ...altered, hash: recomputeHash(altered) };
  return {
    edit: { seq, field, from: original[field], to },
    edited: verifyChain(copy),
    storedHash: original.hash,
    recomputedHash: recomputeHash(altered),
    rehashed: isNewest ? undefined : verifyChain(newestFirst.map((e) => (e.seq === seq ? rehashedEntry : e))),
  };
}

// ---------- Labels ----------

export const CATEGORY_LABEL: Record<AuditCategory, [string, string]> = {
  view: ['Views', 'Visualizaciones'],
  export: ['Exports', 'Exportaciones'],
  review: ['Reviews', 'Revisiones'],
  alarm: ['Alarm handling', 'Gestión de alarmas'],
  config: ['Configuration', 'Configuración'],
  user: ['User admin', 'Administración de usuarios'],
  signin: ['Sign-ins', 'Inicios de sesión'],
  alert: ['Alerts sent', 'Alertas enviadas'],
  report: ['Reports sent', 'Informes enviados'],
  system: ['System events', 'Eventos del sistema'],
};

export const CATEGORIES = Object.keys(CATEGORY_LABEL) as AuditCategory[];

export type ObjectType =
  | 'Alarms'
  | 'Events'
  | 'Cameras'
  | 'Clips'
  | 'Use cases'
  | 'Users'
  | 'Reports'
  | 'Voyages'
  | 'Integrations'
  | 'Plan and billing'
  | 'Support cases'
  | 'Audit log'
  | 'Console'
  | 'Other';

export const OBJECT_TYPE_LABEL: Record<ObjectType, [string, string]> = {
  Alarms: ['Alarms', 'Alarmas'],
  Events: ['Events', 'Eventos'],
  Cameras: ['Cameras', 'Cámaras'],
  Clips: ['Clips', 'Clips'],
  'Use cases': ['Use cases', 'Casos de uso'],
  Users: ['Users', 'Usuarios'],
  Reports: ['Reports', 'Informes'],
  Voyages: ['Voyages', 'Viajes'],
  Integrations: ['Integrations', 'Integraciones'],
  'Plan and billing': ['Plan and billing', 'Plan y facturación'],
  'Support cases': ['Support cases', 'Casos de soporte'],
  'Audit log': ['Audit log', 'Registro de auditoría'],
  Console: ['Console', 'Consola'],
  Other: ['Other', 'Otros'],
};

export const OBJECT_TYPES = Object.keys(OBJECT_TYPE_LABEL) as ObjectType[];

/** Object type of an entry, read from its action and target. */
export function objectTypeOf(e: AuditEntry): ObjectType {
  const a = e.action.toLowerCase();
  const t = e.target;
  if (a.includes('clip')) return 'Clips';
  if (/^ALM-/.test(t)) return 'Alarms';
  if (/^EV-/.test(t)) return 'Events';
  if (/^VOY-/.test(t)) return 'Voyages';
  if (/^SUP-/.test(t) || a.includes('support case')) return 'Support cases';
  if (/^(INV|CHG)-/.test(t) || /^GFSA-\d{4}-\d+/.test(t) || /plan|billing|usage report|invoice|agreement/.test(a)) return 'Plan and billing';
  if (a.includes('audit') || /^Copy of entries/.test(t)) return 'Audit log';
  if (/-CAM-|cameras?\b/i.test(t)) return 'Cameras';
  if (/\bv\d+\.\d+/.test(t) || a.includes('use case')) return 'Use cases';
  if (a.includes('integration') || a.includes('connect') || e.source === 'Connect integration') return 'Integrations';
  if (e.category === 'user') return 'Users';
  if (e.category === 'report' || /report|summary/i.test(t)) return 'Reports';
  if (/^(Console|Session|SSO)/.test(t) || e.category === 'signin') return 'Console';
  return 'Other';
}

/** Audit entry ID as shown to people: AUD-26-018407. */
export const entryId = (seq: number) => `AUD-26-${String(seq).padStart(6, '0')}`;
