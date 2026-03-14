# Seed Neon + R2 Demo Data

This project can run in a unified mode where Cloud Run hosts both:
- the FastAPI backend (`/api/*`)
- the built frontend SPA (`/admin/*`, `/view/*`)

To make the UI usable on a brand new Neon database, you typically need at least one admin user, plus some products and orders.

## Option A (Recommended): Seed From Your Local Machine

1. Ensure your local env points to Neon + R2.

Required env vars:
- `DATABASE_URL` (Neon pooled URL is recommended)
- `R2_ENDPOINT_URL`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`

2. Run the seed script:

```powershell
cd D:\Project\Yantu\backend

# IMPORTANT: make sure the env vars are set in your shell or loaded from your env file.
python scripts\seed_neon_r2.py --require-r2 --purge
```

This will:
- create tables (via `init_db()`)
- create a seed super admin (`seed_admin` / `ChangeMe123!` by default)
- create demo products with cover images + PDF attachments (uploaded to R2)
- create demo orders (some confirmed/refunded to populate analytics)

## Option B: Seed Using A Cloud Run Job (One-Time)

If you prefer not to connect to Neon/R2 from your laptop, you can run a Cloud Run Job using the same container image.

Prerequisite: your image must include `backend/scripts` (this repo's `Dockerfile.cloudrun` already copies it).

Example:
```bash
REGION=asia-east1
PROJECT=yantulol-888
IMAGE="$REGION-docker.pkg.dev/$PROJECT/yantu/yantu:latest"

gcloud run jobs create yantu-seed \
  --image "$IMAGE" \
  --region "$REGION" \
  --command "python" \
  --args "scripts/seed_neon_r2.py,--require-r2,--purge" \
  --set-env-vars "DATABASE_URL=..." \
  --set-env-vars "R2_ENDPOINT_URL=..." \
  --set-env-vars "R2_ACCESS_KEY_ID=..." \
  --set-env-vars "R2_SECRET_ACCESS_KEY=..." \
  --set-env-vars "R2_BUCKET_NAME=..."

gcloud run jobs execute yantu-seed --region "$REGION"
```

## Login

After seeding, open:
- `https://<cloud-run-service-url>/admin/login`

Default seeded admin:
- username: `seed_admin`
- password: `ChangeMe123!`

Change the password immediately if you keep the deployment public.
