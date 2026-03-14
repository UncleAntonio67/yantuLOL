# Deploy On Sealos.io (Single App, Free-Friendly)

This guide deploys the system on Sealos Cloud using a single container image that serves:
- Backend API (`/api/*`, `/docs`, `/openapi.json`)
- Frontend SPA (`/admin/*`, `/view/*`, `/`)

It is the simplest way to get a public URL on Sealos, and it avoids needing path-based routing between separate services.

## 0) What You Need

- A Sealos Cloud account
- A container registry account (free): Docker Hub or GitHub Container Registry (GHCR)
- One persistent volume on Sealos (to store PDFs, product images, SQLite DB)

Notes about "free":
- Sealos typically provides some free quota / trial, but resources are billed. Treat it as low-cost and stop the app when not in use.
- SMTP may be restricted by some cloud providers. Prefer SMTP submission ports 587/465.

## 1) Build And Push The Unified Image

From your local machine:

```bash
# Example using Docker Hub
docker login

# Build
docker build -f Dockerfile.sealos -t yourname/yantu:latest .

# Push
docker push yourname/yantu:latest
```

## 2) Create The App In Sealos (Launchpad UI)

In Sealos Cloud:

1. Create a workspace / namespace (or use default).
2. Create an Application (Launchpad).
3. Image: `yourname/yantu:latest`
4. Container port: `8000`
5. Enable Public Access to get a public URL (Sealos will give you a domain).
6. Add a persistent volume mounted to `/data` (size depends on your PDFs; start with 5-10GB).
7. Set environment variables (below).

### Required Environment Variables

Set these in the app's env:

```env
ENVIRONMENT=prod

# Store sqlite DB on persistent volume
DATABASE_URL=sqlite+pysqlite:////data/yantu.db

# Storage on persistent volume
SOURCE_PDF_DIR=/data/source_pdfs
PRODUCT_IMAGE_DIR=/data/product_images

# IMPORTANT: replace with your Sealos public URL (no trailing slash)
BASE_URL=https://YOUR-SEALOS-DOMAIN
ADMIN_FRONTEND_BASE_URL=https://YOUR-SEALOS-DOMAIN

# Strong secret
JWT_SECRET_KEY=CHANGE_ME_LONG_RANDOM

# One-time bootstrap super admin (remove after first login)
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_PASSWORD=CHANGE_ME_STRONG
BOOTSTRAP_ADMIN_NICKNAME=Super Admin

LEGAL_DISCLAIMER_TEXT=【法律声明/版权提示】本资料仅限购买者本人学习使用，严禁转载、分享、二次传播或用于商业用途。本资料已写入可追溯水印与访问日志，如发生泄露将依法追责。

# Optional SMTP
SMTP_HOST=
SMTP_PORT=587
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_FROM=
SMTP_USE_TLS=true
```

After the first successful boot:
- Delete `BOOTSTRAP_ADMIN_*` env vars
- Restart the app

## 3) Verify

Open these URLs:
- `https://YOUR-SEALOS-DOMAIN/` (frontend)
- `https://YOUR-SEALOS-DOMAIN/admin/login` (admin login)
- `https://YOUR-SEALOS-DOMAIN/docs` (FastAPI docs)

## 4) Storage / Backups

All persistent data is stored under `/data`:
- `/data/yantu.db` (SQLite)
- `/data/source_pdfs/*` (PDF source)
- `/data/product_images/*` (product covers)

Back up your PV if you need long-term safety.

## 5) Tradeoffs

- SQLite is simplest and cheap, but it is not suitable for high concurrency or multi-replica scaling.
- If you need Postgres, use Sealos DB service or an external Postgres, then set `DATABASE_URL` accordingly.

