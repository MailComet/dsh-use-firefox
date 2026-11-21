import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'

const PREFIX = '/ext/use-firefox'

function sendJson(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(body)
}

async function readJson(request) {
  let raw = ''
  for await (const chunk of request) {
    raw += chunk
    if (raw.length > 512 * 1024) throw new Error('request body too large')
  }
  if (raw === '') return {}
  return JSON.parse(raw)
}

export function registerAnnotationRoutes(webServer, runtime) {
  const disposers = []
  const add = (path, handler) => {
    disposers.push(webServer.register({
      kind: 'exact',
      path: `${PREFIX}${path}`,
      handler,
    }))
  }

  add('/queue', async (request, response) => {
    if (request.method !== 'GET') {
      sendJson(response, 405, { ok: false, error: 'method' })
      return
    }
    const url = new URL(request.url ?? `${PREFIX}/queue`, 'http://127.0.0.1')
    const sessionId = url.searchParams.get('session') ?? ''
    sendJson(response, 200, { ok: true, items: runtime.queueAnnotations(sessionId || null) })
  })

  add('/annotation-start', async (request, response) => {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method' })
      return
    }
    try {
      const result = await runtime.startAnnotationOnActiveTab()
      sendJson(response, 200, { ok: true, result })
    } catch (error) {
      sendJson(response, 409, { ok: false, error: error.message })
    }
  })

  add('/pending', async (request, response) => {
    if (request.method !== 'GET') {
      sendJson(response, 405, { ok: false, error: 'method' })
      return
    }
    sendJson(response, 200, { ok: true, items: runtime.pendingAnnotationViews() })
  })

  add('/queue/ack', async (request, response) => {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method' })
      return
    }
    try {
      const body = await readJson(request)
      const ids = Array.isArray(body?.ids) ? body.ids : []
      runtime.ackAnnotations(ids)
      sendJson(response, 200, { ok: true, removed: ids.length })
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message })
    }
  })

  add('/focus', async (request, response) => {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method' })
      return
    }
    try {
      const body = await readJson(request)
      runtime.setFocusedSession(typeof body?.sessionId === 'string' ? body.sessionId : '')
      sendJson(response, 200, { ok: true })
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message })
    }
  })

  add('/token', async (request, response) => {
    if (request.method !== 'GET') {
      sendJson(response, 405, { ok: false, error: 'method' })
      return
    }
    try {
      const token = await readFile(runtime.tokenPath(), 'utf8').then((value) => value.trim())
      if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error('token file is invalid')
      sendJson(response, 200, { ok: true, token })
    } catch (error) {
      sendJson(response, 404, { ok: false, error: error.message })
    }
  })

  add('/overview', async (request, response) => {
    if (request.method !== 'GET') {
      sendJson(response, 405, { ok: false, error: 'method' })
      return
    }
    sendJson(response, 200, { ok: true, ...runtime.overview() })
  })

  add('/mode', async (request, response) => {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method' })
      return
    }
    try {
      const body = await readJson(request)
      runtime.setMode(body?.mode, 'user')
      sendJson(response, 200, { ok: true, ...runtime.overview() })
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message })
    }
  })

  add('/annotation-mode', async (request, response) => {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method' })
      return
    }
    try {
      const body = await readJson(request)
      runtime.setAnnotationMode(body?.mode, 'user')
      sendJson(response, 200, { ok: true, ...runtime.overview() })
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message })
    }
  })

  add('/update', async (request, response) => {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method' })
      return
    }
    try {
      const body = await readJson(request)
      const item = await runtime.updateAnnotation(body?.id, body?.comment)
      sendJson(response, 200, { ok: true, item })
    } catch (error) {
      sendJson(response, error?.code === 'ANNOTATION_NOT_FOUND' ? 404 : 400, { ok: false, error: error.message })
    }
  })

  add('/delete', async (request, response) => {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method' })
      return
    }
    try {
      const body = await readJson(request)
      const result = await runtime.deleteAnnotation(body?.id)
      sendJson(response, 200, { ok: true, ...result })
    } catch (error) {
      sendJson(response, error?.code === 'ANNOTATION_NOT_FOUND' ? 404 : 400, { ok: false, error: error.message })
    }
  })

  add('/item', async (request, response) => {
    if (request.method !== 'GET') {
      sendJson(response, 405, { ok: false, error: 'method' })
      return
    }
    const url = new URL(request.url ?? `${PREFIX}/item`, 'http://127.0.0.1')
    const item = runtime.annotationItem(url.searchParams.get('id') ?? '')
    if (!item) {
      sendJson(response, 404, { ok: false, error: 'not-found' })
      return
    }
    sendJson(response, 200, { ok: true, item })
  })

  add('/image', async (request, response) => {
    if (request.method !== 'GET') {
      sendJson(response, 405, { ok: false, error: 'method' })
      return
    }
    const url = new URL(request.url ?? `${PREFIX}/image`, 'http://127.0.0.1')
    const file = runtime.annotationImage(url.searchParams.get('id') ?? '')
    if (!file) {
      sendJson(response, 404, { ok: false, error: 'not-found' })
      return
    }
    try {
      const data = await readFile(file)
      const ext = extname(file).toLowerCase()
      response.writeHead(200, {
        'content-type': ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png',
        'content-length': String(data.length),
        'cache-control': 'no-store',
      })
      response.end(data)
    } catch {
      sendJson(response, 404, { ok: false, error: 'not-found' })
    }
  })

  return () => {
    for (const dispose of disposers) {
      try { dispose() } catch { /* ignore */ }
    }
  }
}