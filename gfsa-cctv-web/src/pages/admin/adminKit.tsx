import { useEffect, useId, useRef, type FormEvent, type ReactNode } from 'react';
import { useBlocker } from 'react-router';
import { Icon } from '../../components/Icon';
import { useTr } from '../../lib/i18n';
import { TZ } from '../../lib/time';
import './adminKit.css';

// Small helpers shared by the audit log, integrations and plan screens.
// Files (CSV, PDF) come from useExporter() in lib/exporting.ts.

/**
 * Warns before leaving with unsaved input: in-app navigation (useBlocker, the
 * app uses a data router) and closing or reloading the tab (beforeunload).
 */
export function useLeaveGuard(dirty: boolean) {
  const tr = useTr();
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  const message = tr('Leave without saving? What you entered is lost.', '¿Salir sin guardar? Se pierde lo que ingresó.');
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm(message)) blocker.proceed();
    else blocker.reset();
  }, [blocker, message]);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
}

/** Modal dialog built on the native <dialog> element (focus trap and Escape for free). */
export function AdminDialog({
  title,
  sub,
  onClose,
  onSubmit,
  submitLabel,
  submitDisabled,
  danger,
  dirty = false,
  footStart,
  children,
  wide,
}: {
  title: ReactNode;
  sub?: ReactNode;
  onClose: () => void;
  /** When set the body is a form and the footer shows a submit button. */
  onSubmit?: () => void;
  submitLabel?: string;
  submitDisabled?: boolean;
  danger?: boolean;
  /** Unsaved input: warn before navigating away or closing the tab. */
  dirty?: boolean;
  /** Extra controls on the left of the footer (e.g. Remove). */
  footStart?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const tr = useTr();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useLeaveGuard(dirty);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) d.showModal();
    const handle = () => closeRef.current();
    d.addEventListener('close', handle);
    // No d.close() here: its "close" event is async and would reach the listener
    // re-attached by StrictMode's second mount, shutting the dialog at once.
    // Unmounting removes the element, which takes it out of the top layer.
    return () => d.removeEventListener('close', handle);
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit?.();
  };

  return (
    <dialog ref={ref} className={`akit-dialog${wide ? ' akit-dialog--wide' : ''}`} aria-labelledby={titleId}>
      <form method="dialog" onSubmit={submit} className="akit-dialog__form">
        <div className="akit-dialog__head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {sub && <p className="akit-dialog__sub">{sub}</p>}
          </div>
          <button type="button" className="btn btn--ghost btn--icon" aria-label={tr('Close', 'Cerrar')} onClick={() => ref.current?.close()}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="akit-dialog__body">{children}</div>
        <div className="akit-dialog__foot">
          {footStart && <div className="akit-dialog__foot-start">{footStart}</div>}
          <button type="button" className="btn" onClick={() => ref.current?.close()}>
            {onSubmit ? tr('Cancel', 'Cancelar') : tr('Close', 'Cerrar')}
          </button>
          {onSubmit && (
            <button type="submit" className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`} disabled={submitDisabled}>
              {submitLabel ?? tr('Save', 'Guardar')}
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}

/** Inline spinner for simulated network work. */
export function Spinner({ label }: { label?: string }) {
  return <span className="akit-spinner" role={label ? 'status' : undefined} aria-label={label} />;
}

/** Number in the interface language: 1,842 / 1.842. */
export function useNum() {
  const tr = useTr();
  const locale = tr('en-US', 'es-PY');
  return (v: number, digits = 0) => v.toLocaleString(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

/** "15 Oct 2026" / "15 oct 2026" in Asunción time. */
export function useFullDate() {
  const tr = useTr();
  const locale = tr('en-GB', 'es-PY');
  return (v: string | number | Date) =>
    new Intl.DateTimeFormat(locale, { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' })
      .format(v instanceof Date ? v : new Date(v))
      .replace('.', '');
}
