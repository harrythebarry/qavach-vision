import { useMemo, useState } from 'react';
import { USERS } from '../data/seed';
import type { Alert, Classification, QavachRecord, QavachRecordType } from '../data/types';
import { draftRecord } from '../lib/qai';
import { hm } from '../lib/time';
import { acknowledge, AREAS_BY_ID, escalate, markFalse, raiseInQavach, resolve, toast, useCameras, useMe, usePolicies, useRules } from '../state/store';
import { Icon } from './Icon';
import { CameraView, Modal, PriorityBadge, QaiLabel } from './ui';

type Draft = Omit<QavachRecord, 'ref' | 'at' | 'createdBy' | 'source'>;

const article = (w: string) => (/^[aeiou]/i.test(w) ? 'an' : 'a');

function useContext(alert: Alert) {
  const cams = useCameras();
  const rules = useRules();
  const policies = usePolicies();
  const cam = cams.find((c) => c.id === alert.cameraId);
  const rule = rules.find((r) => r.id === alert.ruleId);
  const policy = policies.find((p) => p.priority === alert.priority);
  const draft = useMemo(() => (cam ? draftRecord(alert, cam, rule, AREAS_BY_ID[cam.areaId], hm(alert.at)) : undefined), [alert, cam, rule]);
  return { cam, rule, policy, draft };
}

/** Fields QAI filled stay blue until a person changes them. */
function RecordFields({ value, onChange, edited, setEdited }: { value: Draft; onChange: (d: Draft) => void; edited: Set<string>; setEdited: (s: Set<string>) => void }) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    onChange({ ...value, [k]: v });
    setEdited(new Set(edited).add(k));
  };
  const cls = (k: string) => `field${edited.has(k) ? '' : ' qai-field'}`;
  return (
    <div className="stack">
      <div className="grid-3" style={{ gap: 12 }}>
        <div className={cls('type')}>
          <label htmlFor="rec-type">Qavach record</label>
          <select id="rec-type" className="select" value={value.type} onChange={(e) => set('type', e.target.value as QavachRecordType)}>
            <option>Incident</option>
            <option>Observation</option>
            <option>Near miss</option>
          </select>
        </div>
        <div className={cls('classification')}>
          <label htmlFor="rec-class">Classification</label>
          <select id="rec-class" className="select" value={value.classification} onChange={(e) => set('classification', e.target.value as Classification)}>
            <option>Unsafe act</option>
            <option>Unsafe condition</option>
          </select>
        </div>
        <div className={cls('severity')}>
          <label htmlFor="rec-sev">Severity</label>
          <select id="rec-sev" className="select" value={value.severity} onChange={(e) => set('severity', e.target.value as Draft['severity'])}>
            <option>Critical</option>
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
          </select>
        </div>
      </div>
      <div className={cls('title')}>
        <label htmlFor="rec-title">Title</label>
        <input id="rec-title" className="input" value={value.title} onChange={(e) => set('title', e.target.value)} />
      </div>
      <div className={cls('description')}>
        <label htmlFor="rec-desc">What happened</label>
        <textarea id="rec-desc" className="textarea" rows={4} value={value.description} onChange={(e) => set('description', e.target.value)} />
      </div>
      <div className={cls('immediateAction')}>
        <label htmlFor="rec-act">Immediate action</label>
        <input id="rec-act" className="input" value={value.immediateAction} onChange={(e) => set('immediateAction', e.target.value)} />
      </div>
    </div>
  );
}

export function AckDialog({ alert, via, onClose }: { alert: Alert; via: 'wall' | 'console'; onClose: () => void }) {
  const me = useMe();
  const { cam, rule, policy, draft } = useContext(alert);
  const auto = policy?.qavach === 'on-acknowledge' && rule?.qavach !== 'none' && !alert.qavach;
  const [note, setNote] = useState('');
  const [raise, setRaise] = useState(auto);
  const [rec, setRec] = useState<Draft | undefined>(draft);
  const [edited, setEdited] = useState<Set<string>>(new Set());
  const submit = () => {
    acknowledge(alert.id, me.id, via, note.trim());
    if (raise && rec) {
      const ref = raiseInQavach(alert.id, { ...rec, createdBy: me.id, source: 'manual' });
      toast(`${alert.id} acknowledged · ${rec.type} ${ref} raised in Qavach`);
    } else toast(`${alert.id} acknowledged`);
    onClose();
  };
  return (
    <Modal
      title={`Acknowledge ${alert.id}`}
      onClose={onClose}
      wide={raise}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={submit}>
            <Icon name="check" size={17} />
            {raise && rec ? `Acknowledge and raise ${rec.type.toLowerCase()}` : 'Acknowledge'}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="row" style={{ gap: 10 }}>
          <PriorityBadge p={alert.priority} />
          <strong>{alert.title}</strong>
        </div>
        <span className="meta">
          {cam?.id} {cam?.name} · {alert.detail}
        </span>
        <div className="field">
          <label htmlFor="ack-note">Note (optional)</label>
          <input id="ack-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: Supervisor called, worker back on the walkway" autoFocus />
        </div>
        {rec && !alert.qavach && (
          <label className="check">
            <input type="checkbox" checked={raise} onChange={(e) => setRaise(e.target.checked)} />
            Raise {article(rec.type)} {rec.type.toLowerCase()} in Qavach
            {auto && <span className="chip chip--outline">The {alert.priority} policy raises one on acknowledgement</span>}
          </label>
        )}
        {raise && rec && (
          <div className="qai" style={{ padding: 14 }}>
            <div className="row" style={{ marginBottom: 10 }}>
              <QaiLabel>QAI drafted this from the alert. Check it before you raise it.</QaiLabel>
            </div>
            <RecordFields value={rec} onChange={setRec} edited={edited} setEdited={setEdited} />
          </div>
        )}
      </div>
    </Modal>
  );
}

export function RaiseDialog({ alert, onClose }: { alert: Alert; onClose: () => void }) {
  const me = useMe();
  const { cam, draft } = useContext(alert);
  const [rec, setRec] = useState<Draft | undefined>(draft);
  const [edited, setEdited] = useState<Set<string>>(new Set());
  if (!rec || !cam) return null;
  const submit = () => {
    const ref = raiseInQavach(alert.id, { ...rec, createdBy: me.id, source: 'manual' });
    toast(`${rec.type} ${ref} raised in Qavach with the snapshot and clip`);
    onClose();
  };
  return (
    <Modal
      title="Raise in Qavach"
      wide
      onClose={onClose}
      footer={
        <>
          <span className="meta" style={{ marginRight: 'auto' }}>
            Goes to Incidents and Learning in Qavach, with the snapshot and a 20 s clip.
          </span>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={submit}>
            <Icon name="send" size={16} />
            Raise {rec.type.toLowerCase()}
          </button>
        </>
      }
    >
      <div className="raise">
        <div className="stack">
          <CameraView cam={cam} alert={alert} still zones={cam.zones} highlightZones={alert.zoneId ? [alert.zoneId] : []} />
          <span className="meta">
            {alert.id} · {cam.id} {cam.name} · {hm(alert.at)}
          </span>
        </div>
        <div className="qai" style={{ padding: 14 }}>
          <div className="row" style={{ marginBottom: 10 }}>
            <QaiLabel>QAI drafted this from the alert. Fields you change turn black.</QaiLabel>
          </div>
          <RecordFields value={rec} onChange={setRec} edited={edited} setEdited={setEdited} />
        </div>
      </div>
    </Modal>
  );
}

export function NoteDialog({ alert, kind, onClose }: { alert: Alert; kind: 'resolve' | 'false'; onClose: () => void }) {
  const me = useMe();
  const [text, setText] = useState('');
  const submit = () => {
    if (kind === 'resolve') resolve(alert.id, me.id, text.trim());
    else markFalse(alert.id, me.id, text.trim());
    toast(kind === 'resolve' ? `${alert.id} resolved` : `${alert.id} marked as a false alarm. It goes into the model's review set.`);
    onClose();
  };
  return (
    <Modal
      title={kind === 'resolve' ? `Resolve ${alert.id}` : `Mark ${alert.id} as a false alarm`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={submit} disabled={kind === 'false' && !text.trim()}>
            {kind === 'resolve' ? 'Resolve' : 'Mark as false alarm'}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="note">{kind === 'resolve' ? 'What was done (optional)' : 'Why is it a false alarm?'}</label>
        <input id="note" className="input" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={kind === 'resolve' ? 'For example: Worker briefed, area clear' : 'For example: Vest under a rain jacket'} />
      </div>
    </Modal>
  );
}

export function EscalateDialog({ alert, onClose }: { alert: Alert; onClose: () => void }) {
  const me = useMe();
  const options = USERS.filter((u) => u.id !== me.id && (u.role === 'HSE manager' || u.role === 'Terminal manager' || u.role === 'Shift supervisor'));
  const [to, setTo] = useState(options.find((u) => u.role === 'HSE manager')?.id ?? options[0]?.id);
  const [reason, setReason] = useState('');
  const submit = () => {
    escalate(alert.id, to, me.id, reason.trim() || 'escalated by hand');
    toast(`${alert.id} escalated to ${options.find((u) => u.id === to)?.name}: push and phone call sent`);
    onClose();
  };
  return (
    <Modal
      title={`Escalate ${alert.id}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--danger" onClick={submit}>
            Escalate
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="field">
          <label htmlFor="esc-to">Escalate to</label>
          <select id="esc-to" className="select" value={to} onChange={(e) => setTo(e.target.value)}>
            {options.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {u.role}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="esc-why">Reason</label>
          <input id="esc-why" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: Supervisor not answering the radio" />
        </div>
        <span className="meta">They get a mobile push and a phone call.</span>
      </div>
    </Modal>
  );
}
