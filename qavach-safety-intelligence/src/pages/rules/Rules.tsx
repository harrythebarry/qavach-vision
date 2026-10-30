import { Link, useNavigate } from 'react-router';
import { Icon } from '../../components/Icon';
import { ReadOnlyNote } from '../../components/Shell';
import { PriorityBadge, Switch } from '../../components/ui';
import { describeRule, SCHEDULE_LABEL } from '../../lib/qai';
import { AREAS_BY_ID, isAdmin, saveRule, toast, useAlerts, useCameras, useMe, useRules } from '../../state/store';
import './rules.css';

export function Rules() {
  const rules = useRules();
  const cams = useCameras();
  const alerts = useAlerts();
  const me = useMe();
  const nav = useNavigate();
  const admin = isAdmin(me);
  const live = rules.filter((r) => r.mode === 'live').length;
  const dayAgo = Date.now() - 86400000;

  return (
    <div className="page">
      <div className="page__head">
        <div className="page__title">
          <span className="page__eyebrow">Set up · step 3</span>
          <h1>Rules</h1>
          <span className="page__sub">
            {rules.length} rules · {live} live · {rules.length - live} in test. A rule picks cameras and zones, says what to look for and for how long, and sets the alert level.
          </span>
        </div>
        <div className="page__actions">
          {admin && (
            <Link to="/rules/new" className="btn">
              <Icon name="plus" size={17} />
              New rule
            </Link>
          )}
        </div>
      </div>
      <ReadOnlyNote>Only the safety admin creates and changes rules.</ReadOnlyNote>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Rule</th>
              <th>Cameras</th>
              <th>Level</th>
              <th>Qavach record</th>
              <th>Alerts, 24 h</th>
              <th>Live</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => {
              const rc = cams.filter((c) => r.cameraIds.includes(c.id));
              const zoneNames = [...new Set(rc.flatMap((c) => c.zones.filter((z) => r.zoneIds.includes(z.id)).map((z) => z.name)))];
              const areas = [...new Set(rc.map((c) => AREAS_BY_ID[c.areaId]?.name.split(' ·')[0]))];
              const n = alerts.filter((a) => a.ruleId === r.id && a.at > dayAgo).length;
              return (
                <tr key={r.id} className="is-clickable" onClick={() => nav(`/rules/${r.id}`)}>
                  <td style={{ maxWidth: 420 }}>
                    <div className="row" style={{ gap: 6 }}>
                      <span className="mono faint">{r.id}</span>
                      <strong>{r.name}</strong>
                      {r.plainText && (
                        <span className="chip chip--ai" title={`Drafted from: “${r.plainText}”`}>
                          <Icon name="spark" size={12} />
                          From plain words
                        </span>
                      )}
                    </div>
                    <div className="meta">
                      {describeRule(r, zoneNames)}
                      {r.schedule !== 'always' && ` · ${SCHEDULE_LABEL[r.schedule]}`}
                    </div>
                  </td>
                  <td>
                    {rc.length}
                    <div className="meta">{areas.join(', ')}</div>
                  </td>
                  <td>
                    <PriorityBadge p={r.priority} />
                  </td>
                  <td>{r.qavach === 'none' ? <span className="muted">None</span> : `${r.qavach} · ${r.classification.toLowerCase()}`}</td>
                  <td>{r.mode === 'test' ? <span className="muted">{n} logged</span> : n}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <Switch
                      checked={r.mode === 'live'}
                      disabled={!admin}
                      onChange={(v) => {
                        saveRule({ ...r, mode: v ? 'live' : 'test', updatedAt: Date.now(), updatedBy: me.id });
                        toast(v ? `${r.id} is live: matches now raise alerts` : `${r.id} is in test: matches are logged, no one is told`);
                      }}
                      label={<span className="meta">{r.mode === 'live' ? 'Live' : 'Test'}</span>}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
