import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { Icon } from '../../components/Icon';
import { useApp } from '../../state/AppState';
import { homeFor } from '../../nav';
import { useTr, type Lang } from '../../lib/i18n';
import './public.css';

// The frame of the public pages linked from sign-in (Status, Privacy, Support):
// no sign-in needed, same look as the sign-in page, ES/EN in the bar.

export function PublicLayout({ title, sub, meta, children }: { title: string; sub?: ReactNode; meta?: ReactNode; children: ReactNode }) {
  const { state, setLang } = useApp();
  const tr = useTr();
  const links = [
    { to: '/status', label: tr('Status', 'Estado') },
    { to: '/privacy', label: tr('Privacy', 'Privacidad') },
    { to: '/support', label: tr('Support', 'Soporte') },
  ];
  const langToggle = (
    <div role="group" aria-label={tr('Language', 'Idioma')} className="segmented pub-lang">
      {(['es', 'en'] as Lang[]).map((l) => (
        <button key={l} type="button" lang={l} aria-pressed={state.lang === l} onClick={() => setLang(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
  return (
    <div className="pub" lang={state.lang}>
      <header className="pub-top">
        <div className="pub-bar">
          <Link to="/sign-in" className="pub-brand">
            <span className="pub-brand__logo" aria-hidden="true">
              <Icon name="logo" size={18} strokeWidth={2} />
            </span>
            <span>CCTV Monitoring</span>
            <span className="pub-brand__tenant">· GFSA</span>
          </Link>
          <nav aria-label={tr('Public pages', 'Páginas públicas')} className="pub-nav">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="pub-bar__end">
            {langToggle}
            {state.signedIn ? (
              <Link to={homeFor(state.role)} className="pub-signin">
                {tr('Back to the console', 'Volver a la consola')}
              </Link>
            ) : (
              <Link to="/sign-in" className="pub-signin">
                <Icon name="key" size={16} /> {tr('Sign in', 'Iniciar sesión')}
              </Link>
            )}
          </div>
        </div>
        <div className="pub-hero">
          <h1>{title}</h1>
          {sub && <p>{sub}</p>}
          {meta && <div className="pub-hero__meta">{meta}</div>}
        </div>
      </header>

      <main className="pub-main">{children}</main>

      <footer className="pub-foot">
        <nav aria-label={tr('Site', 'Sitio')} className="pub-foot__links">
          <Link to="/sign-in">{tr('Sign in', 'Iniciar sesión')}</Link>
          {links.map((l) => (
            <Link key={l.to} to={l.to}>
              {l.label}
            </Link>
          ))}
        </nav>
        <span className="mono">v2026.10.2</span>
      </footer>
    </div>
  );
}
