import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useCaseById, useCases } from '../data/useCases';
import { voyageById } from '../data/alarms';
import type { Alarm } from '../data/types';
import { Card, HBarChart, PageHeader, PriorityBadge, Segmented, Stat, StatusDot, linkTone, usePriorityName } from '../components/ui';
import { Icon } from '../components/Icon';
import { useDismiss } from '../components/AppShell';
import { useApp, useInScope, useOpenAlarms } from '../state/AppState';
import { useFleet } from '../state/fleetStore';
import { createStore, useStore } from '../lib/persist';
import { useTr } from '../lib/i18n';
import { useExporter } from '../lib/exporting';
import { slug } from '../lib/download';
import { fmtCountdown, fmtDayTime, fmtDuration, fmtSmart, useNow } from '../lib/time';
import { positionText } from './screenText';
import './OperationsCenter.css';

type Range = 'live' | '24h' | '7d';

const STATE_SHORT: Record<Alarm['state'], [string, string]> = {
  raised: ['New', 'Nueva'],
  ack_board: ['Acknowledged', 'Confirmada'],
  ack_shore: ['In progress', 'En curso'],
  resolved: ['Resolved', 'Resuelta'],
  closed: ['Closed', 'Cerrada'],
};

const DAY = 24 * 60 * 60 * 1000;

// Map layers are a per-viewer preference; kept with the other saved settings.
interface Layers {
  labels: boolean;
  ports: boolean;
  coverage: boolean;
  legend: boolean;
}
const layerStore = createStore<Layers>('ops.mapLayers', { labels: true, ports: true, coverage: false, legend: true });

/** OPS-01 to OPS-04: the fleet at a glance. */
export function OperationsCenterPage() {
  const { state } = useApp();
  const tr = useTr();
  const es = state.lang === 'es';
  const fleet = useFleet();
  const inScope = useInScope();
  const now = useNow();
  const open = useOpenAlarms();
  const ex = useExporter();
  const prioName = usePriorityName();
  const [range, setRange] = useState<Range>('live');
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  useDismiss(exportRef, exportOpen, () => setExportOpen(false));

  const scopedConvoys = fleet.convoys.filter((c) => inScope(c.id));
  const scopedCams = fleet.cameras.filter((c) => inScope(c.convoyId));
  const healthyCams = scopedCams.filter((c) => c.health === 'healthy');
  const degraded = scopedCams.filter((c) => c.health !== 'healthy');
  const connected = scopedConvoys.filter((c) => c.link !== 'none');
  const offline = scopedConvoys.filter((c) => c.link === 'none');
  const toReview = state.reviewEvents.filter((e) => !e.classification && inScope(e.convoyId));
  const units = fleet.edgeUnits.filter((u) => inScope(u.convoyId));

  // OPS-04: Live shows what is open now; 24 hours and 7 days count what was raised in the window.
  const since = range === '7d' ? now - 7 * DAY : now - DAY;
  const alarmsInView = range === 'live' ? open : state.alarms.filter((a) => inScope(a.convoyId) && new Date(a.raisedAt).getTime() >= since);
  const byPriority = (['P1', 'P2', 'P3', 'P4'] as const)
    .map((p) => ({ p, n: alarmsInView.filter((a) => a.priority === p).length }))
    .filter((x) => x.n > 0);

  // Median time to acknowledge ashore, from the alarms that were acknowledged.
  const ackTimes = state.alarms
    .filter((a) => inScope(a.convoyId) && a.stateTimes.ack_shore && a.owner !== 'System')
    .map((a) => new Date(a.stateTimes.ack_shore!).getTime() - new Date(a.escalationBase ?? a.raisedAt).getTime())
    .filter((ms) => ms > 0)
    .sort((x, y) => x - y);
  const median = ackTimes.length ? ackTimes[Math.floor(ackTimes.length / 2)] : 0;
  const medianText = `${Math.floor(median / 60000)} m ${Math.round((median % 60000) / 1000)} s`;
  const withinTarget = median <= 5 * 60_000;

  const scopeLabel =
    state.scope === 'all' ? tr('All convoys', 'Todos los convoyes') : tr(`${fleet.convoyById(state.scope)?.name} convoy`, `Convoy ${fleet.convoyById(state.scope)?.name}`);
  const rangeLabel = range === 'live' ? tr('live', 'en vivo') : range === '24h' ? tr('last 24 hours', 'últimas 24 horas') : tr('last 7 days', 'últimos 7 días');

  // Events by use case: the 24-hour history from the event service plus everything that arrived since.
  const ucRows = useMemo(() => {
    const factor = range === '7d' ? 7 : 1;
    const arrived = (ucId: string) =>
      state.reviewEvents.filter((e) => e.useCaseId === ucId && inScope(e.convoyId) && new Date(e.at).getTime() >= since).length +
      state.alarms.filter((a) => a.useCaseId === ucId && inScope(a.convoyId) && a.id > 'ALM-26-0318' && new Date(a.raisedAt).getTime() >= since).length;
    const scopeShare = state.scope === 'all' ? 1 : 1 / 3;
    return useCases
      .map((u) => ({ u, value: Math.round(u.events24h * factor * scopeShare) + arrived(u.id) }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
      .map(({ u, value }) => ({
        label: es ? u.nameEs : u.name,
        value,
        note: u.status === 'shadow' ? tr('Shadow run, logged only', 'Ejecución en sombra, solo registro') : undefined,
      }));
  }, [state.reviewEvents, state.alarms, state.scope, range, since, inScope, es, tr]);
  const ucTotal = ucRows.reduce((s, r) => s + r.value, 0);

  const oldestReview = toReview.reduce((min, e) => Math.min(min, new Date(e.at).getTime()), now);
  const where = (a: Alarm) => (a.cameraId ? fleet.cameraLabel(a.cameraId) : tr(`${fleet.convoyById(a.convoyId)?.name} convoy`, `Convoy ${fleet.convoyById(a.convoyId)?.name}`));

  const exportPdf = () => {
    setExportOpen(false);
    ex.pdf(
      `operations-center-${slug(scopeLabel)}-${range}.pdf`,
      {
        title: tr('Operations center', 'Centro de operaciones'),
        subtitle: `${scopeLabel} · ${rangeLabel} · ${fmtDayTime(now)} Asunción`,
        blocks: [
          {
            kind: 'kv',
            rows: [
              [tr('Open alarms', 'Alarmas abiertas'), `${alarmsInView.length} (${byPriority.map((x) => `${x.n} ${x.p}`).join(', ') || '0'})`],
              [tr('Waiting for review', 'Pendientes de revisión'), String(toReview.length)],
              [tr('Median time to acknowledge', 'Mediana de tiempo de confirmación'), medianText],
              [tr('Cameras healthy', 'Cámaras en buen estado'), `${healthyCams.length} / ${scopedCams.length}`],
              [tr('Convoys connected', 'Convoyes conectados'), `${connected.length} / ${scopedConvoys.length}`],
            ],
          },
          { kind: 'h2', text: tr('Alarms', 'Alarmas') },
          {
            kind: 'table',
            columns: [
              { label: tr('Priority', 'Prioridad'), width: 1.2 },
              { label: tr('Alarm', 'Alarma'), width: 3.4 },
              { label: tr('State', 'Estado'), width: 1.6 },
              { label: tr('Owner', 'Responsable'), width: 1.6 },
            ],
            rows: alarmsInView.map((a) => [
              prioName(a.priority),
              `${a.id} · ${es && a.titleEs ? a.titleEs : a.title} · ${where(a)} · ${fmtSmart(a.raisedAt, now)}`,
              (es ? a.stateLabelEs : a.stateLabel) ?? STATE_SHORT[a.state][es ? 1 : 0],
              a.owner ?? tr('Unassigned', 'Sin asignar'),
            ]),
          },
          { kind: 'h2', text: tr('Fleet status', 'Estado de la flota') },
          {
            kind: 'table',
            columns: [
              { label: tr('Convoy', 'Convoy'), width: 2 },
              { label: tr('Voyage', 'Viaje'), width: 1.4 },
              { label: tr('Link', 'Enlace'), width: 1.6 },
              { label: tr('Cameras', 'Cámaras'), width: 1, align: 'right' },
              { label: tr('Edge units', 'Unidades'), width: 1, align: 'right' },
            ],
            rows: scopedConvoys.map((c) => {
              const cams = fleet.camerasOf(c.id);
              const us = fleet.unitsOf(c.id);
              return [
                `${c.name} · ${positionText(c.positionLabel, state.lang, c.link !== 'none')}`,
                c.voyageId,
                c.link === 'none' ? tr(`None · ${fmtDuration(now - new Date(c.lastSeen).getTime())}`, `Sin enlace · ${fmtDuration(now - new Date(c.lastSeen).getTime())}`) : c.linkLabel,
                `${cams.filter((x) => x.health === 'healthy').length}/${cams.length}`,
                `${us.filter((u) => u.status === 'reporting').length}/${us.length}`,
              ];
            }),
          },
          { kind: 'h2', text: tr('Events by use case', 'Eventos por caso de uso') },
          { kind: 'bars', rows: ucRows.map((r) => ({ label: r.label, value: r.value })) },
        ],
      },
      { action: 'Exported view', target: `Operations center · ${scopeLabel} · ${range}` },
    );
  };

  const exportCsv = () => {
    setExportOpen(false);
    ex.csv(
      `alarms-${slug(scopeLabel)}-${range}.csv`,
      [
        ['Alarm', 'Priority', 'Title', 'Convoy', 'Vessel and camera', 'Raised', 'State', 'Owner', 'Escalates at', 'Classification'],
        ...alarmsInView.map((a) => [
          a.id,
          a.priority,
          es && a.titleEs ? a.titleEs : a.title,
          fleet.convoyById(a.convoyId)?.name,
          where(a),
          a.raisedAt,
          a.stateLabel ?? STATE_SHORT[a.state][0],
          a.owner ?? '',
          a.escalatesAt ?? '',
          a.classification ?? '',
        ]),
      ],
      { action: 'Exported alarms', target: `Operations center · ${scopeLabel} · ${range}`, details: `${alarmsInView.length} rows` },
    );
  };

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tr('Operations', 'Operaciones'), to: '/' }]}
        title={tr('Operations center', 'Centro de operaciones')}
        sub={tr(
          `${scopeLabel} · ${scopedConvoys.length} convoys, ${scopedCams.length} cameras, ${units.length} edge units · positions and health every minute`,
          `${scopeLabel} · ${scopedConvoys.length} convoyes, ${scopedCams.length} cámaras, ${units.length} unidades de borde · posiciones y estado cada minuto`,
        )}
        actions={
          <>
            <Segmented<Range>
              label={tr('Time range', 'Periodo')}
              value={range}
              onChange={setRange}
              options={[
                { value: 'live', label: tr('Live', 'En vivo') },
                { value: '24h', label: tr('24 hours', '24 horas') },
                { value: '7d', label: tr('7 days', '7 días') },
              ]}
            />
            <div className="ops-menu" ref={exportRef}>
              <button type="button" className="btn" aria-expanded={exportOpen} onClick={() => setExportOpen((v) => !v)}>
                <Icon name="download" size={16} /> {tr('Export', 'Exportar')}
                <Icon name="chevronDown" size={14} />
              </button>
              {exportOpen && (
                <div className="ops-menu__pop" role="menu">
                  <button type="button" role="menuitem" onClick={exportPdf}>
                    <Icon name="file" size={16} />
                    <span>
                      {tr('PDF report of this view', 'Informe PDF de esta vista')}
                      <span className="ops-menu__hint">{tr('Watermarked with your name and the time', 'Con marca de agua con su nombre y la hora')}</span>
                    </span>
                  </button>
                  <button type="button" role="menuitem" onClick={exportCsv}>
                    <Icon name="list" size={16} />
                    <span>
                      {tr('Alarms as CSV', 'Alarmas en CSV')}
                      <span className="ops-menu__hint">{tr(`${alarmsInView.length} rows, ${rangeLabel}`, `${alarmsInView.length} filas, ${rangeLabel}`)}</span>
                    </span>
                  </button>
                </div>
              )}
            </div>
            <Link to={state.scope !== 'all' ? `/video-wall?convoy=${state.scope}` : '/video-wall'} className="btn btn--primary">
              <Icon name="grid" size={16} /> {tr('Open video wall', 'Abrir videowall')}
            </Link>
          </>
        }
      />

      <div className="stat-grid">
        <Stat
          label={range === 'live' ? tr('Open alarms', 'Alarmas abiertas') : tr(`Alarms, ${rangeLabel}`, `Alarmas, ${rangeLabel}`)}
          value={alarmsInView.length}
          aside={byPriority.map((x) => `${x.n} ${x.p}`).join(' · ') || tr('None', 'Ninguna')}
        >
          <span aria-hidden="true" className="ops-prio-bar">
            {byPriority.map((x) => (
              <span key={x.p} style={{ flex: x.n }} className={`ops-prio-bar__${x.p.toLowerCase()}`} />
            ))}
          </span>
        </Stat>
        <Stat
          label={tr('Waiting for review', 'Pendientes de revisión')}
          value={toReview.length}
          aside={toReview.length ? tr(`oldest ${fmtDuration(now - oldestReview)}`, `la más antigua ${fmtDuration(now - oldestReview)}`) : undefined}
          foot={<Link to="/alarms?tab=review">{tr('Open review queue', 'Abrir cola de revisión')}</Link>}
        />
        <Stat
          label={tr('Median time to acknowledge', 'Mediana de tiempo de confirmación')}
          value={ackTimes.length ? medianText : '—'}
          aside={tr(`${ackTimes.length} alarms`, `${ackTimes.length} alarmas`)}
          foot={withinTarget ? tr('Within the 5 min target', 'Dentro del objetivo de 5 min') : tr('Above the 5 min target', 'Por encima del objetivo de 5 min')}
          footTone={withinTarget ? 'ok' : 'bad'}
        />
        <Stat
          label={tr('Cameras healthy', 'Cámaras en buen estado')}
          value={tr(`${healthyCams.length} of ${scopedCams.length}`, `${healthyCams.length} de ${scopedCams.length}`)}
          aside={tr('uptime 99.1%', 'disponibilidad 99,1 %')}
          foot={
            degraded.length ? (
              <Link to="/config/cameras" style={{ color: 'inherit' }}>
                {tr(`${degraded.length} degraded`, `${degraded.length} degradadas`)} · {degraded.map((c) => `${c.name.toLowerCase()}, ${fleet.vesselById(c.vesselId)?.name}`).join('; ')}
              </Link>
            ) : (
              tr('All passing scene checks', 'Todas pasan los controles de escena')
            )
          }
        />
        <Stat
          label={tr('Convoys connected', 'Convoyes conectados')}
          value={tr(`${connected.length} of ${scopedConvoys.length}`, `${connected.length} de ${scopedConvoys.length}`)}
          foot={
            offline.length
              ? offline
                  .map((c) =>
                    tr(`${c.name} out of coverage ${fmtDuration(now - new Date(c.lastSeen).getTime())}`, `${c.name} sin cobertura ${fmtDuration(now - new Date(c.lastSeen).getTime())}`),
                  )
                  .join(' · ')
              : tr('All reporting', 'Todos reportando')
          }
          footTone={offline.length ? 'bad' : undefined}
        />
      </div>

      <div className="row">
        <RouteMap />

        <div className="grow stack">
          <Card
            id="alarms"
            title={range === 'live' ? tr('Active alarms', 'Alarmas activas') : tr(`Alarms, ${rangeLabel}`, `Alarmas, ${rangeLabel}`)}
            hint={
              range === 'live'
                ? tr(`${open.length} open · highest priority first`, `${open.length} abiertas · primero la prioridad más alta`)
                : tr(`${alarmsInView.length} raised`, `${alarmsInView.length} generadas`)
            }
            action={
              <Link to="/alarms" className="card__link">
                {tr('Open alarm console', 'Abrir consola de alarmas')}
              </Link>
            }
            bodyClass="table-wrap"
          >
            {alarmsInView.length === 0 ? (
              <div className="empty">{tr('No alarms in this scope and period.', 'No hay alarmas en este alcance y periodo.')}</div>
            ) : (
              <table className="table" style={{ minWidth: 620 }}>
                <thead>
                  <tr>
                    <th scope="col">{tr('Priority', 'Prioridad')}</th>
                    <th scope="col">{tr('Alarm', 'Alarma')}</th>
                    <th scope="col">{tr('State', 'Estado')}</th>
                    <th scope="col">{tr('Owner', 'Responsable')}</th>
                    <th scope="col">{tr('Response', 'Respuesta')}</th>
                  </tr>
                </thead>
                <tbody>
                  {alarmsInView.map((a) => {
                    const left = a.escalatesAt ? new Date(a.escalatesAt).getTime() - now : undefined;
                    const pending = a.state === 'raised' || a.state === 'ack_board';
                    return (
                      <tr key={a.id} className={a.priority <= 'P2' && pending ? 'is-alert' : undefined}>
                        <td>
                          <PriorityBadge p={a.priority} />
                        </td>
                        <td>
                          <Link to={`/alarms/${a.id}`} className="strong-link">
                            {es && a.titleEs ? a.titleEs : a.title}
                          </Link>
                          <span className="sub">
                            {fmtSmart(a.raisedAt, now)} · {where(a)}
                          </span>
                        </td>
                        <td>
                          {(es ? a.stateLabelEs : a.stateLabel) ?? STATE_SHORT[a.state][es ? 1 : 0]}
                          {a.state === 'ack_board' && a.stateTimes.ack_board && (
                            <span className="sub">{tr(`on board ${fmtSmart(a.stateTimes.ack_board, now)}`, `a bordo ${fmtSmart(a.stateTimes.ack_board, now)}`)}</span>
                          )}
                        </td>
                        <td style={{ color: a.owner ? undefined : 'var(--muted)' }}>{a.owner ?? tr('Unassigned', 'Sin asignar')}</td>
                        <td>
                          {pending && left !== undefined && left > 0 ? (
                            <span className="ops-escalates">
                              <Icon name="clock" size={14} strokeWidth={2.2} />
                              {tr(`Escalates in ${fmtCountdown(left)}`, `Escala en ${fmtCountdown(left)}`)}
                            </span>
                          ) : pending && (a.escalatedTo?.length ?? 0) > 1 ? (
                            <span className="ops-escalates">
                              {tr(`Escalated to ${a.escalatedTo![a.escalatedTo!.length - 1].toLowerCase()}`, `Escalada: ${a.escalatedTo![a.escalatedTo!.length - 1]}`)}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--muted)' }}>{(es ? a.responseEs : undefined) ?? a.response ?? '—'}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>

          <Card
            id="fleet"
            title={tr('Fleet status', 'Estado de la flota')}
            hint={tr('Convoy make-up and voyages from Connect', 'Composición de convoyes y viajes desde Connect')}
            action={
              <Link to="/voyages" className="card__link">
                {tr('All voyages', 'Todos los viajes')}
              </Link>
            }
            bodyClass="table-wrap"
          >
            <table className="table num" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th scope="col">{tr('Convoy', 'Convoy')}</th>
                  <th scope="col">{tr('Voyage', 'Viaje')}</th>
                  <th scope="col">{tr('Link', 'Enlace')}</th>
                  <th scope="col" className="right">
                    {tr('Cameras', 'Cámaras')}
                  </th>
                  <th scope="col" className="right">
                    {tr('Edge units', 'Unidades de borde')}
                  </th>
                  <th scope="col" className="right">
                    {tr('Alarms', 'Alarmas')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {scopedConvoys.map((c) => {
                  const voy = voyageById(c.voyageId);
                  const cams = fleet.camerasOf(c.id);
                  const us = fleet.unitsOf(c.id);
                  const barges = fleet.vesselsOf(c.id).filter((v) => v.kind === 'barge');
                  const lastSeen = new Date(c.lastSeen);
                  const isOff = c.link === 'none';
                  return (
                    <tr key={c.id}>
                      <td>
                        <Link to={`/video-wall?convoy=${c.id}`} className="strong-link">
                          {c.name}
                        </Link>
                        <span className="sub">
                          {barges.length <= 2 ? barges.map((b) => b.name).join(', ') : tr(`${barges.length} barges`, `${barges.length} barcazas`)} · {positionText(c.positionLabel, state.lang, c.link !== 'none')}
                        </span>
                      </td>
                      <td>
                        <Link to={`/voyages/${c.voyageId}`} className="mono" style={{ textDecoration: 'none' }}>
                          {c.voyageId}
                        </Link>
                        <span className="sub">{voy?.status === 'in_port' ? tr(voy.statusNote, 'En puerto · operaciones de carga') : voy && tr(voy.route, voy.route.replace(' to ', ' a '))}</span>
                      </td>
                      <td>
                        <StatusDot tone={linkTone(c.link)}>
                          {isOff ? tr(`None · ${fmtDuration(now - lastSeen.getTime())}`, `Sin enlace · ${fmtDuration(now - lastSeen.getTime())}`) : c.linkLabel}
                        </StatusDot>
                        {c.queuedEvents > 0 && <span className="sub">{tr(`${c.queuedEvents} events queued`, `${c.queuedEvents} eventos en cola`)}</span>}
                      </td>
                      <td className="right">
                        {isOff
                          ? `${cams.length} · ${fmtSmart(lastSeen, now)}`
                          : tr(`${cams.filter((x) => x.health === 'healthy').length} of ${cams.length}`, `${cams.filter((x) => x.health === 'healthy').length} de ${cams.length}`)}
                      </td>
                      <td className="right">
                        {isOff
                          ? `${us.length} · ${fmtSmart(lastSeen, now)}`
                          : tr(`${us.filter((u) => u.status === 'reporting').length} of ${us.length}`, `${us.filter((u) => u.status === 'reporting').length} de ${us.length}`)}
                      </td>
                      <td className="right" style={{ fontWeight: 600 }}>
                        {open.filter((a) => a.convoyId === c.id).length}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          <Card
            id="uc"
            title={tr(`Events by use case, ${range === '7d' ? 'last 7 days' : 'last 24 hours'}`, `Eventos por caso de uso, ${range === '7d' ? 'últimos 7 días' : 'últimas 24 horas'}`)}
            hint={tr(`${ucTotal} events across ${state.scope === 'all' ? 'the fleet' : 'this convoy'}`, `${ucTotal} eventos en ${state.scope === 'all' ? 'la flota' : 'este convoy'}`)}
            action={
              useCaseById('life-jacket') && state.role === 'safety_admin' ? (
                <Link to="/config/use-cases" className="card__link">
                  {tr('Use cases', 'Casos de uso')}
                </Link>
              ) : undefined
            }
          >
            <HBarChart rows={ucRows} />
          </Card>
        </div>
      </div>
    </div>
  );
}

/** OPS-02: schematic route map with each convoy's last position, link state and open alarms. */
function RouteMap() {
  const tr = useTr();
  const fleet = useFleet();
  const inScope = useInScope();
  const open = useOpenAlarms();
  const { state } = useApp();
  const es = state.lang === 'es';
  const now = useNow(30_000);
  const [zoom, setZoom] = useState(1);
  const layers = useStore(layerStore);
  const [layersOpen, setLayersOpen] = useState(false);
  const layersRef = useRef<HTMLDivElement>(null);
  useDismiss(layersRef, layersOpen, () => setLayersOpen(false));

  const toggle = (k: keyof Layers) => layerStore.set((l) => ({ ...l, [k]: !l[k] }));
  const layerList: [keyof Layers, string, string][] = [
    ['labels', 'Convoy labels', 'Etiquetas de convoy'],
    ['ports', 'Ports', 'Puertos'],
    ['coverage', 'Coverage gaps (4G)', 'Zonas sin cobertura (4G)'],
    ['legend', 'Legend', 'Leyenda'],
  ];

  return (
    <Card
      id="map"
      title={tr('Route map', 'Mapa de ruta')}
      hint={tr('Schematic · positions every minute', 'Esquemático · posiciones cada minuto')}
      bodyClass=""
      style={{ flex: '0 1 440px' }}
      action={
        <div className="ops-menu" ref={layersRef}>
          <button type="button" className="btn btn--ghost btn--sm" aria-expanded={layersOpen} onClick={() => setLayersOpen((v) => !v)}>
            <Icon name="layers" size={16} /> {tr('Layers', 'Capas')}
          </button>
          {layersOpen && (
            <div className="ops-menu__pop" role="group" aria-label={tr('Map layers', 'Capas del mapa')}>
              {layerList.map(([k, en, sp]) => (
                <label key={k} className="check ops-menu__check">
                  <input type="checkbox" checked={layers[k]} onChange={() => toggle(k)} />
                  {tr(en, sp)}
                </label>
              ))}
            </div>
          )}
        </div>
      }
    >
      <div className="ops-map">
        <div className="ops-map__canvas" style={{ transform: `scale(${zoom})` }}>
          <img
            src="/media/route-map.svg"
            alt={tr(
              'Schematic map of the route from Asunción down the Paraguay and Paraná rivers to Buenos Aires and Montevideo',
              'Mapa esquemático de la ruta desde Asunción por los ríos Paraguay y Paraná hasta Buenos Aires y Montevideo',
            )}
          />
          {layers.coverage &&
            [
              { x: 34, y: 34, w: 16, h: 9 },
              { x: 22, y: 58, w: 12, h: 7 },
            ].map((g, i) => <span key={i} className="ops-map__gap" style={{ left: `${g.x}%`, top: `${g.y}%`, width: `${g.w}%`, height: `${g.h}%` }} />)}
          {layers.ports &&
            [
              { name: 'Asunción', x: 62.8, y: 4.5, labelSide: 'right' },
              { name: 'Buenos Aires', x: 50.5, y: 92.4, labelSide: 'left' },
              { name: 'Montevideo', x: 87.3, y: 95.3, labelSide: 'above' },
            ].map((p) => (
              <span key={p.name}>
                <span className="ops-map__port" style={{ left: `${p.x}%`, top: `${p.y}%` }} />
                <span className={`ops-map__port-label ops-map__port-label--${p.labelSide}`} style={{ left: `${p.x}%`, top: `${p.y}%` }}>
                  {p.name}
                </span>
              </span>
            ))}

          {fleet.convoys
            .filter((c) => inScope(c.id))
            .map((c) => {
              const alarms = open.filter((a) => a.convoyId === c.id && a.priority <= 'P3' && a.cameraId);
              const top = alarms[0];
              const off = c.link === 'none';
              const tone = off ? 'off' : top ? 'alarm' : 'ok';
              const uc = top ? useCaseById(top.useCaseId) : undefined;
              return (
                <span key={c.id}>
                  {tone === 'alarm' && <span className="ops-map__halo" style={{ left: `${c.map.x}%`, top: `${c.map.y}%` }} />}
                  <span className={`ops-map__convoy ops-map__convoy--${tone}`} style={{ left: `${c.map.x}%`, top: `${c.map.y}%` }} />
                  {layers.labels && (
                    <Link
                      to={`/video-wall?convoy=${c.id}`}
                      className={`ops-map__tag${off ? ' ops-map__tag--off' : ''}`}
                      style={{ left: `calc(${c.map.x}% + 16px)`, top: `calc(${c.map.y}% - 22px)` }}
                    >
                      <strong>{tr(`${c.name} · ${c.bargeIds.length} barges`, `${c.name} · ${c.bargeIds.length} barcazas`)}</strong>
                      <span>
                        {off
                          ? tr(`No link · last seen ${fmtDuration(now - new Date(c.lastSeen).getTime())} ago`, `Sin enlace · visto hace ${fmtDuration(now - new Date(c.lastSeen).getTime())}`)
                          : top
                            ? `${top.priority} · ${uc ? (es ? uc.nameEs : uc.name) : top.title}`
                            : `${c.linkLabel} · ${positionText(c.positionLabel, state.lang, c.link !== 'none')}`}
                      </span>
                    </Link>
                  )}
                </span>
              );
            })}
        </div>

        <div role="group" aria-label={tr('Zoom', 'Zoom')} className="ops-map__zoom">
          <button type="button" aria-label={tr('Zoom in', 'Acercar')} onClick={() => setZoom((z) => Math.min(2, z + 0.25))} disabled={zoom >= 2}>
            <Icon name="plus" size={18} />
          </button>
          <button type="button" aria-label={tr('Zoom out', 'Alejar')} onClick={() => setZoom((z) => Math.max(1, z - 0.25))} disabled={zoom <= 1}>
            <Icon name="minus" size={18} />
          </button>
        </div>

        {layers.legend && (
          <div className="ops-map__legend">
            <span>
              <span className="dot dot--bad" /> {tr('Alarm open', 'Alarma abierta')}
            </span>
            <span>
              <span className="dot" style={{ background: 'var(--navy)' }} /> {tr('Reporting', 'Reportando')}
            </span>
            <span>
              <span className="dot dot--idle" /> {tr('No link', 'Sin enlace')}
            </span>
            <span>
              <span style={{ width: 14, height: 2, background: 'var(--brand)' }} /> {tr('Service route', 'Ruta de servicio')}
            </span>
            {layers.coverage && (
              <span>
                <span className="ops-map__gap-key" /> {tr('No 4G coverage', 'Sin cobertura 4G')}
              </span>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
