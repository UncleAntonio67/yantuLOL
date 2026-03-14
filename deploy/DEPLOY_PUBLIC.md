# Public Deployment (Docker + Caddy + Postgres)

This repo contains:
- Backend (FastAPI) on port 8000 (internal)
- Frontend (React) served by nginx (internal)
- Caddy as the public entrypoint (ports 80/443) with automatic HTTPS
- Postgres for production data

## 0. Prereqs (Server)
- A Linux VPS (Ubuntu 22.04/24.04 recommended)
- A domain (e.g. `redoc.example.com`) pointing A/AAAA to the VPS IP
- Docker + Docker Compose plugin installed
- Open firewall: TCP 80 and 443

## 1. Copy Project To Server
On the VPS:
1. Upload/clone the project into a folder, e.g. `/srv/yantu`
2. `cd /srv/yantu`

## 2. Create Production Env File
Create `/srv/yantu/.env` (or export env vars) with at least:

```bash
DOMAIN=redoc.example.com
ACME_EMAIL=ops@example.com

ENVIRONMENT=prod
BASE_URL=https://redoc.example.com
ADMIN_FRONTEND_BASE_URL=https://redoc.example.com

POSTGRES_DB=yantu
POSTGRES_USER=yantu
POSTGRES_PASSWORD=CHANGE_ME
DATABASE_URL=postgresql+psycopg://yantu:CHANGE_ME@db:5432/yantu

JWT_SECRET_KEY=CHANGE_ME_LONG_RANDOM

# Bootstrap first super admin (one-time)
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_PASSWORD=CHANGE_ME_STRONG
BOOTSTRAP_ADMIN_NICKNAME=Super Admin

# Optional but recommended (Chinese watermark rendering)
# If unset, backend will use default font. In containers, Chinese may render as boxes.
# WATERMARK_FONT_FILE=/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc
WATERMARK_FONT_FILE=

LEGAL_DISCLAIMER_TEXT=【法律声明/版权提示】本资料仅限购买者本人学习使用，严禁转载、分享、二次传播或用于商业用途。本资料已写入可追溯水印与访问日志，如发生泄露将依法追责。

# SMTP (optional: only required if you want the system to send emails directly)
SMTP_HOST=
SMTP_PORT=587
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_FROM=
SMTP_USE_TLS=true
```

Generate a strong JWT secret:
```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

After the first successful boot, remove BOOTSTRAP_* from `.env` and restart the backend container.

## 3. Start With Docker Compose

```bash
docker compose -f deploy/docker-compose.prod.yml up -d --build
```

## 4. Verify
- Frontend: `https://$DOMAIN/`
- Admin: `https://$DOMAIN/admin/login`
- Backend docs: `https://$DOMAIN/docs`
- API health: `https://$DOMAIN/api/admin/dashboard/stats`

QR PNG endpoint (requires order_id exists):
- `https://$DOMAIN/api/viewer/qrcode/ORD-....png`

## 5. Data Persistence / Backups
Named volumes:
- `yantu_pgdata` (Postgres)
- `yantu_data` (PDF source + product images)
- `caddy_data/caddy_config` (TLS certs/config)

Back up `yantu_pgdata` and `yantu_data` regularly.

## 6. Notes / Security
- Always set a strong `JWT_SECRET_KEY`.
- Prefer running frontend and backend under the same domain (as configured above), so you can keep CORS closed in production.
- Consider enabling rate limiting at the proxy layer for:
  - `/api/viewer/auth`
  - `/api/viewer/document/*`
  - `/api/viewer/qrcode/*`
