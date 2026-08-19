#!/usr/bin/env bash
# 飞行棋 · 一键重连随机隧道
# 用法: ./relink.sh   -> 检查服务器、杀旧隧道、起新隧道、输出新链接
set -u
cd "$(dirname "$0")"

PORT=3000

# 1) 确保游戏服务器在跑
if ! curl -s -o /dev/null --max-time 3 "http://127.0.0.1:$PORT/"; then
  echo "启动游戏服务器 (PORT=$PORT)..."
  (PORT=$PORT node server/index.js >/tmp/fc_srv.log 2>&1 &)
  sleep 1.5
else
  echo "服务器已在跑 (PORT=$PORT)"
fi

# 2) 杀掉旧隧道
pkill -f "localhost.run" 2>/dev/null || true
sleep 1

# 3) 起新隧道（匿名 nokey 模式：每次重连给全新的随机子域名，符合"每次重新生成"需求）
echo "建立新隧道(匿名随机子域名)..."
ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 \
  -R 80:localhost:$PORT nokey@localhost.run > /tmp/tunnel_relink.log 2>&1 &
sleep 7

# 4) 抓链接
U="$(grep -oE "https://[a-z0-9]+\.lhr\.life" /tmp/tunnel_relink.log | head -1)"
if [ -z "$U" ]; then
  echo "✗ 未拿到链接，隧道日志："
  tail -12 /tmp/tunnel_relink.log
  exit 1
fi

# 5) 探测可用性
C="000"
for i in 1 2 3 4 5; do
  sleep 3
  C="$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$U" 2>/dev/null)"
  [ "$C" = "200" ] && break
done

echo "==================================="
echo " 新链接: $U"
echo " 状态:   HTTP $C"
echo "==================================="
[ "$C" = "200" ] && echo "✓ 可用" || echo "✗ 仍未通，稍后重试或查日志"
