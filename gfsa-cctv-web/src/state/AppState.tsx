import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import { initialAlarms, initialReviewEvents } from '../data/alarms';
import { initialAudit } from '../data/audit';
import { can as roleCan, roleById } from '../data/users';
import type {
  Alarm,
  AlarmState,
  AuditCategory,
  AuditEntry,
  Classification,
  Permission,
  ReviewEvent,
  RoleId,
  User,
} from '../data/types';
import { scenarioNow, setTimeLocale } from '../lib/time';
import { auditHash } from '../lib/hash';
import { demoUserFor, usersStore } from './usersStore';
import { escalate } from './escalation';

// Client-side store for the demo. Every action that the PRD says must be logged
// (views, downloads, changes) appends to the audit log here; in production these
// become API calls and the server writes the hash-chained log.
// The state (minus toasts) is saved to localStorage, so a reload keeps the
// session, the alarm history and the audit log (Reset demo data clears it).

export type Lang = 'en' | 'es';

export interface Toast {
  id: number;
  text: string;
}

interface State {
  signedIn: boolean;
  role: RoleId;
  user: User;
  lang: Lang;
  /** Convoy scope in the header: 'all' or a convoy id. */
  scope: string;
  alarms: Alarm[];
  reviewEvents: ReviewEvent[];
  audit: AuditEntry[];
  toasts: Toast[];
  /** The live engine raises new events and sends escalations while this is on. */
  simulation: boolean;
}

export interface SystemLog {
  action: string;
  target: string;
  details?: string;
  source?: string;
  convoyId?: string;
  category?: AuditCategory;
  result?: 'ok' | 'failed';
}

type Action =
  | { type: 'signIn'; role?: RoleId }
  | { type: 'signOut' }
  | { type: 'setRole'; role: RoleId }
  | { type: 'setLang'; lang: Lang }
  | { type: 'setScope'; scope: string }
  | { type: 'setSimulation'; on: boolean }
  | { type: 'alarm'; id: string; patch: (a: Alarm) => Alarm }
  | { type: 'raise'; alarm: Alarm }
  | { type: 'review'; id: string; patch: (e: ReviewEvent) => ReviewEvent }
  | { type: 'addReview'; events: ReviewEvent[] }
  | { type: 'audit'; action: string; target: string; details?: string; convoyId?: string; category?: AuditCategory }
  | { type: 'auditSystem'; entry: SystemLog }
  | { type: 'toast'; text: string }
  | { type: 'dismissToast'; id: number }
  | { type: 'hydrate'; saved: Partial<State> };

const iso = () => new Date(scenarioNow()).toISOString();

function categoryOf(action: string): AuditCategory {
  const a = action.toLowerCase();
  if (a.startsWith('viewed') || a.startsWith('opened') || a.startsWith('played')) return 'view';
  if (a.startsWith('export') || a.startsWith('download') || a.startsWith('printed')) return 'export';
  if (a.startsWith('classified')) return 'review';
  if (a.startsWith('sign')) return 'signin';
  if (a.includes('alarm') || a.includes('step') || a.startsWith('acknowledged') || a.startsWith('called')) return 'alarm';
  if (a.includes('user') || a.includes('role') || a.includes('invit')) return 'user';
  if (a.includes('report')) return 'report';
  if (a.includes('alert') || a.includes('reminder')) return 'alert';
  return 'config';
}

function appendAudit(state: State, e: SystemLog & { actor?: string; role?: string }): AuditEntry[] {
  const prev = state.audit[0];
  const seq = (prev?.seq ?? 0) + 1;
  const at = iso();
  const actor = e.actor ?? state.user.name;
  const fields = {
    seq,
    at,
    actor,
    role: e.role ?? roleById(state.role).name,
    action: e.action,
    target: e.target,
    details: e.details,
    source: e.source ?? 'Console 10.20.4.17',
    result: e.result ?? 'ok',
    category: e.category ?? categoryOf(e.action),
    convoyId: e.convoyId,
  };
  const prevHash = prev?.hash ?? '0'.repeat(64);
  const entry: AuditEntry = {
    ...fields,
    ip: e.actor === 'System' ? undefined : '10.20.4.17',
    prevHash,
    hash: auditHash(fields, prevHash),
  };
  return [entry, ...state.audit];
}

let toastSeq = 1;

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'signIn': {
      const role = action.role ?? state.role;
      const user = demoUserFor(role);
      const next = { ...state, signedIn: true, role, user, scope: user.convoyId ?? 'all' };
      return { ...next, audit: appendAudit(next, { action: 'Signed in', target: 'Console', details: 'Single sign-on, MFA' }) };
    }
    case 'signOut':
      return { ...state, signedIn: false, audit: appendAudit(state, { action: 'Signed out', target: 'Console' }) };
    case 'setRole': {
      const user = demoUserFor(action.role);
      const next = { ...state, role: action.role, user, scope: user.convoyId ?? 'all' };
      return { ...next, audit: appendAudit(next, { action: 'Signed in', target: 'Console', details: 'Switched demo role' }) };
    }
    case 'setLang':
      return { ...state, lang: action.lang };
    case 'setScope':
      // ADM-02: masters see their own convoy only.
      if (state.role === 'master') return state;
      return { ...state, scope: action.scope };
    case 'setSimulation':
      return { ...state, simulation: action.on };
    case 'alarm':
      return { ...state, alarms: state.alarms.map((a) => (a.id === action.id ? action.patch(a) : a)) };
    case 'raise':
      if (state.alarms.some((a) => a.id === action.alarm.id)) return state;
      return { ...state, alarms: [action.alarm, ...state.alarms] };
    case 'review':
      return {
        ...state,
        reviewEvents: state.reviewEvents.map((e) => (e.id === action.id ? action.patch(e) : e)),
      };
    case 'addReview': {
      const known = new Set(state.reviewEvents.map((e) => e.id));
      const fresh = action.events.filter((e) => !known.has(e.id));
      if (!fresh.length) return state;
      return { ...state, reviewEvents: [...fresh, ...state.reviewEvents].sort((a, b) => b.at.localeCompare(a.at)) };
    }
    case 'audit':
      return {
        ...state,
        audit: appendAudit(state, { action: action.action, target: action.target, details: action.details, convoyId: action.convoyId, category: action.category }),
      };
    case 'auditSystem':
      return { ...state, audit: appendAudit(state, { ...action.entry, actor: 'System', role: 'Automated', source: action.entry.source ?? 'Event service' }) };
    case 'toast':
      return { ...state, toasts: [...state.toasts.slice(-3), { id: toastSeq++, text: action.text }] };
    case 'dismissToast':
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };
    case 'hydrate': {
      // Another window saved: take its alarms, events and audit log; keep this window's own session view.
      // Unchanged content returns the same state, so two windows never ping-pong saves.
      const same =
        JSON.stringify([action.saved.alarms, action.saved.reviewEvents, action.saved.audit, action.saved.simulation, action.saved.signedIn]) ===
        JSON.stringify([state.alarms, state.reviewEvents, state.audit, state.simulation, state.signedIn]);
      if (same) return state;
      return {
        ...state,
        alarms: action.saved.alarms ?? state.alarms,
        reviewEvents: action.saved.reviewEvents ?? state.reviewEvents,
        audit: action.saved.audit ?? state.audit,
        simulation: action.saved.simulation ?? state.simulation,
        signedIn: action.saved.signedIn ?? state.signedIn,
      };
    }
  }
}

// ---------- Saving ----------

const SAVE_KEY = 'gfsa.v1.app';
// 3: audit hashes cover every field (older saves are dropped).
const SAVE_VERSION = 3;

const initialRole: RoleId = 'duty_officer';

function seedState(): State {
  return {
    signedIn: false,
    role: initialRole,
    user: demoUserFor(initialRole),
    lang: 'en',
    scope: 'all',
    alarms: initialAlarms,
    reviewEvents: initialReviewEvents,
    audit: initialAudit,
    toasts: [],
    simulation: true,
  };
}

function loadState(): State {
  const seed = seedState();
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<State> & { v?: number };
      if (saved.v === SAVE_VERSION) {
        const user = usersStore.get().find((u) => u.id === saved.user?.id) ?? seed.user;
        const s = { ...seed, ...saved, user, toasts: [] } as State;
        setTimeLocale(s.lang);
        return s;
      }
    }
  } catch {
    // Unreadable save: start from the seed.
  }
  setTimeLocale(seed.lang);
  return seed;
}

// ---------- API ----------

interface Api {
  state: State;
  can: (p: Permission) => boolean;
  signIn: (role?: RoleId) => void;
  signOut: () => void;
  setRole: (role: RoleId) => void;
  setLang: (lang: Lang) => void;
  setScope: (scope: string) => void;
  setSimulation: (on: boolean) => void;
  /** Writes one line to the audit log as the signed-in user (VW-05, ALM-08, PH-03, ADM-03). */
  log: (action: string, target: string, details?: string, convoyId?: string, category?: AuditCategory) => void;
  /** Writes one line to the audit log as the system (event service, alert routing, scene checks…). */
  logSystem: (entry: SystemLog) => void;
  toast: (text: string) => void;
  dismissToast: (id: number) => void;
  // Alarm actions (ALM-02 to ALM-07, WH-03, PH-03)
  acknowledgeOnBoard: (id: string, by?: string) => void;
  acknowledgeAshore: (id: string) => void;
  assignToMe: (id: string) => void;
  escalateNow: (id: string) => void;
  resolve: (id: string) => void;
  close: (id: string) => void;
  classifyAlarm: (id: string, c: Classification, reason?: string) => void;
  toggleStep: (id: string, step: number) => void;
  classifyEvent: (id: string, c: Classification, reason?: string) => void;
  /** Adds a line to an alarm's activity trail (ALM-09), e.g. "Called the wheelhouse". */
  addActivity: (id: string, text: string, textEs?: string, actor?: string) => void;
  /** System-side change to an alarm (engine): no audit line unless you log one. */
  patchAlarm: (id: string, patch: (a: Alarm) => Alarm) => void;
  /** A new alarm from the event service. */
  raiseAlarm: (a: Alarm) => void;
  /** New events for the review queue. */
  addReviewEvents: (events: ReviewEvent[]) => void;
}

const Ctx = createContext<Api | null>(null);

const STATE_TEXT: Record<AlarmState, [string, string]> = {
  raised: ['Raised', 'Generada'],
  ack_board: ['Acknowledged on board', 'Confirmada a bordo'],
  ack_shore: ['Acknowledged ashore', 'Confirmada en tierra'],
  resolved: ['Resolved', 'Resuelta'],
  closed: ['Closed', 'Cerrada'],
};

const CLASS_TEXT: Record<Classification, [string, string]> = {
  accepted: ['accepted', 'aceptada'],
  rejected: ['rejected', 'rechazada'],
  false_alert: ['false alert', 'falsa alerta'],
};

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);

  // Save everything but the toasts (debounced).
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        const { toasts: _toasts, ...rest } = state;
        void _toasts;
        window.localStorage.setItem(SAVE_KEY, JSON.stringify({ ...rest, v: SAVE_VERSION }));
      } catch {
        // Quota or private mode: the session still works in memory.
      }
    }, 250);
    return () => window.clearTimeout(id);
  }, [state]);

  // Another window (second screen, wheelhouse) saved: take its changes.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SAVE_KEY || !e.newValue) return;
      try {
        const saved = JSON.parse(e.newValue) as Partial<State> & { v?: number };
        if (saved.v === SAVE_VERSION) dispatch({ type: 'hydrate', saved });
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const log = useCallback(
    (action: string, target: string, details?: string, convoyId?: string, category?: AuditCategory) =>
      dispatch({ type: 'audit', action, target, details, convoyId, category }),
    [],
  );
  const logSystem = useCallback((entry: SystemLog) => dispatch({ type: 'auditSystem', entry }), []);
  const toast = useCallback((text: string) => dispatch({ type: 'toast', text }), []);

  const api = useMemo<Api>(() => {
    const who = state.user.name;
    const es = state.lang === 'es';
    const tr = (en: string, sp: string) => (es ? sp : en);
    const patchAlarm = (id: string, patch: (a: Alarm) => Alarm) => dispatch({ type: 'alarm', id, patch });
    const addActivity = (a: Alarm, text: string, textEs?: string, actor = who): Alarm => ({
      ...a,
      activity: [...a.activity, { at: iso(), text, textEs, actor }],
    });
    const moveTo = (a: Alarm, s: AlarmState, extra: Partial<Alarm> = {}, actor = who): Alarm =>
      addActivity(
        { ...a, ...extra, state: s, stateLabel: undefined, stateLabelEs: undefined, stateTimes: { ...a.stateTimes, [s]: iso() } },
        STATE_TEXT[s][0],
        STATE_TEXT[s][1],
        actor,
      );

    return {
      state,
      can: (p) => roleCan(state.role, p),
      signIn: (role) => dispatch({ type: 'signIn', role }),
      signOut: () => dispatch({ type: 'signOut' }),
      setRole: (role) => dispatch({ type: 'setRole', role }),
      setLang: (lang) => {
        setTimeLocale(lang);
        dispatch({ type: 'setLang', lang });
      },
      setScope: (scope) => dispatch({ type: 'setScope', scope }),
      setSimulation: (on) => {
        dispatch({ type: 'setSimulation', on });
        toast(on ? tr('Live events on: new events, escalations and health messages arrive.', 'Eventos en vivo activados: llegan eventos, escalamientos y mensajes de estado.') : tr('Live events paused. Nothing new arrives until you turn them on again.', 'Eventos en vivo en pausa. No llega nada nuevo hasta que los vuelva a activar.'));
      },
      log,
      logSystem,
      toast,
      dismissToast: (id) => dispatch({ type: 'dismissToast', id }),

      acknowledgeOnBoard: (id, by = 'Wheelhouse') => {
        patchAlarm(id, (a) => {
          if (a.stateTimes.ack_board) return a;
          // Already further along ashore: record the board acknowledgement without moving the state back.
          if (a.state !== 'raised') {
            return addActivity({ ...a, stateTimes: { ...a.stateTimes, ack_board: iso() } }, STATE_TEXT.ack_board[0], STATE_TEXT.ack_board[1], by);
          }
          return moveTo(a, 'ack_board', {}, by);
        });
        log('Acknowledged alarm', id, 'On the wheelhouse display');
      },
      acknowledgeAshore: (id) => {
        patchAlarm(id, (a) =>
          moveTo(a, 'ack_shore', { owner: a.owner && a.owner !== 'System' ? a.owner : who, escalatesAt: undefined, escalatesTo: undefined }),
        );
        log('Acknowledged alarm', id, 'Ashore · escalation stopped');
        toast(tr(`${id} acknowledged. Escalation stopped.`, `${id} confirmada. Escalamiento detenido.`));
      },
      assignToMe: (id) => {
        patchAlarm(id, (a) => addActivity({ ...a, owner: who }, `Assigned to ${who}`, `Asignada a ${who}`));
        log('Assigned alarm', id, `To ${who}`);
      },
      escalateNow: (id) => {
        const current = state.alarms.find((a) => a.id === id);
        if (!current) return;
        const { sent } = escalate(current, iso(), { by: who });
        patchAlarm(id, (a) => escalate(a, iso(), { by: who }).alarm);
        log('Escalated alarm', id, sent ? sent.en : 'No further step on the ladder');
        toast(
          sent
            ? tr(`${id} escalated: ${sent.en.split(': ')[1]}.`, `${id} escalada: ${sent.es.split(': ')[1]}.`)
            : tr(`${id} has no further step on the escalation ladder.`, `${id} no tiene más pasos en la escala.`),
        );
      },
      resolve: (id) => {
        patchAlarm(id, (a) => moveTo(a, 'resolved', { escalatesAt: undefined, escalatesTo: undefined }));
        log('Resolved alarm', id);
      },
      close: (id) => {
        patchAlarm(id, (a) => moveTo(a, 'closed', { escalatesAt: undefined, escalatesTo: undefined }));
        log('Closed alarm', id);
        toast(tr(`${id} closed.`, `${id} cerrada.`));
      },
      classifyAlarm: (id, c, reason) => {
        patchAlarm(id, (a) =>
          addActivity(
            { ...a, classification: c, falseReason: reason },
            `Classified as ${CLASS_TEXT[c][0]}${reason ? ` (${reason})` : ''}`,
            `Clasificada como ${CLASS_TEXT[c][1]}${reason ? ` (${reason})` : ''}`,
          ),
        );
        log('Classified event', id, `${CLASS_TEXT[c][0]}${reason ? `, ${reason}` : ''}`);
      },
      toggleStep: (id, step) => {
        patchAlarm(id, (a) => {
          const done = { ...a.stepsDone };
          if (done[step]) delete done[step];
          else done[step] = { by: who, at: iso() };
          return { ...a, stepsDone: done };
        });
        log('Updated response step', id, `Step ${step + 1}`);
      },
      classifyEvent: (id, c, reason) => {
        dispatch({ type: 'review', id, patch: (e) => ({ ...e, classification: c, falseReason: reason }) });
        log('Classified event', id, `${CLASS_TEXT[c][0]}${reason ? `, ${reason}` : ''}`);
      },
      addActivity: (id, text, textEs, actor = who) => patchAlarm(id, (a) => addActivity(a, text, textEs, actor)),
      patchAlarm,
      raiseAlarm: (alarm) => dispatch({ type: 'raise', alarm }),
      addReviewEvents: (events) => dispatch({ type: 'addReview', events }),
    };
  }, [state, log, logSystem, toast]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useApp(): Api {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside AppStateProvider');
  return v;
}

/** Alarms not closed, filtered to the header's convoy scope, highest priority first. */
export function useOpenAlarms(): Alarm[] {
  const { state } = useApp();
  return useMemo(
    () =>
      state.alarms
        .filter((a) => a.state !== 'closed' && (state.scope === 'all' || a.convoyId === state.scope))
        .sort((a, b) => a.priority.localeCompare(b.priority) || b.raisedAt.localeCompare(a.raisedAt)),
    [state.alarms, state.scope],
  );
}

/** True when the item belongs to the current convoy scope. */
export function useInScope() {
  const { state } = useApp();
  return useCallback((convoyId: string) => state.scope === 'all' || convoyId === state.scope, [state.scope]);
}
