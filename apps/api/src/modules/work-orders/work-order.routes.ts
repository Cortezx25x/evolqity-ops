import type { FastifyInstance } from 'fastify';

import {
  createWorkOrderBodySchema,
  listWorkOrdersQuerySchema,
  updateWorkOrderBodySchema,
  updateWorkOrderStatusBodySchema,
  workOrderIdParamsSchema,
} from './work-order.schemas.js';
import {
  InvalidWorkOrderAssetError,
  InvalidWorkOrderAssigneeError,
  InvalidWorkOrderCreatorError,
  InvalidWorkOrderCustomerError,
  InvalidWorkOrderStatusTransitionError,
  WorkOrderClosedError,
  WorkOrderStatusForbiddenError,
  createWorkOrder,
  getWorkOrderById,
  listWorkOrders,
  updateWorkOrder,
  updateWorkOrderStatus,
} from './work-order.service.js';

export async function registerWorkOrderRoutes(
  app: FastifyInstance,
): Promise<void> {
  const tenantContext = [app.authenticate, app.requireOrganizationContext];

  app.post(
    '/api/work-orders',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedBody = createWorkOrderBodySchema.safeParse(request.body);

      if (!parsedBody.success) {
        return reply.code(400).send({ message: 'Invalid request body' });
      }

      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const workOrder = await createWorkOrder(
          request.organizationContext.organizationId,
          request.organizationContext.membershipId,
          parsedBody.data,
        );

        return reply.code(201).send(workOrder);
      } catch (error) {
        if (error instanceof InvalidWorkOrderCustomerError) {
          return reply.code(400).send({ message: 'Invalid customer' });
        }
        if (error instanceof InvalidWorkOrderAssetError) {
          return reply.code(400).send({ message: 'Invalid asset' });
        }
        if (error instanceof InvalidWorkOrderAssigneeError) {
          return reply.code(400).send({ message: 'Invalid assignee' });
        }
        if (error instanceof InvalidWorkOrderCreatorError) {
          return reply.code(403).send({ message: 'Forbidden' });
        }

        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );

  app.get(
    '/api/work-orders',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedQuery = listWorkOrdersQuerySchema.safeParse(request.query);

      if (!parsedQuery.success) {
        return reply.code(400).send({ message: 'Invalid query parameters' });
      }

      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const result = await listWorkOrders(
          request.organizationContext.organizationId,
          parsedQuery.data,
        );

        return reply.code(200).send(result);
      } catch (error) {
        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );

  app.get(
    '/api/work-orders/:id',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = workOrderIdParamsSchema.safeParse(request.params);

      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid work order id' });
      }

      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const workOrder = await getWorkOrderById(
          request.organizationContext.organizationId,
          parsedParams.data.id,
        );

        if (workOrder === null) {
          return reply.code(404).send({ message: 'Work order not found' });
        }

        return reply.code(200).send(workOrder);
      } catch (error) {
        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );

  app.patch(
    '/api/work-orders/:id',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = workOrderIdParamsSchema.safeParse(request.params);
      const parsedBody = updateWorkOrderBodySchema.safeParse(request.body);

      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid work order id' });
      }
      if (!parsedBody.success) {
        return reply.code(400).send({ message: 'Invalid request body' });
      }

      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const workOrder = await updateWorkOrder(
          request.organizationContext.organizationId,
          parsedParams.data.id,
          parsedBody.data,
        );

        if (workOrder === null) {
          return reply.code(404).send({ message: 'Work order not found' });
        }

        return reply.code(200).send(workOrder);
      } catch (error) {
        if (error instanceof InvalidWorkOrderCustomerError) {
          return reply.code(400).send({ message: 'Invalid customer' });
        }
        if (error instanceof InvalidWorkOrderAssetError) {
          return reply.code(400).send({ message: 'Invalid asset' });
        }
        if (error instanceof InvalidWorkOrderAssigneeError) {
          return reply.code(400).send({ message: 'Invalid assignee' });
        }
        if (error instanceof WorkOrderClosedError) {
          return reply.code(409).send({ message: 'Work order is closed' });
        }

        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );

  app.post(
    '/api/work-orders/:id/status',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = workOrderIdParamsSchema.safeParse(request.params);
      const parsedBody = updateWorkOrderStatusBodySchema.safeParse(
        request.body,
      );

      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid work order id' });
      }
      if (!parsedBody.success) {
        return reply.code(400).send({ message: 'Invalid request body' });
      }

      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const workOrder = await updateWorkOrderStatus(
          request.organizationContext.organizationId,
          parsedParams.data.id,
          request.organizationContext.role,
          parsedBody.data,
        );

        if (workOrder === null) {
          return reply.code(404).send({ message: 'Work order not found' });
        }

        return reply.code(200).send(workOrder);
      } catch (error) {
        if (error instanceof WorkOrderStatusForbiddenError) {
          return reply.code(403).send({ message: 'Forbidden' });
        }
        if (error instanceof InvalidWorkOrderStatusTransitionError) {
          return reply
            .code(409)
            .send({ message: 'Invalid status transition' });
        }

        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );
}
