import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { PageHeader, Segmented, Stat } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useApp } from '../../state/AppState';
import { useFleet } from '../../state/fleetStore';
import { roles } from '../../data/users';
import type { AuditCategory, AuditEntry } from '../../data/types';
import { TZ, fmtDay, fmtTime, fmtTimeSec, scenarioNow, useNow } from '../../lib/time';
import { shortHash } from '../../lib/hash';
import { useTr } from '../../lib/i18n';
import { useExporter } from '../../lib/exporting';
import {
  CATEGORIES,
  CATEGORY_LABEL,
  OBJECT_TYPES,
  OBJECT_TYPE_LABEL,
  entryId,
  objectTypeOf,
  tamperedCopyCheck,
  verifyChain,
  type ChainResult,
  type ObjectType,
  type TamperCase,
} from './auditChain';
import { Spinner, useFullDate, useNum } from './adminKit';
import './AuditLog.css';

type Range = 'today' | '7d' | '30d';

const RANGE_LABEL: Record<Range, [string, string]> = { today: ['Today', 'Hoy'], '7d': ['7 days', '7 días'], '30d': ['30 days', '30 días'] };

/**
 * Entries in the range that are not part of the demo's loaded sample. The design's
 * totals (1,842 today, 312 video views…) are these baselines plus what is loaded.
 */
const BASELINE: Record<Range, { total: number; views: number; exports: number; config: number; failed: number }> = {
  today: { total: 1824, views: 310, exports: 6, config: 2, failed: 0 },
  '7d': { total: 12_388, views: 2_106, exports: 40, config: 16, failed: 3 },
  '30d': { total: 51_912, views: 8_890, exports: 165, config: 69, failed: 10 },
};

const PAGE_SIZE = 20;
const HOUR = 3_600_000;

const isVideoView = (e: AuditEntry) => e.category === 'view' && /live|clip|video/i.test(e.action);
const isConfigChange = (e: AuditEntry) => e.category === 'config' && !/^(verified|tested|synced|requested|opened|withdrew)/i.test(e.action);
const isMonoId = (t: string) => /^[A-Z0-9]+-[A-Z0-9-]+$/.test(t);

/** Recorded failure details shown in a stat foot, in Spanish. */
const DETAIL_ES: Record<string, string> = { 'Wrong MFA code': 'Código MFA incorrecto' };

/** YYYY-MM-DD in Asunción, for file names. */
const isoDay = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
/** 2026-10-15 14:36:02, Asunción time, for the CSV (seed and live entries store different ISO forms). */
const localStamp = (v: string) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(v));

interface Filters {
  q: string;
  actor: string;
  category: '' | AuditCategory;
  object: '' | ObjectType;
  convoy: string;
  result: '' | 'ok' | 'failed';
}

const NO_FILTERS: Filters = { q: '', actor: '', category: '', object: '', convoy: '', result: '' };

type Verify = { state: 'scheduled' } | { state: 'running' } | { state: 'done'; at: number; result: ChainResult };

type Tr = (en: string, es: string) => string;

/** Role names are labels, so they follow the language; the rest of an entry stays as recorded. */
function roleLabel(role: string, tr: Tr) {
  if (role === 'Automated') return tr('Automated', 'Automático');
  const r = roles.find((x) => x.name === role);
  return r ? tr(r.name, r.nameEs) : role;
}

/** ADM-03: append-only, hash-chained record of every view, download and change. */
export function AuditLogPage() {
  const { state, log, toast } = useApp();
  const tr = useTr();
  const num = useNum();
  const fleet = useFleet();
  const ex = useExporter();
  const audit = state.audit;
  const now = useNow(15_000);
  const [range, setRange] = useState<Range>('today');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [selectedSeq, setSelectedSeq] = useState<number>(18_407);
  const [verify, setVerify] = useState<Verify>({ state: 'scheduled' });
  const [tamper, setTamper] = useState<TamperCase | null>(null);

  // Opening the audit log is itself logged, once per visit.
  const viewLogged = useRef(false);
  useEffect(() => {
    if (viewLogged.current) return;
    viewLogged.current = true;
    log('Viewed audit log', 'Audit log', 'Today, newest first');
  }, [log]);

  const rangeName = (r: Range) => tr(...RANGE_LABEL[r]);
  const catName = (c: AuditCategory) => tr(...CATEGORY_LABEL[c]);
  const objName = (o: ObjectType) => tr(...OBJECT_TYPE_LABEL[o]);
  const resultName = (r?: 'ok' | 'failed') => (r === 'failed' ? tr('Failed', 'Fallido') : 'OK');

  const today = fmtDay(now);
  const inRange = useMemo(() => {
    const days = range === '7d' ? 7 : 30;
    return audit.filter((e) => (range === 'today' ? fmtDay(e.at) === today : new Date(e.at).getTime() >= now - days * 86_400_000));
    // `now` matters at day granularity for "today"; the 7 and 30 day windows move by minutes, which is fine to refresh with the audit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audit, range, today]);

  const rows = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return inRange.filter(
      (e) =>
        (!q ||
          [e.actor, e.role, e.action, e.target, e.details ?? '', e.source ?? '', entryId(e.seq)].some((s) => s.toLowerCase().includes(q))) &&
        (!filters.actor || e.actor === filters.actor) &&
        (!filters.category || e.category === filters.category) &&
        (!filters.object || objectTypeOf(e) === filters.object) &&
        (!filters.convoy || e.convoyId === filters.convoy) &&
        (!filters.result || (e.result ?? 'ok') === filters.result),
    );
  }, [inRange, filters]);

  const actors = useMemo(() => {
    const set = new Set(audit.map((e) => e.actor));
    return [...set].sort((a, b) => (a === 'System' ? 1 : b === 'System' ? -1 : a.localeCompare(b)));
  }, [audit]);

  // The hourly check: the chain as it stood at the last full hour, recomputed.
  const lastHour = Math.floor(now / HOUR) * HOUR;
  const hourly = useMemo(() => verifyChain(audit.filter((e) => new Date(e.at).getTime() <= lastHour)), [audit, lastHour]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageNow = Math.min(page, pages - 1);
  const pageRows = rows.slice(pageNow * PAGE_SIZE, pageNow * PAGE_SIZE + PAGE_SIZE);

  // Stats: sample baselines plus everything loaded in the range (live entries included).
  const base = BASELINE[range];
  const views = inRange.filter(isVideoView).length;
  const exportsList = inRange.filter((e) => e.category === 'export');
  const configList = inRange.filter(isConfigChange);
  const drafts = configList.filter((e) => /draft/i.test(e.action)).length;
  const configTotal = base.config + configList.length;
  const failedList = inRange.filter((e) => e.category === 'signin' && e.result === 'failed');
  const total = base.total + inRange.length;

  const filtersActive = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const setFilter = <K extends keyof Filters>(k: K, v: Filters[K]) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(0);
  };

  const selected = audit.find((e) => e.seq === selectedSeq) ?? audit[0];

  const shown: ChainResult = verify.state === 'done' ? verify.result : hourly;
  const shownAt = verify.state === 'done' ? verify.at : lastHour;
  const chainBroken = verify.state !== 'running' && !shown.ok;
  const chainLabel =
    verify.state === 'running'
      ? tr('Verifying hash chain…', 'Verificando la cadena de hashes…')
      : shown.ok
        ? tr(`Hash chain verified ${fmtTime(shownAt)}`, `Cadena de hashes verificada ${fmtTime(shownAt)}`)
        : tr(`Chain broken at seq ${shown.brokenSeq}`, `Cadena rota en la secuencia ${shown.brokenSeq}`);

  const runVerify = () => {
    setVerify({ state: 'running' });
    // Snapshot the chain as it is now; the check itself is synchronous.
    const snapshot = audit;
    window.setTimeout(() => {
      const result = verifyChain(snapshot);
      setVerify({ state: 'done', at: scenarioNow(), result });
      if (result.ok) {
        log('Verified audit chain', `Entries ${result.first} to ${result.last}`, 'Intact');
        toast(
          tr(
            `Chain intact. ${result.count} entries recomputed, ${result.first} to ${result.last}.`,
            `Cadena intacta. ${result.count} entradas recalculadas, de la ${result.first} a la ${result.last}.`,
          ),
        );
      } else {
        log('Verified audit chain', `Broken at seq ${result.brokenSeq}`, result.reason);
        toast(tr(`Chain broken at seq ${result.brokenSeq}: ${result.reason}.`, `Cadena rota en la secuencia ${result.brokenSeq}: ${result.reasonEs}.`));
      }
    }, 700);
  };

  const runTamperDemo = () => {
    if (!selected) return;
    const c = tamperedCopyCheck(audit, selected.seq);
    if (!c) return;
    setTamper(c);
    log(
      'Verified tampered copy (demo)',
      `Copy of entries ${audit[audit.length - 1]?.seq} to ${audit[0]?.seq}`,
      `Seq ${c.edit.seq} ${c.edit.field} altered in the copy · ${c.edited.ok ? 'not detected' : `broken at seq ${c.edited.brokenSeq}`} · real log unchanged`,
    );
  };

  const exportCsv = () => {
    const header = [
      tr('Entry ID', 'ID de entrada'),
      tr('Seq', 'Secuencia'),
      tr('Time (Asunción)', 'Hora (Asunción)'),
      tr('Actor', 'Actor'),
      tr('Role', 'Rol'),
      tr('Action', 'Acción'),
      tr('Category', 'Categoría'),
      tr('Object', 'Objeto'),
      tr('Object type', 'Tipo de objeto'),
      tr('Details', 'Detalles'),
      tr('Source', 'Origen'),
      tr('Convoy', 'Convoy'),
      tr('Result', 'Resultado'),
      tr('Hash', 'Hash'),
      tr('Previous hash', 'Hash anterior'),
    ];
    const body = rows.map((e) => [
      entryId(e.seq),
      e.seq,
      localStamp(e.at),
      e.actor,
      roleLabel(e.role, tr),
      e.action,
      e.category ? catName(e.category) : '',
      e.target,
      objName(objectTypeOf(e)),
      e.details ?? '',
      e.source ?? '',
      fleet.convoyById(e.convoyId)?.name ?? '',
      resultName(e.result),
      e.hash,
      e.prevHash,
    ]);
    const file = `audit-log_${isoDay(now)}_${range}${filtersActive ? '_filtered' : ''}.csv`;
    ex.csv(file, [header, ...body], {
      action: 'Exported audit log',
      target: `${rows.length} entries · ${RANGE_LABEL[range][0]}${filtersActive ? ' · filtered' : ''}`,
      details: 'CSV',
      toast: [
        `${file} downloaded, ${rows.length} entries. The export is itself logged.`,
        `${file} descargado, ${rows.length} entradas. La exportación queda en el registro.`,
      ],
    });
  };

  const toggleRow = (seq: number) => {
    setSelectedSeq(seq);
    setTamper(null);
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(seq)) n.delete(seq);
      else n.add(seq);
      return n;
    });
  };

  const failedFoot = failedList[0]
    ? tr(`${failedList[0].details ?? 'Failed'}, not locked`, `${DETAIL_ES[failedList[0].details ?? ''] ?? failedList[0].details ?? 'Fallido'}, sin bloqueo`)
    : tr('None in the loaded entries', 'Ninguno en las entradas cargadas');

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tr('Administration', 'Administración'), to: '/admin/users' }]}
        title={tr('Audit log', 'Registro de auditoría')}
        sub={tr('Every view, download and change · append-only · kept 12 months', 'Cada visualización, descarga y cambio · solo se agrega · se conserva 12 meses')}
        actions={
          <>
            <Segmented<Range>
              label={tr('Time range', 'Período')}
              value={range}
              onChange={(r) => {
                setRange(r);
                setPage(0);
              }}
              options={(['today', '7d', '30d'] as Range[]).map((r) => ({ value: r, label: rangeName(r) }))}
            />
            <button
              type="button"
              className="btn"
              onClick={exportCsv}
              disabled={rows.length === 0}
              title={rows.length === 0 ? tr('No entries match: clear the filters to export', 'Ninguna entrada coincide: quite los filtros para exportar') : undefined}
            >
              <Icon name="download" size={16} /> {tr('Export CSV', 'Exportar CSV')}
            </button>
          </>
        }
      />

      <div className="stat-grid">
        <Stat
          label={range === 'today' ? tr('Entries today', 'Entradas hoy') : tr(`Entries, ${RANGE_LABEL[range][0]}`, `Entradas, ${RANGE_LABEL[range][1]}`)}
          value={num(total)}
          foot={
            <span className="audl-chain-foot">
              <Icon name={chainBroken ? 'alert' : 'shield'} size={14} />
              {chainLabel}
            </span>
          }
          footTone={chainBroken ? 'bad' : 'ok'}
        />
        <Stat label={tr('Video views', 'Visualizaciones de video')} value={num(base.views + views)} foot={tr('Live and clips', 'En vivo y clips')} />
        <Stat
          label={tr('Exports', 'Exportaciones')}
          value={num(base.exports + exportsList.length)}
          foot={tr('Clips and PDFs watermarked', 'Clips y PDF con marca de agua')}
        />
        <Stat
          label={tr('Configuration changes', 'Cambios de configuración')}
          value={num(configTotal)}
          foot={tr(
            `${drafts} draft${drafts === 1 ? '' : 's'}, ${configTotal - drafts} saved`,
            `${drafts} borrador${drafts === 1 ? '' : 'es'}, ${configTotal - drafts} guardado${configTotal - drafts === 1 ? '' : 's'}`,
          )}
        />
        <Stat label={tr('Failed sign-ins', 'Inicios de sesión fallidos')} value={num(base.failed + failedList.length)} foot={failedFoot} />
      </div>

      <div role="search" aria-label={tr('Filter entries', 'Filtrar entradas')} className="card audl-filters">
        <div className="audl-search">
          <Icon name="search" size={16} />
          <input
            type="search"
            className="input"
            aria-label={tr('Search actor, object or alarm ID', 'Buscar actor, objeto o ID de alarma')}
            placeholder={tr('Search actor, object or alarm ID', 'Buscar actor, objeto o ID de alarma')}
            value={filters.q}
            onChange={(e) => setFilter('q', e.target.value)}
          />
        </div>
        <select className="select audl-select" aria-label={tr('Actor', 'Actor')} value={filters.actor} onChange={(e) => setFilter('actor', e.target.value)}>
          <option value="">{tr('All actors', 'Todos los actores')}</option>
          {actors.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select
          className="select audl-select"
          aria-label={tr('Action', 'Acción')}
          value={filters.category}
          onChange={(e) => setFilter('category', e.target.value as Filters['category'])}
        >
          <option value="">{tr('All actions', 'Todas las acciones')}</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {catName(c)}
            </option>
          ))}
        </select>
        <select
          className="select audl-select"
          aria-label={tr('Object', 'Objeto')}
          value={filters.object}
          onChange={(e) => setFilter('object', e.target.value as Filters['object'])}
        >
          <option value="">{tr('All objects', 'Todos los objetos')}</option>
          {OBJECT_TYPES.map((o) => (
            <option key={o} value={o}>
              {objName(o)}
            </option>
          ))}
        </select>
        <select className="select audl-select" aria-label={tr('Convoy', 'Convoy')} value={filters.convoy} onChange={(e) => setFilter('convoy', e.target.value)}>
          <option value="">{tr('All convoys', 'Todos los convoyes')}</option>
          {fleet.convoys.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          className="select audl-select"
          aria-label={tr('Result', 'Resultado')}
          value={filters.result}
          onChange={(e) => setFilter('result', e.target.value as Filters['result'])}
        >
          <option value="">{tr('All results', 'Todos los resultados')}</option>
          <option value="ok">OK</option>
          <option value="failed">{tr('Failed', 'Fallido')}</option>
        </select>
        <button
          type="button"
          className="btn btn--ghost audl-clear"
          disabled={!filtersActive}
          title={filtersActive ? undefined : tr('No filters set', 'No hay filtros')}
          onClick={() => {
            setFilters(NO_FILTERS);
            setPage(0);
          }}
        >
          {tr('Clear filters', 'Quitar filtros')}
        </button>
      </div>

      <div className="row">
        <section aria-labelledby="audl-entries-title" className="card audl-entries">
          <div className="card__head">
            <div className="card__title">
              <h2 id="audl-entries-title">{tr('Entries', 'Entradas')}</h2>
              <span className="card__hint">
                {tr(
                  `Newest first · ${rows.length} ${rows.length === 1 ? 'match' : 'matches'}`,
                  `Más recientes primero · ${rows.length} ${rows.length === 1 ? 'coincidencia' : 'coincidencias'}`,
                )}
              </span>
            </div>
          </div>
          <div className="table-wrap">
            {rows.length === 0 ? (
              <div className="empty">
                {tr(
                  `No entries match these filters in ${RANGE_LABEL[range][0].toLowerCase()}.`,
                  `Ninguna entrada coincide con estos filtros en ${range === 'today' ? 'el día de hoy' : `los últimos ${RANGE_LABEL[range][1]}`}.`,
                )}
              </div>
            ) : (
              <table className="table num audl-table">
                <colgroup>
                  <col style={{ width: 108 }} />
                  <col style={{ width: 150 }} />
                  <col style={{ width: 130 }} />
                  <col style={{ width: 140 }} />
                  <col />
                  <col style={{ width: 110 }} />
                  <col style={{ width: 92 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">{tr('Time', 'Hora')}</th>
                    <th scope="col">{tr('Actor', 'Actor')}</th>
                    <th scope="col">{tr('Action', 'Acción')}</th>
                    <th scope="col">{tr('Object', 'Objeto')}</th>
                    <th scope="col">{tr('Details', 'Detalles')}</th>
                    <th scope="col">{tr('Source', 'Origen')}</th>
                    <th scope="col">{tr('Result', 'Resultado')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((e) => {
                    const open = expanded.has(e.seq);
                    const isSel = selected?.seq === e.seq;
                    return (
                      <Fragment key={e.seq}>
                        <tr className={isSel ? 'audl-row is-sel' : 'audl-row'} aria-selected={isSel}>
                          <td className="audl-time">
                            <button
                              type="button"
                              className="audl-time-btn mono"
                              aria-expanded={open}
                              aria-controls={`audl-exp-${e.seq}`}
                              aria-label={tr(
                                `${fmtTimeSec(e.at)}, ${e.action}, ${open ? 'hide' : 'show'} chain details`,
                                `${fmtTimeSec(e.at)}, ${e.action}, ${open ? 'ocultar' : 'mostrar'} detalles de la cadena`,
                              )}
                              onClick={() => toggleRow(e.seq)}
                            >
                              <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
                              {range === 'today' ? fmtTimeSec(e.at) : `${fmtDay(e.at)} ${fmtTimeSec(e.at)}`}
                            </button>
                          </td>
                          <td className="audl-nowrap">
                            <span className="audl-actor">{e.actor}</span>
                            <span className="sub">{roleLabel(e.role, tr)}</span>
                          </td>
                          <td>{e.action}</td>
                          <td className={isMonoId(e.target) ? 'mono audl-nowrap' : undefined}>{e.target}</td>
                          <td>{e.details ?? <span className="audl-muted">–</span>}</td>
                          <td className="audl-source">{e.source ?? '–'}</td>
                          <td>
                            {e.result === 'failed' ? (
                              <span className="badge badge--warn">
                                <Icon name="alert" size={13} /> {tr('Failed', 'Fallido')}
                              </span>
                            ) : (
                              <span className="audl-ok">
                                <Icon name="check" size={14} strokeWidth={2.4} /> OK
                              </span>
                            )}
                          </td>
                        </tr>
                        {open && (
                          <tr className="audl-exp" id={`audl-exp-${e.seq}`}>
                            <td colSpan={7}>
                              <dl className="audl-exp__dl">
                                <dt>{tr('Seq', 'Secuencia')}</dt>
                                <dd className="mono">
                                  {e.seq} · {entryId(e.seq)}
                                </dd>
                                <dt>{tr('Hash', 'Hash')}</dt>
                                <dd className="mono audl-hash">{e.hash}</dd>
                                <dt>{tr('Prev hash', 'Hash anterior')}</dt>
                                <dd className="mono audl-hash">{e.prevHash}</dd>
                                <dt>{tr('Chain', 'Cadena')}</dt>
                                <dd>
                                  <LinkStatus e={e} verify={verify} hourly={hourly} hourAt={lastHour} />
                                </dd>
                              </dl>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div className="audl-pager">
            <span>
              {tr(
                `Showing ${pageRows.length ? pageNow * PAGE_SIZE + 1 : 0}–${pageNow * PAGE_SIZE + pageRows.length} of ${rows.length} loaded · ${num(total)} in ${RANGE_LABEL[range][0].toLowerCase()} · entries are hash-chained`,
                `Mostrando ${pageRows.length ? pageNow * PAGE_SIZE + 1 : 0}–${pageNow * PAGE_SIZE + pageRows.length} de ${rows.length} cargadas · ${num(total)} en ${range === 'today' ? 'el día' : RANGE_LABEL[range][1]} · las entradas están encadenadas por hash`,
              )}
            </span>
            <nav aria-label={tr('Pagination', 'Paginación')} className="audl-pager__nav">
              <button
                type="button"
                className="btn btn--sm"
                disabled={pageNow === 0}
                title={pageNow === 0 ? tr('This is the first page', 'Esta es la primera página') : undefined}
                onClick={() => setPage(pageNow - 1)}
              >
                <Icon name="chevronLeft" size={16} /> {tr('Previous', 'Anterior')}
              </button>
              <button
                type="button"
                className="btn btn--sm"
                disabled={pageNow >= pages - 1}
                title={pageNow >= pages - 1 ? tr('This is the last page', 'Esta es la última página') : undefined}
                onClick={() => setPage(pageNow + 1)}
              >
                {tr('Next', 'Siguiente')} <Icon name="chevronRight" size={16} />
              </button>
            </nav>
          </div>
        </section>

        <section aria-labelledby="audl-entry-title" className="card audl-side">
          <div className="card__head">
            <div className="card__title">
              <h2 id="audl-entry-title">
                {tr('Entry', 'Entrada')} <span className="mono">{selected ? entryId(selected.seq) : '–'}</span>
              </h2>
              <span className="card__hint">{tr('Selected entry', 'Entrada seleccionada')}</span>
            </div>
          </div>
          <div className="audl-side__body">
            {selected && <EntryDetails e={selected} />}

            <div className="audl-check">
              <span className="audl-eyebrow">{tr('Chain check', 'Control de la cadena')}</span>
              <ChainStatus verify={verify} hourly={hourly} hourAt={lastHour} total={audit.length} />
              <button type="button" className="btn audl-full" onClick={runVerify} disabled={verify.state === 'running'}>
                {verify.state === 'running' ? <Spinner label={tr('Verifying', 'Verificando')} /> : <Icon name="shield" size={16} />}
                {verify.state === 'running' ? tr('Verifying…', 'Verificando…') : tr('Verify chain now', 'Verificar la cadena ahora')}
              </button>
            </div>

            <div className="audl-check">
              <span className="audl-eyebrow">{tr('Tamper check (demo)', 'Prueba de manipulación (demo)')}</span>
              <p className="audl-note">
                {tr(
                  'Alters the selected entry in a copy of the log and verifies the copy, to show where the chain breaks. The real log is not changed.',
                  'Altera la entrada seleccionada en una copia del registro y verifica la copia, para mostrar dónde se rompe la cadena. El registro real no cambia.',
                )}
              </p>
              <button type="button" className="btn audl-full" onClick={runTamperDemo} disabled={!selected}>
                <Icon name="edit" size={16} /> {tr('Check a tampered copy (demo)', 'Verificar una copia alterada (demo)')}
              </button>
              {tamper && <TamperResult c={tamper} onSelect={(seq) => setSelectedSeq(seq)} onClear={() => setTamper(null)} />}
            </div>

            <p className="audl-note">
              {tr(
                'The log cannot be edited or deleted from the console. Exports of the log are themselves logged.',
                'El registro no se puede editar ni borrar desde la consola. Las exportaciones del registro también quedan registradas.',
              )}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

function LinkStatus({ e, verify, hourly, hourAt }: { e: AuditEntry; verify: Verify; hourly: ChainResult; hourAt: number }) {
  const tr = useTr();
  if (verify.state === 'running') return <span className="audl-muted">{tr('Checking…', 'Verificando…')}</span>;
  const r = verify.state === 'done' ? verify.result : hourly;
  const at = verify.state === 'done' ? verify.at : hourAt;
  if (r.ok) {
    return e.seq <= r.last ? (
      <span className="audl-ok">
        <Icon name="check" size={14} strokeWidth={2.4} /> {tr(`Verified ${fmtTimeSec(at)}`, `Verificada ${fmtTimeSec(at)}`)}
      </span>
    ) : (
      <span className="audl-muted">
        {tr('Written after the last check · use Verify chain now', 'Escrita después del último control · use Verificar la cadena ahora')}
      </span>
    );
  }
  if (e.seq < r.brokenSeq) return <span className="audl-ok">{tr('Links to the previous entry', 'Enlaza con la entrada anterior')}</span>;
  if (e.seq === r.brokenSeq) return <span className="audl-bad">{tr(`Break detected here: ${r.reason}`, `Ruptura detectada aquí: ${r.reasonEs}`)}</span>;
  return <span className="audl-bad">{tr('After the break, not trusted', 'Después de la ruptura, no confiable')}</span>;
}

function ChainStatus({ verify, hourly, hourAt, total }: { verify: Verify; hourly: ChainResult; hourAt: number; total: number }) {
  const tr = useTr();
  const num = useNum();
  if (verify.state === 'running') {
    return (
      <div className="audl-chain" role="status">
        <Spinner />
        <span>{tr(`Recomputing ${total} hashes, oldest first…`, `Recalculando ${total} hashes, del más antiguo al más nuevo…`)}</span>
      </div>
    );
  }
  const r = verify.state === 'done' ? verify.result : hourly;
  const at = verify.state === 'done' ? verify.at : hourAt;
  const when = verify.state === 'done' ? tr('verified at', 'verificada a las') : tr('hourly check, verified at', 'control horario, verificada a las');
  return r.ok ? (
    <div className="audl-chain audl-chain--ok" role="status">
      <Icon name="shield" size={18} />
      <span>
        <strong>{tr('Chain intact', 'Cadena intacta')}</strong> ·{' '}
        {tr(`entries ${num(r.first)} to ${num(r.last)}`, `entradas ${num(r.first)} a ${num(r.last)}`)}{' '}
        <span className="audl-nowrap">
          {when} <span className="mono">{verify.state === 'done' ? fmtTimeSec(at) : fmtTime(at)}</span>
        </span>
      </span>
    </div>
  ) : (
    <div className="audl-chain audl-chain--bad" role="alert">
      <Icon name="alert" size={18} />
      <span>
        <strong>{tr(`Chain broken at seq ${r.brokenSeq}`, `Cadena rota en la secuencia ${r.brokenSeq}`)}</strong> · {tr(r.reason, r.reasonEs)}.{' '}
        {tr(
          `${r.count} entries before it check out. Contact support and keep this page open.`,
          `Las ${r.count} entradas anteriores son correctas. Contacte a soporte y mantenga esta página abierta.`,
        )}
      </span>
    </div>
  );
}

function TamperResult({ c, onSelect, onClear }: { c: TamperCase; onSelect: (seq: number) => void; onClear: () => void }) {
  const tr = useTr();
  const fieldName = { actor: tr('actor', 'actor'), action: tr('action', 'acción'), target: tr('object', 'objeto') }[c.edit.field];
  const line = (r: ChainResult) =>
    r.ok
      ? tr('Not detected: the copy still verifies.', 'No detectado: la copia sigue verificando.')
      : tr(`Breaks at seq ${r.brokenSeq}: ${r.reason}.`, `Se rompe en la secuencia ${r.brokenSeq}: ${r.reasonEs}.`);
  return (
    <div className="audl-tamper" role="status">
      <p>
        <strong>{tr('In the copy', 'En la copia')}</strong>{' '}
        {tr(`entry ${c.edit.seq}: ${fieldName} changed from`, `entrada ${c.edit.seq}: ${fieldName} cambiado de`)} <q>{c.edit.from}</q>{' '}
        {tr('to', 'a')} <q>{c.edit.to}</q>.
      </p>
      <ol className="audl-tamper__steps">
        <li className={c.edited.ok ? undefined : 'is-bad'}>
          <span className="audl-tamper__label">{tr('Edited only', 'Solo editada')}</span>
          <span>{line(c.edited)}</span>
          <span className="audl-tamper__hash mono">
            {tr('stored', 'guardado')} {shortHash(c.storedHash)} · {tr('recomputed', 'recalculado')} {shortHash(c.recomputedHash)}
          </span>
        </li>
        {c.rehashed ? (
          <li className={c.rehashed.ok ? undefined : 'is-bad'}>
            <span className="audl-tamper__label">{tr('Edited and re-hashed', 'Editada y con hash recalculado')}</span>
            <span>{line(c.rehashed)}</span>
            {!c.rehashed.ok && (
              <span className="audl-tamper__hash">
                {tr('The next entry still points at the original hash.', 'La entrada siguiente sigue apuntando al hash original.')}
              </span>
            )}
          </li>
        ) : (
          <li>
            <span className="audl-tamper__label">{tr('Edited and re-hashed', 'Editada y con hash recalculado')}</span>
            <span>
              {tr(
                'Select an older entry to see how the next entry exposes a re-hashed edit.',
                'Seleccione una entrada anterior para ver cómo la siguiente expone una edición con hash recalculado.',
              )}
            </span>
          </li>
        )}
      </ol>
      <p className="audl-note">
        {tr('The real log was not changed and still verifies.', 'El registro real no cambió y sigue verificando.')}{' '}
        {!c.edited.ok && (
          <button type="button" className="audl-linkbtn" onClick={() => onSelect(c.edit.seq)}>
            {tr(`Show entry ${c.edit.seq}`, `Mostrar la entrada ${c.edit.seq}`)}
          </button>
        )}{' '}
        <button type="button" className="audl-linkbtn" onClick={onClear}>
          {tr('Hide demo result', 'Ocultar el resultado')}
        </button>
      </p>
    </div>
  );
}

function EntryDetails({ e }: { e: AuditEntry }) {
  const tr = useTr();
  const fleet = useFleet();
  const fullDate = useFullDate();
  const kept = new Date(e.at);
  kept.setFullYear(kept.getFullYear() + 1);
  const convoy = fleet.convoyById(e.convoyId);
  const type = objectTypeOf(e);
  return (
    <dl className="audl-dl">
      <dt>{tr('Time', 'Hora')}</dt>
      <dd>
        {fullDate(e.at)} <span className="mono">{fmtTimeSec(e.at)}</span>
      </dd>
      <dt>{tr('Actor', 'Actor')}</dt>
      <dd>
        {e.actor} · {roleLabel(e.role, tr)}
      </dd>
      <dt>{tr('Action', 'Acción')}</dt>
      <dd>
        {e.action}
        {e.category && <span className="audl-dd-sub">{tr(...CATEGORY_LABEL[e.category])}</span>}
      </dd>
      <dt>{tr('Object', 'Objeto')}</dt>
      <dd>
        {/^ALM-/.test(e.target) ? (
          <Link to={`/alarms/${e.target}`} className="mono">
            {e.target}
          </Link>
        ) : /^VOY-\d+-\d+$/.test(e.target) ? (
          <Link to={`/voyages/${e.target}`} className="mono">
            {e.target}
          </Link>
        ) : (
          <span className={isMonoId(e.target) ? 'mono' : undefined}>{e.target}</span>
        )}
        <span className="audl-dd-sub">{tr(...OBJECT_TYPE_LABEL[type])}</span>
      </dd>
      {e.details && (
        <>
          <dt>{tr('Details', 'Detalles')}</dt>
          <dd>{e.details}</dd>
        </>
      )}
      {convoy && (
        <>
          <dt>{tr('Convoy', 'Convoy')}</dt>
          <dd>{convoy.name}</dd>
        </>
      )}
      <dt>{tr('Source', 'Origen')}</dt>
      <dd>{e.source ?? '–'}</dd>
      <dt>{tr('Result', 'Resultado')}</dt>
      <dd>{e.result === 'failed' ? <span className="badge badge--warn">{tr('Failed', 'Fallido')}</span> : 'OK'}</dd>
      <dt>{tr('Seq', 'Secuencia')}</dt>
      <dd className="mono">{e.seq}</dd>
      <dt>{tr('Hash', 'Hash')}</dt>
      <dd className="mono" title={e.hash}>
        {shortHash(e.hash)}
      </dd>
      <dt>{tr('Prev hash', 'Hash anterior')}</dt>
      <dd className="mono" title={e.prevHash}>
        {shortHash(e.prevHash)}
      </dd>
      <dt>{tr('Kept until', 'Se conserva hasta')}</dt>
      <dd>{fullDate(kept)}</dd>
    </dl>
  );
}
