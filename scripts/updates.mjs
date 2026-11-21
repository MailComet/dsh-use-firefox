#!/usr/bin/env node
/**
 * 生成 AMO 自动更新清单（update manifest）。
 *
 * Firefox 会定期请求 manifest 里 `browser_specific_settings.gecko.update_url`
 * 指向的 JSON，发现更高版本就去 `update_link` 下载已签名的 xpi。
 *
 * 用法：
 *   node scripts/updates.mjs                          # 用 manifest.json 的版本，输出到 dist/updates.json
 *   node scripts/updates.mjs --version 0.4.8          # 指定版本
 *   node scripts/updates.mjs --out site/updates.json   # 指定输出路径
 *   node scripts/updates.mjs --base https://example.com/dsh-use-firefox/
 *
 * 只输出“当前最新版本”一条：Firefox 对任意低于它的已安装版本都会升级到这一条，
 * 而站点上只保留最新的 xpi，避免历史条目指向已删除的文件。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const DEFAULT_BASE = 'https://sxyz.dev/dl/dsh-use-firefox/'

function readArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      out[key] = next
      i += 1
    } else {
      out[key] = true
    }
  }
  return out
}

const args = readArgs(process.argv.slice(2))
const manifestPath = resolve(root, args.manifest || 'extension/manifest.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const addonId = manifest.browser_specific_settings?.gecko?.id
if (!addonId) throw new Error(`${manifestPath} 里没有 browser_specific_settings.gecko.id`)

const version = String(args.version || manifest.version)
const base = String(args.base || DEFAULT_BASE).replace(/\/+$/, '/')
const updateLink = String(args.link || `${base}dsh_use_firefox-${version}.xpi`)
const out = resolve(root, args.out || 'dist/updates.json')

const payload = {
  addons: {
    [addonId]: {
      updates: [{ version, update_link: updateLink }],
    },
  },
}

await mkdir(dirname(out), { recursive: true })
await writeFile(out, `${JSON.stringify(payload, null, 2)}\n`)
console.log(`wrote ${out}`)
