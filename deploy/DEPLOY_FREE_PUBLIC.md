# Free Public Deployment (Oracle Cloud Always Free + Docker + Caddy)

This project can be deployed to the public internet using **Oracle Cloud Always Free** compute.

Why Oracle Free VM:
- You need outbound SMTP (many “free PaaS” plans block or restrict it).
- You need persistent disk for `source_pdfs` / `product_images` (stateless containers will lose files).

This guide uses the existing production stack:
- Postgres (Docker) for data
- Backend (FastAPI) for API
- Frontend (React build served by nginx)
- Caddy as the public entrypoint (80/443 + automatic HTTPS)

## Option A (Recommended): HTTPS With a Free Domain Name

You need a domain for TLS. You can use a free “IP domain” like:
- `YOUR_IP.sslip.io`
- `YOUR_IP.nip.io`

Example:
- Server public IP: `203.0.113.10`
- Domain: `203.0.113.10.sslip.io`

Then Caddy can request a real certificate automatically.

## 1) Create an Oracle Cloud Always Free VM

Suggested shape:
- Ampere A1 (ARM) or E2 Micro (x86)
- Ubuntu 22.04/24.04
- Public IPv4 enabled

Open the firewall/security list for inbound TCP:
- 22 (SSH)
- 80 (HTTP)
- 443 (HTTPS)

## 2) Install Docker on the VM

On Ubuntu (high level):
- Install Docker Engine
- Install Docker Compose plugin

Follow Docker’s official install docs for Ubuntu.

## 3) Copy the Project to the VM

On the VM:
```bash
mkdir -p /srv/yantu && cd /srv/yantu
# copy files here (git clone, scp, etc.)
```

## 4) Create a Production `.env`

Create `/srv/yantu/.env`:
```bash
DOMAIN=203.0.113.10.sslip.io
ACME_EMAIL=ops@example.com

ENVIRONMENT=prod
BASE_URL=https://203.0.113.10.sslip.io
ADMIN_FRONTEND_BASE_URL=https://203.0.113.10.sslip.io

POSTGRES_DB=yantu
POSTGRES_USER=yantu
POSTGRES_PASSWORD=CHANGE_ME
DATABASE_URL=postgresql+psycopg://yantu:CHANGE_ME@db:5432/yantu

JWT_SECRET_KEY=CHANGE_ME_LONG_RANDOM

# Bootstrap first super admin (one-time)
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_PASSWORD=CHANGE_ME_STRONG
BOOTSTRAP_ADMIN_NICKNAME=Super Admin

LEGAL_DISCLAIMER_TEXT=【法律声明/版权提示】本资料仅限购买者本人学习使用，严禁转载、分享、二次传播或用于商业用途。本资料已写入可追溯水印与访问日志，如发生泄露将依法追责。

# SMTP (required only if you want the system to send emails directly)
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

After the first successful boot:
- Remove `BOOTSTRAP_*` from `.env`
- Restart the backend container

## 5) Start Production Stack

```bash
cd /srv/yantu
docker compose -f deploy/docker-compose.prod.yml up -d --build
```

## 6) Verify

- Frontend: `https://$DOMAIN/`
- Admin: `https://$DOMAIN/admin/login`
- Backend docs: `https://$DOMAIN/docs`

## Option B: No Domain (Temporary Public URL)

If you just need a temporary public URL for testing, you can use TryCloudflare tunnel (free, no domain).
Run the tunnel on the VM and point it to Caddy or directly to backend.

This is intentionally not the default because it is not stable for long-term operations.

## Notes

- If your SMTP provider blocks direct server sending, use a transactional email provider that supports SMTP over 587/465.
- Back up Docker volumes:
  - `yantu_pgdata` (Postgres)
  - `yantu_data` (PDF source + product images)
  - `caddy_data/caddy_config` (TLS certs/config)

