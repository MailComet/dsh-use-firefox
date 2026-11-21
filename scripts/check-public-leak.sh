#!/usr/bin/env bash
# 扫描将要公开的文件里是否混入了基础设施细节。
# 用法: scripts/check-public-leak.sh [目录，默认仓库根]
# 退出码: 0 干净；1 命中；2 用法错误
set -uo pipefail

root=${1:-.}
cd "$root" || exit 2

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "不是 git 仓库: $root" >&2
  exit 2
fi

# 只扫会被公开的文本文件
mapfile -t files < <(git ls-files | grep -Ev '^(dist/|node_modules/)' \
  | grep -E '\.(md|markdown|txt|yml|yaml|sh|json|js|mjs|cjs|ts|html|css|svg)$')
[ ${#files[@]} -eq 0 ] && { echo "没有可扫描的文件"; exit 0; }

hits=0
report() { # $1 规则名, $2 命中行
  hits=$((hits + 1))
  printf '✗ %s\n%s\n\n' "$1" "$2"
}

# 1) 真实 IPv4：回环、未指定、文档保留段放行
mapfile -t ips < <(git grep -hoE '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b' -- "${files[@]}" 2>/dev/null \
  | grep -Ev '^(0\.0\.0\.0|127\.[0-9.]+|203\.0\.113\.[0-9]+|192\.0\.2\.[0-9]+|198\.51\.100\.[0-9]+)$' | sort -u)
for ip in "${ips[@]}"; do
  [ -z "$ip" ] && continue
  report "真实 IP 地址: $ip" "$(git grep -nF "$ip" -- "${files[@]}" | head -3)"
done

# 2) 服务器真实目录
mapfile -t paths < <(git grep -hoE '(/srv|/home|/var/www)/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*' -- "${files[@]}" 2>/dev/null | sort -u)
for p in "${paths[@]}"; do
  [ -z "$p" ] && continue
  report "服务器路径: $p" "$(git grep -nF "$p" -- "${files[@]}" | head -3)"
done

# 3) ssh 用户名@主机 形式
mapfile -t sshs < <(git grep -hoE 'ssh +[a-z_][a-z0-9_-]*@[A-Za-z0-9.-]+' -- "${files[@]}" 2>/dev/null | sort -u)
for s in "${sshs[@]}"; do
  [ -z "$s" ] && continue
  report "ssh 目标: $s" "$(git grep -nF "$s" -- "${files[@]}" | head -3)"
done

# 4) 私钥与常见凭据前缀
mapfile -t keys < <(git grep -nE 'BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}' -- "${files[@]}" 2>/dev/null)
for k in "${keys[@]}"; do
  [ -z "$k" ] && continue
  report "疑似凭据" "$k"
done

if [ "$hits" -gt 0 ]; then
  printf '发现 %d 处疑似泄漏，请改成占位符（如 <你的服务器地址> / 203.0.113.10）。\n' "$hits"
  exit 1
fi

echo "✓ 未发现基础设施细节泄漏"
