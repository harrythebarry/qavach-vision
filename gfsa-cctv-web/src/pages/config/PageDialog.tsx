import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { useTr } from '../../lib/i18n';
import './PageDialog.css';

/**
 * Modal dialog on top of the native <dialog> element: focus is trapped, Esc closes,
 * and a click on the backdrop closes. Used by Alert routing, Edge units and Users.
 */
export function PageDialog({
  open,
  title,
  sub,
  onClose,
  children,
  footer,
  width = 560,
}: {
  open: boolean;
  title: ReactNode;
  sub?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const tr = useTr();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="pdlg"
      aria-labelledby={titleId}
      style={{ width: `min(${width}px, calc(100vw - 24px))` }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <div className="pdlg__inner">
          <div className="pdlg__head">
            <div className="pdlg__title">
              <h2 id={titleId}>{title}</h2>
              {sub && <p>{sub}</p>}
            </div>
            <button type="button" className="btn btn--ghost btn--icon" aria-label={tr('Close', 'Cerrar')} onClick={onClose}>
              <Icon name="x" size={18} />
            </button>
          </div>
          <div className="pdlg__body">{children}</div>
          {footer && <div className="pdlg__foot">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
