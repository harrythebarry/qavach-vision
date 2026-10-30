import type { Alert, Area, Camera, Classification, Condition, Ppe, Priority, QavachRecord, QavachRecordType, Rule, Schedule, Subject } from '../data/types';

// Stand-ins for QAI. In Qavach these calls go to the QAI service; here they
// run in the browser so the prototype works offline. Everything they return is
// shown in blue as a draft, and nothing is saved until a person accepts it.

export const CONDITION_LABEL: Record<Condition, string> = {
  enters: 'enters',
  outside: 'moves away from',
  dwells: 'stays inside',
  crosses: 'crosses',
  'no-ppe': 'is inside without PPE',
  crowd: 'more than N people inside',
  smoke: 'smoke or flame seen',
  stopped: 'vehicle stopped inside',
};

export const SCHEDULE_LABEL: Record<Schedule, string> = {
  always: 'Always',
  day: 'Day shift (06:00–18:00)',
  night: 'Night (18:00–06:00)',
  'vessel-ops': 'During vessel operations',
};

export const SUBJECT_LABEL: Record<Subject, string> = { person: 'A person', vehicle: 'A vehicle', any: 'Anything' };

const secs = (n: number) => (n >= 60 && n % 60 === 0 ? `${n / 60} min` : `${n} s`);

/** One sentence for what a rule watches for. */
export function describeRule(r: Pick<Rule, 'subject' | 'condition' | 'durationSec' | 'ppe' | 'crowdOver'>, zoneNames: string[]): string {
  const names = zoneNames.join(' or ');
  const inZone = names ? `in ${names}` : 'in view';
  const subj = SUBJECT_LABEL[r.subject];
  const dur = r.durationSec > 0 ? ` for ${secs(r.durationSec)} or more` : '';
  const ppe = r.ppe.length ? `a ${r.ppe.join(' or ')}` : 'the required PPE';
  switch (r.condition) {
    case 'enters':
      return names ? `${subj} enters ${names}${dur}` : `${subj} appears in view${dur}`;
    case 'outside':
      return `${subj} moves away from ${names || 'the view'}${dur}`;
    case 'dwells':
      return `${subj} stays ${inZone}${dur}`;
    case 'crosses':
      return `${subj} crosses ${names || 'a line in view'}`;
    case 'no-ppe':
      return `${subj} without ${ppe} ${names ? `at ${names}` : 'in view'}${dur}`;
    case 'crowd':
      return `More than ${r.crowdOver} people ${inZone}${dur}`;
    case 'smoke':
      return `Smoke or flame ${inZone}${dur}`;
    case 'stopped':
      return `A vehicle stopped ${inZone}${dur}`;
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface RuleDraft {
  rule: Pick<Rule, 'name' | 'subject' | 'condition' | 'durationSec' | 'ppe' | 'crowdOver' | 'schedule' | 'priority' | 'qavach' | 'classification' | 'cameraIds' | 'zoneIds'>;
  understood: string[];
  assumed: string[];
}

const AREA_WORDS: [RegExp, string][] = [
  [/\bdeck|gangway|lashing bridge|vessel\b/, 'deck'],
  [/\bquay|crane|sts|apron|berth\b/, 'quay'],
  [/\byard|rtg|block|stack\b/, 'yard'],
  [/\breefer\b/, 'reefer'],
  [/\bgate|truck lane|lane\b/, 'gate'],
  [/\bworkshop|hot work|tyre|wash bay\b/, 'workshop'],
  [/\bimdg|hazard|dangerous goods|hazmat\b/, 'hazmat'],
  [/\bfence|perimeter|boundary\b/, 'perimeter'],
];

const STOP = new Set(['the', 'a', 'an', 'of', 'on', 'in', 'at', 'to', 'zone', 'area', 'from', 'and', 'or']);
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w));

/** Turns a plain-words rule into rule fields, and says what it understood and assumed. */
export function draftRuleFromText(text: string, cameras: Camera[], areas: Area[]): RuleDraft {
  const t = ` ${text.toLowerCase()} `;
  const understood: string[] = [];
  const assumed: string[] = [];

  let subject: Subject = 'person';
  if (/\b(vehicle|truck|forklift|car|rtg|tractor|lorry)s?\b/.test(t)) subject = 'vehicle';
  else if (/\b(smoke|fire|flame)\b/.test(t)) subject = 'any';
  if (/\b(person|people|worker|someone|anyone|lasher|pedestrian|crew|man|staff|visitor)s?\b/.test(t)) subject = 'person';
  understood.push(`Subject: ${SUBJECT_LABEL[subject].toLowerCase()}`);

  const ppe: Ppe[] = [];
  if (/helmet|hard ?hat/.test(t)) ppe.push('helmet');
  if (/\bvest|hi-?vis/.test(t)) ppe.push('vest');
  if (/life ?jacket|life ?vest|pfd/.test(t)) ppe.push('life jacket');

  let condition: Condition = 'enters';
  let crowdOver = 0;
  const crowd = /(more than|over|above|exceeds?)\s+(\d+)\s*(people|persons|workers|men)?/.exec(t);
  if (/\b(smoke|fire|flame)\b/.test(t)) condition = 'smoke';
  else if (ppe.length && /(without|no |not wearing|missing|isn'?t wearing)/.test(t)) condition = 'no-ppe';
  else if (crowd || /crowd/.test(t)) {
    condition = 'crowd';
    crowdOver = crowd ? Number(crowd[2]) : 6;
  } else if (/cross(es|ing)?|climbs? (over|the)|jumps?/.test(t)) condition = 'crosses';
  else if (/away from|leaves?|outside|out of|steps? off|moves? off|off the/.test(t)) condition = 'outside';
  else if (/stopped|parked|stationary|idle|blocking/.test(t)) condition = 'stopped';
  else if (/stays?|loiter|remains?|lingers?|waits?/.test(t)) condition = 'dwells';
  else if (!/enter|inside|into|walks? in|goes in|in the/.test(t)) assumed.push('No action word found, so the rule fires when the subject enters the zone');
  understood.push(`Condition: ${CONDITION_LABEL[condition].replace('N', String(crowdOver))}`);
  if (condition === 'no-ppe') understood.push(`PPE: ${ppe.join(', ')}`);

  let durationSec = { enters: 1, outside: 5, dwells: 30, crosses: 0, 'no-ppe': 3, crowd: 30, smoke: 3, stopped: 60 }[condition];
  const s = /(\d+)\s*(s|sec|secs|second|seconds)\b/.exec(t);
  const m = /(\d+)\s*(m|min|mins|minute|minutes)\b/.exec(t);
  if (s) durationSec = Number(s[1]);
  else if (m) durationSec = Number(m[1]) * 60;
  if (s || m) understood.push(`Duration: ${secs(durationSec)} or more`);
  else if (condition !== 'crosses') assumed.push(`No time given, so it waits ${secs(durationSec)} before alerting`);

  // Zones: score each zone name by the words it shares with the text.
  const zoneNames = [...new Set(cameras.flatMap((c) => c.zones.map((z) => z.name)))];
  const tw = new Set(words(t));
  let best = '';
  let bestScore = 0;
  for (const name of zoneNames) {
    const nw = words(name);
    const hit = nw.filter((w) => tw.has(w)).length;
    const score = hit / nw.length + (t.includes(name.toLowerCase()) ? 1 : 0);
    if (hit && score > bestScore) {
      best = name;
      bestScore = score;
    }
  }
  if (condition === 'no-ppe' && ppe.includes('life jacket') && zoneNames.includes('Deck edge') && /edge|rail|side/.test(t)) best = 'Deck edge';

  let cameraIds: string[] = [];
  let zoneIds: string[] = [];
  if (best) {
    const withZone = cameras.filter((c) => c.zones.some((z) => z.name === best));
    cameraIds = withZone.map((c) => c.id);
    zoneIds = withZone.flatMap((c) => c.zones.filter((z) => z.name === best).map((z) => z.id));
    understood.push(`Zone: ${best} (${cameraIds.length} camera${cameraIds.length === 1 ? '' : 's'} have it)`);
  } else {
    const area = AREA_WORDS.find(([re]) => re.test(t))?.[1];
    if (area) {
      cameraIds = cameras.filter((c) => c.areaId === area && c.status !== 'offline').map((c) => c.id);
      understood.push(`Area: ${areas.find((a) => a.id === area)?.name ?? area} (${cameraIds.length} cameras, whole view)`);
    } else assumed.push('No zone or area named: pick the cameras below');
  }

  let schedule: Schedule = 'always';
  if (/\bnight|after dark\b/.test(t)) schedule = 'night';
  else if (/\bday ?time|day shift|during the day\b/.test(t)) schedule = 'day';
  else if (/vessel (ops|operations)|cargo operations|while (loading|discharging|working)|during (a )?lift|during lifts/.test(t)) schedule = 'vessel-ops';
  if (schedule !== 'always') understood.push(`When: ${SCHEDULE_LABEL[schedule]}`);

  let priority: Priority;
  if (/critical|immediately|urgent|emergency|right away/.test(t)) priority = 'P1';
  else if (/\bhigh\b|asap|quickly/.test(t)) priority = 'P2';
  else if (/\blow\b|just log|only log|record only/.test(t)) priority = 'P4';
  else {
    priority =
      condition === 'smoke' || (condition === 'no-ppe' && ppe.includes('life jacket')) || /exclusion|imdg|hazard/.test(t)
        ? 'P1'
        : condition === 'no-ppe' || condition === 'crowd'
          ? 'P3'
          : condition === 'stopped'
            ? 'P4'
            : 'P2';
    assumed.push(`Alert level ${priority} suggested from what the rule watches for`);
  }

  const qavach: QavachRecordType | 'none' = priority === 'P1' ? 'Incident' : priority === 'P4' ? 'none' : subject === 'vehicle' || /lane/.test(t) ? 'Near miss' : 'Observation';
  const classification: Classification = condition === 'smoke' || condition === 'stopped' ? 'Unsafe condition' : 'Unsafe act';

  const rule = { subject, condition, durationSec, ppe, crowdOver, schedule, priority, qavach, classification, cameraIds, zoneIds, name: '' };
  rule.name = cap(describeRule(rule, best ? [best] : []).replace(/^A (person|vehicle) /, '$1 ').replace(/ for (\d+ (s|min)) or more$/, ' · $1+'));
  return { rule, understood, assumed };
}

const SEVERITY: Record<Priority, QavachRecord['severity']> = { P1: 'Critical', P2: 'High', P3: 'Medium', P4: 'Low' };

const ACTION: Record<Condition, string> = {
  enters: 'Operation in the area stopped and the person removed from the zone.',
  outside: 'Supervisor called the worker back to the marked walkway.',
  dwells: 'Supervisor asked the person to leave the zone.',
  crosses: 'Security sent to the location; access checked.',
  'no-ppe': 'Worker stopped and asked to put on the missing PPE before going on.',
  crowd: 'Access to the gangway controlled until numbers came down.',
  smoke: 'Area cleared and the fire team informed.',
  stopped: 'Driver asked to move clear of the crossing.',
};

/** Drafts the Qavach record for an alert. */
export function draftRecord(alert: Alert, cam: Camera, rule: Rule | undefined, area: Area | undefined, when: string): Omit<QavachRecord, 'ref' | 'at' | 'createdBy' | 'source'> {
  const type: QavachRecordType = rule && rule.qavach !== 'none' ? rule.qavach : 'Observation';
  return {
    type,
    title: `${alert.title} · ${cam.name}`,
    description:
      `At ${when}, camera ${cam.id} (${cam.name}, ${area?.name ?? cam.areaId}) saw: ${alert.detail.charAt(0).toLowerCase()}${alert.detail.slice(1)}. ` +
      `Detected by rule ${rule?.id ?? alert.ruleId} "${rule?.name ?? alert.title}" with ${Math.round(alert.confidence * 100)}% confidence. Snapshot and 20 s clip attached.`,
    classification: rule?.classification ?? 'Unsafe act',
    severity: SEVERITY[alert.priority],
    immediateAction: ACTION[rule?.condition ?? 'enters'],
  };
}
