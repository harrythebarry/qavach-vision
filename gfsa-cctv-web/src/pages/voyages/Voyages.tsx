import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Priority, VoyageStatus } from '../../data/types';
import { Badge, Meter, PageHeader, PriorityBadge, Segmented, Stat, StatusDot, linkTone } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useApp, useInScope } from '../../state/AppState';
import { useFleet } from '../../state/fleetStore';
import { useExporter } from '../../lib/exporting';
import { useTr } from '../../lib/i18n';
import { slug } from '../../lib/download';
import { fmtDayTime, fmtDuration, useNow } from '../../lib/time';
import {
  allVoyageRecords,
  exceptionSummary,
  liveVoyage,
  nextCallText,
  positionText,
  roundStats,
  roundsFor,
  routeText,
  statusText,
} from './voyageData';
import './Voyages.css';

type Filter = 'all' | VoyageStatus;

const STATUS_LABEL: Record<VoyageStatus, [string, string]> = {
  under_way: ['Under way', 'Navegando'],
  in_port: ['In port', 'En puerto'],
  completed: ['Completed', 'Completado'],
};
const STATUS_ORDER: Record<VoyageStatus, number> = { under_way: 0, in_port: 1, completed: 2 };

/** VOY-01: voyages from Connect as under way, in port or completed. */
export function VoyagesPage() {
  const { state } = useApp();
  const tr = useTr();
  const fleet = useFleet();
  const inScope = useInScope();
  const ex = useExporter();
  const now = useNow(15_000);
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');

  const scoped = useMemo(() => allVoyageRecords().filter((r) => inScope(r.voyage.convoyId)), [inScope]);
  const scopeName = fleet.convoyById(state.scope)?.name;
  const scopeLabel = state.scope === 'all' ? tr('All convoys', 'Todos los convoyes') : tr(`${scopeName} convoy`, `Convoy ${scopeName}`);

  const rows = useMemo(
    () =>
      scoped.map((rec) => {
        const v = rec.voyage;
        const convoy = fleet.convoyById(v.convoyId);
        const live = liveVoyage(rec, { convoy, alarms: state.alarms, reviewEvents: state.reviewEvents, audit: state.audit, now });
        const rs = roundStats(roundsFor(rec, now, live.queuedAfter));
        const open = live.alarms.filter((a) => a.state !== 'closed');
        const top = open.map((a) => a.priority).sort()[0] as Priority | undefined;
        const diffs = rec.cargo.reduce((n, c) => n + c.differences.length, 0);
        return { v, rec, live, rs, open, top, diffs, convoy };
      }),
    [scoped, fleet, state.alarms, state.reviewEvents, state.audit, now],
  );

  const needle = q.trim().toLowerCase();
  const shown = rows
    .filter((r) => filter === 'all' || r.v.status === filter)
    .filter((r) => {
      if (!needle) return true;
      const barges = r.rec.barges.map((b) => b.name).join(' ');
      return `${r.v.id} ${r.v.route} ${routeText(r.v.route, tr)} ${r.convoy?.name ?? ''} ${barges} ${nextCallText(r.rec, tr)}`.toLowerCase().includes(needle);
    })
    .sort((a, b) => STATUS_ORDER[a.v.status] - STATUS_ORDER[b.v.status] || b.v.departedAt.localeCompare(a.v.departedAt));

  const count = (s: VoyageStatus) => scoped.filter((r) => r.voyage.status === s).length;
  const active = rows.filter((r) => r.v.status !== 'completed');
  const openAll = active.flatMap((r) => r.open);
  const openByP = (['P1', 'P2', 'P3', 'P4'] as const).map((p) => ({ p, n: openAll.filter((a) => a.priority === p).length })).filter((x) => x.n);
  const judged = active.reduce((n, r) => n + r.rs.judged, 0);
  const onTime = active.reduce((n, r) => n + r.rs.onTime, 0);
  const overdue = active.reduce((n, r) => n + r.rs.overdue, 0);
  const diffsActive = active.reduce((n, r) => n + r.diffs, 0);
  const offline = active.filter((r) => r.live.offline);
  const filterLabel = filter === 'all' ? tr('all', 'todos') : tr(...STATUS_LABEL[filter]).toLowerCase();

  const exportCsv = () => {
    ex.csv(
      `${slug(tr('voyages', 'viajes'))}-${slug(scopeLabel)}${filter !== 'all' ? `-${filter.replace('_', '-')}` : ''}.csv`,
      [
        [
          tr('Voyage', 'Viaje'),
          tr('Route', 'Ruta'),
          tr('Convoy', 'Convoy'),
          tr('Barges', 'Barcazas'),
          tr('Status', 'Estado'),
          tr('Departed', 'Salida'),
          tr('Next call', 'Próxima escala'),
          tr('Link to shore', 'Enlace con tierra'),
          tr('Events', 'Eventos'),
          tr('Waiting for review', 'Pendientes de revisión'),
          tr('Queued on board', 'En cola a bordo'),
          tr('Arrived late', 'Llegaron tarde'),
          tr('Open alarms', 'Alarmas abiertas'),
          tr('Highest open priority', 'Prioridad abierta más alta'),
          tr('Reefer rounds on time', 'Rondas de reefers a tiempo'),
          tr('Reefer rounds checked', 'Rondas de reefers controladas'),
          tr('Round exceptions', 'Excepciones de rondas'),
          tr('Cargo differences', 'Diferencias de carga'),
        ],
        ...shown.map(({ v, rec, live, rs, open, top, diffs, convoy }) => [
          v.id,
          routeText(v.route, tr),
          convoy?.name,
          rec.barges.map((b) => b.name).join(' · '),
          statusText(rec, live, now, tr),
          fmtDayTime(rec.departure),
          nextCallText(rec, tr),
          v.status === 'completed' ? '' : live.offline ? tr(`None since ${fmtDayTime(live.queuedAfter!)}`, `Sin enlace desde ${fmtDayTime(live.queuedAfter!)}`) : convoy?.linkLabel,
          live.events.length,
          live.toReview,
          live.queuedEvents,
          live.arrivedLate,
          open.length,
          top ?? '',
          rs.onTime,
          rs.judged,
          exceptionSummary(rs, tr),
          diffs,
        ]),
      ],
      { action: 'Exported voyages', target: `${scopeLabel} · ${filter}`, details: `${shown.length} voyages${needle ? ` · search "${q.trim()}"` : ''}` },
    );
  };

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tr('Operations', 'Operaciones'), to: '/' }]}
        title={tr('Voyages', 'Viajes')}
        sub={tr(
          `From Connect · ${scopeLabel} · ${count('under_way')} under way, ${count('in_port')} in port, ${count('completed')} completed`,
          `Desde Connect · ${scopeLabel} · ${count('under_way')} navegando, ${count('in_port')} en puerto, ${count('completed')} completados`,
        )}
        actions={
          <button type="button" className="btn" onClick={exportCsv} disabled={!shown.length} title={shown.length ? undefined : tr('No voyages match the filter', 'Ningún viaje coincide con el filtro')}>
            <Icon name="download" size={16} /> {tr('Export CSV', 'Exportar CSV')}
          </button>
        }
      />

      <div className="stat-grid">
        <Stat
          label={tr('Under way', 'Navegando')}
          value={count('under_way')}
          aside={tr(`${count('in_port')} in port`, `${count('in_port')} en puerto`)}
          foot={
            offline.length
              ? offline.map((r) => tr(`${r.convoy?.name} out of coverage`, `${r.convoy?.name} sin cobertura`)).join(' · ')
              : tr('All convoys reporting', 'Todos los convoyes reportan')
          }
          footTone={offline.length ? 'bad' : undefined}
        />
        <Stat
          label={tr('Open alarms on active voyages', 'Alarmas abiertas en viajes activos')}
          value={openAll.length}
          aside={openByP.map((x) => `${x.n} ${x.p}`).join(' · ') || tr('None', 'Ninguna')}
        >
          {openAll.length > 0 && (
            <span aria-hidden="true" className="voy-prio-bar">
              {openByP.map((x) => (
                <span key={x.p} style={{ flex: x.n }} className={`voy-prio-bar__${x.p.toLowerCase()}`} />
              ))}
            </span>
          )}
        </Stat>
        <Stat
          label={tr('Reefer rounds on time', 'Rondas de reefers a tiempo')}
          value={tr(`${onTime} of ${judged}`, `${onTime} de ${judged}`)}
          aside={tr('active voyages', 'viajes activos')}
          foot={overdue ? tr(`${overdue} overdue now`, `${overdue} vencida${overdue === 1 ? '' : 's'} ahora`) : tr('None overdue', 'Ninguna vencida')}
          footTone={overdue ? 'bad' : 'ok'}
        />
        <Stat
          label={tr('Cargo differences', 'Diferencias de carga')}
          value={diffsActive}
          aside={tr('active voyages', 'viajes activos')}
          foot={diffsActive ? tr('Sent to Connect', 'Enviadas a Connect') : tr('Every barge matches its cargo list', 'Todas las barcazas coinciden con su lista de carga')}
        />
      </div>

      <section className="card" aria-labelledby="voy-list-title">
        <div className="card__head voy-card-head-wrap">
          <div className="card__title">
            <h2 id="voy-list-title">{tr('Voyages from Connect', 'Viajes desde Connect')}</h2>
            <span className="card__hint">
              {tr(
                `${shown.length} shown · synced every 5 min · select a row to open the voyage record`,
                `${shown.length} mostrados · sincronizados cada 5 min · seleccione una fila para abrir el registro del viaje`,
              )}
            </span>
          </div>
        </div>
        <div className="voy-toolbar voy-toolbar--inset">
          <Segmented<Filter>
            label={tr('Voyage status', 'Estado del viaje')}
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: tr(`All ${scoped.length}`, `Todos ${scoped.length}`) },
              { value: 'under_way', label: tr(`Under way ${count('under_way')}`, `Navegando ${count('under_way')}`) },
              { value: 'in_port', label: tr(`In port ${count('in_port')}`, `En puerto ${count('in_port')}`) },
              { value: 'completed', label: tr(`Completed ${count('completed')}`, `Completados ${count('completed')}`) },
            ]}
          />
          <label className="voy-search voy-search--wide">
            <Icon name="search" size={16} strokeWidth={2} />
            <span className="sr-only">{tr('Search voyages', 'Buscar viajes')}</span>
            <input
              type="search"
              placeholder={tr('Search voyage, convoy, barge or port', 'Buscar viaje, convoy, barcaza o puerto')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
        </div>
        <div className="table-wrap">
          {shown.length === 0 ? (
            <div className="empty">
              {needle
                ? tr(`No ${filterLabel === 'all' ? '' : `${filterLabel} `}voyages match “${q.trim()}” in this scope.`, `Ningún viaje ${filterLabel === 'todos' ? '' : `${filterLabel} `}coincide con “${q.trim()}” en este alcance.`)
                : tr(`No ${filterLabel} voyages in this scope.`, `No hay viajes ${filterLabel} en este alcance.`)}
            </div>
          ) : (
            <table className="table num voy-list" style={{ minWidth: 1040 }}>
              <thead>
                <tr>
                  <th scope="col">{tr('Voyage', 'Viaje')}</th>
                  <th scope="col">{tr('Convoy', 'Convoy')}</th>
                  <th scope="col">{tr('Status', 'Estado')}</th>
                  <th scope="col">{tr('Departed', 'Salida')}</th>
                  <th scope="col">{tr('Next call', 'Próxima escala')}</th>
                  <th scope="col" className="right">
                    {tr('Events', 'Eventos')}
                  </th>
                  <th scope="col">{tr('Open alarms', 'Alarmas abiertas')}</th>
                  <th scope="col">{tr('Reefer rounds on time', 'Rondas de reefers a tiempo')}</th>
                  <th scope="col" className="right">
                    {tr('Cargo differences', 'Diferencias de carga')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ v, rec, live, rs, open, top, diffs, convoy }) => {
                  const pct = rs.judged ? (rs.onTime / rs.judged) * 100 : 100;
                  const status = statusText(rec, live, now, tr);
                  return (
                    <tr
                      key={v.id}
                      className={`clickable${top && top <= 'P2' ? ' is-alert' : ''}`}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('a')) return;
                        navigate(`/voyages/${v.id}`);
                      }}
                    >
                      <td>
                        <Link to={`/voyages/${v.id}`} className="strong-link mono">
                          {v.id}
                        </Link>
                        <span className="sub">{routeText(v.route, tr)}</span>
                      </td>
                      <td>
                        {convoy?.name}
                        <span className="sub">{rec.barges.map((b) => b.short).join(', ')}</span>
                        {v.status !== 'completed' && convoy && (
                          <span className="sub">
                            <StatusDot tone={linkTone(convoy.link)}>
                              {live.offline
                                ? tr(`No link · ${fmtDuration(now - live.queuedAfter!)}`, `Sin enlace · ${fmtDuration(now - live.queuedAfter!)}`)
                                : `${convoy.linkLabel} · ${positionText(convoy.positionLabel, tr, true)}`}
                            </StatusDot>
                          </span>
                        )}
                      </td>
                      <td>
                        <Badge tone={v.status === 'completed' ? 'neutral' : v.status === 'in_port' ? 'outline' : 'info'}>{tr(...STATUS_LABEL[v.status])}</Badge>
                        <span className="sub">{status.split(' · ').slice(1).join(' · ') || status}</span>
                      </td>
                      <td className="voy-nowrap">{fmtDayTime(rec.departure)}</td>
                      <td>{nextCallText(rec, tr)}</td>
                      <td className="right">
                        {live.events.length}
                        <span className="sub">{live.toReview ? tr(`${live.toReview} to review`, `${live.toReview} por revisar`) : tr('all reviewed', 'todos revisados')}</span>
                        {live.queuedEvents > 0 && <span className="sub">{tr(`+${live.queuedEvents} queued`, `+${live.queuedEvents} en cola`)}</span>}
                        {live.arrivedLate > 0 && <span className="sub">{tr(`${live.arrivedLate} arrived late`, `${live.arrivedLate} llegaron tarde`)}</span>}
                      </td>
                      <td>
                        {open.length ? (
                          <span className="with-dot">
                            {top && <PriorityBadge p={top} short />}
                            <strong>{open.length}</strong>
                          </span>
                        ) : (
                          <span className="voy-subtle">{tr('None', 'Ninguna')}</span>
                        )}
                      </td>
                      <td style={{ minWidth: 150 }}>
                        <strong>{tr(`${rs.onTime} of ${rs.judged}`, `${rs.onTime} de ${rs.judged}`)}</strong>
                        <Meter
                          pct={pct}
                          tone={rs.missed || rs.overdue ? 'bad' : rs.late ? 'warn' : undefined}
                          label={tr(`${v.id} reefer rounds on time`, `${v.id} rondas de reefers a tiempo`)}
                        />
                        <span className="sub">{exceptionSummary(rs, tr)}</span>
                      </td>
                      <td className="right">{diffs ? <Badge tone="warn">{diffs}</Badge> : <span className="voy-subtle">{tr('None', 'Ninguna')}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
