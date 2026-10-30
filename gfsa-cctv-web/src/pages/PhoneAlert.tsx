import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { roleById } from '../data/users';
import type { Alarm } from '../data/types';
import { PriorityBadge } from '../components/ui';
import { Icon } from '../components/Icon';
import { useApp } from '../state/AppState';
import { useFleet } from '../state/fleetStore';
import { useRouting } from '../state/routingStore';
import { channelsText } from '../state/escalation';
import { pick, useTr, type Lang } from '../lib/i18n';
import { fmtAgo, fmtCountdown, fmtTimeSec, useNow } from '../lib/time';
import { detectionIn, targetName, toTarget } from './screenText';
import './PhoneAlert.css';

// PH-02, PH-03: the page behind the WhatsApp/SMS link. Built for one hand on a phone.
// It follows the live alarm: the countdown runs to the next step on the saved
// ladder, the history fills in as alert routing escalates, and the page speaks
// the recipient's language (ES/EN in the bar).

const CLIP_MS = 15_000;

/** Wheelhouse satellite or cell numbers per convoy (sample data). */
const WHEELHOUSE_PHONE: Record<string, string> = {
  tuy: '+595215550141',
  hum: '+595215550142',
  boq: '+595215550143',
};
const fmtPhone = (n: string) => n.replace(/^\+(\d{3})(\d{2})(\d{3})(\d{4})$/, '+$1 $2 $3 $4');

export function PhoneAlertPage() {
  const { id = '' } = useParams();
  const { state, can, log, toast, acknowledgeAshore, addActivity, setLang } = useApp();
  const lang = state.lang;
  const tr = useTr();
  const fleet = useFleet();
  const now = useNow(500);
  const alarm = state.alarms.find((a) => a.id === id);

  // PH-03: every page open is logged, once per page view.
  const logged = useRef('');
  useEffect(() => {
    if (logged.current === id) return;
    logged.current = id;
    log('Opened phone page', id || 'unknown link', alarm ? 'Alert link' : 'Alarm not found', alarm?.convoyId);
  }, [id, log, alarm]);

  // The 15 s clip: plays over the snapshot with the detection box moving.
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const clipLogged = useRef(false);
  useEffect(() => {
    if (!playing) return;
    const started = performance.now() - elapsed;
    const tick = window.setInterval(() => {
      const e = performance.now() - started;
      if (e >= CLIP_MS) {
        setElapsed(CLIP_MS);
        setPlaying(false);
      } else setElapsed(e);
    }, 100);
    return () => window.clearInterval(tick);
    // `elapsed` is read once when play starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const role = roleById(state.role);
  const roleName = lang === 'es' ? role.nameEs : role.name;

  const header = (
    <header className="ph-bar">
      <span className="ph-bar__brand">
        <span className="ph-bar__logo">
          <Icon name="logo" size={16} strokeWidth={2} />
        </span>
        <span className="ph-bar__name">CCTV Monitoring</span>
        <span className="ph-bar__tenant">· GFSA</span>
      </span>
      <span className="ph-bar__end">
        <span className="ph-bar__role">{roleName}</span>
        <span role="group" aria-label={tr('Language', 'Idioma')} className="ph-lang">
          {(['es', 'en'] as Lang[]).map((l) => (
            <button key={l} type="button" lang={l} aria-pressed={lang === l} onClick={() => setLang(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </span>
      </span>
    </header>
  );

  if (!alarm) {
    return (
      <div className="ph" lang={lang}>
        <div className="ph-shell">
          {header}
          <main className="ph-body">
            <div className="ph-missing">
              <Icon name="alert" size={28} />
              <h1>{tr('This alarm link does not work', 'Este enlace de alarma no funciona')}</h1>
              <p>
                {tr('We could not find alarm', 'No encontramos la alarma')} <span className="mono">{id || tr('(no ID)', '(sin ID)')}</span>.{' '}
                {tr('The link may be mistyped or have expired. Opening this page was logged.', 'El enlace puede estar mal escrito o haber vencido. La apertura de esta página quedó registrada.')}
              </p>
              <Link to="/alarms" className="ph-btn ph-btn--secondary">
                {tr('Open the alarm console', 'Abrir la consola de alarmas')}
              </Link>
            </div>
          </main>
        </div>
      </div>
    );
  }

  const cam = fleet.cameraById(alarm.cameraId);
  const vessel = fleet.vesselById(alarm.vesselId ?? cam?.vesselId);
  const convoy = fleet.convoyById(alarm.convoyId);
  const ackBoard = alarm.stateTimes.ack_board;
  const ackShore = alarm.stateTimes.ack_shore;
  const closed = alarm.state === 'resolved' || alarm.state === 'closed';
  const left = alarm.escalatesAt ? new Date(alarm.escalatesAt).getTime() - now : undefined;
  const canAck = can('acknowledge');
  const clip = alarm.evidence.find((e) => e.name.startsWith('Clip'));
  const det = alarm.detection && alarm.detection.box.w < 90 ? alarm.detection : undefined;
  const drift = playing || elapsed > 0 ? Math.sin((elapsed / CLIP_MS) * Math.PI * 2) * 1.5 : 0;
  const tel = WHEELHOUSE_PHONE[alarm.convoyId];
  const next = toTarget(alarm.escalatesTo, lang);
  const convoyName = convoy ? tr(`${convoy.name} convoy`, `convoy ${convoy.name}`) : '';
  const stateWord: Record<Alarm['state'], [string, string]> = {
    raised: ['raised', 'generada'],
    ack_board: ['acknowledged on board', 'confirmada a bordo'],
    ack_shore: ['acknowledged ashore', 'confirmada en tierra'],
    resolved: ['resolved', 'resuelta'],
    closed: ['closed', 'cerrada'],
  };

  const togglePlay = () => {
    if (!playing && !clipLogged.current) {
      clipLogged.current = true;
      log('Viewed clip', alarm.id, 'Phone page', alarm.convoyId);
    }
    if (!playing && elapsed >= CLIP_MS) setElapsed(0);
    setPlaying((p) => !p);
  };

  const callWheelhouse = () => {
    addActivity(alarm.id, 'Called the wheelhouse', 'Llamada al puente');
    log('Called the wheelhouse', alarm.id, `${convoy?.name ?? alarm.convoyId} · ${tel} · from the phone page`, alarm.convoyId);
    toast(tr(`Calling the ${convoy?.name} wheelhouse. The call is on the alarm's activity.`, `Llamando al puente de ${convoy?.name}. La llamada queda en la actividad de la alarma.`));
  };

  return (
    <div className="ph" lang={lang}>
      <div className="ph-shell">
        {header}
        <main className="ph-body">
          <div className="ph-head">
            <div className="ph-head__meta">
              <PriorityBadge p={alarm.priority} />
              <span className="ph-head__when">
                <span className="mono">{alarm.id}</span> · {fmtTimeSec(alarm.raisedAt)} · {fmtAgo(alarm.raisedAt, now)}
              </span>
            </div>
            <h1>{pick(lang, alarm.title, alarm.titleEs)}</h1>
            <p className="ph-head__where">
              {cam ? (
                <>
                  {vessel?.name} · {tr(`${cam.name} camera`, `cámara ${cam.name}`)}
                </>
              ) : (
                pick(lang, alarm.description, alarm.descriptionEs)
              )}
              <br />
              {convoyName.replace(/^c/, 'C')}
              {alarm.voyageId ? ` · ${alarm.voyageId}` : ''}
            </p>
          </div>

          {cam && (
            <div className="ph-clip">
              <img src={cam.image} alt={tr(`${cam.name} camera: ${alarm.description}`, `Cámara ${cam.name}: ${pick(lang, alarm.description, alarm.descriptionEs)}`)} />
              {det && (
                <div
                  className="ph-clip__box"
                  title={detectionIn(det, lang)?.label}
                  style={{ left: `${det.box.x + drift}%`, top: `${det.box.y}%`, width: `${det.box.w}%`, height: `${det.box.h}%` }}
                />
              )}
              {clip ? (
                <>
                  <button
                    type="button"
                    className="ph-clip__play"
                    aria-label={playing ? tr('Pause the clip', 'Pausar el clip') : tr(`Play the ${CLIP_MS / 1000} second clip`, `Reproducir el clip de ${CLIP_MS / 1000} segundos`)}
                    onClick={togglePlay}
                  >
                    <Icon name={playing ? 'pause' : 'play'} size={22} strokeWidth={2.2} />
                  </button>
                  <span className="ph-clip__tag mono">{elapsed > 0 ? `${fmtCountdown(elapsed)} / ${fmtCountdown(CLIP_MS)}` : tr('15 s clip', 'Clip de 15 s')}</span>
                  {elapsed > 0 && (
                    <span className="ph-clip__progress" aria-hidden="true">
                      <span style={{ width: `${(elapsed / CLIP_MS) * 100}%` }} />
                    </span>
                  )}
                </>
              ) : (
                <span className="ph-clip__tag">{tr('Snapshot · clip still uploading', 'Foto · el clip todavía se está subiendo')}</span>
              )}
            </div>
          )}

          <div className="ph-status">
            <div className="ph-status__row">
              {ackBoard ? (
                <>
                  <Icon name="check" size={18} strokeWidth={2.4} style={{ color: 'var(--ok-text)', marginTop: 2 }} />
                  <span>
                    {tr('Wheelhouse acknowledged on board at', 'El puente confirmó a bordo a las')} <span className="mono">{fmtTimeSec(ackBoard)}</span>
                  </span>
                </>
              ) : (
                <>
                  <Icon name="clock" size={18} strokeWidth={2.2} style={{ color: 'var(--muted)', marginTop: 2 }} />
                  <span>{tr('Not acknowledged on board yet', 'Todavía sin confirmar a bordo')}</span>
                </>
              )}
            </div>
            {ackShore ? (
              <div className="ph-status__row">
                <Icon name="check" size={18} strokeWidth={2.4} style={{ color: 'var(--ok-text)', marginTop: 2 }} />
                <span>
                  {alarm.owner && alarm.owner !== 'System'
                    ? tr(`Acknowledged ashore by ${alarm.owner} at`, `Confirmada en tierra por ${alarm.owner} a las`)
                    : tr('Acknowledged ashore at', 'Confirmada en tierra a las')}{' '}
                  <span className="mono">{fmtTimeSec(ackShore)}</span>. {tr('Escalation stopped.', 'Escalamiento detenido.')}
                </span>
              </div>
            ) : closed ? (
              <div className="ph-status__row">
                <Icon name="check" size={18} strokeWidth={2.4} style={{ color: 'var(--ok-text)', marginTop: 2 }} />
                <span>{tr(`This alarm is ${stateWord[alarm.state][0]}. Nothing more to do here.`, `Esta alarma está ${stateWord[alarm.state][1]}. No hay nada más que hacer aquí.`)}</span>
              </div>
            ) : (
              <div className="ph-status__row ph-status__row--hot" role="timer" aria-live="off">
                <Icon name="clock" size={18} strokeWidth={2.2} style={{ color: 'var(--p2-text)', marginTop: 2 }} />
                <span>
                  {left === undefined ? (
                    (alarm.escalatedTo ?? []).length ? (
                      tr('Not acknowledged ashore yet. Every step on the ladder has been alerted.', 'Todavía sin confirmar en tierra. Ya se avisó a todos los pasos de la escala.')
                    ) : (
                      tr('Not acknowledged ashore yet.', 'Todavía sin confirmar en tierra.')
                    )
                  ) : left > 0 ? (
                    <>
                      {tr(`Not acknowledged ashore yet. Goes to ${next} in`, `Todavía sin confirmar en tierra. Pasa ${next} en`)}{' '}
                      <strong className="mono ph-countdown">{fmtCountdown(left)}</strong>
                    </>
                  ) : (
                    <strong className="ph-countdown">{tr(`Not acknowledged ashore. Alerting ${next} now.`, `Sin confirmar en tierra. Se avisa ahora ${next}.`)}</strong>
                  )}
                </span>
              </div>
            )}
          </div>

          <EscalationHistory alarm={alarm} now={now} />

          <div className="ph-actions">
            {!closed && (
              <button type="button" className="ph-btn ph-btn--primary" disabled={!!ackShore || !canAck} onClick={() => acknowledgeAshore(alarm.id)}>
                {ackShore ? (
                  <>
                    <Icon name="check" size={20} strokeWidth={2.4} /> {tr('Acknowledged', 'Confirmada')}
                  </>
                ) : (
                  tr('Acknowledge', 'Confirmar')
                )}
              </button>
            )}
            {!canAck && !ackShore && !closed && (
              <p className="ph-note">
                {tr(
                  `Your role (${roleName}) cannot acknowledge alarms. A duty officer, operations manager or fleet superintendent can.`,
                  `Su rol (${roleName}) no puede confirmar alarmas. Puede hacerlo un oficial de guardia, gerente de operaciones o superintendente de flota.`,
                )}
              </p>
            )}
            {tel && (
              <a href={`tel:${tel}`} className="ph-btn ph-btn--secondary" onClick={callWheelhouse}>
                <Icon name="phone" size={18} strokeWidth={2} /> {tr('Call the wheelhouse', 'Llamar al puente')}
                <span className="ph-btn__sub mono">{fmtPhone(tel)}</span>
              </a>
            )}
            <Link to={`/alarms/${alarm.id}`} className="ph-link">
              {tr('Open in the alarm console', 'Abrir en la consola de alarmas')}
            </Link>
          </div>

          <p className="ph-foot">
            {tr(
              `Sent to you by WhatsApp as ${roleName} for the ${convoyName}. Opening this page is logged.`,
              `Se le envió por WhatsApp como ${roleName} para el ${convoyName}. La apertura de esta página queda registrada.`,
            )}
          </p>
        </main>
      </div>
    </div>
  );
}

/** Who has been alerted so far on the saved ladder, and who is next (RT-01, ALM-03). */
function EscalationHistory({ alarm, now }: { alarm: Alarm; now: number }) {
  const { state } = useApp();
  const lang = state.lang;
  const tr = useTr();
  const routing = useRouting();
  const ladder = routing.ladders[alarm.priority];
  const steps = [
    ...ladder.filter((s) => s.when === 'now' && s.channels.length > 0),
    ...ladder.filter((s) => s.when === 'after').sort((a, b) => a.minutes - b.minutes),
  ];
  const done = new Set(alarm.escalatedTo ?? []);
  // Steps already messaged that are no longer on the saved ladder still belong to the history.
  const extra = [...done].filter((t) => !steps.some((s) => s.target === t));
  if (!steps.length && !extra.length) return null;

  const stopped = !!alarm.stateTimes.ack_shore || alarm.state === 'resolved' || alarm.state === 'closed';
  const sentAt = (target: string) => alarm.activity.find((x) => x.text.toLowerCase().includes(`sent to the ${target.toLowerCase()}`))?.at;
  const left = alarm.escalatesAt ? new Date(alarm.escalatesAt).getTime() - now : undefined;

  const rows = [
    ...extra.map((t) => ({ target: t, channels: '', when: '', status: 'done' as const, at: sentAt(t) })),
    ...steps.map((s) => {
      const channels = lang === 'es' ? channelsText.es(s.channels) : channelsText.en(s.channels);
      const when = s.when === 'now' ? tr('at once', 'de inmediato') : tr(`after ${s.minutes} min`, `a los ${s.minutes} min`);
      const status: 'done' | 'next' | 'stopped' | 'later' = done.has(s.target)
        ? 'done'
        : stopped
          ? 'stopped'
          : alarm.escalatesTo === s.target
            ? 'next'
            : 'later';
      return { target: s.target, channels, when, status, at: done.has(s.target) ? sentAt(s.target) : undefined };
    }),
  ];

  return (
    <section className="ph-esc" aria-labelledby="ph-esc-title">
      <h2 id="ph-esc-title">{tr('Escalation', 'Escalamiento')}</h2>
      <ol>
        {rows.map((r) => (
          <li key={r.target} className={`ph-esc__step ph-esc__step--${r.status}`}>
            <span className="ph-esc__dot" aria-hidden="true">
              {r.status === 'done' && <Icon name="check" size={12} strokeWidth={3} />}
            </span>
            <span className="ph-esc__text">
              <strong>{targetName(r.target, lang)}</strong>
              <span>
                {r.status === 'done'
                  ? r.at
                    ? tr(`Alerted at ${fmtTimeSec(r.at)}`, `Avisado a las ${fmtTimeSec(r.at)}`)
                    : tr('Alerted', 'Avisado')
                  : r.status === 'next'
                    ? left !== undefined && left > 0
                      ? tr(`Next, in ${fmtCountdown(left)}`, `Siguiente, en ${fmtCountdown(left)}`)
                      : tr('Being alerted now', 'Se le avisa ahora')
                    : r.status === 'stopped'
                      ? tr('Not needed: acknowledged ashore', 'No hace falta: confirmada en tierra')
                      : tr(`If nobody acknowledges, ${r.when}`, `Si nadie confirma, ${r.when}`)}
                {r.channels ? ` · ${r.channels}` : ''}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
