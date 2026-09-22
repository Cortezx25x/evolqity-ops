# Evolqity Portal — Project State

**Checkpoint date:** 2026-09-21

**Application status:** The core Evolqity Portal MVP is implemented across the Fastify API and responsive React SPA. The complete tenant workflow includes Customers, Assets, Work Orders, Inspections, Media, Estimates, secure public estimate approval, employee/team management, role-aware navigation, and platform-level organization administration. Authentication and multitenancy are enforced in the application layer.

**Last implemented phase:** **Platform Administration**, including the separate `PLATFORM_ADMIN` capability, organization listing/search/filtering, organization rename, activate/deactivate lifecycle, operator-only platform-admin assignment/revocation, password reset tooling, platform route guards, and responsive administration UI.

**Current phase:** **FASE 12B — Production Deployment**, targeting `https://portal.evolqity.com`. Manual VPS provisioning is in progress. Production uses a separate PostgreSQL database, persistent media storage, Node.js 24, systemd, Nginx, and HTTPS.

Repository layout: two-package monorepo with `apps/api` (Fastify backend) and `apps/web` (integrated Vite/React SPA using same-origin `/api` requests).

---

## Stack (verified from `apps/api/package.json`)

| Area | Package / runtime | Version (declared) |
|------|-------------------|--------------------|
| Runtime | Node.js | 24.x (development/deployment validated with Node 24.21.0) |
| Package manager | npm | 11.x (validated with npm 11.19.0) |
| Language | TypeScript | ^7.0.2 |
| HTTP | Fastify | ^5.12.5 |
| ORM | Prisma | ^7.10.0 (`@prisma/client`, `prisma` CLI) |
| DB driver | `pg` + `@prisma/adapter-pg` | ^8.23.0 / ^7.10.0 |
| Validation | Zod | ^4.6.5 |
| Tests | Vitest | ^5.0.1 |
| Money | `decimal.js` | ^10.6.0 |
| Auth HTTP | `@fastify/jwt` | ^10.2.2 |
| Cookies | `@fastify/cookie` | ^11.1.2 |
| Rate limit | `@fastify/rate-limit` | ^11.2.0 |
| Uploads | `@fastify/multipart` | ^10.1.1 |
| File typing | `file-type` | ^22.1.1 |
| Security headers | `@fastify/helmet` | ^13.1.1 |
| CORS | `@fastify/cors` | ^11.3.0 |
| Password hashing | Node `crypto.argon2` (Argon2id) | Built-in; see `auth.password.ts` |

Prisma client is generated to `apps/api/src/generated/prisma` (`provider = "prisma-client"`). Datasource URL comes from `DATABASE_URL` via `prisma.config.ts`.

---

## Architecture

```
apps/api/
  src/
    config/          # env parsing (Zod)
    lib/             # Prisma singleton
    plugins/         # authenticate, organization context
    modules/         # feature modules (routes + service + schemas)
    app.ts           # Fastify build, plugin registration, route wiring
    server.ts
  prisma/
    schema.prisma
    migrations/
  tests/
  TENANCY.md
```

**Pattern (default):** `*.routes.ts` → HTTP, Zod parse, auth/context preHandlers → `*.service.ts` → Prisma + business rules → explicit `select` shapes for public JSON.

**Exceptions / layers:**
- **Media:** `storage/media-storage.ts` + `local-media-storage.ts`; service orchestrates DB + filesystem.
- **Estimates:** `estimate.money.ts` centralizes decimal math and serialization (no Prisma in money module).
- **Auth:** tokens/cookies/password helpers under `modules/auth/`; routes do not touch Prisma directly for all flows but services do.

Routes should not import Prisma for tenant business logic; services accept `organizationId` explicitly.

---

## Database / Prisma models (summary)

All tenant-owned business entities include `organizationId` except `InspectionItem` and `EstimateItem` (child rows; tenant is derived from parent).

### Enums

| Enum | Values |
|------|--------|
| `PlatformRole` | PLATFORM_ADMIN |
| `OrganizationRole` | OWNER, ADMIN, MEMBER |
| `CustomerType` | PERSON, COMPANY |
| `AssetType` | VEHICLE, EQUIPMENT, DEVICE, OTHER |
| `WorkOrderStatus` | DRAFT, OPEN, IN_PROGRESS, WAITING, COMPLETED, CANCELLED |
| `WorkOrderPriority` | LOW, NORMAL, HIGH, URGENT |
| `InspectionStatus` | DRAFT, COMPLETED |
| `InspectionItemCondition` | OK, ATTENTION, FAIL, NOT_APPLICABLE |
| `EstimateStatus` | DRAFT, SENT, APPROVED, REJECTED, CANCELLED |
| `EstimateItemType` | LABOR, PART, SERVICE, OTHER |
| `PublicEstimateDecision` | APPROVED, REJECTED |

### Models

| Model | Purpose | Tenant key | Notable fields / constraints |
|-------|---------|------------|------------------------------|
| **Organization** | Tenant root | — | `slug` unique; `active`; counters `nextWorkOrderNumber`, `nextEstimateNumber` (default 1) |
| **User** | Global login identity | — | `email` unique; `passwordHash` nullable; optional `platformRole` (`PLATFORM_ADMIN`) |
| **OrganizationUser** | Membership + role | `organizationId` | `@@unique([organizationId, userId])`; `role`, `active` |
| **AuthSession** | Login session | via `userId` | `expiresAt`, `revokedAt`, metadata |
| **RefreshToken** | Opaque refresh storage | via `sessionId` | `tokenHash` (Bytes, unique), rotation fields `usedAt`, `replacedByTokenId` |
| **Customer** | Tenant customer | `organizationId` | `active`; FK org CASCADE |
| **Asset** | Customer-owned asset | `organizationId` | `customerId` required; indexes on plate/vin |
| **WorkOrder** | Operational job | `organizationId` | `@@unique([organizationId, number])`; customer required; asset optional |
| **Inspection** | Checklist on WorkOrder | `organizationId` | `nextItemOrder`; DRAFT/COMPLETED |
| **InspectionItem** | Line on inspection | via `inspectionId` | `sortOrder`; optional `condition` |
| **Media** | Photo metadata | `organizationId` | Exactly one parent FK among WO / Inspection / Item (enforced in service); `storageKey` unique |
| **Estimate** | Quote on WorkOrder | `organizationId` | `@@unique([organizationId, number])`; `@@unique([id, organizationId])`; `Decimal` totals; status workflow; `nextItemOrder` |
| **EstimateItem** | Quote line | via `estimateId` | Server-calculated money columns; `sortOrder` |
| **EstimatePublicToken** | Public capability + decision audit | `organizationId` | `secretHash` unique; composite FKs; partial unique one active (`revokedAt IS NULL`) per estimate |

**Media parent invariant:** DB allows three optional parent FKs; application must ensure exactly one is set (`media.service` / upload paths). Direct SQL could violate this.

**Money columns:** `Estimate` / `EstimateItem` use `@db.Decimal(...)`; never `Float`.

---

## Migrations (chronological)

| Migration folder | Purpose (from name + schema) |
|------------------|------------------------------|
| `20260919190632_init_multitenancy` | Organization, User, OrganizationUser |
| `20260919210046_add_auth_foundation` | AuthSession, RefreshToken |
| `20260919215932_add_customers` | Customer |
| `20260919230554_add_assets` | Asset |
| `20260919234011_add_work_orders` | WorkOrder, `nextWorkOrderNumber` |
| `20260920022107_add_inspections` | Inspection, InspectionItem |
| `20260920030119_add_media` | Media |
| `20260920035148_add_estimates` | Estimate, EstimateItem, `nextEstimateNumber` |
| `20260920160403_add_public_estimate_approval` | `PublicEstimateDecision`, `EstimatePublicToken`, composite uniques on `Estimate` / `OrganizationUser`, partial unique active token index |
| `20260921221500_add_platform_role` | Adds `PlatformRole`, optional `User.platformRole`; existing users remain `null` |

**Count:** 10 migrations under `apps/api/prisma/migrations/`.
**DEV/TEST migration apply status at checkpoint creation:** Not verified (no `migrate status` run during this doc-only task).

Workflow for new migrations: `npx prisma migrate dev --create-only --name <name>`, review SQL, then apply to DEV; `migrate deploy` for TEST/CI-style environments. Do not use `db push` or `migrate reset` on shared DBs.

---

## Authentication

**Endpoints** (`auth.routes.ts`):

| Method | Path | Notes |
|--------|------|--------|
| POST | `/api/auth/register` | Rate limited |
| POST | `/api/auth/login` | Rate limited |
| POST | `/api/auth/refresh` | Cookie-based refresh |
| POST | `/api/auth/logout` | Clears cookie; revokes session best-effort |
`GET /api/auth/me` returns the authenticated profile, active organization memberships, and `platformRole`.
`platformRole` is not used as tenant authorization and does not grant organization membership.
| POST | `/api/auth/select-organization` | JWT; validates membership |
| GET | `/api/auth/context` | JWT + `X-Organization-Id` |

**Passwords:** Argon2id via `node:crypto` (`auth.password.ts`), custom `$evolqity$argon2id$...` encoding.

**Access token:** JWT (`@fastify/jwt`), short TTL (`AUTH_ACCESS_TOKEN_TTL_SECONDS`, default 900). Claims include `userId` and `authSessionId`; plugin validates session still active (`authentication.ts`).

**Refresh token:** Opaque value in HTTP-only cookie (`AUTH_REFRESH_COOKIE_NAME`). Stored as hash (`RefreshToken.tokenHash`). Rotation on refresh; reuse of spent token triggers session revocation (`refresh_token_replay` in `auth.service.ts`).

**Sessions:** `AuthSession` with expiry and revocation; logout revokes.

**Rate limiting:** Login/register use `AUTH_LOGIN_RATE_LIMIT_*` (global plugin + per-route config).

**Security:** `app.ts` redacts passwords/tokens in logs. Public responses exclude `passwordHash`, refresh material, `tokenHash`.

**Nullable password:** `User.passwordHash` optional (supports flows where password not set).

---

## Multitenancy

---

## Platform Administration

Platform administration is separate from tenant membership authorization.

### Platform role

`User.platformRole` may be:

- `PLATFORM_ADMIN`
- `null`

`PLATFORM_ADMIN` is not part of `OrganizationRole`.

A platform administrator does **not** automatically gain access to tenant Customers, Assets, Work Orders, Inspections, Media, Estimates, or Team data.

Normal tenant APIs still require a valid active `OrganizationUser` membership.

### Authorization

Platform routes use a dedicated `requirePlatformAdmin` guard.

The guard:

- requires an authenticated user
- reads the current `User.platformRole` from trusted server-side state
- requires `PLATFORM_ADMIN`
- does not use `X-Organization-Id`

Platform privilege is not trusted from frontend state.

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/platform/organizations` | Search/filter/paginate organizations |
| GET | `/api/platform/organizations/:organizationId` | Administrative organization metadata |
| PATCH | `/api/platform/organizations/:organizationId` | Update supported basic organization metadata such as name |
| POST | `/api/platform/organizations/:organizationId/deactivate` | Soft-deactivate organization |
| POST | `/api/platform/organizations/:organizationId/activate` | Reactivate organization |

### Organization lifecycle

Deactivation uses `Organization.active`.

Deactivation:

- preserves all tenant data
- preserves memberships
- immediately blocks normal tenant access
- removes the organization from normal `/me` organization selection
- prevents public estimate capabilities from being used

Reactivation restores access only for memberships that are themselves active.

Inactive memberships are not automatically reactivated.

### Frontend

Platform administration lives under:

`/app/platform/organizations`

The platform area is authenticated but intentionally outside `OrganizationGate`.

This allows a `PLATFORM_ADMIN` account to administer organizations even when it has zero tenant memberships.

Tenant navigation remains based on `OWNER`, `ADMIN`, and `MEMBER`.

Platform navigation is kept separate from tenant role navigation.

**Header:** `X-Organization-Id` (UUID).

**Plugin:** `requireOrganizationContext` (`organization-context.ts`) sets:

```ts
request.organizationContext = {
  organizationId,
  membershipId,
  role, // OWNER | ADMIN | MEMBER
}
```

Resolution requires: valid JWT, active user membership, active organization (`organization.service.ts`).

**Rules (see also `apps/api/TENANCY.md`):**
- Never authorize using `organizationId` from body or query.
- Every tenant read/write must filter by `organizationId` from context (passed into services).
- Child resource IDs alone do not grant access; verify parent belongs to tenant and relationship (e.g. item belongs to inspection).
- Cross-tenant access to tenant-scoped resources: typically **404** (“not found”) to avoid enumeration.
- Invalid/missing org context for protected routes: **400** (missing/invalid header) or **403** (not a member).

**Roles:**
- **OWNER / ADMIN:** elevated actions where routes add `requireOrganizationRoles('OWNER', 'ADMIN')` (e.g. customer activate/deactivate, estimate status changes).
- **MEMBER:** create/read/update on many resources; restricted status transitions on work orders and forbidden estimate status changes.

**Platform role:**

- `PLATFORM_ADMIN` is global and separate from organization membership roles.
- It authorizes `/api/platform/*` administration only.
- It does not bypass tenant membership requirements.
---

## Customers

- **Model:** `Customer` with `type`, contact fields, `active`.
- **Endpoints:** `POST/GET /api/customers`, `GET/PATCH /api/customers/:id`, `POST .../activate`, `POST .../deactivate`.
- **Roles:** Create/list/get/update: any member with context. Activate/deactivate: OWNER/ADMIN only.
- **List:** search + pagination (schemas in `customer.schemas.ts`).
- **Delete:** No hard-delete API; lifecycle via `active` flag.
- **Isolation:** All queries scoped by `organizationId`.

---

## Assets

- **Types:** `AssetType` enum.
- **Customer:** Required, must be active in same organization (`asset.service.ts`).
- **Fields:** name, identifier, plate, vin, serial, make/model/year/color, notes, `active`.
- **Normalization:** `plate` and `vin` optional strings uppercased in Zod (`asset.schemas.ts`).
- **Endpoints:** `POST/GET /api/assets`, `GET/PATCH /api/assets/:id`, activate/deactivate (OWNER/ADMIN).
- **Search:** list supports search across name/plate/vin/etc.

---

## Work Orders

- **Numbering:** `Organization.nextWorkOrderNumber` incremented atomically in same transaction as create; assigned `number = next - 1`. `@@unique([organizationId, number])`.
- **Defaults:** create sets `status: OPEN` (not DRAFT).
- **Relations:** `customerId` required; `assetId` optional; `assignedToMembershipId` optional; `createdByMembershipId` required.
- **Endpoints:**
  - `POST /api/work-orders`
  - `GET /api/work-orders` (filters, search, pagination)
  - `GET /api/work-orders/:id`
  - `PATCH /api/work-orders/:id`
  - `POST /api/work-orders/:id/status`

**Status workflow** (`work-order.service.ts`):

| From | Allowed to |
|------|------------|
| DRAFT | OPEN, CANCELLED |
| OPEN | IN_PROGRESS, WAITING, COMPLETED, CANCELLED |
| IN_PROGRESS | WAITING, COMPLETED, CANCELLED |
| WAITING | IN_PROGRESS, COMPLETED, CANCELLED |
| COMPLETED, CANCELLED | (terminal) |

**MEMBER** may only use a subset of transitions (e.g. OPEN→IN_PROGRESS); OWNER/ADMIN broader.

**Timestamps:** `startedAt` on first IN_PROGRESS; `completedAt` on COMPLETED; `cancelledAt` on CANCELLED. Same-status update is idempotent.

**Closed orders:** COMPLETED/CANCELLED block PATCH and status changes (`WorkOrderClosedError`).

**PATCH customer/asset validation (verified):** When `customerId` or `assetId` changes, service recomputes `resultingCustomerId` / `resultingAssetId`, calls `requireActiveCustomer` on the resulting customer, then validates asset against **that** customer (`requireActiveAssetForCustomer`). Prevents assigning asset to wrong/inactive customer.

**Concurrency:** Number allocation in transaction; failed create after increment rolls back entire transaction (integration test pattern in `work-orders.integration.test.ts`).

---

## Inspections

- **Models:** `Inspection` on `WorkOrder`; `InspectionItem` children.
- **Status:** DRAFT (editable) → COMPLETED (terminal).
- **Item condition:** optional until complete; **complete** requires every item to have `condition` set (`InspectionHasIncompleteItemsError`).
- **Ordering:** `Inspection.nextItemOrder` atomic increment per new item (same pattern as estimates).
- **WorkOrder closed:** blocks mutations (`InspectionWorkOrderClosedError`).
- **Delete item with media:** `409` `Inspection item has media` (RESTRICT FK + service check).
- **Endpoints:**
  - `POST/GET /api/work-orders/:workOrderId/inspections`
  - `GET/PATCH /api/inspections/:id`
  - `POST /api/inspections/:id/items`
  - `PATCH/DELETE /api/inspections/:inspectionId/items/:itemId`
  - `POST /api/inspections/:id/complete`

---

## Media

- **PostgreSQL:** metadata only (`Media` model). No BLOB column.
- **Storage:** `MediaStorage` interface; `LocalMediaStorage` under `MEDIA_LOCAL_ROOT`. Only driver `local` allowed in `env.ts`.
- **Upload:** `@fastify/multipart`, size limit during receive (`MEDIA_MAX_FILE_SIZE_BYTES`, default 10 MiB). Temp file → magic bytes (`file-type`) → allowed: JPEG, PNG, WEBP only → SHA-256 → server-generated `storageKey` → DB row.
- **Download:** `GET /api/media/:id/content` after auth + tenant; streams file; `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`. No public static path.
- **Public JSON:** no `storageKey`, no `sha256` in public shape (service selects omit or strip).
- **Parents:** WorkOrder, Inspection, or InspectionItem (nested upload routes). Lifecycle: mutable parent rules (closed WO, completed inspection, etc.).
- **Delete:** DB row first, filesystem delete best-effort; orphan files possible if FS delete fails.
- **Env (names only):** `MEDIA_STORAGE_DRIVER`, `MEDIA_LOCAL_ROOT`, `MEDIA_MAX_FILE_SIZE_BYTES`.

**Endpoints (summary):** upload/list on WO, inspection, item; `GET/PATCH/DELETE /api/media/:id`; `GET /api/media/:id/content`.

---

## Estimates (FASE 9 — detailed)

### Model

- **Estimate:** belongs to `organizationId` + `workOrderId`; `number` per org; `currency` (3-letter, validated in Zod); optional notes/terms/validUntil; aggregate `subtotal`, `discountTotal`, `taxTotal`, `total` as `Decimal(14,2)`; status workflow; timestamps `sentAt`, `approvedAt`, `rejectedAt`, `cancelledAt`; `nextItemOrder`.
- **EstimateItem:** `type`, `description`, inputs `quantity` (12,3), `unitPrice` (14,2), percents (5,2); **stored** line amounts: subtotal, discountAmount, taxableAmount, taxAmount, total; `sortOrder`.

### Numbering

- `Organization.nextEstimateNumber` increment in transaction; `estimate.number = next - 1`. Unique `[organizationId, number]`. Rollback on failure restores counter (tested).

### Money (`estimate.money.ts` + `decimal.js`)

- API inputs: decimal **strings** (strict regex in Zod + money module).
- API outputs: strings with fixed scale (`quantity` 3 dp, money/percents 2 dp).
- Rounding: `ROUND_HALF_UP` for monetary fields.
- **Line formulas:**
  - `subtotal = quantity × unitPrice`
  - `discountAmount = subtotal × discountPercent / 100`
  - `taxableAmount = subtotal − discountAmount`
  - `taxAmount = taxableAmount × taxPercent / 100`
  - `total = taxableAmount + taxAmount`
- **Estimate aggregates:** sum of line subtotal, discountAmount, taxAmount, total respectively.
- Never use JavaScript `number` for money math in services.

### Endpoints

| Method | Path |
|--------|------|
| POST | `/api/work-orders/:workOrderId/estimates` |
| GET | `/api/work-orders/:workOrderId/estimates` |
| GET | `/api/estimates/:id` |
| PATCH | `/api/estimates/:id` |
| POST | `/api/estimates/:id/items` |
| PATCH | `/api/estimates/:estimateId/items/:itemId` |
| DELETE | `/api/estimates/:estimateId/items/:itemId` |
| POST | `/api/estimates/:id/status` |

### Workflow

| Status | Transitions |
|--------|-------------|
| DRAFT | SENT, CANCELLED |
| SENT | APPROVED, REJECTED, CANCELLED |
| APPROVED, REJECTED, CANCELLED | terminal |

- **DRAFT → SENT:** requires ≥1 item; total ≥ 0; work order open; sets `sentAt`.
- **Locking:** Only **DRAFT** estimates accept PATCH and item CRUD. After SENT, estimate and items are locked (`Estimate is locked`).
- **Status changes:** `POST .../status` — **OWNER/ADMIN only** (`estimate.routes.ts`). MEMBER → 403.
- **Work order closed:** blocks create, PATCH, items, and status (existing estimates still readable).
- **Items:** `nextItemOrder` atomic; recalculate totals in same transaction after item changes; row lock via `nextItemOrder` no-op update on estimate.
- **Cross-tenant / wrong item:** 404 `Estimate not found` / `Estimate item not found`.

### Public approval (FASE 10A)

- **Capability token:** `<UUID>.<32-byte base64url secret>`; `Authorization: Estimate <token>`; HMAC-SHA256 of secret with `PUBLIC_ESTIMATE_TOKEN_PEPPER`; locator = row `id`; never store raw secret or full token.
- **Issuance (OWNER/ADMIN):** `POST /api/estimates/:id/public-access` for `SENT` estimates on open work orders; revokes **all** prior rows with `revokedAt IS NULL` (including expired credentials) before insert; returns `{ publicUrl: "<PUBLIC_ESTIMATE_BASE_URL>#token=...", expiresAt }` with `Cache-Control: no-store`.
- **Revocation:** `DELETE /api/estimates/:id/public-access` (idempotent `204`, reason `manual`).
- **Public view:** `GET /api/public/estimates/view` — allowlisted JSON only; ignores `X-Organization-Id`; invalid capability → uniform `404`; authenticated expired capability → `410`.
- **Public decision:** `POST /api/public/estimates/decision` — atomic `SENT` → `APPROVED`/`REJECTED` with token audit; idempotent same-decision retry; opposite/concurrent conflicts → `409`.
- **Rate limits (per `request.ip`, process-local):** view 60/min, decision 10/min (env-configurable).

---

## Public response security

- Explicit Prisma `select` objects per module for API shapes.
- Do not expose: `passwordHash`, `RefreshToken`, `tokenHash`, `storageKey`, absolute filesystem paths, internal counters (`nextWorkOrderNumber`, `nextEstimateNumber`, `nextItemOrder`), unnecessary `organizationId` on public DTOs.
- Log redaction for auth secrets (`app.ts`).

---

## Testing

- **Runner:** Vitest (`apps/api/vitest.config.ts`).
- **Setup:** `tests/setup.ts` forces `NODE_ENV=test`, sets `DATABASE_URL` from `TEST_DATABASE_URL`, random auth secrets, isolated `MEDIA_LOCAL_ROOT` under OS temp (`evolqity-ops-media-test/<pid>`).
- **Parallelism:** `fileParallelism: false` (serial test files).
- **Default timeout:** 20s per test (some integration suites use higher per-test timeout).
- **Test files:** 14 `*.test.ts` files + `setup.ts` under `apps/api/tests/` (includes `public-estimate.tokens`, `public-estimates.integration`).
- **DB guard:** Integration suites parse `DATABASE_URL` and refuse to run unless DB name ends with `_test`.
- **Media tests:** additionally verify storage root stays under controlled test base path.
- **Cleanup:** `beforeEach` deletes tenant data in dependency order across integration tests.
- **Total test count:** **Not verified** in this checkpoint (suite not executed). Counting `it(` occurrences in source underestimates `it.each` expansions.

---

## Database environments

From `apps/api/.env.example` (placeholders only):

| Environment | Database name | Host:port |
|-------------|---------------|-----------|
| DEV | `evolqity_ops_dev` | `127.0.0.1:5433` |
| TEST | `evolqity_ops_test` | `127.0.0.1:5433` |

`TEST_DATABASE_URL` is required for tests (`setup.ts`) but is **not** part of `env.ts` schema for the running API.

**Production database:** `evolqity_ops_prod` on the VPS PostgreSQL instance. It uses a dedicated non-superuser application role and remains separate from DEV and TEST. Production migrations are applied only with `prisma migrate deploy`.
---

## Environment variables (`apps/api/.env.example` + `env.ts`)

| Group | Variables |
|-------|-----------|
| Core | `PORT`, `HOST`, `NODE_ENV` |
| Database | `DATABASE_URL` |
| Auth | `AUTH_ACCESS_TOKEN_SECRET`, `AUTH_ACCESS_TOKEN_TTL_SECONDS`, `AUTH_REFRESH_TOKEN_PEPPER`, `AUTH_SESSION_TTL_DAYS`, `AUTH_JWT_ISSUER`, `AUTH_JWT_AUDIENCE`, `AUTH_REFRESH_COOKIE_NAME`, `AUTH_COOKIE_SECURE`, `AUTH_COOKIE_SAME_SITE`, `AUTH_LOGIN_RATE_LIMIT_MAX`, `AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS` |
| Public estimates | `PUBLIC_ESTIMATE_BASE_URL`, `PUBLIC_ESTIMATE_TOKEN_PEPPER`, `PUBLIC_ESTIMATE_TOKEN_TTL_DAYS`, `PUBLIC_ESTIMATE_VIEW_RATE_LIMIT_*`, `PUBLIC_ESTIMATE_DECISION_RATE_LIMIT_*` |
| CORS / proxy | `CORS_ORIGINS`, `TRUST_PROXY` |
| Media | `MEDIA_STORAGE_DRIVER` (only `local`), `MEDIA_LOCAL_ROOT`, `MEDIA_MAX_FILE_SIZE_BYTES` |
| Testing (example file) | `TEST_DATABASE_URL` (used by Vitest setup, not validated in `env.ts`) |

Do not commit real secrets. Default cookie name in code default differs slightly from example (`evolqity_refresh` vs `evolqity_rt` in example) — prefer `.env` alignment locally.

---

## Known warnings / technical debt

| Item | Type |
|------|------|
| `pg@8` deprecation when concurrent queries on same client | Known warning in tests/runtime |
| npm `devdir` warning | Environment/tooling; observed in some npm runs |
| npm audit transitive issues via Prisma deps | Technical debt; do not `npm audit fix --force` without plan |
| Prisma 8.x available | Major upgrade pending |
| Tenant isolation in app layer only | No PostgreSQL RLS yet |
| Media single-parent invariant | Service-enforced; no DB CHECK |
| Estimate totals consistency | Service + transactions; no DB triggers |
| Media / delete: DB vs filesystem | No distributed transaction; orphan files possible |
| S3-compatible media storage | Not implemented (local only) |

No open **bugs** verified in this checkpoint pass.

---

## Git state

Git status is intentionally not recorded here because it becomes stale during
active implementation. Inspect the current branch, tracking status, untracked
migration files, and working tree before building a release.

---

## Current Deployment Phase

**FASE 12B — Production Deployment**

Target:

`https://portal.evolqity.com`

Current infrastructure progress:

- DNS `portal.evolqity.com` points to the VPS
- dedicated Linux service user `evolqityops` created
- persistent media directory prepared under `/var/lib/evolqity-ops/media`
- production configuration directory prepared under `/etc/evolqity-ops`
- dedicated `evolqity_ops_prod` PostgreSQL database created
- dedicated non-superuser production database role created
- Node.js 24.21.0 / npm 11.19.0 installed under `/opt/node` without replacing the server's existing Node.js 20 runtime

Remaining deployment work:

1. Commit and push the reviewed MVP source.
2. Deploy the reviewed Git revision to `/var/www/evolqity-ops`.
3. Install dependencies and generate Prisma client.
4. Build API and web.
5. Apply production migrations with `prisma migrate deploy`.
6. Complete `/etc/evolqity-ops/api.env`.
7. Configure/start the API through systemd.
8. Configure Nginx for `portal.evolqity.com`.
9. Provision TLS.
10. Execute production smoke tests.
11. Configure and test database/media backups and restore procedures.
---

## Non-Negotiable Architectural Rules

1. Never trust `organizationId` from body/query.
2. Tenant data queries must use `organizationContext` / explicit `organizationId` in services.
3. Related UUIDs do not grant authorization.
4. Routes: HTTP + Zod; services: Prisma + business rules.
5. No Prisma in routes for domain logic.
6. No plaintext passwords or refresh tokens in logs/responses.
7. No JS floating-point for money.
8. No binary media in PostgreSQL.
9. Storage paths / `storageKey` are never public.
10. DEV/TEST migrations separated; production uses `migrate deploy`.
11. Never `migrate reset` / `db push` on shared environments without explicit approval.
12. Tests must not run against DEV/PROD databases (`*_test` guard).

---

## Instructions for the Next Agent

Before implementing anything:

1. Read this file.
2. Read `apps/api/TENANCY.md`.
3. Inspect the relevant module under `apps/api/src/modules/<feature>/`.
4. Read `apps/api/prisma/schema.prisma`.
5. Read the latest migration SQL under `apps/api/prisma/migrations/`.
6. Preserve and extend existing tests; do not weaken tenant or money rules.
7. Create migrations with `--create-only`, review full SQL, then apply to DEV and deploy to TEST.
8. Never make destructive Prisma changes without explicit human approval.
9. After changes: `npm run typecheck`, `npm run build`, relevant tests serially
   with `--maxWorkers=1`, `npx prisma validate`, and `migrate status` (DEV +
   TEST). Do not run integration files concurrently against the shared TEST
   database.
10. If this document conflicts with code, **the repository code wins** — update this doc after intentional changes.

---

## Information not verified in this checkpoint

- Current `prisma migrate status` on DEV/TEST machines.
- Total passing test count (full `npm test` not run for this document).
- Actual provisioned staging/production topology or production `DATABASE_URL`.
