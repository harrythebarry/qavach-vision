import { Link } from 'react-router';
import { Icon, type IconName } from '../components/Icon';
import { PriorityBadge, StateChip } from '../components/ui';
import { AREAS, SITE } from '../data/seed';
import { ago, duration, useNow } from '../lib/time';
import { isOpen, useActivity, useAlerts, useCameras, useMe, usePolicies, useRules, useWalls, userName } from '../state/store';
import { Onboarding } from './Onboarding';
import './overview.css';

export function Overview() {
  const me = useMe();
  const cams = useCameras();
  const rules = useRules();
  const walls = useWalls();
  const alerts = useAlerts();
  const policies = usePolicies();
  const activity = useActivity();
  const now = useNow(5000);

  const open = alerts.filter(isOpen);
  const camById = new Map(cams.map((c) => [c.id, c]));
  const today = alerts.filter((a) => now - a.at < 86400000);
  const acked = today.filter((a) => a.ackAt);
  const inTime = acked.filter((a) => {
    const p = policies.find((x) => x.priority === a.priority);
    return p && a.ackAt! - a.at <= p.ackWithinMin * 60000;
  });
  const median = acked.length ? acked.map((a) => a.ackAt! - a.at).sort((x, y) => x - y)[Math.floor(acked.length / 2)] : 0;
  const records = alerts.filter((a) => a.qavach).sort((a, b) => b.qavach!.at - a.qavach!.at);
  const online = cams.filter((c) => c.status === 'online').length;
  const byArea = AREAS.map((a) => ({ a, n: today.filter((x) => camById.get(x.cameraId)?.areaId === a.id).length, busy: cams.filter((c) => c.areaId === a.id).reduce((s, c) => s + (activity[c.id] ?? 0), 0) }));
  const maxN = Math.max(1, ...byArea.map((x) => x.n));
  const maxBusy = Math.max(1, ...byArea.map((x) => x.busy));
  const hour = new Date(now).getHours();

  const flow: { icon: IconName; title: string; text: string; stat: string; to: string }[] = [
    { icon: 'camera', title: 'Cameras and zones', text: 'Add each camera, then draw its zones by hand: walkways, edges, exclusion areas.', stat: `${cams.length} cameras · ${cams.filter((c) => c.zones.length).length} with zones`, to: '/cameras' },
    { icon: 'rule', title: 'Rules', text: 'Pick cameras and zones, say what to look for and for how long, set the alert level. Type it in plain words if you like.', stat: `${rules.filter((r) => r.mode === 'live').length} live · ${rules.filter((r) => r.mode === 'test').length} in test`, to: '/rules' },
    { icon: 'wall', title: 'Video wall', text: 'Each team watches its own wall: high-operational areas pinned, the rest rolling. Alerts take over a tile.', stat: `${walls.length} walls`, to: '/wall' },
    { icon: 'mobile', title: 'Alert and acknowledge', text: 'The right people are told by priority. Not acknowledged in time? It escalates.', stat: `${open.length} open now`, to: '/alerts' },
    { icon: 'shield', title: 'Qavach record', text: 'On acknowledgement, QAI drafts the incident or observation. A person confirms it.', stat: `${records.length} sent to Qavach`, to: '/alerts' },
  ];

  return (
    <div className="page">
      <div className="page__head">
        <div className="page__title">
          <span className="page__eyebrow">
            {SITE.name} · {cams.length} cameras · {AREAS.length} areas
          </span>
          <h1>
            Good {hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}, {me.name.split(' ')[0]}
          </h1>
          <span className="page__sub">CCTV safety monitoring for the terminal. Detections become alerts, alerts become Qavach records.</span>
        </div>
        <div className="page__actions">
          <Link to="/alerts" className="btn btn--secondary">
            <Icon name="bell" size={16} />
            Alerts
          </Link>
          <Link to="/wall" className="btn">
            <Icon name="wall" size={16} />
            Open the video wall
          </Link>
        </div>
      </div>

      <ol className="flowcards" aria-label="How it works">
        {flow.map((f, i) => (
          <li key={f.title}>
            <Link to={f.to} className="flowcard">
              <span className="flowcard__n">{i + 1}</span>
              <Icon name={f.icon} size={22} />
              <strong>{f.title}</strong>
              <span className="meta">{f.text}</span>
              <span className="flowcard__stat">{f.stat}</span>
            </Link>
          </li>
        ))}
      </ol>

      <div className="grid-4" style={{ margin: '16px 0' }}>
        <div className="card kpi">
          <span className="kpi__label">Open alerts</span>
          <span className="kpi__value">
            {open.length}
            <small>
              {(['P1', 'P2', 'P3', 'P4'] as const)
                .map((p) => [p, open.filter((a) => a.priority === p).length] as const)
                .filter(([, n]) => n)
                .map(([p, n]) => `${n} ${p}`)
                .join(' · ') || 'all clear'}
            </small>
          </span>
          <span className="kpi__foot">{open.filter((a) => a.state === 'escalated').length} escalated</span>
        </div>
        <div className="card kpi">
          <span className="kpi__label">Acknowledged in time, 24 h</span>
          <span className="kpi__value">{acked.length ? Math.round((inTime.length / acked.length) * 100) : 100}%</span>
          <span className="kpi__foot">
            {inTime.length} of {acked.length} within their level's time
          </span>
        </div>
        <div className="card kpi">
          <span className="kpi__label">Median time to acknowledge</span>
          <span className="kpi__value">{median ? duration(median) : '–'}</span>
          <span className="kpi__foot">{acked.filter((a) => a.ackVia === 'mobile').length} acknowledged on the phone</span>
        </div>
        <div className="card kpi">
          <span className="kpi__label">Cameras online</span>
          <span className="kpi__value">
            {online}
            <small>of {cams.length}</small>
          </span>
          <span className="kpi__foot">
            <Link to="/cameras">{cams.length - online} offline or degraded</Link>
          </span>
        </div>
      </div>

      <div className="ovgrid">
        <div className="stack" style={{ gap: 16 }}>
          <section className="card">
            <div className="card__head">
              <h2>Needs attention</h2>
              <span className="spacer" />
              <Link to="/alerts" className="meta">
                All alerts
              </Link>
            </div>
            {open.length === 0 && <p className="card__body meta">No open alerts.</p>}
            <ul className="ovlist">
              {open.slice(0, 6).map((a) => {
                const cam = camById.get(a.cameraId);
                return (
                  <li key={a.id}>
                    <Link to={`/alerts/${a.id}`} className="ovlist__item">
                      <PriorityBadge p={a.priority} short />
                      <span className="stack" style={{ gap: 1, minWidth: 0, flex: 1 }}>
                        <strong className="ellipsis">{a.title}</strong>
                        <span className="meta ellipsis">
                          {cam?.id} {cam?.name} · {ago(a.at, now)}
                        </span>
                      </span>
                      <StateChip state={a.state} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
          <section className="card">
            <div className="card__head">
              <h2>Sent to Qavach</h2>
              <span className="meta">Incidents, near misses and observations raised from alerts</span>
            </div>
            {records.length === 0 && <p className="card__body meta">None yet.</p>}
            <ul className="ovlist">
              {records.slice(0, 5).map((a) => (
                <li key={a.id}>
                  <Link to={`/alerts/${a.id}`} className="ovlist__item">
                    <span className="qrec__badge">
                      <Icon name="shield" size={14} />
                      {a.qavach!.type}
                    </span>
                    <span className="stack" style={{ gap: 1, minWidth: 0, flex: 1 }}>
                      <strong className="ellipsis">
                        <span className="mono">{a.qavach!.ref}</span> · {a.qavach!.title}
                      </strong>
                      <span className="meta ellipsis">
                        {a.qavach!.severity} · {a.qavach!.classification} · {a.qavach!.source === 'mobile' ? 'from the phone' : a.qavach!.source === 'auto' ? 'on acknowledgement' : 'from the console'} by {userName(a.qavach!.createdBy)} · {ago(a.qavach!.at, now)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <div className="stack" style={{ gap: 16 }}>
          <section className="card card--pad">
            <h2 style={{ marginBottom: 10 }}>Alerts by area, 24 h</h2>
            {byArea.map(({ a, n }) => (
              <div key={a.id} className="bar-row">
                <span className="ellipsis">{a.name.split(' ·')[0]}</span>
                <span className="bar-row__track">
                  <span className="bar-row__fill" style={{ width: `${(n / maxN) * 100}%` }} />
                </span>
                <span className="mono">{n}</span>
              </div>
            ))}
          </section>
          <section className="card card--pad">
            <h2 style={{ marginBottom: 4 }}>Activity right now</h2>
            <p className="meta" style={{ marginBottom: 10 }}>
              People and vehicles in view. Walls can auto-pin the busiest camera.
            </p>
            {byArea
              .slice()
              .sort((x, y) => y.busy - x.busy)
              .map(({ a, busy }) => (
                <div key={a.id} className="bar-row">
                  <span className="ellipsis">{a.name.split(' ·')[0]}</span>
                  <span className="bar-row__track">
                    <span className="bar-row__fill bar-row__fill--ai" style={{ width: `${(busy / maxBusy) * 100}%` }} />
                  </span>
                  <span className="mono">{busy}</span>
                </div>
              ))}
          </section>
        </div>
      </div>

      <section style={{ marginTop: 20 }}>
        <h2 style={{ marginBottom: 10 }}>Set-up</h2>
        <Onboarding />
      </section>
    </div>
  );
}
