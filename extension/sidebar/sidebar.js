(() => {
  'use strict'

  const MODE_HINTS = {
    full: '所有浏览器动作直接执行，不弹审批。仅保留工作区边界、审计和急停。',
    auto: '普通动作直接执行；提交、发送、支付、删除、密码、验证码、上传等敏感动作才问。',
    ask: '每个改变页面的动作（点击、输入、导航、上传、JS）都要确认。',
    readonly: '只允许读取、截图和注释；不导航、不点击、不输入、不执行 JS。',
  }

  const el = {
    dot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    errorText: document.getElementById('errorText'),
    versionText: document.getElementById('versionText'),
    modeBadge: document.getElementById('modeBadge'),
    stopBtn: document.getElementById('stopBtn'),
    resumeBtn: document.getElementById('resumeBtn'),
    portInput: document.getElementById('portInput'),
    tokenInput: document.getElementById('tokenInput'),
    labelInput: document.getElementById('labelInput'),
    saveBtn: document.getElementById('saveBtn'),
    connectBtn: document.getElementById('connectBtn'),
    modeSelect: document.getElementById('modeSelect'),
    modeHint: document.getElementById('modeHint'),
    annoMode: document.getElementById('annoMode'),
    annotateBtn: document.getElementById('annotateBtn'),
    groupName: document.getElementById('groupName'),
    clientText: document.getElementById('clientText'),
  }

  let lastState = null

  async function send(message) {
    try {
      return await browser.runtime.sendMessage(message)
    } catch (error) {
      return { ok: false, error: error.message || String(error) }
    }
  }

  function setError(message) {
    el.errorText.hidden = !message
    el.errorText.textContent = message || ''
  }

  function render(state) {
    if (!state) return
    lastState = state
    el.portInput.value = String(state.port || 39271)
    el.labelInput.value = state.label || 'Firefox'
    el.modeSelect.value = state.mode || 'full'
    el.modeHint.textContent = MODE_HINTS[state.mode] || MODE_HINTS.full
    el.modeBadge.textContent = state.modeLabel || el.modeSelect.options[el.modeSelect.selectedIndex]?.textContent || state.mode
    el.groupName.textContent = state.groupTitle || 'DSH'
    el.versionText.textContent = [
      state.pluginVersion ? `插件 ${state.pluginVersion}` : '插件未握手',
      state.extensionVersion ? `扩展 ${state.extensionVersion}` : '',
    ].filter(Boolean).join(' · ')

    if (state.connected) {
      el.dot.className = 'dot on'
      el.statusText.textContent = state.paused ? '已连接 · 已急停' : '已连接'
      el.clientText.textContent = `client ${state.clientId || ''}${state.label ? ` · ${state.label}` : ''}`
      el.connectBtn.disabled = true
      el.stopBtn.hidden = state.paused === true
      el.resumeBtn.hidden = state.paused !== true
    } else if (state.connecting) {
      el.dot.className = 'dot warn'
      el.statusText.textContent = '正在连接…'
      el.connectBtn.disabled = true
      el.stopBtn.hidden = false
      el.resumeBtn.hidden = true
    } else {
      el.dot.className = 'dot off'
      el.statusText.textContent = '未连接'
      el.clientText.textContent = state.clientId ? `client ${state.clientId}` : ''
      el.connectBtn.disabled = false
      el.stopBtn.hidden = false
      el.resumeBtn.hidden = true
    }

    setError(state.error || '')
  }

  async function refresh() {
    try {
      const stored = await browser.storage.local.get('dshuf-settings')
      const settings = stored?.['dshuf-settings'] || {}
      if (typeof settings.token === 'string') el.tokenInput.value = settings.token
      if (settings.port) el.portInput.value = String(settings.port)
      if (settings.label) el.labelInput.value = settings.label
    } catch { /* ignore */ }
    const response = await send({ type: 'dshuf:get-state' })
    if (response?.ok && response.state) render(response.state)
    else if (response?.error) setError(response.error)
  }

  el.saveBtn.addEventListener('click', async () => {
    el.saveBtn.disabled = true
    setError('')
    const response = await send({
      type: 'dshuf:save-settings',
      token: el.tokenInput.value.trim(),
      port: Number(el.portInput.value),
      label: el.labelInput.value.trim(),
    })
    el.saveBtn.disabled = false
    if (response?.ok) render(response.state)
    else setError(response?.error || '保存失败')
  })

  el.connectBtn.addEventListener('click', async () => {
    const response = await send({ type: 'dshuf:connect' })
    if (response?.ok) render(response.state)
    else setError(response?.error || '连接失败')
  })

  el.modeSelect.addEventListener('change', async () => {
    const mode = el.modeSelect.value
    el.modeSelect.disabled = true
    const response = await send({ type: 'dshuf:set-mode', mode })
    el.modeSelect.disabled = false
    if (response?.ok) {
      render(response.state)
    } else {
      setError(response?.error || '切换模式失败')
      if (lastState) el.modeSelect.value = lastState.mode || 'full'
    }
  })

  el.stopBtn.addEventListener('click', async () => {
    const response = await send({ type: 'dshuf:stop' })
    if (response?.ok) render(response.state)
    else setError(response?.error || '急停失败')
  })

  el.resumeBtn.addEventListener('click', async () => {
    const response = await send({ type: 'dshuf:resume' })
    if (response?.ok) render(response.state)
    else setError(response?.error || '恢复失败')
  })

  el.annotateBtn.addEventListener('click', async () => {
    el.annotateBtn.disabled = true
    const response = await send({ type: 'dshuf:annotate-start', mode: el.annoMode.value })
    el.annotateBtn.disabled = false
    if (response?.ok) {
      setError('')
      el.statusText.textContent = '已进入注释模式'
    } else {
      setError(response?.error || '无法开始注释')
    }
  })

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type === 'dshuf:state' && message.state) render(message.state)
  })

  refresh()
})()
