import { useEffect, useState } from 'react';
import { SCENARIO_START } from '../data/alarms';

// The sample data is a snapshot at 15 Oct 2026, 14:36:20 Asunción time.
// The scenario clock starts there the first time the app opens and then runs
// in real time. The start is saved, so a reload carries on where it left off
// (Reset demo data in the user menu starts it again).

const ANCHOR_KEY = 'gfsa.v1.clockAnchor';
const scenarioStart = new Date(SCENARIO_START).getTime();

function loadAnchor(): number {
  try {
    const saved = Number(window.localStorage.getItem(ANCHOR_KEY));
    if (saved > 0) return saved;
    const now = Date.now();
    window.localStorage.setItem(ANCHOR_KEY, String(now));
    return now;
  } catch {
    return Date.now();
  }
}

const anchor = loadAnchor();

export const TZ = 'America/Asuncion';

export function scenarioNow(): number {
  return scenarioStart + (Date.now() - anchor);
}

/** Milliseconds since the scenario started (the simulator schedules events on this). */
export const scenarioElapsed = () => Date.now() - anchor;

/** Re-renders every `ms` and returns the scenario time in epoch ms. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(scenarioNow);
  useEffect(() => {
    const id = window.setInterval(() => setNow(scenarioNow()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

// ---------- Locale ----------
// Set from AppState whenever the language changes, before the re-render.

export type TimeLang = 'en' | 'es';
let lang: TimeLang = 'en';
const cache = new Map<string, Intl.DateTimeFormat>();

export function setTimeLocale(l: TimeLang) {
  lang = l;
}

const fmt = (name: string, opts: Intl.DateTimeFormatOptions) => {
  const key = `${lang}:${name}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(lang === 'es' ? 'es-PY' : 'en-GB', { timeZone: TZ, ...opts });
    cache.set(key, f);
  }
  return f;
};

const toDate = (v: string | number | Date) => (v instanceof Date ? v : new Date(v));

/** 14:32 */
export const fmtTime = (v: string | number | Date) =>
  fmt('hm', { hour: '2-digit', minute: '2-digit', hour12: false }).format(toDate(v));
/** 14:32:06 */
export const fmtTimeSec = (v: string | number | Date) =>
  fmt('hms', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(toDate(v));
/** 15 Oct */
export const fmtDay = (v: string | number | Date) => fmt('dm', { day: 'numeric', month: 'short' }).format(toDate(v)).replace('.', '');
/** 15 Oct 14:32 */
export const fmtDayTime = (v: string | number | Date) => `${fmtDay(v)} ${fmtTime(v)}`;
/** Thu 15 Oct */
export const fmtWeekday = (v: string | number | Date) =>
  fmt('wd', { weekday: 'short', day: 'numeric', month: 'short' }).format(toDate(v)).replace(/\./g, '');

/** 15 Oct 14:32, or just 14:32 when it is the scenario's today. */
export function fmtSmart(v: string | number | Date, now = scenarioNow()): string {
  return fmtDay(v) === fmtDay(now) ? fmtTime(v) : fmtDayTime(v);
}

/** 1:31 (m:ss) — for escalation countdowns. */
export function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** "2 min ago", "4 h 12 min ago" ("hace 2 min" in Spanish) */
export function fmtAgo(v: string | number | Date, now = scenarioNow()): string {
  const s = Math.max(0, Math.round((now - toDate(v).getTime()) / 1000));
  let span: string;
  if (s < 60) span = `${s} s`;
  else if (s < 3600) span = `${Math.floor(s / 60)} min`;
  else if (s < 48 * 3600) span = `${Math.floor(s / 3600)} h ${Math.floor(s / 60) % 60} min`;
  else span = `${Math.floor(s / 86400)} d`;
  return lang === 'es' ? `hace ${span}` : `${span} ago`;
}

/** "4 h 12 min" */
export function fmtDuration(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
