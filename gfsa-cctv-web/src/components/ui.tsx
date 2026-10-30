import { Fragment, useEffect, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { CameraHealth, Detection, LinkState, Priority } from '../data/types';
import { Icon } from './Icon';
import { useApp } from '../state/AppState';

// Shared building blocks. Styling lives in styles/global.css; these components
// only pick the right class names so every screen reads the same.

export const PRIORITY_NAME: Record<Priority, string> = {
  P1: 'Critical',
  P2: 'High',
  P3: 'Medium',
  P4: 'Low',
};

export const PRIORITY_NAME_ES: Record<Priority, string> = {
  P1: 'Crítica',
  P2: 'Alta',
  P3: 'Media',
  P4: 'Baja',
};

/** "P2 High" / "P2 Alta" in the current language. */
export function usePriorityName() {
  const { state } = useApp();
  return (p: Priority) => `${p} ${(state.lang === 'es' ? PRIORITY_NAME_ES : PRIORITY_NAME)[p]}`;
}

export function PriorityBadge({ p, short = false }: { p: Priority; short?: boolean }) {
  const name = usePriorityName();
  return (
    <span className={`badge badge--${p.toLowerCase()}`}>
      {(p === 'P1' || p === 'P2') && <Icon name="alert" size={13} strokeWidth={2.4} />}
      {short ? p : name(p)}
    </span>
  );
}

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral' | 'outline';

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge${tone === 'neutral' ? '' : ` badge--${tone}`}`}>{children}</span>;
}

export type DotTone = 'ok' | 'warn' | 'bad' | 'off' | 'idle';

export function Dot({ tone = 'ok' }: { tone?: DotTone }) {
  return <span className={`dot${tone === 'ok' ? '' : ` dot--${tone}`}`} aria-hidden="true" />;
}

export function StatusDot({ tone = 'ok', children }: { tone?: DotTone; children: ReactNode }) {
  return (
    <span className="with-dot">
      <Dot tone={tone} />
      {children}
    </span>
  );
}

export const healthTone = (h: CameraHealth): DotTone => (h === 'healthy' ? 'ok' : h === 'degraded' ? 'warn' : 'bad');
export const linkTone = (l: LinkState): DotTone => (l === 'strong' ? 'ok' : l === 'weak' ? 'warn' : 'off');

export function PageHeader({
  crumbs,
  title,
  sub,
  actions,
  meta,
}: {
  /** Breadcrumb trail; items with `to` become links. The page title is appended. */
  crumbs?: { label: string; to?: string }[];
  title: ReactNode;
  sub?: ReactNode;
  /** Badges or controls shown on the title line. */
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div className="page-head__text">
        {crumbs && (
          <nav aria-label="Breadcrumb" className="breadcrumb">
            {crumbs.map((c, i) => (
              <Fragment key={i}>
                {c.to ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
                {' / '}
              </Fragment>
            ))}
            <span>{typeof title === 'string' ? title : ''}</span>
          </nav>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <h1 className="page-title">{title}</h1>
          {meta}
        </div>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {actions && <div className="page-head__actions">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  hint,
  action,
  children,
  bodyClass = 'card__body',
  id,
  style,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  /** Pass '' for edge-to-edge content such as tables. */
  bodyClass?: string;
  id?: string;
  style?: React.CSSProperties;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section className="card" aria-labelledby={headingId} style={style}>
      {title && (
        <div className="card__head">
          <div className="card__title">
            <h2 id={headingId}>{title}</h2>
            {hint && <span className="card__hint">{hint}</span>}
          </div>
          {action}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  aside,
  foot,
  footTone,
  children,
}: {
  label: string;
  value: ReactNode;
  aside?: ReactNode;
  foot?: ReactNode;
  footTone?: 'ok' | 'bad';
  children?: ReactNode;
}) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className="stat__value">
        <strong>{value}</strong>
        {aside && <span>{aside}</span>}
      </span>
      {children}
      {foot && <span className={`stat__foot${footTone ? ` stat__foot--${footTone}` : ''}`}>{foot}</span>}
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="segmented">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
}: {
  label: string;
  tabs: { value: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="tablist" aria-label={label} className="tabs">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
        >
          {t.label}
          {t.count !== undefined && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Meter({ pct, tone, label }: { pct: number; tone?: 'warn' | 'bad'; label?: string }) {
  return (
    <div
      className={`meter${tone ? ` meter--${tone}` : ''}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
    >
      <span style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}

/** Horizontal bar chart (events by use case and similar). */
export function HBarChart({ rows }: { rows: { label: ReactNode; value: number; note?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="hbar-chart">
      {rows.map((r, i) => (
        <Fragment key={i}>
          <span style={{ fontSize: 13 }}>
            {r.label}
            {r.note && <span style={{ display: 'block', fontSize: 12, color: 'var(--subtle)' }}>{r.note}</span>}
          </span>
          <div className="hbar-chart__bar">
            <span style={{ width: `${(r.value / max) * 88}%`, minWidth: r.value ? 2 : 0 }} />
            <span>{r.value}</span>
          </div>
        </Fragment>
      ))}
    </div>
  );
}

/**
 * A camera frame with optional AI overlays (box, zone, label, confidence) — ALM-05, VW-04.
 * Fills its container; give the parent an aspect ratio or size.
 */
export function CameraFrame({
  src,
  alt,
  detection,
  overlays = true,
  degraded = false,
  children,
  rounded = 6,
}: {
  src: string;
  alt: string;
  detection?: Detection;
  overlays?: boolean;
  degraded?: boolean;
  children?: ReactNode;
  rounded?: number;
}) {
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        borderRadius: rounded,
        overflow: 'hidden',
        background: '#000',
      }}
    >
      <img
        src={src}
        alt={alt}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          filter: degraded ? 'blur(2px) brightness(0.9)' : undefined,
        }}
      />
      {overlays && detection?.zone && (
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        >
          <polygon
            points={detection.zone}
            fill="#FF8A4C"
            fillOpacity={0.16}
            stroke="#FF8A4C"
            strokeWidth={1.5}
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
      {overlays && detection && (
        <>
          <div
            style={{
              position: 'absolute',
              left: `${detection.box.x}%`,
              top: `${detection.box.y}%`,
              width: `${detection.box.w}%`,
              height: `${detection.box.h}%`,
              border: '2px solid var(--overlay)',
              borderRadius: 2,
            }}
          />
          <span
            style={{
              position: 'absolute',
              left: `${detection.box.x}%`,
              // Near the top edge the label sits just inside the box so it is never clipped.
              top: detection.box.y < 10 ? `calc(${detection.box.y}% + 3px)` : `calc(${detection.box.y}% - 24px)`,
              display: 'inline-flex',
              alignItems: 'center',
              height: 20,
              padding: '0 6px',
              borderRadius: 4,
              background: 'var(--overlay)',
              color: 'var(--overlay-ink)',
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            {detection.label} · {detection.confidence.toFixed(2)}
          </span>
        </>
      )}
      {children}
    </div>
  );
}

/** Small dark caption on top of a camera frame. */
export function FrameTag({
  children,
  pos = 'tl',
}: {
  children: ReactNode;
  pos?: 'tl' | 'tr' | 'bl' | 'br';
}) {
  const v = pos[0] === 't' ? { top: 8 } : { bottom: 8 };
  const h = pos[1] === 'l' ? { left: 8 } : { right: 8 };
  return (
    <span
      style={{
        position: 'absolute',
        ...v,
        ...h,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 24,
        padding: '0 8px',
        borderRadius: 4,
        background: 'rgba(6,11,16,0.8)',
        color: '#fff',
        fontSize: 12,
      }}
    >
      {children}
    </span>
  );
}

export function Toasts() {
  const { state, dismissToast } = useApp();
  const es = state.lang === 'es';
  useEffect(() => {
    if (!state.toasts.length) return;
    const id = window.setTimeout(() => dismissToast(state.toasts[0].id), 4000);
    return () => window.clearTimeout(id);
  }, [state.toasts, dismissToast]);
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {state.toasts.map((t) => (
        <div key={t.id} className="toast">
          <Icon name="check" size={18} />
          <span style={{ flex: 1 }}>{t.text}</span>
          <button
            type="button"
            aria-label={es ? 'Cerrar' : 'Dismiss'}
            onClick={() => dismissToast(t.id)}
            style={{ border: 0, background: 'transparent', color: '#fff', cursor: 'pointer', padding: 0 }}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Shown in place of a screen the current role may not open (ADM-02). */
export function NoAccess({ what }: { what: string }) {
  const { state } = useApp();
  const es = state.lang === 'es';
  return (
    <div className="page">
      <div className="card">
        <div className="empty">
          <Icon name="lock" size={28} />
          <h1 style={{ marginTop: 8, fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>{es ? `Su rol no puede abrir ${what}` : `Your role cannot open ${what}`}</h1>
          <p>
            {es
              ? 'Los permisos siguen al rol, no a la persona. Pida acceso al administrador del inquilino si lo necesita.'
              : 'Permissions follow the role, not the person. Ask the tenant administrator if you need access.'}
          </p>
        </div>
      </div>
    </div>
  );
}
