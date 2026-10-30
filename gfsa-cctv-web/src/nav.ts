import type { IconName } from './components/Icon';
import type { RoleId } from './data/types';

export interface NavItem {
  to: string;
  label: string;
  labelEs: string;
  icon: IconName;
  /** Roles that may open the screen. Omitted = every shore role. */
  roles?: RoleId[];
}

const SHORE_OPS: RoleId[] = ['duty_officer', 'ops_manager', 'fleet_super', 'safety_admin', 'reviewer', 'master'];
const MANAGERS: RoleId[] = ['ops_manager', 'fleet_super', 'safety_admin', 'tenant_admin'];
const CONFIG: RoleId[] = ['safety_admin'];
const ADMIN: RoleId[] = ['tenant_admin'];

// Grouped as on the design canvas's navigation rail; a divider separates groups.
export const navGroups: NavItem[][] = [
  [
    { to: '/', label: 'Operations center', labelEs: 'Centro de operaciones', icon: 'dashboard', roles: SHORE_OPS },
    { to: '/video-wall', label: 'Video wall', labelEs: 'Videowall', icon: 'grid', roles: ['duty_officer', 'ops_manager', 'fleet_super', 'safety_admin', 'master'] },
    { to: '/alarms', label: 'Alarms and events', labelEs: 'Alarmas y eventos', icon: 'bell', roles: SHORE_OPS },
    { to: '/voyages', label: 'Voyages', labelEs: 'Viajes', icon: 'route', roles: ['duty_officer', 'ops_manager', 'fleet_super', 'safety_admin', 'reviewer'] },
  ],
  [
    { to: '/config/use-cases', label: 'Use cases', labelEs: 'Casos de uso', icon: 'sliders', roles: CONFIG },
    { to: '/config/cameras', label: 'Cameras and zones', labelEs: 'Cámaras y zonas', icon: 'video', roles: CONFIG },
    { to: '/config/routing', label: 'Alert routing', labelEs: 'Enrutamiento de alertas', icon: 'share', roles: CONFIG },
    { to: '/config/edge-units', label: 'Edge units', labelEs: 'Unidades de borde', icon: 'chip', roles: CONFIG },
  ],
  [
    { to: '/reports', label: 'Reports', labelEs: 'Informes', icon: 'file', roles: [...MANAGERS, 'duty_officer'] },
    { to: '/insights/models', label: 'Model performance', labelEs: 'Rendimiento de modelos', icon: 'activity', roles: ['safety_admin', 'reviewer'] },
  ],
  [
    { to: '/admin/users', label: 'Users and roles', labelEs: 'Usuarios y roles', icon: 'users', roles: ADMIN },
    { to: '/admin/audit', label: 'Audit log', labelEs: 'Registro de auditoría', icon: 'list', roles: ADMIN },
    { to: '/admin/integrations', label: 'Integrations', labelEs: 'Integraciones', icon: 'plug', roles: ADMIN },
    { to: '/admin/plan', label: 'Plan and usage', labelEs: 'Plan y uso', icon: 'card', roles: ADMIN },
  ],
];

export const allNav = navGroups.flat();

export const canOpen = (role: RoleId, item: NavItem) => !item.roles || item.roles.includes(role);

/** Where a role lands after sign-in. */
export const homeFor = (role: RoleId) => (role === 'master' ? '/wheelhouse' : role === 'tenant_admin' ? '/admin/users' : '/');
