import { useState } from 'react';
import { Card, Meter, PageHeader, Segmented } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useApp } from '../../state/AppState';
import { useFleet } from '../../state/fleetStore';
import { useUsers } from '../../state/usersStore';
import { openSupportCase, useSupportCases, SUPPORT_RESPONSE, type SupportCase, type SupportPriority } from '../../state/supportStore';
import { ucStore } from '../../state/configStore';
import { roleById } from '../../data/users';
import type { AuditEntry, RoleId } from '../../data/types';
import { useStore, usePersistentState } from '../../lib/persist';
import { useTr } from '../../lib/i18n';
import { useExporter } from '../../lib/exporting';
import type { PdfBlock } from '../../lib/download';
import { TZ, fmtDay, fmtDayTime, fmtSmart, fmtTime, scenarioNow, useNow } from '../../lib/time';
import { AdminDialog, useFullDate, useNum } from './adminKit';
import { STORAGE_PLAN_TB, STORAGE_USED_TB } from './integrationsData';
import './Plan.css';

type Period = 'q4' | 'q3';
type Tr = (en: string, es: string) => string;

const PLAN = { edgeUnits: 12, cameras: 36, users: 25, storageTb: STORAGE_PLAN_TB, messages: 5000 };

/** Alert messages sent in October before the loaded audit log starts (the log's own sends are counted live). */
const OCT_MESSAGES_BEFORE_LOG = 737;

const monthKey = (v: string | number) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).format(new Date(v));

/** Messages behind one "Sent alert" / "Sent reminder" entry: one per channel named. */
const messagesIn = (e: AuditEntry) => Math.max(1, (e.details ?? '').match(/WhatsApp|SMS|email|voice call/gi)?.length ?? 0);

interface UsageItem {
  id: string;
  label: string;
  used: number;
  limit: number;
  unit?: 'TB';
  /** Note under the meter while within the plan. */
  note: string;
  /** When usage went above the plan. */
  overWhen?: string;
}

interface Invoice {
  id: string;
  period: [string, string];
  issued: string; // ISO date
  due: string;
  paid: boolean;
  items: { en: string; es: string; qty: string; note?: [string, string] }[];
}

const PLAN_ITEMS: Invoice['items'] = [
  { en: 'Edge units', es: 'Unidades de borde', qty: String(PLAN.edgeUnits), note: ['Entitlement', 'Derecho'] },
  { en: 'Cameras', es: 'Cámaras', qty: String(PLAN.cameras), note: ['Entitlement', 'Derecho'] },
  { en: 'Users', es: 'Usuarios', qty: String(PLAN.users), note: ['Entitlement', 'Derecho'] },
  { en: 'Clip storage', es: 'Almacenamiento de clips', qty: `${PLAN.storageTb} TB`, note: ['90-day rolling', '90 días móviles'] },
  { en: 'Alert messages', es: 'Mensajes de alerta', qty: '5,000 / month', note: ['Entitlement', 'Derecho'] },
];

const INVOICES: Invoice[] = [
  {
    id: 'INV-26-0412',
    period: ['Q3 · Jul–Sep 2026', 'T3 · jul–sep 2026'],
    issued: '2026-10-01T12:00:00-03:00',
    due: '2026-10-31T12:00:00-03:00',
    paid: false,
    items: [
      { en: 'Fleet plan, quarterly fee', es: 'Plan de flota, cuota trimestral', qty: '1', note: ['Jul–Sep 2026', 'jul–sep 2026'] },
      ...PLAN_ITEMS,
      { en: 'Alert messages above the plan', es: 'Mensajes de alerta por encima del plan', qty: '412', note: ['August · reported, service not cut', 'Agosto · informado, sin corte del servicio'] },
    ],
  },
  {
    id: 'INV-26-0298',
    period: ['Q2 · Apr–Jun 2026', 'T2 · abr–jun 2026'],
    issued: '2026-07-01T12:00:00-03:00',
    due: '2026-07-31T12:00:00-03:00',
    paid: true,
    items: [{ en: 'Fleet plan, quarterly fee', es: 'Plan de flota, cuota trimestral', qty: '1', note: ['Apr–Jun 2026', 'abr–jun 2026'] }, ...PLAN_ITEMS],
  },
  {
    id: 'INV-26-0171',
    period: ['Q1 pilot · Jan–Mar 2026', 'T1 piloto · ene–mar 2026'],
    issued: '2026-04-01T12:00:00-03:00',
    due: '2026-04-30T12:00:00-03:00',
    paid: true,
    items: [{ en: 'Pilot quarter, one convoy', es: 'Trimestre piloto, un convoy', qty: '1', note: ['Jan–Mar 2026', 'ene–mar 2026'] }],
  },
  {
    id: 'INV-25-0890',
    period: ['Pilot set-up', 'Puesta en marcha del piloto'],
    issued: '2025-12-12T12:00:00-03:00',
    due: '2026-01-11T12:00:00-03:00',
    paid: true,
    items: [{ en: 'Pilot set-up, installation and training', es: 'Puesta en marcha, instalación y capacitación del piloto', qty: '1' }],
  },
];

const PRIORITIES: { value: SupportPriority; label: [string, string]; note: [string, string] }[] = [
  { value: 'P1', label: ['P1 Critical', 'P1 Crítica'], note: ['Alerts not reaching people, service down', 'Las alertas no llegan a las personas, servicio caído'] },
  { value: 'P2', label: ['P2 High', 'P2 Alta'], note: ['A convoy or feature degraded', 'Un convoy o una función degradados'] },
  { value: 'P3', label: ['P3 Normal', 'P3 Normal'], note: ['Questions, changes, small faults', 'Consultas, cambios, fallas menores'] },
];

const CHANGE_ITEMS: { id: string; en: string; es: string; addon?: boolean }[] = [
  { id: 'edge', en: 'Edge units', es: 'Unidades de borde' },
  { id: 'cameras', en: 'Cameras', es: 'Cámaras' },
  { id: 'users', en: 'Users', es: 'Usuarios' },
  { id: 'storage', en: 'Clip storage (TB)', es: 'Almacenamiento de clips (TB)' },
  { id: 'messages', en: 'Alert messages a month', es: 'Mensajes de alerta por mes' },
  { id: 'thermal', en: 'Thermal cameras add-on', es: 'Complemento de cámaras térmicas', addon: true },
];

interface ChangeRequest {
  id: string; // CHG-26-0101
  item: string; // CHANGE_ITEMS id
  qty: number;
  note: string;
  at: string;
  by: string;
  status: 'sent' | 'withdrawn';
  withdrawnAt?: string;
}

interface BillingContact {
  userId: string;
  /** Kept in case the person leaves the directory. */
  name: string;
  role: RoleId;
  finance: string;
}

const STATUS_LABEL: Record<SupportCase['status'], [string, string]> = {
  open: ['Open', 'Abierto'],
  answered: ['Answered', 'Respondido'],
  closed: ['Closed', 'Cerrado'],
};

type DialogKind = null | 'support' | 'change' | 'contact';

/** ADM-05: plan entitlements, usage, invoices, service health and support. */
export function PlanPage() {
  const { can, log, toast, state } = useApp();
  const tr = useTr();
  const es = state.lang === 'es';
  const num = useNum();
  const fullDate = useFullDate();
  const ex = useExporter();
  const fleet = useFleet();
  const users = useUsers();
  const ucRecords = useStore(ucStore);
  const cases = useSupportCases();
  const now = useNow(30_000);
  const canBill = can('plan_billing');
  const [period, setPeriod] = useState<Period>('q4');
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [requests, setRequests] = usePersistentState<ChangeRequest[]>('plan.changeRequests', []);
  const [contact, setContact] = usePersistentState<BillingContact>('plan.billingContact', {
    userId: 'u10',
    name: 'Diego Rojas',
    role: 'tenant_admin',
    finance: 'facturacion@gfsa.example',
  });

  const pct = (u: number, l: number) => Math.round((u / l) * 100);
  const roleName = (r: RoleId) => {
    const role = roleById(r);
    return tr(role.name, role.nameEs);
  };
  const contactUser = users.find((u) => u.id === contact.userId);
  const contactName = contactUser?.name ?? contact.name;

  // ---------- Live usage ----------
  // Seats: directory users not suspended, plus the service account the wheelhouse displays use.
  const seats = users.filter((u) => u.status !== 'suspended').length + 1;
  const liveUseCases = Object.values(ucRecords).filter((r) => r.status === 'live').length;
  const month = monthKey(now);
  const sentThisMonth = state.audit
    .filter((e) => (e.action === 'Sent alert' || e.action === 'Sent reminder') && monthKey(e.at) === month)
    .reduce((s, e) => s + messagesIn(e), 0);
  const messages = (month === '2026-10' ? OCT_MESSAGES_BEFORE_LOG : 0) + sentThisMonth;

  const usage: Record<Period, { title: string; range: string; items: UsageItem[] }> = {
    q4: {
      title: tr('Q4', 'T4'),
      range: tr('1 Oct – 31 Dec 2026', '1 oct – 31 dic 2026'),
      items: [
        {
          id: 'edge',
          label: tr('Edge units', 'Unidades de borde'),
          used: fleet.edgeUnits.length,
          limit: PLAN.edgeUnits,
          note: tr(
            `${pct(fleet.edgeUnits.length, PLAN.edgeUnits)}% of the plan · ${PLAN.edgeUnits - fleet.edgeUnits.length} units free for the pilot's next convoy`,
            `${pct(fleet.edgeUnits.length, PLAN.edgeUnits)}% del plan · ${PLAN.edgeUnits - fleet.edgeUnits.length} unidades libres para el próximo convoy del piloto`,
          ),
        },
        {
          id: 'cameras',
          label: tr('Cameras', 'Cámaras'),
          used: fleet.cameras.length,
          limit: PLAN.cameras,
          note: tr(
            `${pct(fleet.cameras.length, PLAN.cameras)}% of the plan · ${PLAN.cameras - fleet.cameras.length} camera slots free`,
            `${pct(fleet.cameras.length, PLAN.cameras)}% del plan · ${PLAN.cameras - fleet.cameras.length} cupos de cámara libres`,
          ),
        },
        {
          id: 'users',
          label: tr('Users', 'Usuarios'),
          used: seats,
          limit: PLAN.users,
          note: tr(
            `${pct(seats, PLAN.users)}% of the plan · ${PLAN.users - seats} seats free · includes the wheelhouse display account`,
            `${pct(seats, PLAN.users)}% del plan · ${PLAN.users - seats} lugares libres · incluye la cuenta de las pantallas del puente`,
          ),
        },
        {
          id: 'storage',
          label: tr('Clip storage', 'Almacenamiento de clips'),
          used: STORAGE_USED_TB,
          limit: PLAN.storageTb,
          unit: 'TB',
          note: tr(`${pct(STORAGE_USED_TB, PLAN.storageTb)}% of the plan · 90-day rolling`, `${pct(STORAGE_USED_TB, PLAN.storageTb)}% del plan · 90 días móviles`),
        },
        {
          id: 'messages',
          label: tr('Alert messages', 'Mensajes de alerta'),
          used: messages,
          limit: PLAN.messages,
          note: tr(
            `${pct(messages, PLAN.messages)}% of the plan · month to date, counted as they are sent · resets 1 Nov`,
            `${pct(messages, PLAN.messages)}% del plan · en lo que va del mes, contados al enviarse · se reinicia el 1 nov`,
          ),
        },
      ],
    },
    q3: {
      title: tr('Q3', 'T3'),
      range: tr('1 Jul – 30 Sep 2026', '1 jul – 30 sep 2026'),
      items: [
        { id: 'edge', label: tr('Edge units', 'Unidades de borde'), used: 10, limit: PLAN.edgeUnits, note: tr('83% of the plan · peak in the quarter', '83% del plan · pico del trimestre') },
        { id: 'cameras', label: tr('Cameras', 'Cámaras'), used: 30, limit: PLAN.cameras, note: tr('83% of the plan · peak in the quarter', '83% del plan · pico del trimestre') },
        { id: 'users', label: tr('Users', 'Usuarios'), used: 12, limit: PLAN.users, note: tr('48% of the plan · peak in the quarter', '48% del plan · pico del trimestre') },
        { id: 'storage', label: tr('Clip storage', 'Almacenamiento de clips'), used: 1.8, limit: PLAN.storageTb, unit: 'TB', note: tr('36% of the plan · 90-day rolling', '36% del plan · 90 días móviles') },
        {
          id: 'messages',
          label: tr('Alert messages', 'Mensajes de alerta'),
          used: 5412,
          limit: PLAN.messages,
          note: tr('108% of the plan · busiest month', '108% del plan · mes de mayor uso'),
          overWhen: tr('in August', 'en agosto'),
        },
      ],
    },
  };

  const fmtUse = (i: UsageItem) => (i.unit ? tr(`${num(i.used, 1)} of ${i.limit} TB`, `${num(i.used, 1)} de ${i.limit} TB`) : tr(`${num(i.used)} of ${num(i.limit)}`, `${num(i.used)} de ${num(i.limit)}`));
  const shown = usage[period];
  const over = shown.items.filter((i) => i.used > i.limit);
  const q4 = usage.q4.items;
  const used = (id: string) => q4.find((i) => i.id === id)!;

  const entitlements: { label: string; value: string; sub?: string }[] = [
    { label: tr('Edge units', 'Unidades de borde'), value: String(PLAN.edgeUnits), sub: tr(`${used('edge').used} in use`, `${used('edge').used} en uso`) },
    { label: tr('Cameras', 'Cámaras'), value: String(PLAN.cameras), sub: tr(`${used('cameras').used} in use`, `${used('cameras').used} en uso`) },
    { label: tr('Users', 'Usuarios'), value: String(PLAN.users), sub: tr(`${seats} in use`, `${seats} en uso`) },
    { label: tr('Use cases', 'Casos de uso'), value: tr('All 35 in the GFSA workbook', 'Los 35 del libro de trabajo de GFSA'), sub: tr(`${liveUseCases} live`, `${liveUseCases} en vivo`) },
    { label: tr('Event retention', 'Retención de eventos'), value: tr('12 months', '12 meses') },
    { label: tr('Clip retention', 'Retención de clips'), value: tr('90 days', '90 días') },
    { label: tr('Clip storage', 'Almacenamiento de clips'), value: `${PLAN.storageTb} TB`, sub: tr(`${num(STORAGE_USED_TB, 1)} TB used`, `${num(STORAGE_USED_TB, 1)} TB usados`) },
    { label: tr('Alert messages', 'Mensajes de alerta'), value: tr(`${num(PLAN.messages)} a month`, `${num(PLAN.messages)} por mes`), sub: tr(`${num(messages)} this month`, `${num(messages)} este mes`) },
    { label: tr('Model updates', 'Actualizaciones de modelos'), value: tr('Monthly, signed', 'Mensuales, firmadas'), sub: tr('next v1.5 on 28 Oct', 'próxima v1.5 el 28 oct') },
    { label: tr('Shadow runs', 'Ejecuciones en sombra'), value: tr('Included', 'Incluidas') },
    { label: tr('Support', 'Soporte'), value: '24/7', sub: tr('P1 response 15 min · P2 1 h', 'Respuesta P1 15 min · P2 1 h') },
    { label: tr('Hosting', 'Alojamiento'), value: tr('Cloud, South America', 'Nube, Sudamérica'), sub: tr('GFSA-owned data', 'Datos propiedad de GFSA') },
  ];
  const addOns = tr('Thermal cameras: not included · Spanish UI: included', 'Cámaras térmicas: no incluidas · Interfaz en español: incluida');

  // ---------- Files ----------
  const downloadInvoice = (inv: Invoice) => {
    const blocks: PdfBlock[] = [
      {
        kind: 'kv',
        rows: [
          [tr('Customer', 'Cliente'), 'GFSA'],
          [tr('Agreement', 'Contrato'), tr('GFSA-2026-01 · Fleet plan, annual', 'GFSA-2026-01 · Plan de flota, anual')],
          [tr('Period', 'Período'), tr(...inv.period)],
          [tr('Issued', 'Emitida'), fullDate(inv.issued)],
          [tr('Due', 'Vencimiento'), fullDate(inv.due)],
          [tr('Status', 'Estado'), inv.paid ? tr('Paid', 'Pagada') : tr(`Due ${fullDate(inv.due)}`, `Vence el ${fullDate(inv.due)}`)],
          [tr('Billing contact', 'Contacto de facturación'), `${contactName} (${roleName(contact.role)})`],
          [tr('Finance copy', 'Copia a finanzas'), contact.finance],
        ],
      },
      { kind: 'h2', text: tr('Billed items', 'Conceptos facturados') },
      {
        kind: 'table',
        columns: [
          { label: tr('Item', 'Concepto'), width: 3 },
          { label: tr('Quantity', 'Cantidad'), width: 1.2, align: 'right' },
          { label: tr('Note', 'Nota'), width: 2.4 },
        ],
        rows: inv.items.map((i) => [tr(i.en, i.es), es ? i.qty.replace('5,000 / month', '5.000 / mes') : i.qty, i.note ? tr(...i.note) : '']),
      },
      {
        kind: 'p',
        text: tr(
          'Copy for the console. Amounts and taxes are on the original issued by the billing system; usage above the plan is billed, never cut off.',
          'Copia para la consola. Los importes e impuestos figuran en el original emitido por el sistema de facturación; el uso por encima del plan se factura, nunca se corta.',
        ),
      },
    ];
    ex.pdf(
      `${inv.id}.pdf`,
      { title: tr(`Invoice ${inv.id}`, `Factura ${inv.id}`), subtitle: tr('CCTV Monitoring · Fleet plan, annual', 'Monitoreo CCTV · Plan de flota, anual'), blocks },
      { action: 'Downloaded invoice', target: inv.id, details: 'PDF' },
    );
  };

  const viewAgreement = () => {
    ex.pdf(
      'Agreement_GFSA-2026-01_summary.pdf',
      {
        title: tr('Agreement GFSA-2026-01 · summary', 'Contrato GFSA-2026-01 · resumen'),
        subtitle: tr(
          'Fleet plan, annual · 1 Apr 2026 to 31 Mar 2027 · invoiced quarterly · renews 1 Apr 2027',
          'Plan de flota, anual · 1 abr 2026 al 31 mar 2027 · facturado por trimestre · se renueva el 1 abr 2027',
        ),
        blocks: [
          { kind: 'h2', text: tr('What the agreement includes', 'Qué incluye el contrato') },
          { kind: 'kv', rows: entitlements.map((e) => [e.label, e.value]) },
          { kind: 'kv', rows: [[tr('Add-ons', 'Complementos'), addOns]] },
          { kind: 'h2', text: tr(`In use on ${fmtDayTime(now)}`, `En uso al ${fmtDayTime(now)}`) },
          {
            kind: 'table',
            columns: [
              { label: tr('Item', 'Concepto'), width: 2 },
              { label: tr('In use', 'En uso'), width: 1.4, align: 'right' },
              { label: tr('Share of the plan', 'Parte del plan'), width: 1.2, align: 'right' },
            ],
            rows: q4.map((i) => [i.label, fmtUse(i), `${pct(i.used, i.limit)}%`]),
          },
          {
            kind: 'p',
            text: tr(
              'Usage above the plan is reported to the account team and shown on the next invoice. Service and alerts are never cut off. Changes agreed with the account team apply from the next quarter.',
              'El uso por encima del plan se informa al equipo de cuenta y figura en la próxima factura. El servicio y las alertas nunca se cortan. Los cambios acordados con el equipo de cuenta rigen desde el trimestre siguiente.',
            ),
          },
        ],
      },
      { action: 'Downloaded agreement', target: 'GFSA-2026-01', details: 'Summary PDF' },
    );
  };

  const exportUsage = () => {
    const rows = (['q4', 'q3'] as Period[]).flatMap((p) =>
      usage[p].items.map((i) => [
        `${usage[p].title} 2026`,
        i.label,
        i.used,
        i.limit,
        i.unit ?? '',
        pct(i.used, i.limit),
        i.used > i.limit ? Math.round((i.used - i.limit) * 10) / 10 : 0,
      ]),
    );
    ex.csv(
      `usage_GFSA_2026_${isoDayIn(now)}.csv`,
      [[tr('Period', 'Período'), tr('Item', 'Concepto'), tr('Used', 'Usado'), tr('Plan', 'Plan'), tr('Unit', 'Unidad'), tr('% of plan', '% del plan'), tr('Above plan', 'Por encima del plan')], ...rows],
      { action: 'Exported usage report', target: 'Q3 and Q4 2026', details: 'CSV' },
    );
  };

  const withdraw = (r: ChangeRequest) => {
    const item = CHANGE_ITEMS.find((c) => c.id === r.item);
    setRequests((list) => list.map((x) => (x.id === r.id ? { ...x, status: 'withdrawn', withdrawnAt: new Date(scenarioNow()).toISOString() } : x)));
    log('Withdrew plan change request', r.id, item?.en);
    toast(tr(`${r.id} withdrawn. The account team is told.`, `${r.id} retirada. Se avisa al equipo de cuenta.`));
  };

  const invoiceDue = INVOICES.filter((i) => !i.paid).length;
  const sortedCases = [...cases].sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  const lockedTitle = canBill ? undefined : tr('Needs the plan and billing permission', 'Requiere el permiso de plan y facturación');

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tr('Administration', 'Administración'), to: '/admin/users' }]}
        title={tr('Plan and usage', 'Plan y uso')}
        sub={tr('Fleet plan · annual · renews 1 Apr 2027 · invoiced quarterly', 'Plan de flota · anual · se renueva el 1 abr 2027 · facturado por trimestre')}
        actions={
          <>
            <button type="button" className="btn" onClick={() => setDialog('support')}>
              <Icon name="help" size={16} /> {tr('Contact support', 'Contactar a soporte')}
            </button>
            <button type="button" className="btn btn--primary" onClick={() => setDialog('change')} disabled={!canBill} title={lockedTitle}>
              <Icon name="edit" size={16} /> {tr('Request a change', 'Solicitar un cambio')}
            </button>
          </>
        }
      />

      {!canBill && (
        <div className="callout" role="note">
          <Icon name="lock" size={16} />
          <span>
            {tr(
              `Read-only. Your role (${state.user.name}) does not hold the plan and billing permission, so plan changes, invoices and the billing contact are locked.`,
              `Solo lectura. Su rol (${state.user.name}) no tiene el permiso de plan y facturación, así que los cambios de plan, las facturas y el contacto de facturación están bloqueados.`,
            )}
          </span>
        </div>
      )}

      <div className="row plan-row">
        <section aria-labelledby="plan-title" className="card plan-card plan-card--main">
          <div className="card__head">
            <div className="card__title">
              <h2 id="plan-title">{tr('Fleet plan', 'Plan de flota')}</h2>
              <span className="card__hint">{tr('What the agreement includes', 'Qué incluye el contrato')}</span>
            </div>
            <button type="button" className="card__link plan-linkbtn" onClick={viewAgreement} disabled={!canBill} title={lockedTitle}>
              {tr('View agreement', 'Ver contrato')}
            </button>
          </div>
          <div className="plan-banner">
            <div className="plan-banner__name">
              <span>{tr('Fleet plan · annual', 'Plan de flota · anual')}</span>
              <span className="badge badge--ok">
                <Icon name="check" size={13} strokeWidth={2.4} /> {tr('Active', 'Activo')}
              </span>
            </div>
            <span className="mono plan-banner__agr">{tr('Agreement GFSA-2026-01 · 1 Apr 2026 – 31 Mar 2027', 'Contrato GFSA-2026-01 · 1 abr 2026 – 31 mar 2027')}</span>
          </div>
          <dl className="plan-ent num">
            {entitlements.map((e) => (
              <div key={e.label}>
                <dt>{e.label}</dt>
                <dd>
                  <strong>{e.value}</strong>
                  {e.sub && <span className="plan-ent__sub"> · {e.sub}</span>}
                </dd>
              </div>
            ))}
            <div className="plan-ent__wide">
              <dt>{tr('Add-ons', 'Complementos')}</dt>
              <dd>
                <strong>{tr('Thermal cameras', 'Cámaras térmicas')}</strong>
                <span className="plan-ent__sub">{tr(': not included · ', ': no incluidas · ')}</span>
                <strong>{tr('Spanish UI', 'Interfaz en español')}</strong>
                <span className="plan-ent__sub">{tr(': included', ': incluida')}</span>
              </dd>
            </div>
          </dl>
          {requests.length > 0 && (
            <div className="plan-reqs">
              <h3 className="plan-reqs__title">{tr('Change requests', 'Solicitudes de cambio')}</h3>
              <ul>
                {requests.map((r) => {
                  const item = CHANGE_ITEMS.find((c) => c.id === r.item);
                  return (
                    <li key={r.id} className={r.status === 'withdrawn' ? 'is-off' : undefined}>
                      <span className="mono">{r.id}</span>
                      <span className="plan-strong">
                        {item ? tr(item.en, item.es) : r.item}
                        {item?.addon ? '' : ` ${r.qty > 0 ? '+' : ''}${r.qty}`}
                      </span>
                      <span className="plan-reqs__meta">
                        {r.status === 'sent'
                          ? tr(`Sent ${fmtSmart(r.at, now)} by ${r.by} · waiting for the account team`, `Enviada ${fmtSmart(r.at, now)} por ${r.by} · en espera del equipo de cuenta`)
                          : tr(`Withdrawn ${fmtSmart(r.withdrawnAt ?? r.at, now)}`, `Retirada ${fmtSmart(r.withdrawnAt ?? r.at, now)}`)}
                        {r.note ? ` · “${r.note}”` : ''}
                      </span>
                      {r.status === 'sent' && canBill && (
                        <button type="button" className="plan-linkbtn plan-reqs__btn" onClick={() => withdraw(r)} aria-label={tr(`Withdraw ${r.id}`, `Retirar ${r.id}`)}>
                          {tr('Withdraw', 'Retirar')}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <div className="plan-foot">
            {tr(
              'Entitlements cover the whole fleet. Changes agreed with your account team apply from the next quarter.',
              'Los derechos cubren toda la flota. Los cambios acordados con su equipo de cuenta rigen desde el trimestre siguiente.',
            )}
          </div>
        </section>

        <section aria-labelledby="usage-title" className="card plan-card plan-card--side">
          <div className="card__head plan-usage-head">
            <div className="card__title">
              <h2 id="usage-title">{tr('Usage this period', 'Uso en este período')}</h2>
              <span className="card__hint">
                {shown.title} · {shown.range}
              </span>
            </div>
            <button type="button" className="btn btn--ghost btn--icon" aria-label={tr('Download usage report, CSV', 'Descargar informe de uso, CSV')} title={tr('Download usage report, CSV', 'Descargar informe de uso, CSV')} onClick={exportUsage}>
              <Icon name="download" size={16} />
            </button>
          </div>
          <div className="plan-usage">
            <Segmented<Period>
              label={tr('Quarter', 'Trimestre')}
              value={period}
              onChange={setPeriod}
              options={[
                { value: 'q4', label: tr('Q4 · current', 'T4 · actual') },
                { value: 'q3', label: tr('Q3', 'T3') },
              ]}
            />
            {over.length > 0 && (
              <div className="callout callout--warn" role="status">
                <Icon name="alert" size={16} />
                <span>
                  <strong>{tr(`Above the plan in ${shown.title}:`, `Por encima del plan en el ${shown.title}:`)}</strong>{' '}
                  {over.map((i) => `${i.label.toLowerCase()} ${fmtUse(i)}${i.overWhen ? ` ${i.overWhen}` : ''}`).join('; ')}.{' '}
                  {tr(
                    'Reported to your account team and shown on the next invoice. Nothing was held back.',
                    'Informado a su equipo de cuenta y reflejado en la próxima factura. No se retuvo nada.',
                  )}
                </span>
              </div>
            )}
            {shown.items.map((i) => {
              const p = (i.used / i.limit) * 100;
              const isOver = i.used > i.limit;
              const tone = isOver ? 'bad' : p >= 90 ? 'warn' : undefined;
              const extra = Math.round((i.used - i.limit) * 10) / 10;
              return (
                <div key={i.id} className="plan-meter">
                  <div className="plan-meter__top">
                    <span className="plan-meter__label">{i.label}</span>
                    <span className="num">
                      {fmtUse(i)}
                      {isOver && <span className="badge badge--bad plan-over">{tr('Over plan', 'Sobre el plan')}</span>}
                    </span>
                  </div>
                  <Meter pct={p} tone={tone} label={`${i.label}: ${fmtUse(i)}`} />
                  <span className={`plan-meter__note${isOver ? ' is-over' : ''}`}>
                    {isOver
                      ? tr(
                          `${pct(i.used, i.limit)}% of the plan · ${num(extra, i.unit ? 1 : 0)} above · reported, service not cut`,
                          `${pct(i.used, i.limit)}% del plan · ${num(extra, i.unit ? 1 : 0)} por encima · informado, sin corte del servicio`,
                        )
                      : i.note}
                  </span>
                </div>
              );
            })}
            <div className="callout">
              <Icon name="info" size={16} />
              <span>{tr('Usage above the plan is reported, never cut off: alerts always go out.', 'El uso por encima del plan se informa, nunca se corta: las alertas siempre salen.')}</span>
            </div>
          </div>
        </section>
      </div>

      <div className="row">
        <section aria-labelledby="inv-title" className="card plan-card plan-card--main">
          <div className="card__head">
            <div className="card__title">
              <h2 id="inv-title">{tr('Invoices', 'Facturas')}</h2>
              <span className="card__hint">
                {tr(`Quarterly · ${invoiceDue} due, ${INVOICES.length - invoiceDue} paid`, `Trimestrales · ${invoiceDue} pendiente, ${INVOICES.length - invoiceDue} pagadas`)}
              </span>
            </div>
            <button type="button" className="card__link plan-linkbtn" onClick={() => setDialog('contact')} disabled={!canBill} title={lockedTitle}>
              {tr('Change billing contact', 'Cambiar contacto de facturación')}
            </button>
          </div>
          <div className="table-wrap">
            <table className="table num plan-inv">
              <thead>
                <tr>
                  <th scope="col">{tr('Invoice', 'Factura')}</th>
                  <th scope="col">{tr('Period', 'Período')}</th>
                  <th scope="col">{tr('Issued', 'Emitida')}</th>
                  <th scope="col">{tr('Due', 'Vencimiento')}</th>
                  <th scope="col">{tr('Status', 'Estado')}</th>
                  <th scope="col">{tr('Document', 'Documento')}</th>
                </tr>
              </thead>
              <tbody>
                {INVOICES.map((inv) => (
                  <tr key={inv.id}>
                    <td className="mono plan-nowrap">{inv.id}</td>
                    <td>{tr(...inv.period)}</td>
                    <td className="plan-nowrap">{fullDate(inv.issued)}</td>
                    <td className="plan-nowrap">{fullDate(inv.due)}</td>
                    <td>
                      {inv.paid ? (
                        <span className="badge badge--ok">
                          <Icon name="check" size={13} strokeWidth={2.4} /> {tr('Paid', 'Pagada')}
                        </span>
                      ) : (
                        <span className="badge">
                          <Icon name="clock" size={13} /> {tr(`Due ${fmtDay(inv.due)}`, `Vence ${fmtDay(inv.due)}`)}
                        </span>
                      )}
                    </td>
                    <td className="plan-doc">
                      <button
                        type="button"
                        className="plan-pdf"
                        aria-label={tr(`Invoice ${inv.id}, PDF`, `Factura ${inv.id}, PDF`)}
                        onClick={() => downloadInvoice(inv)}
                        disabled={!canBill}
                        title={lockedTitle}
                      >
                        <Icon name="download" size={15} /> PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="plan-foot">
            {tr(
              `Invoice copies list the billed items; amounts are on the original from the billing system. Billing contact: ${contactName} (${roleName(contact.role)}) · Finance copy: ${contact.finance}`,
              `Las copias de factura detallan los conceptos; los importes figuran en el original del sistema de facturación. Contacto de facturación: ${contactName} (${roleName(contact.role)}) · Copia a finanzas: ${contact.finance}`,
            )}
          </div>
        </section>

        <div className="stack plan-card--side plan-sidecol">
          <Card id="health" title={tr('Service health', 'Estado del servicio')} hint={tr('Shore services · last 90 days', 'Servicios en tierra · últimos 90 días')} bodyClass="">
            <dl className="plan-health num">
              <div>
                <dt>{tr('Uptime, 90 days', 'Disponibilidad, 90 días')}</dt>
                <dd>
                  <span className="with-dot plan-strong">
                    <span className="dot" aria-hidden="true" />
                    {es ? '99,97%' : '99.97%'}
                  </span>
                  <span className="plan-health__sub">{tr('above the 99.9% target', 'por encima del objetivo de 99,9%')}</span>
                </dd>
              </div>
              <div>
                <dt>{tr('Incidents, 90 days', 'Incidentes, 90 días')}</dt>
                <dd>
                  <span className="plan-strong">1</span>
                  <span className="plan-health__sub">{tr('12 Sep · 18 min · messaging delay', '12 sep · 18 min · demora en la mensajería')}</span>
                </dd>
              </div>
              <div>
                <dt>{tr('Next maintenance', 'Próximo mantenimiento')}</dt>
                <dd>
                  <span className="plan-strong">{tr('Sun 19 Oct 02:00–03:00 Asunción', 'dom 19 oct 02:00–03:00 Asunción')}</span>
                  <span className="plan-health__sub">{tr('no alert impact', 'sin impacto en las alertas')}</span>
                </dd>
              </div>
              <div>
                <dt>{tr('Status page', 'Página de estado')}</dt>
                <dd>
                  <a href="/status" target="_blank" rel="noreferrer" className="plan-status-link">
                    {tr('Service status', 'Estado del servicio')} <Icon name="external" size={14} />
                    <span className="sr-only">{tr(' (opens in a new tab)', ' (se abre en una pestaña nueva)')}</span>
                  </a>
                </dd>
              </div>
            </dl>
          </Card>

          <section aria-labelledby="support-title" className="card plan-support">
            <div className="card__head">
              <div className="card__title">
                <h2 id="support-title">{tr('Support', 'Soporte')}</h2>
                <span className="card__hint">{tr('Included in the Fleet plan', 'Incluido en el plan de flota')}</span>
              </div>
            </div>
            <div className="plan-support__body">
              <div className="plan-support__lines">
                <span>
                  <Icon name="clock" size={16} /> <span>{tr('24/7 support desk · Spanish and English', 'Mesa de soporte 24/7 · español e inglés')}</span>
                </span>
                <span>
                  <Icon name="alert" size={16} />{' '}
                  <span>{tr('P1 response 15 min · P2 1 h · P3 next business day', 'Respuesta P1 15 min · P2 1 h · P3 el siguiente día hábil')}</span>
                </span>
              </div>
              {sortedCases.length > 0 && (
                <ul className="plan-cases" aria-label={tr('Support cases', 'Casos de soporte')}>
                  {sortedCases.map((c) => (
                    <CaseRow key={c.id} c={c} now={now} tr={tr} />
                  ))}
                </ul>
              )}
              <button type="button" className="btn plan-full" onClick={() => setDialog('support')}>
                <Icon name="message" size={16} /> {tr('Open a support case', 'Abrir un caso de soporte')}
              </button>
              <a href="mailto:cuentas@cctv-monitoring.example?subject=GFSA%20Fleet%20plan" className="plan-account">
                <Icon name="mail" size={16} /> {tr('Contact your account team', 'Contactar a su equipo de cuenta')}
              </a>
            </div>
          </section>
        </div>
      </div>

      {dialog === 'support' && (
        <SupportDialog
          defaultContact={state.user.email}
          onClose={() => setDialog(null)}
          onSubmit={(draft) => {
            const created = openSupportCase({
              ...draft,
              openedAt: new Date(scenarioNow()).toISOString(),
              openedBy: state.user.name,
            });
            setDialog(null);
            // Same action as the public Support page; filed as configuration ("Opened…" alone reads as a view).
            log('Opened support case', created.id, `${created.priority} · ${created.subject}`, undefined, 'config');
            const r = SUPPORT_RESPONSE[created.priority];
            toast(
              tr(
                `Case ${created.id} opened as ${created.priority}. First response within ${r.en}.`,
                `Caso ${created.id} abierto como ${created.priority}. Primera respuesta dentro de ${r.es}.`,
              ),
            );
          }}
        />
      )}
      {dialog === 'change' && canBill && (
        <ChangeDialog
          onClose={() => setDialog(null)}
          onSubmit={(item, qty, note) => {
            const id = `CHG-26-${String(101 + requests.length).padStart(4, '0')}`;
            const it = CHANGE_ITEMS.find((c) => c.id === item)!;
            setRequests((list) => [
              { id, item, qty, note, at: new Date(scenarioNow()).toISOString(), by: state.user.name, status: 'sent' },
              ...list,
            ]);
            setDialog(null);
            log('Requested plan change', id, `${it.en}${it.addon ? '' : ` ${qty > 0 ? '+' : ''}${qty}`}${note ? ` · ${note}` : ''}`);
            toast(
              tr(
                `${id} sent to your account team. Agreed changes apply from the next quarter.`,
                `${id} enviada a su equipo de cuenta. Los cambios acordados rigen desde el trimestre siguiente.`,
              ),
            );
          }}
        />
      )}
      {dialog === 'contact' && canBill && (
        <ContactDialog
          current={contact}
          onClose={() => setDialog(null)}
          onSubmit={(next) => {
            setContact(next);
            setDialog(null);
            log('Changed billing contact', next.name, `Finance copy ${next.finance}`);
            toast(tr(`Billing contact is now ${next.name}. The change is logged.`, `El contacto de facturación ahora es ${next.name}. El cambio queda registrado.`));
          }}
        />
      )}
    </div>
  );
}

const isoDayIn = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

function CaseRow({ c, now, tr }: { c: SupportCase; now: number; tr: Tr }) {
  const r = SUPPORT_RESPONSE[c.priority];
  const dueBy = new Date(c.openedAt).getTime() + r.minutes * 60_000;
  return (
    <li>
      <span className="mono">{c.id}</span>
      <span className={`badge badge--${c.priority.toLowerCase()}`}>{c.priority}</span>
      <span className={`badge${c.status === 'open' ? ' badge--info' : c.status === 'answered' ? ' badge--ok' : ''}`}>{tr(...STATUS_LABEL[c.status])}</span>
      <span className="plan-cases__subject">{c.subject}</span>
      <span className="plan-cases__meta">
        {tr(`Opened ${fmtSmart(c.openedAt, now)} by ${c.openedBy}`, `Abierto ${fmtSmart(c.openedAt, now)} por ${c.openedBy}`)}
        {c.status === 'open' &&
          (c.priority === 'P3'
            ? tr(` · first response ${r.en}`, ` · primera respuesta ${r.es}`)
            : tr(` · first response by ${fmtTime(dueBy)}`, ` · primera respuesta antes de las ${fmtTime(dueBy)}`))}
      </span>
    </li>
  );
}

function SupportDialog({
  defaultContact,
  onClose,
  onSubmit,
}: {
  defaultContact: string;
  onClose: () => void;
  onSubmit: (c: Pick<SupportCase, 'priority' | 'subject' | 'description' | 'contact' | 'language' | 'about'>) => void;
}) {
  const tr = useTr();
  const { state } = useApp();
  const [prio, setPrio] = useState<SupportPriority>('P3');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [about, setAbout] = useState('');
  const [contact, setContact] = useState(defaultContact);
  const [language, setLanguage] = useState<'es' | 'en'>(state.lang);
  const dirty = !!(subject.trim() || body.trim() || about.trim());
  return (
    <AdminDialog
      title={tr('Open a support case', 'Abrir un caso de soporte')}
      sub={
        <>
          {tr('24/7 desk in Spanish and English. For a P1, also call the number on the ', 'Mesa 24/7 en español e inglés. Para una P1, llame también al número de la ')}
          <a href="/status" target="_blank" rel="noreferrer">
            {tr('status page', 'página de estado')}
          </a>
          .
        </>
      }
      onClose={onClose}
      onSubmit={() =>
        onSubmit({ priority: prio, subject: subject.trim(), description: body.trim(), contact: contact.trim(), language, about: about.trim() || undefined })
      }
      submitLabel={tr('Open case', 'Abrir caso')}
      submitDisabled={!subject.trim() || !contact.trim()}
      dirty={dirty}
    >
      <fieldset className="plan-prios">
        <legend className="field__label">{tr('Priority', 'Prioridad')}</legend>
        {PRIORITIES.map((p) => (
          <label key={p.value} className={`plan-prio${prio === p.value ? ' is-on' : ''}`}>
            <input type="radio" name="plan-prio" value={p.value} checked={prio === p.value} onChange={() => setPrio(p.value)} />
            <span>
              <strong>{tr(...p.label)}</strong> · {tr(`response ${SUPPORT_RESPONSE[p.value].en}`, `respuesta en ${SUPPORT_RESPONSE[p.value].es}`)}
              <span className="plan-prio__note">{tr(...p.note)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="field">
        <label htmlFor="plan-sup-subject">{tr('Subject', 'Asunto')}</label>
        <input id="plan-sup-subject" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} required />
        {!subject.trim() && <span className="field__hint">{tr('A subject is needed to open the case.', 'Se necesita un asunto para abrir el caso.')}</span>}
      </div>
      <div className="field">
        <label htmlFor="plan-sup-body">{tr('What happened', 'Qué pasó')}</label>
        <textarea id="plan-sup-body" className="textarea" value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="plan-sup-about">{tr('Related alarm, camera or edge unit (optional)', 'Alarma, cámara o unidad de borde relacionada (opcional)')}</label>
        <input id="plan-sup-about" className="input mono" value={about} onChange={(e) => setAbout(e.target.value)} placeholder="ALM-26-0318, F503-CAM-02…" />
      </div>
      <div className="field">
        <label htmlFor="plan-sup-contact">{tr('Reply to', 'Responder a')}</label>
        <input id="plan-sup-contact" className="input" value={contact} onChange={(e) => setContact(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="plan-sup-lang">{tr('Reply language', 'Idioma de la respuesta')}</label>
        <select id="plan-sup-lang" className="select" value={language} onChange={(e) => setLanguage(e.target.value as 'es' | 'en')}>
          <option value="es">{tr('Spanish', 'Español')}</option>
          <option value="en">{tr('English', 'Inglés')}</option>
        </select>
      </div>
    </AdminDialog>
  );
}

function ChangeDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (item: string, qty: number, note: string) => void }) {
  const tr = useTr();
  const [item, setItem] = useState(CHANGE_ITEMS[0].id);
  const [qty, setQty] = useState(2);
  const [note, setNote] = useState('');
  const isAddon = !!CHANGE_ITEMS.find((c) => c.id === item)?.addon;
  const qtyOk = isAddon || (Number.isFinite(qty) && qty !== 0 && Number.isInteger(qty));
  return (
    <AdminDialog
      title={tr('Request a change to the plan', 'Solicitar un cambio en el plan')}
      sub={tr(
        'Your account team confirms the change and the price. Agreed changes apply from the next quarter.',
        'Su equipo de cuenta confirma el cambio y el precio. Los cambios acordados rigen desde el trimestre siguiente.',
      )}
      onClose={onClose}
      onSubmit={() => onSubmit(item, isAddon ? 1 : qty, note.trim())}
      submitLabel={tr('Send request', 'Enviar solicitud')}
      submitDisabled={!qtyOk}
      dirty={!!note.trim() || item !== CHANGE_ITEMS[0].id || qty !== 2}
    >
      <div className="field">
        <label htmlFor="plan-chg-item">{tr('What to change', 'Qué cambiar')}</label>
        <select id="plan-chg-item" className="select" value={item} onChange={(e) => setItem(e.target.value)}>
          {CHANGE_ITEMS.map((c) => (
            <option key={c.id} value={c.id}>
              {tr(c.en, c.es)}
            </option>
          ))}
        </select>
      </div>
      {!isAddon && (
        <div className="field">
          <label htmlFor="plan-chg-qty">{tr('Change by', 'Cambiar en')}</label>
          <input
            id="plan-chg-qty"
            className="input"
            type="number"
            inputMode="numeric"
            step={1}
            value={Number.isFinite(qty) ? qty : ''}
            onChange={(e) => setQty(e.target.valueAsNumber)}
            aria-invalid={!qtyOk}
          />
          <span className={`field__hint${qtyOk ? '' : ' plan-err'}`}>
            {qtyOk
              ? tr('Use a negative number to reduce. Reductions apply at renewal.', 'Use un número negativo para reducir. Las reducciones rigen en la renovación.')
              : tr('Enter a whole number other than 0.', 'Ingrese un número entero distinto de 0.')}
          </span>
        </div>
      )}
      <div className="field">
        <label htmlFor="plan-chg-note">{tr('Note for the account team', 'Nota para el equipo de cuenta')}</label>
        <textarea
          id="plan-chg-note"
          className="textarea"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={tr('For example: second pilot convoy from January', 'Por ejemplo: segundo convoy piloto desde enero')}
        />
      </div>
    </AdminDialog>
  );
}

function ContactDialog({
  current,
  onClose,
  onSubmit,
}: {
  current: BillingContact;
  onClose: () => void;
  onSubmit: (next: BillingContact) => void;
}) {
  const tr = useTr();
  const users = useUsers();
  const candidates = users.filter((u) => u.status === 'active' && (u.role === 'tenant_admin' || u.role === 'ops_manager'));
  const [userId, setUserId] = useState(candidates.some((u) => u.id === current.userId) ? current.userId : (candidates[0]?.id ?? ''));
  const [finance, setFinance] = useState(current.finance);
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(finance.trim());
  const picked = candidates.find((u) => u.id === userId);
  const dirty = userId !== current.userId || finance.trim() !== current.finance;
  return (
    <AdminDialog
      title={tr('Change billing contact', 'Cambiar contacto de facturación')}
      sub={tr('Invoices and payment reminders go to this person, with a copy to finance.', 'Las facturas y los recordatorios de pago van a esta persona, con copia a finanzas.')}
      onClose={onClose}
      onSubmit={() => picked && onSubmit({ userId: picked.id, name: picked.name, role: picked.role, finance: finance.trim() })}
      submitLabel={tr('Save contact', 'Guardar contacto')}
      submitDisabled={!validEmail || !picked || !dirty}
      dirty={dirty}
    >
      <div className="field">
        <label htmlFor="plan-contact">{tr('Billing contact', 'Contacto de facturación')}</label>
        <select id="plan-contact" className="select" value={userId} onChange={(e) => setUserId(e.target.value)}>
          {candidates.map((u) => {
            const role = roleById(u.role);
            return (
              <option key={u.id} value={u.id}>
                {u.name} · {tr(role.name, role.nameEs)}
              </option>
            );
          })}
        </select>
        <span className="field__hint">
          {tr('Active tenant administrators and operations managers from Users and roles.', 'Administradores del inquilino y gerentes de operaciones activos de Usuarios y roles.')}
        </span>
      </div>
      <div className="field">
        <label htmlFor="plan-finance">{tr('Finance copy', 'Copia a finanzas')}</label>
        <input id="plan-finance" className="input" type="email" value={finance} onChange={(e) => setFinance(e.target.value)} aria-invalid={!validEmail} />
        {!validEmail && <span className="field__hint plan-err">{tr('Enter a valid email address.', 'Ingrese un correo válido.')}</span>}
        {validEmail && !dirty && <span className="field__hint">{tr('Pick another person or address to save.', 'Elija otra persona o dirección para guardar.')}</span>}
      </div>
    </AdminDialog>
  );
}
