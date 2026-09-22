import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from 'react';
import { useSearchParams } from 'react-router-dom';

import { messageForApiError } from '../api/api-client';
import {
  activateAssetRequest,
  createAssetRequest,
  deactivateAssetRequest,
  listAssetsRequest,
  updateAssetRequest,
} from '../api/assets.api';
import { listCustomersRequest } from '../api/customers.api';
import type { Asset, AssetType, Customer } from '../api/types';
import { Modal, ModalFooter } from '../components/Modal';
import { useOrganization } from '../contexts/OrganizationContext';
import { assetTypeLabel } from '../lib/asset-labels';
import { canManageOrganization } from '../lib/roles';

export function AssetsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { selectedOrganization, isTenantReady } = useOrganization();
  const customerFilter = searchParams.get('customerId') ?? '';

  const [assets, setAssets] = useState<Asset[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editAsset, setEditAsset] = useState<Asset | null>(null);

  const canManage =
    selectedOrganization !== null &&
    canManageOrganization(selectedOrganization.role);

  useEffect(() => {
    document.title = 'Activos · Evolqity Ops';
  }, []);

  const loadAssets = useCallback(async () => {
    if (!isTenantReady || selectedOrganization === null) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await listAssetsRequest({
        search,
        customerId: customerFilter === '' ? undefined : customerFilter,
        page,
        limit: 20,
      });
      setAssets(result.data);
      setTotalPages(result.pagination.totalPages);
    } catch (caught) {
      setError(messageForApiError(caught));
    } finally {
      setLoading(false);
    }
  }, [customerFilter, isTenantReady, page, search, selectedOrganization]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  function clearCustomerFilter() {
    setSearchParams({});
    setPage(1);
  }

  return (
    <div className="app-page">
      <header className="app-page-header">
        <div>
          <h1>Activos</h1>
          <p className="app-page-lead">
            Vehículos y equipos asociados a tus clientes.
          </p>
        </div>
        <button
          type="button"
          className="app-button app-button--primary"
          onClick={() => setCreateOpen(true)}
        >
          Nuevo activo
        </button>
      </header>

      {customerFilter !== '' ? (
        <p className="app-alert app-alert--info" role="status">
          Filtrando por cliente seleccionado.{' '}
          <button
            type="button"
            className="app-link-button"
            onClick={clearCustomerFilter}
          >
            Ver todos
          </button>
        </p>
      ) : null}

      {successMessage !== null ? (
        <p className="app-alert app-alert--success" role="status">
          {successMessage}
        </p>
      ) : null}

      {error !== null ? (
        <p className="app-alert app-alert--error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="app-panel">
        <form className="app-toolbar" onSubmit={handleSearchSubmit}>
          <label className="app-search">
            <span className="visually-hidden">Buscar activos</span>
            <input
              type="search"
              placeholder="Buscar por nombre, placa o VIN"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </label>
          <button type="submit" className="app-button app-button--secondary">
            Buscar
          </button>
        </form>

        {loading ? (
          <p className="app-muted">Cargando activos…</p>
        ) : assets.length === 0 ? (
          <p className="app-empty-inline">No hay activos para mostrar.</p>
        ) : (
          <>
            <div className="list-table-wrap">
              <table className="list-table list-table--assets">
                <thead>
                  <tr>
                    <th scope="col">Nombre</th>
                    <th scope="col">Cliente</th>
                    <th scope="col">Tipo</th>
                    <th scope="col">Placa</th>
                    <th scope="col">Estado</th>
                    <th scope="col">
                      <span className="visually-hidden">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map((asset) => (
                    <tr key={asset.id}>
                      <td data-label="Nombre">{asset.name}</td>
                      <td data-label="Cliente">{asset.customer.name}</td>
                      <td data-label="Tipo">{assetTypeLabel(asset.type)}</td>
                      <td data-label="Placa">{asset.plate ?? '—'}</td>
                      <td data-label="Estado">
                        <span
                          className={
                            asset.active
                              ? 'status-badge status-badge--success'
                              : 'status-badge status-badge--muted'
                          }
                        >
                          {asset.active ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td data-label="Acciones">
                        <button
                          type="button"
                          className="app-button app-button--ghost app-button--small"
                          onClick={() => setEditAsset(asset)}
                        >
                          Editar
                        </button>
                        {canManage ? (
                          asset.active ? (
                            <button
                              type="button"
                              className="app-button app-button--ghost app-button--small"
                              onClick={() => {
                                void deactivateAssetRequest(asset.id).then(
                                  () => {
                                    setSuccessMessage('Activo desactivado.');
                                    void loadAssets();
                                  },
                                );
                              }}
                            >
                              Desactivar
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="app-button app-button--ghost app-button--small"
                              onClick={() => {
                                void activateAssetRequest(asset.id).then(() => {
                                  setSuccessMessage('Activo activado.');
                                  void loadAssets();
                                });
                              }}
                            >
                              Activar
                            </button>
                          )
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="list-cards">
              {assets.map((asset) => (
                <li key={asset.id} className="list-card">
                  <div className="list-card-header">
                    <strong>{asset.name}</strong>
                    <span
                      className={
                        asset.active
                          ? 'status-badge status-badge--success'
                          : 'status-badge status-badge--muted'
                      }
                    >
                      {asset.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                  <p className="list-card-meta">
                    {asset.customer.name} · {assetTypeLabel(asset.type)}
                  </p>
                  {asset.plate ? (
                    <p className="list-card-meta">Placa: {asset.plate}</p>
                  ) : null}
                  <div className="list-card-actions">
                    <button
                      type="button"
                      className="app-button app-button--secondary app-button--small"
                      onClick={() => setEditAsset(asset)}
                    >
                      Editar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {totalPages > 1 ? (
          <div className="app-pagination">
            <button
              type="button"
              className="app-button app-button--secondary"
              disabled={page <= 1 || loading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Anterior
            </button>
            <p className="app-muted">
              Página {page} de {totalPages}
            </p>
            <button
              type="button"
              className="app-button app-button--secondary"
              disabled={page >= totalPages || loading}
              onClick={() =>
                setPage((current) => Math.min(totalPages, current + 1))
              }
            >
              Siguiente
            </button>
          </div>
        ) : null}
      </section>

      <AssetFormModal
        title="Nuevo activo"
        open={createOpen}
        initialCustomerId={customerFilter}
        onClose={() => setCreateOpen(false)}
        onSubmit={async (input) => {
          await createAssetRequest(input);
          setCreateOpen(false);
          setSuccessMessage('Activo creado correctamente.');
          await loadAssets();
        }}
      />

      <AssetFormModal
        title="Editar activo"
        open={editAsset !== null}
        asset={editAsset ?? undefined}
        onClose={() => setEditAsset(null)}
        onSubmit={async (input) => {
          if (editAsset === null) {
            return;
          }
          await updateAssetRequest(editAsset.id, input);
          setEditAsset(null);
          setSuccessMessage('Activo actualizado.');
          await loadAssets();
        }}
      />
    </div>
  );
}

function AssetFormModal({
  title,
  open,
  asset,
  initialCustomerId,
  onClose,
  onSubmit,
}: {
  title: string;
  open: boolean;
  asset?: Asset;
  initialCustomerId?: string;
  onClose: () => void;
  onSubmit: (input: Parameters<typeof createAssetRequest>[0]) => Promise<void>;
}) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState(
    asset?.customer.id ?? initialCustomerId ?? '',
  );
  const [type, setType] = useState<AssetType>(asset?.type ?? 'VEHICLE');
  const [name, setName] = useState(asset?.name ?? '');
  const [plate, setPlate] = useState(asset?.plate ?? '');
  const [vin, setVin] = useState(asset?.vin ?? '');
  const [make, setMake] = useState(asset?.make ?? '');
  const [model, setModel] = useState(asset?.model ?? '');
  const [year, setYear] = useState(
    asset?.year !== null && asset?.year !== undefined ? String(asset.year) : '',
  );
  const [color, setColor] = useState(asset?.color ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setCustomerId(asset?.customer.id ?? initialCustomerId ?? '');
    setType(asset?.type ?? 'VEHICLE');
    setName(asset?.name ?? '');
    setPlate(asset?.plate ?? '');
    setVin(asset?.vin ?? '');
    setMake(asset?.make ?? '');
    setModel(asset?.model ?? '');
    setYear(
      asset?.year !== null && asset?.year !== undefined
        ? String(asset.year)
        : '',
    );
    setColor(asset?.color ?? '');
    setError(null);
    setPending(false);

    void listCustomersRequest({ active: true, limit: 100, page: 1 }).then(
      (result) => setCustomers(result.data),
    );
  }, [asset, initialCustomerId, open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const parsedYear =
      year.trim() === '' ? undefined : Number.parseInt(year, 10);

    try {
      await onSubmit({
        customerId,
        type,
        name,
        plate: plate.trim() || undefined,
        vin: vin.trim() || undefined,
        make: make.trim() || undefined,
        model: model.trim() || undefined,
        year:
          parsedYear !== undefined && !Number.isNaN(parsedYear)
            ? parsedYear
            : undefined,
        color: color.trim() || undefined,
      });
    } catch (caught) {
      setError(messageForApiError(caught));
    } finally {
      setPending(false);
    }
  }

  const showVehicleFields = type === 'VEHICLE';

  return (
    <Modal
      title={title}
      description={
        asset === undefined
          ? 'Asocia el activo a un cliente existente del taller.'
          : 'Actualiza los datos del activo.'
      }
      open={open}
      onClose={onClose}
      size="wide"
    >
      <form className="app-modal-form app-modal-form--two-col" onSubmit={handleSubmit}>
        <div className="app-field app-field--full">
          <label htmlFor="asset-customer">Cliente</label>
          <select
            id="asset-customer"
            required
            value={customerId}
            disabled={pending || asset !== undefined}
            onChange={(event) => setCustomerId(event.target.value)}
          >
            <option value="">Selecciona un cliente</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </div>

        <div className="app-field">
          <label htmlFor="asset-type">Tipo</label>
          <select
            id="asset-type"
            value={type}
            disabled={pending}
            onChange={(event) => setType(event.target.value as AssetType)}
          >
            <option value="VEHICLE">Vehículo</option>
            <option value="EQUIPMENT">Equipo</option>
            <option value="DEVICE">Dispositivo</option>
            <option value="OTHER">Otro</option>
          </select>
        </div>

        <div className="app-field app-field--full">
          <label htmlFor="asset-name">Nombre</label>
          <input
            id="asset-name"
            required
            minLength={2}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={pending}
          />
        </div>

        {showVehicleFields ? (
          <>
            <div className="app-field">
              <label htmlFor="asset-make">Marca</label>
              <input
                id="asset-make"
                value={make}
                onChange={(event) => setMake(event.target.value)}
                disabled={pending}
              />
            </div>
            <div className="app-field">
              <label htmlFor="asset-model">Modelo</label>
              <input
                id="asset-model"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                disabled={pending}
              />
            </div>
            <div className="app-field">
              <label htmlFor="asset-plate">Placa</label>
              <input
                id="asset-plate"
                value={plate}
                onChange={(event) => setPlate(event.target.value)}
                disabled={pending}
              />
            </div>
            <div className="app-field">
              <label htmlFor="asset-year">Año</label>
              <input
                id="asset-year"
                inputMode="numeric"
                value={year}
                onChange={(event) => setYear(event.target.value)}
                disabled={pending}
              />
            </div>
            <div className="app-field app-field--full">
              <label htmlFor="asset-vin">VIN</label>
              <input
                id="asset-vin"
                value={vin}
                onChange={(event) => setVin(event.target.value)}
                disabled={pending}
              />
            </div>
            <div className="app-field">
              <label htmlFor="asset-color">Color</label>
              <input
                id="asset-color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
                disabled={pending}
              />
            </div>
          </>
        ) : null}

        {error !== null ? (
          <p className="app-alert app-alert--error app-field--full" role="alert">
            {error}
          </p>
        ) : null}

        <ModalFooter>
          <button
            type="button"
            className="app-button app-button--ghost"
            onClick={onClose}
            disabled={pending}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="app-button app-button--primary"
            disabled={pending || customerId === ''}
          >
            {pending ? 'Guardando…' : 'Guardar'}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
