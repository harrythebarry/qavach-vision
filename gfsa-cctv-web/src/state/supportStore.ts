import { createStore, useStore } from '../lib/persist';

// Support cases (ADM-05 / PRD: 24/7 support desk). Opened from Plan and usage,
// the public Support page and Help; listed on Plan and usage.

export type SupportPriority = 'P1' | 'P2' | 'P3';

export interface SupportCase {
  id: string; // "SUP-26-0412"
  priority: SupportPriority;
  subject: string;
  description: string;
  contact: string; // name or email
  openedAt: string; // ISO
  openedBy: string;
  status: 'open' | 'answered' | 'closed';
  language: 'es' | 'en';
  /** Optional link to what the case is about (alarm, camera, edge unit). */
  about?: string;
}

/** First response targets (PRD, proposed): P1 15 min, P2 1 hour, P3 next business day. */
export const SUPPORT_RESPONSE: Record<SupportPriority, { en: string; es: string; minutes: number }> = {
  P1: { en: '15 minutes', es: '15 minutos', minutes: 15 },
  P2: { en: '1 hour', es: '1 hora', minutes: 60 },
  P3: { en: 'next business day', es: 'el siguiente día hábil', minutes: 24 * 60 },
};

export const supportStore = createStore<SupportCase[]>('support.cases', () => [
  {
    id: 'SUP-26-0398',
    priority: 'P3',
    subject: 'Daily summary in Spanish shows English camera names',
    description: 'The 06:00 daily summary for Guarán F 501 lists camera names in English.',
    contact: 'Lucía Ortiz',
    openedAt: '2026-10-13T09:20:00-03:00',
    openedBy: 'Lucía Ortiz',
    status: 'answered',
    language: 'es',
  },
]);

export const useSupportCases = () => useStore(supportStore);

export function openSupportCase(c: Omit<SupportCase, 'id' | 'status'>): SupportCase {
  const n = 412 + supportStore.get().length;
  const created: SupportCase = { ...c, id: `SUP-26-${String(n).padStart(4, '0')}`, status: 'open' };
  supportStore.set((list) => [created, ...list]);
  return created;
}
