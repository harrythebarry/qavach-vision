import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Badge, Card, PageHeader, Stat } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useApp, useInScope } from '../../state/AppState';
import { useFleet, type Fleet } from '../../state/fleetStore';
import type { EdgeUnit } from '../../data/types';
import { useStore } from '../../lib/persist';
import { useTr } from '../../lib/i18n';
import { useExporter } from '../../lib/exporting';
import { downloadBlob } from '../../lib/download';
import { fmtDayTime, fmtDuration, fmtTime, fmtTimeSec, scenarioNow, useNow } from '../../lib/time';
import { PageDialog } from './PageDialog';
import type { Tr } from './routingText';
import {
  DIAG_MS,
  DIAG_STEPS,
  DIAG_STEP_MS,
  RESTART_MS,
  connectEdgeOps,
  opsStore,
  reachable,
  requestDiagnostics,
  rolloutStore,
  startRestart,
  startRollout,
  type DiagRun,
} from '../../state/edgeOps';
import './EdgeUnits.css';

// EU-01 to EU-03: edge unit health, model rollout, remote diagnostics and restart.

const VERSION_INFO: Record<string, [string, string]> = {
  'v1.4.1': ['Signed 28 Sep', 'Firmada el 28 sep'],
  'v1.4.2': ['Signed 12 Oct', 'Firmada el 12 oct'],
  'v1.4.3': ['Signed 15 Oct', 'Firmada el 15 oct'],
};

/** Health messages arrive every minute, one second past the minute. */
const lastHealthAt = (now: number) => Math.floor((now - 1000) / 60000) * 60000 + 1000;

const mbps = (link: string) => parseFloat(/([\d.]+)\s*Mbps/.exec(link)?.[1] ?? '0');

function statusName(s: EdgeUnit['status'], tr: Tr) {
  switch (s) {
    case 'reporting':
      return tr('Reporting', 'Reportando');
    case 'out_of_coverage':
      return tr('Out of coverage', 'Sin cobertura');
    case 'restarting':
      return tr('Restarting', 'Reiniciando');
    case 'fault':
      return tr('Fault', 'Falla');
  }
}

export function EdgeUnitsPage() {
  const { state, can, log, logSystem, toast } = useApp();
  const tr = useTr();
  const inScope = useInScope();
  const now = useNow();
  const fleet = useFleet();
  const ex = useExporter();
  const rollout = useStore(rolloutStore);
  const ops = useStore(opsStore);
  const canPush = can('push_models');
  const me = state.user.name;

  // The watcher finishes restarts, installs and diagnostics, also after you leave this screen.
  useEffect(() => {
    connectEdgeOps({ logSystem, toast, es: state.lang === 'es' });
  }, [logSystem, toast, state.lang]);

  const [selectedId, setSelectedId] = useState('F503-EU-01');
  const [dialog, setDialog] = useState<null | 'push' | 'rollback' | 'restart'>(null);

  const scoped = fleet.edgeUnits.filter((u) => inScope(u.convoyId));
  const selected = scoped.find((u) => u.id === selectedId) ?? scoped[0];

  const reporting = scoped.filter((u) => u.status === 'reporting');
  const offline = scoped.filter((u) => u.status === 'out_of_coverage');
  const restarting = scoped.filter((u) => u.status === 'restarting');
  const installing = scoped.filter((u) => rollout.installing[u.id]);
  const confirmed = scoped.filter((u) => !rollout.installing[u.id] && u.modelVersion === rollout.version && u.modelConfirmed);
  const waiting = scoped.filter((u) => !installing.includes(u) && !confirmed.includes(u));
  const queuedEvents = scoped.reduce((s, u) => s + u.queue.events, 0);
  const queuedClips = scoped.reduce((s, u) => s + u.queue.clips, 0);
  const storageAvg = scoped.length ? Math.round(scoped.reduce((s, u) => s + u.storagePct, 0) / scoped.length) : 0;
  const scopedConvoys = fleet.convoys.filter((c) => inScope(c.id));
  const offConvoys = scopedConvoys.filter((c) => c.link === 'none');
  const health = lastHealthAt(now);
  const busy = Object.keys(rollout.installing).length > 0;
  const allUnits = fleet.edgeUnits;

  const vesselLabel = (u: EdgeUnit) => {
    const v = fleet.vesselById(u.vesselId);
    return v?.kind === 'tug' ? tr(`${v.name} · tug`, `${v.name} · remolcador`) : (v?.name ?? u.vesselId);
  };
  const convoyText = (id: string) => tr(`${fleet.convoyById(id)?.name ?? id} convoy`, `convoy ${fleet.convoyById(id)?.name ?? id}`);

  // Link budget: what the units send against the share of the link kept for live video.
  const budgetConvoy = scopedConvoys.find((c) => c.link !== 'none') ?? scopedConvoys[0];
  const budgetUsed = budgetConvoy ? fleet.unitsOf(budgetConvoy.id).reduce((s, u) => s + (u.status === 'out_of_coverage' ? 0 : mbps(u.link)), 0) : 0;

  const push = () => {
    if (!rollout.draft) return;
    const v = rollout.draft;
    const r = startRollout(v, { previous: rollout.version, draft: null, pushedAt: scenarioNow(), pushedBy: me });
    log('Pushed model to vessels', v, `${r.now.length} installing now, ${r.waiting.length} waiting for link`);
    toast(
      tr(
        `${v} pushed. ${r.now.length} units in port or on a strong link install now; ${r.waiting.length} wait for the link.`,
        `${v} enviada. ${r.now.length} unidades en puerto o con enlace fuerte la instalan ahora; ${r.waiting.length} esperan el enlace.`,
      ),
    );
    setDialog(null);
  };

  const rollback = () => {
    if (!rollout.previous) return;
    const v = rollout.previous;
    const from = rollout.version;
    const r = startRollout(v, { previous: null, draft: rollout.draft ?? from, pushedAt: scenarioNow(), pushedBy: me });
    log('Rolled back model', v, `From ${from} · ${r.now.length} now, ${r.waiting.length} waiting for link`);
    toast(
      tr(
        `Rolling back to ${v}. The signed previous version reinstalls on ${r.now.length} units in reach; the rest when their link returns.`,
        `Volviendo a ${v}. La versión anterior firmada se reinstala en ${r.now.length} unidades al alcance; el resto cuando vuelva su enlace.`,
      ),
    );
    setDialog(null);
  };

  const onDiagnostics = (u: EdgeUnit) => {
    const phase = requestDiagnostics(u, me);
    if (phase === 'queued') {
      log('Requested diagnostics', u.id, u.status === 'restarting' ? 'Queued until the restart finishes' : 'Queued on shore, no link');
      toast(
        u.status === 'restarting'
          ? tr(`Diagnostics for ${u.id} queued. They run when the restart finishes.`, `Diagnóstico de ${u.id} en cola. Se ejecuta cuando termine el reinicio.`)
          : tr(`Diagnostics for ${u.id} queued. The unit runs them when the link returns.`, `Diagnóstico de ${u.id} en cola. La unidad lo ejecuta cuando vuelva el enlace.`),
      );
    } else {
      log('Requested diagnostics', u.id);
    }
  };

  const restart = (u: EdgeUnit) => {
    startRestart(u, me);
    log('Restarted pipeline', u.id, 'Alerts keep working on board during the restart');
    toast(tr(`Restarting the pipeline on ${u.id}. Alerts keep working on board during the restart.`, `Reiniciando el pipeline de ${u.id}. Las alertas siguen funcionando a bordo durante el reinicio.`));
    setDialog(null);
  };

  const downloadReport = () => {
    const rows = scoped.map((u) => [
      u.id,
      fleet.vesselById(u.vesselId)?.name ?? '',
      fleet.convoyById(u.convoyId)?.name ?? '',
      statusName(u.status, tr),
      u.status === 'out_of_coverage' ? tr('None', 'Ninguno') : u.link,
      u.queue.events,
      u.queue.clips,
      u.modelVersion,
      u.modelConfirmed ? tr('yes', 'sí') : tr('no', 'no'),
      u.storagePct,
      u.tempC,
      u.gpuPct,
      u.inferenceMs,
      ops.restartedAt[u.id] ? 0 : u.uptimeDays,
      u.status === 'out_of_coverage' ? fmtDayTime(fleet.convoyById(u.convoyId)?.lastSeen ?? now) : fmtDayTime(health),
    ]);
    ex.csv(
      `edge-unit-health-${fmtTime(now).replace(':', '')}.csv`,
      [
        [
          tr('Unit', 'Unidad'),
          tr('Vessel', 'Embarcación'),
          tr('Convoy', 'Convoy'),
          tr('Status', 'Estado'),
          tr('Link', 'Enlace'),
          tr('Queued events', 'Eventos en cola'),
          tr('Queued clips', 'Clips en cola'),
          tr('Model', 'Modelo'),
          tr('Confirmed', 'Confirmado'),
          tr('Storage %', 'Almacenamiento %'),
          tr('Temp °C', 'Temp °C'),
          tr('GPU %', 'GPU %'),
          tr('Inference ms', 'Inferencia ms'),
          tr('Uptime d', 'Tiempo activo d'),
          tr('Last health message', 'Último mensaje de estado'),
        ],
        ...rows,
      ],
      { action: 'Downloaded health report', target: 'Edge units', details: `${scoped.length} units` },
    );
  };

  const downloadDiag = (u: EdgeUnit, d: DiagRun) => {
    const doneAt = d.doneAt ?? now;
    const file = `diagnostics-${u.id}-${fmtTime(doneAt).replace(':', '')}.txt`;
    const wm = ex.nextWatermark();
    const s = d.snapshot;
    const cams = fleet.cameras.filter((c) => c.edgeUnitId === u.id);
    const hb = lastHealthAt(doneAt);
    const lines = [
      tr('GFSA CCTV Monitoring · Diagnostics bundle', 'GFSA CCTV Monitoring · Paquete de diagnóstico'),
      `${tr('Unit', 'Unidad')} ${u.id} · ${vesselLabel(u)} · ${convoyText(u.convoyId)}`,
      tr(
        `Requested ${fmtDayTime(d.requestedAt)} by ${d.by} · collected ${fmtTimeSec(d.startedAt ?? doneAt)} · received ${fmtTimeSec(doneAt)}`,
        `Solicitado ${fmtDayTime(d.requestedAt)} por ${d.by} · recopilado ${fmtTimeSec(d.startedAt ?? doneAt)} · recibido ${fmtTimeSec(doneAt)}`,
      ),
      `${tr('Watermark', 'Marca de agua')} ${wm.id} · ${wm.user} · ${wm.at}`,
      '',
      `== ${tr('Health at collection', 'Estado al recopilar')} ==`,
      ...(s
        ? [
            `${tr('Status', 'Estado')}: ${statusName(s.status, tr)}`,
            `${tr('Link', 'Enlace')}: ${s.link}`,
            `${tr('Model', 'Modelo')}: ${s.modelVersion} (${s.modelConfirmed ? tr('confirmed', 'confirmado') : tr('not confirmed', 'sin confirmar')})`,
            `${tr('Storage', 'Almacenamiento')}: ${s.storagePct}% ${tr('of 1 TB NVMe', 'de 1 TB NVMe')}`,
            `${tr('Temperature', 'Temperatura')}: ${s.tempC} °C`,
            `${tr('GPU load', 'Carga de GPU')}: ${s.gpuPct}% · ${tr('inference', 'inferencia')} ${s.inferenceMs} ms`,
            `${tr('Uptime', 'Tiempo activo')}: ${s.uptimeDays} d`,
            `${tr('Queue', 'Cola')}: ${s.queue.events} ${tr('events', 'eventos')}, ${s.queue.clips} clips`,
          ]
        : []),
      `${tr('Module', 'Módulo')}: Jetson ${u.module} · DeepStream 9.1 · JetPack 7.2`,
      '',
      `== ${tr('Self-test', 'Autoprueba')} ==`,
      ...(d.results ?? []).map((r) => `[${r.tone === 'ok' ? 'OK' : '!!'}] ${tr(r.en, r.es)}`),
      '',
      `== ${tr('Cameras', 'Cámaras')} ==`,
      ...cams.map((c) => `${c.id} ${c.name} · ${c.stream} · ${c.fpsToAi} fps ${tr('to AI', 'a IA')} · ${c.health}${c.healthNote ? ` (${c.healthNote})` : ''}`),
      '',
      `== ${tr('Recent pipeline log', 'Registro reciente del pipeline')} ==`,
      ...[4, 3, 2, 1, 0].map((k) => `${fmtTimeSec(hb - k * 60000)} ${tr('health message sent', 'mensaje de estado enviado')} · ${s?.link ?? u.link}`),
      ...(ops.restartedAt[u.id] ? [`${fmtTimeSec(ops.restartedAt[u.id])} ${tr('pipeline restarted, streams resumed', 'pipeline reiniciado, transmisiones reanudadas')}`] : []),
      `${fmtTimeSec(d.startedAt ?? doneAt)} ${tr('diagnostics started', 'diagnóstico iniciado')}`,
      `${fmtTimeSec(doneAt)} ${tr('diagnostics bundle uploaded', 'paquete de diagnóstico subido')}`,
      '',
      tr('This bundle is watermarked; its download is in the audit log.', 'Este paquete lleva marca de agua; su descarga queda en el registro de auditoría.'),
    ];
    downloadBlob(file, lines.join('\r\n') + '\r\n', 'text/plain;charset=utf-8');
    ex.logged(file, { action: 'Downloaded diagnostics bundle', target: u.id, convoyId: u.convoyId }, wm);
  };

  const pushBtn = canPush ? (
    <button
      type="button"
      className="btn btn--primary"
      disabled={!rollout.draft || busy}
      onClick={() => setDialog('push')}
      title={
        busy
          ? tr('Wait until the units installing now have confirmed', 'Espere a que confirmen las unidades que están instalando')
          : !rollout.draft
            ? tr('A new signed version from the model registry becomes the draft', 'Una nueva versión firmada del registro de modelos pasa a ser el borrador')
            : undefined
      }
    >
      <Icon name="upload" size={16} /> {rollout.draft ? tr(`Push ${rollout.draft} to vessels`, `Enviar ${rollout.draft} a las embarcaciones`) : tr('No draft to push', 'Sin borrador para enviar')}
    </button>
  ) : null;

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tr('Configuration', 'Configuración'), to: '/config/use-cases' }]}
        title={tr('Edge units', 'Unidades de borde')}
        sub={tr(
          `${scoped.length} units on ${scopedConvoys.length} convoy${scopedConvoys.length === 1 ? '' : 's'} · ${reporting.length} reporting · ${offline.length} out of coverage${restarting.length ? ` · ${restarting.length} restarting` : ''}`,
          `${scoped.length} unidades en ${scopedConvoys.length} convoy${scopedConvoys.length === 1 ? '' : 'es'} · ${reporting.length} reportando · ${offline.length} sin cobertura${restarting.length ? ` · ${restarting.length} reiniciando` : ''}`,
        )}
        actions={
          <>
            <button type="button" className="btn" onClick={downloadReport}>
              <Icon name="download" size={16} /> {tr('Download health report', 'Descargar informe de estado')}
            </button>
            {pushBtn}
          </>
        }
      />

      {!canPush && (
        <div className="callout">
          <Icon name="lock" size={18} />
          <span>
            {tr(
              'Your role can view edge units. Pushing models and restarting pipelines needs the Safety administrator role.',
              'Su rol puede ver las unidades de borde. Enviar modelos y reiniciar pipelines requiere el rol de administrador de seguridad.',
            )}
          </span>
        </div>
      )}

      <div className="stat-grid">
        <Stat
          label={tr('Reporting', 'Reportando')}
          value={tr(`${reporting.length} of ${scoped.length}`, `${reporting.length} de ${scoped.length}`)}
          aside={tr('units', 'unidades')}
          foot={
            offline.length ? (
              <span className="eu-foot">
                <span className="dot dot--off" aria-hidden="true" />
                <span>
                  {tr(
                    `${offline.length} on ${offConvoys.map((c) => c.name).join(', ')} out of coverage ${offConvoys[0] ? fmtDuration(now - new Date(offConvoys[0].lastSeen).getTime()) : ''}`,
                    `${offline.length} de ${offConvoys.map((c) => c.name).join(', ')} sin cobertura hace ${offConvoys[0] ? fmtDuration(now - new Date(offConvoys[0].lastSeen).getTime()) : ''}`,
                  )}
                </span>
              </span>
            ) : restarting.length ? (
              tr(`${restarting.length} restarting`, `${restarting.length} reiniciando`)
            ) : (
              tr('All units reporting', 'Todas las unidades reportando')
            )
          }
        />
        <Stat
          label={tr('Events queued on board', 'Eventos en cola a bordo')}
          value={queuedEvents}
          aside={`${queuedClips} clips`}
          foot={
            queuedEvents
              ? tr(`${offConvoys.map((c) => c.name).join(', ')} convoy · sent when the link returns`, `Convoy ${offConvoys.map((c) => c.name).join(', ')} · se envían cuando vuelva el enlace`)
              : tr('Nothing waiting', 'Nada en espera')
          }
        />
        <Stat
          label={tr(`Model ${rollout.version}`, `Modelo ${rollout.version}`)}
          value={tr(`${confirmed.length} of ${scoped.length}`, `${confirmed.length} de ${scoped.length}`)}
          aside={tr('confirmed', 'confirmadas')}
          foot={
            <span className="eu-foot eu-foot--warn">
              {installing.length > 0 && (
                <>
                  <span className="dot" style={{ background: 'var(--brand)' }} aria-hidden="true" />
                  {tr(`${installing.length} installing`, `${installing.length} instalando`)}
                  {waiting.length ? ' · ' : ''}
                </>
              )}
              {waiting.length > 0 && (
                <>
                  <span className="dot dot--warn" aria-hidden="true" />
                  {tr(`${waiting.length} waiting for link`, `${waiting.length} esperando enlace`)}
                </>
              )}
              {!installing.length && !waiting.length && tr('All units confirmed', 'Todas las unidades confirmadas')}
            </span>
          }
        />
        <Stat
          label={tr('Storage used', 'Almacenamiento usado')}
          value={`${storageAvg}%`}
          aside={tr('14 days offline fits', 'caben 14 días sin enlace')}
          foot={tr('Average of 1 TB NVMe per unit', 'Promedio de 1 TB NVMe por unidad')}
        />
        <Stat
          label={tr('Link budget', 'Presupuesto de enlace')}
          value={budgetUsed.toFixed(1)}
          aside={tr(`of ${(budgetConvoy?.liveBudgetMbps ?? 0).toFixed(1)} Mbps`, `de ${(budgetConvoy?.liveBudgetMbps ?? 0).toFixed(1)} Mbps`)}
          foot={
            budgetConvoy && budgetConvoy.link !== 'none'
              ? tr(
                  `${budgetConvoy.name} convoy · 20% of a ${budgetConvoy.linkMbps} Mbps ${budgetConvoy.linkLabel} link`,
                  `Convoy ${budgetConvoy.name} · 20% de un enlace ${budgetConvoy.linkLabel} de ${budgetConvoy.linkMbps} Mbps`,
                )
              : tr('No link in this scope', 'Sin enlace en este alcance')
          }
        />
      </div>

      {/* EU-02 */}
      <section className="card" aria-labelledby="eu-roll-title">
        <div className="card__head eu-wrap-head">
          <div className="card__title">
            <h2 id="eu-roll-title">
              {tr('Model rollout', 'Despliegue del modelo')} · <span className="mono">{rollout.version}</span>
            </h2>
            <span className="card__hint">{tr('Base detector v2.1 · Crew safety attributes v1.4', 'Detector base v2.1 · Atributos de seguridad de la tripulación v1.4')}</span>
          </div>
          <div className="eu-head-actions">
            {rollout.draft ? (
              <Badge>
                {tr('Draft', 'Borrador')} <span className="mono">&nbsp;{rollout.draft}&nbsp;</span> {tr('not yet pushed', 'aún sin enviar')}
              </Badge>
            ) : (
              <Badge tone="info">
                {tr('Pushed', 'Enviada')} {rollout.pushedAt ? fmtTime(rollout.pushedAt) : ''}
              </Badge>
            )}
            <Link to="/insights/models" className="card__link">
              {tr('Model registry', 'Registro de modelos')}
            </Link>
          </div>
        </div>
        <div className="eu-roll">
          <div className="eu-roll__progress">
            <span className="eu-roll__line">
              <span style={{ fontWeight: 600 }}>
                {tr(`${confirmed.length} of ${scoped.length} units confirmed`, `${confirmed.length} de ${scoped.length} unidades confirmadas`)}
              </span>
              <span style={{ color: 'var(--muted)' }}>
                {installing.length > 0 && tr(`${installing.length} installing · `, `${installing.length} instalando · `)}
                {tr(`${waiting.length} waiting for link`, `${waiting.length} esperando enlace`)}
              </span>
            </span>
            <span
              className="eu-roll__bar"
              role="progressbar"
              aria-label={tr(`Units confirmed on ${rollout.version}`, `Unidades confirmadas en ${rollout.version}`)}
              aria-valuemin={0}
              aria-valuemax={scoped.length}
              aria-valuenow={confirmed.length}
            >
              <span style={{ width: `${scoped.length ? (confirmed.length / scoped.length) * 100 : 0}%` }} />
              <span className="eu-roll__bar-inst" style={{ width: `${scoped.length ? (installing.length / scoped.length) * 100 : 0}%` }} />
            </span>
            <span className="eu-note">
              {VERSION_INFO[rollout.version] ? tr(...VERSION_INFO[rollout.version]) : tr('Signed', 'Firmada')}
              {rollout.pushedAt ? tr(` · pushed ${fmtTime(rollout.pushedAt)}${rollout.pushedBy ? ` by ${rollout.pushedBy}` : ''}`, ` · enviada ${fmtTime(rollout.pushedAt)}${rollout.pushedBy ? ` por ${rollout.pushedBy}` : ''}`) : ''}
              {tr(' · installed in port or on a strong link', ' · se instala en puerto o con enlace fuerte')}
              {rollout.previous ? (
                <>
                  {' '}
                  · {tr('rollback to', 'reversión a')} <span className="mono">{rollout.previous}</span> {tr('available', 'disponible')}
                </>
              ) : (
                tr(' · no earlier version to roll back to', ' · no hay versión anterior a la que volver')
              )}
            </span>
            {canPush && (
              <div className="eu-roll__actions">
                {pushBtn}
                <button
                  type="button"
                  className="btn"
                  disabled={!rollout.previous || busy}
                  onClick={() => setDialog('rollback')}
                  title={
                    busy
                      ? tr('Wait until the units installing now have confirmed', 'Espere a que confirmen las unidades que están instalando')
                      : !rollout.previous
                        ? tr('Available after the next push', 'Disponible después del próximo envío')
                        : undefined
                  }
                >
                  <Icon name="refresh" size={16} style={{ transform: 'scaleX(-1)' }} /> {tr(`Roll back to ${rollout.previous ?? '…'}`, `Volver a ${rollout.previous ?? '…'}`)}
                </button>
              </div>
            )}
            {canPush && busy && (
              <span className="eu-note">{tr('Push and roll back are available again when the units installing now have confirmed.', 'Enviar y revertir vuelven a estar disponibles cuando confirmen las unidades que están instalando.')}</span>
            )}
          </div>
          <div className="eu-roll__chips">
            <ChipGroup label={tr('Confirmed', 'Confirmadas')} units={confirmed} tone="ok" />
            <ChipGroup label={tr('Installing', 'Instalando')} units={installing} tone="inst" />
            <ChipGroup label={tr('Waiting for link', 'Esperando enlace')} units={waiting} tone="wait" />
          </div>
        </div>
      </section>

      <div className="row">
        {/* EU-01 */}
        <Card
          id="eu-units"
          title={tr('Units', 'Unidades')}
          hint={
            <>
              {tr(`${scoped.length} on ${scopedConvoys.length} convoys · health every minute, last`, `${scoped.length} en ${scopedConvoys.length} convoyes · estado cada minuto, último`)}{' '}
              <span className="mono">{fmtTimeSec(health)}</span>
            </>
          }
          bodyClass="table-wrap"
          style={{ flex: '999 1 560px' }}
          action={
            <Link to="/config/cameras" className="card__link">
              {tr('Cameras', 'Cámaras')}
            </Link>
          }
        >
          <table className="table num eu-table" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th scope="col">{tr('Unit', 'Unidad')}</th>
                <th scope="col">{tr('Module', 'Módulo')}</th>
                <th scope="col" className="right">
                  {tr('Cameras', 'Cámaras')}
                </th>
                <th scope="col">{tr('Status', 'Estado')}</th>
                <th scope="col">{tr('Link', 'Enlace')}</th>
                <th scope="col">{tr('Queue', 'Cola')}</th>
                <th scope="col">{tr('Model', 'Modelo')}</th>
                <th scope="col" className="right">
                  {tr('Storage', 'Almac.')}
                </th>
                <th scope="col" className="right">
                  {tr('Temp', 'Temp.')}
                </th>
                <th scope="col" className="right">
                  {tr('Uptime', 'Activa')}
                </th>
              </tr>
            </thead>
            <tbody>
              {scoped.map((u) => {
                const isSel = selected?.id === u.id;
                const restartedAt = ops.restartedAt[u.id];
                return (
                  <tr key={u.id} className={`clickable${isSel ? ' is-selected' : ''}`} onClick={() => setSelectedId(u.id)}>
                    <td>
                      <button
                        type="button"
                        className="eu-unit-btn mono"
                        aria-pressed={isSel}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedId(u.id);
                        }}
                      >
                        {u.id}
                      </button>
                      <span className="sub eu-nowrap">{vesselLabel(u)}</span>
                    </td>
                    <td className="eu-nowrap">{u.module}</td>
                    <td className="right">{u.cameras}</td>
                    <td className="eu-nowrap">
                      <UnitStatus u={u} now={now} fleet={fleet} until={ops.restarts[u.id]?.until} />
                    </td>
                    <td className="eu-nowrap">
                      <LinkCell u={u} now={now} fleet={fleet} />
                    </td>
                    <td className="eu-nowrap">
                      {u.queue.events || u.queue.clips ? (
                        <>
                          {tr(`${u.queue.events} event${u.queue.events === 1 ? '' : 's'}`, `${u.queue.events} evento${u.queue.events === 1 ? '' : 's'}`)}
                          <span className="sub">
                            {u.queue.clips} clip{u.queue.clips === 1 ? '' : 's'}
                          </span>
                        </>
                      ) : (
                        <span style={{ color: 'var(--muted)' }}>{tr('Empty', 'Vacía')}</span>
                      )}
                    </td>
                    <td className="eu-nowrap">
                      <span className="mono">{u.modelVersion}</span>
                      <ModelState u={u} version={rollout.version} installing={!!rollout.installing[u.id]} />
                    </td>
                    <td className="right">{u.storagePct}%</td>
                    <td className="right eu-nowrap">{u.tempC} °C</td>
                    <td className="right eu-nowrap">{restartedAt ? uptimeSince(now, restartedAt, tr) : `${u.uptimeDays} d`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        {selected && (
          <UnitPanel
            u={selected}
            now={now}
            health={health}
            fleet={fleet}
            diag={ops.diag[selected.id]}
            restartUntil={ops.restarts[selected.id]?.until}
            restartedAt={ops.restartedAt[selected.id]}
            canOperate={canPush}
            lastEvent={lastEventSent(state.alarms, selected)}
            onDiagnostics={() => onDiagnostics(selected)}
            onRestart={() => setDialog('restart')}
            onDownloadDiag={(d) => downloadDiag(selected, d)}
          />
        )}
      </div>

      <PageDialog
        open={dialog === 'push' || dialog === 'rollback'}
        onClose={() => setDialog(null)}
        title={dialog === 'rollback' ? tr(`Roll back to ${rollout.previous}`, `Volver a ${rollout.previous}`) : tr(`Push ${rollout.draft} to vessels`, `Enviar ${rollout.draft} a las embarcaciones`)}
        sub={tr(
          'Signed models are verified on the unit before install. Alerts keep working on board while a unit installs.',
          'Los modelos firmados se verifican en la unidad antes de instalarse. Las alertas siguen funcionando a bordo mientras una unidad instala.',
        )}
        width={620}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setDialog(null)}>
              {tr('Cancel', 'Cancelar')}
            </button>
            <button type="button" className={dialog === 'rollback' ? 'btn btn--danger' : 'btn btn--primary'} onClick={dialog === 'rollback' ? rollback : push}>
              {dialog === 'rollback' ? tr(`Roll back to ${rollout.previous}`, `Volver a ${rollout.previous}`) : tr(`Push ${rollout.draft}`, `Enviar ${rollout.draft}`)}
            </button>
          </>
        }
      >
        <p style={{ fontSize: 13 }}>
          {tr(
            `Applies to all ${allUnits.length} units in the fleet. Units in port or on a strong link install now. Units out of coverage show waiting for link and install when they next report.`,
            `Se aplica a las ${allUnits.length} unidades de la flota. Las unidades en puerto o con enlace fuerte instalan ahora. Las que no tienen cobertura quedan esperando enlace e instalan cuando vuelvan a reportar.`,
          )}
        </p>
        <ul className="eu-push-list">
          {allUnits.map((u) => {
            const r = reachable(u);
            return (
              <li key={u.id}>
                <span className="mono" style={{ fontWeight: 600 }}>
                  {u.id}
                </span>
                <span className="eu-push-list__vessel">{vesselLabel(u)}</span>
                {r.ok ? <Badge tone="ok">{tr(`Now · ${r.why[0]}`, `Ahora · ${r.why[1]}`)}</Badge> : <Badge tone="warn">{tr(`Waiting · ${r.why[0]}`, `En espera · ${r.why[1]}`)}</Badge>}
              </li>
            );
          })}
        </ul>
      </PageDialog>

      <PageDialog
        open={dialog === 'restart' && !!selected}
        onClose={() => setDialog(null)}
        title={tr(`Restart pipeline on ${selected?.id ?? ''}`, `Reiniciar el pipeline de ${selected?.id ?? ''}`)}
        sub={selected ? `${vesselLabel(selected)} · ${convoyText(selected.convoyId)}` : undefined}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setDialog(null)}>
              {tr('Cancel', 'Cancelar')}
            </button>
            <button type="button" className="btn btn--primary" onClick={() => selected && restart(selected)}>
              <Icon name="refresh" size={16} /> {tr('Restart pipeline', 'Reiniciar pipeline')}
            </button>
          </>
        }
      >
        <p style={{ fontSize: 13 }}>
          {tr(
            `The video pipeline stops and starts again. It takes about ${RESTART_MS / 1000} seconds; camera streams and AI detection resume on their own.`,
            `El pipeline de video se detiene y vuelve a arrancar. Tarda unos ${RESTART_MS / 1000} segundos; las transmisiones y la detección con IA se reanudan solas.`,
          )}
        </p>
        <div className="callout">
          <Icon name="shield" size={18} />
          <span>
            {tr(
              'Alerts keep working on board during a restart. The wheelhouse display and buzzer stay connected.',
              'Las alertas siguen funcionando a bordo durante un reinicio. La pantalla del puente y la alarma sonora siguen conectadas.',
            )}
          </span>
        </div>
      </PageDialog>
    </div>
  );
}

function uptimeSince(now: number, at: number, tr: Tr) {
  const ms = now - at;
  return ms < 60_000 ? tr('< 1 min', '< 1 min') : fmtDuration(ms);
}

function lastEventSent(alarms: { vesselId?: string; raisedAt: string }[], u: EdgeUnit): number | undefined {
  const times = alarms.filter((a) => a.vesselId === u.vesselId).map((a) => new Date(a.raisedAt).getTime() + 2000);
  return times.length ? Math.max(...times) : undefined;
}

function ChipGroup({ label, units, tone }: { label: string; units: EdgeUnit[]; tone: 'ok' | 'inst' | 'wait' }) {
  if (!units.length) return null;
  return (
    <div className="eu-chipgroup" role="group" aria-label={`${label}: ${units.length}`}>
      <span className="eu-eyebrow">{label}</span>
      {units.map((u) => (
        <span key={u.id} className={`eu-chip eu-chip--${tone}`}>
          <span className="eu-chip__dot" aria-hidden="true" />
          {u.id}
        </span>
      ))}
    </div>
  );
}

function UnitStatus({ u, now, fleet, until }: { u: EdgeUnit; now: number; fleet: Fleet; until?: number }) {
  const tr = useTr();
  if (u.status === 'restarting')
    return (
      <>
        <span className="with-dot">
          <span className="dot dot--warn" aria-hidden="true" />
          {statusName(u.status, tr)}
        </span>
        <span className="sub">{tr(`back in ${Math.max(1, Math.ceil(((until ?? now) - now) / 1000))} s`, `vuelve en ${Math.max(1, Math.ceil(((until ?? now) - now) / 1000))} s`)}</span>
      </>
    );
  if (u.status === 'out_of_coverage') {
    const since = fleet.convoyById(u.convoyId)?.lastSeen;
    return (
      <>
        <span className="with-dot">
          <span className="dot dot--off" aria-hidden="true" />
          {statusName(u.status, tr)}
        </span>
        <span className="sub">
          {tr('since', 'desde')} <span className="mono">{since ? fmtTime(since) : '–'}</span>
        </span>
      </>
    );
  }
  if (u.status === 'fault')
    return (
      <span className="with-dot">
        <span className="dot dot--bad" aria-hidden="true" />
        {statusName(u.status, tr)}
      </span>
    );
  return (
    <span className="with-dot">
      <span className="dot" aria-hidden="true" />
      {statusName(u.status, tr)}
    </span>
  );
}

function LinkCell({ u, now, fleet }: { u: EdgeUnit; now: number; fleet: Fleet }) {
  const tr = useTr();
  if (u.status === 'out_of_coverage') {
    const since = fleet.convoyById(u.convoyId)?.lastSeen;
    return (
      <>
        {tr('None', 'Ninguno')}
        <span className="sub">{since ? fmtDuration(now - new Date(since).getTime()) : u.link.replace(/^None\s*/, '')}</span>
      </>
    );
  }
  const [kind, ...rest] = u.link.split(' ');
  return (
    <>
      {kind}
      <span className="sub">{rest.join(' ')}</span>
    </>
  );
}

function ModelState({ u, version, installing }: { u: EdgeUnit; version: string; installing: boolean }) {
  const tr = useTr();
  if (installing)
    return (
      <span className="eu-model eu-model--inst">
        <Icon name="download" size={13} strokeWidth={2.2} /> {tr('Installing', 'Instalando')}
      </span>
    );
  if (u.modelVersion === version && u.modelConfirmed)
    return (
      <span className="eu-model eu-model--ok">
        <Icon name="check" size={13} strokeWidth={2.4} /> {tr('Confirmed', 'Confirmada')}
      </span>
    );
  return (
    <span className="eu-model eu-model--wait">
      <Icon name="clock" size={13} strokeWidth={2.2} /> {tr(`Waiting for link · gets ${version}`, `Esperando enlace · recibe ${version}`)}
    </span>
  );
}

function UnitPanel({
  u,
  now,
  health,
  fleet,
  diag,
  restartUntil,
  restartedAt,
  canOperate,
  lastEvent,
  onDiagnostics,
  onRestart,
  onDownloadDiag,
}: {
  u: EdgeUnit;
  now: number;
  health: number;
  fleet: Fleet;
  diag?: DiagRun;
  restartUntil?: number;
  restartedAt?: number;
  canOperate: boolean;
  lastEvent?: number;
  onDiagnostics: () => void;
  onRestart: () => void;
  onDownloadDiag: (d: DiagRun) => void;
}) {
  const tr = useTr();
  const convoy = fleet.convoyById(u.convoyId);
  const vessel = fleet.vesselById(u.vesselId);
  const cams = fleet.cameras.filter((c) => c.edgeUnitId === u.id);
  const fps = [...new Set(cams.map((c) => c.fpsToAi))];
  const off = u.status === 'out_of_coverage';
  const restarting = u.status === 'restarting';
  const [kind, ...rest] = u.link.split(' ');
  const since = convoy?.lastSeen ? new Date(convoy.lastSeen).getTime() : now;
  const backIn = Math.max(1, Math.ceil(((restartUntil ?? now) - now) / 1000));
  const diagBusy = diag?.phase === 'running' || diag?.phase === 'queued';

  return (
    <section className="card eu-panel" aria-labelledby="eu-unit-title">
      <div className="card__head eu-panel__head">
        <div className="eu-panel__title">
          <h2 id="eu-unit-title">
            <span className="mono">{u.id}</span> · {vessel?.name}
          </h2>
          <span className="card__hint">{tr(`Selected unit · ${convoy?.name} convoy`, `Unidad seleccionada · convoy ${convoy?.name}`)}</span>
        </div>
        {off ? (
          <Badge>{statusName(u.status, tr)}</Badge>
        ) : restarting ? (
          <Badge tone="warn">{statusName(u.status, tr)}</Badge>
        ) : (
          <Badge tone="ok">
            <Icon name="check" size={13} strokeWidth={2.4} /> {statusName(u.status, tr)}
          </Badge>
        )}
      </div>
      <div className="eu-panel__body">
        <div className="eu-statusbox" aria-live="polite">
          <span className="with-dot" style={{ fontWeight: 600 }}>
            <span className={`dot${off ? ' dot--off' : restarting ? ' dot--warn' : ''}`} aria-hidden="true" />
            {off ? statusName(u.status, tr) : restarting ? tr('Restarting pipeline', 'Reiniciando pipeline') : statusName(u.status, tr)}
          </span>
          <span style={{ color: 'var(--muted)' }}>
            {off ? (
              <>
                {tr('Last shore sync', 'Última sincronización')} <span className="mono">{fmtTimeSec(since)}</span> ·{' '}
                {tr(
                  `no link for ${fmtDuration(now - since)} · ${u.queue.events} events and ${u.queue.clips} clips queued`,
                  `sin enlace hace ${fmtDuration(now - since)} · ${u.queue.events} eventos y ${u.queue.clips} clips en cola`,
                )}
              </>
            ) : restarting ? (
              tr(`Back in about ${backIn} s · alerts keep working on board`, `Vuelve en unos ${backIn} s · las alertas siguen funcionando a bordo`)
            ) : (
              <>
                {tr('Last shore sync', 'Última sincronización')} <span className="mono">{fmtTimeSec(health)}</span> · {kind} · {rest.join(' ')}
              </>
            )}
          </span>
        </div>

        <div className="eu-group">
          <span className="eu-eyebrow">{tr('Hardware', 'Hardware')}</span>
          <dl className="eu-dl">
            <dt>{tr('Module', 'Módulo')}</dt>
            <dd>Jetson {u.module}</dd>
            <dt>{tr('Software', 'Software')}</dt>
            <dd>DeepStream 9.1 · JetPack 7.2</dd>
            <dt>{tr('Storage', 'Almacenamiento')}</dt>
            <dd>{tr(`NVMe 1 TB · ${u.storagePct}% used`, `NVMe 1 TB · ${u.storagePct}% usado`)}</dd>
            <dt>{tr('Temperature', 'Temperatura')}</dt>
            <dd>{tr(`${u.tempC} °C · throttles at 80 °C`, `${u.tempC} °C · se limita a 80 °C`)}</dd>
            <dt>{tr('Enclosure', 'Gabinete')}</dt>
            <dd>{tr('Fanless, DC 9–36 V', 'Sin ventilador, CC 9–36 V')}</dd>
            <dt>{tr('Certificate', 'Certificado')}</dt>
            <dd>{tr('Unit certificate · renews 3 Mar 2027', 'Certificado de la unidad · se renueva el 3 mar 2027')}</dd>
          </dl>
        </div>

        <div className="eu-group">
          <span className="eu-eyebrow">{tr('Pipeline', 'Pipeline')}</span>
          <dl className="eu-dl num">
            <dt>{tr('Streams', 'Transmisiones')}</dt>
            <dd>
              {restarting
                ? tr('Restarting…', 'Reiniciando…')
                : tr(
                    `${u.cameras} decoded · ${fps.length === 1 ? `${fps[0]} fps each` : `${fps.join(', ')} fps`} to AI`,
                    `${u.cameras} decodificadas · ${fps.length === 1 ? `${fps[0]} fps cada una` : `${fps.join(', ')} fps`} a la IA`,
                  )}
            </dd>
            <dt>{tr('GPU load', 'Carga de GPU')}</dt>
            <dd className="eu-gpu">
              <span className="eu-gpu__bar" aria-hidden="true">
                <span style={{ width: `${restarting ? 0 : u.gpuPct}%` }} />
              </span>
              <span>{restarting ? '0%' : off ? tr(`${u.gpuPct}% at ${fmtTime(since)}`, `${u.gpuPct}% a las ${fmtTime(since)}`) : `${u.gpuPct}%`}</span>
            </dd>
            <dt>{tr('Inference', 'Inferencia')}</dt>
            <dd>{tr(`${u.inferenceMs} ms per frame`, `${u.inferenceMs} ms por cuadro`)}</dd>
            <dt>{tr('Clip buffer', 'Búfer de clips')}</dt>
            <dd>{tr('6 h rolling · 15 s clips on events', '6 h continuas · clips de 15 s en eventos')}</dd>
            <dt>{tr('Queue', 'Cola')}</dt>
            <dd>
              {u.queue.events ? (
                tr(`${u.queue.events} events, ${u.queue.clips} clips · sent when the link returns`, `${u.queue.events} eventos, ${u.queue.clips} clips · se envían cuando vuelva el enlace`)
              ) : (
                <>
                  {tr('Empty', 'Vacía')}
                  {lastEvent && (
                    <>
                      {' '}
                      · {tr('last event sent', 'último evento enviado')} <span className="mono">{fmtTimeSec(lastEvent)}</span>
                    </>
                  )}
                </>
              )}
            </dd>
            {restartedAt && (
              <>
                <dt>{tr('Restarted', 'Reiniciada')}</dt>
                <dd>
                  <span className="mono">{fmtTimeSec(restartedAt)}</span> · {tr(`up ${uptimeSince(now, restartedAt, tr)}`, `activa hace ${uptimeSince(now, restartedAt, tr)}`)}
                </dd>
              </>
            )}
          </dl>
        </div>

        <div className="eu-group">
          <span className="eu-eyebrow">{tr('Security', 'Seguridad')}</span>
          <ul className="eu-sec">
            <li>
              <Icon name="lock" size={16} /> {tr('Outbound-only encrypted connection', 'Conexión cifrada solo de salida')}
            </li>
            <li>
              <Icon name="shield" size={16} /> {tr('No inbound port on the vessel', 'Sin puertos de entrada en la embarcación')}
            </li>
            <li>
              <Icon name="key" size={16} /> {tr('Signed models verified before install', 'Modelos firmados verificados antes de instalar')}
            </li>
          </ul>
        </div>

        <div className="eu-group">
          <div className="eu-actions">
            <button
              type="button"
              className="btn"
              onClick={onDiagnostics}
              disabled={diagBusy}
              title={diagBusy ? tr('A diagnostics request is already under way for this unit', 'Ya hay un diagnóstico en curso para esta unidad') : undefined}
            >
              <Icon name="activity" size={16} />{' '}
              {diag?.phase === 'running'
                ? tr('Running diagnostics…', 'Ejecutando diagnóstico…')
                : diag?.phase === 'queued'
                  ? tr('Diagnostics queued', 'Diagnóstico en cola')
                  : off
                    ? tr('Queue diagnostics', 'Poner diagnóstico en cola')
                    : tr('Request diagnostics', 'Solicitar diagnóstico')}
            </button>
            {canOperate && (
              <button
                type="button"
                className="btn"
                onClick={onRestart}
                disabled={off || restarting}
                title={
                  off
                    ? tr('Restart needs a link: available when the convoy is back in coverage', 'El reinicio necesita enlace: disponible cuando el convoy recupere cobertura')
                    : restarting
                      ? tr('Already restarting', 'Ya se está reiniciando')
                      : undefined
                }
              >
                <Icon name="refresh" size={16} /> {tr('Restart pipeline', 'Reiniciar pipeline')}
              </button>
            )}
          </div>
          <span className="eu-note">
            {off && canOperate ? tr('Restart needs a link · ', 'El reinicio necesita enlace · ') : ''}
            {tr('Alerts keep working on board during a restart', 'Las alertas siguen funcionando a bordo durante un reinicio')}
          </span>
        </div>

        {diag && <DiagPanel d={diag} restarting={restarting} onDownload={() => onDownloadDiag(diag)} />}
      </div>
    </section>
  );
}

function DiagPanel({ d, restarting, onDownload }: { d: DiagRun; restarting: boolean; onDownload: () => void }) {
  const tr = useTr();
  const now = useNow(250);
  if (d.phase === 'queued')
    return (
      <div className="eu-diag" role="status">
        <span className="eu-diag__title">
          <Icon name="clock" size={15} /> {tr(`Diagnostics requested ${fmtTime(d.requestedAt)} by ${d.by}`, `Diagnóstico solicitado ${fmtTime(d.requestedAt)} por ${d.by}`)}
        </span>
        <span className="eu-note">
          {restarting
            ? tr('Queued · runs when the restart finishes.', 'En cola · se ejecuta cuando termine el reinicio.')
            : tr('Queued on shore · the unit runs them when the link returns.', 'En cola en tierra · la unidad lo ejecuta cuando vuelva el enlace.')}
        </span>
      </div>
    );
  const elapsed = now - (d.startedAt ?? now);
  const running = d.phase === 'running';
  const step = DIAG_STEPS[Math.min(DIAG_STEPS.length - 1, Math.floor(elapsed / DIAG_STEP_MS))];
  const progress = Math.min(100, (elapsed / DIAG_MS) * 100);
  return (
    <div className="eu-diag" role="status" aria-live="polite">
      <span className="eu-diag__title">
        {running ? <Icon name="activity" size={15} /> : <Icon name="check" size={15} strokeWidth={2.4} />}
        {running ? `${tr(...step)}…` : tr(`Diagnostics · ${fmtTimeSec(d.doneAt ?? now)}`, `Diagnóstico · ${fmtTimeSec(d.doneAt ?? now)}`)}
      </span>
      {running ? (
        <span className="eu-roll__bar" role="progressbar" aria-label={tr('Diagnostics progress', 'Progreso del diagnóstico')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
          <span style={{ width: `${progress}%` }} />
        </span>
      ) : (
        <>
          <ul className="eu-diag__list">
            {d.results?.map((r) => (
              <li key={r.en} className={`eu-diag__item eu-diag__item--${r.tone}`}>
                <Icon name={r.tone === 'ok' ? 'check' : 'alert'} size={15} strokeWidth={2.2} label={r.tone === 'ok' ? tr('Passed', 'Correcto') : tr('Attention', 'Atención')} />
                <span>{tr(r.en, r.es)}</span>
              </li>
            ))}
          </ul>
          <button type="button" className="btn" onClick={onDownload} style={{ alignSelf: 'flex-start' }}>
            <Icon name="download" size={16} /> {tr('Download diagnostics bundle', 'Descargar paquete de diagnóstico')}
          </button>
        </>
      )}
    </div>
  );
}
