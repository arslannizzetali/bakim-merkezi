# Deployment

This guide covers running BakımEvi in production with the multi-tenant setup in `deploy/` and `scripts/`.

## Topology

```text
                     ┌────────────── server ──────────────────────────────┐
 internet ──443──▶   │ Caddy (TLS) ──▶ <slug>-web  (Next.js, :3000)        │
                     │            └──▶ <slug>-api  (Express, :3001)        │
                     │                    │                                │
                     │      ┌─────────────┼──────────────┐                 │
                     │  PostgreSQL     Redis          MinIO                │
                     │  (db + role     (DB index      (bucket + user       │
                     │   per tenant)    per tenant)    per tenant)         │
                     └────────────────────────────────────────────────────┘
```

- Only Caddy publishes ports (80/443). PostgreSQL, Redis, MinIO and the app containers are reachable only on the internal `bakimevi-net` Docker network.
- Each facility (tenant) has its own database and role, Redis DB index, MinIO bucket with a bucket-scoped user, secrets file and containers. The shared Redis supports at most 15 tenants.

## Requirements

- Linux server with Docker Engine and the Compose plugin
- A DNS name per tenant pointing to the server (Caddy obtains Let's Encrypt certificates automatically)
- Ports 80 and 443 open; **everything else closed** at the firewall
- Enough disk for PostgreSQL and MinIO data plus backups

## First-time platform setup

```bash
cp deploy/.env.platform.example deploy/.env.platform   # fill with `openssl rand -hex 32` values
chmod 600 deploy/.env.platform

# Set a real e-mail for Let's Encrypt notices in deploy/caddy/Caddyfile

docker build -f apps/api/Dockerfile -t bakimevi-api:latest .
docker build -f apps/web/Dockerfile -t bakimevi-web:latest .

docker compose -f deploy/docker-compose.base.yml --env-file deploy/.env.platform up -d
```

## Creating a tenant

```bash
scripts/tenant-create.sh <slug> "<Facility name>" <https-domain> [admin-email]
```

The script generates all secrets, creates the database, Redis index and bucket, writes `deploy/tenants/<slug>/.env` (mode 600), runs `prisma migrate deploy`, creates the facility's first admin with a random password (printed once — store it in a password manager and have the admin change it on first login), adds the Caddy site and starts the containers.

Lifecycle:

| Script | Effect |
| --- | --- |
| `tenant-suspend.sh <slug>` | Stops the containers; data and secrets untouched (reversible) |
| `tenant-resume.sh <slug>` | Starts them again |
| `tenant-remove.sh <slug>` | Removes containers, keeps data |
| `tenant-remove.sh <slug> --purge` | **Permanently** deletes database, bucket, Caddy site and secrets |

Never run `pnpm db:seed` against production. It refuses to run with `NODE_ENV=production`.

## Environment variables

Generated per tenant by `tenant-create.sh`. In production the API refuses to start if a required value is missing, malformed, or if MinIO still uses the default `minioadmin` credentials.

| Variable | Required | Purpose |
| --- | :-: | --- |
| `NODE_ENV` | ✅ | `production` |
| `DATABASE_URL` | ✅ | PostgreSQL connection string for the tenant role |
| `REDIS_URL` | ✅ | Redis URL including password and DB index |
| `JWT_SECRET` | ✅ | 64 hex chars; signs access tokens |
| `JWT_REFRESH_SECRET` | ✅ | 64 hex chars; signs refresh tokens. Must differ from `JWT_SECRET` |
| `MASTER_ENCRYPTION_KEY` | ✅ | 64 hex chars; wraps file keys and encrypts TC numbers. **Losing it makes all documents unreadable — back it up separately from the data** |
| `MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_USE_SSL` | ✅ | Object storage location |
| `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` | ✅ | Bucket-scoped credentials (not the MinIO root user) |
| `MINIO_BUCKET` | ✅ | Tenant bucket |
| `FRONTEND_URL`, `API_URL`, `ALLOWED_ORIGINS` | ✅ | Public HTTPS origin; CORS and CSP use these |
| `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` | | Token lifetimes (defaults `15m`, `8h`) |
| `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_MAX` | | Rate limiting and login lockout threshold |
| `API_PORT` | | Defaults to `3001` |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `NOTIFY_EMAIL` | | Optional e-mail notification for demo requests |

## Database migrations

Schema changes are versioned in `apps/api/prisma/migrations` and applied with Prisma Migrate. `prisma db push` must not be used against a production database.

- Development: `pnpm db:migrate` (`prisma migrate dev`) creates and applies migrations.
- Production: `prisma migrate deploy` applies pending migrations. `tenant-create.sh` runs it automatically for new tenants. For upgrades:

  ```bash
  docker build -f apps/api/Dockerfile -t bakimevi-api:latest .
  docker run --rm --network bakimevi-net --env-file deploy/tenants/<slug>/.env \
    --entrypoint npx bakimevi-api:latest prisma migrate deploy
  TENANT_SLUG=<slug> docker compose -f deploy/docker-compose.tenant.yml \
    --env-file deploy/tenants/<slug>/.env -p <slug> up -d
  ```

CI checks that the migrations produce exactly the schema in `schema.prisma`.

### Baselining a database created with `db push`

If a database was ever created with `prisma db push` (no `_prisma_migrations` table), mark the existing migrations as applied instead of re-running them:

1. Back up the database (see below).
2. Confirm the live schema matches the migrations:

   ```bash
   npx prisma migrate diff --from-url "$DATABASE_URL" --to-migrations prisma/migrations --shadow-database-url "$SHADOW_DATABASE_URL" --exit-code
   ```

   Exit code 0 means no difference. If there is a difference, stop and resolve it first.
3. Mark each migration as applied, oldest first:

   ```bash
   npx prisma migrate resolve --applied 20260515143000_init
   npx prisma migrate resolve --applied 20260806000000_add_demo_requests
   ```

4. From now on, use `prisma migrate deploy` only.

## HTTPS and reverse proxy

Caddy terminates TLS and renews certificates automatically. Each tenant's site block routes `/api/*` to the API container and everything else to the web container. The API sets HSTS, CSP and other security headers via Helmet and trusts exactly one proxy hop (`trust proxy = 1`), so client IPs used for rate limiting and audit logs come from Caddy's `X-Forwarded-For`. Do not put another proxy in front without adjusting that setting.

## Backups and restore

Back up **three** things per tenant: the PostgreSQL database, the MinIO bucket, and the tenant `.env` (for `MASTER_ENCRYPTION_KEY`). Without the key, the encrypted files and TC numbers in the backup cannot be decrypted. Store the key in a different location from the data backups.

Suggested schedule: nightly database dump and bucket mirror, kept for at least 30 days, copied off the server, encrypted at rest.

### PostgreSQL

```bash
# Backup
docker exec bakimevi-platform-postgres pg_dump -U <slug>_user -Fc <slug>_db > <slug>-$(date +%F).dump

# Restore (into an empty database)
docker exec -i bakimevi-platform-postgres pg_restore -U <slug>_user -d <slug>_db --clean --if-exists < <slug>-YYYY-MM-DD.dump
```

### MinIO

```bash
docker run --rm --network bakimevi-net -v "$PWD/backup:/backup" --entrypoint sh minio/mc -c "
  mc alias set platform http://bakimevi-platform-minio:9000 \$ROOT_USER \$ROOT_PASSWORD &&
  mc mirror --overwrite platform/<slug>-documents /backup/<slug>-documents"
```

Restore by mirroring in the other direction. Files in the bucket are already encrypted.

**Test a restore** into a separate tenant at least once before go-live and after major changes.

## Logs and monitoring

- The API logs to stdout/stderr; read with `docker logs <slug>-api`. Configure Docker log rotation (`/etc/docker/daemon.json`, `"log-opts": {"max-size": "10m", "max-file": "5"}`).
- The API currently logs only startup errors and retention job outcomes; it does not log requests or request bodies. Keep it that way for any logging you add: no patient data in logs. User activity is recorded in the audit log table instead.
- Alert on: `/health` returning 503, `[retention] ... giving up` log lines, repeated `TOKEN_REUSE_DETECTED` or `USER_LOGIN_FAILED` audit entries, and disk usage.
- `GET /health` checks PostgreSQL, Redis and MinIO (readiness). `GET /health/live` only checks that the process is running.

## Retention job

A Bull job runs daily at 02:00 Europe/Istanbul and deletes `YELLOW` / `GREEN` documents older than their retention period. `RED` documents are never deleted. Failed runs are retried 3 times with exponential backoff, then kept in Redis as failed jobs for inspection; each failure is logged. Re-running is safe: already deleted documents are skipped.

See also: [PRE_LAUNCH_CHECKLIST.md](PRE_LAUNCH_CHECKLIST.md).
