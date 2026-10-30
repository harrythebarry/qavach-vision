import type { Permission, Role, RoleId, User } from './types';

export const roles: Role[] = [
  { id: 'duty_officer', name: 'Duty officer', nameEs: 'Oficial de guardia', short: 'DO', where: 'Shore operations' },
  { id: 'ops_manager', name: 'Operations manager', nameEs: 'Gerente de operaciones', short: 'OM', where: 'Shore' },
  { id: 'fleet_super', name: 'Fleet superintendent', nameEs: 'Superintendente de flota', short: 'FS', where: 'Shore' },
  { id: 'safety_admin', name: 'Safety administrator', nameEs: 'Administrador de seguridad', short: 'SA', where: 'Shore, configuration' },
  { id: 'reviewer', name: 'Reviewer', nameEs: 'Revisor', short: 'RV', where: 'Shore' },
  { id: 'master', name: 'Master', nameEs: 'Capitán', short: 'MA', where: 'Wheelhouse' },
  { id: 'tenant_admin', name: 'Tenant administrator', nameEs: 'Administrador del inquilino', short: 'TA', where: 'GFSA IT' },
];

export const roleById = (id: RoleId) => roles.find((r) => r.id === id)!;

export const permissionLabels: { id: Permission; label: string; note?: string }[] = [
  { id: 'view_live', label: 'View live video' },
  { id: 'view_clips', label: 'View clips' },
  { id: 'acknowledge', label: 'Acknowledge alarms' },
  { id: 'classify', label: 'Classify events' },
  { id: 'export_clips', label: 'Export clips', note: 'Always watermarked' },
  { id: 'edit_use_cases', label: 'Edit use cases and zones' },
  { id: 'push_models', label: 'Push models to vessels' },
  { id: 'manage_users', label: 'Manage users' },
  { id: 'plan_billing', label: 'Plan and billing' },
  { id: 'read_audit', label: 'Read the audit log' },
];

/** ADM-02: permissions follow the role, not the person. */
export const rolePermissions: Record<RoleId, Permission[]> = {
  duty_officer: ['view_live', 'view_clips', 'acknowledge', 'classify'],
  ops_manager: ['view_live', 'view_clips', 'acknowledge', 'export_clips'],
  fleet_super: ['view_live', 'view_clips', 'acknowledge', 'export_clips'],
  safety_admin: ['view_live', 'view_clips', 'classify', 'export_clips', 'edit_use_cases', 'push_models'],
  reviewer: ['view_clips', 'classify', 'export_clips'],
  master: ['view_live', 'view_clips', 'acknowledge'],
  tenant_admin: ['manage_users', 'plan_billing', 'read_audit'],
};

export const can = (role: RoleId, p: Permission) => rolePermissions[role].includes(p);

export const users: User[] = [
  { id: 'u1', name: 'Marta Benítez', initials: 'MB', email: 'm.benitez@gfsa.example', role: 'duty_officer', roleNote: 'Day shift', channels: ['WhatsApp', 'SMS'], mfa: 'on', lastActive: '14:36 now', status: 'active', language: 'es' },
  { id: 'u2', name: 'Carlos Giménez', initials: 'CG', email: 'c.gimenez@gfsa.example', role: 'duty_officer', roleNote: 'Night shift', channels: ['WhatsApp', 'SMS'], mfa: 'on', lastActive: '15 Oct 06:58', status: 'active', language: 'es' },
  { id: 'u3', name: 'Lucía Ortiz', initials: 'LO', email: 'l.ortiz@gfsa.example', role: 'ops_manager', channels: ['WhatsApp', 'Email'], mfa: 'on', lastActive: '14:12', status: 'active', language: 'es' },
  { id: 'u4', name: 'Óscar Ledesma', initials: 'OL', email: 'o.ledesma@gfsa.example', role: 'ops_manager', roleNote: 'Deputy', channels: ['WhatsApp', 'Email'], mfa: 'on', lastActive: '14 Oct 09:30', status: 'active', language: 'es' },
  { id: 'u5', name: 'Rodrigo Villalba', initials: 'RV', email: 'r.villalba@gfsa.example', role: 'fleet_super', channels: ['SMS', 'Email'], mfa: 'on', lastActive: '14 Oct 18:40', status: 'active', language: 'es' },
  { id: 'u6', name: 'Ana Cáceres', initials: 'AC', email: 'a.caceres@gfsa.example', role: 'safety_admin', channels: ['Email'], mfa: 'on', lastActive: '14:21', status: 'active', language: 'en' },
  { id: 'u7', name: 'Julio Franco', initials: 'JF', email: 'j.franco@gfsa.example', role: 'reviewer', channels: ['Email'], mfa: 'on', lastActive: '14:30', status: 'active', language: 'es' },
  { id: 'u8', name: 'Sofía Martínez', initials: 'SM', email: 's.martinez@gfsa.example', role: 'reviewer', channels: ['Email'], mfa: 'not_enrolled', lastActive: '–', status: 'invited', language: 'es' },
  { id: 'u9', name: 'Beatriz Núñez', initials: 'BN', email: 'b.nunez@gfsa.example', role: 'reviewer', channels: ['Email'], mfa: 'on', lastActive: '12 Oct 16:03', status: 'active', language: 'es' },
  { id: 'u10', name: 'Diego Rojas', initials: 'DR', email: 'd.rojas@gfsa.example', role: 'tenant_admin', channels: ['Email'], mfa: 'on', lastActive: '14:36 now', status: 'active', language: 'en' },
  { id: 'u11', name: 'Pedro Acosta', initials: 'PA', email: 'p.acosta@gfsa.example', role: 'master', roleNote: 'GF Tuyutí convoy only', convoyId: 'tuy', channels: ['Wheelhouse display'], mfa: 'device_bound', lastActive: '14:32', status: 'active', language: 'es' },
  { id: 'u12', name: 'Hugo Ayala', initials: 'HA', email: 'h.ayala@gfsa.example', role: 'master', roleNote: 'GF Humaitá convoy only', convoyId: 'hum', channels: ['Wheelhouse display'], mfa: 'device_bound', lastActive: '13:49', status: 'active', language: 'es' },
  { id: 'u13', name: 'Ramón Duarte', initials: 'RD', email: 'r.duarte@gfsa.example', role: 'master', roleNote: 'GF Boquerón convoy only', convoyId: 'boq', channels: ['Wheelhouse display'], mfa: 'device_bound', lastActive: '14:20', status: 'active', language: 'es' },
];
