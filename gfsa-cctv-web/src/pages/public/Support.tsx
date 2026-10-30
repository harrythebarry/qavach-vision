import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useBlocker } from 'react-router';
import { Card } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useApp } from '../../state/AppState';
import { openSupportCase, SUPPORT_RESPONSE, useSupportCases, type SupportCase, type SupportPriority } from '../../state/supportStore';
import { useTr, type Lang } from '../../lib/i18n';
import { fmtDayTime, fmtTime, scenarioNow } from '../../lib/time';
import { PublicLayout } from './PublicLayout';

// PRD Support: a 24/7 desk in Spanish and English, P1 answered in 15 minutes and
// P2 in 1 hour (proposed). The form opens a real case in the shared support store,
// which Plan and usage lists. Signed in, the contact is filled in for you.

const DESK_PHONE = '+595215550100';
const DESK_PHONE_TEXT = '+595 21 555 0100';
const DESK_EMAIL = 'soporte@cctv-monitoring.example';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PRIORITY_TEXT: Record<SupportPriority, { name: [string, string]; when: [string, string] }> = {
  P1: {
    name: ['P1 Critical', 'P1 Crítica'],
    when: ['Alerts not reaching the wheelhouse or shore, or the console down for everyone', 'Las alertas no llegan al puente o a tierra, o la consola no funciona para nadie'],
  },
  P2: {
    name: ['P2 High', 'P2 Alta'],
    when: ['A convoy, edge unit or feature not working, or alerts arriving late', 'Un convoy, una unidad de borde o una función no funciona, o las alertas llegan tarde'],
  },
  P3: {
    name: ['P3 Medium', 'P3 Media'],
    when: ['Questions, reports and small problems', 'Preguntas, informes y problemas menores'],
  },
};

const STATUS_TEXT: Record<SupportCase['status'], [string, string]> = {
  open: ['Open', 'Abierto'],
  answered: ['Answered', 'Respondido'],
  closed: ['Closed', 'Cerrado'],
};

interface Draft {
  priority: SupportPriority;
  subject: string;
  description: string;
  about: string;
  name: string;
  email: string;
  language: Lang;
}

type Errors = Partial<Record<'subject' | 'description' | 'name' | 'email', string>>;

export function SupportPage() {
  const { state, log, logSystem } = useApp();
  const tr = useTr();
  const lang = state.lang;
  const ids = useId();
  const cases = useSupportCases();
  const signedIn = state.signedIn;

  const blank = (): Draft => ({
    priority: 'P2',
    subject: '',
    description: '',
    about: '',
    name: signedIn ? state.user.name : '',
    email: signedIn ? state.user.email : '',
    language: signedIn ? state.user.language : lang,
  });
  const [form, setForm] = useState<Draft>(blank);
  const base = useRef<Draft>(form);
  const [errors, setErrors] = useState<Errors>({});
  const [opened, setOpened] = useState<SupportCase | null>(null);

  const dirty =
    !opened &&
    (form.subject.trim() !== '' ||
      form.description.trim() !== '' ||
      form.about.trim() !== '' ||
      form.name !== base.current.name ||
      form.email !== base.current.email ||
      form.priority !== base.current.priority);

  // Drafts warn before leaving: in-app navigation and closing the tab.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const onBefore = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, [dirty]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (k in errors) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Errors = {};
    if (!form.subject.trim()) errs.subject = tr('Add a short subject.', 'Agregue un asunto breve.');
    if (form.description.trim().length < 10) errs.description = tr('Tell us what happened, in a sentence or two.', 'Cuéntenos qué pasó, en una o dos frases.');
    if (!form.name.trim()) errs.name = tr('Enter your name.', 'Ingrese su nombre.');
    if (!form.email.trim()) errs.email = tr('Enter the email where we should reply.', 'Ingrese el correo donde le respondemos.');
    else if (!EMAIL_RE.test(form.email.trim())) errs.email = tr('Enter an email such as name@gfsa.example.', 'Ingrese un correo como nombre@gfsa.example.');
    setErrors(errs);
    const first = (['subject', 'description', 'name', 'email'] as const).find((k) => errs[k]);
    if (first) {
      document.getElementById(`${ids}-${first}`)?.focus();
      return;
    }
    const created = openSupportCase({
      priority: form.priority,
      subject: form.subject.trim(),
      description: form.description.trim(),
      contact: `${form.name.trim()} · ${form.email.trim()}`,
      openedAt: new Date(scenarioNow()).toISOString(),
      openedBy: signedIn ? state.user.name : form.name.trim(),
      language: form.language,
      about: form.about.trim() || undefined,
    });
    const target = `${created.id} · ${created.priority} · ${created.subject}`;
    if (signedIn) log('Opened support case', target, 'Support page', undefined, 'config');
    else logSystem({ action: 'Opened support case', target, details: `Public support page · ${form.name.trim()}`, source: 'Support page', category: 'system' });
    setOpened(created);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const another = () => {
    const next = blank();
    base.current = next;
    setForm(next);
    setErrors({});
    setOpened(null);
  };

  const mine = signedIn ? cases.filter((c) => c.openedBy === state.user.name) : opened ? [opened] : [];
  const resp = (p: SupportPriority) => (lang === 'es' ? SUPPORT_RESPONSE[p].es : SUPPORT_RESPONSE[p].en);
  const err = (k: keyof Errors) =>
    errors[k] && (
      <span id={`${ids}-${k}-err`} className="sp-err">
        <Icon name="alert" size={14} strokeWidth={2.2} /> {errors[k]}
      </span>
    );

  return (
    <PublicLayout
      title={tr('Support', 'Soporte')}
      sub={tr(
        'A 24/7 support desk in Spanish and English. Critical problems are answered in 15 minutes, high ones within the hour.',
        'Una mesa de soporte 24/7 en español e inglés. Los problemas críticos se responden en 15 minutos; los altos, dentro de la hora.',
      )}
    >
      <div className="pub-cols">
        <Card id="sp-targets" title={tr('Response targets', 'Tiempos de respuesta')} hint={tr('First response, any time of day', 'Primera respuesta, a cualquier hora')} bodyClass="">
          <ul className="sp-targets">
            {(['P1', 'P2', 'P3'] as SupportPriority[]).map((p) => (
              <li key={p}>
                <span className={`badge badge--${p.toLowerCase()}`}>{p}</span>
                <span className="sp-targets__text">
                  <strong>{tr(PRIORITY_TEXT[p].name[0], PRIORITY_TEXT[p].name[1])}</strong>
                  <span>{tr(PRIORITY_TEXT[p].when[0], PRIORITY_TEXT[p].when[1])}</span>
                </span>
                <span className="sp-targets__time">{resp(p)}</span>
              </li>
            ))}
          </ul>
          <div className="card__body pub-small">
            {tr('Targets are proposed and still to be agreed with GFSA.', 'Los tiempos son una propuesta y todavía deben acordarse con GFSA.')}
          </div>
        </Card>

        <Card id="sp-contact" title={tr('Contact the desk', 'Contactar a la mesa')}>
          <div className="sp-contacts">
            <a href={`tel:${DESK_PHONE}`} className="sp-contact" onClick={() => signedIn && log('Called the support desk', DESK_PHONE_TEXT, 'Support page')}>
              <Icon name="phone" size={20} />
              <span>
                <strong>{DESK_PHONE_TEXT}</strong>
                <small>{tr('24/7 · call for a P1, as well as opening a case', '24/7 · llame por un P1, además de abrir un caso')}</small>
              </span>
            </a>
            <a href={`mailto:${DESK_EMAIL}?subject=${encodeURIComponent(tr('GFSA support', 'Soporte GFSA'))}`} className="sp-contact">
              <Icon name="mail" size={20} />
              <span>
                <strong>{DESK_EMAIL}</strong>
                <small>{tr('For P2 and P3; we open the case for you', 'Para P2 y P3; abrimos el caso por usted')}</small>
              </span>
            </a>
            <p className="pub-small">
              {tr(
                'Have ready what it is about: an alarm ID (ALM-26-…), a camera (F503-CAM-02) or an edge unit (F503-EU-01), and when it happened.',
                'Tenga a mano de qué se trata: un ID de alarma (ALM-26-…), una cámara (F503-CAM-02) o una unidad de borde (F503-EU-01), y cuándo pasó.',
              )}
            </p>
          </div>
        </Card>
      </div>

      <Card id="sp-form" title={opened ? tr('Case opened', 'Caso abierto') : tr('Open a support case', 'Abrir un caso de soporte')}>
        {opened ? (
          <div className="sp-done" role="status">
            <div className="sp-done__head">
              <span className="sp-done__icon">
                <Icon name="check" size={24} strokeWidth={2.4} />
              </span>
              <h2>{tr(`Case ${opened.id} is open`, `El caso ${opened.id} está abierto`)}</h2>
            </div>
            <p>
              {opened.priority === 'P3'
                ? tr(`${opened.priority}: we answer by the next business day.`, `${opened.priority}: respondemos el siguiente día hábil.`)
                : tr(
                    `${opened.priority}: we answer within ${SUPPORT_RESPONSE[opened.priority].en}, by ${fmtTime(new Date(opened.openedAt).getTime() + SUPPORT_RESPONSE[opened.priority].minutes * 60_000)} Asunción, day or night.`,
                    `${opened.priority}: respondemos en ${SUPPORT_RESPONSE[opened.priority].es}, antes de las ${fmtTime(new Date(opened.openedAt).getTime() + SUPPORT_RESPONSE[opened.priority].minutes * 60_000)} de Asunción, de día o de noche.`,
                  )}{' '}
              {tr(
                `We reply to ${opened.contact.split(' · ')[1]} in ${opened.language === 'es' ? 'Spanish' : 'English'}.`,
                `Le respondemos a ${opened.contact.split(' · ')[1]} en ${opened.language === 'es' ? 'español' : 'inglés'}.`,
              )}
            </p>
            {opened.priority === 'P1' && (
              <p>
                {tr('For a P1, also call the desk now:', 'Para un P1, llame también ahora a la mesa:')} <a href={`tel:${DESK_PHONE}`}>{DESK_PHONE_TEXT}</a>
              </p>
            )}
            <p className="pub-small">
              {state.signedIn && state.role === 'tenant_admin' ? (
                <>
                  {tr('The case is listed on', 'El caso aparece en')} <Link to="/admin/plan">{tr('Plan and usage', 'Plan y uso')}</Link>.
                </>
              ) : (
                tr("The case is listed on Plan and usage, with your tenant administrator's other cases.", 'El caso aparece en Plan y uso, junto con los demás casos de su administrador del inquilino.')
              )}
            </p>
            <div className="sp-actions">
              <button type="button" className="btn" onClick={another}>
                <Icon name="plus" size={16} /> {tr('Open another case', 'Abrir otro caso')}
              </button>
            </div>
          </div>
        ) : (
          <form className="sp-form" noValidate onSubmit={submit}>
            <fieldset>
              <legend>{tr('How urgent is it?', '¿Qué tan urgente es?')}</legend>
              <div className="sp-prio">
                {(['P1', 'P2', 'P3'] as SupportPriority[]).map((p) => (
                  <label key={p}>
                    <input type="radio" name="priority" value={p} checked={form.priority === p} onChange={() => set('priority', p)} />
                    <span>
                      <strong>
                        {tr(PRIORITY_TEXT[p].name[0], PRIORITY_TEXT[p].name[1])} · {resp(p)}
                      </strong>
                      <small>{tr(PRIORITY_TEXT[p].when[0], PRIORITY_TEXT[p].when[1])}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="field">
              <label htmlFor={`${ids}-subject`}>{tr('Subject', 'Asunto')}</label>
              <input
                id={`${ids}-subject`}
                className="input"
                value={form.subject}
                maxLength={120}
                placeholder={tr('e.g. No alerts from GF Tuyutí since 14:00', 'p. ej., Sin alertas de GF Tuyutí desde las 14:00')}
                aria-invalid={!!errors.subject}
                aria-describedby={errors.subject ? `${ids}-subject-err` : undefined}
                onChange={(e) => set('subject', e.target.value)}
              />
              {err('subject')}
            </div>

            <div className="field">
              <label htmlFor={`${ids}-description`}>{tr('What happened', 'Qué pasó')}</label>
              <textarea
                id={`${ids}-description`}
                className="textarea"
                rows={5}
                value={form.description}
                placeholder={tr('What you saw, since when, and what you already tried.', 'Qué vio, desde cuándo y qué intentó ya.')}
                aria-invalid={!!errors.description}
                aria-describedby={errors.description ? `${ids}-description-err` : undefined}
                onChange={(e) => set('description', e.target.value)}
              />
              {err('description')}
            </div>

            <div className="field">
              <label htmlFor={`${ids}-about`}>
                {tr('About (optional)', 'Sobre qué (opcional)')}
              </label>
              <input
                id={`${ids}-about`}
                className="input"
                value={form.about}
                placeholder={tr('Alarm, camera or edge unit ID', 'ID de alarma, cámara o unidad de borde')}
                onChange={(e) => set('about', e.target.value)}
              />
            </div>

            <div className="sp-grid2">
              <div className="field">
                <label htmlFor={`${ids}-name`}>{tr('Your name', 'Su nombre')}</label>
                <input
                  id={`${ids}-name`}
                  className="input"
                  autoComplete="name"
                  value={form.name}
                  aria-invalid={!!errors.name}
                  aria-describedby={errors.name ? `${ids}-name-err` : undefined}
                  onChange={(e) => set('name', e.target.value)}
                />
                {err('name')}
              </div>
              <div className="field">
                <label htmlFor={`${ids}-email`}>{tr('Email for the reply', 'Correo para la respuesta')}</label>
                <input
                  id={`${ids}-email`}
                  className="input"
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? `${ids}-email-err` : undefined}
                  onChange={(e) => set('email', e.target.value)}
                />
                {err('email')}
              </div>
            </div>
            {signedIn && (
              <p className="pub-small">
                {tr(`Filled in from your account (${state.user.name}). Change it if someone else should get the reply.`, `Completado con su cuenta (${state.user.name}). Cámbielo si otra persona debe recibir la respuesta.`)}
              </p>
            )}

            <fieldset>
              <legend>{tr('Reply language', 'Idioma de la respuesta')}</legend>
              <div className="segmented" role="group" aria-label={tr('Reply language', 'Idioma de la respuesta')}>
                {(['es', 'en'] as Lang[]).map((l) => (
                  <button key={l} type="button" aria-pressed={form.language === l} onClick={() => set('language', l)}>
                    {l === 'es' ? 'Español' : 'English'}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="sp-actions">
              <button type="submit" className="btn btn--primary">
                <Icon name="send" size={16} /> {tr('Open the case', 'Abrir el caso')}
              </button>
              <span className="pub-small">
                {tr(`First response: ${resp(form.priority)}.`, `Primera respuesta: ${resp(form.priority)}.`)}
              </span>
            </div>
          </form>
        )}
      </Card>

      {mine.length > 0 && (
        <Card id="sp-mine" title={signedIn ? tr('Your cases', 'Sus casos') : tr('Case opened on this page', 'Caso abierto en esta página')} bodyClass="">
          <ul className="sp-cases">
            {mine.map((c) => (
              <li key={c.id}>
                <span className="mono">{c.id}</span>
                <span className={`badge badge--${c.priority.toLowerCase()}`}>{c.priority}</span>
                <span className="sp-cases__subject">{c.subject}</span>
                <span className="pub-small">{fmtDayTime(c.openedAt)}</span>
                <span className={`badge${c.status === 'open' ? ' badge--info' : c.status === 'answered' ? ' badge--ok' : ''}`}>{tr(STATUS_TEXT[c.status][0], STATUS_TEXT[c.status][1])}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {blocker.state === 'blocked' && <LeaveDialog onStay={() => blocker.reset()} onLeave={() => blocker.proceed()} />}
    </PublicLayout>
  );
}

function LeaveDialog({ onStay, onLeave }: { onStay: () => void; onLeave: () => void }) {
  const tr = useTr();
  const stayRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    stayRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onStay();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onStay]);
  return (
    <div className="pub-dialog-backdrop">
      <div className="pub-dialog" role="alertdialog" aria-modal="true" aria-labelledby="sp-leave-title" aria-describedby="sp-leave-text">
        <h2 id="sp-leave-title">{tr('Leave without opening the case?', '¿Salir sin abrir el caso?')}</h2>
        <p id="sp-leave-text" className="pub-muted">
          {tr('What you typed has not been sent to the support desk.', 'Lo que escribió todavía no se envió a la mesa de soporte.')}
        </p>
        <div className="pub-dialog__actions">
          <button type="button" className="btn" onClick={onLeave}>
            {tr('Leave', 'Salir')}
          </button>
          <button type="button" ref={stayRef} className="btn btn--primary" onClick={onStay}>
            {tr('Stay and finish', 'Quedarme y terminar')}
          </button>
        </div>
      </div>
    </div>
  );
}
