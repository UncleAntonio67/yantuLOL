FROM python:3.12-slim

WORKDIR /srv/backend

# Optional but recommended for Chinese watermark rendering in containers.
# If you prefer a smaller image, remove this and mount a font via WATERMARK_FONT_FILE.
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /srv/backend/requirements.txt
RUN pip install --no-cache-dir -r /srv/backend/requirements.txt

COPY app /srv/backend/app

ENV PYTHONPATH=/srv/backend
EXPOSE 8000

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

