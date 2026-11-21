import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createRuntime } from '../src/runtime.js'
import { registerAnnotationRoutes } from '../src/routes.js'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function fakeContext() {
  return { logger: { info() {}, warn() {}, debug() {} }, get() { return undefined } }
}

async function makeRuntime(t) {
  const home = await mkdtemp(join(tmpdir(), 'dshuf-annotation-'))
  const runtime = await createRuntime(fakeContext(), { home, mode: 'full', bridgePort: 0, audit: false })
  t.after(async () => {
    await runtime.dispose()
    await rm(home, { recursive: true, force: true })
  })
  return { home, runtime }
}

function payload(overrides = {}) {
  return {
    kind: 'element',
    comment: '这个按钮太靠右了',
    selector: '#save',
    tag: 'button',
    text: '保存',
    page: { url: 'https://example.com/form', title: '表单' },
    details: { color: 'rgb(17, 24, 39)' },
    rect: { x: 10, y: 20, width: 100, height: 30 },
    pageRect: { x: 10, y: 120, width: 100, height: 30 },
    viewport: { width: 1280, height: 800, dpr: 1 },
    imageDataUrl: PNG,
    ...overrides,
  }
}

test('user annotations are queued, acknowledged and readable by the client', async (t) => {
  const { home, runtime } = await makeRuntime(t)
  runtime.setFocusedSession('session-a')
  const created = await runtime.createAnnotation(null, payload())
  assert.equal(created.seq, 1)
  assert.equal(created.label, '网页注释 1')
  assert.equal(created.queued, true)
  assert.equal(created.sessionId, 'session-a')

  const image = await readFile(join(home, 'annotations', `${created.id}.png`))
  assert.ok(image.length > 0)

  const first = runtime.queueAnnotations('session-a')
  assert.equal(first.length, 1)
  assert.equal(first[0].label, '网页注释 1')
  assert.equal(first[0].comment, '这个按钮太靠右了')
  assert.match(first[0].imageUrl, /^\/ext\/use-firefox\/image\?id=/)

  // Polling before the client acknowledges must keep returning the item.
  const repeated = runtime.queueAnnotations('session-a')
  assert.equal(repeated.length, 1)

  runtime.ackAnnotations([created.id])
  assert.equal(runtime.queueAnnotations('session-a').length, 0)
  assert.equal(runtime.annotationItem(created.id).label, '网页注释 1')
  assert.match(runtime.annotationImage(created.id), /annotations\/.*\.png$/)

  const updated = await runtime.updateAnnotation(created.id, '改过的评论')
  assert.equal(updated.comment, '改过的评论')
  assert.equal(runtime.annotationItem(created.id).comment, '改过的评论')
  assert.equal(updated.sent, false)

  const removed = await runtime.deleteAnnotation(created.id)
  assert.equal(removed.deleted, true)
  assert.equal(runtime.annotationItem(created.id), null)
  assert.equal(runtime.annotationImage(created.id), null)
})

test('annotation records and sent state survive a host restart', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dshuf-annotation-reload-'))
  const first = await createRuntime(fakeContext(), { home, mode: 'full', bridgePort: 0, audit: false })
  try {
    first.setFocusedSession('session-a')
    const created = await first.createAnnotation(null, payload())
    first.ackAnnotations([created.id])
    await first.prepareAnnotationMentions([{
      role: 'user',
      content: [{ type: 'text', text: `@[网页注释 1](dsh-anno:${created.id})` }],
    }])
    assert.equal(first.annotationItem(created.id).sent, true)
  } finally {
    await first.dispose()
  }

  const second = await createRuntime(fakeContext(), { home, mode: 'full', bridgePort: 0, audit: false })
  try {
    const records = [...second.annotations.values()]
    assert.equal(records.length, 1)
    assert.equal(records[0].sent, true)
    assert.equal(records[0].comment, '这个按钮太靠右了')
    assert.equal(second.queueAnnotations('session-a').length, 0)
    assert.ok(second.annotationItem(records[0].id))
    assert.match(second.annotationImage(records[0].id), /annotations\/.*\.png$/)
  } finally {
    await second.dispose()
    await rm(home, { recursive: true, force: true })
  }
})

test('queued annotations bind to the first focused session and filter others', async (t) => {
  const { runtime } = await makeRuntime(t)
  const created = await runtime.createAnnotation(null, payload({ comment: '没有会话' }))
  assert.equal(created.sessionId, null)
  assert.equal(runtime.queueAnnotations('session-b').length, 1)
  assert.equal(runtime.queueAnnotations('session-c').length, 0)
})

test('pre-step attaches one user context for each annotation mention', async (t) => {
  const { runtime } = await makeRuntime(t)
  runtime.setFocusedSession('session-a')
  const created = await runtime.createAnnotation(null, payload())
  runtime.queueAnnotations('session-a')
  runtime.ackAnnotations([created.id])

  const user = {
    role: 'user',
    content: [{ type: 'text', text: `请看一下\n@[网页注释 1](dsh-anno:${created.id})` }],
  }
  const messages = await runtime.prepareAnnotationMentions([user])
  assert.equal(messages.length, 2)
  assert.equal(messages[0], user)
  const context = messages[1]
  assert.equal(context.role, 'user')
  const text = context.content.map((block) => block.text).join('\n')
  assert.match(text, /【网页注释】/)
  assert.match(text, /这个按钮太靠右了/)
  assert.match(text, /https:\/\/example\.com\/form/)
  assert.match(text, /annotations\/.*\.png/)

  const again = await runtime.prepareAnnotationMentions([...messages])
  assert.equal(again.length, messages.length)
  assert.equal(runtime.annotationItem(created.id).label, '网页注释 1')
})

test('annotation routes expose queue, ack, focus, item and image', async (t) => {
  const { runtime } = await makeRuntime(t)
  runtime.setFocusedSession('session-a')
  const created = await runtime.createAnnotation(null, payload())

  const routes = new Map()
  const dispose = registerAnnotationRoutes({
    register(route) {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  }, runtime)

  async function call(path, { method = 'GET', url = path, body = '' } = {}) {
    const handler = routes.get(`/ext/use-firefox${path}`)
    assert.ok(handler, `missing route ${path}`)
    const request = {
      method,
      url,
      async *[Symbol.asyncIterator]() {
        if (body) yield Buffer.from(body)
      },
    }
    let status = 0
    let headers = {}
    let responseBody = Buffer.alloc(0)
    await handler.handler(request, {
      writeHead(nextStatus, nextHeaders) { status = nextStatus; headers = nextHeaders },
      end(chunk) { if (chunk) responseBody = Buffer.concat([responseBody, Buffer.from(chunk)]) },
    })
    return { status, headers, body: responseBody }
  }

  const queue = await call('/queue', { url: '/ext/use-firefox/queue?session=session-a' })
  assert.equal(queue.status, 200)
  const items = JSON.parse(queue.body.toString()).items
  assert.equal(items.length, 1)

  const item = await call('/item', { url: `/ext/use-firefox/item?id=${created.id}` })
  assert.equal(JSON.parse(item.body.toString()).item.id, created.id)

  const image = await call('/image', { url: `/ext/use-firefox/image?id=${created.id}` })
  assert.equal(image.status, 200)
  assert.equal(image.headers['content-type'], 'image/png')
  assert.ok(image.body.length > 0)

  const focus = await call('/focus', { method: 'POST', body: JSON.stringify({ sessionId: 'session-b' }) })
  assert.equal(focus.status, 200)

  const updated = await call('/update', {
    method: 'POST',
    body: JSON.stringify({ id: created.id, comment: '通过路由改评论' }),
  })
  assert.equal(updated.status, 200)
  assert.equal(JSON.parse(updated.body.toString()).item.comment, '通过路由改评论')

  const ack = await call('/queue/ack', { method: 'POST', body: JSON.stringify({ ids: [created.id] }) })
  assert.equal(ack.status, 200)
  assert.equal(runtime.queueAnnotations('session-b').length, 0)
  dispose()
  assert.equal(routes.size, 0)
})
test('pending annotation numbers are compacted on delete and restart after send', async (t) => {
  const { runtime } = await makeRuntime(t)
  runtime.setFocusedSession('session-a')
  const one = await runtime.createAnnotation(null, payload({ comment: '一' }))
  const two = await runtime.createAnnotation(null, payload({ comment: '二' }))
  const three = await runtime.createAnnotation(null, payload({ comment: '三' }))

  assert.deepEqual(runtime.pendingAnnotationViews().map((item) => item.seq), [1, 2, 3])

  await runtime.deleteAnnotation(two.id)
  assert.deepEqual(runtime.pendingAnnotationViews().map((item) => item.seq), [1, 2])

  const four = await runtime.createAnnotation(null, payload({ comment: '四' }))
  assert.equal(four.seq, 3)
  assert.equal(four.label, '网页注释 3')

  const items = runtime.pendingAnnotationViews()
  const message = {
    role: 'user',
    content: [{ type: 'text', text: items.map((item) => item.mention).join('\n') }],
  }
  const output = await runtime.prepareAnnotationMentions([message])
  assert.equal(output.length, 2)
  assert.equal(runtime.pendingAnnotationViews().length, 0)

  const next = await runtime.createAnnotation(null, payload({ comment: '下一批' }))
  assert.equal(next.seq, 1)
  assert.equal(next.label, '网页注释 1')
  assert.equal(runtime.annotationItem(one.id).seq, 1)
  assert.equal(runtime.annotationItem(three.id).seq, 2)
})

test('concurrent annotation creates receive distinct batch numbers', async (t) => {
  const { runtime } = await makeRuntime(t)
  const created = await Promise.all([
    runtime.createAnnotation(null, payload({ comment: '并发一' })),
    runtime.createAnnotation(null, payload({ comment: '并发二' })),
    runtime.createAnnotation(null, payload({ comment: '并发三' })),
  ])
  assert.deepEqual(created.map((item) => item.seq).sort((a, b) => a - b), [1, 2, 3])
  assert.deepEqual(runtime.pendingAnnotationViews().map((item) => item.seq), [1, 2, 3])
})

test('normalizeSessionNumbers repairs a stale persisted sequence', async (t) => {
  const { runtime } = await makeRuntime(t)
  const first = await runtime.createAnnotation(null, payload({ comment: '旧记录' }))
  const record = runtime.annotations.get(first.id)
  record.seq = 7
  record.label = '网页注释 7'
  record.mention = `@[网页注释 7](dsh-anno:${record.id})`
  const pending = runtime.normalizeSessionNumbers(null)
  assert.equal(pending[0].seq, 1)
  assert.equal(pending[0].label, '网页注释 1')
})

test('annotation numbering is independent for each DSH session', async (t) => {
  const { runtime } = await makeRuntime(t)
  runtime.setFocusedSession('session-a')
  const a1 = await runtime.createAnnotation(null, payload({ comment: 'A1' }))
  const a2 = await runtime.createAnnotation(null, payload({ comment: 'A2' }))
  runtime.setFocusedSession('session-b')
  const b1 = await runtime.createAnnotation(null, payload({ comment: 'B1' }))
  assert.equal(a1.seq, 1)
  assert.equal(a2.seq, 2)
  assert.equal(b1.seq, 1)

  await runtime.deleteAnnotation(a1.id)
  const pending = runtime.pendingAnnotationViews()
  assert.deepEqual(pending.filter((item) => item.sessionId === 'session-a').map((item) => item.seq), [1])
  assert.deepEqual(pending.filter((item) => item.sessionId === 'session-b').map((item) => item.seq), [1])

  const b2 = await runtime.createAnnotation(null, payload({ comment: 'B2' }))
  assert.equal(b2.seq, 2)
})

test('restarting the host archives an unsent batch and starts a fresh one', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dshuf-annotation-orphan-'))
  const first = await createRuntime(fakeContext(), { home, mode: 'full', bridgePort: 0, audit: false })
  try {
    first.setFocusedSession('session-a')
    await first.createAnnotation(null, payload({ comment: '重启前' }))
  } finally {
    await first.dispose()
  }
  const second = await createRuntime(fakeContext(), { home, mode: 'full', bridgePort: 0, audit: false })
  try {
    assert.equal(second.pendingAnnotationViews().length, 0)
    assert.equal([...second.annotations.values()].filter((record) => record.orphaned).length, 1)
    second.setFocusedSession('session-a')
    const next = await second.createAnnotation(null, payload({ comment: '重启后' }))
    assert.equal(next.seq, 1)
  } finally {
    await second.dispose()
    await rm(home, { recursive: true, force: true })
  }
})
