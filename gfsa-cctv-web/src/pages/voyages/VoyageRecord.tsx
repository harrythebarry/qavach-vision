import { useCallback, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { roles } from '../../data/users';
import type { AuditEntry } from '../../data/types';
import { Badge, Card, PriorityBadge, Segmented, Stat, StatusDot, Tabs, usePriorityName } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useApp, useInScope } from '../../state/AppState';
import { useFleet } from '../../state/fleetStore';
import { useUsers } from '../../state/usersStore';
import { useExporter } from '../../lib/exporting';
import { useLang, useTr } from '../../lib/i18n';
import { uid } from '../../lib/persist';
import { slug } from '../../lib/download';
import { fmtDayTime, fmtDuration, fmtTime, useNow } from '../../lib/time';
import { RoundMark, VoyageTimeline, type TimelineAlarm } from './VoyageTimeline';
import { ConnectDrawer } from './ConnectDrawer';
import { callSentAt, cargoSentAt, connectRef, lastRead, lastWrite, outboxRows, sentFor, useConnectOutbox, type OutboxRow, type SentItem } from './connect';
import { buildVoyageReport, reportFilename } from './voyageReport';
import { buildAlarmRows, type AlarmRow } from './voyageView';
import {
  MIN,
  MISSED_AFTER_MIN,
  ROUND_EVERY_H,
  ROUND_LABEL,
  SNAPSHOT,
  SYNC_EVERY_MIN,
  TOLERANCE_MIN,
  allVoyageRecords,
  callLabel,
  diffText,
  exceptionSummary,
  fmtDelta,
  fmtRoundTime,
  lastSync,
  liveVoyage,
  nextCallText,
  positionText,
  roundStats,
  roundsFor,
  routeText,
  statusText,
  useCaseName,
  vesselName,
  voyageRecord,
  type CargoCheck,
  type EventStatus,
  type LiveVoyage,
  type Round,
  type Tr,
  type VoyageEvent,
  type VoyageRecord,
} from './voyageData';
import './Voyages.css';

type Tab = 'overview' | 'events' | 'alarms' | 'rounds' | 'cargo' | 'audit';
const TABS: Tab[] = ['overview', 'events', 'alarms', 'rounds', 'cargo', 'audit'];
const TAB_LABEL: Record<Tab, [string, string]> = {
  overview: ['Overview', 'Resumen'],
  events: ['Events', 'Eventos'],
  alarms: ['Alarms', 'Alarmas'],
  rounds: ['Reefer rounds', 'Rondas de reefers'],
  cargo: ['Cargo checks', 'Control de carga'],
  audit: ['Audit log', 'Registro de auditoría'],
};

const isoAt = (ms: number) => new Date(ms).toISOString();

export function VoyageRecordPage() {
  const { id } = useParams();
  const rec = voyageRecord(id);
  return (
    <div className="voy-layout">
      <VoyageSideList currentId={id} />
      {rec ? <RecordBody key={rec.voyage.id} rec={rec} /> : <NotFound id={id} />}
    </div>
  );
}

function Crumbs({ id }: { id?: string }) {
  const tr = useTr();
  return (
    <nav aria-label={tr('Breadcrumb', 'Ruta de navegación')} className="breadcrumb">
      <Link to="/">{tr('Operations', 'Operaciones')}</Link> / <Link to="/voyages">{tr('Voyages', 'Viajes')}</Link> / <span className="mono">{id}</span>
    </nav>
  );
}

function NotFound({ id }: { id?: string }) {
  const tr = useTr();
  return (
    <div className="page voy-page">
      <Crumbs id={id} />
      <div className="card">
        <div className="empty">
          <Icon name="route" size={28} />
          <p style={{ marginTop: 8, fontWeight: 600, color: 'var(--ink)' }}>{tr(`Voyage ${id} is not in Connect`, `El viaje ${id} no está en Connect`)}</p>
          <p>{tr('It may have been renumbered or belong to another tenant.', 'Puede haber cambiado de número o pertenecer a otro inquilino.')}</p>
          <p style={{ marginTop: 12 }}>
            <Link to="/voyages" className="btn">
              {tr('All voyages', 'Todos los viajes')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

/** Everything the record shows, live. */
function useVoyageView(rec: VoyageRecord, now: number) {
  const { state } = useApp();
  const tr = useTr();
  const lang = useLang();
  const fleet = useFleet();
  const users = useUsers();
  const [sent] = useConnectOutbox();
  const convoy = fleet.convoyById(rec.voyage.convoyId);
  const live = useMemo(
    () => liveVoyage(rec, { convoy, alarms: state.alarms, reviewEvents: state.reviewEvents, audit: state.audit, now }),
    [rec, convoy, state.alarms, state.reviewEvents, state.audit, now],
  );
  const rows = useMemo(() => buildAlarmRows(rec, live, now, fleet, users, lang, tr), [rec, live, now, fleet, users, lang, tr]);
  const rounds = useMemo(() => roundsFor(rec, now, live.queuedAfter), [rec, now, live.queuedAfter]);
  const cargoSent = useMemo(() => cargoSentAt(rec.cargo, sent.filter((s) => s.voyageId === rec.voyage.id)), [rec, sent]);
  const callSent = useMemo(() => callSentAt(rec.calls, sent.filter((s) => s.voyageId === rec.voyage.id)), [rec, sent]);
  const outbox = useMemo(() => outboxRows(rec, live, rounds, sent, now, lang, tr), [rec, live, rounds, sent, now, lang, tr]);
  return { live, rows, rounds, cargoSent, callSent, outbox, fleet };
}

function RecordBody({ rec }: { rec: VoyageRecord }) {
  const { state, log, toast } = useApp();
  const tr = useTr();
  const lang = useLang();
  const inScope = useInScope();
  const ex = useExporter();
  const prioName = usePriorityName();
  const now = useNow(1000);
  const [, setSent] = useConnectOutbox();
  const [params, setParams] = useSearchParams();
  const [connectOpen, setConnectOpen] = useState(false);
  const closeConnect = useCallback(() => setConnectOpen(false), []);
  const v = rec.voyage;
  const { live, rows, rounds, cargoSent, callSent, outbox, fleet } = useVoyageView(rec, now);

  const tabParam = params.get('tab') as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : 'overview';
  const bargeParam = params.get('barge');
  const reeferBarges = rec.roundSpecs.map((r) => r.bargeId);
  const barge = bargeParam && reeferBarges.includes(bargeParam) ? bargeParam : (reeferBarges[0] ?? '');
  const setTab = (t: Tab, extra: Record<string, string> = {}) => {
    const next = new URLSearchParams(params);
    if (t === 'overview') next.delete('tab');
    else next.set('tab', t);
    Object.entries(extra).forEach(([k, val]) => next.set(k, val));
    setParams(next, { replace: true });
  };
  const setBarge = (b: string) => {
    const next = new URLSearchParams(params);
    next.set('barge', b);
    setParams(next, { replace: true });
  };

  const openRows = rows.filter((r) => r.open);
  const openByP = (['P1', 'P2', 'P3', 'P4'] as const).map((p) => ({ p, n: openRows.filter((r) => r.priority === p).length })).filter((x) => x.n);
  const topOpen = openByP[0]?.p;
  const rs = roundStats(rounds);
  const diffs = rec.cargo.reduce((n, c) => n + c.differences.length, 0);
  const portActual = rec.calls.filter((c) => c.actual);
  const lastPort = portActual.at(-1);
  const timelineAlarms: TimelineAlarm[] = rows.map((r) => ({ id: r.id, priority: r.priority, title: r.title, at: r.raisedAt, open: r.open, linkable: r.linkable }));
  const convoy = live.convoy;

  const bargeNames = rec.barges.map((b) => b.name);
  const list = bargeNames.length > 1 ? `${bargeNames.slice(0, -1).join(', ')} ${tr('and', 'y')} ${bargeNames.at(-1)}` : (bargeNames[0] ?? tr('no barges', 'sin barcazas'));
  const makeUp = tr(`${rec.tug?.name ?? convoy?.name ?? ''} pushing ${list}`, `${rec.tug?.name ?? convoy?.name ?? ''} empujando ${list}`);

  // ADM-02: masters see their own convoy only.
  if (state.role === 'master' && !inScope(v.convoyId)) {
    return (
      <div className="page voy-page">
        <Crumbs id={v.id} />
        <div className="card">
          <div className="empty">
            <Icon name="lock" size={28} />
            <p style={{ marginTop: 8, fontWeight: 600, color: 'var(--ink)' }}>{tr('This voyage belongs to another convoy', 'Este viaje pertenece a otro convoy')}</p>
            <p>{tr('Masters see the voyages of their own convoy only.', 'Los capitanes solo ven los viajes de su propio convoy.')}</p>
            <p style={{ marginTop: 12 }}>
              <Link to="/voyages" className="btn">
                {tr('Your voyages', 'Sus viajes')}
              </Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  const report = () => {
    const doc = buildVoyageReport({ rec, live, rows, rounds, outbox, cargoSent, callSent, now, lang, tr, fleet, prioName });
    ex.pdf(reportFilename(rec, doc.final, tr), doc, {
      action: 'Downloaded voyage report',
      target: v.id,
      details: doc.final ? 'Final report' : 'Draft while under way',
      convoyId: v.convoyId,
    });
  };

  const sendCargo = () => {
    const items = rec.cargo.flatMap((c) => c.differences.map((d) => ({ bargeId: c.bargeId, container: d.container, kind: d.kind })));
    if (!items.length) return;
    const id = uid('cx');
    const ref = connectRef(id);
    const item: SentItem = { id, voyageId: v.id, at: isoAt(now), kind: 'cargo', by: state.user.name, ref, diffs: items };
    setSent((prev) => [item, ...prev]);
    log('Sent cargo differences to Connect', v.id, `${items.length} container${items.length === 1 ? '' : 's'} · ${items.map((d) => `${vesselName(d.bargeId)} ${d.container}`).join(', ')} · ${ref}`, v.convoyId, 'system');
    toast(
      tr(
        `${items.length} container difference${items.length === 1 ? '' : 's'} sent to Connect for ${v.id} (${ref}). They show in the Connect panel.`,
        `${items.length} diferencia${items.length === 1 ? '' : 's'} de contenedores enviada${items.length === 1 ? '' : 's'} a Connect para ${v.id} (${ref}). Aparece${items.length === 1 ? '' : 'n'} en el panel de Connect.`,
      ),
    );
  };

  const sendPortTimes = () => {
    const calls = rec.calls.filter((c) => c.actual).map((c) => ({ port: c.port, kind: c.kind, scheduled: c.scheduled, actual: c.actual! }));
    if (!calls.length) return;
    const id = uid('cx');
    const ref = connectRef(id);
    const item: SentItem = { id, voyageId: v.id, at: isoAt(now), kind: 'port_times', by: state.user.name, ref, calls };
    setSent((prev) => [item, ...prev]);
    log('Sent port times to Connect', v.id, `${calls.map((c) => `${c.port} ${c.kind} ${fmtTime(c.actual)}`).join(', ')} · ${ref}`, v.convoyId, 'system');
    toast(
      tr(
        `${calls.length} port time${calls.length === 1 ? '' : 's'} from video sent to Connect for ${v.id} (${ref}).`,
        `${calls.length} hora${calls.length === 1 ? '' : 's'} de puerto del video enviada${calls.length === 1 ? '' : 's'} a Connect para ${v.id} (${ref}).`,
      ),
    );
  };

  const openConnect = () => {
    setConnectOpen(true);
    log('Viewed Connect record', v.id, 'In Connect panel on the voyage record', v.convoyId);
  };

  return (
    <div className="page voy-page">
      <div className="page-head">
        <div className="page-head__text">
          <Crumbs id={v.id} />
          <h1 className="page-title">
            <span className="mono">{v.id}</span> · {routeText(v.route, tr)}
          </h1>
          <div className="voy-badges">
            <Badge tone={v.status === 'completed' ? 'neutral' : 'info'}>{statusText(rec, live, now, tr)}</Badge>
            <span className="badge badge--ok">
              <span className="dot" aria-hidden="true" />
              {tr(`Synced with Connect ${fmtTime(lastSync(now))}`, `Sincronizado con Connect ${fmtTime(lastSync(now))}`)}
            </span>
            {live.offline && (
              <span className="badge badge--warn">
                {tr(
                  `No link since ${fmtTime(live.queuedAfter!)} · ${live.queuedEvents} events queued`,
                  `Sin enlace desde las ${fmtTime(live.queuedAfter!)} · ${live.queuedEvents} eventos en cola`,
                )}
              </span>
            )}
            {!live.offline && live.current && live.reconnectedAt && live.arrivedLate > 0 && (
              <Badge tone="outline">
                {tr(
                  `Back in coverage ${fmtTime(live.reconnectedAt)} · ${live.arrivedLate} queued events arrived`,
                  `De nuevo con cobertura ${fmtTime(live.reconnectedAt)} · llegaron ${live.arrivedLate} eventos en cola`,
                )}
              </Badge>
            )}
            {topOpen && (
              <span className={`badge badge--${topOpen.toLowerCase()}`}>{tr(`${topOpen} alarm open`, `Alarma ${topOpen} abierta`)}</span>
            )}
            {rec.reportSentAt && <Badge tone="outline">{tr(`Report sent ${fmtDayTime(rec.reportSentAt)}`, `Informe enviado ${fmtDayTime(rec.reportSentAt)}`)}</Badge>}
            {!inScope(v.convoyId) && <Badge tone="outline">{tr('Outside your convoy scope', 'Fuera de su alcance de convoy')}</Badge>}
          </div>
          <p className="page-sub">
            {makeUp} · {tr(`left ${rec.departurePort} ${fmtDayTime(rec.departure)}`, `salió de ${rec.departurePort} ${fmtDayTime(rec.departure)}`)} · {nextCallText(rec, tr)}
          </p>
        </div>
        <div className="page-head__actions voy-head-actions">
          <button type="button" className="btn" aria-haspopup="dialog" onClick={openConnect}>
            <Icon name="layers" size={16} strokeWidth={2} /> {tr('Open in Connect', 'Abrir en Connect')}
          </button>
          <button type="button" className="btn" onClick={report}>
            <Icon name="download" size={16} strokeWidth={2} /> {tr('Voyage report', 'Informe de viaje')}
          </button>
          <Link to={`/video-wall?convoy=${v.convoyId}`} className="btn btn--primary">
            <Icon name="grid" size={16} strokeWidth={2} /> {tr('Watch convoy', 'Ver convoy')}
          </Link>
        </div>
      </div>

      <Tabs<Tab>
        label={tr('Voyage', 'Viaje')}
        value={tab}
        onChange={(t) => setTab(t)}
        tabs={[
          { value: 'overview', label: tr(...TAB_LABEL.overview) },
          { value: 'events', label: tr(...TAB_LABEL.events), count: live.events.length },
          { value: 'alarms', label: tr(...TAB_LABEL.alarms), count: rows.length },
          { value: 'rounds', label: tr(...TAB_LABEL.rounds) },
          { value: 'cargo', label: tr(...TAB_LABEL.cargo) },
          { value: 'audit', label: tr(...TAB_LABEL.audit) },
        ]}
      />

      <div role="tabpanel" aria-label={tr(...TAB_LABEL[tab])} className="voy-panel">
        {tab === 'overview' && (
          <>
            <div className="stat-grid voy-stats">
              <Stat
                label={tr('Events on this voyage', 'Eventos en este viaje')}
                value={live.events.length}
                foot={[
                  tr(`${live.toReview} waiting for review`, `${live.toReview} pendientes de revisión`),
                  live.offline ? tr(`+${live.queuedEvents} queued on board`, `+${live.queuedEvents} en cola a bordo`) : '',
                  live.arrivedLate ? tr(`${live.arrivedLate} arrived late`, `${live.arrivedLate} llegaron tarde`) : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
              <Stat
                label={tr('Alarms', 'Alarmas')}
                value={rows.length}
                aside={`${tr(`${openRows.length} open`, `${openRows.length} abiertas`)}${openByP.map((x) => ` · ${x.n} ${x.p}`).join('')}`}
              >
                {openRows.length > 0 && (
                  <span aria-hidden="true" className="voy-prio-bar">
                    {openByP.map((x) => (
                      <span key={x.p} style={{ flex: x.n }} className={`voy-prio-bar__${x.p.toLowerCase()}`} />
                    ))}
                  </span>
                )}
              </Stat>
              <Stat
                label={tr('Reefer rounds on time', 'Rondas de reefers a tiempo')}
                value={tr(`${rs.onTime} of ${rs.judged}`, `${rs.onTime} de ${rs.judged}`)}
                foot={exceptionSummary(rs, tr)}
              />
              <Stat
                label={tr('Cargo list check', 'Control de la lista de carga')}
                value={diffs ? tr(`${diffs} difference${diffs === 1 ? '' : 's'}`, `${diffs} diferencia${diffs === 1 ? '' : 's'}`) : tr('Match', 'Coincide')}
                foot={
                  diffs
                    ? `${rec.cargo
                        .filter((c) => c.differences.length)
                        .map((c) => vesselName(c.bargeId))
                        .join(', ')} · ${rec.cargo.some((c) => c.differences.length && cargoSent[c.bargeId]) ? tr('sent to Connect', 'enviada a Connect') : tr('not sent yet', 'aún no enviada')}`
                    : tr('Every barge matches its cargo list', 'Todas las barcazas coinciden con su lista de carga')
                }
              />
              <Stat
                label={tr('Port times from video', 'Horas de puerto del video')}
                value={tr(`${portActual.length} of ${rec.calls.length}`, `${portActual.length} de ${rec.calls.length}`)}
                foot={
                  lastPort?.actual
                    ? `${lastPort.port} ${callLabel(lastPort, tr).toLowerCase()} ${fmtDelta(lastPort.actual - lastPort.scheduled, tr)}`
                    : tr('None yet', 'Ninguna todavía')
                }
              />
            </div>

            <VoyageTimeline
              rec={rec}
              rounds={rounds}
              alarms={timelineAlarms}
              events={live.events}
              link={live.link}
              reconnectedAt={live.reconnectedAt}
              callSent={(i) => sentFor(callSent, rec.calls[i])}
              now={now}
            />

            <div className="row">
              <div className="grow stack">
                <Card
                  id="alm"
                  title={tr('Alarms on this voyage', 'Alarmas de este viaje')}
                  hint={tr(`${openRows.length} open · latest first`, `${openRows.length} abiertas · más recientes primero`)}
                  action={
                    <Link to="/alarms" className="card__link">
                      {tr('Open alarm console', 'Abrir consola de alarmas')}
                    </Link>
                  }
                  bodyClass="table-wrap"
                >
                  <AlarmTable rows={rows} />
                </Card>
                <RoundExceptions rounds={rounds} barges={reeferBarges} barge={barge} setBarge={setBarge} now={now} openRows={openRows} onAll={() => setTab('rounds', { barge })} />
              </div>

              <aside className="voy-aside" aria-label={tr('Checks and Connect', 'Controles y Connect')}>
                <Card id="cargo" title={tr('Containers against the cargo list', 'Contenedores contra la lista de carga')} bodyClass="voy-aside-body">
                  {rec.cargo.length ? (
                    <CargoTable cargo={rec.cargo} sentAt={cargoSent} compact />
                  ) : (
                    <p className="voy-note">{tr('Connect has not sent cargo lists for this voyage.', 'Connect no envió listas de carga para este viaje.')}</p>
                  )}
                  <p className="voy-note">
                    {tr('Counted from the deck cameras at departure.', 'Contados con las cámaras de cubierta a la salida.')}{' '}
                    {diffs
                      ? tr('The difference is on the voyage record in Connect.', 'La diferencia está en el registro del viaje en Connect.')
                      : tr('Counts match the cargo lists in Connect.', 'Los conteos coinciden con las listas de carga de Connect.')}
                  </p>
                  {diffs > 0 && (
                    <button type="button" className="btn btn--sm" onClick={() => setTab('cargo')}>
                      {tr('Review and send differences', 'Revisar y enviar diferencias')}
                    </button>
                  )}
                </Card>

                <PortTimesCard rec={rec} callSent={callSent} outbox={outbox} onSend={sendPortTimes} />

                <ConnectSync rec={rec} live={live} now={now} rounds={rounds} diffs={diffs} outbox={outbox} onReport={report} onOpen={openConnect} />
              </aside>
            </div>
          </>
        )}

        {tab === 'events' && <EventsTab rec={rec} live={live} />}
        {tab === 'alarms' && <AlarmsTab rows={rows} />}
        {tab === 'rounds' && <RoundsTab rec={rec} rounds={rounds} barges={reeferBarges} barge={barge} setBarge={setBarge} openRows={openRows} />}
        {tab === 'cargo' && <CargoTab rec={rec} cargoSent={cargoSent} diffs={diffs} outbox={outbox} onSend={sendCargo} />}
        {tab === 'audit' && <AuditTab rec={rec} live={live} rows={rows} rounds={rounds} />}
      </div>

      {connectOpen && (
        <ConnectDrawer rec={rec} live={live} rounds={rounds} outbox={outbox} cargoSent={cargoSent} callSent={callSent} now={now} onClose={closeConnect} />
      )}
    </div>
  );
}

// ---------- Side list ----------

function VoyageSideList({ currentId }: { currentId?: string }) {
  const { state } = useApp();
  const tr = useTr();
  const fleet = useFleet();
  const inScope = useInScope();
  const now = useNow(30_000);
  const [q, setQ] = useState('');
  const scoped = allVoyageRecords().filter((r) => inScope(r.voyage.convoyId));
  const needle = q.trim().toLowerCase();
  const shown = scoped.filter((r) => {
    if (!needle) return true;
    const c = fleet.convoyById(r.voyage.convoyId);
    return `${r.voyage.id} ${r.voyage.route} ${routeText(r.voyage.route, tr)} ${c?.name ?? ''}`.toLowerCase().includes(needle);
  });
  const n = (s: string) => scoped.filter((r) => r.voyage.status === s).length;
  const groups = [
    { status: 'under_way', label: tr('Under way', 'Navegando') },
    { status: 'in_port', label: tr('In port', 'En puerto') },
    { status: 'completed', label: tr('Completed', 'Completados') },
  ] as const;

  return (
    <aside className="voy-side" aria-labelledby="voy-side-title">
      <div className="voy-side__head">
        <div>
          <h2 id="voy-side-title">{tr('Voyages', 'Viajes')}</h2>
          <span>{tr(`From Connect · ${n('under_way')} under way, ${n('in_port')} in port`, `Desde Connect · ${n('under_way')} navegando, ${n('in_port')} en puerto`)}</span>
        </div>
        <label className="voy-search">
          <Icon name="search" size={15} strokeWidth={2} />
          <span className="sr-only">{tr('Filter voyages', 'Filtrar viajes')}</span>
          <input type="search" placeholder={tr('Filter voyages', 'Filtrar viajes')} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <nav className="voy-side__list" aria-label={tr('Voyages', 'Viajes')}>
        {groups.map((g) => {
          const items = shown.filter((r) => r.voyage.status === g.status);
          if (!items.length) return null;
          return (
            <div key={g.status} className="voy-side__group">
              <span className="voy-side__group-label">{g.label}</span>
              {items.map((rec) => {
                const v = rec.voyage;
                const c = fleet.convoyById(v.convoyId);
                const lv = liveVoyage(rec, { convoy: c, alarms: state.alarms, reviewEvents: [], audit: state.audit, now });
                const top = lv.alarms.filter((a) => a.state !== 'closed').map((a) => a.priority).sort()[0];
                const day = Math.min(rec.plannedDays, Math.floor((now - rec.departure) / 86_400_000) + 1);
                const current = v.id === currentId;
                return (
                  <Link key={v.id} to={`/voyages/${v.id}`} aria-current={current ? 'page' : undefined} className="voy-side__item">
                    <span className="voy-side__top">
                      <span className="mono voy-strong">{v.id}</span>
                      {top && <span className={`badge badge--${top.toLowerCase()} voy-side__badge`}>{tr(`${top} open`, `${top} abierta`)}</span>}
                    </span>
                    <span className={current ? 'voy-strong' : undefined}>
                      {c?.name} · {v.status === 'in_port' ? (rec.calls.find((x) => !x.actual)?.port ?? routeText(v.route, tr)) : routeText(v.route, tr)}
                    </span>
                    <span className="voy-side__meta">
                      {v.status === 'completed' ? (
                        `${statusText(rec, lv, now, tr)} · ${tr('report sent', 'informe enviado')}`
                      ) : (
                        <>
                          <span className={lv.offline ? 'dot dot--off' : 'dot'} aria-hidden="true" />
                          {v.status === 'in_port'
                            ? `${tr('Cargo operations', 'Operaciones de carga')} · ${c?.linkLabel ?? ''}`
                            : lv.offline
                              ? tr(
                                  `Day ${day} · no link ${fmtDuration(now - lv.queuedAfter!)} · ${lv.queuedEvents} queued`,
                                  `Día ${day} · sin enlace ${fmtDuration(now - lv.queuedAfter!)} · ${lv.queuedEvents} en cola`,
                                )
                              : tr(`Day ${day} · ${positionText(c?.positionLabel, tr, true)} · ${c?.linkLabel ?? ''}`, `Día ${day} · ${positionText(c?.positionLabel, tr, true)} · ${c?.linkLabel ?? ''}`)}
                        </>
                      )}
                    </span>
                  </Link>
                );
              })}
            </div>
          );
        })}
        {!shown.length && <p className="empty">{tr('No voyages match.', 'Ningún viaje coincide.')}</p>}
      </nav>
    </aside>
  );
}

// ---------- Alarms ----------

function AlarmTable({ rows, full = false }: { rows: AlarmRow[]; full?: boolean }) {
  const tr = useTr();
  if (!rows.length) return <div className="empty">{tr('No alarms on this voyage.', 'No hay alarmas en este viaje.')}</div>;
  return (
    <table className="table" style={{ minWidth: full ? 760 : 620 }}>
      <thead>
        <tr>
          <th scope="col">{tr('Priority', 'Prioridad')}</th>
          <th scope="col">{tr('Alarm', 'Alarma')}</th>
          <th scope="col">{tr('Raised', 'Generada')}</th>
          <th scope="col">{tr('State', 'Estado')}</th>
          {full && <th scope="col">{tr('Owner', 'Responsable')}</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className={r.open && r.priority <= 'P2' ? 'is-alert' : undefined}>
            <td>
              <PriorityBadge p={r.priority} />
            </td>
            <td>
              {r.linkable ? (
                <Link to={`/alarms/${r.id}`} className="strong-link">
                  {r.title}
                </Link>
              ) : (
                <span className="strong-link">{r.title}</span>
              )}
              <span className="sub">
                <span className="mono">{r.id}</span> · {r.where}
                {r.archived && tr(' · archived with the voyage', ' · archivada con el viaje')}
                {r.arrived && tr(' · new since you opened the console', ' · nueva desde que abrió la consola')}
              </span>
            </td>
            <td className="voy-nowrap">{fmtDayTime(r.raisedAt)}</td>
            <td style={r.open ? undefined : { color: 'var(--muted)' }}>
              {r.open ? (
                r.stateText
              ) : (
                <span className="with-dot">
                  <Icon name="check" size={14} strokeWidth={2.2} /> {r.stateText}
                </span>
              )}
              {r.stateSub && <span className={`sub${r.subTone === 'bad' ? ' voy-sub-bad' : ''}`}>{r.stateSub}</span>}
            </td>
            {full && <td style={{ color: r.owner ? undefined : 'var(--muted)' }}>{r.owner ?? (r.open ? tr('Unassigned', 'Sin asignar') : '—')}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AlarmsTab({ rows }: { rows: AlarmRow[] }) {
  const tr = useTr();
  const [f, setF] = useState<'all' | 'open' | 'closed'>('all');
  const shown = rows.filter((r) => (f === 'all' ? true : f === 'open' ? r.open : !r.open));
  const open = rows.filter((r) => r.open).length;
  return (
    <Card
      id="alarms-tab"
      title={tr('Alarms on this voyage', 'Alarmas de este viaje')}
      hint={tr(`${open} open · ${rows.length - open} closed · latest first`, `${open} abiertas · ${rows.length - open} cerradas · más recientes primero`)}
      action={
        <Segmented
          label={tr('Alarm state', 'Estado de la alarma')}
          value={f}
          onChange={setF}
          options={[
            { value: 'all', label: tr(`All ${rows.length}`, `Todas ${rows.length}`) },
            { value: 'open', label: tr(`Open ${open}`, `Abiertas ${open}`) },
            { value: 'closed', label: tr(`Closed ${rows.length - open}`, `Cerradas ${rows.length - open}`) },
          ]}
        />
      }
      bodyClass="table-wrap"
    >
      {shown.length ? (
        <AlarmTable rows={shown} full />
      ) : (
        <div className="empty">{f === 'open' ? tr('No open alarms on this voyage.', 'No hay alarmas abiertas en este viaje.') : tr('No closed alarms on this voyage.', 'No hay alarmas cerradas en este viaje.')}</div>
      )}
    </Card>
  );
}

// ---------- Reefer rounds ----------

function ResultBadge({ r, openRows }: { r: Round; openRows: AlarmRow[] }) {
  const tr = useTr();
  const alarmOpen = openRows.some(
    (a) => a.useCaseId === 'reefer-rounds' && a.vesselId === r.bargeId && Math.abs(a.raisedAt - (r.scheduled + TOLERANCE_MIN * MIN)) < MIN,
  );
  switch (r.result) {
    case 'overdue':
      return (
        <span className="badge badge--warn">
          <Icon name="clock" size={13} strokeWidth={2.2} /> {tr(`Overdue ${r.minutes} min`, `Vencida ${r.minutes} min`)}
          {alarmOpen ? tr(' · alarm open', ' · alarma abierta') : ''}
        </span>
      );
    case 'missed':
      return (
        <span className="badge voy-badge-missed">
          <Icon name="x" size={13} strokeWidth={2.4} /> {tr('Missed · sent to Connect', 'Perdida · enviada a Connect')}
        </span>
      );
    case 'late':
      return (
        <span className="badge badge--warn">
          <Icon name="alert" size={13} strokeWidth={2.2} /> {tr(`Late ${r.minutes} min`, `Tarde ${r.minutes} min`)}
        </span>
      );
    case 'queued':
      return <Badge>{tr('Queued on board', 'En cola a bordo')}</Badge>;
    case 'due':
      return <Badge tone="outline">{tr('Due', 'Pendiente')}</Badge>;
    default:
      return (
        <span className="voy-ok">
          <Icon name="check" size={14} strokeWidth={2.4} /> {tr('On time', 'A tiempo')}
        </span>
      );
  }
}

const seenText = (r: Round, tr: Tr) =>
  r.seen
    ? fmtTime(r.seen)
    : r.result === 'overdue'
      ? tr('Not yet', 'Todavía no')
      : r.result === 'missed'
        ? tr('Not seen', 'No vista')
        : r.result === 'queued'
          ? tr('Queued on board', 'En cola a bordo')
          : '—';

const EXCEPTIONS = ['late', 'missed', 'overdue', 'queued'];

function RoundExceptions({
  rounds,
  barges,
  barge,
  setBarge,
  now,
  openRows,
  onAll,
}: {
  rounds: Round[];
  barges: string[];
  barge: string;
  setBarge: (b: string) => void;
  now: number;
  openRows: AlarmRow[];
  onAll: () => void;
}) {
  const tr = useTr();
  const fleet = useFleet();
  const mine = rounds.filter((r) => r.bargeId === barge);
  const past = mine.filter((r) => r.scheduled <= now);
  const ex = past.filter((r) => EXCEPTIONS.includes(r.result)).sort((a, b) => b.scheduled - a.scheduled);
  const onTime = past.filter((r) => r.result === 'on_time').length;
  return (
    <section className="card" aria-labelledby="rounds-title">
      <div className="card__head voy-card-head-wrap">
        <div className="card__title">
          <h2 id="rounds-title">{tr('Reefer round exceptions', 'Excepciones de rondas de reefers')}</h2>
          <span className="card__hint">{tr('Checked against the Connect schedule', 'Comparadas con el horario de Connect')}</span>
        </div>
        {barges.length > 1 && (
          <Segmented label={tr('Barge', 'Barcaza')} value={barge} onChange={setBarge} options={barges.map((b) => ({ value: b, label: vesselName(b) }))} />
        )}
      </div>
      {barges.length === 0 ? (
        <div className="empty">{tr('No reefer rounds are scheduled on this voyage.', 'No hay rondas de reefers programadas en este viaje.')}</div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table num" style={{ minWidth: 480 }}>
              <thead>
                <tr>
                  <th scope="col">{tr('Scheduled', 'Programada')}</th>
                  <th scope="col">{tr('Seen on video', 'Vista en video')}</th>
                  <th scope="col">{tr('Camera', 'Cámara')}</th>
                  <th scope="col">{tr('Result', 'Resultado')}</th>
                </tr>
              </thead>
              <tbody>
                {ex.map((r) => (
                  <tr key={r.key} className={r.result === 'overdue' ? 'voy-row-warn' : undefined}>
                    <td className="voy-nowrap">{fmtRoundTime(r.scheduled)}</td>
                    <td style={r.seen ? undefined : { color: 'var(--muted)' }}>{seenText(r, tr)}</td>
                    <td>{fleet.cameraById(r.cameraId)?.name ?? r.cameraId}</td>
                    <td>
                      <ResultBadge r={r} openRows={openRows} />
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={4} style={{ color: 'var(--muted)' }}>
                    <span className="with-dot">
                      <Icon name="check" size={14} strokeWidth={2.4} style={{ color: 'var(--ok-text)' }} />
                      {ex.length
                        ? tr(`The other ${onTime} rounds on ${vesselName(barge)} were on time`, `Las otras ${onTime} rondas de ${vesselName(barge)} fueron a tiempo`)
                        : tr(`All ${onTime} rounds on ${vesselName(barge)} were on time`, `Las ${onTime} rondas de ${vesselName(barge)} fueron a tiempo`)}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <button type="button" className="voy-card-foot" onClick={onAll}>
            {tr(`All ${past.length} rounds on ${vesselName(barge)}`, `Las ${past.length} rondas de ${vesselName(barge)}`)}
          </button>
        </>
      )}
    </section>
  );
}

function RoundsTab({
  rec,
  rounds,
  barges,
  barge,
  setBarge,
  openRows,
}: {
  rec: VoyageRecord;
  rounds: Round[];
  barges: string[];
  barge: string;
  setBarge: (b: string) => void;
  openRows: AlarmRow[];
}) {
  const tr = useTr();
  const fleet = useFleet();
  const [f, setF] = useState<'all' | 'exceptions' | 'upcoming'>('all');
  const mine = rounds.filter((r) => r.bargeId === barge);
  const s = roundStats(mine);
  const shown = mine
    .filter((r) => (f === 'all' ? true : f === 'exceptions' ? EXCEPTIONS.includes(r.result) : r.result === 'due'))
    .sort((a, b) => (f === 'upcoming' ? a.scheduled - b.scheduled : b.scheduled - a.scheduled));
  if (!barges.length)
    return (
      <Card title={tr('Reefer rounds', 'Rondas de reefers')}>
        <div className="empty">{tr('No reefer rounds are scheduled on this voyage.', 'No hay rondas de reefers programadas en este viaje.')}</div>
      </Card>
    );
  return (
    <div className="stack">
      <div className="voy-toolbar">
        <Segmented label={tr('Barge', 'Barcaza')} value={barge} onChange={setBarge} options={barges.map((b) => ({ value: b, label: vesselName(b) }))} />
        <Segmented
          label={tr('Rounds shown', 'Rondas mostradas')}
          value={f}
          onChange={setF}
          options={[
            { value: 'all', label: tr('All', 'Todas') },
            { value: 'exceptions', label: tr('Exceptions', 'Excepciones') },
            { value: 'upcoming', label: tr('Due', 'Pendientes') },
          ]}
        />
      </div>
      <div className="stat-grid">
        <Stat label={tr('On time', 'A tiempo')} value={tr(`${s.onTime} of ${s.judged}`, `${s.onTime} de ${s.judged}`)} foot={tr(`Within ${TOLERANCE_MIN} min of the schedule`, `Dentro de ${TOLERANCE_MIN} min del horario`)} />
        <Stat label={tr('Late', 'Tarde')} value={s.late} foot={tr('Seen after the tolerance', 'Vistas después de la tolerancia')} footTone={s.late ? 'bad' : undefined} />
        <Stat label={tr('Missed', 'Perdidas')} value={s.missed} foot={tr('Not seen within 1 hour · sent to Connect', 'No vistas en 1 hora · enviadas a Connect')} footTone={s.missed ? 'bad' : undefined} />
        <Stat
          label={tr('Overdue now', 'Vencidas ahora')}
          value={s.overdue + s.queued}
          foot={s.queued ? tr(`${s.queued} queued on board`, `${s.queued} en cola a bordo`) : tr(`Alarm raised after ${TOLERANCE_MIN} min`, `Alarma generada a los ${TOLERANCE_MIN} min`)}
        />
        <Stat label={tr('Still due', 'Pendientes')} value={s.due} foot={tr(`Every ${ROUND_EVERY_H} hours to ${rec.arrivalPort}`, `Cada ${ROUND_EVERY_H} horas hasta ${rec.arrivalPort}`)} />
      </div>
      <Card
        id="rounds-all"
        title={tr(`Reefer rounds on ${vesselName(barge)}`, `Rondas de reefers de ${vesselName(barge)}`)}
        hint={tr(`Schedule from Connect · ${fleet.cameraById(mine[0]?.cameraId)?.name ?? 'reefer row camera'}`, `Horario de Connect · ${fleet.cameraById(mine[0]?.cameraId)?.name ?? 'cámara de la fila de reefers'}`)}
        bodyClass="table-wrap"
      >
        {shown.length ? (
          <table className="table num" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th scope="col">{tr('Scheduled', 'Programada')}</th>
                <th scope="col">{tr('Seen on video', 'Vista en video')}</th>
                <th scope="col" className="right">
                  {tr('After schedule', 'Después del horario')}
                </th>
                <th scope="col">{tr('Result', 'Resultado')}</th>
                <th scope="col">Connect</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const sentAt = r.result === 'missed' ? r.scheduled + MISSED_AFTER_MIN * MIN : r.result === 'late' ? r.seen : undefined;
                return (
                  <tr key={r.key} className={r.result === 'overdue' ? 'voy-row-warn' : undefined}>
                    <td className="voy-nowrap">{fmtRoundTime(r.scheduled)}</td>
                    <td style={r.seen ? undefined : { color: 'var(--muted)' }}>{seenText(r, tr)}</td>
                    <td className="right">{r.seen ? `${Math.round((r.seen - r.scheduled) / MIN)} min` : '—'}</td>
                    <td>
                      <span className="with-dot">
                        <RoundMark result={r.result} size={12} />
                        <ResultBadge r={r} openRows={openRows} />
                      </span>
                    </td>
                    <td style={{ color: 'var(--muted)' }}>
                      {sentAt ? tr(`Sent ${fmtTime(sentAt)}`, `Enviada ${fmtTime(sentAt)}`) : r.result === 'on_time' ? tr('On record', 'En el registro') : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="empty">{tr('No rounds match this filter.', 'Ninguna ronda coincide con este filtro.')}</div>
        )}
      </Card>
      <p className="voy-note">
        {tr(
          `A round counts as on time when someone is seen in the reefer row within ${TOLERANCE_MIN} minutes of the Connect schedule. After ${TOLERANCE_MIN} minutes the round is overdue and raises a P3 alarm; after an hour it counts as missed and goes to Connect.`,
          `Una ronda cuenta como a tiempo cuando se ve a alguien en la fila de reefers dentro de ${TOLERANCE_MIN} minutos del horario de Connect. Después de ${TOLERANCE_MIN} minutos la ronda está vencida y genera una alarma P3; después de una hora cuenta como perdida y va a Connect.`,
        )}
      </p>
      <p className="voy-note">{tr(...ROUND_LABEL.queued)}: {tr('results wait on board while the convoy is out of coverage.', 'los resultados esperan a bordo mientras el convoy está sin cobertura.')}</p>
    </div>
  );
}

// ---------- Cargo ----------

function CargoTable({ cargo, sentAt, compact = false }: { cargo: CargoCheck[]; sentAt: Record<string, number | undefined>; compact?: boolean }) {
  const tr = useTr();
  const fleet = useFleet();
  return (
    <table className={compact ? 'voy-mini num' : 'table num'} style={compact ? undefined : { minWidth: 640 }}>
      <thead>
        <tr>
          <th scope="col">{tr('Barge', 'Barcaza')}</th>
          <th scope="col" className="right">
            {tr('List', 'Lista')}
          </th>
          <th scope="col" className="right">
            {tr('Counted', 'Contados')}
          </th>
          {!compact && <th scope="col">{tr('Counted at', 'Contados el')}</th>}
          <th scope="col">{tr('Result', 'Resultado')}</th>
          {!compact && <th scope="col">Connect</th>}
        </tr>
      </thead>
      <tbody>
        {cargo.map((c) => {
          const notSeen = c.differences.filter((d) => d.kind === 'not_seen').length;
          const notListed = c.differences.filter((d) => d.kind === 'not_listed').length;
          const sent = sentAt[c.bargeId];
          return (
            <tr key={c.bargeId}>
              <td>{vesselName(c.bargeId)}</td>
              <td className="right">{c.list}</td>
              <td className="right" style={c.differences.length ? { fontWeight: 600 } : undefined}>
                {c.counted}
              </td>
              {!compact && (
                <td className="voy-nowrap">
                  {fmtDayTime(c.countedAt)}
                  <span className="sub">
                    {c.port} · {fleet.cameraById(c.cameraId)?.name ?? c.cameraId}
                  </span>
                </td>
              )}
              <td>
                {c.differences.length ? (
                  <span className="voy-badges">
                    {notSeen > 0 && <Badge tone="warn">{tr(`${notSeen} not seen`, `${notSeen} no visto${notSeen === 1 ? '' : 's'}`)}</Badge>}
                    {notListed > 0 && <Badge tone="warn">{tr(`${notListed} not on list`, `${notListed} fuera de la lista`)}</Badge>}
                  </span>
                ) : (
                  <span className="voy-ok">
                    <Icon name="check" size={14} strokeWidth={2.4} /> {tr('Match', 'Coincide')}
                  </span>
                )}
              </td>
              {!compact && (
                <td style={{ color: 'var(--muted)' }}>
                  {c.differences.length ? (sent ? tr(`Sent ${fmtDayTime(sent)}`, `Enviada ${fmtDayTime(sent)}`) : tr('Not sent', 'No enviada')) : '—'}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function SendLog({ rows }: { rows: OutboxRow[] }) {
  const tr = useTr();
  if (!rows.length) return null;
  return (
    <ul className="voy-drawer__list voy-sendlog" aria-label={tr('Sent to Connect', 'Enviado a Connect')}>
      {rows.slice(0, 5).map((r) => (
        <li key={r.key}>
          <Icon name="send" size={14} />
          <span>
            {fmtDayTime(r.at)} · {r.by}
            {r.ref ? ` · ${r.ref}` : ''}
            {r.detail && <span className="sub">{r.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function CargoTab({
  rec,
  cargoSent,
  diffs,
  outbox,
  onSend,
}: {
  rec: VoyageRecord;
  cargoSent: Record<string, number | undefined>;
  diffs: number;
  outbox: OutboxRow[];
  onSend: () => void;
}) {
  const tr = useTr();
  const cargo = rec.cargo;
  const lastSent = Math.max(0, ...cargo.filter((c) => c.differences.length).map((c) => cargoSent[c.bargeId] ?? 0));
  const list = cargo.reduce((n, c) => n + c.list, 0);
  const counted = cargo.reduce((n, c) => n + c.counted, 0);
  const sends = outbox.filter((r) => r.kind === 'cargo');
  return (
    <div className="stack">
      <div className="stat-grid">
        <Stat
          label={tr('On the cargo lists', 'En las listas de carga')}
          value={list}
          foot={tr(`${cargo.length} barge${cargo.length === 1 ? '' : 's'} · from Connect`, `${cargo.length} barcaza${cargo.length === 1 ? '' : 's'} · desde Connect`)}
        />
        <Stat label={tr('Counted on video', 'Contados en video')} value={counted} foot={tr('Deck cameras at departure', 'Cámaras de cubierta a la salida')} />
        <Stat
          label={tr('Differences', 'Diferencias')}
          value={diffs}
          foot={
            diffs
              ? lastSent
                ? tr(`Last sent to Connect ${fmtDayTime(lastSent)}`, `Último envío a Connect ${fmtDayTime(lastSent)}`)
                : tr('Not sent yet', 'Aún no enviadas')
              : tr('None', 'Ninguna')
          }
          footTone={diffs ? 'bad' : 'ok'}
        />
      </div>
      <Card
        id="cargo-all"
        title={tr('Containers against the cargo list', 'Contenedores contra la lista de carga')}
        hint={tr('Per barge, counted at departure', 'Por barcaza, contados a la salida')}
        bodyClass="table-wrap"
      >
        {cargo.length ? (
          <CargoTable cargo={cargo} sentAt={cargoSent} />
        ) : (
          <div className="empty">{tr('Connect has not sent cargo lists for this voyage.', 'Connect no envió listas de carga para este viaje.')}</div>
        )}
      </Card>
      <Card
        id="cargo-diffs"
        title={tr('Differences', 'Diferencias')}
        hint={diffs ? tr('Each one goes to the voyage record in Connect', 'Cada una va al registro del viaje en Connect') : undefined}
        action={
          diffs > 0 ? (
            <button type="button" className="btn btn--primary btn--sm" onClick={onSend}>
              <Icon name="send" size={15} strokeWidth={2} /> {tr('Send differences to Connect', 'Enviar diferencias a Connect')}
            </button>
          ) : undefined
        }
        bodyClass="table-wrap"
      >
        {diffs ? (
          <table className="table" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th scope="col">{tr('Barge', 'Barcaza')}</th>
                <th scope="col">{tr('Container', 'Contenedor')}</th>
                <th scope="col">{tr('Difference', 'Diferencia')}</th>
                <th scope="col">{tr('Sent', 'Enviada')}</th>
              </tr>
            </thead>
            <tbody>
              {cargo.flatMap((c) =>
                c.differences.map((d) => (
                  <tr key={d.container}>
                    <td>{vesselName(c.bargeId)}</td>
                    <td className="mono">{d.container}</td>
                    <td>
                      {d.kind === 'not_seen' ? tr('Not seen', 'No visto') : tr('Not on the list', 'Fuera de la lista')}
                      <span className="sub">{diffText(d, tr)}</span>
                    </td>
                    <td className="voy-nowrap">{cargoSent[c.bargeId] ? fmtDayTime(cargoSent[c.bargeId]!) : <span className="voy-subtle">{tr('Not sent', 'No enviada')}</span>}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        ) : (
          <div className="empty">{tr('Nothing to send: every container counted matches the cargo list.', 'Nada que enviar: todos los contenedores contados coinciden con la lista de carga.')}</div>
        )}
        {sends.length > 0 && (
          <div className="card__body">
            <span className="voy-eyebrow">{tr('Sent to Connect', 'Enviado a Connect')}</span>
            <SendLog rows={sends} />
          </div>
        )}
      </Card>
      <p className="voy-note">
        {tr(
          `Counts come from the deck cameras on ${rec.barges.map((b) => b.short).join(' and ')} as the convoy leaves the berth. Containers that differ from the Connect cargo list go back to Connect so the terminal can check them.`,
          `Los conteos vienen de las cámaras de cubierta de ${rec.barges.map((b) => b.short).join(' y ')} cuando el convoy deja el muelle. Los contenedores que difieren de la lista de carga de Connect vuelven a Connect para que la terminal los verifique.`,
        )}
      </p>
    </div>
  );
}

// ---------- Port times ----------

function PortTimesCard({
  rec,
  callSent,
  outbox,
  onSend,
}: {
  rec: VoyageRecord;
  callSent: Record<string, number | undefined>;
  outbox: OutboxRow[];
  onSend: () => void;
}) {
  const tr = useTr();
  const actual = rec.calls.filter((c) => c.actual).length;
  const lastManual = outbox.find((r) => r.kind === 'port_times' && r.manual);
  return (
    <Card id="port" title={tr('Port times from video', 'Horas de puerto del video')} bodyClass="voy-aside-body">
      <table className="voy-mini num">
        <thead>
          <tr>
            <th scope="col">{tr('Call', 'Escala')}</th>
            <th scope="col">{tr('Schedule', 'Horario')}</th>
            <th scope="col">{tr('Video', 'Video')}</th>
          </tr>
        </thead>
        <tbody>
          {rec.calls.map((c, i) => {
            const sent = sentFor(callSent, c);
            return (
              <tr key={i}>
                <td>
                  {c.port}
                  <span className="sub">{callLabel(c, tr)}</span>
                </td>
                <td className="voy-nowrap">{fmtDayTime(c.scheduled)}</td>
                <td className="voy-nowrap">
                  {c.actual ? (
                    <>
                      <strong>
                        {fmtTime(c.actual)} · {fmtDelta(c.actual - c.scheduled, tr)}
                      </strong>
                      {sent && <span className="sub">{tr(`In Connect ${fmtDayTime(sent)}`, `En Connect ${fmtDayTime(sent)}`)}</span>}
                    </>
                  ) : (
                    <span className="voy-subtle">{tr('Pending', 'Pendiente')}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="voy-note">{tr('Actual times go to Connect beside the schedule.', 'Las horas reales van a Connect junto al horario.')}</p>
      {actual > 0 ? (
        <div className="voy-actions-row">
          <button type="button" className="btn btn--sm" onClick={onSend}>
            <Icon name="send" size={15} strokeWidth={2} /> {tr('Send port times to Connect', 'Enviar horas de puerto a Connect')}
          </button>
          {lastManual && (
            <span className="voy-note">
              {tr(`Last sent ${fmtDayTime(lastManual.at)} by ${lastManual.by}`, `Último envío ${fmtDayTime(lastManual.at)} por ${lastManual.by}`)}
            </span>
          )}
        </div>
      ) : (
        <p className="voy-note">{tr('Nothing to send until the cameras record the first port time.', 'Nada que enviar hasta que las cámaras registren la primera hora de puerto.')}</p>
      )}
    </Card>
  );
}

// ---------- Connect sync ----------

function ConnectSync({
  rec,
  live,
  now,
  rounds,
  diffs,
  outbox,
  onReport,
  onOpen,
}: {
  rec: VoyageRecord;
  live: LiveVoyage;
  now: number;
  rounds: Round[];
  diffs: number;
  outbox: OutboxRow[];
  onReport: () => void;
  onOpen: () => void;
}) {
  const tr = useTr();
  const v = rec.voyage;
  const listTotal = rec.cargo.reduce((n, c) => n + c.list, 0);
  const sentEvents = outbox.filter((r) => r.kind === 'events' && !r.pending).reduce((n, r) => n + (r.count ?? 0), 0);
  const pendingEvents = outbox.filter((r) => r.kind === 'events' && r.pending).reduce((n, r) => n + (r.count ?? 0), 0);
  const s = roundStats(rounds);
  const write = lastWrite(outbox);
  return (
    <section className="card" aria-labelledby="sync-title">
      <div className="card__head voy-sync-head">
        <div className="card__title">
          <h2 id="sync-title">{tr('Connect sync', 'Sincronización con Connect')}</h2>
        </div>
        <StatusDot>
          <span className="voy-sync-time">{tr(`${fmtTime(lastRead(now))} · every ${SYNC_EVERY_MIN} min`, `${fmtTime(lastRead(now))} · cada ${SYNC_EVERY_MIN} min`)}</span>
        </StatusDot>
      </div>
      <div className="card__body voy-sync">
        <div>
          <span className="voy-eyebrow">{tr('In from Connect', 'Desde Connect')}</span>
          <dl className="voy-dl">
            <dt>{tr('Convoy make-up', 'Composición del convoy')}</dt>
            <dd>{tr(`1 tug, ${rec.barges.length} barge${rec.barges.length === 1 ? '' : 's'}`, `1 remolcador, ${rec.barges.length} barcaza${rec.barges.length === 1 ? '' : 's'}`)}</dd>
            <dt>{tr('Schedule', 'Horario')}</dt>
            <dd>{tr(`${rec.calls.length} calls`, `${rec.calls.length} escalas`)}</dd>
            <dt>{tr('Cargo lists', 'Listas de carga')}</dt>
            <dd>{tr(`${listTotal} containers`, `${listTotal} contenedores`)}</dd>
            <dt>{tr('Reefer round times', 'Horas de ronda de reefers')}</dt>
            <dd>{rec.roundSpecs.length ? tr(`Every ${ROUND_EVERY_H} hours`, `Cada ${ROUND_EVERY_H} horas`) : tr('None', 'Ninguna')}</dd>
          </dl>
        </div>
        <div>
          <span className="voy-eyebrow">{tr('Out to Connect', 'Hacia Connect')}</span>
          <dl className="voy-dl voy-dl--strong">
            <dt>{tr('Events on the voyage record', 'Eventos en el registro del viaje')}</dt>
            <dd>
              {sentEvents}
              {pendingEvents > 0 && <span className="voy-subtle"> · {tr(`${pendingEvents} at the next sync`, `${pendingEvents} en la próxima`)}</span>}
              {live.offline && <span className="voy-subtle"> · {tr(`${live.queuedEvents} queued`, `${live.queuedEvents} en cola`)}</span>}
            </dd>
            <dt>{tr('Actual port times', 'Horas de puerto reales')}</dt>
            <dd>{rec.calls.filter((c) => c.actual).length}</dd>
            <dt>{tr('Container differences', 'Diferencias de contenedores')}</dt>
            <dd>{diffs}</dd>
            <dt>{tr('Missed reefer rounds', 'Rondas de reefers perdidas')}</dt>
            <dd>{s.missed}</dd>
          </dl>
          {write && (
            <p className="voy-note" style={{ marginTop: 8 }}>
              {tr(`Last write ${fmtDayTime(write.at)} · ${write.what}`, `Última escritura ${fmtDayTime(write.at)} · ${write.what}`)}
            </p>
          )}
        </div>
        <div className="voy-report">
          <span className="voy-eyebrow">{tr('Voyage report', 'Informe de viaje')}</span>
          <p>
            {rec.reportSentAt
              ? tr(`Sent at arrival, ${fmtDayTime(rec.reportSentAt)}, to Connect and the operations manager.`, `Enviado a la llegada, ${fmtDayTime(rec.reportSentAt)}, a Connect y al gerente de operaciones.`)
              : tr(`Goes to Connect and the operations manager at arrival in ${rec.arrivalPort}.`, `Va a Connect y al gerente de operaciones a la llegada a ${rec.arrivalPort}.`)}
          </p>
          <button type="button" className="btn btn--sm" onClick={onReport}>
            <Icon name="file" size={15} strokeWidth={2} /> {v.status === 'completed' ? tr('Download report', 'Descargar informe') : tr('Generate draft now', 'Generar borrador ahora')}
          </button>
        </div>
      </div>
      <button type="button" className="voy-card-foot" aria-haspopup="dialog" onClick={onOpen}>
        {tr('What Connect holds and what was sent', 'Qué tiene Connect y qué se envió')}
      </button>
      <Link to="/admin/integrations" className="voy-card-foot">
        {tr('Integration log', 'Registro de la integración')}
      </Link>
    </section>
  );
}

// ---------- Events ----------

const STATUS_BADGE: Record<EventStatus, { tone: 'bad' | 'warn' | 'ok' | 'neutral'; label: [string, string] }> = {
  alarm: { tone: 'bad', label: ['Alarm', 'Alarma'] },
  to_review: { tone: 'warn', label: ['To review', 'Por revisar'] },
  accepted: { tone: 'ok', label: ['Accepted', 'Aceptado'] },
  rejected: { tone: 'neutral', label: ['Rejected', 'Rechazado'] },
  false_alert: { tone: 'neutral', label: ['False alert', 'Falsa alerta'] },
};

type EventFilter = 'all' | 'alarm' | 'to_review' | 'reviewed' | 'late';

function EventsTab({ rec, live }: { rec: VoyageRecord; live: LiveVoyage }) {
  const tr = useTr();
  const lang = useLang();
  const fleet = useFleet();
  const ex = useExporter();
  const [f, setF] = useState<EventFilter>('all');
  const [uc, setUc] = useState('all');
  const [vessel, setVessel] = useState('all');
  const events = live.events;
  const linkable = new Set([...live.alarms.map((a) => a.id), ...rec.consoleAlarms.map((a) => a.id)]);
  const useCasesHere = [...new Set(events.map((e) => e.useCaseId))];
  const vesselsHere = [...new Set(events.map((e) => e.vesselId))].filter(Boolean);
  const match = (e: VoyageEvent) =>
    f === 'all' || (f === 'reviewed' ? e.status === 'accepted' || e.status === 'false_alert' || e.status === 'rejected' : f === 'late' ? !!e.late : e.status === f);
  const shown = events.filter((e) => match(e) && (uc === 'all' || e.useCaseId === uc) && (vessel === 'all' || e.vesselId === vessel));
  const count = (s: EventStatus) => events.filter((e) => e.status === s).length;
  const reviewed = count('accepted') + count('false_alert') + count('rejected');
  const statusLabel = (e: VoyageEvent) => tr(...STATUS_BADGE[e.status].label);

  const exportCsv = () => {
    const name = `${slug(tr('events', 'eventos'))}-${slug(rec.voyage.id)}${f !== 'all' ? `-${f}` : ''}.csv`;
    ex.csv(
      name,
      [
        [
          tr('Event', 'Evento'),
          tr('Time (Asunción)', 'Hora (Asunción)'),
          tr('Time (UTC)', 'Hora (UTC)'),
          tr('Use case', 'Caso de uso'),
          tr('Vessel', 'Embarcación'),
          tr('Camera', 'Cámara'),
          tr('Confidence', 'Confianza'),
          tr('Review', 'Revisión'),
          tr('Alarm', 'Alarma'),
          tr('Shadow run', 'Ejecución en sombra'),
          tr('Arrived late', 'Llegó tarde'),
          tr('Received ashore', 'Recibido en tierra'),
        ],
        ...shown.map((e) => [
          e.id,
          fmtDayTime(e.at),
          isoAt(e.at),
          useCaseName(e.useCaseId, lang),
          vesselName(e.vesselId),
          fleet.cameraById(e.cameraId)?.name ?? e.cameraId,
          e.confidence.toFixed(2),
          statusLabel(e),
          e.alarmId ?? '',
          e.shadow ? tr('Yes', 'Sí') : '',
          e.late ? tr('Yes', 'Sí') : '',
          e.receivedAt ? fmtDayTime(e.receivedAt) : '',
        ]),
      ],
      { action: 'Exported events', target: rec.voyage.id, details: `${shown.length} events · filter ${f}${uc !== 'all' ? ` · ${uc}` : ''}${vessel !== 'all' ? ` · ${vessel}` : ''}`, convoyId: rec.voyage.convoyId },
    );
  };

  return (
    <div className="stack">
      <div className="voy-toolbar">
        <Segmented<EventFilter>
          label={tr('Review state', 'Estado de revisión')}
          value={f}
          onChange={setF}
          options={[
            { value: 'all', label: tr(`All ${events.length}`, `Todos ${events.length}`) },
            { value: 'alarm', label: tr(`Alarms ${count('alarm')}`, `Alarmas ${count('alarm')}`) },
            { value: 'to_review', label: tr(`To review ${count('to_review')}`, `Por revisar ${count('to_review')}`) },
            { value: 'reviewed', label: tr(`Reviewed ${reviewed}`, `Revisados ${reviewed}`) },
            ...(live.arrivedLate ? [{ value: 'late' as const, label: tr(`Arrived late ${live.arrivedLate}`, `Llegaron tarde ${live.arrivedLate}`) }] : []),
          ]}
        />
        <label className="voy-field">
          <span>{tr('Use case', 'Caso de uso')}</span>
          <select className="select" value={uc} onChange={(e) => setUc(e.target.value)}>
            <option value="all">{tr('All use cases', 'Todos los casos de uso')}</option>
            {useCasesHere.map((u) => (
              <option key={u} value={u}>
                {useCaseName(u, lang)}
              </option>
            ))}
          </select>
        </label>
        <label className="voy-field">
          <span>{tr('Vessel', 'Embarcación')}</span>
          <select className="select" value={vessel} onChange={(e) => setVessel(e.target.value)}>
            <option value="all">{tr('All vessels', 'Todas las embarcaciones')}</option>
            {vesselsHere.map((x) => (
              <option key={x} value={x}>
                {vesselName(x)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn voy-toolbar__end" onClick={exportCsv} disabled={!shown.length} title={shown.length ? undefined : tr('No events match the filters', 'Ningún evento coincide con los filtros')}>
          <Icon name="download" size={16} /> {tr('Export CSV', 'Exportar CSV')}
        </button>
      </div>
      {live.offline && live.queuedEvents > 0 && (
        <div className="callout callout--warn">
          <Icon name="wifiOff" size={18} />
          <span>
            {tr(
              `${live.queuedEvents} more events are queued on board since ${fmtTime(live.queuedAfter!)}. They arrive with their original times and go to Connect when the link returns.`,
              `${live.queuedEvents} eventos más esperan en cola a bordo desde las ${fmtTime(live.queuedAfter!)}. Llegan con su hora original y van a Connect cuando vuelva el enlace.`,
            )}
          </span>
        </div>
      )}
      {!live.offline && live.arrivedLate > 0 && (
        <div className="callout">
          <Icon name="wifi" size={18} />
          <span>
            {tr(
              `${live.convoy?.name ?? ''} came back into coverage${live.reconnectedAt ? ` at ${fmtTime(live.reconnectedAt)}` : ''}. ${live.arrivedLate} queued events arrived with their original times; they are marked Arrived late.`,
              `${live.convoy?.name ?? ''} volvió a tener cobertura${live.reconnectedAt ? ` a las ${fmtTime(live.reconnectedAt)}` : ''}. Llegaron ${live.arrivedLate} eventos en cola con su hora original; están marcados como Llegó tarde.`,
            )}
          </span>
        </div>
      )}
      <Card
        id="events"
        title={tr('Events on this voyage', 'Eventos de este viaje')}
        hint={tr(`${shown.length} shown · latest first · all on the voyage record in Connect`, `${shown.length} mostrados · más recientes primero · todos en el registro del viaje en Connect`)}
        bodyClass="table-wrap"
      >
        {shown.length ? (
          <table className="table num" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th scope="col">{tr('Time', 'Hora')}</th>
                <th scope="col">{tr('Event', 'Evento')}</th>
                <th scope="col">{tr('Where', 'Dónde')}</th>
                <th scope="col" className="right">
                  {tr('Confidence', 'Confianza')}
                </th>
                <th scope="col">{tr('Review', 'Revisión')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => {
                const st = STATUS_BADGE[e.status];
                const to = e.alarmId && linkable.has(e.alarmId) ? `/alarms/${e.alarmId}` : e.source === 'review' ? `/alarms?tab=review&event=${e.id}` : undefined;
                return (
                  <tr key={e.key}>
                    <td className="voy-nowrap">
                      {fmtDayTime(e.at)}
                      {e.late && e.receivedAt && <span className="sub">{tr(`Received ${fmtTime(e.receivedAt)}`, `Recibido ${fmtTime(e.receivedAt)}`)}</span>}
                    </td>
                    <td>
                      {to ? (
                        <Link to={to} className="strong-link">
                          {useCaseName(e.useCaseId, lang)}
                        </Link>
                      ) : (
                        <span className="strong-link">{useCaseName(e.useCaseId, lang)}</span>
                      )}
                      <span className="sub mono">
                        {e.id}
                        {e.alarmId ? ` · ${e.alarmId}` : ''}
                      </span>
                    </td>
                    <td>
                      {vesselName(e.vesselId) || '—'}
                      <span className="sub">{fleet.cameraById(e.cameraId)?.name ?? e.cameraId}</span>
                    </td>
                    <td className="right">{e.confidence.toFixed(2)}</td>
                    <td>
                      <span className="voy-badges">
                        <Badge tone={st.tone}>{statusLabel(e)}</Badge>
                        {e.late && (
                          <Badge tone="outline">
                            <Icon name="wifiOff" size={12} /> {tr('Arrived late', 'Llegó tarde')}
                          </Badge>
                        )}
                        {e.shadow && <Badge tone="outline">{tr('Shadow run', 'En sombra')}</Badge>}
                      </span>
                      {e.status === 'false_alert' && e.falseReason && <span className="sub">{e.falseReason}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="empty">{tr('No events match these filters.', 'Ningún evento coincide con estos filtros.')}</div>
        )}
      </Card>
    </div>
  );
}

// ---------- Audit ----------

const ROLE_ES: Record<string, string> = Object.fromEntries([...roles.map((r) => [r.name, r.nameEs]), ['Automated', 'Automático']]);

function AuditTab({ rec, live, rows, rounds }: { rec: VoyageRecord; live: LiveVoyage; rows: AlarmRow[]; rounds: Round[] }) {
  const { state, can } = useApp();
  const tr = useTr();
  const lang = useLang();
  const [f, setF] = useState<'all' | 'people' | 'system'>('all');
  const v = rec.voyage;

  const entries = useMemo(() => {
    const targets = new Set<string>([v.id, ...rows.map((r) => r.id), ...live.events.map((e) => e.id)]);
    const camIds = new Set(live.events.map((e) => e.cameraId));
    const fromLog = state.audit.filter(
      (a) => targets.has(a.target) || a.target.startsWith(`${v.id} `) || (v.status !== 'completed' && camIds.has(a.target)),
    );
    const sys = (at: number, action: string, target: string, details: string): AuditEntry => ({
      seq: 0,
      at: new Date(at).toISOString(),
      actor: 'System',
      role: 'Automated',
      action,
      target,
      details,
      source: 'Connect integration',
      hash: '',
      prevHash: '',
    });
    const loggedNear = (t: number) => fromLog.some((a) => a.action === 'Sent to Connect' && Math.abs(new Date(a.at).getTime() - t) < 2 * MIN);
    const en: Tr = (x) => x; // records stay in English, as written
    const synth: AuditEntry[] = [
      sys(rec.window.start, 'Received voyage', v.id, `Make-up, schedule with ${rec.calls.length} calls, cargo lists, reefer round times`),
      ...rec.calls
        .filter((c) => c.actual && c.sentAt)
        .map((c) => sys(c.sentAt!, 'Sent port time', v.id, `${c.port} ${c.kind} ${fmtTime(c.actual!)} (${fmtDelta(c.actual! - c.scheduled, en)})`)),
      ...rec.cargo
        .filter((c) => c.differences.length && c.sentAt)
        .map((c) => sys(c.sentAt!, 'Sent cargo differences', v.id, `${vesselName(c.bargeId)} · ${c.differences.map((d) => d.container).join(', ')}`)),
      ...rounds
        .filter((r) => r.result === 'missed' && (r.scheduled + MISSED_AFTER_MIN * MIN < SNAPSHOT || !loggedNear(r.scheduled + MISSED_AFTER_MIN * MIN)))
        .map((r) => sys(r.scheduled + MISSED_AFTER_MIN * MIN, 'Sent missed reefer round', v.id, `${vesselName(r.bargeId)} · ${new Date(r.scheduled).toISOString()}`)),
      ...(rec.reportSentAt ? [sys(rec.reportSentAt, 'Sent report', v.id, 'Voyage report at arrival, to Connect and the operations manager')] : []),
    ];
    return [...fromLog, ...synth].sort((a, b) => b.at.localeCompare(a.at));
  }, [state.audit, rec, live.events, rows, rounds, v.id, v.status]);

  const shown = entries.filter((e) => (f === 'all' ? true : f === 'system' ? e.role === 'Automated' : e.role !== 'Automated'));
  const role = (r: string) => (lang === 'es' ? (ROLE_ES[r] ?? r) : r);
  const actor = (a: string) => (a === 'System' ? tr('System', 'Sistema') : a);

  return (
    <Card
      id="audit"
      title={tr('Audit log for this voyage', 'Registro de auditoría de este viaje')}
      hint={tr('Views, exports, alarm actions and Connect messages, newest first', 'Vistas, exportaciones, acciones sobre alarmas y mensajes de Connect, más recientes primero')}
      action={
        <span className="voy-badges">
          <Segmented
            label={tr('Who', 'Quién')}
            value={f}
            onChange={setF}
            options={[
              { value: 'all', label: tr('All', 'Todos') },
              { value: 'people', label: tr('People', 'Personas') },
              { value: 'system', label: tr('Automated', 'Automático') },
            ]}
          />
          {can('read_audit') && (
            <Link to="/admin/audit" className="card__link">
              {tr('Full audit log', 'Registro de auditoría completo')}
            </Link>
          )}
        </span>
      }
      bodyClass="table-wrap"
    >
      {shown.length ? (
        <table className="table" style={{ minWidth: 720 }}>
          <thead>
            <tr>
              <th scope="col">{tr('Time', 'Hora')}</th>
              <th scope="col">{tr('Who', 'Quién')}</th>
              <th scope="col">{tr('Action', 'Acción')}</th>
              <th scope="col">{tr('Object', 'Objeto')}</th>
              <th scope="col">{tr('Details', 'Detalle')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e, i) => (
              <tr key={`${e.at}-${e.seq}-${i}`}>
                <td className="voy-nowrap num">{fmtDayTime(e.at)}</td>
                <td>
                  {actor(e.actor)}
                  <span className="sub">{role(e.role)}</span>
                </td>
                <td>{e.action}</td>
                <td className="mono">{e.target}</td>
                <td style={{ color: 'var(--muted)' }}>
                  {e.details ?? '—'}
                  {e.source && <span className="sub">{e.source}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="empty">{tr('No entries for this filter.', 'No hay entradas para este filtro.')}</div>
      )}
      <p className="voy-note card__body">
        {tr('Actions and details are records and stay as they were written.', 'Las acciones y los detalles son registros y se muestran tal como se escribieron.')}
      </p>
    </Card>
  );
}
