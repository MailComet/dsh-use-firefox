import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { WebSocket } from 'ws'
import { Bridge } from '../src/bridge.js'

function clientFor(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ext/bridge`)
  const queue = []
  const waiters = []
  ws.on('message', (data) => {
    const message = JSON.parse(data.toString())
    const waiter = waiters.shift()
    if (waiter) waiter(message)
    else queue.push(message)
  })
  const next = () => {
    if (queue.length) return Promise.resolve(queue.shift())
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for bridge message')), 2500)
      waiters.push((message) => {
        clearTimeout(timer)
        resolve(message)
      })
    })
  }
  return { ws, next, open: once(ws, 'open') }
}

function makeBridge(overrides = {}) {
  return new Bridge({
    host: '127.0.0.1',
    port: 0,
    token: 'a'.repeat(64),
    pluginVersion: 'test',
    getWelcome: () => ({ mode: 'full', modeLabel: '完全访问', groupTitle: 'DSH' }),
    ...overrides,
  })
}

const hello = {
  type: 'hello',
  protocol: 'dsh-use-firefox',
  version: 1,
  token: 'a'.repeat(64),
  clientId: 'c1',
  label: 'test-firefox',
  extensionVersion: '0.1.0',
}

test('bridge handshake, host requests, extension requests and events', async (t) => {
  let event = null
  const bridge = makeBridge({
    onEvent: (_client, name, data) => { event = { name, data } },
    onRequest: (_client, op, params) => ({ echoed: op, params }),
  })
  await bridge.start()
  t.after(async () => { await bridge.close() })

  const client = clientFor(bridge.port)
  t.after(() => client.ws.close())
  await client.open
  client.ws.send(JSON.stringify(hello))
  const welcome = await client.next()
  assert.equal(welcome.type, 'welcome')
  assert.equal(welcome.mode, 'full')
  assert.equal(welcome.groupTitle, 'DSH')

  const pending = bridge.request('snapshot', { tabId: 7 })
  const request = await client.next()
  assert.equal(request.type, 'request')
  assert.equal(request.op, 'snapshot')
  client.ws.send(JSON.stringify({ type: 'response', id: request.id, ok: true, data: { title: 'ok' } }))
  assert.deepEqual(await pending, { title: 'ok' })

  client.ws.send(JSON.stringify({ type: 'request', id: 'e1', op: 'mode.set', params: { mode: 'readonly' } }))
  const response = await client.next()
  assert.equal(response.type, 'response')
  assert.equal(response.ok, true)
  assert.equal(response.data.echoed, 'mode.set')

  client.ws.send(JSON.stringify({ type: 'event', event: 'annotation', data: { kind: 'element' } }))
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.deepEqual(event, { name: 'annotation', data: { kind: 'element' } })
  assert.equal(bridge.listClients().length, 1)
  assert.equal(bridge.status().running, true)
})

test('bridge rejects a bad token and a version mismatch', async (t) => {
  const bridge = makeBridge()
  await bridge.start()
  t.after(async () => { await bridge.close() })

  const badToken = clientFor(bridge.port)
  t.after(() => badToken.ws.close())
  await badToken.open
  badToken.ws.send(JSON.stringify({ ...hello, clientId: 'bad-token', token: 'b'.repeat(64) }))
  const tokenError = await badToken.next()
  assert.equal(tokenError.type, 'error')
  assert.equal(tokenError.code, 'BAD_TOKEN')

  const badVersion = clientFor(bridge.port)
  t.after(() => badVersion.ws.close())
  await badVersion.open
  badVersion.ws.send(JSON.stringify({ ...hello, clientId: 'bad-version', version: 999 }))
  const versionError = await badVersion.next()
  assert.equal(versionError.type, 'error')
  assert.equal(versionError.code, 'VERSION_MISMATCH')
})
