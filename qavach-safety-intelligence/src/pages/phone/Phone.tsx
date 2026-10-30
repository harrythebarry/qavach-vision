import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Icon, Logo } from '../../components/Icon';
import { CameraView, PRIORITY_NAME, StateChip } from '../../components/ui';
import { USERS } from '../../data/seed';
import type { Alert, Classification, QavachRecordType } from '../../data/types';
import { draftRecord } from '../../lib/qai';
import { ago, duration, hm, useNow } from '../../lib/time';
import { acknowledge, AREAS_BY_ID, isOpen, markFalse, raiseInQavach, roleText, TEAMS_BY_ID, useAlerts, useCameras, usePolicies, useRules, useSession } from '../../state/store';
import './phone.css';

// What a shift supervisor sees on the phone: the alert arrives as a push,
// they open it, acknowledge it, and report it into Qavach from the same page.

const SUPERVISORS = USERS.filter((u) => u.role === 'Shift supervisor');

export function Phone() {
  const { alertId } = useParams();
  const { userId } = useSession();
  const [asId, setAsId] = useState(() => (SUPERVISORS.some((u) => u.id === userId) ? userId : SUPERVISORS[0].id));
  const as = USERS.find((u) => u.id === asId)!;
  useEffect(() => {
    document.title = 'Safety alerts · Qavach';
  }, []);
  return (
    <div className="phonepage">
      <div className="phonepage__side">
        <Logo size={34} />
        <h1>Supervisor's phone</h1>
        <p>This is what a shift supervisor gets on the Qavach app when an alert is sent to them. It stays in step with the console and the wall.</p>
        <label className="field">
          <span className="field__label">Viewing as</span>
          <select className="select" value={asId} onChange={(e) => setAsId(e.target.value)}>
            {SUPERVISORS.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {TEAMS_BY_ID[u.teamId]?.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="phone" role="region" aria-label="Phone">
        <div className="phone__status">
          <span>{hm(Date.now())}</span>
          <span className="spacer" />
          <Icon name="wifi" size={14} />
          <span>5G</span>
        </div>
        {alertId ? <PhoneAlert id={alertId} userId={as.id} /> : <PhoneList userId={as.id} />}
      </div>
    </div>
  );
}

function useMyAlerts(userId: string) {
  const alerts = useAlerts();
  const cams = useCameras();
  const me = USERS.find((u) => u.id === userId)!;
  const areas = TEAMS_BY_ID[me.teamId]?.areaIds ?? [];
  return useMemo(() => {
    const camArea = new Map(cams.map((c) => [c.id, c.areaId]));
    return alerts.filter((a) => a.deliveries.some((d) => d.to === userId) || areas.includes(camArea.get(a.cameraId) ?? ''));
  }, [alerts, cams, userId, areas]);
}

function PhoneList({ userId }: { userId: string }) {
  const list = useMyAlerts(userId);
  const cams = useCameras();
  const now = useNow(5000);
  const [tab, setTab] = useState<'open' | 'all'>('open');
  const shown = list.filter((a) => (tab === 'open' ? isOpen(a) || (a.state === 'acknowledged' && !a.qavach) : true));
  return (
    <>
      <div className="phone__bar">
        <strong>Safety alerts</strong>
        <span className="spacer" />
        <span className="phone__count">{list.filter(isOpen).length} open</span>
      </div>
      <div className="phone__tabs">
        <button type="button" aria-pressed={tab === 'open'} onClick={() => setTab('open')}>
          Needs you
        </button>
        <button type="button" aria-pressed={tab === 'all'} onClick={() => setTab('all')}>
          All
        </button>
      </div>
      <div className="phone__scroll">
        {shown.length === 0 && <p className="phone__empty">Nothing needs you right now.</p>}
        {shown.map((a) => {
          const cam = cams.find((c) => c.id === a.cameraId);
          return (
            <Link key={a.id} to={`/m/${a.id}`} className={`pitem pitem--${a.priority}`}>
              <span className="pitem__bar" />
              <span className="stack" style={{ gap: 2, minWidth: 0, flex: 1 }}>
                <span className="pitem__top">
                  <strong>
                    {a.priority} · {PRIORITY_NAME[a.priority]}
                  </strong>
                  <span className="meta">{ago(a.at, now)}</span>
                </span>
                <span className="pitem__title">{a.title}</span>
                <span className="meta ellipsis">
                  {cam?.name} · {AREAS_BY_ID[cam?.areaId ?? '']?.name}
                </span>
              </span>
              <StateChip state={a.state} />
            </Link>
          );
        })}
      </div>
    </>
  );
}

function PhoneAlert({ id, userId }: { id: string; userId: string }) {
  const alerts = useAlerts();
  const cams = useCameras();
  const rules = useRules();
  const policies = usePolicies();
  const nav = useNavigate();
  const now = useNow(1000);
  const alert = alerts.find((a) => a.id === id);
  const cam = cams.find((c) => c.id === alert?.cameraId);
  const rule = rules.find((r) => r.id === alert?.ruleId);
  const policy = policies.find((p) => p.priority === alert?.priority);
  const [reporting, setReporting] = useState(false);

  if (!alert || !cam)
    return (
      <div className="phone__scroll">
        <p className="phone__empty">
          Alert not found. <Link to="/m">Back</Link>
        </p>
      </div>
    );

  const open = isOpen(alert);
  const due = policy ? alert.at + policy.ackWithinMin * 60000 - now : 0;

  return (
    <>
      <div className="phone__bar">
        <button type="button" className="phone__back" onClick={() => nav('/m')} aria-label="Back to alerts">
          <Icon name="chevron-left" size={22} />
        </button>
        <strong>{alert.id}</strong>
        <span className="spacer" />
        <StateChip state={alert.state} />
      </div>
      <div className="phone__scroll">
        <div className={`pbanner pbanner--${alert.priority}`}>
          <span className="pbanner__p">
            {alert.priority} · {PRIORITY_NAME[alert.priority]}
          </span>
          <strong>{alert.title}</strong>
          <span>
            {cam.name} · {ago(alert.at, now)}
          </span>
          {open && policy && policy.escalateTo !== 'none' && alert.state === 'new' && <span className="pbanner__due">Escalates to the {roleText(policy.escalateTo)} in {duration(Math.max(0, due))}</span>}
          {alert.state === 'escalated' && <span className="pbanner__due">Escalated: not acknowledged in time</span>}
        </div>
        <CameraView cam={cam} still alert={alert} zones={cam.zones.filter((z) => z.id === alert.zoneId)} />
        <dl className="pfacts">
          <dt>What</dt>
          <dd>{alert.detail}</dd>
          <dt>Where</dt>
          <dd>
            {cam.id} · {AREAS_BY_ID[cam.areaId]?.name}
          </dd>
          <dt>Rule</dt>
          <dd>{rule?.name ?? alert.ruleId}</dd>
        </dl>

        {open && (
          <div className="pactions">
            <button
              type="button"
              className="pbtn pbtn--primary"
              onClick={() => {
                acknowledge(alert.id, userId, 'mobile');
                if (rule && rule.qavach !== 'none') setReporting(true);
              }}
            >
              <Icon name="check" size={20} stroke={2.2} />
              Acknowledge
            </button>
            <a className="pbtn" href="tel:+910000000000">
              <Icon name="phone" size={18} />
              Call control room
            </a>
            <button type="button" className="pbtn pbtn--ghost" onClick={() => markFalse(alert.id, userId, 'From the phone')}>
              False alarm
            </button>
          </div>
        )}

        {!open && alert.ackBy && (
          <p className="pnote">
            <Icon name="check" size={16} />
            Acknowledged by {USERS.find((u) => u.id === alert.ackBy)?.name ?? alert.ackBy} {alert.ackVia === 'mobile' ? 'on the phone' : alert.ackVia === 'wall' ? 'on the wall' : 'in the console'} at {hm(alert.ackAt!)}
          </p>
        )}

        {alert.qavach ? (
          <div className="pdone">
            <Icon name="shield" size={20} />
            <span>
              <strong>
                {alert.qavach.type} {alert.qavach.ref}
              </strong>{' '}
              is in Qavach with the snapshot and clip.
            </span>
          </div>
        ) : (
          alert.state === 'acknowledged' &&
          (reporting ? (
            <PhoneReport alert={alert} userId={userId} onDone={() => setReporting(false)} />
          ) : (
            <button type="button" className="pbtn" onClick={() => setReporting(true)}>
              <Icon name="send" size={18} />
              Report in Qavach
            </button>
          ))
        )}
      </div>
    </>
  );
}

function PhoneReport({ alert, userId, onDone }: { alert: Alert; userId: string; onDone: () => void }) {
  const cams = useCameras();
  const rules = useRules();
  const cam = cams.find((c) => c.id === alert.cameraId)!;
  const rule = rules.find((r) => r.id === alert.ruleId);
  const d = draftRecord(alert, cam, rule, AREAS_BY_ID[cam.areaId], hm(alert.at));
  const [type, setType] = useState<QavachRecordType>(d.type);
  const [cls, setCls] = useState<Classification>(d.classification);
  const [note, setNote] = useState(d.immediateAction);
  const [noteEdited, setNoteEdited] = useState(false);
  return (
    <div className="preport">
      <strong>Report in Qavach</strong>
      <div className="phone__tabs phone__tabs--inline">
        {(['Incident', 'Near miss', 'Observation'] as QavachRecordType[]).map((t) => (
          <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="phone__tabs phone__tabs--inline">
        {(['Unsafe act', 'Unsafe condition'] as Classification[]).map((t) => (
          <button key={t} type="button" aria-pressed={cls === t} onClick={() => setCls(t)}>
            {t}
          </button>
        ))}
      </div>
      <label className={`field${noteEdited ? '' : ' qai-field'}`}>
        <span className="field__label">{noteEdited ? 'What you did' : 'What you did · QAI suggestion'}</span>
        <textarea
          className="textarea"
          rows={3}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setNoteEdited(true);
          }}
        />
      </label>
      <span className="meta">
        <Icon name="camera" size={14} /> Snapshot and 20 s clip from {cam.id} attached
      </span>
      <button
        type="button"
        className="pbtn pbtn--primary"
        onClick={() => {
          raiseInQavach(alert.id, { ...d, type, classification: cls, immediateAction: note, createdBy: userId, source: 'mobile' });
          onDone();
        }}
      >
        <Icon name="send" size={18} />
        Submit to Qavach
      </button>
    </div>
  );
}
