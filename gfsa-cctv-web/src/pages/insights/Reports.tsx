import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { voyages } from '../../data/alarms';
import { Badge, NoAccess, PageHeader, Segmented, Stat, Tabs } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useApp, useInScope } from '../../state/AppState';
import { useUsers } from '../../state/usersStore';
import type { Fleet } from '../../state/fleetStore';
import { allNav, canOpen } from '../../nav';
import { uid, usePersistentState } from '../../lib/persist';
import { useTr, type Lang } from '../../lib/i18n';
import { useExporter } from '../../lib/exporting';
import { fmtDay, fmtDayTime, scenarioNow } from '../../lib/time';
import { DAILY_MIN, shiftDate, shortDate, t, useCaseName } from './dailyData';
import {
  ARRIVAL_ONLY,
  DEFAULT_FREQ,
  LANG_TEXT,
  SCOPE_TEXT,
  STATUS_TEXT,
  WEEKDAYS,
  initialLibrary,
  initialSchedules,
  isoWeek,
  nextRunText,
  parseNextCall,
  periodText,
  recipientsFrom,
  sentToText,
  subjectText,
  templateById,
  templateName,
  templates,
  voyageNote,
  whenText,
  type Frequency,
  type LibraryReport,
  type RPeriod,
  type Recipient,
  type Schedule,
  type ScheduleLang,
  type Subject,
  type TemplateId,
} from './reportsData';
import { reportContent, sampleContent, type ReportCtx } from './reportContent';
import { InsightsDialog, dateOf, useLeaveGuard } from './insightsUtil';
import { useInsightsData } from './useInsightsData';
import './Reports.css';

type Tab = 'library' | 'schedules' | 'templates';
type PeriodFilter = '30d' | '7d' | 'quarter' | 'all';

const PAGE = 10;
const DAY = 86_400_000;

const reportsNav = allNav.find((n) => n.to === '/reports')!;
const voyagesNav = allNav.find((n) => n.to === '/voyages')!;
const modelsNav = allNav.find((n) => n.to === '/insights/models')!;
const auditNav = allNav.find((n) => n.to === '/admin/audit')!;

type Counts = { convoys: number; cameras: number; camerasOf: (id: string) => number };
const countsOf = (fleet: Fleet): Counts => ({ convoys: fleet.convoys.length, cameras: fleet.cameras.length, camerasOf: (id) => fleet.camerasOf(id).length });

/** Everything the tabs need to show a report in a language. */
interface View {
  ctxFor: (lang: Lang) => ReportCtx;
  today: string;
  now: number;
  counts: Counts;
  recipients: Recipient[];
}

/** REP-01 to REP-03: report library, schedules and templates. */
export function ReportsPage() {
  const { state, log, toast } = useApp();
  const tr = useTr();
  const lang = state.lang;
  const ex = useExporter();
  const users = useUsers();
  const data = useInsightsData();
  const recipients = useMemo(() => recipientsFrom(users), [users]);
  const counts = useMemo(() => countsOf(data.fleet), [data.fleet]);
  const view: View = { ctxFor: data.ctxFor, today: data.today, now: data.now, counts, recipients };

  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: Tab = tabParam === 'schedules' || tabParam === 'templates' ? tabParam : 'library';
  const setTab = (v: Tab) => {
    const next = new URLSearchParams(params);
    if (v === 'library') next.delete('tab');
    else next.set('tab', v);
    setParams(next, { replace: true });
  };

  const [library, setLibrary] = usePersistentState<LibraryReport[]>('reports.library', initialLibrary);
  const [schedules, setSchedules] = usePersistentState<Schedule[]>('reports.schedules', initialSchedules);
  const [selectedId, setSelectedId] = useState('r01');
  const [scheduleDialog, setScheduleDialog] = useState<{ edit?: Schedule; template?: TemplateId } | null>(null);
  const [createDialog, setCreateDialog] = useState<{ template?: TemplateId } | null>(null);

  if (!canOpen(state.role, reportsNav)) return <NoAccess what={tr('reports', 'los informes')} />;

  const canEdit = state.role !== 'duty_officer';
  const readOnlyWhy = tr('Your role can read schedules but not change them. Managers and administrators can.', 'Su rol puede ver las programaciones pero no cambiarlas. Pueden hacerlo los gerentes y administradores.');

  /** Audit log object for a report (records stay in English). */
  const auditTarget = (r: LibraryReport) =>
    `${templateName(r.template, 'en')} · ${subjectText(r.subject, 'en', counts)} · ${periodText(r.period, 'en', data.today)}`;

  const download = (r: LibraryReport, docLang: Lang, toastText?: [string, string]) => {
    const c = reportContent(r, data.ctxFor(docLang));
    ex.pdf(c.file, { title: c.title, subtitle: c.subtitle, blocks: c.blocks }, {
      action: 'Downloaded report',
      target: auditTarget(r),
      details: `PDF ${docLang.toUpperCase()}${r.status === 'scheduled' ? ' · so far' : ''}`,
      toast: toastText,
    });
  };

  const downloadSample = (id: TemplateId) => {
    const fallback = makeReport(id, data.today, state.user.name, lang, data.fleet);
    const c = sampleContent(id, library, data.ctxFor(lang), fallback);
    ex.pdf(c.file, { title: c.title, subtitle: c.subtitle, blocks: c.blocks }, {
      action: 'Downloaded report sample',
      target: `${templateName(id, 'en')} template`,
      details: `PDF ${lang.toUpperCase()}`,
      note: tr('Sample', 'Muestra'),
    });
  };

  const toggleSchedule = (id: string) => {
    const s = schedules.find((x) => x.id === id);
    if (!s || !canEdit) return;
    const name = templateName(s.template, lang);
    setSchedules((all) => all.map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x)));
    log(s.enabled ? 'Turned off report schedule' : 'Turned on report schedule', `${templateName(s.template, 'en')} · ${whenText(s, (en) => en)}`);
    toast(
      s.enabled
        ? tr(`${name} schedule turned off. Nothing is sent until you turn it back on.`, `Programación de ${name} desactivada. No se envía nada hasta que la vuelva a activar.`)
        : tr(`${name} schedule turned on. Next run ${nextRunText(s, data.now, tr)} Asunción.`, `Programación de ${name} activada. Próximo envío ${nextRunText(s, data.now, tr)} hora de Asunción.`),
    );
  };

  const saveSchedule = (s: Schedule, isNew: boolean) => {
    const name = templateName(s.template, lang);
    setSchedules((all) => (isNew ? [...all, s] : all.map((x) => (x.id === s.id ? s : x))));
    log(isNew ? 'Added report schedule' : 'Changed report schedule', `${templateName(s.template, 'en')} · ${whenText(s, (en) => en)} · ${s.recipients.length} recipients`);
    const next = s.enabled ? tr(`Next run ${nextRunText(s, data.now, tr)} Asunción.`, `Próximo envío ${nextRunText(s, data.now, tr)} hora de Asunción.`) : tr('It is off.', 'Está desactivada.');
    toast(isNew ? tr(`${name} schedule added. ${next}`, `Programación de ${name} agregada. ${next}`) : tr(`${name} schedule saved. ${next}`, `Programación de ${name} guardada. ${next}`));
    setScheduleDialog(null);
  };

  const deleteSchedule = (s: Schedule) => {
    const name = templateName(s.template, lang);
    setSchedules((all) => all.filter((x) => x.id !== s.id));
    log('Deleted report schedule', `${templateName(s.template, 'en')} · ${whenText(s, (en) => en)}`);
    toast(tr(`${name} schedule deleted. Reports already sent stay in the library.`, `Programación de ${name} eliminada. Los informes ya enviados quedan en la biblioteca.`));
    setScheduleDialog(null);
  };

  const addReport = (r: LibraryReport, docLang: Lang) => {
    setLibrary((all) => [r, ...all]);
    setSelectedId(r.id);
    log('Generated report', auditTarget(r), `On demand · ${docLang.toUpperCase()}`);
    const name = templateName(r.template, lang);
    const subject = subjectText(r.subject, lang, counts);
    const period = periodText(r.period, lang, data.today);
    download(r, docLang, [
      `${name} for ${subject}, ${period}, generated in ${docLang === 'es' ? 'Spanish' : 'English'} and downloaded with a watermark. It is at the top of the library and the download is in the audit log.`,
      `${name} de ${subject}, ${period}, generado en ${docLang === 'es' ? 'español' : 'inglés'} y descargado con marca de agua. Está al principio de la biblioteca y la descarga queda en el registro de auditoría.`,
    ]);
    setCreateDialog(null);
    setTab('library');
  };

  const onCount = schedules.filter((s) => s.enabled).length;

  return (
    <div className="page rep-page">
      <PageHeader
        crumbs={[{ label: tr('Insights', 'Análisis') }]}
        title={tr('Reports', 'Informes')}
        sub={tr('Daily, voyage and fleet reports, generated from reviewed events and sent on a schedule', 'Informes diarios, de viaje y de flota, generados a partir de eventos revisados y enviados según una programación')}
        actions={
          <>
            <button type="button" className="btn" disabled={!canEdit} title={canEdit ? undefined : readOnlyWhy} onClick={() => setScheduleDialog({})}>
              <Icon name="clock" size={16} /> {tr('Schedule a report', 'Programar un informe')}
            </button>
            <button type="button" className="btn btn--primary" onClick={() => setCreateDialog({})}>
              <Icon name="plus" size={16} /> {tr('Create report', 'Crear informe')}
            </button>
          </>
        }
      />

      <Tabs<Tab>
        label={tr('Reports', 'Informes')}
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'library', label: tr('Library', 'Biblioteca') },
          { value: 'schedules', label: tr('Schedules', 'Programaciones'), count: schedules.length },
          { value: 'templates', label: tr('Templates', 'Plantillas'), count: templates.length },
        ]}
      />

      {tab === 'library' && (
        <LibraryTab
          view={view}
          library={library}
          selectedId={selectedId}
          onSelect={setSelectedId}
          schedules={schedules}
          onToggle={toggleSchedule}
          canEdit={canEdit}
          readOnlyWhy={readOnlyWhy}
          onManage={() => setTab('schedules')}
          onTemplates={() => setTab('templates')}
          onDownload={download}
        />
      )}

      {tab === 'schedules' && (
        <SchedulesTab
          view={view}
          schedules={schedules}
          onCount={onCount}
          canEdit={canEdit}
          readOnlyWhy={readOnlyWhy}
          onToggle={toggleSchedule}
          onEdit={(s) => setScheduleDialog({ edit: s })}
          onAdd={() => setScheduleDialog({})}
        />
      )}

      {tab === 'templates' && (
        <TemplatesTab
          schedules={schedules}
          canEdit={canEdit}
          readOnlyWhy={readOnlyWhy}
          onSample={downloadSample}
          onSchedule={(id) => setScheduleDialog({ template: id })}
          onCreate={(id) => setCreateDialog({ template: id })}
        />
      )}

      {scheduleDialog && (
        <ScheduleDialog
          view={view}
          edit={scheduleDialog.edit}
          template={scheduleDialog.template}
          onClose={() => setScheduleDialog(null)}
          onSave={saveSchedule}
          onDelete={deleteSchedule}
        />
      )}
      {createDialog && <CreateDialog view={view} template={createDialog.template} onClose={() => setCreateDialog(null)} onCreate={addReport} />}
    </div>
  );
}

// =====================================================================
// Library
// =====================================================================

function LibraryTab({
  view,
  library,
  selectedId,
  onSelect,
  schedules,
  onToggle,
  canEdit,
  readOnlyWhy,
  onManage,
  onTemplates,
  onDownload,
}: {
  view: View;
  library: LibraryReport[];
  selectedId: string;
  onSelect: (id: string) => void;
  schedules: Schedule[];
  onToggle: (id: string) => void;
  canEdit: boolean;
  readOnlyWhy: string;
  onManage: () => void;
  onTemplates: () => void;
  onDownload: (r: LibraryReport, lang: Lang) => void;
}) {
  const { state } = useApp();
  const tr = useTr();
  const lang = state.lang;
  const inScope = useInScope();
  const fleet = view.ctxFor(lang).fleet;
  const [query, setQuery] = useState('');
  const [type, setType] = useState<'all' | TemplateId>('all');
  const [vessel, setVessel] = useState('all');
  const [period, setPeriod] = useState<PeriodFilter>('30d');
  const [page, setPage] = useState(0);
  const previewRef = useRef<HTMLElement>(null);

  const { now, today } = view;
  const yesterday = shiftDate(today, -1);
  const last30 = library.filter((r) => r.status === 'scheduled' || now - new Date(r.at).getTime() <= 30 * DAY);
  const recipientsReached = new Set(last30.filter((r) => r.status === 'sent').flatMap((r) => r.sentTo)).size;

  // Key figures, from the library and the daily history.
  const figures = useMemo(() => {
    const ctx = view.ctxFor(lang);
    const covered = new Set(library.filter((r) => r.template === 'daily' && r.status === 'sent' && dateOf(r.at) === today).flatMap((r) => r.vesselIds));
    const upRep: LibraryReport = { id: 'tile', template: 'camera_uptime', subject: { kind: 'cameras' }, vesselIds: [], period: { kind: 'day', date: yesterday }, at: new Date(now).toISOString(), status: 'generated', sentTo: [] };
    const uptime = reportContent(upRep, ctx).kpis[0]?.[1] ?? '–';
    let on = 0;
    let total = 0;
    for (let i = 1; i <= 7; i++)
      for (const v of fleet.vessels.filter((x) => x.kind === 'barge'))
        for (const q of ctx.summary(v.id, shiftDate(today, -i)).rounds ?? []) {
          total += 1;
          if (q.result === 'on_time') on += 1;
        }
    return { covered: covered.size, uptime, on, total };
  }, [view, lang, library, today, yesterday, now, fleet.vessels]);

  const label = (r: LibraryReport) => ({
    name: templateName(r.template, lang),
    subject: subjectText(r.subject, lang, view.counts),
    period: periodText(r.period, lang, today),
    sentTo: sentToText(r, lang),
    generated: r.status === 'scheduled' ? arrivalText(r, tr) : fmtDayTime(r.at),
    due: r.status === 'scheduled' ? tr(`due ${fmtDayTime(r.at)}`, `previsto ${fmtDayTime(r.at)}`) : undefined,
  });

  const rows = (() => {
    const q = query.trim().toLowerCase();
    const since = period === '7d' ? now - 7 * DAY : period === '30d' ? now - 30 * DAY : period === 'quarter' ? new Date('2026-10-01T00:00:00-03:00').getTime() : 0;
    return library.filter((r) => {
      if (r.vesselIds.length && !r.vesselIds.some((v) => inScope(fleet.vesselById(v)?.convoyId ?? ''))) return false;
      if (type !== 'all' && r.template !== type) return false;
      if (vessel !== 'all' && !r.vesselIds.includes(vessel)) return false;
      if (since && r.status !== 'scheduled' && new Date(r.at).getTime() < since) return false;
      if (q) {
        const l = label(r);
        const hay = `${templateName(r.template, 'en')} ${templateName(r.template, 'es')} ${l.subject} ${l.period} ${l.sentTo} ${l.generated}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  })();

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages - 1);
  const shown = rows.slice(current * PAGE, current * PAGE + PAGE);
  const selected = library.find((r) => r.id === selectedId) ?? rows[0];
  const nextCount = Math.min(PAGE, rows.length - (current + 1) * PAGE);

  const resetPage = () => setPage(0);
  const select = (id: string) => {
    onSelect(id);
    if (window.matchMedia?.('(max-width: 960px)').matches) {
      window.setTimeout(() => previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
    }
  };

  const onCount = schedules.filter((s) => s.enabled).length;
  const allCovered = figures.covered >= fleet.vessels.length;

  return (
    <>
      <div className="stat-grid">
        <Stat
          label={tr('Reports, last 30 days', 'Informes, últimos 30 días')}
          value={last30.length}
          foot={tr(`sent to ${recipientsReached} recipients`, `enviados a ${recipientsReached} destinatarios`)}
        />
        <Stat
          label={tr(`Daily summaries, ${fmtDay(now)}`, `Resúmenes diarios, ${fmtDay(now)}`)}
          value={tr(`${figures.covered} of ${fleet.vessels.length}`, `${figures.covered} de ${fleet.vessels.length}`)}
          aside={tr('one per tug and barge', 'uno por remolcador y barcaza')}
          foot={
            allCovered ? (
              <span className="ins-inline-icon">
                <Icon name="check" size={13} strokeWidth={2.4} /> {tr('sent 06:00 Asunción', 'enviados 06:00 hora de Asunción')}
              </span>
            ) : (
              tr(`${fleet.vessels.length - figures.covered} not sent yet`, `${fleet.vessels.length - figures.covered} sin enviar aún`)
            )
          }
          footTone={allCovered ? 'ok' : undefined}
        />
        <Stat
          label={tr(`Camera uptime, ${fmtDay(new Date(`${yesterday}T12:00:00-03:00`))}`, `Disponibilidad de cámaras, ${fmtDay(new Date(`${yesterday}T12:00:00-03:00`))}`)}
          value={figures.uptime}
          foot={tr(`fleet · ${fleet.cameras.length} cameras`, `flota · ${fleet.cameras.length} cámaras`)}
        />
        <Stat
          label={tr('Reefer rounds on time, 7 days', 'Rondas de reefers a tiempo, 7 días')}
          value={figures.total ? `${Math.round((figures.on / figures.total) * 100)}%` : '–'}
          foot={tr(`${figures.on} of ${figures.total}`, `${figures.on} de ${figures.total}`)}
        />
      </div>

      <div className="row">
        <section className="card grow rep-lib" aria-labelledby="rep-lib-title">
          <div className="card__head">
            <div className="card__title">
              <h2 id="rep-lib-title">{tr('Report library', 'Biblioteca de informes')}</h2>
              <span className="card__hint">{tr(`${last30.length} in the last 30 days · newest first`, `${last30.length} en los últimos 30 días · los más recientes primero`)}</span>
            </div>
            <button type="button" className="card__link rep-linkbtn" onClick={onTemplates}>
              {tr('Templates', 'Plantillas')}
            </button>
          </div>
          <div className="rep-filters">
            <label className="rep-search">
              <Icon name="search" size={16} />
              <span className="sr-only">{tr('Filter reports', 'Filtrar informes')}</span>
              <input
                type="search"
                placeholder={tr('Filter reports', 'Filtrar informes')}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  resetPage();
                }}
              />
            </label>
            <label className="rep-filter">
              {tr('Type', 'Tipo')}
              <select
                value={type}
                onChange={(e) => {
                  setType(e.target.value as 'all' | TemplateId);
                  resetPage();
                }}
              >
                <option value="all">{tr('All', 'Todos')}</option>
                {templates.map((tp) => (
                  <option key={tp.id} value={tp.id}>
                    {templateName(tp.id, lang)}
                  </option>
                ))}
              </select>
            </label>
            <label className="rep-filter">
              {tr('Vessel', 'Embarcación')}
              <select
                value={vessel}
                onChange={(e) => {
                  setVessel(e.target.value);
                  resetPage();
                }}
              >
                <option value="all">{tr('All', 'Todas')}</option>
                <VesselOptions fleet={fleet} />
              </select>
            </label>
            <label className="rep-filter">
              {tr('Period', 'Período')}
              <select
                value={period}
                onChange={(e) => {
                  setPeriod(e.target.value as PeriodFilter);
                  resetPage();
                }}
              >
                <option value="30d">{tr('Last 30 days', 'Últimos 30 días')}</option>
                <option value="7d">{tr('Last 7 days', 'Últimos 7 días')}</option>
                <option value="quarter">{tr('This quarter', 'Este trimestre')}</option>
                <option value="all">{tr('All', 'Todo')}</option>
              </select>
            </label>
          </div>
          <div className="table-wrap">
            <table className="table num rep-table">
              <thead>
                <tr>
                  <th scope="col">{tr('Report', 'Informe')}</th>
                  <th scope="col">{tr('Period', 'Período')}</th>
                  <th scope="col">{tr('Generated', 'Generado')}</th>
                  <th scope="col">{tr('Sent to', 'Enviado a')}</th>
                  <th scope="col">{tr('Status', 'Estado')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <div className="empty">{tr('No reports match these filters.', 'Ningún informe coincide con estos filtros.')}</div>
                    </td>
                  </tr>
                )}
                {shown.map((r) => {
                  const isSel = selected?.id === r.id;
                  const l = label(r);
                  return (
                    <tr key={r.id} className={`clickable${isSel ? ' rep-row--sel' : ''}`} onClick={() => select(r.id)}>
                      <td>
                        <button
                          type="button"
                          className="rep-title"
                          aria-pressed={isSel}
                          onClick={(e) => {
                            e.stopPropagation();
                            select(r.id);
                          }}
                        >
                          {l.name}
                        </button>
                        <span className="sub">
                          {l.subject.startsWith('VOY-') ? (
                            <>
                              <span className="mono">{l.subject.slice(0, 10)}</span>
                              {l.subject.slice(10)}
                            </>
                          ) : (
                            l.subject
                          )}
                        </span>
                      </td>
                      <td className="rep-nowrap">{l.period}</td>
                      <td className={r.status === 'scheduled' ? 'rep-due' : 'mono rep-nowrap'}>
                        {l.generated}
                        {l.due && <span className="sub rep-nowrap">{l.due}</span>}
                      </td>
                      <td>{l.sentTo}</td>
                      <td>
                        <StatusBadge status={r.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="rep-pager">
            <span>
              {rows.length === 0
                ? tr('No reports', 'Sin informes')
                : tr(`Showing ${current * PAGE + 1}–${current * PAGE + shown.length} of ${rows.length}`, `Mostrando ${current * PAGE + 1}–${current * PAGE + shown.length} de ${rows.length}`)}{' '}
              · {tr("PDF, in each recipient's language (Spanish or English)", 'PDF, en el idioma de cada destinatario (español o inglés)')}
            </span>
            <span className="rep-pager__btns">
              <button type="button" className="btn btn--sm" disabled={current === 0} onClick={() => setPage(current - 1)}>
                <Icon name="chevronLeft" size={16} />
                {tr('Previous', 'Anterior')}
              </button>
              <button type="button" className="btn btn--sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
                {tr('Next', 'Siguiente')} {nextCount > 0 ? nextCount : ''}
                <Icon name="chevronRight" size={16} />
              </button>
            </span>
          </div>
        </section>

        <div className="rep-side stack">
          {selected && <Preview report={selected} view={view} ref={previewRef} onDownload={onDownload} />}

          <section className="card" aria-labelledby="rep-sched-title">
            <div className="card__head">
              <div className="card__title">
                <h2 id="rep-sched-title">{tr('Schedules', 'Programaciones')}</h2>
                <span className="card__hint">{tr(`${onCount} on · Asunción time`, `${onCount} activas · hora de Asunción`)}</span>
              </div>
              <button type="button" className="card__link rep-linkbtn" onClick={onManage}>
                {tr('Manage', 'Administrar')}
              </button>
            </div>
            <ul className="rep-schedlist">
              {schedules.map((s) => (
                <li key={s.id}>
                  <span className="rep-schedlist__text">
                    <strong>{templateName(s.template, lang)}</strong>
                    <span>
                      {whenText(s, tr)}
                      {s.frequency !== 'arrival' ? tr(' Asunción', ' hora de Asunción') : ''} · {SCOPE_TEXT[s.scope][lang === 'es' ? 1 : 0].toLowerCase()}
                    </span>
                    <span>{recipientNames(s.recipients, view.recipients, lang)}</span>
                  </span>
                  <ScheduleSwitch s={s} onToggle={onToggle} disabled={!canEdit} why={readOnlyWhy} />
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}

function arrivalText(r: LibraryReport, tr: (en: string, es: string) => string): string {
  const v = voyages.find((x) => x.id === r.voyageId);
  const place = v ? parseNextCall(v.nextCall)?.place : undefined;
  return place ? tr(`At ${place} arrival`, `A la llegada a ${place}`) : tr('At arrival', 'A la llegada');
}

function VesselOptions({ fleet }: { fleet: Fleet }) {
  const tr = useTr();
  const inScope = useInScope();
  return (
    <>
      {fleet.convoys
        .filter((c) => inScope(c.id))
        .map((c) => (
          <optgroup key={c.id} label={tr(`${c.name} convoy`, `Convoy ${c.name}`)}>
            {fleet.vesselsOf(c.id).map((v) => (
              <option key={v.id} value={v.id}>
                {v.kind === 'tug' ? tr(`${v.name} (tug)`, `${v.name} (remolcador)`) : v.name}
              </option>
            ))}
          </optgroup>
        ))}
    </>
  );
}

function StatusBadge({ status }: { status: LibraryReport['status'] }) {
  const { state } = useApp();
  const text = STATUS_TEXT[status][state.lang === 'es' ? 1 : 0];
  if (status === 'sent')
    return (
      <Badge tone="ok">
        <Icon name="check" size={13} strokeWidth={2.4} />
        {text}
      </Badge>
    );
  if (status === 'scheduled')
    return (
      <Badge>
        <Icon name="clock" size={13} />
        {text}
      </Badge>
    );
  return (
    <Badge tone="info">
      <Icon name="file" size={13} />
      {text}
    </Badge>
  );
}

function recipientName(id: string, recipients: Recipient[], lang: Lang): string {
  const r = recipients.find((x) => x.id === id);
  return r ? r.name[lang === 'es' ? 1 : 0] : lang === 'es' ? 'Usuario ya no activo' : 'User no longer active';
}

function recipientNames(ids: string[], recipients: Recipient[], lang: Lang): string {
  return ids.map((id) => recipientName(id, recipients, lang)).join(', ');
}

function ScheduleSwitch({ s, onToggle, disabled, why }: { s: Schedule; onToggle: (id: string) => void; disabled?: boolean; why: string }) {
  const { state } = useApp();
  const tr = useTr();
  const name = templateName(s.template, state.lang);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={s.enabled}
      aria-label={tr(`${name} schedule`, `Programación de ${name}`)}
      className="rep-switch"
      disabled={disabled}
      title={disabled ? why : undefined}
      onClick={() => onToggle(s.id)}
    >
      <span className="rep-switch__track" aria-hidden="true">
        <span />
      </span>
      {s.enabled ? tr('On', 'Activa') : tr('Off', 'Inactiva')}
    </button>
  );
}

// ---------- Preview ----------

function Preview({ report, view, ref, onDownload }: { report: LibraryReport; view: View; ref: React.Ref<HTMLElement>; onDownload: (r: LibraryReport, lang: Lang) => void }) {
  const { state } = useApp();
  const tr = useTr();
  // The PDF language follows the console until a reader picks one, and again after the console language changes.
  const [pickedFor, setPicked] = useState<{ lang: Lang; console: Lang } | null>(null);
  const chosen = pickedFor && pickedFor.console === state.lang ? pickedFor.lang : null;
  const docLang = chosen ?? state.lang;
  const setChosen = (l: Lang) => setPicked({ lang: l, console: state.lang });
  const content = useMemo(() => reportContent(report, view.ctxFor(docLang)), [report, view, docLang]);
  const s = report.daily ? view.ctxFor(docLang).summary(report.daily.vesselId, report.daily.date) : null;
  const max = s ? Math.max(1, ...s.events.map((e) => e.count)) : 1;
  const name = templateName(report.template, state.lang);
  const fleet = view.ctxFor(docLang).fleet;

  const openTo = report.daily
    ? `/reports/daily?vessel=${report.daily.vesselId}&date=${report.daily.date}${chosen ? `&lang=${docLang}` : ''}`
    : report.template === 'voyage' && report.voyageId && canOpen(state.role, voyagesNav)
      ? `/voyages/${report.voyageId}`
      : report.template === 'model_perf' && canOpen(state.role, modelsNav)
        ? '/insights/models'
        : report.template === 'audit' && canOpen(state.role, auditNav)
          ? '/admin/audit'
          : undefined;

  const period = periodText(report.period, state.lang, view.today);
  const title = report.daily
    ? `${name} · ${report.vesselIds.length > 1 ? subjectText(report.subject, state.lang, view.counts).split(' · ')[0] : fleet.vesselById(report.daily.vesselId)?.name} · ${period}`
    : `${name} · ${period}`;
  const scheduled = report.status === 'scheduled';

  return (
    <section className="card rep-preview" aria-labelledby="rep-preview-title" ref={ref} tabIndex={-1}>
      <div className="rep-preview__head">
        <h2 id="rep-preview-title">{title}</h2>
        <span>
          {scheduled
            ? `${arrivalText(report, tr)}, ${tr(`due ${fmtDayTime(report.at)}`, `previsto ${fmtDayTime(report.at)}`)}`
            : tr(`Generated ${fmtDayTime(report.at)}`, `Generado ${fmtDayTime(report.at)}`)}{' '}
          · {report.status === 'generated' ? tr('on demand, not sent', 'a pedido, no enviado') : tr(`sent to ${sentToText(report, 'en')}`, `enviado a ${sentToText(report, 'es')}`)}
        </span>
      </div>

      <div className="rep-sheet">
        <div className="rep-sheet__page" aria-label={tr(`Preview of ${title}`, `Vista previa de ${title}`)} role="img" lang={docLang}>
          <div className="rep-sheet__top">
            <span className="rep-sheet__kicker">{report.daily ? t('kicker', docLang) : `GFSA · ${templateName(report.template, docLang)}`}</span>
            <span className="rep-sheet__name">{report.daily ? fleet.vesselById(report.daily.vesselId)?.name : subjectText(report.subject, docLang, view.counts)}</span>
            <span className="rep-sheet__meta">
              {report.daily && s ? `${shortDate(report.daily.date, docLang)} 2026${s.voyageId ? ` · ${s.voyageId}` : ''}` : periodText(report.period, docLang, view.today)}
            </span>
          </div>
          <div className="rep-sheet__kpis">
            {content.kpis.slice(0, 4).map(([l, n]) => (
              <MiniKpi key={l} n={n} l={l} />
            ))}
          </div>
          {s && (
            <div className="rep-sheet__bars">
              {s.events.slice(0, 4).map((e) => (
                <div key={e.useCaseId} className="rep-sheet__bar">
                  <span>{useCaseName(e.useCaseId, docLang)}</span>
                  <strong>{e.count}</strong>
                  <span className="rep-sheet__track">
                    <span style={{ width: `${(e.count / max) * 100}%` }} />
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="rep-sheet__lines" aria-hidden="true">
            <span style={{ width: '42%' }} />
            <span />
            <span />
            <span />
            <span style={{ width: '76%' }} />
          </div>
        </div>
      </div>

      <div className="rep-preview__lang">
        <span>{tr('PDF language', 'Idioma del PDF')}</span>
        <Segmented<Lang>
          label={tr('PDF language', 'Idioma del PDF')}
          value={docLang}
          onChange={setChosen}
          options={[
            { value: 'es', label: 'Español' },
            { value: 'en', label: 'English' },
          ]}
        />
      </div>

      <div className="rep-preview__actions">
        {openTo ? (
          <Link to={openTo} className="btn btn--primary">
            {tr('Open report', 'Abrir informe')}
          </Link>
        ) : (
          <button type="button" className="btn btn--primary" onClick={() => onDownload(report, docLang)} title={tr('This report opens as a PDF', 'Este informe se abre como PDF')}>
            <Icon name="file" size={16} /> {tr('Open PDF', 'Abrir PDF')}
          </button>
        )}
        <button type="button" className="btn" onClick={() => onDownload(report, docLang)}>
          <Icon name="download" size={16} /> {scheduled ? tr('Download so far', 'Descargar lo que va') : tr('Download PDF', 'Descargar PDF')}
        </button>
      </div>
      <span className="rep-preview__note">
        {scheduled
          ? tr('Sent when the convoy arrives. The copy so far is watermarked and logged like any download.', 'Se envía cuando llega el convoy. La copia hasta ahora lleva marca de agua y queda registrada como toda descarga.')
          : tr('Downloads are watermarked and written to the audit log', 'Las descargas llevan marca de agua y quedan en el registro de auditoría')}
      </span>
    </section>
  );
}

function MiniKpi({ n, l }: { n: string; l: string }) {
  return (
    <div className="rep-sheet__kpi">
      <strong>{n}</strong>
      <span>{l}</span>
    </div>
  );
}

// =====================================================================
// Schedules
// =====================================================================

function SchedulesTab({
  view,
  schedules,
  onCount,
  canEdit,
  readOnlyWhy,
  onToggle,
  onEdit,
  onAdd,
}: {
  view: View;
  schedules: Schedule[];
  onCount: number;
  canEdit: boolean;
  readOnlyWhy: string;
  onToggle: (id: string) => void;
  onEdit: (s: Schedule) => void;
  onAdd: () => void;
}) {
  const { state } = useApp();
  const tr = useTr();
  const lang = state.lang;
  return (
    <>
      <div className="callout">
        <Icon name="info" size={18} />
        <span>
          {tr(
            "Each report is a PDF in the recipient's language, Spanish or English, unless the schedule fixes one. Times are Asunción time. Daily summaries go out at 06:00 for the day before, one per tug and barge.",
            'Cada informe es un PDF en el idioma del destinatario, español o inglés, salvo que la programación fije uno. Los horarios son de Asunción. Los resúmenes diarios salen a las 06:00 con el día anterior, uno por remolcador y barcaza.',
          )}
          {!canEdit && ` ${readOnlyWhy}`}
        </span>
      </div>
      <section className="card" aria-labelledby="rep-schedules-title">
        <div className="card__head">
          <div className="card__title">
            <h2 id="rep-schedules-title">{tr('Schedules', 'Programaciones')}</h2>
            <span className="card__hint">
              {tr(`${onCount} on, ${schedules.length - onCount} off · Asunción time`, `${onCount} activas, ${schedules.length - onCount} inactivas · hora de Asunción`)}
            </span>
          </div>
          <button type="button" className="btn btn--sm" onClick={onAdd} disabled={!canEdit} title={canEdit ? undefined : readOnlyWhy}>
            <Icon name="plus" size={16} /> {tr('Add schedule', 'Agregar programación')}
          </button>
        </div>
        <div className="table-wrap">
          <table className="table rep-sched-table">
            <thead>
              <tr>
                <th scope="col">{tr('Report', 'Informe')}</th>
                <th scope="col">{tr('When', 'Cuándo')}</th>
                <th scope="col">{tr('Recipients', 'Destinatarios')}</th>
                <th scope="col">{tr('Language', 'Idioma')}</th>
                <th scope="col">{tr('Next run', 'Próximo envío')}</th>
                <th scope="col">{tr('Sending', 'Envío')}</th>
                <th scope="col">
                  <span className="sr-only">{tr('Edit', 'Editar')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {schedules.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="empty">{tr('No schedules. Add one to send reports automatically.', 'Sin programaciones. Agregue una para enviar informes automáticamente.')}</div>
                  </td>
                </tr>
              )}
              {schedules.map((s) => {
                const name = templateName(s.template, lang);
                return (
                  <tr key={s.id} className={s.enabled ? undefined : 'rep-row--off'}>
                    <td>
                      <span className="rep-strong">{name}</span>
                      <span className="sub">{SCOPE_TEXT[s.scope][lang === 'es' ? 1 : 0]}</span>
                    </td>
                    <td className="rep-nowrap">
                      {whenText(s, tr)}
                      {s.frequency !== 'arrival' && <span className="sub">{tr('Asunción time', 'hora de Asunción')}</span>}
                    </td>
                    <td>
                      <ul className="rep-recips">
                        {s.recipients.map((id) => {
                          const r = view.recipients.find((x) => x.id === id);
                          const l = s.lang === 'recipient' ? r?.lang : s.lang;
                          return (
                            <li key={id}>
                              {recipientName(id, view.recipients, lang)}
                              {l && (
                                <span className="rep-lang" title={l === 'es' ? tr('Spanish', 'Español') : tr('English', 'Inglés')}>
                                  {l.toUpperCase()}
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </td>
                    <td>{LANG_TEXT[s.lang][lang === 'es' ? 1 : 0]}</td>
                    <td className="rep-nowrap">{s.enabled ? nextRunText(s, view.now, tr) : <span className="rep-muted">{tr('Off', 'Inactiva')}</span>}</td>
                    <td>
                      <ScheduleSwitch s={s} onToggle={onToggle} disabled={!canEdit} why={readOnlyWhy} />
                    </td>
                    <td className="right">
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() => onEdit(s)}
                        disabled={!canEdit}
                        title={canEdit ? undefined : readOnlyWhy}
                        aria-label={tr(`Edit ${name} schedule`, `Editar programación de ${name}`)}
                      >
                        <Icon name="edit" size={15} /> {tr('Edit', 'Editar')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function ScheduleDialog({
  view,
  edit,
  template,
  onClose,
  onSave,
  onDelete,
}: {
  view: View;
  edit?: Schedule;
  template?: TemplateId;
  onClose: () => void;
  onSave: (s: Schedule, isNew: boolean) => void;
  onDelete: (s: Schedule) => void;
}) {
  const { state } = useApp();
  const tr = useTr();
  const lang = state.lang;
  const startTemplate = edit?.template ?? template ?? 'audit';
  const [initial] = useState<Schedule>(
    () =>
      edit ?? {
        id: uid('sched'),
        template: startTemplate,
        scope: templateById(startTemplate).scopes[0],
        frequency: DEFAULT_FREQ[startTemplate][0],
        weekday: 1,
        time: DEFAULT_FREQ[startTemplate][1],
        recipients: [],
        lang: 'recipient',
        enabled: true,
      },
  );
  const [form, setForm] = useState<Schedule>(initial);
  const [tried, setTried] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const tp = templateById(form.template);
  const arrivalOnly = ARRIVAL_ONLY.includes(form.template);
  const set = (patch: Partial<Schedule>) => setForm((f) => ({ ...f, ...patch }));
  const noRecipients = form.recipients.length === 0;
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useLeaveGuard(dirty, tr('Leave without saving this schedule? Your changes are lost.', '¿Salir sin guardar esta programación? Se pierden los cambios.'));

  const submit = () => {
    setTried(true);
    if (noRecipients || (!arrivalOnly && !/^\d{2}:\d{2}$/.test(form.time))) return;
    onSave(form, !edit);
  };
  const close = () => {
    if (dirty && !window.confirm(tr('Close without saving this schedule?', '¿Cerrar sin guardar esta programación?'))) return;
    onClose();
  };

  return (
    <InsightsDialog
      title={edit ? tr(`Edit schedule · ${templateName(tp.id, 'en')}`, `Editar programación · ${templateName(tp.id, 'es')}`) : tr('Schedule a report', 'Programar un informe')}
      sub={tr('Sent as PDF to named recipients · Asunción time', 'Se envía en PDF a destinatarios con nombre · hora de Asunción')}
      onClose={close}
      onSubmit={submit}
      width={620}
      footer={
        confirmDelete && edit ? (
          <>
            <span className="ins-spacer rep-confirm">{tr('Delete this schedule? Reports already sent stay in the library.', '¿Eliminar esta programación? Los informes ya enviados quedan en la biblioteca.')}</span>
            <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
              {tr('Keep it', 'Conservarla')}
            </button>
            <button type="button" className="btn btn--danger" onClick={() => onDelete(edit)}>
              <Icon name="trash" size={16} /> {tr('Delete schedule', 'Eliminar programación')}
            </button>
          </>
        ) : (
          <>
            {edit && (
              <button type="button" className="btn btn--ghost ins-spacer rep-danger-text" onClick={() => setConfirmDelete(true)}>
                <Icon name="trash" size={16} /> {tr('Delete', 'Eliminar')}
              </button>
            )}
            <button type="button" className="btn" onClick={close}>
              {tr('Cancel', 'Cancelar')}
            </button>
            <button type="submit" className="btn btn--primary">
              {edit ? tr('Save schedule', 'Guardar programación') : tr('Add schedule', 'Agregar programación')}
            </button>
          </>
        )
      }
    >
      <div className="ins-grid-2">
        <div className="field">
          <label htmlFor="rep-s-template">{tr('Report', 'Informe')}</label>
          <select
            id="rep-s-template"
            className="select"
            value={form.template}
            disabled={!!edit}
            onChange={(e) => {
              const id = e.target.value as TemplateId;
              set({ template: id, scope: templateById(id).scopes[0], frequency: DEFAULT_FREQ[id][0], time: DEFAULT_FREQ[id][1] });
            }}
          >
            {templates.map((x) => (
              <option key={x.id} value={x.id}>
                {templateName(x.id, lang)}
              </option>
            ))}
          </select>
          {edit && <span className="field__hint">{tr('To send another report, add a new schedule.', 'Para enviar otro informe, agregue una programación nueva.')}</span>}
        </div>
        <div className="field">
          <label htmlFor="rep-s-scope">{tr('Covers', 'Abarca')}</label>
          <select id="rep-s-scope" className="select" value={form.scope} onChange={(e) => set({ scope: e.target.value as Schedule['scope'] })}>
            {tp.scopes.map((sc) => (
              <option key={sc} value={sc}>
                {SCOPE_TEXT[sc][lang === 'es' ? 1 : 0]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rep-s-freq">{tr('Frequency', 'Frecuencia')}</label>
          <select id="rep-s-freq" className="select" value={form.frequency} disabled={arrivalOnly} onChange={(e) => set({ frequency: e.target.value as Frequency })}>
            {arrivalOnly ? (
              <option value="arrival">{tr('At arrival', 'A la llegada')}</option>
            ) : (
              <>
                <option value="daily">{tr('Every day', 'Todos los días')}</option>
                <option value="weekly">{tr('Every week', 'Cada semana')}</option>
                <option value="monthly">{tr('1st of the month', 'Día 1 de cada mes')}</option>
              </>
            )}
          </select>
          {arrivalOnly && <span className="field__hint">{tr('Built from the voyage record when the convoy arrives.', 'Se arma con el registro del viaje cuando llega el convoy.')}</span>}
        </div>
        {form.frequency === 'weekly' && (
          <div className="field">
            <label htmlFor="rep-s-day">{tr('Day', 'Día')}</label>
            <select id="rep-s-day" className="select" value={form.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <option key={d} value={d}>
                  {WEEKDAYS[d][lang === 'es' ? 1 : 0]}
                </option>
              ))}
            </select>
          </div>
        )}
        {!arrivalOnly && (
          <div className="field">
            <label htmlFor="rep-s-time">{tr('Time, Asunción', 'Hora, Asunción')}</label>
            <input id="rep-s-time" type="time" className="input" step={300} required value={form.time} onChange={(e) => set({ time: e.target.value })} />
          </div>
        )}
      </div>

      <fieldset className="rep-fieldset">
        <legend>
          {tr('Recipients', 'Destinatarios')} <span className="rep-muted">· {tr(`${form.recipients.length} selected`, `${form.recipients.length} seleccionados`)}</span>
        </legend>
        <div className="rep-recip-list">
          {view.recipients.map((r) => (
            <label key={r.id} className="check rep-recip">
              <input
                type="checkbox"
                checked={form.recipients.includes(r.id)}
                onChange={(e) => set({ recipients: e.target.checked ? [...form.recipients, r.id] : form.recipients.filter((x) => x !== r.id) })}
              />
              <span className="rep-recip__text">
                <span>{r.name[lang === 'es' ? 1 : 0]}</span>
                <span>{r.detail[lang === 'es' ? 1 : 0]}</span>
              </span>
              <span className="rep-lang">{r.lang.toUpperCase()}</span>
            </label>
          ))}
          {form.recipients
            .filter((id) => !view.recipients.some((r) => r.id === id))
            .map((id) => (
              <label key={id} className="check rep-recip">
                <input type="checkbox" checked onChange={() => set({ recipients: form.recipients.filter((x) => x !== id) })} />
                <span className="rep-recip__text">
                  <span>{tr('User no longer active', 'Usuario ya no activo')}</span>
                  <span>{tr('Untick to remove from this schedule', 'Desmarque para quitarlo de esta programación')}</span>
                </span>
              </label>
            ))}
        </div>
        {tried && noRecipients && (
          <span className="ins-error" role="alert">
            {tr('Choose at least one recipient.', 'Elija al menos un destinatario.')}
          </span>
        )}
      </fieldset>

      <fieldset className="rep-fieldset">
        <legend>{tr('Language of the PDF', 'Idioma del PDF')}</legend>
        <div className="rep-radios">
          {(['recipient', 'es', 'en'] as ScheduleLang[]).map((l) => (
            <label key={l} className="check">
              <input type="radio" name="rep-s-lang" checked={form.lang === l} onChange={() => set({ lang: l })} />
              {LANG_TEXT[l][lang === 'es' ? 1 : 0]}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="switch">
        <input type="checkbox" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        {form.enabled
          ? tr(`On · next run ${nextRunText(form, view.now, tr)}`, `Activa · próximo envío ${nextRunText(form, view.now, tr)}`)
          : tr('Off · nothing is sent', 'Inactiva · no se envía nada')}
      </label>
    </InsightsDialog>
  );
}

// =====================================================================
// Templates
// =====================================================================

function TemplatesTab({
  schedules,
  canEdit,
  readOnlyWhy,
  onSample,
  onSchedule,
  onCreate,
}: {
  schedules: Schedule[];
  canEdit: boolean;
  readOnlyWhy: string;
  onSample: (id: TemplateId) => void;
  onSchedule: (id: TemplateId) => void;
  onCreate: (id: TemplateId) => void;
}) {
  const { state } = useApp();
  const tr = useTr();
  const i = state.lang === 'es' ? 1 : 0;
  return (
    <div className="rep-templates">
      {templates.map((tp) => {
        const n = schedules.filter((s) => s.template === tp.id).length;
        const [frequency, time] = DEFAULT_FREQ[tp.id];
        return (
          <section key={tp.id} className="card rep-tpl" aria-labelledby={`rep-tpl-${tp.id}`}>
            <div className="rep-tpl__head">
              <span className="rep-tpl__icon" aria-hidden="true">
                <Icon name="file" size={18} />
              </span>
              <div className="rep-tpl__title">
                <h2 id={`rep-tpl-${tp.id}`}>{tp.name[i]}</h2>
                <span>
                  {tp.req} · {tp.pages[i]} · {tr('PDF in Spanish or English', 'PDF en español o inglés')}
                </span>
              </div>
            </div>
            <p className="rep-tpl__summary">{tp.summary[i]}</p>
            <ul className="rep-tpl__sections">
              {tp.sections.map((sec) => (
                <li key={sec[0]}>{sec[i]}</li>
              ))}
            </ul>
            <dl className="dl rep-tpl__dl">
              <dt>{tr('Default', 'Por defecto')}</dt>
              <dd>{whenText({ frequency, weekday: 1, time }, tr)}</dd>
              <dt>{tr('Covers', 'Abarca')}</dt>
              <dd>{tp.scopes.map((sc) => SCOPE_TEXT[sc][i]).join(', ')}</dd>
              <dt>{tr('Schedules', 'Programaciones')}</dt>
              <dd>{n ? tr(`${n} on this template`, `${n} con esta plantilla`) : tr('None yet', 'Ninguna aún')}</dd>
            </dl>
            <div className="rep-tpl__actions">
              <button type="button" className="btn btn--sm" onClick={() => onSample(tp.id)} aria-label={tr(`Download a sample ${tp.name[0]} PDF`, `Descargar un PDF de muestra de ${tp.name[1]}`)}>
                <Icon name="download" size={15} /> {tr('Sample', 'Muestra')}
              </button>
              <button type="button" className="btn btn--sm" onClick={() => onSchedule(tp.id)} disabled={!canEdit} title={canEdit ? undefined : readOnlyWhy}>
                <Icon name="clock" size={15} /> {tr('Schedule', 'Programar')}
              </button>
              <button type="button" className="btn btn--sm btn--primary" onClick={() => onCreate(tp.id)}>
                {tr('Create now', 'Crear ahora')}
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}

// =====================================================================
// Create report (on demand)
// =====================================================================

type PeriodKey = 'w0' | 'w1' | 'w2' | 'yesterday' | 'today' | '7d' | '30d' | 'all' | 'sep';

const PERIOD_KEYS: Partial<Record<TemplateId, PeriodKey[]>> = {
  weekly_fleet: ['w0', 'w1', 'w2'],
  camera_uptime: ['yesterday', '7d', '30d'],
  model_perf: ['30d', '7d', 'all', 'sep'],
  audit: ['today', '7d', '30d'],
};

function periodFor(tpl: TemplateId, key: PeriodKey, today: string): RPeriod {
  if (tpl === 'model_perf') return { kind: 'perf', period: key === '7d' || key === 'all' || key === 'sep' ? key : '30d' };
  if (key === 'w0' || key === 'w1' || key === 'w2') {
    let w = isoWeek(today);
    for (let k = 0; k < Number(key[1]); k++) w = isoWeek(shiftDate(w.from, -1));
    return { kind: 'week', ...w };
  }
  if (key === 'yesterday') return { kind: 'day', date: shiftDate(today, -1) };
  if (key === 'today') return { kind: 'day', date: today };
  return { kind: 'days', from: shiftDate(today, key === '7d' ? -6 : -29), to: today };
}

/** A new on-demand report, before it is added to the library. */
function makeReport(
  tpl: TemplateId,
  today: string,
  by: string,
  lang: Lang,
  fleet: Fleet,
  opts: { vessel?: string; date?: string; subject?: string; voyageId?: string; period?: PeriodKey } = {},
): LibraryReport {
  const base = { id: uid('rep'), template: tpl, at: new Date(scenarioNow()).toISOString(), status: 'generated' as const, sentTo: [], by, lang };
  if (tpl === 'daily') {
    const v = fleet.vesselById(opts.vessel ?? 'f501') ?? fleet.vessels[0];
    const date = opts.date ?? shiftDate(today, -1);
    return { ...base, subject: { kind: 'vessel', vesselId: v.id }, vesselIds: [v.id], period: { kind: 'day', date }, daily: { vesselId: v.id, date } };
  }
  if (tpl === 'voyage' || tpl === 'reefer') {
    const voy = voyages.find((v) => v.id === opts.voyageId) ?? voyages[0];
    const vs = fleet.vesselsOf(voy.convoyId);
    const barges = vs.filter((v) => v.kind === 'barge').map((v) => v.id);
    const from = dateOf(voy.departedAt);
    const end = voy.status === 'completed' ? parseCompleted(voy.statusNote) : undefined;
    const subject: Subject = tpl === 'voyage' ? { kind: 'voyage', voyageId: voy.id } : { kind: 'barges', voyageId: voy.id, vesselIds: barges };
    return { ...base, subject, vesselIds: tpl === 'voyage' ? vs.map((v) => v.id) : barges, period: { kind: 'voyage', voyageId: voy.id, from, to: end ?? today }, voyageId: voy.id };
  }
  const key = opts.period ?? PERIOD_KEYS[tpl]?.[0] ?? '30d';
  const period = periodFor(tpl, key, today);
  const convoyId = opts.subject && opts.subject !== 'fleet' ? opts.subject : undefined;
  if (tpl === 'weekly_fleet')
    return { ...base, subject: convoyId ? { kind: 'convoy', convoyId } : { kind: 'fleet' }, vesselIds: convoyId ? fleet.vesselsOf(convoyId).map((v) => v.id) : [], period };
  if (tpl === 'camera_uptime')
    return { ...base, subject: { kind: 'cameras', convoyId }, vesselIds: convoyId ? fleet.vesselsOf(convoyId).map((v) => v.id) : [], period };
  if (tpl === 'model_perf') return { ...base, subject: { kind: 'models' }, vesselIds: [], period };
  return { ...base, subject: { kind: 'audit' }, vesselIds: [], period };
}

/** "Completed 9 Oct" → "2026-10-09" */
function parseCompleted(note: string): string | undefined {
  const m = note.match(/(\d{1,2}) ([A-Z][a-z]{2})/);
  if (!m) return undefined;
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(m[2]) + 1;
  return month ? `2026-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}` : undefined;
}

function CreateDialog({
  view,
  template,
  onClose,
  onCreate,
}: {
  view: View;
  template?: TemplateId;
  onClose: () => void;
  onCreate: (r: LibraryReport, lang: Lang) => void;
}) {
  const { state } = useApp();
  const tr = useTr();
  const lang = state.lang;
  const inScope = useInScope();
  const fleet = view.ctxFor(lang).fleet;
  const today = view.today;
  const firstVessel = fleet.vessels.find((v) => v.id === 'f503' && inScope(v.convoyId)) ?? fleet.vessels.find((v) => inScope(v.convoyId)) ?? fleet.vessels[0];
  const scopedVoyages = voyages.filter((v) => inScope(v.convoyId));
  const [tpl, setTpl] = useState<TemplateId>(template ?? 'daily');
  const [vessel, setVessel] = useState(firstVessel.id);
  const [date, setDate] = useState(shiftDate(today, -1));
  const [subject, setSubject] = useState('fleet');
  const [voyageId, setVoyageId] = useState(scopedVoyages[0]?.id ?? voyages[0].id);
  const [periodKey, setPeriodKey] = useState<PeriodKey>(PERIOD_KEYS[template ?? 'daily']?.[0] ?? '30d');
  const [docLang, setDocLang] = useState<Lang>(lang);
  const tp = templateById(tpl);
  const i = lang === 'es' ? 1 : 0;

  const usesVoyage = tpl === 'voyage' || tpl === 'reefer';
  const usesConvoy = tpl === 'weekly_fleet' || tpl === 'camera_uptime';
  const keys = PERIOD_KEYS[tpl] ?? [];
  const keyLabel = (k: PeriodKey) =>
    k === 'yesterday'
      ? tr(`Yesterday, ${fmtDay(new Date(`${shiftDate(today, -1)}T12:00:00-03:00`))}`, `Ayer, ${fmtDay(new Date(`${shiftDate(today, -1)}T12:00:00-03:00`))}`)
      : k === 'today'
        ? tr('Today so far', 'Hoy hasta ahora')
        : periodText(periodFor(tpl, k, today), lang, today);

  const submit = () => {
    if (tpl === 'daily' && (!date || date < DAILY_MIN || date > today)) return;
    onCreate(makeReport(tpl, today, state.user.name, docLang, fleet, { vessel, date, subject, voyageId, period: periodKey }), docLang);
  };

  return (
    <InsightsDialog
      title={tr('Create report', 'Crear informe')}
      sub={tr('Generated now from reviewed events · added to the library and downloaded', 'Se genera ahora con los eventos revisados · se agrega a la biblioteca y se descarga')}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {tr('Cancel', 'Cancelar')}
          </button>
          <button type="submit" className="btn btn--primary">
            <Icon name="download" size={16} /> {tr('Generate and download', 'Generar y descargar')}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="rep-c-template">{tr('Report', 'Informe')}</label>
        <select
          id="rep-c-template"
          className="select"
          value={tpl}
          onChange={(e) => {
            const id = e.target.value as TemplateId;
            setTpl(id);
            setPeriodKey(PERIOD_KEYS[id]?.[0] ?? '30d');
          }}
        >
          {templates.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name[i]}
            </option>
          ))}
        </select>
        <span className="field__hint">{tp.summary[i]}</span>
      </div>

      <div className="ins-grid-2">
        {tpl === 'daily' && (
          <>
            <div className="field">
              <label htmlFor="rep-c-vessel">{tr('Tug or barge', 'Remolcador o barcaza')}</label>
              <select id="rep-c-vessel" className="select" value={vessel} onChange={(e) => setVessel(e.target.value)}>
                <VesselOptions fleet={fleet} />
              </select>
            </div>
            <div className="field">
              <label htmlFor="rep-c-date">{tr('Day', 'Día')}</label>
              <input id="rep-c-date" type="date" className="input" min={DAILY_MIN} max={today} value={date} required onChange={(e) => setDate(e.target.value)} />
              {date === today && <span className="field__hint">{tr('Today so far, from the events in the console now.', 'Hoy hasta ahora, con los eventos que tiene la consola.')}</span>}
            </div>
          </>
        )}
        {usesVoyage && (
          <div className="field">
            <label htmlFor="rep-c-voyage">{tr('Voyage', 'Viaje')}</label>
            <select id="rep-c-voyage" className="select" value={voyageId} onChange={(e) => setVoyageId(e.target.value)}>
              {scopedVoyages.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id} · {fleet.convoyById(v.convoyId)?.name} · {voyageNote(v.statusNote, lang)}
                </option>
              ))}
            </select>
          </div>
        )}
        {usesConvoy && (
          <div className="field">
            <label htmlFor="rep-c-subject">{tr('Covers', 'Abarca')}</label>
            <select id="rep-c-subject" className="select" value={subject} onChange={(e) => setSubject(e.target.value)}>
              <option value="fleet">{tr(`Fleet, ${fleet.convoys.length} convoys`, `Flota, ${fleet.convoys.length} convoyes`)}</option>
              {fleet.convoys
                .filter((c) => inScope(c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {tr(`${c.name} convoy`, `Convoy ${c.name}`)}
                  </option>
                ))}
            </select>
          </div>
        )}
        {keys.length > 0 && (
          <div className="field">
            <label htmlFor="rep-c-period">{tr('Period', 'Período')}</label>
            <select id="rep-c-period" className="select" value={periodKey} onChange={(e) => setPeriodKey(e.target.value as PeriodKey)}>
              {keys.map((k) => (
                <option key={k} value={k}>
                  {keyLabel(k)}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <span className="field__label" id="rep-c-lang">
            {tr('Language', 'Idioma')}
          </span>
          <Segmented<Lang>
            label={tr('Report language', 'Idioma del informe')}
            value={docLang}
            onChange={setDocLang}
            options={[
              { value: 'es', label: 'Español' },
              { value: 'en', label: 'English' },
            ]}
          />
        </div>
      </div>
    </InsightsDialog>
  );
}
