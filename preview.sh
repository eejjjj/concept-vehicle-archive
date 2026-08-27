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

echo ""
echo "Preview: http://localhost:${PORT}/"
echo ""

LAN_IPS="$(ifconfig 2>/dev/null | awk '/inet / && $2 != "127.0.0.1" {print $2}')"
if [ -n "$LAN_IPS" ]; then
  echo "Mobile (same WiFi):"
  while IFS= read -r ip; do
    [ -z "$ip" ] && continue
    echo "  http://${ip}:${PORT}/"
  done <<< "$LAN_IPS"
else
  echo "Mobile: could not detect LAN IP — run: ifconfig | grep 'inet '"
fi

echo ""
echo "手机预览步骤："
echo "  1. 手机与 Mac 连接同一 WiFi（关闭蜂窝数据）"
echo "  2. 在手机浏览器打开上方 http://<IP>:${PORT}/ 链接"
echo "  3. 若无法访问：系统设置 → 网络 → 防火墙 → 允许 Python 入站"
echo "     或临时关闭防火墙后再试"
echo ""
echo "吹气交互（麦克风）:"
echo "  LAN 的 http:// 地址无法弹出麦克风授权（浏览器限制）"
echo "  请用 HTTPS 隧道，另开终端运行:"
echo "  npx localtunnel --port ${PORT}"
echo "  手机打开输出的 https:// 链接，轻触屏幕授权麦克风"
echo ""

exec python3 -m http.server "$PORT" --bind 0.0.0.0
