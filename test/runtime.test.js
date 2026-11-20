import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createRuntime } from '../src/runtime.js'
import { readState } from '../src/paths.js'

function fakeContext() {
  return {
    logger: { info() {}, warn() {}, debug() {} },
    get() { return undefined },
  }
}

test('runtime mode persistence, annotation queue and followup', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'dshuf-runtime-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const runtime = await createRuntime(fakeContext(), {
    home,
    mode: 'full',
    bridgePort: 0,
    audit: false,
  })
  t.after(() => runtime.dispose())

  assert.equal(runtime.mode, 'full')
  runtime.setMode('readonly')
  await runtime.persistState()
  assert.equal((await readState(home)).mode, 'readonly')
  assert.throws(() => runtime.setMode('nonsense'), /未知模式/)

  const message = { id: 'm1', content: 'queued' }
  runtime.deliverUserMessage(message, 'test')
  const pending = runtime.takePendingAnnotations({ id: 'agent-1', session: { id: 's1' } })
  assert.deepEqual(pending, [message])

  let delivered = null
  const agent = {
    id: 'agent-2',
    session: { id: 's2' },
    followup(value) { delivered = value },
  }
  runtime.noteAgent(agent)
  runtime.deliverUserMessage({ id: 'm2' }, 'test')
  assert.equal(delivered.id, 'm2')

  const status = runtime.status()
  assert.equal(status.mode, 'readonly')
  assert.equal(status.groupTitle, 'DSH')
  assert.match(runtime.statusText(), /mode: 只读取/)
})
