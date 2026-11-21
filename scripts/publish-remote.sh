#!/usr/bin/env bash
# 手动把已签名的 xpi 和 updates.json 推到 sxyz.dev（不走 GitHub Actions 时用）。
#
# 用法:
#   scripts/publish-remote.sh                 # 用 dist/ 里当前版本的 xpi
#   scripts/publish-remote.sh path/to.xpi     # 指定签名包
#
# 需要先设：DSH_UPDATE_HOST（ssh 主机或别名）、DSH_UPDATE_PATH（服务器上的发布目录）
# 可选：    DSH_UPDATE_BASE（公开地址前缀，默认 https://sxyz.dev/dl/dsh-use-firefox/）
set -euo pipefail

host=${DSH_UPDATE_HOST:?请设置 DSH_UPDATE_HOST（ssh 主机或别名）}
target=${DSH_UPDATE_PATH:?请设置 DSH_UPDATE_PATH（服务器上的发布目录）}
base=${DSH_UPDATE_BASE:-https://sxyz.dev/dl/dsh-use-firefox/}

root=$(cd "$(dirname "$0")/.." && pwd)
version=$(node -p "require('${root}/extension/manifest.json').version")
xpi=${1:-${root}/dist/dsh_use_firefox-${version}.xpi}

if [ ! -f "$xpi" ]; then
  echo "找不到签名包：$xpi（先用 web-ext sign 签名，或从 AMO 下载）" >&2
  exit 1
fi

site=$(mktemp -d)
cleanup() { rm -rf "$site"; }
trap cleanup EXIT

cp "$xpi" "${site}/dsh_use_firefox-${version}.xpi"
cp "$xpi" "${site}/dsh_use_firefox.xpi"
node "${root}/scripts/updates.mjs" --version "$version" --out "${site}/updates.json" --base "$base"

ssh "$host" "mkdir -p '${target}'"
rsync -az --delete --chmod=D775,F664 "${site}/" "${host}:${target}/"

echo "已上传 ${version} 到 ${host}:${target}"
curl -fsS "${base}updates.json"
