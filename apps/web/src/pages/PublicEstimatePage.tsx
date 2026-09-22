import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';

import {
  fetchPublicEstimateView,
  messageForApiError,
  submitPublicEstimateDecision,
} from '../api/public-estimate.client';
import type { PublicEstimateView } from '../api/public-estimate.types';
import { PublicEstimateApiError } from '../api/public-estimate.types';
import {
  readCapabilityTokenFromHash,
  stripCapabilityTokenFromAddressBar,
} from '../lib/capability-token';
import { formatDisplayDate } from '../lib/dates';
import {
  formatMoney,
  formatPercent,
  formatQuantity,
  isZeroMoney,
} from '../lib/money';
import {
  customerMessages,
  estimateStatusLabel,
  itemTypeLabel,
  statusHeadline,
} from '../lib/public-messages';
import { DecisionDialog } from '../components/DecisionDialog';
import './public-estimate.css';

type PagePhase = 'loading' | 'ready' | 'error';

type DialogMode = 'approve' | 'reject' | null;

function validateResponderName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return 'Ingresa tu nombre (mínimo 2 caracteres).';
  }
  if (trimmed.length > 120) {
    return 'El nombre no puede superar 120 caracteres.';
  }
  return null;
}

export default function PublicEstimatePage() {
  const [phase, setPhase] = useState<PagePhase>('loading');
  const [view, setView] = useState<PublicEstimateView | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [capabilityToken, setCapabilityToken] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [responderName, setResponderName] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitPending, setSubmitPending] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  const loadView = useCallback(async (token: string) => {
    setPhase('loading');
    setErrorMessage(null);
    setBannerMessage(null);

    try {
      const nextView = await fetchPublicEstimateView(token);
      setView(nextView);
      setPhase('ready');
    } catch (error) {
      setView(null);
      setPhase('error');
      setErrorMessage(messageForApiError(error));
    }
  }, []);

  useEffect(() => {
    document.title = 'Cotización';
    const tokenFromHash = readCapabilityTokenFromHash();

    if (tokenFromHash === null) {
      setPhase('error');
      setErrorMessage(customerMessages.missingToken);
      return;
    }

    stripCapabilityTokenFromAddressBar();
    setCapabilityToken(tokenFromHash);
    void loadView(tokenFromHash);
  }, [loadView]);

  const headline = useMemo(
    () => (view === null ? null : statusHeadline(view)),
    [view],
  );

  const canRespond =
    view?.estimate.status === 'SENT' && view.estimate.canRespond === true;

  const openApprove = () => {
    setFieldError(null);
    setResponderName('');
    setDialogMode('approve');
  };

  const openReject = () => {
    setFieldError(null);
    setResponderName('');
    setRejectionReason('');
    setDialogMode('reject');
  };

  const closeDialog = () => {
    if (submitPending) {
      return;
    }
    setDialogMode(null);
    setFieldError(null);
  };

  const handleDecisionSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (capabilityToken === null || dialogMode === null) {
      return;
    }

    const nameError = validateResponderName(responderName);
    if (nameError !== null) {
      setFieldError(nameError);
      return;
    }

    setSubmitPending(true);
    setFieldError(null);

    try {
      const nextView = await submitPublicEstimateDecision(capabilityToken, {
        decision: dialogMode === 'approve' ? 'APPROVED' : 'REJECTED',
        responderName,
        rejectionReason:
          dialogMode === 'reject' ? rejectionReason : undefined,
      });
      setView(nextView);
      setDialogMode(null);
      setPhase('ready');
    } catch (error) {
      if (
        error instanceof PublicEstimateApiError &&
        error.code === 'conflict'
      ) {
        setBannerMessage(customerMessages.conflict);
        setDialogMode(null);
        try {
          const refreshed = await fetchPublicEstimateView(capabilityToken);
          setView(refreshed);
          setPhase('ready');
        } catch (refreshError) {
          setPhase('error');
          setErrorMessage(messageForApiError(refreshError));
        }
      } else {
        setFieldError(messageForApiError(error));
      }
    } finally {
      setSubmitPending(false);
    }
  };

  if (phase === 'loading') {
    return (
      <main className="pe-page" aria-busy="true">
        <div className="pe-shell">
          <div className="pe-skeleton pe-skeleton--title" />
          <div className="pe-skeleton pe-skeleton--line" />
          <div className="pe-skeleton pe-skeleton--line" />
          <div className="pe-skeleton pe-skeleton--block" />
          <footer className="pe-footer">Gestionado con Evolqity Ops</footer>
        </div>
      </main>
    );
  }

  if (phase === 'error' || view === null) {
    return (
      <main className="pe-page">
        <div className="pe-shell pe-panel pe-panel--error" role="alert">
          <h1>Cotización</h1>
          <p>{errorMessage ?? customerMessages.loadError}</p>
          <footer className="pe-footer">Gestionado con Evolqity Ops</footer>
        </div>
      </main>
    );
  }

  const currency = view.estimate.currency;

  return (
    <main className="pe-page">
      <div className="pe-shell">
        <header className="pe-header">
          <p className="pe-kicker">{view.organization.name}</p>
          <h1>Cotización #{view.estimate.number}</h1>
          <p className="pe-meta">
            <span className="pe-badge">{estimateStatusLabel(view.estimate.status)}</span>
            {formatDisplayDate(view.estimate.sentAt) !== null ? (
              <span>
                Enviada: {formatDisplayDate(view.estimate.sentAt)}
              </span>
            ) : null}
            {formatDisplayDate(view.estimate.validUntil) !== null ? (
              <span>
                Válida hasta: {formatDisplayDate(view.estimate.validUntil)}
              </span>
            ) : null}
          </p>
        </header>

        {bannerMessage !== null ? (
          <div className="pe-banner pe-banner--warn" role="status">
            {bannerMessage}
          </div>
        ) : null}

        {headline !== null ? (
          <div className="pe-banner pe-banner--info" role="status">
            {headline}
          </div>
        ) : null}

        <section className="pe-panel" aria-labelledby="pe-job-heading">
          <h2 id="pe-job-heading">Trabajo</h2>
          <dl className="pe-dl">
            <div>
              <dt>Orden de trabajo</dt>
              <dd>#{view.workOrder.number}</dd>
            </div>
            <div>
              <dt>Cliente</dt>
              <dd>{view.workOrder.customer.name}</dd>
            </div>
            {view.workOrder.asset !== null ? (
              <>
                <div>
                  <dt>Vehículo / equipo</dt>
                  <dd>{view.workOrder.asset.name}</dd>
                </div>
                {view.workOrder.asset.plate !== null ? (
                  <div>
                    <dt>Placa</dt>
                    <dd>{view.workOrder.asset.plate}</dd>
                  </div>
                ) : null}
                {view.workOrder.asset.make !== null ||
                view.workOrder.asset.model !== null ? (
                  <div>
                    <dt>Marca / modelo</dt>
                    <dd>
                      {[view.workOrder.asset.make, view.workOrder.asset.model]
                        .filter(Boolean)
                        .join(' ')}
                    </dd>
                  </div>
                ) : null}
              </>
            ) : null}
          </dl>
        </section>

        <section className="pe-panel" aria-labelledby="pe-items-heading">
          <h2 id="pe-items-heading">Detalle</h2>
          <ul className="pe-items">
            {[...view.items]
              .sort((left, right) => left.sortOrder - right.sortOrder)
              .map((item) => (
                <li key={`${item.sortOrder}-${item.description}`}>
                  <div className="pe-item__head">
                    <span className="pe-item__type">
                      {itemTypeLabel(item.type)}
                    </span>
                    <span className="pe-item__total">
                      {formatMoney(item.total, currency)}
                    </span>
                  </div>
                  <p className="pe-item__description">{item.description}</p>
                  <dl className="pe-item__meta">
                    <div>
                      <dt>Cant.</dt>
                      <dd>{formatQuantity(item.quantity)}</dd>
                    </div>
                    <div>
                      <dt>P. unit.</dt>
                      <dd>{formatMoney(item.unitPrice, currency)}</dd>
                    </div>
                    {!isZeroMoney(item.discountAmount) ? (
                      <div>
                        <dt>Desc.</dt>
                        <dd>
                          {formatPercent(item.discountPercent)}{' '}
                          ({formatMoney(item.discountAmount, currency)})
                        </dd>
                      </div>
                    ) : null}
                    {!isZeroMoney(item.taxAmount) ? (
                      <div>
                        <dt>Imp.</dt>
                        <dd>
                          {formatPercent(item.taxPercent)}{' '}
                          ({formatMoney(item.taxAmount, currency)})
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </li>
              ))}
          </ul>
        </section>

        <section className="pe-panel pe-totals" aria-labelledby="pe-totals-heading">
          <h2 id="pe-totals-heading">Totales</h2>
          <dl className="pe-dl pe-dl--totals">
            <div>
              <dt>Subtotal</dt>
              <dd>{formatMoney(view.estimate.subtotal, currency)}</dd>
            </div>
            {!isZeroMoney(view.estimate.discountTotal) ? (
              <div>
                <dt>Descuento</dt>
                <dd>{formatMoney(view.estimate.discountTotal, currency)}</dd>
              </div>
            ) : null}
            {!isZeroMoney(view.estimate.taxTotal) ? (
              <div>
                <dt>Impuestos</dt>
                <dd>{formatMoney(view.estimate.taxTotal, currency)}</dd>
              </div>
            ) : null}
            <div className="pe-total-row">
              <dt>Total</dt>
              <dd>{formatMoney(view.estimate.total, currency)}</dd>
            </div>
          </dl>
        </section>

        {view.estimate.terms !== null && view.estimate.terms.trim().length > 0 ? (
          <section className="pe-panel" aria-labelledby="pe-terms-heading">
            <h2 id="pe-terms-heading">Términos</h2>
            <p className="pe-terms">{view.estimate.terms}</p>
          </section>
        ) : null}

        {canRespond ? (
          <section className="pe-actions" aria-label="Responder cotización">
            <p className="pe-actions__hint">
              Confirma tu respuesta con tu nombre. Esto registra tu decisión,
              no constituye una firma legal.
            </p>
            <div className="pe-actions__buttons">
              <button
                type="button"
                className="pe-button pe-button--primary"
                onClick={openApprove}
              >
                Aprobar
              </button>
              <button
                type="button"
                className="pe-button pe-button--danger"
                onClick={openReject}
              >
                Rechazar
              </button>
            </div>
          </section>
        ) : null}

        <footer className="pe-footer">Gestionado con Evolqity Ops</footer>
      </div>

      <DecisionDialog
        open={dialogMode === 'approve'}
        title="Confirmar aprobación"
        description="Indica tu nombre para registrar que apruebas esta cotización."
        confirmLabel="Confirmar aprobación"
        pending={submitPending}
        onClose={closeDialog}
        onSubmit={handleDecisionSubmit}
      >
        <label className="pe-field">
          <span>Nombre</span>
          <input
            name="responderName"
            autoComplete="name"
            required
            minLength={2}
            maxLength={120}
            value={responderName}
            onChange={(event) => setResponderName(event.target.value)}
          />
        </label>
        {fieldError !== null ? (
          <p className="pe-field-error" role="alert">
            {fieldError}
          </p>
        ) : null}
      </DecisionDialog>

      <DecisionDialog
        open={dialogMode === 'reject'}
        title="Confirmar rechazo"
        description="Indica tu nombre. Puedes agregar un motivo opcional."
        confirmLabel="Confirmar rechazo"
        pending={submitPending}
        onClose={closeDialog}
        onSubmit={handleDecisionSubmit}
      >
        <label className="pe-field">
          <span>Nombre</span>
          <input
            name="responderName"
            autoComplete="name"
            required
            minLength={2}
            maxLength={120}
            value={responderName}
            onChange={(event) => setResponderName(event.target.value)}
          />
        </label>
        <label className="pe-field">
          <span>Motivo (opcional)</span>
          <textarea
            name="rejectionReason"
            rows={3}
            maxLength={2000}
            value={rejectionReason}
            onChange={(event) => setRejectionReason(event.target.value)}
          />
        </label>
        {fieldError !== null ? (
          <p className="pe-field-error" role="alert">
            {fieldError}
          </p>
        ) : null}
      </DecisionDialog>
    </main>
  );
}
