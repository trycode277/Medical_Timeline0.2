# syntax=docker/dockerfile:1.7

# ---------- Stage 1: build the virtualenv ----------
FROM python:3.12-slim AS builder
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /build
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY requirements.txt .
RUN pip install -r requirements.txt

# ---------- Stage 2: slim runtime ----------
FROM python:3.12-slim AS runtime
# Tesseract language packs by Debian suffix, e.g. "eng" or "eng,spa,deu"
ARG OCR_LANGS=eng
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    UPLOAD_DIR=/data/uploads \
    WEB_CONCURRENCY=2

RUN set -eux; \
    packs=""; \
    for l in $(echo "$OCR_LANGS" | tr ',+' '  '); do packs="$packs tesseract-ocr-$l"; done; \
    apt-get update; \
    apt-get install -y --no-install-recommends tesseract-ocr $packs; \
    rm -rf /var/lib/apt/lists/*

# Non-root user; /data/uploads is owned by it so a fresh named volume inherits that
RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home /app --shell /usr/sbin/nologin app \
    && mkdir -p /data/uploads /app \
    && chown -R app:app /data /app

WORKDIR /app
COPY --from=builder /opt/venv /opt/venv
COPY --chown=app:app app ./app
USER app

EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"

# Runs behind the nginx container, so trust its X-Forwarded-* headers
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${WEB_CONCURRENCY} --proxy-headers --forwarded-allow-ips='*'"]
