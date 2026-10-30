import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router';
import { initialAlarms, initialReviewEvents } from '../../data/alarms';
import { TARGETS, useCaseById, useCaseCategories, useCases } from '../../data/useCases';
import { roles } from '../../data/users';
import type { Camera, Priority, UseCase, UseCaseLevel, UseCasePhase, UseCaseStatus } from '../../data/types';
import { Badge, Card, Meter, PageHeader, PriorityBadge, Segmented, Stat, StatusDot, Tabs, usePriorityName, type DotTone } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useApp } from '../../state/AppState';
import { useFleet, type Fleet } from '../../state/fleetStore';
import { useRouting } from '../../state/routingStore';
import { pick, plural, useLang, useTr } from '../../lib/i18n';
import { fmtDay, fmtDayTime, fmtSmart, fmtTime, useNow } from '../../lib/time';
import {
  activeConfig,
  camStore,
  draftOf,
  editableFrom,
  editStore,
  eligibleCameras,
  goLive,
  isoNow,
  liveOf,
  newZoneId,
  nextVersion,
  sameZones,
  setUcEdit,
  SLOT_LABEL,
  slotOf,
  ucStore,
  UC_SLOTS,
  unitsForPushNow,
  usesZones,
  useStore,
  type CamState,
  type UcConfig,
  type UcRecord,
  type UcVersion,
  type Zone,
} from '../../state/configStore';
import {
  accuracyNotes,
  ANYWHERE,
  blockedText,
  cameraTypesText,
  categoryText,
  diffSummary,
  FALSE_REASONS,
  GATE_PASSED,
  gateMissing,
  gateOf,
  healthNoteText,
  hoursText,
  howText,
  joinList,
  LEVEL_SHORT,
  LEVELS,
  MODEL_LINE,
  PHASE_LABEL,
  ruleArticle,
  ruleWord,
  SCHEDULES,
  shadowComplete,
  shadowDay,
  shadowEnd,
  STATUS_LABEL,
  STATUS_TONE,
  statusText,
  targetText,
  whenText,
  type Bi,
} from './useCaseSetup';
import { ZoneEditor, ZoneList } from './ZoneEditor';
import { SetupDialog } from './SetupDialog';
import './UseCases.css';

/** UC-01 to UC-07: use case catalogue and set-up. */
export function UseCasesPage() {
  const { id } = useParams();
  const tr = useTr();
  if (!id) return <Catalogue />;
  const uc = useCaseById(id);
  if (!uc) {
    return (
      <div className="page">
        <PageHeader crumbs={[{ label: tr('Configuration', 'Configuración') }, { label: tr('Use cases', 'Casos de uso'), to: '/config/use-cases' }]} title={tr('Use case not found', 'Caso de uso no encontrado')} />
        <Card>
          <div className="empty">
            {tr(`There is no use case called “${id}”.`, `No existe un caso de uso llamado «${id}».`)} <Link to="/config/use-cases">{tr('Back to all use cases', 'Volver a todos los casos de uso')}</Link>
          </div>
        </Card>
      </div>
    );
  }
  return <UseCaseDetail key={uc.id} uc={uc} />;
}

// ---------- Helpers ----------

const STATUS_DOT: Record<UseCaseStatus, DotTone> = { live: 'ok', shadow: 'warn', off: 'idle', blocked: 'bad' };
const DAY = 24 * 60 * 60 * 1000;

const pct = (v: number | undefined, es: boolean) => (v === undefined ? '—' : `${Math.round(v * 100)}${es ? ' %' : '%'}`);
const dec = (v: number, es: boolean) => (es ? v.toFixed(2).replace('.', ',') : v.toFixed(2));

/** Alarms and events already in the seed (their counts are in each use case's 24-hour figure). */
const SEED_IDS = new Set([...initialAlarms.map((a) => a.id), ...initialReviewEvents.map((e) => e.id)]);

function MetCell({ value, met }: { value: string; met?: boolean }) {
  const tr = useTr();
  if (met === undefined) return <span className="ucs-muted">—</span>;
  return (
    <span className={`ucs-met ${met ? 'ucs-met--ok' : 'ucs-met--bad'}`}>
      <Icon name={met ? 'check' : 'alert'} size={13} strokeWidth={2.6} label={met ? tr('Target met', 'Objetivo cumplido') : tr('Target not met', 'Objetivo no cumplido')} />
      {value}
    </span>
  );
}

function pushSummary(v: UcVersion | undefined, now: number) {
  const units = v?.push?.units ?? [];
  const confirmed = units.filter((u) => u.confirmAt && new Date(u.confirmAt).getTime() <= now).length;
  const waiting = units.filter((u) => u.waiting).length;
  return { total: units.length, confirmed, waiting, installing: units.length - confirmed - waiting };
}

/** Fills the Spanish steps of configurations saved before they existed. */
function withSpanish(uc: UseCase, cfg: UcConfig): UcConfig {
  const same = cfg.steps.join('|') === uc.responseSteps.join('|');
  const stepsEs = cfg.stepsEs && cfg.stepsEs.length === cfg.steps.length ? cfg.stepsEs : same ? [...uc.responseStepsEs] : [...cfg.steps];
  return { ...cfg, stepsEs, nextStepEs: cfg.nextStepEs ?? (cfg.nextStep === uc.nextStep ? uc.nextStepEs : cfg.nextStep) };
}

const noteOf = (v: UcVersion, es: boolean) => (es ? (v.noteEs ?? v.note) : v.note);

// ---------- UC-01 catalogue ----------

function Catalogue() {
  const { state } = useApp();
  const tr = useTr();
  const es = useLang() === 'es';
  const records = useStore(ucStore);
  const navigate = useNavigate();
  const now = useNow(60_000);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | UseCaseStatus>('all');
  const [phase, setPhase] = useState<'all' | UseCasePhase>('all');

  // Events in the last 24 hours: the seed figure plus what the edge units sent since.
  const events24h = useMemo(() => {
    const since = now - DAY;
    const out: Record<string, number> = Object.fromEntries(useCases.map((u) => [u.id, u.events24h]));
    for (const a of state.alarms) if (!SEED_IDS.has(a.id) && new Date(a.raisedAt).getTime() >= since && out[a.useCaseId] !== undefined) out[a.useCaseId] += 1;
    for (const e of state.reviewEvents) if (!SEED_IDS.has(e.id) && new Date(e.at).getTime() >= since && out[e.useCaseId] !== undefined) out[e.useCaseId] += 1;
    return out;
  }, [state.alarms, state.reviewEvents, now]);

  const count = (s: UseCaseStatus) => useCases.filter((u) => records[u.id]?.status === s).length;
  const filtered = useCases.filter((u) => {
    const r = records[u.id];
    if (!r) return false;
    if (status !== 'all' && r.status !== status) return false;
    if (phase !== 'all' && u.phase !== phase) return false;
    if (q && !`${u.name} ${u.nameEs} ${u.rule} ${u.ruleEs} ${u.category} ${categoryText(u.category)[1]}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  const events = useCases.reduce((s, u) => s + (events24h[u.id] ?? 0), 0);
  const drafts = useCases.filter((u) => records[u.id] && draftOf(records[u.id])).length;
  const alerting = useCases.filter((u) => records[u.id]?.status === 'live' && activeConfig(u, records[u.id]).level === 'alert').length;
  const n = (p: UseCasePhase) => useCases.filter((u) => u.phase === p).length;

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tr('Configuration', 'Configuración') }]}
        title={tr('Use cases', 'Casos de uso')}
        sub={tr(
          `${useCases.length} use cases from GFSA's workbook · ${n('Pilot')} in the pilot, ${n('Rollout')} in rollout, ${n('Blocked')} blocked`,
          `${useCases.length} casos de uso del libro de trabajo de GFSA · ${n('Pilot')} en el piloto, ${n('Rollout')} en despliegue, ${n('Blocked')} bloqueados`,
        )}
        actions={
          <>
            <Link to="/insights/models" className="btn">
              <Icon name="activity" size={16} /> {tr('Model performance', 'Rendimiento de modelos')}
            </Link>
            <Link to="/config/routing" className="btn">
              <Icon name="share" size={16} /> {tr('Alert routing', 'Enrutamiento de alertas')}
            </Link>
          </>
        }
      />

      <div className="stat-grid">
        <Stat
          label={tr('Live', 'En vivo')}
          value={count('live')}
          aside={tr('on the vessels', 'en los buques')}
          foot={tr(`${alerting} alerting, the rest record and list`, `${alerting} con alertas, el resto registra y lista`)}
        />
        <Stat
          label={tr('Shadow run', 'Ejecución en sombra')}
          value={count('shadow')}
          aside={tr(`${TARGETS.shadowDays} days, alerts off`, `${TARGETS.shadowDays} días, alertas apagadas`)}
          foot={tr('Alerts switch on once the targets are met', 'Las alertas se activan cuando se cumplen los objetivos')}
        />
        <Stat
          label={tr('Off or blocked', 'Apagados o bloqueados')}
          value={count('off') + count('blocked')}
          aside={tr(`${count('off')} off · ${count('blocked')} blocked`, `${count('off')} apagados · ${count('blocked')} bloqueados`)}
          foot={tr('Blocked until new cameras or footage exist', 'Bloqueados hasta que haya cámaras o imágenes nuevas')}
        />
        <Stat
          label={tr('Events, last 24 hours', 'Eventos, últimas 24 horas')}
          value={events}
          aside={tr('across the fleet', 'en toda la flota')}
          foot={<Link to="/alarms?tab=review">{tr('Open review queue', 'Abrir cola de revisión')}</Link>}
        />
        <Stat
          label={tr('Drafts not on vessels', 'Borradores fuera de los buques')}
          value={drafts}
          foot={drafts ? tr('Push a draft to send it, signed, to the edge units', 'Envíe un borrador para mandarlo, firmado, a las unidades de borde') : tr('Every change is on the vessels', 'Todos los cambios están en los buques')}
        />
      </div>

      <Card id="catalogue" title={tr('Catalogue', 'Catálogo')} hint={tr('Grouped by category · open a use case to set it up', 'Agrupado por categoría · abra un caso de uso para configurarlo')} bodyClass="">
        <div className="ucs-filters">
          <div className="ucs-search">
            <Icon name="search" size={16} />
            <input type="search" className="input" aria-label={tr('Filter use cases', 'Filtrar casos de uso')} placeholder={tr('Filter use cases', 'Filtrar casos de uso')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Segmented<'all' | UseCaseStatus>
            label={tr('Status', 'Estado')}
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: tr('All', 'Todos') },
              { value: 'live', label: `${tr(...STATUS_LABEL.live)} ${count('live')}` },
              { value: 'shadow', label: `${tr(...STATUS_LABEL.shadow)} ${count('shadow')}` },
              { value: 'off', label: `${tr(...STATUS_LABEL.off)} ${count('off')}` },
              { value: 'blocked', label: `${tr(...STATUS_LABEL.blocked)} ${count('blocked')}` },
            ]}
          />
          <label className="ucs-inline-field">
            {tr('Phase', 'Fase')}
            <select className="select" value={phase} onChange={(e) => setPhase(e.target.value as 'all' | UseCasePhase)}>
              <option value="all">{tr('All', 'Todas')}</option>
              {(['Pilot', 'Rollout', 'Blocked'] as const).map((p) => (
                <option key={p} value={p}>
                  {tr(...PHASE_LABEL[p])}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="table-wrap">
          <table className="table num ucs-cat">
            <thead>
              <tr>
                <th scope="col">{tr('Use case', 'Caso de uso')}</th>
                <th scope="col">{tr('Priority', 'Prioridad')}</th>
                <th scope="col" className="ucs-hide-sm">
                  {tr('Phase', 'Fase')}
                </th>
                <th scope="col">{tr('Status', 'Estado')}</th>
                <th scope="col" className="ucs-hide-sm">
                  {tr('Level', 'Nivel')}
                </th>
                <th scope="col" className="right">
                  {tr('Cameras', 'Cámaras')}
                </th>
                <th scope="col" className="right">
                  {tr('Events 24 h', 'Eventos 24 h')}
                </th>
                <th scope="col" className="right">
                  {tr('Precision', 'Precisión')}
                </th>
                <th scope="col" className="right ucs-hide-sm">
                  {tr('Recall', 'Exhaustividad')}
                </th>
                <th scope="col" className="right">
                  {tr('False alerts', 'Falsas alertas')}
                </th>
              </tr>
            </thead>
            <tbody>
              {useCaseCategories.map((cat) => {
                const rows = filtered.filter((u) => u.category === cat);
                if (!rows.length) return null;
                return (
                  <Fragment key={cat}>
                    <tr className="ucs-group">
                      <th scope="colgroup" colSpan={10}>
                        {tr(...categoryText(cat))}
                        <span> · {rows.length}</span>
                      </th>
                    </tr>
                    {rows.map((u) => {
                      const r = records[u.id];
                      const cfg = activeConfig(u, r);
                      const g = gateOf(u);
                      const draft = draftOf(r);
                      const st = tr(...statusText(u, r, now));
                      return (
                        <tr key={u.id} className="clickable" onClick={() => navigate(`/config/use-cases/${u.id}`)}>
                          <td>
                            <Link to={`/config/use-cases/${u.id}`} className="strong-link" onClick={(e) => e.stopPropagation()}>
                              {pick(es ? 'es' : 'en', u.name, u.nameEs)}
                            </Link>
                            <span className="sub">{pick(es ? 'es' : 'en', u.rule, u.ruleEs)}</span>
                            {draft && (
                              <span className="ucs-draft-tag">
                                {tr('Draft', 'Borrador')} <span className="mono">{draft.version}</span> · {tr('not on vessels', 'fuera de los buques')}
                              </span>
                            )}
                          </td>
                          <td>
                            <PriorityBadge p={cfg.priority} />
                          </td>
                          <td className="ucs-hide-sm">{tr(...PHASE_LABEL[u.phase])}</td>
                          <td>
                            <StatusDot tone={STATUS_DOT[r.status]}>{tr(...STATUS_LABEL[r.status])}</StatusDot>
                            <span className="sub">{r.status === 'blocked' ? tr(...blockedText(u)) : st.split(' · ').slice(1).join(' · ')}</span>
                          </td>
                          <td className="ucs-hide-sm">{tr(...LEVEL_SHORT[cfg.level])}</td>
                          <td className="right">
                            {cfg.cameraIds.length}
                            <span className="sub">{tr(...cameraTypesText(u))}</span>
                          </td>
                          <td className="right">{events24h[u.id] ?? 0}</td>
                          <td className="right">
                            <MetCell value={pct(u.precision, es)} met={g.precision} />
                          </td>
                          <td className="right ucs-hide-sm">
                            <MetCell value={pct(u.recall, es)} met={g.recall} />
                          </td>
                          <td className="right">
                            <MetCell value={u.falseAlertsPerCamDay !== undefined ? dec(u.falseAlertsPerCamDay, es) : '—'} met={g.falseAlerts} />
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
              {!filtered.length && (
                <tr>
                  <td colSpan={10}>
                    <div className="empty">{tr('No use cases match these filters.', 'Ningún caso de uso coincide con estos filtros.')}</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="ucs-targets">
          {tr(
            `Targets agreed with GFSA: precision ${Math.round(TARGETS.precision * 100)}% or more, recall ${Math.round(TARGETS.recall * 100)}% or more, ${TARGETS.falseAlertsPerCamDay} or fewer false alerts per camera per day. Every use case runs a ${TARGETS.shadowDays}-day shadow run with alerts off before alerts go live.`,
            `Objetivos acordados con GFSA: precisión del ${Math.round(TARGETS.precision * 100)} % o más, exhaustividad del ${Math.round(TARGETS.recall * 100)} % o más, ${TARGETS.falseAlertsPerCamDay} falsas alertas o menos por cámara y día. Cada caso de uso pasa una ejecución en sombra de ${TARGETS.shadowDays} días con las alertas apagadas antes de activarlas.`,
          )}
        </p>
      </Card>
    </div>
  );
}

// ---------- UC-02 to UC-07 set-up ----------

type Tab = 'setup' | 'steps' | 'versions' | 'audit';
type DialogState =
  | null
  | { kind: 'push' }
  | { kind: 'discard' }
  | { kind: 'rollback'; version: string }
  | { kind: 'training' }
  | { kind: 'start-shadow' }
  | { kind: 'alerts-on' };

function UseCaseDetail({ uc }: { uc: UseCase }) {
  const { state, can, log, toast } = useApp();
  const tr = useTr();
  const es = useLang() === 'es';
  const prioName = usePriorityName();
  const records = useStore(ucStore);
  const cams = useStore(camStore);
  const edits = useStore(editStore);
  const fleet = useFleet();
  const now = useNow(1000);
  const [params, setParams] = useSearchParams();
  const rec = records[uc.id];
  const draftV = draftOf(rec);
  const liveV = liveOf(rec);
  const active = activeConfig(uc, rec);
  const name = pick(es ? 'es' : 'en', uc.name, uc.nameEs);

  const locked = rec.status === 'blocked';
  const canEdit = can('edit_use_cases') && !locked;
  const canPush = can('push_models') && !locked;
  const who = state.user.name;

  // The configuration being edited: the draft, or the one on the vessels (its zones stay on the cameras).
  const base = withSpanish(uc, draftV?.config ?? editableFrom(active));
  const baseKey = JSON.stringify(base);
  const stored = canEdit ? edits.useCases?.[uc.id] : undefined;
  const work = stored ? withSpanish(uc, stored) : base;
  const dirty = canEdit && JSON.stringify(work) !== baseKey;
  const setWork = (fn: (w: UcConfig) => UcConfig) => {
    const cur = editStore.get().useCases?.[uc.id] ?? base;
    const next = fn(withSpanish(uc, cur));
    setUcEdit(uc.id, JSON.stringify(next) === baseKey ? undefined : next);
  };
  const patch = (p: Partial<UcConfig>) => setWork((w) => ({ ...w, ...p }));

  const [tab, setTab] = useState<Tab>('setup');
  const [dialog, setDialog] = useState<DialogState>(null);

  // Unsaved changes: warn before leaving the screen or the page.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const eligible = eligibleCameras(uc.id, cams.cameras);
  const paramCam = params.get('camera');
  const defaultCam = (uc.id === 'life-jacket' && eligible.find((c) => c.id === 'F503-CAM-02')) || eligible.find((c) => work.cameraIds.includes(c.id)) || eligible[0];
  const editCam = eligible.find((c) => c.id === paramCam) ?? defaultCam;
  const setEditCam = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('camera', id);
    setParams(next, { replace: true });
  };

  const setRecord = (fn: (r: UcRecord) => UcRecord) => ucStore.set((s) => ({ ...s, [uc.id]: fn(s[uc.id]) }));
  const liveCfg = liveV?.config ?? active;
  const units = unitsForPushNow(now);
  const waitingUnits = units.filter((u) => u.waiting).length;
  const unitsLine = (total: number, waiting: number): Bi => [
    `signed and sent to ${total} edge units${waiting ? `; ${waiting} install when their link returns` : ''}`,
    `firmada y enviada a ${total} unidades de borde${waiting ? `; ${waiting} la instalan cuando vuelva su enlace` : ''}`,
  ];

  // ---------- UC-07 actions ----------

  const saveDraft = () => {
    if (!dirty) return;
    const version = draftV?.version ?? nextVersion(rec);
    const [note, noteEs] = diffSummary(liveCfg, work);
    const at = isoNow();
    setRecord((r) => ({
      ...r,
      versions: draftOf(r)
        ? r.versions.map((v) => (v.state === 'draft' ? { ...v, config: work, at, by: who, note, noteEs } : v))
        : [{ version, state: 'draft', at, by: who, note, noteEs, config: work }, ...r.versions],
    }));
    setUcEdit(uc.id, undefined);
    log('Saved draft', `${uc.name} ${version}`, note);
    toast(tr(`Draft ${version} saved. It reaches the vessels only when you push it.`, `Borrador ${version} guardado. Llega a los buques solo cuando lo envíe.`));
  };

  const undoChanges = (announce = true) => {
    setUcEdit(uc.id, undefined);
    if (announce) toast(tr('Unsaved changes discarded.', 'Cambios sin guardar descartados.'));
  };

  const discardDraft = () => {
    if (!draftV) return;
    setRecord((r) => ({ ...r, versions: r.versions.filter((v) => v.state !== 'draft') }));
    setUcEdit(uc.id, undefined);
    log('Discarded draft', `${uc.name} ${draftV.version}`);
    toast(tr(`Draft ${draftV.version} discarded. The vessels keep ${liveV?.version ?? 'their version'}.`, `Borrador ${draftV.version} descartado. Los buques siguen con ${liveV?.version ?? 'su versión'}.`));
    setDialog(null);
  };

  const push = () => {
    if (!draftV || dirty || !canPush) return;
    const [en] = diffSummary(liveCfg, draftV.config);
    const v = goLive(uc.id, { by: who, version: draftV.version });
    if (!v) return;
    const waiting = v.push?.units.filter((u) => u.waiting).length ?? 0;
    log('Pushed version', `${uc.name} ${draftV.version}`, `${en} · signed, to ${v.push?.units.length ?? 0} edge units`);
    toast(tr(`${draftV.version} is live: ${unitsLine(v.push?.units.length ?? 0, waiting)[0]}.`, `${draftV.version} está en vivo: ${unitsLine(v.push?.units.length ?? 0, waiting)[1]}.`));
    setDialog(null);
    setTab('versions');
  };

  const rollback = (version: string) => {
    if (dirty || !canPush) return;
    const v = goLive(uc.id, { by: who, version });
    if (!v) return;
    const total = v.push?.units.length ?? 0;
    const waiting = v.push?.units.filter((u) => u.waiting).length ?? 0;
    if (liveV) log('Rolled back version', `${uc.name} ${liveV.version} to ${version}`, `Zones, cameras, level and priority restored · signed, to ${total} edge units`);
    else log('Pushed version', `${uc.name} ${version}`, `Signed, to ${total} edge units`);
    toast(
      liveV
        ? tr(`Rolled back to ${version}: ${unitsLine(total, waiting)[0]}.`, `Vuelta a ${version}: ${unitsLine(total, waiting)[1]}.`)
        : tr(`${version} is live: ${unitsLine(total, waiting)[0]}.`, `${version} está en vivo: ${unitsLine(total, waiting)[1]}.`),
    );
    setDialog(null);
  };

  const startShadow = () => {
    if (dirty || !canPush) return;
    const version = draftV?.version ?? nextVersion(rec);
    const cfg: UcConfig = { ...(draftV?.config ?? editableFrom(active)), level: 'list' };
    const v = goLive(uc.id, { by: who, version, config: cfg, note: ['14-day shadow run started, alerts off', 'Inicio de la ejecución en sombra de 14 días, alertas apagadas'], status: 'shadow', shadowStart: isoNow() });
    if (!v) return;
    log('Started shadow run', `${uc.name} ${version}`, `Record and list, alerts off · ${cfg.cameraIds.length} cameras · signed, to ${v.push?.units.length ?? 0} edge units`);
    toast(tr(`${TARGETS.shadowDays}-day shadow run started with ${version}. Events are logged for review with alerts off.`, `Ejecución en sombra de ${TARGETS.shadowDays} días iniciada con ${version}. Los eventos se registran para revisión con las alertas apagadas.`));
    setDialog(null);
  };

  const switchAlertsOn = () => {
    if (!alertsReady) return;
    const version = nextVersion(rec);
    const cfg: UcConfig = { ...editableFrom(active), level: 'alert' };
    const v = goLive(uc.id, { by: who, version, config: cfg, note: ['Alerts on: every accuracy target met', 'Alertas activas: se cumplen todos los objetivos de precisión'], status: 'live' });
    if (!v) return;
    log('Switched alerts on', `${uc.name} ${version}`, `Record and alert · ${cfg.priority} · signed, to ${v.push?.units.length ?? 0} edge units`);
    toast(
      tr(
        `Alerts are on for ${uc.name} with ${version}. New events raise ${cfg.priority} alarms and follow the ${cfg.priority} routing.`,
        `Alertas activas para ${uc.nameEs} con ${version}. Los eventos nuevos generan alarmas ${cfg.priority} y siguen el enrutamiento ${cfg.priority}.`,
      ),
    );
    setDialog(null);
  };

  const sendTraining = () => {
    const clips = FALSE_REASONS[uc.id]?.reasons.reduce((s, x) => s + x[1], 0) ?? 0;
    setRecord((r) => ({ ...r, trainingSent: isoNow(), trainingBy: who, trainingClips: clips }));
    log('Sent clips to training', `${uc.name} · ${clips} false-alert clips`, 'Under GFSA consent GFSA-DA-01 · faces blurred');
    toast(tr(`${clips} clips sent to the training set under GFSA consent. The send is in the audit log.`, `${clips} clips enviados al conjunto de entrenamiento con el consentimiento de GFSA. El envío queda en el registro de auditoría.`));
    setDialog(null);
  };

  // ---------- UC-06 gate: when alerts can switch on ----------

  const gate = gateOf(uc);
  const offersAlerts = rec.status === 'shadow' || (rec.status === 'live' && active.level === 'list');
  const alertsWaits: string[] = [];
  if (rec.status === 'shadow' && !shadowComplete(rec, now))
    alertsWaits.push(tr(`the shadow run reaches ${TARGETS.shadowDays} days on ${fmtDay(shadowEnd(rec))}`, `la ejecución en sombra llegue a ${TARGETS.shadowDays} días, el ${fmtDay(shadowEnd(rec))}`));
  alertsWaits.push(...gateMissing(uc, es));
  if (draftV) alertsWaits.push(tr(`draft ${draftV.version} is pushed or discarded`, `se envíe o descarte el borrador ${draftV.version}`));
  if (dirty) alertsWaits.push(tr('your changes are saved or undone', 'se guarden o deshagan sus cambios'));
  if (!canPush) alertsWaits.push(tr('someone with the right to push models to vessels does it', 'lo haga alguien con permiso para enviar modelos a los buques'));
  const alertsReady = offersAlerts && alertsWaits.length === 0;

  const shadowWaits: string[] = [];
  if (dirty) shadowWaits.push(tr('your changes are saved or undone', 'se guarden o deshagan sus cambios'));
  if (!work.cameraIds.length) shadowWaits.push(tr('at least one camera is chosen in step 2', 'se elija al menos una cámara en el paso 2'));
  if (!canPush) shadowWaits.push(tr('someone with the right to push models to vessels does it', 'lo haga alguien con permiso para enviar modelos a los buques'));

  const pushWhy = !canPush
    ? tr('Pushing to vessels needs the right to push models.', 'Enviar a los buques requiere el permiso para enviar modelos.')
    : dirty
      ? tr('Save the draft first, then push it.', 'Primero guarde el borrador y luego envíelo.')
      : !draftV
        ? tr('Nothing to push yet: change the set-up and save a draft.', 'Todavía no hay nada que enviar: cambie la configuración y guarde un borrador.')
        : undefined;
  const rollbackWhy = dirty ? tr('Save or undo your changes before rolling back.', 'Guarde o deshaga sus cambios antes de volver a otra versión.') : undefined;

  const statusTone = STATUS_TONE[rec.status];
  const rollbackTarget = dialog?.kind === 'rollback' ? rec.versions.find((v) => v.version === dialog.version) : undefined;
  const rollbackZones = rollbackTarget ? Object.keys(rollbackTarget.config.zones).filter((id) => !sameZones(rollbackTarget.config.zones[id], cams.zones[id])) : [];
  const leaveDiff = diffSummary(base, work);

  return (
    <div className={`page ucs-page${dirty ? ' ucs-page--dirty' : ''}`}>
      <div className="page-head">
        <div className="page-head__text">
          <nav aria-label={tr('Breadcrumb', 'Ruta de navegación')} className="breadcrumb">
            {tr('Configuration', 'Configuración')} / <Link to="/config/use-cases">{tr('Use cases', 'Casos de uso')}</Link> / {tr(...categoryText(uc.category))}
          </nav>
          <h1 className="page-title">{name}</h1>
          <div className="ucs-badges">
            <Badge tone={statusTone}>
              <span className={`dot${STATUS_DOT[rec.status] === 'ok' ? '' : ` dot--${STATUS_DOT[rec.status]}`}`} aria-hidden="true" />
              {tr(...statusText(uc, rec, now))}
            </Badge>
            <PriorityBadge p={work.priority} />
            {draftV && (
              <Badge tone="warn">
                {tr(`Draft ${draftV.version} · not yet on vessels`, `Borrador ${draftV.version} · aún no está en los buques`)}
              </Badge>
            )}
            {dirty && <Badge tone="info">{tr('Unsaved changes', 'Cambios sin guardar')}</Badge>}
          </div>
        </div>
        {!locked && (
          <div className="page-head__actions ucs-head-actions">
            <span className="ucs-head-buttons">
              {draftV ? (
                <button type="button" className="btn" disabled={!canEdit} onClick={() => setDialog({ kind: 'discard' })}>
                  {tr('Discard draft', 'Descartar borrador')}
                </button>
              ) : (
                <button type="button" className="btn" disabled={!dirty} onClick={() => undoChanges()}>
                  {tr('Discard changes', 'Descartar cambios')}
                </button>
              )}
              <button type="button" className="btn" disabled={!dirty} onClick={saveDraft}>
                {tr('Save draft', 'Guardar borrador')}
              </button>
              <button type="button" className="btn btn--primary" disabled={!!pushWhy} aria-describedby={pushWhy ? 'ucs-push-why' : undefined} onClick={() => setDialog({ kind: 'push' })}>
                <Icon name="upload" size={16} /> {tr('Push to vessels', 'Enviar a los buques')}
              </button>
            </span>
            {pushWhy && (
              <span id="ucs-push-why" className="ucs-why">
                {pushWhy}
              </span>
            )}
          </div>
        )}
      </div>

      {locked && (
        <div className="callout callout--bad" role="note">
          <Icon name="lock" size={18} />
          <span>
            <strong>{tr(`Blocked: ${blockedText(uc)[0].toLowerCase()}.`, `Bloqueado: ${blockedText(uc)[1].toLowerCase()}.`)}</strong>{' '}
            {uc.id === 'overboard'
              ? tr(
                  'Person overboard stays off until thermal cameras are fitted at the barge edges for night detection.',
                  'Hombre al agua sigue apagado hasta que se instalen cámaras térmicas en los bordes de las barcazas para detectar de noche.',
                )
              : tr(
                  'Person down on deck stays off until GFSA provides consented drill footage to train on.',
                  'Persona caída en cubierta sigue apagado hasta que GFSA entregue imágenes de simulacros con consentimiento para entrenar.',
                )}{' '}
            {tr(
              'The set-up is shown for reference and cannot be changed or pushed. It opens in the “Act and expand” phase of the release plan.',
              'La configuración se muestra como referencia y no se puede cambiar ni enviar. Se habilita en la fase «Actuar y ampliar» del plan de lanzamiento.',
            )}
          </span>
        </div>
      )}
      {!locked && !can('edit_use_cases') && (
        <div className="callout" role="note">
          <Icon name="lock" size={18} />
          <span>
            {tr(
              'Your role can view this set-up but not change it. Editing use cases and zones needs the safety administrator role.',
              'Su rol puede ver esta configuración pero no cambiarla. Editar casos de uso y zonas requiere el rol de administrador de seguridad.',
            )}
          </span>
        </div>
      )}
      {!locked && can('edit_use_cases') && !can('push_models') && (
        <div className="callout" role="note">
          <Icon name="info" size={18} />
          <span>{tr('You can save drafts. Pushing to vessels needs the right to push models.', 'Puede guardar borradores. Enviar a los buques requiere el permiso para enviar modelos.')}</span>
        </div>
      )}

      <Tabs<Tab>
        label={tr('Use case', 'Caso de uso')}
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'setup', label: tr('Set-up', 'Configuración') },
          { value: 'steps', label: tr('Response steps', 'Pasos de respuesta') },
          { value: 'versions', label: tr('Versions', 'Versiones'), count: rec.versions.length },
          { value: 'audit', label: tr('Audit log', 'Registro de auditoría') },
        ]}
      />

      {tab === 'setup' && (
        <div className="row">
          <div className="grow stack ucs-main">
            <LevelSection uc={uc} rec={rec} work={work} patch={patch} canEdit={canEdit} gateMet={gate.met} />
            <CamerasSection uc={uc} work={work} patch={patch} canEdit={canEdit} cams={cams} fleet={fleet} eligible={eligible} editCam={editCam} setEditCam={setEditCam} />
            <RuleSection uc={uc} work={work} patch={patch} canEdit={canEdit} cams={cams} />
            <WhenSection work={work} patch={patch} canEdit={canEdit} />
            <RoutingSection work={work} onSteps={() => setTab('steps')} />
          </div>
          <aside className="stack ucs-aside" aria-label={tr('Accuracy and versions', 'Precisión y versiones')}>
            <GateCard
              uc={uc}
              rec={rec}
              now={now}
              cameras={work.cameraIds.length}
              offersAlerts={offersAlerts}
              alertsWaits={alertsWaits}
              shadowWaits={shadowWaits}
              onStart={() => setDialog({ kind: 'start-shadow' })}
              onAlertsOn={() => setDialog({ kind: 'alerts-on' })}
            />
            <FalseAlertsCard uc={uc} rec={rec} canEdit={canEdit} onSend={() => setDialog({ kind: 'training' })} />
            <VersionsAside rec={rec} now={now} who={who} canPush={canPush} rollbackWhy={rollbackWhy} onAll={() => setTab('versions')} onRollback={(v) => setDialog({ kind: 'rollback', version: v })} />
          </aside>
        </div>
      )}

      {tab === 'steps' && <StepsTab work={work} patch={patch} canEdit={canEdit} />}
      {tab === 'versions' && (
        <VersionsTab
          rec={rec}
          now={now}
          who={who}
          canPush={canPush}
          canEdit={canEdit}
          pushWhy={pushWhy}
          rollbackWhy={rollbackWhy}
          fleet={fleet}
          onPush={() => setDialog({ kind: 'push' })}
          onDiscard={() => setDialog({ kind: 'discard' })}
          onRollback={(v) => setDialog({ kind: 'rollback', version: v })}
        />
      )}
      {tab === 'audit' && <AuditTab uc={uc} rec={rec} />}

      {dirty && (
        <div className="ucs-dirty" role="region" aria-label={tr('Unsaved changes', 'Cambios sin guardar')}>
          <Icon name="edit" size={16} />
          <span className="ucs-dirty__text">
            <strong>{tr('Unsaved changes.', 'Cambios sin guardar.')}</strong> {tr(...leaveDiff)}
          </span>
          <button type="button" className="btn btn--sm" onClick={() => undoChanges()}>
            {tr('Undo changes', 'Deshacer cambios')}
          </button>
          <button type="button" className="btn btn--sm btn--primary" onClick={saveDraft}>
            {tr('Save draft', 'Guardar borrador')} {draftV ? draftV.version : nextVersion(rec)}
          </button>
        </div>
      )}

      {/* Leaving with unsaved changes */}
      <SetupDialog
        open={blocker.state === 'blocked'}
        title={tr('Leave with unsaved changes?', '¿Salir con cambios sin guardar?')}
        sub={tr(`${name}: ${leaveDiff[0]}.`, `${name}: ${leaveDiff[1]}.`)}
        onClose={() => blocker.reset?.()}
        actions={
          <>
            <button type="button" className="btn" onClick={() => blocker.reset?.()}>
              {tr('Stay', 'Quedarse')}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                undoChanges(false);
                blocker.proceed?.();
              }}
            >
              {tr('Discard changes', 'Descartar cambios')}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                saveDraft();
                blocker.proceed?.();
              }}
            >
              {tr('Save draft', 'Guardar borrador')}
            </button>
          </>
        }
      >
        <p>{tr('A saved draft stays here, not on the vessels, until you push it.', 'Un borrador guardado queda aquí, no en los buques, hasta que lo envíe.')}</p>
      </SetupDialog>

      {/* Dialogs */}
      <SetupDialog
        open={dialog?.kind === 'push'}
        wide
        title={tr(`Push ${draftV?.version ?? ''} to the vessels`, `Enviar ${draftV?.version ?? ''} a los buques`)}
        sub={tr('Signed with the GFSA release key. Each unit checks the signature before it installs.', 'Firmada con la clave de publicación de GFSA. Cada unidad verifica la firma antes de instalarla.')}
        onClose={() => setDialog(null)}
        actions={
          <>
            <button type="button" className="btn" onClick={() => setDialog(null)}>
              {tr('Cancel', 'Cancelar')}
            </button>
            <button type="button" className="btn btn--primary" onClick={push}>
              <Icon name="upload" size={16} /> {tr('Push signed version', 'Enviar versión firmada')}
            </button>
          </>
        }
      >
        {draftV && (
          <>
            <p>
              <strong>{tr(`Changes from ${liveV?.version ?? 'the last version'}:`, `Cambios respecto a ${liveV?.version ?? 'la última versión'}:`)}</strong> {tr(...diffSummary(liveCfg, draftV.config))}.
            </p>
            <p className="ucs-muted">
              {tr(
                `From the next event the vessels use ${tr(...LEVEL_SHORT[draftV.config.level]).toLowerCase()} at ${prioName(draftV.config.priority)} on ${draftV.config.cameraIds.length} cameras.`,
                `Desde el próximo evento los buques usan ${tr(...LEVEL_SHORT[draftV.config.level]).toLowerCase()} con ${prioName(draftV.config.priority)} en ${draftV.config.cameraIds.length} cámaras.`,
              )}
            </p>
            <PushUnitsPreview now={now} fleet={fleet} />
            <p className="ucs-muted">
              {tr(
                'Units in port or on a strong link install at once. The rest install when their link returns; the current version keeps running until then.',
                'Las unidades en puerto o con buen enlace la instalan de inmediato. El resto la instala cuando vuelve su enlace; mientras tanto sigue la versión actual.',
              )}
            </p>
          </>
        )}
      </SetupDialog>

      <SetupDialog
        open={dialog?.kind === 'discard'}
        title={tr(`Discard draft ${draftV?.version ?? ''}?`, `¿Descartar el borrador ${draftV?.version ?? ''}?`)}
        sub={tr('The draft is deleted. The version on the vessels does not change.', 'El borrador se elimina. La versión de los buques no cambia.')}
        onClose={() => setDialog(null)}
        actions={
          <>
            <button type="button" className="btn" onClick={() => setDialog(null)}>
              {tr('Keep draft', 'Conservar borrador')}
            </button>
            <button type="button" className="btn btn--danger" onClick={discardDraft}>
              {tr('Discard draft', 'Descartar borrador')}
            </button>
          </>
        }
      >
        {draftV && (
          <p>
            {tr('Changes lost:', 'Cambios que se pierden:')} {tr(...diffSummary(liveCfg, work))}.
          </p>
        )}
      </SetupDialog>

      <SetupDialog
        open={dialog?.kind === 'rollback'}
        title={
          liveV
            ? tr(`Roll back to ${rollbackTarget?.version ?? ''}?`, `¿Volver a ${rollbackTarget?.version ?? ''}?`)
            : tr(`Push ${rollbackTarget?.version ?? ''} to the vessels?`, `¿Enviar ${rollbackTarget?.version ?? ''} a los buques?`)
        }
        sub={
          liveV
            ? tr(`${liveV.version} is replaced on every edge unit, signed, as with any push.`, `${liveV.version} se reemplaza en todas las unidades de borde, firmada, como en cualquier envío.`)
            : tr('Signed with the GFSA release key. Each unit checks the signature before it installs.', 'Firmada con la clave de publicación de GFSA. Cada unidad verifica la firma antes de instalarla.')
        }
        onClose={() => setDialog(null)}
        actions={
          <>
            <button type="button" className="btn" onClick={() => setDialog(null)}>
              {tr('Cancel', 'Cancelar')}
            </button>
            <button type="button" className="btn btn--primary" onClick={() => rollbackTarget && rollback(rollbackTarget.version)}>
              <Icon name="refresh" size={16} /> {liveV ? tr('Roll back', 'Volver a esta versión') : tr('Push signed version', 'Enviar versión firmada')}
            </button>
          </>
        }
      >
        {rollbackTarget && (
          <>
            <p>
              <strong>{tr('What changes on the vessels:', 'Qué cambia en los buques:')}</strong> {tr(...diffSummary(liveCfg, rollbackTarget.config))}.
            </p>
            <p>
              {rollbackZones.length
                ? tr(
                    `Zones go back to how they were in ${rollbackTarget.version} on ${rollbackZones.join(', ')}. Other use cases on those cameras use the restored zones too.`,
                    `Las zonas vuelven a como estaban en ${rollbackTarget.version} en ${rollbackZones.join(', ')}. Los demás casos de uso de esas cámaras también usan las zonas restauradas.`,
                  )
                : tr('The zones on the cameras already match this version.', 'Las zonas de las cámaras ya coinciden con esta versión.')}{' '}
              {tr(
                `Level ${tr(...LEVEL_SHORT[rollbackTarget.config.level]).toLowerCase()}, ${prioName(rollbackTarget.config.priority)}, ${rollbackTarget.config.cameraIds.length} cameras.`,
                `Nivel ${tr(...LEVEL_SHORT[rollbackTarget.config.level]).toLowerCase()}, ${prioName(rollbackTarget.config.priority)}, ${rollbackTarget.config.cameraIds.length} cámaras.`,
              )}
            </p>
            {draftV && <p className="ucs-muted">{tr(`Your draft ${draftV.version} is kept and can still be pushed later.`, `Su borrador ${draftV.version} se conserva y se puede enviar más tarde.`)}</p>}
            {waitingUnits > 0 && (
              <p className="ucs-muted">{tr(`${waitingUnits} units without a link roll back when their link returns.`, `${waitingUnits} unidades sin enlace vuelven a esta versión cuando regrese su enlace.`)}</p>
            )}
          </>
        )}
      </SetupDialog>

      <TrainingDialog open={dialog?.kind === 'training'} uc={uc} onClose={() => setDialog(null)} onSend={sendTraining} />

      <SetupDialog
        open={dialog?.kind === 'start-shadow'}
        wide
        title={tr(`Start the ${TARGETS.shadowDays}-day shadow run?`, `¿Iniciar la ejecución en sombra de ${TARGETS.shadowDays} días?`)}
        sub={tr(
          'Events are logged and reviewed with alerts off. Alerts switch on only once all three targets are met.',
          'Los eventos se registran y revisan con las alertas apagadas. Las alertas se activan solo cuando se cumplen los tres objetivos.',
        )}
        onClose={() => setDialog(null)}
        actions={
          <>
            <button type="button" className="btn" onClick={() => setDialog(null)}>
              {tr('Cancel', 'Cancelar')}
            </button>
            <button type="button" className="btn btn--primary" onClick={startShadow}>
              {tr('Start shadow run', 'Iniciar ejecución en sombra')}
            </button>
          </>
        }
      >
        <p>
          {tr(
            `${draftV ? `Draft ${draftV.version}` : `A new version ${nextVersion(rec)}`} is signed and pushed at record and list on ${work.cameraIds.length} cameras. Reviewers classify every event so precision and false alerts can be measured.`,
            `${draftV ? `El borrador ${draftV.version}` : `Una versión nueva ${nextVersion(rec)}`} se firma y envía con registrar y listar en ${work.cameraIds.length} cámaras. Los revisores clasifican cada evento para medir la precisión y las falsas alertas.`,
          )}
        </p>
        <PushUnitsPreview now={now} fleet={fleet} />
      </SetupDialog>

      <SetupDialog
        open={dialog?.kind === 'alerts-on'}
        wide
        title={tr(`Switch alerts on for ${uc.name}?`, `¿Activar las alertas de ${uc.nameEs}?`)}
        sub={tr(
          `Every accuracy target is met. A new version ${nextVersion(rec)} is signed and pushed with record and alert.`,
          `Se cumplen todos los objetivos de precisión. Una versión nueva ${nextVersion(rec)} se firma y envía con registrar y alertar.`,
        )}
        onClose={() => setDialog(null)}
        actions={
          <>
            <button type="button" className="btn" onClick={() => setDialog(null)}>
              {tr('Cancel', 'Cancelar')}
            </button>
            <button type="button" className="btn btn--primary" onClick={switchAlertsOn}>
              <Icon name="bell" size={16} /> {tr('Switch alerts on', 'Activar alertas')}
            </button>
          </>
        }
      >
        <p>
          {tr(
            `From the next event, detections on its ${active.cameraIds.length} cameras raise ${prioName(active.priority)} alarms: the wheelhouse is told at once and the ${active.priority} routing escalates ashore. ${rec.status === 'shadow' ? 'The shadow run ends.' : ''}`,
            `Desde el próximo evento, las detecciones en sus ${active.cameraIds.length} cámaras generan alarmas ${prioName(active.priority)}: se avisa al puente de inmediato y el enrutamiento ${active.priority} escala en tierra. ${rec.status === 'shadow' ? 'La ejecución en sombra termina.' : ''}`,
          )}
        </p>
        <PushUnitsPreview now={now} fleet={fleet} />
      </SetupDialog>
    </div>
  );
}

// ---------- Sections ----------

type SectionProps = { work: UcConfig; patch: (p: Partial<UcConfig>) => void; canEdit: boolean };

function Section({ n, title, aside, children, id }: { n: number; title: string; aside?: ReactNode; children: ReactNode; id: string }) {
  return (
    <section className="card ucs-sec" aria-labelledby={`${id}-title`}>
      <div className="ucs-sec__head">
        <h2 id={`${id}-title`}>
          <span className="ucs-sec__n">{n}</span> · {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function LevelSection({ uc, rec, work, patch, canEdit, gateMet }: SectionProps & { uc: UseCase; rec: UcRecord; gateMet: boolean }) {
  const tr = useTr();
  const prioName = usePriorityName();
  const alertOpen = rec.status === 'live' && gateMet;
  const alertLocked: Bi =
    rec.status === 'shadow'
      ? ['Opens when the 14-day shadow run meets the targets: use Switch alerts on beside it.', 'Se habilita cuando la ejecución en sombra de 14 días cumple los objetivos: use Activar alertas al costado.']
      : rec.status === 'off'
        ? ['Opens after a 14-day shadow run meets the targets.', 'Se habilita después de que una ejecución en sombra de 14 días cumpla los objetivos.']
        : ['Opens once every accuracy target is met.', 'Se habilita cuando se cumple cada objetivo de precisión.'];
  return (
    <Section
      n={1}
      id="lvl"
      title={tr('Level and priority', 'Nivel y prioridad')}
      aside={
        <label className="ucs-inline-field">
          {tr('Priority', 'Prioridad')}
          <select className="select ucs-strong" value={work.priority} disabled={!canEdit} onChange={(e) => patch({ priority: e.target.value as Priority })}>
            {(['P1', 'P2', 'P3', 'P4'] as const).map((p) => (
              <option key={p} value={p}>
                {prioName(p)}
              </option>
            ))}
          </select>
        </label>
      }
    >
      <div role="radiogroup" aria-labelledby="lvl-title" className="ucs-levels">
        {LEVELS.map((l) => {
          const lockedOpt = l.value === 'act' || (l.value === 'alert' && !alertOpen && work.level !== 'alert');
          const checked = work.level === l.value;
          return (
            <label key={l.value} className={`ucs-level${checked ? ' is-checked' : ''}${lockedOpt ? ' is-locked' : ''}`}>
              <input type="radio" name={`level-${uc.id}`} value={l.value} checked={checked} disabled={!canEdit || lockedOpt} onChange={() => patch({ level: l.value as UseCaseLevel })} />
              <span className="ucs-level__text">
                <span className="ucs-level__name">
                  {tr(...l.label)}
                  {lockedOpt && <Icon name="lock" size={13} label={tr('Locked', 'Bloqueado')} />}
                </span>
                <span>{l.value === 'alert' && lockedOpt ? tr(...alertLocked) : tr(...l.text)}</span>
              </span>
            </label>
          );
        })}
      </div>
    </Section>
  );
}

function CamerasSection({
  uc,
  work,
  patch,
  canEdit,
  cams,
  fleet,
  eligible,
  editCam,
  setEditCam,
}: SectionProps & { uc: UseCase; cams: CamState; fleet: Fleet; eligible: Camera[]; editCam?: Camera; setEditCam: (id: string) => void }) {
  const { log, toast } = useApp();
  const tr = useTr();
  const es = useLang() === 'es';
  const [selZone, setSelZone] = useState<string | undefined>();
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyTargets, setCopyTargets] = useState<string[]>([]);
  const selected = new Set(work.cameraIds);
  const zonesFor = (id: string): Zone[] => work.zones[id] ?? cams.zones[id] ?? [];
  const setZones = (id: string, z: Zone[]) => patch({ zones: { ...work.zones, [id]: z } });
  const zoned = usesZones(work);

  const slots = UC_SLOTS[uc.id] ?? [];
  const slotText = slots.length === 1 ? `${tr(...SLOT_LABEL[slots[0]])} ` : '';
  const convoyIds = [...new Set(eligible.filter((c) => selected.has(c.id)).map((c) => c.convoyId))];
  const nCams = work.cameraIds.length;

  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(selected);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    patch({ cameraIds: eligible.filter((c) => next.has(c.id)).map((c) => c.id) });
  };

  const candidates = editCam ? eligible.filter((c) => c.id !== editCam.id && slotOf(c) === slotOf(editCam)) : [];
  const defaultTarget = candidates.find((c) => c.convoyId === editCam?.convoyId) ?? candidates[0];

  const openCopy = () => {
    setCopyTargets(defaultTarget ? [defaultTarget.id] : []);
    setCopyOpen(true);
  };
  const doCopy = () => {
    if (!editCam || !copyTargets.length) return;
    const src = zonesFor(editCam.id);
    const zones = { ...work.zones };
    copyTargets.forEach((id) => {
      zones[id] = src.map((z) => ({ ...z, id: newZoneId(), points: z.points.map((p) => [...p] as [number, number]) }));
    });
    patch({ zones });
    log('Copied zones', `${uc.name} · ${editCam.id} to ${copyTargets.join(', ')}`);
    toast(
      tr(
        `${src.length} ${plural(src.length, 'zone', 'zones')} copied to ${copyTargets.length} ${plural(copyTargets.length, 'camera', 'cameras')}. Save the draft to keep them.`,
        `${src.length} ${plural(src.length, 'zona copiada', 'zonas copiadas')} a ${copyTargets.length} ${plural(copyTargets.length, 'cámara', 'cámaras')}. Guarde el borrador para conservarlas.`,
      ),
    );
    setCopyOpen(false);
  };

  const vesselName = (c: Camera) => fleet.vesselById(c.vesselId)?.name ?? c.vesselId;
  const shortName = (c: Camera) => fleet.vesselById(c.vesselId)?.short ?? c.id;
  const hold = editCam ? cams.holds[editCam.id] : undefined;
  const zones = editCam ? zonesFor(editCam.id) : [];

  return (
    <Section
      n={2}
      id="zone"
      title={tr('Cameras and zones', 'Cámaras y zonas')}
      aside={
        <span className="ucs-aside-text">
          {tr(
            `${nCams} ${slotText}${plural(nCams, 'camera', 'cameras')} on ${convoyIds.length} ${plural(convoyIds.length, 'convoy', 'convoys')}`,
            `${nCams} ${plural(nCams, 'cámara', 'cámaras')} ${slotText}en ${convoyIds.length} ${plural(convoyIds.length, 'convoy', 'convoyes')}`,
          )}
        </span>
      }
    >
      <fieldset className="ucs-fieldset" disabled={!canEdit}>
        <legend className="sr-only">{tr('Cameras this use case runs on', 'Cámaras en las que funciona este caso de uso')}</legend>
        <div className="ucs-chips">
          {fleet.convoys.map((cv) => {
            const list = eligible.filter((c) => c.convoyId === cv.id);
            if (!list.length) return null;
            if (editCam && cv.id === editCam.convoyId) {
              return list.map((c) => (
                <label key={c.id} className={`ucs-chip${selected.has(c.id) ? ' is-on' : ''}${c.id === editCam.id ? ' is-editing' : ''}`}>
                  <input type="checkbox" checked={selected.has(c.id)} onChange={(e) => toggle([c.id], e.target.checked)} />
                  {vesselName(c)} · {c.name}
                  {c.id === editCam.id && zoned ? tr(' · editing', ' · editando') : ''}
                </label>
              ));
            }
            const on = list.filter((c) => selected.has(c.id)).length;
            const shown = on === list.length ? `${list.length}` : tr(`${on} of ${list.length}`, `${on} de ${list.length}`);
            return (
              <label key={cv.id} className={`ucs-chip${on ? ' is-on' : ''}`}>
                <input
                  type="checkbox"
                  checked={on === list.length}
                  ref={(el) => {
                    if (el) el.indeterminate = on > 0 && on < list.length;
                  }}
                  onChange={(e) => toggle(list.map((c) => c.id), e.target.checked)}
                />
                {tr(`${cv.name} convoy · ${shown} ${slotText}cameras`, `Convoy ${cv.name} · ${shown} cámaras ${slotText}`.trim())}
              </label>
            );
          })}
        </div>
      </fieldset>

      {editCam && zoned && (
        <>
          <label className="ucs-inline-field ucs-editcam">
            {tr('Edit zones on', 'Editar zonas en')}
            <select
              className="select"
              value={editCam.id}
              onChange={(e) => {
                setEditCam(e.target.value);
                setSelZone(undefined);
                setCopyOpen(false);
              }}
            >
              {fleet.convoys.map((cv) => {
                const list = eligible.filter((c) => c.convoyId === cv.id);
                if (!list.length) return null;
                return (
                  <optgroup key={cv.id} label={tr(`${cv.name} convoy`, `Convoy ${cv.name}`)}>
                    {list.map((c) => (
                      <option key={c.id} value={c.id}>
                        {vesselName(c)} · {c.name} ({c.id}){selected.has(c.id) ? '' : tr(' · not used', ' · sin usar')}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </label>

          {hold && (
            <div className="callout callout--warn" role="note">
              <Icon name="alert" size={18} />
              <span>
                {tr(
                  `This camera moved and its zones are held for review since ${fmtTime(hold.since)}. They are not used until someone approves or redraws them on `,
                  `Esta cámara se movió y sus zonas están retenidas para revisión desde las ${fmtTime(hold.since)}. No se usan hasta que alguien las apruebe o redibuje en `,
                )}
                <Link to={`/config/cameras?camera=${editCam.id}`}>{tr('Cameras and zones', 'Cámaras y zonas')}</Link>.
              </span>
            </div>
          )}

          <div className="ucs-zone-wrap">
            <div className="ucs-zone-editor">
              <ZoneEditor
                image={editCam.image}
                alt={tr(`Reference view of the ${editCam.name.toLowerCase()} camera on ${vesselName(editCam)}`, `Vista de referencia de la cámara ${editCam.name} de ${vesselName(editCam)}`)}
                tag={
                  <>
                    {tr('Reference view', 'Vista de referencia')} · <span className="mono">{editCam.id}</span>
                  </>
                }
                zones={zones}
                onChange={canEdit ? (z) => setZones(editCam.id, z) : undefined}
                selectedId={selZone}
                onSelect={setSelZone}
                degraded={editCam.health === 'degraded' && !hold}
                extraTools={
                  canEdit &&
                  candidates.length > 0 && (
                    <span className="ucs-copy">
                      <button type="button" className="ze__tool" aria-expanded={copyOpen} aria-haspopup="dialog" onClick={() => (copyOpen ? setCopyOpen(false) : openCopy())}>
                        <Icon name="copy" size={15} /> {defaultTarget ? tr(`Copy to ${shortName(defaultTarget)}`, `Copiar a ${shortName(defaultTarget)}`) : tr('Copy to other cameras', 'Copiar a otras cámaras')}
                      </button>
                      {copyOpen && (
                        <div
                          className="ucs-copy__pop"
                          role="dialog"
                          aria-label={tr('Copy zones to other cameras', 'Copiar zonas a otras cámaras')}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') setCopyOpen(false);
                          }}
                        >
                          <span className="ucs-copy__title">
                            {tr(`Copy ${zones.length} ${plural(zones.length, 'zone', 'zones')} to`, `Copiar ${zones.length} ${plural(zones.length, 'zona', 'zonas')} a`)}
                          </span>
                          <div className="ucs-copy__list">
                            {candidates.map((c) => (
                              <label key={c.id} className="check">
                                <input
                                  type="checkbox"
                                  checked={copyTargets.includes(c.id)}
                                  onChange={(e) => setCopyTargets((t) => (e.target.checked ? [...t, c.id] : t.filter((x) => x !== c.id)))}
                                />
                                {vesselName(c)} · {c.name}
                              </label>
                            ))}
                          </div>
                          <span className="ucs-muted">
                            {!zones.length
                              ? tr('Draw a zone on this camera first: there is nothing to copy yet.', 'Primero dibuje una zona en esta cámara: todavía no hay nada que copiar.')
                              : !copyTargets.length
                                ? tr('Tick at least one camera to copy to.', 'Marque al menos una cámara de destino.')
                                : tr('Replaces the zones on those cameras. Saved with the draft.', 'Reemplaza las zonas de esas cámaras. Se guarda con el borrador.')}
                          </span>
                          <span className="ucs-copy__actions">
                            <button type="button" className="btn btn--sm" onClick={() => setCopyOpen(false)}>
                              {tr('Cancel', 'Cancelar')}
                            </button>
                            <button type="button" className="btn btn--sm btn--primary" disabled={!copyTargets.length || !zones.length} onClick={doCopy}>
                              {tr('Copy zones', 'Copiar zonas')}
                            </button>
                          </span>
                        </div>
                      )}
                    </span>
                  )
                }
              />
            </div>
            <div className="ucs-zone-side">
              <span className="ucs-label">{tr('Zones on this camera', 'Zonas en esta cámara')}</span>
              <ZoneList
                zones={zones}
                selectedId={selZone}
                onSelect={setSelZone}
                onRename={canEdit ? (id, nm) => setZones(editCam.id, zones.map((z) => (z.id === id ? { ...z, name: nm } : z))) : undefined}
                onDelete={
                  canEdit
                    ? (id) => {
                        setZones(editCam.id, zones.filter((z) => z.id !== id));
                        setSelZone(undefined);
                      }
                    : undefined
                }
              />
              <p className="ucs-note">
                {editCam.health !== 'healthy' && !hold && healthNoteText(editCam.healthNote, es)
                  ? tr(`Camera health: ${editCam.healthNote}. `, `Estado de la cámara: ${healthNoteText(editCam.healthNote, true)}. `)
                  : ''}
                {tr('If the camera is moved, the scene check flags it and these zones need redrawing.', 'Si la cámara se mueve, el control de escena lo detecta y hay que redibujar estas zonas.')}
              </p>
            </div>
          </div>
        </>
      )}
      {!zoned && <p className="ucs-note">{tr('This use case looks at the whole image, so it needs no zones.', 'Este caso de uso mira toda la imagen, así que no necesita zonas.')}</p>}
      {!eligible.length && <p className="ucs-note">{tr('No cameras of the right kind are fitted yet.', 'Todavía no hay cámaras del tipo necesario instaladas.')}</p>}
    </Section>
  );
}

function RuleSection({ uc, work, patch, canEdit, cams }: SectionProps & { uc: UseCase; cams: CamState }) {
  const tr = useTr();
  const es = useLang() === 'es';
  const r = work.rule;
  const setRule = (p: Partial<UcConfig['rule']>) => patch({ rule: { ...r, ...p } });
  const zoneNames = useMemo(() => {
    const names = new Set<string>();
    work.cameraIds.forEach((id) => (work.zones[id] ?? cams.zones[id] ?? []).forEach((z) => names.add(z.name)));
    if (r.zone) names.add(r.zone);
    names.add(ANYWHERE);
    return [...names];
  }, [work.cameraIds, work.zones, cams.zones, r.zone]);
  const art = ruleArticle(r.object);
  const isPerson = r.object === 'person';
  const w = (s: string) => ruleWord(s, es);
  const zoneMissing = r.zone && r.zone !== ANYWHERE && !work.cameraIds.some((id) => (work.zones[id] ?? cams.zones[id] ?? []).some((z) => z.name === r.zone));

  return (
    <Section n={3} id="rule" title={tr('Model and rule', 'Modelo y regla')} aside={<span className="ucs-aside-text">{tr(...MODEL_LINE[uc.category])}</span>}>
      <fieldset className="ucs-fieldset" disabled={!canEdit}>
        <legend className="sr-only">{tr('Rule', 'Regla')}</legend>
        <div className="ucs-sentence">
          <span>{es ? 'Generar un evento cuando' : `Raise an event when${art ? ` ${art}` : ''}`}</span>
          <select aria-label={tr('Object', 'Objeto')} className="ucs-sel" value={r.object} onChange={(e) => setRule({ object: e.target.value })}>
            {r.objects.map((o) => (
              <option key={o} value={o}>
                {w(o)}
              </option>
            ))}
          </select>
          <span>{w(r.verb)}</span>
          {r.zone !== undefined && (
            <select aria-label={tr('Zone', 'Zona')} className="ucs-sel" value={r.zone} onChange={(e) => setRule({ zone: e.target.value })}>
              {zoneNames.map((z) => (
                <option key={z} value={z}>
                  {z === ANYWHERE ? w(z) : z}
                </option>
              ))}
            </select>
          )}
          {r.items && (
            <>
              {r.qualifier && <span>{w(r.qualifier)}</span>}
              <select
                aria-label={r.qualifier === 'without a' ? tr('Missing item', 'Elemento que falta') : tr('Condition', 'Condición')}
                className="ucs-sel"
                value={r.item}
                onChange={(e) => setRule({ item: e.target.value })}
              >
                {r.items.map((o) => (
                  <option key={o} value={o}>
                    {w(o)}
                  </option>
                ))}
              </select>
            </>
          )}
          {r.seconds !== undefined && (
            <>
              <span>{tr('for at least', 'durante al menos')}</span>
              <input
                aria-label={tr('Seconds', 'Segundos')}
                type="number"
                min={1}
                max={600}
                className="ucs-num"
                value={r.seconds}
                onChange={(e) => setRule({ seconds: Math.max(1, Math.min(600, Number(e.target.value) || 1)) })}
              />
              <span>{r.seconds === 1 ? tr('second.', 'segundo.') : tr('seconds.', 'segundos.')}</span>
            </>
          )}
          {r.suffix && <span>{w(r.suffix)}.</span>}
          {r.seconds === undefined && !r.suffix && <span aria-hidden="true">.</span>}
        </div>
        {zoneMissing && (
          <p className="ucs-note ucs-note--warn">
            {tr(
              `None of the chosen cameras has a zone called “${r.zone}”. Draw or rename one in step 2, or pick another zone.`,
              `Ninguna de las cámaras elegidas tiene una zona llamada «${r.zone}». Dibuje o renombre una en el paso 2, o elija otra zona.`,
            )}
          </p>
        )}
        <div className="ucs-rule-grid">
          <label className="ucs-range">
            {tr('Confidence needed', 'Confianza necesaria')}
            <span className="ucs-range__row">
              <input type="range" min={0.3} max={0.95} step={0.05} value={work.confidence} onChange={(e) => patch({ confidence: Number(e.target.value) })} />
              <span className="mono">{dec(work.confidence, es)}</span>
            </span>
            <span className="ucs-range__hint">{tr('Raise it to cut false alerts, lower it to miss fewer events', 'Súbala para reducir falsas alertas, bájela para perder menos eventos')}</span>
          </label>
          <div className="ucs-range">
            <span id="repeat-label">{tr('Repeat events', 'Eventos repetidos')}</span>
            <span className="ucs-range__row ucs-range__row--text">
              {isPerson ? tr('One per person every', 'Uno por persona cada') : tr('One per object every', 'Uno por objeto cada')}
              <input
                type="number"
                aria-labelledby="repeat-label"
                aria-describedby="repeat-unit"
                min={1}
                max={120}
                className="ucs-num"
                value={work.repeatMin}
                onChange={(e) => patch({ repeatMin: Math.max(1, Math.min(120, Number(e.target.value) || 1)) })}
              />
              <span id="repeat-unit">min</span>
            </span>
            <span className="ucs-range__hint">
              {isPerson
                ? tr('Tracking keeps one person from raising a flood of alarms', 'El seguimiento evita que una misma persona genere una avalancha de alarmas')
                : tr('Tracking keeps one object from raising a flood of alarms', 'El seguimiento evita que un mismo objeto genere una avalancha de alarmas')}
            </span>
          </div>
        </div>
      </fieldset>
    </Section>
  );
}

function WhenSection({ work, patch, canEdit }: SectionProps) {
  const tr = useTr();
  return (
    <Section n={4} id="when" title={tr('When it runs', 'Cuándo funciona')}>
      <fieldset className="ucs-fieldset" disabled={!canEdit}>
        <legend className="sr-only">{tr('When it runs', 'Cuándo funciona')}</legend>
        <div role="radiogroup" aria-labelledby="when-title" className="ucs-pills">
          {SCHEDULES.map((s) => (
            <label key={s.value} className={`ucs-pill${work.schedule === s.value ? ' is-checked' : ''}`}>
              <input type="radio" name="when" value={s.value} checked={work.schedule === s.value} onChange={() => patch({ schedule: s.value })} />
              {tr(...s.label)}
            </label>
          ))}
        </div>
        {work.schedule === 'hours' && (
          <div className="ucs-hours">
            <label className="field">
              <span className="field__label">{tr('From', 'Desde')}</span>
              <input type="time" className="input" value={work.hours.from} onChange={(e) => patch({ hours: { ...work.hours, from: e.target.value } })} />
            </label>
            <label className="field">
              <span className="field__label">{tr('To', 'Hasta')}</span>
              <input type="time" className="input" value={work.hours.to} onChange={(e) => patch({ hours: { ...work.hours, to: e.target.value } })} />
            </label>
            <span className="ucs-note">{tr('Asunción time, every day. A range past midnight runs overnight.', 'Hora de Asunción, todos los días. Un rango que pasa la medianoche funciona durante la noche.')}</span>
          </div>
        )}
      </fieldset>
      <p className="ucs-text">
        {tr(
          "Voyage status comes from the operational schedule in Connect, so the check follows GFSA's own plan.",
          'El estado del viaje viene del cronograma operativo en Connect, así que el control sigue el plan propio de GFSA.',
        )}
      </p>
    </Section>
  );
}

function RoutingSection({ work, onSteps }: { work: UcConfig; onSteps: () => void }) {
  const tr = useTr();
  const prioName = usePriorityName();
  const routing = useRouting();
  const rows = routing.ladders[work.priority] ?? [];
  return (
    <section className="card" aria-labelledby="who-title">
      <div className="ucs-sec__head ucs-sec__head--pad">
        <h2 id="who-title">
          <span className="ucs-sec__n">5</span> · {tr('Who gets the alarm', 'Quién recibe la alarma')}
        </h2>
        <span className="ucs-aside-text">
          {tr('Response steps are on', 'Los pasos de respuesta están en')}{' '}
          <button type="button" className="ucs-linkbtn" onClick={onSteps}>
            {tr('their own tab', 'su propia pestaña')}
          </button>
        </span>
      </div>
      {work.level === 'list' ? (
        <div className="ucs-sec__pad">
          <p className="ucs-text">
            {tr(
              'Record and list: nobody is alerted. Each event is logged with a clip and goes to the review queue.',
              'Registrar y listar: no se alerta a nadie. Cada evento se registra con un clip y va a la cola de revisión.',
            )}
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table" style={{ minWidth: 540 }}>
            <thead>
              <tr>
                <th scope="col">{tr('When', 'Cuándo')}</th>
                <th scope="col">{tr('Who', 'Quién')}</th>
                <th scope="col">{tr('How', 'Cómo')}</th>
                <th scope="col">{tr('Hours', 'Horario')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td>{tr(...whenText(s))}</td>
                  <td style={{ fontWeight: 600 }}>{tr(...targetText(s.target))}</td>
                  <td>{tr(...howText(s))}</td>
                  <td>{tr(...hoursText(s, routing.recipients))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="ucs-sec__foot">
        <span>{tr(`${prioName(work.priority)} routing, shared by every ${work.priority} use case`, `Enrutamiento ${prioName(work.priority)}, compartido por todos los casos de uso ${work.priority}`)}</span>
        <Link to="/config/routing" className="card__link">
          {tr('Edit alert routing', 'Editar enrutamiento de alertas')}
        </Link>
      </div>
    </section>
  );
}

// ---------- UC-06 accuracy gate ----------

function GateMetric({ label, value, target, met, bar, note }: { label: string; value: string; target: string; met?: boolean; bar?: { pct: number; target: number }; note: string }) {
  const tr = useTr();
  return (
    <div className="ucs-metric">
      <div className="ucs-metric__head">
        <span>{label}</span>
        {met !== undefined && (
          <span className={met ? 'ucs-met ucs-met--ok' : 'ucs-met ucs-met--bad'}>
            <Icon name={met ? 'check' : 'alert'} size={13} strokeWidth={2.6} />
            {met ? tr('Met', 'Cumplido') : tr('Not met', 'No cumplido')}
          </span>
        )}
      </div>
      <span className="ucs-metric__value">
        {value}
        <span>{target}</span>
      </span>
      {bar && (
        <div className="ucs-metric__bar" aria-hidden="true">
          <div style={{ width: `${bar.pct}%` }} className={met === false ? 'is-bad' : undefined} />
          <span style={{ left: `${bar.target}%` }} />
        </div>
      )}
      <span className="ucs-metric__note">{note}</span>
    </div>
  );
}

function GateCard({
  uc,
  rec,
  now,
  cameras,
  offersAlerts,
  alertsWaits,
  shadowWaits,
  onStart,
  onAlertsOn,
}: {
  uc: UseCase;
  rec: UcRecord;
  now: number;
  cameras: number;
  offersAlerts: boolean;
  alertsWaits: string[];
  shadowWaits: string[];
  onStart: () => void;
  onAlertsOn: () => void;
}) {
  const tr = useTr();
  const es = useLang() === 'es';
  const g = gateOf(uc);
  const notes = accuracyNotes(uc, rec, cameras);
  const day = shadowDay(rec, now);
  const hasScores = uc.precision !== undefined && rec.status !== 'off';
  const passed = GATE_PASSED[uc.id] ?? rec.alertsSince ?? liveOf(rec)?.push?.at;
  const sub: Bi =
    rec.status === 'live'
      ? passed
        ? [`Passed the ${TARGETS.shadowDays}-day shadow run on ${fmtDay(passed)}`, `Superó la ejecución en sombra de ${TARGETS.shadowDays} días el ${fmtDay(passed)}`]
        : ['Passed the shadow run', 'Superó la ejecución en sombra']
      : rec.status === 'shadow'
        ? [`Shadow run, alerts off · day ${day} of ${TARGETS.shadowDays}`, `Ejecución en sombra, alertas apagadas · día ${day} de ${TARGETS.shadowDays}`]
        : rec.status === 'blocked'
          ? [`Blocked · ${blockedText(uc)[0].toLowerCase()}`, `Bloqueado · ${blockedText(uc)[1].toLowerCase()}`]
          : ['Not started · follows in the fleet rollout', 'Sin iniciar · sigue en el despliegue a la flota'];

  return (
    <section className="card ucs-sec" aria-labelledby="gate-title">
      <div className="ucs-gate__head">
        <h2 id="gate-title">{tr('Accuracy against the agreed targets', 'Precisión frente a los objetivos acordados')}</h2>
        <span>{tr(...sub)}</span>
      </div>
      {rec.status === 'shadow' && rec.shadowStart && (
        <div className="ucs-shadow">
          <Meter pct={(day / TARGETS.shadowDays) * 100} label={tr('Shadow run progress', 'Avance de la ejecución en sombra')} tone={g.met ? undefined : 'warn'} />
          <span className="ucs-metric__note">
            {tr(`Started ${fmtDay(rec.shadowStart)} · ends ${fmtDay(shadowEnd(rec))} · `, `Inició el ${fmtDay(rec.shadowStart)} · termina el ${fmtDay(shadowEnd(rec))} · `)}
            {g.met ? tr('on track to switch alerts on', 'en camino a activar las alertas') : tr('alerts stay off until all three targets are met', 'las alertas siguen apagadas hasta cumplir los tres objetivos')}
          </span>
        </div>
      )}
      {hasScores ? (
        <>
          <GateMetric
            label={tr('Precision', 'Precisión')}
            value={pct(uc.precision, es)}
            target={tr(`target ${Math.round(TARGETS.precision * 100)}% or more`, `objetivo ${Math.round(TARGETS.precision * 100)} % o más`)}
            met={g.precision}
            bar={{ pct: (uc.precision ?? 0) * 100, target: TARGETS.precision * 100 }}
            note={tr(...notes.precisionNote)}
          />
          <GateMetric
            label={tr('Recall', 'Exhaustividad')}
            value={pct(uc.recall, es)}
            target={tr(`target ${Math.round(TARGETS.recall * 100)}% or more`, `objetivo ${Math.round(TARGETS.recall * 100)} % o más`)}
            met={g.recall}
            bar={{ pct: (uc.recall ?? 0) * 100, target: TARGETS.recall * 100 }}
            note={tr(...notes.recallNote)}
          />
          <GateMetric
            label={tr('False alerts per camera per day', 'Falsas alertas por cámara y día')}
            value={uc.falseAlertsPerCamDay !== undefined ? dec(uc.falseAlertsPerCamDay, es) : '—'}
            target={tr(`limit ${TARGETS.falseAlertsPerCamDay} or fewer`, `límite ${TARGETS.falseAlertsPerCamDay} o menos`)}
            met={g.falseAlerts}
            note={tr(...notes.falseNote)}
          />
        </>
      ) : (
        <p className="ucs-text">
          {rec.status === 'blocked'
            ? tr(
                'No model to score yet. Scores appear once training data exists and the held-out GFSA test set has run.',
                'Todavía no hay modelo que puntuar. Los resultados aparecen cuando existan datos de entrenamiento y se haya corrido el conjunto de prueba de GFSA.',
              )
            : tr('No scores yet. The held-out GFSA test set runs when the shadow run starts.', 'Todavía no hay resultados. El conjunto de prueba de GFSA se corre cuando inicia la ejecución en sombra.')}
        </p>
      )}
      {rec.status === 'off' && (
        <>
          <button type="button" className="btn btn--primary" disabled={shadowWaits.length > 0} aria-describedby={shadowWaits.length ? 'ucs-shadow-why' : undefined} onClick={onStart}>
            {tr(`Start ${TARGETS.shadowDays}-day shadow run`, `Iniciar ejecución en sombra de ${TARGETS.shadowDays} días`)}
          </button>
          {shadowWaits.length > 0 && (
            <p id="ucs-shadow-why" className="ucs-why">
              {tr(`Opens when ${joinList(shadowWaits, false)}.`, `Se habilita cuando ${joinList(shadowWaits, true)}.`)}
            </p>
          )}
        </>
      )}
      {offersAlerts && (
        <>
          <button type="button" className={`btn${alertsWaits.length ? '' : ' btn--primary'}`} disabled={alertsWaits.length > 0} aria-describedby={alertsWaits.length ? 'ucs-alerts-why' : undefined} onClick={onAlertsOn}>
            <Icon name={alertsWaits.length ? 'lock' : 'bell'} size={15} /> {tr('Switch alerts on', 'Activar alertas')}
          </button>
          <p id="ucs-alerts-why" className="ucs-why">
            {alertsWaits.length
              ? tr(`Opens when ${joinList(alertsWaits, false)}.`, `Se habilita cuando ${joinList(alertsWaits, true)}.`)
              : tr(
                  'Every target is met. Switching on signs and pushes a new version at record and alert.',
                  'Se cumplen todos los objetivos. Al activar se firma y envía una versión nueva con registrar y alertar.',
                )}
          </p>
        </>
      )}
    </section>
  );
}

function FalseAlertsCard({ uc, rec, canEdit, onSend }: { uc: UseCase; rec: UcRecord; canEdit: boolean; onSend: () => void }) {
  const tr = useTr();
  const fa = FALSE_REASONS[uc.id];
  if (!fa) return null;
  const max = Math.max(...fa.reasons.map((r) => r[1]));
  return (
    <section className="card ucs-sec" aria-labelledby="fa-title">
      <div className="ucs-gate__head">
        <h2 id="fa-title">{tr('Why false alerts happen', 'Por qué ocurren las falsas alertas')}</h2>
        <span>{tr(...fa.since)}</span>
      </div>
      <ul className="ucs-bars">
        {fa.reasons.map(([label, n]) => (
          <li key={label[0]}>
            <span>{tr(...label)}</span>
            <strong>{n}</strong>
            <div aria-hidden="true">
              <div style={{ width: `${(n / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
      <p className="ucs-note">{tr(...fa.note)}</p>
      {rec.trainingSent ? (
        <p className="ucs-sent" role="status">
          <Icon name="check" size={15} />
          {tr(
            `${rec.trainingClips ?? ''} clips sent to training ${fmtSmart(rec.trainingSent)}${rec.trainingBy ? ` by ${rec.trainingBy}` : ''}, under GFSA consent.`,
            `${rec.trainingClips ?? ''} clips enviados a entrenamiento ${fmtSmart(rec.trainingSent)}${rec.trainingBy ? ` por ${rec.trainingBy}` : ''}, con el consentimiento de GFSA.`,
          )}
        </p>
      ) : (
        <>
          <button type="button" className="btn" disabled={!canEdit} aria-describedby={canEdit ? undefined : 'ucs-train-why'} onClick={onSend}>
            {tr('Send these clips to training', 'Enviar estos clips a entrenamiento')}
          </button>
          {!canEdit && (
            <p id="ucs-train-why" className="ucs-why">
              {rec.status === 'blocked'
                ? tr('Opens when the use case is unblocked.', 'Se habilita cuando el caso de uso se desbloquee.')
                : tr('Sending clips to training needs the safety administrator role.', 'Enviar clips a entrenamiento requiere el rol de administrador de seguridad.')}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function TrainingDialog({ open, uc, onClose, onSend }: { open: boolean; uc: UseCase; onClose: () => void; onSend: () => void }) {
  const tr = useTr();
  const [consent, setConsent] = useState(false);
  const fa = FALSE_REASONS[uc.id];
  const total = fa?.reasons.reduce((s, r) => s + r[1], 0) ?? 0;
  return (
    <SetupDialog
      open={open}
      title={tr('Send these clips to training', 'Enviar estos clips a entrenamiento')}
      sub={tr(`${total} false-alert clips from ${uc.name}, labelled by reviewers`, `${total} clips de falsas alertas de ${uc.nameEs}, etiquetados por los revisores`)}
      onClose={onClose}
      onSubmit={() => consent && onSend()}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {tr('Cancel', 'Cancelar')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={!consent}>
            {tr('Send to training', 'Enviar a entrenamiento')}
          </button>
        </>
      }
    >
      <div className="callout callout--warn">
        <Icon name="shield" size={18} />
        <span>
          {tr(
            "GFSA owns its footage. Clips train models only with GFSA's written consent, and faces stay blurred in the training set.",
            'Las imágenes son de GFSA. Los clips entrenan modelos solo con el consentimiento escrito de GFSA, y los rostros siguen difuminados en el conjunto de entrenamiento.',
          )}
        </span>
      </div>
      <label className="check ucs-consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        {tr("GFSA's written consent covers these clips (data agreement GFSA-DA-01, signed 1 Sep 2026)", 'El consentimiento escrito de GFSA cubre estos clips (acuerdo de datos GFSA-DA-01, firmado el 1 sep 2026)')}
      </label>
      {!consent && <p className="ucs-muted">{tr('Tick the consent box to send.', 'Marque la casilla de consentimiento para enviar.')}</p>}
    </SetupDialog>
  );
}

// ---------- UC-07 versions ----------

function VersionsAside({
  rec,
  now,
  who,
  canPush,
  rollbackWhy,
  onAll,
  onRollback,
}: {
  rec: UcRecord;
  now: number;
  who: string;
  canPush: boolean;
  rollbackWhy?: string;
  onAll: () => void;
  onRollback: (v: string) => void;
}) {
  const tr = useTr();
  const draft = draftOf(rec);
  const live = liveOf(rec);
  const older = rec.versions.filter((v) => v.state === 'signed').slice(0, 1);
  const s = pushSummary(live, now);
  return (
    <section className="card" aria-labelledby="ver-title">
      <div className="ucs-sec__head ucs-sec__head--pad">
        <h2 id="ver-title">{tr('Versions on vessels', 'Versiones en los buques')}</h2>
        <button type="button" className="ucs-linkbtn" onClick={onAll}>
          {tr(`All ${rec.versions.length}`, `Las ${rec.versions.length}`)}
        </button>
      </div>
      {!rec.versions.length && <p className="ucs-sec__pad ucs-text">{tr('No versions yet.', 'Todavía no hay versiones.')}</p>}
      <ol className="ucs-vlist">
        {draft && (
          <li className="is-draft">
            <span>
              <span className="mono ucs-strong">{draft.version}</span>
              <span className="ucs-vlist__sub">
                {tr('Draft', 'Borrador')} · {draft.by === who ? tr('you', 'usted') : draft.by} · {fmtSmart(draft.at, now)}
              </span>
            </span>
            <span className="ucs-vlist__warn">{tr('Not pushed', 'Sin enviar')}</span>
          </li>
        )}
        {live && (
          <li>
            <span>
              <span className="mono ucs-strong">{live.version}</span>
              <span className="ucs-vlist__sub">
                {tr('Live · pushed', 'En vivo · enviada')} {fmtSmart(live.push?.at ?? live.at, now)}
              </span>
            </span>
            <span className="ucs-vlist__units">
              <span>{tr(`${s.confirmed} of ${s.total} units`, `${s.confirmed} de ${s.total} unidades`)}</span>
              {s.installing > 0 && <span>{tr(`${s.installing} installing`, `${s.installing} instalando`)}</span>}
              {s.waiting > 0 && <span>{tr(`${s.waiting} waiting for link`, `${s.waiting} esperan enlace`)}</span>}
            </span>
          </li>
        )}
        {older.map((v) => (
          <li key={v.version} className="is-center">
            <span>
              <span className="mono ucs-strong">{v.version}</span>
              <span className="ucs-vlist__sub">
                {tr('Signed', 'Firmada')} · {fmtDay(v.at)}
              </span>
            </span>
            {canPush && (
              <button type="button" className="btn btn--sm" disabled={!!rollbackWhy} title={rollbackWhy} onClick={() => onRollback(v.version)}>
                {live ? tr('Roll back', 'Volver') : tr('Push', 'Enviar')}
              </button>
            )}
          </li>
        ))}
      </ol>
      {rollbackWhy && canPush && older.length > 0 && <p className="ucs-sec__pad ucs-why">{rollbackWhy}</p>}
    </section>
  );
}

function PushUnitsPreview({ now, fleet }: { now: number; fleet: Fleet }) {
  const tr = useTr();
  const es = useLang() === 'es';
  const units = unitsForPushNow(now);
  return (
    <div className="table-wrap ucs-units">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">{tr('Edge unit', 'Unidad de borde')}</th>
            <th scope="col">{tr('Convoy', 'Convoy')}</th>
            <th scope="col">{tr('Installs', 'Instala')}</th>
          </tr>
        </thead>
        <tbody>
          {units.map((u) => {
            const eu = fleet.edgeUnitById(u.unitId);
            const cv = fleet.convoyById(eu?.convoyId);
            return (
              <tr key={u.unitId}>
                <td className="mono">{u.unitId}</td>
                <td>{cv?.name}</td>
                <td>
                  {u.waiting ? (
                    <StatusDot tone="off">{tr('When the link returns', 'Cuando vuelva el enlace')}</StatusDot>
                  ) : (
                    <StatusDot tone="ok">
                      {tr('Now', 'Ahora')}, {es ? cv?.linkLabel.replace(/^None/, 'Sin enlace') : cv?.linkLabel}
                    </StatusDot>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function VersionsTab({
  rec,
  now,
  who,
  canPush,
  canEdit,
  pushWhy,
  rollbackWhy,
  fleet,
  onPush,
  onDiscard,
  onRollback,
}: {
  rec: UcRecord;
  now: number;
  who: string;
  canPush: boolean;
  canEdit: boolean;
  pushWhy?: string;
  rollbackWhy?: string;
  fleet: Fleet;
  onPush: () => void;
  onDiscard: () => void;
  onRollback: (v: string) => void;
}) {
  const tr = useTr();
  const es = useLang() === 'es';
  const live = liveOf(rec);
  return (
    <div className="stack">
      {(rollbackWhy || (pushWhy && draftOf(rec))) && canPush && (
        <div className="callout" role="note">
          <Icon name="info" size={18} />
          <span>{rollbackWhy ?? pushWhy}</span>
        </div>
      )}
      <Card id="versions" title={tr('Versions', 'Versiones')} hint={tr('Every change is a signed version · roll back to any earlier one', 'Cada cambio es una versión firmada · puede volver a cualquiera anterior')} bodyClass="table-wrap">
        {rec.versions.length === 0 ? (
          <div className="empty">{tr('No versions yet. This use case stays locked until it can be trained.', 'Todavía no hay versiones. Este caso de uso sigue bloqueado hasta que se pueda entrenar.')}</div>
        ) : (
          <table className="table" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th scope="col">{tr('Version', 'Versión')}</th>
                <th scope="col">{tr('State', 'Estado')}</th>
                <th scope="col">{tr('Saved', 'Guardada')}</th>
                <th scope="col">{tr('Change', 'Cambio')}</th>
                <th scope="col">{tr('On vessels', 'En los buques')}</th>
                <th scope="col" className="right">
                  <span className="sr-only">{tr('Actions', 'Acciones')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rec.versions.map((v) => {
                const s = pushSummary(v, now);
                return (
                  <tr key={v.version} className={v.state === 'draft' ? 'ucs-row-draft' : undefined}>
                    <td className="mono ucs-strong">{v.version}</td>
                    <td>
                      {v.state === 'draft' && <Badge tone="warn">{tr('Draft', 'Borrador')}</Badge>}
                      {v.state === 'live' && <Badge tone="ok">{tr('Live', 'En vivo')}</Badge>}
                      {v.state === 'signed' && <Badge tone="outline">{tr('Signed', 'Firmada')}</Badge>}
                    </td>
                    <td>
                      {fmtSmart(v.at, now)}
                      <span className="sub">{v.by === who ? tr('You', 'Usted') : v.by}</span>
                    </td>
                    <td>{noteOf(v, es)}</td>
                    <td>
                      {v.state === 'live' ? (
                        <>
                          {tr(`${s.confirmed} of ${s.total} confirmed`, `${s.confirmed} de ${s.total} confirmadas`)}
                          <span className="sub">
                            {[s.installing && tr(`${s.installing} installing`, `${s.installing} instalando`), s.waiting && tr(`${s.waiting} waiting for link`, `${s.waiting} esperan enlace`)]
                              .filter(Boolean)
                              .join(' · ') || tr('All units on this version', 'Todas las unidades con esta versión')}
                          </span>
                        </>
                      ) : v.state === 'draft' ? (
                        <span className="ucs-muted">{tr('Not pushed', 'Sin enviar')}</span>
                      ) : (
                        <span className="ucs-muted">{v.push ? tr(`Was live from ${fmtDay(v.push.at)}`, `Estuvo en vivo desde el ${fmtDay(v.push.at)}`) : tr('Never pushed', 'Nunca enviada')}</span>
                      )}
                    </td>
                    <td className="right">
                      <span className="ucs-row-actions">
                        {v.state === 'draft' && (
                          <>
                            <button type="button" className="btn btn--sm" disabled={!canEdit} onClick={onDiscard}>
                              {tr('Discard', 'Descartar')}
                            </button>
                            {canPush && (
                              <button type="button" className="btn btn--sm btn--primary" disabled={!!pushWhy} title={pushWhy} onClick={onPush}>
                                {tr('Push', 'Enviar')}
                              </button>
                            )}
                          </>
                        )}
                        {v.state === 'signed' && canPush && (
                          <button type="button" className="btn btn--sm" disabled={!!rollbackWhy} title={rollbackWhy} onClick={() => onRollback(v.version)}>
                            {live ? tr('Roll back', 'Volver') : tr('Push', 'Enviar')}
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {live?.push && (
        <Card
          id="confirm"
          title={tr(`Confirmations for ${live.version}`, `Confirmaciones de ${live.version}`)}
          hint={tr(`Pushed ${fmtDayTime(live.push.at)} by ${live.push.by} · signed`, `Enviada ${fmtDayTime(live.push.at)} por ${live.push.by} · firmada`)}
          bodyClass="table-wrap"
        >
          <table className="table" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th scope="col">{tr('Edge unit', 'Unidad de borde')}</th>
                <th scope="col">{tr('Vessel', 'Buque')}</th>
                <th scope="col">{tr('Convoy', 'Convoy')}</th>
                <th scope="col">{tr('State', 'Estado')}</th>
              </tr>
            </thead>
            <tbody>
              {live.push.units.map((u) => {
                const eu = fleet.edgeUnitById(u.unitId);
                const cv = fleet.convoyById(eu?.convoyId);
                const confirmed = u.confirmAt && new Date(u.confirmAt).getTime() <= now;
                return (
                  <tr key={u.unitId}>
                    <td>
                      <Link to="/config/edge-units" className="mono" style={{ textDecoration: 'none' }}>
                        {u.unitId}
                      </Link>
                    </td>
                    <td>{fleet.vesselById(eu?.vesselId)?.name}</td>
                    <td>{cv?.name}</td>
                    <td>
                      {u.waiting ? (
                        <StatusDot tone="off">
                          {tr('Waiting for link', 'Esperando enlace')}
                          {cv?.link === 'none' ? tr(` · out of coverage since ${fmtTime(cv.lastSeen)}`, ` · sin cobertura desde las ${fmtTime(cv.lastSeen)}`) : ''}
                        </StatusDot>
                      ) : confirmed ? (
                        <StatusDot tone="ok">{tr(`Confirmed ${fmtSmart(u.confirmAt!, now)} · signature checked`, `Confirmada ${fmtSmart(u.confirmAt!, now)} · firma verificada`)}</StatusDot>
                      ) : (
                        <StatusDot tone="warn">{tr('Installing…', 'Instalando…')}</StatusDot>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ---------- Response steps ----------

function StepsTab({ work, patch, canEdit }: SectionProps) {
  const tr = useTr();
  const es = useLang() === 'es';
  const [newStep, setNewStep] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const en = work.steps;
  const sp = work.stepsEs ?? work.steps;
  const steps = es ? sp : en;
  const setBoth = (nextEn: string[], nextEs: string[]) => patch({ steps: nextEn, stepsEs: nextEs });
  const setText = (i: number, text: string) => (es ? patch({ stepsEs: sp.map((x, k) => (k === i ? text : x)) }) : patch({ steps: en.map((x, k) => (k === i ? text : x)) }));
  const swap = (arr: string[], i: number, j: number) => {
    const s = [...arr];
    [s[i], s[j]] = [s[j], s[i]];
    return s;
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    setBoth(swap(en, i, j), swap(sp, i, j));
  };
  const remove = (i: number) => setBoth(
    en.filter((_, k) => k !== i),
    sp.filter((_, k) => k !== i),
  );
  const add = () => {
    const t = newStep.trim();
    if (!t) return;
    setBoth([...en, t], [...sp, t]);
    setNewStep('');
    inputRef.current?.focus();
  };
  const next = es ? (work.nextStepEs ?? work.nextStep) : work.nextStep;

  return (
    <div className="row">
      <div className="grow stack">
        <Card id="steps" title={tr('Response steps', 'Pasos de respuesta')} hint={tr('Shown on the alarm, the phone page and the wheelhouse, in this order', 'Se muestran en la alarma, la página del teléfono y el puente, en este orden')}>
          {steps.length === 0 && <p className="ucs-text">{tr('No response steps yet.', 'Todavía no hay pasos de respuesta.')}</p>}
          <ol className="ucs-steps">
            {steps.map((s, i) => (
              <li key={i}>
                <span className="ucs-steps__n" aria-hidden="true">
                  {i + 1}
                </span>
                {canEdit ? (
                  <input className="input" aria-label={tr(`Step ${i + 1}`, `Paso ${i + 1}`)} value={s} onChange={(e) => setText(i, e.target.value)} />
                ) : (
                  <span className="ucs-steps__text">{s}</span>
                )}
                {canEdit && (
                  <span className="ucs-steps__tools">
                    <button type="button" className="btn btn--ghost btn--icon" aria-label={tr(`Move step ${i + 1} up`, `Subir el paso ${i + 1}`)} disabled={i === 0} onClick={() => move(i, -1)}>
                      <Icon name="chevronDown" size={18} style={{ transform: 'rotate(180deg)' }} />
                    </button>
                    <button type="button" className="btn btn--ghost btn--icon" aria-label={tr(`Move step ${i + 1} down`, `Bajar el paso ${i + 1}`)} disabled={i === steps.length - 1} onClick={() => move(i, 1)}>
                      <Icon name="chevronDown" size={18} />
                    </button>
                    <button type="button" className="btn btn--ghost btn--icon" aria-label={tr(`Delete step ${i + 1}`, `Eliminar el paso ${i + 1}`)} onClick={() => remove(i)}>
                      <Icon name="trash" size={17} />
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ol>
          {canEdit && (
            <form
              className="ucs-addstep"
              onSubmit={(e) => {
                e.preventDefault();
                add();
              }}
            >
              <label className="field grow">
                <span className="field__label">{tr('Add a step', 'Agregar un paso')}</span>
                <input
                  ref={inputRef}
                  className="input"
                  value={newStep}
                  placeholder={tr('For example: Check the clip and call the master', 'Por ejemplo: Revisar el clip y llamar al capitán')}
                  onChange={(e) => setNewStep(e.target.value)}
                />
              </label>
              <button type="submit" className="btn" disabled={!newStep.trim()} title={newStep.trim() ? undefined : tr('Type the step first', 'Escriba el paso primero')}>
                <Icon name="plus" size={16} /> {tr('Add step', 'Agregar paso')}
              </button>
            </form>
          )}
          {canEdit && (
            <p className="ucs-note">
              {tr(
                'Steps are kept in English and Spanish. You are editing the English text; switch the language in the header to edit the Spanish one. A new step starts with the same text in both.',
                'Los pasos se guardan en español e inglés. Está editando el texto en español; cambie el idioma en el encabezado para editar el inglés. Un paso nuevo empieza con el mismo texto en ambos.',
              )}
            </p>
          )}
        </Card>
      </div>
      <div className="stack ucs-aside">
        <Card id="next" title={tr('Next step on the wheelhouse display', 'Próximo paso en la pantalla del puente')} hint={tr('One line the master sees first', 'Una línea que el capitán ve primero')}>
          <label className="field">
            <span className="sr-only">{tr('Next step on the wheelhouse display', 'Próximo paso en la pantalla del puente')}</span>
            <textarea className="textarea" value={next} disabled={!canEdit} maxLength={140} onChange={(e) => patch(es ? { nextStepEs: e.target.value } : { nextStep: e.target.value })} />
            <span className="field__hint">
              {tr(`${next.length} of 140 characters · shown in the master's language on board`, `${next.length} de 140 caracteres · se muestra en el idioma del capitán a bordo`)}
            </span>
          </label>
        </Card>
        <p className="ucs-note">{tr('Step changes are saved with the draft and reach the vessels when the draft is pushed.', 'Los cambios de pasos se guardan con el borrador y llegan a los buques cuando se envía.')}</p>
      </div>
    </div>
  );
}

// ---------- Audit ----------

const ROLE_ES: Record<string, string> = Object.fromEntries([...roles.map((r) => [r.name, r.nameEs]), ['Automated', 'Automático']]);

function AuditTab({ uc, rec }: { uc: UseCase; rec: UcRecord }) {
  const { state } = useApp();
  const tr = useTr();
  const es = useLang() === 'es';
  const now = useNow(60_000);
  const live = state.audit
    .filter((a) => a.target.startsWith(uc.name))
    .map((a) => ({ at: a.at, actor: a.actor, role: a.role, action: a.action, target: a.target, details: a.details }));
  const keys = new Set(live.map((a) => `${a.action}|${a.target}`));
  const history = rec.versions.flatMap((v) => {
    const rows = [
      {
        at: v.at,
        actor: v.by,
        role: 'Safety administrator',
        action: v.state === 'draft' ? 'Saved draft' : 'Signed version',
        target: `${uc.name} ${v.version}`,
        details: noteOf(v, es),
      },
    ];
    if (v.push)
      rows.push({
        at: v.push.at,
        actor: v.push.by,
        role: 'Safety administrator',
        action: 'Pushed version',
        target: `${uc.name} ${v.version}`,
        details: tr(`To ${v.push.units.length} edge units, signed`, `A ${v.push.units.length} unidades de borde, firmada`),
      });
    return rows;
  });
  const rows = [...live, ...history.filter((h) => !keys.has(`${h.action}|${h.target}`))].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <Card
      id="audit"
      title={tr('Audit log', 'Registro de auditoría')}
      hint={tr('Changes to this use case · the full hash-chained log is under Administration', 'Cambios de este caso de uso · el registro completo encadenado está en Administración')}
      bodyClass="table-wrap"
    >
      {rows.length === 0 ? (
        <div className="empty">{tr('No changes recorded for this use case.', 'No hay cambios registrados para este caso de uso.')}</div>
      ) : (
        <table className="table" style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th scope="col">{tr('When', 'Cuándo')}</th>
              <th scope="col">{tr('Who', 'Quién')}</th>
              <th scope="col">{tr('Action', 'Acción')}</th>
              <th scope="col">{tr('Details', 'Detalles')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                  {fmtSmart(r.at, now)}
                </td>
                <td>
                  {r.actor}
                  <span className="sub">{es ? (ROLE_ES[r.role] ?? r.role) : r.role}</span>
                </td>
                <td>
                  <span className="ucs-strong">{r.action}</span>
                  <span className="sub">{r.target.slice(uc.name.length).replace(/^ · /, '').trim() || '—'}</span>
                </td>
                <td>{r.details ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="ucs-note ucs-sec__pad">{tr('Actions and details are kept as recorded, in English.', 'Las acciones y los detalles se conservan como se registraron, en inglés.')}</p>
    </Card>
  );
}
