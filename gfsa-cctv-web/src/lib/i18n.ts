import { useCallback } from 'react';
import { useApp } from '../state/AppState';

// Spanish and English interface (PRD: Language). Spanish is GFSA's default for
// messages and reports; the console follows the language chosen in the header.
//
// Usage in a component:
//   const tr = useTr();
//   <h2>{tr('Active alarms', 'Alarmas activas')}</h2>
//
// Keep both strings side by side at the call site so nothing is left untranslated.

export type Lang = 'en' | 'es';

export function useLang(): Lang {
  return useApp().state.lang;
}

/** Returns tr(en, es) for the current language. */
export function useTr() {
  const lang = useLang();
  return useCallback((en: string, es: string) => (lang === 'es' ? es : en), [lang]);
}

/** Picks the Spanish variant of a data field when there is one. */
export function pick<T extends string | undefined>(lang: Lang, en: T, es?: string): T | string {
  return lang === 'es' && es ? es : en;
}

/** Plural helper: plural(n, 'camera', 'cameras'). */
export const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
