import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { AckDialog, EscalateDialog, NoteDialog, RaiseDialog } from '../../components/AlertDialogs';
import { Icon } from '../../components/Icon';
import { CameraView, CHANNEL, Empty, PriorityBadge, Seg, StateChip } from '../../components/ui';
import { AREAS } from '../../data/seed';
import type { Alert, Priority } from '../../data/types';
import { describeRule } from '../../lib/qai';
import { ago, dayTime, duration, hms, useNow } from '../../lib/time';
import { AREAS_BY_ID, isOpen, roleText, useAlerts, useCameras, usePolicies, useRules, userName, USERS_BY_ID } from '../../state/store';
import './alerts.css';

type Tab = 'open' | 'acknowledged' | 'closed' | 'all';

const inTab = (a: Alert, t: Tab) =>
  t === 'all' ? true : t === 'open' ? isOpen(a) : t === 'acknowledged' ? a.state === 'acknowledged' : a.state === 'resolved' || a.state === 'false-alarm';

export function Alerts() {
  const { alertId } = useParams();
  const nav = useNavigate();
  const alerts = useAlerts();
  const cams = useCameras();
  const now = useNow(1000);
  const [tab, setTab] = useState<Tab>('all');
  const [prio, setPrio] = useState<Priority | 'all'>('all');
  const [area, setArea] = useState('all');
  const [q, setQ] = useState('');
  const camById = useMemo(() => new Map(cams.map((c) => [c.id, c])), [cams]);

  const filtered = alerts.filter((a) => {
    if (!inTab(a, tab)) return false;
    if (prio !== 'all' && a.priority !== prio) return false;
    const cam = camById.get(a.cameraId);
    if (area !== 'all' && cam?.areaId !== area) return false;
    const t = q.trim().toLowerCase();
    return !t || `${a.id} ${a.title} ${cam?.id} ${cam?.name} ${a.qavach?.ref ?? ''}`.toLowerCase().includes(t);
  });
  const selected = alerts.find((a) => a.id === alertId);
  const counts = { open: alerts.filter(isOpen).length, acknowledged: alerts.filter((a) => a.state === 'acknowledged').length };
  const sentToQavach = alerts.filter((a) => a.qavach).length;
  const acked = alerts.filter((a) => a.ackAt);
  const medianAck = acked.length ? acked.map((a) => a.ackAt! - a.at).sort((x, y) => x - y)[Math.floor(acked.length / 2)] : 0;

  return (
    <div className="page page--wide">
      <div className="page__head">
        <div className="page__title">
          <span className="page__eyebrow">Alerts and notifications</span>
          <h1>Alerts</h1>
          <span className="page__sub">
            {counts.open} open · {counts.acknowledged} acknowledged · median time to acknowledge {medianAck ? duration(medianAck) : '–'} · {sentToQavach} sent to Qavach
          </span>
        </div>
        <div className="page__actions">
          <Link to="/notifications" className="btn btn--secondary">
            <Icon name="route" size={16} />
            Who gets told
          </Link>
        </div>
      </div>

      <div className={`alerts${selected ? ' alerts--detail' : ''}`}>
        <section className="card alerts__list">
          <div className="alerts__filters">
            <Seg
              label="Alert state"
              small
              value={tab}
              onChange={setTab}
              options={[
                { value: 'all', label: 'All' },
                { value: 'open', label: `Open ${counts.open ? `(${counts.open})` : ''}` },
                { value: 'acknowledged', label: 'Acknowledged' },
                { value: 'closed', label: 'Closed' },
              ]}
            />
            <div className="row-wrap">
              {(['all', 'P1', 'P2', 'P3', 'P4'] as const).map((p) => (
                <button key={p} type="button" className="chip chip--outline" aria-pressed={prio === p} onClick={() => setPrio(p)}>
                  {p === 'all' ? 'All levels' : p}
                </button>
              ))}
              <select className="select select--sm" style={{ width: 'auto' }} value={area} onChange={(e) => setArea(e.target.value)} aria-label="Area">
                <option value="all">All areas</option>
                {AREAS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <input className="input input--sm" style={{ flex: '1 1 160px', width: 'auto' }} placeholder="Search alerts" aria-label="Search alerts" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          {filtered.length === 0 ? (
            <Empty icon="shield" title="No alerts here">
              Change the filters to see more.
            </Empty>
          ) : (
            <ul className="alist">
              {filtered.map((a) => {
                const cam = camById.get(a.cameraId);
                return (
                  <li key={a.id}>
                    <button type="button" className={`alist__item${a.id === alertId ? ' is-selected' : ''}${isOpen(a) ? ' is-open' : ''}`} onClick={() => nav(`/alerts/${a.id}`)}>
                      <PriorityBadge p={a.priority} short />
                      <span className="alist__main">
                        <span className="alist__title">{a.title}</span>
                        <span className="meta ellipsis">
                          <span className="mono">{a.id}</span> · {cam?.id} {cam?.name} · {AREAS_BY_ID[cam?.areaId ?? '']?.name}
                        </span>
                      </span>
                      <span className="alist__side">
                        <StateChip state={a.state} />
                        {a.qavach && <span className="chip chip--outline mono">{a.qavach.ref}</span>}
                        <span className="meta">{ago(a.at, now)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        {selected ? (
          <AlertDetail alert={selected} onClose={() => nav('/alerts')} />
        ) : (
          <section className="card alerts__hint">
            <Empty icon="bell" title="Pick an alert">
              See the snapshot, the rule that fired, who was told and how, and raise it in Qavach.
            </Empty>
          </section>
        )}
      </div>
    </div>
  );
}

function AlertDetail({ alert, onClose }: { alert: Alert; onClose: () => void }) {
  const cams = useCameras();
  const rules = useRules();
  const policies = usePolicies();
  const now = useNow(1000);
  const [dialog, setDialog] = useState<'ack' | 'raise' | 'resolve' | 'false' | 'escalate'>();
  const [live, setLive] = useState(false);
  const cam = cams.find((c) => c.id === alert.cameraId);
  const rule = rules.find((r) => r.id === alert.ruleId);
  const policy = policies.find((p) => p.priority === alert.priority);
  if (!cam) return null;
  const zoneNames = cam.zones.filter((z) => rule?.zoneIds.includes(z.id)).map((z) => z.name);
  const open = isOpen(alert);
  const dueAt = policy ? alert.at + policy.ackWithinMin * 60000 : 0;

  return (
    <section className="card adetail" aria-label={`Alert ${alert.id}`}>
      <div className="adetail__head">
        <PriorityBadge p={alert.priority} />
        <span className="mono">{alert.id}</span>
        <StateChip state={alert.state} />
        <span className="spacer" />
        <a href={`#/m/${alert.id}`} target="_blank" rel="noopener" className="btn btn--ghost btn--sm" title="What the supervisor sees on the phone">
          <Icon name="mobile" size={15} />
          Phone view
        </a>
        <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={onClose} aria-label="Close">
          <Icon name="close" size={17} />
        </button>
      </div>
      <div className="adetail__body">
        <h2 className="adetail__title">{alert.title}</h2>
        <p className="muted">
          {alert.detail} · {Math.round(alert.confidence * 100)}% confidence · {dayTime(alert.at)}
        </p>

        {open && policy && (
          <div className={`adetail__due${alert.state === 'escalated' ? ' is-late' : ''}`}>
            <Icon name="clock" size={17} />
            {alert.state === 'escalated' ? (
              <span>
                Not acknowledged in {policy.ackWithinMin} min · escalated to <strong>{userName(alert.escalatedTo)}</strong>
              </span>
            ) : policy.escalateTo === 'none' ? (
              <span>Open for {duration(now - alert.at)} · {policy.priority} alerts are not escalated</span>
            ) : (
              <span>
                Acknowledge within {policy.ackWithinMin} min · escalates to the {roleText(policy.escalateTo)} in <strong className="mono">{duration(Math.max(0, dueAt - now))}</strong>
              </span>
            )}
          </div>
        )}

        <div className="adetail__media">
          <CameraView cam={cam} still={!live} alert={live ? undefined : alert} zones={cam.zones} highlightZones={alert.zoneId ? [alert.zoneId] : undefined} showZoneLabels now={live ? now : undefined} />
          <div className="row-wrap">
            <Seg
              label="Picture"
              small
              value={live ? 'live' : 'snap'}
              onChange={(v) => setLive(v === 'live')}
              options={[
                { value: 'snap', label: `Snapshot · ${hms(alert.at)}` },
                { value: 'live', label: 'Live now' },
              ]}
            />
            <span className="meta">
              {cam.id} {cam.name} · {AREAS_BY_ID[cam.areaId]?.name}
            </span>
          </div>
        </div>

        <div className="adetail__actions">
          {open && (
            <button type="button" className="btn" onClick={() => setDialog('ack')}>
              <Icon name="check" size={16} />
              Acknowledge
            </button>
          )}
          {!alert.qavach && alert.state !== 'false-alarm' && (
            <button type="button" className="btn btn--ai-soft" onClick={() => setDialog('raise')}>
              <Icon name="spark" size={16} />
              Raise in Qavach
            </button>
          )}
          {open && (
            <button type="button" className="btn btn--secondary" onClick={() => setDialog('escalate')}>
              <Icon name="arrow-right" size={16} />
              Escalate
            </button>
          )}
          {alert.state === 'acknowledged' && (
            <button type="button" className="btn btn--secondary" onClick={() => setDialog('resolve')}>
              Resolve
            </button>
          )}
          {alert.state !== 'resolved' && alert.state !== 'false-alarm' && (
            <button type="button" className="btn btn--ghost" onClick={() => setDialog('false')}>
              False alarm
            </button>
          )}
        </div>

        {alert.qavach && (
          <div className="qrec">
            <div className="qrec__head">
              <span className="qrec__badge">
                <Icon name="shield" size={15} />
                Qavach
              </span>
              <strong>
                {alert.qavach.type} <span className="mono">{alert.qavach.ref}</span>
              </strong>
              <span className="chip">{alert.qavach.severity}</span>
              <span className="chip">{alert.qavach.classification}</span>
              <span className="spacer" />
              <span className="meta">
                {alert.qavach.source === 'auto' ? 'Raised on acknowledgement (policy)' : alert.qavach.source === 'mobile' ? 'Raised from the phone' : 'Raised from the console'} by {userName(alert.qavach.createdBy)} · {ago(alert.qavach.at, now)}
              </span>
            </div>
            <strong>{alert.qavach.title}</strong>
            <p>{alert.qavach.description}</p>
            <p className="meta">Immediate action: {alert.qavach.immediateAction}</p>
            <p className="meta">In Qavach: Incidents and Learning · {alert.qavach.type === 'Incident' ? 'Incident register' : alert.qavach.type === 'Near miss' ? 'Near-miss register' : 'Observations'} · snapshot and 20 s clip attached</p>
          </div>
        )}

        <div className="grid-2 adetail__cols">
          <div className="stack">
            <h3>Rule that fired</h3>
            {rule ? (
              <Link to={`/rules/${rule.id}`} className="rulecard">
                <span className="mono">{rule.id}</span>
                <strong>{rule.name}</strong>
                <span className="meta">{describeRule(rule, zoneNames)}</span>
                <span className="meta">
                  {rule.cameraIds.length} cameras · {rule.mode === 'live' ? 'Live' : 'Test'} · creates {rule.qavach === 'none' ? 'no Qavach record' : `a Qavach ${rule.qavach.toLowerCase()}`}
                </span>
              </Link>
            ) : (
              <span className="meta">The rule has been deleted.</span>
            )}
            <h3>Activity</h3>
            <ol className="timeline">
              {[...alert.activity].reverse().map((e, i) => (
                <li key={i}>
                  <span className="mono meta">{hms(e.at)}</span>
                  <span>
                    {e.text}
                    {e.actor !== 'system' && <span className="meta"> · {userName(e.actor)}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div className="stack">
            <h3>Who was told ({alert.deliveries.length})</h3>
            <table className="table table--compact">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Person</th>
                  <th>Channel</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {alert.deliveries.map((d, i) => (
                  <tr key={i}>
                    <td className="mono">{hms(d.at)}</td>
                    <td>
                      {userName(d.to)}
                      <div className="meta">
                        {USERS_BY_ID[d.to]?.role}
                        {d.reason !== 'alert' && ` · ${d.reason}`}
                      </div>
                    </td>
                    <td>
                      <span className="row" style={{ gap: 5 }}>
                        <Icon name={CHANNEL[d.channel].icon} size={15} />
                        {CHANNEL[d.channel].label}
                      </span>
                    </td>
                    <td>
                      <span className={`chip ${d.status === 'read' ? 'chip--good' : d.status === 'failed' ? 'chip--danger' : ''}`}>{d.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {dialog === 'ack' && <AckDialog alert={alert} via="console" onClose={() => setDialog(undefined)} />}
      {dialog === 'raise' && <RaiseDialog alert={alert} onClose={() => setDialog(undefined)} />}
      {dialog === 'escalate' && <EscalateDialog alert={alert} onClose={() => setDialog(undefined)} />}
      {(dialog === 'resolve' || dialog === 'false') && <NoteDialog alert={alert} kind={dialog} onClose={() => setDialog(undefined)} />}
    </section>
  );
}

