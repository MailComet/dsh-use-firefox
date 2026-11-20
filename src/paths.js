import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export function resolveBrowserHome(configured) {
  const raw = configured && String(configured).trim()
    ? String(configured).trim()
    : join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'browser')
  const expanded = raw.startsWith('~') ? join(homedir(), raw.slice(1)) : raw
  return resolve(expanded)
}

export async function ensureDirs(home) {
  await mkdir(home, { recursive: true })
  await mkdir(join(home, 'screenshots'), { recursive: true })
  await mkdir(join(home, 'annotations'), { recursive: true })
}

export async function ensureToken(home) {
  const file = join(home, 'ext-token')
  try {
    const token = (await readFile(file, 'utf8')).trim()
    if (/^[a-f0-9]{64}$/i.test(token)) return token
  } catch { /* generate below */ }
  const token = randomBytes(32).toString('hex')
  await writeFile(file, `${token}\n`, { mode: 0o600 })
  await chmod(file, 0o600).catch(() => {})
  return token
}

export async function readState(home) {
  try {
    const state = JSON.parse(await readFile(join(home, 'state.json'), 'utf8'))
    return state && typeof state === 'object' ? state : {}
  } catch {
    return {}
  }
}

export async function writeState(home, state) {
  const file = join(home, 'state.json')
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  await rename(tmp, file)
}

export async function appendJsonl(file, value) {
  await mkdir(dirname(file), { recursive: true })
  const line = `${JSON.stringify(value)}\n`
  const { appendFile } = await import('node:fs/promises')
  await appendFile(file, line, { encoding: 'utf8', mode: 0o600 })
}

export function tokenPath(home) {
  return join(home, 'ext-token')
}

export function auditPath(home) {
  return join(home, 'audit.jsonl')
}

export function annotationsPath(home) {
  return join(home, 'annotations', 'annotations.jsonl')
}

export function screenshotsDir(home) {
  return join(home, 'screenshots')
}
