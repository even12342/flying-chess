#!/usr/bin/env bash
# 通过 GitHub Contents API 上传 flying-chess 源码(文件body走临时文件, 可断点续传)
set -u

TOKEN="${TOKEN:?需要环境变量 TOKEN}"
REPO="${REPO:-flying-chess}"
BRANCH="${BRANCH:-main}"
SRC="$(cd "$(dirname "$0")" && pwd)"
API="https://api.github.com"
AUTH="Authorization: Bearer $TOKEN"
BODY="$(mktemp)"

echo "=== 1) 验证令牌 ==="
USER_JSON="$(curl -s -H "$AUTH" "$API/user")"
LOGIN="$(echo "$USER_JSON" | grep -oE '"login"\s*:\s*"[^"]+"' | head -1 | sed -E 's/.*"login"\s*:\s*"([^"]+)".*/\1/')"
if [ -z "$LOGIN" ]; then echo "✗ 令牌无效:"; echo "$USER_JSON" | head -20; exit 1; fi
echo "✓ 登录为: $LOGIN"

echo "=== 2) 收集文件(排除 node_modules/.git/.tunnel) ==="
FILES="$(cd "$SRC" && find . -type f \
  -not -path './node_modules/*' \
  -not -path './.git/*' \
  -not -path './.tunnel/*' \
  | sed 's|^\./||' | sort)"
COUNT="$(echo "$FILES" | grep -c .)"
echo "• 待上传: $COUNT 个文件"

upload_one() {
  local f="$1"
  local F_ESC="$(echo "$f" | sed 's/"/\\"/g')"
  local CONTENT_B64="$(base64 -w0 "$SRC/$f")"
  # 写 body 到临时文件, 避免超长命令行
  printf '{"message":"add %s","content":"%s","branch":"%s"}' "$F_ESC" "$CONTENT_B64" "$BRANCH" > "$BODY"
  local RES CODE
  RES="$(curl -s -w "\n%{http_code}" -X PUT -H "$AUTH" -H "Content-Type: application/json" \
    --data-binary "@$BODY" \
    "$API/repos/$LOGIN/$REPO/contents/$F_ESC")"
  CODE="$(echo "$RES" | tail -1)"
  if [ "$CODE" = "201" ] || [ "$CODE" = "200" ]; then
    return 0
  fi
  # 409 = 已存在但没带 sha; 取 sha 后重试
  if [ "$CODE" = "409" ]; then
    local SHA="$(echo "$RES" | grep -oE '"sha"\s*:\s*"[^"]+"' | head -1 | sed -E 's/.*"sha"\s*:\s*"([^"]+)".*/\1/')"
    if [ -z "$SHA" ]; then
      # 通过 GET 拿 sha
      SHA="$(curl -s -H "$AUTH" "$API/repos/$LOGIN/$REPO/contents/$F_ESC?ref=$BRANCH" | grep -oE '"sha"\s*:\s*"[^"]+"' | head -1 | sed -E 's/.*"sha"\s*:\s*"([^"]+)".*/\1/')"
    fi
    printf '{"message":"add %s","content":"%s","branch":"%s","sha":"%s"}' "$F_ESC" "$CONTENT_B64" "$BRANCH" "$SHA" > "$BODY"
    RES="$(curl -s -w "\n%{http_code}" -X PUT -H "$AUTH" -H "Content-Type: application/json" \
      --data-binary "@$BODY" "$API/repos/$LOGIN/$REPO/contents/$F_ESC")"
    CODE="$(echo "$RES" | tail -1)"
    if [ "$CODE" = "200" ] || [ "$CODE" = "201" ] || [ "$CODE" = "422" ]; then
      return 0   # 422 = 内容未变, 视为已就位
    fi
  fi
  if [ "$CODE" = "422" ]; then return 0; fi
  echo "    DEBUG[$f] -> $CODE"; echo "$RES" | head -3
  return 1
}

echo "=== 3) 逐文件上传 ==="
OK=0; FAIL=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if upload_one "$f"; then
    OK=$((OK+1)); echo "  + [$OK] $f"
  else
    FAIL=$((FAIL+1)); echo "  ✗ $f"
    if [ "$FAIL" -ge 5 ]; then echo "✗ 失败过多，停止"; rm -f "$BODY"; exit 1; fi
  fi
done <<< "$FILES"
rm -f "$BODY"

echo ""
echo "🎉 完成! 成功 $OK / 失败 $FAIL"
echo "仓库: https://github.com/$LOGIN/$REPO (分支 $BRANCH)"
