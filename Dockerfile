FROM node:20-alpine AS frontend_build

WORKDIR /srv/frontend
# Some npm dependencies may be sourced from git or require native builds (node-gyp).
RUN apk add --no-cache git python3 make g++
COPY frontend/package.json frontend/package-lock.json /srv/frontend/
RUN npm ci
COPY frontend /srv/frontend/
RUN npm run build


FROM python:3.12-slim

WORKDIR /srv/backend

# Optional but recommended for Chinese watermark rendering in containers.
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /srv/backend/requirements.txt
RUN pip install --no-cache-dir -r /srv/backend/requirements.txt

COPY backend/app /srv/backend/app
COPY backend/scripts /srv/backend/scripts
COPY --from=frontend_build /srv/frontend/dist /srv/frontend/dist

ENV PYTHONPATH=/srv/backend
ENV FRONTEND_DIST_DIR=/srv/frontend/dist

# Cloud Run will route to $PORT (defaults to 8080). We honor it in CMD below.
EXPOSE 8080

CMD ["sh", "-c", "python -m uvicorn app.unified_app:app --host 0.0.0.0 --port ${PORT:-8080}"]
