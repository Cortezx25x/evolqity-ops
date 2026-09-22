# Evolqity Ops deployment and pilot-readiness runbook

This document prepares staging and a controlled 1–3 workshop pilot. It does
not authorize deployment, DNS, firewall, database, or live service changes.

## Readiness decision

The application architecture is suitable for one VPS and one API process, but
the repository is not deployable by copying only `dist` directories. A release
must include both package lockfiles, generated Prisma client output, the API
build, the web build, all nine reviewed migrations, and the external
configuration described below.

Before staging:

- Commit and review the currently untracked
  `20260920160403_add_public_estimate_approval` migration with the related code.
- Provision HTTPS, private PostgreSQL connectivity, a persistent media
  directory, a non-root API account, and production environment secrets.
- Use Node 24.7 or newer within major 24 and npm 11.
- Run `prisma generate` before the API build and `prisma migrate deploy` only
  after a database backup and migration review.
- Install the Nginx and systemd examples only after adapting and validating
  them on the target host.

Before real pilot data:

- Confirm automated PostgreSQL and media backups, an off-server copy, alerting
  on backup failure, and a successful restore drill.
- Keep public registration blocked after controlled owner creation.
- Confirm disk monitoring, HTTP monitoring, API readiness, log review, and
  upload/download smoke tests.
- Document the manual password-support process and authorized operators.
- Run each integration suite serially or with `--maxWorkers=1` until the shared
  TEST-database cleanup problem is fixed.

## Production topology

`https://portal.evolqity.com` terminates TLS at Nginx. Nginx serves
`apps/web/dist` and proxies `/api/` to Fastify on `127.0.0.1:3001`.
PostgreSQL listens only on localhost or a private network. The API stores media
under `/var/lib/evolqity-ops/media`; Nginx must never expose that directory.

The frontend already uses relative `/api/...` URLs, so this is a same-origin
deployment and needs no frontend runtime environment variables.

Recommended layout:

```text
/var/www/evolqity-ops/
  source/                 # deployment checkout, not served
  releases/
    <timestamp>-<commit>/
      apps/api/
      apps/web/
  current -> releases/<timestamp>-<commit>
/var/lib/evolqity-ops/
  media/                  # persistent, never inside a release
/etc/evolqity-ops/
  api.env                 # mode 0640 or stricter; never committed
```

Keeping immutable releases makes a failed build harmless and permits code
rollback. Database migrations still require forward-compatible planning; do
not attempt an automatic down migration.

## Build and runtime

There is no root `package.json` and no workspace-level install/build command.
Run package commands from each application directory.

API:

```sh
cd apps/api
npm ci
npx prisma generate
npm run typecheck
npm run build
node dist/server.js
```

- Production build: `npm run build` (`tsc`).
- Compiled entrypoint/start: `dist/server.js` / `npm start`.
- The generated Prisma client is emitted to `src/generated/prisma`, imported by
  source code, and compiled into `dist/generated/prisma`. A fresh checkout must
  run `npx prisma generate` before typecheck/build.
- Node 24.7+ is required because password hashing uses `node:crypto` Argon2.
- `SIGTERM` and `SIGINT` call `app.close()`, then disconnect Prisma. systemd
  should allow 30 seconds before forced termination.
- Liveness: `GET /api/health`.
- Readiness: `GET /api/ready`; it executes `SELECT 1` and returns 503 when the
  database is unavailable.

Web:

```sh
cd apps/web
npm ci
npm run typecheck
npm run build
```

- Production build: `npm run build` (`tsc -b && vite build`).
- Output: `apps/web/dist`.
- React uses `BrowserRouter`. Nginx must use `try_files ... /index.html` for
  `/login`, `/estimate`, `/app/dashboard`, `/app/work-orders/:id`, and every
  other client route.
- Public estimate credentials are in the URL fragment
  `/estimate#token=...`; fragments are not sent to Nginx. The page reads and
  removes the token from the address bar before calling the API.

## Node and npm version

Both package manifests constrain Node to `>=24.7 <25` and npm to `>=11 <12`.
This is the smallest cross-platform repository check: no `.nvmrc` or
`.node-version` is also required. Install an approved Node 24 release on the
VPS and verify `node --version` and `npm --version` before every release.

## Environment variables

The API is the only application with runtime environment variables.
`deployment/env/evolqity-ops-api.env.example` is the production template.
Values with code defaults should still be explicit in production so a release
is auditable.

Required by the runtime schema:

- `DATABASE_URL`
- `AUTH_ACCESS_TOKEN_SECRET`
- `AUTH_REFRESH_TOKEN_PEPPER`
- `PUBLIC_ESTIMATE_BASE_URL`
- `PUBLIC_ESTIMATE_TOKEN_PEPPER`
- `MEDIA_LOCAL_ROOT`

Production-required settings:

- `NODE_ENV=production`
- `HOST=127.0.0.1`
- `PORT=3001` (or the matching private upstream port)
- `AUTH_COOKIE_SECURE=true`
- `AUTH_REFRESH_COOKIE_NAME=__Secure-evolqity_rt`
- `AUTH_COOKIE_SAME_SITE=lax`
- `CORS_ORIGINS=https://portal.evolqity.com`
- `TRUST_PROXY=true` when the API is reachable only through local Nginx
- `PUBLIC_ESTIMATE_BASE_URL=https://portal.evolqity.com/estimate`
- `MEDIA_STORAGE_DRIVER=local`
- an absolute `MEDIA_LOCAL_ROOT`, outside releases

Optional settings with defaults:

- `PORT=3001`
- `HOST=127.0.0.1`
- `NODE_ENV=development`
- `AUTH_ACCESS_TOKEN_TTL_SECONDS=900`
- `AUTH_SESSION_TTL_DAYS=30`
- `AUTH_JWT_ISSUER=evolqity-ops-api`
- `AUTH_JWT_AUDIENCE=evolqity-ops`
- `AUTH_REFRESH_COOKIE_NAME=evolqity_refresh`
- `AUTH_COOKIE_SECURE=false` (invalid for production)
- `AUTH_COOKIE_SAME_SITE=lax`
- `CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173`
- `TRUST_PROXY=false`
- `AUTH_LOGIN_RATE_LIMIT_MAX=5`
- `AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS=60`
- `PUBLIC_ESTIMATE_TOKEN_TTL_DAYS=30`
- `PUBLIC_ESTIMATE_VIEW_RATE_LIMIT_MAX=60`
- `PUBLIC_ESTIMATE_VIEW_RATE_LIMIT_WINDOW_SECONDS=60`
- `PUBLIC_ESTIMATE_DECISION_RATE_LIMIT_MAX=10`
- `PUBLIC_ESTIMATE_DECISION_RATE_LIMIT_WINDOW_SECONDS=60`
- `MEDIA_STORAGE_DRIVER=local`
- `MEDIA_MAX_FILE_SIZE_BYTES=10485760`

Development/test only:

- `TEST_DATABASE_URL` is consumed by Vitest setup, not by the running API.
- Localhost CORS origins, insecure cookies, and relative media roots are only
  appropriate outside production.

There are no production-only variable names, but the production values above
are mandatory. Do not put `TEST_DATABASE_URL` in the service environment.

## Secrets

Generate the three secrets independently, for example with
`openssl rand -base64 48`. They must be distinct and stored only in the
root-owned production environment file. Never copy example values, passwords,
or database credentials into Git, logs, tickets, or shell history.

Production startup rejects secrets shorter than 48 characters, obvious
placeholder/password values, low-diversity values, duplicate secrets, insecure
cookies, non-HTTPS public estimate/CORS URLs, and relative media roots.

Secret rotation is operationally disruptive:

- Rotating the access-token secret invalidates current access tokens.
- Rotating the refresh-token pepper invalidates refresh credentials.
- Rotating the public-estimate pepper invalidates all issued public links.

Plan rotation and user communication; do not rotate casually during a pilot.

## PostgreSQL and Prisma

DEV, TEST, staging, and production must use separate databases and credentials.
The production application role must not have `CREATEDB`, superuser, or public
network access. For the pilot it may own its application schema so the
controlled deployment step can run migrations; a separate migration owner is
preferable when operational support is ready for that split.

There are nine ordered migrations. The latest creates
`EstimatePublicToken`, composite tenant-safe foreign keys, and the custom
partial unique index:

```sql
CREATE UNIQUE INDEX "EstimatePublicToken_estimateId_one_active_key"
ON "EstimatePublicToken"("estimateId") WHERE "revokedAt" IS NULL;
```

That index is not expressible in the Prisma schema and must be preserved.
The checked schema and migration sequence are internally consistent. Keep
`prisma/migrations/migration_lock.toml` and every migration in source control.

The `.migration-manual-backup/20260920145300_add_public_estimate_approval`
folder is not part of the canonical migration chain. Before staging, confirm
that no database recorded that backup migration name. If one did, reconcile
its `_prisma_migrations` history with the canonical
`20260920160403_add_public_estimate_approval` migration under DBA review; do
not simply apply both.

Release rules:

- Use `npx prisma migrate deploy`.
- Never use `prisma db push`, `prisma migrate dev`, or `migrate reset` in
  production.
- Run `npx prisma generate` during every fresh release build.
- Inspect `npx prisma migrate status` with the production credential before
  and after deployment.
- Back up first. If migration review or backup verification fails, stop.

## Media persistence

Local filesystem storage is acceptable for 1–3 workshops on one API process
and one VPS. `/var/lib/evolqity-ops/media` must:

- be an absolute path owned and writable by the non-root API account;
- live outside `current`, `releases`, and Git checkouts;
- survive deployment and code rollback;
- be backed up automatically and copied off-server;
- be included in restore drills and disk-capacity alerts.

Only authenticated, tenant-authorized API routes serve media. Never add an
Nginx `alias` for the media root.

Move to S3-compatible object storage when running multiple API hosts, when VPS
disk growth or recovery time becomes material, when cross-region durability is
required, or before uptime expectations exceed what one disk/VPS can provide.

## Nginx, cookies, proxy trust, and CORS

Start from `deployment/nginx/portal.evolqity.com.conf.example`. It provides:

- HTTP-to-HTTPS redirect and TLS placeholders;
- Vite static serving with SPA fallback;
- `/api/` proxying to loopback Fastify;
- `Host`, `X-Real-IP`, `X-Forwarded-For`, and `X-Forwarded-Proto`;
- a 12 MiB body limit for a 10 MiB configured media file plus multipart
  overhead;
- no-store API caching policy and baseline security headers;
- no direct media filesystem exposure;
- public registration blocked by default.

Set `TRUST_PROXY=true` only because Fastify binds to loopback and Nginx is the
only ingress. This makes `request.ip`, HTTPS awareness, and IP-based rate
limits use forwarded data. Do not expose port 3001 publicly while trusting
forwarded headers.

The refresh cookie is `HttpOnly`, `Secure` in production, `SameSite=Lax`,
scoped to `/api/auth`, and expires with the auth session. This is correct for
same-origin use. `SameSite=None` is unnecessary and should not be enabled.

Keep `CORS_ORIGINS` to the exact HTTPS origin. Never use `*` with credentials.
Same-origin requests do not need broad CORS permissions, but the current API
origin guard still requires the exact origin when an `Origin` header exists.

Fastify Helmet protects API responses. Nginx protects static responses. Enable
HSTS only after HTTPS and certificate renewal are verified. `nosniff`, a
strict referrer policy, and frame denial are suitable now. Do not add a strict
CSP until all authenticated and public React pages have been tested against
it.

## systemd and logs

One systemd-managed Node process is sufficient for this pilot. Start from
`deployment/systemd/evolqity-ops-api.service.example`.

- Run as the dedicated non-root `evolqity-ops` account.
- Keep the service working directory at `current/apps/api`.
- Load secrets from `/etc/evolqity-ops/api.env`.
- Restart only on failure and send `SIGTERM` for graceful shutdown.
- Read logs with `journalctl -u evolqity-ops-api`.

Fastify emits structured request/application logs. Authorization and Cookie
headers plus common password/token body fields are redacted. Fastify does not
normally log response bodies, but operators must still avoid adding ad-hoc
logs containing credentials or public capability links.

Minimum pilot monitoring:

- external HTTPS checks for `/` and `/api/health`;
- internal readiness check for `/api/ready`;
- systemd failed/restart alerts;
- PostgreSQL availability and backup-success alerts;
- filesystem/inode alerts for `/var/lib/evolqity-ops` and backup storage;
- certificate-expiry monitoring.

## Conservative release checklist

Run these steps manually for a reviewed commit. Replace shell variables and
paths deliberately; do not paste this section into an unattended production
script yet.

1. Confirm the release commit, clean source checkout, Node/npm versions, change
   approval, maintenance window, and operator access.
2. Confirm the latest automated PostgreSQL and media backups succeeded and
   that an off-server copy exists.
3. Fetch without changing the active release:

   ```sh
   cd /var/www/evolqity-ops/source
   git fetch --prune origin
   git checkout --detach <reviewed-commit-sha>
   git status --short
   ```

4. Create an immutable candidate:

   ```sh
   RELEASE=/var/www/evolqity-ops/releases/<timestamp>-<short-commit>
   mkdir -p "$RELEASE"
   git archive HEAD | tar -x -C "$RELEASE"
   ```

5. Build and validate the candidate without changing `current`:

   ```sh
   cd "$RELEASE/apps/api"
   npm ci
   npx prisma generate
   npm run typecheck
   npm run build
   npx prisma validate

   cd "$RELEASE/apps/web"
   npm ci
   npm run typecheck
   npm run build
   ```

6. Load the protected production database URL into the deployment shell
   without printing it. Check migration status, review pending SQL again, then
   deploy migrations:

   ```sh
   cd "$RELEASE/apps/api"
   npx prisma migrate status
   npx prisma migrate deploy
   npx prisma migrate status
   ```

7. Atomically switch `current` only after all prior commands succeed:

   ```sh
   cd /var/www/evolqity-ops
   ln -s "$RELEASE" current.next
   mv -Tf current.next current
   ```

8. Restart and verify:

   ```sh
   sudo systemctl restart evolqity-ops-api
   sudo systemctl --no-pager --full status evolqity-ops-api
   curl --fail http://127.0.0.1:3001/api/health
   curl --fail http://127.0.0.1:3001/api/ready
   curl --fail https://portal.evolqity.com/
   ```

9. In a browser, verify direct refresh of `/login`, `/app/dashboard`,
   `/app/work-orders/<known-id>`, and `/estimate`; login/refresh/logout;
   tenant selection; one upload and authorized download; public estimate view
   and a controlled approval/rejection test.
10. Review service and Nginx logs without exposing credentials. Confirm the
    media file landed under the persistent root.
11. If application verification fails, point `current` back to the previous
    release and restart. Do not reverse database migrations automatically.
    Escalate if the new migration is not backward compatible.
12. Retain the previous known-good release. Remove old releases only after
    backups and rollback windows are satisfied; never delete the media root.

## Backups and restore

PostgreSQL:

- Take an automated daily custom-format `pg_dump`.
- Retain at least 14 daily and 8 weekly copies for the pilot.
- Encrypt and copy backups off the VPS.
- Alert on command failure, missing/empty output, and stale latest backup.
- Restore into an isolated database at least monthly and before onboarding the
  first real workshop; verify migrations, row counts, login, and core records.

Media:

- Back up `/var/lib/evolqity-ops/media` daily after the database snapshot.
- Retain at least the same 14 daily and 8 weekly restore points and keep an
  encrypted off-server copy.
- For a guaranteed consistent restore point, briefly stop API writes during
  the DB dump and media snapshot, or use coordinated filesystem snapshots.
- Restore into an isolated directory, verify checksums/sample downloads, then
  test against the restored database.

A backup is not accepted as working until a documented restore succeeds.

## Rate limiting

Login/register/refresh limits and public estimate view/decision limits are
provided by `@fastify/rate-limit`. Storage is process-local and keys are based
on Fastify's client IP. This is acceptable for one API process behind the
trusted local proxy. Limits reset on restart and are neither shared nor
globally enforceable across multiple processes/hosts. Reassess a shared store
before horizontal scaling; Redis is not required solely for this pilot.

## Pilot onboarding and password support

`POST /api/auth/register` atomically creates the first user, organization, OWNER
membership, and session. The web application has no registration page. For
each approved workshop, an operator may make one controlled registration
request over a loopback/SSH-tunneled connection while the Nginx public route
remains blocked. Do not put the initial password in shell history or tickets.
Afterward, the owner provisions ADMIN/MEMBER users in the Team UI.

There is no forgot-password, reset-password, email invitation, or forced
initial-password-change flow. This does not block a tightly managed pilot if:

- each account receives a strong unique initial password through an approved
  secure channel; there is currently no self-service way to change it;
- support verifies identity out of band;
- an authorized operator performs a documented, audited database-level hash
  replacement or reprovisions a not-yet-used account;
- compromised accounts/memberships are deactivated promptly.

Direct database password repair is operational debt and must use the same
Argon2 format as the application; never store plaintext. A supported password
reset/change flow becomes a priority after the controlled pilot, not a blocker
to staging.

## Known pre-production debt

- Integration files share one destructive TEST database and can interfere
  under concurrency. Run relevant files independently with `--maxWorkers=1`.
- `pg@8` emits a concurrent-query deprecation warning.
- Public estimate rate limiting is process-local.
- Media storage is local and deletion can leave orphan files after a
  filesystem failure.
- Tenant isolation is application-level; PostgreSQL RLS is not implemented.
- There is no password reset, email invitation, PDF, email, or WhatsApp flow.

The feature omissions above are not staging blockers by themselves.
