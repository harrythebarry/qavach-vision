import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Badge, Segmented } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useLang, useTr } from '../../lib/i18n';
import { fmtDayTime, fmtTime } from '../../lib/time';
import { OUTBOX_KIND, lastRead, lastWrite, sentFor, type OutboxKind, type OutboxRow } from './connect';
import {
  HOUR,
  ROUND_EVERY_H,
  SYNC_EVERY_MIN,
  callLabel,
  fmtDelta,
  fmtRoundTime,
  nextCallText,
  routeText,
  syncAfter,
  vesselName,
  type LiveVoyage,
  type Round,
  type VoyageRecord,
} from './voyageData';

// "Open in Connect": Connect has no address the console can link to, so this
// drawer shows what Connect holds for the voyage, read on the last sync, and
// the outbox of everything this app wrote back to it.

type OutFilter = 'all' | OutboxKind;

export function ConnectDrawer({
  rec,
  live,
  rounds,
  outbox,
  cargoSent,
  callSent,
  now,
  onClose,
}: {
  rec: VoyageRecord;
  live: LiveVoyage;
  rounds: Round[];
  outbox: OutboxRow[];
  cargoSent: Record<string, number | undefined>;
  callSent: Record<string, number | undefined>;
  now: number;
  onClose: () => void;
}) {
  const tr = useTr();
  const lang = useLang();
  const ref = useRef<HTMLElement>(null);
  const [filter, setFilter] = useState<OutFilter>('all');
  const [showAll, setShowAll] = useState(false);
  const v = rec.voyage;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  const read = lastRead(now);
  const write = lastWrite(outbox);
  const pending = outbox.filter((r) => r.pending);
  const pendingEvents = pending.reduce((n, r) => n + (r.count ?? 0), 0);
  const shown = outbox.filter((r) => filter === 'all' || r.kind === filter);
  const visible = showAll ? shown : shown.slice(0, 12);
  const kinds: OutboxKind[] = ['events', 'port_times', 'cargo', 'round', 'report'];
  const count = (k: OutboxKind) => outbox.filter((r) => r.kind === k).length;

  return (
    <div className="voy-drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cx-title"
        className="voy-drawer"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="voy-drawer__head">
          <div>
            <h2 id="cx-title">{tr('In Connect', 'En Connect')}</h2>
            <span>
              <span className="mono">{v.id}</span> · {routeText(v.route, tr)}
            </span>
          </div>
          <button type="button" className="btn btn--ghost btn--icon" aria-label={tr('Close Connect panel', 'Cerrar panel de Connect')} onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <section className="voy-drawer__sec" aria-labelledby="cx-sync">
          <h3 id="cx-sync">{tr('Last sync', 'Última sincronización')}</h3>
          <div className="voy-drawer__sync">
            <div>
              <span className="voy-eyebrow">
                <Icon name="download" size={13} strokeWidth={2.2} /> {tr('In from Connect', 'Desde Connect')}
              </span>
              <strong>{fmtTime(read)}</strong>
              <span>
                {tr(
                  `Voyage, make-up, schedule, cargo lists and round times · every ${SYNC_EVERY_MIN} min`,
                  `Viaje, composición, horario, listas de carga y horas de ronda · cada ${SYNC_EVERY_MIN} min`,
                )}
              </span>
            </div>
            <div>
              <span className="voy-eyebrow">
                <Icon name="upload" size={13} strokeWidth={2.2} /> {tr('Out to Connect', 'Hacia Connect')}
              </span>
              <strong>{write ? fmtDayTime(write.at) : '—'}</strong>
              <span>{write ? `${tr(...OUTBOX_KIND[write.kind])} · ${write.what}` : tr('Nothing sent yet', 'Nada enviado todavía')}</span>
              {pendingEvents > 0 && (
                <span className="voy-drawer__pending">
                  {tr(
                    `${pendingEvents} event${pendingEvents === 1 ? '' : 's'} go${pendingEvents === 1 ? 'es' : ''} at the next sync, ${fmtTime(syncAfter(now))}`,
                    `${pendingEvents} evento${pendingEvents === 1 ? '' : 's'} sale${pendingEvents === 1 ? '' : 'n'} en la próxima sincronización, ${fmtTime(syncAfter(now))}`,
                  )}
                </span>
              )}
              {live.offline && (
                <span className="voy-drawer__pending">
                  {tr(
                    `${live.queuedEvents} events wait on board since ${fmtTime(live.queuedAfter!)}; they go when the link returns.`,
                    `${live.queuedEvents} eventos esperan a bordo desde las ${fmtTime(live.queuedAfter!)}; salen cuando vuelva el enlace.`,
                  )}
                </span>
              )}
            </div>
          </div>
        </section>

        <section className="voy-drawer__sec" aria-labelledby="cx-makeup">
          <h3 id="cx-makeup">{tr('Convoy make-up', 'Composición del convoy')}</h3>
          <ul className="voy-drawer__list">
            {rec.tug && (
              <li>
                <Icon name="ship" size={15} />
                <span>
                  <strong>{rec.tug.name}</strong> · {tr('tug, pushing', 'remolcador, empuja')}
                </span>
              </li>
            )}
            {rec.barges.map((b) => (
              <li key={b.id}>
                <Icon name="layers" size={15} />
                <span>
                  <strong>{b.name}</strong> · {tr('barge', 'barcaza')}
                  {rec.roundSpecs.some((r) => r.bargeId === b.id) ? tr(', reefer rounds', ', rondas de reefers') : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="voy-drawer__sec" aria-labelledby="cx-sched">
          <h3 id="cx-sched">{tr('Schedule', 'Horario')}</h3>
          <ol className="voy-drawer__sched">
            {rec.schedule.map((s, i) => (
              <li key={i} className={s.from <= now && now < s.to ? 'is-now' : undefined}>
                <span className={`voy-drawer__swatch voy-drawer__swatch--${s.kind}`} aria-hidden="true" />
                <span>
                  {lang === 'es' ? s.labelEs : s.label}
                  <span className="sub">
                    {fmtDayTime(s.from)} – {fmtDayTime(s.to)}
                    {s.from <= now && now < s.to ? ` · ${tr('now', 'ahora')}` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          <div className="table-wrap">
            <table className="voy-mini num">
              <thead>
                <tr>
                  <th scope="col">{tr('Call', 'Escala')}</th>
                  <th scope="col">{tr('Schedule', 'Horario')}</th>
                  <th scope="col">{tr('Actual, from this app', 'Real, desde esta app')}</th>
                </tr>
              </thead>
              <tbody>
                {rec.calls.map((c, i) => {
                  const sent = sentFor(callSent, c);
                  return (
                    <tr key={i}>
                      <td>
                        {c.port}
                        <span className="sub">{callLabel(c, tr)}</span>
                      </td>
                      <td className="voy-nowrap">{fmtDayTime(c.scheduled)}</td>
                      <td className="voy-nowrap">
                        {c.actual && sent ? (
                          <>
                            <strong>{fmtTime(c.actual)}</strong> · {fmtDelta(c.actual - c.scheduled, tr)}
                            <span className="sub">{tr(`Written ${fmtDayTime(sent)}`, `Escrita ${fmtDayTime(sent)}`)}</span>
                          </>
                        ) : (
                          <span className="voy-subtle">{tr('Not yet', 'Todavía no')}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="voy-note">{nextCallText(rec, tr)}</p>
        </section>

        <section className="voy-drawer__sec" aria-labelledby="cx-cargo">
          <h3 id="cx-cargo">{tr('Cargo lists', 'Listas de carga')}</h3>
          {rec.cargo.length === 0 ? (
            <p className="voy-note">{tr('Connect has not sent cargo lists for this voyage.', 'Connect no envió listas de carga para este viaje.')}</p>
          ) : (
            rec.cargo.map((c) => {
              const notSeen = new Set(c.differences.filter((d) => d.kind === 'not_seen').map((d) => d.container));
              const notListed = c.differences.filter((d) => d.kind === 'not_listed');
              return (
                <details key={c.bargeId} className="voy-drawer__cargo">
                  <summary>
                    <span>
                      <strong>{vesselName(c.bargeId)}</strong> · {tr(`${c.list} containers on the list`, `${c.list} contenedores en la lista`)}
                    </span>
                    {c.differences.length ? (
                      <Badge tone="warn">
                        {tr(`${c.differences.length} difference${c.differences.length === 1 ? '' : 's'}`, `${c.differences.length} diferencia${c.differences.length === 1 ? '' : 's'}`)}
                      </Badge>
                    ) : (
                      <span className="voy-ok">
                        <Icon name="check" size={14} strokeWidth={2.4} /> {tr('Match', 'Coincide')}
                      </span>
                    )}
                  </summary>
                  <p className="voy-note">
                    {tr(`Counted ${c.counted} on video at ${c.port}, ${fmtDayTime(c.countedAt)}.`, `Contados ${c.counted} en video en ${c.port}, ${fmtDayTime(c.countedAt)}.`)}{' '}
                    {c.differences.length
                      ? cargoSent[c.bargeId]
                        ? tr(`Differences written ${fmtDayTime(cargoSent[c.bargeId]!)}.`, `Diferencias escritas ${fmtDayTime(cargoSent[c.bargeId]!)}.`)
                        : tr('Differences not sent yet.', 'Diferencias aún no enviadas.')
                      : ''}
                  </p>
                  <ul className="voy-drawer__boxes" aria-label={tr(`Cargo list, ${vesselName(c.bargeId)}`, `Lista de carga, ${vesselName(c.bargeId)}`)}>
                    {c.containers.map((n) => (
                      <li key={n} className={notSeen.has(n) ? 'is-diff' : undefined}>
                        <span className="mono">{n}</span>
                        {notSeen.has(n) && <span className="sub">{tr('not seen', 'no visto')}</span>}
                      </li>
                    ))}
                  </ul>
                  {notListed.length > 0 && (
                    <p className="voy-note">
                      {tr('Seen on deck, not on the list:', 'Visto en cubierta, no está en la lista:')} <span className="mono">{notListed.map((d) => d.container).join(', ')}</span>
                    </p>
                  )}
                </details>
              );
            })
          )}
        </section>

        <section className="voy-drawer__sec" aria-labelledby="cx-rounds">
          <h3 id="cx-rounds">{tr('Reefer round times', 'Horas de ronda de reefers')}</h3>
          {rec.roundSpecs.length === 0 ? (
            <p className="voy-note">{tr('No reefer rounds are scheduled on this voyage.', 'No hay rondas de reefers programadas en este viaje.')}</p>
          ) : (
            <ul className="voy-drawer__list">
              {rec.roundSpecs.map((r) => {
                const next = rounds.find((x) => x.bargeId === r.bargeId && x.scheduled > now);
                const lastRound = r.first + (r.count - 1) * ROUND_EVERY_H * HOUR;
                return (
                  <li key={r.bargeId}>
                    <Icon name="clock" size={15} />
                    <span>
                      <strong>{vesselName(r.bargeId)}</strong> ·{' '}
                      {tr(
                        `every ${ROUND_EVERY_H} h, ${r.count} rounds from ${fmtRoundTime(r.first)} to ${fmtRoundTime(lastRound)}`,
                        `cada ${ROUND_EVERY_H} h, ${r.count} rondas desde ${fmtRoundTime(r.first)} hasta ${fmtRoundTime(lastRound)}`,
                      )}
                      <span className="sub">{next ? tr(`Next ${fmtRoundTime(next.scheduled)}`, `Próxima ${fmtRoundTime(next.scheduled)}`) : tr('No rounds left', 'No quedan rondas')}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="voy-drawer__sec" aria-labelledby="cx-out">
          <h3 id="cx-out">{tr('Sent by this app', 'Enviado por esta app')}</h3>
          <Segmented<OutFilter>
            label={tr('What was sent', 'Qué se envió')}
            value={filter}
            onChange={(f) => {
              setFilter(f);
              setShowAll(false);
            }}
            options={[
              { value: 'all', label: tr(`All ${outbox.length}`, `Todo ${outbox.length}`) },
              ...kinds.filter((k) => count(k)).map((k) => ({ value: k, label: `${tr(...OUTBOX_KIND[k])} ${count(k)}` })),
            ]}
          />
          {visible.length ? (
            <ol className="voy-drawer__out">
              {visible.map((r) => (
                <li key={r.key}>
                  <span className="voy-drawer__out-time num">{fmtDayTime(r.at)}</span>
                  <span>
                    <span className="voy-drawer__out-kind">{tr(...OUTBOX_KIND[r.kind])}</span> {r.what}
                    {r.detail && <span className="sub">{r.detail}</span>}
                    <span className="sub">
                      {r.by}
                      {r.manual ? ` · ${tr('from the voyage record', 'desde el registro del viaje')}` : ''}
                      {' · '}
                      {r.pending ? (
                        <span className="voy-drawer__state voy-drawer__state--wait">{tr(`Goes at ${fmtTime(r.at)}`, `Sale a las ${fmtTime(r.at)}`)}</span>
                      ) : (
                        <span className="voy-drawer__state">
                          {tr('Delivered', 'Entregado')}
                          {r.ref ? ` · ${r.ref}` : ''}
                        </span>
                      )}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="voy-note">{tr('Nothing of this kind was sent.', 'No se envió nada de este tipo.')}</p>
          )}
          {shown.length > visible.length && (
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setShowAll(true)}>
              {tr(`Show all ${shown.length}`, `Mostrar los ${shown.length}`)}
            </button>
          )}
        </section>

        <div className="voy-drawer__foot">
          <Link to="/admin/integrations" className="btn btn--sm" onClick={onClose}>
            <Icon name="plug" size={15} /> {tr('Connect integration and sync log', 'Integración de Connect y registro de sincronización')}
          </Link>
        </div>
      </aside>
    </div>
  );
}
