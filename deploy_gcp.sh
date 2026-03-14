#!/usr/bin/env bash
set -euo pipefail

# One-click deploy to Google Cloud Run.
# Requirements:
# - gcloud installed and authenticated
# - Cloud Build + Artifact Registry + Cloud Run APIs enabled
# - A .env file in repo root (NOT committed) containing:
#   DATABASE_URL, R2_ENDPOINT_URL, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME

REGION="${REGION:-asia-east1}"
SERVICE_NAME="${SERVICE_NAME:-yantu-backend}"
AR_REPO="${AR_REPO:-yantu}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(tr -d "\r" < ".env")
  set +a
fi

: "${DATABASE_URL:?Missing DATABASE_URL}"
: "${R2_ENDPOINT_URL:?Missing R2_ENDPOINT_URL}"
: "${R2_ACCESS_KEY_ID:?Missing R2_ACCESS_KEY_ID}"
: "${R2_SECRET_ACCESS_KEY:?Missing R2_SECRET_ACCESS_KEY}"
: "${R2_BUCKET_NAME:?Missing R2_BUCKET_NAME}"

PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
if [[ -z "${PROJECT_ID}" ]]; then
  echo "GCP project is not set. Set GCP_PROJECT_ID or run: gcloud config set project <YOUR_PROJECT_ID>" >&2
  exit 1
fi

gcloud config set project "${PROJECT_ID}" >/dev/null

echo "[1/3] Ensuring Artifact Registry repo exists: ${AR_REPO} (${REGION})"
if ! gcloud artifacts repositories describe "${AR_REPO}" --location "${REGION}" >/dev/null 2>&1; then
  gcloud artifacts repositories create "${AR_REPO}" --repository-format=docker --location "${REGION}" >/dev/null
fi

IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/yantu:${IMAGE_TAG}"

echo "[2/3] Building container image with Cloud Build: ${IMAGE}"
gcloud builds submit --config cloudbuild.cloudrun.yaml --substitutions _IMAGE=${IMAGE} .

echo "[3/3] Deploying to Cloud Run: ${SERVICE_NAME} (${REGION})"
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE}" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 1Gi \
  --set-env-vars "ENVIRONMENT=prod" \
  --set-env-vars "DATABASE_URL=${DATABASE_URL}" \
  --set-env-vars "R2_ENDPOINT_URL=${R2_ENDPOINT_URL}" \
  --set-env-vars "R2_ACCESS_KEY_ID=${R2_ACCESS_KEY_ID}" \
  --set-env-vars "R2_SECRET_ACCESS_KEY=${R2_SECRET_ACCESS_KEY}" \
  --set-env-vars "R2_BUCKET_NAME=${R2_BUCKET_NAME}"

BACKEND_URL="$(gcloud run services describe "${SERVICE_NAME}" --region "${REGION}" --format='value(status.url)')"
echo "Deployed backend URL: ${BACKEND_URL}"



