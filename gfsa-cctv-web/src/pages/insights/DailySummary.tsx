import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Icon } from '../../components/Icon';
import { NoAccess, PageHeader, Segmented } from '../../components/ui';
import { useApp } from '../../state/AppState';
import { useUsers } from '../../state/usersStore';
import { useTr, type Lang } from '../../lib/i18n';
import { useExporter } from '../../lib/exporting';
import { slug, type PdfWatermark } from '../../lib/download';
import { fmtDay, fmtDayTime, fmtTime } from '../../lib/time';
import {
  DAILY_DEFAULT_VESSEL,
  DAILY_MIN,
  cameraName,
  clampDate,
  dailyDoc,
  hMin,
  isDailyVessel,
  longDate,
  minsToHm,
  roundResultText,
  roundsNote,
  routeText,
  shiftDate,
  shortDate,
  t,
  useCaseName,
  type DailySummary,
  type LinkKind,
} from './dailyData';
import { dayIso, useWidth } from './insightsUtil';
import { useInsightsData } from './useInsightsData';
import './DailySummary.css';

const PAPER_W = 794;
const PAPER_H = 1123;

const ALLOWED = ['ops_manager', 'fleet_super', 'safety_admin', 'tenant_admin', 'duty_officer', 'master'];

/** REP-01: the daily summary for one tug or barge, as the A4 page that is sent at 06:00. */
export function DailySummaryPage() {
  const { state, log } = useApp();
  const tr = useTr();
  const ex = useExporter();
  const users = useUsers();
  const data = useInsightsData();
  const { fleet, today } = data;
  const [params, setParams] = useSearchParams();
  const [printWm, setPrintWm] = useState<PdfWatermark | null>(null);

  // Masters receive the summary for their own convoy only (ADM-02).
  const ownConvoy = state.role === 'master' ? state.user.convoyId : undefined;
  const allowedConvoys = fleet.convoys.filter((c) => !ownConvoy || c.id === ownConvoy);

  let vesselId = params.get('vessel');
  if (!isDailyVessel(vesselId) || (ownConvoy && fleet.vesselById(vesselId!)?.convoyId !== ownConvoy)) {
    vesselId = ownConvoy ? (fleet.vesselsOf(ownConvoy)[1]?.id ?? fleet.vesselsOf(ownConvoy)[0].id) : DAILY_DEFAULT_VESSEL;
  }
  // The summary is for the day before; today shows the day so far.
  const date = params.get('date') ? clampDate(params.get('date'), today) : shiftDate(today, -1);
  const isToday = date === today;
  // The document language follows the console unless the reader picks the other one.
  const langParam = params.get('lang');
  const docLang: Lang = langParam === 'es' || langParam === 'en' ? langParam : state.lang;
  // Switching the console language brings the document back to it.
  const consoleLang = useRef(state.lang);
  useEffect(() => {
    if (consoleLang.current === state.lang) return;
    consoleLang.current = state.lang;
    if (!params.has('lang')) return;
    const next = new URLSearchParams(params);
    next.delete('lang');
    setParams(next, { replace: true });
  }, [state.lang, params, setParams]);

  if (!ALLOWED.includes(state.role)) return <NoAccess what={tr('daily summaries', 'los resúmenes diarios')} />;

  const summary = data.summary(vesselId!, date);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    next.set('vessel', vesselId!);
    next.set('date', date);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };
  const setDocLang = (l: Lang) => update({ lang: l === state.lang ? null : l });

  const vessel = fleet.vesselById(vesselId!)!;
  const convoy = fleet.convoyById(vessel.convoyId)!;
  const master = users.find((u) => u.role === 'master' && u.convoyId === convoy.id && u.status === 'active');
  const managers = users.filter((u) => u.role === 'ops_manager' && u.status === 'active');
  const target = `Daily summary · ${vessel.name} · ${date}`;
  const sendDay = fmtDay(dayIso(shiftDate(date, 1)));
  const toWhom = [
    managers.length ? tr(`the operations manager${managers.length > 1 ? 's' : ''}`, `${managers.length > 1 ? 'los gerentes' : 'el gerente'} de operaciones`) : '',
    master ? tr(`${master.name}, master of ${convoy.name}`, `${master.name}, capitán del ${convoy.name}`) : '',
  ]
    .filter(Boolean)
    .join(tr(' and ', ' y '));

  const download = () => {
    const doc = dailyDoc(summary, docLang);
    ex.pdf(`daily-summary-${slug(vessel.name)}-${date}-${docLang}.pdf`, doc, {
      action: 'Downloaded report',
      target,
      details: `PDF ${docLang.toUpperCase()}${summary.live ? ` · so far, up to ${minsToHm(summary.live.upTo)}` : ''}`,
      convoyId: vessel.convoyId,
    });
  };
  const print = () => {
    // The printed copy carries its own watermark ID, like a download.
    const wm = ex.nextWatermark(tr('Printed copy', 'Copia impresa'));
    setPrintWm(wm);
    log('Printed report', target, `${docLang.toUpperCase()} · Watermark ${wm.id}`, vessel.convoyId);
    window.setTimeout(() => window.print(), 50);
  };

  return (
    <div className="page ds-page">
      <PageHeader
        crumbs={[{ label: tr('Insights', 'Análisis') }, { label: tr('Reports', 'Informes'), to: '/reports' }]}
        title={tr('Daily summary', 'Resumen diario')}
        sub={
          isToday
            ? tr(`Today so far · sent ${sendDay} 06:00 Asunción to ${toWhom}`, `Hoy hasta ahora · se envía el ${sendDay} a las 06:00 hora de Asunción a ${toWhom}`)
            : tr(`Sent ${sendDay} 06:00 Asunción to ${toWhom} · PDF in each recipient's language`, `Enviado el ${sendDay} a las 06:00 hora de Asunción a ${toWhom} · PDF en el idioma de cada destinatario`)
        }
      />

      <div className="ds-toolbar">
        <label className="ds-toolbar__field">
          <span>{tr('Vessel', 'Embarcación')}</span>
          <select className="select" value={vesselId!} onChange={(e) => update({ vessel: e.target.value })}>
            {allowedConvoys.map((c) => (
              <optgroup key={c.id} label={tr(`${c.name} convoy`, `Convoy ${c.name}`)}>
                {fleet.vesselsOf(c.id).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.kind === 'tug' ? tr(`${v.name} (tug)`, `${v.name} (remolcador)`) : v.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="ds-toolbar__field">
          <label htmlFor="ds-date">{tr('Day', 'Día')}</label>
          <div className="ds-date">
            <button
              type="button"
              className="btn btn--icon"
              aria-label={tr('Previous day', 'Día anterior')}
              disabled={date <= DAILY_MIN}
              title={date <= DAILY_MIN ? tr('Summaries start on 1 Oct', 'Los resúmenes empiezan el 1 oct') : undefined}
              onClick={() => update({ date: shiftDate(date, -1) })}
            >
              <Icon name="chevronLeft" size={18} />
            </button>
            <input
              id="ds-date"
              type="date"
              className="input"
              min={DAILY_MIN}
              max={today}
              value={date}
              onChange={(e) => e.target.value && update({ date: clampDate(e.target.value, today) })}
            />
            <button
              type="button"
              className="btn btn--icon"
              aria-label={tr('Next day', 'Día siguiente')}
              disabled={isToday}
              title={isToday ? tr('Today is the latest day', 'Hoy es el último día') : undefined}
              onClick={() => update({ date: shiftDate(date, 1) })}
            >
              <Icon name="chevronRight" size={18} />
            </button>
          </div>
        </div>
        <div className="ds-toolbar__field">
          <span id="ds-doclang">{tr('Document language', 'Idioma del documento')}</span>
          <Segmented<Lang>
            label={tr('Document language', 'Idioma del documento')}
            value={docLang}
            onChange={setDocLang}
            options={[
              { value: 'es', label: 'ES' },
              { value: 'en', label: 'EN' },
            ]}
          />
        </div>
        <div className="ds-toolbar__actions">
          <button type="button" className="btn" onClick={print}>
            <Icon name="file" size={16} /> {tr('Print', 'Imprimir')}
          </button>
          <button type="button" className="btn btn--primary" onClick={download}>
            <Icon name="download" size={16} /> {tr('Download PDF', 'Descargar PDF')}
          </button>
        </div>
      </div>
      <p className="ds-note">
        <Icon name="shield" size={14} />{' '}
        {docLang === state.lang
          ? tr('The document follows the console language.', 'El documento sigue el idioma de la consola.')
          : tr(`The document is in ${docLang === 'es' ? 'Spanish' : 'English'}; the console stays in English.`, `El documento está en ${docLang === 'es' ? 'español' : 'inglés'}; la consola sigue en español.`)}{' '}
        {tr('Downloads and prints carry a watermark with your name and the time, and are written to the audit log.', 'Las descargas e impresiones llevan una marca de agua con su nombre y la hora, y quedan en el registro de auditoría.')}
      </p>
      {isToday && (
        <div className="callout ds-today">
          <Icon name="clock" size={18} />
          <span>
            {tr(
              `Today so far, up to ${fmtTime(data.now)}: built from the alarms and review queue in the console, the cameras' health and the convoy link. Classifying an event updates it. The final summary is sent ${sendDay} 06:00.`,
              `Hoy hasta ahora, a las ${fmtTime(data.now)}: se arma con las alarmas y la cola de revisión de la consola, el estado de las cámaras y el enlace del convoy. Clasificar un evento lo actualiza. El resumen final se envía el ${sendDay} a las 06:00.`,
            )}
          </span>
        </div>
      )}

      <ScaledPaper>
        <DailyPaper
          s={summary}
          lang={docLang}
          watermark={`${state.user.name} · ${printWm ? printWm.at : fmtDayTime(data.now)}${printWm ? ` · ${printWm.id}` : ''} · ${t('confidential', docLang)}`}
        />
      </ScaledPaper>
    </div>
  );
}

/** Scales the 794 × 1123 page down to fit narrow screens (print is always full size). */
function ScaledPaper({ children }: { children: React.ReactNode }) {
  const [ref, width] = useWidth<HTMLDivElement>(PAPER_W);
  const scale = Math.min(1, (width - 2) / PAPER_W);
  return (
    <div ref={ref} className="ds-stage">
      <div className="ds-stage__box" style={{ height: PAPER_H * scale, width: PAPER_W * scale }}>
        <div className="ds-stage__inner" style={{ transform: scale < 1 ? `scale(${scale})` : undefined }}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function DailyPaper({ s, lang, watermark }: { s: DailySummary; lang: Lang; watermark?: string }) {
  const max = Math.max(1, ...s.events.map((e) => e.count));
  const reviewed = s.total - s.outcomes.pending;
  const outcomeParts = [
    { key: 'accepted', n: s.outcomes.accepted, label: t('accepted', lang) },
    { key: 'false', n: s.outcomes.falseAlert, label: t('falseAlert', lang) },
    { key: 'rejected', n: s.outcomes.rejected, label: t('rejected', lang) },
    { key: 'pending', n: s.outcomes.pending, label: t('pending', lang) },
  ].filter((p) => p.n > 0 || p.key !== 'pending');
  const onTime = s.rounds?.filter((r) => r.result === 'on_time').length ?? 0;
  const counted = s.rounds?.filter((r) => r.result !== 'upcoming').length ?? 0;
  const genDate = shiftDate(s.date, 1);
  const genLabel = `${shortDate(genDate, lang)} ${genDate.slice(0, 4)}`;
  const upTo = s.live?.upTo ?? 1440;

  const outcomeSummary = outcomeParts.map((p) => `${p.label} ${p.n}`).join(', ');
  const linkSummary = (['good', 'weak', 'none'] as LinkKind[]).map((k) => `${t(k, lang)} ${hMin(s.linkTotals[k])}`).join(', ');

  return (
    <article className="ds-paper" lang={lang} aria-label={`${t('kicker', lang)} · ${s.vesselName} · ${longDate(s.date, lang)}`}>
      {watermark && (
        <div className="ds-watermark" aria-hidden="true">
          {watermark}
        </div>
      )}
      <header className="ds-paper__head">
        <div className="ds-paper__title">
          <span className="ds-kicker">{t('kicker', lang)}</span>
          <h2>{s.vesselName}</h2>
          <span>
            {longDate(s.date, lang)} · {t('tz', lang)}
            {s.live && <strong className="ds-sofar"> · {t('soFar', lang, { t: minsToHm(s.live.upTo) })}</strong>}
          </span>
        </div>
        <div className="ds-paper__meta">
          <span>{t('convoy', lang, { c: s.convoyName })}</span>
          <span>{s.voyageId ? t('voyage', lang, { v: s.voyageId }) : t('noVoyage', lang)}</span>
          {s.route && <span>{routeText(s.route, lang)}</span>}
          {s.portNote && <span>{s.portNote[lang]}</span>}
        </div>
      </header>

      <div className="ds-kpis">
        <div className="ds-kpi">
          <span>{t('eventsLogged', lang)}</span>
          <strong>{s.total}</strong>
        </div>
        <div className="ds-kpi">
          <span>{t('alertsSent', lang)}</span>
          <strong>{s.alertsSent}</strong>
        </div>
        <div className="ds-kpi">
          <span>{t('roundsOnTime', lang)}</span>
          {s.rounds ? (
            <strong>{t('of', lang, { a: onTime, b: counted })}</strong>
          ) : (
            <strong className="ds-kpi__na">
              – <small>{t('noReefers', lang)}</small>
            </strong>
          )}
        </div>
        <div className="ds-kpi">
          <span>{t('cameraUptime', lang)}</span>
          <strong>{s.uptimePct.toFixed(1)}%</strong>
        </div>
      </div>

      <section className="ds-sec">
        <h3>{t('eventsByUseCase', lang)}</h3>
        {s.events.length === 0 ? (
          <p className="ds-muted">{s.live ? t('noEventsYet', lang) : t('noEvents', lang)}</p>
        ) : (
          <div className="ds-bars">
            {s.events.map((e) => (
              <div key={e.useCaseId} className="ds-bars__row">
                <span>
                  {useCaseName(e.useCaseId, lang)}
                  {e.shadow && <span className="ds-bars__note">{t('shadow', lang)}</span>}
                </span>
                <div className="ds-bars__bar">
                  <span style={{ width: `${(e.count / max) * 85}%` }} />
                  <strong>{e.count}</strong>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="ds-sec">
        <div className="ds-sec__head">
          <h3>{t('reviewOutcomes', lang)}</h3>
          <span>
            {s.total === 0
              ? t('nothingToReview', lang)
              : s.outcomes.pending
                ? t('someReviewed', lang, { a: reviewed, b: s.total })
                : t('allReviewed', lang, { n: s.total })}
          </span>
        </div>
        {s.total > 0 && (
          <>
            <div className="ds-stack" role="img" aria-label={`${t('reviewOutcomes', lang)}: ${outcomeSummary}`}>
              {outcomeParts
                .filter((p) => p.n > 0)
                .map((p) => (
                  <span key={p.key} className={`ds-stack__${p.key}`} style={{ width: `${(p.n / s.total) * 100}%` }} />
                ))}
            </div>
            <div className="ds-legend">
              {outcomeParts.map((p) => (
                <span key={p.key}>
                  <i className={`ds-sw ds-stack__${p.key}`} aria-hidden="true" />
                  {p.label} <strong>{p.n}</strong>
                </span>
              ))}
            </div>
          </>
        )}
        <span className="ds-muted ds-small">
          {s.falseReasons.length ? t('falseAlerts', lang, { r: s.falseReasons.map((r) => r[lang === 'es' ? 1 : 0]).join(', ') }) : t('noFalse', lang)}
        </span>
      </section>

      <div className="ds-two">
        <section className="ds-sec ds-sec--tight">
          <h3>{t('reeferRounds', lang)}</h3>
          {s.rounds ? (
            <>
              <table className="ds-rounds">
                <thead>
                  <tr>
                    <th scope="col">{t('due', lang)}</th>
                    <th scope="col">{t('seen', lang)}</th>
                    <th scope="col">{t('result', lang)}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.rounds.map((r) => (
                    <tr key={r.due}>
                      <td>{r.due}</td>
                      <td>{r.seen ?? (r.result === 'missed' ? t('notSeen', lang) : '–')}</td>
                      <td>
                        <span className={`ds-res ds-res--${r.result === 'missed' ? 'missed' : r.result === 'late' ? 'late' : r.result === 'upcoming' ? 'upcoming' : 'ok'}`}>
                          <Icon
                            name={r.result === 'missed' ? 'x' : r.result === 'on_time' ? 'check' : 'clock'}
                            size={14}
                            strokeWidth={r.result === 'missed' || r.result === 'on_time' ? 2.4 : 2.2}
                          />
                          {roundResultText(r, lang)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <span className="ds-muted ds-xsmall">{roundsNote(s, lang)}</span>
            </>
          ) : (
            <p className="ds-muted ds-small">{t('tugNoRounds', lang)}</p>
          )}
        </section>

        <section className="ds-sec ds-sec--tight">
          <h3>{t('cameraUptime', lang)}</h3>
          <div className="ds-uptime">
            {s.uptime.map((u) => (
              <div key={u.cameraId}>
                <span className="ds-uptime__label">
                  <span>{cameraName(u.name, lang)}</span>
                  <strong>{u.pct === 100 ? '100%' : `${u.pct.toFixed(1)}%`}</strong>
                </span>
                <span className="ds-uptime__track" aria-hidden="true">
                  <span style={{ width: `${u.pct}%` }} />
                </span>
                {u.down && (
                  <span className="ds-muted ds-xsmall">
                    {u.ongoing
                      ? t('offlineSince', lang, { a: minsToHm(u.down.from) })
                      : t('offlineNote', lang, { a: minsToHm(u.down.from), b: minsToHm(u.down.from + u.down.mins) })}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="ds-sec ds-sec--tight">
        <div className="ds-sec__head">
          <h3>{s.live ? t('linkSoFar', lang) : t('link', lang)}</h3>
          <span>{s.longestWait ? t('longestWait', lang, { d: hMin(s.longestWait) }) : s.live ? t('noWaitYet', lang) : t('noWait', lang)}</span>
        </div>
        <div className="ds-link" role="img" aria-label={`${s.live ? t('linkSoFar', lang) : t('link', lang)}: ${linkSummary}`}>
          {s.link.map((seg, i) => (
            <span
              key={i}
              className={`ds-link__${seg.kind}`}
              style={{
                left: `${(seg.from / 1440) * 100}%`,
                width: seg.to >= upTo ? `${((seg.to - seg.from) / 1440) * 100}%` : `calc(${((seg.to - seg.from) / 1440) * 100}% - 2px)`,
              }}
            />
          ))}
          {s.live && (
            <>
              <span className="ds-link__rest" style={{ left: `calc(${(upTo / 1440) * 100}% + 2px)`, right: 0 }} />
              <span className="ds-link__now" style={{ left: `${(upTo / 1440) * 100}%` }} />
            </>
          )}
        </div>
        <div className="ds-axis" aria-hidden="true">
          <span style={{ left: 0 }}>00:00</span>
          <span style={{ left: '25%', transform: 'translateX(-50%)' }}>06:00</span>
          <span style={{ left: '50%', transform: 'translateX(-50%)' }}>12:00</span>
          <span style={{ left: '75%', transform: 'translateX(-50%)' }}>18:00</span>
          <span style={{ right: 0 }}>24:00</span>
        </div>
        <div className="ds-legend">
          {(['good', 'weak', 'none'] as LinkKind[]).map((k) => (
            <span key={k}>
              <i className={`ds-sw ds-sw--wide ds-link__${k}`} aria-hidden="true" />
              {t(k, lang)} <strong>{hMin(s.linkTotals[k])}</strong>
            </span>
          ))}
          {s.live && (
            <span>
              <i className="ds-sw ds-sw--wide ds-link__rest" aria-hidden="true" />
              {t('rest', lang)}
            </span>
          )}
        </div>
      </section>

      <footer className="ds-paper__foot">
        <span>{s.live ? t('liveFoot', lang, { t: minsToHm(s.live.upTo), d: genLabel }) : t('generated', lang, { d: genLabel })}</span>
        <span>{t('page', lang)}</span>
      </footer>
    </article>
  );
}
