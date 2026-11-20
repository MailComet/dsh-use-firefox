import { createHash, timingSafeEqual } from 'node:crypto'
import { WebSocketServer } from 'ws'

export const PROTOCOL = 'dsh-use-firefox'
export const PROTOCOL_VERSION = 1
export const BRIDGE_PATH = '/ext/bridge'
export const DEFAULT_PORT = 39271

export class BridgeError extends Error {
  constructor(code, message, next = '') {
    super(message)
    this.name = 'BridgeError'
    this.code = code
    this.next = next
  }
}

function tokenMatches(presented, expected) {
  const left = createHash('sha256').update(String(presented ?? '')).digest()
  const right = createHash('sha256').update(String(expected ?? '')).digest()
  return left.length === right.length && timingSafeEqual(left, right)
}

function safeString(value, max = 120) {
  return String(value ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, max)
}

function send(ws, value) {
  if (ws.readyState !== 1) return false
  try {
    ws.send(JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export class Bridge {
  /**
   * @param {object} options
   * @param {string} [options.host]
   * @param {number} options.port
   * @param {string} options.token
   * @param {string} options.pluginVersion
   * @param {() => object} options.getWelcome
   * @param {(client: object, event: string, data: any) => any} [options.onEvent]
   * @param {(client: object, op: string, params: any) => any} [options.onRequest]
   * @param {(clients: object[]) => void} [options.onClientsChanged]
   * @param {{info?: Function, warn?: Function, debug?: Function}} [options.logger]
   */
  constructor(options) {
    this.host = options.host || '127.0.0.1'
    this.port = options.port ?? DEFAULT_PORT
    this.token = options.token
    this.pluginVersion = options.pluginVersion || '0.0.0'
    this.getWelcome = options.getWelcome || (() => ({}))
    this.onEvent = options.onEvent
    this.onRequest = options.onRequest
    this.onClientsChanged = options.onClientsChanged
    this.logger = options.logger || {}
    this.wss = null
    this.running = false
    this.error = null
    this.clients = new Map()
    this.activeClientId = null
    this.seq = 0
    this.heartbeat = null
  }

  async start() {
    if (this.running) return this
    this.error = null
    const wss = new WebSocketServer({
      host: this.host,
      port: this.port,
      path: BRIDGE_PATH,
      maxPayload: 25 * 1024 * 1024,
    })
    this.wss = wss
    wss.on('connection', (ws, request) => this.#onConnection(ws, request))
    wss.on('error', (error) => {
      this.error = error
      this.logger.warn?.(`use-firefox bridge error: ${error.message}`)
    })
    await new Promise((resolve, reject) => {
      const onListening = () => {
        wss.off('error', onError)
        resolve()
      }
      const onError = (error) => {
        wss.off('listening', onListening)
        reject(error)
      }
      wss.once('listening', onListening)
      wss.once('error', onError)
    }).catch((error) => {
      this.error = error
      this.running = false
      try { wss.close() } catch { /* ignore */ }
      throw new BridgeError(
        'BRIDGE_START_FAILED',
        `无法在 ${this.host}:${this.port} 启动扩展桥: ${error.message}`,
        '检查端口是否被占用，或修改插件配置 bridgePort 后重启 DSH。',
      )
    })

    const address = wss.address()
    if (address && typeof address === 'object' && address.port) this.port = address.port
    this.running = true
    this.heartbeat = setInterval(() => this.#heartbeatTick(), 25_000)
    this.heartbeat.unref?.()
    this.logger.info?.(`use-firefox bridge listening on ws://${this.host}:${this.port}${BRIDGE_PATH}`)
    return this
  }

  #onConnection(ws, request) {
    const client = {
      id: null,
      ws,
      label: '',
      extensionVersion: '',
      address: request?.socket?.remoteAddress || '',
      connectedAt: new Date().toISOString(),
      pending: new Map(),
      alive: true,
      helloDone: false,
    }
    const helloTimer = setTimeout(() => {
      if (!client.helloDone) this.#fail(client, 'HELLO_TIMEOUT', '扩展在 10 秒内没有完成握手', '重新打开扩展弹窗或重启 Firefox。')
    }, 10_000)
    helloTimer.unref?.()

    ws.on('pong', () => { client.alive = true })
    ws.on('message', (raw) => {
      let message
      try {
        message = JSON.parse(raw.toString('utf8'))
      } catch {
        this.#sendError(client, 'BAD_JSON', '扩展发来的消息不是 JSON')
        return
      }
      if (!client.helloDone) {
        this.#onHello(client, message, helloTimer)
        return
      }
      this.#onMessage(client, message)
    })
    ws.on('error', (error) => {
      this.logger.warn?.(`use-firefox client error: ${error.message}`)
    })
    ws.on('close', () => {
      clearTimeout(helloTimer)
      this.#removeClient(client)
    })
  }

  #onHello(client, message, timer) {
    if (message?.type !== 'hello') {
      this.#fail(client, 'HELLO_REQUIRED', '第一条消息必须是 hello', '升级扩展或重新连接。')
      return
    }
    if (message.protocol !== PROTOCOL) {
      this.#fail(client, 'PROTOCOL_MISMATCH', `协议不匹配: 期望 ${PROTOCOL},收到 ${safeString(message.protocol)}`, '插件和扩展必须来自同一版本。')
      return
    }
    if (message.version !== PROTOCOL_VERSION) {
      this.#fail(client, 'VERSION_MISMATCH', `协议版本不匹配: 插件 ${PROTOCOL_VERSION},扩展 ${safeString(message.version, 20)}`, '更新插件和扩展，使两端版本一致。')
      return
    }
    if (!tokenMatches(message.token, this.token)) {
      this.#fail(client, 'BAD_TOKEN', '扩展令牌不正确', '重新复制 ~/.dsh/browser/ext-token 到扩展弹窗。')
      return
    }

    clearTimeout(timer)
    client.helloDone = true
    const clientId = safeString(message.clientId || `client-${++this.seq}`, 80) || `client-${++this.seq}`
    client.id = clientId
    client.label = safeString(message.label || 'Firefox', 80)
    client.extensionVersion = safeString(message.extensionVersion || '', 40)

    const previous = this.clients.get(clientId)
    if (previous && previous !== client) {
      this.#fail(previous, 'RECONNECTED', '同一扩展重新连接', '')
    }
    this.clients.set(clientId, client)
    this.activeClientId = clientId
    send(client.ws, {
      type: 'welcome',
      protocol: PROTOCOL,
      version: PROTOCOL_VERSION,
      pluginVersion: this.pluginVersion,
      clientId,
      activeClientId: this.activeClientId,
      ...this.getWelcome(),
    })
    this.logger.info?.(`use-firefox client connected: ${clientId} (${client.label})`)
    this.onClientsChanged?.(this.listClients())
  }

  #onMessage(client, message) {
    client.alive = true
    if (message?.type === 'response') {
      const pending = client.pending.get(message.id)
      if (!pending) return
      client.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.ok) {
        pending.resolve(message.data)
      } else {
        const error = message.error || {}
        pending.reject(new BridgeError(
          safeString(error.code || 'EXTENSION_ERROR', 80),
          safeString(error.message || '扩展执行失败', 1000),
          safeString(error.next || '', 1000),
        ))
      }
      return
    }

    if (message?.type === 'request') {
      Promise.resolve()
        .then(() => this.onRequest?.(this.publicClient(client), message.op, message.params))
        .then(
          (data) => send(client.ws, { type: 'response', id: message.id, ok: true, data }),
          (error) => send(client.ws, {
            type: 'response',
            id: message.id,
            ok: false,
            error: {
              code: safeString(error?.code || 'REQUEST_FAILED', 80),
              message: safeString(error?.message || String(error), 1000),
              next: safeString(error?.next || '', 1000),
            },
          }),
        )
      return
    }

    if (message?.type === 'event') {
      Promise.resolve()
        .then(() => this.onEvent?.(this.publicClient(client), safeString(message.event, 80), message.data))
        .catch((error) => this.logger.warn?.(`use-firefox event ${message.event} failed: ${error.message}`))
    }
  }

  #heartbeatTick() {
    for (const client of [...this.clients.values()]) {
      if (!client.alive) {
        this.logger.warn?.(`use-firefox client ${client.id} missed heartbeat`)
        this.#fail(client, 'HEARTBEAT_TIMEOUT', '扩展心跳超时', '重新打开扩展弹窗。')
        continue
      }
      client.alive = false
      try { client.ws.ping() } catch { this.#fail(client, 'PING_FAILED', '无法发送心跳', '重新连接扩展。') }
    }
  }

  #fail(client, code, message, next) {
    try {
      send(client.ws, { type: 'error', code, message, next })
      client.ws.close(1008, code)
    } catch { /* ignore */ }
    this.#removeClient(client)
  }

  #sendError(client, code, message) {
    send(client.ws, { type: 'error', code, message })
  }

  #removeClient(client) {
    const existing = client.id ? this.clients.get(client.id) : undefined
    if (existing === client) {
      this.clients.delete(client.id)
      if (this.activeClientId === client.id) this.activeClientId = null
      this.logger.info?.(`use-firefox client disconnected: ${client.id}`)
      this.onClientsChanged?.(this.listClients())
    }
    for (const pending of client.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new BridgeError('CLIENT_DISCONNECTED', 'Firefox 扩展已断开', '让用户在 Firefox 工具栏弹窗重新连接。'))
    }
    client.pending.clear()
    if (!this.activeClientId) {
      const last = [...this.clients.values()].at(-1)
      if (last) this.activeClientId = last.id
    }
  }

  publicClient(client) {
    return {
      id: client.id,
      label: client.label,
      extensionVersion: client.extensionVersion,
      connectedAt: client.connectedAt,
    }
  }

  listClients() {
    return [...this.clients.values()].map((client) => this.publicClient(client))
  }

  pickClient(clientId) {
    const id = clientId || this.activeClientId
    if (id) {
      const client = this.clients.get(id)
      if (client) return client
    }
    const last = [...this.clients.values()].at(-1)
    if (last) {
      this.activeClientId = last.id
      return last
    }
    throw new BridgeError(
      'NO_CLIENT',
      'Firefox 扩展尚未连接',
      `在 Firefox 中安装并打开 DSH Use Firefox 扩展，在工具栏弹窗填入 ${this.host}:${this.port} 的端口和 ~/.dsh/browser/ext-token 的令牌。`,
    )
  }

  setActiveClient(clientId) {
    const client = this.clients.get(clientId)
    if (!client) throw new BridgeError('NO_CLIENT', `找不到扩展客户端 ${clientId}`)
    this.activeClientId = clientId
    return this.publicClient(client)
  }

  request(op, params = {}, options = {}) {
    const client = this.pickClient(options.clientId)
    const timeoutMs = Number(options.timeoutMs || 60_000)
    return new Promise((resolve, reject) => {
      const id = `h${++this.seq}`
      const timer = setTimeout(() => {
        client.pending.delete(id)
        reject(new BridgeError('TIMEOUT', `扩展执行 ${op} 超时`, '检查 Firefox 是否还开着；页面可能需要更长时间。'))
      }, timeoutMs)
      timer.unref?.()
      client.pending.set(id, { resolve, reject, timer })
      const sent = send(client.ws, { type: 'request', id, op, params })
      if (!sent) {
        client.pending.delete(id)
        clearTimeout(timer)
        reject(new BridgeError('CLIENT_DISCONNECTED', 'Firefox 扩展连接已断开', '重新连接扩展。'))
      }
    })
  }

  sendEvent(event, data) {
    for (const client of this.clients.values()) {
      send(client.ws, { type: 'event', event, data })
    }
  }

  broadcast(event, data) {
    this.sendEvent(event, data)
  }

  status() {
    return {
      running: this.running,
      host: this.host,
      port: this.port,
      error: this.error ? String(this.error.message || this.error) : null,
      protocol: PROTOCOL,
      version: PROTOCOL_VERSION,
      activeClientId: this.activeClientId,
      clients: this.listClients(),
    }
  }

  async close() {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    for (const client of [...this.clients.values()]) {
      this.#fail(client, 'BRIDGE_CLOSING', 'DSH 插件正在关闭', '')
    }
    this.clients.clear()
    this.activeClientId = null
    this.running = false
    const wss = this.wss
    this.wss = null
    if (wss) {
      await new Promise((resolve) => {
        try {
          wss.close(() => resolve())
          setTimeout(resolve, 1000).unref?.()
        } catch {
          resolve()
        }
      })
    }
  }
}
