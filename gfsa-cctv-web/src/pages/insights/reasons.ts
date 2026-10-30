import type { Lang } from '../../lib/i18n';

// False-alert reasons as reviewers record them in the alarm console (ALM-06),
// with their Spanish, and the groups the model performance screen counts (MP-02).

const REASON_ES: Record<string, string> = {
  'Inflatable life jacket worn': 'Chaleco salvavidas inflable puesto',
  'Reflection or shadow': 'Reflejo o sombra',
  'Outside the zone': 'Fuera de la zona',
  'Wrong object': 'Objeto equivocado',
  'Hard hat worn, not seen': 'Casco puesto, no detectado',
  'Not smoking (breath or steam)': 'No fumaba (aliento o vapor)',
  'Cargo operations under way': 'Operaciones de carga en curso',
  'Door was closed': 'La puerta estaba cerrada',
  'Work was planned': 'El trabajo estaba planificado',
  'Not a person': 'No es una persona',
  'Steam from the exhaust': 'Vapor del escape',
  'Dust from cleaning': 'Polvo de la limpieza',
  'Reflection or light': 'Reflejo o luz',
  'Dust or spray': 'Polvo o rocío',
  'Round was done, not seen': 'La ronda se hizo, no se vio',
  'Round moved in Connect': 'Ronda movida en Connect',
  'View blocked': 'Vista bloqueada',
  'Wrong person': 'Persona equivocada',
  'Lens was clean': 'La lente estaba limpia',
  'Night or low light': 'Noche o poca luz',
  'Glare from the sun': 'Reflejo del sol',
  'Camera fault': 'Falla de la cámara',
};

/** A recorded reason in both languages ("Reflection or shadow" → ["Reflection or shadow", "Reflejo o sombra"]). */
export function reasonPair(text: string | undefined): [string, string] {
  if (!text) return ['no reason given', 'sin motivo indicado'];
  const es = REASON_ES[text] ?? Object.entries(REASON_ES).find(([, v]) => v === text)?.[1] ?? text;
  const en = REASON_ES[text] ? text : (Object.entries(REASON_ES).find(([, v]) => v === text)?.[0] ?? text);
  return [en, es];
}

export const reasonText = (text: string | undefined, lang: Lang) => reasonPair(text)[lang === 'es' ? 1 : 0];

export type ReasonGroup = 'inflatable' | 'reflection' | 'zone' | 'object' | 'moved' | 'other';

/** The group a recorded reason counts under on the model performance screen. */
export function reasonGroup(text: string | undefined): ReasonGroup {
  const t = reasonPair(text)[0].toLowerCase();
  if (t.includes('inflatable')) return 'inflatable';
  if (/reflection|shadow|light|glare/.test(t)) return 'reflection';
  if (t.includes('zone')) return 'zone';
  if (/wrong|not a person|hard hat worn/.test(t)) return 'object';
  if (/camera|lens|view blocked|moved/.test(t)) return 'moved';
  return 'other';
}

export const REASON_GROUP_TEXT: Record<ReasonGroup, [string, string]> = {
  inflatable: ['Inflatable life jacket worn', 'Chaleco salvavidas inflable puesto'],
  reflection: ['Reflection or shadow', 'Reflejo o sombra'],
  zone: ['Outside the zone', 'Fuera de la zona'],
  object: ['Wrong object', 'Objeto equivocado'],
  moved: ['Camera moved or blocked', 'Cámara movida o tapada'],
  other: ['Other, as noted by the reviewer', 'Otros, según el revisor'],
};
