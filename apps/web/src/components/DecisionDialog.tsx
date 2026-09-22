import {
  useEffect,
  useId,
  useRef,
  type FormEvent,
  type ReactNode,
} from 'react';

interface DecisionDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}

export function DecisionDialog({
  open,
  title,
  description,
  confirmLabel,
  pending,
  onClose,
  onSubmit,
  children,
}: DecisionDialogProps) {
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
      className="pe-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) {
          onClose();
        }
      }}
      onClose={onClose}
    >
      <form className="pe-dialog__form" onSubmit={onSubmit}>
        <header className="pe-dialog__header">
          <h2 id={titleId}>{title}</h2>
          <p id={descriptionId}>{description}</p>
        </header>
        <div className="pe-dialog__body">{children}</div>
        <footer className="pe-dialog__actions">
          <button
            type="button"
            className="pe-button pe-button--ghost"
            disabled={pending}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="pe-button pe-button--primary"
            disabled={pending}
          >
            {pending ? 'Enviando…' : confirmLabel}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
