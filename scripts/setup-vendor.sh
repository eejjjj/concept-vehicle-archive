#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE="$ROOT/vendor/three"
VER="0.170.0"
CDN="https://cdn.jsdelivr.net/npm/three@${VER}"

mkdir -p "$BASE/build" "$BASE/examples/jsm/loaders" "$BASE/examples/jsm/environments"

curl -fsSL "$CDN/build/three.module.js" -o "$BASE/build/three.module.js"
curl -fsSL "$CDN/examples/jsm/loaders/RGBELoader.js" -o "$BASE/examples/jsm/loaders/RGBELoader.js"
curl -fsSL "$CDN/examples/jsm/environments/RoomEnvironment.js" -o "$BASE/examples/jsm/environments/RoomEnvironment.js"

echo "Three.js ${VER} vendored to vendor/three/"
