import type { FastifyInstance } from 'fastify';

import {
  addInspectionItemBodySchema,
  createInspectionBodySchema,
  inspectionIdParamsSchema,
  inspectionItemParamsSchema,
  listInspectionsQuerySchema,
  updateInspectionBodySchema,
  updateInspectionItemBodySchema,
  workOrderIdParamsSchema,
} from './inspection.schemas.js';
import {
  InspectionCompletedError,
  InspectionHasIncompleteItemsError,
  InspectionHasNoItemsError,
  InspectionItemNotFoundError,
  InspectionNotFoundError,
  InspectionWorkOrderClosedError,
  InspectionWorkOrderNotFoundError,
  InvalidInspectionMembershipError,
  addInspectionItem,
  completeInspection,
  createInspection,
  deleteInspectionItem,
  getInspectionById,
  listInspectionsForWorkOrder,
  updateInspection,
  updateInspectionItem,
} from './inspection.service.js';

function knownInspectionError(error: unknown) {
  if (error instanceof InspectionWorkOrderNotFoundError) {
    return { statusCode: 404, message: 'Work order not found' };
  }
  if (error instanceof InspectionWorkOrderClosedError) {
    return { statusCode: 409, message: 'Work order is closed' };
  }
  if (error instanceof InspectionNotFoundError) {
    return { statusCode: 404, message: 'Inspection not found' };
  }
  if (error instanceof InspectionCompletedError) {
    return { statusCode: 409, message: 'Inspection is completed' };
  }
  if (error instanceof InspectionItemNotFoundError) {
    return { statusCode: 404, message: 'Inspection item not found' };
  }
  if (error instanceof InspectionHasNoItemsError) {
    return { statusCode: 409, message: 'Inspection has no items' };
  }
  if (error instanceof InspectionHasIncompleteItemsError) {
    return { statusCode: 409, message: 'Inspection has incomplete items' };
  }
  if (error instanceof InvalidInspectionMembershipError) {
    return { statusCode: 403, message: 'Forbidden' };
  }

  return null;
}

export async function registerInspectionRoutes(
  app: FastifyInstance,
): Promise<void> {
  const tenantContext = [app.authenticate, app.requireOrganizationContext];

  app.post(
    '/api/work-orders/:workOrderId/inspections',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = workOrderIdParamsSchema.safeParse(request.params);
      const parsedBody = createInspectionBodySchema.safeParse(request.body);

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
        const inspection = await createInspection(
          request.organizationContext.organizationId,
          parsedParams.data.workOrderId,
          request.organizationContext.membershipId,
          parsedBody.data,
        );

        return reply.code(201).send(inspection);
      } catch (error) {
        const knownError = knownInspectionError(error);
        if (knownError !== null) {
          return reply
            .code(knownError.statusCode)
            .send({ message: knownError.message });
        }

        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );

  app.get(
    '/api/work-orders/:workOrderId/inspections',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = workOrderIdParamsSchema.safeParse(request.params);
      const parsedQuery = listInspectionsQuerySchema.safeParse(request.query);

      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid work order id' });
      }
      if (!parsedQuery.success) {
        return reply.code(400).send({ message: 'Invalid query parameters' });
      }
      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const result = await listInspectionsForWorkOrder(
          request.organizationContext.organizationId,
          parsedParams.data.workOrderId,
          parsedQuery.data,
        );

        return reply.code(200).send(result);
      } catch (error) {
        const knownError = knownInspectionError(error);
        if (knownError !== null) {
          return reply
            .code(knownError.statusCode)
            .send({ message: knownError.message });
        }

        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );

  app.get(
    '/api/inspections/:id',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = inspectionIdParamsSchema.safeParse(request.params);

      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid inspection id' });
      }
      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const inspection = await getInspectionById(
          request.organizationContext.organizationId,
          parsedParams.data.id,
        );

        if (inspection === null) {
          return reply.code(404).send({ message: 'Inspection not found' });
        }

        return reply.code(200).send(inspection);
      } catch (error) {
        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );

  app.patch(
    '/api/inspections/:id',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = inspectionIdParamsSchema.safeParse(request.params);
      const parsedBody = updateInspectionBodySchema.safeParse(request.body);

      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid inspection id' });
      }
      if (!parsedBody.success) {
        return reply.code(400).send({ message: 'Invalid request body' });
      }
      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const inspection = await updateInspection(
          request.organizationContext.organizationId,
          parsedParams.data.id,
          parsedBody.data,
        );

        if (inspection === null) {
          return reply.code(404).send({ message: 'Inspection not found' });
        }

        return reply.code(200).send(inspection);
      } catch (error) {
        const knownError = knownInspectionError(error);
        if (knownError !== null) {
          return reply
            .code(knownError.statusCode)
            .send({ message: knownError.message });
        }

        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );

  app.post(
    '/api/inspections/:id/items',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = inspectionIdParamsSchema.safeParse(request.params);
      const parsedBody = addInspectionItemBodySchema.safeParse(request.body);

      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid inspection id' });
      }
      if (!parsedBody.success) {
        return reply.code(400).send({ message: 'Invalid request body' });
      }
      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const item = await addInspectionItem(
          request.organizationContext.organizationId,
          parsedParams.data.id,
          parsedBody.data,
        );

        return reply.code(201).send(item);
      } catch (error) {
        const knownError = knownInspectionError(error);
        if (knownError !== null) {
          return reply
            .code(knownError.statusCode)
            .send({ message: knownError.message });
        }

        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );

  app.patch(
    '/api/inspections/:inspectionId/items/:itemId',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = inspectionItemParamsSchema.safeParse(
        request.params,
      );
      const parsedBody = updateInspectionItemBodySchema.safeParse(
        request.body,
      );

      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid inspection item id' });
      }
      if (!parsedBody.success) {
        return reply.code(400).send({ message: 'Invalid request body' });
      }
      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const item = await updateInspectionItem(
          request.organizationContext.organizationId,
          parsedParams.data.inspectionId,
          parsedParams.data.itemId,
          parsedBody.data,
        );

        return reply.code(200).send(item);
      } catch (error) {
        const knownError = knownInspectionError(error);
        if (knownError !== null) {
          return reply
            .code(knownError.statusCode)
            .send({ message: knownError.message });
        }

        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );

  app.delete(
    '/api/inspections/:inspectionId/items/:itemId',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = inspectionItemParamsSchema.safeParse(
        request.params,
      );

      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid inspection item id' });
      }
      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        await deleteInspectionItem(
          request.organizationContext.organizationId,
          parsedParams.data.inspectionId,
          parsedParams.data.itemId,
        );

        return reply.code(204).send();
      } catch (error) {
        const knownError = knownInspectionError(error);
        if (knownError !== null) {
          return reply
            .code(knownError.statusCode)
            .send({ message: knownError.message });
        }

        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );

  app.post(
    '/api/inspections/:id/complete',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = inspectionIdParamsSchema.safeParse(request.params);

      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid inspection id' });
      }
      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const inspection = await completeInspection(
          request.organizationContext.organizationId,
          parsedParams.data.id,
          request.organizationContext.membershipId,
        );

        if (inspection === null) {
          return reply.code(404).send({ message: 'Inspection not found' });
        }

        return reply.code(200).send(inspection);
      } catch (error) {
        const knownError = knownInspectionError(error);
        if (knownError !== null) {
          return reply
            .code(knownError.statusCode)
            .send({ message: knownError.message });
        }

        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );
}
