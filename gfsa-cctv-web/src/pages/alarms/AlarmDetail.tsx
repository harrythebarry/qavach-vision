import { useState } from 'react';
import { Link } from 'react-router';
import type { Alarm, Classification } from '../../data/types';
import { useCaseById } from '../../data/useCases';
import { voyageById } from '../../data/alarms';
import { Badge, Card, PriorityBadge, Tabs, usePriorityName } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useApp } from '../../state/AppState';
import { activeConfig, ucStore } from '../../state/configStore';
import { nextStep } from '../../state/escalation';
import { useStore } from '../../lib/persist';
import { fmtCountdown, fmtDay, fmtSmart, fmtTimeSec } from '../../lib/time';
import { shortHash } from '../../lib/hash';
import {
  LEVEL_NAME,
  WHEELHOUSE_PHONE,
  activityOf,
  escalationOf,
  evidenceOf,
  falseReasonsFor,
  relatedOf,
  segmentLabelFor,
  stateBadgeText,
  useAlarmText,
  type EvidenceItem,
} from './alarmConsoleData';
import { targetOfAlarm, type EvidenceExport, type EvidenceTarget } from './evidenceExport';
import type { FootageRequest } from './footage';
import { ActivityTrail, ClassifyPanel, ClipPlayer, EscalationCard, EvidenceSummary, FootageButton, StateBar, type ClipSource } from './parts';

type DetailTab = 'overview' | 'evidence' | 'activity' | 'related';

const AUTO_ACTORS = ['Wheelhouse', 'System'];

export interface ClassifyProps {
  pendingFalse: boolean;
  onClassify: (c: Classification, reason?: string) => void;
  onFalse: () => void;
  onCancelFalse: () => void;
}

/** The selected alarm in full (ALM-02 to ALM-10). */
export function AlarmDetail({
  alarm,
  now,
  readOnly,
  allAlarms,
  onEscalate,
  footage,
  onRequestFootage,
  exp,
  classifyProps,
}: {
  alarm: Alarm;
  now: number;
  /** Archived records are shown but never changed from the console. */
  readOnly: boolean;
  allAlarms: Alarm[];
  onEscalate: (a: Alarm) => void;
  footage?: FootageRequest;
  onRequestFootage: () => void;
  exp: EvidenceExport;
  classifyProps: ClassifyProps;
}) {
  const app = useApp();
  const { state, can, toast, log } = app;
  const tx = useAlarmText();
  const { tr, p, fleet } = tx;
  const prioName = usePriorityName();
  const ucRecords = useStore(ucStore);
  const [tab, setTab] = useState<DetailTab>('overview');
  const [source, setSource] = useState<ClipSource>('clip');

  const uc = useCaseById(alarm.useCaseId);
  const cam = fleet.cameraById(alarm.cameraId);
  const vessel = fleet.vesselById(alarm.vesselId);
  const convoy = fleet.convoyById(alarm.convoyId);
  const voyage = voyageById(alarm.voyageId);
  const esc = escalationOf(alarm, now);
  const entries = activityOf(alarm, now);
  const footageArrived = Boolean(footage?.arrivedAt);
  const evidence = evidenceOf(alarm, footageArrived);
  const related = relatedOf(alarm, allAlarms, state.reviewEvents, tx, (id) => tx.ucName(useCaseById(id), id));
  const hasClip = evidence.some((e) => e.kind === 'clip');
  const sources: ClipSource[] = [...(hasClip ? (['clip'] as const) : []), ...(footageArrived ? (['footage'] as const) : [])];
  const me = state.user.name;
  const canAck = can('acknowledge') && !readOnly;
  const canClassify = can('classify') && !readOnly;
  const st = alarm.state;
  const isOpenAshore = st === 'raised' || st === 'ack_board';
  const ladderNext = isOpenAshore ? nextStep(alarm) : undefined;
  const target: EvidenceTarget = targetOfAlarm(alarm);

  // Response steps: the saved use case configuration, in the viewer's language.
  const rec = uc ? ucRecords[uc.id] : undefined;
  const cfg = uc && rec ? activeConfig(uc, rec) : undefined;
  const stepsEn = cfg?.steps ?? uc?.responseSteps ?? [];
  const stepsEs = cfg?.stepsEs ?? uc?.responseStepsEs ?? [];
  const steps = stepsEn.map((en, i) => ({ en, text: tx.es ? (stepsEs[i] ?? en) : en }));
  const stepsDone = steps.filter((_, i) => alarm.stepsDone[i]).length;
  const firstOpenStep = steps.findIndex((_, i) => !alarm.stepsDone[i]);

  // Call the wheelhouse: a real tel: link, plus a line on the alarm and in the audit log.
  const phone = WHEELHOUSE_PHONE[alarm.convoyId];
  const noteCall = () => {
    if (readOnly) return;
    app.addActivity(alarm.id, 'Called the wheelhouse', 'Llamada al puente', me);
    log('Called the wheelhouse', alarm.id, `${convoy?.name ?? alarm.convoyId} · ${phone?.display ?? ''}`, alarm.convoyId);
  };
  const callLink = (cls: string) =>
    phone && (
      <a href={`tel:${phone.tel}`} className={cls} onClick={noteCall} title={tr(`Call the ${convoy?.name} wheelhouse, ${phone.display}`, `Llamar al puente de ${convoy?.name}, ${phone.display}`)}>
        <Icon name="phone" size={14} strokeWidth={2} />
        {tr('Call wheelhouse', 'Llamar al puente')}
      </a>
    );

  const playFootage = () => {
    setSource('footage');
    setTab('overview');
  };

  const overview = (
    <div className="alm-cols">
      <div className="alm-cols__main">
        {cam ? (
          <ClipPlayer
            key={`${alarm.id}-${source}-${sources.join()}`}
            targetId={alarm.id}
            cameraId={cam.id}
            image={cam.image}
            alt={tr(
              `${hasClip ? 'Clip' : 'Snapshot'} frame: ${alarm.title.toLowerCase()} on ${tx.where(alarm)}`,
              `Cuadro del ${hasClip ? 'clip' : 'la captura'}: ${tx.title(alarm).toLowerCase()} en ${tx.where(alarm)}`,
            )}
            detection={alarm.detection}
            raisedAt={alarm.raisedAt}
            segmentLabel={p(segmentLabelFor(alarm.useCaseId))}
            markerLabel={alarm.useCaseId === 'life-jacket' ? tr('Alarm raised after 5 s', 'Alarma generada a los 5 s') : tr('Alarm raised', 'Alarma generada')}
            sources={sources}
            source={source}
            onSource={setSource}
          />
        ) : (
          <div className="card">
            <div className="empty">
              <Icon name="wifiOff" size={28} />
              <p style={{ marginTop: 8, fontWeight: 600, color: 'var(--ink)' }}>{tr('No video for this alarm', 'Esta alarma no tiene video')}</p>
              <p>{tx.description(alarm)}</p>
            </div>
          </div>
        )}

        <ClassifyPanel
          value={alarm.classification}
          reason={alarm.falseReason}
          reasons={falseReasonsFor(alarm.useCaseId)}
          pendingFalse={classifyProps.pendingFalse && canClassify}
          disabled={!canClassify}
          disabledNote={
            readOnly
              ? tr('Archived record: the classification can no longer change.', 'Registro archivado: la clasificación ya no puede cambiar.')
              : tr('Your role cannot classify events. A duty officer, reviewer or safety administrator can.', 'Su rol no puede clasificar eventos. Puede hacerlo un oficial de guardia, un revisor o el administrador de seguridad.')
          }
          onClassify={classifyProps.onClassify}
          onFalse={classifyProps.onFalse}
          onCancelFalse={classifyProps.onCancelFalse}
        />

        <ActivityTrail entries={entries} now={now} />
      </div>

      <div className="alm-cols__side">
        <EscalationCard alarm={alarm} now={now} />

        <section className="card" aria-labelledby="alm-steps-title">
          <div className="alm-steps__head">
            <h2 id="alm-steps-title">{tr('Response steps', 'Pasos de respuesta')}</h2>
            <span>
              {steps.length
                ? tr(`Set by GFSA for this use case · ${stepsDone} of ${steps.length} done`, `Definidos por GFSA para este caso de uso · ${stepsDone} de ${steps.length} hechos`)
                : tr('No response steps set for this use case', 'Este caso de uso no tiene pasos de respuesta')}
            </span>
          </div>
          {steps.length > 0 && (
            <div className="alm-steps">
              {steps.map((s, i) => {
                const d = alarm.stepsDone[i];
                const auto = d && AUTO_ACTORS.includes(d.by);
                const current = i === firstOpenStep && st !== 'closed';
                const call = /master|radio|wheelhouse/i.test(s.en) && !/acknowledges on board/i.test(s.en);
                const id = `alm-step-${alarm.id}-${i}`;
                return (
                  <div key={i} className={`alm-step${d ? ' is-done' : ''}${current ? ' is-current' : ''}`}>
                    <input
                      id={id}
                      type="checkbox"
                      checked={Boolean(d)}
                      disabled={!canAck || Boolean(auto) || st === 'closed'}
                      title={
                        auto
                          ? tr('Done automatically', 'Hecho automáticamente')
                          : !canAck
                            ? readOnly
                              ? tr('Archived record', 'Registro archivado')
                              : tr('Your role cannot update response steps', 'Su rol no puede actualizar los pasos')
                            : undefined
                      }
                      onChange={() => {
                        app.toggleStep(alarm.id, i);
                        toast(d ? tr(`Step ${i + 1} reopened.`, `Paso ${i + 1} reabierto.`) : tr(`Step ${i + 1} done, recorded with your name and the time.`, `Paso ${i + 1} hecho, registrado con su nombre y la hora.`));
                      }}
                    />
                    <div className="alm-step__body">
                      <label htmlFor={id} className="alm-step__label">
                        {s.text}
                      </label>
                      {d ? (
                        <span className="alm-step__meta">
                          {auto
                            ? tr(`Done automatically at ${fmtTimeSec(d.at)}`, `Hecho automáticamente a las ${fmtTimeSec(d.at)}`)
                            : d.by === me
                              ? tr(`Done by you at ${fmtTimeSec(d.at)}`, `Hecho por usted a las ${fmtTimeSec(d.at)}`)
                              : tr(`Done by ${d.by} at ${fmtTimeSec(d.at)}`, `Hecho por ${d.by} a las ${fmtTimeSec(d.at)}`)}
                        </span>
                      ) : /connect/i.test(s.en) && /task/i.test(s.en) ? (
                        <span className="alm-step__meta">{tr('Tasks in Connect open once the pilot proves accuracy', 'Las tareas en Connect se habilitan cuando el piloto demuestre su precisión')}</span>
                      ) : null}
                      {!d && current && call && !readOnly && callLink('btn btn--sm alm-step__call')}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="card alm-details" aria-labelledby="alm-details-title">
          <h2 id="alm-details-title">{tr('Details', 'Detalles')}</h2>
          <dl className="dl">
            <dt>{tr('Alarm', 'Alarma')}</dt>
            <dd className="mono">{alarm.id}</dd>
            <dt>{tr('Event', 'Evento')}</dt>
            <dd className="mono">{alarm.eventId}</dd>
            <dt>{tr('Use case', 'Caso de uso')}</dt>
            <dd>
              <Link to={`/config/use-cases/${alarm.useCaseId}`} style={{ textDecoration: 'none' }}>
                {tx.ucName(uc, alarm.useCaseId)}
              </Link>
            </dd>
            {uc && (
              <>
                <dt>{tr('Level', 'Nivel')}</dt>
                <dd>
                  {p(LEVEL_NAME[cfg?.level ?? uc.level])} · {prioName(alarm.priority)}
                </dd>
              </>
            )}
            <dt>{cam ? tr('Camera', 'Cámara') : tr('Source', 'Origen')}</dt>
            <dd>{cam ? tx.where(alarm) : tr(`${convoy?.name} convoy, edge unit health`, `Convoy ${convoy?.name}, estado de la unidad de borde`)}</dd>
            {phone && (
              <>
                <dt>{tr('Wheelhouse', 'Puente')}</dt>
                <dd>
                  {readOnly ? (
                    <span className="mono">{phone.display}</span>
                  ) : (
                    <a href={`tel:${phone.tel}`} className="mono" onClick={noteCall}>
                      {phone.display}
                    </a>
                  )}
                  {convoy?.link === 'none' && <span className="sub">{tr('Out of coverage: the call may not connect', 'Sin cobertura: la llamada puede no conectar')}</span>}
                </dd>
              </>
            )}
            {alarm.position && (
              <>
                <dt>{tr('Position', 'Posición')}</dt>
                <dd className="mono">{alarm.position}</dd>
              </>
            )}
            {alarm.detection && (
              <>
                <dt>{tr('Confidence', 'Confianza')}</dt>
                <dd className="mono">{alarm.detection.confidence.toFixed(2)}</dd>
              </>
            )}
            {alarm.models && (
              <>
                <dt>{tr('Models', 'Modelos')}</dt>
                <dd>{alarm.models}</dd>
              </>
            )}
            {alarm.response && (
              <>
                <dt>{tr('Response', 'Respuesta')}</dt>
                <dd>{tx.phrase(alarm.response)}</dd>
              </>
            )}
          </dl>
        </section>

        <EvidenceSummary
          items={evidence}
          convoyId={alarm.convoyId}
          footage={footage}
          now={now}
          onRequest={onRequestFootage}
          onOpen={() => setTab('evidence')}
          canRequest={Boolean(cam)}
        />
      </div>
    </div>
  );

  const ownerText = alarm.owner
    ? alarm.owner === me
      ? tr(`${me} (you)`, `${me} (usted)`)
      : tx.actor(alarm.owner)
    : tr('unassigned', 'sin asignar');

  return (
    <>
      <div className="alm-head">
        <div className="alm-head__text">
          <nav aria-label={tr('Breadcrumb', 'Ruta de navegación')} className="breadcrumb">
            <Link to="/">{tr('Operations', 'Operaciones')}</Link> / <Link to="/alarms">{tr('Alarms and events', 'Alarmas y eventos')}</Link> /{' '}
            <span className="mono">{alarm.id}</span>
          </nav>
          <h1 className="page-title">{tx.title(alarm)}</h1>
          <div className="alm-head__meta">
            <PriorityBadge p={alarm.priority} />
            <Badge>{stateBadgeText(alarm, tx)}</Badge>
            {esc && esc.to && (
              <span className="alm-esc" role="timer" aria-live="off">
                <Icon name="clock" size={12} strokeWidth={2.6} />
                {esc.left > 0
                  ? tr(`Escalates to ${esc.to} in ${fmtCountdown(esc.left)}`, `Se escala ${tx.roleTo(esc.to)} en ${fmtCountdown(esc.left)}`)
                  : state.simulation
                    ? tr(`Escalating to ${esc.to}`, `Escalando ${tx.roleTo(esc.to)}`)
                    : tr(`Escalation to ${esc.to} due · live events paused`, `Escalamiento ${tx.roleTo(esc.to)} vencido · eventos en vivo en pausa`)}
              </span>
            )}
            {readOnly && <Badge tone="outline">{tr('Archived record', 'Registro archivado')}</Badge>}
          </div>
          <p className="page-sub">
            {tx.where(alarm)}
            {cam && ` · ${tx.convoyLabel(alarm.convoyId)}`}
            {voyage && (
              <>
                {' · '}
                <Link to={`/voyages/${voyage.id}`} className="mono" style={{ textDecoration: 'none' }}>
                  {voyage.id}
                </Link>
              </>
            )}
            {tr(' · raised ', ' · generada ')}
            {fmtDay(alarm.raisedAt) === fmtDay(now) ? fmtTimeSec(alarm.raisedAt) : fmtSmart(alarm.raisedAt, now)}
            {tr(' · owner: ', ' · responsable: ')}
            {ownerText}
          </p>
        </div>
        {st !== 'closed' && !readOnly && (
          <div className="alm-head__actions">
            {st !== 'resolved' && (
              <button
                type="button"
                className="btn"
                disabled={!canAck || alarm.owner === me}
                title={!canAck ? tr('Your role cannot assign alarms', 'Su rol no puede asignar alarmas') : undefined}
                onClick={() => {
                  app.assignToMe(alarm.id);
                  toast(tr(`${alarm.id} assigned to you.`, `${alarm.id} asignada a usted.`));
                }}
              >
                {alarm.owner === me ? tr('Assigned to you', 'Asignada a usted') : tr('Assign to me', 'Asignarme')}
              </button>
            )}
            {isOpenAshore && ladderNext && (
              <button
                type="button"
                className="btn"
                disabled={!canAck}
                title={
                  canAck
                    ? tr(`Message the ${ladderNext.target.toLowerCase()} now`, `Avisar ahora ${tx.roleTo(ladderNext.target)}`)
                    : tr('Your role cannot escalate alarms', 'Su rol no puede escalar alarmas')
                }
                onClick={() => onEscalate(alarm)}
              >
                {tr('Escalate now', 'Escalar ahora')}
              </button>
            )}
            {isOpenAshore && (
              <button
                type="button"
                className="btn btn--primary"
                disabled={!canAck}
                title={canAck ? undefined : tr('Your role cannot acknowledge alarms', 'Su rol no puede confirmar alarmas')}
                onClick={() => app.acknowledgeAshore(alarm.id)}
              >
                {tr('Acknowledge', 'Confirmar')}
              </button>
            )}
            {st === 'ack_shore' && (
              <button
                type="button"
                className="btn btn--primary"
                disabled={!canAck}
                title={canAck ? undefined : tr('Your role cannot resolve alarms', 'Su rol no puede resolver alarmas')}
                onClick={() => {
                  app.resolve(alarm.id);
                  toast(tr(`${alarm.id} resolved. Classify the event, then close the alarm.`, `${alarm.id} resuelta. Clasifique el evento y luego cierre la alarma.`));
                }}
              >
                {tr('Resolve', 'Resolver')}
              </button>
            )}
            {st === 'resolved' && (
              <button
                type="button"
                className="btn btn--primary"
                disabled={!canAck || !alarm.classification}
                title={alarm.classification ? undefined : tr('Classify the event before closing', 'Clasifique el evento antes de cerrar')}
                onClick={() => app.close(alarm.id)}
              >
                {tr('Close alarm', 'Cerrar alarma')}
              </button>
            )}
          </div>
        )}
      </div>

      {!can('acknowledge') && st !== 'closed' && !readOnly && (
        <div className="callout">
          <Icon name="lock" size={18} />
          <span>{tr('Your role can follow this alarm but not acknowledge, assign or escalate it.', 'Su rol puede seguir esta alarma, pero no confirmarla, asignarla ni escalarla.')}</span>
        </div>
      )}
      {st === 'resolved' && !alarm.classification && canAck && (
        <div className="callout callout--warn">
          <Icon name="info" size={18} />
          <span>{tr('Classify the event (A, R or F) before closing the alarm.', 'Clasifique el evento (A, R o F) antes de cerrar la alarma.')}</span>
        </div>
      )}

      <StateBar alarm={alarm} now={now} />

      <Tabs<DetailTab>
        label={tr('Alarm detail', 'Detalle de la alarma')}
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: tr('Overview', 'Resumen') },
          { value: 'evidence', label: tr('Evidence', 'Evidencia'), count: evidence.length },
          { value: 'activity', label: tr('Activity', 'Actividad'), count: entries.length },
          { value: 'related', label: tr('Related', 'Relacionados'), count: related.length },
        ]}
      />

      {tab === 'overview' && overview}

      {tab === 'evidence' && (
        <div className="alm-cols">
          <div className="alm-cols__main">
            <EvidenceTable
              target={target}
              items={evidence}
              exp={exp}
              onPlay={(item) => {
                if (item.kind === 'footage') playFootage();
                else {
                  setSource('clip');
                  setTab('overview');
                }
              }}
            />
          </div>
          <div className="alm-cols__side">
            <Card title={tr('Longer footage', 'Video más largo')} hint={tr('From the recorder on board', 'Del grabador de a bordo')}>
              <div className="stack" style={{ gap: 10 }}>
                {cam ? (
                  <FootageButton convoyId={alarm.convoyId} footage={footage} now={now} onRequest={onRequestFootage} />
                ) : (
                  <p className="alm-muted">{tr('This alarm has no camera, so there is no recorder footage to ask for.', 'Esta alarma no tiene cámara, así que no hay video del grabador para pedir.')}</p>
                )}
                {footageArrived && cam && (
                  <button type="button" className="btn btn--sm" onClick={playFootage} style={{ alignSelf: 'flex-start' }}>
                    <Icon name="play" size={14} /> {tr('Play recorder footage', 'Reproducir video del grabador')}
                  </button>
                )}
                <span className="alm-muted">
                  {tr(
                    'The recorder keeps 30 days. A 2 min request is about 25 MB and is sent when the link allows; over a weak link it waits behind live alarms.',
                    'El grabador guarda 30 días. Un pedido de 2 min son unos 25 MB y se envía cuando el enlace lo permite; con un enlace débil espera detrás de las alarmas en vivo.',
                  )}
                </span>
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'activity' && (
        <div className="stack">
          <ActivityTrail entries={entries} now={now} />
          <AuditCard ids={[alarm.id, alarm.eventId]} now={now} />
        </div>
      )}

      {tab === 'related' && (
        <div className="alm-cols">
          <div className="alm-cols__main">
            <Card
              title={tr('Related events', 'Eventos relacionados')}
              hint={alarm.vesselId ? tr('Same vessel, within 2 hours', 'Misma embarcación, dentro de 2 horas') : tr('Same convoy, within 2 hours', 'Mismo convoy, dentro de 2 horas')}
              bodyClass="table-wrap"
            >
              {related.length === 0 ? (
                <div className="empty">
                  {alarm.vesselId
                    ? tr('No other events on this vessel within 2 hours.', 'No hay otros eventos en esta embarcación dentro de 2 horas.')
                    : tr('No other events on this convoy within 2 hours.', 'No hay otros eventos en este convoy dentro de 2 horas.')}
                </div>
              ) : (
                <table className="table" style={{ minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th scope="col">{tr('Event', 'Evento')}</th>
                      <th scope="col">{tr('Where', 'Dónde')}</th>
                      <th scope="col">{tr('Time', 'Hora')}</th>
                      <th scope="col">{tr('Status', 'Estado')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {related.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <Link to={r.to} className="strong-link">
                            {r.title}
                          </Link>
                          <span className="sub mono">{r.id}</span>
                        </td>
                        <td>{r.where}</td>
                        <td className="num">{fmtSmart(r.at, now)}</td>
                        <td>{r.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
          <div className="alm-cols__side">
            <Card
              title={tr('Voyage', 'Viaje')}
              hint={tr('From Connect', 'Desde Connect')}
              action={
                voyage && (
                  <Link to={`/voyages/${voyage.id}`} className="card__link">
                    {tr('Open voyage record', 'Abrir registro del viaje')}
                  </Link>
                )
              }
            >
              {voyage ? (
                <dl className="dl">
                  <dt>{tr('Voyage', 'Viaje')}</dt>
                  <dd>
                    <Link to={`/voyages/${voyage.id}`} className="mono" style={{ textDecoration: 'none' }}>
                      {voyage.id}
                    </Link>
                  </dd>
                  <dt>{tr('Convoy', 'Convoy')}</dt>
                  <dd>{convoy?.name}</dd>
                  <dt>{tr('Route', 'Ruta')}</dt>
                  <dd>{tx.voyageText(voyage).route}</dd>
                  <dt>{tr('Status', 'Estado')}</dt>
                  <dd>{tx.voyageText(voyage).status}</dd>
                  <dt>{tr('Next call', 'Próxima escala')}</dt>
                  <dd>{tx.voyageText(voyage).nextCall}</dd>
                  <dt>{tr('Events', 'Eventos')}</dt>
                  <dd className="num">{tr(`${voyage.events} · ${voyage.toReview} to review`, `${voyage.events} · ${voyage.toReview} por revisar`)}</dd>
                  <dt>{tr('Alarms', 'Alarmas')}</dt>
                  <dd className="num">{tr(`${voyage.alarms} · ${voyage.openAlarms} open`, `${voyage.alarms} · ${voyage.openAlarms} abiertas`)}</dd>
                </dl>
              ) : (
                <p className="alm-muted">{tr('This alarm is not linked to a voyage.', 'Esta alarma no está vinculada a un viaje.')}</p>
              )}
            </Card>
            {vessel && (
              <Card title={tr('Vessel', 'Embarcación')}>
                <dl className="dl">
                  <dt>{tr('Vessel', 'Embarcación')}</dt>
                  <dd>{vessel.name}</dd>
                  <dt>{tr('Edge unit', 'Unidad de borde')}</dt>
                  <dd className="mono">{vessel.edgeUnitId}</dd>
                  <dt>{tr('Link', 'Enlace')}</dt>
                  <dd>{tx.linkLabel(convoy?.linkLabel)}</dd>
                  {phone && (
                    <>
                      <dt>{tr('Wheelhouse', 'Puente')}</dt>
                      <dd>{readOnly ? <span className="mono">{phone.display}</span> : callLink('btn btn--sm')}</dd>
                    </>
                  )}
                </dl>
              </Card>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** ALM-08: evidence with hashes; every export is a real, watermarked, logged file. */
export function EvidenceTable({
  target,
  items,
  exp,
  onPlay,
}: {
  target: EvidenceTarget;
  items: EvidenceItem[];
  exp: EvidenceExport;
  onPlay?: (item: EvidenceItem) => void;
}) {
  const { can, toast } = useApp();
  const tx = useAlarmText();
  const { tr } = tx;
  const mayExport = can('export_clips');
  const mine = exp.exportsFor(target.id);
  const busyAll = exp.busy === `${target.id}|all`;
  const noExport = tr('Your role cannot export clips. An operations manager, fleet superintendent, safety administrator or reviewer can.', 'Su rol no puede exportar clips. Puede hacerlo un gerente de operaciones, el superintendente de flota, el administrador de seguridad o un revisor.');

  const copy = (hash: string) => {
    void navigator.clipboard?.writeText(hash).then(
      () => toast(tr('Hash copied.', 'Hash copiado.')),
      () => toast(tr('The browser blocked the clipboard. Select the hash and copy it.', 'El navegador bloqueó el portapapeles. Seleccione el hash y cópielo.')),
    );
  };

  return (
    <>
      <Card
        title={tr('Evidence', 'Evidencia')}
        hint={tr('SHA-256 recorded when each file reached shore', 'SHA-256 registrado cuando cada archivo llegó a tierra')}
        bodyClass="table-wrap"
        action={
          items.length > 1 && (
            <button
              type="button"
              className="btn btn--sm"
              disabled={!mayExport || exp.busy !== null}
              title={mayExport ? tr(`Downloads ${items.length} files, each watermarked`, `Descarga ${items.length} archivos, cada uno con marca de agua`) : noExport}
              onClick={() => void exp.exportAll(target, items)}
            >
              <Icon name="download" size={16} /> {busyAll ? tr('Exporting…', 'Exportando…') : tr('Export all', 'Exportar todo')}
            </button>
          )
        }
      >
        {items.length === 0 ? (
          <div className="empty">{tr('No evidence files. This alarm comes from edge unit health messages.', 'No hay archivos de evidencia. Esta alarma viene de los mensajes de estado de la unidad de borde.')}</div>
        ) : (
          <table className="table" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th scope="col">{tr('File', 'Archivo')}</th>
                <th scope="col">{tr('Format', 'Formato')}</th>
                <th scope="col">SHA-256</th>
                <th scope="col" className="right">
                  <span className="sr-only">{tr('Actions', 'Acciones')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => {
                const label = tx.evidence(e);
                const busy = exp.busy === `${target.id}|${e.name}`;
                return (
                  <tr key={e.name}>
                    <td style={{ fontWeight: 600 }}>{label}</td>
                    <td>{e.meta}</td>
                    <td>
                      {e.hash ? (
                        <span className="alm-hash">
                          <span className="mono">{e.hash}</span>
                          <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label={tr(`Copy hash of ${label}`, `Copiar hash de ${label}`)} onClick={() => copy(e.hash!)}>
                            <Icon name="copy" size={16} />
                          </button>
                        </span>
                      ) : (
                        <span className="alm-muted">{tr('Pending', 'Pendiente')}</span>
                      )}
                    </td>
                    <td className="right">
                      <span className="alm-hash" style={{ justifyContent: 'flex-end' }}>
                        {(e.kind === 'clip' || e.kind === 'footage') && onPlay && (
                          <button type="button" className="btn btn--sm" onClick={() => onPlay(e)} aria-label={tr(`Play ${label}`, `Reproducir ${label}`)}>
                            <Icon name="play" size={14} /> {tr('Play', 'Reproducir')}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn--sm"
                          disabled={!mayExport || exp.busy !== null}
                          title={mayExport ? undefined : noExport}
                          aria-label={tr(`Export ${label}`, `Exportar ${label}`)}
                          onClick={() => void exp.exportOne(target, e, items)}
                        >
                          <Icon name="download" size={14} /> {busy ? tr('Exporting…', 'Exportando…') : tr('Export', 'Exportar')}
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      <Card title={tr('Exports', 'Exportaciones')} hint={tr('Watermarked, faces blurred when the file leaves GFSA', 'Con marca de agua y rostros difuminados cuando el archivo sale de GFSA')}>
        {!mayExport && (
          <p className="alm-muted" style={{ marginBottom: 8 }}>
            {noExport}
          </p>
        )}
        <ExportList records={mine} />
      </Card>
    </>
  );
}

/** The saved exports of one alarm or event, newest first. */
export function ExportList({ records }: { records: ReturnType<EvidenceExport['exportsFor']> }) {
  const tx = useAlarmText();
  const { tr } = tx;
  if (records.length === 0) {
    return <p className="alm-muted">{tr('No exports yet. Every export carries a watermark ID and is written to the audit log.', 'Todavía no hay exportaciones. Cada una lleva una marca de agua y queda en el registro de auditoría.')}</p>;
  }
  return (
    <ul className="alm-exports">
      {records.map((x) => (
        <li key={`${x.wm}-${x.at}`}>
          <span>
            <strong>{tx.evidence({ name: x.item })}</strong>
            <span className="alm-muted"> · {x.by}</span>
            <span className="alm-exports__file mono">{x.file}</span>
          </span>
          <span className="mono">
            {x.wm} · {fmtDay(x.at)} {fmtTimeSec(x.at)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Audit log lines that name this alarm or event (ALM-09). */
export function AuditCard({ ids, now }: { ids: string[]; now: number }) {
  const { state, can } = useApp();
  const tx = useAlarmText();
  const { tr } = tx;
  const lines = state.audit.filter((e) => ids.some((id) => e.target.includes(id)));
  return (
    <Card
      title={tr('Audit log', 'Registro de auditoría')}
      hint={tr('Hash-chained, every view, export and change', 'Encadenado por hash: cada vista, exportación y cambio')}
      bodyClass="table-wrap"
      action={
        can('read_audit') && (
          <Link to="/admin/audit" className="card__link">
            {tr('Full audit log', 'Registro completo')}
          </Link>
        )
      }
    >
      {lines.length === 0 ? (
        <div className="empty">{tr('No audit lines yet for this alarm.', 'Todavía no hay líneas de auditoría para esta alarma.')}</div>
      ) : (
        <table className="table" style={{ minWidth: 560 }}>
          <thead>
            <tr>
              <th scope="col">{tr('Time', 'Hora')}</th>
              <th scope="col">{tr('Who', 'Quién')}</th>
              <th scope="col">{tr('Action', 'Acción')}</th>
              <th scope="col">{tr('Object', 'Objeto')}</th>
              <th scope="col">Hash</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((e) => (
              <tr key={e.seq}>
                <td className="mono">{fmtDay(e.at) === fmtDay(now) ? fmtTimeSec(e.at) : fmtSmart(e.at, now)}</td>
                <td>
                  {tx.actor(e.actor)}
                  <span className="sub">{e.role}</span>
                </td>
                <td>
                  {e.action}
                  {e.details && <span className="sub">{e.details}</span>}
                </td>
                <td className="mono" style={{ fontSize: 12 }}>
                  {e.target}
                </td>
                <td className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {shortHash(e.hash)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
