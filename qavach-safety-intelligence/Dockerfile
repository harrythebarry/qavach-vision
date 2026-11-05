# Qavach Safety Intelligence: the console and the detection service in one image.
#   docker compose up -d      (from the repository root; see docker-compose.yml)
# Everything the models need is inside: CPU PyTorch, YOLO11s and OSNet weights (backend/weights), BoxMOT, yt-dlp.

# --- 1. build the console (React) ------------------------------------------------------------------------------
FROM node:22-slim AS web
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# --- 2. the detection service and its tracker environment ----------------------------------------------------------
FROM python:3.12-slim-bookworm
# libgl1 and libglib2.0-0 are what OpenCV needs on a slim image; ffmpeg lets OpenCV read RTSP and HLS streams.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Two environments, as in the port-safety project: the service (detector) and the tracker worker (BoxMOT).
# --extra-index-url gives the CPU build of torch (about 200 MB) instead of the CUDA one (about 2.5 GB).
COPY backend/requirements.txt backend/requirements-tracker.txt /tmp/
RUN python -m venv /opt/service \
    && /opt/service/bin/pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r /tmp/requirements.txt \
    && python -m venv /opt/tracker \
    && /opt/tracker/bin/pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r /tmp/requirements-tracker.txt

WORKDIR /app/backend
COPY backend/qavach ./qavach
COPY backend/weights ./weights
COPY --from=web /web/dist /app/dist

ENV QAVACH_HOST=0.0.0.0 \
    QAVACH_DATA=/data \
    QAVACH_WEB=/app/dist \
    QAVACH_TRACKER_PYTHON=/opt/tracker/bin/python \
    PYTHONUNBUFFERED=1 \
    YOLO_CONFIG_DIR=/tmp/ultralytics
VOLUME /data
EXPOSE 8830
HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=5 \
    CMD ["/opt/service/bin/python", "-c", "import urllib.request,sys; sys.exit(0 if b'\"ok\":true' in urllib.request.urlopen('http://127.0.0.1:8830/api/health', timeout=4).read() else 1)"]
CMD ["/opt/service/bin/python", "-m", "qavach.server", "--port", "8830"]
