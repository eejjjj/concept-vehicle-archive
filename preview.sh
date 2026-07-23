#!/usr/bin/env bash
cd "$(dirname "$0")"
PORT="${1:-8765}"

if [ ! -f "vendor/three/build/three.module.js" ]; then
  echo "Downloading Three.js (first run only)..."
  bash scripts/setup-vendor.sh
fi

if command -v lsof >/dev/null 2>&1; then
  OLD_PID="$(lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1)"
  if [ -n "$OLD_PID" ]; then
    echo "Port ${PORT} busy (pid ${OLD_PID}) — stopping old server..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 0.4
  fi
fi

echo "Preview: http://localhost:${PORT}/index/"
exec python3 -m http.server "$PORT"
