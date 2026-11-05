#!/usr/bin/env bash
# Starts the detection service on http://127.0.0.1:8830. It needs the Python environment of the port-safety project
# (FastAPI, Ultralytics, OpenCV, yt-dlp); point QAVACH_PYTHON elsewhere if yours lives somewhere else.
cd "$(dirname "$0")"
PY="${QAVACH_PYTHON:-$HOME/Documents/port-safety /barge-intrusion/.venv/bin/python}"
exec "$PY" -m qavach.server "$@"
