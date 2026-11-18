# BakımEvi — Care Facility Management System

**Patient tracking and encrypted document management for elderly and disability care facilities.**

[![CI](https://github.com/arslannizzetali/bakim-merkezi/actions/workflows/ci.yml/badge.svg)](https://github.com/arslannizzetali/bakim-merkezi/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-14-000000?logo=nextdotjs)
![Express](https://img.shields.io/badge/Express-4-000000?logo=express)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-5-2D3748?logo=prisma)

🇹🇷 [Türkçe README](README.tr.md)


## Why this project?

Care facilities that look after elderly and disabled residents still track much of their daily work on paper: medication given, vital signs, incidents, and the documents that come with each resident. That makes it hard to see who did what, and sensitive health documents end up in folders and shared drives.

BakımEvi gives care staff one place to record daily patient updates and store documents, with role-based access, encryption of sensitive data, and an audit trail of who viewed or changed what.

The project was designed and built in response to the requirements of a care facility. This public repository contains only the application code and fully synthetic demo data; it holds no information about any real facility, resident or staff member.


## Screenshots

_All screenshots use the synthetic demo data from `pnpm db:seed`; no real residents or staff are shown._

![Admin dashboard](docs/screenshots/02-dashboard.png)

<table>
  <tr>
    <td><img src="docs/screenshots/04-hasta-detay.png" alt="Patient detail with prioritized documents"></td>
    <td><img src="docs/screenshots/03-hastalar.png" alt="Patient list and filters"></td>
  </tr>
  <tr>
    <td align="center">Patient detail with prioritized documents</td>
    <td align="center">Patient list and filters</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/05-guncelleme-formu.png" alt="Daily update form"></td>
    <td align="center"><img src="docs/screenshots/09-mobil-dashboard.png" alt="Mobile layout" width="45%"></td>
  </tr>
  <tr>
    <td align="center">Daily update form</td>
    <td align="center">Mobile layout</td>
  </tr>
</table>

## Features

- **Patient records** — registration, search and filters (status, care type, mobility, admission date), quick access by room number
- **Daily updates** — medication, care performed, observation, vital signs, status change and incident entries, with mood tracking and an urgent flag
- **Document management** — upload PDF, JPEG, PNG, WEBP, DOCX and XLSX files with a priority:

  | Priority | Meaning | Rule |
  | --- | --- | --- |
  | `RED` | Critical | Can never be deleted, by any role |
  | `YELLOW` | Semi-important | Admin can delete; auto-deleted after 90 days by default |
  | `GREEN` | Standard | Admin can delete; auto-deleted after 30 days by default |

- **Admin panel** — employee management, all patients and updates, recent/urgent updates, audit log viewer, retention policy settings
- **Multi-tenant deployment** — one script provisions an isolated database, Redis index, storage bucket, containers and HTTPS subdomain per facility

### Roles and permissions

| Action | Admin | Employee |
| --- | :-: | :-: |
| Create, delete, list employees | ✅ | ❌ |
| View all audit logs | ✅ | ❌ |
| View all patient updates | ✅ | ❌ |
| Create and view patients | ✅ | ✅ |
| Delete patients (soft delete) | ✅ | ❌ |
| Enter patient updates / view own updates | ✅ | ✅ |
| Upload documents | ✅ | ✅ |
| Download own documents | ✅ | ✅ |
| Download another employee's documents | ✅ | ❌ |
| Delete `RED` documents | ❌ | ❌ |
| Delete `YELLOW` / `GREEN` documents | ✅ | ❌ |
| Change retention policies | ✅ | ❌ |

Every row is covered by an integration test in [`tests/integration/permission-matrix.integration.test.ts`](tests/integration/permission-matrix.integration.test.ts).

## Security design

- **Files** are encrypted with AES-256-GCM before they reach object storage. Each file gets its own random key and IV; the file key is wrapped with a master key (envelope encryption) and the GCM auth tag plus a SHA-256 checksum are verified on download.
- **National ID (TC) numbers** are encrypted with AES-256-GCM and a random IV per value.
- **Authentication** uses short-lived JWT access tokens and refresh tokens in an `httpOnly`, `SameSite=Strict` cookie. Refresh tokens are single-use and rotated atomically (`GETDEL`); reusing one revokes the whole session family. Changing a password revokes every token issued before the change.
- **No default accounts** — there are no built-in users or passwords. Development seed passwords are random unless set in `.env`; a production facility's first admin gets a random password printed once by the provisioning script.
- **Forced password change** — any password set by someone else (the provisioning script, or an admin creating or resetting an employee) must be replaced by the user on first login. Until then the API rejects every other request with `PASSWORD_CHANGE_REQUIRED`.
- **Brute-force protection** — Redis-backed rate limiting, a lockout per IP + account, and a separate per-account lockout across all IPs. Unknown e-mails are compared against a dummy bcrypt hash so response timing does not reveal which accounts exist.
- **Uploads** are checked by extension, declared MIME type *and* file signature (magic bytes), limited to 50 MB, and stored under a random UUID name.
- **Audit log** records logins, failed logins, patient views/searches/changes and document actions. The application never updates or deletes audit entries.
- **Hardening** — Helmet security headers with a deny-all CSP on the JSON API, framing and sniffing protection on the web app, CORS restricted to configured origins, Zod validation on every input, bcrypt (cost 12) password hashing. Startup fails if `NODE_ENV` is missing, if secrets are missing or malformed, or if default MinIO credentials are used in production. Stack traces are never returned in production.

Details: [`docs/ENCRYPTION.md`](docs/ENCRYPTION.md) (key hierarchy, envelope encryption, known gaps) and [`docs/DATA_PROTECTION.md`](docs/DATA_PROTECTION.md).

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | Next.js 14 (App Router), React 18, Tailwind CSS, TanStack Query, Zustand, React Hook Form + Zod | Server/client rendering in one framework; Query handles caching and token refresh retries |
| API | Express 4, TypeScript | Small, explicit middleware chain that is easy to audit for a security-sensitive app |
| Database | PostgreSQL 16 + Prisma 5 | Relational data with strong typing and versioned migrations |
| Cache / queue | Redis 7 + Bull | Rate limiting, token state and the nightly retention job |
| Object storage | MinIO (S3-compatible) | Self-hosted, so health documents never leave the facility's infrastructure |
| Validation | Zod, shared between web and API (`packages/validation`) | One source of truth for input rules |
| Tooling | pnpm workspaces, Turbo, Vitest, ESLint, Prettier, GitHub Actions | |

## Architecture

```mermaid
flowchart LR
  user[Browser] -->|HTTPS| caddy[Caddy reverse proxy]
  caddy -->|/| web[Next.js web]
  caddy -->|/api/*| api[Express API]
  web -->|REST + JWT| api
  api --> pg[(PostgreSQL)]
  api --> redis[(Redis)]
  api -->|encrypted files| minio[(MinIO)]
  redis --> bull[Bull queue]
  bull -->|nightly 02:00| retention[Retention job]
  retention --> pg
  retention --> minio
```

In production each facility (tenant) gets its own `web` and `api` containers, PostgreSQL database and role, Redis database index and MinIO bucket, behind a shared Caddy instance that terminates HTTPS. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).


## Getting started

**Requirements:** Node.js 22, Corepack, Docker.

```bash
corepack enable
corepack pnpm install
corepack pnpm generate:secrets   # writes JWT and encryption keys to .env

docker compose up -d             # PostgreSQL, Redis, MinIO

corepack pnpm db:generate
corepack pnpm db:migrate         # prisma migrate dev
corepack pnpm db:seed            # development data only
corepack pnpm dev
```

Or, after `pnpm install` and `pnpm generate:secrets`, start the services, apply migrations and load the demo data in one step with `corepack pnpm demo:setup`.

- Web: http://localhost:3000
- API: http://localhost:3001 — readiness check at `/health`, liveness at `/health/live`
- MinIO console: http://localhost:9001

**Development seed users** are created by `pnpm db:seed`. Their passwords come from `SEED_ADMIN_PASSWORD` and `SEED_EMPLOYEE_PASSWORD` in `.env`; if those are empty, random passwords are generated and printed once. The seed refuses to run with `NODE_ENV=production`.

### Demo data

`pnpm db:seed` loads a fully synthetic demo dataset: four staff accounts (`admin@demo.example`, `ahmet@demo.example`, `mehmet@demo.example`, `fatma@demo.example`), eight residents with made-up names, placeholder national ID numbers (`1000000000x`, not valid TC numbers), a placeholder phone number, sample updates and small generated PDF/JPEG documents. Every name and value is invented; `.example` is a reserved domain that can never receive mail.

### Production setup

Production facilities are provisioned with `scripts/tenant-create.sh`, which generates all secrets with `openssl rand`, creates the database, Redis index and bucket, and creates **one** admin with a random password that must be changed on first login. It never loads demo data. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) and run through [`docs/PRE_LAUNCH_CHECKLIST.md`](docs/PRE_LAUNCH_CHECKLIST.md) before go-live.

Installations created before random IVs were introduced for TC numbers should run the one-off re-encryption script after a backup:

```bash
cd apps/api
corepack pnpm exec tsx prisma/reencrypt-legacy-tc.ts          # dry run
corepack pnpm exec tsx prisma/reencrypt-legacy-tc.ts --apply
```

## Running tests

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test                                     # unit tests
RUN_INTEGRATION=true corepack pnpm --filter @bakimevi/api test   # needs a seeded test DB, Redis, MinIO
```

CI runs all of the above on every push, including the integration suite against PostgreSQL, Redis and MinIO containers and a check that migrations match `schema.prisma`.

## Project structure

```text
bakim-merkezi/
├── apps/
│   ├── api/                 # Express API, Prisma schema, migrations, seed
│   └── web/                 # Next.js frontend
├── packages/
│   ├── shared-types/        # Types shared by web and API
│   └── validation/          # Zod schemas shared by web and API
├── tests/                   # Unit and integration tests
├── deploy/                  # Production Docker Compose and Caddy config
├── scripts/                 # Tenant lifecycle and secret generation scripts
├── docs/                    # Deployment and data protection docs
├── research/, security/     # Design notes written as AI agent briefs (see below)
└── docker-compose.yml       # Local PostgreSQL, Redis, MinIO
```

## Data protection (KVKK) notes

BakımEvi processes health data, which is a special category of personal data under KVKK (Law No. 6698). The software provides technical measures — encryption of national ID numbers and documents, role-based access, an audit trail, configurable retention and an intranet-first deployment — but compliance also depends on how each facility operates it. A facility deploying the system remains the data controller and is responsible for, among other things:

- registering with VERBİS where required and keeping an inventory of processing activities,
- informing residents, relatives and staff (aydınlatma metni) and obtaining explicit consent where required,
- keeping the server, backups and `MASTER_ENCRYPTION_KEY` in its own controlled infrastructure,
- defining retention periods that match its legal obligations, and
- handling access and deletion requests from data subjects.

[`docs/DATA_PROTECTION.md`](docs/DATA_PROTECTION.md) lists every stored field, where it lives and how it is protected. None of this is legal advice.

## Known limitations and roadmap

- Clinical fields (diagnosis, allergies, medications, update notes) are protected by access control and database/disk security but are not encrypted at the column level.
- Audit log immutability is enforced in application code; a database-level guard (revoked `UPDATE`/`DELETE` or a trigger) is planned.
- Next.js 14 and Multer 1.x have published advisories that are fixed only in new major versions; upgrading to Next.js 15 and Multer 2 is planned.
- No key rotation tooling yet for `MASTER_ENCRYPTION_KEY`, and ciphertexts are not bound to their row with GCM associated data (AAD).
- In the multi-tenant setup tenants share one Redis instance and password, separated only by database index; per-tenant Redis instances or ACL users are planned.
- No e-mail/SMS notifications for urgent updates.

## Development history

The project was first developed locally and imported into this repository later in bulk, which is why the commit history is short.

## AI-assisted development


AI coding agents were used during development. The `AGENTS.md` files in the root and in `apps/`, `research/`, `security/`, `tests/` and `src/ui/` are the instruction files they worked from: they describe the project rules, security requirements and conventions each agent had to follow.

## License


Copyright © 2026 İzzet Ali Arslan. All rights reserved — see [`LICENSE`](LICENSE). The source is published for portfolio and evaluation purposes only; it may not be used, copied, modified or distributed without written permission.

## Contact

İzzet Ali Arslan — [GitHub](https://github.com/arslannizzetali)

