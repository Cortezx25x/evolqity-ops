import { useState, type ReactNode } from 'react';

import type { IssueEstimatePublicAccessResponse } from '../../api/estimates.api';
import { formatDisplayDate } from '../../lib/dates';
import { copyTextToClipboard } from '../../lib/clipboard';
import { Modal, ModalFooter } from '../Modal';

export interface EstimatePublicAccessMemory {
  publicUrl: string;
  expiresAt: string;
}

export interface EstimatePublicAccessSectionProps {
  issuedLink: EstimatePublicAccessMemory | null;
  issuePending: boolean;
  revokePending: boolean;
  onIssueLink: () => Promise<IssueEstimatePublicAccessResponse>;
  onRevokeLink: () => Promise<void>;
  onLocalFeedback?: (message: string) => void;
}

export function EstimatePublicAccessSection({
  issuedLink,
  issuePending,
  revokePending,
  onIssueLink,
  onRevokeLink,
  onLocalFeedback,
}: EstimatePublicAccessSectionProps) {
  const [generateOpen, setGenerateOpen] = useState(false);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [copyHint, setCopyHint] = useState<string | null>(null);

  const busy = issuePending || revokePending;

  async function handleIssue(isRegenerate: boolean) {
    setCopyHint(null);
    try {
      await onIssueLink();
      setGenerateOpen(false);
      setRegenerateOpen(false);
      if (isRegenerate) {
        onLocalFeedback?.('Se generó un nuevo enlace.');
      }
    } catch {
      // Parent surfaces API errors.
    }
  }

  async function handleRevoke() {
    setCopyHint(null);
    try {
      await onRevokeLink();
      setRevokeOpen(false);
      onLocalFeedback?.('Acceso público revocado.');
    } catch {
      // Parent surfaces API errors.
    }
  }

  async function handleCopy() {
    if (issuedLink === null) {
      return;
    }
    const copied = await copyTextToClipboard(issuedLink.publicUrl);
    if (copied) {
      setCopyHint('Enlace copiado.');
      onLocalFeedback?.('Enlace copiado.');
    } else {
      setCopyHint(
        'No pudimos copiar el enlace. Puedes seleccionarlo manualmente.',
      );
    }
  }

  function handleOpenCustomerView() {
    if (issuedLink === null) {
      return;
    }
    window.open(issuedLink.publicUrl, '_blank', 'noopener,noreferrer');
  }

  return (
    <section
      className="estimate-public-access"
      aria-labelledby="estimate-public-access-title"
    >
      <header className="estimate-public-access-header">
        <div>
          <h4 id="estimate-public-access-title">Aprobación del cliente</h4>
          <p className="app-muted" role="status">
            Esperando respuesta del cliente.
          </p>
        </div>
      </header>

      {issuedLink === null ? (
        <div className="estimate-public-access-empty">
          <p className="app-muted">
            Los enlaces generados no se almacenan en el navegador y no pueden
            volver a mostrarse.
          </p>
          <button
            type="button"
            className="app-button app-button--primary"
            disabled={busy}
            onClick={() => setGenerateOpen(true)}
          >
            Generar enlace para cliente
          </button>
          <p className="estimate-public-access-hint">
            Si existe un enlace anterior, será reemplazado.
          </p>
        </div>
      ) : (
        <div className="estimate-public-access-card">
          <h5>Enlace para el cliente</h5>
          <p className="estimate-public-access-label">Enlace privado</p>
          <a
            className="estimate-public-access-url"
            href={issuedLink.publicUrl}
            onClick={(event) => event.preventDefault()}
          >
            {issuedLink.publicUrl}
          </a>
          <p className="estimate-public-access-expiry">
            Válido hasta {formatDisplayDate(issuedLink.expiresAt)}
          </p>
          {copyHint !== null ? (
            <p className="app-alert app-alert--success" role="status">
              {copyHint}
            </p>
          ) : null}
          <div className="estimate-public-access-actions">
            <button
              type="button"
              className="app-button app-button--primary"
              disabled={busy}
              onClick={() => void handleCopy()}
            >
              Copiar enlace
            </button>
            <button
              type="button"
              className="app-button app-button--secondary"
              disabled={busy}
              onClick={handleOpenCustomerView}
            >
              Abrir vista del cliente
            </button>
            <button
              type="button"
              className="app-button app-button--secondary"
              disabled={busy}
              onClick={() => setRegenerateOpen(true)}
            >
              Generar nuevo enlace
            </button>
            <button
              type="button"
              className="app-button app-button--danger"
              disabled={busy}
              onClick={() => setRevokeOpen(true)}
            >
              Revocar acceso
            </button>
          </div>
        </div>
      )}

      <GeneratePublicLinkModal
        open={generateOpen}
        pending={issuePending}
        title="Generar enlace para cliente"
        body={
          <>
            <p>
              Se creará un enlace privado para que el cliente pueda revisar y
              responder esta cotización.
            </p>
            <p>
              Si ya existía otro enlace para esta cotización, dejará de
              funcionar.
            </p>
          </>
        }
        confirmLabel="Generar enlace"
        onClose={() => {
          if (!issuePending) {
            setGenerateOpen(false);
          }
        }}
        onConfirm={() => void handleIssue(false)}
      />

      <GeneratePublicLinkModal
        open={regenerateOpen}
        pending={issuePending}
        title="Generar nuevo enlace"
        body={
          <p>
            El enlace actual dejará de funcionar y se creará uno nuevo.
          </p>
        }
        confirmLabel="Generar nuevo enlace"
        onClose={() => {
          if (!issuePending) {
            setRegenerateOpen(false);
          }
        }}
        onConfirm={() => void handleIssue(true)}
      />

      <Modal
        open={revokeOpen}
        title="Revocar acceso"
        onClose={() => {
          if (!revokePending) {
            setRevokeOpen(false);
          }
        }}
      >
        <p>El cliente ya no podrá abrir este enlace.</p>
        <ModalFooter>
          <button
            type="button"
            className="app-button app-button--ghost"
            disabled={revokePending}
            onClick={() => setRevokeOpen(false)}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="app-button app-button--danger"
            disabled={revokePending}
            onClick={() => void handleRevoke()}
          >
            {revokePending ? 'Revocando…' : 'Revocar acceso'}
          </button>
        </ModalFooter>
      </Modal>
    </section>
  );
}

function GeneratePublicLinkModal({
  open,
  pending,
  title,
  body,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  open: boolean;
  pending: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal open={open} title={title} onClose={onClose}>
      {body}
      <ModalFooter>
        <button
          type="button"
          className="app-button app-button--ghost"
          disabled={pending}
          onClick={onClose}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="app-button app-button--primary"
          disabled={pending}
          onClick={onConfirm}
        >
          {pending ? 'Generando…' : confirmLabel}
        </button>
      </ModalFooter>
    </Modal>
  );
}
