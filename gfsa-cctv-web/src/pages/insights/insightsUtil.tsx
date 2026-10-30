import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useBlocker } from 'react-router';
import { Icon } from '../../components/Icon';
import { fakeHash } from '../../lib/hash';
import { useTr, type Lang } from '../../lib/i18n';
import { TZ, scenarioNow } from '../../lib/time';
import './insights.css';

// Helpers shared by the Reports, Daily summary and Model performance screens.

/** Deterministic pseudo-random numbers (mulberry32) seeded from a string. */
export function seeded(seed: string): () => number {
  let a = parseInt(fakeHash(seed).slice(0, 8), 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Width of an element, kept current with a ResizeObserver. */
export function useWidth<T extends HTMLElement>(fallback = 800): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth || fallback);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, width];
}

/**
 * Modal dialog built on the native <dialog> element (focus is trapped and
 * Escape closes it). Mount it only while it should be open.
 */
export function InsightsDialog({
  title,
  sub,
  onClose,
  children,
  footer,
  width = 560,
  onSubmit,
}: {
  title: ReactNode;
  sub?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  width?: number;
  /** When set the body is a form and Enter submits it. */
  onSubmit?: () => void;
}) {
  const tr = useTr();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => {
      if (d?.open) d.close();
    };
  }, []);

  const inner = (
    <>
      <div className="ins-dialog__head">
        <div className="ins-dialog__title">
          <h2 id={titleId}>{title}</h2>
          {sub && <p>{sub}</p>}
        </div>
        <button type="button" className="btn btn--ghost btn--icon" aria-label={tr('Close', 'Cerrar')} onClick={onClose}>
          <Icon name="x" size={18} />
        </button>
      </div>
      <div className="ins-dialog__body">{children}</div>
      <div className="ins-dialog__foot">{footer}</div>
    </>
  );

  return (
    <dialog
      ref={ref}
      className="ins-dialog"
      aria-labelledby={titleId}
      style={{ width: `min(${width}px, calc(100vw - 24px))` }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {onSubmit ? (
        <form
          className="ins-dialog__form"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          {inner}
        </form>
      ) : (
        <div className="ins-dialog__form">{inner}</div>
      )}
    </dialog>
  );
}

/**
 * Warns before leaving while a form holds unsaved changes: in-app navigation
 * (react-router blocker) and closing or reloading the tab (beforeunload).
 */
export function useLeaveGuard(dirty: boolean, message: string) {
  const blocker = useBlocker(dirty);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm(message)) blocker.proceed();
    else blocker.reset();
  }, [blocker, message]);
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);
}

/** "1,041" in English, "1041" / "12.345" in Spanish. */
export const fmtInt = (n: number, lang: Lang = 'en') => n.toLocaleString(lang === 'es' ? 'es-PY' : 'en-US');

/** 0.913 → "91%" */
export const pct = (v: number) => `${Math.round(v * 100)}%`;

// ---------- Document language ----------
// Reports are produced in the reader's language, which can differ from the
// console's: a duty officer working in English sends a master the Spanish PDF.
// These take the document language explicitly; screen text uses useTr() and lib/time.

/** tr(en, es) for a document language. */
export const docTr = (lang: Lang) => (en: string, es: string) => (lang === 'es' ? es : en);

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function docFmt(lang: Lang, name: string, opts: Intl.DateTimeFormatOptions) {
  const key = `${lang}:${name}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(lang === 'es' ? 'es-PY' : 'en-GB', { timeZone: TZ, ...opts });
    fmtCache.set(key, f);
  }
  return f;
}

/** A calendar day "2026-10-14" as a moment at noon Asunción time. */
export const dayIso = (d: string) => `${d}T12:00:00-03:00`;
const asDate = (v: string | number) => new Date(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? dayIso(v) : v);

/** "15 Oct" / "15 oct" */
export const docDay = (v: string | number, lang: Lang) =>
  docFmt(lang, 'dm', { day: 'numeric', month: 'short' }).format(asDate(v)).replace('.', '');
/** "14:32" */
export const docTime = (v: string | number, lang: Lang) =>
  docFmt(lang, 'hm', { hour: '2-digit', minute: '2-digit', hour12: false }).format(asDate(v));
/** "15 Oct 14:32" */
export const docDayTime = (v: string | number, lang: Lang) => `${docDay(v, lang)} ${docTime(v, lang)}`;
/** "September" / "septiembre" */
export const docMonth = (month: number, lang: Lang) =>
  docFmt(lang, 'm', { month: 'long' }).format(new Date(Date.UTC(2026, month, 15, 12)));

/** The calendar day of a moment in Asunción, "2026-10-15". */
export function dateOf(v: string | number): string {
  const p = docFmt('en', 'ymd', { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(v));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Minutes after midnight in Asunción. */
export function minsOfDay(v: string | number): number {
  const p = docFmt('en', 'hm24', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(v));
  const h = Number(p.find((x) => x.type === 'hour')?.value ?? 0);
  const m = Number(p.find((x) => x.type === 'minute')?.value ?? 0);
  return (h % 24) * 60 + m;
}

/** The scenario's today in Asunción. */
export const scenarioToday = (now = scenarioNow()) => dateOf(now);

/** "5–11 Oct", "28 Sep – 4 Oct" */
export function docRange(from: string, to: string, lang: Lang): string {
  const a = docDay(from, lang);
  const b = docDay(to, lang);
  if (from === to) return a;
  const [da, ...ma] = a.split(' ');
  const [db, ...mb] = b.split(' ');
  return ma.join(' ') === mb.join(' ') ? `${da}–${db} ${mb.join(' ')}` : `${a} – ${b}`;
}

/** Calendar days from `from` to `to`, both included. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const t = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`).getTime();
  while (t.getTime() <= end && out.length < 400) {
    out.push(t.toISOString().slice(0, 10));
    t.setUTCDate(t.getUTCDate() + 1);
  }
  return out;
}

/** Splits `total` into whole parts proportional to `weights` (largest remainder). */
export function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (!weights.length) return [];
  if (sum <= 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const raw = weights.map((w) => (w / sum) * total);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((s, x) => s + x, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k][1]] += 1;
  return out;
}
