import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { messageForApiError } from '../api/api-client';
import { listAssetsRequest } from '../api/assets.api';
import { listCustomersRequest } from '../api/customers.api';
import { listWorkOrdersRequest } from '../api/work-orders.api';
import type { WorkOrder } from '../api/types';
import { formatCompactDate } from '../lib/dates';
import { useOrganization } from '../contexts/OrganizationContext';
import {
  WorkOrderStatusBadge,
} from '../components/WorkOrderStatusBadge';

interface DashboardMetrics {
  customers: number | null;
  assets: number | null;
  open: number | null;
  inProgress: number | null;
  waiting: number | null;
}

export function DashboardPage() {
  const { selectedOrganization, isTenantReady } = useOrganization();
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    customers: null,
    assets: null,
    open: null,
    inProgress: null,
    waiting: null,
  });
  const [recentOrders, setRecentOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Dashboard · Evolqity Ops';
  }, []);

  useEffect(() => {
    if (!isTenantReady) {
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const [
          customers,
          assets,
          openOrders,
          inProgressOrders,
          waitingOrders,
          recent,
        ] = await Promise.all([
          listCustomersRequest({ active: true, limit: 1, page: 1 }),
          listAssetsRequest({ active: true, limit: 1, page: 1 }),
          listWorkOrdersRequest({ status: 'OPEN', limit: 1, page: 1 }),
          listWorkOrdersRequest({ status: 'IN_PROGRESS', limit: 1, page: 1 }),
          listWorkOrdersRequest({ status: 'WAITING', limit: 1, page: 1 }),
          listWorkOrdersRequest({ limit: 5, page: 1 }),
        ]);

        if (cancelled) {
          return;
        }

        setMetrics({
          customers: customers.pagination.total,
          assets: assets.pagination.total,
          open: openOrders.pagination.total,
          inProgress: inProgressOrders.pagination.total,
          waiting: waitingOrders.pagination.total,
        });
        setRecentOrders(recent.data);
      } catch (caught) {
        if (!cancelled) {
          setError(messageForApiError(caught));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [isTenantReady]);

  return (
    <div className="app-page">
      <header className="app-page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="app-page-lead">
            Resumen operativo de {selectedOrganization?.name ?? 'tu taller'}.
          </p>
        </div>
        <div className="app-page-actions">
          <Link className="app-button app-button--secondary" to="/app/customers">
            Nuevo cliente
          </Link>
          <Link
            className="app-button app-button--primary"
            to="/app/work-orders"
            state={{ openCreate: true }}
          >
            Nueva orden
          </Link>
        </div>
      </header>

      {error !== null ? (
        <p className="app-alert app-alert--error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="metric-grid" aria-label="Indicadores">
        {loading ? (
          <>
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="metric-card metric-card--skeleton" />
            ))}
          </>
        ) : (
          <>
            <MetricCard label="Clientes activos" value={metrics.customers} />
            <MetricCard label="Activos activos" value={metrics.assets} />
            <MetricCard label="Órdenes abiertas" value={metrics.open} />
            <MetricCard
              label="Órdenes en progreso"
              value={metrics.inProgress}
            />
            <MetricCard label="Órdenes en espera" value={metrics.waiting} />
          </>
        )}
      </section>

      <section className="app-panel" aria-labelledby="recent-work-orders">
        <div className="app-panel-header">
          <h2 id="recent-work-orders">Órdenes recientes</h2>
        </div>

        {loading ? (
          <p className="app-muted">Cargando órdenes…</p>
        ) : recentOrders.length === 0 ? (
          <p className="app-empty-inline">
            Aún no hay órdenes de trabajo registradas.
          </p>
        ) : (
          <div className="list-table-wrap">
            <table className="list-table list-table--work-orders">
              <thead>
                <tr>
                  <th scope="col">Número</th>
                  <th scope="col">Título</th>
                  <th scope="col">Cliente</th>
                  <th scope="col">Estado</th>
                  <th scope="col" className="col-created">Creada</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <Link
                        to={`/app/work-orders/${order.id}`}
                        className="app-table-link"
                      >
                        #{order.number}
                      </Link>
                    </td>
                    <td>{order.title}</td>
                    <td>{order.customer.name}</td>
                    <td>
                      <WorkOrderStatusBadge status={order.status} />
                    </td>
                    <td className="col-created">
                      {formatCompactDate(order.createdAt) ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  return (
    <article className="metric-card">
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value ?? '—'}</p>
    </article>
  );
}
