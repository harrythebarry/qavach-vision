import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { SITE, USERS } from '../data/seed';
import { resetAll, useStore } from '../lib/persist';
import { ago, hms, useNow } from '../lib/time';
import { isAdmin, isOpen, sessionStore, toastStore, useAlerts, useCameras, useMe, useRules, useSession, userName } from '../state/store';
import { Icon, Logo, type IconName } from './Icon';
import { CHANNEL, PriorityBadge } from './ui';
import './Shell.css';

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Overview', icon: 'home', end: true },
  { to: '/wall', label: 'Video wall', icon: 'wall' },
  { to: '/alerts', label: 'Alerts', icon: 'bell' },
];
const SETUP: { to: string; label: string; icon: IconName }[] = [
  { to: '/cameras', label: 'Cameras', icon: 'camera' },
  { to: '/rules', label: 'Rules', icon: 'rule' },
  { to: '/notifications', label: 'Notify', icon: 'route' },
];

export function Shell() {
  const alerts = useAlerts();
  const open = alerts.filter(isOpen).length;
  const me = useMe();
  const [profile, setProfile] = useState(false);
  const [bell, setBell] = useState(false);

  return (
    <div className="app">
      <div className="rail">
        <nav className="dock" aria-label="Safety Intelligence">
          <Link to="/" className="dock__logo" aria-label="Safety Intelligence overview">
            <Logo />
          </Link>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `dock__item${isActive ? ' is-active' : ''}`}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
              {n.to === '/alerts' && open > 0 && <span className="dock__badge dock__badge--alert">{open}</span>}
            </NavLink>
          ))}
          <div className="dock__sep" />
          <span className="dock__group">Set up</span>
          {SETUP.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => `dock__item${isActive ? ' is-active' : ''}`}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
            </NavLink>
          ))}
          <div className="dock__sep" />
          <a href="#/m" target="_blank" rel="noopener" className="dock__item" title="Opens the supervisor's phone view in a new window">
            <Icon name="mobile" />
            <span>Phone</span>
          </a>
          <div className="dock__spacer" />
          <div className="dock__profile">
            <button type="button" className="dock__avatar" onClick={() => setProfile((v) => !v)} aria-expanded={profile} aria-label={`Signed in as ${me.name}, ${me.role}`}>
              {me.name
                .split(' ')
                .map((p) => p[0])
                .join('')}
            </button>
          </div>
        </nav>
      </div>

      <div className="main">
        <TopBar onBell={() => setBell(true)} />
        <main className="content">
          <Outlet />
        </main>
      </div>

      {profile && <ProfileMenu onClose={() => setProfile(false)} />}
      {bell && <NotificationsDrawer onClose={() => setBell(false)} />}
      <Toasts />
    </div>
  );
}

function TopBar({ onBell }: { onBell: () => void }) {
  const { live } = useSession();
  const me = useMe();
  const alerts = useAlerts();
  const now = useNow(1000);
  const mine = alerts.filter((a) => isOpen(a) && a.deliveries.some((d) => d.to === me.id)).length;
  return (
    <header className="bar">
      <div className="bar__module">
        <Icon name="cctv" size={20} />
        <div className="stack" style={{ gap: 0 }}>
          <strong>Safety Intelligence</strong>
          <span className="meta">Qavach · CCTV monitoring</span>
        </div>
      </div>
      <span className="bar__site">
        <Icon name="map" size={17} />
        <span className="ellipsis">{SITE.name}</span>
        <span className="muted">All areas</span>
      </span>
      <Search />
      <span className="spacer" />
      <button
        type="button"
        className={`bar__live${live ? '' : ' is-paused'}`}
        onClick={() => sessionStore.set((s) => ({ ...s, live: !s.live }))}
        title={live ? 'Live events are on: new alerts arrive every minute or so. Click to pause.' : 'Live events are paused. Click to resume.'}
      >
        <span className="bar__live-dot" />
        <span className="mono">{hms(now)}</span>
        <span>{live ? 'Live' : 'Paused'}</span>
      </button>
      <button type="button" className="btn btn--secondary btn--icon bar__bell" onClick={onBell} aria-label={`Notifications${mine ? `, ${mine} open alerts sent to you` : ''}`}>
        <Icon name="bell" />
        {mine > 0 && <span className="bar__dot">{mine}</span>}
      </button>
    </header>
  );
}

function Search() {
  const cams = useCameras();
  const alerts = useAlerts();
  const rules = useRules();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    const out: { to: string; icon: IconName; label: string; sub: string }[] = [];
    cams.filter((c) => `${c.id} ${c.name}`.toLowerCase().includes(t)).slice(0, 5).forEach((c) => out.push({ to: `/cameras/${c.id}`, icon: 'camera', label: `${c.id} · ${c.name}`, sub: 'Camera' }));
    alerts.filter((a) => `${a.id} ${a.title} ${a.qavach?.ref ?? ''}`.toLowerCase().includes(t)).slice(0, 4).forEach((a) => out.push({ to: `/alerts/${a.id}`, icon: 'bell', label: `${a.id} · ${a.title}`, sub: a.qavach ? `Alert · ${a.qavach.ref}` : 'Alert' }));
    rules.filter((r) => `${r.id} ${r.name}`.toLowerCase().includes(t)).slice(0, 4).forEach((r) => out.push({ to: `/rules/${r.id}`, icon: 'rule', label: `${r.id} · ${r.name}`, sub: 'Rule' }));
    return out;
  }, [q, cams, alerts, rules]);
  const go = (to: string) => {
    nav(to);
    setQ('');
    setOpen(false);
    ref.current?.blur();
  };
  return (
    <div className="bar__search">
      <Icon name="search" size={18} />
      <input
        ref={ref}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results[0]) go(results[0].to);
          if (e.key === 'Escape') setQ('');
        }}
        placeholder="Find a camera, alert, rule or Qavach record"
        aria-label="Find a camera, alert, rule or Qavach record"
      />
      {open && q.trim() && (
        <div className="bar__results" role="listbox">
          {results.length === 0 && <div className="bar__result muted">Nothing matches “{q}”.</div>}
          {results.map((r) => (
            <button key={r.to} type="button" className="bar__result" onMouseDown={(e) => e.preventDefault()} onClick={() => go(r.to)}>
              <Icon name={r.icon} size={17} />
              <span className="ellipsis">{r.label}</span>
              <span className="spacer" />
              <span className="meta">{r.sub}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ProfileMenu({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const { live } = useSession();
  const nav = useNavigate();
  return (
    <>
      <div className="click-away" onClick={onClose} />
      <div className="profile" role="menu">
        <div className="profile__head">
          <strong>{me.name}</strong>
          <span>{me.role}</span>
          <span className="meta">{SITE.name}</span>
        </div>
        <div className="profile__label">Try another role</div>
        {USERS.map((u) => (
          <button
            key={u.id}
            type="button"
            role="menuitemradio"
            aria-checked={u.id === me.id}
            className="profile__item"
            onClick={() => {
              sessionStore.set((s) => ({ ...s, userId: u.id }));
              onClose();
            }}
          >
            <span className={`profile__radio${u.id === me.id ? ' is-on' : ''}`} />
            <span className="stack" style={{ gap: 0 }}>
              <span>{u.name}</span>
              <span className="meta">{u.role}</span>
            </span>
          </button>
        ))}
        <div className="profile__sep" />
        <button type="button" className="profile__item" role="menuitem" onClick={() => sessionStore.set((s) => ({ ...s, live: !s.live }))}>
          <Icon name={live ? 'pause' : 'play'} size={18} />
          {live ? 'Pause live events' : 'Resume live events'}
        </button>
        <button
          type="button"
          className="profile__item"
          role="menuitem"
          onClick={() => {
            if (!window.confirm('Reset the prototype? Cameras, zones, rules, walls and alerts go back to the sample data.')) return;
            const keepUser = me.id;
            resetAll();
            sessionStore.set((s) => ({ ...s, userId: keepUser }));
            onClose();
            nav('/');
          }}
        >
          <Icon name="refresh" size={18} />
          Reset sample data
        </button>
      </div>
    </>
  );
}

function NotificationsDrawer({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const alerts = useAlerts();
  const now = useNow(5000);
  const nav = useNavigate();
  const items = alerts
    .flatMap((a) => a.deliveries.filter((d) => d.to === me.id || isAdmin(me)).map((d) => ({ a, d })))
    .sort((x, y) => y.d.at - x.d.at)
    .slice(0, 40);
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Notifications">
        <div className="modal__head">
          <div className="stack" style={{ gap: 2 }}>
            <h2>Notifications</h2>
            <span className="meta">{isAdmin(me) ? 'Everything sent from this site (you are the safety admin)' : `Sent to ${me.name}`}</span>
          </div>
          <span className="spacer" />
          <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="notif">
          {items.length === 0 && <div className="empty">Nothing sent to you yet.</div>}
          {items.map(({ a, d }, i) => (
            <button
              key={`${a.id}-${i}`}
              type="button"
              className="notif__item"
              onClick={() => {
                nav(`/alerts/${a.id}`);
                onClose();
              }}
            >
              <PriorityBadge p={a.priority} short />
              <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                <span className="ellipsis">
                  <strong>{a.title}</strong>
                </span>
                <span className="meta">
                  {a.id} · {d.reason === 'alert' ? '' : d.reason === 'escalation' ? 'Escalation · ' : 'Reminder · '}
                  {CHANNEL[d.channel].label} to {userName(d.to)} · {d.status}
                </span>
              </span>
              <span className="spacer" />
              <span className="meta" style={{ whiteSpace: 'nowrap' }}>
                {ago(d.at, now)}
              </span>
            </button>
          ))}
        </div>
      </aside>
    </>
  );
}

function Toasts() {
  const toasts = useStore(toastStore);
  const nav = useNavigate();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.tone ? ` toast--${t.tone}` : ''}`}>
          {t.tone === 'alert' && <Icon name="warning" size={18} />}
          <span>{t.text}</span>
          {t.link && (
            <button type="button" className="toast__link" onClick={() => nav(t.link!)}>
              Open
            </button>
          )}
          <button type="button" className="toast__x" aria-label="Dismiss" onClick={() => toastStore.set((s) => s.filter((x) => x.id !== t.id))}>
            <Icon name="close" size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Banner for set-up screens when the signed-in role can only look. */
export function ReadOnlyNote({ children }: { children: ReactNode }) {
  const me = useMe();
  if (isAdmin(me)) return null;
  return (
    <div className="readonly">
      <Icon name="info" size={18} />
      <span>
        {children} You are signed in as <strong>{me.role}</strong>. Switch to <strong>Safety admin</strong> in the profile menu to make changes.
      </span>
    </div>
  );
}
