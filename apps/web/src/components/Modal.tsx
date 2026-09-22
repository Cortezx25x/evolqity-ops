import { useEffect, useId, useRef, type ReactNode } from 'react';

export interface ModalProps {
  title: string;
  description?: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  size?: 'default' | 'wide';
  /** When true, shows a subtle header close control (avoid on form dialogs). */
  showCloseButton?: boolean;
}

export function Modal({
  title,
  description,
  open,
  onClose,
  children,
  size = 'default',
  showCloseButton = false,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }

    if (open && !dialog.open) {
      dialog.showModal();
    }

    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="app-modal"
      aria-labelledby={titleId}
      aria-describedby={
        description !== undefined ? descriptionId : undefined
      }
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          onClose();
        }
      }}
    >
      <div
        className={
          size === 'wide'
            ? 'app-modal-panel app-modal-panel--wide'
            : 'app-modal-panel'
        }
        role="document"
      >
        <header className="app-modal-header">
          <div className="app-modal-header-text">
            <h2 id={titleId}>{title}</h2>
            {description !== undefined ? (
              <p id={descriptionId} className="app-modal-description">
                {description}
              </p>
            ) : null}
          </div>
          {showCloseButton ? (
            <button
              type="button"
              className="app-button app-button--ghost app-modal-close"
              onClick={onClose}
              aria-label="Cerrar"
            >
              ×
            </button>
          ) : null}
        </header>
        <div className="app-modal-body">{children}</div>
      </div>
    </dialog>
  );
}

/** Shared footer row for modal primary/secondary actions */
export function ModalFooter({ children }: { children: ReactNode }) {
  return <div className="app-modal-footer">{children}</div>;
}

/** Alias for product naming consistency */
export const AppDialog = Modal;
