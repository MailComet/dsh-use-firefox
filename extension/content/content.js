(() => {
  'use strict'
  if (globalThis.__dshufContentLoaded) return
  globalThis.__dshufContentLoaded = true

  const ANNO_HOST_ID = '__dshuf_anno_host'
  const SENSITIVE_FIELD = /(password|passwd|pwd|otp|one[-_ ]?time|verification|captcha|token|secret|cvv|cvc|card[-_ ]?number|credit[-_ ]?card|安全码|验证码|密码|口令|信用卡|卡号)/i
  const CAPTCHA_HINT = /(captcha|recaptcha|hcaptcha|turnstile|verify you are human|验证码|人机验证|安全验证)/i
  const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio',
    'slider', 'spinbutton', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'option', 'tab', 'switch', 'treeitem', 'gridcell',
  ])

  let refs = new Map()
  let nextRef = 0
  let anno = null
  let annoHost = null
  const annoMarkers = new Map()

  class PageError extends Error {
    constructor(code, message, next = '') {
      super(message)
      this.name = 'PageError'
      this.code = code
      this.next = next
    }
  }

  function normalizeError(error) {
    if (error instanceof PageError) return { code: error.code, message: error.message, next: error.next }
    return { code: error?.code || 'PAGE_ERROR', message: error?.message || String(error), next: error?.next || '' }
  }

  function collapse(value, max = 200) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
  }

  function roleOf(element) {
    const explicit = element.getAttribute?.('role')
    if (explicit) return explicit.trim().toLowerCase()
    const tag = element.tagName?.toLowerCase()
    if (tag === 'a') return 'link'
    if (tag === 'button') return 'button'
    if (tag === 'select') return 'combobox'
    if (tag === 'textarea') return 'textbox'
    if (tag === 'summary') return 'button'
    if (tag === 'img') return 'img'
    if (/^h[1-6]$/.test(tag)) return 'heading'
    if (tag === 'ul' || tag === 'ol') return 'list'
    if (tag === 'li') return 'listitem'
    if (tag === 'table') return 'table'
    if (tag === 'tr') return 'row'
    if (tag === 'td' || tag === 'th') return 'cell'
    if (tag === 'nav') return 'navigation'
    if (tag === 'main') return 'main'
    if (tag === 'form') return 'form'
    if (tag === 'input') {
      const type = String(element.type || 'text').toLowerCase()
      if (type === 'checkbox') return 'checkbox'
      if (type === 'radio') return 'radio'
      if (type === 'range') return 'slider'
      if (type === 'number') return 'spinbutton'
      if (type === 'search') return 'searchbox'
      if (type === 'submit' || type === 'button' || type === 'reset' || type === 'file') return 'button'
      return 'textbox'
    }
    if (element.isContentEditable) return 'textbox'
    return ''
  }

  function isInteractive(element) {
    const tag = element.tagName?.toLowerCase()
    if (!tag || ['html', 'body', 'script', 'style', 'noscript', 'meta', 'link'].includes(tag)) return false
    const role = roleOf(element)
    if (INTERACTIVE_ROLES.has(role)) return true
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button' || tag === 'summary') return true
    if (tag === 'a' && element.hasAttribute('href')) return true
    if (element.isContentEditable) return true
    if (element.hasAttribute('tabindex') && Number(element.getAttribute('tabindex')) >= 0) return true
    if (element.hasAttribute('onclick') || element.onclick || element.hasAttribute('onmousedown')) return true
    if (element.hasAttribute('aria-haspopup')) return true
    return false
  }

  function isVisible(element) {
    if (!(element instanceof Element) || !element.isConnected) return false
    try {
      const style = getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
      if (element.checkVisibility) {
        if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false
      }
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return false
      return true
    } catch {
      return false
    }
  }

  function nameOf(element) {
    const ariaLabel = element.getAttribute?.('aria-label')
    if (ariaLabel && ariaLabel.trim()) return collapse(ariaLabel, 160)
    const labelledBy = element.getAttribute?.('aria-labelledby')
    if (labelledBy) {
      const label = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ')
      if (label.trim()) return collapse(label, 160)
    }
    if (element.labels?.length) {
      const label = collapse(element.labels[0].textContent, 160)
      if (label) return label
    }
    const placeholder = element.getAttribute?.('placeholder')
    if (placeholder && placeholder.trim()) return collapse(placeholder, 160)
    const title = element.getAttribute?.('title')
    if (title && title.trim()) return collapse(title, 160)
    const alt = element.getAttribute?.('alt')
    if (alt && alt.trim()) return collapse(alt, 160)
    if (element.tagName === 'INPUT' && ['button', 'submit', 'reset'].includes(String(element.type).toLowerCase())) {
      const value = collapse(element.value, 160)
      if (value) return value
    }
    const text = collapse(element.innerText || element.textContent || '', 160)
    return text
  }

  function isSensitiveElement(element) {
    if (!element) return false
    if (String(element.type || '').toLowerCase() === 'password') return true
    return SENSITIVE_FIELD.test(`${element.name || ''} ${element.id || ''} ${element.getAttribute?.('placeholder') || ''} ${element.getAttribute?.('autocomplete') || ''}`)
  }

  function descriptorFor(element) {
    if (!(element instanceof Element)) return null
    const rect = element.getBoundingClientRect()
    return {
      tag: element.tagName.toLowerCase(),
      role: roleOf(element) || element.tagName.toLowerCase(),
      name: nameOf(element),
      type: String(element.type || '').toLowerCase(),
      id: element.id || '',
      nameAttr: element.getAttribute?.('name') || '',
      placeholder: element.getAttribute?.('placeholder') || '',
      autocomplete: element.getAttribute?.('autocomplete') || '',
      href: element.tagName === 'A' ? String(element.href || '').slice(0, 600) : '',
      disabled: element.disabled === true || element.getAttribute?.('aria-disabled') === 'true',
      required: element.required === true || element.getAttribute?.('aria-required') === 'true',
      readOnly: element.readOnly === true,
      inForm: Boolean(element.form),
      formAction: element.form?.action ? String(element.form.action).slice(0, 600) : '',
      contentEditable: element.isContentEditable === true,
      sensitive: isSensitiveElement(element),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    }
  }

  function inViewport(rect) {
    return rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth
  }

  function addElement(element, elements, seen) {
    if (seen.has(element)) return
    seen.add(element)
    if (!isVisible(element)) return
    const rect = element.getBoundingClientRect()
    const ref = `e${++nextRef}`
    refs.set(ref, element)
    const descriptor = descriptorFor(element)
    const item = {
      ref,
      tag: descriptor.tag,
      role: descriptor.role,
      name: descriptor.name,
      type: descriptor.type || undefined,
      checked: element.checked === true,
      disabled: descriptor.disabled,
      required: descriptor.required,
      readOnly: descriptor.readOnly,
      sensitive: descriptor.sensitive || undefined,
      placeholder: descriptor.placeholder || undefined,
      href: descriptor.href || undefined,
      inViewport: inViewport(rect),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    }
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      item.value = descriptor.sensitive ? '••••' : String(element.value || '').slice(0, 300)
    } else if (element.tagName === 'SELECT') {
      item.value = descriptor.sensitive ? '••••' : String(element.value || '').slice(0, 300)
    }
    elements.push(item)
  }

  function walk(root, elements, seen, stats, depth = 0) {
    if (!root || depth > 120 || stats.visited > 12_000 || elements.length >= 300) return
    const children = []
    if (root instanceof Element) children.push(root)
    else if (root.children) children.push(...root.children)
    for (const element of children) {
      stats.visited += 1
      if (element.id === ANNO_HOST_ID) continue
      if (isInteractive(element)) {
        stats.interactiveTotal += 1
        addElement(element, elements, seen)
      }
      for (const child of element.children || []) walk(child, elements, seen, stats, depth + 1)
      if (element.shadowRoot) {
        for (const child of element.shadowRoot.children || []) walk(child, elements, seen, stats, depth + 1)
      }
    }
  }

  function collectDialogs() {
    const result = []
    const candidates = document.querySelectorAll('[role="dialog"],[role="alertdialog"],dialog[open]')
    for (const element of candidates) {
      if (!isVisible(element)) continue
      result.push({
        role: element.getAttribute('role') || 'dialog',
        name: nameOf(element),
        text: collapse(element.innerText || element.textContent || '', 500),
      })
      if (result.length >= 5) break
    }
    return result
  }

  function collectFrames() {
    const frames = []
    for (const frame of document.querySelectorAll('iframe,frame')) {
      const src = frame.getAttribute('src') || ''
      const title = frame.getAttribute('title') || ''
      if (!src && !title) continue
      frames.push({ src: src.slice(0, 600), title: title.slice(0, 200) })
      if (frames.length >= 20) break
    }
    return frames
  }

  function detectCaptcha(text) {
    const clues = []
    for (const element of document.querySelectorAll('iframe[src],img[src]')) {
      const src = String(element.getAttribute('src') || '')
      if (CAPTCHA_HINT.test(src)) clues.push(src.slice(0, 160))
      if (clues.length >= 4) break
    }
    if (CAPTCHA_HINT.test(text.slice(0, 20_000))) clues.push('page text mentions verification')
    return { detected: clues.length > 0, clues: [...new Set(clues)].slice(0, 5) }
  }

  function buildSnapshot(maxChars = 20_000) {
    refs = new Map()
    nextRef = 0
    const elements = []
    const seen = new Set()
    const stats = { visited: 0, interactiveTotal: 0 }
    walk(document.documentElement, elements, seen, stats)
    const text = String(document.body?.innerText || document.documentElement?.innerText || '')
      .replace(/\s+/g, ' ')
      .trim()
    const limit = Math.max(1000, Math.min(Number(maxChars) || 20_000, 50_000))
    const textTruncated = text.length > limit
    const active = document.activeElement
    let focused = null
    if (active && active instanceof Element) {
      let activeRef = null
      for (const [ref, element] of refs) {
        if (element === active) { activeRef = ref; break }
      }
      focused = {
        ref: activeRef,
        tag: active.tagName.toLowerCase(),
        role: roleOf(active) || active.tagName.toLowerCase(),
        name: nameOf(active),
      }
    }
    const selection = window.getSelection()?.toString() || ''
    return {
      url: location.href,
      title: document.title,
      readyState: document.readyState,
      scroll: {
        x: window.scrollX,
        y: window.scrollY,
        height: Math.max(document.documentElement?.scrollHeight || 0, document.body?.scrollHeight || 0),
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        container: scrollDescriptor(pageScroller()),
      },
      focused,
      selection: selection.slice(0, 500),
      elements: elements.slice(0, 250),
      interactiveTotal: stats.interactiveTotal,
      text: text.slice(0, limit),
      textTruncated,
      textMax: limit,
      dialogs: collectDialogs(),
      captcha: detectCaptcha(text),
      frames: collectFrames(),
    }
  }

  function resolveRef(ref) {
    const element = refs.get(String(ref))
    if (!element || !element.isConnected) {
      throw new PageError('STALE_REF', `元素引用 ${ref} 已失效`, '重新调用 browser_read 获取新的 ref。')
    }
    return element
  }

  function isCoveredByOverlay(element, top) {
    if (!top) return false
    if (top === element || element.contains(top)) return false
    let node = top
    for (let depth = 0; node && depth < 6; depth += 1) {
      if (node === element) return false
      if (node.shadowRoot?.contains(element)) return false
      node = node.parentNode || (node.getRootNode?.()?.host) || null
    }
    return true
  }

  function checkHit(element) {
    const rect = element.getBoundingClientRect()
    const x = Math.min(Math.max(rect.left + rect.width / 2, 0), innerWidth - 1)
    const y = Math.min(Math.max(rect.top + rect.height / 2, 0), innerHeight - 1)
    const top = document.elementFromPoint(x, y)
    if (isCoveredByOverlay(element, top)) {
      throw new PageError(
        'COVERED',
        `目标被其他元素遮挡: ${top?.tagName?.toLowerCase() || 'unknown'} ${nameOf(top) ? JSON.stringify(nameOf(top)) : ''}`,
        '先关闭遮罩/对话框，或重新读取页面找可点击的元素。',
      )
    }
    return { x, y }
  }

  function dispatchClick(element, point) {
    const base = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: point.x,
      clientY: point.y,
      screenX: point.x,
      screenY: point.y,
      button: 0,
      buttons: 1,
    }
    const pointer = (type, extra = {}) => {
      const event = typeof PointerEvent === 'function'
        ? new PointerEvent(type, { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true, ...extra })
        : new MouseEvent(type, { ...base, ...extra })
      element.dispatchEvent(event)
    }
    pointer('pointerover')
    element.dispatchEvent(new MouseEvent('mouseover', base))
    pointer('pointerdown')
    element.dispatchEvent(new MouseEvent('mousedown', base))
    pointer('pointerup', { buttons: 0 })
    element.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }))
    try { element.click() } catch { /* ignore */ }
  }

  function clickElement(ref) {
    const element = resolveRef(ref)
    const descriptor = descriptorFor(element)
    if (descriptor.disabled) throw new PageError('DISABLED', '元素已禁用', '换一个可用元素。')
    if (String(element.type || '').toLowerCase() === 'file') {
      throw new PageError('UNSUPPORTED', '文件上传输入框不能通过点击操作', '这次版本暂不支持文件上传。')
    }
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
    if (!isVisible(element)) throw new PageError('NOT_VISIBLE', '元素不可见', '重新读取页面，选择可见元素。')
    try { element.focus({ preventScroll: true }) } catch { try { element.focus() } catch { /* ignore */ } }
    const point = checkHit(element)
    dispatchClick(element, point)
    return { descriptor }
  }

  function setNativeValue(element, value) {
    if (element instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      if (setter) setter.call(element, value)
      else element.value = value
    } else if (element instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      if (setter) setter.call(element, value)
      else element.value = value
    } else {
      element.value = value
    }
  }

  function fireInput(element, value) {
    try {
      element.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: value }))
    } catch {
      element.dispatchEvent(new Event('input', { bubbles: true }))
    }
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function typeInto(ref, text, clear = true, submit = false) {
    const element = resolveRef(ref)
    const descriptor = descriptorFor(element)
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
    try { element.focus({ preventScroll: true }) } catch { element.focus() }

    if (element.tagName === 'SELECT') {
      const desired = String(text)
      let matched = false
      for (const option of element.options) {
        if (String(option.value) === desired || collapse(option.textContent, 200) === desired) {
          element.value = option.value
          matched = true
          break
        }
      }
      if (!matched) throw new PageError('OPTION_NOT_FOUND', `下拉框没有匹配的选项: ${desired}`, '用 browser_read 查看下拉框的选项值。')
      element.dispatchEvent(new Event('change', { bubbles: true }))
      return { descriptor, submitted: false, sensitive: descriptor.sensitive }
    }

    if (String(element.type || '').toLowerCase() === 'file') {
      throw new PageError('UNSUPPORTED', '文件上传输入框不能直接赋值', '这次版本暂不支持文件上传。')
    }

    if (String(element.type || '').toLowerCase() === 'checkbox' || String(element.type || '').toLowerCase() === 'radio') {
      const desired = String(text).toLowerCase()
      const shouldCheck = ['1', 'true', 'on', 'yes', 'checked', '是', '对'].includes(desired)
      if (element.checked !== shouldCheck) element.click()
      return { descriptor, submitted: false, sensitive: descriptor.sensitive }
    }

    if (element.isContentEditable) {
      const range = document.createRange()
      range.selectNodeContents(element)
      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      let inserted = false
      try { inserted = document.execCommand('insertText', false, String(text)) } catch { inserted = false }
      if (!inserted) {
        element.textContent = String(text)
        fireInput(element, String(text))
      } else {
        element.dispatchEvent(new Event('input', { bubbles: true }))
      }
      return { descriptor, submitted: false, sensitive: descriptor.sensitive }
    }

    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
      throw new PageError('UNSUPPORTED', '目标不是可输入元素', '用 browser_read 找 textbox/textarea。')
    }

    const nextValue = clear === false ? `${element.value || ''}${text}` : String(text)
    setNativeValue(element, nextValue)
    fireInput(element, nextValue)

    if (submit) {
      const form = element.form || element.closest('form')
      if (form?.requestSubmit) form.requestSubmit()
      else if (form) form.submit()
      else {
        const ev = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }
        element.dispatchEvent(new KeyboardEvent('keydown', ev))
        element.dispatchEvent(new KeyboardEvent('keyup', ev))
      }
    }
    return { descriptor, submitted: Boolean(submit), sensitive: descriptor.sensitive }
  }

  const KEY_CODES = {
    Enter: 13,
    NumpadEnter: 13,
    Tab: 9,
    Escape: 27,
    Backspace: 8,
    Delete: 46,
    ArrowUp: 38,
    ArrowDown: 40,
    ArrowLeft: 37,
    ArrowRight: 39,
    PageUp: 33,
    PageDown: 34,
    Home: 36,
    End: 35,
    ' ': 32,
  }

  function insertPrintable(target, text) {
    if (!(target instanceof HTMLElement)) return false
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      if (String(target.type || '').toLowerCase() === 'file') return false
      const start = typeof target.selectionStart === 'number' ? target.selectionStart : target.value.length
      const end = typeof target.selectionEnd === 'number' ? target.selectionEnd : start
      const next = `${target.value.slice(0, start)}${text}${target.value.slice(end)}`
      setNativeValue(target, next)
      if (target.setSelectionRange) target.setSelectionRange(start + text.length, start + text.length)
      fireInput(target, next)
      return true
    }
    if (target.isContentEditable) {
      try {
        if (!document.execCommand('insertText', false, text)) return false
        target.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      } catch {
        return false
      }
    }
    return false
  }

  function pressKey(key) {
    const target = document.activeElement && document.activeElement !== document.body
      ? document.activeElement
      : document.body
    if (!target) throw new PageError('NO_TARGET', '找不到键盘目标')
    const name = String(key)
    const eventInit = {
      key: name === 'NumpadEnter' ? 'Enter' : name,
      code: name,
      keyCode: KEY_CODES[name] ?? (name.length === 1 ? name.toUpperCase().charCodeAt(0) : 0),
      which: KEY_CODES[name] ?? (name.length === 1 ? name.toUpperCase().charCodeAt(0) : 0),
      bubbles: true,
      cancelable: true,
      composed: true,
    }

    const printable = name.length === 1 && !/[\u0000-\u001f]/.test(name)
    const editable = target instanceof HTMLElement && (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target.isContentEditable
    )
    if (printable && editable) {
      target.dispatchEvent(new KeyboardEvent('keydown', eventInit))
      const inserted = insertPrintable(target, name)
      target.dispatchEvent(new KeyboardEvent('keyup', eventInit))
      return { key: name, inserted, descriptor: descriptorFor(target) }
    }

    target.dispatchEvent(new KeyboardEvent('keydown', eventInit))
    target.dispatchEvent(new KeyboardEvent('keypress', eventInit))
    target.dispatchEvent(new KeyboardEvent('keyup', eventInit))
    return { key: name, inserted: false, descriptor: descriptorFor(target) }
  }

  function scrollableAncestor(element) {
    let node = element
    while (node && node instanceof Element) {
      try {
        const style = getComputedStyle(node)
        if (/(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 4) return node
      } catch { /* ignore */ }
      node = node.parentElement || node.getRootNode?.()?.host || null
    }
    return null
  }

  function scrollDescriptor(node) {
    if (!node) return null
    return {
      tag: node.tagName?.toLowerCase() || '',
      id: node.id || '',
      className: typeof node.className === 'string' ? node.className.slice(0, 80) : '',
      scrollTop: Math.round(node.scrollTop || 0),
      scrollHeight: Math.round(node.scrollHeight || 0),
      clientHeight: Math.round(node.clientHeight || 0),
    }
  }

  function pageScroller() {
    try {
      const center = document.elementFromPoint(innerWidth / 2, innerHeight / 2)
      return scrollableAncestor(center)
    } catch {
      return null
    }
  }

  function scrollPage(direction = 'down', amount = 3, ref = null) {
    if (ref) {
      const element = resolveRef(ref)
      element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
      return { x: window.scrollX, y: window.scrollY, container: null }
    }

    const scroller = pageScroller()
    const steps = Math.max(1, Math.min(Number(amount) || 3, 10))
    const delta = steps * 100
    if (scroller) {
      if (direction === 'top') scroller.scrollTop = 0
      else if (direction === 'bottom') scroller.scrollTop = scroller.scrollHeight
      else if (direction === 'up') scroller.scrollTop -= delta
      else if (direction === 'left') scroller.scrollLeft -= delta
      else if (direction === 'right') scroller.scrollLeft += delta
      else scroller.scrollTop += delta
      return { x: window.scrollX, y: window.scrollY, container: scrollDescriptor(scroller) }
    }

    if (direction === 'top') window.scrollTo({ top: 0, behavior: 'instant' })
    else if (direction === 'bottom') window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
    else if (direction === 'up') window.scrollBy(0, -delta)
    else if (direction === 'left') window.scrollBy(-delta, 0)
    else if (direction === 'right') window.scrollBy(delta, 0)
    else window.scrollBy(0, delta)
    return { x: window.scrollX, y: window.scrollY, container: null }
  }

  async function waitFor({ text, selector, timeoutMs = 5000 }) {
    const limit = Math.max(200, Math.min(Number(timeoutMs) || 5000, 30_000))
    const start = Date.now()
    while (Date.now() - start <= limit) {
      let selectorFound = true
      let textFound = true
      if (selector) {
        try { selectorFound = Boolean(document.querySelector(selector)) } catch { selectorFound = false }
      }
      if (text) textFound = String(document.body?.innerText || '').includes(String(text))
      if (selectorFound && textFound) return { found: true, elapsedMs: Date.now() - start }
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    return { found: false, elapsedMs: Date.now() - start }
  }

  function inspectRef(ref) {
    const element = resolveRef(ref)
    return descriptorFor(element)
  }

  function cssEscape(value) {
    try { return CSS.escape(String(value)) } catch { return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&') }
  }

  function targetPathOf(element) {
    if (!(element instanceof Element)) return ''
    const parts = []
    let current = element
    let depth = 0
    while (current && current.nodeType === 1 && depth < 16) {
      let part = current.tagName.toLowerCase()
      const parent = current.parentElement
      if (parent) {
        const siblings = Array.from(parent.children).filter((sibling) => sibling.tagName === current.tagName)
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`
      }
      parts.unshift(part)
      if (current === document.body) break
      current = parent
      depth += 1
    }
    return parts.join(' > ')
  }

  function selectorOf(element) {
    if (!(element instanceof Element)) return ''
    if (element.id) return `#${cssEscape(element.id)}`
    const parts = []
    let current = element
    for (let depth = 0; current && current.nodeType === 1 && depth < 6; depth += 1) {
      let part = current.tagName.toLowerCase()
      const classes = Array.from(current.classList || []).slice(0, 2)
      if (classes.length) part += `.${classes.map(cssEscape).join('.')}`
      const parent = current.parentElement
      if (parent) {
        const siblings = Array.from(parent.children).filter((sibling) => sibling.tagName === current.tagName)
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`
      }
      parts.unshift(part)
      current = parent
      if (current === document.body) break
    }
    return parts.join(' > ')
  }

  function elementInfo(element) {
    if (!(element instanceof Element)) return null
    const rect = element.getBoundingClientRect()
    const descriptor = descriptorFor(element)
    return {
      kind: 'element',
      selector: selectorOf(element),
      descriptor,
      text: collapse(element.innerText || element.textContent || '', 2000),
      html: String(element.outerHTML || '').slice(0, 4000),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      page: { url: location.href, title: document.title },
    }
  }

const ANNO_ICONS = {
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/></svg>',
    sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h6M14 7h6M4 17h2M10 17h10"/><circle cx="12" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l4 4L19 6"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  }

  function annoIcon(name) {
    const parsed = new DOMParser().parseFromString(`<body>${ANNO_ICONS[name]}</body>`, 'text/html')
    const svg = parsed.body.querySelector('svg')
    return svg ? document.importNode(svg, true) : null
  }

  const ANNO_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", "Noto Sans CJK SC", sans-serif; }
    .hidden { display: none !important; }
    .hint {
      position: fixed; left: 50%; top: 14px; transform: translateX(-50%);
      display: flex; align-items: center; gap: 8px; max-width: min(92vw, 680px);
      padding: 7px 8px 7px 12px; border-radius: 999px; pointer-events: auto;
      background: #ffffff; color: #374151; border: 1px solid #dbe3ef;
      box-shadow: 0 6px 22px rgba(15, 23, 42, .16); font-size: 12px; line-height: 1.4;
    }
    .hint-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .outline {
      position: fixed; z-index: 2147483645; border: 2px solid #2563eb;
      background: rgba(37, 99, 235, .07); border-radius: 4px; pointer-events: none;
      box-shadow: 0 0 0 1px rgba(255,255,255,.35);
    }
    .region {
      position: fixed; z-index: 2147483645; border: 2px dashed #2563eb;
      background: rgba(37, 99, 235, .09); border-radius: 4px; pointer-events: none;
    }
    .card, .details {
      position: fixed; z-index: 2147483647; width: min(420px, calc(100vw - 24px));
      background: #ffffff; color: #111827; border: 1px solid rgba(15, 23, 42, .09);
      border-radius: 14px; box-shadow: 0 16px 50px rgba(15, 23, 42, .22);
      pointer-events: auto; padding: 10px 12px; font-size: 13px;
    }
    .card textarea {
      display: block; width: 100%; min-height: 44px; max-height: 160px; resize: none;
      border: 0; outline: 0; background: transparent; color: #111827;
      font: 14px/1.5 inherit; padding: 4px 0; margin: 0;
    }
    .card textarea::placeholder { color: #9ca3af; }
    .card .bar { display: flex; align-items: center; gap: 4px; margin-top: 4px; }
    .card .grow { flex: 1; }
    .icon {
      width: 30px; height: 30px; padding: 0; border: 0; border-radius: 8px;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent; color: #6b7280; cursor: pointer;
    }
    .icon:hover { background: #f3f4f6; color: #111827; }
    .icon svg { width: 17px; height: 17px; }
    .icon.danger:hover { color: #dc2626; background: #fef2f2; }
    .icon.small { width: 22px; height: 22px; }
    .icon.small svg { width: 13px; height: 13px; }
    .icon.confirm { width: 30px; height: 30px; border-radius: 50%; background: #16a34a; color: #ffffff; }
    .icon.confirm:hover { background: #15803d; color: #ffffff; }
    .card-error { color: #dc2626; font-size: 12px; margin-top: 4px; white-space: pre-wrap; }
    .details { width: min(440px, calc(100vw - 24px)); max-height: min(72vh, 640px); overflow: auto; }
    .details-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .details-tag { color: #6b7280; font-size: 13px; font-weight: 600; }
    .details-comment { margin-top: 9px; padding: 7px 9px; border-radius: 8px; background: #f8fafc; color: #111827; white-space: pre-wrap; word-break: break-word; font-size: 12px; }
    .details-rows { display: flex; flex-direction: column; gap: 5px; margin-top: 10px; }
    .detail-row { display: grid; grid-template-columns: 78px 1fr; gap: 8px; align-items: center; padding: 4px 0; border-bottom: 1px solid #eef1f5; }
    .detail-label { color: #6b7280; font-size: 12px; }
    .detail-value { color: #111827; font-size: 12px; line-height: 1.4; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 6px; padding: 5px 7px; min-height: 28px; word-break: break-all; }
    .details-foot { display: flex; justify-content: flex-end; border-top: 1px solid #eef1f5; padding-top: 8px; margin-top: 8px; }
    .details-foot button {
      appearance: none; border: 1px solid #e5e7eb; background: #ffffff; color: #374151;
      border-radius: 8px; padding: 5px 10px; font-size: 12px; cursor: pointer;
    }
    .details-foot button:hover { background: #f9fafb; }
    .markers { position: fixed; inset: 0; z-index: 2147483644; pointer-events: none; }
    .marker {
      position: fixed; width: 24px; height: 24px; border-radius: 50%;
      border: 2px solid #ffffff; background: #2563eb; color: #ffffff;
      font: 600 12px/20px system-ui, sans-serif; text-align: center;
      box-shadow: 0 2px 9px rgba(37, 99, 235, .45); pointer-events: auto;
      cursor: pointer; transform: translate(50%, -50%);
    }
    .toast {
      position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%);
      background: #0f172a; color: #ffffff; padding: 8px 14px; border-radius: 999px;
      font-size: 12px; opacity: 0; pointer-events: none; transition: opacity .18s ease;
    }
    .toast.show { opacity: 1; }
  `

  function ensureAnnoHost() {
    if (annoHost?.host?.isConnected) return annoHost
    const host = document.createElement('div')
    host.id = ANNO_HOST_ID
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;'
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = `
      <style></style>
      <div class="hint hidden"><span class="hint-text"></span><button data-cancel-hint class="icon small" title="取消"></button></div>
      <div class="outline hidden"></div>
      <div class="region hidden"></div>
      <div class="card hidden">
        <textarea rows="2" placeholder="添加评论…"></textarea>
        <div class="bar">
          <button data-delete class="icon danger" title="删除"></button>
          <span class="grow"></span>
          <button data-details class="icon" title="元素详情"></button>
          <button data-confirm class="icon confirm" title="确认"></button>
        </div>
        <div class="card-error hidden"></div>
      </div>
      <div class="details hidden">
        <div class="details-head"><span class="details-tag"></span><button data-close-details class="icon" title="关闭"></button></div>
        <div class="details-comment"></div>
        <div class="details-rows"></div>
        <div class="details-foot"><button data-close-details>关闭</button></div>
      </div>
      <div class="markers"></div>
      <div class="toast"></div>
    `
    shadow.querySelector('style').textContent = ANNO_CSS
    document.documentElement.appendChild(host)
    const q = (selector) => shadow.querySelector(selector)
    for (const [selector, icon] of [['[data-cancel-hint]', 'close'], ['[data-delete]', 'trash'], ['[data-details]', 'sliders'], ['[data-confirm]', 'check']]) {
      const node = annoIcon(icon)
      if (node) q(selector).append(node)
    }
    for (const button of shadow.querySelectorAll('[data-close-details]')) {
      const node = annoIcon('close')
      if (node) button.append(node)
    }
    const ui = {
      host,
      shadow,
      hint: q('.hint'),
      hintText: q('.hint-text'),
      outline: q('.outline'),
      region: q('.region'),
      card: q('.card'),
      textarea: q('.card textarea'),
      error: q('.card-error'),
      details: q('.details'),
      detailsTag: q('.details-tag'),
      detailsComment: q('.details-comment'),
      detailsRows: q('.details-rows'),
      markers: q('.markers'),
      toast: q('.toast'),
    }
    q('[data-cancel-hint]').addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); cancelAnnotation() })
    q('[data-delete]').addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); removeAnnotationDraft() })
    q('[data-details]').addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); showDetails() })
    q('[data-confirm]').addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); submitAnnotation() })
    for (const button of shadow.querySelectorAll('[data-close-details]')) {
      button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); hideDetails() })
    }
    ui.textarea.addEventListener('input', () => {
      ui.textarea.style.height = 'auto'
      ui.textarea.style.height = `${Math.min(160, Math.max(44, ui.textarea.scrollHeight))}px`
      if (anno?.phase === 'card') positionDraft()
    })
    ui.textarea.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if (event.key === 'Escape') {
        event.preventDefault()
        cancelAnnotation()
      } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        submitAnnotation()
      }
    })
    annoHost = ui
    const reposition = () => {
      if (anno?.phase === 'card' || anno?.phase === 'details') positionDraft()
      positionAnnoMarkers()
    }
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return ui
  }

  function isInsideAnnoUi(event) {
    const path = event?.composedPath?.() || []
    return Boolean(annoHost?.host && path.includes(annoHost.host))
  }

  function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, value))
  }

  function normalizedRect(rect) {
    const x = Math.min(rect.x, rect.x + rect.width)
    const y = Math.min(rect.y, rect.y + rect.height)
    return { x, y, width: Math.abs(rect.width), height: Math.abs(rect.height) }
  }

  function elementAt(x, y) {
    const element = document.elementFromPoint(x, y)
    if (!element || element.id === ANNO_HOST_ID) return null
    return element
  }

  function draftRect() {
    if (!anno) return null
    if (anno.kind === 'element' && anno.selected?.isConnected) {
      const rect = anno.selected.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) return rect
    }
    if (anno.pageRect) {
      return {
        x: anno.pageRect.x - window.scrollX,
        y: anno.pageRect.y - window.scrollY,
        width: anno.pageRect.width,
        height: anno.pageRect.height,
      }
    }
    return anno.rect
  }

  function placeFloating(element, rect, gap = 10) {
    if (!element || !rect) return
    const width = Math.min(440, Math.max(260, window.innerWidth - 16))
    element.style.width = `${width}px`
    element.style.left = `${clampNumber(rect.x, 8, Math.max(8, window.innerWidth - width - 8))}px`
    element.classList.remove('hidden')
    const height = element.offsetHeight || 160
    const below = rect.y + rect.height + gap
    const top = below + height <= window.innerHeight - 8 ? below : Math.max(8, rect.y - height - gap)
    element.style.top = `${top}px`
  }

  function setOutline(rect) {
    const ui = annoHost
    if (!ui) return
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      ui.outline.classList.add('hidden')
      return
    }
    ui.outline.classList.remove('hidden')
    ui.outline.style.left = `${rect.x}px`
    ui.outline.style.top = `${rect.y}px`
    ui.outline.style.width = `${rect.width}px`
    ui.outline.style.height = `${rect.height}px`
  }

  function setRegion(rect) {
    const ui = annoHost
    if (!ui) return
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      ui.region.classList.add('hidden')
      return
    }
    ui.region.classList.remove('hidden')
    ui.region.style.left = `${rect.x}px`
    ui.region.style.top = `${rect.y}px`
    ui.region.style.width = `${rect.width}px`
    ui.region.style.height = `${rect.height}px`
  }

  function positionDraft() {
    if (!anno || !annoHost) return
    const rect = draftRect()
    if (!rect) return
    if (anno.kind === 'region') {
      setRegion(rect)
      setOutline(null)
    } else {
      setOutline(rect)
      setRegion(null)
    }
    if (anno.phase === 'card') placeFloating(annoHost.card, rect)
    if (anno.phase === 'details') placeFloating(annoHost.details, rect)
  }

  function detailsFor(element) {
    if (!(element instanceof Element)) return null
    const style = getComputedStyle(element)
    return {
      tag: element.tagName.toLowerCase(),
      selector: selectorOf(element),
      color: style.color,
      backgroundColor: style.backgroundColor,
      opacity: Math.round((Number.parseFloat(style.opacity) || 1) * 100),
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      borderColor: style.borderColor,
      borderRadius: style.borderRadius,
      borderWidth: style.borderWidth,
      width: style.width,
      height: style.height,
      display: style.display,
      lineHeight: style.lineHeight,
      padding: style.padding,
      margin: style.margin,
    }
  }

  function showDetails() {
    if (!anno || anno.busy) return
    const info = detailsFor(anno.selected)
    if (!info) return
    const ui = annoHost
    ui.detailsTag.textContent = info.tag || 'region'
    ui.detailsComment.textContent = ui.textarea.value.trim() || '（暂无评论）'
    const rows = [
      ['文字颜色', info.color],
      ['背景颜色', info.backgroundColor],
      ['透明度', `${info.opacity}`],
      ['字体', info.fontFamily],
      ['字号', info.fontSize],
      ['字重', info.fontWeight],
      ['边框颜色', info.borderColor],
      ['圆角', info.borderRadius],
      ['边框宽度', info.borderWidth],
      ['宽度', info.width],
      ['高度', info.height],
      ['显示', info.display],
      ['行高', info.lineHeight],
      ['内边距', info.padding],
      ['外边距', info.margin],
    ]
    ui.detailsRows.replaceChildren(...rows.map(([label, value]) => {
      const row = document.createElement('div')
      row.className = 'detail-row'
      const key = document.createElement('div')
      key.className = 'detail-label'
      key.textContent = label
      const val = document.createElement('div')
      val.className = 'detail-value'
      val.textContent = String(value ?? '')
      row.append(key, val)
      return row
    }))
    ui.card.classList.add('hidden')
    ui.details.classList.remove('hidden')
    anno.phase = 'details'
    placeFloating(ui.details, draftRect())
  }

  function hideDetails() {
    if (!anno || anno.phase !== 'details') return
    const ui = annoHost
    ui.details.classList.add('hidden')
    ui.card.classList.remove('hidden')
    anno.phase = 'card'
    positionDraft()
    ui.textarea.focus()
  }

  function showToast(text) {
    if (!annoHost) return
    const toast = annoHost.toast
    toast.textContent = text
    toast.classList.add('show')
    setTimeout(() => toast.classList.remove('show'), 1800)
  }

  function positionAnnoMarkers() {
    if (!annoHost) return
    for (const record of annoMarkers.values()) {
      const marker = record.marker
      if (!marker) continue
      let rect = null
      if (record.element?.isConnected) rect = record.element.getBoundingClientRect()
      else if (record.pageRect) {
        rect = {
          x: record.pageRect.x - window.scrollX,
          y: record.pageRect.y - window.scrollY,
          width: record.pageRect.width,
          height: record.pageRect.height,
        }
      }
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        marker.classList.add('hidden')
        continue
      }
      marker.classList.remove('hidden')
      marker.style.left = `${rect.x + rect.width}px`
      marker.style.top = `${rect.y}px`
    }
  }

  function addAnnotationMarker(record) {
    const ui = ensureAnnoHost()
    const marker = document.createElement('button')
    marker.className = 'marker'
    marker.type = 'button'
    marker.textContent = String(record.seq)
    marker.title = record.comment || `网页注释 ${record.seq}`
    marker.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (record.element?.isConnected) {
        record.element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
      }
      editAnnotation(record)
    })
    ui.markers.appendChild(marker)
    record.marker = marker
    annoMarkers.set(record.id, record)
    positionAnnoMarkers()
  }

  function showDraftError(message) {
    if (!annoHost) return
    annoHost.error.hidden = !message
    annoHost.error.textContent = message || ''
    if (message) positionDraft()
  }

  async function cropDataUrl(dataUrl, rect, viewportWidth, viewportHeight) {
    const image = new Image()
    image.src = dataUrl
    await image.decode()
    const scaleX = image.naturalWidth / Math.max(1, viewportWidth)
    const scaleY = image.naturalHeight / Math.max(1, viewportHeight)
    const x = clampNumber(rect.x, 0, viewportWidth)
    const y = clampNumber(rect.y, 0, viewportHeight)
    const width = clampNumber(rect.width, 1, viewportWidth - x)
    const height = clampNumber(rect.height, 1, viewportHeight - y)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scaleX))
    canvas.height = Math.max(1, Math.round(height * scaleY))
    const context = canvas.getContext('2d')
    if (!context) return dataUrl
    context.drawImage(
      image,
      Math.round(x * scaleX),
      Math.round(y * scaleY),
      Math.round(width * scaleX),
      Math.round(height * scaleY),
      0,
      0,
      canvas.width,
      canvas.height,
    )
    return canvas.toDataURL('image/png')
  }

  function beginAnnotation(initialMode, requestId, hint) {
    const ui = ensureAnnoHost()
    if (annoMarkers.size >= 20) {
      showToast('本页最多 20 条网页注释')
      return false
    }
    if (anno?.cancel) anno.cancel()
    ui.hint.classList.remove('hidden')
    ui.hintText.textContent = initialMode === 'text'
      ? '注释：选中页面文字，然后写评论 · Esc 取消'
      : (hint || '注释：点击元素，或按住鼠标框选区域 · Esc 取消')
    ui.card.classList.add('hidden')
    ui.details.classList.add('hidden')
    ui.error.classList.add('hidden')
    ui.error.textContent = ''
    ui.textarea.value = ''
    ui.textarea.style.height = '44px'
    setOutline(null)
    setRegion(null)

    const draft = {
      mode: initialMode === 'text' ? 'text' : 'auto',
      requestId: requestId || null,
      hint: hint || '',
      phase: 'pick',
      kind: 'element',
      selected: null,
      selectedText: '',
      rect: null,
      pageRect: null,
      down: false,
      downPoint: null,
      downTarget: null,
      dragging: false,
      busy: false,
      listeners: [],
    }
    anno = draft

    const on = (target, type, handler, options) => {
      target.addEventListener(type, handler, options)
      draft.listeners.push(() => target.removeEventListener(type, handler, options))
    }
    const cancel = () => {
      cleanupDraft(true)
    }
    const onClickBlock = (event) => {
      if (!anno || isInsideAnnoUi(event)) return
      event.preventDefault()
      event.stopPropagation()
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        cancel()
      }
    }
    draft.cancel = cancel

    if (draft.mode === 'text') {
      const onMouseUp = (event) => {
        if (!anno || isInsideAnnoUi(event)) return
        setTimeout(() => {
          if (!anno || anno.phase !== 'pick') return
          const selection = window.getSelection()
          const text = String(selection?.toString() || '').trim()
          if (!text) return
          const range = selection.rangeCount ? selection.getRangeAt(0) : null
          const rect = range?.getBoundingClientRect()
          if (!rect) return
          const anchor = selection.anchorNode?.nodeType === Node.ELEMENT_NODE
            ? selection.anchorNode
            : selection.anchorNode?.parentElement
          draft.kind = 'text'
          draft.selected = anchor || document.body
          draft.selectedText = text.slice(0, 4000)
          draft.rect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          draft.pageRect = { x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height }
          draft.phase = 'card'
          annoHost.hint.classList.add('hidden')
          annoHost.card.classList.remove('hidden')
          placeFloating(annoHost.card, draft.rect)
          annoHost.textarea.focus()
        }, 0)
      }
      on(document, 'mouseup', onMouseUp, true)
    } else {
      const onPointerMoveHover = (event) => {
        if (!anno || anno.phase !== 'pick' || draft.down || isInsideAnnoUi(event)) return
        const target = elementAt(event.clientX, event.clientY)
        if (!target || target === document.documentElement || target === document.body) {
          setOutline(null)
          return
        }
        setOutline(target.getBoundingClientRect())
      }
      const onPointerDown = (event) => {
        if (!anno || anno.phase !== 'pick' || isInsideAnnoUi(event) || event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        draft.down = true
        draft.downPoint = { x: event.clientX, y: event.clientY }
        const pathTarget = event.composedPath?.().find((node) => node instanceof Element && node.id !== ANNO_HOST_ID)
        draft.downTarget = pathTarget || elementAt(event.clientX, event.clientY)
        draft.dragging = false
      }
      const onPointerMove = (event) => {
        if (!anno || !draft.down) {
          onPointerMoveHover(event)
          return
        }
        const x = Math.min(draft.downPoint.x, event.clientX)
        const y = Math.min(draft.downPoint.y, event.clientY)
        const width = Math.abs(event.clientX - draft.downPoint.x)
        const height = Math.abs(event.clientY - draft.downPoint.y)
        if (width > 8 || height > 8) {
          draft.dragging = true
          setOutline(null)
          setRegion({ x, y, width, height })
        }
      }
      const onPointerUp = (event) => {
        if (!anno || !draft.down) return
        draft.down = false
        event.preventDefault()
        event.stopPropagation()
        if (draft.dragging) {
          const rect = normalizedRect({
            x: draft.downPoint.x,
            y: draft.downPoint.y,
            width: event.clientX - draft.downPoint.x,
            height: event.clientY - draft.downPoint.y,
          })
          if (rect.width < 8 || rect.height < 8) {
            setRegion(null)
            return
          }
          const target = elementAt(rect.x + rect.width / 2, rect.y + rect.height / 2) || document.body
          draft.kind = 'region'
          draft.selected = target
          draft.rect = rect
          draft.pageRect = { x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height }
        } else {
          const target = draft.downTarget && draft.downTarget.isConnected
            ? draft.downTarget
            : elementAt(event.clientX, event.clientY)
          if (!target || target === document.documentElement) return
          const rect = target.getBoundingClientRect()
          if (rect.width <= 0 || rect.height <= 0) return
          draft.kind = 'element'
          draft.selected = target
          draft.rect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          draft.pageRect = { x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height }
        }
        draft.phase = 'card'
        annoHost.hint.classList.add('hidden')
        setRegion(null)
        setOutline(draftRect())
        annoHost.card.classList.remove('hidden')
        placeFloating(annoHost.card, draftRect())
        annoHost.textarea.focus()
      }
      on(document, 'pointermove', onPointerMove, true)
      on(document, 'pointerdown', onPointerDown, true)
      on(document, 'pointerup', onPointerUp, true)
    }
    on(document, 'click', onClickBlock, true)
    on(document, 'keydown', onKeyDown, true)
    return true
  }

  function editAnnotation(record) {
    const ui = ensureAnnoHost()
    if (anno?.cancel) anno.cancel()
    const element = record.element?.isConnected ? record.element : null
    const rect = element
      ? element.getBoundingClientRect()
      : (record.pageRect
        ? {
            x: record.pageRect.x - window.scrollX,
            y: record.pageRect.y - window.scrollY,
            width: record.pageRect.width,
            height: record.pageRect.height,
          }
        : record.rect)
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      showToast('这个注释的位置已经不存在')
      return
    }
    const draft = {
      mode: 'edit',
      editingId: record.id,
      requestId: null,
      hint: '',
      phase: 'card',
      kind: record.kind || 'element',
      selected: element,
      selectedText: '',
      rect,
      pageRect: record.pageRect || { x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height },
      down: false,
      downPoint: null,
      downTarget: null,
      dragging: false,
      busy: false,
      listeners: [],
    }
    anno = draft
    const on = (target, type, handler, options) => {
      target.addEventListener(type, handler, options)
      draft.listeners.push(() => target.removeEventListener(type, handler, options))
    }
    draft.cancel = () => cleanupDraft(true)
    on(document, 'click', (event) => {
      if (!anno || isInsideAnnoUi(event)) return
      event.preventDefault()
      event.stopPropagation()
    }, true)
    on(document, 'keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        cleanupDraft(true)
      }
    }, true)
    ui.hint.classList.remove('hidden')
    ui.hintText.textContent = `编辑 ${record.label || '网页注释'} · Esc 取消`
    ui.card.classList.remove('hidden')
    ui.details.classList.add('hidden')
    ui.error.classList.add('hidden')
    ui.error.textContent = ''
    ui.textarea.value = record.comment || ''
    ui.textarea.style.height = 'auto'
    ui.textarea.style.height = `${Math.min(160, Math.max(44, ui.textarea.scrollHeight || 44))}px`
    setOutline(draft.kind === 'region' ? null : rect)
    setRegion(draft.kind === 'region' ? rect : null)
    positionDraft()
    ui.textarea.focus()
  }

  async function removeAnnotationDraft() {
    const draft = anno
    if (!draft || draft.busy) return
    if (!draft.editingId) {
      cancelAnnotation()
      return
    }
    const ui = annoHost
    draft.busy = true
    showDraftError('')
    const buttons = [...ui.card.querySelectorAll('button')]
    for (const button of buttons) button.disabled = true
    try {
      const response = await browser.runtime.sendMessage({
        type: 'dshuf:annotation-delete',
        payload: { id: draft.editingId },
      }).catch((error) => ({ ok: false, error: error?.message || String(error) }))
      if (!response?.ok) throw new Error(response?.error || 'DSH 没有删除注释')
      const record = annoMarkers.get(draft.editingId)
      if (record?.marker) record.marker.remove()
      annoMarkers.delete(draft.editingId)
      cleanupDraft(false)
      showToast(`已删除 ${record?.label || '网页注释'}`)
    } catch (error) {
      draft.busy = false
      for (const button of buttons) button.disabled = false
      showDraftError(error?.message || String(error))
    }
  }

  function cleanupDraft(sendCancel) {
    if (!anno) return
    const draft = anno
    anno = null
    for (const off of draft.listeners || []) {
      try { off() } catch { /* ignore */ }
    }
    if (annoHost) {
      annoHost.hint.classList.add('hidden')
      annoHost.card.classList.add('hidden')
      annoHost.details.classList.add('hidden')
      annoHost.outline.classList.add('hidden')
      annoHost.region.classList.add('hidden')
      annoHost.error.classList.add('hidden')
      annoHost.textarea.value = ''
      annoHost.textarea.style.height = '44px'
      for (const button of annoHost.card.querySelectorAll('button')) button.disabled = false
    }
    if (sendCancel && draft.requestId) {
      browser.runtime.sendMessage({ type: 'dshuf:annotation-cancel', requestId: draft.requestId }).catch(() => {})
    }
  }

  async function submitAnnotation() {
    if (!anno || anno.busy) return
    const draft = anno
    const ui = annoHost
    draft.busy = true
    showDraftError('')
    const submitButton = ui.card.querySelector('[data-confirm]')
    const deleteButton = ui.card.querySelector('[data-delete]')
    const detailsButton = ui.card.querySelector('[data-details]')
    for (const button of [submitButton, deleteButton, detailsButton]) button.disabled = true
    try {
      if (draft.editingId) {
        const comment = ui.textarea.value.trim()
        const response = await browser.runtime.sendMessage({
          type: 'dshuf:annotation-update',
          payload: { id: draft.editingId, comment },
        }).catch((error) => ({ ok: false, error: error?.message || String(error) }))
        if (!response?.ok) throw new Error(response?.error || 'DSH 没有更新注释')
        const record = annoMarkers.get(draft.editingId)
        if (record) {
          record.comment = comment
          if (record.marker) record.marker.title = comment || record.label
        }
        cleanupDraft(false)
        showToast(`已更新 ${record?.label || '网页注释'}`)
        return
      }
      if (draft.kind === 'element' && draft.selected?.isConnected) {
        draft.selected.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
        await new Promise((resolve) => setTimeout(resolve, 80))
      }
      const rect = draftRect()
      if (!rect) throw new Error('注释区域已经不存在')
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      ui.host.style.visibility = 'hidden'
      await new Promise((resolve) => setTimeout(resolve, 50))
      let capture
      try {
        capture = await browser.runtime.sendMessage({ type: 'dshuf:capture-tab' })
      } finally {
        ui.host.style.visibility = 'visible'
      }
      if (!capture?.ok || !capture.dataUrl) throw new Error(capture?.error || '无法截取页面')
      let imageDataUrl = capture.dataUrl
      try {
        const pad = 8
        const left = Math.max(0, rect.x - pad)
        const top = Math.max(0, rect.y - pad)
        const right = Math.min(viewportWidth, rect.x + rect.width + pad)
        const bottom = Math.min(viewportHeight, rect.y + rect.height + pad)
        imageDataUrl = await cropDataUrl(capture.dataUrl, {
          x: left,
          y: top,
          width: Math.max(1, right - left),
          height: Math.max(1, bottom - top),
        }, viewportWidth, viewportHeight)
      } catch { /* use the full screenshot */ }
      const selected = draft.selected
      const payload = {
        kind: draft.kind,
        requestId: draft.requestId || undefined,
        comment: ui.textarea.value.trim(),
        selector: selected ? selectorOf(selected) : '',
        targetPath: selected ? targetPathOf(selected) : '',
        tag: selected?.tagName?.toLowerCase() || (draft.kind === 'region' ? 'region' : 'text'),
        text: draft.selectedText || collapse(selected?.innerText || selected?.textContent || '', 2000),
        html: selected ? String(selected.outerHTML || '').slice(0, 4000) : '',
        descriptor: selected ? descriptorFor(selected) : null,
        details: detailsFor(selected),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        pageRect: draft.pageRect,
        viewport: { width: viewportWidth, height: viewportHeight, dpr: window.devicePixelRatio },
        page: { url: location.href, title: document.title },
        imageDataUrl,
      }
      const response = await browser.runtime.sendMessage({ type: 'dshuf:annotation-submit', payload })
      if (!response?.ok) throw new Error(response?.error || 'DSH 没有接收注释')
      const seq = Number(response.data?.seq) || annoMarkers.size + 1
      const id = String(response.data?.id || `anno-${seq}-${Date.now()}`)
      addAnnotationMarker({
        id,
        seq,
        element: selected,
        kind: draft.kind,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        pageRect: draft.pageRect,
        comment: payload.comment,
      })
      cleanupDraft(false)
      showToast(`已放入 DSH 输入框：网页注释 ${seq}`)
    } catch (error) {
      draft.busy = false
      for (const button of [submitButton, deleteButton, detailsButton]) button.disabled = false
      showDraftError(error?.message || String(error))
    }
  }

  function startAnnotation({ mode = 'element', requestId = null, hint = '' } = {}) {
    const initialMode = mode === 'text' ? 'text' : 'auto'
    const started = beginAnnotation(initialMode, requestId, hint)
    return started ? { started: true, mode: initialMode } : { started: false, reason: 'limit', limit: 20 }
  }

  function cancelAnnotation() {
    cleanupDraft(true)
    return { cancelled: true }
  }

  async function handleCommand(command, params = {}) {
    switch (command) {
      case 'snapshot': {
        const snapshot = buildSnapshot(params.maxChars)
        return snapshot
      }
      case 'inspect':
        return inspectRef(params.ref)
      case 'click':
        return clickElement(params.ref)
      case 'type':
        return typeInto(params.ref, params.text ?? '', params.clear !== false, params.submit === true)
      case 'press':
        return pressKey(params.key)
      case 'scroll':
        return scrollPage(params.direction, params.amount, params.ref)
      case 'wait':
        return waitFor(params)
      case 'annotation.start':
        return startAnnotation(params)
      case 'annotation.sync': {
        const items = Array.isArray(params.items) ? params.items : []
        let updated = 0
        for (const item of items) {
          const record = annoMarkers.get(String(item?.id || ''))
          if (!record) continue
          if (Number.isFinite(Number(item.seq))) record.seq = Number(item.seq)
          if (typeof item.comment === 'string') record.comment = item.comment
          if (record.marker) {
            record.marker.textContent = String(record.seq)
            record.marker.title = record.comment || item.label || `网页注释 ${record.seq}`
          }
          updated += 1
        }
        positionAnnoMarkers()
        return { updated }
      }
      case 'annotation.clear': {
        const ids = new Set((params.ids || []).map(String))
        let cleared = 0
        for (const id of [...annoMarkers.keys()]) {
          if (!ids.has(id)) continue
          const record = annoMarkers.get(id)
          if (record?.marker) record.marker.remove()
          annoMarkers.delete(id)
          cleared += 1
        }
        if (anno?.editingId && ids.has(anno.editingId)) cleanupDraft(false)
        positionAnnoMarkers()
        return { cleared }
      }
      case 'annotation.cancel':
        return cancelAnnotation()
      case 'ping':
        return { pong: true }
      default:
        throw new PageError('UNKNOWN_COMMAND', `未知页面命令: ${command}`)
    }
  }

  browser.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== 'dshuf:command') return undefined
    if (message.command === 'ping') return Promise.resolve({ ok: true, data: { pong: true } })
    return Promise.resolve()
      .then(() => handleCommand(message.command, message.params || {}))
      .then(
        (data) => ({ ok: true, data }),
        (error) => ({ ok: false, error: normalizeError(error) }),
      )
  })
})()
