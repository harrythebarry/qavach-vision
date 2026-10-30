import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { voyages } from '../data/alarms';
import { useFleet } from '../state/fleetStore';
import { useTr } from '../lib/i18n';
import { allNav, canOpen } from '../nav';
import { useApp } from '../state/AppState';
import { Icon, type IconName } from './Icon';

interface Hit {
  kind: string;
  icon: IconName;
  label: string;
  sub?: string;
  to: string;
}

/** Ctrl K search over screens, alarms, vessels, cameras and voyages. */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { state } = useApp();
  const fleet = useFleet();
  const tr = useTr();
  const es = state.lang === 'es';
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const all = useMemo<Hit[]>(
    () => [
      ...allNav
        .filter((n) => canOpen(state.role, n))
        .map((n) => ({ kind: tr('Screen', 'Pantalla'), icon: n.icon, label: es ? n.labelEs : n.label, to: n.to })),
      ...state.alarms.map((a) => ({
        kind: tr('Alarm', 'Alarma'),
        icon: 'bell' as const,
        label: `${a.id} · ${es && a.titleEs ? a.titleEs : a.title}`,
        sub: `${a.priority} · ${a.state === 'closed' ? tr('closed', 'cerrada') : tr('open', 'abierta')}`,
        to: `/alarms/${a.id}`,
      })),
      ...fleet.vessels.map((v) => ({
        kind: tr('Vessel', 'Embarcación'),
        icon: 'ship' as const,
        label: v.name,
        sub: v.kind === 'tug' ? tr('tug', 'remolcador') : tr('barge', 'barcaza'),
        to: `/video-wall?convoy=${v.convoyId}`,
      })),
      ...fleet.cameras.map((c) => ({
        kind: tr('Camera', 'Cámara'),
        icon: 'video' as const,
        label: `${c.id} · ${c.name}`,
        sub: fleet.vesselById(c.vesselId)?.name,
        to: `/config/cameras?camera=${c.id}`,
      })),
      ...voyages.map((v) => ({ kind: tr('Voyage', 'Viaje'), icon: 'route' as const, label: `${v.id} · ${v.route}`, sub: v.statusNote, to: `/voyages/${v.id}` })),
    ],
    [state.alarms, state.role, fleet, tr, es],
  );

  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? all.filter((h) => `${h.label} ${h.sub ?? ''} ${h.kind}`.toLowerCase().includes(s)) : all.filter((h) => h.icon === 'bell' || h.to.startsWith('/') && !h.to.includes('?') && !h.to.startsWith('/alarms/') && !h.to.startsWith('/voyages/'));
    return list.slice(0, 12);
  }, [q, all]);

  const go = (h: Hit) => {
    navigate(h.to);
    onClose();
  };

  return (
    <div
      role="presentation"
      onMouseDown={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(14,26,38,0.4)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '10vh 16px 16px' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tr('Search', 'Buscar')}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 560, borderRadius: 10, background: 'var(--surface)', boxShadow: 'var(--shadow-pop)', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', borderBottom: '1px solid var(--line-soft)' }}>
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => Math.min(hits.length - 1, i + 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              }
              if (e.key === 'Enter' && hits[active]) go(hits[active]);
            }}
            placeholder={tr('Search vessels, cameras, alarms', 'Buscar embarcaciones, cámaras, alarmas')}
            aria-label={tr('Search vessels, cameras, alarms', 'Buscar embarcaciones, cámaras, alarmas')}
            style={{ flex: 1, minHeight: 52, border: 0, outline: 'none', fontSize: 15, background: 'transparent' }}
          />
          <kbd style={{ fontSize: 12, padding: '1px 6px', border: '1px solid var(--line-input)', borderRadius: 4, color: 'var(--subtle)' }}>Esc</kbd>
        </div>
        <ul role="listbox" style={{ listStyle: 'none', margin: 0, padding: 6, maxHeight: 420, overflow: 'auto' }}>
          {hits.length === 0 && <li className="empty">{tr(`Nothing matches “${q}”`, `Nada coincide con “${q}”`)}</li>}
          {hits.map((h, i) => (
            <li key={`${h.kind}-${h.to}-${h.label}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(h)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  minHeight: 44,
                  padding: '0 10px',
                  border: 0,
                  borderRadius: 6,
                  background: i === active ? 'var(--brand-tint)' : 'transparent',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <Icon name={h.icon} size={18} style={{ color: 'var(--muted)' }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600, fontSize: 13 }}>{h.label}</span>
                  {h.sub && <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>{h.sub}</span>}
                </span>
                <span style={{ fontSize: 12, color: 'var(--subtle)' }}>{h.kind}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
