import { Suspense, useEffect, useRef, useState, type RefObject } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { roles } from '../data/users';
import type { RoleId } from '../data/types';
import { allNav, canOpen, homeFor, navGroups } from '../nav';
import { useApp, useOpenAlarms } from '../state/AppState';
import { useFleet } from '../state/fleetStore';
import { useTr } from '../lib/i18n';
import { readSaved, resetDemoData, useStore } from '../lib/persist';
import { registryStore } from '../state/modelRegistry';
import { fmtCountdown, fmtSmart, fmtTime, fmtTimeSec, useNow } from '../lib/time';
import { Icon } from './Icon';
import { CommandPalette } from './CommandPalette';
import { HelpPanel } from './HelpPanel';
import { NoAccess, PriorityBadge } from './ui';
import './AppShell.css';

/** Closes a popover on outside click or Escape. */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, open, close]);
}

export function AppShell() {
  const { state, setScope } = useApp();
  const tr = useTr();
  const fleet = useFleet();
  const open = useOpenAlarms();
  const now = useNow();
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const es = state.lang === 'es';

  // Ctrl/Cmd K opens search; "?" opens help.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable="true"]');
      if (e.key === '?' && !typing && !e.ctrlKey && !e.metaKey) setHelpOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const current = allNav
    .filter((n) => (n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to)))
    .sort((a, b) => b.to.length - a.to.length)[0];
  const allowed = !current || canOpen(state.role, current);
  const notReporting = fleet.edgeUnits.filter((u) => u.status !== 'reporting').length;
  const liveModel = useStore(registryStore).versions.find((m) => m.state === 'live')?.v ?? '—';
  // Connect syncs every 5 minutes while it is on (Integrations); "Sync now" there moves it forward.
  const connect = readSaved<Record<string, { enabled?: boolean; toggledAt?: string }>>('integrations.state')?.connect;
  const connectOn = connect?.enabled !== false;
  const lastSync = Math.max(readSaved<number>('integrations.syncClock') ?? 0, Math.floor(now / 300_000) * 300_000);
  const label = (n: { label: string; labelEs: string }) => (es ? n.labelEs : n.label);

  return (
    <div className="shell">
      <a href="#main" className="shell__skip">
        {tr('Skip to content', 'Ir al contenido')}
      </a>
      <header className="shell__header">
        <Link to={homeFor(state.role)} className="shell__brand">
          <span className="shell__logo">
            <Icon name="logo" size={18} strokeWidth={2} />
          </span>
          <span>CCTV Monitoring</span>
        </Link>
        <span className="shell__tenant" title={tr('Tenant', 'Inquilino')}>
          <span className="shell__tenant-mark">G</span>GFSA
        </span>
        <span className="shell__env">{tr('Production', 'Producción')}</span>

        <button type="button" className="shell__search" onClick={() => setPaletteOpen(true)}>
          <Icon name="search" size={16} strokeWidth={2} />
          <span>{tr('Search vessels, cameras, alarms', 'Buscar embarcaciones, cámaras, alarmas')}</span>
          <kbd>Ctrl K</kbd>
        </button>

        <div className="shell__right">
          <label className="shell__scope">
            <span className="sr-only">{tr('Convoy scope', 'Alcance de convoyes')}</span>
            <select
              value={state.scope}
              onChange={(e) => setScope(e.target.value)}
              disabled={state.role === 'master'}
              title={state.role === 'master' ? tr('Masters see their own convoy only', 'Los capitanes ven solo su propio convoy') : undefined}
            >
              <option value="all">{tr('All convoys', 'Todos los convoyes')}</option>
              {fleet.convoys.map((c) => (
                <option key={c.id} value={c.id}>
                  {tr(`${c.name} convoy`, `Convoy ${c.name}`)}
                </option>
              ))}
            </select>
            <Icon name="chevronDown" size={14} strokeWidth={2} />
          </label>
          <span className="shell__clock" aria-label={tr('Asunción time', 'Hora de Asunción')}>
            <span className={`shell__clock-dot${state.simulation ? '' : ' shell__clock-dot--paused'}`} />
            {fmtTimeSec(now)} Asunción
          </span>
          <Notifications />
          <button type="button" className="shell__iconbtn" aria-label={tr('Help', 'Ayuda')} onClick={() => setHelpOpen(true)}>
            <Icon name="help" />
          </button>
          <UserMenu />
        </div>
      </header>

      <div className="shell__body">
        <nav aria-label={tr('Main', 'Principal')} className="shell__rail">
          {navGroups.map((group, gi) => {
            const items = group.filter((n) => canOpen(state.role, n));
            if (!items.length) return null;
            return (
              <div key={gi} className="shell__rail-group">
                {items.map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.to === '/'} className="shell__rail-link" aria-label={label(n)} data-tip={label(n)}>
                    <Icon name={n.icon} />
                    {n.to === '/alarms' && open.some((a) => a.priority <= 'P2') && <span className="shell__rail-dot" />}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        <main className="shell__main" id="main" tabIndex={-1}>
          {allowed ? (
            <Suspense fallback={<div className="empty">{tr('Loading…', 'Cargando…')}</div>}>
              <Outlet />
            </Suspense>
          ) : (
            <NoAccess what={current ? label(current).toLowerCase() : tr('this screen', 'esta pantalla')} />
          )}
          <footer className="shell__footer">
            <span className="with-dot">
              <span className={`dot${state.simulation ? '' : ' dot--warn'}`} />
              {state.simulation ? tr('Event service connected', 'Servicio de eventos conectado') : tr('Live events paused (demo)', 'Eventos en vivo en pausa (demo)')}
            </span>
            <span className="with-dot">
              <span className={`dot${connectOn ? '' : ' dot--warn'}`} />
              {connectOn
                ? tr(`Connect synced ${fmtTime(lastSync)}`, `Connect sincronizado ${fmtTime(lastSync)}`)
                : tr('Connect sync off', 'Sincronización con Connect apagada')}
            </span>
            <span className="with-dot">
              <span className="dot" />
              {tr(`Model registry ${liveModel}`, `Registro de modelos ${liveModel}`)}
            </span>
            {notReporting > 0 && (
              <Link to="/config/edge-units" className="with-dot" style={{ color: 'inherit' }}>
                <span className="dot dot--warn" />
                {tr(`${notReporting} edge units not reporting`, `${notReporting} unidades de borde sin reportar`)}
              </Link>
            )}
            <span style={{ marginLeft: 'auto' }}>{tr('Production · GFSA tenant · v2026.10.2', 'Producción · inquilino GFSA · v2026.10.2')}</span>
          </footer>
        </main>
      </div>

      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

/** The bell: open alarms and the latest system messages (escalations, reconnects, new events). */
function Notifications() {
  const { state } = useApp();
  const tr = useTr();
  const fleet = useFleet();
  const open = useOpenAlarms();
  const now = useNow();
  const navigate = useNavigate();
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, show, () => setShow(false));
  const es = state.lang === 'es';
  const recent = state.audit.filter((e) => e.actor === 'System').slice(0, 6);
  const go = (to: string) => {
    setShow(false);
    navigate(to);
  };

  return (
    <div className="shell__pop-anchor" ref={ref}>
      <button
        type="button"
        className="shell__iconbtn"
        aria-label={tr(`Alarms, ${open.length} open`, `Alarmas, ${open.length} abiertas`)}
        aria-expanded={show}
        onClick={() => setShow((v) => !v)}
      >
        <Icon name="bell" />
        {open.length > 0 && <span className="shell__count">{open.length}</span>}
      </button>
      {show && (
        <div className="shell__pop shell__pop--wide" role="dialog" aria-label={tr('Notifications', 'Notificaciones')}>
          <div className="shell__pop-head">
            <strong>{tr('Open alarms', 'Alarmas abiertas')}</strong>
            <span>{open.length}</span>
          </div>
          {open.length === 0 && <p className="shell__pop-empty">{tr('No open alarms in this scope.', 'No hay alarmas abiertas en este alcance.')}</p>}
          <ul className="shell__notes">
            {open.slice(0, 6).map((a) => {
              const left = a.escalatesAt ? new Date(a.escalatesAt).getTime() - now : undefined;
              return (
                <li key={a.id}>
                  <button type="button" onClick={() => go(`/alarms/${a.id}`)}>
                    <PriorityBadge p={a.priority} short />
                    <span className="shell__note-main">
                      <strong>{es && a.titleEs ? a.titleEs : a.title}</strong>
                      <span>
                        {a.cameraId ? fleet.cameraLabel(a.cameraId) : fleet.convoyById(a.convoyId)?.name} · {fmtSmart(a.raisedAt, now)}
                      </span>
                    </span>
                    {left !== undefined && left > 0 && <span className="shell__note-timer">{fmtCountdown(left)}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="shell__pop-head">
            <strong>{tr('Latest from the system', 'Lo último del sistema')}</strong>
          </div>
          <ul className="shell__notes shell__notes--log">
            {recent.map((e) => (
              <li key={e.seq}>
                <span className="mono">{fmtTime(e.at)}</span>
                <span>
                  {e.action} · {e.target}
                  {e.details && <span className="shell__note-sub">{e.details}</span>}
                </span>
              </li>
            ))}
          </ul>
          <div className="shell__pop-foot">
            <button type="button" className="btn btn--sm" onClick={() => go('/alarms')}>
              {tr('Open alarm console', 'Abrir consola de alarmas')}
            </button>
            {state.role === 'tenant_admin' && (
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => go('/admin/audit')}>
                {tr('Audit log', 'Registro de auditoría')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { state, setRole, setLang, signOut, setSimulation } = useApp();
  const tr = useTr();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  const role = roles.find((r) => r.id === state.role)!;
  const es = state.lang === 'es';

  const switchRole = (r: RoleId) => {
    setRole(r);
    setOpen(false);
    navigate(homeFor(r));
  };

  return (
    <div className="usermenu" ref={ref}>
      <button type="button" className="usermenu__btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="usermenu__avatar">{state.user.initials}</span>
        <span className="usermenu__who">
          <span>{es ? role.nameEs : role.name}</span>
          <span>{state.user.name}</span>
        </span>
        <Icon name="chevronDown" size={14} strokeWidth={2} />
      </button>
      {open && (
        <div className="usermenu__pop" role="menu">
          <div className="usermenu__section">
            <span className="usermenu__label">{tr('Demo: sign in as', 'Demo: entrar como')}</span>
            {roles.map((r) => (
              <button key={r.id} type="button" role="menuitemradio" aria-checked={r.id === state.role} onClick={() => switchRole(r.id)}>
                <span className="usermenu__short">{r.short}</span>
                {es ? r.nameEs : r.name}
                {r.id === state.role && <Icon name="check" size={16} style={{ marginLeft: 'auto' }} />}
              </button>
            ))}
          </div>
          <div className="usermenu__section">
            <span className="usermenu__label">{tr('Other surfaces', 'Otras pantallas')}</span>
            <Link to="/wheelhouse" role="menuitem" onClick={() => setOpen(false)}>
              <Icon name="screen" size={16} /> {tr('Wheelhouse display', 'Pantalla del puente')}
            </Link>
            <Link to={`/m/alarm/${state.alarms.find((a) => a.state !== 'closed' && a.priority <= 'P2')?.id ?? 'ALM-26-0318'}`} role="menuitem" onClick={() => setOpen(false)}>
              <Icon name="phone" size={16} /> {tr('Phone alert page', 'Página de alerta en el teléfono')}
            </Link>
          </div>
          <div className="usermenu__section usermenu__row">
            <span className="usermenu__label">{tr('Language', 'Idioma')}</span>
            <div className="segmented" role="group" aria-label={tr('Language', 'Idioma')}>
              {(['es', 'en'] as const).map((l) => (
                <button key={l} type="button" aria-pressed={state.lang === l} onClick={() => setLang(l)}>
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div className="usermenu__section">
            <label className="switch usermenu__switch">
              <input type="checkbox" checked={state.simulation} onChange={(e) => setSimulation(e.target.checked)} />
              <span>
                {tr('Live events (demo)', 'Eventos en vivo (demo)')}
                <span className="usermenu__hint">{tr('New events, escalations and health messages', 'Eventos nuevos, escalamientos y mensajes de estado')}</span>
              </span>
            </label>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                if (window.confirm(tr('Reset the demo? Every change is cleared and the clock goes back to 14:36:20.', '¿Reiniciar la demo? Se borran todos los cambios y el reloj vuelve a las 14:36:20.'))) resetDemoData();
              }}
            >
              <Icon name="refresh" size={16} /> {tr('Reset demo data', 'Reiniciar datos de la demo')}
            </button>
          </div>
          <div className="usermenu__section">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                signOut();
                navigate('/sign-in');
              }}
            >
              <Icon name="logout" size={16} /> {tr('Sign out', 'Cerrar sesión')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

