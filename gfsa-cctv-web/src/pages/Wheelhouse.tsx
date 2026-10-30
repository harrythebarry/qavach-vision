import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useCaseById } from '../data/useCases';
import type { Alarm, Camera, EdgeUnit, Vessel } from '../data/types';
import { CameraFrame, usePriorityName } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import { useApp } from '../state/AppState';
import { useFleet, type Fleet } from '../state/fleetStore';
import { usePersistentState } from '../lib/persist';
import { pick, useTr, type Lang } from '../lib/i18n';
import { fmtAgo, fmtCountdown, fmtDuration, fmtTime, fmtTimeSec, scenarioNow, useNow } from '../lib/time';
import { detectionIn, healthNote, healthShort, isMirrored } from './screenText';
import './Wheelhouse.css';

// WH-01 to WH-04: the wheelhouse display on the tug. Alerts come from the AI units on
// board, so the display works without the shore link. It follows the live alarms of
// the master's convoy: a P1/P2 alarm not yet acknowledged on board takes the screen
// with the buzzer; everything else is listed under "Also open".

const SILENCE_MS = 2 * 60_000;
const BRIGHTNESS = [0.35, 0.5, 0.65, 0.8, 1];

const isUrgent = (a: Alarm) => (a.priority === 'P1' || a.priority === 'P2') && a.state !== 'resolved' && a.state !== 'closed';
/** Takes the screen until the wheelhouse acknowledges it (WH-01, WH-03). */
const needsBoardAck = (a: Alarm) => isUrgent(a) && !a.stateTimes.ack_board;
const byUrgency = (a: Alarm, b: Alarm) => a.priority.localeCompare(b.priority) || b.raisedAt.localeCompare(a.raisedAt);
const iso = () => new Date(scenarioNow()).toISOString();

function alarmIcon(a: Alarm): IconName {
  const uc = useCaseById(a.useCaseId);
  if (a.useCaseId === 'camera-health') return a.cameraId ? 'droplet' : 'wifiOff';
  if (a.useCaseId === 'reefer-rounds') return 'clock';
  if (uc?.category === 'Fire and smoke') return 'flame';
  return 'alert';
}

/** The use case's next step, naming the vessel. */
function nextStepFor(a: Alarm, vessel: Vessel | undefined, lang: Lang): string {
  const uc = useCaseById(a.useCaseId);
  if (!uc) return lang === 'es' ? 'Revise la cámara y avise a tierra.' : 'Check the camera and tell shore.';
  if (lang === 'es') {
    const t = uc.nextStepEs;
    return vessel ? t.replace('de la barcaza', `de ${vessel.name}`).replace('en la barcaza', `en ${vessel.name}`) : t;
  }
  return vessel ? uc.nextStep.replace('on the barge', `on ${vessel.name}`) : uc.nextStep;
}

const UNIT_STATUS: Record<EdgeUnit['status'], [string, string]> = {
  reporting: ['Reporting', 'Reportando'],
  out_of_coverage: ['Out of coverage, queuing', 'Sin cobertura, en cola'],
  restarting: ['Restarting', 'Reiniciando'],
  fault: ['Fault', 'Falla'],
};

/** Web Audio buzzer: a two-tone beep every second while `on`. */
function useBuzzer(on: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  const [blocked, setBlocked] = useState(false);

  const ensure = useCallback(() => {
    if (!ctxRef.current) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctxRef.current = new AC();
    }
    const ctx = ctxRef.current;
    if (ctx.state === 'suspended') {
      ctx.resume().then(
        () => setBlocked(false),
        () => setBlocked(true),
      );
    }
    setBlocked(ctx.state !== 'running');
    return ctx;
  }, []);

  const beep = useCallback(() => {
    const ctx = ensure();
    if (!ctx || ctx.state !== 'running') return;
    const t0 = ctx.currentTime;
    [0, 0.22].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = i === 0 ? 880 : 660;
      gain.gain.setValueAtTime(0.0001, t0 + offset);
      gain.gain.exponentialRampToValueAtTime(0.12, t0 + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + offset);
      osc.stop(t0 + offset + 0.2);
    });
  }, [ensure]);

  useEffect(() => {
    if (!on) return;
    beep();
    const id = window.setInterval(beep, 1000);
    return () => window.clearInterval(id);
  }, [on, beep]);

  // Browsers only start audio after a gesture: any tap on the display unlocks it.
  useEffect(() => {
    const unlock = () => ensure();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [ensure]);

  useEffect(
    () => () => {
      ctxRef.current?.close().catch(() => undefined);
      ctxRef.current = null;
    },
    [],
  );

  return { blocked: on && blocked, beep };
}

type View = { mode: 'snapshot' } | { mode: 'live'; cameraId: string };

export function WheelhousePage() {
  const { state, log, toast, acknowledgeOnBoard, patchAlarm, setLang } = useApp();
  const lang = state.lang;
  const tr = useTr();
  const prio = usePriorityName();
  const fleet = useFleet();
  const now = useNow();
  const convoy = fleet.convoyById(state.user.convoyId ?? 'tuy') ?? fleet.convoyById('tuy') ?? fleet.convoys[0];
  const vessels = fleet.vesselsOf(convoy.id);
  const barges = vessels.filter((v) => v.kind === 'barge');
  const cams = fleet.camerasOf(convoy.id);
  const units = fleet.unitsOf(convoy.id);
  const tugUnit = units.find((u) => fleet.vesselById(u.vesselId)?.kind === 'tug') ?? units[0];
  const noLink = convoy.link === 'none';

  // Saved on this display: brightness, and the buzzer silence for the alarm on screen.
  const [brightness, setBrightness] = usePersistentState<number>('wheelhouse.brightness', BRIGHTNESS.length - 1);
  const [silence, setSilence] = usePersistentState<{ alarmId: string; until: number } | null>('wheelhouse.silence', null);
  const [view, setView] = useState<View>({ mode: 'snapshot' });
  const [calmCam, setCalmCam] = useState<string>('');

  const convoyAlarms = useMemo(() => state.alarms.filter((a) => a.convoyId === convoy.id && a.state !== 'closed'), [state.alarms, convoy.id]);
  const urgentQueue = useMemo(() => convoyAlarms.filter(needsBoardAck).sort(byUrgency), [convoyAlarms]);
  const alarm = urgentQueue[0];
  // The calm screen shows the latest urgent alarm the wheelhouse acknowledged, while it is still open.
  const lastAcked = useMemo(
    () =>
      convoyAlarms
        .filter((a) => isUrgent(a) && a.stateTimes.ack_board)
        .sort((a, b) => (b.stateTimes.ack_board ?? '').localeCompare(a.stateTimes.ack_board ?? ''))[0],
    [convoyAlarms],
  );
  const others = convoyAlarms.filter((a) => a.id !== alarm?.id && (alarm || a.id !== lastAcked?.id) && a.state !== 'resolved').sort(byUrgency);

  const silenced = !!alarm && !!silence && silence.alarmId === alarm.id && silence.until > now;
  const { blocked, beep } = useBuzzer(!!alarm && !silenced);

  // A new alarm on screen starts on its snapshot.
  const alarmId = alarm?.id;
  useEffect(() => {
    setView({ mode: 'snapshot' });
  }, [alarmId]);

  const cam = fleet.cameraById(alarm?.cameraId);
  const calmCamera = fleet.cameraById(calmCam) ?? cams.find((c) => c.health !== 'offline') ?? cams[0];
  const isLive = view.mode === 'live';
  const shownCam = isLive ? fleet.cameraById(view.cameraId) : cam;

  // Every live view is logged (VW-05 applies on board too), each time it starts.
  const liveCam = alarm ? (isLive ? view.cameraId : undefined) : calmCamera?.id;
  const lastLive = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (lastLive.current === liveCam) return;
    lastLive.current = liveCam;
    if (liveCam) log('Viewed live', liveCam, `Wheelhouse display · ${convoy.name}`, convoy.id);
  }, [liveCam, log, convoy.id, convoy.name]);

  const acknowledge = () => {
    if (!alarm) return;
    if (alarm.state === 'raised') {
      acknowledgeOnBoard(alarm.id, 'Wheelhouse');
    } else {
      // Already acknowledged ashore: record the board acknowledgement without moving the alarm back.
      const at = iso();
      patchAlarm(alarm.id, (a) =>
        a.stateTimes.ack_board
          ? a
          : { ...a, stateTimes: { ...a.stateTimes, ack_board: at }, activity: [...a.activity, { at, text: 'Acknowledged on board', textEs: 'Confirmada a bordo', actor: 'Wheelhouse' }] },
      );
      log('Acknowledged alarm', alarm.id, 'On the wheelhouse display', alarm.convoyId);
    }
    setSilence(null);
    toast(
      noLink
        ? tr(`${alarm.id} acknowledged on board. It goes ashore when the link returns.`, `${alarm.id} confirmada a bordo. Se envía a tierra cuando vuelva el enlace.`)
        : tr(`${alarm.id} acknowledged on board and sent ashore.`, `${alarm.id} confirmada a bordo y enviada a tierra.`),
    );
  };

  const toggleSilence = () => {
    if (!alarm) return;
    if (silenced) {
      setSilence(null);
      log('Turned the buzzer back on', alarm.id, 'Wheelhouse display', alarm.convoyId);
    } else {
      setSilence({ alarmId: alarm.id, until: scenarioNow() + SILENCE_MS });
      log('Silenced buzzer', alarm.id, 'Wheelhouse display · 2 min', alarm.convoyId);
    }
  };

  const showLive = (id: string) => {
    setView({ mode: 'live', cameraId: id });
  };

  const vessel = fleet.vesselById(alarm?.vesselId ?? cam?.vesselId);
  const healthy = cams.filter((c) => c.health === 'healthy').length;
  const unitsUp = units.filter((u) => u.status === 'reporting' || u.status === 'out_of_coverage').length;
  const queued = units.reduce((s, u) => s + u.queue.events, 0);
  const camText = (c: Camera) => tr(`${c.name} camera`, `Cámara ${c.name}`);

  return (
    <div className="wh" lang={lang} style={{ filter: brightness < BRIGHTNESS.length - 1 ? `brightness(${BRIGHTNESS[brightness]})` : undefined }}>
      <header className="wh-bar">
        <div className="wh-bar__title">
          <span className="wh-bar__name">
            {convoy.name} · {tr('Wheelhouse', 'Puente')}
          </span>
          <span className="wh-bar__sub">
            {barges.length
              ? tr(`Pushing ${barges.map((b) => b.name).join(' and ')}`, `Empujando ${barges.map((b) => b.name).join(' y ')}`)
              : tr('No barges in the convoy', 'Sin barcazas en el convoy')}
          </span>
        </div>
        <div className="wh-bar__status">
          <span className="wh-pill">
            <span className={`wh-dot wh-dot--${noLink ? 'off' : convoy.link === 'weak' ? 'warn' : 'ok'}`} aria-hidden="true" />
            {noLink
              ? tr(`Shore link none · ${fmtDuration(now - new Date(convoy.lastSeen).getTime())}`, `Sin enlace a tierra · ${fmtDuration(now - new Date(convoy.lastSeen).getTime())}`)
              : tr(`Shore link ${convoy.linkLabel}`, `Enlace a tierra ${convoy.linkLabel}`)}
          </span>
          <span className="wh-pill">
            <span className={`wh-dot wh-dot--${healthy === cams.length ? 'ok' : 'warn'}`} aria-hidden="true" />
            {tr(`Cameras ${healthy} of ${cams.length}`, `Cámaras ${healthy} de ${cams.length}`)}
          </span>
          <span className="wh-pill">
            <span className={`wh-dot wh-dot--${unitsUp === units.length ? 'ok' : 'warn'}`} aria-hidden="true" />
            {tr(`AI units ${unitsUp} of ${units.length}`, `Unidades de IA ${unitsUp} de ${units.length}`)}
          </span>
          <span className="wh-clock mono" aria-label={tr('Time on board', 'Hora a bordo')}>
            {fmtTimeSec(now)}
          </span>
          <div role="group" aria-label={tr('Screen brightness', 'Brillo de la pantalla')} className="wh-bright">
            <button
              type="button"
              aria-label={tr('Dimmer', 'Más oscuro')}
              title={brightness === 0 ? tr('Already at the lowest brightness', 'Ya está en el brillo mínimo') : tr('Dimmer', 'Más oscuro')}
              className="wh-btn wh-btn--sq"
              disabled={brightness === 0}
              onClick={() => setBrightness((b) => Math.max(0, b - 1))}
            >
              <Icon name="sunDim" size={18} strokeWidth={2} />
            </button>
            <button
              type="button"
              aria-label={tr('Brighter', 'Más brillo')}
              title={brightness === BRIGHTNESS.length - 1 ? tr('Already at full brightness', 'Ya está en el brillo máximo') : tr('Brighter', 'Más brillo')}
              className="wh-btn wh-btn--sq"
              disabled={brightness === BRIGHTNESS.length - 1}
              onClick={() => setBrightness((b) => Math.min(BRIGHTNESS.length - 1, b + 1))}
            >
              <Icon name="sun" size={20} strokeWidth={2} />
            </button>
          </div>
          <div role="group" aria-label={tr('Language', 'Idioma')} className="wh-lang">
            {(['es', 'en'] as Lang[]).map((l) => (
              <button key={l} type="button" lang={l} className="wh-btn" aria-pressed={lang === l} onClick={() => setLang(l)}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <Link to="/" className="wh-btn wh-btn--sq" aria-label={tr('Leave the display', 'Salir de la pantalla')} title={tr('Leave the display', 'Salir de la pantalla')}>
            <Icon name="logout" size={18} strokeWidth={2} />
          </Link>
        </div>
      </header>

      {blocked && (
        <button type="button" className="wh-unlock" onClick={() => beep()}>
          <Icon name="bell" size={18} strokeWidth={2} /> {tr('Tap here to turn on the alarm buzzer', 'Toque aquí para activar la alarma sonora')}
        </button>
      )}

      <p className="sr-only" aria-live="assertive">
        {alarm
          ? tr(`Urgent alarm ${alarm.priority}: ${alarm.title}.`, `Alarma urgente ${alarm.priority}: ${pick(lang, alarm.title, alarm.titleEs)}.`) +
            (cam ? ` ${fleet.vesselById(cam.vesselId)?.name}, ${camText(cam)}.` : '')
          : tr('No urgent alarms', 'Sin alarmas urgentes')}
      </p>

      <div className="wh-body">
        {alarm ? (
          <section aria-labelledby="wh-alert-title" className={`wh-alert wh-alert--${alarm.priority.toLowerCase()}`}>
            <div className="wh-alert__bar">
              <Icon name="alert" size={26} strokeWidth={2.2} />
              <h1 id="wh-alert-title">
                {prio(alarm.priority)} · {pick(lang, alarm.title, alarm.titleEs)}
              </h1>
              <span className="mono wh-alert__ago">{fmtAgo(alarm.raisedAt, now)}</span>
            </div>

            <div className="wh-alert__main">
              <div className="wh-alert__frame">
                {shownCam && shownCam.health !== 'offline' ? (
                  <CameraFrame
                    src={shownCam.image}
                    alt={
                      isLive
                        ? tr(`Live view of ${fleet.cameraLabel(shownCam.id)}`, `Vista en vivo de ${fleet.cameraLabel(shownCam.id)}`)
                        : tr(`${camText(shownCam)} on ${vessel?.name}: ${alarm.description}`, `${camText(shownCam)} en ${vessel?.name}: ${pick(lang, alarm.description, alarm.descriptionEs)}`)
                    }
                    detection={isLive && view.cameraId !== cam?.id ? undefined : detectionIn(alarm.detection, lang)}
                    degraded={shownCam.health === 'degraded'}
                    rounded={10}
                  >
                    <span className="wh-frame-tag mono">
                      {isLive ? (
                        <>
                          <span className="wh-dot wh-dot--ok wh-dot--pulse" aria-hidden="true" />
                          {tr('LIVE', 'EN VIVO')} · {shownCam.id === cam?.id ? '' : `${shownCam.name} · `}
                          {fmtTimeSec(now - 1500)}
                        </>
                      ) : (
                        tr(`Snapshot ${fmtTimeSec(alarm.raisedAt)}`, `Foto ${fmtTimeSec(alarm.raisedAt)}`)
                      )}
                    </span>
                  </CameraFrame>
                ) : (
                  <div className="wh-noimage">
                    <Icon name="wifiOff" size={26} />
                    <span>{shownCam ? tr(`No image from the ${shownCam.name} camera`, `Sin imagen de la cámara ${shownCam.name}`) : tr('No camera on this alarm', 'Esta alarma no tiene cámara')}</span>
                  </div>
                )}
              </div>
              <div className="wh-alert__facts">
                <div className="wh-alert__vessel">{vessel?.name ?? convoy.name}</div>
                {cam && <div className="wh-alert__cam">{camText(cam)}</div>}
                <div className="wh-alert__desc">{pick(lang, alarm.description, alarm.descriptionEs)}</div>
                <div className="wh-alert__meta">
                  <span className="mono wh-alert__time">{fmtTimeSec(alarm.raisedAt)}</span>
                  <span className="wh-muted">{tr(`Detected by the AI unit on ${vessel?.name ?? convoy.name}`, `Detectada por la unidad de IA de ${vessel?.name ?? convoy.name}`)}</span>
                  <span className="mono wh-alert__id">{tr(`Alarm ${alarm.id}`, `Alarma ${alarm.id}`)}</span>
                </div>
              </div>
            </div>

            <div className="wh-next">
              <span className="wh-next__label">{tr('Next step', 'Próximo paso')}</span>
              <span className="wh-next__text">{nextStepFor(alarm, vessel, lang)}</span>
            </div>

            <Progress alarm={alarm} linkLabel={noLink ? undefined : convoy.linkLabel} />

            <div className="wh-actions">
              <button type="button" className="wh-ack" onClick={acknowledge}>
                {tr('Acknowledge', 'Confirmar')}
              </button>
              {cam && (
                <button
                  type="button"
                  className="wh-btn wh-btn--big"
                  aria-pressed={isLive}
                  onClick={() => (isLive ? setView({ mode: 'snapshot' }) : showLive(cam.id))}
                >
                  <Icon name={isLive ? 'eye' : 'video'} size={22} strokeWidth={2} />
                  {isLive ? tr('Show snapshot', 'Ver la foto') : tr('Show live', 'Ver en vivo')}
                </button>
              )}
              <button type="button" className="wh-btn wh-btn--big" aria-pressed={silenced} onClick={toggleSilence}>
                <Icon name="mute" size={22} strokeWidth={2} />
                {silenced && silence ? (
                  <span>
                    {tr('Silenced', 'Silenciada')} <span className="mono">{fmtCountdown(silence.until - now)}</span>
                  </span>
                ) : (
                  tr('Silence 2 min', 'Silenciar 2 min')
                )}
              </button>
            </div>
            {urgentQueue.length > 1 && (
              <p className="wh-queue">
                {tr(
                  `${urgentQueue.length - 1} more urgent alarm${urgentQueue.length > 2 ? 's' : ''} waiting after this one`,
                  `${urgentQueue.length - 1} alarma${urgentQueue.length > 2 ? 's' : ''} urgente${urgentQueue.length > 2 ? 's' : ''} más en espera después de esta`,
                )}
              </p>
            )}
          </section>
        ) : (
          <section aria-labelledby="wh-calm-title" className="wh-calm">
            <div className="wh-calm__head">
              <span className="wh-calm__icon">
                <Icon name="check" size={26} strokeWidth={2.4} />
              </span>
              <div>
                <h1 id="wh-calm-title">{tr('No urgent alarms', 'Sin alarmas urgentes')}</h1>
                <p className="wh-muted">
                  {tr(
                    `The AI units on board are watching ${cams.length} cameras. Urgent alarms show here within 5 s, with or without the shore link.`,
                    `Las unidades de IA a bordo vigilan ${cams.length} cámaras. Las alarmas urgentes aparecen aquí en 5 s, con o sin enlace a tierra.`,
                  )}
                </p>
              </div>
            </div>
            {lastAcked && <LastAcknowledged alarm={lastAcked} fleet={fleet} now={now} onShow={(id) => setCalmCam(id)} linkLabel={noLink ? undefined : convoy.linkLabel} />}
            <CalmView cams={cams} vessels={vessels} selected={calmCamera} onSelect={setCalmCam} now={now} alarms={convoyAlarms} />
          </section>
        )}

        <div className="wh-side">
          {alarm && (
            <section aria-labelledby="wh-cams-title" className="wh-panel">
              <h2 id="wh-cams-title">{tr('Cameras', 'Cámaras')}</h2>
              <CameraGrid cams={cams} vessels={vessels} alarms={convoyAlarms} selected={isLive ? view.cameraId : undefined} onSelect={showLive} />
            </section>
          )}

          <section aria-labelledby="wh-other-title" className="wh-panel">
            <h2 id="wh-other-title">{alarm ? tr('Also open', 'También abiertas') : tr('Open alarms', 'Alarmas abiertas')}</h2>
            {others.length === 0 ? (
              <p className="wh-muted">{tr('Nothing else open on this convoy.', 'No hay nada más abierto en este convoy.')}</p>
            ) : (
              <ul className="wh-others">
                {others.map((a) => {
                  const c = fleet.cameraById(a.cameraId);
                  const v = fleet.vesselById(a.vesselId ?? c?.vesselId);
                  const tone = a.priority <= 'P2' ? 'bad' : 'warn';
                  const board = needsBoardAck(a)
                    ? tr(' · waiting for acknowledgement', ' · esperando confirmación')
                    : a.stateTimes.ack_board
                      ? tr(' · acknowledged on board', ' · confirmada a bordo')
                      : '';
                  return (
                    <li key={a.id}>
                      <span className={`wh-others__icon wh-others__icon--${tone}`}>
                        <Icon name={alarmIcon(a)} size={18} strokeWidth={2.2} />
                      </span>
                      <span className="wh-others__text">
                        <strong>{pick(lang, a.title, a.titleEs)}</strong>
                        <span>
                          {c ? `${v?.name} · ${c.name}` : tr(`${convoy.name} convoy`, `Convoy ${convoy.name}`)} · {tr(`since ${fmtTime(a.raisedAt)}`, `desde las ${fmtTime(a.raisedAt)}`)}
                          {board}
                          {a.state === 'ack_shore' ? tr(' · ashore on it', ' · en tierra la atienden') : ''}
                        </span>
                      </span>
                      <span className={`badge badge--${a.priority.toLowerCase()}`}>{a.priority}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="wh-units-title" className="wh-panel">
            <h2 id="wh-units-title">{tr('AI units on board', 'Unidades de IA a bordo')}</h2>
            <div className="wh-units">
              <span>
                <span className="wh-muted">{tr('Queue on board', 'Cola a bordo')}</span>
                <strong>{queued ? tr(`${queued} events waiting`, `${queued} eventos en espera`) : tr('Empty', 'Vacía')}</strong>
              </span>
              <span>
                <span className="wh-muted">{tr('Last shore sync', 'Última sincronización con tierra')}</span>
                <strong className="mono">{fmtTimeSec(convoy.lastSeen)}</strong>
              </span>
              <span>
                <span className="wh-muted">{tr('Models', 'Modelos')}</span>
                <strong>
                  {tugUnit?.modelVersion ?? '—'}
                  {tugUnit && !tugUnit.modelConfirmed ? tr(' · update waiting', ' · actualización pendiente') : ''}
                </strong>
              </span>
              <span>
                <span className="wh-muted">{tr('Alerts work offline', 'Alertas sin enlace')}</span>
                <strong>{tr('Yes', 'Sí')}</strong>
              </span>
            </div>
            <ul className="wh-unitlist">
              {units.map((u) => {
                const v = fleet.vesselById(u.vesselId);
                const tone = u.status === 'reporting' ? 'ok' : u.status === 'out_of_coverage' ? 'off' : 'warn';
                return (
                  <li key={u.id}>
                    <span className={`wh-dot wh-dot--sm wh-dot--${tone}`} aria-hidden="true" />
                    <span className="wh-unitlist__name">{v?.kind === 'tug' ? tr('Tug', 'Remolcador') : v?.short}</span>
                    <span className="wh-muted">{tr(UNIT_STATUS[u.status][0], UNIT_STATUS[u.status][1])}</span>
                    <span className="mono wh-muted">{u.tempC} °C</span>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

/** "Where this alert has reached": detected → this screen → ashore → duty officer. */
function Progress({ alarm, linkLabel }: { alarm: Alarm; linkLabel?: string }) {
  const tr = useTr();
  const find = (re: RegExp) => alarm.activity.find((x) => re.test(x.text));
  const onScreen = find(/wheelhouse display/i)?.at ?? new Date(new Date(alarm.raisedAt).getTime() + 1000).toISOString();
  const ashore = find(/received ashore/i)?.at;
  const notified = find(/sent to the duty officer/i)?.at;
  const ackBoard = alarm.stateTimes.ack_board;
  const ackShore = alarm.stateTimes.ack_shore;

  type Step = { label: string; state: 'done' | 'current' | 'todo' };
  const steps: Step[] = [
    { label: tr(`Detected ${fmtTimeSec(alarm.raisedAt)}`, `Detectada ${fmtTimeSec(alarm.raisedAt)}`), state: 'done' },
    ackBoard
      ? { label: tr(`Acknowledged on board ${fmtTimeSec(ackBoard)}`, `Confirmada a bordo ${fmtTimeSec(ackBoard)}`), state: 'done' }
      : { label: tr(`On this screen ${fmtTimeSec(onScreen)}`, `En esta pantalla ${fmtTimeSec(onScreen)}`), state: 'done' },
    ashore
      ? { label: tr(`Ashore ${fmtTimeSec(ashore)}`, `En tierra ${fmtTimeSec(ashore)}`), state: 'done' }
      : {
          label: linkLabel ? tr(`Ashore, sending over ${linkLabel}`, `A tierra, enviando por ${linkLabel}`) : tr('Ashore, queued until the link returns', 'A tierra, en cola hasta que vuelva el enlace'),
          state: 'current',
        },
    ackShore
      ? { label: tr(`Duty officer acknowledged ${fmtTimeSec(ackShore)}`, `El oficial de guardia confirmó ${fmtTimeSec(ackShore)}`), state: 'done' }
      : notified
        ? { label: tr(`Duty officer alerted ${fmtTimeSec(notified)}`, `Oficial de guardia avisado ${fmtTimeSec(notified)}`), state: 'current' }
        : { label: tr('Duty officer', 'Oficial de guardia'), state: 'todo' },
  ];
  return (
    <ol className="wh-progress" aria-label={tr('Where this alert has reached', 'Hasta dónde llegó esta alerta')}>
      {steps.map((s, i) => (
        <li key={i} className={`wh-progress__step wh-progress__step--${s.state}`}>
          <span className="wh-progress__dot" aria-hidden="true" />
          <span>
            {s.label}
            <span className="sr-only">
              {s.state === 'done' ? tr(' (done)', ' (hecho)') : s.state === 'current' ? tr(' (in progress)', ' (en curso)') : tr(' (not yet)', ' (todavía no)')}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The calm screen keeps the latest urgent alarm the wheelhouse acknowledged in view while it is open. */
function LastAcknowledged({ alarm, fleet, now, onShow, linkLabel }: { alarm: Alarm; fleet: Fleet; now: number; onShow: (cameraId: string) => void; linkLabel?: string }) {
  const { state } = useApp();
  const lang = state.lang;
  const tr = useTr();
  const prio = usePriorityName();
  const cam = fleet.cameraById(alarm.cameraId);
  const v = fleet.vesselById(alarm.vesselId ?? cam?.vesselId);
  const by = [...alarm.activity].reverse().find((x) => /acknowledged on board/i.test(x.text))?.actor;
  return (
    <section aria-labelledby="wh-last-title" className="wh-last">
      <div className="wh-last__head">
        <span className={`badge badge--${alarm.priority.toLowerCase()}`}>{prio(alarm.priority)}</span>
        <h2 id="wh-last-title">
          {tr('Acknowledged on board', 'Confirmada a bordo')} · {pick(lang, alarm.title, alarm.titleEs)}
        </h2>
      </div>
      <p className="wh-muted">
        {cam ? `${v?.name} · ${cam.name}` : tr(`${fleet.convoyById(alarm.convoyId)?.name} convoy`, `Convoy ${fleet.convoyById(alarm.convoyId)?.name}`)} ·{' '}
        <span className="mono">{alarm.id}</span> · {tr(`raised ${fmtAgo(alarm.raisedAt, now)}`, `generada ${fmtAgo(alarm.raisedAt, now)}`)}
        {alarm.stateTimes.ack_board &&
          tr(
            ` · acknowledged at ${fmtTimeSec(alarm.stateTimes.ack_board)}${by && by !== 'Wheelhouse' ? ` by ${by}` : ''}`,
            ` · confirmada a las ${fmtTimeSec(alarm.stateTimes.ack_board)}${by && by !== 'Wheelhouse' ? ` por ${by}` : ''}`,
          )}
      </p>
      <Progress alarm={alarm} linkLabel={linkLabel} />
      {cam && (
        <button type="button" className="wh-btn wh-last__btn" onClick={() => onShow(cam.id)}>
          <Icon name="video" size={18} strokeWidth={2} /> {tr('Show this camera live', 'Ver esta cámara en vivo')}
        </button>
      )}
    </section>
  );
}

function CameraGrid({
  cams,
  vessels,
  alarms,
  selected,
  onSelect,
  large = false,
}: {
  cams: Camera[];
  vessels: Vessel[];
  alarms: Alarm[];
  selected?: string;
  onSelect: (id: string) => void;
  large?: boolean;
}) {
  const { state } = useApp();
  const lang = state.lang;
  const tr = useTr();
  const byVessel = new Map<string, Camera[]>();
  cams.forEach((c) => byVessel.set(c.vesselId, [...(byVessel.get(c.vesselId) ?? []), c]));
  return (
    <div className={`wh-grid${large ? ' wh-grid--large' : ''}`}>
      {[...byVessel.entries()].map(([vesselId, list]) => {
        const v = vessels.find((x) => x.id === vesselId);
        return (
          <div key={vesselId} className="wh-grid__row">
            <span className="wh-grid__vessel">{v?.kind === 'tug' ? tr('Tug', 'Rem.') : v?.short}</span>
            {list.map((c) => {
              const alarm = alarms.find((a) => a.cameraId === c.id && isUrgent(a));
              const degraded = c.health !== 'healthy';
              const label = alarm ? `${c.name} · ${alarm.priority}` : degraded ? `${c.name.split(' ')[0]} · ${healthShort(c, lang)}` : c.name;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`wh-cam${alarm ? ' wh-cam--alarm' : degraded ? ' wh-cam--warn' : ''}${selected === c.id ? ' is-selected' : ''}`}
                  aria-pressed={selected === c.id}
                  aria-label={
                    tr(`Show live: ${v?.name} · ${c.name}`, `Ver en vivo: ${v?.name} · ${c.name}`) +
                    (degraded ? `, ${healthNote(c, lang)}` : '') +
                    (alarm ? tr(`, ${alarm.priority} alarm`, `, alarma ${alarm.priority}`) : '')
                  }
                  onClick={() => onSelect(c.id)}
                >
                  <span className={`wh-cam__img${isMirrored(c, vessels) ? ' wh-cam__img--mirror' : ''}`}>
                    {c.health === 'offline' ? (
                      <span className="wh-cam__off">
                        <Icon name="wifiOff" size={16} />
                      </span>
                    ) : (
                      <img src={c.image} alt="" style={degraded ? { filter: 'blur(2px) brightness(0.9)' } : undefined} />
                    )}
                  </span>
                  <span className="wh-cam__label">
                    <span className={`wh-dot wh-dot--sm wh-dot--${alarm ? 'alarm' : degraded ? 'warn' : 'ok'}`} aria-hidden="true" />
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function CalmView({
  cams,
  vessels,
  selected,
  onSelect,
  now,
  alarms,
}: {
  cams: Camera[];
  vessels: Vessel[];
  selected?: Camera;
  onSelect: (id: string) => void;
  now: number;
  alarms: Alarm[];
}) {
  const { state } = useApp();
  const tr = useTr();
  const cam = selected;
  const v = vessels.find((x) => x.id === cam?.vesselId);
  return (
    <div className="wh-calm__body">
      {cam && (
        <div className={`wh-calm__live${isMirrored(cam, vessels) ? ' wh-cam__img--mirror' : ''}`}>
          {cam.health === 'offline' ? (
            <div className="wh-noimage">
              <Icon name="wifiOff" size={26} />
              <span>{tr(`No image from the ${cam.name} camera`, `Sin imagen de la cámara ${cam.name}`)}</span>
            </div>
          ) : (
            <CameraFrame
              src={cam.image}
              alt={tr(`Live view of ${v?.name} · ${cam.name}`, `Vista en vivo de ${v?.name} · ${cam.name}`)}
              overlays={false}
              degraded={cam.health === 'degraded'}
              rounded={10}
            >
              <span className="wh-frame-tag">
                <span className="wh-dot wh-dot--ok wh-dot--pulse" aria-hidden="true" />
                {v?.name} · {cam.name}{' '}
                <span className="mono" lang={state.lang}>
                  {tr('LIVE', 'EN VIVO')} · {fmtTimeSec(now - 1500)}
                </span>
              </span>
            </CameraFrame>
          )}
        </div>
      )}
      {cams.length ? (
        <CameraGrid cams={cams} vessels={vessels} alarms={alarms} selected={cam?.id} onSelect={onSelect} large />
      ) : (
        <p className="wh-muted">{tr('No cameras are set up on this convoy yet.', 'Aún no hay cámaras configuradas en este convoy.')}</p>
      )}
    </div>
  );
}
