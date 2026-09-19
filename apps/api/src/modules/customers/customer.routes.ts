import type { FastifyInstance } from 'fastify';

import {
  createCustomerBodySchema,
  customerIdParamsSchema,
  listCustomersQuerySchema,
  updateCustomerBodySchema,
} from './customer.schemas.js';
import {
  createCustomer,
  getCustomerById,
  listCustomers,
  setCustomerActive,
  updateCustomer,
} from './customer.service.js';

export async function registerCustomerRoutes(
  app: FastifyInstance,
): Promise<void> {
  const tenantContext = [app.authenticate, app.requireOrganizationContext];

  app.post(
    '/api/customers',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedBody = createCustomerBodySchema.safeParse(request.body);

      if (!parsedBody.success) {
        return reply.code(400).send({ message: 'Invalid request body' });
      }

      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const customer = await createCustomer(
          request.organizationContext.organizationId,
          parsedBody.data,
        );

        return reply.code(201).send(customer);
      } catch (error) {
        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );

  app.get(
    '/api/customers',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedQuery = listCustomersQuerySchema.safeParse(request.query);

      if (!parsedQuery.success) {
        return reply.code(400).send({ message: 'Invalid query parameters' });
      }

      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const result = await listCustomers(
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
    '/api/customers/:id',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = customerIdParamsSchema.safeParse(request.params);

      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid customer id' });
      }

      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const customer = await getCustomerById(
          request.organizationContext.organizationId,
          parsedParams.data.id,
        );

        if (customer === null) {
          return reply.code(404).send({ message: 'Customer not found' });
        }

        return reply.code(200).send(customer);
      } catch (error) {
        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );

  app.patch(
    '/api/customers/:id',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = customerIdParamsSchema.safeParse(request.params);
      const parsedBody = updateCustomerBodySchema.safeParse(request.body);

      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid customer id' });
      }

      if (!parsedBody.success) {
        return reply.code(400).send({ message: 'Invalid request body' });
      }

      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const customer = await updateCustomer(
          request.organizationContext.organizationId,
          parsedParams.data.id,
          parsedBody.data,
        );

        if (customer === null) {
          return reply.code(404).send({ message: 'Customer not found' });
        }

        return reply.code(200).send(customer);
      } catch (error) {
        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );

  app.post(
    '/api/customers/:id/deactivate',
    {
      preHandler: [
        ...tenantContext,
        app.requireOrganizationRoles('OWNER', 'ADMIN'),
      ],
    },
    async (request, reply) => {
      const parsedParams = customerIdParamsSchema.safeParse(request.params);

      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid customer id' });
      }

      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const customer = await setCustomerActive(
          request.organizationContext.organizationId,
          parsedParams.data.id,
          false,
        );

        if (customer === null) {
          return reply.code(404).send({ message: 'Customer not found' });
        }

        return reply.code(200).send(customer);
      } catch (error) {
        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );

  app.post(
    '/api/customers/:id/activate',
    {
      preHandler: [
        ...tenantContext,
        app.requireOrganizationRoles('OWNER', 'ADMIN'),
      ],
    },
    async (request, reply) => {
      const parsedParams = customerIdParamsSchema.safeParse(request.params);

      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid customer id' });
      }

      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const customer = await setCustomerActive(
          request.organizationContext.organizationId,
          parsedParams.data.id,
          true,
        );

        if (customer === null) {
          return reply.code(404).send({ message: 'Customer not found' });
        }

        return reply.code(200).send(customer);
      } catch (error) {
        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );
}
