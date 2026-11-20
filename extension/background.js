(() => {
  'use strict'

  const PROTOCOL = 'dsh-use-firefox'
  const PROTOCOL_VERSION = 1
  const DEFAULT_PORT = 39271
  const KEEPALIVE_ALARM = 'dshuf-keepalive'
  const KEEPALIVE_ALARM_2 = 'dshuf-keepalive-2'
  const SETTINGS_KEY = 'dshuf-settings'
  const OUTBOX_KEY = 'dshuf-outbox'
  const MAX_OUTBOX = 20

  const MUTATING_OPS = new Set(['tabs.open', 'tabs.close', 'tabs.navigate', 'navigate', 'click', 'type', 'press'])

  const state = {
    ws: null,
    connected: false,
    connecting: false,
    error: null,
    mode: 'full',
    modeLabel: '完全访问',
    paused: false,
    groupTitle: 'DSH',
    groupColor: 'blue',
    pluginVersion: '',
    serverProtocolVersion: 0,
    token: '',
    port: DEFAULT_PORT,
    label: 'Firefox',
    clientId: '',
    extensionVersion: browser.runtime.getManifest().version,
    reconnectTimer: null,
    reconnectDelay: 1000,
    lastAnnotation: null,
    lastAnnotationTabId: null,
  }

  const hostPending = new Map()
  let hostSeq = 0

  class ExtError extends Error {
    constructor(code, message, next = '') {
      super(message)
      this.name = 'ExtError'
      this.code = code
      this.next = next
    }
  }

  function normalizeError(error) {
    if (error instanceof ExtError) return error
    const message = error?.message || String(error || '未知错误')
    return new ExtError(error?.code || 'EXTENSION_ERROR', message, error?.next || '')
  }

  function publicState() {
    return {
      connected: state.connected,
      connecting: state.connecting,
      error: state.error,
      mode: state.mode,
      modeLabel: state.modeLabel,
      paused: state.paused,
      groupTitle: state.groupTitle,
      groupColor: state.groupColor,
      pluginVersion: state.pluginVersion,
      port: state.port,
      label: state.label,
      clientId: state.clientId,
      extensionVersion: state.extensionVersion,
      lastAnnotation: state.lastAnnotation,
    }
  }

  function notify() {
    browser.runtime.sendMessage({ type: 'dshuf:state', state: publicState() }).catch(() => {})
  }

  async function loadSettings() {
    const saved = await browser.storage.local.get(SETTINGS_KEY)
    const settings = saved?.[SETTINGS_KEY] || {}
    if (typeof settings.token === 'string') state.token = settings.token
    if (Number.isFinite(Number(settings.port)) && Number(settings.port) > 0) state.port = Number(settings.port)
    if (typeof settings.label === 'string' && settings.label.trim()) state.label = settings.label.trim()
    if (typeof settings.clientId === 'string' && settings.clientId) {
      state.clientId = settings.clientId
    } else {
      state.clientId = crypto.randomUUID ? crypto.randomUUID() : `firefox-${Date.now()}-${Math.random().toString(16).slice(2)}`
      await saveSettings()
    }
  }

  async function saveSettings() {
    await browser.storage.local.set({
      [SETTINGS_KEY]: {
        token: state.token,
        port: state.port,
        label: state.label,
        clientId: state.clientId,
      },
    })
  }

  function scheduleReconnect() {
    if (state.reconnectTimer) return
    const delay = state.reconnectDelay
    state.reconnectDelay = Math.min(15_000, Math.max(1000, state.reconnectDelay * 2))
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null
      connect()
    }, delay)
  }

  function sendRaw(value) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return false
    try {
      state.ws.send(JSON.stringify(value))
      return true
    } catch {
      return false
    }
  }

  async function connect() {
    if (!state.token) {
      state.error = '未配置扩展令牌'
      state.connecting = false
      notify()
      return
    }
    if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) return
    state.connecting = true
    state.error = null
    notify()

    let ws
    try {
      ws = new WebSocket(`ws://127.0.0.1:${state.port}/ext/bridge`)
    } catch (error) {
      state.connecting = false
      state.error = error.message || String(error)
      notify()
      scheduleReconnect()
      return
    }
    state.ws = ws

    ws.onopen = () => {
      if (state.ws !== ws) return
      state.connecting = false
      state.error = null
      sendRaw({
        type: 'hello',
        protocol: PROTOCOL,
        version: PROTOCOL_VERSION,
        token: state.token,
        clientId: state.clientId,
        label: state.label,
        extensionVersion: state.extensionVersion,
      })
      notify()
    }

    ws.onmessage = (event) => {
      if (state.ws !== ws) return
      let message
      try {
        message = JSON.parse(String(event.data))
      } catch {
        state.error = '桥返回了非 JSON 消息'
        notify()
        return
      }
      handleHostMessage(message)
    }

    ws.onerror = () => {
      if (state.ws !== ws) return
      state.error = '无法连接 DSH 扩展桥'
    }

    ws.onclose = () => {
      if (state.ws !== ws) return
      const wasConnected = state.connected
      state.ws = null
      state.connected = false
      state.connecting = false
      if (!state.error) state.error = wasConnected ? '与 DSH 的连接已断开' : '未连接到 DSH'
      for (const pending of hostPending.values()) {
        clearTimeout(pending.timer)
        pending.reject(new ExtError('HOST_DISCONNECTED', 'DSH 插件连接已断开'))
      }
      hostPending.clear()
      notify()
      scheduleReconnect()
    }
  }

  function handleHostMessage(message) {
    if (!message || typeof message !== 'object') return
    if (message.type === 'welcome') {
      state.connected = true
      state.connecting = false
      state.error = null
      state.pluginVersion = String(message.pluginVersion || '')
      state.serverProtocolVersion = Number(message.version || 0)
      state.mode = message.mode || state.mode
      state.modeLabel = message.modeLabel || state.mode
      state.paused = message.paused === true
      state.groupTitle = message.groupTitle || state.groupTitle
      state.groupColor = message.groupColor || state.groupColor
      state.reconnectDelay = 1000
      notify()
      void flushOutbox()
      return
    }

    if (message.type === 'error') {
      state.error = [message.code, message.message].filter(Boolean).join(': ')
      notify()
      return
    }

    if (message.type === 'response') {
      const pending = hostPending.get(message.id)
      if (!pending) return
      hostPending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.ok) pending.resolve(message.data)
      else pending.reject(normalizeError(message.error))
      return
    }

    if (message.type === 'request') {
      Promise.resolve()
        .then(() => handleHostRequest(message.op, message.params))
        .then(
          (data) => sendRaw({ type: 'response', id: message.id, ok: true, data }),
          (error) => {
            const normalized = normalizeError(error)
            sendRaw({
              type: 'response',
              id: message.id,
              ok: false,
              error: { code: normalized.code, message: normalized.message, next: normalized.next },
            })
          },
        )
      return
    }

    if (message.type === 'event') {
      if (message.event === 'mode') {
        state.mode = message.data?.mode || state.mode
        state.modeLabel = message.data?.modeLabel || state.mode
        notify()
      } else if (message.event === 'paused') {
        state.paused = message.data?.paused === true
        notify()
      }
    }
  }

  function requestHost(op, params = {}, timeoutMs = 20_000) {
    if (!state.connected) return Promise.reject(new ExtError('HOST_DISCONNECTED', 'DSH 插件未连接'))
    return new Promise((resolve, reject) => {
      const id = `e${++hostSeq}`
      const timer = setTimeout(() => {
        hostPending.delete(id)
        reject(new ExtError('HOST_TIMEOUT', `DSH 插件响应 ${op} 超时`))
      }, timeoutMs)
      hostPending.set(id, { resolve, reject, timer })
      if (!sendRaw({ type: 'request', id, op, params })) {
        hostPending.delete(id)
        clearTimeout(timer)
        reject(new ExtError('HOST_DISCONNECTED', 'DSH 插件连接已断开'))
      }
    })
  }

  async function queueEvent(event, data) {
    const saved = await browser.storage.local.get(OUTBOX_KEY)
    const items = Array.isArray(saved?.[OUTBOX_KEY]) ? saved[OUTBOX_KEY] : []
    items.push({ event, data, at: Date.now() })
    const trimmed = items.slice(-MAX_OUTBOX)
    await browser.storage.local.set({ [OUTBOX_KEY]: trimmed })
    notify()
    return trimmed.length
  }

  async function sendEvent(event, data) {
    if (sendRaw({ type: 'event', event, data })) return true
    await queueEvent(event, data)
    return false
  }

  async function flushOutbox() {
    if (!state.connected) return
    const saved = await browser.storage.local.get(OUTBOX_KEY)
    const items = Array.isArray(saved?.[OUTBOX_KEY]) ? saved[OUTBOX_KEY] : []
    if (items.length === 0) return
    const keep = []
    for (const item of items) {
      if (!sendRaw({ type: 'event', event: item.event, data: item.data })) keep.push(item)
    }
    if (keep.length) await browser.storage.local.set({ [OUTBOX_KEY]: keep })
    else await browser.storage.local.remove(OUTBOX_KEY)
    notify()
  }

  function tabSummary(tab) {
    if (!tab) return null
    return {
      tabId: tab.id,
      windowId: tab.windowId,
      groupId: tab.groupId,
      title: tab.title || '',
      url: tab.url || tab.pendingUrl || '',
      active: tab.active === true,
      status: tab.status || '',
    }
  }

  async function groupTitleOf(groupId) {
    if (groupId === undefined || groupId === null || groupId < 0) return null
    try {
      const group = await browser.tabGroups.get(groupId)
      return group?.title || ''
    } catch {
      return null
    }
  }

  async function isDshGroupTab(tabId) {
    try {
      const tab = await browser.tabs.get(tabId)
      if (!tab || tab.groupId === undefined || tab.groupId < 0) return false
      return (await groupTitleOf(tab.groupId)) === state.groupTitle
    } catch {
      return false
    }
  }

  async function assertGroupTab(tabId) {
    if (!(await isDshGroupTab(tabId))) {
      throw new ExtError(
        'NOT_IN_DSH_GROUP',
        `标签页 ${tabId} 不在 ${state.groupTitle} 分组内`,
        '只操作 DSH 分组里的标签页；需要新页面时用 browser_navigate 或 browser_tabs action=open。',
      )
    }
    try {
      return await browser.tabs.get(tabId)
    } catch {
      throw new ExtError('TAB_GONE', `标签页 ${tabId} 已不存在`, '重新调用 browser_tabs action=list。')
    }
  }

  async function listGroupTabs() {
    const groups = await browser.tabGroups.query({})
    const ids = new Set(groups.filter((group) => group.title === state.groupTitle).map((group) => group.id))
    const tabs = await browser.tabs.query({})
    return tabs
      .filter((tab) => ids.has(tab.groupId))
      .sort((left, right) => (left.windowId - right.windowId) || ((left.index || 0) - (right.index || 0)))
      .map(tabSummary)
  }

  async function targetWindowId() {
    try {
      const active = await browser.tabs.query({ active: true, lastFocusedWindow: true })
      if (active?.[0]?.windowId) return active[0].windowId
    } catch { /* fall through */ }
    const win = await browser.windows.getLastFocused()
    if (win?.id) return win.id
    const wins = await browser.windows.getAll()
    if (wins?.[0]?.id) return wins[0].id
    throw new ExtError('NO_WINDOW', '找不到可用的 Firefox 窗口', '打开一个普通 Firefox 窗口后重试。')
  }

  async function findGroup(windowId) {
    const groups = await browser.tabGroups.query({})
    return groups.find((group) => group.windowId === windowId && group.title === state.groupTitle) || null
  }

  async function ensureTabInGroup(tab, windowId) {
    const existing = await findGroup(windowId)
    if (existing) {
      try {
        await browser.tabs.group({ tabIds: [tab.id], groupId: existing.id })
        if (existing.title !== state.groupTitle) {
          await browser.tabGroups.update(existing.id, { title: state.groupTitle, color: state.groupColor })
        }
        return existing.id
      } catch { /* create a new group below */ }
    }
    try {
      const groupId = await browser.tabs.group({ tabIds: [tab.id], createProperties: { windowId } })
      await browser.tabGroups.update(groupId, { title: state.groupTitle, color: state.groupColor })
      return groupId
    } catch (error) {
      throw new ExtError(
        'GROUP_FAILED',
        `无法把标签页加入 ${state.groupTitle} 分组: ${error.message || error}`,
        '确认 Firefox 已开启标签组功能（browser.tabs.groups.enabled）。',
      )
    }
  }

  async function openTabInGroup(url, active = false, windowId) {
    const winId = windowId || (await targetWindowId())
    const tab = await browser.tabs.create({ url, active: active === true, windowId: winId })
    try {
      await ensureTabInGroup(tab, winId)
    } catch (error) {
      try { await browser.tabs.remove(tab.id) } catch { /* ignore */ }
      throw error
    }
    const loaded = await waitForLoad(tab.id, 15_000)
    return tabSummary(loaded || (await browser.tabs.get(tab.id)))
  }

  function waitForTabUpdate(tabId, previousUrl, timeoutMs = 15_000) {
    let done = false
    let timer = null
    let fallbackTimer = null
    let settle = null
    let sawProgress = false

    const finish = async () => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      if (fallbackTimer) clearTimeout(fallbackTimer)
      try { browser.tabs.onUpdated.removeListener(onUpdated) } catch { /* ignore */ }
      let tab = null
      try { tab = await browser.tabs.get(tabId) } catch { /* ignore */ }
      if (settle) settle(tab)
    }

    const onUpdated = (id, info) => {
      if (id !== tabId) return
      if (info.status === 'loading' || (info.url && info.url !== previousUrl)) sawProgress = true
      if (info.status === 'complete' && sawProgress) finish()
    }

    const promise = new Promise((resolve) => {
      settle = resolve
      browser.tabs.onUpdated.addListener(onUpdated)
      timer = setTimeout(finish, timeoutMs)
      fallbackTimer = setTimeout(() => {
        if (done || sawProgress) return
        browser.tabs.get(tabId).then((tab) => {
          if (tab && tab.url !== previousUrl) {
            sawProgress = true
            if (tab.status === 'complete') finish()
          }
        }).catch(() => {})
      }, 400)
    })

    return {
      promise,
      cancel() {
        if (done) return
        done = true
        if (timer) clearTimeout(timer)
        if (fallbackTimer) clearTimeout(fallbackTimer)
        try { browser.tabs.onUpdated.removeListener(onUpdated) } catch { /* ignore */ }
        if (settle) settle(null)
      },
    }
  }

  async function navigateTab(url, tabId, active = false) {
    const before = await assertGroupTab(tabId)
    const waiter = waitForTabUpdate(tabId, before.url || '', 15_000)
    try {
      await browser.tabs.update(tabId, { url, active: active === true })
    } catch (error) {
      waiter.cancel()
      throw error
    }
    const loaded = await waiter.promise
    return tabSummary(loaded || (await browser.tabs.get(tabId)))
  }

  function waitForLoad(tabId, timeoutMs) {
    return new Promise((resolve) => {
      let done = false
      let timer = null
      const finish = async () => {
        if (done) return
        done = true
        if (timer) clearTimeout(timer)
        try { browser.tabs.onUpdated.removeListener(onUpdated) } catch { /* ignore */ }
        try { resolve(await browser.tabs.get(tabId)) } catch { resolve(null) }
      }
      const onUpdated = (id, info) => {
        if (id !== tabId) return
        if (info.status === 'complete') finish()
      }
      browser.tabs.onUpdated.addListener(onUpdated)
      timer = setTimeout(finish, timeoutMs)
      browser.tabs.get(tabId).then((tab) => {
        if (tab?.status === 'complete') setTimeout(finish, 100)
      }).catch(() => finish())
    })
  }

  function isRestrictedUrl(url) {
    const value = String(url || '')
    return /^(about:|moz-extension:|chrome:|view-source:|resource:|jar:)/i.test(value)
      || /^https?:\/\/addons\.mozilla\.org\//i.test(value)
      || /^https?:\/\/accounts\.firefox\.com\//i.test(value)
  }

  async function ensureContent(tabId) {
    try {
      await browser.tabs.sendMessage(tabId, { type: 'dshuf:command', command: 'ping' })
      return
    } catch { /* inject below */ }
    let tab
    try { tab = await browser.tabs.get(tabId) } catch {
      throw new ExtError('TAB_GONE', `标签页 ${tabId} 已不存在`)
    }
    if (isRestrictedUrl(tab.url || tab.pendingUrl)) {
      throw new ExtError('UNSUPPORTED_PAGE', 'Firefox 内部页或受保护页面不能被扩展操作', '换一个 http(s) 页面。')
    }
    try {
      await browser.scripting.executeScript({ target: { tabId }, files: ['content/content.js'] })
    } catch (error) {
      throw new ExtError(
        'INJECT_FAILED',
        `无法向页面注入 DSH Use Firefox 脚本: ${error.message || error}`,
        '确认扩展有访问该站点的权限；浏览器内部页无法注入。',
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 60))
    try {
      await browser.tabs.sendMessage(tabId, { type: 'dshuf:command', command: 'ping' })
    } catch {
      throw new ExtError('INJECT_FAILED', '页面脚本加载后没有响应', '刷新页面后重试。')
    }
  }

  async function sendContent(tabId, command, params = {}) {
    await ensureContent(tabId)
    let lastError
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await browser.tabs.sendMessage(tabId, { type: 'dshuf:command', command, params })
        if (!response) throw new Error('页面脚本没有返回结果')
        if (response.ok) return response.data
        throw normalizeError(response.error)
      } catch (error) {
        lastError = error
        if (attempt === 0) {
          await ensureContent(tabId)
          await new Promise((resolve) => setTimeout(resolve, 80))
          continue
        }
        break
      }
    }
    throw normalizeError(lastError)
  }

  async function captureAnyTab(tabId, format = 'png') {
    let dataUrl
    try {
      dataUrl = await browser.tabs.captureTab(tabId, { format })
    } catch {
      try {
        const tab = await browser.tabs.get(tabId)
        await browser.tabs.update(tabId, { active: true })
        await browser.windows.update(tab.windowId, { focused: true })
        await new Promise((resolve) => setTimeout(resolve, 250))
        dataUrl = await browser.tabs.captureTab(tabId, { format })
      } catch (error) {
        throw new ExtError(
          'SCREENSHOT_FAILED',
          `截图失败: ${error.message || error}`,
          'Firefox 的截图通常要求标签页可见；把页面切到前台后重试。',
        )
      }
    }
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      throw new ExtError('SCREENSHOT_FAILED', '截图返回了空数据', '把标签页切到前台后重试。')
    }
    return dataUrl
  }

  async function captureTab(tabId, format = 'png') {
    await assertGroupTab(tabId)
    let dataUrl
    try {
      dataUrl = await browser.tabs.captureTab(tabId, { format })
    } catch {
      try {
        const tab = await browser.tabs.get(tabId)
        await browser.tabs.update(tabId, { active: true })
        await browser.windows.update(tab.windowId, { focused: true })
        await new Promise((resolve) => setTimeout(resolve, 250))
        dataUrl = await browser.tabs.captureTab(tabId, { format })
      } catch (error) {
        throw new ExtError(
          'SCREENSHOT_FAILED',
          `截图失败: ${error.message || error}`,
          'Firefox 的截图通常要求标签页可见；先 browser_tabs action=select 再重试。',
        )
      }
    }
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      throw new ExtError('SCREENSHOT_FAILED', '截图返回了空数据', '把标签页切到前台后重试。')
    }
    return dataUrl
  }

  async function handleHostRequest(op, params = {}) {
    if (state.paused && MUTATING_OPS.has(op)) {
      throw new ExtError('PAUSED', '浏览器已被用户急停', '让用户在扩展弹窗点“恢复”。')
    }
    if (state.mode === 'readonly' && MUTATING_OPS.has(op)) {
      throw new ExtError('MODE_DENIED', '只读取模式不允许改变页面的操作', '让用户切换模式。')
    }

    switch (op) {
      case 'tabs.list':
        return listGroupTabs()
      case 'tabs.open':
        return openTabInGroup(params.url, params.active === true, params.windowId)
      case 'tabs.navigate':
        return navigateTab(params.url, Number(params.tabId), params.active === true)
      case 'tabs.close': {
        const tabId = Number(params.tabId)
        await assertGroupTab(tabId)
        await browser.tabs.remove(tabId)
        return { closed: true, tabId }
      }
      case 'tabs.select': {
        const tabId = Number(params.tabId)
        const tab = await assertGroupTab(tabId)
        await browser.tabs.update(tabId, { active: true })
        try { await browser.windows.update(tab.windowId, { focused: true }) } catch { /* ignore */ }
        return tabSummary(await browser.tabs.get(tabId))
      }
      case 'inspect': {
        const tabId = Number(params.tabId)
        await assertGroupTab(tabId)
        return sendContent(tabId, 'inspect', { ref: params.ref })
      }
      case 'snapshot': {
        const tabId = Number(params.tabId)
        await assertGroupTab(tabId)
        return sendContent(tabId, 'snapshot', { maxChars: params.maxChars })
      }
      case 'click': {
        const tabId = Number(params.tabId)
        await assertGroupTab(tabId)
        let before = null
        try { before = await browser.tabs.get(tabId) } catch { /* ignore */ }
        let result
        try {
          result = await sendContent(tabId, 'click', { ref: params.ref })
        } catch (error) {
          await new Promise((resolve) => setTimeout(resolve, 800))
          let after = null
          try { after = await browser.tabs.get(tabId) } catch { /* ignore */ }
          if (after && (after.status === 'loading' || after.url !== before?.url)) {
            return {
              result: { clicked: true, navigation: true, note: 'page navigated before the content script replied' },
              tab: tabSummary(after),
            }
          }
          throw error
        }
        await new Promise((resolve) => setTimeout(resolve, 700))
        let tab
        try { tab = tabSummary(await browser.tabs.get(tabId)) } catch { tab = null }
        return { result, tab }
      }
      case 'type': {
        const tabId = Number(params.tabId)
        await assertGroupTab(tabId)
        let before = null
        try { before = await browser.tabs.get(tabId) } catch { /* ignore */ }
        let result
        try {
          result = await sendContent(tabId, 'type', {
            ref: params.ref,
            text: params.text,
            clear: params.clear !== false,
            submit: params.submit === true,
          })
        } catch (error) {
          if (!params.submit) throw error
          await new Promise((resolve) => setTimeout(resolve, 800))
          let after = null
          try { after = await browser.tabs.get(tabId) } catch { /* ignore */ }
          if (after && (after.status === 'loading' || after.url !== before?.url)) {
            return {
              result: { typed: true, submitted: true, navigation: true, note: 'form navigated before the content script replied' },
              tab: tabSummary(after),
            }
          }
          throw error
        }
        if (params.submit) await new Promise((resolve) => setTimeout(resolve, 700))
        let tab
        try { tab = tabSummary(await browser.tabs.get(tabId)) } catch { tab = null }
        return { result, tab }
      }
      case 'press': {
        const tabId = Number(params.tabId)
        await assertGroupTab(tabId)
        const result = await sendContent(tabId, 'press', { key: params.key })
        await new Promise((resolve) => setTimeout(resolve, 300))
        let tab
        try { tab = tabSummary(await browser.tabs.get(tabId)) } catch { tab = null }
        return { result, tab }
      }
      case 'scroll': {
        const tabId = Number(params.tabId)
        await assertGroupTab(tabId)
        return sendContent(tabId, 'scroll', {
          direction: params.direction,
          amount: params.amount,
          ref: params.ref,
        })
      }
      case 'wait': {
        const tabId = Number(params.tabId)
        await assertGroupTab(tabId)
        return sendContent(tabId, 'wait', {
          text: params.text,
          selector: params.selector,
          timeoutMs: params.timeoutMs,
        })
      }
      case 'screenshot': {
        const tabId = Number(params.tabId)
        const dataUrl = await captureTab(tabId, params.format === 'jpeg' ? 'jpeg' : 'png')
        let tab
        try { tab = tabSummary(await browser.tabs.get(tabId)) } catch { tab = null }
        return { dataUrl, tab }
      }
      case 'annotation.start': {
        const tabId = params.tabId ? Number(params.tabId) : await activeTabId()
        const tab = await browser.tabs.get(tabId)
        if (isRestrictedUrl(tab.url || tab.pendingUrl)) {
          throw new ExtError('UNSUPPORTED_PAGE', '这个页面不能注释', '换一个普通 http(s) 页面。')
        }
        await ensureContent(tabId)
        await sendContent(tabId, 'annotation.start', {
          mode: params.mode || 'element',
          requestId: params.requestId || null,
          hint: params.hint || '',
        })
        state.lastAnnotationTabId = tabId
        return { started: true, tab: tabSummary(tab) }
      }
      case 'annotation.cancel': {
        const tabId = params.tabId ? Number(params.tabId) : state.lastAnnotationTabId
        if (tabId) {
          try { await sendContent(tabId, 'annotation.cancel', { requestId: params.requestId || null }) } catch { /* ignore */ }
        }
        return { cancelled: true }
      }
      case 'status':
        return publicState()
      default:
        throw new ExtError('UNKNOWN_OP', `未知操作: ${op}`)
    }
  }

  async function activeTabId() {
    const active = await browser.tabs.query({ active: true, lastFocusedWindow: true })
    if (!active?.[0]?.id) throw new ExtError('NO_ACTIVE_TAB', '当前没有活动标签页')
    return active[0].id
  }

  async function startAnnotationOnActiveTab(mode = 'element') {
    const tabId = await activeTabId()
    const tab = await browser.tabs.get(tabId)
    if (isRestrictedUrl(tab.url || tab.pendingUrl)) {
      throw new ExtError('UNSUPPORTED_PAGE', '这个页面不能注释', '换一个普通 http(s) 页面。')
    }
    await ensureContent(tabId)
    await sendContent(tabId, 'annotation.start', {
      mode,
      requestId: null,
      hint: '在页面上点选元素、选中文字或框选区域，然后发送给 DSH。',
    })
    state.lastAnnotationTabId = tabId
    return { started: true, tabId, title: tab.title || '', url: tab.url || '' }
  }

  async function handleSidebarMessage(message) {
    switch (message.type) {
      case 'dshuf:get-state':
        return { ok: true, state: publicState() }
      case 'dshuf:save-settings': {
        const token = typeof message.token === 'string' ? message.token.trim() : state.token
        const port = Number(message.port || state.port)
        const label = typeof message.label === 'string' && message.label.trim() ? message.label.trim().slice(0, 60) : state.label
        if (!Number.isFinite(port) || port <= 0 || port > 65535) return { ok: false, error: '端口不合法' }
        state.token = token
        state.port = port
        state.label = label
        await saveSettings()
        try { state.ws?.close() } catch { /* ignore */ }
        state.ws = null
        state.connected = false
        state.connecting = false
        state.error = null
        connect()
        notify()
        return { ok: true, state: publicState() }
      }
      case 'dshuf:connect':
        connect()
        return { ok: true, state: publicState() }
      case 'dshuf:set-mode': {
        const mode = String(message.mode || '')
        if (!['full', 'auto', 'ask', 'readonly'].includes(mode)) return { ok: false, error: '模式不合法' }
        try {
          const result = await requestHost('mode.set', { mode })
          state.mode = result.mode
          state.modeLabel = result.modeLabel || mode
          notify()
          return { ok: true, state: publicState() }
        } catch (error) {
          return { ok: false, error: normalizeError(error).message }
        }
      }
      case 'dshuf:stop': {
        try {
          const result = await requestHost('paused.set', { paused: true })
          state.paused = result.paused === true
          notify()
          return { ok: true, state: publicState() }
        } catch (error) {
          return { ok: false, error: normalizeError(error).message }
        }
      }
      case 'dshuf:resume': {
        try {
          const result = await requestHost('paused.set', { paused: false })
          state.paused = result.paused === true
          notify()
          return { ok: true, state: publicState() }
        } catch (error) {
          return { ok: false, error: normalizeError(error).message }
        }
      }
      case 'dshuf:annotate-start': {
        try {
          const result = await startAnnotationOnActiveTab(message.mode || 'element')
          return { ok: true, state: publicState(), result }
        } catch (error) {
          return { ok: false, error: normalizeError(error).message }
        }
      }
      default:
        return { ok: false, error: `未知消息: ${message.type}` }
    }
  }

  browser.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === 'dshuf:annotation') {
      if (!sender?.tab?.id) return Promise.resolve({ ok: false, error: '缺少来源标签页' })
      const payload = {
        ...(message.payload || {}),
        tabId: sender.tab.id,
        page: {
          url: message.payload?.page?.url || sender.tab.url || '',
          title: message.payload?.page?.title || sender.tab.title || '',
        },
      }
      state.lastAnnotation = {
        kind: payload.kind,
        note: payload.note || '',
        text: String(payload.text || '').slice(0, 300),
        url: payload.page?.url || '',
        at: new Date().toISOString(),
      }
      notify()
      return sendEvent('annotation', payload).then((sent) => ({ ok: true, queued: !sent }))
    }
    if (message?.type === 'dshuf:annotation-cancel') {
      const requestId = message.requestId || null
      return sendEvent('annotation-cancel', { requestId }).then(() => ({ ok: true }))
    }
    if (message?.type === 'dshuf:capture-tab') {
      const tabId = sender?.tab?.id
      if (!tabId) return Promise.resolve({ ok: false, error: '缺少来源标签页' })
      return captureAnyTab(tabId, 'png').then(
        (dataUrl) => ({ ok: true, dataUrl }),
        (error) => ({ ok: false, error: normalizeError(error).message }),
      )
    }
    if (message?.type === 'dshuf:annotation-update') {
      return requestHost('annotation.update', {
        id: message.payload?.id,
        comment: String(message.payload?.comment || ''),
      }, 30_000).then(
        (data) => ({ ok: true, data }),
        (error) => ({ ok: false, error: normalizeError(error).message }),
      )
    }
    if (message?.type === 'dshuf:annotation-delete') {
      return requestHost('annotation.delete', { id: message.payload?.id }, 30_000).then(
        (data) => ({ ok: true, data }),
        (error) => ({ ok: false, error: normalizeError(error).message }),
      )
    }
    if (message?.type === 'dshuf:annotation-submit') {
      if (!sender?.tab?.id) return Promise.resolve({ ok: false, error: '缺少来源标签页' })
      const payload = {
        ...(message.payload || {}),
        tabId: sender.tab.id,
        page: {
          url: message.payload?.page?.url || sender.tab.url || '',
          title: message.payload?.page?.title || sender.tab.title || '',
        },
      }
      return requestHost('annotation.create', payload, 60_000).then(
        (data) => {
          state.lastAnnotation = {
            kind: payload.kind,
            comment: String(payload.comment || '').slice(0, 300),
            text: String(payload.text || '').slice(0, 300),
            url: payload.page?.url || '',
            at: new Date().toISOString(),
          }
          notify()
          return { ok: true, data }
        },
        (error) => ({ ok: false, error: normalizeError(error).message }),
      )
    }
    if (message?.type?.startsWith('dshuf:')) {
      return handleSidebarMessage(message)
    }
    return undefined
  })

  browser.tabs.onCreated.addListener((tab) => {
    const openerId = tab.openerTabId
    if (!openerId) return
    browser.tabs.get(openerId).then(async (opener) => {
      if (!opener || opener.groupId === undefined || opener.groupId < 0) return
      if ((await groupTitleOf(opener.groupId)) !== state.groupTitle) return
      try { await browser.tabs.group({ tabIds: [tab.id], groupId: opener.groupId }) } catch { /* ignore */ }
    }).catch(() => {})
  })

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === KEEPALIVE_ALARM || alarm.name === KEEPALIVE_ALARM_2) {
      if (!state.connected) connect()
      else if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        try { state.ws.send(JSON.stringify({ type: 'event', event: 'keepalive', data: { at: Date.now() } })) } catch { /* ignore */ }
      }
    }
  })

  browser.runtime.onInstalled.addListener(() => {
    browser.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.33 })
    browser.alarms.create(KEEPALIVE_ALARM_2, { delayInMinutes: 0.18, periodInMinutes: 0.33 })
    notify()
  })

  browser.runtime.onStartup.addListener(() => {
    connect()
  })

  async function boot() {
    await loadSettings()
    browser.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.33 })
    browser.alarms.create(KEEPALIVE_ALARM_2, { delayInMinutes: 0.18, periodInMinutes: 0.33 })
    notify()
    connect()
  }

  void boot()
})()
