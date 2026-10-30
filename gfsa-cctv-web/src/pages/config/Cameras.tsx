import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useBlocker, useSearchParams } from 'react-router';
import { useCases } from '../../data/useCases';
import type { Camera, UseCase } from '../../data/types';
import { Badge, PriorityBadge, Stat, Tabs, type DotTone } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useApp, useInScope } from '../../state/AppState';
import { updateUnit, useFleet, type Fleet } from '../../state/fleetStore';
import { pick, plural, useLang, useTr } from '../../lib/i18n';
import { fmtDay, fmtSmart, fmtTime, useNow } from '../../lib/time';
import {
  activeConfig,
  camStore,
  cloneZones,
  editStore,
  isoNow,
  markServiced,
  releaseHold,
  runSceneCheck,
  setRedraw,
  slotOf,
  sourceOf,
  ucStore,
  UC_SLOTS,
  useCasesOnCamera,
  usesZones,
  useStore,
  type CamSlot,
  type CamState,
  type UcRecord,
  type Zone,
} from '../../state/configStore';
import { facingText, flagText, healthNoteText, kindText, linkText, placeText, positionText, shadowDay, statusText, zoneNoteText } from './useCaseSetup';
import { ZoneEditor, ZoneList, zoneSummary } from './ZoneEditor';
import { SetupDialog } from './SetupDialog';
import './Cameras.css';

type HealthFilter = 'all' | 'healthy' | 'degraded' | 'offline' | 'held';
type View = 'cameras' | 'log';

const DEFAULT_CAMERA = 'F503-CAM-02';
const FIX_STEP = 1; // camera-health response step "Confirm the next scene check passes"

/** CAM-01 to CAM-03: camera inventory, hourly scene checks and zones held for review. */
export function CamerasPage() {
  const { state, can, log, logSystem, patchAlarm, toast } = useApp();
  const tr = useTr();
  const es = useLang() === 'es';
  const inScope = useInScope();
  const fleet = useFleet();
  const cs = useStore(camStore);
  const records = useStore(ucStore);
  const edits = useStore(editStore);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [convoyF, setConvoyF] = useState('all');
  const [healthF, setHealthF] = useState<HealthFilter>('all');
  const [ucF, setUcF] = useState('all');
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [view, setView] = useState<View>('cameras');
  const [addOpen, setAddOpen] = useState(false);

  const canEdit = can('edit_use_cases');
  const cams = cs.cameras.filter((c) => inScope(c.convoyId));
  const selected = cs.cameras.find((c) => c.id === params.get('camera')) ?? cams.find((c) => c.id === DEFAULT_CAMERA) ?? cams[0] ?? cs.cameras[0];
  const select = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('camera', id);
    setParams(next, { replace: true });
  };

  const ucByCam = useMemo(() => Object.fromEntries(cs.cameras.map((c) => [c.id, useCasesOnCamera(records, c.id)])), [cs.cameras, records]);

  // ---------- Zones being redrawn: warn before leaving ----------
  const redraws = edits.redraws ?? {};
  const redrawIds = Object.keys(redraws).filter((id) => cs.cameras.some((c) => c.id === id));
  const dirty = canEdit && redrawIds.length > 0;
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

  const saveZones = (cameraId: string) => {
    const zones = editStore.get().redraws?.[cameraId];
    if (!zones) return;
    const held = !!camStore.get().holds[cameraId];
    if (held) releaseHold(cameraId, zones);
    else camStore.set((s) => ({ ...s, zones: { ...s.zones, [cameraId]: cloneZones(zones) }, cameras: s.cameras.map((c) => (c.id === cameraId ? { ...c, zones: zones.length } : c)) }));
    setRedraw(cameraId, undefined);
    log(held ? 'Redrew zones' : 'Changed zones', `${cameraId} · ${zones.length} zones`, held ? 'After camera move · hold released' : undefined);
    toast(
      held
        ? tr(`${zones.length} zones on ${cameraId} saved and released for use.`, `${zones.length} zonas de ${cameraId} guardadas y liberadas para su uso.`)
        : tr(`${zones.length} zones on ${cameraId} saved.`, `${zones.length} zonas de ${cameraId} guardadas.`),
    );
  };

  // ---------- Filters ----------
  const filtering = q !== '' || convoyF !== 'all' || healthF !== 'all' || ucF !== 'all';
  const matches = (c: Camera) => {
    if (convoyF !== 'all' && c.convoyId !== convoyF) return false;
    if (healthF === 'held' && !cs.holds[c.id]) return false;
    if (healthF !== 'all' && healthF !== 'held' && c.health !== healthF) return false;
    if (ucF !== 'all' && !ucByCam[c.id]?.some((u) => u.id === ucF)) return false;
    if (q) {
      const hay = `${c.id} ${c.name} ${c.position} ${positionText(c.position, true)} ${fleet.vesselById(c.vesselId)?.name ?? ''}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  };
  const isOpen = (convoyId: string) => toggled[convoyId] ?? (filtering || convoyId === 'tuy' || convoyId === selected?.convoyId);

  const scopedConvoys = fleet.convoys.filter((c) => inScope(c.id));
  const shown = scopedConvoys.reduce((n, cv) => n + (isOpen(cv.id) ? cams.filter((c) => c.convoyId === cv.id && matches(c)).length : 0), 0);

  // ---------- Stats ----------
  const unitCount = new Set(cams.map((c) => c.edgeUnitId)).size;
  const healthy = cams.filter((c) => c.health === 'healthy');
  const degraded = cams.filter((c) => c.health === 'degraded');
  const offline = cams.filter((c) => c.health === 'offline');
  const zoneTotal = cams.reduce((n, c) => n + (cs.zones[c.id]?.length ?? 0), 0);
  const zoneCams = cams.filter((c) => cs.zones[c.id]?.length).length;
  const inUse = cams.filter((c) => ucByCam[c.id]?.some((u) => u.id !== 'camera-health'));
  const checksOnly = cams.filter((c) => !inUse.includes(c));
  const lastRun = cs.runs[0];
  const lastFlagged = lastRun ? lastRun.flags.filter((f) => !f.cleared).length : 0;
  const today = lastRun ? cs.runs.filter((r) => fmtDay(r.at) === fmtDay(lastRun.at)) : [];
  const flaggedToday = new Set(today.flatMap((r) => r.flags.map((f) => f.cameraId))).size;
  const queuedNow = (lastRun?.queued ?? []).filter((x) => !x.delivered);

  // ---------- CAM-02 scene check ----------
  const runCheck = () => {
    const run = runSceneCheck(state.user.name);
    const at = run.at;
    // Cameras that pass again confirm the "next scene check passes" step on their open alarms.
    for (const camId of run.cleared ?? []) {
      for (const a of state.alarms.filter((x) => x.cameraId === camId && x.useCaseId === 'camera-health' && x.state !== 'closed')) {
        patchAlarm(a.id, (x) => ({
          ...x,
          stepsDone: { ...x.stepsDone, [FIX_STEP]: x.stepsDone[FIX_STEP] ?? { by: 'Scene checks', at } },
          response: 'Scene check passed',
          activity: [...x.activity, { at, text: `Scene check passed at ${fmtTime(at)}: the image is clear again`, textEs: `Control de escena superado a las ${fmtTime(at)}: la imagen vuelve a estar clara`, actor: 'Scene checks' }],
        }));
        logSystem({ action: 'Scene check passed', target: a.id, details: `${camId} · image clear again`, source: 'Scene checks', convoyId: a.convoyId, category: 'system' });
      }
    }
    for (const f of run.flags.filter((x) => x.fresh)) {
      logSystem({ action: 'Scene check flagged camera', target: f.cameraId, details: f.note, source: 'Scene checks', category: 'system' });
    }
    log('Ran scene check', `${run.checked} cameras`, `${run.checked - run.flags.length} passed, ${run.flags.length} flagged${run.queued.length ? `, ${run.queued.map((x) => x.convoyId).join(', ')} queued on board` : ''}`);
    const passed = run.checked - run.flags.length;
    const qd = run.queued.map((x) => fleet.convoyById(x.convoyId)?.name).join(', ');
    toast(
      tr(
        `Scene check done: ${passed} passed, ${run.flags.length} flagged${run.cleared?.length ? `, ${run.cleared.length} clear again` : ''}${qd ? `. ${qd} results queued on board` : ''}.`,
        `Control de escena terminado: ${passed} superadas, ${run.flags.length} señaladas${run.cleared?.length ? `, ${run.cleared.length} de nuevo bien` : ''}${qd ? `. Resultados de ${qd} en cola a bordo` : ''}.`,
      ),
    );
  };

  // ---------- Add camera ----------
  const addCamera = (cam: Camera, source: string) => {
    camStore.set((s) => ({
      ...s,
      cameras: [...s.cameras, cam],
      zones: { ...s.zones, [cam.id]: [] },
      sources: { ...s.sources, [cam.id]: source },
      addedAt: { ...s.addedAt, [cam.id]: isoNow() },
    }));
    updateUnit(cam.edgeUnitId, (u) => ({ cameras: u.cameras + 1 }));
    setToggled((t) => ({ ...t, [cam.convoyId]: true }));
    select(cam.id);
    setAddOpen(false);
    log('Added camera', `${cam.id} · ${fleet.vesselById(cam.vesselId)?.name}`, source.replace(/\/\/[^@/]*@/, '//'), cam.convoyId);
    toast(
      tr(
        `${cam.id} added. It joins the next scene check; draw its zones before use cases run on it.`,
        `${cam.id} agregada. Entra en el próximo control de escena; dibuje sus zonas antes de que funcionen casos de uso en ella.`,
      ),
    );
  };

  const ucOptions = useCases.filter((u) => records[u.id] && records[u.id].status !== 'blocked');
  const healthWord = (c: Camera) => healthNoteText(c.healthNote, es)?.toLowerCase();

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head__text">
          <nav aria-label={tr('Breadcrumb', 'Ruta de navegación')} className="breadcrumb">
            {tr('Configuration', 'Configuración')} / {tr('Cameras and zones', 'Cámaras y zonas')}
          </nav>
          <h1 className="page-title">{tr('Cameras and zones', 'Cámaras y zonas')}</h1>
          <p className="page-sub">
            {tr(
              `${cams.length} cameras on ${unitCount} edge units · ${scopedConvoys.length} ${plural(scopedConvoys.length, 'convoy', 'convoys')}`,
              `${cams.length} cámaras en ${unitCount} unidades de borde · ${scopedConvoys.length} ${plural(scopedConvoys.length, 'convoy', 'convoyes')}`,
            )}
          </p>
        </div>
        <div className="page-head__actions cz-head-actions">
          <span className="cz-head-buttons">
            <button type="button" className="btn" onClick={runCheck}>
              <Icon name="refresh" size={16} />
              {tr('Run scene check', 'Ejecutar control de escena')}
            </button>
            <button type="button" className="btn btn--primary" disabled={!canEdit} aria-describedby={canEdit ? undefined : 'cz-add-why'} onClick={() => setAddOpen(true)}>
              <Icon name="plus" size={16} /> {tr('Add camera', 'Agregar cámara')}
            </button>
          </span>
          {!canEdit && (
            <span id="cz-add-why" className="cz-why">
              {tr('Adding cameras and changing zones needs the safety administrator role.', 'Agregar cámaras y cambiar zonas requiere el rol de administrador de seguridad.')}
            </span>
          )}
        </div>
      </div>

      <div className="stat-grid">
        <Stat label={tr('Cameras', 'Cámaras')} value={cams.length} aside={tr(`on ${unitCount} edge units`, `en ${unitCount} unidades de borde`)}>
          <span className="cz-foot cz-foot--ok">
            <Icon name="check" size={13} strokeWidth={2.6} />
            {tr(`${healthy.length} healthy`, `${healthy.length} en buen estado`)}
          </span>
        </Stat>
        <Stat label={tr('Degraded', 'Degradadas')} value={degraded.length} aside={tr(`${offline.length} offline`, `${offline.length} sin señal`)}>
          {[...degraded, ...offline].map((c) => (
            <button key={c.id} type="button" className="cz-foot cz-foot--warn cz-foot--btn" onClick={() => select(c.id)}>
              <span className={`dot ${c.health === 'offline' ? 'dot--bad' : 'dot--warn'}`} aria-hidden="true" />
              <span>
                {c.id} {c.name} · {cs.holds[c.id] ? tr('moved, zones held', 'movida, zonas retenidas') : c.health === 'offline' ? tr('no image', 'sin imagen') : healthWord(c)}
              </span>
            </button>
          ))}
        </Stat>
        <Stat
          label={tr('Zones drawn', 'Zonas dibujadas')}
          value={zoneTotal}
          aside={tr(`on ${zoneCams} cameras`, `en ${zoneCams} cámaras`)}
          foot={tr('Polygons and lines · redrawn when a camera moves', 'Polígonos y líneas · se redibujan cuando se mueve una cámara')}
        />
        <Stat
          label={tr('Cameras in use cases', 'Cámaras en casos de uso')}
          value={tr(`${inUse.length} of ${cams.length}`, `${inUse.length} de ${cams.length}`)}
          foot={
            checksOnly.every((c) => slotOf(c) === 'wheelhouse')
              ? tr(`${checksOnly.length} wheelhouse cameras on scene checks only`, `${checksOnly.length} cámaras del puente solo con controles de escena`)
              : tr(`${checksOnly.length} cameras on scene checks only`, `${checksOnly.length} cámaras solo con controles de escena`)
          }
        />
        <Stat
          label={tr('Last scene check', 'Último control de escena')}
          value={lastRun ? <span className="mono">{fmtTime(lastRun.at)}</span> : '—'}
          aside={tr(`${lastFlagged} flagged`, `${lastFlagged} señaladas`)}
          foot={lastRun ? tr(`Every hour · next ${fmtTime(new Date(lastRun.at).getTime() + 3600_000)}`, `Cada hora · próximo ${fmtTime(new Date(lastRun.at).getTime() + 3600_000)}`) : tr('Every hour', 'Cada hora')}
        />
      </div>

      <div className="row">
        <div className="grow stack">
          <Tabs<View>
            label={tr('Cameras view', 'Vista de cámaras')}
            value={view}
            onChange={setView}
            tabs={[
              { value: 'cameras', label: tr('Cameras', 'Cámaras'), count: cams.length },
              { value: 'log', label: tr('Scene check log', 'Registro de controles de escena'), count: cs.runs.length },
            ]}
          />

          {view === 'cameras' ? (
            <>
              <section className="card" aria-labelledby="cams-title">
                <div className="card__head">
                  <div className="card__title">
                    <h2 id="cams-title">{tr('Cameras', 'Cámaras')}</h2>
                    <span className="card__hint">{tr(`Grouped by convoy and vessel · ${shown} of ${cams.length} shown`, `Agrupadas por convoy y buque · ${shown} de ${cams.length} a la vista`)}</span>
                  </div>
                  <button type="button" className="card__link cz-linkbtn" onClick={() => setView('log')}>
                    {tr('Scene check log', 'Registro de controles de escena')}
                  </button>
                </div>
                <div className="cz-filters">
                  <div className="cz-search">
                    <Icon name="search" size={16} />
                    <input type="search" className="input" aria-label={tr('Filter cameras', 'Filtrar cámaras')} placeholder={tr('Filter cameras', 'Filtrar cámaras')} value={q} onChange={(e) => setQ(e.target.value)} />
                  </div>
                  <label className="cz-inline">
                    {tr('Convoy', 'Convoy')}
                    <select className="select" value={convoyF} onChange={(e) => setConvoyF(e.target.value)}>
                      <option value="all">{tr('All', 'Todos')}</option>
                      {scopedConvoys.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="cz-inline">
                    {tr('Health', 'Estado')}
                    <select className="select" value={healthF} onChange={(e) => setHealthF(e.target.value as HealthFilter)}>
                      <option value="all">{tr('All', 'Todos')}</option>
                      <option value="healthy">{tr('Healthy', 'En buen estado')}</option>
                      <option value="degraded">{tr('Degraded', 'Degradada')}</option>
                      <option value="offline">{tr('Offline', 'Sin señal')}</option>
                      <option value="held">{tr('Zones held for review', 'Zonas retenidas para revisión')}</option>
                    </select>
                  </label>
                  <label className="cz-inline">
                    {tr('Use case', 'Caso de uso')}
                    <select className="select cz-uc-select" value={ucF} onChange={(e) => setUcF(e.target.value)}>
                      <option value="all">{tr('All', 'Todos')}</option>
                      {ucOptions.map((u) => (
                        <option key={u.id} value={u.id}>
                          {pick(es ? 'es' : 'en', u.name, u.nameEs)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="table-wrap">
                  <table className="table num cz-table">
                    <thead>
                      <tr>
                        <th scope="col">{tr('Camera', 'Cámara')}</th>
                        <th scope="col">{tr('Position', 'Posición')}</th>
                        <th scope="col">{tr('Stream', 'Flujo')}</th>
                        <th scope="col">{tr('Edge unit', 'Unidad de borde')}</th>
                        <th scope="col">{tr('Health', 'Estado')}</th>
                        <th scope="col" className="right">
                          {tr('Zones', 'Zonas')}
                        </th>
                        <th scope="col" className="right">
                          {tr('Use cases', 'Casos de uso')}
                        </th>
                        <th scope="col" className="right">
                          {tr('Last check', 'Último control')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {scopedConvoys.map((cv) => {
                        const list = cams.filter((c) => c.convoyId === cv.id && matches(c));
                        if (filtering && !list.length) return null;
                        const all = cams.filter((c) => c.convoyId === cv.id);
                        const okCount = all.filter((c) => c.health === 'healthy').length;
                        const open = isOpen(cv.id);
                        const off = cv.link === 'none';
                        const vs = fleet.vesselsOf(cv.id);
                        const count = filtering ? tr(`${list.length} of ${all.length}`, `${list.length} de ${all.length}`) : `${all.length}`;
                        return (
                          <Fragment key={cv.id}>
                            <tr className="cz-convoy">
                              <td colSpan={8}>
                                <button type="button" aria-expanded={open} onClick={() => setToggled((t) => ({ ...t, [cv.id]: !open }))}>
                                  <Icon name={open ? 'chevronDown' : 'chevronRight'} size={16} />
                                  {tr(`${cv.name} convoy`, `Convoy ${cv.name}`)}
                                  <span className="cz-convoy__meta">
                                    {' '}
                                    · {tr(`${count} cameras`, `${count} cámaras`)} ·{' '}
                                    {off
                                      ? tr(`last seen ${fmtTime(cv.lastSeen)}`, `visto por última vez a las ${fmtTime(cv.lastSeen)}`)
                                      : okCount === all.length
                                        ? tr('all healthy', 'todas en buen estado')
                                        : tr(`${okCount} healthy`, `${okCount} en buen estado`)}
                                  </span>
                                  <span className="cz-convoy__link">
                                    <span className={`dot${off ? ' dot--off' : ''}`} aria-hidden="true" />
                                    {off ? tr('Out of coverage', 'Sin cobertura') : `${linkText(cv.linkLabel, es)} · ${placeText(cv.positionLabel, es)}`}
                                  </span>
                                </button>
                              </td>
                            </tr>
                            {open &&
                              vs.map((v) => {
                                const vc = list.filter((c) => c.vesselId === v.id);
                                if (!vc.length) return null;
                                return (
                                  <Fragment key={v.id}>
                                    <tr className="cz-vessel">
                                      <th scope="rowgroup" colSpan={8}>
                                        {v.name} · {kindText(v.kind, es)}
                                        <span>
                                          {' '}
                                          · {vc.length} {tr(plural(vc.length, 'camera', 'cameras'), plural(vc.length, 'cámara', 'cámaras'))}
                                        </span>
                                      </th>
                                    </tr>
                                    {vc.map((c) => (
                                      <CameraRow key={c.id} c={c} cs={cs} ucCount={ucByCam[c.id]?.length ?? 0} selected={c.id === selected?.id} onSelect={() => select(c.id)} />
                                    ))}
                                  </Fragment>
                                );
                              })}
                          </Fragment>
                        );
                      })}
                      {filtering && shown === 0 && (
                        <tr>
                          <td colSpan={8}>
                            <div className="empty">{tr('No cameras match these filters.', 'Ninguna cámara coincide con estos filtros.')}</div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="card" aria-labelledby="sc-title">
                <div className="card__head">
                  <div className="card__title">
                    <h2 id="sc-title">{tr('Scene checks', 'Controles de escena')}</h2>
                    <span className="card__hint">{tr('Every hour on every camera · run on board, results sent ashore', 'Cada hora en todas las cámaras · se hacen a bordo y los resultados se envían a tierra')}</span>
                  </div>
                  <Link to="/config/use-cases/camera-health" className="card__link">
                    {tr('Open use case', 'Abrir caso de uso')}
                  </Link>
                </div>
                <div className="cz-facts">
                  <div>
                    <span className="cz-eyebrow">{tr('What is checked', 'Qué se controla')}</span>
                    <span>{tr('Blur, glare, wet lens, camera moved or no image', 'Desenfoque, reflejos, lente mojada, cámara movida o sin imagen')}</span>
                  </div>
                  <div>
                    <span className="cz-eyebrow">{tr('When a check fails', 'Cuando un control falla')}</span>
                    <span>
                      {tr(
                        "Raises Camera offline or degraded (P3) and holds the camera's zones for review",
                        'Genera Cámara sin señal o degradada (P3) y retiene las zonas de la cámara para revisión',
                      )}
                    </span>
                  </div>
                  <div>
                    <span className="cz-eyebrow">{tr('Today', 'Hoy')}</span>
                    <span>
                      {tr(
                        `${today.length} runs · ${flaggedToday} ${plural(flaggedToday, 'camera', 'cameras')} flagged`,
                        `${today.length} controles · ${flaggedToday} ${plural(flaggedToday, 'cámara señalada', 'cámaras señaladas')}`,
                      )}
                      {queuedNow.map((x) => (
                        <Fragment key={x.convoyId}>
                          {' '}
                          · {tr(`${fleet.convoyById(x.convoyId)?.name} results queued on board since`, `resultados de ${fleet.convoyById(x.convoyId)?.name} en cola a bordo desde las`)}{' '}
                          <span className="mono">{fmtTime(x.since)}</span>
                        </Fragment>
                      ))}
                    </span>
                  </div>
                </div>
              </section>
            </>
          ) : (
            <SceneLog
              cs={cs}
              fleet={fleet}
              onPick={(id) => {
                select(id);
                setView('cameras');
              }}
            />
          )}
        </div>

        {selected ? (
          <CameraDetail key={selected.id} cam={selected} cs={cs} records={records} fleet={fleet} ucs={ucByCam[selected.id] ?? []} canEdit={canEdit} redraw={canEdit ? redraws[selected.id] : undefined} onSave={() => saveZones(selected.id)} />
        ) : (
          <section className="card cz-detail">
            <div className="empty">{tr('No cameras in this convoy scope.', 'No hay cámaras en este alcance de convoy.')}</div>
          </section>
        )}
      </div>

      <AddCameraDialog open={addOpen} cs={cs} fleet={fleet} onClose={() => setAddOpen(false)} onAdd={addCamera} />

      <SetupDialog
        open={blocker.state === 'blocked'}
        title={tr('Leave with zones not saved?', '¿Salir con zonas sin guardar?')}
        sub={tr(`Zones are being redrawn on ${redrawIds.join(', ')}.`, `Se están redibujando zonas en ${redrawIds.join(', ')}.`)}
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
                redrawIds.forEach((id) => setRedraw(id, undefined));
                blocker.proceed?.();
              }}
            >
              {tr('Discard changes', 'Descartar cambios')}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                redrawIds.forEach(saveZones);
                blocker.proceed?.();
              }}
            >
              {tr('Save zones', 'Guardar zonas')}
            </button>
          </>
        }
      >
        <p>
          {tr(
            'Saving releases held zones for use at once. Discarding keeps the zones the cameras have now.',
            'Al guardar, las zonas retenidas quedan liberadas para su uso de inmediato. Al descartar, las cámaras conservan las zonas que tienen ahora.',
          )}
        </p>
      </SetupDialog>
    </div>
  );
}

// ---------- Rows ----------

function HealthBadge({ c, held }: { c: Camera; held: boolean }) {
  const tr = useTr();
  if (c.health === 'healthy')
    return (
      <Badge tone="ok">
        <Icon name="check" size={12} strokeWidth={3} /> {tr('Healthy', 'En buen estado')}
      </Badge>
    );
  if (c.health === 'offline')
    return (
      <Badge tone="bad">
        <Icon name="wifiOff" size={12} strokeWidth={2.4} /> {tr('Offline', 'Sin señal')}
      </Badge>
    );
  return (
    <Badge tone="warn">
      <Icon name="alert" size={12} strokeWidth={2.4} /> {held ? tr('Moved', 'Movida') : tr('Degraded', 'Degradada')}
    </Badge>
  );
}

function CameraRow({ c, cs, ucCount, selected, onSelect }: { c: Camera; cs: CamState; ucCount: number; selected: boolean; onSelect: () => void }) {
  const tr = useTr();
  const es = useLang() === 'es';
  const held = !!cs.holds[c.id];
  const zones = cs.zones[c.id]?.length ?? 0;
  return (
    <tr className={`clickable${selected ? ' is-selected cz-row--sel' : ''}`} aria-selected={selected} onClick={onSelect}>
      <td>
        <Link to={`?camera=${c.id}`} replace className="strong-link cz-nowrap" aria-current={selected ? 'true' : undefined} onClick={(e) => e.stopPropagation()}>
          {c.name}
        </Link>
        <span className="mono cz-sub">{c.id}</span>
      </td>
      <td className="cz-nowrap">
        {positionText(c.position, es)}
        <span className="sub">{facingText(c.facing, es)}</span>
      </td>
      <td className="cz-nowrap">
        {c.stream}
        <span className="sub">{tr(`${c.fpsToAi} fps to AI`, `${c.fpsToAi} fps a la IA`)}</span>
      </td>
      <td className="mono cz-nowrap">{c.edgeUnitId}</td>
      <td>
        <HealthBadge c={c} held={held} />
        {held ? <span className="sub cz-nowrap">{tr('Zones held for review', 'Zonas retenidas para revisión')}</span> : c.healthNote && <span className="sub cz-nowrap">{healthNoteText(c.healthNote, es)}</span>}
      </td>
      <td className={`right${zones ? '' : ' cz-muted'}`}>{zones}</td>
      <td className="right">{ucCount}</td>
      <td className="right mono cz-nowrap">{c.lastCheck}</td>
    </tr>
  );
}

// ---------- Scene check log (CAM-02) ----------

function SceneLog({ cs, fleet, onPick }: { cs: CamState; fleet: Fleet; onPick: (id: string) => void }) {
  const tr = useTr();
  const es = useLang() === 'es';
  return (
    <section className="card" aria-labelledby="log-title">
      <div className="card__head">
        <div className="card__title">
          <h2 id="log-title">{tr('Scene check log', 'Registro de controles de escena')}</h2>
          <span className="card__hint">{tr('Newest first · run on board, results sent ashore', 'Más recientes primero · se hacen a bordo y los resultados se envían a tierra')}</span>
        </div>
      </div>
      <div className="table-wrap">
        <table className="table num" style={{ minWidth: 680 }}>
          <thead>
            <tr>
              <th scope="col">{tr('Time', 'Hora')}</th>
              <th scope="col">{tr('Run by', 'Ejecutado por')}</th>
              <th scope="col" className="right">
                {tr('Checked', 'Controladas')}
              </th>
              <th scope="col">{tr('Result', 'Resultado')}</th>
              <th scope="col">{tr('Not reached', 'Sin alcanzar')}</th>
            </tr>
          </thead>
          <tbody>
            {cs.runs.map((r) => (
              <tr key={r.id}>
                <td className="mono">{fmtSmart(r.at)}</td>
                <td>{r.by === 'Schedule' ? tr('Schedule', 'Programado') : r.by}</td>
                <td className="right">{r.checked}</td>
                <td>
                  <span className={r.flags.length ? undefined : 'cz-ok'}>
                    {tr(`${r.checked - r.flags.length} passed`, `${r.checked - r.flags.length} superadas`)}
                    {r.flags.length ? tr(`, ${r.flags.length} flagged`, `, ${r.flags.length} señaladas`) : ''}
                    {r.cleared?.length ? tr(`, ${r.cleared.length} clear again`, `, ${r.cleared.length} de nuevo bien`) : ''}
                  </span>
                  {r.flags.map((f) => (
                    <button key={f.cameraId} type="button" className="cz-flag" onClick={() => onPick(f.cameraId)}>
                      <span className="mono">{f.cameraId}</span> · {flagText(f.note, es)}
                      {f.cleared ? tr(` · cleared ${f.cleared}`, ` · resuelto ${f.cleared}`) : ''}
                    </button>
                  ))}
                </td>
                <td>
                  {r.queued.length ? (
                    r.queued.map((x) => (
                      <span key={x.convoyId} className="sub" style={{ color: 'var(--ink-2)' }}>
                        {x.delivered
                          ? tr(
                              `${fleet.convoyById(x.convoyId)?.name} · ${x.cameras} cameras · results arrived ${fmtTime(x.delivered)}`,
                              `${fleet.convoyById(x.convoyId)?.name} · ${x.cameras} cámaras · resultados recibidos a las ${fmtTime(x.delivered)}`,
                            )
                          : tr(
                              `${fleet.convoyById(x.convoyId)?.name} · ${x.cameras} cameras queued on board since ${fmtTime(x.since)}`,
                              `${fleet.convoyById(x.convoyId)?.name} · ${x.cameras} cámaras en cola a bordo desde las ${fmtTime(x.since)}`,
                            )}
                      </span>
                    ))
                  ) : (
                    <span className="cz-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------- Detail panel ----------

interface CheckLine {
  time: string;
  text: string;
  tone: 'ok' | 'warn' | 'idle' | 'muted';
}

function checksFor(cs: CamState, cam: Camera, tr: (en: string, es: string) => string, es: boolean): { lines: CheckLine[]; runs: number; passed: number } {
  const added = cs.addedAt[cam.id];
  const raw: CheckLine[] = [];
  const today = cs.runs[0] ? fmtDay(cs.runs[0].at) : '';
  for (const r of cs.runs) {
    if (fmtDay(r.at) !== today) continue;
    if (added && new Date(r.at).getTime() < new Date(added).getTime()) continue;
    const t = fmtTime(r.at);
    const q = r.queued.find((x) => x.convoyId === cam.convoyId);
    if (q && !q.delivered) raw.push({ time: t, text: tr('Queued on board', 'En cola a bordo'), tone: 'idle' });
    else if (q?.delivered) {
      raw.push(
        cam.health === 'healthy'
          ? { time: t, text: tr(`Passed on board · arrived ${fmtTime(q.delivered)}`, `Superado a bordo · recibido a las ${fmtTime(q.delivered)}`), tone: 'ok' }
          : { time: t, text: tr(`Flagged on board · arrived ${fmtTime(q.delivered)}`, `Señalada a bordo · recibido a las ${fmtTime(q.delivered)}`), tone: 'warn' },
      );
    } else {
      const f = r.flags.find((x) => x.cameraId === cam.id);
      raw.push(
        f
          ? { time: t, text: `${flagText(f.note, es)}${f.cleared ? tr(` · cleared ${f.cleared}`, ` · resuelto ${f.cleared}`) : ''}`, tone: 'warn' }
          : { time: t, text: r.cleared?.includes(cam.id) ? tr('Passed · clear again', 'Superado · de nuevo bien') : tr('Passed', 'Superado'), tone: 'ok' },
      );
    }
  }
  const lines: CheckLine[] = [];
  let i = 0;
  while (i < raw.length) {
    if (i >= 3 && raw[i].tone === 'ok') {
      let j = i;
      while (j + 1 < raw.length && raw[j + 1].tone === 'ok') j++;
      if (j > i) {
        lines.push({ time: `${raw[j].time}–${raw[i].time}`, text: tr(`${j - i + 1} passed`, `${j - i + 1} superados`), tone: 'muted' });
        i = j + 1;
        continue;
      }
    }
    lines.push(raw[i]);
    i++;
  }
  return { lines, runs: raw.filter((x) => x.tone !== 'idle').length, passed: raw.filter((x) => x.tone === 'ok').length };
}

const UC_DOT: Record<string, DotTone> = { live: 'ok', shadow: 'warn', off: 'idle', blocked: 'bad' };

/** Where "Edit zones" goes: a use case that draws zones on this camera, running on it or able to. */
function zoneUseCase(cam: Camera, ucs: UseCase[], records: Record<string, UcRecord>, zones: Zone[]): UseCase | undefined {
  const zoned = (u: UseCase) => u.id !== 'camera-health' && records[u.id] && records[u.id].status !== 'blocked' && usesZones(activeConfig(u, records[u.id]));
  const running = ucs.filter(zoned);
  const matching = running.find((u) => zones.some((z) => z.name === activeConfig(u, records[u.id]).rule.zone));
  if (matching) return matching;
  if (running[0]) return running[0];
  return useCases.filter((u) => (UC_SLOTS[u.id] ?? []).includes(slotOf(cam))).find(zoned);
}

function CameraDetail({
  cam,
  cs,
  records,
  fleet,
  ucs,
  canEdit,
  redraw,
  onSave,
}: {
  cam: Camera;
  cs: CamState;
  records: Record<string, UcRecord>;
  fleet: Fleet;
  ucs: UseCase[];
  canEdit: boolean;
  redraw?: Zone[];
  onSave: () => void;
}) {
  const { state, log, addActivity, toast } = useApp();
  const tr = useTr();
  const es = useLang() === 'es';
  const now = useNow(60_000);
  const vessel = fleet.vesselById(cam.vesselId);
  const convoy = fleet.convoyById(cam.convoyId);
  const zones = cs.zones[cam.id] ?? [];
  const hold = cs.holds[cam.id];
  const serviced = cs.serviced?.[cam.id];
  const [selZone, setSelZone] = useState<string | undefined>();
  const checks = checksFor(cs, cam, tr, es);
  const lastFlag = cs.runs[0]?.flags.find((f) => f.cameraId === cam.id && !f.cleared);
  const ucName = (u: UseCase) => pick(es ? 'es' : 'en', u.name, u.nameEs);

  const usedBy = (z: Zone) => {
    const names = ucs.filter((u) => records[u.id] && activeConfig(u, records[u.id]).rule.zone === z.name).map(ucName);
    return [zoneSummary(z, es), names.length ? tr(`used by ${names.join(', ')}`, `la usa ${names.join(', ')}`) : zoneNoteText(z.note, es)].filter(Boolean).join(' · ');
  };

  const approve = () => {
    releaseHold(cam.id);
    log('Approved zones', `${cam.id} · after camera move`);
    toast(tr(`Zones on ${cam.id} approved. Use cases use them again from the next frame.`, `Zonas de ${cam.id} aprobadas. Los casos de uso las vuelven a usar desde el próximo cuadro.`));
  };
  const startRedraw = () => setRedraw(cam.id, cloneZones(zones));

  const reportFixed = () => {
    markServiced(cam.id, state.user.name);
    const what = cam.health === 'offline' ? 'reset the camera' : 'cleaned the lens';
    for (const a of state.alarms.filter((x) => x.cameraId === cam.id && x.useCaseId === 'camera-health' && x.state !== 'closed')) {
      addActivity(a.id, `Crew reports they ${what}; waiting for the next scene check`, cam.health === 'offline' ? 'La tripulación informa que reinició la cámara; se espera el próximo control de escena' : 'La tripulación informa que limpió la lente; se espera el próximo control de escena');
    }
    log('Recorded crew report', cam.id, `Crew ${what}`, cam.convoyId);
    toast(tr(`Noted for ${cam.id}. The next scene check confirms it; run one now to check at once.`, `Anotado para ${cam.id}. El próximo control de escena lo confirma; ejecute uno ahora para comprobarlo ya.`));
  };

  const zoneUc = zoneUseCase(cam, ucs, records, zones);
  const editInPlace = !zoneUc && zones.length > 0 && canEdit;
  const shown = redraw ?? zones;
  const liveHref = `/video-wall?convoy=${cam.convoyId}&camera=${cam.id}`;
  const slot: CamSlot = slotOf(cam);

  return (
    <section className="card cz-detail" aria-labelledby="cam-title">
      <div className="cz-detail__head">
        <div>
          <h2 id="cam-title">
            <span className="mono">{cam.id}</span> · {cam.name}
          </h2>
          <span className="card__hint">
            {tr('Selected camera', 'Cámara seleccionada')} · {vessel?.name}
          </span>
        </div>
        <HealthBadge c={cam} held={!!hold} />
      </div>
      <div className="cz-detail__body">
        {hold && (
          <div className="callout callout--warn cz-hold" role="note">
            <Icon name="alert" size={18} />
            <div className="cz-hold__text">
              <strong>{tr(`Zones held for review since ${fmtTime(hold.since)}`, `Zonas retenidas para revisión desde las ${fmtTime(hold.since)}`)}</strong>
              <span>
                {es ? (hold.reasonEs ?? hold.reason) : hold.reason}{' '}
                {tr(`Its ${zones.length} zones are not used until someone approves or redraws them.`, `Sus ${zones.length} zonas no se usan hasta que alguien las apruebe o redibuje.`)}
              </span>
              {canEdit ? (
                !redraw && (
                  <span className="cz-hold__actions">
                    <button type="button" className="btn btn--sm btn--primary" onClick={approve}>
                      <Icon name="check" size={14} /> {tr('Approve zones', 'Aprobar zonas')}
                    </button>
                    <button type="button" className="btn btn--sm" onClick={startRedraw}>
                      <Icon name="edit" size={14} /> {tr('Redraw', 'Redibujar')}
                    </button>
                  </span>
                )
              ) : (
                <span>{tr('Approving or redrawing zones needs the safety administrator role.', 'Aprobar o redibujar zonas requiere el rol de administrador de seguridad.')}</span>
              )}
            </div>
          </div>
        )}

        <ZoneEditor
          image={cam.image}
          alt={tr(
            `Reference view of the ${cam.name.toLowerCase()} camera on ${vessel?.name}${zones.length ? ` with ${zones.map((z) => z.name).join(' and ')}` : ''}`,
            `Vista de referencia de la cámara ${cam.name} de ${vessel?.name}${zones.length ? ` con ${zones.map((z) => z.name).join(' y ')}` : ''}`,
          )}
          tag={
            <>
              {tr('Reference view', 'Vista de referencia')} · <span className="mono">{cam.lastCheck}</span>&nbsp;{tr('scene check', 'control de escena')}
            </>
          }
          zones={shown}
          onChange={redraw ? (z) => setRedraw(cam.id, z) : undefined}
          selectedId={selZone}
          onSelect={setSelZone}
          degraded={cam.health === 'degraded' && !hold}
        />
        {redraw && (
          <div className="cz-redraw-actions">
            <span className="cz-muted">
              {tr('Drag the points onto the new view, or draw the zones again. Kept here until you save or cancel.', 'Arrastre los puntos sobre la nueva vista o dibuje las zonas de nuevo. Se conservan aquí hasta que guarde o cancele.')}
            </span>
            <button type="button" className="btn btn--sm" onClick={() => setRedraw(cam.id, undefined)}>
              {tr('Cancel', 'Cancelar')}
            </button>
            <button type="button" className="btn btn--sm btn--primary" onClick={onSave}>
              {hold ? tr('Save and release zones', 'Guardar y liberar zonas') : tr('Save zones', 'Guardar zonas')}
            </button>
          </div>
        )}

        <dl className="dl cz-dl">
          <dt>{tr('Vessel', 'Buque')}</dt>
          <dd>
            {vessel?.name} · {tr(`${convoy?.name} convoy`, `convoy ${convoy?.name}`)}
          </dd>
          <dt>{tr('Edge unit', 'Unidad de borde')}</dt>
          <dd>
            <Link to="/config/edge-units" className="mono" style={{ textDecoration: 'none' }}>
              {cam.edgeUnitId}
            </Link>
          </dd>
          <dt>{tr('Source', 'Fuente')}</dt>
          <dd className="cz-break">{es ? sourceOf(cs, cam).replace(/^Recorder/, 'Grabador') : sourceOf(cs, cam)}</dd>
          <dt>{tr('To AI', 'A la IA')}</dt>
          <dd>{tr(`${cam.fpsToAi} frames a second`, `${cam.fpsToAi} imágenes por segundo`)}</dd>
          <dt>{tr('Health', 'Estado')}</dt>
          <dd>
            <span className="with-dot">
              <span className={`dot${cam.health === 'healthy' ? '' : cam.health === 'degraded' ? ' dot--warn' : ' dot--bad'}`} aria-hidden="true" />
              {cam.health === 'healthy' ? tr('Healthy', 'En buen estado') : cam.health === 'degraded' ? (hold ? tr('Moved', 'Movida') : tr('Degraded', 'Degradada')) : tr('Offline', 'Sin señal')}
            </span>
            <span className="cz-sub">
              {cam.lastCheck === '—'
                ? tr('Waiting for its first scene check', 'Esperando su primer control de escena')
                : lastFlag
                  ? tr(
                      `${lastFlag.note} at the ${cam.lastCheck} scene check${cam.healthNote && !hold ? ` · ${cam.healthNote.toLowerCase()}` : ''}`,
                      `${flagText(lastFlag.note, true)} en el control de escena de las ${cam.lastCheck}${cam.healthNote && !hold ? ` · ${healthNoteText(cam.healthNote, true)?.toLowerCase()}` : ''}`,
                    )
                  : convoy?.link === 'none'
                    ? tr(`Last scene check ${cam.lastCheck} · results queued on board`, `Último control de escena ${cam.lastCheck} · resultados en cola a bordo`)
                    : tr(`Scene check passed ${cam.lastCheck}`, `Control de escena superado a las ${cam.lastCheck}`)}
            </span>
            {cam.health !== 'healthy' && !hold && (
              <span className="cz-fix">
                {serviced ? (
                  <span className="cz-sub" role="status">
                    {tr(
                      `Crew reported it fixed at ${fmtTime(serviced.at)} (${serviced.by}). The next scene check confirms it${convoy?.link === 'none' ? ' when the link returns' : ''}.`,
                      `La tripulación informó que se arregló a las ${fmtTime(serviced.at)} (${serviced.by}). El próximo control de escena lo confirma${convoy?.link === 'none' ? ' cuando vuelva el enlace' : ''}.`,
                    )}
                  </span>
                ) : (
                  <button type="button" className="btn btn--sm" onClick={reportFixed}>
                    <Icon name="check" size={14} /> {cam.health === 'offline' ? tr('Crew reset the camera', 'La tripulación reinició la cámara') : tr('Crew cleaned the lens', 'La tripulación limpió la lente')}
                  </button>
                )}
              </span>
            )}
          </dd>
          <dt>{tr('Privacy', 'Privacidad')}</dt>
          <dd>{tr('Faces blurred on export', 'Rostros difuminados al exportar')}</dd>
        </dl>

        <div className="cz-block">
          <div className="cz-block__head">
            <span className="cz-eyebrow">{tr('Zones', 'Zonas')}</span>
            <span>{tr(`${zones.length} on this camera`, `${zones.length} en esta cámara`)}</span>
          </div>
          <ZoneList zones={shown} selectedId={selZone} onSelect={setSelZone} describe={usedBy} />
        </div>

        <div className="cz-block">
          <div className="cz-block__head">
            <span className="cz-eyebrow">{tr('Use cases on this camera', 'Casos de uso en esta cámara')}</span>
            <span>{ucs.length}</span>
          </div>
          {ucs.length === 0 && <p className="cz-muted">{tr('None yet. Add this camera to a use case in its set-up.', 'Ninguno todavía. Agregue esta cámara a un caso de uso en su configuración.')}</p>}
          {ucs.map((u) => {
            const r = records[u.id];
            const cfg = activeConfig(u, r);
            const zoneText = cfg.rule.zone && cfg.rule.zone !== 'Anywhere in view' && zones.some((z) => z.name === cfg.rule.zone) ? tr(` · zone ${cfg.rule.zone}`, ` · zona ${cfg.rule.zone}`) : '';
            const note =
              r.status === 'live' && u.id !== 'camera-health'
                ? cfg.level === 'alert'
                  ? tr(`Live · alert${zoneText}`, `En vivo · alerta${zoneText}`)
                  : tr(`Live · record and list${zoneText}`, `En vivo · registrar y listar${zoneText}`)
                : r.status === 'shadow'
                  ? tr(`Shadow run · day ${shadowDay(r, now)} of 14 · logged only`, `Ejecución en sombra · día ${shadowDay(r, now)} de 14 · solo registro`)
                  : tr(...statusText(u, r, now));
            return (
              <Link key={u.id} to={`/config/use-cases/${u.id}?camera=${cam.id}`} className="cz-uc">
                <span className="cz-uc__top">
                  <span className="cz-uc__name">{ucName(u)}</span>
                  <PriorityBadge p={cfg.priority} />
                </span>
                <span className="cz-uc__note">
                  <span className={`dot${UC_DOT[r.status] === 'ok' ? '' : ` dot--${UC_DOT[r.status]}`}`} aria-hidden="true" />
                  {note}
                </span>
              </Link>
            );
          })}
        </div>

        <div className="cz-block">
          <div className="cz-block__head">
            <span className="cz-eyebrow">{tr('Scene checks, today', 'Controles de escena, hoy')}</span>
            <span>{tr(`${checks.runs} run · ${checks.passed} passed`, `${checks.runs} hechos · ${checks.passed} superados`)}</span>
          </div>
          {checks.lines.length === 0 ? (
            <p className="cz-muted">{tr('No scene checks yet. The camera joins the next hourly run.', 'Todavía no hay controles de escena. La cámara entra en el próximo control horario.')}</p>
          ) : (
            <div className="cz-checks">
              {checks.lines.map((l, i) => (
                <Fragment key={i}>
                  <span className={`mono${l.tone === 'muted' ? ' cz-muted' : ''}`}>{l.time}</span>
                  <span className={`cz-check cz-check--${l.tone}`}>
                    {l.tone === 'ok' && <Icon name="check" size={12} strokeWidth={3} />}
                    {l.tone === 'warn' && <Icon name="alert" size={12} strokeWidth={2.4} />}
                    {l.tone === 'idle' && <Icon name="wifiOff" size={12} strokeWidth={2.4} />}
                    {l.text}
                  </span>
                </Fragment>
              ))}
            </div>
          )}
        </div>

        <div className="cz-actions">
          {zoneUc ? (
            <Link to={`/config/use-cases/${zoneUc.id}?camera=${cam.id}`} className="btn" title={tr(`Zones are edited in the ${zoneUc.name} set-up, as a signed version`, `Las zonas se editan en la configuración de ${zoneUc.nameEs}, como versión firmada`)}>
              <Icon name="edit" size={16} /> {canEdit ? tr('Edit zones', 'Editar zonas') : tr('View zones', 'Ver zonas')}
            </Link>
          ) : (
            <button type="button" className="btn" disabled={!editInPlace || !!redraw} aria-describedby={editInPlace ? undefined : 'cz-zones-why'} onClick={startRedraw}>
              <Icon name="edit" size={16} /> {tr('Edit zones', 'Editar zonas')}
            </button>
          )}
          <Link to={liveHref} className="btn btn--primary">
            <Icon name="video" size={16} /> {tr('Open live view', 'Abrir vista en vivo')}
          </Link>
        </div>
        {!zoneUc && !editInPlace && (
          <p id="cz-zones-why" className="cz-why">
            {zones.length > 0
              ? tr('Changing these zones needs the safety administrator role.', 'Cambiar estas zonas requiere el rol de administrador de seguridad.')
              : slot === 'wheelhouse'
                ? tr(
                    'Wheelhouse cameras only run scene checks, which look at the whole image, so there are no zones to draw. Edit zones opens once a use case that uses zones runs on this camera.',
                    'Las cámaras del puente solo tienen controles de escena, que miran toda la imagen, así que no hay zonas que dibujar. Editar zonas se habilita cuando funcione en esta cámara un caso de uso con zonas.',
                  )
                : tr(
                    'No use case that draws zones can run on this camera position yet. Edit zones opens once one is set up for it.',
                    'Todavía ningún caso de uso con zonas puede funcionar en esta posición de cámara. Editar zonas se habilita cuando se configure uno.',
                  )}
          </p>
        )}
      </div>
    </section>
  );
}

// ---------- Add camera ----------

const POSITIONS: { value: string; kind: 'tug' | 'barge'; image: string }[] = [
  { value: 'Barge, deck', kind: 'barge', image: 'cam-deck-forward' },
  { value: 'Barge, port side', kind: 'barge', image: 'cam-port-edge' },
  { value: 'Barge, starboard side', kind: 'barge', image: 'cam-port-edge' },
  { value: 'Barge, reefer row', kind: 'barge', image: 'cam-reefer-row' },
  { value: 'Tug, wheelhouse', kind: 'tug', image: 'cam-wheelhouse' },
  { value: 'Tug, engine room', kind: 'tug', image: 'cam-engine-room' },
  { value: 'Tug, bow', kind: 'tug', image: 'cam-bow-forward' },
];

const SLOT_DEFAULT_FPS: Record<CamSlot, number> = { wheelhouse: 5, engine: 5, bow: 12, deck: 5, edge: 5, reefer: 5 };
const FACINGS = ['Forward-facing', 'Aft-facing', 'Overhead'];

function AddCameraDialog({ open, cs, fleet, onClose, onAdd }: { open: boolean; cs: CamState; fleet: Fleet; onClose: () => void; onAdd: (c: Camera, source: string) => void }) {
  const tr = useTr();
  const es = useLang() === 'es';
  const [name, setName] = useState('');
  const [vesselId, setVesselId] = useState('f501');
  const vessel = fleet.vesselById(vesselId) ?? fleet.vessels[0];
  const positions = POSITIONS.filter((p) => p.kind === vessel.kind);
  const [position, setPosition] = useState(positions[0].value);
  const [facing, setFacing] = useState('Forward-facing');
  const [kind, setKind] = useState<'RTSP' | 'ONVIF'>('RTSP');
  const [address, setAddress] = useState('');
  const [stream, setStream] = useState('1080p30');
  const [fps, setFps] = useState(5);
  const [tried, setTried] = useState(false);

  const pos = positions.find((p) => p.value === position) ?? positions[0];
  const addrOk = kind === 'RTSP' ? /^rtsp:\/\/\S+/.test(address) : /^https?:\/\/\S+/.test(address);
  const nameErr = !name.trim() ? tr('Give the camera a name the crew will recognise.', 'Dé a la cámara un nombre que la tripulación reconozca.') : '';
  const addrErr = !address.trim()
    ? tr(`Enter the camera's ${kind} address.`, `Escriba la dirección ${kind} de la cámara.`)
    : !addrOk
      ? kind === 'RTSP'
        ? tr('An RTSP address starts with rtsp://', 'Una dirección RTSP empieza con rtsp://')
        : tr('An ONVIF device address starts with http:// or https://', 'La dirección de un dispositivo ONVIF empieza con http:// o https://')
      : '';
  const dupe = cs.cameras.some((c) => c.vesselId === vesselId && c.name.trim().toLowerCase() === name.trim().toLowerCase());
  const dupeErr = name.trim() && dupe ? tr(`${vessel.name} already has a camera called “${name.trim()}”.`, `${vessel.name} ya tiene una cámara llamada «${name.trim()}».`) : '';

  const reset = () => {
    setName('');
    setAddress('');
    setTried(false);
    setFps(5);
  };

  const submit = () => {
    setTried(true);
    if (nameErr || addrErr || dupeErr) return;
    const onVessel = cs.cameras.filter((c) => c.vesselId === vesselId);
    const prefix = onVessel[0]?.id.split('-CAM-')[0] ?? vessel.edgeUnitId.split('-EU-')[0];
    let n = onVessel.length + 1;
    while (cs.cameras.some((c) => c.id === `${prefix}-CAM-${String(n).padStart(2, '0')}`)) n++;
    const id = `${prefix}-CAM-${String(n).padStart(2, '0')}`;
    const cam: Camera = {
      id,
      name: name.trim(),
      vesselId,
      convoyId: vessel.convoyId,
      edgeUnitId: vessel.edgeUnitId,
      position: pos.value,
      facing,
      stream,
      fpsToAi: fps,
      health: 'healthy',
      healthNote: 'Added · waiting for the first scene check',
      zones: 0,
      useCases: 0,
      lastCheck: '—',
      image: `/media/${pos.image}.svg`,
    };
    onAdd(cam, `${kind} · ${address.trim()} · ${stream}`);
    reset();
  };

  const close = () => {
    reset();
    onClose();
  };

  return (
    <SetupDialog
      open={open}
      title={tr('Add camera', 'Agregar cámara')}
      sub={tr('The edge unit picks the stream up without a restart.', 'La unidad de borde toma el flujo sin reiniciarse.')}
      onClose={close}
      onSubmit={submit}
      actions={
        <>
          <button type="button" className="btn" onClick={close}>
            {tr('Cancel', 'Cancelar')}
          </button>
          <button type="submit" className="btn btn--primary">
            <Icon name="plus" size={16} /> {tr('Add camera', 'Agregar cámara')}
          </button>
        </>
      }
    >
      <div className="cz-form">
        <label className="field cz-form__wide">
          <span className="field__label">{tr('Name', 'Nombre')}</span>
          <input
            className="input"
            value={name}
            placeholder={tr('For example: Starboard edge', 'Por ejemplo: Borde de estribor')}
            aria-invalid={tried && !!(nameErr || dupeErr)}
            aria-describedby={tried && (nameErr || dupeErr) ? 'cz-name-err' : undefined}
            onChange={(e) => setName(e.target.value)}
          />
          {tried && (nameErr || dupeErr) && (
            <span id="cz-name-err" className="cz-err">
              {nameErr || dupeErr}
            </span>
          )}
        </label>
        <label className="field">
          <span className="field__label">{tr('Vessel', 'Buque')}</span>
          <select
            className="select"
            value={vesselId}
            onChange={(e) => {
              const v = fleet.vesselById(e.target.value);
              if (!v) return;
              setVesselId(v.id);
              const first = POSITIONS.find((p) => p.kind === v.kind)!;
              setPosition(first.value);
              setFps(SLOT_DEFAULT_FPS[slotOf({ position: first.value })]);
            }}
          >
            {fleet.convoys.map((cv) => (
              <optgroup key={cv.id} label={tr(`${cv.name} convoy`, `Convoy ${cv.name}`)}>
                {fleet.vesselsOf(cv.id).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} · {kindText(v.kind, es)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className="field__hint">
            {tr('Edge unit', 'Unidad de borde')} <span className="mono">{vessel.edgeUnitId}</span>
          </span>
        </label>
        <label className="field">
          <span className="field__label">{tr('Position', 'Posición')}</span>
          <select
            className="select"
            value={pos.value}
            onChange={(e) => {
              setPosition(e.target.value);
              setFps(SLOT_DEFAULT_FPS[slotOf({ position: e.target.value })]);
            }}
          >
            {positions.map((p) => (
              <option key={p.value} value={p.value}>
                {positionText(p.value, es)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">{tr('Facing', 'Orientación')}</span>
          <select className="select" value={facing} onChange={(e) => setFacing(e.target.value)}>
            {FACINGS.map((f) => (
              <option key={f} value={f}>
                {facingText(f, es)}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="cz-fieldset">
          <legend className="field__label">{tr('Source', 'Fuente')}</legend>
          <div className="cz-radios">
            {(['RTSP', 'ONVIF'] as const).map((k) => (
              <label key={k} className="check">
                <input type="radio" name="cz-source" checked={kind === k} onChange={() => setKind(k)} />
                {k === 'RTSP' ? tr('RTSP stream', 'Flujo RTSP') : tr('ONVIF device', 'Dispositivo ONVIF')}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="field cz-form__wide">
          <span className="field__label">{kind === 'RTSP' ? tr('RTSP address', 'Dirección RTSP') : tr('ONVIF device address', 'Dirección del dispositivo ONVIF')}</span>
          <input
            className="input mono"
            value={address}
            placeholder={kind === 'RTSP' ? 'rtsp://10.20.5.21:554/stream1' : 'http://10.20.5.21/onvif/device_service'}
            aria-invalid={tried && !!addrErr}
            aria-describedby={tried && addrErr ? 'cz-addr-err' : 'cz-addr-hint'}
            onChange={(e) => setAddress(e.target.value)}
          />
          {tried && addrErr ? (
            <span id="cz-addr-err" className="cz-err">
              {addrErr}
            </span>
          ) : (
            <span id="cz-addr-hint" className="field__hint">
              {tr('On the vessel network. Credentials are stored on the edge unit, not ashore.', 'En la red del buque. Las credenciales se guardan en la unidad de borde, no en tierra.')}
            </span>
          )}
        </label>
        <label className="field">
          <span className="field__label">{tr('Stream', 'Flujo')}</span>
          <select className="select" value={stream} onChange={(e) => setStream(e.target.value)}>
            <option>1080p30</option>
            <option>720p30</option>
            <option>4K15</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">{tr('Frames a second to AI', 'Imágenes por segundo a la IA')}</span>
          <input className="input" type="number" min={1} max={15} value={fps} onChange={(e) => setFps(Math.max(1, Math.min(15, Number(e.target.value) || 1)))} />
          <span className="field__hint">{tr('5 for most use cases, 10 to 15 for bow and overboard', '5 para la mayoría de los casos de uso, 10 a 15 para proa y hombre al agua')}</span>
        </label>
      </div>
    </SetupDialog>
  );
}
