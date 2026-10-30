import { useMemo } from 'react';
import { Card, StatusDot } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useApp } from '../../state/AppState';
import { useFleet } from '../../state/fleetStore';
import { useTr } from '../../lib/i18n';
import { TZ, fmtAgo, fmtDay, fmtDuration, fmtTime, fmtTimeSec, useNow } from '../../lib/time';
import { positionText } from '../screenText';
import { PublicLayout } from './PublicLayout';

// Service health page (PRD: Observability, "a service health page"; Availability 99.9%).
// Shore services with 90 days of history; the current state comes from live data
// where there is any: edge units and convoy positions from the fleet store, alerts
// from the audit log. A convoy out of coverage is vessel coverage, not an outage:
// its events wait on board and arrive with their original times.

type CompId = 'console' | 'events' | 'alerts' | 'whatsapp' | 'sms' | 'email' | 'voice' | 'connect' | 'positions' | 'storage' | 'sso';
type CompState = 'operational' | 'degraded' | 'outage' | 'coverage';

interface Incident {
  id: string;
  /** Asunción calendar day, YYYY-MM-DD. */
  day: string;
  window: string;
  minutes: number;
  kind: 'degraded' | 'outage';
  components: CompId[];
  title: [string, string];
  impact: [string, string];
  updates: { at: string; status: [string, string]; text: [string, string] }[];
}

// The service history (production: the status service). One incident in 90 days.
const INCIDENTS: Incident[] = [
  {
    id: 'INC-26-007',
    day: '2026-09-12',
    window: '21:04–21:22',
    minutes: 18,
    kind: 'degraded',
    components: ['alerts', 'whatsapp', 'sms'],
    title: ['Messaging delay', 'Demora en los mensajes'],
    impact: [
      'WhatsApp and SMS alerts arrived up to 6 minutes late. The wheelhouse displays, the console and email were not affected.',
      'Las alertas por WhatsApp y SMS llegaron hasta 6 minutos tarde. Las pantallas del puente, la consola y el correo no se vieron afectados.',
    ],
    updates: [
      {
        at: '21:04',
        status: ['Investigating', 'Investigando'],
        text: ['Alerts by WhatsApp and SMS are taking longer than usual to arrive.', 'Las alertas por WhatsApp y SMS tardan más de lo habitual en llegar.'],
      },
      {
        at: '21:11',
        status: ['Identified', 'Identificado'],
        text: [
          "A messaging provider's API slowed down. Alerts moved to the backup route.",
          'La API de un proveedor de mensajería se ralentizó. Las alertas pasaron a la ruta de respaldo.',
        ],
      },
      {
        at: '21:22',
        status: ['Resolved', 'Resuelto'],
        text: ['Messages are on time again. Every delayed alert was delivered; none was lost.', 'Los mensajes vuelven a llegar a tiempo. Se entregaron todas las alertas demoradas; no se perdió ninguna.'],
      },
    ],
  },
];

const MAINTENANCE = {
  when: ['Sun 19 Oct, 02:00–03:00 Asunción', 'dom 19 oct, 02:00–03:00 Asunción'] as [string, string],
  text: [
    'Console and reports may be slow for a few minutes. Alerts to the wheelhouse displays and by message are not affected.',
    'La consola y los informes pueden ir lentos unos minutos. Las alertas a las pantallas del puente y por mensaje no se ven afectadas.',
  ] as [string, string],
};

const DAYS = 90;
const dayKey = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

function uptime(id: CompId, children: CompId[] = []): number {
  const mins = INCIDENTS.filter((i) => i.components.includes(id) || children.some((c) => i.components.includes(c))).reduce((s, i) => s + i.minutes, 0);
  return 100 - (mins / (DAYS * 24 * 60)) * 100;
}
const fmtPct = (p: number, lang: 'en' | 'es' = 'en') => {
  const v = p >= 99.995 ? '100' : p.toFixed(2);
  return lang === 'es' ? `${v.replace('.', ',')} %` : `${v}%`;
};

export function StatusPage() {
  const { state } = useApp();
  const lang = state.lang;
  const tr = useTr();
  const fleet = useFleet();
  const now = useNow();

  const today = dayKey(now);
  const days = useMemo(() => {
    const list: { key: string; ms: number }[] = [];
    for (let i = DAYS - 1; i >= 0; i--) {
      const ms = now - i * 86_400_000;
      list.push({ key: dayKey(ms), ms });
    }
    return list;
    // One list per scenario day.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today]);

  // ---------- Live state ----------
  const units = fleet.edgeUnits;
  const reporting = units.filter((u) => u.status === 'reporting').length;
  const outOfCoverage = units.filter((u) => u.status === 'out_of_coverage').length;
  const unitIssues = units.filter((u) => u.status === 'fault' || u.status === 'restarting').length;
  const convoys = fleet.convoys;
  const offline = convoys.filter((c) => c.link === 'none');
  const lastAlert = state.audit.find((e) => e.source === 'Alert routing' || e.action === 'Sent alert' || e.action === 'Sent reminder');
  const lastConnect = state.audit.find((e) => e.source === 'Connect integration');
  const backIn = (convoyId: string) => state.audit.find((e) => e.action === 'Convoy back in coverage' && e.convoyId === convoyId);

  type Row = { id: CompId; name: string; desc: string; state: CompState; live?: string; children?: Row[] };
  const rows: Row[] = [
    {
      id: 'console',
      name: tr('Console', 'Consola'),
      desc: tr('Web console, video wall and phone alert pages', 'Consola web, videowall y páginas de alerta en el teléfono'),
      state: 'operational',
    },
    {
      id: 'events',
      name: tr('Event service', 'Servicio de eventos'),
      desc: tr('Receives events, clips and health messages from the edge units', 'Recibe eventos, clips y mensajes de estado de las unidades de borde'),
      state: 'operational',
      live: [
        tr(`${reporting} of ${units.length} edge units reporting`, `${reporting} de ${units.length} unidades de borde reportando`),
        outOfCoverage ? tr(`${outOfCoverage} out of coverage, queuing on board`, `${outOfCoverage} sin cobertura, en cola a bordo`) : '',
        unitIssues ? tr(`${unitIssues} restarting or with a fault on board`, `${unitIssues} reiniciando o con falla a bordo`) : '',
      ]
        .filter(Boolean)
        .join(' · '),
    },
    {
      id: 'alerts',
      name: tr('Alert routing', 'Enrutamiento de alertas'),
      desc: tr('Escalations, reminders and digests to the people on the ladder', 'Escalamientos, recordatorios y resúmenes a las personas de la escala'),
      state: 'operational',
      live: lastAlert ? tr(`Last message sent ${fmtAgo(lastAlert.at, now)}`, `Último mensaje enviado ${fmtAgo(lastAlert.at, now)}`) : undefined,
      children: [
        { id: 'whatsapp', name: 'WhatsApp', desc: tr('Alerts with the phone page link', 'Alertas con el enlace a la página del teléfono'), state: 'operational' },
        { id: 'sms', name: 'SMS', desc: tr('Alerts with the phone page link', 'Alertas con el enlace a la página del teléfono'), state: 'operational' },
        { id: 'email', name: tr('Email', 'Correo'), desc: tr('Escalations, digests and reports', 'Escalamientos, resúmenes e informes'), state: 'operational' },
        { id: 'voice', name: tr('Voice call', 'Llamada de voz'), desc: tr('P1 calls to the duty officer and managers', 'Llamadas P1 al oficial de guardia y a los gerentes'), state: 'operational' },
      ],
    },
    {
      id: 'connect',
      name: tr('Connect integration', 'Integración con Connect'),
      desc: tr('Voyages, schedules and cargo lists from Connect; missed rounds back to it', 'Viajes, horarios y listas de carga desde Connect; rondas perdidas de vuelta a Connect'),
      state: 'operational',
      live: lastConnect ? tr(`Last record sent ${fmtAgo(lastConnect.at, now)}`, `Último registro enviado ${fmtAgo(lastConnect.at, now)}`) : undefined,
    },
    {
      id: 'positions',
      name: tr('Positions and health', 'Posiciones y estado'),
      desc: tr('Last position and health from every convoy, every minute', 'Última posición y estado de cada convoy, cada minuto'),
      state: offline.length ? 'coverage' : 'operational',
      live: offline.length
        ? tr(
            `${convoys.length - offline.length} of ${convoys.length} convoys reporting · ${offline.map((c) => c.name).join(', ')} out of coverage`,
            `${convoys.length - offline.length} de ${convoys.length} convoyes reportando · ${offline.map((c) => c.name).join(', ')} sin cobertura`,
          )
        : tr(`All ${convoys.length} convoys reporting`, `Los ${convoys.length} convoyes reportan`),
    },
    {
      id: 'storage',
      name: tr('Object storage', 'Almacenamiento de objetos'),
      desc: tr('Clips and snapshots, kept 90 days', 'Clips y fotos, guardados 90 días'),
      state: 'operational',
    },
    {
      id: 'sso',
      name: tr('Single sign-on', 'Inicio de sesión único'),
      desc: tr('Sign-in with the GFSA directory and a second factor', 'Inicio de sesión con el directorio de GFSA y un segundo factor'),
      state: 'operational',
    },
  ];

  const anyDown = rows.some((r) => r.state === 'outage' || r.state === 'degraded' || r.children?.some((c) => c.state === 'outage' || c.state === 'degraded'));
  const incidents90 = INCIDENTS.filter((i) => days.some((d) => d.key === i.day));

  const stateBadge = (s: CompState) =>
    s === 'operational' ? (
      <StatusDot tone="ok">{tr('Operational', 'Operativo')}</StatusDot>
    ) : s === 'coverage' ? (
      <StatusDot tone="off">{tr('Vessel coverage', 'Cobertura del buque')}</StatusDot>
    ) : s === 'degraded' ? (
      <StatusDot tone="warn">{tr('Degraded', 'Degradado')}</StatusDot>
    ) : (
      <StatusDot tone="bad">{tr('Outage', 'Caída')}</StatusDot>
    );

  const bars = (row: Row) => {
    const ids = [row.id, ...(row.children ?? []).map((c) => c.id)];
    const pct = uptime(row.id, (row.children ?? []).map((c) => c.id));
    const hits = incidents90.filter((i) => ids.some((id) => i.components.includes(id)));
    return (
      <div className="st-row__bars">
        <div className="st-bars" aria-hidden="true">
          {days.map((d) => {
            const inc = hits.find((i) => i.day === d.key);
            return (
              <span
                key={d.key}
                className={inc ? (inc.kind === 'outage' ? 'is-outage' : 'is-degraded') : undefined}
                title={inc ? `${fmtDay(d.ms)} · ${inc.minutes} min · ${tr(inc.title[0], inc.title[1])}` : `${fmtDay(d.ms)} · ${tr('no incidents', 'sin incidentes')}`}
              />
            );
          })}
        </div>
        <div className="st-bars__axis">
          <span className="st-axis-90">{tr('90 days ago', 'Hace 90 días')}</span>
          <span className="st-axis-45">{tr('45 days ago', 'Hace 45 días')}</span>
          <span>
            {tr(`${fmtPct(pct, lang)} uptime`, `${fmtPct(pct, lang)} disponible`)}
            {hits.length ? tr(` · ${hits.length} incident`, ` · ${hits.length} incidente`) : ''}
          </span>
          <span>{tr('Today', 'Hoy')}</span>
        </div>
        <span className="sr-only">
          {tr(
            `${fmtPct(pct, lang)} uptime over 90 days${hits.length ? `; incidents on ${hits.map((i) => fmtDay(new Date(`${i.day}T12:00:00-03:00`))).join(', ')}` : '; no incidents'}.`,
            `${fmtPct(pct, lang)} de disponibilidad en 90 días${hits.length ? `; incidentes el ${hits.map((i) => fmtDay(new Date(`${i.day}T12:00:00-03:00`))).join(', ')}` : '; sin incidentes'}.`,
          )}
        </span>
      </div>
    );
  };

  return (
    <PublicLayout
      title={tr('Service status', 'Estado del servicio')}
      sub={tr(
        'Shore services for CCTV Monitoring at GFSA. Alerts on board never wait for shore: the wheelhouse displays keep working with no link.',
        'Servicios en tierra de CCTV Monitoring en GFSA. Las alertas a bordo nunca esperan a tierra: las pantallas del puente siguen funcionando sin enlace.',
      )}
      meta={
        <>
          <span className="with-dot">
            <span className="dot" aria-hidden="true" /> {tr('Live', 'En vivo')} · {tr('updated', 'actualizado')} <span className="mono">{fmtTimeSec(now)}</span> Asunción
          </span>
          <span>{tr('Target: 99.9% a month for shore services (proposed)', 'Objetivo: 99,9 % al mes para los servicios en tierra (propuesto)')}</span>
        </>
      }
    >
      <section className="st-summary" aria-labelledby="st-summary-title" role="status">
        <span className={`st-summary__icon${anyDown ? ' st-summary__icon--warn' : ''}`}>
          <Icon name={anyDown ? 'alert' : 'check'} size={24} strokeWidth={2.4} />
        </span>
        <div className="st-summary__text">
          <strong id="st-summary-title">
            {anyDown ? tr('Some shore services are degraded', 'Algunos servicios en tierra están degradados') : tr('All shore services are running', 'Todos los servicios en tierra funcionan')}
          </strong>
          <span>
            {offline.length
              ? lang === 'es'
                ? `Cobertura del buque: ${offline.map((c) => `${c.name} sin enlace desde las ${fmtTime(c.lastSeen)} (${positionText(c.positionLabel, 'es', true)})`).join('; ')}. Sus eventos esperan a bordo y llegan con su hora original. No es una caída.`
                : `Vessel coverage: ${offline.map((c) => `${c.name} has no link since ${fmtTime(c.lastSeen)} (${positionText(c.positionLabel, 'en', true)})`).join('; ')}. Its events wait on board and arrive with their original times. This is not an outage.`
              : tr(`Every convoy is reporting. ${incidents90.length} incident in the last 90 days.`, `Todos los convoyes reportan. ${incidents90.length} incidente en los últimos 90 días.`)}
          </span>
        </div>
      </section>

      <Card id="st-components" title={tr('Shore services', 'Servicios en tierra')} hint={tr('Last 90 days', 'Últimos 90 días')} bodyClass="">
        <ul className="st-list">
          {rows.map((r) => (
            <li key={r.id}>
              <div className="st-row">
                <div className="st-row__name">
                  <strong>{r.name}</strong>
                  <span>{r.desc}</span>
                  {r.live && <span>{r.live}</span>}
                </div>
                <span className="st-row__state">{stateBadge(r.state)}</span>
                {bars(r)}
              </div>
              {r.children && (
                <ul className="st-list" aria-label={tr(`${r.name} channels`, `Canales de ${r.name.toLowerCase()}`)}>
                  {r.children.map((c) => (
                    <li key={c.id} className="st-row st-row--child">
                      <div className="st-row__name">
                        <strong>{c.name}</strong>
                        <span>{c.desc}</span>
                      </div>
                      <span className="st-row__state">{stateBadge(c.state)}</span>
                      {bars(c)}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <div className="pub-cols">
        <Card
          id="st-coverage"
          title={tr('Vessel coverage', 'Cobertura de los buques')}
          hint={tr('Not counted as downtime', 'No cuenta como caída')}
          bodyClass=""
        >
          <ul className="st-coverage">
            {convoys.map((c) => {
              const us = fleet.unitsOf(c.id);
              const up = us.filter((u) => u.status === 'reporting').length;
              const back = backIn(c.id);
              const off = c.link === 'none';
              return (
                <li key={c.id}>
                  <span className="st-coverage__name">
                    <strong>{tr(`${c.name} convoy`, `Convoy ${c.name}`)}</strong>
                    <span>
                      {off
                        ? tr(
                            `No link since ${fmtTime(c.lastSeen)} · ${c.queuedEvents} events queued on board`,
                            `Sin enlace desde las ${fmtTime(c.lastSeen)} · ${c.queuedEvents} eventos en cola a bordo`,
                          )
                        : tr(`Last health message ${fmtAgo(c.lastSeen, now)} · ${up} of ${us.length} edge units`, `Último mensaje de estado ${fmtAgo(c.lastSeen, now)} · ${up} de ${us.length} unidades de borde`)}
                      {back && !off ? tr(` · back in coverage at ${fmtTime(back.at)}`, ` · con cobertura de nuevo desde las ${fmtTime(back.at)}`) : ''}
                    </span>
                  </span>
                  {off ? (
                    <StatusDot tone="off">
                      {tr('Out of coverage', 'Sin cobertura')} · {fmtDuration(now - new Date(c.lastSeen).getTime())}
                    </StatusDot>
                  ) : (
                    <StatusDot tone={c.link === 'weak' ? 'warn' : 'ok'}>{tr(`Reporting · ${c.linkLabel}`, `Reportando · ${c.linkLabel}`)}</StatusDot>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="card__body pub-small">
            {tr(
              'Edge units keep detecting and alerting the wheelhouse with no link, and hold at least 14 days of events. When coverage returns, queued events arrive with their original times, so nothing is lost.',
              'Las unidades de borde siguen detectando y alertando al puente sin enlace, y guardan al menos 14 días de eventos. Cuando vuelve la cobertura, los eventos en cola llegan con su hora original, así que no se pierde nada.',
            )}
          </div>
        </Card>

        <Card id="st-maint" title={tr('Scheduled maintenance', 'Mantenimiento programado')} bodyClass="">
          <ul className="st-incidents">
            <li className="st-incident">
              <div className="st-incident__head">
                <span className="badge badge--info">{tr('Upcoming', 'Próximo')}</span>
                <h3>{tr(MAINTENANCE.when[0], MAINTENANCE.when[1])}</h3>
              </div>
              <p className="st-incident__meta">{tr(MAINTENANCE.text[0], MAINTENANCE.text[1])}</p>
            </li>
          </ul>
        </Card>
      </div>

      <Card id="st-incidents" title={tr('Recent incidents', 'Incidentes recientes')} hint={tr('Last 90 days', 'Últimos 90 días')} bodyClass="">
        {incidents90.length === 0 ? (
          <div className="empty">{tr('No incidents in the last 90 days.', 'Sin incidentes en los últimos 90 días.')}</div>
        ) : (
          <ul className="st-incidents">
            {incidents90.map((i) => {
              const comps = i.components
                .map((id) => {
                  const r = rows.find((x) => x.id === id) ?? rows.flatMap((x) => x.children ?? []).find((x) => x.id === id);
                  return r?.name;
                })
                .filter(Boolean)
                .join(', ');
              const dayMs = new Date(`${i.day}T12:00:00-03:00`).getTime();
              return (
                <li key={i.id} className="st-incident">
                  <div className="st-incident__head">
                    <span className="badge badge--ok">{tr('Resolved', 'Resuelto')}</span>
                    <h3>{tr(i.title[0], i.title[1])}</h3>
                    <span className="st-incident__meta">
                      {fmtDay(dayMs)} · {i.window} · {i.minutes} min · {comps}
                    </span>
                  </div>
                  <p className="st-incident__meta">{tr(i.impact[0], i.impact[1])}</p>
                  <ol className="st-timeline">
                    {i.updates.map((u) => (
                      <li key={u.at}>
                        <span className="mono">{u.at}</span> <strong>{tr(u.status[0], u.status[1])}</strong> · {tr(u.text[0], u.text[1])}
                      </li>
                    ))}
                  </ol>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </PublicLayout>
  );
}
