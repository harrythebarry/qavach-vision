import { useEffect, useRef, useState } from 'react';
import type { ActivityEntry, Alarm, Classification, Detection } from '../../data/types';
import { Badge, CameraFrame, FrameTag } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useApp } from '../../state/AppState';
import { channelsText } from '../../state/escalation';
import { useRouting } from '../../state/routingStore';
import { TZ, fmtCountdown, fmtDay, fmtDayTime, fmtTime, fmtTimeSec } from '../../lib/time';
import {
  FOOTAGE_LEAD,
  FOOTAGE_SECONDS,
  STATE_HINT,
  STATE_NAME,
  STATE_ORDER,
  escalationOf,
  useAlarmText,
  type EvidenceItem,
} from './alarmConsoleData';
import { footageStatus, type FootageRequest } from './footage';

// ---------- Clip player (ALM-05) ----------

export type ClipSource = 'clip' | 'footage';

const CLIP = { duration: 15, detect: 3, mark: 8 };
const FOOTAGE = { duration: FOOTAGE_SECONDS, detect: FOOTAGE_LEAD - (CLIP.mark - CLIP.detect), mark: FOOTAGE_LEAD };
const FRAME = 0.2; // AI frames are sampled 5 a second

const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtClip = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const fmtLen = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * The 15 s clip, or the 2 min recorder footage once it has arrived: play/pause,
 * frame step, seek and an overlay toggle. The first play, step or seek writes
 * "Viewed clip" (or "Viewed recorder footage") to the audit log.
 */
export function ClipPlayer({
  targetId,
  cameraId,
  image,
  alt,
  detection,
  raisedAt,
  segmentLabel,
  markerLabel,
  sources,
  source,
  onSource,
}: {
  targetId: string;
  cameraId: string;
  image: string;
  alt: string;
  detection?: Detection;
  /** Time the alarm or event fired; the clip starts 8 s before it. */
  raisedAt: string;
  segmentLabel: string;
  markerLabel: string;
  /** Video available for this alarm; empty means snapshot only. */
  sources: ClipSource[];
  source?: ClipSource;
  onSource?: (s: ClipSource) => void;
}) {
  const { log, can } = useApp();
  const tx = useAlarmText();
  const { tr } = tx;
  const current: ClipSource | undefined = source && sources.includes(source) ? source : sources[0];
  const spec = current === 'footage' ? FOOTAGE : CLIP;
  const [t, setT] = useState(spec.mark);
  const [playing, setPlaying] = useState(false);
  const [overlays, setOverlays] = useState(true);
  const viewed = useRef(false);
  const mayView = can('view_clips');
  const hasVideo = Boolean(current);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setT((x) => Math.min(spec.duration, Math.round((x + 0.1) * 10) / 10));
    }, 100);
    return () => window.clearInterval(id);
  }, [playing, spec.duration]);

  useEffect(() => {
    if (playing && t >= spec.duration) setPlaying(false);
  }, [t, playing, spec.duration]);

  const markViewed = () => {
    if (viewed.current) return;
    viewed.current = true;
    log(current === 'footage' ? 'Viewed recorder footage' : 'Viewed clip', `${targetId} · ${cameraId}`);
  };

  const toggle = () => {
    markViewed();
    if (!playing && t >= spec.duration) setT(0);
    setPlaying((p) => !p);
  };
  const step = (d: number) => {
    markViewed();
    setPlaying(false);
    setT((x) => Math.min(spec.duration, Math.max(0, Math.round((x + d) * 10) / 10)));
  };

  const clipStart = new Date(raisedAt).getTime() - spec.mark * 1000;
  const frameTime = hasVideo ? clipStart + t * 1000 : new Date(raisedAt).getTime();
  const inDetection = !hasVideo || t >= spec.detect;
  const shown = detection ? { ...detection, label: tx.detLabel(detection.label) } : undefined;
  const lenText = fmtLen(spec.duration);

  return (
    <section className="alm-player" aria-label={hasVideo ? (current === 'footage' ? tr('Recorder footage', 'Video del grabador') : tr('Clip', 'Clip')) : tr('Snapshot', 'Captura')}>
      <div className="alm-player__frame">
        <CameraFrame src={image} alt={alt} detection={inDetection ? shown : undefined} overlays={overlays} rounded={0}>
          {overlays && !inDetection && detection?.zone && (
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" className="alm-player__zone">
              <polygon points={detection.zone} vectorEffect="non-scaling-stroke" />
            </svg>
          )}
          <FrameTag pos="tl">
            <span className="mono">
              {ymd.format(frameTime)} {fmtTimeSec(frameTime)} · {cameraId}
            </span>
          </FrameTag>
          <FrameTag pos="tr">{tr('Faces blurred on export', 'Rostros difuminados al exportar')}</FrameTag>
        </CameraFrame>
      </div>
      <div className="alm-player__controls">
        {sources.length > 1 && onSource && (
          <div className="segmented alm-player__src" role="group" aria-label={tr('Video source', 'Fuente de video')}>
            {sources.map((s) => (
              <button key={s} type="button" aria-pressed={s === current} onClick={() => onSource(s)}>
                {s === 'clip' ? tr('Clip, 15 s', 'Clip, 15 s') : tr('Recorder, 2 min', 'Grabador, 2 min')}
              </button>
            ))}
          </div>
        )}
        {hasVideo && (
          <div className="alm-tl">
            <span className="alm-tl__track" />
            <span className="alm-tl__seg" style={{ left: `${(spec.detect / spec.duration) * 100}%` }} />
            <span className="alm-tl__mark" style={{ left: `${(spec.mark / spec.duration) * 100}%` }} />
            <span className="alm-tl__head" style={{ left: `${(t / spec.duration) * 100}%` }} />
            <input
              type="range"
              className="alm-tl__input"
              min={0}
              max={spec.duration}
              step={0.1}
              value={t}
              disabled={!mayView}
              aria-label={current === 'footage' ? tr('Footage position', 'Posición en el video') : tr('Clip position', 'Posición en el clip')}
              aria-valuetext={tr(`${fmtClip(t)} of ${lenText}`, `${fmtClip(t)} de ${lenText}`)}
              onChange={(e) => {
                markViewed();
                setT(Number(e.target.value));
              }}
            />
          </div>
        )}
        <div className="alm-player__row">
          {hasVideo ? (
            <div className="alm-player__btns">
              <button
                type="button"
                className="alm-player__play"
                aria-label={playing ? tr('Pause', 'Pausa') : tr('Play', 'Reproducir')}
                title={mayView ? undefined : tr('Your role cannot view clips', 'Su rol no puede ver clips')}
                onClick={toggle}
                disabled={!mayView}
              >
                <Icon name={playing ? 'pause' : 'play'} size={18} />
              </button>
              <button type="button" className="alm-player__step" aria-label={tr('Back one frame', 'Un cuadro atrás')} onClick={() => step(-FRAME)} disabled={!mayView}>
                <Icon name="stepBack" size={18} strokeWidth={2} />
              </button>
              <button type="button" className="alm-player__step" aria-label={tr('Forward one frame', 'Un cuadro adelante')} onClick={() => step(FRAME)} disabled={!mayView}>
                <Icon name="stepForward" size={18} strokeWidth={2} />
              </button>
              <span className="alm-player__time mono" aria-live="off">
                {fmtClip(t)} / {lenText}
              </span>
            </div>
          ) : (
            <span className="alm-player__note">{tr('Snapshot only. Request footage from the recorder for video.', 'Solo captura. Pida video al grabador de a bordo.')}</span>
          )}
          <div className="alm-player__legend">
            {hasVideo && (
              <>
                <span>
                  <span className="alm-player__key alm-player__key--seg" />
                  {segmentLabel}
                </span>
                <span>
                  <span className="alm-player__key alm-player__key--mark" />
                  {markerLabel}
                </span>
              </>
            )}
            <label className="switch alm-player__switch">
              <input type="checkbox" role="switch" checked={overlays} onChange={(e) => setOverlays(e.target.checked)} />
              {tr('AI overlays', 'Capas de IA')}
            </label>
          </div>
        </div>
        {!mayView && <p className="alm-muted">{tr('Your role cannot view clips. Ask a duty officer or a reviewer.', 'Su rol no puede ver clips. Pida ayuda a un oficial de guardia o a un revisor.')}</p>}
      </div>
    </section>
  );
}

// ---------- Classification (ALM-06) ----------

const CLASS_OPTIONS: { c: Classification; label: [string, string]; key: string; note: [string, string] }[] = [
  { c: 'accepted', label: ['Accept', 'Aceptar'], key: 'A', note: ['It happened as described', 'Ocurrió como se describe'] },
  { c: 'rejected', label: ['Reject', 'Rechazar'], key: 'R', note: ['It happened, no action needed', 'Ocurrió, no requiere acción'] },
  { c: 'false_alert', label: ['False alert', 'Falsa alerta'], key: 'F', note: ['The system got it wrong', 'El sistema se equivocó'] },
];

export function ClassifyPanel({
  value,
  reason,
  reasons,
  pendingFalse,
  disabled,
  disabledNote,
  onClassify,
  onFalse,
  onCancelFalse,
}: {
  value?: Classification;
  reason?: string;
  /** [English (stored), Spanish] */
  reasons: [string, string][];
  pendingFalse: boolean;
  disabled: boolean;
  disabledNote?: string;
  onClassify: (c: Classification, reason?: string) => void;
  onFalse: () => void;
  onCancelFalse: () => void;
}) {
  const tx = useAlarmText();
  const { tr, p } = tx;
  const [other, setOther] = useState('');
  const reasonsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (pendingFalse) reasonsRef.current?.querySelector('button')?.focus();
  }, [pendingFalse]);

  const status = disabled
    ? disabledNote
    : pendingFalse
      ? tr(`Pick a reason to save it as a false alert: keys 1 to ${reasons.length}, or Esc to cancel.`, `Elija un motivo para guardarla como falsa alerta: teclas 1 a ${reasons.length}, o Esc para cancelar.`)
      : value
        ? tr(`Saved as ${tx.classText(value, reason)}. It counts toward the use case's precision.`, `Guardada como ${tx.classText(value, reason)}. Cuenta para la precisión del caso de uso.`)
        : tr('Not classified yet.', 'Todavía sin clasificar.');

  return (
    <section className="card alm-classify" aria-labelledby="alm-classify-title">
      <div className="alm-classify__head">
        <h2 id="alm-classify-title">{tr('Classification', 'Clasificación')}</h2>
        <span>{tr('Each decision becomes a training label for the next model update', 'Cada decisión se convierte en una etiqueta de entrenamiento para la próxima actualización del modelo')}</span>
      </div>
      <div className="alm-classify__opts">
        {CLASS_OPTIONS.map((o) => (
          <button
            key={o.c}
            type="button"
            className="alm-classify__opt"
            aria-pressed={value === o.c || (o.c === 'false_alert' && pendingFalse)}
            disabled={disabled}
            onClick={() => (o.c === 'false_alert' ? onFalse() : onClassify(o.c))}
          >
            <span className="alm-classify__opt-top">
              {p(o.label)}
              <kbd>{o.key}</kbd>
            </span>
            <span className="alm-classify__opt-note">{p(o.note)}</span>
          </button>
        ))}
      </div>
      <div className="alm-classify__reasons" role="group" aria-label={tr('Reason for a false alert', 'Motivo de la falsa alerta')} ref={reasonsRef}>
        <span className="alm-classify__why">{tr('If false, why:', 'Si es falsa, ¿por qué?')}</span>
        {reasons.map((r, i) => (
          <button
            key={r[0]}
            type="button"
            className="alm-chip alm-chip--reason"
            aria-pressed={value === 'false_alert' && reason === r[0]}
            disabled={disabled}
            onClick={() => onClassify('false_alert', r[0])}
          >
            {pendingFalse && <kbd>{i + 1}</kbd>}
            {p(r)}
          </button>
        ))}
        {pendingFalse && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={onCancelFalse}>
            {tr('Cancel', 'Cancelar')}
          </button>
        )}
      </div>
      {pendingFalse && !disabled && (
        <form
          className="alm-classify__other"
          onSubmit={(e) => {
            e.preventDefault();
            if (other.trim()) {
              onClassify('false_alert', other.trim());
              setOther('');
            }
          }}
        >
          <div className="field grow" style={{ flexBasis: 220 }}>
            <label htmlFor="alm-other-reason">{tr('Other reason', 'Otro motivo')}</label>
            <input
              id="alm-other-reason"
              className="input"
              value={other}
              onChange={(e) => setOther(e.target.value)}
              placeholder={tr('Describe what the system got wrong', 'Describa en qué se equivocó el sistema')}
            />
          </div>
          <button type="submit" className="btn" disabled={!other.trim()} title={other.trim() ? undefined : tr('Type a reason first', 'Escriba primero un motivo')}>
            {tr('Save as false alert', 'Guardar como falsa alerta')}
          </button>
        </form>
      )}
      <p className="alm-classify__status" role="status">
        {status}
      </p>
    </section>
  );
}

// ---------- Alarm state bar (ALM-02) ----------

export function StateBar({ alarm, now }: { alarm: Alarm; now: number }) {
  const { state } = useApp();
  const tx = useAlarmText();
  const { tr, p } = tx;
  const esc = escalationOf(alarm, now);
  const done = (s: (typeof STATE_ORDER)[number]) => Boolean(alarm.stateTimes[s]);
  const lastDone = STATE_ORDER.reduce((acc, s, i) => (done(s) ? i : acc), -1);
  const current = lastDone + 1 < STATE_ORDER.length ? lastDone + 1 : -1;
  // Fraction of the current escalation window used up, drawn on the waiting step.
  let used = 0.5;
  if (esc) {
    const from = new Date(alarm.escalationBase ?? alarm.stateTimes.ack_board ?? alarm.stateTimes.raised ?? alarm.raisedAt).getTime();
    used = Math.min(1, Math.max(0.04, (now - from) / Math.max(1, esc.at - from)));
  }
  const waitingText = () => {
    if (!esc) return tr('Waiting', 'En espera');
    if (esc.left > 0) return tr(`Waiting · ${fmtCountdown(esc.left)} left`, `En espera · quedan ${fmtCountdown(esc.left)}`);
    return state.simulation ? tr('Escalating now', 'Escalando ahora') : tr('Escalation due · live events paused', 'Escalamiento vencido · eventos en vivo en pausa');
  };

  return (
    <ol className="alm-states" aria-label={tr('Alarm state', 'Estado de la alarma')}>
      {STATE_ORDER.map((s, i) => {
        const at = alarm.stateTimes[s];
        const isCurrent = i === current;
        const skipped = !at && i < lastDone;
        const cls = at ? 'is-done' : isCurrent ? (esc ? 'is-waiting' : 'is-next') : 'is-future';
        return (
          <li key={s} className={`alm-states__step ${cls}`} aria-current={isCurrent ? 'step' : undefined}>
            <span
              className="alm-states__bar"
              style={isCurrent && esc ? { background: `linear-gradient(90deg, var(--p2) ${used * 100}%, #f3d2c4 ${used * 100}%)` } : undefined}
            />
            <span className="alm-states__name">{p(STATE_NAME[s])}</span>
            <span className={`alm-states__time${at ? ' mono' : ''}`}>
              {at
                ? fmtDay(at) === fmtDay(now)
                  ? fmtTimeSec(at)
                  : `${fmtDay(at)} ${fmtTimeSec(at)}`
                : skipped
                  ? tr('Not recorded', 'No registrado')
                  : isCurrent
                    ? waitingText()
                    : p(STATE_HINT[s])}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------- Escalation ladder (ALM-03, RT-01, RT-03) ----------

/** Who has been messaged, who is next and when, from the saved ladder and the engine's fields. */
export function EscalationCard({ alarm, now }: { alarm: Alarm; now: number }) {
  const { state } = useApp();
  const routing = useRouting();
  const tx = useAlarmText();
  const { tr } = tx;
  const steps = routing.ladders[alarm.priority].filter((s) => s.when === 'now' || s.when === 'after' || s.when === 'unreviewed');
  const sent = new Set(alarm.escalatedTo ?? []);
  const open = alarm.state === 'raised' || alarm.state === 'ack_board';
  if (!steps.length || (!open && sent.size === 0)) return null;

  const esc = escalationOf(alarm, now);
  const base = new Date(alarm.escalationBase ?? alarm.raisedAt).getTime();
  const ackAt = alarm.stateTimes.ack_shore;
  const first = steps.find((s) => s.when === 'now' && s.channels.length > 0);
  const { reminderEvery, reminderMax } = routing.rules;
  const reminders = alarm.reminders ?? 0;
  const how = (ch: typeof steps[number]['channels']) => (ch.length ? (tx.es ? channelsText.es(ch) : channelsText.en(ch)) : tr('console only, no message', 'solo consola, sin mensaje'));
  const messaged = steps.filter((s) => sent.has(s.target));

  return (
    <section className="card alm-escl" aria-labelledby="alm-escl-title">
      <div className="alm-steps__head">
        <h2 id="alm-escl-title">{tr('Escalation', 'Escalamiento')}</h2>
        <span>
          {messaged.length
            ? tr(`Messaged so far: ${messaged.map((s) => s.target.toLowerCase()).join(', ')}`, `Avisados hasta ahora: ${messaged.map((s) => tx.roleName(s.target).toLowerCase()).join(', ')}`)
            : tr('Nobody messaged yet', 'Todavía no se avisó a nadie')}
        </span>
      </div>
      <ol className="alm-ladder">
        {steps.map((s) => {
          const consoleOnly = s.when === 'now' && s.channels.length === 0;
          const done = sent.has(s.target) || consoleOnly;
          const isNext = open && !done && esc?.to === s.target;
          const due = s.when === 'after' ? base + s.minutes * 60_000 : s.when === 'unreviewed' ? new Date(alarm.raisedAt).getTime() + s.minutes * 60_000 : base;
          const when =
            s.when === 'now'
              ? tr('At once, ashore', 'De inmediato, en tierra')
              : s.when === 'after'
                ? tr(`Not acknowledged in ${s.minutes} min`, `Sin confirmar en ${s.minutes} min`)
                : tr(`Unreviewed for ${s.minutes} min`, `Sin revisar durante ${s.minutes} min`);
          let status: string;
          let cls = 'is-later';
          if (done) {
            status = consoleOnly ? tr('In the console queue', 'En la cola de la consola') : tr('Messaged', 'Avisado');
            cls = 'is-done';
          } else if (!open) {
            status = ackAt ? tr(`Not needed · acknowledged ashore ${fmtTime(ackAt)}`, `No hizo falta · confirmada en tierra ${fmtTime(ackAt)}`) : tr('Not needed', 'No hizo falta');
            cls = 'is-skipped';
          } else if (isNext && esc) {
            status =
              esc.left > 0
                ? tr(`Next · in ${fmtCountdown(esc.left)} (${fmtTimeSec(esc.at)})`, `Siguiente · en ${fmtCountdown(esc.left)} (${fmtTimeSec(esc.at)})`)
                : state.simulation
                  ? tr('Escalating now', 'Escalando ahora')
                  : tr('Due · live events paused', 'Vencido · eventos en vivo en pausa');
            cls = 'is-next';
          } else {
            status = tr(`At ${fmtTime(due)} if still open`, `A las ${fmtTime(due)} si sigue abierta`);
          }
          return (
            <li key={s.id} className={`alm-ladder__step ${cls}`}>
              <span className="alm-ladder__dot" aria-hidden="true">
                {done && <Icon name="check" size={12} strokeWidth={3} />}
              </span>
              <span className="alm-ladder__body">
                <strong>{tx.roleName(s.target)}</strong>
                <span>
                  {when} · {how(s.channels)}
                  {s.digest ? tr(' digest', ' (resumen)') : ''}
                </span>
              </span>
              <span className="alm-ladder__status" role={cls === 'is-next' ? 'timer' : undefined} aria-live="off">
                {status}
              </span>
            </li>
          );
        })}
      </ol>
      {first && alarm.escalationBase && (open || reminders > 0) && (
        <p className="alm-muted">
          {open
            ? tr(
                `Reminders to the ${first.target.toLowerCase()}: ${reminders} of ${reminderMax} sent, every ${reminderEvery} min until someone acknowledges ashore.`,
                `Recordatorios ${tx.roleTo(first.target)}: ${reminders} de ${reminderMax} enviados, cada ${reminderEvery} min hasta que alguien confirme en tierra.`,
              )
            : tr(`${reminders} reminders sent before it was acknowledged.`, `${reminders} recordatorios enviados antes de la confirmación.`)}
        </p>
      )}
    </section>
  );
}

// ---------- Store and forward ----------

export function LateBadge() {
  const { tr } = useAlarmText();
  return (
    <Badge tone="warn">
      <Icon name="wifiOff" size={12} strokeWidth={2.4} />
      {tr('Arrived late · stored on board', 'Llegó tarde · guardado a bordo')}
    </Badge>
  );
}

// ---------- Activity and audit trail (ALM-09) ----------

export function ActivityTrail({ entries, now }: { entries: ActivityEntry[]; now: number }) {
  const tx = useAlarmText();
  const { tr } = tx;
  return (
    <section className="card" aria-labelledby="alm-activity-title">
      <div className="card__head">
        <div className="card__title">
          <h2 id="alm-activity-title">{tr('Activity and audit trail', 'Actividad y registro de auditoría')}</h2>
        </div>
        <span className="card__hint" style={{ paddingRight: 8 }}>
          {tr('Kept 12 months with the event', 'Se conserva 12 meses con el evento')}
        </span>
      </div>
      {entries.length === 0 ? (
        <div className="empty">{tr('No activity recorded on this alarm.', 'No hay actividad registrada en esta alarma.')}</div>
      ) : (
        <ol className="alm-activity">
          {entries.map((e, i) => (
            <li key={`${e.at}-${i}`} className={e.pending ? 'is-pending' : undefined}>
              <span className="mono alm-activity__time">{fmtDay(e.at) === fmtDay(now) ? fmtTimeSec(e.at) : fmtDayTime(e.at)}</span>
              <span className="alm-activity__dot" aria-hidden="true" />
              <span>{tx.activity(e)}</span>
              <span className="alm-activity__actor">{tx.actor(e.actor)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ---------- Evidence summary and recorder footage (ALM-05, ALM-08) ----------

export function EvidenceSummary({
  items,
  convoyId,
  footage,
  now,
  onRequest,
  onOpen,
  canRequest,
}: {
  items: EvidenceItem[];
  convoyId: string;
  footage?: FootageRequest;
  now: number;
  onRequest: () => void;
  onOpen?: () => void;
  /** False when the alarm has no camera to ask the recorder for. */
  canRequest: boolean;
}) {
  const tx = useAlarmText();
  const { tr } = tx;
  return (
    <section className="card alm-evsum" aria-labelledby="alm-evsum-title">
      <div className="alm-evsum__head">
        <h2 id="alm-evsum-title">{tr('Evidence', 'Evidencia')}</h2>
        {onOpen && (
          <button type="button" className="card__link alm-linkbtn" onClick={onOpen}>
            {tr('Open evidence', 'Abrir evidencia')}
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="alm-muted">{tr('No clip or snapshot. This alarm comes from edge unit health messages.', 'Sin clip ni captura. Esta alarma viene de los mensajes de estado de la unidad de borde.')}</p>
      ) : (
        <ul className="alm-evsum__list">
          {items.map((e) => (
            <li key={e.name}>
              <span>{tx.evidence(e)}</span>
              <span className="mono alm-evsum__hash">{e.kind === 'record' ? e.meta : e.hash}</span>
            </li>
          ))}
        </ul>
      )}
      {canRequest && (
        <>
          <FootageButton convoyId={convoyId} footage={footage} now={now} onRequest={onRequest} />
          <span className="alm-muted">{tr('About 25 MB, sent when the link allows. Exports are watermarked and logged.', 'Unos 25 MB, se envía cuando el enlace lo permite. Las exportaciones llevan marca de agua y quedan registradas.')}</span>
        </>
      )}
    </section>
  );
}

export function FootageButton({
  convoyId,
  footage,
  now,
  onRequest,
}: {
  convoyId: string;
  footage?: FootageRequest;
  now: number;
  onRequest: () => void;
}) {
  const { state, can } = useApp();
  const tx = useAlarmText();
  const { tr, fleet } = tx;
  const convoy = fleet.convoyById(convoyId);
  if (footage) {
    const st = footageStatus(footage, convoy, now, state.simulation);
    const name = convoy?.name ?? '';
    const asked = fmtTime(footage.requestedAt);
    return (
      <p className={`alm-footage ${st.kind === 'arrived' ? 'is-ok' : ''}`} role="status">
        <Icon name={st.kind === 'arrived' ? 'check' : st.kind === 'queued' ? 'wifiOff' : 'clock'} size={16} />
        <span>
          {st.kind === 'arrived'
            ? tr(`2 min from the recorder received ${fmtTime(st.at)} · listed in evidence`, `2 min del grabador recibidos a las ${fmtTime(st.at)} · en la evidencia`)
            : st.kind === 'queued'
              ? tr(`Requested ${asked} · queued on board, sent when ${name} reconnects`, `Pedido a las ${asked} · en cola a bordo, se envía cuando ${name} vuelva a tener cobertura`)
              : st.paused
                ? tr(`Requested ${asked} · due now; live events are paused, it arrives when they resume`, `Pedido a las ${asked} · ya debería llegar; los eventos en vivo están en pausa, llega cuando se reanuden`)
                : tr(
                    `Requested ${asked} · arriving over ${tx.linkLabel(convoy?.linkLabel)}, about ${fmtCountdown(st.dueAt - now)} left`,
                    `Pedido a las ${asked} · llegando por ${tx.linkLabel(convoy?.linkLabel)}, faltan unos ${fmtCountdown(st.dueAt - now)}`,
                  )}
        </span>
      </p>
    );
  }
  const allowed = can('view_clips');
  return (
    <>
      <button
        type="button"
        className="btn"
        onClick={onRequest}
        disabled={!allowed}
        title={allowed ? undefined : tr('Your role cannot view clips, so it cannot ask the recorder for footage', 'Su rol no puede ver clips, así que no puede pedir video al grabador')}
      >
        <Icon name="download" size={16} strokeWidth={2} />
        {tr('Request 2 min from the recorder', 'Pedir 2 min al grabador')}
      </button>
      {!allowed && <span className="alm-muted">{tr('Your role cannot request footage. Ask a duty officer.', 'Su rol no puede pedir video. Pida ayuda a un oficial de guardia.')}</span>}
      {allowed && convoy?.link === 'none' && (
        <span className="alm-muted">{tr(`${convoy.name} is out of coverage: the request waits on board until it reconnects.`, `${convoy.name} está sin cobertura: el pedido espera a bordo hasta que vuelva a conectarse.`)}</span>
      )}
    </>
  );
}
