import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  annotationsPath,
  appendJsonl,
  ensureDirs,
  ensureToken,
  readState,
  tokenPath,
  writeState,
} from '../src/paths.js'

test('home directories, token permissions, state and JSONL logs', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'dshuf-paths-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  await ensureDirs(home)

  const first = await ensureToken(home)
  const second = await ensureToken(home)
  assert.match(first, /^[a-f0-9]{64}$/)
  assert.equal(first, second)
  assert.equal((await stat(tokenPath(home))).mode & 0o777, 0o600)

  await writeState(home, { mode: 'readonly', updatedAt: 'now' })
  assert.deepEqual(await readState(home), { mode: 'readonly', updatedAt: 'now' })

  await appendJsonl(annotationsPath(home), { id: 'a1' })
  await appendJsonl(annotationsPath(home), { id: 'a2' })
  const lines = (await readFile(annotationsPath(home), 'utf8')).trim().split('\n')
  assert.equal(lines.length, 2)
  assert.deepEqual(JSON.parse(lines[0]), { id: 'a1' })
})
