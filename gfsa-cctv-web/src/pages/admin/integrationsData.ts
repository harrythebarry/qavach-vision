import type { IconName } from '../../components/Icon';

// ADM-04 integrations. Definitions (names, fields, wording in both languages)
// live here; what an administrator changes (on/off, settings, which secrets are
// set, test results, the Connect mapping and sync log) is saved with
// usePersistentState('integrations.…') on the Integrations screen.
// Secret values are never saved in the browser: only a "set" flag.

export type L = { en: string; es: string };
const l = (en: string, es: string): L => ({ en, es });

export type IntegrationStatus = 'connected' | 'attention' | 'not_configured';

export type FieldDef =
  | { key: string; label: L; kind: 'text' | 'url' | 'email'; hint?: L; required?: boolean }
  | { key: string; label: L; kind: 'secret'; hint?: L; required?: boolean }
  | { key: string; label: L; kind: 'select'; options: { value: string; es?: string }[]; hint?: L }
  | { key: string; label: L; kind: 'toggle'; hint?: L };

export type Tone = 'ok' | 'warn' | 'bad';

export interface TestOutcome {
  tone: Tone;
  en: string;
  es: string;
}

export interface IntegrationDef {
  id: string;
  name: L;
  icon: IconName;
  description: L;
  fields: FieldDef[];
  /** Answer of the far end when tested (live ones are computed on the screen). */
  test: TestOutcome;
  /** Shown in the configure dialog when an admin turns the integration off. */
  disableWarning?: L;
  /** Added from "Add integration" (can be removed). */
  custom?: boolean;
}

/** What is saved per integration. */
export interface IntegrationState {
  enabled: boolean;
  configured: boolean;
  /** Non-secret settings by field key. */
  values: Record<string, string | boolean>;
  /** Secret fields that hold a stored value (the value itself stays server-side). */
  secrets: Record<string, boolean>;
  /** Last message, sync or check (ISO). */
  lastAt?: string;
  setUpAt?: string;
  /** When it was last turned on or off (ISO). */
  toggledAt?: string;
}

export interface TestResult extends TestOutcome {
  at: string;
}

const t = (hms: string) => `2026-10-15T${hms}-03:00`;
const opts = (...v: (string | [string, string])[]) => v.map((x) => (Array.isArray(x) ? { value: x[0], es: x[1] } : { value: x }));
const keepSecret = l('Stored encrypted. Leave blank to keep it.', 'Guardado cifrado. Déjelo en blanco para conservarlo.');

/** Clip storage in use (TB); the storage integration and Plan and usage both show it. */
export const STORAGE_USED_TB = 2.1;
export const STORAGE_PLAN_TB = 5;

export const INTEGRATIONS: IntegrationDef[] = [
  {
    id: 'connect',
    name: l('Connect', 'Connect'),
    icon: 'layers',
    description: l('Voyages, schedule and cargo in; events and port times out', 'Viajes, programación y carga entran; eventos y horarios de puerto salen'),
    fields: [
      { key: 'url', label: l('Connect API address', 'Dirección de la API de Connect'), kind: 'url', required: true },
      { key: 'client', label: l('Client ID', 'ID de cliente'), kind: 'text', required: true },
      { key: 'secret', label: l('Client secret', 'Secreto de cliente'), kind: 'secret', hint: keepSecret, required: true },
      { key: 'interval', label: l('Sync interval', 'Intervalo de sincronización'), kind: 'select', options: opts('1 min', '5 min', '15 min') },
      { key: 'out', label: l('Write events and port times back to Connect', 'Escribir eventos y horarios de puerto en Connect'), kind: 'toggle' },
    ],
    test: { tone: 'ok', en: 'Connect API answered in 212 ms · token valid until 16 Oct 02:00', es: 'La API de Connect respondió en 212 ms · token válido hasta el 16 oct 02:00' },
    disableWarning: l(
      'Voyages, convoy make-up and cargo lists stop updating, and events no longer reach the voyage record.',
      'Los viajes, la composición de convoyes y las listas de carga dejan de actualizarse, y los eventos ya no llegan al registro del viaje.',
    ),
  },
  {
    id: 'whatsapp',
    name: l('WhatsApp messaging', 'Mensajería WhatsApp'),
    icon: 'message',
    description: l('Alerts to shore roles with the clip page link', 'Alertas a los roles en tierra con el enlace a la página del clip'),
    fields: [
      { key: 'number', label: l('Business sender number', 'Número de remitente comercial'), kind: 'text', required: true },
      { key: 'token', label: l('Access token', 'Token de acceso'), kind: 'secret', hint: keepSecret, required: true },
      { key: 'lang', label: l('Default message language', 'Idioma predeterminado de los mensajes'), kind: 'select', options: opts(['Spanish', 'Español'], ['English', 'Inglés']) },
      { key: 'link', label: l('Include the one-time phone page link', 'Incluir el enlace de un solo uso a la página del teléfono'), kind: 'toggle' },
    ],
    test: { tone: 'ok', en: 'Business API reachable · alert templates approved (es, en)', es: 'API comercial accesible · plantillas de alerta aprobadas (es, en)' },
    disableWarning: l(
      'Alerts fall back to SMS for every recipient. Escalation timers keep running.',
      'Las alertas pasan a SMS para todos los destinatarios. Los temporizadores de escalamiento siguen corriendo.',
    ),
  },
  {
    id: 'sms',
    name: l('SMS gateway', 'Pasarela SMS'),
    icon: 'send',
    description: l('Fallback and escalation messages', 'Mensajes de respaldo y de escalamiento'),
    fields: [
      {
        key: 'provider',
        label: l('Provider', 'Proveedor'),
        kind: 'select',
        options: opts(['Regional SMS gateway', 'Pasarela SMS regional'], ['Global SMS provider', 'Proveedor SMS global']),
      },
      { key: 'sender', label: l('Sender ID', 'ID de remitente'), kind: 'text', required: true },
      { key: 'key', label: l('API key', 'Clave de API'), kind: 'secret', hint: keepSecret, required: true },
    ],
    test: {
      tone: 'ok',
      en: 'Gateway reachable in 184 ms · sender ID approved in Paraguay, Argentina and Uruguay',
      es: 'Pasarela accesible en 184 ms · ID de remitente aprobado en Paraguay, Argentina y Uruguay',
    },
    disableWarning: l(
      'Messages that fail on WhatsApp get no fallback, and escalations by SMS stop.',
      'Los mensajes que fallan por WhatsApp quedan sin respaldo y se detienen los escalamientos por SMS.',
    ),
  },
  {
    id: 'email',
    name: l('Email', 'Correo electrónico'),
    icon: 'mail',
    description: l('Escalations, digests and daily reports', 'Escalamientos, resúmenes e informes diarios'),
    fields: [
      { key: 'host', label: l('SMTP server', 'Servidor SMTP'), kind: 'text', required: true },
      { key: 'from', label: l('From address', 'Dirección de remitente'), kind: 'email', required: true },
      { key: 'tls', label: l('Require TLS', 'Exigir TLS'), kind: 'toggle' },
    ],
    test: { tone: 'ok', en: 'SMTP handshake OK · TLS 1.3 · test message accepted', es: 'Conexión SMTP correcta · TLS 1.3 · mensaje de prueba aceptado' },
  },
  {
    id: 'voice',
    name: l('Voice call', 'Llamada de voz'),
    icon: 'phone',
    description: l('Automated calls for P1 escalations', 'Llamadas automáticas para escalamientos P1'),
    fields: [
      { key: 'caller', label: l('Caller ID', 'Identificador de llamada'), kind: 'text', required: true },
      {
        key: 'after',
        label: l('Call when a P1 is not acknowledged after', 'Llamar cuando una P1 no se confirma después de'),
        kind: 'select',
        options: opts('2 min', '3 min', '5 min'),
      },
      { key: 'lang', label: l('Spoken language', 'Idioma de la llamada'), kind: 'select', options: opts(['Spanish', 'Español'], ['English', 'Inglés']) },
    ],
    test: { tone: 'ok', en: 'Voice provider reachable · caller ID verified · no call placed', es: 'Proveedor de voz accesible · identificador verificado · no se realizó ninguna llamada' },
    disableWarning: l(
      'P1 escalations go out by message only. The PRD calls for a voice call on P1.',
      'Los escalamientos P1 salen solo por mensaje. El PRD pide una llamada de voz para P1.',
    ),
  },
  {
    id: 'positions',
    name: l('Vessel positions', 'Posiciones de los buques'),
    icon: 'pin',
    description: l('GPS from each edge unit every minute · AIS optional', 'GPS de cada unidad de borde cada minuto · AIS opcional'),
    fields: [
      { key: 'interval', label: l('Position interval', 'Intervalo de posición'), kind: 'select', options: opts('30 s', '1 min', '5 min') },
      {
        key: 'ais',
        label: l('Fill coverage gaps from an AIS feed', 'Cubrir los huecos de cobertura con un servicio AIS'),
        kind: 'toggle',
        hint: l('Needs an AIS feed integration that is set up.', 'Requiere una integración de servicio AIS configurada.'),
      },
    ],
    test: { tone: 'ok', en: '', es: '' },
  },
  {
    id: 'recorders',
    name: l('Video recorders', 'Grabadores de video'),
    icon: 'video',
    description: l('RTSP streams from the recorders on each vessel', 'Flujos RTSP de los grabadores de cada buque'),
    fields: [
      { key: 'protocol', label: l('Protocol', 'Protocolo'), kind: 'select', options: opts('RTSP', 'ONVIF') },
      {
        key: 'creds',
        label: l('Recorder credentials', 'Credenciales de los grabadores'),
        kind: 'secret',
        hint: l('Held on each edge unit, never ashore. Leave blank to keep them.', 'Se guardan en cada unidad de borde, nunca en tierra. Déjelo en blanco para conservarlas.'),
        required: true,
      },
      { key: 'buffer', label: l('Rolling buffer on the edge unit', 'Búfer continuo en la unidad de borde'), kind: 'select', options: opts('12 h', '24 h', '48 h') },
    ],
    test: { tone: 'ok', en: '', es: '' },
    disableWarning: l(
      'Edge units stop reading the recorders: no detection, no wheelhouse alerts.',
      'Las unidades de borde dejan de leer los grabadores: sin detección ni alertas en el puente.',
    ),
  },
  {
    id: 'reefer',
    name: l('Reefer monitoring', 'Monitoreo de reefers'),
    icon: 'thermometer',
    description: l('Match reefer alarms to the video of the affected row', 'Vincula las alarmas de reefers con el video de la fila afectada'),
    fields: [
      { key: 'url', label: l('Reefer system address', 'Dirección del sistema de reefers'), kind: 'url', required: true },
      { key: 'key', label: l('API key', 'Clave de API'), kind: 'secret', required: true },
      { key: 'match', label: l('Open the matching camera when a reefer alarms', 'Abrir la cámara correspondiente cuando un reefer da alarma'), kind: 'toggle' },
    ],
    test: { tone: 'ok', en: 'Reefer system answered · 24 reefer points found', es: 'El sistema de reefers respondió · 24 puntos de reefer encontrados' },
  },
  {
    id: 'sso',
    name: l('Single sign-on (SAML)', 'Inicio de sesión único (SAML)'),
    icon: 'key',
    description: l('Sign in with the GFSA directory, MFA enforced', 'Ingreso con el directorio de GFSA, MFA obligatorio'),
    fields: [
      { key: 'metadata', label: l('Identity provider metadata URL', 'URL de metadatos del proveedor de identidad'), kind: 'url', required: true },
      { key: 'entity', label: l('Entity ID', 'ID de entidad'), kind: 'text', required: true },
      { key: 'mfa', label: l('Require MFA for every shore role', 'Exigir MFA a todos los roles en tierra'), kind: 'toggle' },
    ],
    test: { tone: 'ok', en: 'Metadata valid · signing certificate expires 3 Mar 2027', es: 'Metadatos válidos · el certificado de firma vence el 3 mar 2027' },
    disableWarning: l(
      'Nobody can sign in to the console except the break-glass administrator.',
      'Nadie puede ingresar a la consola salvo el administrador de emergencia.',
    ),
  },
  {
    id: 'storage',
    name: l('Object storage', 'Almacenamiento de objetos'),
    icon: 'hardDrive',
    description: l('Clips 90 days, events 12 months, encrypted at rest', 'Clips 90 días, eventos 12 meses, cifrado en reposo'),
    fields: [
      { key: 'bucket', label: l('Bucket', 'Bucket'), kind: 'text', required: true },
      {
        key: 'region',
        label: l('Region', 'Región'),
        kind: 'select',
        options: opts(['South America (São Paulo)', 'Sudamérica (São Paulo)'], ['South America (Santiago)', 'Sudamérica (Santiago)']),
      },
      { key: 'clips', label: l('Clip retention', 'Retención de clips'), kind: 'select', options: opts(['30 days', '30 días'], ['60 days', '60 días'], ['90 days', '90 días']) },
    ],
    test: { tone: 'ok', en: 'Write, read and delete of a test object OK · 96 ms', es: 'Escritura, lectura y borrado de un objeto de prueba correctos · 96 ms' },
    disableWarning: l(
      'New clips stay queued on the edge units and cannot be viewed ashore.',
      'Los clips nuevos quedan en cola en las unidades de borde y no se pueden ver en tierra.',
    ),
  },
];

export const initialStates: Record<string, IntegrationState> = {
  connect: {
    enabled: true,
    configured: true,
    values: { url: 'https://connect.gfsa.example/api/v2', client: 'cctv-monitoring-prod', interval: '5 min', out: true },
    secrets: { secret: true },
    lastAt: t('14:35:02'),
  },
  whatsapp: { enabled: true, configured: true, values: { number: '+595 21 600 4100', lang: 'Spanish', link: true }, secrets: { token: true }, lastAt: t('14:32:52') },
  sms: { enabled: true, configured: true, values: { provider: 'Regional SMS gateway', sender: 'GFSA-CCTV' }, secrets: { key: true }, lastAt: t('14:32:52') },
  email: { enabled: true, configured: true, values: { host: 'smtp.gfsa.example:587', from: 'cctv-alertas@gfsa.example', tls: true }, secrets: {}, lastAt: t('06:00:00') },
  voice: { enabled: true, configured: true, values: { caller: '+595 21 600 4100', after: '3 min', lang: 'Spanish' }, secrets: {}, lastAt: t('11:58:40') },
  positions: { enabled: true, configured: true, values: { interval: '1 min', ais: false }, secrets: {} },
  recorders: { enabled: true, configured: true, values: { protocol: 'RTSP', buffer: '24 h' }, secrets: { creds: true }, lastAt: t('14:30:00') },
  reefer: { enabled: true, configured: false, values: { url: '', match: true }, secrets: {} },
  sso: {
    enabled: true,
    configured: true,
    values: { metadata: 'https://login.gfsa.example/saml/metadata', entity: 'urn:cctv-monitoring:gfsa', mfa: true },
    secrets: {},
    lastAt: t('14:21:02'),
  },
  storage: {
    enabled: true,
    configured: true,
    values: { bucket: 'gfsa-cctv-clips-sa-east', region: 'South America (São Paulo)', clips: '90 days' },
    secrets: {},
    lastAt: t('14:35:40'),
  },
};

// ---------- Added integrations ----------

export type AddableKind = 'ais' | 'webhook' | 'maintenance';

export const ADDABLE: { kind: AddableKind; name: L; icon: IconName; description: L; test: TestOutcome }[] = [
  {
    kind: 'ais',
    name: l('AIS feed', 'Servicio AIS'),
    icon: 'globe',
    description: l('Positions from an AIS provider while a convoy is out of coverage', 'Posiciones de un proveedor AIS mientras un convoy está sin cobertura'),
    test: { tone: 'ok', en: 'AIS provider answered · 3 of 3 tugs found by MMSI', es: 'El proveedor AIS respondió · 3 de 3 remolcadores encontrados por MMSI' },
  },
  {
    kind: 'webhook',
    name: l('Outbound webhook', 'Webhook saliente'),
    icon: 'share',
    description: l('Send events to another GFSA system as they arrive', 'Envía los eventos a otro sistema de GFSA a medida que llegan'),
    test: { tone: 'ok', en: 'Endpoint accepted a signed test event · HTTP 202', es: 'El destino aceptó un evento de prueba firmado · HTTP 202' },
  },
  {
    kind: 'maintenance',
    name: l('Maintenance system', 'Sistema de mantenimiento'),
    icon: 'file',
    description: l('Open a work order when a camera or edge unit fails', 'Abre una orden de trabajo cuando falla una cámara o una unidad de borde'),
    test: { tone: 'ok', en: 'Maintenance API answered · work order type "CCTV fault" found', es: 'La API de mantenimiento respondió · tipo de orden "Falla CCTV" encontrado' },
  },
];

/** A saved added integration; its definition is rebuilt from the kind. */
export interface CustomIntegration {
  id: string;
  name: string;
  kind: AddableKind;
}

export function customDef(c: CustomIntegration): IntegrationDef {
  const a = ADDABLE.find((x) => x.kind === c.kind) ?? ADDABLE[0];
  return {
    id: c.id,
    name: { en: c.name, es: c.name },
    icon: a.icon,
    description: a.description,
    custom: true,
    fields: [
      { key: 'url', label: l('Endpoint address', 'Dirección del destino'), kind: 'url', required: true },
      { key: 'key', label: l('API key', 'Clave de API'), kind: 'secret', hint: keepSecret, required: true },
    ],
    test: a.test,
  };
}

// ---------- Connect mapping and sync log ----------

export interface MappingRow {
  id: string;
  object: L;
  direction: 'in' | 'out';
  use: L;
  /** ISO time of the last sync of this object. */
  lastSync: string;
  records: L;
}

export const initialMapping: MappingRow[] = [
  { id: 'voyages', object: l('Voyages', 'Viajes'), direction: 'in', use: l('Voyage record, schedule and status', 'Registro, programación y estado del viaje'), lastSync: t('14:35:02'), records: l('3', '3') },
  { id: 'makeup', object: l('Convoy make-up', 'Composición del convoy'), direction: 'in', use: l('Tug and barge groups, camera trees', 'Grupos de remolcador y barcazas, árbol de cámaras'), lastSync: t('14:35:02'), records: l('3', '3') },
  { id: 'schedule', object: l('Operational schedule', 'Programación operativa'), direction: 'in', use: l('When use cases run, port calls', 'Cuándo corren los casos de uso, escalas'), lastSync: t('14:35:02'), records: l('9 calls', '9 escalas') },
  { id: 'cargo', object: l('Cargo lists', 'Listas de carga'), direction: 'in', use: l('Container count check', 'Control del conteo de contenedores'), lastSync: t('14:35:02'), records: l('84 containers', '84 contenedores') },
  { id: 'reefer-times', object: l('Reefer round times', 'Horarios de rondas de reefers'), direction: 'in', use: l('Round compliance', 'Cumplimiento de rondas'), lastSync: t('14:35:02'), records: l('every 6 h', 'cada 6 h') },
  { id: 'events', object: l('Events', 'Eventos'), direction: 'out', use: l('On the voyage record', 'En el registro del viaje'), lastSync: t('14:35:02'), records: l('41 this voyage', '41 en este viaje') },
  { id: 'port-times', object: l('Actual port times', 'Horarios reales de puerto'), direction: 'out', use: l('Beside the schedule', 'Junto a la programación'), lastSync: '2026-10-11T06:12:00-03:00', records: l('1', '1') },
  { id: 'differences', object: l('Container differences', 'Diferencias de contenedores'), direction: 'out', use: l('Flagged on the cargo list', 'Marcadas en la lista de carga'), lastSync: '2026-10-11T07:40:00-03:00', records: l('1', '1') },
  { id: 'missed-rounds', object: l('Missed reefer rounds', 'Rondas de reefers perdidas'), direction: 'out', use: l('Task on the voyage', 'Tarea en el viaje'), lastSync: '2026-10-14T02:16:00-03:00', records: l('1', '1') },
];

export interface SyncEntry {
  id: string;
  at: string; // ISO
  tone: Tone;
  result: 'ok' | 'retried' | 'failed' | 'sent';
  text: L;
  /** Who asked for it, for manual syncs. */
  by?: string;
}

export const SYNC_RESULT: Record<SyncEntry['result'], L> = {
  ok: l('OK', 'OK'),
  retried: l('Retried once', 'Reintentado una vez'),
  failed: l('Failed', 'Fallido'),
  sent: l('Sent', 'Enviado'),
};

export const initialSyncLog: SyncEntry[] = [
  { id: 's-1435', at: t('14:35:02'), tone: 'ok', result: 'ok', text: l('3 voyages, 1 schedule change', '3 viajes, 1 cambio de programación') },
  { id: 's-1430', at: t('14:30:01'), tone: 'ok', result: 'ok', text: l('No changes', 'Sin cambios') },
  { id: 's-1425', at: t('14:25:01'), tone: 'ok', result: 'ok', text: l('2 cargo list updates (VOY-26-040)', '2 actualizaciones de listas de carga (VOY-26-040)') },
  { id: 's-1420', at: t('14:20:03'), tone: 'ok', result: 'ok', text: l('No changes', 'Sin cambios') },
  { id: 's-1415', at: t('14:15:01'), tone: 'warn', result: 'retried', text: l('Timeout after 8 s, then OK', 'Tiempo de espera agotado a los 8 s, luego OK') },
  { id: 's-1410', at: t('14:10:01'), tone: 'ok', result: 'ok', text: l('No changes', 'Sin cambios') },
];

/** Where scheduled syncs have been written up to (ms); scheduled syncs after it are added when due. */
export const initialSyncClock = new Date(t('14:35:02')).getTime();

/** What a scheduled sync at this time brought back. Deterministic, so every window agrees. */
export function scheduledSync(atMs: number): Pick<SyncEntry, 'tone' | 'result' | 'text'> {
  const k = Math.floor(atMs / 60_000) % 11;
  if (k === 3) return { tone: 'ok', result: 'ok', text: l('1 schedule change', '1 cambio de programación') };
  if (k === 7) return { tone: 'ok', result: 'ok', text: l('2 cargo list updates (VOY-26-041)', '2 actualizaciones de listas de carga (VOY-26-041)') };
  if (k === 9) return { tone: 'warn', result: 'retried', text: l('Timeout after 8 s, then OK', 'Tiempo de espera agotado a los 8 s, luego OK') };
  return { tone: 'ok', result: 'ok', text: l('No changes', 'Sin cambios') };
}

export const intervalMs = (v: string) => (v === '1 min' ? 60_000 : v === '15 min' ? 15 * 60_000 : 5 * 60_000);
