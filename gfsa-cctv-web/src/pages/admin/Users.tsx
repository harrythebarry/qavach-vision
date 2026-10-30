import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge, Card, PageHeader, Stat, Tabs } from '../../components/ui';
import { Icon, type IconName } from '../../components/Icon';
import { useApp } from '../../state/AppState';
import { useFleet } from '../../state/fleetStore';
import { addUser, removeUser, updateUser, useUsers } from '../../state/usersStore';
import { useRouting } from '../../state/routingStore';
import { permissionLabels, roleById, rolePermissions, roles } from '../../data/users';
import type { Permission, Role, RoleId, User } from '../../data/types';
import { uid, usePersistentState } from '../../lib/persist';
import { useTr } from '../../lib/i18n';
import { useExporter } from '../../lib/exporting';
import { fmtDay, fmtSmart, scenarioNow, useNow } from '../../lib/time';
import { PageDialog } from '../config/PageDialog';
import { useLeaveGuard } from '../config/useLeaveGuard';
import { dayLabel, shiftName, targetName, type Tr } from '../config/routingText';
import './Users.css';

// ADM-01 sign-in policy, ADM-02 role permissions, user administration.
// The directory is the shared user store: alert routing picks recipients from
// it and the demo role switcher signs in as the first active user of a role.

type Tab = 'users' | 'roles' | 'policy';
type StatusFilter = 'all' | User['status'];

const SEATS = 25;
const SHORE_CHANNELS = ['WhatsApp', 'SMS', 'Email', 'Voice call'];
const WHEELHOUSE = 'Wheelhouse display';

const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

// ---------- Wording ----------

const PERM_ES: Record<Permission, [string, string?]> = {
  view_live: ['Ver video en vivo'],
  view_clips: ['Ver clips'],
  acknowledge: ['Confirmar alarmas'],
  classify: ['Clasificar eventos'],
  export_clips: ['Exportar clips', 'Siempre con marca de agua'],
  edit_use_cases: ['Editar casos de uso y zonas'],
  push_models: ['Enviar modelos a las embarcaciones'],
  manage_users: ['Administrar usuarios'],
  plan_billing: ['Plan y facturación'],
  read_audit: ['Leer el registro de auditoría'],
};

const WHERE_ES: Record<RoleId, string> = {
  duty_officer: 'Operaciones en tierra',
  ops_manager: 'Tierra',
  fleet_super: 'Tierra',
  safety_admin: 'Tierra, configuración',
  reviewer: 'Tierra',
  master: 'Puente de mando',
  tenant_admin: 'TI de GFSA',
};

const roleName = (r: Role | RoleId, tr: Tr) => {
  const role = typeof r === 'string' ? roleById(r) : r;
  return tr(role.name, role.nameEs);
};
const permLabel = (p: (typeof permissionLabels)[number], tr: Tr) => tr(p.label, PERM_ES[p.id][0]);
const permNote = (p: (typeof permissionLabels)[number], tr: Tr) => (p.note ? tr(p.note, PERM_ES[p.id][1] ?? p.note) : undefined);

function channelLabel(c: string, tr: Tr) {
  if (c === 'Email') return tr('Email', 'Correo');
  if (c === 'Voice call') return tr('Voice call', 'Llamada de voz');
  if (c === WHEELHOUSE) return tr(WHEELHOUSE, 'Pantalla del puente');
  return c;
}

function noteText(note: string, tr: Tr) {
  const known: Record<string, string> = { 'Day shift': 'Turno de día', 'Night shift': 'Turno de noche', Deputy: 'Adjunto', 'On call': 'De guardia' };
  if (known[note]) return tr(note, known[note]);
  const m = /^(.+) convoy only$/.exec(note);
  return m ? tr(note, `Solo convoy ${m[1]}`) : note;
}

const lastActiveText = (s: string, tr: Tr) => tr(s, s.replace(/\bnow\b/, 'ahora').replace(/\bOct\b/, 'oct'));

const statusLabel = (s: User['status'], tr: Tr) =>
  s === 'active' ? tr('Active', 'Activo') : s === 'invited' ? tr('Invited', 'Invitado') : tr('Suspended', 'Suspendido');

const mfaLabel = (m: User['mfa'], tr: Tr) => (m === 'on' ? tr('On', 'Activado') : m === 'device_bound' ? tr('Device-bound', 'Vinculado al dispositivo') : tr('Not enrolled', 'Sin registrar'));

// ---------- Sign-in policy (ADM-01) ----------

interface Policy {
  sso: boolean;
  mfaShore: boolean;
  sessionHours: number;
  idleMin: number;
  deviceBound: boolean;
  breakGlass: boolean;
  /** ISO time of the last saved change. */
  changedAt: string;
  changedBy: string;
}

const initialPolicy: Policy = {
  sso: true,
  mfaShore: true,
  sessionHours: 12,
  idleMin: 30,
  deviceBound: true,
  breakGlass: true,
  changedAt: '2026-10-02T10:40:00-03:00',
  changedBy: 'Diego Rojas',
};

const DIRECTORY_GROUPS: { group: string; role: RoleId }[] = [
  { group: 'GFSA-CCTV-DutyOfficers', role: 'duty_officer' },
  { group: 'GFSA-CCTV-OpsManagers', role: 'ops_manager' },
  { group: 'GFSA-CCTV-FleetSupers', role: 'fleet_super' },
  { group: 'GFSA-CCTV-SafetyAdmins', role: 'safety_admin' },
  { group: 'GFSA-CCTV-Reviewers', role: 'reviewer' },
  { group: 'GFSA-CCTV-Masters', role: 'master' },
  { group: 'GFSA-IT-TenantAdmins', role: 'tenant_admin' },
];

/** Differences as [English for the audit log, Spanish]. */
function policyDiff(a: Policy, b: Policy): [string, string][] {
  const out: [string, string][] = [];
  const on = (v: boolean): [string, string] => (v ? ['on', 'activado'] : ['off', 'desactivado']);
  if (a.sso !== b.sso) out.push([`SAML single sign-on ${on(b.sso)[0]}`, `inicio de sesión único SAML ${on(b.sso)[1]}`]);
  if (a.mfaShore !== b.mfaShore) out.push([`MFA for shore roles ${on(b.mfaShore)[0]}`, `MFA para roles en tierra ${on(b.mfaShore)[1]}`]);
  if (a.sessionHours !== b.sessionHours) out.push([`session limit ${b.sessionHours} h`, `límite de sesión ${b.sessionHours} h`]);
  if (a.idleMin !== b.idleMin) out.push([`idle timeout ${b.idleMin} min`, `cierre por inactividad ${b.idleMin} min`]);
  if (a.deviceBound !== b.deviceBound) out.push([`device-bound wheelhouse accounts ${on(b.deviceBound)[0]}`, `cuentas del puente vinculadas al dispositivo ${on(b.deviceBound)[1]}`]);
  if (a.breakGlass !== b.breakGlass) out.push([`break-glass password accounts ${on(b.breakGlass)[0]}`, `cuentas de emergencia con contraseña ${on(b.breakGlass)[1]}`]);
  return out;
}

export function UsersPage() {
  const { state, can, log, toast } = useApp();
  const tr = useTr();
  const now = useNow(30_000);
  const fleet = useFleet();
  const ex = useExporter();
  const people = useUsers();
  const routing = useRouting();
  const canManage = can('manage_users');

  const [tab, setTab] = useState<Tab>('users');
  const [invitedAt, setInvitedAt] = usePersistentState<Record<string, string>>('users.invitedAt', { u8: '2026-10-15T09:12:00-03:00' });
  const [policy, setPolicy] = usePersistentState<Policy>('users.policy', initialPolicy);
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | RoleId>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [manageId, setManageId] = useState<string | null>(null);
  const [policyDraft, setPolicyDraft] = useState<Policy | null>(null);

  const seatsUsed = people.length + 1; // + Connect service account
  const active = people.filter((u) => u.status === 'active');
  const invited = people.filter((u) => u.status === 'invited');
  const suspended = people.filter((u) => u.status === 'suspended');
  const shoreActive = active.filter((u) => u.role !== 'master');
  const mfaOn = shoreActive.filter((u) => u.mfa === 'on');
  const failedSignIns = 1 + state.audit.filter((e) => e.result === 'failed' && (e.category === 'signin' || /^Sign/.test(e.action))).length;

  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () =>
      people.filter(
        (u) =>
          (roleFilter === 'all' || u.role === roleFilter) &&
          (statusFilter === 'all' || u.status === statusFilter) &&
          (!needle ||
            u.name.toLowerCase().includes(needle) ||
            u.email.toLowerCase().includes(needle) ||
            roleById(u.role).name.toLowerCase().includes(needle) ||
            roleById(u.role).nameEs.toLowerCase().includes(needle)),
      ),
    [people, roleFilter, statusFilter, needle],
  );
  const showService =
    roleFilter === 'all' &&
    (statusFilter === 'all' || statusFilter === 'active') &&
    (!needle || 'connect integration service account cuenta de servicio integración'.includes(needle));
  const filtered = roleFilter !== 'all' || statusFilter !== 'all' || !!needle;

  /** Where alert routing uses a person: recipient rows and rota shifts. */
  const routingUse = (u: User): string[] => {
    const out: string[] = [];
    routing.recipients
      .filter((r) => r.personId === u.id)
      .forEach((r) => out.push(tr(`Alert routing recipient: ${r.role}${r.shift ? `, ${r.shift.toLowerCase()}` : ''}`, `Destinatario de alertas: ${targetName(r.role, tr)}${r.shift ? `, ${shiftName(r.shift, tr).toLowerCase()}` : ''}`)));
    const shifts = routing.rota.flatMap((d) => [
      ...(d.day === u.id ? [`${dayLabel(d.label, tr)} 07:00–19:00`] : []),
      ...(d.night === u.id ? [`${dayLabel(d.label, tr)} 19:00–07:00`] : []),
    ]);
    if (shifts.length) out.push(tr(`Duty rota: ${shifts.join(', ')}`, `Rota de guardia: ${shifts.join(', ')}`));
    return out;
  };

  const setStatus = (u: User, status: User['status']) => {
    updateUser(u.id, { status });
    if (status === 'suspended') {
      log('Suspended user', `${u.name} · ${roleById(u.role).name}`, routingUse(u).length ? 'Still listed in alert routing' : undefined);
      toast(tr(`${u.name} suspended. Their sessions end now and alerts stop going to them.`, `${u.name} suspendido. Sus sesiones terminan ahora y deja de recibir alertas.`));
    } else {
      log('Reactivated user', `${u.name} · ${roleById(u.role).name}`);
      toast(tr(`${u.name} reactivated. They sign in again through the GFSA directory.`, `${u.name} reactivado. Vuelve a iniciar sesión con el directorio de GFSA.`));
    }
  };

  const exportCsv = () => {
    ex.csv(
      'gfsa-users.csv',
      [
        [
          tr('Name', 'Nombre'),
          tr('Email', 'Correo'),
          tr('Role', 'Rol'),
          tr('Note', 'Nota'),
          tr('Convoy', 'Convoy'),
          tr('Alert channels', 'Canales de alerta'),
          'MFA',
          tr('Last active', 'Última actividad'),
          tr('Status', 'Estado'),
          tr('Language', 'Idioma'),
          tr('Invited', 'Invitado'),
        ],
        ...people.map((u) => [
          u.name,
          u.email,
          roleName(u.role, tr),
          u.roleNote ? noteText(u.roleNote, tr) : '',
          u.convoyId ? (fleet.convoyById(u.convoyId)?.name ?? u.convoyId) : tr('All convoys', 'Todos los convoyes'),
          u.channels.map((c) => channelLabel(c, tr)).join(' / '),
          mfaLabel(u.mfa, tr),
          lastActiveText(u.lastActive, tr),
          statusLabel(u.status, tr),
          u.language.toUpperCase(),
          invitedAt[u.id] ? fmtSmart(invitedAt[u.id], now) : '',
        ]),
      ],
      { action: 'Exported user list', target: 'Users and roles', details: `CSV · ${people.length} users` },
    );
  };

  const managed = people.find((u) => u.id === manageId);
  const pendingFoot = invited.length
    ? tr(
        `${invited[0].name} · sent ${invitedAt[invited[0].id] ? fmtSmart(invitedAt[invited[0].id], now) : 'today'}${invited.length > 1 ? ` · and ${invited.length - 1} more` : ''}`,
        `${invited[0].name} · enviada ${invitedAt[invited[0].id] ? fmtSmart(invitedAt[invited[0].id], now) : 'hoy'}${invited.length > 1 ? ` · y ${invited.length - 1} más` : ''}`,
      )
    : tr('None waiting', 'Ninguna pendiente');

  // ---------- Sign-in policy draft ----------

  const diffs = policyDraft ? policyDiff(policy, policyDraft) : [];
  const policyDirty = diffs.length > 0;

  const savePolicy = (): boolean => {
    if (!policyDraft || !canManage) return false;
    if (!diffs.length) {
      setPolicyDraft(null);
      return true;
    }
    setPolicy({ ...policyDraft, changedAt: new Date(scenarioNow()).toISOString(), changedBy: state.user.name });
    setPolicyDraft(null);
    log('Changed sign-in policy', 'Sign-in policy', diffs.map((d) => d[0]).join('; '));
    toast(tr(`Sign-in policy saved: ${diffs.map((d) => d[0]).join('; ')}.`, `Política de inicio de sesión guardada: ${diffs.map((d) => d[1]).join('; ')}.`));
    return true;
  };

  const leaveGuard = useLeaveGuard({
    dirty: policyDirty,
    what: tr('the sign-in policy', 'la política de inicio de sesión'),
    changes: diffs.map(([en, es]) => tr(en, es)),
    onDiscard: () => setPolicyDraft(null),
    onSave: canManage ? savePolicy : undefined,
  });

  const startPolicyEdit = () => {
    setTab('policy');
    setPolicyDraft(policy);
  };

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tr('Administration', 'Administración'), to: '/admin/users' }]}
        title={tr('Users and roles', 'Usuarios y roles')}
        sub={tr(
          `${seatsUsed} users · ${roles.length} roles · single sign-on with the GFSA directory, MFA required ashore`,
          `${seatsUsed} usuarios · ${roles.length} roles · inicio de sesión único con el directorio de GFSA, MFA obligatorio en tierra`,
        )}
        actions={
          <>
            <button type="button" className="btn" onClick={exportCsv}>
              <Icon name="download" size={16} /> {tr('Export', 'Exportar')}
            </button>
            {canManage && (
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => setInviteOpen(true)}
                disabled={seatsUsed >= SEATS}
                title={seatsUsed >= SEATS ? tr('All seats are in use: revoke an invitation or remove a user to free one', 'Todos los puestos están en uso: revoque una invitación o quite un usuario para liberar uno') : undefined}
              >
                <Icon name="plus" size={16} /> {tr('Invite user', 'Invitar usuario')}
              </button>
            )}
          </>
        }
      />

      {!canManage && (
        <div className="callout">
          <Icon name="lock" size={18} />
          <span>
            {tr(
              'Read only. Inviting, suspending and changing roles needs the Tenant administrator role.',
              'Solo lectura. Invitar, suspender y cambiar roles requiere el rol de administrador del inquilino.',
            )}
          </span>
        </div>
      )}

      <Tabs<Tab>
        label={tr('Users and roles', 'Usuarios y roles')}
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'users', label: tr('Users', 'Usuarios'), count: seatsUsed },
          { value: 'roles', label: tr('Roles', 'Roles'), count: roles.length },
          { value: 'policy', label: policyDirty ? tr('Sign-in policy · unsaved', 'Política de inicio de sesión · sin guardar') : tr('Sign-in policy', 'Política de inicio de sesión') },
        ]}
      />

      {tab === 'users' && (
        <>
          <div className="stat-grid">
            <Stat
              label={tr('Active users, 30 days', 'Usuarios activos, 30 días')}
              value={tr(`${active.length + 1} of ${seatsUsed}`, `${active.length + 1} de ${seatsUsed}`)}
              foot={
                [
                  invited.length ? tr(`${invited.length} invitation${invited.length === 1 ? '' : 's'} not yet accepted`, `${invited.length} invitaci${invited.length === 1 ? 'ón' : 'ones'} sin aceptar`) : '',
                  suspended.length ? tr(`${suspended.length} suspended`, `${suspended.length} suspendido${suspended.length === 1 ? '' : 's'}`) : '',
                ]
                  .filter(Boolean)
                  .join(' · ') || tr('Everyone signed in this month', 'Todos iniciaron sesión este mes')
              }
            />
            <Stat
              label={tr('MFA enrolled', 'MFA registrado')}
              value={tr(`${mfaOn.length} of ${shoreActive.length}`, `${mfaOn.length} de ${shoreActive.length}`)}
              aside={tr('shore users', 'usuarios en tierra')}
              foot={tr('Wheelhouse accounts are device-bound', 'Las cuentas del puente están vinculadas al dispositivo')}
            />
            <Stat label={tr('Pending invitations', 'Invitaciones pendientes')} value={invited.length} foot={pendingFoot} />
            <Stat
              label={tr('Failed sign-ins, 7 days', 'Inicios de sesión fallidos, 7 días')}
              value={failedSignIns}
              footTone="ok"
              foot={
                <span className="with-dot">
                  <Icon name="check" size={14} strokeWidth={2.4} /> {tr('None locked', 'Ninguna cuenta bloqueada')}
                </span>
              }
            />
          </div>

          <div className="row">
            <section className="card usr-main" aria-labelledby="usr-users-title">
              <div className="card__head usr-head">
                <div className="card__title">
                  <h2 id="usr-users-title">{tr('Users', 'Usuarios')}</h2>
                  <span className="card__hint">
                    {tr(`${seatsUsed} of ${SEATS} seats · all convoys unless shown`, `${seatsUsed} de ${SEATS} puestos · todos los convoyes salvo indicación`)}
                  </span>
                </div>
                <div className="usr-filters">
                  <span className="usr-search">
                    <Icon name="search" size={16} />
                    <input
                      type="search"
                      className="input"
                      aria-label={tr('Filter users', 'Filtrar usuarios')}
                      placeholder={tr('Filter users', 'Filtrar usuarios')}
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                    />
                  </span>
                  <label className="usr-inline-select">
                    {tr('Role', 'Rol')}
                    <select className="select" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as 'all' | RoleId)}>
                      <option value="all">{tr('All', 'Todos')}</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {roleName(r, tr)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="usr-inline-select">
                    {tr('Status', 'Estado')}
                    <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
                      <option value="all">{tr('All', 'Todos')}</option>
                      <option value="active">{statusLabel('active', tr)}</option>
                      <option value="invited">{statusLabel('invited', tr)}</option>
                      <option value="suspended">{statusLabel('suspended', tr)}</option>
                    </select>
                  </label>
                </div>
              </div>
              <div className="table-wrap">
                <table className="table num usr-table" style={{ minWidth: 820 }}>
                  <thead>
                    <tr>
                      <th scope="col">{tr('User', 'Usuario')}</th>
                      <th scope="col">{tr('Role', 'Rol')}</th>
                      <th scope="col">{tr('Alert channels', 'Canales de alerta')}</th>
                      <th scope="col">MFA</th>
                      <th scope="col">{tr('Last active', 'Última actividad')}</th>
                      <th scope="col">{tr('Status', 'Estado')}</th>
                      {canManage && (
                        <th scope="col">
                          <span className="sr-only">{tr('Actions', 'Acciones')}</span>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((u) => (
                      <UserRow key={u.id} u={u} canManage={canManage} isMe={u.id === state.user.id} onManage={() => setManageId(u.id)} />
                    ))}
                    {showService && (
                      <tr>
                        <td>
                          <div className="usr-user">
                            <span className="usr-avatar" aria-hidden="true">
                              <Icon name="plug" size={15} />
                            </span>
                            <span className="usr-user__text">
                              <span className="usr-user__name">{tr('Connect integration', 'Integración con Connect')}</span>
                              <span className="usr-user__mail">{tr('Two-way sync every 5 min', 'Sincronización en ambos sentidos cada 5 min')}</span>
                            </span>
                          </div>
                        </td>
                        <td>
                          {tr('Service account', 'Cuenta de servicio')}
                          <span className="sub usr-nowrap">
                            <Link to="/admin/integrations">{tr('Integrations', 'Integraciones')}</Link>
                          </span>
                        </td>
                        <td style={{ color: 'var(--muted)' }}>–</td>
                        <td>
                          <span className="usr-mfa usr-mfa--muted">
                            <Icon name="key" size={14} /> {tr('Certificate', 'Certificado')}
                          </span>
                        </td>
                        <td className="mono usr-nowrap">14:35</td>
                        <td>
                          <StatusBadge s="active" />
                        </td>
                        {canManage && <td />}
                      </tr>
                    )}
                    {!shown.length && !showService && (
                      <tr>
                        <td colSpan={canManage ? 7 : 6}>
                          <div className="empty">{tr('No users match these filters.', 'Ningún usuario coincide con estos filtros.')}</div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="usr-foot">
                <span>
                  {filtered
                    ? tr(`${shown.length + (showService ? 1 : 0)} of ${seatsUsed} users shown`, `${shown.length + (showService ? 1 : 0)} de ${seatsUsed} usuarios mostrados`)
                    : tr(`${seatsUsed} users`, `${seatsUsed} usuarios`)}{' '}
                  · {tr('roles are assigned in the GFSA directory and mirrored here', 'los roles se asignan en el directorio de GFSA y se reflejan aquí')}
                </span>
                {filtered && (
                  <button
                    type="button"
                    className="usr-linkbtn"
                    onClick={() => {
                      setQ('');
                      setRoleFilter('all');
                      setStatusFilter('all');
                    }}
                  >
                    {tr('Clear filters', 'Quitar filtros')}
                  </button>
                )}
              </div>
            </section>

            <div className="stack usr-side">
              <section className="card" aria-labelledby="usr-perm-title">
                <div className="usr-cardhead">
                  <h2 id="usr-perm-title">{tr('What each role can do', 'Qué puede hacer cada rol')}</h2>
                  <span className="card__hint">{tr('Permissions follow the role, not the person', 'Los permisos siguen al rol, no a la persona')}</span>
                </div>
                <PermissionMatrix />
                <MatrixLegend />
              </section>

              <PolicySummary policy={policy} canManage={canManage} onEdit={startPolicyEdit} />
            </div>
          </div>
        </>
      )}

      {tab === 'roles' && (
        <RolesTab
          people={people}
          onShowUsers={(r) => {
            setRoleFilter(r);
            setStatusFilter('all');
            setQ('');
            setTab('users');
          }}
        />
      )}

      {tab === 'policy' && (
        <PolicyTab
          policy={policy}
          draft={policyDraft}
          diffs={diffs}
          canManage={canManage}
          people={people}
          convoyName={(id) => fleet.convoyById(id)?.name ?? '–'}
          onEdit={() => setPolicyDraft(policy)}
          onChange={(p) => setPolicyDraft((d) => (d ? { ...d, ...p } : d))}
          onCancel={() => setPolicyDraft(null)}
          onSave={savePolicy}
        />
      )}

      <InviteDialog
        key={inviteOpen ? 'invite-open' : 'invite-closed'}
        open={inviteOpen}
        existing={people}
        seatsLeft={SEATS - seatsUsed}
        convoys={fleet.convoys}
        onClose={() => setInviteOpen(false)}
        onInvite={(u) => {
          addUser(u);
          setInvitedAt((m) => ({ ...m, [u.id]: new Date(scenarioNow()).toISOString() }));
          setInviteOpen(false);
          setStatusFilter('all');
          log('Invited user', `${u.name} · ${roleById(u.role).name}`, u.email);
          toast(
            tr(
              `Invitation sent to ${u.email}. They sign in with the GFSA directory${u.role === 'master' ? '' : ' and enrol MFA'}. They can now be picked in alert routing.`,
              `Invitación enviada a ${u.email}. Inicia sesión con el directorio de GFSA${u.role === 'master' ? '' : ' y registra MFA'}. Ya se puede elegir en el enrutamiento de alertas.`,
            ),
          );
        }}
      />

      <ManageDialog
        key={managed?.id ?? 'none'}
        user={managed}
        isMe={managed?.id === state.user.id}
        canManage={canManage}
        invitedAt={managed && invitedAt[managed.id] ? fmtSmart(invitedAt[managed.id], now) : undefined}
        routingUse={managed ? routingUse(managed) : []}
        convoys={fleet.convoys}
        onClose={() => setManageId(null)}
        onSave={(next) => {
          if (!managed) return;
          const changes: string[] = [];
          if (next.role !== managed.role) changes.push(`role ${roleById(managed.role).name} → ${roleById(next.role).name}`);
          if (next.convoyId !== managed.convoyId) changes.push(`convoy ${fleet.convoyById(next.convoyId)?.name ?? 'all'}`);
          if ((next.roleNote ?? '') !== (managed.roleNote ?? '')) changes.push(`note "${next.roleNote ?? ''}"`);
          if (next.channels.join() !== managed.channels.join()) changes.push(`channels ${next.channels.join(', ')}`);
          if (next.language !== managed.language) changes.push(`language ${next.language.toUpperCase()}`);
          setManageId(null);
          if (!changes.length) return;
          updateUser(managed.id, next);
          log(next.role !== managed.role ? 'Changed user role' : 'Updated user', `${managed.name} · ${changes.join(', ')}`);
          toast(
            next.role !== managed.role
              ? tr(
                  `${managed.name} is now ${roleById(next.role).name}. Permissions follow the new role from their next action.`,
                  `${managed.name} ahora es ${roleById(next.role).nameEs}. Los permisos siguen al nuevo rol desde su próxima acción.`,
                )
              : tr(`${managed.name} updated.`, `${managed.name} actualizado.`),
          );
        }}
        onStatus={(s) => {
          if (!managed) return;
          setStatus(managed, s);
          setManageId(null);
        }}
        onResend={() => {
          if (!managed) return;
          setInvitedAt((m) => ({ ...m, [managed.id]: new Date(scenarioNow()).toISOString() }));
          log('Resent user invitation', managed.name, managed.email);
          toast(tr(`Invitation sent again to ${managed.email}.`, `Invitación reenviada a ${managed.email}.`));
          setManageId(null);
        }}
        onRevoke={() => {
          if (!managed) return;
          removeUser(managed.id);
          setInvitedAt((m) => {
            const { [managed.id]: _gone, ...rest } = m;
            void _gone;
            return rest;
          });
          log('Revoked user invitation', managed.name, managed.email);
          toast(tr(`Invitation for ${managed.name} revoked. The seat is free again.`, `Invitación de ${managed.name} revocada. El puesto queda libre.`));
          setManageId(null);
        }}
      />

      {leaveGuard}
    </div>
  );
}

// ---------- Rows and cells ----------

function UserRow({ u, canManage, isMe, onManage }: { u: User; canManage: boolean; isMe: boolean; onManage: () => void }) {
  const tr = useTr();
  const [time, ...restActive] = u.lastActive.split(' ');
  const isNow = restActive.includes('now');
  return (
    <tr className={u.status === 'suspended' ? 'usr-row--suspended' : undefined}>
      <td>
        <div className="usr-user">
          <span className="usr-avatar" aria-hidden="true">
            {u.initials}
          </span>
          <span className="usr-user__text">
            <span className="usr-user__name">
              {u.name}
              {isMe && <span className="usr-you">{tr('You', 'Usted')}</span>}
            </span>
            <span className="usr-user__mail">{u.email}</span>
          </span>
        </div>
      </td>
      <td>
        {roleName(u.role, tr)}
        {u.roleNote && <span className="sub usr-nowrap">{noteText(u.roleNote, tr)}</span>}
      </td>
      <td>
        {u.role === 'master' ? (
          <span style={{ color: 'var(--muted)' }}>{channelLabel(WHEELHOUSE, tr)}</span>
        ) : (
          <span className="usr-chips">
            {u.channels.map((c) => (
              <span key={c} className="usr-chip">
                {channelLabel(c, tr)}
              </span>
            ))}
          </span>
        )}
      </td>
      <td>
        <MfaCell mfa={u.mfa} />
      </td>
      <td className="mono usr-nowrap" style={u.lastActive === '–' ? { color: 'var(--muted)' } : undefined}>
        {isNow ? (
          <>
            {time}
            <span className="sub usr-sans">{tr('now', 'ahora')}</span>
          </>
        ) : (
          lastActiveText(u.lastActive, tr)
        )}
      </td>
      <td>
        <StatusBadge s={u.status} />
      </td>
      {canManage && (
        <td className="right">
          <button type="button" className="btn btn--ghost btn--icon" aria-label={tr(`Manage ${u.name}`, `Administrar a ${u.name}`)} onClick={onManage}>
            <Icon name="edit" size={16} />
          </button>
        </td>
      )}
    </tr>
  );
}

function MfaCell({ mfa }: { mfa: User['mfa'] }) {
  const tr = useTr();
  if (mfa === 'on')
    return (
      <span className="usr-mfa usr-mfa--ok">
        <Icon name="check" size={14} strokeWidth={2.4} /> {mfaLabel(mfa, tr)}
      </span>
    );
  if (mfa === 'device_bound')
    return (
      <span className="usr-mfa usr-mfa--muted">
        <Icon name="screen" size={14} /> {mfaLabel(mfa, tr)}
      </span>
    );
  return (
    <span className="usr-mfa usr-mfa--warn">
      <Icon name="alert" size={14} strokeWidth={2.2} /> {mfaLabel(mfa, tr)}
    </span>
  );
}

function StatusBadge({ s }: { s: User['status'] }) {
  const tr = useTr();
  const icon: IconName = s === 'active' ? 'check' : s === 'invited' ? 'mail' : 'lock';
  return (
    <Badge tone={s === 'active' ? 'ok' : s === 'suspended' ? 'bad' : 'neutral'}>
      <Icon name={icon} size={13} strokeWidth={2.2} /> {statusLabel(s, tr)}
    </Badge>
  );
}

// ---------- ADM-02 permission matrix ----------

function PermissionMatrix({ wide = false }: { wide?: boolean }) {
  const tr = useTr();
  return (
    <div className="table-wrap">
      <table className={`usr-matrix${wide ? ' usr-matrix--wide' : ''}`}>
        <thead>
          <tr>
            <th scope="col">{tr('Permission', 'Permiso')}</th>
            {roles.map((r) => (
              <th key={r.id} scope="col" className="usr-matrix__role">
                {wide ? (
                  roleName(r, tr)
                ) : (
                  <abbr title={roleName(r, tr)} style={{ textDecoration: 'none' }}>
                    {r.short}
                  </abbr>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {permissionLabels.map((p) => (
            <tr key={p.id}>
              <th scope="row">
                {permLabel(p, tr)}
                {p.note && <span className="usr-matrix__note">{permNote(p, tr)}</span>}
              </th>
              {roles.map((r) => {
                const ok = rolePermissions[r.id].includes(p.id);
                const own = ok && r.id === 'master';
                return (
                  <td key={r.id}>
                    {ok ? (
                      <span
                        role="img"
                        aria-label={own ? tr('Allowed, own convoy only', 'Permitido, solo su convoy') : tr('Allowed', 'Permitido')}
                        className="usr-matrix__yes"
                        title={own ? tr('Own convoy only', 'Solo su convoy') : undefined}
                      >
                        <Icon name="check" size={16} strokeWidth={2.4} />
                        {own && (
                          <span className="usr-matrix__own" aria-hidden="true">
                            *
                          </span>
                        )}
                      </span>
                    ) : (
                      <span role="img" aria-label={tr('Not allowed', 'No permitido')} className="usr-matrix__no">
                        <span />
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatrixLegend() {
  const tr = useTr();
  return (
    <div className="usr-legend">
      <span>
        {roles.map((r, i) => (
          <span key={r.id}>
            {i > 0 && ' · '}
            <strong>{r.short}</strong> {roleName(r, tr)}
          </span>
        ))}
      </span>
      <span>
        {tr(
          '* Masters see their own convoy only. Every view and download is written to the audit log.',
          '* Los capitanes ven solo su propio convoy. Cada visualización y descarga queda en el registro de auditoría.',
        )}
      </span>
    </div>
  );
}

// ---------- Roles tab ----------

function RolesTab({ people, onShowUsers }: { people: User[]; onShowUsers: (r: RoleId) => void }) {
  const tr = useTr();
  return (
    <>
      <div className="callout">
        <Icon name="info" size={18} />
        <span>
          <strong>{tr('Permissions follow the role, not the person.', 'Los permisos siguen al rol, no a la persona.')}</strong>{' '}
          {tr(
            'Roles are fixed and come from the GFSA directory groups; to change what someone can do, change their role on the Users tab. Masters see their own convoy only.',
            'Los roles son fijos y vienen de los grupos del directorio de GFSA; para cambiar lo que alguien puede hacer, cambie su rol en la pestaña Usuarios. Los capitanes ven solo su propio convoy.',
          )}
        </span>
      </div>
      <section className="card" aria-labelledby="usr-roles-matrix">
        <div className="usr-cardhead">
          <h2 id="usr-roles-matrix">{tr('Permission matrix', 'Matriz de permisos')}</h2>
          <span className="card__hint">
            {tr(`Read only · ${permissionLabels.length} permissions across ${roles.length} roles`, `Solo lectura · ${permissionLabels.length} permisos en ${roles.length} roles`)}
          </span>
        </div>
        <PermissionMatrix wide />
        <MatrixLegend />
      </section>
      <div className="usr-role-grid">
        {roles.map((r) => {
          const members = people.filter((u) => u.role === r.id && u.status !== 'suspended');
          const perms = permissionLabels.filter((p) => rolePermissions[r.id].includes(p.id));
          return (
            <article key={r.id} className="card usr-role" aria-labelledby={`usr-role-${r.id}`}>
              <div className="usr-role__head">
                <span className="usr-role__short" aria-hidden="true">
                  {r.short}
                </span>
                <div>
                  <h3 id={`usr-role-${r.id}`}>{roleName(r, tr)}</h3>
                  <span className="card__hint">{tr(r.where, WHERE_ES[r.id])}</span>
                </div>
              </div>
              <ul className="usr-role__perms">
                {perms.map((p) => (
                  <li key={p.id}>
                    <Icon name="check" size={14} strokeWidth={2.4} />
                    {permLabel(p, tr)}
                    {r.id === 'master' && tr(' · own convoy', ' · su convoy')}
                  </li>
                ))}
              </ul>
              {r.id === 'master' && <p className="usr-role__note">{tr('Device-bound wheelhouse account · cannot export', 'Cuenta del puente vinculada al dispositivo · no puede exportar')}</p>}
              {r.id === 'tenant_admin' && <p className="usr-role__note">{tr('Administers the tenant; does not see video', 'Administra el inquilino; no ve video')}</p>}
              <div className="usr-role__foot">
                <span>{tr(`${members.length} ${members.length === 1 ? 'person' : 'people'}`, `${members.length} ${members.length === 1 ? 'persona' : 'personas'}`)}</span>
                <button
                  type="button"
                  className="usr-linkbtn"
                  onClick={() => onShowUsers(r.id)}
                  disabled={!members.length}
                  title={!members.length ? tr('Nobody holds this role yet: invite someone with it', 'Nadie tiene este rol todavía: invite a alguien con él') : undefined}
                >
                  {tr('Show users', 'Ver usuarios')}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

// ---------- ADM-01 sign-in policy ----------

function policyItems(p: Policy, tr: Tr): { key: string; icon: IconName; on: boolean; text: string }[] {
  return [
    {
      key: 'sso',
      icon: 'key',
      on: p.sso,
      text: p.sso
        ? tr('Single sign-on (SAML) with the GFSA directory', 'Inicio de sesión único (SAML) con el directorio de GFSA')
        : tr('Single sign-on is off · local passwords', 'Inicio de sesión único desactivado · contraseñas locales'),
    },
    {
      key: 'mfa',
      icon: 'shield',
      on: p.mfaShore,
      text: p.mfaShore ? tr('MFA required for every shore role', 'MFA obligatorio para cada rol en tierra') : tr('MFA optional for shore roles', 'MFA opcional para roles en tierra'),
    },
    {
      key: 'session',
      icon: 'clock',
      on: true,
      text: tr(`Sessions expire after ${p.sessionHours} hours, ${p.idleMin} min idle`, `Las sesiones vencen a las ${p.sessionHours} horas, o tras ${p.idleMin} min de inactividad`),
    },
    {
      key: 'device',
      icon: 'screen',
      on: p.deviceBound,
      text: p.deviceBound
        ? tr('Wheelhouse accounts are bound to the display device and cannot export', 'Las cuentas del puente están vinculadas a la pantalla y no pueden exportar')
        : tr('Wheelhouse accounts can sign in on any device', 'Las cuentas del puente pueden iniciar sesión en cualquier dispositivo'),
    },
    {
      key: 'glass',
      icon: 'lock',
      on: true,
      text: p.breakGlass
        ? tr('Password sign-in only for break-glass accounts, reviewed monthly', 'Contraseña solo para cuentas de emergencia, revisadas cada mes')
        : tr('No password sign-in at all · no break-glass accounts', 'Sin inicio con contraseña · sin cuentas de emergencia'),
    },
  ];
}

function PolicySummary({ policy, canManage, onEdit }: { policy: Policy; canManage: boolean; onEdit: () => void }) {
  const tr = useTr();
  return (
    <section className="card" aria-labelledby="usr-policy-title">
      <div className="usr-cardhead">
        <h2 id="usr-policy-title">{tr('Sign-in policy', 'Política de inicio de sesión')}</h2>
        <span className="card__hint">
          {tr(
            `Set by the tenant administrator · last changed ${fmtDay(policy.changedAt)} by ${policy.changedBy}`,
            `Definida por el administrador del inquilino · último cambio ${fmtDay(policy.changedAt)} por ${policy.changedBy}`,
          )}
        </span>
      </div>
      <ul className="usr-policy-list">
        {policyItems(policy, tr).map((i) => (
          <li key={i.key} className={i.on ? undefined : 'is-off'}>
            <Icon name={i.on ? i.icon : 'alert'} size={18} />
            <span>{i.text}</span>
          </li>
        ))}
      </ul>
      {canManage && (
        <div className="usr-card-actions">
          <button type="button" className="btn" onClick={onEdit}>
            <Icon name="edit" size={16} /> {tr('Edit policy', 'Editar política')}
          </button>
        </div>
      )}
    </section>
  );
}

function PolicyRow({ title, detail, children, warn }: { title: string; detail: ReactNode; children: ReactNode; warn?: string | false }) {
  return (
    <div className="usr-prow">
      <div className="usr-prow__text">
        <span className="usr-prow__title">{title}</span>
        <span className="usr-prow__detail">{detail}</span>
        {warn && (
          <span className="usr-prow__warn" role="alert">
            <Icon name="alert" size={14} strokeWidth={2.2} /> {warn}
          </span>
        )}
      </div>
      <div className="usr-prow__ctl">{children}</div>
    </div>
  );
}

function PolicyTab({
  policy,
  draft,
  diffs,
  canManage,
  people,
  convoyName,
  onEdit,
  onChange,
  onCancel,
  onSave,
}: {
  policy: Policy;
  draft: Policy | null;
  diffs: [string, string][];
  canManage: boolean;
  people: User[];
  convoyName: (id?: string) => string;
  onEdit: () => void;
  onChange: (p: Partial<Policy>) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const tr = useTr();
  const p = draft ?? policy;
  const editing = !!draft;
  const masters = people.filter((u) => u.role === 'master' && u.status !== 'suspended').length;
  const onOff = (on: boolean) => <Badge tone={on ? 'ok' : 'bad'}>{on ? tr('On', 'Activado') : tr('Off', 'Desactivado')}</Badge>;
  const sw = (label: string, on: boolean, set: (v: boolean) => void) =>
    editing ? (
      <label className="switch">
        <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
        <span className="sr-only">{label}</span>
        <span aria-hidden="true">{on ? tr('On', 'Activado') : tr('Off', 'Desactivado')}</span>
      </label>
    ) : (
      onOff(on)
    );

  return (
    <div className="row">
      <section className="card usr-main" aria-labelledby="usr-pol-title">
        <div className="card__head">
          <div className="card__title">
            <h2 id="usr-pol-title">{tr('Sign-in policy', 'Política de inicio de sesión')}</h2>
            <span className="card__hint">
              {tr(
                `Set by the tenant administrator · last changed ${fmtDay(policy.changedAt)} by ${policy.changedBy}`,
                `Definida por el administrador del inquilino · último cambio ${fmtDay(policy.changedAt)} por ${policy.changedBy}`,
              )}
              {editing &&
                diffs.length > 0 &&
                tr(` · ${diffs.length} unsaved change${diffs.length === 1 ? '' : 's'}`, ` · ${diffs.length} cambio${diffs.length === 1 ? '' : 's'} sin guardar`)}
            </span>
          </div>
          {editing ? (
            <div className="usr-head-actions">
              <button type="button" className="btn" onClick={onCancel}>
                {tr('Cancel', 'Cancelar')}
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={onSave}
                disabled={!diffs.length}
                title={!diffs.length ? tr('Change a setting to save', 'Cambie un ajuste para guardar') : undefined}
              >
                {tr('Save policy', 'Guardar política')}
              </button>
            </div>
          ) : (
            canManage && (
              <button type="button" className="btn" onClick={onEdit}>
                <Icon name="edit" size={16} /> {tr('Edit policy', 'Editar política')}
              </button>
            )
          )}
        </div>
        <div className="usr-prows">
          <PolicyRow
            title={tr('Single sign-on (SAML) with the GFSA directory', 'Inicio de sesión único (SAML) con el directorio de GFSA')}
            detail={tr(
              'Identity provider sso.gfsa.example · signing certificate valid to 14 Jun 2027 · roles come from directory groups',
              'Proveedor de identidad sso.gfsa.example · certificado de firma válido hasta el 14 jun 2027 · los roles vienen de los grupos del directorio',
            )}
            warn={!p.sso && tr('Without single sign-on, leavers keep access until removed here.', 'Sin inicio de sesión único, quien deja la empresa conserva el acceso hasta que se lo quite aquí.')}
          >
            {sw(tr('Single sign-on', 'Inicio de sesión único'), p.sso, (v) => onChange({ sso: v }))}
          </PolicyRow>
          <PolicyRow
            title={tr('MFA for every shore role', 'MFA para cada rol en tierra')}
            detail={tr(
              'Authenticator app or security key at every sign-in · invited users enrol at first sign-in',
              'App de autenticación o llave de seguridad en cada inicio · los invitados lo registran en su primer inicio',
            )}
            warn={!p.mfaShore && tr('ADM-01 requires MFA for every shore role.', 'ADM-01 exige MFA para cada rol en tierra.')}
          >
            {sw(tr('MFA for every shore role', 'MFA para cada rol en tierra'), p.mfaShore, (v) => onChange({ mfaShore: v }))}
          </PolicyRow>
          <PolicyRow
            title={tr('Session limits', 'Límites de sesión')}
            detail={tr(
              'Signed-out sessions end everywhere; consoles in the operations room re-authenticate with SSO',
              'Las sesiones cerradas terminan en todas partes; las consolas de la sala de operaciones se vuelven a autenticar con SSO',
            )}
          >
            {editing ? (
              <span className="usr-inline-fields">
                <label>
                  {tr('Expire after', 'Vencer a las')}
                  <select className="select" value={p.sessionHours} onChange={(e) => onChange({ sessionHours: Number(e.target.value) })}>
                    {[8, 10, 12, 24].map((h) => (
                      <option key={h} value={h}>
                        {tr(`${h} hours`, `${h} horas`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {tr('Idle', 'Inactividad')}
                  <select className="select" value={p.idleMin} onChange={(e) => onChange({ idleMin: Number(e.target.value) })}>
                    {[15, 30, 60].map((m) => (
                      <option key={m} value={m}>
                        {m} min
                      </option>
                    ))}
                  </select>
                </label>
              </span>
            ) : (
              <span className="usr-value">{tr(`${p.sessionHours} h · ${p.idleMin} min idle`, `${p.sessionHours} h · ${p.idleMin} min de inactividad`)}</span>
            )}
          </PolicyRow>
          <PolicyRow
            title={tr('Device-bound wheelhouse accounts', 'Cuentas del puente vinculadas al dispositivo')}
            detail={tr(
              `${masters} wheelhouse displays enrolled · bound to the display device, cannot export`,
              `${masters} pantallas del puente registradas · vinculadas al dispositivo, no pueden exportar`,
            )}
            warn={!p.deviceBound && tr('Wheelhouse accounts could then sign in from any device.', 'Las cuentas del puente podrían iniciar sesión desde cualquier dispositivo.')}
          >
            {sw(tr('Device-bound wheelhouse accounts', 'Cuentas del puente vinculadas al dispositivo'), p.deviceBound, (v) => onChange({ deviceBound: v }))}
          </PolicyRow>
          <PolicyRow
            title={tr('Break-glass password accounts', 'Cuentas de emergencia con contraseña')}
            detail={tr(
              '2 accounts kept in the safe · reviewed monthly, last review 1 Oct · every use alerts the tenant administrator',
              '2 cuentas guardadas en la caja fuerte · revisadas cada mes, última revisión 1 oct · cada uso avisa al administrador del inquilino',
            )}
          >
            {sw(tr('Break-glass password accounts', 'Cuentas de emergencia con contraseña'), p.breakGlass, (v) => onChange({ breakGlass: v }))}
          </PolicyRow>
        </div>
      </section>

      <div className="stack usr-side">
        <Card id="usr-groups" title={tr('Directory groups', 'Grupos del directorio')} hint={tr('Synced 14:30 · mapped to roles', 'Sincronizado 14:30 · asignados a roles')} bodyClass="">
          <ul className="usr-groups">
            {DIRECTORY_GROUPS.map((g) => (
              <li key={g.group}>
                <span className="mono">{g.group}</span>
                <span className="usr-groups__role">{roleName(g.role, tr)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card id="usr-ws" title={tr('Wheelhouse displays', 'Pantallas del puente')} hint={tr('One account per convoy', 'Una cuenta por convoy')} bodyClass="">
          <ul className="usr-groups">
            {people
              .filter((u) => u.role === 'master')
              .map((u) => (
                <li key={u.id}>
                  <span>{u.name}</span>
                  <span className="usr-groups__role">
                    {convoyName(u.convoyId)} · {u.status === 'suspended' ? statusLabel('suspended', tr).toLowerCase() : tr('device-bound', 'vinculada al dispositivo')}
                  </span>
                </li>
              ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

// ---------- Dialogs ----------

function ChannelPicker({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const tr = useTr();
  return (
    <fieldset disabled={disabled}>
      <legend>{tr('Alert channels', 'Canales de alerta')}</legend>
      <div className="pdlg__checks">
        {SHORE_CHANNELS.map((c) => (
          <label key={c} className="check">
            <input
              type="checkbox"
              checked={value.includes(c)}
              onChange={(e) => onChange(e.target.checked ? SHORE_CHANNELS.filter((x) => x === c || value.includes(x)) : value.filter((x) => x !== c))}
            />
            {channelLabel(c, tr)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function InviteDialog({
  open,
  existing,
  seatsLeft,
  convoys,
  onClose,
  onInvite,
}: {
  open: boolean;
  existing: User[];
  seatsLeft: number;
  convoys: { id: string; name: string }[];
  onClose: () => void;
  onInvite: (u: User) => void;
}) {
  const tr = useTr();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<RoleId>('duty_officer');
  const [convoyId, setConvoyId] = useState(convoys[0]?.id ?? '');
  const [language, setLanguage] = useState<'es' | 'en'>('es');
  const [channels, setChannels] = useState<string[]>(['WhatsApp', 'SMS']);
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const isMaster = role === 'master';

  const errors: Record<string, string> = {};
  if (!name.trim()) errors.name = tr('Enter the person’s name.', 'Ingrese el nombre de la persona.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) errors.email = tr('Enter a valid email address.', 'Ingrese un correo válido.');
  else if (existing.some((u) => u.email.toLowerCase() === email.trim().toLowerCase())) errors.email = tr('Someone already uses this email.', 'Alguien ya usa este correo.');
  if (!isMaster && !channels.length) errors.channels = tr('Choose at least one alert channel.', 'Elija al menos un canal de alerta.');
  if (seatsLeft <= 0) errors.seats = tr(`All ${SEATS} seats are in use.`, `Los ${SEATS} puestos están en uso.`);

  const submit = () => {
    setTried(true);
    if (Object.keys(errors).length) return;
    const convoy = convoys.find((c) => c.id === convoyId);
    onInvite({
      id: uid('u'),
      name: name.trim(),
      initials: initialsOf(name),
      email: email.trim(),
      role,
      roleNote: isMaster ? `${convoy?.name} convoy only` : note.trim() || undefined,
      convoyId: isMaster ? convoyId : undefined,
      channels: isMaster ? [WHEELHOUSE] : channels,
      mfa: isMaster ? 'device_bound' : 'not_enrolled',
      lastActive: '–',
      status: 'invited',
      language,
    });
  };

  const err = (k: string) =>
    tried && errors[k] ? (
      <span className="pdlg__error" id={`usr-inv-${k}-err`}>
        {errors[k]}
      </span>
    ) : null;

  return (
    <PageDialog
      open={open}
      onClose={onClose}
      title={tr('Invite user', 'Invitar usuario')}
      sub={tr(`${seatsLeft} of ${SEATS} seats left · the person signs in with the GFSA directory`, `Quedan ${seatsLeft} de ${SEATS} puestos · la persona inicia sesión con el directorio de GFSA`)}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {tr('Cancel', 'Cancelar')}
          </button>
          <button type="button" className="btn btn--primary" onClick={submit}>
            <Icon name="send" size={16} /> {tr('Send invitation', 'Enviar invitación')}
          </button>
        </>
      }
    >
      <div className="pdlg__grid">
        <div className="field">
          <label htmlFor="usr-inv-name">{tr('Name', 'Nombre')}</label>
          <input
            id="usr-inv-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            aria-invalid={tried && !!errors.name}
            aria-describedby={tried && errors.name ? 'usr-inv-name-err' : undefined}
          />
          {err('name')}
        </div>
        <div className="field">
          <label htmlFor="usr-inv-email">{tr('Email', 'Correo')}</label>
          <input
            id="usr-inv-email"
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
            placeholder={tr('name@gfsa.example', 'nombre@gfsa.example')}
            aria-invalid={tried && !!errors.email}
            aria-describedby={tried && errors.email ? 'usr-inv-email-err' : undefined}
          />
          {err('email')}
        </div>
        <div className="field">
          <label htmlFor="usr-inv-role">{tr('Role', 'Rol')}</label>
          <select id="usr-inv-role" className="select" value={role} onChange={(e) => setRole(e.target.value as RoleId)}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {roleName(r, tr)}
              </option>
            ))}
          </select>
          <span className="field__hint">{tr(roleById(role).where, WHERE_ES[role])}</span>
        </div>
        <div className="field">
          <label htmlFor="usr-inv-lang">{tr('Language', 'Idioma')}</label>
          <select id="usr-inv-lang" className="select" value={language} onChange={(e) => setLanguage(e.target.value as 'es' | 'en')}>
            <option value="es">{tr('Spanish', 'Español')}</option>
            <option value="en">{tr('English', 'Inglés')}</option>
          </select>
          <span className="field__hint">{tr('Alert messages and reports', 'Mensajes de alerta e informes')}</span>
        </div>
        {isMaster ? (
          <div className="field">
            <label htmlFor="usr-inv-convoy">{tr('Convoy', 'Convoy')}</label>
            <select id="usr-inv-convoy" className="select" value={convoyId} onChange={(e) => setConvoyId(e.target.value)}>
              {convoys.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <span className="field__hint">{tr('Masters see their own convoy only', 'Los capitanes ven solo su propio convoy')}</span>
          </div>
        ) : (
          <div className="field">
            <label htmlFor="usr-inv-note">{tr('Shift or note (optional)', 'Turno o nota (opcional)')}</label>
            <input id="usr-inv-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr('Day shift', 'Turno de día')} />
          </div>
        )}
      </div>
      {isMaster ? (
        <p className="usr-dlg-note">
          {tr(
            'Masters are alerted on the wheelhouse display; the account is bound to that device and cannot export.',
            'Los capitanes reciben alertas en la pantalla del puente; la cuenta queda vinculada a ese dispositivo y no puede exportar.',
          )}
        </p>
      ) : (
        <>
          <ChannelPicker value={channels} onChange={setChannels} />
          {err('channels')}
        </>
      )}
      <p className="usr-dlg-note">
        {tr(
          'Once invited, the person can be picked as a recipient in alert routing.',
          'Una vez invitada, la persona se puede elegir como destinataria en el enrutamiento de alertas.',
        )}
      </p>
      {err('seats')}
    </PageDialog>
  );
}

function ManageDialog({
  user,
  isMe,
  canManage,
  invitedAt,
  routingUse,
  convoys,
  onClose,
  onSave,
  onStatus,
  onResend,
  onRevoke,
}: {
  user?: User;
  isMe: boolean;
  canManage: boolean;
  invitedAt?: string;
  routingUse: string[];
  convoys: { id: string; name: string }[];
  onClose: () => void;
  onSave: (next: Partial<User> & Pick<User, 'role' | 'channels' | 'language'>) => void;
  onStatus: (s: User['status']) => void;
  onResend: () => void;
  onRevoke: () => void;
}) {
  const tr = useTr();
  const [role, setRole] = useState<RoleId>(user?.role ?? 'duty_officer');
  const [convoyId, setConvoyId] = useState(user?.convoyId ?? convoys[0]?.id ?? '');
  const [note, setNote] = useState(user?.role === 'master' ? '' : (user?.roleNote ?? ''));
  const [channels, setChannels] = useState<string[]>(user?.role === 'master' ? ['Email'] : (user?.channels ?? []));
  const [language, setLanguage] = useState<'es' | 'en'>(user?.language ?? 'es');
  const [confirm, setConfirm] = useState<null | 'suspend' | 'revoke'>(null);
  if (!user) return null;
  const isMaster = role === 'master';
  const locked = !canManage || isMe;
  const noChannels = !isMaster && channels.length === 0;
  const first = user.name.split(' ')[0];

  const save = () => {
    if (noChannels) return;
    const wasMaster = user.role === 'master';
    const convoy = convoys.find((c) => c.id === convoyId);
    onSave({
      role,
      convoyId: isMaster ? convoyId : undefined,
      roleNote: isMaster ? `${convoy?.name} convoy only` : note.trim() || undefined,
      channels: isMaster ? [WHEELHOUSE] : channels,
      language,
      mfa: isMaster ? 'device_bound' : wasMaster ? 'not_enrolled' : user.mfa,
    });
  };

  const meTitle = isMe ? tr('Another tenant administrator must do this for your own account', 'Otro administrador del inquilino debe hacerlo en su propia cuenta') : undefined;

  return (
    <PageDialog
      open={!!user}
      onClose={onClose}
      title={user.name}
      sub={`${user.email} · ${statusLabel(user.status, tr)}${user.status === 'invited' && invitedAt ? tr(` · invited ${invitedAt}`, ` · invitado ${invitedAt}`) : ''}`}
      width={600}
      footer={
        <>
          {user.status === 'active' && (
            <button
              type="button"
              className="btn pdlg__spacer usr-danger"
              disabled={locked}
              title={meTitle}
              onClick={() => (confirm === 'suspend' ? onStatus('suspended') : setConfirm('suspend'))}
            >
              <Icon name="lock" size={16} /> {confirm === 'suspend' ? tr('Confirm suspend', 'Confirmar suspensión') : tr('Suspend', 'Suspender')}
            </button>
          )}
          {user.status === 'suspended' && (
            <button type="button" className="btn pdlg__spacer" onClick={() => onStatus('active')}>
              <Icon name="refresh" size={16} /> {tr('Reactivate', 'Reactivar')}
            </button>
          )}
          {user.status === 'invited' && (
            <span className="pdlg__spacer usr-dlg-actions">
              <button type="button" className="btn" onClick={onResend}>
                <Icon name="send" size={16} /> {tr('Resend', 'Reenviar')}
              </button>
              <button type="button" className="btn usr-danger" onClick={() => (confirm === 'revoke' ? onRevoke() : setConfirm('revoke'))}>
                <Icon name="trash" size={16} /> {confirm === 'revoke' ? tr('Confirm revoke', 'Confirmar revocación') : tr('Revoke', 'Revocar')}
              </button>
            </span>
          )}
          <button type="button" className="btn" onClick={onClose}>
            {tr('Cancel', 'Cancelar')}
          </button>
          <button type="button" className="btn btn--primary" onClick={save} disabled={noChannels} title={noChannels ? tr('Choose at least one alert channel', 'Elija al menos un canal de alerta') : undefined}>
            {tr('Save', 'Guardar')}
          </button>
        </>
      }
    >
      {isMe && (
        <div className="callout">
          <Icon name="info" size={18} />
          <span>
            {tr(
              'This is your own account. Another tenant administrator must change your role or suspend you.',
              'Esta es su propia cuenta. Otro administrador del inquilino debe cambiar su rol o suspenderlo.',
            )}
          </span>
        </div>
      )}
      {confirm && (
        <div className="callout callout--bad" role="alert">
          <Icon name="alert" size={18} />
          <span>
            {confirm === 'suspend'
              ? tr(`Suspending ends ${first}’s sessions now and stops alerts to them.`, `Suspender termina ahora las sesiones de ${first} y deja de enviarle alertas.`)
              : tr(`Revoking removes ${first}’s invitation and frees the seat.`, `Revocar quita la invitación de ${first} y libera el puesto.`)}
            {routingUse.length > 0 ? (
              <>
                {' '}
                {tr(`${first} is still used in alert routing:`, `${first} todavía figura en el enrutamiento de alertas:`)}
                <ul className="usr-uses">
                  {routingUse.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
                <Link to="/config/routing">{tr('Open alert routing to reassign', 'Abrir el enrutamiento de alertas para reasignar')}</Link>
              </>
            ) : (
              ` ${tr(`${first} is not on the duty rota or a recipient in alert routing.`, `${first} no está en la rota de guardia ni es destinatario de alertas.`)}`
            )}
          </span>
        </div>
      )}
      <div className="pdlg__grid">
        <div className="field">
          <label htmlFor="usr-m-role">{tr('Role', 'Rol')}</label>
          <select id="usr-m-role" className="select" value={role} disabled={locked} title={meTitle} onChange={(e) => setRole(e.target.value as RoleId)}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {roleName(r, tr)}
              </option>
            ))}
          </select>
          {role !== user.role && (
            <span className="field__hint">{tr(`Was ${roleById(user.role).name} · permissions follow the new role`, `Era ${roleById(user.role).nameEs} · los permisos siguen al nuevo rol`)}</span>
          )}
        </div>
        {isMaster ? (
          <div className="field">
            <label htmlFor="usr-m-convoy">{tr('Convoy', 'Convoy')}</label>
            <select id="usr-m-convoy" className="select" value={convoyId} onChange={(e) => setConvoyId(e.target.value)}>
              {convoys.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <span className="field__hint">{tr('Own convoy only', 'Solo su convoy')}</span>
          </div>
        ) : (
          <div className="field">
            <label htmlFor="usr-m-note">{tr('Shift or note', 'Turno o nota')}</label>
            <input id="usr-m-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr('Day shift', 'Turno de día')} />
          </div>
        )}
        <div className="field">
          <label htmlFor="usr-m-lang">{tr('Language', 'Idioma')}</label>
          <select id="usr-m-lang" className="select" value={language} onChange={(e) => setLanguage(e.target.value as 'es' | 'en')}>
            <option value="es">{tr('Spanish', 'Español')}</option>
            <option value="en">{tr('English', 'Inglés')}</option>
          </select>
        </div>
      </div>
      {isMaster ? (
        <p className="usr-dlg-note">
          {tr('Alerts go to the wheelhouse display. The account is device-bound and cannot export.', 'Las alertas van a la pantalla del puente. La cuenta está vinculada al dispositivo y no puede exportar.')}
        </p>
      ) : (
        <>
          <ChannelPicker value={channels} onChange={setChannels} />
          {noChannels && <span className="pdlg__error">{tr('Choose at least one alert channel.', 'Elija al menos un canal de alerta.')}</span>}
        </>
      )}
      <dl className="dl usr-dlg-dl">
        <dt>MFA</dt>
        <dd>
          <MfaCell mfa={user.mfa} />
        </dd>
        <dt>{tr('Last active', 'Última actividad')}</dt>
        <dd className="mono">{lastActiveText(user.lastActive, tr)}</dd>
        <dt>{tr('Can do', 'Puede')}</dt>
        <dd>
          {permissionLabels
            .filter((p) => rolePermissions[role].includes(p.id))
            .map((p) => permLabel(p, tr))
            .join(' · ')}
        </dd>
        {routingUse.length > 0 && (
          <>
            <dt>{tr('Alert routing', 'Enrutamiento')}</dt>
            <dd>{routingUse.join(' · ')}</dd>
          </>
        )}
      </dl>
    </PageDialog>
  );
}
