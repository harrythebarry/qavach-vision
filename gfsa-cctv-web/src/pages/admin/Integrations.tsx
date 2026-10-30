import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Card, PageHeader } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useApp } from '../../state/AppState';
import { useFleet } from '../../state/fleetStore';
import { useUsers } from '../../state/usersStore';
import { SCENARIO_START } from '../../data/alarms';
import type { Convoy } from '../../data/types';
import { fmtDay, fmtDayTime, fmtSmart, fmtTime, fmtTimeSec, scenarioNow, useNow } from '../../lib/time';
import { uid, usePersistentState } from '../../lib/persist';
import { useTr } from '../../lib/i18n';
import { AdminDialog, Spinner, useNum } from './adminKit';
import {
  ADDABLE,
  INTEGRATIONS,
  STORAGE_PLAN_TB,
  STORAGE_USED_TB,
  SYNC_RESULT,
  customDef,
  initialMapping,
  initialStates,
  initialSyncClock,
  initialSyncLog,
  intervalMs,
  scheduledSync,
  type AddableKind,
  type CustomIntegration,
  type FieldDef,
  type IntegrationDef,
  type IntegrationState,
  type IntegrationStatus,
  type L,
  type MappingRow,
  type SyncEntry,
  type TestOutcome,
  type TestResult,
} from './integrationsData';
import './Integrations.css';

const iso = (ms = scenarioNow()) => new Date(ms).toISOString();
const ms = (v?: string) => (v ? new Date(v).getTime() : 0);
const latest = (...v: (string | undefined)[]) => v.filter(Boolean).sort((a, b) => ms(b) - ms(a))[0];
const BLANK: IntegrationState = { enabled: true, configured: false, values: {}, secrets: {} };
const SINCE_START = new Date(SCENARIO_START).getTime();
const LOG_MAX = 200;

const isUrl = (v: string) => {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};
const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/** ADM-04: integrations with status, last activity, Connect field mapping and a sync log. */
export function IntegrationsPage() {
  const { state, log, logSystem, toast } = useApp();
  const tr = useTr();
  const es = state.lang === 'es';
  const say = (x: L) => (es ? x.es : x.en);
  const num = useNum();
  const fleet = useFleet();
  const users = useUsers();
  const now = useNow(5_000);

  // Saved: on/off, settings, which secrets are set, test results, mapping and the sync log.
  const [states, setStates] = usePersistentState<Record<string, IntegrationState>>('integrations.state', initialStates);
  const [custom, setCustom] = usePersistentState<CustomIntegration[]>('integrations.custom', []);
  const [tests, setTests] = usePersistentState<Record<string, TestResult>>('integrations.tests', {});
  const [mapping, setMapping] = usePersistentState<MappingRow[]>('integrations.mapping', initialMapping);
  const [syncLog, setSyncLog] = usePersistentState<SyncEntry[]>('integrations.syncLog', initialSyncLog);
  const [syncClock, setSyncClock] = usePersistentState<number>('integrations.syncClock', initialSyncClock);

  // UI only.
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [configId, setConfigId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [allLog, setAllLog] = useState(false);

  const defs = useMemo(() => [...INTEGRATIONS, ...custom.map(customDef)], [custom]);
  const stOf = (id: string): IntegrationState => states[id] ?? initialStates[id] ?? BLANK;
  const patchState = (id: string, fn: (s: IntegrationState) => IntegrationState) =>
    setStates((all) => ({ ...all, [id]: fn(all[id] ?? initialStates[id] ?? BLANK) }));

  const connect = stOf('connect');
  const connectOn = connect.enabled && connect.configured;
  const interval = String(connect.values.interval ?? '5 min');
  const writeBack = connect.values.out !== false;
  const inCount = mapping.filter((m) => m.direction === 'in').length;
  const outCount = mapping.length - inCount;

  // ---------- Live data ----------
  const gaps = fleet.convoys.filter((c) => c.link === 'none');
  const reporting = fleet.convoys.filter((c) => c.link !== 'none');
  const lastFix = latest(...reporting.map((c) => c.lastSeen));
  const ais = custom.find((c) => c.kind === 'ais' && stOf(c.id).configured && stOf(c.id).enabled);
  const aisOn = !!ais && stOf('positions').values.ais === true;

  const live = useMemo(() => {
    const after = state.audit.filter((e) => ms(e.at) > SINCE_START);
    const msgs = after.filter((e) => e.action === 'Sent alert' || e.action === 'Sent reminder');
    const count = (re: RegExp) => {
      const list = msgs.filter((e) => re.test(e.details ?? ''));
      return { n: list.length, last: list[0]?.at };
    };
    return {
      whatsapp: count(/WhatsApp/),
      sms: count(/\bSMS\b/),
      email: count(/\bemail\b/i),
      voice: count(/voice call/i),
      reports: after.filter((e) => e.action === 'Sent report').length,
      toConnect: state.audit.filter((e) => e.action === 'Sent to Connect'),
      tuyEvents: after.filter((e) => (e.action === 'Received event' || e.action === 'Raised alarm') && e.convoyId === 'tuy'),
    };
  }, [state.audit]);

  // ---------- Scheduled Connect syncs: one entry per interval while Connect is on ----------
  useEffect(() => {
    const step = intervalMs(interval);
    if (now - syncClock < step) return;
    const due: number[] = [];
    for (let b = syncClock + step; b <= now; b += step) due.push(b);
    const toggled = connect.toggledAt ? ms(connect.toggledAt) : -Infinity;
    const ran = (b: number) => connect.configured && (connect.enabled ? b >= toggled : b < toggled);
    const entries: SyncEntry[] = due
      .filter(ran)
      .slice(-50)
      .map((b) => ({ id: `auto-${b}`, at: iso(b), ...scheduledSync(b) }));
    setSyncClock(due[due.length - 1]);
    if (!entries.length) return;
    const lastAt = entries[entries.length - 1].at;
    setSyncLog((l) => {
      const known = new Set(l.map((x) => x.id));
      return [...entries.filter((x) => !known.has(x.id)).reverse(), ...l].slice(0, LOG_MAX);
    });
    setMapping((m) => m.map((r) => (r.direction === 'in' || (r.id === 'events' && writeBack) ? { ...r, lastSync: latest(r.lastSync, lastAt)! } : r)));
    patchState('connect', (s) => ({ ...s, lastAt: latest(s.lastAt, lastAt) }));
    // patchState and the setters are stable for this purpose; the effect follows the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, syncClock, interval, connect.enabled, connect.configured, connect.toggledAt, writeBack]);

  // ---------- Per integration: status, activity, last activity, test outcome ----------
  const statusOf = (def: IntegrationDef, st: IntegrationState): IntegrationStatus => {
    if (!st.configured) return 'not_configured';
    if (def.id === 'positions' && gaps.length && !aisOn) return 'attention';
    if (tests[def.id]?.tone === 'bad') return 'attention';
    return 'connected';
  };

  const convoyLine = (c: Convoy) =>
    c.link === 'none'
      ? tr(`no position since ${fmtSmart(c.lastSeen, now)}`, `sin posición desde ${fmtSmart(c.lastSeen, now)}`)
      : tr(`${c.linkLabel} · position ${fmtTime(c.lastSeen)}`, `${c.linkLabel} · posición ${fmtTime(c.lastSeen)}`);

  const activityOf = (def: IntegrationDef, st: IntegrationState): ReactNode => {
    const n = (x: { n: number }) => x.n;
    switch (def.id) {
      case 'connect':
        return tr(`Synced ${st.lastAt ? fmtTime(st.lastAt) : '–'} · every ${interval}`, `Sincronizado ${st.lastAt ? fmtTime(st.lastAt) : '–'} · cada ${interval}`);
      case 'whatsapp':
        return tr(`${num(141 + n(live.whatsapp))} of ${num(142 + n(live.whatsapp))} delivered, 7 days`, `${num(141 + n(live.whatsapp))} de ${num(142 + n(live.whatsapp))} entregados, 7 días`);
      case 'sms':
        return tr(`${num(140 + n(live.sms))} of ${num(142 + n(live.sms))} delivered, 7 days`, `${num(140 + n(live.sms))} de ${num(142 + n(live.sms))} entregados, 7 días`);
      case 'email': {
        const sent = 61 + n(live.email) + live.reports;
        return tr(`GFSA mail server · ${num(sent)} sent, 7 days`, `Servidor de correo de GFSA · ${num(sent)} enviados, 7 días`);
      }
      case 'voice':
        return n(live.voice) === 0
          ? tr('2 calls placed, 7 days · both answered', '2 llamadas realizadas, 7 días · ambas atendidas')
          : tr(`${2 + n(live.voice)} calls placed, 7 days`, `${2 + n(live.voice)} llamadas realizadas, 7 días`);
      case 'positions':
        return (
          <>
            <span>
              {tr(
                `${reporting.length} of ${fleet.convoys.length} convoys reporting · every ${st.values.interval ?? '1 min'}`,
                `${reporting.length} de ${fleet.convoys.length} convoyes reportando · cada ${st.values.interval ?? '1 min'}`,
              )}
            </span>
            <ul className="intg-pos" aria-label={tr('Convoy positions', 'Posiciones de los convoyes')}>
              {fleet.convoys.map((c) => (
                <li key={c.id}>
                  <span className={`dot${c.link === 'none' ? ' dot--off' : c.link === 'weak' ? ' dot--warn' : ''}`} aria-hidden="true" />
                  <strong>{c.name}</strong>
                  <span>
                    {convoyLine(c)}
                    {c.link === 'none' && aisOn ? tr(' · AIS fill-in on', ' · relleno AIS activo') : ''}
                  </span>
                </li>
              ))}
            </ul>
          </>
        );
      case 'recorders':
        return tr(`${fleet.cameras.length} cameras on ${fleet.convoys.length} convoys`, `${fleet.cameras.length} cámaras en ${fleet.convoys.length} convoyes`);
      case 'reefer':
        return st.configured
          ? tr(`Set up ${fmtSmart(st.setUpAt ?? iso(), now)} · first data within 5 min`, `Configurado ${fmtSmart(st.setUpAt ?? iso(), now)} · primeros datos en 5 min`)
          : tr('Where fitted', 'Donde esté instalado');
      case 'sso': {
        const n = users.filter((u) => u.status !== 'suspended').length;
        return tr(`${n} users`, `${n} usuarios`);
      }
      case 'storage':
        return tr(`${num(STORAGE_USED_TB, 1)} of ${STORAGE_PLAN_TB} TB used`, `${num(STORAGE_USED_TB, 1)} de ${STORAGE_PLAN_TB} TB usados`);
      default:
        return st.configured
          ? tr(`Set up ${fmtSmart(st.setUpAt ?? iso(), now)}`, `Configurado ${fmtSmart(st.setUpAt ?? iso(), now)}`)
          : tr('Added · not set up yet', 'Agregada · aún sin configurar');
    }
  };

  const lastAtOf = (def: IntegrationDef, st: IntegrationState) => {
    switch (def.id) {
      case 'whatsapp':
        return latest(st.lastAt, live.whatsapp.last);
      case 'sms':
        return latest(st.lastAt, live.sms.last);
      case 'email':
        return latest(st.lastAt, live.email.last);
      case 'voice':
        return latest(st.lastAt, live.voice.last);
      case 'positions':
        return latest(st.lastAt, lastFix);
      default:
        return st.lastAt;
    }
  };

  const outcomeOf = (def: IntegrationDef, st: IntegrationState): TestOutcome => {
    if (def.id === 'positions') {
      if (!gaps.length)
        return {
          tone: 'ok',
          en: `${reporting.length} of ${fleet.convoys.length} convoys answered · last fix ${lastFix ? fmtTimeSec(lastFix) : '–'}`,
          es: `${reporting.length} de ${fleet.convoys.length} convoyes respondieron · última posición ${lastFix ? fmtTimeSec(lastFix) : '–'}`,
        };
      const g = gaps.map((c) => `${c.name} out of coverage since ${fmtTime(c.lastSeen)}`).join(', ');
      const gEs = gaps.map((c) => `${c.name} sin cobertura desde ${fmtTime(c.lastSeen)}`).join(', ');
      return {
        tone: 'warn',
        en: `${reporting.length} of ${fleet.convoys.length} convoys answered · ${g}`,
        es: `${reporting.length} de ${fleet.convoys.length} convoyes respondieron · ${gEs}`,
      };
    }
    if (def.id === 'recorders') {
      const reach = fleet.cameras.filter((c) => fleet.convoyById(c.convoyId)?.link !== 'none');
      const answered = reach.filter((c) => c.health !== 'offline');
      const away = gaps.map((c) => c.name).join(', ');
      return {
        tone: answered.length < reach.length ? 'warn' : 'ok',
        en: `${answered.length} of ${reach.length} reachable streams answered${away ? ` · ${away} checked when back in coverage` : ''}`,
        es: `${answered.length} de ${reach.length} flujos accesibles respondieron${away ? ` · ${away} se verifica al volver la cobertura` : ''}`,
      };
    }
    if (def.id === 'connect' && st.values.out === false) {
      return { tone: 'ok', en: `${def.test.en} · write-back off`, es: `${def.test.es} · escritura en Connect desactivada` };
    }
    return def.test;
  };

  // ---------- Actions ----------
  const testConnection = (def: IntegrationDef) => {
    const st = stOf(def.id);
    const out = outcomeOf(def, st);
    setTesting((s) => ({ ...s, [def.id]: true }));
    log('Tested integration', def.name.en);
    // Completes even if the screen is left: the result is saved and logged by the integration service.
    window.setTimeout(() => {
      const at = iso();
      setTesting((s) => ({ ...s, [def.id]: false }));
      setTests((r) => ({ ...r, [def.id]: { ...out, at } }));
      patchState(def.id, (s) => ({ ...s, lastAt: at }));
      const word: [string, string] = out.tone === 'ok' ? ['OK', 'correcta'] : out.tone === 'warn' ? ['partial', 'parcial'] : ['failed', 'fallida'];
      logSystem({
        action: 'Integration test',
        target: def.name.en,
        details: `${word[0] === 'OK' ? 'OK' : word[0]} · ${out.en}`,
        result: out.tone === 'bad' ? 'failed' : 'ok',
        source: 'Integration service',
        category: 'system',
      });
      toast(tr(`${def.name.en}: test ${word[0]}. ${out.en}.`, `${def.name.es}: prueba ${word[1]}. ${out.es}.`));
    }, 1400);
  };

  const syncNow = () => {
    setSyncing(true);
    log('Synced Connect', 'Connect', 'Manual sync requested');
    const by = state.user.name;
    window.setTimeout(() => {
      const atMs = scenarioNow();
      const at = iso(atMs);
      const res = scheduledSync(atMs);
      const entry: SyncEntry = {
        id: uid('sync'),
        at,
        tone: res.tone,
        result: res.result,
        by,
        text: { en: `Manual sync · ${res.text.en}`, es: `Sincronización manual · ${res.text.es}` },
      };
      setSyncing(false);
      setSyncLog((l) => [entry, ...l].slice(0, LOG_MAX));
      setMapping((m) => m.map((r) => (r.direction === 'in' || (r.id === 'events' && writeBack) ? { ...r, lastSync: at } : r)));
      patchState('connect', (s) => ({ ...s, lastAt: at }));
      logSystem({ action: 'Synced Connect', target: 'Connect', details: entry.text.en, source: 'Connect integration', category: 'system' });
      toast(tr(`Connect synced at ${fmtTimeSec(at)}: ${res.text.en.toLowerCase()}.`, `Connect sincronizado a las ${fmtTimeSec(at)}: ${res.text.es.toLowerCase()}.`));
    }, 1600);
  };

  // ---------- Mapping and log, with what the engine wrote to Connect ----------
  const missed = live.toConnect.filter((e) => /^Missed reefer round/.test(e.details ?? ''));
  const mappingView = mapping.map((r) => {
    if (r.id === 'missed-rounds' && missed.length) {
      const n = 1 + missed.length;
      return { ...r, lastSync: latest(r.lastSync, missed[0].at)!, records: { en: String(n), es: String(n) } };
    }
    if (r.id === 'events') {
      const n = 41 + live.tuyEvents.filter((e) => ms(e.at) <= ms(r.lastSync)).length;
      return { ...r, records: { en: `${n} this voyage`, es: `${n} en este viaje` } };
    }
    return r;
  });

  const logView: SyncEntry[] = useMemo(() => {
    const sent: SyncEntry[] = live.toConnect.map((e) => ({
      id: `aud-${e.seq}`,
      at: e.at,
      tone: 'ok',
      result: 'sent',
      text: {
        en: `${e.target} · ${e.details ?? ''}`,
        es: `${e.target} · ${(e.details ?? '').replace(/^Missed reefer round/, 'Ronda de reefer perdida').replace(/· row (\d+)/, '· fila $1')}`,
      },
    }));
    return [...sent, ...syncLog].sort((a, b) => ms(b.at) - ms(a.at));
  }, [live.toConnect, syncLog]);
  const logShown = allLog ? logView : logView.slice(0, 8);

  const configuringDef = defs.find((d) => d.id === configId);

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tr('Administration', 'Administración'), to: '/admin/users' }]}
        title={tr('Integrations', 'Integraciones')}
        sub={tr('Connect, messaging, positions, recorders and storage', 'Connect, mensajería, posiciones, grabadores y almacenamiento')}
        actions={
          <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} /> {tr('Add integration', 'Agregar integración')}
          </button>
        }
      />

      <div className="intg-grid">
        {defs.map((def) => {
          const st = stOf(def.id);
          return (
            <IntegrationCard
              key={def.id}
              def={def}
              st={st}
              status={statusOf(def, st)}
              activity={activityOf(def, st)}
              lastAt={lastAtOf(def, st)}
              testing={!!testing[def.id]}
              result={tests[def.id]}
              onConfigure={() => setConfigId(def.id)}
              onTest={() => testConnection(def)}
            />
          );
        })}
      </div>

      <div className="row intg-row">
        <Card
          id="intg-map"
          title={tr('Connect · field mapping', 'Connect · mapeo de campos')}
          hint={tr(`${inCount} objects in · ${outCount} out · every ${interval}`, `${inCount} objetos entran · ${outCount} salen · cada ${interval}`)}
          bodyClass="table-wrap"
          style={{ flex: '999 1 560px' }}
        >
          {!connectOn ? (
            <div className="callout callout--warn intg-map-off">
              <Icon name="pause" size={16} />
              <span>
                {connect.configured
                  ? tr('Connect is turned off. Mapping is kept; nothing syncs until it is turned back on.', 'Connect está apagado. El mapeo se conserva; nada se sincroniza hasta que se vuelva a encender.')
                  : tr('Connect is not set up yet.', 'Connect aún no está configurado.')}
              </span>
            </div>
          ) : (
            !writeBack && (
              <div className="callout intg-map-off">
                <Icon name="pause" size={16} />
                <span>
                  {tr(
                    'Write-back is off: events and port times are not sent to Connect. Turn it on in Configure Connect.',
                    'La escritura en Connect está desactivada: los eventos y horarios de puerto no se envían. Actívela en Configurar Connect.',
                  )}
                </span>
              </div>
            )
          )}
          <table className="table num intg-map">
            <thead>
              <tr>
                <th scope="col">{tr('Connect object', 'Objeto de Connect')}</th>
                <th scope="col">{tr('Direction', 'Dirección')}</th>
                <th scope="col">{tr('Console use', 'Uso en la consola')}</th>
                <th scope="col" className="right">
                  {tr('Last sync', 'Última sincronización')}
                </th>
                <th scope="col" className="right">
                  {tr('Records', 'Registros')}
                </th>
              </tr>
            </thead>
            <tbody>
              {mappingView.map((m) => (
                <tr key={m.id}>
                  <td className="intg-strong">{say(m.object)}</td>
                  <td>
                    {m.direction === 'in' ? (
                      <span className="badge intg-dir-in">
                        <Icon name="download" size={13} /> {tr('In', 'Entra')}
                      </span>
                    ) : (
                      <span className="badge">
                        <Icon name={writeBack ? 'upload' : 'pause'} size={13} /> {writeBack ? tr('Out', 'Sale') : tr('Out · paused', 'Sale · en pausa')}
                      </span>
                    )}
                  </td>
                  <td>{say(m.use)}</td>
                  <td className="right mono intg-nowrap">{fmtSmart(m.lastSync, now)}</td>
                  <td className="right intg-nowrap">{say(m.records)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <section aria-labelledby="intg-log-title" className="card intg-log">
          <div className="card__head">
            <div className="card__title">
              <h2 id="intg-log-title">{tr('Connect sync log', 'Registro de sincronización de Connect')}</h2>
              <span className="card__hint">{tr('Newest first', 'Más recientes primero')}</span>
            </div>
            <button
              type="button"
              className="btn btn--sm intg-sync"
              onClick={syncNow}
              disabled={syncing || !connectOn}
              title={!connectOn ? tr('Turn Connect on to sync', 'Encienda Connect para sincronizar') : undefined}
            >
              {syncing ? <Spinner label={tr('Syncing', 'Sincronizando')} /> : <Icon name="refresh" size={15} />}
              {syncing ? tr('Syncing…', 'Sincronizando…') : tr('Sync now', 'Sincronizar ahora')}
            </button>
          </div>
          <ol className="intg-log__list" aria-live="polite">
            {logShown.map((s) => (
              <li key={s.id}>
                <time dateTime={s.at} className="mono">
                  {fmtDay(s.at) === fmtDay(now) ? fmtTimeSec(s.at) : fmtDayTime(s.at)}
                </time>
                <span className="with-dot intg-strong">
                  <span className={`dot${s.tone === 'ok' ? '' : ` dot--${s.tone}`}`} aria-hidden="true" />
                  {say(SYNC_RESULT[s.result])}
                </span>
                <span className="intg-log__text">
                  {withMonoIds(say(s.text))}
                  {s.by ? ` · ${s.by}` : ''}
                </span>
              </li>
            ))}
          </ol>
          <div className="intg-log__foot">
            {logView.length > 8 && (
              <button type="button" className="intg-linkbtn" aria-expanded={allLog} onClick={() => setAllLog((v) => !v)}>
                {allLog ? tr('Show the latest 8', 'Mostrar las 8 últimas') : tr(`Show all ${logView.length}`, `Mostrar las ${logView.length}`)}
              </button>
            )}
            <Link to="/admin/audit" className="intg-log__more">
              {tr('Changes and manual syncs in the audit log', 'Cambios y sincronizaciones manuales en el registro de auditoría')}
            </Link>
          </div>
        </section>
      </div>

      {configuringDef && (
        <ConfigureDialog
          def={configuringDef}
          st={stOf(configuringDef.id)}
          aisAvailable={!!ais}
          onClose={() => setConfigId(null)}
          onRemove={
            configuringDef.custom
              ? () => {
                  const id = configuringDef.id;
                  setConfigId(null);
                  setCustom((c) => c.filter((x) => x.id !== id));
                  setStates((all) => {
                    const { [id]: _gone, ...rest } = all;
                    void _gone;
                    return rest;
                  });
                  setTests((all) => {
                    const { [id]: _gone, ...rest } = all;
                    void _gone;
                    return rest;
                  });
                  log('Removed integration', configuringDef.name.en);
                  toast(tr(`${configuringDef.name.en} removed. The change is logged.`, `${configuringDef.name.es} eliminada. El cambio queda registrado.`));
                }
              : undefined
          }
          onSave={(next, changes) => {
            const def = configuringDef;
            const before = stOf(def.id);
            const setUp = !before.configured && next.configured;
            patchState(def.id, () => next);
            setConfigId(null);
            log(setUp ? 'Set up integration' : 'Changed integration', def.name.en, changes.join(', ') || 'No changes');
            toast(
              !next.enabled && before.enabled
                ? tr(`${def.name.en} turned off. The change is logged.`, `${def.name.es} apagada. El cambio queda registrado.`)
                : setUp
                  ? tr(`${def.name.en} set up. Test the connection to check it.`, `${def.name.es} configurada. Pruebe la conexión para verificarla.`)
                  : tr(`${def.name.en} saved. The change is logged.`, `${def.name.es} guardada. El cambio queda registrado.`),
            );
          }}
        />
      )}

      {adding && (
        <AddDialog
          taken={defs.flatMap((d) => [d.name.en, d.name.es])}
          onClose={() => setAdding(false)}
          onAdd={(name, kind) => {
            const id = uid('intg');
            const a = ADDABLE.find((x) => x.kind === kind)!;
            setCustom((list) => [...list, { id, name, kind }]);
            setStates((all) => ({ ...all, [id]: { enabled: true, configured: false, values: { url: '' }, secrets: {} } }));
            setAdding(false);
            log('Added integration', name, a.name.en);
            toast(tr(`${name} added. Set it up to start using it.`, `${name} agregada. Configúrela para empezar a usarla.`));
            setConfigId(id);
          }}
        />
      )}
    </div>
  );
}

function withMonoIds(text: string) {
  return text.split(/(VOY-\d+-\d+)/).map((part, i) =>
    /^VOY-/.test(part) ? (
      <span key={i} className="mono">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function StatusBadge({ status, enabled }: { status: IntegrationStatus; enabled: boolean }) {
  const tr = useTr();
  if (!enabled)
    return (
      <span className="badge intg-badge">
        <Icon name="pause" size={12} /> {tr('Off', 'Apagada')}
      </span>
    );
  if (status === 'not_configured')
    return (
      <span className="badge intg-badge">
        <Icon name="minus" size={13} /> {tr('Not configured', 'Sin configurar')}
      </span>
    );
  if (status === 'attention')
    return (
      <span className="badge badge--warn intg-badge">
        <Icon name="alert" size={13} /> {tr('Attention', 'Atención')}
      </span>
    );
  return (
    <span className="badge badge--ok intg-badge">
      <Icon name="check" size={13} strokeWidth={2.4} /> {tr('Connected', 'Conectada')}
    </span>
  );
}

function IntegrationCard({
  def,
  st,
  status,
  activity,
  lastAt,
  testing,
  result,
  onConfigure,
  onTest,
}: {
  def: IntegrationDef;
  st: IntegrationState;
  status: IntegrationStatus;
  activity: ReactNode;
  lastAt?: string;
  testing: boolean;
  result?: TestResult;
  onConfigure: () => void;
  onTest: () => void;
}) {
  const tr = useTr();
  const name = tr(def.name.en, def.name.es);
  const titleId = `intg-${def.id}`;
  const setUp = !st.configured;
  const canTest = st.enabled && !setUp;
  return (
    <article aria-labelledby={titleId} className={`intg-card${st.enabled ? '' : ' is-off'}`}>
      <div className="intg-card__head">
        <span className="intg-card__icon">
          <Icon name={def.icon} size={18} />
        </span>
        <h2 id={titleId}>{name}</h2>
        <StatusBadge status={status} enabled={st.enabled} />
      </div>
      <p className="intg-card__desc">{tr(def.description.en, def.description.es)}</p>
      <div className="intg-card__meta num">
        {st.enabled ? activity : tr('Turned off · nothing sent or received', 'Apagada · no se envía ni recibe nada')}
        {lastAt && (
          <span className="intg-card__last">
            {tr('Last activity', 'Última actividad')} <span className="mono">{fmtSmart(lastAt)}</span>
          </span>
        )}
      </div>
      <div className="intg-card__result" aria-live="polite">
        {testing ? (
          <span className="intg-result">
            <Spinner /> {tr('Testing connection…', 'Probando la conexión…')}
          </span>
        ) : result ? (
          <span className={`intg-result intg-result--${result.tone}`}>
            <Icon name={result.tone === 'ok' ? 'check' : 'alert'} size={14} strokeWidth={2.4} />
            <span>
              {tr(result.en, result.es)} · <span className="mono">{fmtSmart(result.at)}</span>
            </span>
          </span>
        ) : null}
      </div>
      <div className="intg-card__actions">
        <button type="button" className="btn intg-btn" aria-label={setUp ? tr(`Set up ${name}`, `Configurar ${name}`) : tr(`Configure ${name}`, `Ajustar ${name}`)} onClick={onConfigure}>
          {setUp ? tr('Set up', 'Configurar') : tr('Configure', 'Ajustar')}
        </button>
        <button
          type="button"
          className="btn btn--ghost intg-btn intg-btn--test"
          aria-label={tr(`Test connection to ${name}`, `Probar la conexión con ${name}`)}
          onClick={onTest}
          disabled={!canTest || testing}
          title={!canTest ? (setUp ? tr('Set it up first', 'Configúrela primero') : tr('Turn it on in Configure to test', 'Enciéndala en Ajustar para probarla')) : undefined}
        >
          <Icon name="zap" size={15} /> {tr('Test connection', 'Probar conexión')}
        </button>
      </div>
      {!canTest && (
        <p className="intg-card__why">
          {setUp ? tr('Set it up to test the connection.', 'Configúrela para probar la conexión.') : tr('Turned off: turn it on to test.', 'Apagada: enciéndala para probarla.')}
        </p>
      )}
    </article>
  );
}

function ConfigureDialog({
  def,
  st,
  aisAvailable,
  onClose,
  onSave,
  onRemove,
}: {
  def: IntegrationDef;
  st: IntegrationState;
  aisAvailable: boolean;
  onClose: () => void;
  onSave: (next: IntegrationState, changes: string[]) => void;
  onRemove?: () => void;
}) {
  const tr = useTr();
  const name = tr(def.name.en, def.name.es);
  const [enabled, setEnabled] = useState(st.enabled);
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(
      def.fields.map((f) => [f.key, f.kind === 'secret' ? '' : f.kind === 'toggle' ? st.values[f.key] === true : String(st.values[f.key] ?? (f.kind === 'select' ? f.options[0].value : ''))]),
    ),
  );
  const setUp = !st.configured;

  const changes: string[] = [];
  if (enabled !== st.enabled) changes.push(enabled ? 'turned on' : 'turned off');
  for (const f of def.fields) {
    const v = values[f.key];
    if (f.kind === 'secret') {
      if (typeof v === 'string' && v.trim()) changes.push(`${f.label.en} ${st.secrets[f.key] ? 'replaced' : 'set'}`);
    } else if (f.kind === 'toggle') {
      if (v !== (st.values[f.key] === true)) changes.push(`${f.label.en} ${v ? 'on' : 'off'}`);
    } else if (String(v) !== String(st.values[f.key] ?? '')) changes.push(`${f.label.en} ${String(v) || 'cleared'}`);
  }

  // What blocks saving, per field (only while the integration is on: off keeps the settings as they are).
  const problems: Record<string, string> = {};
  if (enabled) {
    for (const f of def.fields) {
      const v = String(values[f.key] ?? '').trim();
      if (f.kind === 'secret') {
        if (f.required && !st.secrets[f.key] && !v) problems[f.key] = tr('Required to connect.', 'Obligatorio para conectar.');
      } else if (f.kind === 'url' || f.kind === 'email' || f.kind === 'text') {
        if (f.required && !v) problems[f.key] = tr('Required.', 'Obligatorio.');
        else if (v && f.kind === 'url' && !isUrl(v)) problems[f.key] = tr('Enter a full address starting with https://', 'Ingrese una dirección completa que empiece con https://');
        else if (v && f.kind === 'email' && !isEmail(v)) problems[f.key] = tr('Enter a valid email address.', 'Ingrese un correo válido.');
      }
    }
  }
  const blocked = Object.keys(problems).length > 0;
  const dirty = changes.length > 0;

  const save = () => {
    if (blocked) return;
    const at = iso();
    const nextValues: Record<string, string | boolean> = { ...st.values };
    const nextSecrets = { ...st.secrets };
    for (const f of def.fields) {
      const v = values[f.key];
      if (f.kind === 'secret') {
        if (typeof v === 'string' && v.trim()) nextSecrets[f.key] = true;
      } else if (f.kind === 'toggle') nextValues[f.key] = !!v;
      else nextValues[f.key] = String(v).trim();
    }
    const next: IntegrationState = {
      ...st,
      enabled,
      values: nextValues,
      secrets: nextSecrets,
      toggledAt: enabled !== st.enabled ? at : st.toggledAt,
      ...(setUp && enabled ? { configured: true, setUpAt: at, lastAt: at } : {}),
    };
    onSave(next, changes);
  };

  return (
    <AdminDialog
      title={setUp ? tr(`Set up ${name}`, `Configurar ${name}`) : tr(`Configure ${name}`, `Ajustar ${name}`)}
      sub={tr(def.description.en, def.description.es)}
      onClose={onClose}
      onSubmit={save}
      submitLabel={setUp ? tr('Set up', 'Configurar') : tr('Save changes', 'Guardar cambios')}
      submitDisabled={blocked || (!setUp && !dirty)}
      danger={!enabled && st.enabled}
      dirty={dirty}
      footStart={
        onRemove && (
          <button
            type="button"
            className="btn btn--ghost intg-remove"
            onClick={() => {
              if (window.confirm(tr(`Remove ${name}? Its settings are deleted.`, `¿Eliminar ${name}? Se borran sus ajustes.`))) onRemove();
            }}
          >
            <Icon name="trash" size={15} /> {tr('Remove', 'Eliminar')}
          </button>
        )
      }
    >
      {!setUp && (
        <label className="switch">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>
            <strong>{enabled ? tr('On', 'Encendida') : tr('Off', 'Apagada')}</strong> ·{' '}
            {enabled ? tr('in use', 'en uso') : tr('nothing is sent or received', 'no se envía ni recibe nada')}
          </span>
        </label>
      )}
      {!enabled && st.enabled && (
        <div className="callout callout--bad" role="alert">
          <Icon name="alert" size={16} />
          <span>
            {def.disableWarning
              ? tr(def.disableWarning.en, def.disableWarning.es)
              : tr(`${def.name.en} stops sending and receiving data.`, `${def.name.es} deja de enviar y recibir datos.`)}
          </span>
        </div>
      )}
      {def.fields.map((f) => (
        <FieldInput
          key={f.key}
          id={`intg-f-${def.id}-${f.key}`}
          f={f}
          value={values[f.key]}
          stored={f.kind === 'secret' && !!st.secrets[f.key]}
          disabled={!enabled || (def.id === 'positions' && f.key === 'ais' && !aisAvailable && values[f.key] !== true)}
          problem={problems[f.key]}
          onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
        />
      ))}
      <p className="field__hint">
        {tr(
          'Saving writes the change to the audit log. Secrets are stored encrypted on the server and never shown again; the browser only keeps whether one is set.',
          'Guardar escribe el cambio en el registro de auditoría. Los secretos se guardan cifrados en el servidor y no se vuelven a mostrar; el navegador solo sabe si hay uno guardado.',
        )}
      </p>
      {!setUp && !dirty && <p className="field__hint">{tr('Change a setting to save.', 'Cambie un ajuste para guardar.')}</p>}
    </AdminDialog>
  );
}

function FieldInput({
  id,
  f,
  value,
  stored,
  disabled,
  problem,
  onChange,
}: {
  id: string;
  f: FieldDef;
  value: string | boolean | undefined;
  stored: boolean;
  disabled: boolean;
  problem?: string;
  onChange: (v: string | boolean) => void;
}) {
  const tr = useTr();
  const hint = f.hint ? tr(f.hint.en, f.hint.es) : undefined;
  const errId = `${id}-err`;
  if (f.kind === 'toggle') {
    return (
      <div className="field">
        <label className="switch">
          <input type="checkbox" checked={!!value} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
          <span>{tr(f.label.en, f.label.es)}</span>
        </label>
        {hint && <span className="field__hint">{hint}</span>}
      </div>
    );
  }
  return (
    <div className="field">
      <label htmlFor={id}>{tr(f.label.en, f.label.es)}</label>
      {f.kind === 'select' ? (
        <select id={id} className="select" value={String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {tr(o.value, o.es ?? o.value)}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          className="input"
          type={f.kind === 'secret' ? 'password' : f.kind === 'url' ? 'url' : f.kind === 'email' ? 'email' : 'text'}
          autoComplete="off"
          placeholder={f.kind === 'secret' && stored ? tr('•••••••• stored', '•••••••• guardado') : undefined}
          value={String(value ?? '')}
          disabled={disabled}
          aria-invalid={!!problem}
          aria-describedby={problem ? errId : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {problem && (
        <span id={errId} className="field__hint intg-err">
          {problem}
        </span>
      )}
      {hint && <span className="field__hint">{hint}</span>}
    </div>
  );
}

function AddDialog({ taken, onClose, onAdd }: { taken: string[]; onClose: () => void; onAdd: (name: string, kind: AddableKind) => void }) {
  const tr = useTr();
  const [kind, setKind] = useState<AddableKind>(ADDABLE[0].kind);
  const defaultName = (k: AddableKind) => {
    const a = ADDABLE.find((x) => x.kind === k)!;
    return tr(a.name.en, a.name.es);
  };
  const [name, setName] = useState(() => defaultName(ADDABLE[0].kind));
  const [touched, setTouched] = useState(false);
  const clash = taken.some((t) => t.toLowerCase() === name.trim().toLowerCase());
  return (
    <AdminDialog
      title={tr('Add integration', 'Agregar integración')}
      sub={tr('New integrations start turned on but not set up.', 'Las integraciones nuevas empiezan encendidas pero sin configurar.')}
      onClose={onClose}
      onSubmit={() => onAdd(name.trim(), kind)}
      submitLabel={tr('Add', 'Agregar')}
      submitDisabled={!name.trim() || clash}
      dirty={touched}
    >
      <fieldset className="intg-kinds">
        <legend className="field__label">{tr('Type', 'Tipo')}</legend>
        {ADDABLE.map((a) => (
          <label key={a.kind} className={`intg-kind${kind === a.kind ? ' is-on' : ''}`}>
            <input
              type="radio"
              name="intg-kind"
              value={a.kind}
              checked={kind === a.kind}
              onChange={() => {
                setKind(a.kind);
                if (!touched) setName(defaultName(a.kind));
              }}
            />
            <Icon name={a.icon} size={18} />
            <span>
              <strong>{tr(a.name.en, a.name.es)}</strong>
              <span className="intg-kind__desc">{tr(a.description.en, a.description.es)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="field">
        <label htmlFor="intg-add-name">{tr('Name', 'Nombre')}</label>
        <input
          id="intg-add-name"
          className="input"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setTouched(true);
          }}
          aria-invalid={clash || !name.trim()}
          aria-describedby={clash || !name.trim() ? 'intg-add-err' : undefined}
        />
        {(clash || !name.trim()) && (
          <span id="intg-add-err" className="field__hint intg-err">
            {clash ? tr('An integration with this name already exists.', 'Ya existe una integración con este nombre.') : tr('Enter a name.', 'Ingrese un nombre.')}
          </span>
        )}
      </div>
    </AdminDialog>
  );
}
