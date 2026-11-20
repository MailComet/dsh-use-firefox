(() => {
  'use strict'
  if (globalThis.__dshufHotkeyLoaded) return
  globalThis.__dshufHotkeyLoaded = true

  let stamp = 0

  function editable(target) {
    return target instanceof Element && Boolean(target.closest(
      'input, textarea, select, [contenteditable=""], [contenteditable="true"]',
    ))
  }

  function toast(message) {
    const node = document.createElement('div')
    node.textContent = message
    node.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;background:#0f172a;color:#fff;padding:8px 14px;border-radius:999px;font:12px system-ui,sans-serif;box-shadow:0 6px 22px rgba(15,23,42,.25);pointer-events:none;'
    document.documentElement.appendChild(node)
    setTimeout(() => node.remove(), 2400)
  }

  document.addEventListener('keydown', (event) => {
    if (event.isComposing || event.repeat) return
    if (document.getElementById('__dshuf_anno_host')) return
    if (editable(event.target)) return
    if (event.key === 'A' && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      stamp = Date.now()
      return
    }
    if ((event.key === 'n' || event.key === 'N') && Date.now() - stamp < 1200) {
      stamp = 0
      event.preventDefault()
      event.stopPropagation()
      browser.runtime.sendMessage({ type: 'dshuf:shortcut-annotate' }).then(
        (response) => {
          if (!response?.ok) toast(response?.error || '无法开始注释')
        },
        () => toast('无法连接 DSH'),
      )
    }
  }, true)
})()
