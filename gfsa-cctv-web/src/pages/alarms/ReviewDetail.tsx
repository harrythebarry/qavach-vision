import { useState } from 'react';
import { Link } from 'react-router';
import type { ReviewEvent } from '../../data/types';
import { useCaseById } from '../../data/useCases';
import { voyageById } from '../../data/alarms';
import { Badge, Card, Meter, PriorityBadge, usePriorityName } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useApp } from '../../state/AppState';
import { SHADOW_DAY_MS, activeConfig, ucStore } from '../../state/configStore';
import { useStore } from '../../lib/persist';
import { fmtDay, fmtSmart, fmtTimeSec } from '../../lib/time';
import {
  LEVEL_NAME,
  TALLY_NAME,
  arrivedAshoreAt,
  eventEvidence,
  falseReasonsFor,
  segmentLabelFor,
  useAlarmText,
} from './alarmConsoleData';
import { ExportList, type ClassifyProps } from './AlarmDetail';
import { targetOfEvent, type EvidenceExport } from './evidenceExport';
import type { FootageRequest } from './footage';
import { ClassifyPanel, ClipPlayer, FootageButton, LateBadge, type ClipSource } from './parts';

/** One event from the To review queue, laid out for fast keyboard review (ALM-06). */
export function ReviewDetail({
  ev,
  now,
  position,
  total,
  reviewed,
  scopeTotal,
  counts,
  onNext,
  footage,
  onRequestFootage,
  exp,
  classifyProps,
}: {
  ev: ReviewEvent;
  now: number;
  /** Place of this event in the filtered list. */
  position: number;
  total: number;
  /** Reviewed events in the convoy scope, and all events in it. */
  reviewed: number;
  scopeTotal: number;
  counts: Record<'accepted' | 'rejected' | 'false_alert', number>;
  onNext: () => void;
  footage?: FootageRequest;
  onRequestFootage: () => void;
  exp: EvidenceExport;
  classifyProps: ClassifyProps;
}) {
  const { state, can } = useApp();
  const tx = useAlarmText();
  const { tr, p, fleet } = tx;
  const prioName = usePriorityName();
  const ucRecords = useStore(ucStore);
  const [source, setSource] = useState<ClipSource>('clip');
  const uc = useCaseById(ev.useCaseId);
  const rec = uc ? ucRecords[uc.id] : undefined;
  const cfg = uc && rec ? activeConfig(uc, rec) : undefined;
  const cam = fleet.cameraById(ev.cameraId);
  const convoy = fleet.convoyById(ev.convoyId);
  const voyage = voyageById(convoy?.voyageId);
  const footageArrived = Boolean(footage?.arrivedAt);
  const evidence = eventEvidence(ev, footageArrived);
  const arrived = arrivedAshoreAt(ev, state.audit);
  const target = targetOfEvent(ev, voyage?.id, arrived);
  const canClassify = can('classify');
  const mayExport = can('export_clips');
  const mine = exp.exportsFor(ev.id);
  const sources: ClipSource[] = footageArrived ? ['clip', 'footage'] : ['clip'];
  const time = (iso: string) => (fmtDay(iso) === fmtDay(now) ? fmtTimeSec(iso) : `${fmtDay(iso)} ${fmtTimeSec(iso)}`);

  // Shadow run progress, from the saved use case record.
  const shadowDay = rec?.shadowStart ? Math.max(1, Math.floor((now - new Date(rec.shadowStart).getTime()) / SHADOW_DAY_MS) + 1) : undefined;
  const shadowText = shadowDay
    ? tr(`Shadow run · day ${Math.min(shadowDay, 14)} of 14`, `Ejecución en sombra · día ${Math.min(shadowDay, 14)} de 14`)
    : rec
      ? tx.ucStatus(rec.statusNote)
      : tr('Shadow run', 'Ejecución en sombra');

  return (
    <>
      <div className="alm-head">
        <div className="alm-head__text">
          <nav aria-label={tr('Breadcrumb', 'Ruta de navegación')} className="breadcrumb">
            <Link to="/">{tr('Operations', 'Operaciones')}</Link> / <Link to="/alarms">{tr('Alarms and events', 'Alarmas y eventos')}</Link> /{' '}
            <Link to="/alarms?tab=review">{tr('To review', 'Por revisar')}</Link> / <span className="mono">{ev.id}</span>
          </nav>
          <h1 className="page-title">{tx.ucName(uc, ev.useCaseId)}</h1>
          <div className="alm-head__meta">
            {uc && <PriorityBadge p={cfg?.priority ?? uc.priority} />}
            {ev.shadow && <Badge tone="info">{tr('Shadow run · logged only', 'Ejecución en sombra · solo registro')}</Badge>}
            {ev.queued && <LateBadge />}
            {ev.classification ? (
              <Badge tone={ev.classification === 'false_alert' ? 'bad' : 'ok'}>
                {tr('Reviewed', 'Revisado')} · {tx.classText(ev.classification, ev.falseReason)}
              </Badge>
            ) : (
              <Badge tone="warn">{tr('Not reviewed', 'Sin revisar')}</Badge>
            )}
          </div>
          <p className="page-sub">
            {tx.where(ev)} · {tx.convoyLabel(ev.convoyId)}
            {voyage && (
              <>
                {' · '}
                <Link to={`/voyages/${voyage.id}`} className="mono" style={{ textDecoration: 'none' }}>
                  {voyage.id}
                </Link>
              </>
            )}
            {ev.queued ? tr(' · detected on board ', ' · detectado a bordo ') : tr(' · detected ', ' · detectado ')}
            {fmtSmart(ev.at, now)}
            {ev.queued && arrived && tr(` · reached shore ${fmtSmart(arrived, now)}`, ` · llegó a tierra ${fmtSmart(arrived, now)}`)}
            {tr(' · confidence ', ' · confianza ')}
            <span className="mono">{ev.confidence.toFixed(2)}</span>
          </p>
        </div>
        <div className="alm-head__actions">
          <span className="alm-muted num">{tr(`Event ${position} of ${total}`, `Evento ${position} de ${total}`)}</span>
          <button type="button" className="btn" onClick={onNext}>
            {tr('Next', 'Siguiente')} <kbd className="alm-kbd">J</kbd>
          </button>
        </div>
      </div>

      {ev.queued && (
        <div className="callout callout--warn">
          <Icon name="wifiOff" size={18} />
          <span>
            {tr(
              `${convoy?.name} was out of coverage when this happened. The edge unit stored the event on board and sent it on reconnect${arrived ? ` at ${time(arrived)}` : ''}; the times shown are the original ones from the vessel.`,
              `${convoy?.name} estaba sin cobertura cuando ocurrió. La unidad de borde guardó el evento a bordo y lo envió al reconectarse${arrived ? ` a las ${time(arrived)}` : ''}; las horas que se muestran son las originales de la embarcación.`,
            )}
          </span>
        </div>
      )}

      {ev.shadow && uc && (
        <div className="callout">
          <Icon name="info" size={18} />
          <span>
            {tr(
              `${shadowText}. This use case only records events while it proves itself; your decision counts toward its accuracy gate before alerts switch on.`,
              `${shadowText}. Este caso de uso solo registra eventos mientras demuestra su precisión; su decisión cuenta para el umbral de precisión antes de activar las alertas.`,
            )}
          </span>
        </div>
      )}

      <div className="alm-cols">
        <div className="alm-cols__main">
          {cam && (
            <ClipPlayer
              key={`${ev.id}-${source}-${sources.join()}`}
              targetId={ev.id}
              cameraId={cam.id}
              image={cam.image}
              alt={tr(`Clip frame from ${tx.where(ev)}: ${uc?.rule.toLowerCase() ?? 'detection'}`, `Cuadro del clip de ${tx.where(ev)}: ${uc?.ruleEs.toLowerCase() ?? 'detección'}`)}
              detection={ev.detection}
              raisedAt={ev.at}
              segmentLabel={p(segmentLabelFor(ev.useCaseId))}
              markerLabel={tr('Event recorded', 'Evento registrado')}
              sources={sources}
              source={source}
              onSource={setSource}
            />
          )}
          <ClassifyPanel
            value={ev.classification}
            reason={ev.falseReason}
            reasons={falseReasonsFor(ev.useCaseId)}
            pendingFalse={classifyProps.pendingFalse && canClassify}
            disabled={!canClassify}
            disabledNote={tr('Your role cannot classify events. A duty officer, reviewer or safety administrator can.', 'Su rol no puede clasificar eventos. Puede hacerlo un oficial de guardia, un revisor o el administrador de seguridad.')}
            onClassify={classifyProps.onClassify}
            onFalse={classifyProps.onFalse}
            onCancelFalse={classifyProps.onCancelFalse}
          />
        </div>

        <div className="alm-cols__side">
          <Card title={tr('Review progress', 'Avance de la revisión')} hint={tr('In this scope', 'En este alcance')}>
            <div className="stack" style={{ gap: 10 }}>
              <div className="alm-progress">
                <strong className="num">{tr(`${reviewed} of ${scopeTotal}`, `${reviewed} de ${scopeTotal}`)}</strong>
                <span className="alm-muted">{tr('reviewed', 'revisados')}</span>
              </div>
              <Meter pct={scopeTotal ? (reviewed / scopeTotal) * 100 : 0} label={tr('Events reviewed', 'Eventos revisados')} />
              <ul className="alm-tally">
                {(Object.keys(counts) as (keyof typeof counts)[]).map((k) => (
                  <li key={k}>
                    <span>{p(TALLY_NAME[k])}</span>
                    <strong className="num">{counts[k]}</strong>
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          <section className="card alm-details" aria-labelledby="alm-ev-details-title">
            <h2 id="alm-ev-details-title">{tr('Details', 'Detalles')}</h2>
            <dl className="dl">
              <dt>{tr('Event', 'Evento')}</dt>
              <dd className="mono">{ev.id}</dd>
              <dt>{tr('Use case', 'Caso de uso')}</dt>
              <dd>
                <Link to={`/config/use-cases/${ev.useCaseId}`} style={{ textDecoration: 'none' }}>
                  {tx.ucName(uc, ev.useCaseId)}
                </Link>
              </dd>
              {uc && (
                <>
                  <dt>{tr('Rule', 'Regla')}</dt>
                  <dd>{tx.ucRule(uc)}</dd>
                  <dt>{tr('Level', 'Nivel')}</dt>
                  <dd>
                    {ev.shadow
                      ? tr(`Shadow run, then ${p(LEVEL_NAME[cfg?.level ?? uc.level]).toLowerCase()}`, `Ejecución en sombra, luego ${p(LEVEL_NAME[cfg?.level ?? uc.level]).toLowerCase()}`)
                      : p(LEVEL_NAME[cfg?.level ?? uc.level])}{' '}
                    · {prioName(cfg?.priority ?? uc.priority)}
                  </dd>
                </>
              )}
              <dt>{tr('Camera', 'Cámara')}</dt>
              <dd>
                {tx.where(ev)} <span className="mono alm-muted">{ev.cameraId}</span>
              </dd>
              <dt>{ev.queued ? tr('Detected on board', 'Detectado a bordo') : tr('Detected', 'Detectado')}</dt>
              <dd className="mono">{time(ev.at)}</dd>
              {ev.queued && (
                <>
                  <dt>{tr('Reached shore', 'Llegó a tierra')}</dt>
                  <dd className="mono">{arrived ? time(arrived) : tr('On reconnect', 'Al reconectar')}</dd>
                </>
              )}
              <dt>{tr('Confidence', 'Confianza')}</dt>
              <dd className="mono">{ev.confidence.toFixed(2)}</dd>
            </dl>
          </section>

          <section className="card alm-evsum" aria-labelledby="alm-ev-evidence-title">
            <div className="alm-evsum__head">
              <h2 id="alm-ev-evidence-title">{tr('Evidence', 'Evidencia')}</h2>
              {evidence.length > 1 && (
                <button
                  type="button"
                  className="card__link alm-linkbtn"
                  disabled={!mayExport || exp.busy !== null}
                  title={mayExport ? undefined : tr('Your role cannot export clips', 'Su rol no puede exportar clips')}
                  onClick={() => void exp.exportAll(target, evidence)}
                >
                  {exp.busy === `${ev.id}|all` ? tr('Exporting…', 'Exportando…') : tr('Export all', 'Exportar todo')}
                </button>
              )}
            </div>
            <ul className="alm-evsum__list">
              {evidence.map((e) => {
                const label = tx.evidence(e);
                return (
                  <li key={e.name}>
                    <span className="alm-evsum__name">
                      {label}
                      <span className="mono alm-evsum__hash">{e.hash}</span>
                    </span>
                    <span className="alm-hash">
                      {e.kind === 'footage' && (
                        <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label={tr(`Play ${label}`, `Reproducir ${label}`)} onClick={() => setSource('footage')}>
                          <Icon name="play" size={16} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn--ghost btn--icon btn--sm"
                        aria-label={tr(`Export ${label}`, `Exportar ${label}`)}
                        title={mayExport ? undefined : tr('Your role cannot export clips', 'Su rol no puede exportar clips')}
                        disabled={!mayExport || exp.busy !== null}
                        onClick={() => void exp.exportOne(target, e, evidence)}
                      >
                        <Icon name="download" size={16} />
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
            <FootageButton convoyId={ev.convoyId} footage={footage} now={now} onRequest={onRequestFootage} />
            {mine.length > 0 && <ExportList records={mine} />}
            <span className="alm-muted">
              {mayExport
                ? tr('Exports are watermarked, faces blurred, and logged.', 'Las exportaciones llevan marca de agua, rostros difuminados y quedan registradas.')
                : tr('Your role cannot export clips. An operations manager, safety administrator or reviewer can.', 'Su rol no puede exportar clips. Puede hacerlo un gerente de operaciones, el administrador de seguridad o un revisor.')}
            </span>
          </section>
        </div>
      </div>
    </>
  );
}
