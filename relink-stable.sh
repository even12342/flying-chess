#!/usr/bin/env bash
# 飞行棋 · 稳定重连（key 隧道 + 心跳保活，链接基本固定，适合长时间玩）
# 用法: ./relink-stable.sh
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

# 3) 起 key 隧道（认证用户，比匿名稳定；子域名会粘在账号上 = 基本固定）
echo "建立稳定隧道(key 登录)..."
ssh -i .tunnel/lhr_key -o StrictHostKeyChecking=no -o ServerAliveInterval=30 \
  -R 80:localhost:$PORT feixingqi@localhost.run > /tmp/tunnel_stable.log 2>&1 &
sleep 7

# 4) 抓链接（循环等待，key 隧道建立可能稍慢，最多等约 30s）
U=""
for i in $(seq 1 15); do
  U="$(grep -oE "https://[a-z0-9]+\.lhr\.life" /tmp/tunnel_stable.log | head -1)"
  [ -n "$U" ] && break
  sleep 2
done
if [ -z "$U" ]; then
  echo "✗ 未拿到链接，隧道日志："
  tail -12 /tmp/tunnel_stable.log
  exit 1
fi

# 5) 探测
C="000"
for i in 1 2 3 4 5; do
  sleep 3
  C="$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$U" 2>/dev/null)"
  [ "$C" = "200" ] && break
done

echo "==================================="
echo " 稳定链接: $U"
echo " 状态:     HTTP $C"
echo "==================================="

# 6) 心跳保活：每 20s 请求一次本地服务，防止隧道因空闲被断开
echo "启动心跳保活(每20s)..."
nohup bash -c "while true; do curl -s -o /dev/null http://127.0.0.1:$PORT/ ; sleep 20; done" >/tmp/keepalive.log 2>&1 &
echo "✓ 完成"
