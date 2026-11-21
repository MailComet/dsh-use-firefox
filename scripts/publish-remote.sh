#!/usr/bin/env bash
# 手动把已签名的 xpi、未签名 zip 和 updates.json 推到 sxyz.dev（不走 GitHub Actions 时用）。
#
# 用法:
#   scripts/publish-remote.sh                 # 用 dist/ 里当前版本的 xpi
#   scripts/publish-remote.sh path/to.xpi     # 指定签名包
#
# 需要先设：DSH_UPDATE_HOST（ssh 主机或别名）、DSH_UPDATE_PATH（服务器上的 Firefox 扩展发布目录）
# 可选：    DSH_UPDATE_BASE（公开地址前缀，默认 https://sxyz.dev/dl/firefox/dsh-use-firefox/）
set -euo pipefail

host=${DSH_UPDATE_HOST:?请设置 DSH_UPDATE_HOST（ssh 主机或别名）}
target=${DSH_UPDATE_PATH:?请设置 DSH_UPDATE_PATH（服务器上的 Firefox 扩展发布目录）}
base=${DSH_UPDATE_BASE:-https://sxyz.dev/dl/firefox/dsh-use-firefox/}
base=${base%/}/

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

zip=${root}/dist/dsh_use_firefox-${version}.zip
if [ -f "$zip" ]; then
  cp "$zip" "${site}/dsh_use_firefox-${version}.zip"
  cp "$zip" "${site}/dsh_use_firefox.zip"
fi

node "${root}/scripts/updates.mjs" --version "$version" --out "${site}/updates.json" --base "$base"

ssh "$host" "mkdir -p '${target}'"
# 不加 --delete：保留历史版本 xpi/zip，版本化地址才能长期可用。
rsync -az --chmod=D775,F664 "${site}/" "${host}:${target}/"

# 校验和覆盖目录里的全部版本，而不只是这一次上传的文件。
ssh "$host" "cd '${target}' && { for f in *.xpi *.zip updates.json; do [ -f \"\$f\" ] && sha256sum \"\$f\"; done; } > SHA256SUMS"

echo "已上传 ${version} 到 ${host}:${target}"
curl -fsS "${base}updates.json"
