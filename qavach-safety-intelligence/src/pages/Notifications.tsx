import { useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { ReadOnlyNote } from '../components/Shell';
import { CHANNEL, PRIORITY_NAME, PriorityBadge, Seg, Switch } from '../components/ui';
import { AREAS, TEAMS, USERS } from '../data/seed';
import type { Channel, Policy, Role } from '../data/types';
import { isAdmin, savePolicies, toast, useMe, usePolicies, useRules, useWalls } from '../state/store';
import './notifications.css';

const ROLES: Role[] = ['Control room operator', 'Shift supervisor', 'HSE manager', 'Terminal manager'];
const CHANNELS: Channel[] = ['wall', 'push', 'sms', 'whatsapp', 'email', 'call'];

export function Notifications() {
  const saved = usePolicies();
  const rules = useRules();
  const walls = useWalls();
  const me = useMe();
  const admin = isAdmin(me);
  const [draft, setDraft] = useState<Policy[]>(saved);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (p: Policy, patch: Partial<Policy>) => setDraft(draft.map((x) => (x.priority === p.priority ? { ...x, ...patch } : x)));

  return (
    <div className="page">
      <div className="page__head">
        <div className="page__title">
          <span className="page__eyebrow">Set up · step 4</span>
          <h1>Who gets told</h1>
          <span className="page__sub">Each alert level sets the channels, who is told first, how long they have to acknowledge, who it escalates to, and when the Qavach record is raised.</span>
        </div>
        {admin && (
          <div className="page__actions">
            <button type="button" className="btn btn--secondary" disabled={!dirty} onClick={() => setDraft(saved)}>
              Discard
            </button>
            <button
              type="button"
              className="btn"
              disabled={!dirty}
              onClick={() => {
                savePolicies(draft);
                toast('Notification rules saved. New and open alerts follow them from now on.');
              }}
            >
              Save changes
            </button>
          </div>
        )}
      </div>
      <ReadOnlyNote>Only the safety admin changes who gets told.</ReadOnlyNote>

      <fieldset className="plain stack" disabled={!admin} style={{ gap: 14 }}>
        {draft.map((p) => {
          const using = rules.filter((r) => r.priority === p.priority);
          return (
            <section key={p.priority} className={`card policy policy--${p.priority}`}>
              <div className="card__head">
                <PriorityBadge p={p.priority} />
                <h2>{PRIORITY_NAME[p.priority]} alerts</h2>
                <span className="meta">
                  {using.length} rules:{' '}
                  {using.slice(0, 3).map((r, i) => (
                    <span key={r.id}>
                      {i > 0 && ', '}
                      <Link to={`/rules/${r.id}`}>{r.name}</Link>
                    </span>
                  ))}
                  {using.length > 3 && ` +${using.length - 3}`}
                </span>
              </div>
              <div className="policy__grid">
                <div className="field">
                  <span className="field__label">Channels</span>
                  <div className="row-wrap">
                    {CHANNELS.map((c) => {
                      const on = p.channels.includes(c);
                      return (
                        <button key={c} type="button" className="chip chip--outline" aria-pressed={on} onClick={() => set(p, { channels: on ? p.channels.filter((x) => x !== c) : [...p.channels, c] })}>
                          <Icon name={CHANNEL[c].icon} size={13} />
                          {CHANNEL[c].label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="field">
                  <span className="field__label">Tell first</span>
                  <div className="row-wrap">
                    {ROLES.map((r) => {
                      const on = p.notify.includes(r);
                      return (
                        <button key={r} type="button" className="chip chip--outline" aria-pressed={on} onClick={() => set(p, { notify: on ? p.notify.filter((x) => x !== r) : [...p.notify, r] })}>
                          {r}
                        </button>
                      );
                    })}
                  </div>
                  <span className="field__hint">People in these roles on the camera's team. The wall always shows it to that team's control room operator.</span>
                </div>
                <div className="policy__row">
                  <div className="field">
                    <label htmlFor={`ack-${p.priority}`}>Acknowledge within</label>
                    <select id={`ack-${p.priority}`} className="select" value={p.ackWithinMin} onChange={(e) => set(p, { ackWithinMin: Number(e.target.value) })}>
                      {[1, 2, 5, 10, 15, 30, 60].map((m) => (
                        <option key={m} value={m}>
                          {m} min
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`esc-${p.priority}`}>Then escalate to</label>
                    <select id={`esc-${p.priority}`} className="select" value={p.escalateTo} onChange={(e) => set(p, { escalateTo: e.target.value as Role | 'none' })}>
                      <option value="none">No one</option>
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`rem-${p.priority}`}>Remind every</label>
                    <select id={`rem-${p.priority}`} className="select" value={p.remindEveryMin} onChange={(e) => set(p, { remindEveryMin: Number(e.target.value) })}>
                      <option value={0}>No reminders</option>
                      {[1, 2, 5, 10].map((m) => (
                        <option key={m} value={m}>
                          {m} min (3 at most)
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="policy__row">
                  <div className="field">
                    <span className="field__label">Qavach record</span>
                    <Seg
                      label="When the Qavach record is raised"
                      small
                      value={p.qavach}
                      onChange={(v) => set(p, { qavach: v })}
                      options={[
                        { value: 'on-acknowledge', label: 'When acknowledged' },
                        { value: 'reviewer-decides', label: 'Reviewer decides' },
                        { value: 'never', label: 'Never' },
                      ]}
                    />
                  </div>
                  <div className="field">
                    <span className="field__label">Video wall</span>
                    <div className="row-wrap" style={{ gap: 16 }}>
                      <Switch checked={p.wallTakeover} onChange={(v) => set(p, { wallTakeover: v })} label="Takes over a tile" />
                      <Switch checked={p.sound} onChange={(v) => set(p, { sound: v })} label="Alarm sound" />
                    </div>
                  </div>
                </div>
              </div>
              <Flow p={p} />
            </section>
          );
        })}
      </fieldset>

      <section className="card" style={{ marginTop: 24 }}>
        <div className="card__head">
          <h2>Teams and what they watch</h2>
          <span className="meta">Teams and people come from Qavach user management.</span>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Team</th>
              <th>Areas</th>
              <th>People</th>
              <th>Walls</th>
            </tr>
          </thead>
          <tbody>
            {TEAMS.map((t) => (
              <tr key={t.id}>
                <td>
                  <strong>{t.name}</strong>
                </td>
                <td className="meta" style={{ maxWidth: 300 }}>
                  {t.id === 't-hse' ? 'All areas' : t.areaIds.map((a) => AREAS.find((x) => x.id === a)?.name).join(' · ')}
                </td>
                <td>
                  {USERS.filter((u) => u.teamId === t.id).map((u) => (
                    <div key={u.id}>
                      {u.name} <span className="meta">· {u.role}</span>
                    </div>
                  ))}
                </td>
                <td>
                  {walls
                    .filter((w) => w.teamId === t.id)
                    .map((w) => (
                      <div key={w.id}>
                        <Link to={`/wall/${w.id}`}>{w.name}</Link>
                      </div>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/** What happens over time for one alert at this level, with real names from the quay team. */
function Flow({ p }: { p: Policy }) {
  const first = p.notify.flatMap((r) => {
    const u = USERS.find((x) => x.role === r && (x.teamId === 't-quay' || r === 'HSE manager' || r === 'Terminal manager'));
    return u ? [u] : [];
  });
  const esc = p.escalateTo !== 'none' ? USERS.find((u) => u.role === p.escalateTo) : undefined;
  const others = p.channels.filter((c) => c !== 'wall').map((c) => CHANNEL[c].label);
  return (
    <ol className="flow" aria-label="What happens">
      <li>
        <span className="flow__t">0:00</span>
        <span>
          {p.channels.includes('wall') ? `On the quay wall${p.wallTakeover ? ', takes over a tile' : ''}${p.sound ? ', with sound' : ''}. ` : ''}
          {others.length ? `${others.join(', ')} to ${first.map((u) => u.name).join(' and ') || 'no one'}` : ''}
        </span>
      </li>
      {p.remindEveryMin > 0 && (
        <li>
          <span className="flow__t">+{p.remindEveryMin}:00</span>
          <span>Reminder if still open, up to 3</span>
        </li>
      )}
      {esc && (
        <li className="flow__esc">
          <span className="flow__t">+{p.ackWithinMin}:00</span>
          <span>
            Not acknowledged: escalates to {esc.name} ({esc.role}) by push and phone call
          </span>
        </li>
      )}
      <li className="flow__q">
        <span className="flow__t">Ack</span>
        <span>
          {p.qavach === 'on-acknowledge' ? 'Whoever acknowledges confirms the QAI draft, and the record is raised in Qavach' : p.qavach === 'reviewer-decides' ? 'A reviewer decides whether to raise a Qavach record' : 'No Qavach record'}
        </span>
      </li>
    </ol>
  );
}
