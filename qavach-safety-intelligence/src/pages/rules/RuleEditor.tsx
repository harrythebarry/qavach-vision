import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Icon } from '../../components/Icon';
import { ReadOnlyNote } from '../../components/Shell';
import { CameraView, CHANNEL, Modal, PRIORITY_NAME, PriorityBadge, QaiLabel, Seg } from '../../components/ui';
import { AREAS } from '../../data/seed';
import type { Camera, Classification, Condition, Ppe, Priority, QavachRecordType, Rule, Schedule, Subject } from '../../data/types';
import { CONDITION_LABEL, describeRule, draftRuleFromText, SCHEDULE_LABEL, SUBJECT_LABEL, type RuleDraft } from '../../lib/qai';
import { hm } from '../../lib/time';
import { raiseFor } from '../../state/engine';
import { deleteRule, isAdmin, nextRuleId, roleText, saveRule, toast, useCameras, useMe, usePolicies, useRules } from '../../state/store';
import './rules.css';

const EXAMPLES = [
  'Alert me when a person moves away from the deck walkway for at least 5 seconds',
  'Someone without a helmet or vest on the quay apron for 3 seconds',
  'A truck stopped on the pedestrian crossing for 2 minutes',
  'Anyone crosses the fence line at night, urgent',
];

type AiField = 'name' | 'cameras' | 'zones' | 'subject' | 'condition' | 'duration' | 'schedule' | 'priority' | 'qavach';

export function RuleEditor() {
  const { ruleId } = useParams();
  const rules = useRules();
  const cams = useCameras();
  const policies = usePolicies();
  const me = useMe();
  const nav = useNavigate();
  const admin = isAdmin(me);
  const existing = rules.find((r) => r.id === ruleId);
  const [rule, setRule] = useState<Rule>(
    () =>
      existing ?? {
        id: nextRuleId(rules),
        name: '',
        cameraIds: [],
        zoneIds: [],
        subject: 'person',
        condition: 'enters',
        durationSec: 3,
        ppe: [],
        crowdOver: 6,
        schedule: 'always',
        priority: 'P2',
        mode: 'test',
        qavach: 'Observation',
        classification: 'Unsafe act',
        updatedAt: Date.now(),
        updatedBy: me.id,
      },
  );
  const [text, setText] = useState(existing?.plainText ?? '');
  const [draft, setDraft] = useState<RuleDraft>();
  const [ai, setAi] = useState<Set<AiField>>(new Set());
  const [picking, setPicking] = useState(false);
  const [backtest, setBacktest] = useState<{ total: number; hits: { cam: Camera; at: number }[] }>();

  const chosen = cams.filter((c) => rule.cameraIds.includes(c.id));
  const zoneOptions = useZoneOptions(chosen);
  const selectedZoneNames = zoneOptions.filter((o) => o.ids.some((id) => rule.zoneIds.includes(id))).map((o) => o.name);
  const policy = policies.find((p) => p.priority === rule.priority);

  if (ruleId && !existing) {
    return (
      <div className="page">
        Rule {ruleId} not found. <Link to="/rules">Back to rules</Link>
      </div>
    );
  }

  const touch = (f: AiField) => setAi((s) => (s.has(f) ? new Set([...s].filter((x) => x !== f)) : s));
  const set = (p: Partial<Rule>, f?: AiField) => {
    setRule({ ...rule, ...p });
    if (f) touch(f);
    setBacktest(undefined);
  };
  const aiCls = (f: AiField) => (ai.has(f) ? ' qai-field' : '');

  const runDraft = (t = text) => {
    if (!t.trim()) return;
    const d = draftRuleFromText(t, cams, AREAS);
    setDraft(d);
    setRule({ ...rule, ...d.rule, plainText: t });
    setAi(new Set(['name', 'cameras', 'zones', 'subject', 'condition', 'duration', 'schedule', 'priority', 'qavach']));
    setBacktest(undefined);
  };

  const runBacktest = () => {
    const base: Record<Condition, number> = { enters: 0.5, outside: 0.45, dwells: 0.35, crosses: 0.15, 'no-ppe': 0.7, crowd: 0.25, smoke: 0.02, stopped: 0.35 };
    const seed = rule.cameraIds.join('').length + rule.durationSec * 7 + rule.zoneIds.length * 3;
    const factor = 1 / (1 + rule.durationSec / 12);
    const total = Math.round(base[rule.condition] * Math.max(1, chosen.length) * factor * (0.8 + (seed % 7) / 10));
    const now = Date.now();
    const hits = Array.from({ length: Math.min(total, 6) }, (_, i) => ({ cam: chosen[(seed + i * 3) % Math.max(1, chosen.length)], at: now - ((seed * (i + 3) * 997) % 86400000) })).filter((h) => h.cam);
    setBacktest({ total, hits: hits.sort((a, b) => b.at - a.at) });
  };

  const valid = rule.name.trim() && rule.cameraIds.length > 0;
  const save = () => {
    saveRule({ ...rule, updatedAt: Date.now(), updatedBy: me.id });
    toast(`${rule.id} saved · ${rule.mode === 'live' ? 'live now' : 'in test: matches are logged, no one is told'}`);
    nav('/rules');
  };

  const sentence = describeRule(rule, selectedZoneNames);

  return (
    <div className="page">
      <div className="page__head">
        <div className="page__title">
          <span className="page__eyebrow">
            <Link to="/rules">Rules</Link> / {existing ? rule.id : 'New rule'}
          </span>
          <h1>{existing ? rule.name : 'New rule'}</h1>
        </div>
      </div>
      <ReadOnlyNote>Only the safety admin creates and changes rules.</ReadOnlyNote>

      <fieldset className="plain" disabled={!admin}>
        <section className="qai ruleai">
          <QaiLabel>Describe the rule in your own words</QaiLabel>
          <div className="ruleai__row">
            <textarea className="textarea" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="For example: Alert me when a person moves away from the deck walkway for at least 5 seconds" />
            <button type="button" className="btn btn--ai" onClick={() => runDraft()} disabled={!text.trim()}>
              <Icon name="spark" size={16} />
              Draft the rule
            </button>
          </div>
          {!draft && (
            <div className="row-wrap">
              <span className="meta">Try:</span>
              {EXAMPLES.map((e) => (
                <button
                  key={e}
                  type="button"
                  className="chip chip--ai"
                  onClick={() => {
                    setText(e);
                    runDraft(e);
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
          {draft && (
            <div className="ruleai__out">
              <div>
                <strong className="qai__label">QAI understood</strong>
                <ul>
                  {draft.understood.map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              </div>
              {draft.assumed.length > 0 && (
                <div>
                  <strong className="qai__label">QAI assumed, so check</strong>
                  <ul>
                    {draft.assumed.map((u) => (
                      <li key={u}>{u}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="meta">Blue fields below came from QAI. They turn black when you change them. Nothing is saved until you press Save.</p>
            </div>
          )}
        </section>

        <div className="ruleedit">
          <div className="card card--pad stack ruleform">
            <div className={`field${aiCls('name')}`}>
              <label htmlFor="r-name">Rule name</label>
              <input id="r-name" className="input" value={rule.name} onChange={(e) => set({ name: e.target.value }, 'name')} placeholder="For example: Person away from the deck walkway" />
            </div>

            <div className={`field${aiCls('cameras')}`}>
              <span className="field__label">Cameras</span>
              <div className="row-wrap">
                {chosen.slice(0, 10).map((c) => (
                  <span key={c.id} className={`chip ${ai.has('cameras') ? 'chip--ai' : 'chip--outline'}`}>
                    <span className="mono">{c.id}</span>
                  </span>
                ))}
                {chosen.length > 10 && <span className="chip">+{chosen.length - 10} more</span>}
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => setPicking(true)}>
                  <Icon name="camera" size={15} />
                  {chosen.length ? `Change (${chosen.length})` : 'Choose cameras'}
                </button>
              </div>
            </div>

            <div className={`field${aiCls('zones')}`}>
              <span className="field__label">Zones</span>
              {chosen.length === 0 ? (
                <span className="meta">Choose cameras first.</span>
              ) : zoneOptions.length === 0 ? (
                <span className="meta">These cameras have no zones yet, so the rule watches the whole view. Draw zones on the Cameras page.</span>
              ) : (
                <div className="row-wrap">
                  {zoneOptions.map((o) => {
                    const on = o.ids.some((id) => rule.zoneIds.includes(id));
                    return (
                      <button
                        key={o.name}
                        type="button"
                        className={`chip ${ai.has('zones') && on ? 'chip--ai' : 'chip--outline'}`}
                        aria-pressed={on && !ai.has('zones')}
                        onClick={() => set({ zoneIds: on ? rule.zoneIds.filter((id) => !o.ids.includes(id)) : [...rule.zoneIds, ...o.ids] }, 'zones')}
                      >
                        {on && <Icon name="check" size={13} />}
                        {o.name} · {o.ids.length}
                      </button>
                    );
                  })}
                  <span className="meta">{rule.zoneIds.length ? '' : 'None picked: the whole view'}</span>
                </div>
              )}
            </div>

            <div className="grid-2" style={{ gap: 12 }}>
              <div className={`field${aiCls('subject')}`}>
                <label htmlFor="r-subj">Who or what</label>
                <select id="r-subj" className="select" value={rule.subject} onChange={(e) => set({ subject: e.target.value as Subject }, 'subject')}>
                  {(Object.keys(SUBJECT_LABEL) as Subject[]).map((s) => (
                    <option key={s} value={s}>
                      {SUBJECT_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div className={`field${aiCls('condition')}`}>
                <label htmlFor="r-cond">Does what</label>
                <select id="r-cond" className="select" value={rule.condition} onChange={(e) => set({ condition: e.target.value as Condition }, 'condition')}>
                  {(Object.keys(CONDITION_LABEL) as Condition[]).map((c) => (
                    <option key={c} value={c}>
                      {CONDITION_LABEL[c]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {rule.condition === 'no-ppe' && (
              <div className={`field${aiCls('condition')}`}>
                <span className="field__label">Missing PPE</span>
                <div className="row-wrap">
                  {(['helmet', 'vest', 'life jacket'] as Ppe[]).map((p) => (
                    <label key={p} className="check">
                      <input type="checkbox" checked={rule.ppe.includes(p)} onChange={(e) => set({ ppe: e.target.checked ? [...rule.ppe, p] : rule.ppe.filter((x) => x !== p) }, 'condition')} />
                      {p}
                    </label>
                  ))}
                </div>
              </div>
            )}
            {rule.condition === 'crowd' && (
              <div className="field" style={{ maxWidth: 220 }}>
                <label htmlFor="r-crowd">More than how many people</label>
                <input id="r-crowd" className="input" type="number" min={1} value={rule.crowdOver} onChange={(e) => set({ crowdOver: Math.max(1, Number(e.target.value)) })} />
              </div>
            )}

            <div className="grid-2" style={{ gap: 12 }}>
              <div className={`field${aiCls('duration')}`}>
                <label htmlFor="r-dur">For at least</label>
                <div className="row">
                  <input id="r-dur" className="input" type="number" min={0} value={rule.durationSec >= 120 && rule.durationSec % 60 === 0 ? rule.durationSec / 60 : rule.durationSec} onChange={(e) => set({ durationSec: Math.max(0, Number(e.target.value)) * (rule.durationSec >= 120 && rule.durationSec % 60 === 0 ? 60 : 1) }, 'duration')} style={{ maxWidth: 110 }} />
                  <span className="muted">{rule.durationSec >= 120 && rule.durationSec % 60 === 0 ? 'minutes' : 'seconds'}</span>
                </div>
                <span className="field__hint">Short blips under this time don't alert.</span>
              </div>
              <div className={`field${aiCls('schedule')}`}>
                <label htmlFor="r-when">When</label>
                <select id="r-when" className="select" value={rule.schedule} onChange={(e) => set({ schedule: e.target.value as Schedule }, 'schedule')}>
                  {(Object.keys(SCHEDULE_LABEL) as Schedule[]).map((s) => (
                    <option key={s} value={s}>
                      {SCHEDULE_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className={`field${aiCls('priority')}`}>
              <span className="field__label">Alert level</span>
              <Seg
                label="Alert level"
                value={rule.priority}
                onChange={(v) => set({ priority: v }, 'priority')}
                options={(['P1', 'P2', 'P3', 'P4'] as Priority[]).map((p) => ({ value: p, label: `${p} ${PRIORITY_NAME[p]}` }))}
              />
              {policy && (
                <span className="field__hint">
                  {policy.channels.map((c) => CHANNEL[c].label).join(', ')} to the {policy.notify.map(roleText).join(' and ')}
                  {policy.escalateTo !== 'none' ? `; escalates to the ${roleText(policy.escalateTo)} if not acknowledged in ${policy.ackWithinMin} min` : ''}.{' '}
                  <Link to="/notifications">Change who is told</Link>
                </span>
              )}
            </div>

            <div className="grid-2" style={{ gap: 12 }}>
              <div className={`field${aiCls('qavach')}`}>
                <label htmlFor="r-q">Qavach record</label>
                <select id="r-q" className="select" value={rule.qavach} onChange={(e) => set({ qavach: e.target.value as QavachRecordType | 'none' }, 'qavach')}>
                  <option value="Incident">Incident</option>
                  <option value="Observation">Observation</option>
                  <option value="Near miss">Near miss</option>
                  <option value="none">Don't create one</option>
                </select>
              </div>
              <div className={`field${aiCls('qavach')}`}>
                <span className="field__label">Classification</span>
                <Seg label="Classification" small value={rule.classification} onChange={(v) => set({ classification: v as Classification }, 'qavach')} options={[{ value: 'Unsafe act', label: 'Unsafe act' }, { value: 'Unsafe condition', label: 'Unsafe condition' }]} />
              </div>
            </div>

            <div className="field">
              <span className="field__label">Mode</span>
              <Seg
                label="Mode"
                value={rule.mode}
                onChange={(v) => set({ mode: v })}
                options={[
                  { value: 'test', label: 'Test · log only' },
                  { value: 'live', label: 'Live · alert people' },
                ]}
              />
              <span className="field__hint">Run a new rule in test for a few shifts, check what it catches, then make it live.</span>
            </div>
          </div>

          <aside className="stack ruleside">
            <div className="card card--pad stack">
              <h3>In one sentence</h3>
              <p className="rulesentence">
                {sentence}
                {rule.schedule !== 'always' ? `, ${SCHEDULE_LABEL[rule.schedule].toLowerCase()}` : ''} on {chosen.length} camera{chosen.length === 1 ? '' : 's'} → <PriorityBadge p={rule.priority} />
                {rule.qavach !== 'none' ? ` and a Qavach ${rule.qavach.toLowerCase()}` : ''}.
              </p>
              {chosen[0] && (
                <CameraView cam={chosen[0]} still zones={chosen[0].zones} highlightZones={rule.zoneIds} showZoneLabels />
              )}
              {chosen[0] && <span className="meta">Preview: {chosen[0].id} {chosen[0].name}</span>}
            </div>
            <div className="card card--pad stack">
              <h3>Check it before it goes live</h3>
              <button type="button" className="btn btn--secondary" onClick={runBacktest} disabled={!chosen.length}>
                <Icon name="clock" size={16} />
                Try it on the last 24 hours
              </button>
              {backtest && (
                <div className="stack" style={{ gap: 6 }}>
                  <strong>
                    Would have alerted {backtest.total} time{backtest.total === 1 ? '' : 's'}
                  </strong>
                  {backtest.hits.map((h, i) => (
                    <span key={i} className="meta">
                      {hm(h.at)} · {h.cam.id} {h.cam.name}
                    </span>
                  ))}
                  {backtest.total === 0 && <span className="meta">No matches. Check the zones and the time.</span>}
                </div>
              )}
              {existing && (
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={!chosen.some((c) => c.status !== 'offline')}
                  onClick={() => {
                    const cam = chosen.find((c) => c.status !== 'offline')!;
                    const a = raiseFor(existing, cam, { quiet: true });
                    toast(`Test alert ${a.id} raised on ${cam.id}: it follows the ${existing.priority} policy`, { link: `/alerts/${a.id}` });
                  }}
                >
                  <Icon name="bell" size={16} />
                  Raise a test alert now
                </button>
              )}
            </div>
          </aside>
        </div>
      </fieldset>

      <div className="camedit__foot">
        <Link to="/rules" className="btn btn--secondary">
          Cancel
        </Link>
        {existing && admin && (
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              if (!window.confirm(`Delete ${rule.id} “${rule.name}”?`)) return;
              deleteRule(rule.id);
              toast(`${rule.id} deleted`);
              nav('/rules');
            }}
          >
            <Icon name="trash" size={16} />
            Delete
          </button>
        )}
        <span className="spacer" />
        {!valid && <span className="meta">Give it a name and at least one camera.</span>}
        {admin && (
          <button type="button" className="btn" onClick={save} disabled={!valid}>
            Save rule
          </button>
        )}
      </div>

      {picking && (
        <CameraPicker
          selected={rule.cameraIds}
          onClose={() => setPicking(false)}
          onDone={(ids) => {
            const keepZones = rule.zoneIds.filter((z) => ids.some((id) => z.startsWith(`${id}-`)));
            set({ cameraIds: ids, zoneIds: keepZones }, 'cameras');
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}

function useZoneOptions(chosen: Camera[]) {
  return useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of chosen) for (const z of c.zones) m.set(z.name, [...(m.get(z.name) ?? []), z.id]);
    return [...m.entries()].map(([name, ids]) => ({ name, ids }));
  }, [chosen]);
}

function CameraPicker({ selected, onClose, onDone }: { selected: string[]; onClose: () => void; onDone: (ids: string[]) => void }) {
  const cams = useCameras();
  const [sel, setSel] = useState(new Set(selected));
  const [q, setQ] = useState('');
  const t = q.trim().toLowerCase();
  const toggle = (id: string, on: boolean) => {
    const s = new Set(sel);
    if (on) s.add(id);
    else s.delete(id);
    setSel(s);
  };
  return (
    <Modal
      title="Choose cameras"
      wide
      onClose={onClose}
      footer={
        <>
          <span className="meta" style={{ marginRight: 'auto' }}>
            {sel.size} selected
          </span>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={() => onDone([...sel])}>
            Use {sel.size} cameras
          </button>
        </>
      }
    >
      <input className="input" placeholder="Filter cameras" aria-label="Filter cameras" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} />
      {AREAS.map((a) => {
        const items = cams.filter((c) => c.areaId === a.id && (!t || `${c.id} ${c.name}`.toLowerCase().includes(t)));
        if (!items.length) return null;
        const all = items.every((c) => sel.has(c.id));
        return (
          <div key={a.id} className="picker__area">
            <label className="check picker__areahead">
              <input
                type="checkbox"
                checked={all}
                onChange={(e) => {
                  const s = new Set(sel);
                  items.forEach((c) => (e.target.checked ? s.add(c.id) : s.delete(c.id)));
                  setSel(s);
                }}
              />
              <strong>{a.name}</strong>
              <span className="meta">{items.length}</span>
            </label>
            <div className="picker__grid">
              {items.map((c) => (
                <label key={c.id} className={`picker__cam${sel.has(c.id) ? ' is-on' : ''}`}>
                  <input type="checkbox" checked={sel.has(c.id)} onChange={(e) => toggle(c.id, e.target.checked)} />
                  <span className="mono">{c.id}</span>
                  <span className="ellipsis">{c.name}</span>
                  {c.zones.length === 0 && <span className="chip chip--warn">no zones</span>}
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </Modal>
  );
}
