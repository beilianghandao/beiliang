#!/bin/sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "需要先安装 Node.js：https://nodejs.org"
  exit 1
fi
echo "正在启动 青梧大学 · 校园生活 ..."
node scripts/serve.js
