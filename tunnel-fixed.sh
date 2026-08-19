#!/usr/bin/env bash
# 飞行棋 · 固定子域名隧道（localhost.run）
#
# 前置条件（一次性）：
#   1. 注册免费账号 https://admin.localhost.run/
#   2. 把 .tunnel/lhr_key.pub 的内容贴到账号的 SSH Keys 里
#   3. 在账号里预约一个子域名，例如 feixingqi（会得到 feixingqi.lhr.life）
#
# 用法：
#   SUBDOMAIN=feixingqi ./tunnel-fixed.sh
#
# 效果：服务器在本机 3000 端口启动，并通过隧道暴露为固定域名
#   https://<SUBDOMAIN>.lhr.life
# 关掉本终端 / 关机，链接才断；期间重连域名不变。
set -e

SUBDOMAIN="${SUBDOMAIN:?请先设置 SUBDOMAIN，例如: SUBDOMAIN=feixingqi ./tunnel-fixed.sh}"
PORT="${PORT:-3000}"
DIR="$(cd "$(dirname "$0")" && pwd)"
KEY="$DIR/.tunnel/lhr_key"

if [ ! -f "$KEY" ]; then
  echo "缺少私钥 $KEY，请先生成密钥对（ssh-keygen -t ed25519 -f .tunnel/lhr_key -N ''）"
  exit 1
fi

# 1) 启动游戏服务器
(PORT="$PORT" node "$DIR/server/index.js" >/tmp/fc_srv.log 2>&1 &)
sleep 1.5
echo "游戏服务器已启动: http://localhost:$PORT"

# 2) 建立固定子域名隧道
echo "正在建立固定子域名: https://$SUBDOMAIN.lhr.life"
echo "(若提示权限拒绝，请确认已把 .tunnel/lhr_key.pub 贴到 localhost.run 账号并已预约该子域名)"
ssh -i "$KEY" -o StrictHostKeyChecking=no -o ServerAliveInterval=30 \
  -R "$SUBDOMAIN:80:localhost:$PORT" "$SUBDOMAIN@localhost.run"
