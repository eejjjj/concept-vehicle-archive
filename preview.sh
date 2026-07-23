#!/usr/bin/env bash
cd "$(dirname "$0")"
PORT="${1:-8765}"

if [ ! -f "vendor/three/build/three.module.js" ]; then
  echo "Downloading Three.js (first run only)..."
  bash scripts/setup-vendor.sh
fi

echo "Preview: http://localhost:${PORT}/index.html?reset=1"
python3 -m http.server "$PORT"
