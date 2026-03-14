# Deploy on Google Cloud Run

This repo can be deployed to **Google Cloud Run** as a **single service** (frontend + backend in one container).

Why single service:
- Same origin for frontend + API (no CORS work)
- One public URL
- Simpler than routing between separate services

Important: Cloud Run's container filesystem is **ephemeral**. For real use you must store:
- Database: Cloud SQL (recommended)
- PDFs / product images: Cloud Storage (recommended)

## 0) Prereqs

- A Google Cloud project with billing enabled (Cloud Run has free tier, but billing must be on)
- `gcloud` installed and authenticated

Enable APIs:
```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com sqladmin.googleapis.com storage.googleapis.com
```

Set defaults:
```bash
gcloud config set project YOUR_PROJECT_ID
gcloud config set run/region asia-east1   # pick your region
```

## 1) Build and Push Image

This repo includes [Dockerfile.cloudrun](/D:/Project/Yantu/Dockerfile.cloudrun) which builds frontend + backend into one image.

Create an Artifact Registry repo (once):
```bash
gcloud artifacts repositories create yantu --repository-format=docker --location=$(gcloud config get-value run/region)
```

Build with Cloud Build and push:
```bash
REGION=$(gcloud config get-value run/region)
IMAGE="$REGION-docker.pkg.dev/$(gcloud config get-value project)/yantu/yantu:latest"

gcloud builds submit --tag "$IMAGE" .
```

## 2) Create Cloud Storage Bucket (Files)

Create a bucket for source PDFs and product images:
```bash
REGION=$(gcloud config get-value run/region)
gsutil mb -l "$REGION" "gs://YOUR_BUCKET_NAME"
```

Recommended: add lifecycle policy to control storage growth (optional).

## 3) Create Cloud SQL (Postgres) (DB)

Create instance (example):
```bash
REGION=$(gcloud config get-value run/region)
gcloud sql instances create yantu-db --database-version=POSTGRES_16 --region="$REGION"
gcloud sql databases create yantu --instance=yantu-db
gcloud sql users create yantu --instance=yantu-db --password='CHANGE_ME'
```

Get the instance connection name:
```bash
CONN=$(gcloud sql instances describe yantu-db --format='value(connectionName)')
echo "$CONN"
```

## 4) Secrets (Recommended)

Store secrets in Secret Manager:
```bash
printf '%s' 'CHANGE_ME_LONG_RANDOM' | gcloud secrets create JWT_SECRET_KEY --data-file=-
printf '%s' 'CHANGE_ME_STRONG' | gcloud secrets create BOOTSTRAP_ADMIN_PASSWORD --data-file=-
printf '%s' 'CHANGE_ME' | gcloud secrets create DB_PASSWORD --data-file=-
```

## 5) Deploy Cloud Run Service

We deploy one service called `yantu`.

### Minimal env vars

You must set `BASE_URL` and `ADMIN_FRONTEND_BASE_URL` to the Cloud Run URL after deploy.
For the first deploy, set them to a placeholder, then update once you get the URL.

Example deploy:
```bash
REGION=$(gcloud config get-value run/region)
IMAGE="$REGION-docker.pkg.dev/$(gcloud config get-value project)/yantu/yantu:latest"
CONN=$(gcloud sql instances describe yantu-db --format='value(connectionName)')

gcloud run deploy yantu \
  --image "$IMAGE" \
  --allow-unauthenticated \
  --port 8080 \
  --memory 1Gi \
  --cpu 1 \
  --timeout 300 \
  --min-instances 0 \
  --max-instances 3 \
  --add-cloudsql-instances "$CONN" \
  --set-env-vars "ENVIRONMENT=prod" \
  --set-env-vars "DATABASE_URL=postgresql+psycopg://yantu:__DB_PASSWORD__@/yantu?host=/cloudsql/$CONN" \
  --set-env-vars "BASE_URL=https://REPLACE_AFTER_DEPLOY" \
  --set-env-vars "ADMIN_FRONTEND_BASE_URL=https://REPLACE_AFTER_DEPLOY" \
  --set-env-vars "SOURCE_PDF_DIR=/data/source_pdfs" \
  --set-env-vars "PRODUCT_IMAGE_DIR=/data/product_images" \
  --set-env-vars "LEGAL_DISCLAIMER_TEXT=【法律声明/版权提示】本资料仅限购买者本人学习使用，严禁转载、分享、二次传播或用于商业用途。本资料已写入可追溯水印与访问日志，如发生泄露将依法追责。" \
  --set-secrets "JWT_SECRET_KEY=JWT_SECRET_KEY:latest" \
  --set-secrets "BOOTSTRAP_ADMIN_PASSWORD=BOOTSTRAP_ADMIN_PASSWORD:latest"
```

Notes:
- The command above sets `SOURCE_PDF_DIR` / `PRODUCT_IMAGE_DIR` under `/data`, but Cloud Run does not provide persistent `/data`.
  - For real use, replace file storage with Cloud Storage (recommended).
- Replace `__DB_PASSWORD__` with Secret Manager wiring or IAM auth. The simplest is to embed password (not recommended).

After deploy, get the Cloud Run URL:
```bash
URL=$(gcloud run services describe yantu --format='value(status.url)')
echo "$URL"
```

Then update:
```bash
gcloud run services update yantu \
  --set-env-vars "BASE_URL=$URL" \
  --set-env-vars "ADMIN_FRONTEND_BASE_URL=$URL"
```

## 6) Verify

- Frontend: `$URL/`
- Admin login: `$URL/admin/login`
- Backend docs: `$URL/docs`

## 7) Production Storage (Required Work)

Cloud Run filesystem is ephemeral. For production you should:

1. Use **Cloud Storage** for:
   - `source_pdfs`
   - `product_images`
2. Update backend storage code to read/write from GCS (recommended), or use a managed file mount solution.

If you want, I can implement a `gs://bucket/prefix` storage backend in code (behind env flags), so Cloud Run can run without local disk assumptions.

