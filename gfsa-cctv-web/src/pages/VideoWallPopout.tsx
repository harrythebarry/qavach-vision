import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Convoy } from '../data/types';
import { NoAccess, Segmented, usePriorityName } from '../components/ui';
import { Icon } from '../components/Icon';
import { useApp } from '../state/AppState';
import { useFleet } from '../state/fleetStore';
import { pick, useTr, type Lang } from '../lib/i18n';
import { fmtCountdown, fmtTime, fmtTimeSec, useNow } from '../lib/time';
import { BudgetMeter, LAYOUTS, WallGrid, isUrgent, useWall, useWallConvoy, type Layout } from './VideoWall';
import { positionText, toTarget } from './screenText';
import './VideoWall.css';

// "Open on a second screen" from the video wall (VW-01 to VW-05): the wall on
// its own, full window, without the console around it. Layout, focus and
// overlays are the saved ones, so both windows stay in step; pinning, the
// budget plan and the audit lines work here exactly as on the console.

export function VideoWallPopoutPage() {
  const { can } = useApp();
  const tr = useTr();
  const [params] = useSearchParams();
  const { convoy, choices } = useWallConvoy(params.get('convoy'));
  if (!can('view_live') || !convoy) {
    return (
      <div className="vwp vwp--plain">
        <NoAccess what={tr('the video wall', 'el videowall')} />
      </div>
    );
  }
  return <PopoutWall convoy={convoy} choices={choices} />;
}

function PopoutWall({ convoy, choices }: { convoy: Convoy; choices: Convoy[] }) {
  const { state, can, acknowledgeAshore, setLang } = useApp();
  const lang = state.lang;
  const tr = useTr();
  const fleet = useFleet();
  const prio = usePriorityName();
  const [, setParams] = useSearchParams();
  const now = useNow();
  const wall = useWall(convoy, 'second screen');
  const noLink = convoy.link === 'none';
  const opened = typeof window !== 'undefined' && !!window.opener;
  const convoyLabel = (c: Convoy) => tr(`${c.name} convoy`, `Convoy ${c.name}`);

  // The window title names the wall, so it can be found among the windows on the second screen.
  useEffect(() => {
    const before = document.title;
    document.title = `${tr('Video wall', 'Videowall')} · ${convoy.name}`;
    return () => {
      document.title = before;
    };
  }, [convoy.name, tr]);

  // The newest urgent alarm not yet acknowledged ashore leads the alarm bar.
  const hot = wall.openAlarms.filter((a) => isUrgent(a) && a.state !== 'ack_shore').sort((a, b) => a.priority.localeCompare(b.priority) || b.raisedAt.localeCompare(a.raisedAt));
  const lead = hot[0];
  const leadCam = fleet.cameraById(lead?.cameraId);
  const left = lead?.escalatesAt ? new Date(lead.escalatesAt).getTime() - now : undefined;

  return (
    <div className="vwp">
      <header className="vwp-bar">
        <div className="vwp-bar__title">
          <span className="vwp-bar__logo" aria-hidden="true">
            <Icon name="logo" size={16} strokeWidth={2} />
          </span>
          <h1>{tr('Video wall', 'Videowall')}</h1>
          <label className="vwp-select">
            <span className="sr-only">{tr('Convoy on this wall', 'Convoy en este videowall')}</span>
            <select value={convoy.id} onChange={(e) => setParams({ convoy: e.target.value }, { replace: true })}>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {convoyLabel(c)}
                </option>
              ))}
            </select>
            <Icon name="chevronDown" size={14} strokeWidth={2} />
          </label>
          <span className="vwp-link">
            <span className={`dot${noLink ? ' dot--off' : convoy.link === 'weak' ? ' dot--warn' : ''}`} aria-hidden="true" />
            {noLink ? tr(`No link since ${fmtTime(convoy.lastSeen)}`, `Sin enlace desde las ${fmtTime(convoy.lastSeen)}`) : convoy.linkLabel}
          </span>
        </div>
        <div className="vwp-bar__controls">
          <Segmented<Layout>
            label={tr('Grid', 'Cuadrícula')}
            value={wall.layout}
            onChange={wall.setLayout}
            options={LAYOUTS.map((l) => ({ value: l.value, label: tr(l.label[0], l.label[1]) }))}
          />
          <label className="check vwp-check">
            <input type="checkbox" checked={wall.overlays} onChange={(e) => wall.setOverlays(e.target.checked)} />
            {tr('AI overlays', 'Superposiciones de IA')}
          </label>
          <BudgetMeter wall={wall} dark />
          <span className="vwp-clock mono" aria-label={tr('Time in Asunción', 'Hora de Asunción')}>
            {fmtTimeSec(now)}
          </span>
          <div role="group" aria-label={tr('Language', 'Idioma')} className="segmented vwp-lang">
            {(['es', 'en'] as Lang[]).map((l) => (
              <button key={l} type="button" lang={l} aria-pressed={lang === l} onClick={() => setLang(l)}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          {opened ? (
            <button type="button" className="vwp-btn" onClick={() => window.close()}>
              <Icon name="x" size={18} /> {tr('Close window', 'Cerrar ventana')}
            </button>
          ) : (
            <Link to={`/video-wall?convoy=${convoy.id}`} className="vwp-btn">
              <Icon name="chevronLeft" size={18} /> {tr('Back to the console', 'Volver a la consola')}
            </Link>
          )}
        </div>
      </header>

      {lead ? (
        <div className={`vwp-alarm vwp-alarm--${lead.priority.toLowerCase()}`} role="status">
          <span className={`badge badge--${lead.priority.toLowerCase()}`}>{prio(lead.priority)}</span>
          <span className="vwp-alarm__text">
            <strong>
              {lead.id} · {pick(lang, lead.title, lead.titleEs)}
            </strong>
            <span>
              {leadCam ? fleet.cameraLabel(leadCam.id) : convoyLabel(convoy)} · {fmtTimeSec(lead.raisedAt)} ·{' '}
              {lead.state === 'ack_board' ? tr('acknowledged on board', 'confirmada a bordo') : tr('not acknowledged on board', 'sin confirmar a bordo')}
              {left !== undefined &&
                (left > 0
                  ? tr(` · goes to ${toTarget(lead.escalatesTo, 'en')} in ${fmtCountdown(left)}`, ` · pasa ${toTarget(lead.escalatesTo, 'es')} en ${fmtCountdown(left)}`)
                  : tr(' · escalating now', ' · escalando ahora'))}
              {hot.length > 1 ? tr(` · ${hot.length - 1} more urgent`, ` · ${hot.length - 1} urgentes más`) : ''}
            </span>
          </span>
          {leadCam && leadCam.id !== wall.focusCam?.id && (
            <button type="button" className="vwp-btn" onClick={() => wall.focusOn(leadCam)}>
              <Icon name="eye" size={18} /> {tr('Show in focus', 'Mostrar en el foco')}
            </button>
          )}
          {can('acknowledge') && (
            <button type="button" className="vwp-btn vwp-btn--primary" onClick={() => acknowledgeAshore(lead.id)}>
              {tr('Acknowledge', 'Confirmar')}
            </button>
          )}
          <a href={`/alarms/${lead.id}`} target="gfsa-console" className="vwp-btn">
            {tr('Open in the console', 'Abrir en la consola')} <Icon name="external" size={16} />
          </a>
        </div>
      ) : noLink ? (
        <div className="vwp-alarm vwp-alarm--calm" role="status">
          <Icon name="wifiOff" size={18} />
          <span className="vwp-alarm__text">
            <strong>{tr(`${convoy.name} has no link to shore`, `${convoy.name} no tiene enlace a tierra`)}</strong>
            <span>
              {tr(
                `Since ${fmtTime(convoy.lastSeen)}, ${positionText(convoy.positionLabel, 'en', true)}. Tiles show the last snapshots; ${convoy.queuedEvents} events wait on board. They go live within the budget when coverage returns.`,
                `Desde las ${fmtTime(convoy.lastSeen)}, ${positionText(convoy.positionLabel, 'es', true)}. Los mosaicos muestran las últimas fotos; ${convoy.queuedEvents} eventos esperan a bordo. Pasan a vivo dentro del presupuesto cuando vuelva la cobertura.`,
              )}
            </span>
          </span>
        </div>
      ) : (
        <div className="vwp-alarm vwp-alarm--calm" role="status">
          <Icon name="check" size={18} />
          <span className="vwp-alarm__text">
            <strong>{tr('No urgent alarm waiting ashore on this convoy', 'Ninguna alarma urgente pendiente en tierra en este convoy')}</strong>
            <span>
              {tr(
                `${wall.openAlarms.length} open · a new P1 or P2 alarm takes the focus tile at once`,
                `${wall.openAlarms.length} abiertas · una nueva alarma P1 o P2 toma el foco de inmediato`,
              )}
            </span>
          </span>
        </div>
      )}

      <main className="vwp-main">
        <WallGrid wall={wall} now={now} fill alarmLinkTarget="gfsa-console" />
      </main>

      <footer className="vwp-foot">
        <span>{tr('Second screen · same layout, focus and overlays as the console', 'Segunda pantalla · mismo diseño, foco y superposiciones que la consola')}</span>
        <span>{tr('Every live view is written to the audit log', 'Cada vista en vivo queda en el registro de auditoría')}</span>
      </footer>
    </div>
  );
}
