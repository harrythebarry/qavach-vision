import { Link } from 'react-router';
import { Icon, type IconName } from '../components/Icon';
import { TEAMS } from '../data/seed';
import { useCameras, usePolicies, useRules, useWalls } from '../state/store';

// The set-up path from the call: add cameras, draw zones, create rules, decide
// who is told, then put cameras on the teams' walls.
export function Onboarding({ compact }: { compact?: boolean }) {
  const cams = useCameras();
  const rules = useRules();
  const walls = useWalls();
  const policies = usePolicies();
  const zoned = cams.filter((c) => c.zones.length).length;
  const live = rules.filter((r) => r.mode === 'live').length;
  const teamsWithWall = new Set(walls.map((w) => w.teamId)).size;
  const steps: { icon: IconName; title: string; to: string; status: string; done: boolean; partial?: boolean }[] = [
    { icon: 'camera', title: 'Add cameras', to: '/cameras', status: `${cams.length} added`, done: cams.length > 0 },
    { icon: 'polygon', title: 'Draw zones', to: '/cameras', status: `${zoned} of ${cams.length} cameras`, done: zoned === cams.length, partial: zoned > 0 },
    { icon: 'rule', title: 'Create rules', to: '/rules', status: `${live} live · ${rules.length - live} in test`, done: live > 0 },
    { icon: 'route', title: 'Decide who is told', to: '/notifications', status: `${policies.length} alert levels`, done: policies.length > 0 },
    { icon: 'wall', title: 'Build the walls', to: '/wall', status: `${walls.length} walls · ${teamsWithWall} of ${TEAMS.length} teams`, done: teamsWithWall === TEAMS.length },
  ];
  return (
    <ol className={`onboard${compact ? ' onboard--compact' : ''}`} aria-label="Set-up steps">
      {steps.map((s, i) => (
        <li key={s.title}>
          <Link to={s.to} className={`onboard__step${s.done ? ' is-done' : s.partial ? ' is-partial' : ''}`}>
            <span className="onboard__num">{s.done ? <Icon name="check" size={15} stroke={2.4} /> : i + 1}</span>
            <span className="stack" style={{ gap: 1, minWidth: 0 }}>
              <strong className="row" style={{ gap: 6 }}>
                <Icon name={s.icon} size={16} />
                {s.title}
              </strong>
              <span className="meta ellipsis">{s.status}</span>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
