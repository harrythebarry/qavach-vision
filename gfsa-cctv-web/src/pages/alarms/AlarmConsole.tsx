import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import type { Alarm, Classification, Priority, ReviewEvent } from '../../data/types';
import { useCaseById } from '../../data/useCases';
import { roleById } from '../../data/users';
import { Badge, PRIORITY_NAME, PRIORITY_NAME_ES, PriorityBadge } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useApp, useInScope } from '../../state/AppState';
import { useUsers } from '../../state/usersStore';
import { fmtCountdown, fmtDay, fmtSmart, fmtTime, useNow } from '../../lib/time';
import {
  ARCHIVED_ALARMS,
  STATE_SHORT,
  escalationOf,
  falseReasonsFor,
  useAlarmText,
  type AlarmText,
} from './alarmConsoleData';
import { AlarmDetail } from './AlarmDetail';
import { ReviewDetail } from './ReviewDetail';
import { useEvidenceExport } from './evidenceExport';
import { useFootage, useFootageDelivery } from './footage';
import './AlarmConsole.css';

type QueueTab = 'open' | 'review' | 'closed';

const PRIORITIES: Priority[] = ['P1', 'P2', 'P3', 'P4'];

const byPriority = (a: Alarm, b: Alarm) => a.priority.localeCompare(b.priority) || b.raisedAt.localeCompare(a.raisedAt);
const newestFirst = (a: Alarm, b: Alarm) => (b.stateTimes.closed ?? b.raisedAt).localeCompare(a.stateTimes.closed ?? a.raisedAt);

/** ALM-01 to ALM-10: the alarm queue, the review queue and the selected alarm in full. */
export function AlarmConsolePage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const app = useApp();
  const { state, can, log, toast } = app;
  const inScope = useInScope();
  const now = useNow();
  const tx = useAlarmText();
  const { tr, fleet } = tx;
  const users = useUsers();
  const exp = useEvidenceExport();
  const { requests: footage, request: requestFootage } = useFootage();
  useFootageDelivery(now);

  const tabParam = params.get('tab');
  const tab: QueueTab = tabParam === 'review' || tabParam === 'closed' ? tabParam : 'open';

  const [prio, setPrio] = useState<Set<Priority>>(() => new Set(PRIORITIES));
  const [ucFilter, setUcFilter] = useState('all');
  const [vesselFilter, setVesselFilter] = useState('all');
  const [hideReviewed, setHideReviewed] = useState(false);
  const [falsePendingFor, setFalsePendingFor] = useState<string | null>(null);

  /** "DO" for an owner who is a duty officer; nothing for the system. */
  const ownerShort = (name?: string) => {
    if (!name || name === 'System') return '';
    const u = users.find((x) => x.name === name);
    return u ? roleById(u.role).short : '';
  };

  // ---------- Queues (live: the engine adds alarms and events as they arrive) ----------

  const allAlarms = useMemo(
    () => [...state.alarms, ...ARCHIVED_ALARMS.filter((x) => !state.alarms.some((a) => a.id === x.id))],
    [state.alarms],
  );
  const scoped = allAlarms.filter((a) => inScope(a.convoyId));
  const openAll = scoped.filter((a) => a.state !== 'closed').sort(byPriority);
  const closedAll = scoped.filter((a) => a.state === 'closed').sort(newestFirst);
  const openList = openAll.filter((a) => prio.has(a.priority));
  const closedList = closedAll.filter((a) => prio.has(a.priority));
  const closedToday = closedList.filter((a) => fmtDay(a.stateTimes.closed ?? a.raisedAt) === fmtDay(now));

  const reviewScoped = state.reviewEvents.filter((e) => inScope(e.convoyId));
  const toReviewCount = reviewScoped.filter((e) => !e.classification).length;
  const lateCount = reviewScoped.filter((e) => e.queued && !e.classification).length;
  const reviewList = reviewScoped.filter(
    (e) =>
      (ucFilter === 'all' || e.useCaseId === ucFilter) &&
      (vesselFilter === 'all' || e.vesselId === vesselFilter) &&
      (!hideReviewed || !e.classification),
  );
  const ucOptions = [...new Set(reviewScoped.map((e) => e.useCaseId))];
  const vesselOptions = [...new Set(reviewScoped.map((e) => e.vesselId))];

  // ---------- Selection ----------
  // Without an id in the URL the first item is shown, and it stays shown while
  // new alarms and events arrive above it (so a live arrival never swaps the
  // alarm you are working on).

  const pin = useRef<Partial<Record<QueueTab, string>>>({});
  let selectedAlarm: Alarm | undefined;
  if (tab !== 'review') {
    if (id) selectedAlarm = allAlarms.find((a) => a.id === id);
    else {
      const list = tab === 'closed' ? closedList : [...openList, ...closedToday];
      selectedAlarm = list.find((a) => a.id === pin.current[tab]) ?? list[0];
    }
  }

  const evParam = params.get('event');
  const selectedEvent: ReviewEvent | undefined =
    tab === 'review'
      ? evParam
        ? state.reviewEvents.find((e) => e.id === evParam)
        : (reviewList.find((e) => e.id === pin.current.review) ?? reviewList.find((e) => !e.classification) ?? reviewList[0])
      : undefined;

  useEffect(() => {
    pin.current[tab] = tab === 'review' ? (evParam ? undefined : selectedEvent?.id) : id ? undefined : selectedAlarm?.id;
  });

  const readOnly = Boolean(selectedAlarm && !state.alarms.some((a) => a.id === selectedAlarm.id));
  const targetId = selectedEvent?.id ?? selectedAlarm?.id;
  const targetUseCase = selectedEvent?.useCaseId ?? selectedAlarm?.useCaseId;
  const pendingFalse = Boolean(targetId && falsePendingFor === targetId);
  const outOfScope = selectedAlarm ? !inScope(selectedAlarm.convoyId) : selectedEvent ? !inScope(selectedEvent.convoyId) : false;
  const blocked = outOfScope && state.role === 'master';

  const alarmLink = (a: Alarm) => `/alarms/${a.id}${tab === 'closed' ? '?tab=closed' : ''}`;
  const eventLink = (e: ReviewEvent) => `/alarms?tab=review&event=${e.id}`;

  const goTab = (t: QueueTab) => {
    setFalsePendingFor(null);
    navigate(t === 'open' ? '/alarms' : `/alarms?tab=${t}`);
  };

  // Every alarm or event opened here is a view of its video: write it to the audit log once.
  const opened = useRef(new Set<string>());
  useEffect(() => {
    if (!targetId || blocked || opened.current.has(targetId)) return;
    opened.current.add(targetId);
    log(selectedEvent ? 'Opened event' : 'Opened alarm', targetId);
  }, [targetId, blocked, selectedEvent, log]);

  // ---------- Actions ----------

  const next = () => {
    setFalsePendingFor(null);
    if (tab === 'review') {
      const i = reviewList.findIndex((e) => e.id === selectedEvent?.id);
      const n = reviewList[i + 1];
      if (n) setParams({ tab: 'review', event: n.id });
      else toast(tr('End of the review queue.', 'Fin de la cola de revisión.'));
      return;
    }
    const list = tab === 'closed' ? closedList : [...openList, ...closedToday];
    const i = list.findIndex((a) => a.id === selectedAlarm?.id);
    const n = list[i + 1];
    if (n) navigate(alarmLink(n));
    else toast(tab === 'closed' ? tr('End of the closed list.', 'Fin de la lista de cerradas.') : tr('End of the alarm queue.', 'Fin de la cola de alarmas.'));
  };

  const classify = (c: Classification, reason?: string) => {
    if (!can('classify')) {
      toast(tr('Your role cannot classify events.', 'Su rol no puede clasificar eventos.'));
      return;
    }
    setFalsePendingFor(null);
    if (tab === 'review' && selectedEvent) {
      app.classifyEvent(selectedEvent.id, c, reason);
      const i = reviewList.findIndex((e) => e.id === selectedEvent.id);
      const n = reviewList.slice(i + 1).find((e) => !e.classification) ?? reviewList.slice(0, Math.max(0, i)).find((e) => !e.classification);
      if (n) setParams({ tab: 'review', event: n.id }, { replace: true });
      else setParams({ tab: 'review', event: selectedEvent.id }, { replace: true });
      const what = tx.classText(c, reason);
      toast(
        tr(
          `${selectedEvent.id} saved as ${what}.${n ? ' Next event opened.' : ' Review queue done.'}`,
          `${selectedEvent.id} guardado como ${what}.${n ? ' Se abrió el siguiente evento.' : ' Cola de revisión terminada.'}`,
        ),
      );
    } else if (selectedAlarm && !readOnly) {
      app.classifyAlarm(selectedAlarm.id, c, reason);
      toast(tr(`${selectedAlarm.id} classified as ${tx.classText(c, reason)}.`, `${selectedAlarm.id} clasificada como ${tx.classText(c, reason)}.`));
    }
  };

  const startFalse = () => {
    if (!can('classify') || !targetId || readOnly) return;
    setFalsePendingFor(targetId);
  };

  // ---------- Keyboard: A accept, R reject, F false alert, J next, 1–4 reasons (ALM-06) ----------

  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyHandler.current = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    const el = e.target as HTMLElement | null;
    if (el?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]')) return;
    if (document.querySelector('[role="dialog"]')) return;
    const k = e.key.toLowerCase();
    const mayClassify = can('classify') && Boolean(targetId) && !readOnly && !blocked;
    if (k === 'j') {
      e.preventDefault();
      next();
    } else if (k === 'a' && mayClassify) {
      e.preventDefault();
      classify('accepted');
    } else if (k === 'r' && mayClassify) {
      e.preventDefault();
      classify('rejected');
    } else if (k === 'f' && mayClassify) {
      e.preventDefault();
      startFalse();
    } else if (pendingFalse && /^[1-9]$/.test(k) && targetUseCase) {
      const reason = falseReasonsFor(targetUseCase)[Number(k) - 1];
      if (reason) {
        e.preventDefault();
        classify('false_alert', reason[0]);
      }
    } else if (k === 'escape' && pendingFalse) {
      setFalsePendingFor(null);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const classifyProps = {
    pendingFalse,
    onClassify: classify,
    onFalse: startFalse,
    onCancelFalse: () => setFalsePendingFor(null),
  };

  // ---------- Render ----------

  const scopeLabel = state.scope === 'all' ? tr('All convoys', 'Todos los convoyes') : tx.convoyLabel(state.scope);
  const prioCounts = (list: Alarm[]) => Object.fromEntries(PRIORITIES.map((p) => [p, list.filter((a) => a.priority === p).length]));
  const counts = prioCounts(tab === 'closed' ? closedAll : openAll);

  const reviewCounts = {
    accepted: reviewScoped.filter((e) => e.classification === 'accepted').length,
    rejected: reviewScoped.filter((e) => e.classification === 'rejected').length,
    false_alert: reviewScoped.filter((e) => e.classification === 'false_alert').length,
  };

  const outOfScopeCallout = (
    <div className="callout callout--warn">
      <Icon name="filter" size={18} />
      <span className="grow" style={{ flexBasis: 200 }}>
        {selectedEvent
          ? tr(`This event is outside the convoy filter in the header (${scopeLabel}).`, `Este evento está fuera del filtro de convoy del encabezado (${scopeLabel}).`)
          : tr(`This alarm is outside the convoy filter in the header (${scopeLabel}).`, `Esta alarma está fuera del filtro de convoy del encabezado (${scopeLabel}).`)}
      </span>
      <button type="button" className="btn btn--sm" onClick={() => app.setScope('all')}>
        {tr('Show all convoys', 'Mostrar todos los convoyes')}
      </button>
    </div>
  );

  let detail: ReactNode;
  if (tab === 'review') {
    detail = !selectedEvent ? (
      evParam ? (
        <EmptyDetail
          title={tr(`Event ${evParam} not found`, `Evento ${evParam} no encontrado`)}
          text={tr('It may have been archived, or the link is wrong.', 'Puede haberse archivado, o el enlace es incorrecto.')}
          tx={tx}
        />
      ) : (
        <EmptyDetail
          title={tr('Nothing to review', 'Nada para revisar')}
          text={tr('No events wait for review in this scope and filter. New events appear here as the vessels send them.', 'No hay eventos pendientes en este alcance y filtro. Los eventos nuevos aparecen aquí a medida que las embarcaciones los envían.')}
          tx={tx}
        />
      )
    ) : blocked ? (
      <EmptyDetail title={tr('This event belongs to another convoy', 'Este evento pertenece a otro convoy')} text={tr('Masters see their own convoy only.', 'Los capitanes solo ven su propio convoy.')} tx={tx} />
    ) : (
      <>
        {outOfScope && outOfScopeCallout}
        <ReviewDetail
          ev={selectedEvent}
          now={now}
          position={Math.max(1, reviewList.findIndex((e) => e.id === selectedEvent.id) + 1)}
          total={reviewList.length}
          reviewed={reviewScoped.length - toReviewCount}
          scopeTotal={reviewScoped.length}
          counts={reviewCounts}
          onNext={next}
          footage={footage[selectedEvent.id]}
          onRequestFootage={() => requestFootage({ id: selectedEvent.id, kind: 'event', convoyId: selectedEvent.convoyId, vesselId: selectedEvent.vesselId, cameraId: selectedEvent.cameraId })}
          exp={exp}
          classifyProps={classifyProps}
        />
      </>
    );
  } else if (!selectedAlarm) {
    detail = id ? (
      <EmptyDetail title={tr(`Alarm ${id} not found`, `Alarma ${id} no encontrada`)} text={tr('It may have been archived, or the link is wrong.', 'Puede haberse archivado, o el enlace es incorrecto.')} tx={tx} />
    ) : (
      <EmptyDetail
        title={tab === 'closed' ? tr('No closed alarms', 'No hay alarmas cerradas') : tr('No open alarms', 'No hay alarmas abiertas')}
        text={
          tab === 'closed'
            ? tr('Nothing closed in this scope and filter.', 'No hay nada cerrado en este alcance y filtro.')
            : tr('Every alarm in this scope is closed. The queue fills as vessels report.', 'Todas las alarmas de este alcance están cerradas. La cola se llena a medida que reportan las embarcaciones.')
        }
        tx={tx}
      />
    );
  } else if (blocked) {
    detail = <EmptyDetail title={tr('This alarm belongs to another convoy', 'Esta alarma pertenece a otro convoy')} text={tr('Masters see their own convoy only.', 'Los capitanes solo ven su propio convoy.')} tx={tx} />;
  } else {
    detail = (
      <>
        {outOfScope && outOfScopeCallout}
        <AlarmDetail
          key={selectedAlarm.id}
          alarm={selectedAlarm}
          now={now}
          readOnly={readOnly}
          allAlarms={allAlarms}
          onEscalate={(a) => app.escalateNow(a.id)}
          footage={footage[selectedAlarm.id]}
          onRequestFootage={() =>
            requestFootage({ id: selectedAlarm.id, kind: 'alarm', convoyId: selectedAlarm.convoyId, vesselId: selectedAlarm.vesselId, cameraId: selectedAlarm.cameraId })
          }
          exp={exp}
          classifyProps={classifyProps}
        />
      </>
    );
  }

  return (
    <div className="alm">
      <aside className="alm-queue" aria-labelledby="alm-queue-title">
        <div className="alm-queue__head">
          <div className="alm-queue__title">
            <h2 id="alm-queue-title">{tr('Alarms and events', 'Alarmas y eventos')}</h2>
            <span>{scopeLabel}</span>
          </div>
          {tab === 'review' ? (
            <div className="alm-filters">
              <div className="field">
                <label htmlFor="alm-f-uc" className="alm-filters__label">
                  {tr('Use case', 'Caso de uso')}
                </label>
                <select id="alm-f-uc" className="select" value={ucFilter} onChange={(e) => setUcFilter(e.target.value)}>
                  <option value="all">{tr('All use cases', 'Todos los casos de uso')}</option>
                  {ucOptions.map((u) => (
                    <option key={u} value={u}>
                      {tx.ucName(useCaseById(u), u)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="alm-f-vessel" className="alm-filters__label">
                  {tr('Vessel', 'Embarcación')}
                </label>
                <select id="alm-f-vessel" className="select" value={vesselFilter} onChange={(e) => setVesselFilter(e.target.value)}>
                  <option value="all">{tr('All vessels', 'Todas las embarcaciones')}</option>
                  {vesselOptions.map((v) => (
                    <option key={v} value={v}>
                      {fleet.vesselById(v)?.name ?? v}
                    </option>
                  ))}
                </select>
              </div>
              <label className="check" style={{ gridColumn: '1 / -1' }}>
                <input type="checkbox" checked={hideReviewed} onChange={(e) => setHideReviewed(e.target.checked)} />
                {tr('Hide reviewed', 'Ocultar revisados')}
              </label>
              {lateCount > 0 && (
                <p className="alm-queue__late" style={{ gridColumn: '1 / -1' }}>
                  <Icon name="wifiOff" size={14} />
                  {tr(`${lateCount} arrived late from a convoy that was out of coverage`, `${lateCount} llegaron tarde de un convoy que estaba sin cobertura`)}
                </p>
              )}
            </div>
          ) : (
            <div className="alm-chips" role="group" aria-label={tr('Filter by priority', 'Filtrar por prioridad')}>
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="alm-chip"
                  aria-pressed={prio.has(p)}
                  title={tx.es ? PRIORITY_NAME_ES[p] : PRIORITY_NAME[p]}
                  onClick={() =>
                    setPrio((s) => {
                      const n = new Set(s);
                      if (n.has(p)) n.delete(p);
                      else n.add(p);
                      return n;
                    })
                  }
                >
                  {p} · {counts[p]}
                </button>
              ))}
            </div>
          )}
        </div>

        <div role="tablist" aria-label={tr('Queue', 'Cola')} className="tabs alm-qtabs">
          {(
            [
              ['open', tr('Open alarms', 'Alarmas abiertas'), openAll.length],
              ['review', tr('To review', 'Por revisar'), toReviewCount],
              ['closed', tr('Closed', 'Cerradas'), closedAll.length],
            ] as const
          ).map(([v, label, n]) => (
            <button key={v} type="button" role="tab" aria-selected={tab === v} onClick={() => goTab(v)}>
              {label}
              <span className="count">{n}</span>
            </button>
          ))}
        </div>

        <div className="alm-queue__body">
          {tab === 'open' && (
            <>
              {openList.length === 0 ? (
                <div className="empty">
                  {openAll.length ? tr('No open alarms match the priority filter.', 'Ninguna alarma abierta coincide con el filtro de prioridad.') : tr('No open alarms in this scope.', 'No hay alarmas abiertas en este alcance.')}
                </div>
              ) : (
                <ul className="alm-list">
                  {openList.map((a) => (
                    <li key={a.id}>
                      <QueueItem a={a} now={now} to={alarmLink(a)} current={a.id === selectedAlarm?.id} tx={tx} owner={ownerShort(a.owner)} paused={!state.simulation} />
                    </li>
                  ))}
                </ul>
              )}
              {closedToday.length > 0 && (
                <>
                  <div className="alm-section">{tr('Closed today', 'Cerradas hoy')}</div>
                  <ul className="alm-list alm-list--compact">
                    {closedToday.map((a) => (
                      <li key={a.id}>
                        <ClosedItem a={a} now={now} to={`/alarms/${a.id}`} current={a.id === selectedAlarm?.id} tx={tx} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}

          {tab === 'closed' &&
            (closedList.length === 0 ? (
              <div className="empty">{tr('No closed alarms match the filter.', 'Ninguna alarma cerrada coincide con el filtro.')}</div>
            ) : (
              <ul className="alm-list alm-list--compact">
                {closedList.map((a) => (
                  <li key={a.id}>
                    <ClosedItem a={a} now={now} to={alarmLink(a)} current={a.id === selectedAlarm?.id} tx={tx} />
                  </li>
                ))}
              </ul>
            ))}

          {tab === 'review' &&
            (reviewList.length === 0 ? (
              <div className="empty">{reviewScoped.length ? tr('No events match the filter.', 'Ningún evento coincide con el filtro.') : tr('No events in this scope yet.', 'Todavía no hay eventos en este alcance.')}</div>
            ) : (
              <ul className="alm-list">
                {reviewList.map((e) => (
                  <li key={e.id}>
                    <ReviewItem e={e} now={now} to={eventLink(e)} current={e.id === selectedEvent?.id} tx={tx} />
                  </li>
                ))}
              </ul>
            ))}
        </div>
      </aside>

      <div className="alm-main">
        <div className="alm-detail">{detail}</div>
        <div className="alm-keys">
          <Icon name="key" size={14} />
          <span>
            {tr('Keyboard:', 'Teclado:')} <kbd>A</kbd> {tr('accept', 'aceptar')} · <kbd>R</kbd> {tr('reject', 'rechazar')} · <kbd>F</kbd> {tr('false alert', 'falsa alerta')}, {tr('then', 'luego')}{' '}
            <kbd>1</kbd>–<kbd>4</kbd> {tr('reason', 'motivo')} · <kbd>J</kbd> {tr('next', 'siguiente')}
          </span>
          {!can('classify') && <span className="alm-keys__note">{tr('Your role can use J only', 'Su rol solo puede usar J')}</span>}
        </div>
      </div>
    </div>
  );
}

function QueueItem({ a, now, to, current, tx, owner, paused }: { a: Alarm; now: number; to: string; current: boolean; tx: AlarmText; owner: string; paused: boolean }) {
  const { tr, p, fleet } = tx;
  const esc = escalationOf(a, now);
  const convoy = fleet.convoyById(a.convoyId);
  const cam = fleet.cameraById(a.cameraId);
  const sent = a.escalatedTo?.length ?? 0;
  const sub = cam
    ? `${tx.where(a)} · ${fmtSmart(a.raisedAt, now)}${a.state === 'ack_board' ? tr(' · ack on board', ' · confirmada a bordo') : ''}`
    : `${tx.convoyLabel(a.convoyId)} · ${fmtSmart(a.raisedAt, now)}${convoy?.queuedEvents ? tr(` · ${convoy.queuedEvents} events queued`, ` · ${convoy.queuedEvents} eventos en cola`) : ''}`;
  return (
    <Link to={to} className="alm-item" aria-current={current ? 'true' : undefined}>
      <span className="alm-item__top">
        <PriorityBadge p={a.priority} />
        {esc ? (
          <span
            className="alm-item__countdown"
            aria-label={
              esc.left > 0
                ? tr(`Escalates to the ${(esc.to ?? '').toLowerCase()} in ${fmtCountdown(esc.left)}`, `Se escala ${tx.roleTo(esc.to ?? '')} en ${fmtCountdown(esc.left)}`)
                : tr('Escalation due', 'Escalamiento vencido')
            }
          >
            <Icon name="clock" size={13} strokeWidth={2.4} />
            {esc.left > 0 ? fmtCountdown(esc.left) : paused ? tr('Due', 'Vencida') : tr('Escalating', 'Escalando')}
          </span>
        ) : (
          <span className="alm-item__state">
            {tx.phrase(a.stateLabel ?? p(STATE_SHORT[a.state]))}
            {owner && ` · ${owner}`}
          </span>
        )}
      </span>
      <span className="alm-item__title">{tx.title(a)}</span>
      <span className="alm-item__sub">{sub}</span>
      {sent > 1 && a.state !== 'closed' && (
        <span className="alm-item__sub alm-item__esc">
          {tr(`Escalated · ${sent} messaged`, `Escalada · ${sent} avisados`)}
        </span>
      )}
    </Link>
  );
}

function ClosedItem({ a, now, to, current, tx }: { a: Alarm; now: number; to: string; current: boolean; tx: AlarmText }) {
  const { tr } = tx;
  const where = a.vesselId ? tx.vesselShort(a.vesselId) : tx.convoyLabel(a.convoyId);
  const response = a.response ? tx.phrase(a.response) : undefined;
  const responseText = response ? response[0].toLowerCase() + response.slice(1) : undefined;
  const outcome = [a.classification ? tx.classText(a.classification) : tr('closed', 'cerrada'), responseText].filter(Boolean).join(', ');
  return (
    <Link to={to} className="alm-closed" aria-current={current ? 'true' : undefined}>
      <span className="alm-closed__p">{a.priority}</span>
      <span className="alm-closed__body">
        <span className="alm-closed__title">{tx.title(a)}</span>
        <span className="alm-closed__sub">
          {where} · {fmtDay(a.raisedAt) === fmtDay(now) ? fmtTime(a.raisedAt) : fmtSmart(a.raisedAt, now)} · {outcome}
        </span>
      </span>
    </Link>
  );
}

function ReviewItem({ e, now, to, current, tx }: { e: ReviewEvent; now: number; to: string; current: boolean; tx: AlarmText }) {
  const { tr, fleet } = tx;
  const cam = fleet.cameraById(e.cameraId);
  const uc = useCaseById(e.useCaseId);
  return (
    <Link to={to} className={`alm-rev${e.classification ? ' is-reviewed' : ''}`} aria-current={current ? 'true' : undefined}>
      {cam && <img className="alm-rev__thumb" src={cam.image} alt="" />}
      <span className="alm-rev__body">
        <span className="alm-rev__title">{tx.ucName(uc, e.useCaseId)}</span>
        <span className="alm-rev__sub">
          {tx.vesselShort(e.vesselId)} · {cam?.name} · {e.queued ? tr(`on board ${fmtSmart(e.at, now)}`, `a bordo ${fmtSmart(e.at, now)}`) : fmtSmart(e.at, now)}
        </span>
        <span className="alm-rev__tags">
          <span className="mono">{e.confidence.toFixed(2)}</span>
          {e.queued && <Badge tone="warn">{tr('Arrived late · stored on board', 'Llegó tarde · guardado a bordo')}</Badge>}
          {e.shadow && <Badge tone="info">{tr('Shadow run', 'Ejecución en sombra')}</Badge>}
          {e.classification && <Badge tone={e.classification === 'false_alert' ? 'bad' : 'ok'}>{tx.classText(e.classification)}</Badge>}
        </span>
      </span>
    </Link>
  );
}

function EmptyDetail({ title, text, tx }: { title: string; text: string; tx: AlarmText }) {
  return (
    <div className="card">
      <div className="empty">
        <Icon name="bell" size={28} />
        <p style={{ marginTop: 8, fontWeight: 600, color: 'var(--ink)' }}>{title}</p>
        <p>{text}</p>
        <p style={{ marginTop: 12 }}>
          <Link to="/alarms" className="btn btn--sm">
            {tx.tr('Back to open alarms', 'Volver a las alarmas abiertas')}
          </Link>
        </p>
      </div>
    </div>
  );
}
