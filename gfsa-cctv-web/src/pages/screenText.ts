import type { Camera, Detection, Vessel } from '../data/types';
import type { Lang } from '../lib/i18n';

// Spanish for the data the video wall, the wheelhouse display and the phone page
// show without a Spanish field of their own: detection labels, zone names,
// camera health notes, escalation targets and position labels.

const DETECTION_ES: Record<string, string> = {
  'No life jacket': 'Sin chaleco salvavidas',
  'No hard hat': 'Sin casco',
  Smoking: 'Fumando',
  Smoke: 'Humo',
  'Door open': 'Puerta abierta',
  Person: 'Persona',
  Detection: 'Detección',
  'Blurred image': 'Imagen borrosa',
  'Watchkeeper present': 'Guardia presente',
};

export const detectionLabel = (label: string, lang: Lang) => (lang === 'es' ? (DETECTION_ES[label] ?? label) : label);

/** The detection with its label in the current language (for CameraFrame). */
export function detectionIn(det: Detection | undefined, lang: Lang): Detection | undefined {
  if (!det) return undefined;
  return lang === 'es' ? { ...det, label: detectionLabel(det.label, lang), zoneName: det.zoneName && zoneName(det.zoneName, lang) } : det;
}

const ZONE_ES: Record<string, string> = {
  'Water edge, port': 'Borde del agua, babor',
  'Water edge': 'Borde del agua',
  'Deck walkway': 'Pasillo de cubierta',
  'Container stack': 'Pila de contenedores',
  'Engine room floor': 'Piso de la sala de máquinas',
  'Forward zone': 'Zona de proa',
  'Reefer row': 'Fila de reefers',
  'Hull line': 'Línea del casco',
};

export const zoneName = (name: string, lang: Lang) => (lang === 'es' ? (ZONE_ES[name] ?? name) : name);

/** Short health word for a tile or tree row: "blurred" / "borrosa". */
export function healthShort(cam: Camera, lang: Lang): string {
  const es = lang === 'es';
  if (cam.health === 'offline') return es ? 'sin imagen' : 'no image';
  const first = (cam.healthNote ?? '').split(/[\s·]/)[0].toLowerCase();
  const words: Record<string, [string, string]> = {
    blurred: ['blurred', 'borrosa'],
    moved: ['moved', 'movida'],
    added: ['new', 'nueva'],
    dark: ['dark', 'oscura'],
    blocked: ['blocked', 'tapada'],
    covered: ['covered', 'tapada'],
  };
  const w = words[first];
  if (w) return es ? w[1] : w[0];
  return es ? 'degradada' : 'degraded';
}

/** Full health note: "Blurred since 13:20" / "Borrosa desde las 13:20". */
export function healthNote(cam: Camera, lang: Lang): string {
  const note = cam.healthNote;
  if (cam.health === 'offline' && !note) return lang === 'es' ? 'Sin imagen' : 'No image';
  if (!note) return lang === 'es' ? 'Degradada' : 'Degraded';
  if (lang !== 'es') return note;
  const patterns: [RegExp, (m: RegExpMatchArray) => string][] = [
    [/^Blurred since (.+)$/i, (m) => `Borrosa desde las ${m[1]}`],
    [/^Moved · zones held since (.+)$/i, (m) => `Movida · zonas retenidas desde las ${m[1]}`],
    [/^Added · waiting for the first scene check$/i, () => 'Agregada · esperando el primer control de escena'],
    [/^Dark since (.+)$/i, (m) => `Oscura desde las ${m[1]}`],
    [/^No image since (.+)$/i, (m) => `Sin imagen desde las ${m[1]}`],
  ];
  for (const [re, fn] of patterns) {
    const m = note.match(re);
    if (m) return fn(m);
  }
  return healthShort(cam, lang).replace(/^./, (c) => c.toUpperCase());
}

const TARGET_ES: Record<string, string> = {
  'Duty officer': 'Oficial de guardia',
  'Operations manager': 'Gerente de operaciones',
  'Fleet superintendent': 'Superintendente de flota',
  'Safety administrator': 'Administrador de seguridad',
  'GFSA management on call': 'Gerencia de GFSA de guardia',
  'Wheelhouse display': 'Pantalla del puente',
  'Wheelhouse list': 'Lista del puente',
  'Console only': 'Solo consola',
  'Daily summary': 'Resumen diario',
};

/** An escalation target ("Operations manager") in the current language, capitalised. */
export const targetName = (target: string, lang: Lang) => (lang === 'es' ? (TARGET_ES[target] ?? target) : target);

/** "near Goya at 13:49" → "cerca de Goya a las 13:49" */
export function positionText(label: string, lang: Lang, dropTime = false): string {
  const l = dropTime ? label.replace(/ at \d{1,2}:\d{2}$/, '') : label;
  if (lang !== 'es') return l;
  return l.replace(/^near /i, 'cerca de ').replace(/ at (\d)/, ' a las $1');
}

/** The second barge in a convoy reuses the sample frames mirrored, as on the design canvas. */
export function isMirrored(cam: Camera, convoyVessels: Vessel[]): boolean {
  if (cam.id === 'F503-CAM-02') return false;
  const i = convoyVessels.findIndex((v) => v.id === cam.vesselId);
  return i > 0 && i % 2 === 0;
}

/** "the operations manager" / "al gerente de operaciones": a target after "goes to". */
export function toTarget(target: string | undefined, lang: Lang): string {
  if (!target) return lang === 'es' ? 'al siguiente paso' : 'the next step';
  if (lang === 'es') {
    const name = TARGET_ES[target] ?? target;
    const feminine = /^(Gerencia|Pantalla|Lista)/.test(name);
    const lower = name.charAt(0).toLowerCase() + name.slice(1);
    return feminine ? `a la ${lower.replace(/^gerencia de gfsa/, 'gerencia de GFSA')}` : `al ${lower}`;
  }
  const lower = /^[A-Z]{2,}/.test(target) ? target : target.charAt(0).toLowerCase() + target.slice(1);
  return `the ${lower}`;
}
