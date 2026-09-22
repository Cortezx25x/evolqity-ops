import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { env } from '../../config/env.js';
import {
  PublicEstimateCapabilityExpiredError,
  PublicEstimateCapabilityNotFoundError,
  PublicEstimateDecisionConflictError,
  PublicEstimateDecisionNotAllowedError,
  getPublicEstimateView,
  submitPublicEstimateDecision,
} from './public-estimate.service.js';
import {
  publicEstimateDecisionBodySchema,
  queryRejectsOrganizationId,
} from './public-estimate.schemas.js';
import { parseEstimateAuthorizationHeader } from './public-estimate.tokens.js';

const viewRateLimit = {
  max: env.PUBLIC_ESTIMATE_VIEW_RATE_LIMIT_MAX,
  timeWindow: env.PUBLIC_ESTIMATE_VIEW_RATE_LIMIT_WINDOW_SECONDS * 1000,
};

const decisionRateLimit = {
  max: env.PUBLIC_ESTIMATE_DECISION_RATE_LIMIT_MAX,
  timeWindow: env.PUBLIC_ESTIMATE_DECISION_RATE_LIMIT_WINDOW_SECONDS * 1000,
};

function setPublicResponseHeaders(reply: FastifyReply): void {
  reply.header('Cache-Control', 'private, no-store');
  reply.header('Pragma', 'no-cache');
  reply.header('Referrer-Policy', 'no-referrer');
}

function rejectOrganizationIdFromQuery(request: FastifyRequest, reply: FastifyReply) {
  if (!queryRejectsOrganizationId(request.query)) {
    void reply.code(400).send({ message: 'organizationId is not allowed' });
    return false;
  }

  return true;
}

function parseCapabilityHeader(
  request: FastifyRequest,
  reply: FastifyReply,
): { tokenId: string; secret: string } | null {
  const parsed = parseEstimateAuthorizationHeader(request.headers.authorization);
  if (parsed === null) {
    void reply.code(404).send({ message: 'Not found' });
    return null;
  }

  return parsed;
}

function sendPublicEstimateError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
) {
  if (error instanceof PublicEstimateCapabilityNotFoundError) {
    setPublicResponseHeaders(reply);
    return reply.code(404).send({ message: 'Not found' });
  }
  if (error instanceof PublicEstimateCapabilityExpiredError) {
    setPublicResponseHeaders(reply);
    return reply.code(410).send({ message: 'Public estimate link expired' });
  }
  if (error instanceof PublicEstimateDecisionConflictError) {
    setPublicResponseHeaders(reply);
    return reply.code(409).send({ message: 'Decision conflict' });
  }
  if (error instanceof PublicEstimateDecisionNotAllowedError) {
    setPublicResponseHeaders(reply);
    return reply.code(409).send({ message: 'Decision is not allowed' });
  }

  request.log.error(error);
  setPublicResponseHeaders(reply);
  return reply.code(500).send({ message: 'Internal server error' });
}

export async function registerPublicEstimateRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    '/api/public/estimates/view',
    { config: { rateLimit: viewRateLimit } },
    async (request, reply) => {
      if (!rejectOrganizationIdFromQuery(request, reply)) {
        return;
      }

      const capability = parseCapabilityHeader(request, reply);
      if (capability === null) {
        return;
      }

      try {
        const view = await getPublicEstimateView(
          capability.tokenId,
          capability.secret,
        );
        setPublicResponseHeaders(reply);
        return reply.code(200).send(view);
      } catch (error) {
        return sendPublicEstimateError(request, reply, error);
      }
    },
  );

  app.post(
    '/api/public/estimates/decision',
    {
      config: { rateLimit: decisionRateLimit },
      bodyLimit: 4096,
    },
    async (request, reply) => {
      if (!rejectOrganizationIdFromQuery(request, reply)) {
        return;
      }

      const parsedBody = publicEstimateDecisionBodySchema.safeParse(
        request.body,
      );
      if (!parsedBody.success) {
        return reply.code(400).send({ message: 'Invalid request body' });
      }

      const capability = parseCapabilityHeader(request, reply);
      if (capability === null) {
        return;
      }

      try {
        const view = await submitPublicEstimateDecision(
          capability.tokenId,
          capability.secret,
          parsedBody.data,
        );
        setPublicResponseHeaders(reply);
        return reply.code(200).send(view);
      } catch (error) {
        return sendPublicEstimateError(request, reply, error);
      }
    },
  );
}
