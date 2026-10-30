import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import type { LinkState, Priority } from '../../data/types';
import { Segmented } from '../../components/ui';
import { useLang, useTr } from '../../lib/i18n';
import { fmtDay, fmtDayTime, fmtTime } from '../../lib/time';
import {
  DAY,
  HOUR,
  ROUND_EVERY_H,
  ROUND_LABEL,
  TOLERANCE_MIN,
  alignLocal,
  callLabel,
  dayWord,
  fmtDelta,
  fmtRoundTime,
  fmtWeekdayShort,
  useCaseName,
  vesselName,
  vesselShort,
  type LinkSeg,
  type Round,
  type RoundResult,
  type VoyageEvent,
  type VoyageRecord,
} from './voyageData';

// VOY-02: the voyage on one timeline. Schedule from Connect, port times from
// video, reefer rounds per barge, events, alarms and link state, with a now marker.

export interface TimelineAlarm {
  id: string;
  priority: Priority;
  title: string;
  at: number;
  open: boolean;
  linkable: boolean;
}

type Range = 'whole' | '24h';

interface Detail {
  key: string;
  title: string;
  body: string;
  link?: { to: string; label: string };
}

const LINK_TEXT: Record<LinkState, [string, string]> = {
  strong: ['Link strong', 'Enlace fuerte'],
  weak: ['Link weak', 'Enlace débil'],
  none: ['No link, events queued on board', 'Sin enlace, eventos en cola a bordo'],
};

export function VoyageTimeline({
  rec,
  rounds,
  alarms,
  events,
  link,
  reconnectedAt,
  callSent,
  now,
}: {
  rec: VoyageRecord;
  rounds: Round[];
  alarms: TimelineAlarm[];
  events: VoyageEvent[];
  link: LinkSeg[];
  reconnectedAt?: number;
  callSent: (i: number) => number | undefined;
  now: number;
}) {
  const tr = useTr();
  const lang = useLang();
  const [range, setRange] = useState<Range>('whole');
  const [hover, setHover] = useState<Detail | null>(null);
  const [pinned, setPinned] = useState<Detail | null>(null);
  const v = rec.voyage;

  const lastArrival = rec.calls.filter((c) => c.kind === 'arrival' && c.actual).at(-1)?.actual;
  const anchor = v.status === 'completed' ? Math.min(now, lastArrival ?? rec.window.end) : now;
  const [start, end] = range === 'whole' ? [rec.window.start, rec.window.end] : [anchor - 24 * HOUR, anchor + 2 * HOUR];
  const span = end - start;
  const pct = (t: number) => ((t - start) / span) * 100;
  const inWin = (t: number) => t >= start && t <= end;
  const clip = (from: number, to: number) => {
    const a = Math.max(from, start);
    const b = Math.min(to, end);
    return b > a ? { left: pct(a), width: pct(b) - pct(a) } : null;
  };

  // Axis: days for the whole voyage, 3-hour ticks for the last 24 hours.
  const axis = useMemo(() => {
    const lines: number[] = [];
    const labels: { at: number; text: string; strong: boolean }[] = [];
    if (range === 'whole') {
      for (let d = alignLocal(start, DAY); d <= end; d += DAY) {
        if (d >= start) lines.push(d);
        const mid = d + 12 * HOUR;
        if (mid > start && mid < end) {
          const wd = fmtWeekdayShort(d).split(' ');
          labels.push({
            at: mid,
            text: labels.length === 0 ? fmtWeekdayShort(d) : `${wd[0]} ${wd[1]}`,
            strong: fmtDay(d) === fmtDay(now),
          });
        }
      }
    } else {
      const step = 3 * HOUR;
      for (let t = alignLocal(start, step) + step; t < end; t += step) {
        lines.push(t);
        const isMidnight = alignLocal(t, DAY) === t;
        const wd = fmtWeekdayShort(t).split(' ');
        labels.push({ at: t, text: isMidnight ? `${wd[0]} ${wd[1]}` : fmtTime(t), strong: isMidnight });
      }
    }
    return { lines, labels };
    // lang is a dependency because the weekday names follow the language.
  }, [range, start, end, now, lang]);

  // Events per bucket.
  const bucket = range === 'whole' ? ROUND_EVERY_H * HOUR : 2 * HOUR;
  const buckets = useMemo(() => {
    const out: { from: number; n: number; late: number }[] = [];
    for (let b = alignLocal(start, bucket); b < end; b += bucket) {
      const evs = events.filter((e) => e.at >= b && e.at < b + bucket);
      if (evs.length > 0 && b + bucket / 2 >= start) out.push({ from: b, n: evs.length, late: evs.filter((e) => e.late).length });
    }
    return out;
  }, [events, start, end, bucket]);
  const maxBucket = Math.max(0, ...buckets.map((b) => b.n));

  // Alarms grouped when they sit close together on this scale.
  const clusters = useMemo(() => {
    const list = alarms.filter((a) => a.at >= start && a.at <= end).sort((a, b) => a.at - b.at);
    const gap = span / 40;
    const out: TimelineAlarm[][] = [];
    list.forEach((a) => {
      const last = out.at(-1);
      if (last && a.at - last[last.length - 1].at <= gap) last.push(a);
      else out.push([a]);
    });
    return out;
  }, [alarms, start, end, span]);
  const labelledCluster = [...clusters].reverse().find((c) => c.length > 1 && c.some((a) => a.open)) ?? clusters.filter((c) => c.length > 1).at(-1);

  const linkSegs = link.map((s) => ({ ...s, end: s.to ?? Math.min(now, end) })).filter((s) => s.end > s.from);

  const reeferBarges = rec.roundSpecs.map((r) => r.bargeId);
  const lastRow = 3 + reeferBarges.length + 3; // link row
  const nowVisible = now >= start && now <= end;
  const slot = (ROUND_EVERY_H * HOUR * 100) / span;

  const detail = pinned ?? hover;
  const bind = (d: Detail) => ({
    onMouseEnter: () => setHover(d),
    onMouseLeave: () => setHover((h) => (h?.key === d.key ? null : h)),
    onFocus: () => setHover(d),
    onBlur: () => setHover((h) => (h?.key === d.key ? null : h)),
    onClick: () => setPinned((p) => (p?.key === d.key ? null : d)),
    'aria-pressed': pinned?.key === d.key,
    'aria-label': `${d.title}. ${d.body}`,
  });

  const roundDetail = (r: Round): Detail => {
    const sched = fmtRoundTime(r.scheduled);
    let body = '';
    if (r.result === 'on_time' && r.seen)
      body = tr(`Seen ${fmtTime(r.seen)}, within ${TOLERANCE_MIN} min of the schedule.`, `Vista ${fmtTime(r.seen)}, dentro de ${TOLERANCE_MIN} min del horario.`);
    else if (r.result === 'late' && r.seen)
      body = tr(`Seen ${fmtTime(r.seen)}, ${r.minutes} min late. Sent to Connect.`, `Vista ${fmtTime(r.seen)}, ${r.minutes} min tarde. Enviada a Connect.`);
    else if (r.result === 'missed')
      body = tr('Nobody seen in the reefer row. Counted as missed and sent to Connect.', 'Nadie visto en la fila de reefers. Contada como perdida y enviada a Connect.');
    else if (r.result === 'overdue')
      body = tr(
        `Not seen yet, overdue ${r.minutes} min. Alarm open; counts as missed ${fmtTime(r.scheduled + HOUR)}.`,
        `Aún no vista, vencida hace ${r.minutes} min. Alarma abierta; cuenta como perdida a las ${fmtTime(r.scheduled + HOUR)}.`,
      );
    else if (r.result === 'queued')
      body = tr('The convoy is out of coverage. The result is queued on board.', 'El convoy está sin cobertura. El resultado espera en cola a bordo.');
    else
      body = tr(
        `Due. On time if someone is seen in the reefer row by ${fmtTime(r.scheduled + TOLERANCE_MIN * 60_000)}.`,
        `Pendiente. A tiempo si se ve a alguien en la fila de reefers antes de las ${fmtTime(r.scheduled + TOLERANCE_MIN * 60_000)}.`,
      );
    return {
      key: `round-${r.key}`,
      title: tr(`${vesselName(r.bargeId)} round ${sched} · ${ROUND_LABEL[r.result][0]}`, `${vesselName(r.bargeId)} ronda ${sched} · ${ROUND_LABEL[r.result][1]}`),
      body,
      link: { to: `?tab=rounds&barge=${r.bargeId}`, label: tr('All rounds on this barge', 'Todas las rondas de esta barcaza') },
    };
  };

  const gridStyle: CSSProperties = { gridTemplateRows: `18px 22px 24px ${reeferBarges.map(() => '22px').join(' ')} 40px 24px 10px 22px` };

  // Port call labels: skip when they would collide with the previous one.
  let lastLabelled = -100;
  const callMarks = rec.calls.map((c, i) => {
    const t = c.actual ?? c.scheduled;
    if (!inWin(t)) return null;
    const p = pct(t);
    const nextT = rec.calls[i + 1] ? (rec.calls[i + 1].actual ?? rec.calls[i + 1].scheduled) : Infinity;
    const roomRight = pct(nextT) - p;
    let label: string | null = null;
    let side: 'right' | 'left' = 'right';
    if (c.actual) {
      if (p - lastLabelled > 6) {
        label =
          roomRight > 32 && p < 70
            ? tr(
                `${c.port} · ${callLabel(c, tr).toLowerCase()} ${fmtTime(c.actual)}, schedule ${fmtTime(c.scheduled)}`,
                `${c.port} · ${callLabel(c, tr).toLowerCase()} ${fmtTime(c.actual)}, horario ${fmtTime(c.scheduled)}`,
              )
            : c.port;
        side = p > 85 ? 'left' : 'right';
      }
    } else if (p - lastLabelled > 10) {
      label = c.port;
      side = 'left';
    }
    if (label) lastLabelled = p;
    const sent = callSent(i);
    const d: Detail = {
      key: `call-${i}`,
      title: `${c.port} · ${callLabel(c, tr)}`,
      body: c.actual
        ? tr(
            `Schedule ${fmtDayTime(c.scheduled)} · video ${fmtDayTime(c.actual)} (${fmtDelta(c.actual - c.scheduled, tr)}). Sent to Connect${sent ? ` ${fmtDayTime(sent)}` : ''}.`,
            `Horario ${fmtDayTime(c.scheduled)} · video ${fmtDayTime(c.actual)} (${fmtDelta(c.actual - c.scheduled, tr)}). Enviada a Connect${sent ? ` ${fmtDayTime(sent)}` : ''}.`,
          )
        : tr(`Schedule ${fmtDayTime(c.scheduled)} · actual time from video pending.`, `Horario ${fmtDayTime(c.scheduled)} · hora real del video pendiente.`),
    };
    return { c, p, label, side, d };
  });

  return (
    <section className="card voy-tl" aria-labelledby="tl-title">
      <div className="card__head voy-tl__head">
        <div className="card__title">
          <h2 id="tl-title">{tr('Voyage timeline', 'Cronología del viaje')}</h2>
          <span className="card__hint">
            {range === 'whole'
              ? tr('Schedule from Connect, checks from video', 'Horario de Connect, controles por video')
              : tr('Last 24 hours and the next 2', 'Últimas 24 horas y las 2 siguientes')}
          </span>
        </div>
        <Segmented<Range>
          label={tr('Range', 'Periodo')}
          value={range}
          onChange={(r) => {
            setRange(r);
            setPinned(null);
          }}
          options={[
            { value: 'whole', label: tr('Whole voyage', 'Todo el viaje') },
            { value: '24h', label: tr('Last 24 hours', 'Últimas 24 horas') },
          ]}
        />
      </div>
      <div className="voy-tl__body">
        <div className="voy-tl__scroll" role="region" aria-label={tr('Voyage timeline, scrolls sideways', 'Cronología del viaje, se desplaza hacia los lados')} tabIndex={0}>
          <div className="voy-tl__grid" style={gridStyle}>
            {/* Grid lines */}
            <div aria-hidden="true" className="voy-tl__lines" style={{ gridRow: `1 / span ${lastRow}` }}>
              <span style={{ left: 0 }} />
              {axis.lines.map((t) => (
                <span key={t} style={{ left: `${pct(t)}%` }} />
              ))}
              <span style={{ right: 0 }} />
            </div>

            {/* Axis */}
            <span style={{ gridColumn: 1, gridRow: 1 }} />
            <div className="voy-tl__track voy-tl__axis" style={{ gridRow: 1 }}>
              {axis.labels.map((l) => (
                <span key={l.at} style={{ left: `${pct(l.at)}%` }} className={l.strong ? 'is-strong' : undefined}>
                  {l.text}
                </span>
              ))}
            </div>

            {/* Schedule */}
            <span className="voy-tl__label" style={{ gridRow: 2 }}>
              {tr('Schedule · Connect', 'Horario · Connect')}
            </span>
            <div className="voy-tl__track" style={{ gridRow: 2 }}>
              {rec.schedule.map((s, i) => {
                const box = clip(s.from, s.to);
                if (!box) return null;
                const label = lang === 'es' ? s.labelEs : s.label;
                const d: Detail = {
                  key: `sched-${i}`,
                  title: label,
                  body: tr(`${fmtDayTime(s.from)} to ${fmtDayTime(s.to)}, from the Connect schedule.`, `${fmtDayTime(s.from)} a ${fmtDayTime(s.to)}, según el horario de Connect.`),
                };
                return (
                  <button
                    key={i}
                    type="button"
                    className={`voy-tl__seg voy-tl__seg--${s.kind}`}
                    style={{ left: `${box.left}%`, width: `calc(${box.width}% - 2px)` }}
                    {...bind(d)}
                  >
                    {s.kind === 'underway' && box.width > 14 && <span>{label}</span>}
                  </button>
                );
              })}
            </div>

            {/* Port times */}
            <span className="voy-tl__label" style={{ gridRow: 3 }}>
              {tr('Port times · video', 'Horas de puerto · video')}
            </span>
            <div className="voy-tl__track" style={{ gridRow: 3 }}>
              {callMarks.map((m) =>
                m ? (
                  <span key={m.d.key}>
                    {m.label && (
                      <span className={`voy-tl__call-label voy-tl__call-label--${m.side}${m.c.actual ? '' : ' is-pending'}`} style={{ left: `${m.p}%` }}>
                        {m.label}
                      </span>
                    )}
                    <button type="button" className="voy-tl__hit" style={{ left: `${m.p}%` }} {...bind(m.d)}>
                      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                        {m.c.actual ? (
                          <path d="M7 0 14 7 7 14 0 7z" fill="var(--navy)" />
                        ) : (
                          <path d="M7 1 13 7 7 13 1 7z" fill="#fff" stroke="var(--offline)" strokeWidth="2" />
                        )}
                      </svg>
                    </button>
                  </span>
                ) : null,
              )}
            </div>

            {/* Reefer rounds per barge */}
            {reeferBarges.map((bargeId, bi) => (
              <RoundRow
                key={bargeId}
                row={4 + bi}
                label={tr(`Reefer rounds · ${vesselShort(bargeId)}`, `Rondas de reefers · ${vesselShort(bargeId)}`)}
                rounds={rounds.filter((r) => r.bargeId === bargeId && inWin(r.scheduled))}
                pct={pct}
                slot={slot}
                bind={(r) => bind(roundDetail(r))}
              />
            ))}

            {/* Events */}
            <span className="voy-tl__label" style={{ gridRow: 4 + reeferBarges.length }}>
              {range === 'whole' ? tr('Events per 6 hours', 'Eventos cada 6 horas') : tr('Events per 2 hours', 'Eventos cada 2 horas')}
            </span>
            <div className="voy-tl__track voy-tl__events" style={{ gridRow: 4 + reeferBarges.length }}>
              <span className="voy-tl__baseline" aria-hidden="true" />
              {buckets.map((b) => {
                const center = pct(b.from + bucket / 2);
                const w = (bucket / span) * 100 * 0.53;
                const evs = events.filter((e) => e.at >= b.from && e.at < b.from + bucket);
                const kinds = [...new Set(evs.map((e) => useCaseName(e.useCaseId, lang)))];
                const d: Detail = {
                  key: `ev-${b.from}`,
                  title: tr(
                    `${b.n} event${b.n === 1 ? '' : 's'}, ${fmtDayTime(b.from)} to ${fmtTime(b.from + bucket)}`,
                    `${b.n} evento${b.n === 1 ? '' : 's'}, ${fmtDayTime(b.from)} a ${fmtTime(b.from + bucket)}`,
                  ),
                  body: [
                    kinds.join(', '),
                    b.late
                      ? tr(`${b.late} queued on board, arrived ashore late${reconnectedAt ? ` at ${fmtTime(reconnectedAt)}` : ''}`, `${b.late} en cola a bordo, llegaron tarde a tierra${reconnectedAt ? ` a las ${fmtTime(reconnectedAt)}` : ''}`)
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' · '),
                  link: { to: '?tab=events', label: tr('Open the events list', 'Abrir la lista de eventos') },
                };
                return (
                  <button
                    key={b.from}
                    type="button"
                    className={`voy-tl__bar${b.late ? ' voy-tl__bar--late' : ''}`}
                    style={{ left: `${center}%`, width: `max(${w}%, 8px)` }}
                    {...bind(d)}
                  >
                    <span style={{ height: `${(b.n / Math.max(1, maxBucket)) * 36}px` }} />
                  </button>
                );
              })}
              <span className="voy-tl__max">{tr(`Most in a block: ${maxBucket}`, `Máximo en un bloque: ${maxBucket}`)}</span>
            </div>

            {/* Alarms */}
            <span className="voy-tl__label" style={{ gridRow: 5 + reeferBarges.length }}>
              {tr('Alarms', 'Alarmas')}
            </span>
            <div className="voy-tl__track" style={{ gridRow: 5 + reeferBarges.length }}>
              {clusters.map((c) => {
                const first = c[0];
                const last = c[c.length - 1];
                const top = c.reduce((p, a) => (a.priority < p ? a.priority : p), 'P4' as Priority);
                if (c.length === 1) {
                  const d: Detail = {
                    key: `alm-${first.id}`,
                    title: `${first.priority} · ${first.title}`,
                    body: tr(
                      `${first.id} · raised ${fmtDayTime(first.at)} · ${first.open ? 'open' : 'closed'}`,
                      `${first.id} · generada ${fmtDayTime(first.at)} · ${first.open ? 'abierta' : 'cerrada'}`,
                    ),
                    link: first.linkable ? { to: `/alarms/${first.id}`, label: tr('Open alarm', 'Abrir alarma') } : undefined,
                  };
                  return (
                    <button key={first.id} type="button" className="voy-tl__hit voy-tl__hit--tri" style={{ left: `${pct(first.at)}%` }} {...bind(d)}>
                      <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
                        <path d="M7 11.2 0.8 0.8h12.4z" className={`voy-tri voy-tri--${first.priority.toLowerCase()}`} strokeWidth="1.2" strokeLinejoin="round" />
                      </svg>
                    </button>
                  );
                }
                const left = pct(first.at);
                const width = Math.max(pct(last.at) - left, 0.8);
                const openTop = c.filter((a) => a.open).reduce((p, a) => (a.priority < p ? a.priority : p), 'P9' as string);
                const openTopCount = c.filter((a) => a.open && a.priority === openTop).length;
                const text = tr(
                  `${c.length} ${dayWord(first.at, now, tr)}, ${fmtTime(first.at)} to ${fmtTime(last.at)}${openTopCount ? ` · ${openTopCount} ${openTop} open` : ''}`,
                  `${c.length} ${dayWord(first.at, now, tr)}, ${fmtTime(first.at)} a ${fmtTime(last.at)}${openTopCount ? ` · ${openTopCount} ${openTop} ${openTopCount === 1 ? 'abierta' : 'abiertas'}` : ''}`,
                );
                const d: Detail = {
                  key: `grp-${first.id}`,
                  title: text,
                  body: c.map((a) => `${fmtTime(a.at)} ${a.priority} ${a.title}`).join(' · '),
                  link: { to: '?tab=alarms', label: tr('Alarms on this voyage', 'Alarmas de este viaje') },
                };
                const isLabelled = c === labelledCluster;
                const labelLeft = left + width > 70;
                return (
                  <span key={first.id}>
                    <button
                      type="button"
                      className={`voy-tl__group voy-tl__group--${top.toLowerCase()}`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      {...bind(d)}
                    >
                      <span />
                    </button>
                    {isLabelled && (
                      <Link
                        to="?tab=alarms"
                        className={`voy-tl__group-link${top <= 'P2' ? '' : ' voy-tl__group-link--p3'}`}
                        style={labelLeft ? { left: `${left}%`, transform: 'translateX(calc(-100% - 8px))' } : { left: `calc(${left + width}% + 8px)` }}
                      >
                        {text}
                      </Link>
                    )}
                  </span>
                );
              })}
            </div>

            {/* Link to shore */}
            <span className="voy-tl__label" style={{ gridRow: lastRow }}>
              {tr('Link to shore', 'Enlace con tierra')}
            </span>
            <div className="voy-tl__track voy-tl__link-row" style={{ gridRow: lastRow }}>
              {linkSegs.map((s, i) => {
                const box = clip(s.from, s.end);
                if (!box) return null;
                const back = s.state !== 'none' && reconnectedAt !== undefined && Math.abs(s.from - reconnectedAt) < 60_000;
                const d: Detail = {
                  key: `link-${i}`,
                  title: tr(...LINK_TEXT[s.state]),
                  body: [
                    tr(`${fmtDayTime(s.from)} to ${s.to ? fmtDayTime(s.to) : 'now'}`, `${fmtDayTime(s.from)} a ${s.to ? fmtDayTime(s.to) : 'ahora'}`),
                    back ? tr('Back in coverage: the queued events arrived with their original times.', 'De nuevo con cobertura: los eventos en cola llegaron con su hora original.') : '',
                  ]
                    .filter(Boolean)
                    .join(' · '),
                };
                return (
                  <button
                    key={i}
                    type="button"
                    className={`voy-tl__link voy-tl__link--${s.state}`}
                    style={{ left: `${box.left}%`, width: `calc(${box.width}% - 2px)` }}
                    {...bind(d)}
                  >
                    <span />
                  </button>
                );
              })}
            </div>

            {/* Now marker */}
            {nowVisible && (
              <>
                <div aria-hidden="true" className="voy-tl__now-line" style={{ gridRow: `2 / span ${lastRow - 1}` }}>
                  <span style={{ left: `${pct(now)}%` }} />
                </div>
                <span style={{ gridColumn: 1, gridRow: lastRow + 1 }} />
                <div className="voy-tl__track" style={{ gridRow: lastRow + 1 }}>
                  <span className="voy-tl__now" style={{ left: `${pct(now)}%` }}>
                    {tr('Now', 'Ahora')} · {fmtTime(now)}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="voy-tl__detail" aria-live="polite">
          {detail ? (
            <>
              <strong>{detail.title}</strong>
              <span>{detail.body}</span>
              {detail.link && (
                <Link to={detail.link.to} className="voy-tl__detail-link">
                  {detail.link.label}
                </Link>
              )}
              {pinned && (
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPinned(null)}>
                  {tr('Clear', 'Quitar')}
                </button>
              )}
            </>
          ) : (
            <span className="voy-tl__detail-hint">
              {tr('Point at, tab to or tap a marker to see its details here.', 'Señale, recorra con Tab o toque un marcador para ver aquí su detalle.')}
            </span>
          )}
        </div>

        <Legend />
        <p className="voy-note">
          {tr(
            `A round counts as on time when someone is seen in the reefer row within ${TOLERANCE_MIN} minutes of the Connect schedule. The tolerance is set with GFSA.`,
            `Una ronda cuenta como a tiempo cuando se ve a alguien en la fila de reefers dentro de ${TOLERANCE_MIN} minutos del horario de Connect. La tolerancia se acuerda con GFSA.`,
          )}
        </p>
      </div>
    </section>
  );
}

function RoundRow({
  row,
  label,
  rounds,
  pct,
  slot,
  bind,
}: {
  row: number;
  label: string;
  rounds: Round[];
  pct: (t: number) => number;
  slot: number;
  bind: (r: Round) => Record<string, unknown>;
}) {
  return (
    <>
      <span className="voy-tl__label" style={{ gridRow: row }}>
        {label}
      </span>
      <div className="voy-tl__track" style={{ gridRow: row }}>
        {rounds.map((r) => (
          <button
            key={r.key}
            type="button"
            className="voy-tl__hit voy-tl__hit--round"
            style={{ left: `${pct(r.scheduled)}%`, width: `min(${slot}%, 44px)` }}
            {...bind(r)}
          >
            <RoundMark result={r.result} />
          </button>
        ))}
      </div>
    </>
  );
}

export function RoundMark({ result, size }: { result: RoundResult; size?: number }) {
  if (result === 'late')
    return (
      <svg width={size ?? 14} height={size ?? 14} viewBox="0 0 14 14" aria-hidden="true">
        <path d="M7 0 14 7 7 14 0 7z" fill="var(--warn)" />
      </svg>
    );
  if (result === 'missed')
    return (
      <svg width={size ?? 14} height={size ?? 14} viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r="6" fill="var(--voy-missed)" />
        <path d="M4.5 4.5l5 5M9.5 4.5l-5 5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  return <span aria-hidden="true" className={`voy-mark voy-mark--${result}`} />;
}

function Legend() {
  const tr = useTr();
  return (
    <div className="voy-legend" role="group" aria-label={tr('Legend', 'Leyenda')}>
      <span>
        <RoundMark result="on_time" /> {tr('Round on time', 'Ronda a tiempo')}
      </span>
      <span>
        <RoundMark result="late" size={12} /> {tr('Late', 'Tarde')}
      </span>
      <span>
        <RoundMark result="missed" size={12} /> {tr('Missed', 'Perdida')}
      </span>
      <span>
        <RoundMark result="overdue" /> {tr('Overdue', 'Vencida')}
      </span>
      <span>
        <RoundMark result="due" /> {tr('Due', 'Pendiente')}
      </span>
      <span>
        <span className="voy-legend__bar" /> {tr('Events', 'Eventos')}
      </span>
      <span>
        <span className="voy-legend__bar voy-legend__bar--late" /> {tr('Arrived late', 'Llegaron tarde')}
      </span>
      <span>
        <svg width="12" height="10" viewBox="0 0 14 12" aria-hidden="true">
          <path d="M7 11.2 0.8 0.8h12.4z" className="voy-tri voy-tri--p3" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
        {tr('P3 alarm', 'Alarma P3')}
      </span>
      <span>
        <span className="voy-legend__group" /> {tr('Alarm group with a P2', 'Grupo de alarmas con una P2')}
      </span>
      <span>
        <span className="voy-legend__link voy-legend__link--strong" /> {tr('Link strong', 'Enlace fuerte')}
      </span>
      <span>
        <span className="voy-legend__link voy-legend__link--weak" /> {tr('Weak', 'Débil')}
      </span>
      <span>
        <span className="voy-legend__link voy-legend__link--none" /> {tr('None, events queued on board', 'Sin enlace, eventos en cola a bordo')}
      </span>
    </div>
  );
}
