import { defineTool } from '@deepseek-ai/dsh-tools'
import { BridgeError } from './bridge.js'
import { formatTab, formatTabs, oneLine, truncate } from './format.js'
import { descriptorSummary } from './policy.js'

function textOutput() {
  return {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: String(value) }],
  }
}

function toToolError(runtime, error) {
  if (error instanceof BridgeError) {
    const wrapped = new Error(runtime.formatError(error))
    wrapped.code = error.code
    wrapped.next = error.next
    return wrapped
  }
  if (error instanceof Error) return error
  return new Error(String(error))
}

function guarded(runtime, fn) {
  return async (args, exec) => {
    try {
      return await fn(args, exec)
    } catch (error) {
      throw toToolError(runtime, error)
    }
  }
}

function tabLine(tab) {
  if (!tab) return ''
  return `tab ${tab.tabId} · ${tab.title || '(untitled)'} — ${tab.url || 'about:blank'}`
}

function withSnapshot(runtime, exec, tabId, include) {
  if (!include) return ''
  return `\n\n${runtime.snapshot(exec.agent, tabId)}`
}

async function tabInfo(runtime, tabId) {
  try {
    return await runtime.tabInfo(tabId)
  } catch {
    return null
  }
}

export function registerTools(ctx, runtime) {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'browser_status',
    description:
      'Show the Firefox extension connection, current access mode, DSH tab group, and the token/bridge setup information. Call this first when a Firefox task starts or when browser tools fail.',
    parameters: {},
    output: textOutput(),
    execute: guarded(runtime, async () => runtime.statusText()),
  })), 'dsh-use-firefox: browser_status')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'browser_tabs',
    description:
      'List or manage tabs in the Firefox native tab group named "DSH". action=list returns only group tabs. action=open opens a URL in a new DSH-group tab. action=select focuses a group tab. action=close closes a group tab. Tabs outside the DSH group are never touched.',
    parameters: {
      action: { type: 'string', enum: ['list', 'open', 'select', 'close'], required: true, description: 'list, open, select, or close' },
      url: { type: 'string', description: 'URL for action=open' },
      tab_id: { type: 'integer', description: 'Tab id for select/close/navigate' },
      active: { type: 'boolean', description: 'For open: bring the tab to the front (default false)' },
    },
    output: textOutput(),
    execute: guarded(runtime, async (args, exec) => {
      if (args.action === 'list') {
        return formatTabs(await runtime.listTabs(), runtime.groupTitle)
      }
      if (args.action === 'open') {
        if (!args.url) throw new BridgeError('BAD_URL', 'browser_tabs action=open 需要 url')
        await runtime.authorize(exec, { action: 'tabs.open', toolName: 'browser_tabs' })
        const tab = await runtime.openTab(exec.agent, { url: args.url, active: args.active === true })
        return `已打开并加入 ${runtime.groupTitle} 分组:\n${formatTab(tab)}`
      }
      const tabId = await runtime.resolveTabId(exec.agent, args.tab_id)
      if (args.action === 'select') {
        await runtime.authorize(exec, { action: 'tabs.select', toolName: 'browser_tabs' })
        const tab = await runtime.selectTab(exec.agent, tabId)
        return `已切换到 ${formatTab(tab)}`
      }
      await runtime.authorize(exec, {
        action: 'tabs.close',
        tab: await tabInfo(runtime, tabId),
        toolName: 'browser_tabs',
      })
      await runtime.closeTab(exec.agent, tabId)
      return `已关闭 DSH 分组标签页 ${tabId}`
    }),
  })), 'dsh-use-firefox: browser_tabs')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'browser_navigate',
    description:
      'Open a URL in the DSH group. Without tab_id it opens a new background tab in the group; with tab_id it navigates that existing group tab. Waits for the page load, then returns the tab. Use browser_read to inspect the page.',
    parameters: {
      url: { type: 'string', required: true, description: 'http(s) URL or a browser-supported URL' },
      tab_id: { type: 'integer', description: 'Existing DSH-group tab to navigate; omit to open a new tab' },
      active: { type: 'boolean', description: 'Bring the tab to the front (default false)' },
    },
    output: textOutput(),
    execute: guarded(runtime, async (args, exec) => {
      await runtime.authorize(exec, {
        action: 'navigate',
        tab: args.tab_id ? await tabInfo(runtime, args.tab_id) : null,
        text: args.url,
        toolName: 'browser_navigate',
      })
      const tab = await runtime.navigate(exec.agent, { url: args.url, tabId: args.tab_id, active: args.active === true })
      return `已导航:\n${formatTab(tab)}`
    }),
  })), 'dsh-use-firefox: browser_navigate')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'browser_read',
    description:
      'Read the current DSH-group tab as a compact text snapshot: URL/title, visible text, interactive elements with ref ids, forms, dialogs, CAPTCHA hints, and frames. Refs expire when the page changes; call this again before acting after navigation or DOM updates.',
    parameters: {
      tab_id: { type: 'integer', description: 'DSH-group tab id; defaults to the current agent tab' },
      max_chars: { type: 'integer', description: 'Maximum visible text characters (default from plugin config)' },
    },
    output: textOutput(),
    execute: guarded(runtime, async (args, exec) => runtime.snapshot(exec.agent, args.tab_id, args.max_chars)),
  })), 'dsh-use-firefox: browser_read')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'browser_click',
    description:
      'Click an interactive element in a DSH-group tab by its ref from the latest browser_read snapshot. The extension scrolls it into view, checks visibility and occlusion, and dispatches a real pointer/mouse sequence. Re-read the page to verify.',
    parameters: {
      ref: { type: 'string', required: true, description: 'Element ref such as e12 from browser_read' },
      tab_id: { type: 'integer', description: 'DSH-group tab id; defaults to the current agent tab' },
      include_snapshot: { type: 'boolean', description: 'Append a fresh page snapshot after the click' },
    },
    output: textOutput(),
    execute: guarded(runtime, async (args, exec) => {
      const tabId = await runtime.resolveTabId(exec.agent, args.tab_id)
      const descriptor = runtime.mode === 'full' ? null : await runtime.inspect(exec.agent, tabId, args.ref)
      await runtime.authorize(exec, {
        action: 'click',
        tab: await tabInfo(runtime, tabId),
        descriptor,
        toolName: 'browser_click',
      })
      const result = await runtime.action(exec.agent, 'click', tabId, { ref: args.ref })
      const detail = result?.result || result
      const info = result?.tab || (await tabInfo(runtime, tabId))
      const summary = detail?.descriptor ? descriptorSummary(detail.descriptor) : descriptorSummary(descriptor)
      void runtime.audit({ type: 'action', action: 'click', tab: tabId, ref: args.ref, target: summary, url: info?.url })
      let text = `已点击 ${args.ref}${summary ? ` (${summary})` : ''}`
      if (info) text += `\n${tabLine(info)}`
      return text + withSnapshot(runtime, exec, tabId, args.include_snapshot === true)
    }),
  })), 'dsh-use-firefox: browser_click')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'browser_type',
    description:
      'Type text into an input, textarea, or contenteditable element in a DSH-group tab, using native value setters and input/change events so React/Vue controls work. Set submit=true to submit the containing form. Re-read the page to verify.',
    parameters: {
      ref: { type: 'string', required: true, description: 'Element ref from browser_read' },
      text: { type: 'string', required: true, description: 'Text to enter' },
      tab_id: { type: 'integer', description: 'DSH-group tab id; defaults to the current agent tab' },
      clear: { type: 'boolean', description: 'Clear the existing value first (default true)' },
      submit: { type: 'boolean', description: 'Submit the containing form after typing' },
      include_snapshot: { type: 'boolean', description: 'Append a fresh page snapshot after typing' },
    },
    output: textOutput(),
    execute: guarded(runtime, async (args, exec) => {
      const tabId = await runtime.resolveTabId(exec.agent, args.tab_id)
      const descriptor = runtime.mode === 'full' ? null : await runtime.inspect(exec.agent, tabId, args.ref)
      await runtime.authorize(exec, {
        action: 'type',
        tab: await tabInfo(runtime, tabId),
        descriptor,
        text: args.text,
        toolName: 'browser_type',
      })
      const result = await runtime.action(exec.agent, 'type', tabId, {
        ref: args.ref,
        text: args.text,
        clear: args.clear !== false,
        submit: args.submit === true,
      })
      const detail = result?.result || result
      const sensitive = descriptor?.sensitive === true || detail?.descriptor?.sensitive === true
      void runtime.audit({
        type: 'action',
        action: 'type',
        tab: tabId,
        ref: args.ref,
        text: sensitive ? '[redacted]' : oneLine(args.text, 200),
        sensitive,
      })
      const info = result?.tab || (await tabInfo(runtime, tabId))
      let text = `已输入 ${args.ref}${detail?.submitted ? ' 并提交表单' : ''}${sensitive ? '（敏感内容已隐藏）' : ''}`
      if (info) text += `\n${tabLine(info)}`
      return text + withSnapshot(runtime, exec, tabId, args.include_snapshot === true)
    }),
  })), 'dsh-use-firefox: browser_type')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'browser_press',
    description:
      'Dispatch a keyboard key to the focused element in a DSH-group tab. Supports Enter, Tab, Escape, arrows, PageUp/PageDown, Backspace, Delete, and single letters. Enter may submit a form and is treated as sensitive in auto mode.',
    parameters: {
      key: { type: 'string', required: true, description: 'Key name, e.g. Enter, Tab, Escape, ArrowDown' },
      tab_id: { type: 'integer', description: 'DSH-group tab id; defaults to the current agent tab' },
      include_snapshot: { type: 'boolean', description: 'Append a fresh page snapshot after the key' },
    },
    output: textOutput(),
    execute: guarded(runtime, async (args, exec) => {
      const tabId = await runtime.resolveTabId(exec.agent, args.tab_id)
      await runtime.authorize(exec, {
        action: 'press',
        tab: await tabInfo(runtime, tabId),
        text: args.key,
        toolName: 'browser_press',
      })
      const result = await runtime.action(exec.agent, 'press', tabId, { key: args.key })
      const detail = result?.result || result
      const info = result?.tab || (await tabInfo(runtime, tabId))
      const sensitive = detail?.descriptor?.sensitive === true
      void runtime.audit({ type: 'action', action: 'press', tab: tabId, key: sensitive ? '[redacted]' : args.key })
      let text = `已按键 ${args.key}${detail?.inserted ? '（已插入文本）' : ''}`
      if (info) text += `\n${tabLine(info)}`
      return text + withSnapshot(runtime, exec, tabId, args.include_snapshot === true)
    }),
  })), 'dsh-use-firefox: browser_press')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'browser_scroll',
    description:
      'Scroll a DSH-group tab. Direction can be up/down/left/right/top/bottom. If ref is given, scrolls that element into the center instead. Returns the resulting scroll position.',
    parameters: {
      direction: { type: 'string', enum: ['up', 'down', 'left', 'right', 'top', 'bottom'], description: 'Scroll direction (default down)' },
      amount: { type: 'integer', description: 'Number of wheel steps (default 3)' },
      ref: { type: 'string', description: 'Optional element ref to scroll into view' },
      tab_id: { type: 'integer', description: 'DSH-group tab id; defaults to the current agent tab' },
    },
    output: textOutput(),
    execute: guarded(runtime, async (args, exec) => {
      const result = await runtime.action(exec.agent, 'scroll', args.tab_id, {
        direction: args.direction || 'down',
        amount: args.amount || 3,
        ref: args.ref,
      })
      const container = result?.container
      const windowPart = `scroll: window ${Math.round(result?.x || 0)},${Math.round(result?.y || 0)}`
      if (!container) return windowPart
      const label = `${container.tag || 'element'}${container.id ? `#${container.id}` : ''}`
      return `${windowPart} · container ${label} ${container.scrollTop ?? 0}/${container.scrollHeight ?? 0}`
    }),
  })), 'dsh-use-firefox: browser_scroll')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'browser_wait',
    description:
      'Wait for text or a CSS selector to appear in a DSH-group tab. Returns found=true, or a timeout notice. Use this for slow SPA pages before browser_read.',
    parameters: {
      text: { type: 'string', description: 'Visible text to wait for' },
      selector: { type: 'string', description: 'CSS selector to wait for' },
      timeout_ms: { type: 'integer', description: 'Timeout in milliseconds (default 5000, max 30000)' },
      tab_id: { type: 'integer', description: 'DSH-group tab id; defaults to the current agent tab' },
    },
    output: textOutput(),
    execute: guarded(runtime, async (args, exec) => {
      if (!args.text && !args.selector) throw new BridgeError('BAD_WAIT', 'browser_wait 需要 text 或 selector')
      const result = await runtime.action(exec.agent, 'wait', args.tab_id, {
        text: args.text,
        selector: args.selector,
        timeoutMs: Math.min(Number(args.timeout_ms || 5000), 30_000),
      })
      return result?.found === false ? '等待超时，目标未出现。' : '目标已出现。'
    }),
  })), 'dsh-use-firefox: browser_wait')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'browser_screenshot',
    description:
      'Capture the visible area of a DSH-group tab as a PNG or JPEG and save it under ~/.dsh/browser/screenshots. Returns the absolute file path for the user. The model cannot see the image in this DSH version; use browser_read for page understanding.',
    parameters: {
      tab_id: { type: 'integer', description: 'DSH-group tab id; defaults to the current agent tab' },
      format: { type: 'string', enum: ['png', 'jpeg'], description: 'Image format (default png)' },
    },
    output: textOutput(),
    execute: guarded(runtime, async (args, exec) => {
      const result = await runtime.screenshot(exec.agent, args.tab_id, args.format || 'png')
      return `截图已保存: ${result.file}\n${result.bytes} bytes\n${result.tab ? tabLine(result.tab) : ''}`.trim()
    }),
  })), 'dsh-use-firefox: browser_screenshot')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'browser_annotate',
    description:
      'Ask the user to annotate a DSH-group page in Firefox: the user picks an element, selects text, or draws a region and writes a note. With wait=true the tool waits and returns the annotation; with wait=false it only enters annotation mode and returns immediately. The user can also start annotations from the extension toolbar popup.',
    parameters: {
      tab_id: { type: 'integer', description: 'DSH-group tab id to annotate; defaults to the current agent tab' },
      prompt: { type: 'string', description: 'One-line instruction shown in the annotation banner' },
      wait: { type: 'boolean', description: 'Wait for the user to finish and return the annotation (default true)' },
      timeout_ms: { type: 'integer', description: 'Wait timeout in milliseconds (default from plugin config)' },
    },
    output: textOutput(),
    execute: guarded(runtime, async (args, exec) => {
      return runtime.annotate(exec, {
        tabId: args.tab_id,
        prompt: args.prompt || '',
        wait: args.wait !== false,
        timeoutMs: args.timeout_ms,
      })
    }),
  })), 'dsh-use-firefox: browser_annotate')
}
