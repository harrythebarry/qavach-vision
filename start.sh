#!/usr/bin/env bash
# Starts Qavach Safety Intelligence with Docker and prints the address to open.
# It uses port 8830 when that is free, otherwise the next free one, and remembers the choice (.env) so the address stays
# the same next time. If the site is already running it just reports where.
set -e
cd "$(dirname "$0")"

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop, wait until it says it is running, then run this again." >&2
  exit 1
fi

in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

port="$(docker compose port qavach 8830 2>/dev/null | sed 's/.*://' || true)"      # already running: keep its port
if [ -z "$port" ]; then
  preferred="$(sed -n 's/^QAVACH_PORT=//p' .env 2>/dev/null | tail -1)"
  port="${preferred:-8830}"
  tries=0
  while in_use "$port"; do
    port=$((port + 1)); tries=$((tries + 1))
    if [ "$tries" -gt 100 ]; then echo "Could not find a free port near ${preferred:-8830}." >&2; exit 1; fi
  done
fi

printf 'QAVACH_PORT=%s\n' "$port" > .env
echo "Starting Qavach on port $port (the first run builds the image and can take 10-20 minutes)..."
QAVACH_PORT="$port" docker compose up -d --wait
echo
echo "Ready. Open:  http://localhost:$port"
