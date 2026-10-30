import { useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../components/Icon';
import { CameraView, Empty, Seg } from '../../components/ui';
import { AREAS } from '../../data/seed';
import { isAdmin, useCameras, useMe, useRules } from '../../state/store';
import { Onboarding } from '../Onboarding';
import './cameras.css';

export function Cameras() {
  const cams = useCameras();
  const rules = useRules();
  const me = useMe();
  const [area, setArea] = useState('all');
  const [show, setShow] = useState<'all' | 'nozones' | 'issues'>('all');
  const [q, setQ] = useState('');
  const t = q.trim().toLowerCase();
  const list = cams.filter(
    (c) =>
      (area === 'all' || c.areaId === area) &&
      (show === 'all' || (show === 'nozones' ? c.zones.length === 0 : c.status !== 'online')) &&
      (!t || `${c.id} ${c.name} ${c.stream}`.toLowerCase().includes(t)),
  );
  const ruleCount = (id: string) => rules.filter((r) => r.cameraIds.includes(id)).length;
  const online = cams.filter((c) => c.status === 'online').length;
  const zoned = cams.filter((c) => c.zones.length).length;

  return (
    <div className="page">
      <div className="page__head">
        <div className="page__title">
          <span className="page__eyebrow">Set up · steps 1 and 2</span>
          <h1>Cameras and zones</h1>
          <span className="page__sub">
            {cams.length} cameras · {online} online · {zoned} with zones drawn · {cams.length - zoned} still need zones
          </span>
        </div>
        <div className="page__actions">
          {isAdmin(me) && (
            <Link to="/cameras/new" className="btn">
              <Icon name="plus" size={17} />
              Add camera
            </Link>
          )}
        </div>
      </div>

      <Onboarding />

      <div className="camfilters">
        <Seg
          label="Show"
          small
          value={show}
          onChange={setShow}
          options={[
            { value: 'all', label: 'All' },
            { value: 'nozones', label: `Need zones (${cams.length - zoned})` },
            { value: 'issues', label: `Offline or degraded (${cams.length - online})` },
          ]}
        />
        <select className="select select--sm" style={{ width: 'auto' }} value={area} onChange={(e) => setArea(e.target.value)} aria-label="Area">
          <option value="all">All areas</option>
          {AREAS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <input className="input input--sm" style={{ maxWidth: 280 }} placeholder="Search by ID, name or address" aria-label="Search cameras" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {list.length === 0 && <Empty icon="camera" title="No cameras match" />}
      {AREAS.map((a) => {
        const items = list.filter((c) => c.areaId === a.id);
        if (!items.length) return null;
        return (
          <section key={a.id} className="camarea">
            <h2>
              {a.name}
              <span className="meta">
                {items.length} cameras{a.highOps ? ' · high-operational area' : ''}
              </span>
            </h2>
            <div className="camgrid">
              {items.map((c) => (
                <Link key={c.id} to={`/cameras/${c.id}`} className="camcard">
                  <CameraView cam={c} still zones={c.zones} caption={false} />
                  <div className="camcard__body">
                    <div className="row">
                      <span className={`dot dot--${c.status}`} title={c.status} />
                      <span className="mono">{c.id}</span>
                      <span className="ellipsis">{c.name}</span>
                    </div>
                    <div className="row-wrap">
                      {c.zones.length ? <span className="chip">{c.zones.length} {c.zones.length === 1 ? 'zone' : 'zones'}</span> : <span className="chip chip--warn">No zones yet</span>}
                      {ruleCount(c.id) > 0 && <span className="chip">{ruleCount(c.id)} {ruleCount(c.id) === 1 ? 'rule' : 'rules'}</span>}
                      {c.status !== 'online' && <span className={`chip ${c.status === 'offline' ? 'chip--danger' : 'chip--warn'}`}>{c.status}</span>}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
