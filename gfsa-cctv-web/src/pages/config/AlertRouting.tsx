import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge, Card, PageHeader, Segmented, Stat, Tabs, usePriorityName } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useApp } from '../../state/AppState';
import { useFleet } from '../../state/fleetStore';
import { useUsers } from '../../state/usersStore';
import { saveRouting, useRouting } from '../../state/routingStore';
import { nextEscalationAt, nextStep, roleEs, toRoleEs } from '../../state/escalation';
import { activeConfig, ucStore } from '../../state/configStore';
import { useCases } from '../../data/useCases';
import { SCENARIO_START } from '../../data/alarms';
import type { Alarm, Priority, User } from '../../data/types';
import { uid, useStore } from '../../lib/persist';
import { useTr, type Lang } from '../../lib/i18n';
import { fmtCountdown, fmtDay, fmtTime, fmtTimeSec, scenarioNow, useNow } from '../../lib/time';
import { PageDialog } from './PageDialog';
import { useLeaveGuard } from './useLeaveGuard';
import {
  ALL_TARGETS,
  CHANNELS,
  MESSAGE_TARGETS,
  FIXED_TARGETS,
  HOURS_OPTIONS,
  PLACEHOLDERS,
  RECIPIENT_ROLES,
  WHEN_OPTIONS,
  delivery7d,
  emailSubject,
  newStepId,
  sampleValues,
  type ChannelId,
  type Recipient,
  type RecipientChannel,
  type RoutingConfig,
  type Rules,
  type Shift,
  type Step,
  type TplLang,
} from '../../data/routing';
import {
  RECIPIENT_ROLE_ID,
  channelChip,
  channelName,
  dayLabel,
  fixedDetail,
  hoursName,
  shiftName,
  stepDetailText,
  targetName,
  whenOption,
  whenText,
  type Tr,
} from './routingText';
import {
  TIMING,
  addRun,
  advance,
  alertMessages,
  deliveryStore,
  emailBounces,
  secsOf,
  verifyStore,
  type DeliveryMsg,
  type DeliveryRun,
  type VRecord,
} from './routingDelivery';
import './AlertRouting.css';

const PRIORITIES: Priority[] = ['P1', 'P2', 'P3', 'P4'];
const SCENARIO_MS = new Date(SCENARIO_START).getTime();
const isOpen = (a: Alarm) => a.state === 'raised' || a.state === 'ack_board';
const iso = (ms: number) => new Date(ms).toISOString();

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Changed sections as [English for the audit log, Spanish]. */
function changedSections(a: RoutingConfig, b: RoutingConfig): [string, string][] {
  const out: [string, string][] = [];
  PRIORITIES.forEach((p) => {
    if (!same(a.ladders[p], b.ladders[p])) out.push([`Escalation ${p}`, `Escalamiento ${p}`]);
  });
  if (!same(a.recipients, b.recipients)) out.push(['Recipients', 'Destinatarios']);
  if (!same(a.rota, b.rota)) out.push(['Duty rota', 'Rota de guardia']);
  if (!same(a.rules, b.rules)) out.push(['Delivery rules', 'Reglas de entrega']);
  if (!same(a.templates, b.templates)) out.push(['Message template', 'Plantilla del mensaje']);
  return out;
}

/** Timers must grow down the ladder and a timed step must send something. */
function ladderProblems(steps: Step[], tr: Tr): string[] {
  const out: string[] = [];
  let last = 0;
  steps.forEach((s, i) => {
    const n = i + 1;
    if (s.when === 'after' || s.when === 'unreviewed') {
      if (s.minutes < 1) out.push(tr(`Step ${n}: the timer must be at least 1 minute.`, `Paso ${n}: el temporizador debe ser de al menos 1 minuto.`));
      else if (s.minutes <= last)
        out.push(
          tr(
            `Step ${n}: ${s.minutes} min must be later than the step before (${last} min).`,
            `Paso ${n}: ${s.minutes} min debe ser posterior al paso anterior (${last} min).`,
          ),
        );
      last = Math.max(last, s.minutes);
    }
    if (s.when === 'after' && !FIXED_TARGETS[s.target] && s.channels.length === 0)
      out.push(
        tr(
          `Step ${n}: an escalation to the ${s.target.toLowerCase()} needs at least one channel.`,
          `Paso ${n}: un escalamiento ${toRoleEs(s.target)} necesita al menos un canal.`,
        ),
      );
  });
  if (!steps.length) out.push(tr('Add at least one step.', 'Agregue al menos un paso.'));
  return out;
}

/** Where the next escalation of an open alarm would go with a given ladder. */
function nextOn(a: Alarm, ladder: Step[]): { step?: Step; at?: number } {
  const done = new Set(a.escalatedTo ?? []);
  const step = ladder
    .filter((s) => s.when === 'after')
    .sort((x, y) => x.minutes - y.minutes)
    .find((s) => !done.has(s.target));
  if (!step) return {};
  return { step, at: new Date(a.escalationBase ?? a.raisedAt).getTime() + step.minutes * 60_000 };
}

/** "operations manager" (as written in the audit log) → "Operations manager". */
const targetFromLower = (t: string) => MESSAGE_TARGETS.find((x) => x.toLowerCase() === t) ?? t;

/** Health messages arrive every minute, one second past the minute. */
const lastHealthAt = (now: number) => Math.floor((now - 1000) / 60000) * 60000 + 1000;

const SEED_CHANNEL: Record<string, ChannelId> = { WhatsApp: 'whatsapp', SMS: 'sms', Email: 'email', 'Voice call': 'call' };
const TABLE_CHANNELS: RecipientChannel[] = ['whatsapp', 'sms', 'email', 'call', 'display'];

interface ChannelRow {
  id: RecipientChannel;
  sent: number;
  delivered: number | null;
  read: number | null;
  failed: number | null;
  median: string;
  alertsSent: number;
}

function median(samples: number[]): number | undefined {
  if (!samples.length) return undefined;
  const s = [...samples].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

type VerifyView = VRecord | { state: 'display'; up: boolean; lastSeen?: string };

// =====================================================================

export function AlertRoutingPage() {
  const { state, can, log, logSystem, toast, patchAlarm } = useApp();
  const tr = useTr();
  const now = useNow();
  const fleet = useFleet();
  const people = useUsers();
  const saved = useRouting();
  const verify = useStore(verifyStore);
  const delivery = useStore(deliveryStore);
  const ucRecords = useStore(ucStore);
  const prioName = usePriorityName();
  const canEdit = can('edit_use_cases');

  // The draft starts as the saved routing and exists only while something is edited.
  const [draftState, setDraft] = useState<RoutingConfig | null>(null);
  const draft = draftState ?? saved;
  // Contacts changed in the draft are not verified until saved and verified again.
  const [verifyDraft, setVerifyDraft] = useState<Record<string, VRecord>>({});

  const [editLadder, setEditLadder] = useState<Priority | null>(null);
  const [recipientDlg, setRecipientDlg] = useState<{ id: string | null } | null>(null);
  const [rotaEditing, setRotaEditing] = useState(false);
  const [rulesEditing, setRulesEditing] = useState(false);
  const [tplEditing, setTplEditing] = useState(false);
  const [tplLang, setTplLang] = useState<TplLang>('es');
  const [testOpen, setTestOpen] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  const changes = useMemo(() => changedSections(saved, draft), [saved, draft]);
  const changesText = changes.map(([en, es]) => tr(en, es));
  const dirty = changes.length > 0;
  const blocking = PRIORITIES.flatMap((p) => ladderProblems(draft.ladders[p], tr).map((m) => `${p} · ${m}`));

  const userById = (id: string): User | undefined => people.find((u) => u.id === id);
  const linkUp = (convoyId: string) => fleet.convoyById(convoyId)?.link !== 'none';

  useEffect(() => {
    if (editLadder) editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [editLadder]);

  const patch = (fn: (c: RoutingConfig) => RoutingConfig) => setDraft((d) => fn(d ?? saved));
  const setSteps = (p: Priority, steps: Step[]) => patch((c) => ({ ...c, ladders: { ...c.ladders, [p]: steps } }));

  const closeEditors = () => {
    setEditLadder(null);
    setRotaEditing(false);
    setRulesEditing(false);
    setTplEditing(false);
  };

  const personName = (r: Recipient): string =>
    r.personId ? (userById(r.personId)?.name ?? tr('Removed user', 'Usuario eliminado')) : tr('On-call rota · 2 people', 'Rota de guardia · 2 personas');
  /** Name as stored in delivery rows and the audit log (English). */
  const personRecord = (r: Recipient) => (r.personId ? (userById(r.personId)?.name ?? 'Removed user') : 'On-call rota');

  const verifyOf = (r: Recipient): VerifyView => {
    if (r.channels.includes('display')) {
      const c = fleet.convoyById(r.scope);
      return { state: 'display', up: !!c && c.link !== 'none', lastSeen: c?.lastSeen };
    }
    return verifyDraft[r.id] ?? verify[r.id] ?? { state: 'unverified' };
  };

  // ---------- Save, discard ----------

  /** Points open alarms at the next step of the saved ladder (ALM-03). */
  const retimeOpenAlarms = (): string[] => {
    const at = iso(scenarioNow());
    const moved: string[] = [];
    for (const a of state.alarms) {
      if (!isOpen(a) || !a.escalationBase) continue;
      const step = nextStep(a);
      const when = nextEscalationAt(a, step);
      if (when === a.escalatesAt && step?.target === a.escalatesTo) continue;
      moved.push(a.id);
      patchAlarm(a.id, (x) => {
        const s = nextStep(x);
        const t = nextEscalationAt(x, s);
        return {
          ...x,
          escalatesAt: t,
          escalatesTo: s?.target,
          activity: [
            ...x.activity,
            s && t
              ? {
                  at,
                  text: `Escalation ladder changed: next step the ${s.target.toLowerCase()} at ${fmtTimeSec(t)}`,
                  textEs: `Escala de escalamiento modificada: siguiente paso ${roleEs(s.target)} a las ${fmtTimeSec(t)}`,
                  actor: 'Alert routing',
                }
              : { at, text: 'Escalation ladder changed: no further step', textEs: 'Escala de escalamiento modificada: no hay más pasos', actor: 'Alert routing' },
          ],
        };
      });
    }
    return moved;
  };

  const save = (): boolean => {
    if (!dirty || blocking.length || !canEdit) return false;
    saveRouting(draft);
    if (Object.keys(verifyDraft).length) verifyStore.set((v) => ({ ...v, ...verifyDraft }));
    setVerifyDraft({});
    const moved = retimeOpenAlarms();
    const en = changes.map((c) => c[0]).join(', ');
    log('Changed alert routing', 'Alert routing', `${en}${moved.length ? ` · next step re-timed on ${moved.join(', ')}` : ''}`);
    toast(
      moved.length
        ? tr(
            `Alert routing saved: ${en}. Applies to the next alarm and to the next step of ${moved.join(', ')}.`,
            `Enrutamiento guardado: ${changes.map((c) => c[1]).join(', ')}. Se aplica a la próxima alarma y al siguiente paso de ${moved.join(', ')}.`,
          )
        : tr(`Alert routing saved: ${en}. Applies from the next alarm.`, `Enrutamiento guardado: ${changes.map((c) => c[1]).join(', ')}. Se aplica desde la próxima alarma.`),
    );
    setDraft(null);
    closeEditors();
    return true;
  };

  const discard = (quiet = false) => {
    setDraft(null);
    setVerifyDraft({});
    closeEditors();
    if (!quiet) toast(tr('Unsaved alert routing changes discarded.', 'Cambios sin guardar del enrutamiento descartados.'));
  };

  const leaveGuard = useLeaveGuard({
    dirty,
    what: tr('alert routing', 'el enrutamiento de alertas'),
    changes: changesText,
    onDiscard: () => discard(true),
    onSave: canEdit && !blocking.length ? save : undefined,
  });

  // ---------- Delivery: tests and verification (RT-02, RT-05) ----------

  // Move delivery rows along and write the outcome of finished runs.
  useEffect(() => {
    const cur = deliveryStore.get();
    const { next, finished } = advance(cur, now, linkUp);
    if (next === cur) return;
    deliveryStore.set(() => next);
    for (const { run, msgs } of finished) {
      const summary = msgs.map((m) => `${channelName(m.channel, (e) => e)} ${m.status === 'failed' ? 'failed (bounced)' : m.status}${secsOf(m) !== undefined ? ` ${secsOf(m)} s` : ''}`).join(' · ');
      const failed = msgs.some((m) => m.status === 'failed');
      if (run.kind === 'verify') {
        const lastAt = Math.max(...msgs.map((m) => m.readAt ?? m.failedAt ?? m.deliveredAt ?? run.at));
        verifyStore.set((v) => ({
          ...v,
          [run.recipientId]: failed
            ? { state: 'bounced', at: iso(lastAt), what: 'email' }
            : { state: 'verified', at: iso(lastAt), what: v[run.recipientId]?.what ?? 'contact' },
        }));
        logSystem({ action: failed ? 'Contact verification failed' : 'Verified contact', target: `${run.role} · ${run.to}`, details: summary, source: 'Alert routing', category: 'alert' });
        toast(
          failed
            ? tr(`Verification for ${run.to} bounced. Check the email address.`, `La verificación para ${run.to} rebotó. Revise el correo.`)
            : tr(`${run.to} replied: contact details verified.`, `${run.to} respondió: datos de contacto verificados.`),
        );
      } else {
        logSystem({ action: failed ? 'Test alert partly failed' : 'Test alert delivered', target: `${run.to} · ${run.role}`, details: summary, source: 'Alert routing', category: 'alert' });
        toast(
          failed
            ? tr(`Test alert to ${run.to}: email bounced, the other channels delivered.`, `Alerta de prueba a ${run.to}: el correo rebotó, los demás canales entregaron.`)
            : tr(`Test alert to ${run.to} delivered on every channel.`, `Alerta de prueba a ${run.to} entregada en todos los canales.`),
        );
      }
    }
    // linkUp reads the live fleet; the tick is driven by `now`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, fleet.convoys]);

  const sendVerification = (r: Recipient) => {
    const at = scenarioNow();
    const runId = uid('verify');
    const phone = r.channels.some((c) => c === 'whatsapp' || c === 'sms' || c === 'call');
    const email = r.channels.includes('email');
    const chans: RecipientChannel[] = [...(phone ? (['sms'] as const) : []), ...(email ? (['email'] as const) : [])];
    if (!chans.length) return;
    const who = personRecord(r);
    const msgs: DeliveryMsg[] = chans.map((c) => ({
      id: uid('msg'),
      runId,
      channel: c,
      status: 'sent',
      queuedAt: at,
      sentAt: at,
      // The person replies to the code or opens the link a few seconds after it arrives.
      plan: { deliver: TIMING[c].deliver, read: TIMING[c].deliver + 4000 },
    }));
    addRun({ id: runId, kind: 'verify', recipientId: r.id, to: who, role: r.role, lang: userById(r.personId)?.language ?? 'es', at, by: state.user.name }, msgs);
    const what: VRecord['what'] = phone && email ? 'contact' : email ? 'email' : r.personId ? 'number' : 'numbers';
    verifyStore.set((v) => ({ ...v, [r.id]: { state: 'pending', at: iso(at), what } }));
    setVerifyDraft((d) => {
      const { [r.id]: _drop, ...rest } = d;
      void _drop;
      return rest;
    });
    log('Sent contact verification', `${r.role} · ${who}`, chans.map((c) => channelName(c, (e) => e)).join(', '), undefined, 'alert');
    toast(
      tr(
        `Verification sent to ${personName(r)}. The contact is marked verified when they reply.`,
        `Verificación enviada a ${personName(r)}. El contacto queda verificado cuando responda.`,
      ),
    );
  };

  const sendTest = (r: Recipient, chans: RecipientChannel[], msgLang: TplLang) => {
    const at = scenarioNow();
    const runId = uid('test');
    const who = personRecord(r);
    const bounced = verifyOf(r).state === 'bounced';
    const msgs: DeliveryMsg[] = chans.map((c) => {
      const waitConvoy = c === 'display' ? r.scope : undefined;
      const up = !waitConvoy || linkUp(waitConvoy);
      const fail = c === 'email' && bounced;
      return {
        id: uid('msg'),
        runId,
        channel: c,
        status: up ? 'sent' : 'queued',
        queuedAt: at,
        sentAt: up ? at : undefined,
        plan: fail ? { deliver: TIMING.email.deliver, fail: 6000 } : { ...TIMING[c] },
        waitConvoy,
        reason: fail ? 'bounced' : undefined,
      };
    });
    addRun({ id: runId, kind: 'test', recipientId: r.id, to: who, role: r.role, lang: msgLang, at, by: state.user.name }, msgs);
    log('Sent test alert', `${who} · ${r.role}`, `${chans.map((c) => channelName(c, (e) => e)).join(', ')} · ${msgLang.toUpperCase()} · marked TEST, no alarm opened`);
    toast(
      tr(
        `Test alert sent to ${personName(r)}. It is marked TEST and does not open an alarm.`,
        `Alerta de prueba enviada a ${personName(r)}. Va marcada como PRUEBA y no abre una alarma.`,
      ),
    );
    setTestOpen(false);
  };

  // ---------- Live numbers (RT-05) ----------

  const alertMsgs = useMemo(() => alertMessages(state.audit, SCENARIO_MS), [state.audit]);

  const rows: ChannelRow[] = useMemo(
    () =>
      TABLE_CHANNELS.map((id) => {
        const seed = delivery7d.find((d) => SEED_CHANNEL[d.channel] === id);
        const tests = delivery.msgs.filter((m) => m.channel === id && m.status !== 'queued');
        const alerts = alertMsgs.filter((a) => a.channel === id);
        let delivered = seed?.delivered ?? 0;
        let read = seed?.read ?? 0;
        let failed = seed?.failed ?? 0;
        const secs: number[] = [];
        const seedMedian = seed ? parseFloat(seed.median) : NaN;
        if (!Number.isNaN(seedMedian)) for (let i = 0; i < (seed?.delivered ?? 0); i++) secs.push(seedMedian);
        for (const m of tests) {
          if (m.status === 'delivered' || m.status === 'read') {
            delivered++;
            secs.push(m.plan.deliver / 1000);
          }
          if (m.status === 'read') read++;
          if (m.status === 'failed') failed++;
        }
        for (const a of alerts) {
          const t = TIMING[a.channel];
          if (a.channel === 'email' && emailBounces(a.target, saved.recipients, verify)) {
            if (now >= a.at + 6000) failed++;
            continue;
          }
          if (now >= a.at + t.deliver) {
            delivered++;
            secs.push(t.deliver / 1000);
          }
          if (t.read !== undefined && now >= a.at + t.read) read++;
        }
        const sent = (seed?.sent ?? 0) + tests.length + alerts.length;
        const m = median(secs);
        return {
          id,
          sent,
          delivered: sent ? delivered : null,
          read: id === 'whatsapp' || id === 'email' ? read : null,
          failed: sent ? failed : null,
          median: m === undefined ? '–' : `${Math.round(m)} s`,
          alertsSent: (seed?.sent ?? 0) + alerts.length,
        };
      }).filter((r) => r.id !== 'display' || r.sent > 0),
    [delivery.msgs, alertMsgs, now, saved.recipients, verify],
  );
  const testCount = delivery.msgs.filter((m) => m.status !== 'queued').length;
  const totalSent = rows.reduce((s, r) => s + (r.delivered === null ? 0 : r.sent), 0);
  const totalDelivered = rows.reduce((s, r) => s + (r.delivered ?? 0), 0);
  const totalFailed = rows.reduce((s, r) => s + (r.failed ?? 0), 0);
  const newAlarms = new Set(alertMsgs.map((a) => a.alarmId));
  const escalatedNew = [...new Set(alertMsgs.filter((a) => a.escalation).map((a) => a.alarmId))];
  // The audit log is newest first.
  const lastEsc = alertMsgs.find((a) => a.escalation);
  const alarmsAlerted = 142 + newAlarms.size;
  const byId = (id: RecipientChannel) => rows.find((r) => r.id === id)?.alertsSent ?? 0;

  // Median time to acknowledge ashore, from the alarms that were acknowledged (as on the operations center).
  const ackTimes = state.alarms
    .filter((a) => a.stateTimes.ack_shore && a.owner !== 'System')
    .map((a) => new Date(a.stateTimes.ack_shore!).getTime() - new Date(a.escalationBase ?? a.raisedAt).getTime())
    .filter((ms) => ms > 0)
    .sort((x, y) => x - y);
  const ackMedian = ackTimes.length ? ackTimes[Math.floor(ackTimes.length / 2)] : undefined;
  const ackText = ackMedian === undefined ? '–' : `${Math.floor(ackMedian / 60000)} m ${Math.round((ackMedian % 60000) / 1000)} s`;
  const ackOk = ackMedian === undefined || ackMedian <= 5 * 60_000;

  const ladderHint = (p: Priority): string => {
    const ucs = useCases.filter((u) => ucRecords[u.id] && activeConfig(u, ucRecords[u.id]).priority === p);
    const live = ucs.filter((u) => ucRecords[u.id].status === 'live').length;
    const shadow = ucs.filter((u) => ucRecords[u.id].status === 'shadow').length;
    if (p === 'P4') return tr('System notices', 'Avisos del sistema');
    if (p === 'P3') return tr(`${ucs.length} use cases · ${shadow} in shadow run`, `${ucs.length} casos de uso · ${shadow} en ejecución en sombra`);
    return tr(`${live} live use case${live === 1 ? '' : 's'}`, `${live} caso${live === 1 ? '' : 's'} de uso activo${live === 1 ? '' : 's'}`);
  };

  const openAlarms = state.alarms.filter(isOpen);
  const p2 = state.alarms.find((a) => a.id === 'ALM-26-0318');

  const recipientSub = (r: Recipient): string => {
    const scope = r.scope === 'all' ? tr('all convoys', 'todos los convoyes') : tr(`${fleet.convoyById(r.scope)?.name ?? r.scope} convoy`, `convoy ${fleet.convoyById(r.scope)?.name ?? r.scope}`);
    const s = [r.shift ? shiftName(r.shift, tr) : '', scope, r.p1Only ? tr('P1 only', 'solo P1') : ''].filter(Boolean).join(' · ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  const recentRuns = delivery.runs.slice(0, 4);

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tr('Configuration', 'Configuración'), to: '/config/use-cases' }]}
        title={tr('Alert routing', 'Enrutamiento de alertas')}
        sub={tr('Who is told, how, and when it escalates · applies to all convoys', 'A quién se avisa, cómo y cuándo se escala · se aplica a todos los convoyes')}
        meta={
          dirty ? (
            <Badge tone="warn">
              <Icon name="edit" size={13} /> {tr('Unsaved changes', 'Cambios sin guardar')} · {changes.length}
            </Badge>
          ) : (
            <Badge tone="ok">
              <Icon name="check" size={13} /> {tr('All changes saved', 'Todos los cambios guardados')}
            </Badge>
          )
        }
        actions={
          <>
            <button type="button" className="btn" onClick={() => setTestOpen(true)}>
              <Icon name="send" size={16} /> {tr('Send test alert', 'Enviar alerta de prueba')}
            </button>
            {dirty && (
              <button type="button" className="btn" onClick={() => discard()}>
                {tr('Discard', 'Descartar')}
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                className="btn btn--primary"
                disabled={!dirty || blocking.length > 0}
                onClick={save}
                title={
                  blocking.length
                    ? tr('Fix the escalation timers first', 'Corrija primero los temporizadores de escalamiento')
                    : !dirty
                      ? tr('Edit a ladder, recipient, rota, rule or template to save', 'Edite una escala, destinatario, rota, regla o plantilla para guardar')
                      : undefined
                }
              >
                {tr('Save changes', 'Guardar cambios')}
              </button>
            )}
          </>
        }
      />

      {!canEdit && (
        <div className="callout">
          <Icon name="lock" size={18} />
          <span>
            {tr(
              'Your role can view alert routing but not change it. Changes need the Safety administrator role.',
              'Su rol puede ver el enrutamiento de alertas pero no cambiarlo. Los cambios requieren el rol de administrador de seguridad.',
            )}
          </span>
        </div>
      )}

      <div className="stat-grid">
        <Stat
          label={tr('Alerts sent, 7 days', 'Alertas enviadas, 7 días')}
          value={alarmsAlerted}
          aside={tr('alarms', 'alarmas')}
          foot={`WhatsApp ${byId('whatsapp')} · SMS ${byId('sms')} · ${tr('email', 'correo')} ${byId('email')}${byId('call') ? ` · ${tr('calls', 'llamadas')} ${byId('call')}` : ''}`}
        />
        <Stat
          label={tr('Delivered', 'Entregadas')}
          value={totalSent ? `${((totalDelivered / totalSent) * 100).toFixed(1)}%` : '–'}
          aside={tr(`${totalDelivered} of ${totalSent}`, `${totalDelivered} de ${totalSent}`)}
          foot={tr(`${totalFailed} failed · failed alerts are resent on the next channel`, `${totalFailed} fallidas · las alertas fallidas se reenvían por el siguiente canal`)}
        />
        <Stat
          label={tr('Median time to acknowledge', 'Mediana de tiempo de confirmación')}
          value={ackText}
          aside={tr('target 5 min', 'objetivo 5 min')}
          footTone={ackOk ? 'ok' : 'bad'}
          foot={
            <span className="with-dot">
              <Icon name={ackOk ? 'check' : 'alert'} size={14} strokeWidth={2.4} />
              {ackOk ? tr('Within the 5 min target', 'Dentro del objetivo de 5 min') : tr('Over the 5 min target', 'Por encima del objetivo de 5 min')}
            </span>
          }
        />
        <Stat
          label={tr('Escalated', 'Escaladas')}
          value={tr(`${3 + escalatedNew.length} of ${alarmsAlerted}`, `${3 + escalatedNew.length} de ${alarmsAlerted}`)}
          aside={tr('7 days', '7 días')}
          foot={
            lastEsc
              ? tr(`Latest: ${lastEsc.alarmId} to the ${lastEsc.target}`, `Última: ${lastEsc.alarmId} ${toRoleEs(targetFromLower(lastEsc.target))}`)
              : tr('All reached the Operations manager', 'Todas llegaron al gerente de operaciones')
          }
        />
      </div>

      {/* RT-01 */}
      <Card
        id="esc"
        title={tr('Escalation by priority', 'Escalamiento por prioridad')}
        hint={tr(
          "Steps run in order until the alarm is acknowledged · applies to the next alarm and to open alarms' next step",
          'Los pasos se ejecutan en orden hasta que se confirma la alarma · se aplica a la próxima alarma y al siguiente paso de las alarmas abiertas',
        )}
        bodyClass=""
        action={
          <Link to="/config/use-cases" className="card__link">
            {tr('Priorities by use case', 'Prioridades por caso de uso')}
          </Link>
        }
      >
        <div className="ar-ladders">
          {PRIORITIES.map((p) => (
            <LadderCard
              key={p}
              p={p}
              title={prioName(p)}
              hint={ladderHint(p)}
              steps={draft.ladders[p]}
              changed={!same(saved.ladders[p], draft.ladders[p])}
              editing={editLadder === p}
              canEdit={canEdit}
              onEdit={() => setEditLadder(editLadder === p ? null : p)}
              open={openAlarms.filter((a) => a.priority === p)}
              draftLadder={draft.ladders[p]}
              now={now}
            />
          ))}
        </div>
        {editLadder && (
          <div ref={editorRef}>
            <LadderEditor
              p={editLadder}
              onPick={setEditLadder}
              steps={draft.ladders[editLadder]}
              savedSteps={saved.ladders[editLadder]}
              onChange={(s) => setSteps(editLadder, s)}
              onDone={() => setEditLadder(null)}
            />
          </div>
        )}
      </Card>

      <div className="row">
        <div className="grow stack">
          {/* RT-02 */}
          <Card
            id="rec"
            title={tr('Recipients', 'Destinatarios')}
            hint={tr(
              `${draft.recipients.length} recipients · people from Users and roles · contact details checked with a test message`,
              `${draft.recipients.length} destinatarios · personas de Usuarios y roles · datos de contacto comprobados con un mensaje de prueba`,
            )}
            bodyClass="table-wrap"
            action={
              canEdit && (
                <button type="button" className="ar-linkbtn" onClick={() => setRecipientDlg({ id: null })}>
                  <Icon name="plus" size={16} /> {tr('Add recipient', 'Agregar destinatario')}
                </button>
              )
            }
          >
            <table className="table num ar-rec" style={{ minWidth: 820 }}>
              <thead>
                <tr>
                  <th scope="col">{tr('Role · vessels', 'Rol · embarcaciones')}</th>
                  <th scope="col">{tr('Person', 'Persona')}</th>
                  <th scope="col">{tr('Channels', 'Canales')}</th>
                  <th scope="col">{tr('Hours', 'Horario')}</th>
                  <th scope="col">{tr('Verified', 'Verificado')}</th>
                  {canEdit && (
                    <th scope="col">
                      <span className="sr-only">{tr('Actions', 'Acciones')}</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {draft.recipients.map((r) => {
                  const name = personName(r);
                  const user = r.personId ? userById(r.personId) : undefined;
                  const v = verifyOf(r);
                  const isNew = !saved.recipients.some((x) => x.id === r.id);
                  return (
                    <tr key={r.id}>
                      <td className="ar-nowrap">
                        <span style={{ fontWeight: 600 }}>{targetName(r.role, tr)}</span>
                        {isNew && <span className="ar-changed"> · {tr('New', 'Nuevo')}</span>}
                        <span className="sub">{recipientSub(r)}</span>
                      </td>
                      <td>
                        <span className="ar-person">
                          <span className="ar-avatar" aria-hidden="true">
                            {r.personId ? initialsOf(name) : <Icon name="users" size={15} />}
                          </span>
                          <span>
                            {name}
                            {r.personId && !user && (
                              <span className="sub ar-flag ar-flag--bad">{tr('No longer in Users and roles · choose someone', 'Ya no está en Usuarios y roles · elija a otra persona')}</span>
                            )}
                            {user?.status === 'suspended' && (
                              <span className="sub ar-flag ar-flag--bad">{tr('Suspended · alerts do not reach them', 'Suspendido · no recibe alertas')}</span>
                            )}
                            {user?.status === 'invited' && (
                              <span className="sub ar-flag">{tr('Invited · has not signed in yet', 'Invitado · aún no inició sesión')}</span>
                            )}
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className="ar-chips">
                          {r.channels.map((c) =>
                            c === 'display' ? (
                              <Badge key={c} tone="info">
                                {channelName('display', tr)}
                              </Badge>
                            ) : (
                              <Badge key={c}>{channelChip(c, tr)}</Badge>
                            ),
                          )}
                        </span>
                      </td>
                      <td className="ar-nowrap">{hoursName(r.hours, tr)}</td>
                      <td className="ar-nowrap">
                        <VerifyCell v={v} now={now} tr={tr} />
                        {(v.state === 'bounced' || v.state === 'unverified') && canEdit && (
                          <button type="button" className="ar-inline-btn" onClick={() => sendVerification(r)}>
                            <Icon name="send" size={14} /> {tr('Send verification', 'Enviar verificación')}
                          </button>
                        )}
                      </td>
                      {canEdit && (
                        <td className="right">
                          <button
                            type="button"
                            className="btn btn--ghost btn--icon"
                            aria-label={tr(`Edit ${r.role}, ${name}`, `Editar ${targetName(r.role, tr)}, ${name}`)}
                            onClick={() => setRecipientDlg({ id: r.id })}
                          >
                            <Icon name="edit" size={16} />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          {/* RT-04 */}
          <TemplateCard
            templates={draft.templates}
            savedTemplates={saved.templates}
            lang={tplLang}
            setLang={setTplLang}
            editing={tplEditing}
            canEdit={canEdit}
            onToggleEdit={() => setTplEditing((e) => !e)}
            onChange={(l, text) => patch((c) => ({ ...c, templates: { ...c.templates, [l]: text } }))}
            onReset={(l) => patch((c) => ({ ...c, templates: { ...c.templates, [l]: saved.templates[l] } }))}
            sentNote={
              p2
                ? [
                    tr('Sent 14:32:07 to Marta Benítez · WhatsApp delivered in 4 s, SMS in 9 s', 'Enviada 14:32:07 a Marta Benítez · WhatsApp entregado en 4 s, SMS en 9 s'),
                    p2.stateTimes.ack_shore
                      ? tr(`acknowledged ashore ${fmtTime(p2.stateTimes.ack_shore)}`, `confirmada en tierra ${fmtTime(p2.stateTimes.ack_shore)}`)
                      : (p2.escalatedTo ?? []).length > 1
                        ? tr(
                            `escalated to the ${(p2.escalatedTo ?? []).slice(-1)[0].toLowerCase()}`,
                            `escalada ${toRoleEs((p2.escalatedTo ?? []).slice(-1)[0])}`,
                          )
                        : tr('not yet acknowledged ashore', 'aún sin confirmar en tierra'),
                  ].join(' · ')
                : undefined
            }
          />
        </div>

        <div className="stack ar-side">
          {/* RT-03 */}
          <RotaCard
            now={now}
            rota={draft.rota}
            people={people}
            editing={rotaEditing}
            canEdit={canEdit}
            changed={!same(saved.rota, draft.rota)}
            onToggleEdit={() => setRotaEditing((e) => !e)}
            onChange={(date, shift, userId) => patch((c) => ({ ...c, rota: c.rota.map((d) => (d.date === date ? { ...d, [shift]: userId } : d)) }))}
          />

          <RulesCard
            rules={draft.rules}
            editing={rulesEditing}
            canEdit={canEdit}
            changed={!same(saved.rules, draft.rules)}
            onToggleEdit={() => setRulesEditing((e) => !e)}
            onChange={(r) => patch((c) => ({ ...c, rules: { ...c.rules, ...r } }))}
          />

          {/* RT-05 */}
          <Card
            id="deliv"
            title={tr('Delivery, last 7 days', 'Entrega, últimos 7 días')}
            bodyClass=""
            action={
              <Link to="/admin/integrations" className="card__link">
                {tr('Channels', 'Canales')}
              </Link>
            }
          >
            <div className="table-wrap">
              <table className="table num ar-compact">
                <thead>
                  <tr>
                    <th scope="col">{tr('Channel', 'Canal')}</th>
                    <th scope="col" className="right">
                      {tr('Sent', 'Enviados')}
                    </th>
                    <th scope="col" className="right">
                      {tr('Delivered', 'Entregados')}
                    </th>
                    <th scope="col" className="right">
                      {tr('Read', 'Leídos')}
                    </th>
                    <th scope="col" className="right">
                      {tr('Failed', 'Fallidos')}
                    </th>
                    <th scope="col" className="right">
                      {tr('Median', 'Mediana')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.id}>
                      <th scope="row" className="ar-rowhead">
                        {channelName(d.id, tr)}
                      </th>
                      <td className="right">{d.sent}</td>
                      <Num v={d.delivered} />
                      <Num v={d.read} />
                      <td className={`right${d.failed ? ' ar-failed' : ''}`} style={d.failed === null ? { color: 'var(--muted)' } : undefined}>
                        {d.failed ?? '–'}
                      </td>
                      <td className="right ar-nowrap" style={d.median === '–' ? { color: 'var(--muted)' } : undefined}>
                        {d.median}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="ar-note">
              {tr(
                "SMS has no read receipts. Failed alerts are resent on the recipient's next channel.",
                'SMS no tiene confirmación de lectura. Las alertas fallidas se reenvían por el siguiente canal del destinatario.',
              )}
              {testCount > 0 &&
                ` ${tr(
                  `Includes ${testCount} test and verification message${testCount === 1 ? '' : 's'} sent from this page.`,
                  `Incluye ${testCount} mensaje${testCount === 1 ? '' : 's'} de prueba y verificación enviado${testCount === 1 ? '' : 's'} desde esta página.`,
                )}`}
            </p>
            {recentRuns.map((run) => (
              <RunResult key={run.id} run={run} msgs={delivery.msgs.filter((m) => m.runId === run.id)} tr={tr} fleetName={(id) => fleet.convoyById(id)?.name ?? id} />
            ))}
            <div className="ar-card-foot">
              <button type="button" className="btn" onClick={() => setTestOpen(true)}>
                <Icon name="send" size={15} /> {tr('Send test alert', 'Enviar alerta de prueba')}
              </button>
            </div>
          </Card>
        </div>
      </div>

      {dirty && (
        <div className="ar-savebar" role="region" aria-label={tr('Unsaved changes', 'Cambios sin guardar')}>
          <span className="ar-savebar__text">
            <strong>{tr('Unsaved changes', 'Cambios sin guardar')}</strong> · {changesText.join(', ')}
            {blocking.length > 0 && <span className="ar-savebar__warn"> · {blocking[0]}</span>}
          </span>
          <button type="button" className="btn" onClick={() => discard()}>
            {tr('Discard', 'Descartar')}
          </button>
          {canEdit && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={save}
              disabled={blocking.length > 0}
              title={blocking.length ? tr('Fix the escalation timers first', 'Corrija primero los temporizadores de escalamiento') : undefined}
            >
              {tr('Save changes', 'Guardar cambios')}
            </button>
          )}
        </div>
      )}

      <RecipientDialog
        key={recipientDlg ? `recipient-${recipientDlg.id ?? 'new'}` : 'recipient-closed'}
        open={!!recipientDlg}
        initial={recipientDlg?.id ? draft.recipients.find((r) => r.id === recipientDlg.id) : undefined}
        people={people}
        convoys={fleet.convoys.map((c) => ({ id: c.id, name: c.name }))}
        onClose={() => setRecipientDlg(null)}
        onSave={(r, contactChanged) => {
          const isNew = !draft.recipients.some((x) => x.id === r.id);
          patch((c) => ({
            ...c,
            recipients: isNew ? [...c.recipients, r] : c.recipients.map((x) => (x.id === r.id ? r : x)),
          }));
          if ((isNew || contactChanged) && !r.channels.includes('display')) setVerifyDraft((v) => ({ ...v, [r.id]: { state: 'unverified' } }));
          setRecipientDlg(null);
          toast(
            isNew
              ? tr(`${r.role} added to the draft. Save changes to apply.`, `${targetName(r.role, tr)} agregado al borrador. Guarde los cambios para aplicarlo.`)
              : tr(`${r.role} updated in the draft. Save changes to apply.`, `${targetName(r.role, tr)} actualizado en el borrador. Guarde los cambios para aplicarlo.`),
          );
        }}
        onRemove={(r) => {
          patch((c) => ({ ...c, recipients: c.recipients.filter((x) => x.id !== r.id) }));
          setRecipientDlg(null);
          toast(
            tr(
              `${r.role} · ${personName(r)} removed from the draft. Save changes to apply.`,
              `${targetName(r.role, tr)} · ${personName(r)} quitado del borrador. Guarde los cambios para aplicarlo.`,
            ),
          );
        }}
      />

      <TestDialog
        key={testOpen ? 'test-open' : 'test-closed'}
        open={testOpen}
        recipients={draft.recipients}
        templates={draft.templates}
        rules={draft.rules}
        people={people}
        personName={personName}
        linkUp={linkUp}
        convoyName={(id) => fleet.convoyById(id)?.name ?? id}
        bounced={(r) => verifyOf(r).state === 'bounced'}
        onClose={() => setTestOpen(false)}
        onSend={sendTest}
      />

      {leaveGuard}
    </div>
  );
}

// ---------- Small cells ----------

function Num({ v }: { v: number | null }) {
  return (
    <td className="right" style={v === null ? { color: 'var(--muted)' } : undefined}>
      {v ?? '–'}
    </td>
  );
}

function VerifyCell({ v, now, tr }: { v: VerifyView; now: number; tr: Tr }) {
  if (v.state === 'display') {
    return v.up ? (
      <span className="ar-verify ar-verify--ok">
        <Icon name="check" size={14} strokeWidth={2.4} />
        {tr(`Display reachable ${fmtTime(lastHealthAt(now))}`, `Pantalla accesible ${fmtTime(lastHealthAt(now))}`)}
      </span>
    ) : (
      <span className="ar-verify ar-verify--muted">
        <span className="dot dot--off" aria-hidden="true" />
        {tr(`Last seen ${v.lastSeen ? fmtTime(v.lastSeen) : '–'} · no link`, `Visto ${v.lastSeen ? fmtTime(v.lastSeen) : '–'} · sin enlace`)}
      </span>
    );
  }
  const day = v.at ? fmtDay(v.at) : '';
  switch (v.state) {
    case 'verified': {
      const what =
        v.what === 'numbers'
          ? tr('Numbers verified', 'Números verificados')
          : v.what === 'email'
            ? tr('Email verified', 'Correo verificado')
            : v.what === 'contact'
              ? tr('Contact verified', 'Contacto verificado')
              : tr('Number verified', 'Número verificado');
      return (
        <span className="ar-verify ar-verify--ok">
          <Icon name="check" size={14} strokeWidth={2.4} />
          {what} {day}
        </span>
      );
    }
    case 'bounced':
      return (
        <span className="ar-verify ar-verify--warn">
          <Icon name="alert" size={14} strokeWidth={2.2} />
          {tr(`Email bounced ${day}`, `Correo rebotado ${day}`)}
        </span>
      );
    case 'pending':
      return (
        <span className="ar-verify ar-verify--muted">
          <Icon name="clock" size={14} />
          {tr(`Verification sent ${v.at ? fmtTime(v.at) : ''} · waiting for reply`, `Verificación enviada ${v.at ? fmtTime(v.at) : ''} · esperando respuesta`)}
        </span>
      );
    case 'unverified':
      return <Badge tone="warn">{tr('Not verified', 'Sin verificar')}</Badge>;
  }
}

// ---------- RT-01 ladder ----------

function LadderCard({
  p,
  title,
  hint,
  steps,
  changed,
  editing,
  canEdit,
  onEdit,
  open,
  draftLadder,
  now,
}: {
  p: Priority;
  title: string;
  hint: string;
  steps: Step[];
  changed: boolean;
  editing: boolean;
  canEdit: boolean;
  onEdit: () => void;
  open: Alarm[];
  draftLadder: Step[];
  now: number;
}) {
  const tr = useTr();
  const id = `ar-${p.toLowerCase()}-title`;
  return (
    <article aria-labelledby={id} className={`ar-ladder${editing ? ' is-editing' : ''}`}>
      <div className="ar-ladder__head">
        <h3 id={id} className={`badge badge--${p.toLowerCase()}`}>
          {title}
        </h3>
        <span className="ar-ladder__hint">
          {changed && <span className="ar-changed">{tr('Edited', 'Editada')} · </span>}
          {hint}
        </span>
      </div>
      <ol className="ar-ladder__steps">
        {steps.map((s, i) => (
          <li key={s.id} className="ar-ladder__step">
            <span aria-hidden="true" className="ar-ladder__rail">
              <span className={`ar-ladder__dot${s.when === 'onboard' ? ' ar-ladder__dot--board' : ''}`} />
              {i < steps.length - 1 && <span className="ar-ladder__line" />}
            </span>
            <span className="ar-ladder__text">
              <span className="ar-ladder__when">{whenText(s, tr)}</span>
              <span className="ar-ladder__who">{targetName(s.target, tr)}</span>
              <span className="ar-ladder__detail">{stepDetailText(s, tr)}</span>
            </span>
          </li>
        ))}
      </ol>
      {open.length > 0 && (
        <div className="ar-inuse">
          <span className="ar-inuse__title">{tr('Open alarms on this ladder', 'Alarmas abiertas en esta escala')}</span>
          <ul>
            {open.map((a) => {
              const preview = changed ? nextOn(a, draftLadder) : undefined;
              const at = a.escalatesAt ? new Date(a.escalatesAt).getTime() : undefined;
              return (
                <li key={a.id}>
                  <Link to={`/alarms/${a.id}`} className="mono">
                    {a.id}
                  </Link>{' '}
                  {at && a.escalatesTo ? (
                    <span>
                      {tr(`next: ${a.escalatesTo.toLowerCase()} at ${fmtTimeSec(at)}`, `siguiente: ${roleEs(a.escalatesTo)} a las ${fmtTimeSec(at)}`)}
                      {at > now && <span className="ar-inuse__count"> · {tr('in', 'en')} {fmtCountdown(at - now)}</span>}
                    </span>
                  ) : (
                    <span className="ar-inuse__muted">{tr('no further step', 'sin más pasos')}</span>
                  )}
                  {preview && (preview.at !== at || preview.step?.target !== a.escalatesTo) && (
                    <span className="ar-changed ar-inuse__after">
                      {preview.step && preview.at
                        ? tr(
                            `after saving: ${preview.step.target.toLowerCase()} at ${fmtTimeSec(preview.at)}`,
                            `al guardar: ${roleEs(preview.step.target)} a las ${fmtTimeSec(preview.at)}`,
                          )
                        : tr('after saving: no further step', 'al guardar: sin más pasos')}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="ar-ladder__foot">
        {canEdit ? (
          <button type="button" className="ar-linkbtn" onClick={onEdit} aria-pressed={editing}>
            <Icon name="edit" size={15} /> {editing ? tr('Close editor', 'Cerrar editor') : tr('Edit', 'Editar')}
          </button>
        ) : (
          <span className="ar-inuse__muted">{tr('Read only', 'Solo lectura')}</span>
        )}
      </div>
    </article>
  );
}

function LadderEditor({
  p,
  onPick,
  steps,
  savedSteps,
  onChange,
  onDone,
}: {
  p: Priority;
  onPick: (p: Priority) => void;
  steps: Step[];
  savedSteps: Step[];
  onChange: (s: Step[]) => void;
  onDone: () => void;
}) {
  const tr = useTr();
  const prioName = usePriorityName();
  const problems = ladderProblems(steps, tr);
  const set = (i: number, patch: Partial<Step>) => onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...steps];
    const [s] = next.splice(i, 1);
    next.splice(i + d, 0, s);
    onChange(next);
  };
  const add = () => {
    const lastMin = steps.reduce((m, s) => (s.when === 'after' || s.when === 'unreviewed' ? Math.max(m, s.minutes) : m), 0);
    onChange([...steps, { id: newStepId(), when: 'after', minutes: lastMin + 5, target: 'Operations manager', channels: ['whatsapp'] }]);
  };

  return (
    <div className="ar-editor" aria-label={tr(`Edit ${p} escalation`, `Editar escalamiento ${p}`)} role="region">
      <div className="ar-editor__head">
        <div>
          <h3 className="ar-editor__title">{tr('Edit escalation ladder', 'Editar escala de escalamiento')}</h3>
          <p className="ar-note" style={{ padding: 0 }}>
            {tr(
              'Changes stay in the draft until you save. On-board steps work without the link. Timers count from when the alarm reaches shore.',
              'Los cambios quedan en el borrador hasta que guarde. Los pasos a bordo funcionan sin enlace. Los tiempos cuentan desde que la alarma llega a tierra.',
            )}
          </p>
        </div>
        <button type="button" className="btn" onClick={onDone}>
          <Icon name="check" size={15} /> {tr('Done', 'Listo')}
        </button>
      </div>
      <Tabs<Priority> label={tr('Priority', 'Prioridad')} value={p} onChange={onPick} tabs={PRIORITIES.map((x) => ({ value: x, label: prioName(x) }))} />
      <ol className="ar-editor__steps">
        {steps.map((s, i) => {
          const fid = `ar-${p}-${s.id}`;
          const fixed = !!FIXED_TARGETS[s.target];
          const timed = s.when === 'after' || s.when === 'unreviewed';
          const n = i + 1;
          return (
            <li key={s.id} className="ar-step-edit">
              <span className="ar-step-edit__n" aria-label={tr(`Step ${n}`, `Paso ${n}`)}>
                {n}
              </span>
              <div className="field ar-step-edit__when">
                <label htmlFor={`${fid}-when`}>{tr('When', 'Cuándo')}</label>
                <select
                  id={`${fid}-when`}
                  className="select"
                  value={s.when}
                  onChange={(e) => {
                    const when = e.target.value as Step['when'];
                    set(i, { when, minutes: when === 'after' || when === 'unreviewed' ? s.minutes || 5 : 0 });
                  }}
                >
                  {WHEN_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {whenOption(o.value, tr)}
                    </option>
                  ))}
                </select>
              </div>
              {timed && (
                <div className="field ar-step-edit__min">
                  <label htmlFor={`${fid}-min`}>{tr('Minutes', 'Minutos')}</label>
                  <input
                    id={`${fid}-min`}
                    className="input"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={240}
                    value={s.minutes}
                    onChange={(e) => set(i, { minutes: Math.max(0, Math.min(240, Number(e.target.value) || 0)) })}
                  />
                </div>
              )}
              <div className="field ar-step-edit__who">
                <label htmlFor={`${fid}-who`}>{tr('Who', 'Quién')}</label>
                <select
                  id={`${fid}-who`}
                  className="select"
                  value={s.target}
                  onChange={(e) => {
                    const target = e.target.value;
                    set(i, { target, channels: FIXED_TARGETS[target] ? [] : s.channels.length ? s.channels : ['whatsapp'] });
                  }}
                >
                  {ALL_TARGETS.map((t) => (
                    <option key={t} value={t}>
                      {targetName(t, tr)}
                    </option>
                  ))}
                </select>
              </div>
              <fieldset className="ar-step-edit__ch">
                <legend>{tr('Channels', 'Canales')}</legend>
                {fixed ? (
                  <span className="ar-step-edit__fixed">{fixedDetail(s.target, tr)}</span>
                ) : (
                  <span className="ar-step-edit__checks">
                    {CHANNELS.map((c) => (
                      <label key={c.id} className="check">
                        <input
                          type="checkbox"
                          checked={s.channels.includes(c.id)}
                          onChange={(e) =>
                            set(i, {
                              channels: e.target.checked ? CHANNELS.map((x) => x.id).filter((x) => x === c.id || s.channels.includes(x)) : s.channels.filter((x) => x !== c.id),
                            })
                          }
                        />
                        {channelName(c.id, tr)}
                      </label>
                    ))}
                  </span>
                )}
              </fieldset>
              <div className="ar-step-edit__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  aria-label={tr(`Move step ${n} up`, `Subir el paso ${n}`)}
                  disabled={i === 0}
                  title={i === 0 ? tr('Already the first step', 'Ya es el primer paso') : undefined}
                  onClick={() => move(i, -1)}
                >
                  <Icon name="chevronDown" size={18} style={{ transform: 'rotate(180deg)' }} />
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  aria-label={tr(`Move step ${n} down`, `Bajar el paso ${n}`)}
                  disabled={i === steps.length - 1}
                  title={i === steps.length - 1 ? tr('Already the last step', 'Ya es el último paso') : undefined}
                  onClick={() => move(i, 1)}
                >
                  <Icon name="chevronDown" size={18} />
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon ar-danger"
                  aria-label={tr(`Remove step ${n}`, `Quitar el paso ${n}`)}
                  disabled={steps.length === 1}
                  title={steps.length === 1 ? tr('A ladder needs at least one step', 'Una escala necesita al menos un paso') : undefined}
                  onClick={() => onChange(steps.filter((_, j) => j !== i))}
                >
                  <Icon name="trash" size={17} />
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      {problems.length > 0 && (
        <div className="callout callout--warn" role="alert">
          <Icon name="alert" size={18} />
          <span>
            {problems.map((m) => (
              <span key={m} style={{ display: 'block' }}>
                {m}
              </span>
            ))}
          </span>
        </div>
      )}
      <div className="ar-editor__foot">
        <button
          type="button"
          className="btn"
          onClick={add}
          disabled={steps.length >= 8}
          title={steps.length >= 8 ? tr('At most 8 steps: remove one to add another', 'Como máximo 8 pasos: quite uno para agregar otro') : undefined}
        >
          <Icon name="plus" size={16} /> {tr('Add step', 'Agregar paso')}
        </button>
        {!same(steps, savedSteps) && (
          <button type="button" className="btn btn--ghost" onClick={() => onChange(savedSteps)}>
            {tr(`Undo ${p} changes`, `Deshacer cambios en ${p}`)}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- RT-03 rota ----------

function RotaCard({
  now,
  rota,
  people,
  editing,
  canEdit,
  changed,
  onToggleEdit,
  onChange,
}: {
  now: number;
  rota: RoutingConfig['rota'];
  people: User[];
  editing: boolean;
  canEdit: boolean;
  changed: boolean;
  onToggleEdit: () => void;
  onChange: (date: number, shift: 'day' | 'night', userId: string) => void;
}) {
  const tr = useTr();
  const userById = (id: string) => people.find((u) => u.id === id);
  const h = Number(fmtTime(now).slice(0, 2));
  const today = Number(fmtDay(now).split(' ')[0]);
  const shift: 'day' | 'night' = h >= 7 && h < 19 ? 'day' : 'night';
  const rotaDate = h < 7 ? today - 1 : today;
  const cur = rota.find((d) => d.date === rotaDate);
  const onNow = cur ? userById(cur[shift]) : undefined;
  const next = shift === 'day' ? cur && userById(cur.night) : userById(rota.find((d) => d.date === rotaDate + 1)?.day ?? '');
  const eligible = people.filter((u) => u.role !== 'master' && u.role !== 'tenant_admin' && u.status !== 'suspended');
  const flag = (u?: User) =>
    !u ? tr(' · removed', ' · eliminado') : u.status === 'suspended' ? tr(' · suspended', ' · suspendido') : u.status === 'invited' ? tr(' · invited', ' · invitado') : '';
  const first = rota[0]?.label;
  const last = rota[rota.length - 1]?.label;

  return (
    <section className="card" aria-labelledby="ar-rota-title">
      <div className="card__head">
        <div className="ar-head-stack">
          <h2 id="ar-rota-title">{tr('Duty officer rota · this week', 'Rota de oficiales de guardia · esta semana')}</h2>
          <span className="card__hint">
            {changed && <span className="ar-changed">{tr('Edited', 'Editada')} · </span>}
            {first && last ? tr(`${first} to ${last} Oct`, `${dayLabel(first, tr)} a ${dayLabel(last, tr)} oct`) : ''}
          </span>
        </div>
        {canEdit && (
          <button type="button" className="ar-linkbtn" onClick={onToggleEdit} aria-pressed={editing}>
            {editing ? tr('Done', 'Listo') : tr('Edit rota', 'Editar rota')}
          </button>
        )}
      </div>
      <div className="ar-rota-now" aria-live="polite">
        <span className={`dot${onNow && onNow.status === 'active' ? '' : ' dot--warn'}`} aria-hidden="true" />
        <span>
          <strong>
            {tr('On duty now', 'De guardia ahora')}: {onNow?.name ?? tr('Nobody', 'Nadie')}
            {onNow && onNow.status !== 'active' && flag(onNow)}
          </strong>
          <span className="ar-rota-now__sub">
            {shift === 'day' ? tr('Day shift until 19:00', 'Turno de día hasta las 19:00') : tr('Night shift until 07:00', 'Turno de noche hasta las 07:00')}
            {next && tr(` · then ${next.name}`, ` · luego ${next.name}`)}
          </span>
        </span>
      </div>
      <div className="table-wrap">
        <table className="table num ar-compact ar-rota">
          <thead>
            <tr>
              <th scope="col">{tr('Day', 'Día')}</th>
              <th scope="col">07:00–19:00</th>
              <th scope="col">19:00–07:00</th>
            </tr>
          </thead>
          <tbody>
            {rota.map((d) => {
              const isToday = d.date === today;
              return (
                <tr key={d.date} className={isToday ? 'is-today' : undefined} aria-current={isToday ? 'date' : undefined}>
                  <th scope="row" className="ar-rowhead ar-rota__day">
                    <span style={isToday ? { fontWeight: 600, color: 'var(--ink)' } : undefined}>{dayLabel(d.label, tr)}</span>
                    {isToday && <span className="ar-today">{tr('Today', 'Hoy')}</span>}
                  </th>
                  {(['day', 'night'] as const).map((s) => {
                    const u = userById(d[s]);
                    const live = d.date === rotaDate && s === shift;
                    const options = u && !eligible.includes(u) ? [u, ...eligible] : eligible;
                    return (
                      <td key={s} className="ar-nowrap" style={isToday ? { fontWeight: 600 } : undefined}>
                        {editing ? (
                          <select
                            className="select ar-rota__select"
                            aria-label={`${dayLabel(d.label, tr)}, ${s === 'day' ? tr('07:00 to 19:00', '07:00 a 19:00') : tr('19:00 to 07:00', '19:00 a 07:00')}`}
                            value={u ? d[s] : ''}
                            onChange={(e) => onChange(d.date, s, e.target.value)}
                          >
                            {!u && <option value="">{tr('Choose…', 'Elija…')}</option>}
                            {options.map((x) => (
                              <option key={x.id} value={x.id} disabled={x.status === 'suspended'}>
                                {x.name}
                                {flag(x)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <>
                            {u?.name ?? '–'}
                            {u && u.status !== 'active' && <span className="ar-flag ar-flag--bad">{flag(u)}</span>}
                            {live && <span className="ar-onnow">{tr('On now', 'Ahora')}</span>}
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------- RT-03 delivery rules ----------

const HOURS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);

function RulesCard({
  rules,
  editing,
  canEdit,
  changed,
  onToggleEdit,
  onChange,
}: {
  rules: Rules;
  editing: boolean;
  canEdit: boolean;
  changed: boolean;
  onToggleEdit: () => void;
  onChange: (r: Partial<Rules>) => void;
}) {
  const tr = useTr();
  const langOpt = (l: Rules['language']) =>
    l === 'recipient'
      ? tr("Recipient's language, Spanish by default", 'Idioma del destinatario, español por defecto')
      : l === 'es'
        ? tr('Spanish for everyone', 'Español para todos')
        : tr('English for everyone', 'Inglés para todos');
  const rows: { key: string; dt: string; view: ReactNode; edit?: ReactNode }[] = [
    {
      key: 'lang',
      dt: tr('Message language', 'Idioma del mensaje'),
      view: langOpt(rules.language),
      edit: (
        <select className="select" aria-label={tr('Message language', 'Idioma del mensaje')} value={rules.language} onChange={(e) => onChange({ language: e.target.value as Rules['language'] })}>
          {(['recipient', 'es', 'en'] as const).map((l) => (
            <option key={l} value={l}>
              {langOpt(l)}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: 'rem',
      dt: tr('Reminders', 'Recordatorios'),
      view: tr(
        `Every ${rules.reminderEvery} min until acknowledged, max ${rules.reminderMax}`,
        `Cada ${rules.reminderEvery} min hasta que se confirme, máximo ${rules.reminderMax}`,
      ),
      edit: (
        <span className="ar-inline-fields">
          <label>
            {tr('Every', 'Cada')}
            <select className="select" value={rules.reminderEvery} onChange={(e) => onChange({ reminderEvery: Number(e.target.value) })}>
              {[1, 2, 3, 5].map((n) => (
                <option key={n} value={n}>
                  {n} min
                </option>
              ))}
            </select>
          </label>
          <label>
            {tr('at most', 'como máximo')}
            <select className="select" value={rules.reminderMax} onChange={(e) => onChange({ reminderMax: Number(e.target.value) })}>
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </span>
      ),
    },
    {
      key: 'rate',
      dt: tr('Rate limit', 'Límite de envío'),
      view: rules.rateLimit
        ? tr('1 message per person per alarm per channel', '1 mensaje por persona, alarma y canal')
        : tr('Off · every reminder is a new message', 'Desactivado · cada recordatorio es un mensaje nuevo'),
      edit: (
        <label className="switch">
          <input type="checkbox" checked={rules.rateLimit} onChange={(e) => onChange({ rateLimit: e.target.checked })} />
          {tr('1 message per person per alarm per channel', '1 mensaje por persona, alarma y canal')}
        </label>
      ),
    },
    {
      key: 'quiet',
      dt: tr('Quiet hours', 'Horas de silencio'),
      view: tr(`None for P1 and P2 · P3 digests ${rules.digestFrom}–${rules.digestTo}`, `Ninguna para P1 y P2 · resúmenes P3 ${rules.digestFrom}–${rules.digestTo}`),
      edit: (
        <span className="ar-inline-fields">
          <span>{tr('None for P1 and P2 · P3 digests', 'Ninguna para P1 y P2 · resúmenes P3')}</span>
          <label>
            <span className="sr-only">{tr('Digests from', 'Resúmenes desde')}</span>
            <select className="select" value={rules.digestFrom} onChange={(e) => onChange({ digestFrom: e.target.value })}>
              {HOURS.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          {tr('to', 'a')}
          <label>
            <span className="sr-only">{tr('Digests until', 'Resúmenes hasta')}</span>
            <select className="select" value={rules.digestTo} onChange={(e) => onChange({ digestTo: e.target.value })}>
              {HOURS.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
        </span>
      ),
    },
    {
      key: 'phone',
      dt: tr('Phone page', 'Página en el teléfono'),
      view: (
        <>
          {tr('Opens the alarm with a 15 s clip; every open is logged', 'Abre la alarma con un clip de 15 s; cada apertura se registra')} ·{' '}
          <Link to="/m/alarm/ALM-26-0318">{tr('Open sample', 'Abrir ejemplo')}</Link>
        </>
      ),
    },
  ];

  return (
    <section className="card" aria-labelledby="ar-rules-title">
      <div className="card__head">
        <div className="card__title">
          <h2 id="ar-rules-title">{tr('Delivery rules', 'Reglas de entrega')}</h2>
          {changed && <span className="card__hint ar-changed">{tr('Edited', 'Editadas')}</span>}
        </div>
        {canEdit && (
          <button type="button" className="ar-linkbtn" onClick={onToggleEdit} aria-pressed={editing}>
            {editing ? tr('Done', 'Listo') : tr('Edit', 'Editar')}
          </button>
        )}
      </div>
      <dl className="ar-rules">
        {rows.map((r) => (
          <div key={r.key}>
            <dt>{r.dt}</dt>
            <dd>{editing && r.edit ? r.edit : r.view}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// ---------- RT-04 template ----------

const PLACEHOLDER_ES: Record<string, string> = {
  priority: 'Prioridad',
  use_case: 'Caso de uso',
  vessel: 'Embarcación',
  camera: 'Cámara',
  time: 'Hora',
  onboard_status: 'Estado a bordo',
  alarm_id: 'ID de alarma',
  link: 'Enlace al clip',
};

function renderTemplate(tpl: string, vals: Record<string, string>): ReactNode[] {
  return tpl.split('\n').map((line, li) => {
    const parts = line.split(/(\{[a-z_]+\})/g);
    const prioAt = parts.findIndex((x) => x === '{priority}');
    const nodes = parts.map((part, i) => {
      const m = /^\{([a-z_]+)\}$/.exec(part);
      if (!m) return <Fragment key={i}>{part}</Fragment>;
      const key = m[1];
      if (!(key in vals))
        return (
          <mark key={i} className="ar-preview__unknown">
            {part}
          </mark>
        );
      if (key === 'link')
        return (
          <Link key={i} to={`/m/alarm/${vals.alarm_id}`} className="mono ar-preview__link">
            {vals.link}
          </Link>
        );
      return <Fragment key={i}>{vals[key]}</Fragment>;
    });
    return (
      <span key={li} className="ar-preview__line">
        {prioAt >= 0 ? (
          <>
            <strong className="ar-preview__prio">{nodes.slice(0, prioAt + 1)}</strong>
            {nodes.slice(prioAt + 1)}
          </>
        ) : (
          nodes
        )}
        {!line && ' '}
      </span>
    );
  });
}

function fillTemplate(tpl: string, vals: Record<string, string>) {
  return tpl.replace(/\{([a-z_]+)\}/g, (all, k: string) => vals[k] ?? all);
}

function TemplateCard({
  templates,
  savedTemplates,
  lang,
  setLang,
  editing,
  canEdit,
  onToggleEdit,
  onChange,
  onReset,
  sentNote,
}: {
  templates: Record<TplLang, string>;
  savedTemplates: Record<TplLang, string>;
  lang: TplLang;
  setLang: (l: TplLang) => void;
  editing: boolean;
  canEdit: boolean;
  onToggleEdit: () => void;
  onChange: (lang: TplLang, text: string) => void;
  onReset: (lang: TplLang) => void;
  sentNote?: string;
}) {
  const tr = useTr();
  const ta = useRef<HTMLTextAreaElement>(null);
  const tpl = templates[lang];
  const vals = sampleValues[lang];
  const text = fillTemplate(tpl, vals);
  const used = new Set([...tpl.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]));
  const unknown = [...used].filter((k) => !(k in vals));
  const unicode = /[^\x20-\x7E\n]/.test(text);
  const per = unicode ? 70 : 160;
  const parts = text.length <= per ? 1 : Math.ceil(text.length / (unicode ? 67 : 153));
  const changed = templates[lang] !== savedTemplates[lang];
  const phLabel = (p: { key: string; label: string }) => tr(p.label, PLACEHOLDER_ES[p.key] ?? p.label);

  const insert = (key: string) => {
    const el = ta.current;
    const token = `{${key}}`;
    if (!el) return onChange(lang, tpl + token);
    const a = el.selectionStart ?? tpl.length;
    const b = el.selectionEnd ?? a;
    onChange(lang, tpl.slice(0, a) + token + tpl.slice(b));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + token.length, a + token.length);
    });
  };

  const langName = lang === 'es' ? tr('Spanish', 'Español') : tr('English', 'Inglés');

  return (
    <section className="card" aria-labelledby="ar-tpl-title">
      <div className="card__head">
        <div className="card__title">
          <h2 id="ar-tpl-title">{tr('Message template', 'Plantilla del mensaje')}</h2>
          <span className="card__hint">
            {changed && <span className="ar-changed">{tr('Edited', 'Editada')} · </span>}
            {tr(`${langName} · WhatsApp and SMS · shown with the open P2`, `${langName} · WhatsApp y SMS · se muestra con la P2 abierta`)}
          </span>
        </div>
        {canEdit && (
          <button type="button" className="ar-linkbtn" onClick={onToggleEdit} aria-pressed={editing}>
            {editing ? tr('Done', 'Listo') : tr('Edit template', 'Editar plantilla')}
          </button>
        )}
      </div>
      <div className="ar-tpl">
        <div className="ar-tpl__main">
          <div className="ar-tpl__bar">
            <Segmented<TplLang>
              label={tr('Template language', 'Idioma de la plantilla')}
              value={lang}
              onChange={setLang}
              options={[
                { value: 'es', label: tr('ES · Spanish', 'ES · Español') },
                { value: 'en', label: tr('EN · English', 'EN · Inglés') },
              ]}
            />
            <span className="ar-note" style={{ padding: 0 }}>
              {tr("Sent in the recipient's language; Spanish when none is set.", 'Se envía en el idioma del destinatario; en español si no tiene uno.')}
            </span>
          </div>

          {editing && (
            <div className="field">
              <label htmlFor="ar-tpl-text">{tr(`Template, ${langName}`, `Plantilla, ${langName.toLowerCase()}`)}</label>
              <textarea
                id="ar-tpl-text"
                ref={ta}
                className="textarea mono ar-tpl__textarea"
                rows={5}
                value={tpl}
                lang={lang}
                onChange={(e) => onChange(lang, e.target.value)}
                aria-describedby="ar-tpl-help"
              />
              <div className="ar-tpl__insert" role="group" aria-label={tr('Insert a placeholder', 'Insertar un campo')}>
                {PLACEHOLDERS.map((p) => (
                  <button key={p.key} type="button" className="ar-ph" onClick={() => insert(p.key)} title={tr(`Insert ${p.label}`, `Insertar ${phLabel(p).toLowerCase()}`)}>
                    {`{${p.key}}`}
                  </button>
                ))}
              </div>
              <span id="ar-tpl-help" className="field__hint">
                {tr(
                  `Placeholders are filled in for each alarm. ${text.length} characters · SMS in ${parts} part${parts === 1 ? '' : 's'}${unicode ? ' (accented text uses 70 characters per part)' : ''}.`,
                  `Los campos se completan para cada alarma. ${text.length} caracteres · SMS en ${parts} parte${parts === 1 ? '' : 's'}${unicode ? ' (el texto con acentos usa 70 caracteres por parte)' : ''}.`,
                )}
                {changed && (
                  <button type="button" className="ar-inline-btn" onClick={() => onReset(lang)}>
                    {tr('Undo template changes', 'Deshacer cambios en la plantilla')}
                  </button>
                )}
              </span>
              {(unknown.length > 0 || !used.has('link')) && (
                <div className="callout callout--warn" role="alert">
                  <Icon name="alert" size={18} />
                  <span>
                    {unknown.length > 0 && (
                      <span style={{ display: 'block' }}>
                        {tr('Unknown placeholder', 'Campo desconocido')}: {unknown.map((k) => `{${k}}`).join(', ')}
                      </span>
                    )}
                    {!used.has('link') && (
                      <span style={{ display: 'block' }}>
                        {tr(
                          'Add {link} so recipients can open the clip and acknowledge.',
                          'Agregue {link} para que los destinatarios puedan abrir el clip y confirmar.',
                        )}
                      </span>
                    )}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="ar-preview" aria-label={tr(`Preview, ${langName}`, `Vista previa, ${langName.toLowerCase()}`)} aria-live="polite" lang={lang}>
            {renderTemplate(tpl, vals)}
          </div>
          {sentNote && (
            <span className="ar-sentnote">
              <span className="dot" aria-hidden="true" />
              {sentNote}
            </span>
          )}
        </div>
        <dl className="ar-tpl__meta">
          <div>
            <dt>{tr('Fields filled in for each alarm', 'Campos que se completan en cada alarma')}</dt>
            <dd className="ar-chips">
              {PLACEHOLDERS.filter((p) => used.has(p.key)).map((p) => (
                <Badge key={p.key}>{phLabel(p)}</Badge>
              ))}
            </dd>
          </div>
          <div>
            <dt>{tr('Email subject', 'Asunto del correo')}</dt>
            <dd lang={lang}>{emailSubject[lang]}</dd>
          </div>
          <div>
            <dt>{tr('Clip page', 'Página del clip')}</dt>
            <dd>{tr('Faces blurred for recipients outside GFSA · every open is logged', 'Rostros difuminados para destinatarios fuera de GFSA · cada apertura se registra')}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

// ---------- RT-05 test and verification results ----------

function statusText(m: DeliveryMsg, kind: DeliveryRun['kind'], tr: Tr, convoyName: (id: string) => string): string {
  const secs = secsOf(m);
  const s = secs !== undefined ? ` · ${secs} s` : '';
  switch (m.status) {
    case 'queued':
      return tr(`Queued · ${convoyName(m.waitConvoy ?? '')} has no link`, `En cola · ${convoyName(m.waitConvoy ?? '')} sin enlace`);
    case 'sent':
      return tr('Sent', 'Enviado');
    case 'delivered':
      return (m.channel === 'call' ? tr('Answered', 'Atendida') : tr('Delivered', 'Entregado')) + s;
    case 'read':
      return (kind === 'verify' ? tr('Confirmed', 'Confirmado') : tr('Read', 'Leído')) + s;
    case 'failed':
      return tr('Failed · bounced', 'Falló · rebotado') + s;
  }
}

function RunResult({ run, msgs, tr, fleetName }: { run: DeliveryRun; msgs: DeliveryMsg[]; tr: Tr; fleetName: (id: string) => string }) {
  const to = run.to === 'On-call rota' ? tr('On-call rota', 'Rota de guardia') : run.to === 'Removed user' ? tr('Removed user', 'Usuario eliminado') : run.to;
  return (
    <div className="ar-test" aria-live="polite">
      <span className="ar-test__title">
        {run.kind === 'test' ? tr('Test alert', 'Alerta de prueba') : tr('Verification', 'Verificación')} {fmtTimeSec(run.at)} · {to} · {targetName(run.role, tr)}
        {run.kind === 'test' && ` · ${run.lang.toUpperCase()}`}
      </span>
      <ul>
        {msgs.map((c) => (
          <li key={c.id}>
            <span>{channelName(c.channel, tr)}</span>
            <Badge tone={c.status === 'failed' ? 'bad' : c.status === 'queued' || c.status === 'sent' ? 'neutral' : 'ok'}>
              {c.status === 'failed' && <Icon name="alert" size={12} />}
              {statusText(c, run.kind, tr, fleetName)}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Dialogs ----------

function RecipientDialog({
  open,
  initial,
  people,
  convoys,
  onClose,
  onSave,
  onRemove,
}: {
  open: boolean;
  initial?: Recipient;
  people: User[];
  convoys: { id: string; name: string }[];
  onClose: () => void;
  onSave: (r: Recipient, contactChanged: boolean) => void;
  onRemove: (r: Recipient) => void;
}) {
  const tr = useTr();
  const [r, setR] = useState<Recipient>(
    initial ?? {
      id: uid('rcp'),
      role: 'Duty officer',
      shift: '',
      scope: 'all',
      p1Only: false,
      personId: '',
      channels: ['whatsapp', 'sms'],
      hours: '24 h',
      phone: '',
      email: '',
    },
  );
  const [tried, setTried] = useState(false);
  const isMaster = r.role === 'Master';
  const isRota = r.role === 'GFSA management';
  const roleId = RECIPIENT_ROLE_ID[r.role];
  const candidates = people.filter((u) => (isMaster ? u.role === 'master' : u.role !== 'master' && u.role !== 'tenant_admin'));
  const withRole = roleId && !isMaster ? candidates.filter((u) => u.role === roleId) : [];
  const others = candidates.filter((u) => !withRole.includes(u));
  const msgChannels = r.channels.filter((c): c is ChannelId => c !== 'display');
  const picked = people.find((u) => u.id === r.personId);

  const errors: string[] = [];
  if (!isRota && !r.personId) errors.push(tr('Choose a person.', 'Elija una persona.'));
  if (r.personId && !picked) errors.push(tr('This person is no longer in Users and roles. Choose someone else.', 'Esta persona ya no está en Usuarios y roles. Elija a otra.'));
  if (picked?.status === 'suspended')
    errors.push(
      tr(
        `${picked.name} is suspended in Users and roles. Choose someone else or reactivate them there first.`,
        `${picked.name} está suspendido en Usuarios y roles. Elija a otra persona o reactívelo allí primero.`,
      ),
    );
  if (!isMaster && msgChannels.length === 0) errors.push(tr('Choose at least one channel.', 'Elija al menos un canal.'));
  if (!isMaster && msgChannels.some((c) => c !== 'email') && !r.phone?.trim()) errors.push(tr('Add a phone number for WhatsApp, SMS or calls.', 'Agregue un teléfono para WhatsApp, SMS o llamadas.'));
  if (!isMaster && msgChannels.includes('email') && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email ?? '')) errors.push(tr('Add a valid email address.', 'Agregue un correo válido.'));

  const set = (p: Partial<Recipient>) => setR((x) => ({ ...x, ...p }));

  const submit = () => {
    setTried(true);
    if (errors.length) return;
    const changed = !!initial && (initial.phone !== r.phone || initial.email !== r.email || initial.personId !== r.personId);
    onSave({ ...r, rotaLabel: isRota && !r.personId ? 'Rota · 2 people' : undefined }, changed);
  };

  const opt = (u: User) => (
    <option key={u.id} value={u.id} disabled={u.status === 'suspended' && u.id !== initial?.personId}>
      {u.name}
      {u.status === 'suspended' ? tr(' · suspended', ' · suspendido') : u.status === 'invited' ? tr(' · invited', ' · invitado') : ''}
    </option>
  );

  return (
    <PageDialog
      open={open}
      onClose={onClose}
      title={initial ? tr(`Edit recipient · ${initial.role}`, `Editar destinatario · ${targetName(initial.role, tr)}`) : tr('Add recipient', 'Agregar destinatario')}
      sub={tr(
        'People come from Users and roles. Contacts must be verified with a test message before alarms are sent to them.',
        'Las personas vienen de Usuarios y roles. Los contactos deben verificarse con un mensaje de prueba antes de recibir alarmas.',
      )}
      footer={
        <>
          {initial && (
            <button type="button" className="btn pdlg__spacer ar-danger" onClick={() => onRemove(initial)}>
              <Icon name="trash" size={16} /> {tr('Remove', 'Quitar')}
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            {tr('Cancel', 'Cancelar')}
          </button>
          <button type="button" className="btn btn--primary" onClick={submit}>
            {initial ? tr('Update draft', 'Actualizar borrador') : tr('Add to draft', 'Agregar al borrador')}
          </button>
        </>
      }
    >
      <div className="pdlg__grid">
        <div className="field">
          <label htmlFor="ar-r-role">{tr('Role', 'Rol')}</label>
          <select
            id="ar-r-role"
            className="select"
            value={r.role}
            onChange={(e) => {
              const role = e.target.value;
              set({
                role,
                personId: '',
                channels: role === 'Master' ? ['display'] : msgChannels.length ? msgChannels : ['whatsapp', 'sms'],
                scope: role === 'Master' && r.scope === 'all' ? (convoys[0]?.id ?? 'all') : r.scope,
                shift: role === 'GFSA management' ? 'On call' : r.shift,
                hours: role === 'GFSA management' ? 'On-call rota' : r.hours,
              });
            }}
          >
            {RECIPIENT_ROLES.map((x) => (
              <option key={x} value={x}>
                {targetName(x, tr)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ar-r-person">{tr('Person', 'Persona')}</label>
          <select
            id="ar-r-person"
            className="select"
            value={r.personId}
            onChange={(e) => {
              const u = people.find((x) => x.id === e.target.value);
              set({ personId: e.target.value, email: r.email?.trim() ? r.email : (u?.email ?? '') });
            }}
          >
            <option value="">{isRota ? tr('On-call rota · 2 people', 'Rota de guardia · 2 personas') : tr('Choose…', 'Elija…')}</option>
            {r.personId && !picked && <option value={r.personId}>{tr('Removed user', 'Usuario eliminado')}</option>}
            {withRole.length > 0 && <optgroup label={tr('With this role', 'Con este rol')}>{withRole.map(opt)}</optgroup>}
            {others.length > 0 &&
              (withRole.length > 0 ? <optgroup label={tr('Other users', 'Otros usuarios')}>{others.map(opt)}</optgroup> : others.map(opt))}
          </select>
          <span className="field__hint">
            {picked?.status === 'invited'
              ? tr('Invited, has not signed in yet · alerts still reach them', 'Invitado, aún no inició sesión · igual recibe alertas')
              : tr('Suspended users cannot be picked', 'No se puede elegir a usuarios suspendidos')}
          </span>
        </div>
        <div className="field">
          <label htmlFor="ar-r-scope">{tr('Vessels', 'Embarcaciones')}</label>
          <select id="ar-r-scope" className="select" value={r.scope} onChange={(e) => set({ scope: e.target.value })}>
            {!isMaster && <option value="all">{tr('All convoys', 'Todos los convoyes')}</option>}
            {convoys.map((c) => (
              <option key={c.id} value={c.id}>
                {tr(`${c.name} convoy`, `Convoy ${c.name}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ar-r-shift">{tr('Shift', 'Turno')}</label>
          <select id="ar-r-shift" className="select" value={r.shift} onChange={(e) => set({ shift: e.target.value as Shift })}>
            {(['', 'Day shift', 'Night shift', 'On call'] as Shift[]).map((s) => (
              <option key={s} value={s}>
                {shiftName(s, tr)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ar-r-hours">{tr('Hours', 'Horario')}</label>
          <select id="ar-r-hours" className="select" value={r.hours} onChange={(e) => set({ hours: e.target.value })}>
            {HOURS_OPTIONS.map((h) => (
              <option key={h} value={h}>
                {hoursName(h, tr)}
              </option>
            ))}
          </select>
        </div>
        <label className="check" style={{ alignSelf: 'end' }}>
          <input type="checkbox" checked={r.p1Only} onChange={(e) => set({ p1Only: e.target.checked })} />
          {tr('P1 alarms only', 'Solo alarmas P1')}
        </label>
      </div>

      <fieldset>
        <legend>{tr('Channels', 'Canales')}</legend>
        {isMaster ? (
          <p className="ar-note" style={{ padding: 0 }}>
            {tr('Masters are alerted on the wheelhouse display, which works without the link.', 'Los capitanes reciben la alerta en la pantalla del puente, que funciona sin enlace.')}
          </p>
        ) : (
          <div className="pdlg__checks">
            {CHANNELS.map((c) => (
              <label key={c.id} className="check">
                <input
                  type="checkbox"
                  checked={msgChannels.includes(c.id)}
                  onChange={(e) =>
                    set({
                      channels: e.target.checked ? CHANNELS.map((x) => x.id).filter((x) => x === c.id || msgChannels.includes(x)) : msgChannels.filter((x) => x !== c.id),
                    })
                  }
                />
                {channelName(c.id, tr)}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      {!isMaster && (
        <div className="pdlg__grid">
          <div className="field">
            <label htmlFor="ar-r-phone">{tr('Phone (WhatsApp, SMS, calls)', 'Teléfono (WhatsApp, SMS, llamadas)')}</label>
            <input
              id="ar-r-phone"
              className="input"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={r.phone ?? ''}
              onChange={(e) => set({ phone: e.target.value })}
              placeholder="+595 9xx xxx xxx"
            />
          </div>
          <div className="field">
            <label htmlFor="ar-r-email">{tr('Email', 'Correo')}</label>
            <input
              id="ar-r-email"
              className="input"
              type="email"
              autoComplete="off"
              value={r.email ?? ''}
              onChange={(e) => set({ email: e.target.value })}
              placeholder={tr('name@gfsa.example', 'nombre@gfsa.example')}
            />
          </div>
        </div>
      )}
      {tried && errors.length > 0 && (
        <div className="pdlg__error" role="alert">
          {errors.map((e) => (
            <span key={e} style={{ display: 'block' }}>
              {e}
            </span>
          ))}
        </div>
      )}
      {initial && (
        <p className="ar-note" style={{ padding: 0 }}>
          {tr('Changing the person or contact details marks the contact as not verified.', 'Cambiar la persona o los datos de contacto marca el contacto como sin verificar.')}
        </p>
      )}
    </PageDialog>
  );
}

function TestDialog({
  open,
  recipients,
  templates,
  rules,
  people,
  personName,
  linkUp,
  convoyName,
  bounced,
  onClose,
  onSend,
}: {
  open: boolean;
  recipients: Recipient[];
  templates: Record<TplLang, string>;
  rules: Rules;
  people: User[];
  personName: (r: Recipient) => string;
  linkUp: (convoyId: string) => boolean;
  convoyName: (id: string) => string;
  bounced: (r: Recipient) => boolean;
  onClose: () => void;
  onSend: (r: Recipient, chans: RecipientChannel[], lang: TplLang) => void;
}) {
  const tr = useTr();
  const langFor = (x?: Recipient): Lang =>
    rules.language !== 'recipient' ? rules.language : ((x?.personId && people.find((u) => u.id === x.personId)?.language) || 'es');
  const [rid, setRid] = useState(recipients[0]?.id ?? '');
  const r = recipients.find((x) => x.id === rid);
  const [chans, setChans] = useState<RecipientChannel[]>(r?.channels ?? []);
  const [lang, setLang] = useState<TplLang>(langFor(r));
  const user = r?.personId ? people.find((u) => u.id === r.personId) : undefined;
  const suspended = user?.status === 'suspended';
  const removed = !!r?.personId && !user;

  const pick = (id: string) => {
    setRid(id);
    const nr = recipients.find((x) => x.id === id);
    setChans(nr?.channels ?? []);
    setLang(langFor(nr));
  };

  const blockedWhy = !r
    ? tr('Add a recipient first', 'Agregue primero un destinatario')
    : suspended
      ? tr(`${user?.name} is suspended: reactivate them in Users and roles to send to them`, `${user?.name} está suspendido: reactívelo en Usuarios y roles para enviarle`)
      : removed
        ? tr('This person was removed from Users and roles: choose another person for this recipient', 'Esta persona fue eliminada de Usuarios y roles: elija otra para este destinatario')
        : chans.length === 0
          ? tr('Tick at least one channel', 'Marque al menos un canal')
          : undefined;

  return (
    <PageDialog
      open={open}
      onClose={onClose}
      title={tr('Send test alert', 'Enviar alerta de prueba')}
      sub={tr(
        'Goes through the real channels, marked TEST. No alarm is opened and nothing escalates. Uses the template as it is in the draft.',
        'Se envía por los canales reales, marcada PRUEBA. No se abre ninguna alarma y nada se escala. Usa la plantilla tal como está en el borrador.',
      )}
      footer={
        <>
          {blockedWhy && <span className="pdlg__spacer ar-note" style={{ padding: 0 }}>{blockedWhy}</span>}
          <button type="button" className="btn" onClick={onClose}>
            {tr('Cancel', 'Cancelar')}
          </button>
          <button type="button" className="btn btn--primary" disabled={!!blockedWhy} onClick={() => r && onSend(r, chans, lang)}>
            <Icon name="send" size={16} /> {tr('Send test', 'Enviar prueba')}
          </button>
        </>
      }
    >
      <div className="pdlg__grid">
        <div className="field">
          <label htmlFor="ar-t-to">{tr('Recipient', 'Destinatario')}</label>
          <select id="ar-t-to" className="select" value={rid} onChange={(e) => pick(e.target.value)}>
            {recipients.map((x) => {
              const u = x.personId ? people.find((p) => p.id === x.personId) : undefined;
              return (
                <option key={x.id} value={x.id}>
                  {targetName(x.role, tr)} · {personName(x)}
                  {u?.status === 'suspended' ? tr(' · suspended', ' · suspendido') : ''}
                </option>
              );
            })}
          </select>
        </div>
        <div className="field">
          <span className="field__label" id="ar-t-lang">
            {tr('Language', 'Idioma')}
          </span>
          <Segmented<TplLang>
            label={tr('Test message language', 'Idioma del mensaje de prueba')}
            value={lang}
            onChange={setLang}
            options={[
              { value: 'es', label: tr('Spanish', 'Español') },
              { value: 'en', label: tr('English', 'Inglés') },
            ]}
          />
        </div>
      </div>
      <fieldset>
        <legend>{tr('Channels', 'Canales')}</legend>
        <div className="pdlg__checks">
          {(r?.channels ?? []).map((c) => (
            <label key={c} className="check">
              <input type="checkbox" checked={chans.includes(c)} onChange={(e) => setChans((x) => (e.target.checked ? [...x, c] : x.filter((y) => y !== c)))} />
              {channelName(c, tr)}
            </label>
          ))}
        </div>
      </fieldset>
      {r && chans.includes('display') && !linkUp(r.scope) && (
        <div className="callout">
          <Icon name="wifiOff" size={18} />
          <span>
            {tr(
              `${convoyName(r.scope)} has no link now. The test waits on shore and reaches the display when the convoy is back in coverage.`,
              `${convoyName(r.scope)} no tiene enlace ahora. La prueba espera en tierra y llega a la pantalla cuando el convoy recupere cobertura.`,
            )}
          </span>
        </div>
      )}
      {r && chans.includes('email') && bounced(r) && (
        <div className="callout callout--warn">
          <Icon name="alert" size={18} />
          <span>
            {tr(
              'The last email to this contact bounced. Expect the email to fail; correct the address and send a verification.',
              'El último correo a este contacto rebotó. Es probable que falle; corrija la dirección y envíe una verificación.',
            )}
          </span>
        </div>
      )}
      <div className="field">
        <span className="field__label">{tr('Message', 'Mensaje')}</span>
        <div className="ar-preview" lang={lang}>
          <span className="ar-preview__line">
            <strong>{lang === 'es' ? '[PRUEBA]' : '[TEST]'}</strong>
          </span>
          {renderTemplate(templates[lang], sampleValues[lang])}
        </div>
      </div>
    </PageDialog>
  );
}
