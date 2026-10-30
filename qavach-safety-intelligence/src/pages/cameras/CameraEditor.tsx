import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Icon } from '../../components/Icon';
import { ReadOnlyNote } from '../../components/Shell';
import { CameraView } from '../../components/ui';
import { AREAS, camId } from '../../data/seed';
import type { Camera, ZonePurpose } from '../../data/types';
import { PURPOSE_LABEL, ZONE_COLORS } from '../../scenes/zones';
import { isAdmin, removeCamera, saveCamera, saveWall, toast, useCameras, useMe, useRules, useWalls } from '../../state/store';
import { LAYOUT_SLOTS } from '../wall/WallBody';
import { ZoneEditor } from './ZoneEditor';

type Step = 'connect' | 'zones' | 'walls';

const MAKES = ['Axis Q1786-LE', 'Hanwha XNO-8082R', 'Bosch DINION 5100i', 'Hikvision DS-2CD5A46', 'Other ONVIF camera'];

export function CameraEditor() {
  const { cameraId } = useParams();
  const isNew = !cameraId;
  const cams = useCameras();
  const rules = useRules();
  const walls = useWalls();
  const me = useMe();
  const nav = useNavigate();
  const existing = cams.find((c) => c.id === cameraId);
  const canEdit = isAdmin(me);

  const [cam, setCam] = useState<Camera | undefined>(() => existing ?? blank(cams));
  const [step, setStep] = useState<Step>(isNew ? 'connect' : 'zones');
  const [test, setTest] = useState<'idle' | 'testing' | 'ok' | 'fail'>(isNew ? 'idle' : 'ok');
  const [user, setUser] = useState('svc-cctv');
  const [pass, setPass] = useState('');
  const [sel, setSel] = useState<string>();
  const [wallPlan, setWallPlan] = useState<Record<string, 'off' | 'rolls' | 'pinned'>>({});

  useEffect(() => {
    if (existing && existing.id !== cam?.id) setCam(existing);
    // Only when the route changes to another camera.
  }, [cameraId]);

  useEffect(() => {
    if (!cam) return;
    const plan: Record<string, 'off' | 'rolls' | 'pinned'> = {};
    for (const w of walls) plan[w.id] = w.pinned.includes(cam.id) ? 'pinned' : w.rotation.includes(cam.id) ? 'rolls' : 'off';
    setWallPlan(plan);
  }, [cam?.id]);

  if (!cam) {
    return (
      <div className="page">
        <p>
          Camera {cameraId} not found. <Link to="/cameras">Back to cameras</Link>
        </p>
      </div>
    );
  }

  const set = (p: Partial<Camera>) => setCam({ ...cam, ...p });
  const setArea = (areaId: string) => {
    const area = AREAS.find((a) => a.id === areaId)!;
    const n = cams.filter((c) => c.areaId === areaId).length + 1;
    setCam({ ...cam, areaId, scene: area.scene, id: isNew ? camId(areaId, n) : cam.id, zones: isNew ? [] : cam.zones });
    if (isNew) setTest('idle');
  };

  const runTest = () => {
    if (!/^rtsp:\/\/[\w.-]+(:\d+)?\/\S*/.test(cam.stream)) {
      setTest('fail');
      return;
    }
    setTest('testing');
    window.setTimeout(() => setTest('ok'), 1200);
  };

  const usedBy = (zoneId: string) => rules.filter((r) => r.zoneIds.includes(zoneId)).map((r) => r.id);

  const save = () => {
    saveCamera({ ...cam, addedAt: existing?.addedAt ?? Date.now(), addedBy: existing?.addedBy ?? me.id, status: existing?.status ?? 'online' });
    for (const w of walls) {
      const want = wallPlan[w.id] ?? 'off';
      let pinned = w.pinned.map((p) => (p === cam.id ? null : p));
      let rotation = w.rotation.filter((id) => id !== cam.id);
      if (want === 'rolls') rotation = [...rotation, cam.id];
      if (want === 'pinned') {
        const slots = LAYOUT_SLOTS[w.pinnedLayout];
        const free = pinned.slice(0, slots).findIndex((p) => !p);
        const i = free >= 0 ? free : Math.min(pinned.length, slots - 1);
        pinned = [...pinned];
        while (pinned.length <= i) pinned.push(null);
        pinned[i] = cam.id;
        rotation = [...rotation, cam.id];
      }
      if (want !== (w.pinned.includes(cam.id) ? 'pinned' : w.rotation.includes(cam.id) ? 'rolls' : 'off')) saveWall({ ...w, pinned, rotation });
    }
    toast(isNew ? `${cam.id} ${cam.name} added with ${cam.zones.length} zones` : `${cam.id} saved`);
    nav(isNew ? `/cameras/${cam.id}` : '/cameras');
  };

  const steps: { id: Step; label: string }[] = [
    { id: 'connect', label: '1 · Connect' },
    { id: 'zones', label: `2 · Draw zones (${cam.zones.length})` },
    { id: 'walls', label: '3 · Walls' },
  ];
  const selZone = cam.zones.find((z) => z.id === sel);
  const canNext = step !== 'connect' || test === 'ok';

  return (
    <div className="page">
      <div className="page__head">
        <div className="page__title">
          <span className="page__eyebrow">
            <Link to="/cameras">Cameras and zones</Link> / {isNew ? 'Add camera' : cam.id}
          </span>
          <h1>{isNew ? 'Add a camera' : `${cam.id} · ${cam.name}`}</h1>
        </div>
        <div className="page__actions">
          {!isNew && canEdit && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                if (!window.confirm(`Remove ${cam.id}? Its zones go too, and it comes off every rule and wall.`)) return;
                removeCamera(cam.id);
                toast(`${cam.id} removed`);
                nav('/cameras');
              }}
            >
              <Icon name="trash" size={16} />
              Remove camera
            </button>
          )}
        </div>
      </div>

      <ReadOnlyNote>Only the safety admin adds cameras and draws zones.</ReadOnlyNote>

      <div className="tabs" role="tablist">
        {steps.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={step === s.id} onClick={() => (s.id === 'connect' || test === 'ok' ? setStep(s.id) : undefined)} disabled={s.id !== 'connect' && test !== 'ok'}>
            {s.label}
          </button>
        ))}
      </div>

      <fieldset className="plain" disabled={!canEdit}>
        {step === 'connect' && (
          <div className="camedit">
            <div className="card card--pad stack">
              <div className="grid-2" style={{ gap: 12 }}>
                <div className="field">
                  <label htmlFor="c-area">Area</label>
                  <select id="c-area" className="select" value={cam.areaId} onChange={(e) => setArea(e.target.value)} disabled={!isNew}>
                    {AREAS.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="c-id">Camera ID</label>
                  <input id="c-id" className="input mono" value={cam.id} readOnly />
                </div>
              </div>
              <div className="field">
                <label htmlFor="c-name">Name people will see</label>
                <input id="c-name" className="input" value={cam.name} onChange={(e) => set({ name: e.target.value })} placeholder="For example: Berth 2 · deck port side" />
              </div>
              <div className="field">
                <label htmlFor="c-url">Stream address (RTSP)</label>
                <input
                  id="c-url"
                  className="input mono"
                  value={cam.stream}
                  onChange={(e) => {
                    set({ stream: e.target.value });
                    if (isNew) setTest('idle');
                  }}
                  placeholder="rtsp://10.40.1.25:554/stream1"
                />
                <span className="field__hint">The camera's main stream on the terminal network. The edge unit pulls it; nothing is exposed outside.</span>
              </div>
              <div className="grid-2" style={{ gap: 12 }}>
                <div className="field">
                  <label htmlFor="c-user">User name</label>
                  <input id="c-user" className="input" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="off" />
                </div>
                <div className="field">
                  <label htmlFor="c-pass">Password</label>
                  <input id="c-pass" className="input" type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" placeholder={isNew ? '' : 'Saved · leave blank to keep'} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="c-make">Make and model</label>
                <select id="c-make" className="select" value={cam.make} onChange={(e) => set({ make: e.target.value })}>
                  {MAKES.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="row">
                <button type="button" className="btn btn--secondary" onClick={runTest} disabled={test === 'testing' || !cam.stream}>
                  <Icon name="wifi" size={16} />
                  {test === 'testing' ? 'Testing…' : 'Test connection'}
                </button>
                {test === 'ok' && (
                  <span className="chip chip--good">
                    <Icon name="check" size={14} />
                    Connected · {cam.resolution} · {cam.fps} fps · H.265
                  </span>
                )}
                {test === 'fail' && <span className="chip chip--danger">Use an RTSP address, for example rtsp://10.40.1.25:554/stream1</span>}
              </div>
            </div>
            <div className="stack">
              {test === 'ok' ? (
                <CameraView cam={cam} />
              ) : (
                <div className="camedit__placeholder">
                  <Icon name="camera" size={30} />
                  <span>{test === 'testing' ? 'Connecting to the camera…' : 'Test the connection to see the picture'}</span>
                </div>
              )}
              <p className="meta">Next you draw the zones on this picture. Detection only runs inside the zones you draw.</p>
            </div>
          </div>
        )}

        {step === 'zones' && (
          <div className="camedit camedit--zones">
            <ZoneEditor cam={cam} zones={cam.zones} onChange={(zones) => set({ zones })} selectedId={sel} onSelect={setSel} readOnly={!canEdit} />
            <div className="card">
              <div className="card__head">
                <h2>Zones on this camera</h2>
              </div>
              <div className="card__body stack">
                {cam.zones.length === 0 && <p className="meta">No zones yet. Pick “Draw an area” or “Draw a line”, then click on the picture.</p>}
                {cam.zones.map((z) => (
                  <div key={z.id} className={`zonerow${z.id === sel ? ' is-sel' : ''}`} onClick={() => setSel(z.id)}>
                    <span className="zonerow__swatch" style={{ background: ZONE_COLORS[z.purpose] }} />
                    <div className="stack" style={{ gap: 6, flex: 1, minWidth: 0 }}>
                      <input className="input input--sm" aria-label="Zone name" value={z.name} onChange={(e) => set({ zones: cam.zones.map((x) => (x.id === z.id ? { ...x, name: e.target.value } : x)) })} />
                      <select className="select select--sm" aria-label="What the zone is" value={z.purpose} onChange={(e) => set({ zones: cam.zones.map((x) => (x.id === z.id ? { ...x, purpose: e.target.value as ZonePurpose } : x)) })}>
                        {(Object.keys(PURPOSE_LABEL) as ZonePurpose[])
                          .filter((p) => (z.kind === 'line' ? p === 'line' || p === 'deck-edge' : p !== 'line'))
                          .map((p) => (
                            <option key={p} value={p}>
                              {PURPOSE_LABEL[p]}
                            </option>
                          ))}
                      </select>
                      <span className="meta">
                        {z.kind === 'line' ? 'Line' : `Area · ${z.points.length} corners`}
                        {usedBy(z.id).length > 0 && ` · used by ${usedBy(z.id).join(', ')}`}
                      </span>
                    </div>
                  </div>
                ))}
                {selZone && <p className="meta">Selected: {selZone.name}. Drag its corners on the picture to adjust.</p>}
              </div>
            </div>
          </div>
        )}

        {step === 'walls' && (
          <div className="card">
            <div className="card__head">
              <h2>Where this camera shows</h2>
              <span className="meta">Pinned cameras stay on screen; the others take turns in the rolling section.</span>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Wall</th>
                  <th>Team</th>
                  <th>On this wall</th>
                </tr>
              </thead>
              <tbody>
                {walls.map((w) => (
                  <tr key={w.id}>
                    <td>
                      <strong>{w.name}</strong>
                    </td>
                    <td className="muted">{w.teamId === 't-quay' ? 'Quay and marine' : w.teamId === 't-yard' ? 'Yard and gate' : 'HSE control room'}</td>
                    <td>
                      <div className="seg seg--sm" role="group" aria-label={`On ${w.name}`}>
                        {(['off', 'rolls', 'pinned'] as const).map((v) => (
                          <button key={v} type="button" aria-pressed={(wallPlan[w.id] ?? 'off') === v} onClick={() => setWallPlan({ ...wallPlan, [w.id]: v })} disabled={v === 'pinned' && w.pinnedShare === 0}>
                            {v === 'off' ? 'Not shown' : v === 'rolls' ? 'Rolls' : 'Pinned'}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </fieldset>

      <div className="camedit__foot">
        <Link to="/cameras" className="btn btn--secondary">
          Cancel
        </Link>
        <span className="spacer" />
        {step !== 'connect' && (
          <button type="button" className="btn btn--secondary" onClick={() => setStep(step === 'walls' ? 'zones' : 'connect')}>
            Back
          </button>
        )}
        {step !== 'walls' ? (
          <button type="button" className="btn btn--secondary" onClick={() => setStep(step === 'connect' ? 'zones' : 'walls')} disabled={!canNext}>
            Next
            <Icon name="arrow-right" size={16} />
          </button>
        ) : null}
        {canEdit && (
          <button type="button" className="btn" onClick={save} disabled={test !== 'ok' || !cam.name.trim()}>
            {isNew ? 'Add camera' : 'Save camera'}
          </button>
        )}
      </div>
    </div>
  );
}

function blank(cams: Camera[]): Camera {
  const n = cams.filter((c) => c.areaId === 'deck').length + 1;
  return {
    id: camId('deck', n),
    name: '',
    areaId: 'deck',
    scene: 'deck',
    variant: (n * 3) % 8,
    status: 'online',
    stream: '',
    make: MAKES[0],
    resolution: '2560 × 1440',
    fps: 20,
    zones: [],
    addedAt: Date.now(),
    addedBy: '',
  };
}
