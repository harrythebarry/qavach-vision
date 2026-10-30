import { useEffect, type ReactNode } from 'react';
import { useBlocker } from 'react-router';
import { Icon } from '../../components/Icon';
import { useTr } from '../../lib/i18n';
import { PageDialog } from './PageDialog';

/**
 * Warns before leaving a screen with an unsaved draft: in-app navigation is
 * held by useBlocker and a confirm dialog; closing or reloading the tab gets
 * the browser's own prompt (beforeunload). Render the returned node.
 */
export function useLeaveGuard({
  dirty,
  what,
  changes,
  onDiscard,
  onSave,
}: {
  dirty: boolean;
  /** "alert routing", already translated. */
  what: string;
  /** What is unsaved, already translated. */
  changes?: string[];
  onDiscard: () => void;
  /** Saves the draft; returns false when it cannot be saved yet. */
  onSave?: () => boolean;
}): ReactNode {
  const tr = useTr();
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const blocked = blocker.state === 'blocked';
  const stay = () => blocker.state === 'blocked' && blocker.reset();
  return (
    <PageDialog
      open={blocked}
      onClose={stay}
      title={tr('Leave without saving?', '¿Salir sin guardar?')}
      sub={tr(`You have unsaved changes to ${what}.`, `Tiene cambios sin guardar en ${what}.`)}
      width={480}
      footer={
        <>
          <button type="button" className="btn pdlg__spacer" onClick={stay}>
            {tr('Stay on this page', 'Quedarse en esta página')}
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => {
              onDiscard();
              if (blocker.state === 'blocked') blocker.proceed();
            }}
          >
            {tr('Discard and leave', 'Descartar y salir')}
          </button>
          {onSave && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                if (onSave() && blocker.state === 'blocked') blocker.proceed();
              }}
            >
              {tr('Save and leave', 'Guardar y salir')}
            </button>
          )}
        </>
      }
    >
      {changes && changes.length > 0 && (
        <div className="callout callout--warn">
          <Icon name="edit" size={18} />
          <span>
            {tr('Unsaved', 'Sin guardar')}: {changes.join(', ')}
          </span>
        </div>
      )}
      <p style={{ fontSize: 13 }}>
        {tr(
          'If you leave now, the draft is lost and the saved version stays in force.',
          'Si sale ahora, se pierde el borrador y sigue vigente la versión guardada.',
        )}
      </p>
    </PageDialog>
  );
}
