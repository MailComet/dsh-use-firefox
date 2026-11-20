'use strict'

const el = {
  dot: document.getElementById('statusDot'),
  status: document.getElementById('statusText'),
  versions: document.getElementById('versionText'),
  mode: document.getElementById('modeBadge'),
  error: document.getElementById('errorText'),
  setup: document.getElementById('setup'),
  port: document.getElementById('portInput'),
  token: document.getElementById('tokenInput'),
  label: document.getElementById('labelInput'),
  save: document.getElementById('saveBtn'),
}

function render(state) {
  if (!state) return
  el.dot.className = `dot ${state.connected ? 'on' : state.error ? 'warn' : 'off'}`
  el.status.textContent = state.connected ? '已连接' : state.connecting ? '连接中…' : '未连接'
  el.versions.textContent = `插件 ${state.pluginVersion || '—'} · 扩展 ${state.extensionVersion || '—'}`
  el.mode.textContent = state.modeLabel || '—'
  el.error.hidden = !state.error
  el.error.textContent = state.error || ''
  el.setup.hidden = state.connected
  if (!state.connected) {
    el.port.value = state.port || 39271
    el.label.value = state.label || 'Firefox'
  }
}

async function refresh() {
  try {
    const response = await browser.runtime.sendMessage({ type: 'dshuf:get-state' })
    if (response?.ok) render(response.state)
    else if (response?.error) { el.error.hidden = false; el.error.textContent = response.error }
  } catch (error) {
    el.error.hidden = false
    el.error.textContent = error?.message || String(error)
  }
}

el.save.addEventListener('click', async () => {
  el.save.disabled = true
  try {
    const response = await browser.runtime.sendMessage({
      type: 'dshuf:save-settings',
      port: Number(el.port.value),
      token: el.token.value,
      label: el.label.value,
    })
    if (response?.ok) {
      el.token.value = ''
      render(response.state)
    } else {
      el.error.hidden = false
      el.error.textContent = response?.error || '保存失败'
    }
  } catch (error) {
    el.error.hidden = false
    el.error.textContent = error?.message || String(error)
  } finally {
    el.save.disabled = false
  }
})

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === 'dshuf:state') render(message.state)
})
refresh()
