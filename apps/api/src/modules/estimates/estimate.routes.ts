import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { EstimateMoneyError } from './estimate.money.js';
import {
  createEstimateBodySchema,
  estimateIdParamsSchema,
  estimateItemInputSchema,
  estimateItemParamsSchema,
  listEstimatesQuerySchema,
  updateEstimateBodySchema,
  updateEstimateItemBodySchema,
  updateEstimateStatusBodySchema,
  workOrderEstimateParamsSchema,
} from './estimate.schemas.js';
import {
  EstimateHasNoItemsError,
  EstimateItemNotFoundError,
  EstimateLockedError,
  EstimateNotFoundError,
  EstimateWorkOrderClosedError,
  EstimateWorkOrderNotFoundError,
  InvalidEstimateMembershipError,
  InvalidEstimateStatusTransitionError,
  addEstimateItem,
  createEstimate,
  deleteEstimateItem,
  getEstimateById,
  listEstimatesForWorkOrder,
  updateEstimate,
  updateEstimateItem,
  updateEstimateStatus,
} from './estimate.service.js';

function knownEstimateError(error: unknown) {
  if (error instanceof EstimateWorkOrderNotFoundError) {
    return { statusCode: 404, message: 'Work order not found' };
  }
  if (error instanceof EstimateWorkOrderClosedError) {
    return { statusCode: 409, message: 'Work order is closed' };
  }
  if (error instanceof EstimateNotFoundError) {
    return { statusCode: 404, message: 'Estimate not found' };
  }
  if (error instanceof EstimateLockedError) {
    return { statusCode: 409, message: 'Estimate is locked' };
  }
  if (error instanceof EstimateItemNotFoundError) {
    return { statusCode: 404, message: 'Estimate item not found' };
  }
  if (error instanceof EstimateHasNoItemsError) {
    return { statusCode: 409, message: 'Estimate has no items' };
  }
  if (error instanceof InvalidEstimateStatusTransitionError) {
    return {
      statusCode: 409,
      message: 'Invalid estimate status transition',
    };
  }
  if (error instanceof InvalidEstimateMembershipError) {
    return { statusCode: 403, message: 'Forbidden' };
  }
  if (error instanceof EstimateMoneyError) {
    return { statusCode: 400, message: 'Invalid monetary value' };
  }

  return null;
}

function sendEstimateError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
) {
  const known = knownEstimateError(error);
  if (known !== null) {
    return reply.code(known.statusCode).send({ message: known.message });
  }

  request.log.error(error);
  return reply.code(500).send({ message: 'Internal server error' });
}

export async function registerEstimateRoutes(
  app: FastifyInstance,
): Promise<void> {
  const tenantContext = [app.authenticate, app.requireOrganizationContext];

  app.post(
    '/api/work-orders/:workOrderId/estimates',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = workOrderEstimateParamsSchema.safeParse(
        request.params,
      );
      const parsedBody = createEstimateBodySchema.safeParse(request.body);
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
        const estimate = await createEstimate(
          request.organizationContext.organizationId,
          parsedParams.data.workOrderId,
          request.organizationContext.membershipId,
          parsedBody.data,
        );
        return reply.code(201).send(estimate);
      } catch (error) {
        return sendEstimateError(request, reply, error);
      }
    },
  );

  app.get(
    '/api/work-orders/:workOrderId/estimates',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = workOrderEstimateParamsSchema.safeParse(
        request.params,
      );
      const parsedQuery = listEstimatesQuerySchema.safeParse(request.query);
      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid work order id' });
      }
      if (!parsedQuery.success) {
        return reply.code(400).send({ message: 'Invalid query' });
      }
      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        return reply.code(200).send(
          await listEstimatesForWorkOrder(
            request.organizationContext.organizationId,
            parsedParams.data.workOrderId,
            parsedQuery.data,
          ),
        );
      } catch (error) {
        return sendEstimateError(request, reply, error);
      }
    },
  );

  app.get(
    '/api/estimates/:id',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = estimateIdParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid estimate id' });
      }
      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const estimate = await getEstimateById(
          request.organizationContext.organizationId,
          parsedParams.data.id,
        );
        if (estimate === null) {
          return reply.code(404).send({ message: 'Estimate not found' });
        }
        return reply.code(200).send(estimate);
      } catch (error) {
        return sendEstimateError(request, reply, error);
      }
    },
  );

  app.patch(
    '/api/estimates/:id',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = estimateIdParamsSchema.safeParse(request.params);
      const parsedBody = updateEstimateBodySchema.safeParse(request.body);
      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid estimate id' });
      }
      if (!parsedBody.success) {
        return reply.code(400).send({ message: 'Invalid request body' });
      }
      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        return reply.code(200).send(
          await updateEstimate(
            request.organizationContext.organizationId,
            parsedParams.data.id,
            parsedBody.data,
          ),
        );
      } catch (error) {
        return sendEstimateError(request, reply, error);
      }
    },
  );

  app.post(
    '/api/estimates/:id/items',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = estimateIdParamsSchema.safeParse(request.params);
      const parsedBody = estimateItemInputSchema.safeParse(request.body);
      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid estimate id' });
      }
      if (!parsedBody.success) {
        return reply.code(400).send({ message: 'Invalid request body' });
      }
      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        return reply.code(201).send(
          await addEstimateItem(
            request.organizationContext.organizationId,
            parsedParams.data.id,
            parsedBody.data,
          ),
        );
      } catch (error) {
        return sendEstimateError(request, reply, error);
      }
    },
  );

  app.patch(
    '/api/estimates/:estimateId/items/:itemId',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = estimateItemParamsSchema.safeParse(request.params);
      const parsedBody = updateEstimateItemBodySchema.safeParse(request.body);
      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid estimate item id' });
      }
      if (!parsedBody.success) {
        return reply.code(400).send({ message: 'Invalid request body' });
      }
      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        return reply.code(200).send(
          await updateEstimateItem(
            request.organizationContext.organizationId,
            parsedParams.data.estimateId,
            parsedParams.data.itemId,
            parsedBody.data,
          ),
        );
      } catch (error) {
        return sendEstimateError(request, reply, error);
      }
    },
  );

  app.delete(
    '/api/estimates/:estimateId/items/:itemId',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = estimateItemParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid estimate item id' });
      }
      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        await deleteEstimateItem(
          request.organizationContext.organizationId,
          parsedParams.data.estimateId,
          parsedParams.data.itemId,
        );
        return reply.code(204).send();
      } catch (error) {
        return sendEstimateError(request, reply, error);
      }
    },
  );

  app.post(
    '/api/estimates/:id/status',
    {
      preHandler: [
        ...tenantContext,
        app.requireOrganizationRoles('OWNER', 'ADMIN'),
      ],
    },
    async (request, reply) => {
      const parsedParams = estimateIdParamsSchema.safeParse(request.params);
      const parsedBody = updateEstimateStatusBodySchema.safeParse(
        request.body,
      );
      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid estimate id' });
      }
      if (!parsedBody.success) {
        return reply.code(400).send({ message: 'Invalid request body' });
      }
      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        return reply.code(200).send(
          await updateEstimateStatus(
            request.organizationContext.organizationId,
            parsedParams.data.id,
            parsedBody.data,
          ),
        );
      } catch (error) {
        return sendEstimateError(request, reply, error);
      }
    },
  );
}
