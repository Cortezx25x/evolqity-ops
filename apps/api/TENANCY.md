# Tenant isolation rule

Every entity owned by a tenant must include an `organizationId`.

Every query that reads or mutates tenant-owned data must:

1. Require authentication and a validated `request.organizationContext`.
2. Receive the organization ID explicitly from that context in the service.
3. Filter the Prisma query by that organization ID.

Never use an `organizationId` from a request body or query string as the
authorization source. URL organization IDs must match the validated context.
The `X-Organization-Id` header identifies the requested tenant but is not
trusted until active membership and active organization checks succeed.

Tenant entity services must accept `organizationId` explicitly. Reads, counts,
and mutations must include it in the Prisma `where` clause; updates by ID use a
tenant-scoped operation such as `updateMany({ where: { id, organizationId } })`.
