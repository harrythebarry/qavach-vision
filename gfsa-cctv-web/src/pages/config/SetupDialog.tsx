import { useEffect, useId, useRef, type FormEvent, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { useTr } from '../../lib/i18n';
import './SetupDialog.css';

/**
 * Modal dialog on the native <dialog> element (focus trap, Escape to close).
 * Used by the use case and camera screens for confirmations and small forms.
 */
export function SetupDialog({
  open,
  title,
  sub,
  onClose,
  children,
  actions,
  onSubmit,
  wide = false,
}: {
  open: boolean;
  title: string;
  sub?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  actions: ReactNode;
  /** When set the body is a form and the primary action should be type="submit". */
  onSubmit?: () => void;
  wide?: boolean;
}) {
  const tr = useTr();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit?.();
  };

  const body = (
    <>
      <div className="sdlg__head">
        <div className="sdlg__title">
          <h2 id={titleId}>{title}</h2>
          {sub && <p>{sub}</p>}
        </div>
        <button type="button" className="btn btn--ghost btn--icon" aria-label={tr('Close', 'Cerrar')} onClick={onClose}>
          <Icon name="x" size={18} />
        </button>
      </div>
      <div className="sdlg__body">{children}</div>
      <div className="sdlg__foot">{actions}</div>
    </>
  );

  return (
    <dialog
      ref={ref}
      className={`sdlg${wide ? ' sdlg--wide' : ''}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {open && (onSubmit ? <form onSubmit={submit}>{body}</form> : body)}
    </dialog>
  );
}
