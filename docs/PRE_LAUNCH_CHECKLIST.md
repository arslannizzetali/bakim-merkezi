# Pre-launch checklist

Run these on the production server before handing a tenant to a facility, and again after major changes.

## Accounts and secrets

- [ ] No account uses a password that has ever appeared in this repository or its history. The facility's first admin was created by `tenant-create.sh` with a random password, stored in a password manager.
- [ ] The facility admin changed the initial password on first login.
- [ ] `JWT_SECRET`, `JWT_REFRESH_SECRET` and `MASTER_ENCRYPTION_KEY` are 64 random hex characters, different from each other and from every other tenant.
- [ ] No `.env` file is committed: `git ls-files | grep -E '(^|/)\.env'` prints only `.env.example` and `deploy/.env.platform.example`.
- [ ] `deploy/.env.platform` and `deploy/tenants/*/.env` are mode `600` and owned by the deploy user.
- [ ] `MASTER_ENCRYPTION_KEY` for each tenant is backed up in a separate place from the data backups.

## Network exposure

Check from **outside** the server (`nmap -Pn -p- <server-ip>`), not from the server itself:

- [ ] Only 80 and 443 are open (plus SSH, ideally restricted to your IP).
- [ ] 5432 (PostgreSQL), 6379 (Redis), 9000 (MinIO API) and **9001 (MinIO console)** are closed.
- [ ] `http://` redirects to `https://` and the certificate is valid.
- [ ] SSH uses keys only; password login and root login are disabled.

## Application

- [ ] `curl https://<domain>/health` returns `200` with all checks `up`.
- [ ] Response headers include `Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options: nosniff`.
- [ ] A cross-origin request from another domain is rejected by CORS.
- [ ] Logging in with a wrong password 5 times locks the account/IP pair for 15 minutes.
- [ ] An employee account cannot open the admin pages or another employee's documents.
- [ ] The database contains no seed or demo data (`bakimevi.com` users, sample patients).

## Backups

- [ ] Nightly PostgreSQL dump and MinIO mirror are scheduled and copied off the server.
- [ ] A restore was tested into a separate tenant and documents could be downloaded and opened.
- [ ] Docker log rotation is configured.

## Legal

- [ ] A formal KVKK review has been done (see [DATA_PROTECTION.md](DATA_PROTECTION.md)), including the facility's role as data controller and yours as data processor, and a data processing agreement.
