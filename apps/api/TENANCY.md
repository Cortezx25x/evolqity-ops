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

Relations between tenant entities must also be validated with the same
`organizationId`. A valid foreign key is not authorization: for example, a
frontend-provided `customerId` must be checked against
`request.organizationContext.organizationId` before it can be assigned.

For work orders, an optional Asset must also belong to the selected Customer,
and an assignee membership must be active in the same organization. Related
IDs never grant access. Tenant-scoped sequence numbers are generated only by
the server inside the transaction that creates the record.

Child resources inherit authorization through their tenant-owned parent.
Creating an Inspection requires a WorkOrder from the active organization, and
an InspectionItem derives its tenant from its Inspection. A child UUID alone
never grants access; both parent ownership and the parent-child relationship
must be verified.

Media belongs to one tenant and exactly one parent: WorkOrder, Inspection, or
InspectionItem. Its `storageKey` is internal, and physical content is served
only after resolving tenant-scoped metadata. Database cascades are not a
substitute for filesystem cleanup, so media-bearing parents use restrictive
foreign keys and child IDs are always authorized through their parent.
