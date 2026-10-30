// Deterministic 64-hex-character digest for the demo's hash-chained audit log.
// NOT cryptographic: the production log is chained with SHA-256 on the server.
export function fakeHash(input: string): string {
  let out = '';
  let h1 = 0x811c9dc5;
  for (let round = 0; round < 8; round++) {
    for (let i = 0; i < input.length; i++) {
      h1 ^= input.charCodeAt(i) + round;
      h1 = Math.imul(h1, 0x01000193) >>> 0;
    }
    out += h1.toString(16).padStart(8, '0');
  }
  return out;
}

/** "4f9a…c21e" */
export const shortHash = (h: string) => `${h.slice(0, 4)}…${h.slice(-4)}`;

/**
 * ADM-03: what each audit entry's hash covers: every recorded field, then the
 * previous entry's hash. Shared by the seed log (data/audit.ts), live entries
 * (state/AppState.tsx) and the audit log's chain check, so they cannot drift.
 */
export interface AuditHashFields {
  seq: number;
  at: string;
  actor: string;
  role: string;
  action: string;
  target: string;
  details?: string;
  source?: string;
  result?: string;
  category?: string;
  convoyId?: string;
}

export const auditHashBase = (e: AuditHashFields) =>
  [e.seq, e.at, e.actor, e.role, e.action, e.target, e.details ?? '', e.source ?? '', e.result ?? 'ok', e.category ?? '', e.convoyId ?? ''].join('|') + '|';

export const auditHash = (e: AuditHashFields, prevHash: string) => fakeHash(auditHashBase(e) + prevHash);
