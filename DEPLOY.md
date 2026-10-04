# Deploying Medical Timeline

## Local
```bash
cp .env.example .env        # set POSTGRES_PASSWORD and an LLM API key
docker compose up --build   # UI: http://localhost:8080   API docs: http://localhost:8000/docs
```
The override file publishes the DB (5432) and API (8000) on localhost only.

## Cloud / production
```bash
docker compose -f docker-compose.yml up -d --build   # ignores the local override
```
- Only the frontend (nginx, port 8080) is published. Put a TLS-terminating load balancer or reverse proxy (ALB, Cloudflare, Caddy, Traefik) in front of it; do not serve PHI over plain HTTP.
- Managed Postgres: set `DATABASE_URL` in `.env` (the bundled `db` service can then be dropped).
- Inject secrets (`POSTGRES_PASSWORD`, API keys) from your platform's secret manager rather than a file on disk.
- Building images separately: `docker build -t timeline-api ./backend`, `docker build -t timeline-web ./frontend`.

## Before real patient data
- Replace `create_all` with Alembic migrations; back up the `pgdata` volume.
- Add authentication and audit logging; sign a BAA / zero-retention agreement with your LLM vendor (or de-identify text first).
- Commit `frontend/package-lock.json` so builds are reproducible (`npm install` once locally).
- Uploads live on a RAM-only tmpfs (`UPLOAD_TMPFS_SIZE`, default 2g) and are deleted as soon as processing finishes, whether it succeeded or failed; a sweeper removes orphans after `UPLOAD_SWEEP_MAX_AGE_MINUTES`. OCR text is never written to disk. If you need retention, move originals to encrypted object storage deliberately.
- `ENVIRONMENT=production` (the compose default) makes the API refuse to start if the LLM key is missing, the DB still uses `postgres:postgres`, or CORS contains `*`. Set `ENVIRONMENT=development` in `.env` for local runs without keys.
- `read_only: true` on the backend is untested here; if a dependency needs another writable path, add it as a tmpfs.
- CI: .github/workflows/ci-cd.yml runs pytest, the frontend build and a production-mode compose smoke test on every push/PR; images are pushed to GHCR from main.
