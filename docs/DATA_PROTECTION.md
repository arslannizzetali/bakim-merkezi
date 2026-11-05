# Data protection — technical measures

This document describes what personal and health data BakımEvi stores and the technical measures that protect it. It is documentation of the software, **not legal advice**, and does not by itself establish compliance with KVKK (Law No. 6698) or any other regulation.

## Data inventory

| Data | Category | Where | Protection at rest |
| --- | --- | --- | --- |
| Resident name, birth date, gender, room number, admission date | Personal | `patients` table | Database access control, disk security |
| Resident national ID (TC) number | Personal (identifier) | `patients.tc_number_encrypted` | AES-256-GCM, random IV per value, master key |
| Diagnosis, allergies, current medications, dietary needs, notes | **Special category — health** | `patients` table | Database access control, disk security (not column-encrypted) |
| Daily updates: medications given, vital signs, care performed, mood, incidents | **Special category — health** | `patient_updates` table | Database access control, disk security (not column-encrypted) |
| Uploaded documents (reports, prescriptions, forms) | Usually **special category — health** | MinIO bucket | AES-256-GCM per file, random key and IV, key wrapped with master key; SHA-256 checksum |
| Original file names | May contain personal data | `documents.file_name` | Database access control; files are stored under random UUID names |
| Emergency contact name, phone, relationship | Personal (third party) | `patients` table | Database access control |
| Staff name, e-mail, role, password hash, last login time and IP | Personal | `users` table | bcrypt (cost 12) for passwords |
| Audit log: user, action, resource ID, IP, user agent, time | Personal | `audit_logs` table | Database access control |
| Demo request: institution, contact name, phone, e-mail, message | Personal | `demo_requests` table | Database access control |

The master key (`MASTER_ENCRYPTION_KEY`) lives only in the tenant's environment file on the server, never in the database or the repository. A database dump alone does not reveal document contents or TC numbers.

## Access control

- Two roles, `ADMIN` and `EMPLOYEE`; the full matrix is in the [README](../README.md#roles-and-permissions) and enforced in API middleware and services, with an integration test per row.
- Employees see only the updates they entered and download only documents they uploaded. Admins see everything.
- Every API request (except login, refresh and the public demo form) requires a valid access token. Tokens expire after 15 minutes; refresh tokens are single-use, rotated, stored server-side by ID, and revoked as a family on reuse.
- Deactivated or deleted staff cannot log in or refresh sessions.
- Each facility is a separate tenant with its own database, bucket, Redis index and keys; there is no cross-tenant access path in the application.

## Encryption in transit

All traffic from browsers terminates at Caddy over HTTPS with HSTS. Traffic between the API and PostgreSQL, Redis and MinIO stays on the internal Docker network of a single host and is not TLS-encrypted; if these services are moved to separate hosts, enable TLS for them.

## Retention

| Data | Retention |
| --- | --- |
| `RED` documents | Kept indefinitely; cannot be deleted by any role |
| `YELLOW` documents | Auto-deleted after 90 days by default (admin-configurable) |
| `GREEN` documents | Auto-deleted after 30 days by default (admin-configurable) |
| Patients, updates, staff accounts | Kept until deleted; deletion is a soft delete (see below) |
| Audit log | Kept indefinitely; no automatic deletion |
| Demo requests | Kept indefinitely; no automatic deletion |

Auto-deletion removes the encrypted file from MinIO and marks the document record as deleted. The record (file name, uploader, dates) remains for traceability.

## Deletion requests

- **Deleting a patient** (`DELETE /patients/:id`, admin only) is a **soft delete**: it sets `deleted_at` and hides the record from the application. Personal and health data, updates and documents remain in the database and storage.
- **Deleting a staff member** deactivates the account and sets `deleted_at`; the record stays so audit entries remain attributable.
- There is currently **no hard-delete or anonymisation function**. Fulfilling an erasure request requires a manual, audited database operation.

Soft delete is a reasonable default for care records: Turkish health regulations generally require facilities to keep care records for a defined period, and deleting them on request may not be permitted. Once that period ends, records should be erased or anonymised. An anonymisation job is on the roadmap. The applicable retention periods must be confirmed in the legal review.

## Audit log

Recorded actions: `USER_LOGIN`, `USER_LOGIN_FAILED`, `USER_LOGOUT`, `TOKEN_REUSE_DETECTED`, `USER_CREATED`, `USER_UPDATED`, `USER_DELETED`, `PATIENT_CREATED`, `PATIENT_VIEWED`, `PATIENT_SEARCHED`, `PATIENT_UPDATED`, `PATIENT_DELETED`, `PATIENT_UPDATE_CREATED`, `DOCUMENT_UPLOADED`, `DOCUMENT_DOWNLOADED`, `DOCUMENT_PRIORITY_CHANGED`, `DOCUMENT_DELETED` (manual and automatic), `RETENTION_POLICY_UPDATED`.

Each entry stores the acting user (or `system`), the resource type and ID, the IP address, user agent, timestamp and limited metadata (for example which fields changed, never the new values of health fields). Search queries are stored as metadata.

**Immutability:** the application only ever inserts audit entries; there is no code path that updates or deletes them. This is enforced in application code only. A database role with full privileges could still modify the table; revoking `UPDATE`/`DELETE` on `audit_logs` from the application role or adding a trigger is planned.

## Other measures

- Upload validation by extension, MIME type and file signature; 50 MB limit; random storage names.
- Rate limiting on all API routes, stricter limits on login and the public form, and account/IP lockout after repeated failed logins.
- Helmet security headers, CSP, CORS limited to the tenant's own origin.
- Production startup fails if secrets are missing or MinIO uses default credentials; the development seed refuses to run in production.
- Error responses do not include stack traces in production; logs do not contain request bodies or patient data.

## Known gaps

- Health fields in `patients` and `patient_updates` are not column-encrypted.
- No hard-delete/anonymisation tooling.
- No database-level audit log immutability.
- No master key rotation tooling.
- Internal service traffic is not TLS-encrypted (single-host deployment).

---

**Formal KVKK compliance review required.** Before processing real resident data, a qualified legal review should confirm the legal basis for processing, data controller/processor roles and contracts, VERBİS registration obligations, retention periods, cross-border transfer status of any third-party services, breach notification procedures and the handling of data subject requests.
