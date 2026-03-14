# Deploy Plan: Cloud Run (Backend) + Neon (Postgres) + Cloudflare R2 (Files) + Vercel (Frontend)

Target architecture:
- Vercel serves the React frontend (admin + viewer)
- Google Cloud Run serves the FastAPI backend (`/api/*`, `/docs`)
- Neon provides Postgres
- Cloudflare R2 stores:
  - product PDF source files (private)
  - product cover images (either public or proxied)

Key constraint: Cloud Run filesystem is ephemeral. You must not store PDFs/images on local disk in Cloud Run.

## Phase 0: Repo Prep (Already In This Repo)

- Cloud Run build: [Dockerfile.cloudrun](/D:/Project/Yantu/Dockerfile.cloudrun)
- Frontend rewrite config for Vercel: [vercel.json](/D:/Project/Yantu/frontend/vercel.json)

If you deploy frontend on Vercel and keep API calls as relative `/api/...`, the rewrite keeps everything "same-origin" from the browser perspective (no CORS headache).

## Phase 1: Provision Managed Services

### 1) Neon (Postgres)
1. Create a Neon project and a database (e.g. `yantu`).
2. Get the **pooled** connection string (recommended for serverless like Cloud Run).
3. Ensure your connection string includes SSL (Neon requires TLS):
   - usually `?sslmode=require` (or Neon-provided URL already includes TLS)

Result: `DATABASE_URL` for SQLAlchemy, for example:
```text
postgresql+psycopg://USER:PASSWORD@HOST/DBNAME?sslmode=require
```

### 2) Cloudflare R2 (Object Storage)
1. Create an R2 bucket, e.g. `yantu-files`.
2. Create an R2 API token (S3 compatible access key id + secret).
3. Record the R2 S3 endpoint:
   - `https://<accountid>.r2.cloudflarestorage.com`

Decisions you must make:
- Cover images:
  - Option A: store as public objects and save `cover_image` as a public URL
  - Option B (recommended): keep private, backend proxies image bytes via an API endpoint
- PDFs:
  - keep private (backend reads, watermarks, and streams to viewer)

## Phase 2: Deploy Backend To Cloud Run

### 1) Build & push image (Artifact Registry)
Use Cloud Build for easiest flow:
```bash
gcloud config set project YOUR_PROJECT_ID
gcloud config set run/region asia-east1

REGION=$(gcloud config get-value run/region)
IMAGE="$REGION-docker.pkg.dev/$(gcloud config get-value project)/yantu/yantu:latest"

gcloud artifacts repositories create yantu --repository-format=docker --location="$REGION"
gcloud builds submit --tag "$IMAGE" .
```

### 2) Create Cloud Run service
Deploy:
```bash
gcloud run deploy yantu-backend \
  --image "$IMAGE" \
  --allow-unauthenticated \
  --port 8080 \
  --cpu 1 \
  --memory 1Gi \
  --timeout 300 \
  --concurrency 10 \
  --max-instances 2 \
  --set-env-vars "ENVIRONMENT=prod" \
  --set-env-vars "DATABASE_URL=$DATABASE_URL_FROM_NEON" \
  --set-env-vars "JWT_SECRET_KEY=$JWT_SECRET_KEY" \
  --set-env-vars "BASE_URL=https://REPLACE_AFTER_DEPLOY" \
  --set-env-vars "ADMIN_FRONTEND_BASE_URL=https://REPLACE_AFTER_VERCEL" \
  --set-env-vars "LEGAL_DISCLAIMER_TEXT=【法律声明/版权提示】本资料仅限购买者本人学习使用，严禁转载、分享、二次传播或用于商业用途。本资料已写入可追溯水印与访问日志，如发生泄露将依法追责。"
```

Get URL:
```bash
BACKEND_URL=$(gcloud run services describe yantu-backend --format='value(status.url)')
echo "$BACKEND_URL"
```

Update:
```bash
gcloud run services update yantu-backend --set-env-vars "BASE_URL=$BACKEND_URL"
```

Bootstrap admin (one-time):
- Set env vars `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_PASSWORD`, `BOOTSTRAP_ADMIN_NICKNAME`
- After first successful login, remove these env vars and redeploy/update.

### 3) R2 env vars
If you set these env vars, backend automatically switches to R2 for PDFs and product cover images:
```env
R2_ENDPOINT_URL=https://<accountid>.r2.cloudflarestorage.com
R2_BUCKET_NAME=yantu-files
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_REGION=auto
```


## Phase 4: End-to-End Validation Checklist

1. Admin login: `https://<vercel>/admin/login`
2. Create product with multiple PDF attachments and a cover image
3. Deliver order (text / qrcode / email preview)
4. Viewer open: `https://<vercel>/view/<order_id>` and authenticate with password
5. Confirm receipt in admin, then download:
   - PDF should be encrypted, open password equals access password
6. Refund order:
   - viewer token/password should be revoked

## R2 Support (Current Status)
Backend storage is environment-adaptive:
- Local dev (no R2 env vars): stores PDFs/images on local disk (`SOURCE_PDF_DIR`, `PRODUCT_IMAGE_DIR`).
- Cloud deployment (R2 env vars set): stores PDFs and product cover images in R2 automatically.

Note: product cover images are served via backend endpoint `/static/product-images/{name}` which proxies from R2 in R2 mode.



