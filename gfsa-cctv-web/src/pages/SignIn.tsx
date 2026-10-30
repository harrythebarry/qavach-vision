import { useId, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { roles } from '../data/users';
import { demoUserFor } from '../state/usersStore';
import type { RoleId } from '../data/types';
import { homeFor } from '../nav';
import { Icon } from '../components/Icon';
import { useApp, type Lang } from '../state/AppState';
import { fmtCountdown, scenarioNow, useNow } from '../lib/time';
import './SignIn.css';

// ADM-01: SAML single sign-on with the GFSA directory, MFA for shore roles, and
// device-code pairing for wheelhouse displays.

type Step = 'form' | 'mfa' | 'device' | 'forgot' | 'forgotSent';

const DEVICE_CODE = 'WH-4K7P-92';
const DEVICE_CODE_MS = 10 * 60_000;
/** A reset link can be sent again after a minute. */
const RESEND_MS = 60_000;

const T = {
  en: {
    heroTitle: 'AI on the cameras you already have, on every convoy.',
    heroSub: 'Events and clips reach shore over the river link. Alerts reach the wheelhouse even without it.',
    stat1: 'Urgent alerts ashore when the link is up',
    stat2: 'On the wheelhouse display, link or no link',
    stat3v: '12 months',
    stat3: 'Events kept, every view logged',
    sample: 'Sample data · vessel names are placeholders',
    title: 'Sign in',
    tenant: 'GFSA tenant · Production',
    sso: 'Continue with GFSA single sign-on',
    or: 'or sign in with email',
    email: 'Work email',
    password: 'Password',
    show: 'Show',
    hide: 'Hide',
    showLabel: 'Show password',
    hideLabel: 'Hide password',
    remember: 'Keep me signed in on this device',
    forgot: 'Forgot password?',
    fpTitle: 'Reset your password',
    fpSub: 'Enter your work email. We send a link to set a new password for email sign-in.',
    fpSubmit: 'Send reset link',
    fpBack: 'Back to sign in',
    fpSentTitle: 'Check your email',
    fpSent: (e: string) => `If ${e} has a CCTV Monitoring account, a reset link is on its way. It works once, for 30 minutes.`,
    fpSso: 'Signing in with GFSA single sign-on? Then your password is your GFSA directory password: reset it in the GFSA directory (GFSA IT self-service), not here.',
    fpSsoDomain: (d: string) => `${d} accounts sign in with GFSA single sign-on, so this is most likely you.`,
    fpSpam: 'No email after a few minutes? Check spam, or send the link again.',
    fpResend: 'Send again',
    fpResendIn: 'Send again in',
    fpResent: 'Reset link sent again.',
    submit: 'Sign in',
    info: 'Shore roles need a second factor after sign-in. Wheelhouse displays sign in with a device code.',
    deviceLink: 'Use a device code',
    demoRole: 'Sign in as',
    demoHint: 'Prototype only: pick the role to try. Any filled form signs in.',
    errEmail: 'Enter your work email.',
    errEmailFormat: 'Enter an email such as name@gfsa.example.',
    errPassword: 'Enter your password.',
    mfaTitle: 'Enter your verification code',
    mfaSub: (who: string) => `Open the authenticator app for ${who} and type the 6-digit code.`,
    mfaLabel: '6-digit code',
    mfaErr: 'Enter the 6 digits from your authenticator app.',
    verify: 'Verify and continue',
    back: 'Back',
    mfaHelp: 'Lost your phone? GFSA IT can reset your second factor.',
    devTitle: 'Pair a wheelhouse display',
    devSub: 'Wheelhouse accounts are bound to the display, not to a person. Show this code to the tenant administrator, who pairs it in Users and roles.',
    devCode: 'Device code',
    devExpires: 'Expires in',
    devExpired: 'This code has expired.',
    devNew: 'Get a new code',
    devPair: 'Pair as master',
    devWaiting: 'Waiting for pairing',
    signedIn: 'Signed in.',
    signedInRemember: 'Signed in. This device stays signed in for 12 hours.',
    paired: 'Display paired. Alerts from the convoy now show on this screen.',
    status: 'Status',
    privacy: 'Privacy',
    support: 'Support',
    lang: 'Language',
    site: 'Site',
    about: 'About CCTV Monitoring',
    art: 'Schematic river route from Asunción past Buenos Aires to Montevideo, with the GF Tuyutí convoy on voyage VOY-26-041 mid-route and three camera events along the way',
  },
  es: {
    heroTitle: 'IA en las cámaras que ya tiene, en cada convoy.',
    heroSub: 'Los eventos y clips llegan a tierra por el enlace fluvial. Las alertas llegan al puente aun sin él.',
    stat1: 'Alertas urgentes en tierra cuando hay enlace',
    stat2: 'En la pantalla del puente, con o sin enlace',
    stat3v: '12 meses',
    stat3: 'Eventos guardados, cada vista registrada',
    sample: 'Datos de ejemplo · los nombres de buques son ficticios',
    title: 'Iniciar sesión',
    tenant: 'Inquilino GFSA · Producción',
    sso: 'Continuar con el inicio de sesión único de GFSA',
    or: 'o inicie sesión con su correo',
    email: 'Correo de trabajo',
    password: 'Contraseña',
    show: 'Mostrar',
    hide: 'Ocultar',
    showLabel: 'Mostrar contraseña',
    hideLabel: 'Ocultar contraseña',
    remember: 'Mantener la sesión en este dispositivo',
    forgot: '¿Olvidó su contraseña?',
    fpTitle: 'Restablecer la contraseña',
    fpSub: 'Ingrese su correo de trabajo. Le enviamos un enlace para crear una contraseña nueva para el inicio de sesión con correo.',
    fpSubmit: 'Enviar enlace',
    fpBack: 'Volver a iniciar sesión',
    fpSentTitle: 'Revise su correo',
    fpSent: (e: string) => `Si ${e} tiene una cuenta de CCTV Monitoring, le llegará un enlace para restablecer la contraseña. Sirve una sola vez, durante 30 minutos.`,
    fpSso: '¿Inicia sesión con el inicio de sesión único de GFSA? Entonces su contraseña es la del directorio de GFSA: restablézcala en el directorio de GFSA (autoservicio de TI de GFSA), no aquí.',
    fpSsoDomain: (d: string) => `Las cuentas de ${d} inician sesión con el inicio de sesión único de GFSA, así que probablemente sea su caso.`,
    fpSpam: '¿No llega el correo en unos minutos? Revise el correo no deseado o envíe el enlace de nuevo.',
    fpResend: 'Enviar de nuevo',
    fpResendIn: 'Enviar de nuevo en',
    fpResent: 'Enlace enviado de nuevo.',
    submit: 'Iniciar sesión',
    info: 'Los roles de tierra necesitan un segundo factor. Las pantallas del puente inician sesión con un código de dispositivo.',
    deviceLink: 'Usar un código de dispositivo',
    demoRole: 'Entrar como',
    demoHint: 'Solo prototipo: elija el rol a probar. Cualquier formulario completo inicia sesión.',
    errEmail: 'Ingrese su correo de trabajo.',
    errEmailFormat: 'Ingrese un correo como nombre@gfsa.example.',
    errPassword: 'Ingrese su contraseña.',
    mfaTitle: 'Ingrese su código de verificación',
    mfaSub: (who: string) => `Abra la app de autenticación de ${who} e ingrese el código de 6 dígitos.`,
    mfaLabel: 'Código de 6 dígitos',
    mfaErr: 'Ingrese los 6 dígitos de su app de autenticación.',
    verify: 'Verificar y continuar',
    back: 'Volver',
    mfaHelp: '¿Perdió su teléfono? TI de GFSA puede restablecer su segundo factor.',
    devTitle: 'Vincular una pantalla del puente',
    devSub: 'Las cuentas del puente están ligadas a la pantalla, no a una persona. Muestre este código al administrador, que lo vincula en Usuarios y roles.',
    devCode: 'Código de dispositivo',
    devExpires: 'Vence en',
    devExpired: 'Este código venció.',
    devNew: 'Obtener un código nuevo',
    devPair: 'Vincular como capitán',
    devWaiting: 'Esperando la vinculación',
    signedIn: 'Sesión iniciada.',
    signedInRemember: 'Sesión iniciada. Este dispositivo mantiene la sesión por 12 horas.',
    paired: 'Pantalla vinculada. Las alertas del convoy se muestran en esta pantalla.',
    status: 'Estado',
    privacy: 'Privacidad',
    support: 'Soporte',
    lang: 'Idioma',
    site: 'Sitio',
    about: 'Acerca de CCTV Monitoring',
    art: 'Ruta fluvial esquemática desde Asunción, pasando por Buenos Aires, hasta Montevideo, con el convoy GF Tuyutí en el viaje VOY-26-041 a mitad de camino y tres eventos de cámara en el recorrido',
  },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignInPage() {
  const { state, signIn, setLang, toast, logSystem } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const t = T[state.lang];
  const completing = useRef(false);

  const [step, setStep] = useState<Step>('form');
  const [role, setRole] = useState<RoleId>(state.role);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [code, setCode] = useState('');
  const [codeErr, setCodeErr] = useState('');
  const [deviceIssued, setDeviceIssued] = useState(0);
  const [resetEmail, setResetEmail] = useState('');
  const [resetErr, setResetErr] = useState('');
  const [resetSentAt, setResetSentAt] = useState(0);
  const now = useNow();
  const ids = useId();

  if (state.signedIn && !completing.current) return <Navigate to={homeFor(state.role)} replace />;

  const complete = (r: RoleId, to?: string) => {
    completing.current = true;
    signIn(r);
    toast(r === 'master' && to === '/wheelhouse' ? t.paired : remember ? t.signedInRemember : t.signedIn);
    navigate(to ?? (from && from !== '/sign-in' ? from : homeFor(r)), { replace: true });
  };

  const openDevice = () => {
    setDeviceIssued(scenarioNow());
    setStep('device');
  };

  const afterFirstFactor = () => {
    if (role === 'master') openDevice();
    else {
      setCode('');
      setCodeErr('');
      setStep('mfa');
    }
  };

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!email.trim()) next.email = t.errEmail;
    else if (!EMAIL_RE.test(email.trim())) next.email = t.errEmailFormat;
    if (!password) next.password = t.errPassword;
    setErrors(next);
    if (next.email) document.getElementById(`${ids}-email`)?.focus();
    else if (next.password) document.getElementById(`${ids}-password`)?.focus();
    if (!next.email && !next.password) afterFirstFactor();
  };

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setCodeErr(t.mfaErr);
      document.getElementById(`${ids}-code`)?.focus();
      return;
    }
    complete(role);
  };

  const openForgot = () => {
    setResetEmail(email.trim());
    setResetErr('');
    setStep('forgot');
  };

  const sendReset = (again = false) => {
    const addr = resetEmail.trim();
    logSystem({ action: again ? 'Sent password reset link again' : 'Sent password reset link', target: addr, details: 'Requested on the sign-in page', source: 'Sign-in page', category: 'signin' });
    setResetSentAt(scenarioNow());
    if (again) toast(t.fpResent);
  };

  const submitForgot = (e: FormEvent) => {
    e.preventDefault();
    const addr = resetEmail.trim();
    const err = !addr ? t.errEmail : !EMAIL_RE.test(addr) ? t.errEmailFormat : '';
    setResetErr(err);
    if (err) {
      document.getElementById(`${ids}-reset-email`)?.focus();
      return;
    }
    sendReset();
    setStep('forgotSent');
  };

  const roleName = (r: RoleId) => {
    const role = roles.find((x) => x.id === r)!;
    return state.lang === 'es' ? role.nameEs : role.name;
  };
  const deviceLeft = Math.min(DEVICE_CODE_MS, DEVICE_CODE_MS - (now - deviceIssued));
  const resendLeft = RESEND_MS - (now - resetSentAt);
  const resetDomain = resetEmail.trim().split('@')[1]?.toLowerCase() ?? '';
  const footLink = (to: string, label: string) => (
    <Link to={to} className="si-foot__link">
      {label}
    </Link>
  );

  return (
    <div className="si" lang={state.lang}>
      <section aria-label={t.about} className="si-hero">
        <div className="si-brand">
          <span className="si-brand__logo">
            <Icon name="logo" size={18} strokeWidth={2} />
          </span>
          <span>CCTV Monitoring</span>
        </div>

        <div className="si-hero__copy">
          <p className="si-hero__title">{t.heroTitle}</p>
          <p className="si-hero__sub">{t.heroSub}</p>
        </div>

        <RouteArt label={t.art} />

        <div className="si-stats">
          <div>
            <strong>60 s</strong>
            <span>{t.stat1}</span>
          </div>
          <div>
            <strong>5 s</strong>
            <span>{t.stat2}</span>
          </div>
          <div>
            <strong>{t.stat3v}</strong>
            <span>{t.stat3}</span>
          </div>
        </div>

        <p className="si-hero__foot">{t.sample}</p>
      </section>

      <main className="si-main">
        <div className="si-col">
          <section aria-labelledby="si-title" className="si-card">
            {step === 'form' && (
              <>
                <div className="si-card__head">
                  <h1 id="si-title">{t.title}</h1>
                  <p>{t.tenant}</p>
                </div>

                <div className="si-demo">
                  <label htmlFor={`${ids}-role`}>{t.demoRole}</label>
                  <select id={`${ids}-role`} className="select" value={role} onChange={(e) => setRole(e.target.value as RoleId)} aria-describedby={`${ids}-role-hint`}>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {roleName(r.id)} · {demoUserFor(r.id).name}
                      </option>
                    ))}
                  </select>
                  <span id={`${ids}-role-hint`}>{t.demoHint}</span>
                </div>

                <button type="button" className="si-btn si-btn--primary" onClick={afterFirstFactor}>
                  <Icon name="key" size={18} />
                  {t.sso}
                </button>

                <div className="si-or">
                  <span aria-hidden="true" />
                  {t.or}
                  <span aria-hidden="true" />
                </div>

                <form className="si-form" noValidate onSubmit={submitPassword}>
                  <div className="field">
                    <label htmlFor={`${ids}-email`}>{t.email}</label>
                    <input
                      id={`${ids}-email`}
                      className="input"
                      name="email"
                      type="email"
                      autoComplete="username"
                      placeholder={demoUserFor(role).email.replace(/^[^@]+/, 'name')}
                      value={email}
                      aria-invalid={!!errors.email}
                      aria-describedby={errors.email ? `${ids}-email-err` : undefined}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (errors.email) setErrors((x) => ({ ...x, email: undefined }));
                      }}
                    />
                    {errors.email && (
                      <span id={`${ids}-email-err`} className="si-err">
                        <Icon name="alert" size={14} strokeWidth={2.2} /> {errors.email}
                      </span>
                    )}
                  </div>

                  <div className="field">
                    <label htmlFor={`${ids}-password`}>{t.password}</label>
                    <div className="si-pw">
                      <input
                        id={`${ids}-password`}
                        className="input"
                        name="password"
                        type={showPw ? 'text' : 'password'}
                        autoComplete="current-password"
                        value={password}
                        aria-invalid={!!errors.password}
                        aria-describedby={errors.password ? `${ids}-pw-err` : undefined}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          if (errors.password) setErrors((x) => ({ ...x, password: undefined }));
                        }}
                      />
                      <button
                        type="button"
                        className="si-pw__toggle"
                        aria-pressed={showPw}
                        aria-label={showPw ? t.hideLabel : t.showLabel}
                        onClick={() => setShowPw((v) => !v)}
                      >
                        {showPw ? t.hide : t.show}
                      </button>
                    </div>
                    {errors.password && (
                      <span id={`${ids}-pw-err`} className="si-err">
                        <Icon name="alert" size={14} strokeWidth={2.2} /> {errors.password}
                      </span>
                    )}
                  </div>

                  <div className="si-row">
                    <label className="check">
                      <input type="checkbox" name="remember" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                      {t.remember}
                    </label>
                    <button type="button" className="si-row__link" onClick={openForgot}>
                      {t.forgot}
                    </button>
                  </div>

                  <button type="submit" className="si-btn si-btn--secondary">
                    {t.submit}
                  </button>
                </form>

                <div className="callout si-info">
                  <Icon name="info" size={16} style={{ color: 'var(--brand)', marginTop: 2 }} />
                  <span>
                    {t.info}{' '}
                    <button type="button" className="si-inline-link" onClick={openDevice}>
                      {t.deviceLink}
                    </button>
                  </span>
                </div>
              </>
            )}

            {step === 'mfa' && (
              <form className="si-form" noValidate onSubmit={submitCode}>
                <div className="si-card__head">
                  <span className="si-step-icon">
                    <Icon name="shield" size={22} />
                  </span>
                  <h1 id="si-title">{t.mfaTitle}</h1>
                  <p>{t.mfaSub(email.trim() || demoUserFor(role).email)}</p>
                </div>
                <div className="field">
                  <label htmlFor={`${ids}-code`}>{t.mfaLabel}</label>
                  <input
                    id={`${ids}-code`}
                    className="input si-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    autoFocus
                    value={code}
                    aria-invalid={!!codeErr}
                    aria-describedby={codeErr ? `${ids}-code-err` : undefined}
                    onChange={(e) => {
                      setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                      setCodeErr('');
                    }}
                  />
                  {codeErr && (
                    <span id={`${ids}-code-err`} className="si-err">
                      <Icon name="alert" size={14} strokeWidth={2.2} /> {codeErr}
                    </span>
                  )}
                </div>
                <button type="submit" className="si-btn si-btn--primary">
                  {t.verify}
                </button>
                <button type="button" className="si-btn si-btn--ghost" onClick={() => setStep('form')}>
                  <Icon name="chevronLeft" size={18} /> {t.back}
                </button>
                <p className="si-help">{t.mfaHelp}</p>
              </form>
            )}

            {step === 'forgot' && (
              <form className="si-form" noValidate onSubmit={submitForgot}>
                <div className="si-card__head">
                  <span className="si-step-icon">
                    <Icon name="key" size={22} />
                  </span>
                  <h1 id="si-title">{t.fpTitle}</h1>
                  <p>{t.fpSub}</p>
                </div>
                <div className="field">
                  <label htmlFor={`${ids}-reset-email`}>{t.email}</label>
                  <input
                    id={`${ids}-reset-email`}
                    className="input"
                    name="email"
                    type="email"
                    autoComplete="username"
                    autoFocus
                    placeholder={demoUserFor(role).email.replace(/^[^@]+/, 'name')}
                    value={resetEmail}
                    aria-invalid={!!resetErr}
                    aria-describedby={resetErr ? `${ids}-reset-err` : undefined}
                    onChange={(e) => {
                      setResetEmail(e.target.value);
                      if (resetErr) setResetErr('');
                    }}
                  />
                  {resetErr && (
                    <span id={`${ids}-reset-err`} className="si-err">
                      <Icon name="alert" size={14} strokeWidth={2.2} /> {resetErr}
                    </span>
                  )}
                </div>
                <button type="submit" className="si-btn si-btn--primary">
                  <Icon name="send" size={18} /> {t.fpSubmit}
                </button>
                <button type="button" className="si-btn si-btn--ghost" onClick={() => setStep('form')}>
                  <Icon name="chevronLeft" size={18} /> {t.fpBack}
                </button>
                <p className="si-help">{t.fpSso}</p>
              </form>
            )}

            {step === 'forgotSent' && (
              <div className="si-form" role="status">
                <div className="si-card__head">
                  <span className="si-step-icon si-step-icon--ok">
                    <Icon name="mail" size={22} />
                  </span>
                  <h1 id="si-title">{t.fpSentTitle}</h1>
                  <p className="si-sent">{t.fpSent(resetEmail.trim())}</p>
                </div>
                <div className="callout si-info">
                  <Icon name="info" size={16} style={{ color: 'var(--brand)', marginTop: 2 }} />
                  <span>
                    {t.fpSso}
                    {resetDomain === 'gfsa.example' && <> {t.fpSsoDomain(resetDomain)}</>}
                  </span>
                </div>
                <p className="si-help">{t.fpSpam}</p>
                <button type="button" className="si-btn si-btn--secondary" disabled={resendLeft > 0} onClick={() => sendReset(true)}>
                  {resendLeft > 0 ? (
                    <>
                      {t.fpResendIn} <span className="mono">{fmtCountdown(resendLeft)}</span>
                    </>
                  ) : (
                    t.fpResend
                  )}
                </button>
                <button type="button" className="si-btn si-btn--primary" onClick={() => setStep('form')}>
                  <Icon name="chevronLeft" size={18} /> {t.fpBack}
                </button>
              </div>
            )}

            {step === 'device' && (
              <div className="si-form">
                <div className="si-card__head">
                  <span className="si-step-icon">
                    <Icon name="screen" size={22} />
                  </span>
                  <h1 id="si-title">{t.devTitle}</h1>
                  <p>{t.devSub}</p>
                </div>
                <div className="si-device">
                  <span className="si-device__label">{t.devCode}</span>
                  <span className="si-device__code mono" aria-live="polite">
                    {deviceLeft > 0 ? DEVICE_CODE : '— — —'}
                  </span>
                  <span className="si-device__exp">
                    {deviceLeft > 0 ? (
                      <>
                        <span className="si-device__spin" aria-hidden="true" /> {t.devWaiting} · {t.devExpires}{' '}
                        <span className="mono">{fmtCountdown(deviceLeft)}</span>
                      </>
                    ) : (
                      t.devExpired
                    )}
                  </span>
                </div>
                {deviceLeft > 0 ? (
                  <button type="button" className="si-btn si-btn--primary" onClick={() => complete('master', '/wheelhouse')}>
                    <Icon name="check" size={18} strokeWidth={2.2} /> {t.devPair}
                  </button>
                ) : (
                  <button type="button" className="si-btn si-btn--primary" onClick={() => setDeviceIssued(scenarioNow())}>
                    <Icon name="refresh" size={18} /> {t.devNew}
                  </button>
                )}
                <button type="button" className="si-btn si-btn--ghost" onClick={() => setStep('form')}>
                  <Icon name="chevronLeft" size={18} /> {t.back}
                </button>
              </div>
            )}
          </section>

          <nav aria-label={t.site} className="si-foot">
            {footLink('/status', t.status)}
            {footLink('/privacy', t.privacy)}
            {footLink('/support', t.support)}
            <div role="group" aria-label={t.lang} className="segmented">
              {(['es', 'en'] as Lang[]).map((l) => (
                <button key={l} type="button" lang={l} aria-pressed={state.lang === l} onClick={() => setLang(l)}>
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
            <span className="mono si-foot__ver">v2026.10.2</span>
          </nav>
        </div>
      </main>
    </div>
  );
}

/** Schematic river route with the GF Tuyutí convoy mid-route, as on the design. */
function RouteArt({ label }: { label: string }) {
  return (
    <svg viewBox="0 0 560 300" className="si-art" role="img" aria-label={label}>
      <g stroke="#3A5F84" strokeOpacity="0.4" strokeWidth="1" strokeDasharray="2 6">
        <path d="M0 75h560M0 150h560M0 225h560" />
      </g>
      <path
        d="M60 40 C80 80 100 110 130 115 C165 120 200 110 230 130 C265 155 270 195 300 205 C330 215 350 235 380 240 C420 246 460 252 500 262"
        fill="none"
        stroke="#3A5F84"
        strokeWidth="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g fill="#2E74B5">
        {[
          [98, 98],
          [192, 117],
          [440, 250],
        ].map(([cx, cy]) => (
          <g key={cx}>
            <circle cx={cx} cy={cy} r="18" opacity="0.12" />
            <circle cx={cx} cy={cy} r="10" opacity="0.28" />
            <circle cx={cx} cy={cy} r="4" opacity="0.9" />
          </g>
        ))}
      </g>
      <g fill="#FFFFFF" stroke="#2E74B5" strokeWidth="3">
        <circle cx="60" cy="40" r="7" />
        <circle cx="380" cy="240" r="7" />
        <circle cx="500" cy="262" r="7" />
      </g>
      <g fontFamily="IBM Plex Sans, sans-serif" fontSize="12" fill="#C9D6E3">
        <text x="76" y="36">
          Asunción
        </text>
        <text x="380" y="276" textAnchor="middle">
          Buenos Aires
        </text>
        <text x="500" y="290" textAnchor="middle">
          Montevideo
        </text>
      </g>
      <g transform="translate(267 173) rotate(57)">
        <path d="M-11 0H-28" stroke="#FAB219" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
        <rect x="-10" y="-5" width="20" height="10" rx="3" fill="#FAB219" />
      </g>
      <text x="288" y="166" fontFamily="IBM Plex Sans, sans-serif" fontSize="12" fontWeight="600" fill="#FFFFFF">
        GF Tuyutí · VOY-26-041
      </text>
    </svg>
  );
}
