/* DSH Use FF — Web Client half.
 * Queues annotations into the composer as reference chips and shows the
 * annotation cards above the input. The annotation body is attached by the
 * host at agent/pre-step when the message is sent; sent messages render the
 * same cards inline and allow editing or deleting the stored annotation.
 */
window.__ModuleLoader__.load({
  id: 'dsh-use-firefox',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    const QUEUE_PATH = '/ext/use-firefox/queue'
    const ACK_PATH = '/ext/use-firefox/queue/ack'
    const FOCUS_PATH = '/ext/use-firefox/focus'
    const ITEM_PATH = '/ext/use-firefox/item'
    const UPDATE_PATH = '/ext/use-firefox/update'
    const DELETE_PATH = '/ext/use-firefox/delete'
    const PENDING_PATH = '/ext/use-firefox/pending'
    const OVERVIEW_PATH = '/ext/use-firefox/overview'
    const MODE_PATH = '/ext/use-firefox/mode'
    const PAUSED_PATH = '/ext/use-firefox/paused'
    const ANNOTATION_MODE_PATH = '/ext/use-firefox/annotation-mode'
    const ANNOTATION_START_PATH = '/ext/use-firefox/annotation-start'
    const TOKEN_PATH = '/ext/use-firefox/token'
    const WIRE = /@\[((?:\\.|[^\\\]\n])*)\]\(dsh-anno:([A-Za-z0-9_-]+)\)/uy
    const ANNO_BLOCK = /<browser_annotation\b([^>]*)>([\s\S]*?)<\/browser_annotation>(?:\nDSH:[^\n]*)?(?:\n\n截图:[^\n]*)?/g
    const ANNO_BLOCK_ID = /\bannotation_id="([A-Za-z0-9_-]+)"/
    const POLL_MS = 2000

    const CSS = `
.dshuf-dock { display: flex; flex-direction: column; gap: 6px; width: min(100%, var(--dsh-chat-content-width, 920px)); margin: 0 auto 8px; min-width: 0; }
.dshuf-summary { font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); padding: 0 2px; }
.dshuf-list { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
.dshuf-list .dshuf-card { flex: 1 1 280px; width: auto; max-width: 340px; }
.dshuf-card { display: flex; gap: 8px; align-items: flex-start; min-width: 0; padding: 6px 8px; border: 1px solid var(--dsw-alias-border-secondary, #e5e7eb); border-radius: 10px; background: var(--dsw-alias-bg-elevated, #fff); cursor: pointer; box-sizing: border-box; }
.dshuf-inline-wrap { position: absolute; top: 8px; left: 12px; right: 12px; z-index: 25; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
[data-composer-card]:has(.dshuf-inline-wrap) { padding-top: calc(8px + var(--dshuf-inline-height, 0px) + 12px); }
.dshuf-inline-wrap .dshuf-list { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; width: 100%; }
.dshuf-inline-wrap .dshuf-card { width: min(100%, 280px); max-width: 280px; flex: none; align-self: flex-start; background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2563eb) 4%, var(--dsw-alias-bg-elevated, #fff)); border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2563eb) 20%, var(--dsw-alias-border-secondary, #e5e7eb)); box-shadow: 0 2px 8px rgba(15, 23, 42, .04); }
.dshuf-card:hover { border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2563eb) 35%, var(--dsw-alias-border-secondary, #e5e7eb)); }
.dshuf-card.editing { align-items: stretch; background: var(--dsw-alias-bg-elevated, #fff); }
.dshuf-history { display: flex; width: min(100%, 280px); max-width: 280px; margin-top: 7px; }
.dshuf-history .dshuf-thumb { width: 56px; height: 38px; }
.dshuf-thumb { width: 58px; height: 40px; flex: none; object-fit: cover; border-radius: 6px; border: 1px solid var(--dsw-alias-border-secondary, #e5e7eb); background: var(--dsw-alias-bg-secondary, #f8fafc); }
.dshuf-thumb-empty { display: flex; align-items: center; justify-content: center; font-size: 10px; color: var(--dsw-alias-label-secondary, #6b7280); text-align: center; }
.dshuf-card-body { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
.dshuf-card-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
.dshuf-card-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary, #111827); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.dshuf-card-comment { font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshuf-edit { flex: none; border: 0; background: transparent; color: var(--dsw-alias-state-business-primary, #2563eb); font: inherit; font-size: 11px; cursor: pointer; padding: 1px 3px; }
.dshuf-edit:hover { text-decoration: underline; }
.dshuf-editbox { display: flex; flex-direction: column; gap: 5px; margin-top: 4px; }
.dshuf-editbox textarea { width: 100%; min-height: 48px; resize: vertical; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-secondary, #e5e7eb); border-radius: 7px; background: var(--dsw-alias-bg-secondary, #f8fafc); color: var(--dsw-alias-label-primary, #111827); padding: 5px 6px; font: 12px/1.45 system-ui, sans-serif; }
.dshuf-editbox textarea:focus { outline: 2px solid color-mix(in srgb, var(--dsw-alias-state-business-primary, #2563eb) 45%, transparent); outline-offset: 0; }
.dshuf-edit-actions { display: flex; gap: 6px; justify-content: flex-end; }
.dshuf-edit-actions button { border: 1px solid var(--dsw-alias-border-secondary, #e5e7eb); border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary, #111827); font: inherit; font-size: 11px; padding: 2px 8px; cursor: pointer; }
.dshuf-edit-actions button.primary { background: var(--dsw-alias-state-business-primary, #2563eb); border-color: transparent; color: #fff; }
.dshuf-edit-actions button.danger { color: #dc2626; border-color: color-mix(in srgb, #dc2626 30%, transparent); }
.dshuf-edit-actions button:disabled { opacity: .5; cursor: default; }
.dshuf-card-error { color: #dc2626; font-size: 11px; white-space: pre-wrap; }
.dshuf-chip { display: inline; max-width: 100%; margin: 0 2px; color: var(--dsw-alias-state-business-primary, #2563eb); font-weight: 500; white-space: inherit; overflow-wrap: anywhere; }
.dshuf-chip-deleted { color: var(--dsw-alias-label-secondary, #6b7280); text-decoration: line-through; }.dshuf-mode-wrap { position: relative; display: inline-flex; align-items: center; }
.dshuf-mode-button { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--dsw-alias-border-secondary, #e5e7eb); border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary, #6b7280); font: inherit; font-size: 11px; padding: 2px 8px; cursor: pointer; }
.dshuf-mode-button:hover { color: var(--dsw-alias-label-primary, #111827); background: var(--dsw-alias-bg-secondary, #f8fafc); }
.dshuf-mode-name { font-weight: 600; }
.dshuf-mode-value { color: var(--dsw-alias-state-business-primary, #2563eb); }
.dshuf-stop { border: 1px solid color-mix(in srgb, #dc2626 30%, transparent); border-radius: 999px; background: color-mix(in srgb, #dc2626 7%, transparent); color: #dc2626; font: inherit; font-size: 11px; padding: 2px 8px; cursor: pointer; white-space: nowrap; }
.dshuf-stop:hover { background: color-mix(in srgb, #dc2626 12%, transparent); }
.dshuf-stop.paused { color: #1f9d63; border-color: color-mix(in srgb, #1f9d63 35%, transparent); background: color-mix(in srgb, #1f9d63 8%, transparent); }
.dshuf-stop:disabled { opacity: .5; cursor: default; }
.dshuf-mode-menu { position: absolute; left: 0; bottom: calc(100% + 6px); z-index: 30; display: flex; flex-direction: column; min-width: 190px; padding: 5px; border: 1px solid var(--dsw-alias-border-secondary, #e5e7eb); border-radius: 10px; background: var(--dsw-alias-bg-elevated, #fff); box-shadow: 0 12px 32px rgba(15, 23, 42, .18); }
.dshuf-mode-item { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; border: 0; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-primary, #111827); font: inherit; font-size: 12px; padding: 5px 8px; cursor: pointer; text-align: left; }
.dshuf-mode-item small { color: var(--dsw-alias-label-secondary, #6b7280); font-size: 10px; }
.dshuf-mode-item:hover, .dshuf-mode-item.active { background: var(--dsw-alias-bg-secondary, #f8fafc); }
.dshuf-mode-item.active { color: var(--dsw-alias-state-business-primary, #2563eb); }
.dshuf-jump { border: 1px solid var(--dsw-alias-border-secondary, #e5e7eb); border-radius: 8px; background: transparent; color: var(--dsw-alias-label-primary, #111827); font: inherit; font-size: 12px; padding: 5px 10px; cursor: pointer; }
.dshuf-jump:hover { background: var(--dsw-alias-bg-secondary, #f8fafc); }
.dshuf-settings { display: flex; flex-direction: column; gap: 8px; margin: 8px 0 12px; }
.dshuf-settings-card { border: 1px solid var(--dsw-alias-border-secondary, #e5e7eb); border-radius: 10px; padding: 10px 12px; background: var(--dsw-alias-bg-elevated, #fff); }
.dshuf-settings-card h3 { margin: 0 0 7px; font-size: 13px; color: var(--dsw-alias-label-primary, #111827); }
.dshuf-setting-line { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; font-size: 12px; padding: 2px 0; color: var(--dsw-alias-label-secondary, #6b7280); }
.dshuf-setting-line strong { color: var(--dsw-alias-label-primary, #111827); font-weight: 500; text-align: right; word-break: break-all; }
.dshuf-setting-line code { font: 11px ui-monospace, "JetBrains Mono", monospace; color: var(--dsw-alias-label-primary, #111827); }
.dshuf-setting-actions { margin-top: 7px; }
.dshuf-setting-actions button { border: 1px solid var(--dsw-alias-border-secondary, #e5e7eb); border-radius: 7px; background: transparent; color: var(--dsw-alias-label-primary, #111827); font: inherit; font-size: 11px; padding: 3px 9px; cursor: pointer; }
.dshuf-setting-actions button.danger { color: #dc2626; border-color: color-mix(in srgb, #dc2626 28%, transparent); }
.dshuf-setting-actions button.primary { color: #fff; background: var(--dsw-alias-state-business-primary, #2563eb); border-color: transparent; }
.dshuf-choice-row { display: flex; flex-wrap: wrap; gap: 5px; }
.dshuf-choice { border: 1px solid var(--dsw-alias-border-secondary, #e5e7eb); border-radius: 7px; background: transparent; color: var(--dsw-alias-label-primary, #111827); font: inherit; font-size: 11px; padding: 3px 8px; cursor: pointer; }
.dshuf-choice.active { color: var(--dsw-alias-state-business-primary, #2563eb); border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2563eb) 45%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2563eb) 8%, transparent); }
.dshuf-settings-hint { margin: 6px 0 0; color: var(--dsw-alias-label-secondary, #6b7280); font-size: 11px; line-height: 1.45; }
.dshuf-settings-error { margin: 0; color: #dc2626; font-size: 11px; }

.dshuf-history-details { display: flex; flex-direction: column; gap: 3px; margin-top: 5px; padding-top: 5px; border-top: 1px solid var(--dsw-alias-border-secondary, #e5e7eb); }
.dshuf-detail-row { display: flex; gap: 6px; font-size: 11px; line-height: 1.4; }
.dshuf-detail-key { flex: 0 0 58px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dshuf-detail-value { min-width: 0; color: var(--dsw-alias-label-primary, #111827); overflow-wrap: anywhere; }
`

    function unescapeLabel(label) {
      return label.replace(/\\(.)/gu, '$1')
    }

    const annoRule = {
      id: 'dshuf-anno',
      order: 20,
      match(text, from) {
        for (let start = text.indexOf('@', from); start >= 0; start = text.indexOf('@', start + 1)) {
          WIRE.lastIndex = start
          const found = WIRE.exec(text)
          if (found === null) continue
          return {
            id: 'dshuf-anno',
            start,
            end: start + found[0].length,
            data: { id: found[2], label: unescapeLabel(found[1]) },
          }
        }
        return undefined
      },
    }

    const annoBlockRule = {
      id: 'dshuf-anno-block',
      order: 19,
      match(text, from) {
        for (let start = text.indexOf('<browser_annotation', from); start >= 0; start = text.indexOf('<browser_annotation', start + 1)) {
          ANNO_BLOCK.lastIndex = start
          const found = ANNO_BLOCK.exec(text)
          if (found === null || found.index !== start || !found[2].includes('<user_comment>')) continue
          const id = ANNO_BLOCK_ID.exec(found[1])?.[1] || null
          return {
            id: 'dshuf-anno-block',
            start,
            end: start + found[0].length,
            data: { id },
          }
        }
        return undefined
      },
    }

    async function requestJson(path, options = {}) {
      const response = await fetch(`${window.location.origin}${path}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        ...options,
      })
      let body = null
      try { body = await response.json() } catch { /* non-json */ }
      if (!response.ok) throw new Error(body?.error || `请求失败 (${response.status})`)
      return body
    }

    async function getQueue(sessionId) {
      const body = await requestJson(`${QUEUE_PATH}?session=${encodeURIComponent(sessionId)}`)
      return Array.isArray(body?.items) ? body.items : []
    }

    async function getPending() {
      const body = await requestJson(PENDING_PATH)
      return Array.isArray(body?.items) ? body.items : []
    }

    function mentionId(ref) {
      const match = /\(dsh-anno:([^)]+)\)$/.exec(String(ref || ''))
      return match ? match[1] : null
    }

    function relabelDraft(state, items) {
      if (!state || state.phase !== 'plain' || (state.quotes?.length ?? 0) > 0) return undefined
      const byId = new Map(items.map((item) => [item.id, item]))
      const text = typeof state.draft === 'string' ? state.draft : ''
      const occurrences = Array.isArray(state.occurrences) ? state.occurrences : []
      if (occurrences.length === 0) return undefined
      let changed = false
      let next = ''
      let cursor = 0
      const references = []
      for (const occurrence of occurrences) {
        next += text.slice(cursor, occurrence.offset)
        const id = mentionId(occurrence.ref)
        const item = id ? byId.get(id) : null
        const ref = item?.mention || occurrence.ref
        const label = item?.label || occurrence.label
        if (ref !== occurrence.ref || label !== occurrence.label) changed = true
        references.push({
          source: occurrence.source,
          ref,
          offset: next.length,
          length: ref.length,
          label,
          ...(occurrence.appearance === undefined ? {} : { appearance: occurrence.appearance }),
          clipboardText: ref,
          ...(occurrence.invalid === undefined ? {} : { invalid: occurrence.invalid }),
        })
        next += ref
        cursor = occurrence.offset + occurrence.length
      }
      next += text.slice(cursor)
      return changed ? { text: next, references } : undefined
    }

    async function getItem(id) {
      try {
        const body = await requestJson(`${ITEM_PATH}?id=${encodeURIComponent(id)}`)
        return body?.item ?? null
      } catch {
        return null
      }
    }

    async function acknowledge(ids) {
      if (!ids.length) return
      await requestJson(ACK_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
    }

    async function reportFocus(sessionId) {
      await requestJson(FOCUS_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
    }

    async function updateAnnotation(id, comment) {
      const body = await requestJson(UPDATE_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, comment }),
      })
      return body?.item ?? null
    }

    async function deleteAnnotation(id) {
      await requestJson(DELETE_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      })
    }

    const MODE_OPTIONS = [
      ['full', '完全访问', '浏览器动作直接执行，不弹审批'],
      ['auto', '自动检查', '敏感动作询问'],
      ['ask', '全部询问', '每个改变页面的动作都询问'],
      ['readonly', '只读取', '只读、截图和注释'],
    ]
    const ANNOTATION_MODE_OPTIONS = [
      ['element', '点选元素'],
      ['text', '选中文字'],
      ['region', '框选区域'],
    ]

    async function getOverview() {
      const body = await requestJson(OVERVIEW_PATH)
      return body
    }

    async function postOverview(path, payload) {
      const body = await requestJson(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      return body
    }

    function SettingsJump({ subject }) {
      if (subject?.kind !== 'bundle' || subject.pkg?.name !== 'dsh-use-firefox') return null
      return h('button', {
        type: 'button',
        className: 'dshuf-jump',
        onClick: () => document.querySelector('.dshuf-settings')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      }, 'Firefox 插件设置')
    }

    function SettingsPage({ view }) {
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState('')

      React.useEffect(() => {
        if (view !== 'page') return undefined
        let live = true
        const load = async () => {
          try {
            const next = await getOverview()
            if (live) { setData(next); setError('') }
          } catch (cause) {
            if (live) setError(cause?.message || String(cause))
          }
        }
        void load()
        const timer = setInterval(() => void load(), 4000)
        return () => { live = false; clearInterval(timer) }
      }, [view])

      if (view !== 'page') return null

      const act = async (path, payload) => {
        setBusy(true)
        setError('')
        try {
          const next = await postOverview(path, payload)
          setData(next)
          setNotice('')
        } catch (cause) {
          setError(cause?.message || String(cause))
        } finally {
          setBusy(false)
        }
      }

      const clients = Array.isArray(data?.clients) ? data.clients : []
      const connected = clients.length > 0
      const choices = (options, current, onPick) => h(
        'span',
        { className: 'dshuf-choice-row' },
        options.map(([value, label]) => h('button', {
          type: 'button',
          key: value,
          className: `dshuf-choice${current === value ? ' active' : ''}`,
          disabled: busy,
          onClick: () => onPick(value),
        }, label)),
      )

      return h(
        'div',
        { className: 'dshuf-settings' },
        error ? h('p', { className: 'dshuf-settings-error' }, error) : null,
        notice ? h('p', { className: 'dshuf-settings-hint' }, notice) : null,
        h(
          'section',
          { className: 'dshuf-settings-card' },
          h('h3', null, '状态'),
          h('div', { className: 'dshuf-setting-line' }, h('span', null, 'Firefox'), h('strong', null, connected ? `已连接 · ${clients.length} 个客户端` : '未连接')),
          h('div', { className: 'dshuf-setting-line' }, h('span', null, '插件 / 扩展'), h('strong', null, `${data?.pluginVersion || '—'} / ${clients[0]?.extensionVersion || '—'}`)),
          h('div', { className: 'dshuf-setting-line' }, h('span', null, '桥'), h('strong', null, data?.running ? `运行中 · ${data.port}` : '未运行')),
          h('div', { className: 'dshuf-setting-actions' },
            h('button', { type: 'button', className: data?.paused ? 'primary' : 'danger', disabled: busy || !data, onClick: () => act(PAUSED_PATH, { paused: !data?.paused }) }, data?.paused ? '恢复' : '急停'),
          ),
        ),
        h(
          'section',
          { className: 'dshuf-settings-card' },
          h('h3', null, '连接'),
          h('div', { className: 'dshuf-setting-line' }, h('span', null, '桥端口'), h('strong', null, String(data?.port || 39271))),
          h('div', { className: 'dshuf-setting-line' }, h('span', null, '标签组'), h('strong', null, data?.groupTitle || 'DSH')),
          h('div', { className: 'dshuf-setting-line' }, h('span', null, '令牌文件'), h('code', null, data?.tokenPath || '~/.dsh/browser/ext-token')),
          h('div', { className: 'dshuf-setting-actions' },
            h('button', { type: 'button', onClick: async () => {
              try {
                const token = await requestJson(TOKEN_PATH)
                await navigator.clipboard.writeText(token.token)
                setError('')
                setNotice('令牌已复制；首次连接时粘贴到 Firefox 工具栏弹窗。')
              } catch (cause) {
                setError(cause?.message || String(cause))
              }
            } }, '复制连接令牌'),
          ),
          h('p', { className: 'dshuf-settings-hint' }, 'Firefox 首次连接时，在工具栏弹窗的“首次连接”里填端口和令牌；连接后弹窗只显示功能介绍。'),
        ),
        h(
          'section',
          { className: 'dshuf-settings-card' },
          h('h3', null, '权限模式'),
          choices(MODE_OPTIONS, data?.mode, (mode) => act(MODE_PATH, { mode })),
          h('p', { className: 'dshuf-settings-hint' }, MODE_OPTIONS.find(([value]) => value === data?.mode)?.[2] || ''),
        ),
        h(
          'section',
          { className: 'dshuf-settings-card' },
          h('h3', null, '注释'),
          choices(ANNOTATION_MODE_OPTIONS, data?.annotationMode, (mode) => act(ANNOTATION_MODE_PATH, { mode })),
          h('div', { className: 'dshuf-setting-actions' },
            h('button', { type: 'button', disabled: busy, onClick: async () => {
              setBusy(true)
              setError('')
              try {
                await requestJson(ANNOTATION_START_PATH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
                setNotice('已进入 Firefox 注释模式；切到 Firefox 点选元素并写评论。')
              } catch (cause) {
                setError(cause?.message || String(cause))
              } finally {
                setBusy(false)
              }
            } }, '在 Firefox 当前标签页开始注释'),
          ),
          h('p', { className: 'dshuf-settings-hint' }, '在 Firefox 网页上按 Ctrl + Alt + A（macOS 为 MacCtrl + Alt + A）开始注释；Esc 退出。每个 DSH 对话独立从 1 编号；发送后网页标记清除，下一批重新从 1 开始。'),
        ),
        h(
          'section',
          { className: 'dshuf-settings-card' },
          h('h3', null, '工作区'),
          h('p', { className: 'dshuf-settings-hint' }, 'Agent 打开的标签页会进入 Firefox 原生标签组 “' + (data?.groupTitle || 'DSH') + '”。组外个人标签页不会被 Agent 操作。'),
        ),
      )
    }

    function ModeControl() {
      const [data, setData] = React.useState(null)
      const [open, setOpen] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')

      React.useEffect(() => {
        let live = true
        const load = async () => {
          try {
            const next = await getOverview()
            if (live) setData(next)
          } catch { /* keep the last value */ }
        }
        void load()
        const timer = setInterval(() => void load(), 6000)
        const onVisible = () => { if (document.visibilityState !== 'hidden') void load() }
        window.addEventListener('focus', onVisible)
        return () => { live = false; clearInterval(timer); window.removeEventListener('focus', onVisible) }
      }, [])

      React.useEffect(() => {
        if (!open) return undefined
        const close = (event) => {
          if (event.target?.closest?.('.dshuf-mode-wrap')) return
          setOpen(false)
        }
        document.addEventListener('click', close, true)
        return () => document.removeEventListener('click', close, true)
      }, [open])

      const pick = async (mode) => {
        setBusy(true)
        setError('')
        try {
          const next = await postOverview(MODE_PATH, { mode })
          setData(next)
          setOpen(false)
        } catch (cause) {
          setError(cause?.message || String(cause))
        } finally {
          setBusy(false)
        }
      }

      const togglePause = async (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (busy || !data) return
        setBusy(true)
        setError('')
        try {
          const next = await postOverview(PAUSED_PATH, { paused: !data.paused })
          setData(next)
        } catch (cause) {
          setError(cause?.message || String(cause))
        } finally {
          setBusy(false)
        }
      }

      if (!data?.mode) return null
      const label = data.modeLabel || MODE_OPTIONS.find(([value]) => value === data.mode)?.[1] || data.mode
      return h(
        'span',
        { className: 'dshuf-mode-wrap' },
        h('button', {
          type: 'button',
          className: 'dshuf-mode-button',
          title: '设置 Firefox 插件的访问模式',
          onClick: (event) => { event.preventDefault(); event.stopPropagation(); setOpen((value) => !value) },
          onMouseDown: (event) => event.preventDefault(),
        }, h('span', { className: 'dshuf-mode-name' }, 'Firefox'), h('span', { className: 'dshuf-mode-value' }, label)),
        h('button', {
          type: 'button',
          className: `dshuf-stop${data.paused ? ' paused' : ''}`,
          title: data.paused ? '恢复 Firefox 操作' : '急停 Firefox 操作',
          disabled: busy,
          onClick: togglePause,
          onMouseDown: (event) => event.preventDefault(),
        }, data.paused ? '恢复' : '急停'),
        open ? h(
          'span',
          { className: 'dshuf-mode-menu' },
          MODE_OPTIONS.map(([mode, text, hint]) => h('button', {
            type: 'button',
            key: mode,
            className: `dshuf-mode-item${data.mode === mode ? ' active' : ''}`,
            disabled: busy,
            onClick: (event) => { event.preventDefault(); event.stopPropagation(); void pick(mode) },
          }, h('span', null, text), h('small', null, hint))),
          error ? h('span', { className: 'dshuf-card-error' }, error) : null,
        ) : null,
      )
    }

    function composeDraft(state, items) {
      if (!state || state.phase !== 'plain' || state.claim !== undefined) return undefined
      const text = typeof state.draft === 'string' ? state.draft : ''
      const occurrences = Array.isArray(state.occurrences) ? state.occurrences : []
      const known = new Set(occurrences.map((occurrence) => occurrence.ref))
      const references = [...occurrences]
      const ack = []
      let next = text
      let added = 0
      for (const item of items) {
        if (typeof item?.id !== 'string' || typeof item?.mention !== 'string' || item.mention === '') continue
        ack.push(item.id)
        if (known.has(item.mention)) continue
        known.add(item.mention)
        if (next !== '' && !next.endsWith('\n')) next += '\n'
        references.push({
          source: 'reference',
          ref: item.mention,
          offset: next.length,
          length: item.mention.length,
          label: typeof item.label === 'string' && item.label !== '' ? item.label : item.mention,
          clipboardText: item.mention,
        })
        next += item.mention
        added += 1
      }
      return { text: added ? next : undefined, references, ack }
    }

    function removeMentions(state, mentions) {
      if (!state || state.phase !== 'plain') return undefined
      const remove = new Set(mentions.filter((value) => typeof value === 'string' && value !== ''))
      if (remove.size === 0) return undefined
      const text = typeof state.draft === 'string' ? state.draft : ''
      const occurrences = Array.isArray(state.occurrences) ? state.occurrences : []
      const removed = occurrences.filter((occurrence) => remove.has(occurrence.ref))
      if (removed.length === 0) return undefined
      let next = text
      for (const occurrence of [...removed].sort((left, right) => right.offset - left.offset)) {
        next = next.slice(0, occurrence.offset) + next.slice(occurrence.offset + occurrence.length)
      }
      const beforeTrim = next
      next = next.replace(/^\n+/, '').replace(/\n+$/, '')
      const leading = beforeTrim.length - next.length
      const references = occurrences
        .filter((occurrence) => !remove.has(occurrence.ref))
        .map((occurrence) => {
          const cut = removed.reduce((total, item) => total + (item.offset < occurrence.offset ? item.length : 0), 0)
          return {
            source: occurrence.source,
            ref: occurrence.ref,
            offset: Math.max(0, occurrence.offset - cut - leading),
            length: occurrence.length,
            label: occurrence.label,
            ...(occurrence.appearance === undefined ? {} : { appearance: occurrence.appearance }),
            clipboardText: occurrence.clipboardText,
            ...(occurrence.invalid === undefined ? {} : { invalid: occurrence.invalid }),
          }
        })
      return { text: next, references }
    }

    function pendingForSession(items, sessionId) {
      return items
        .filter((item) => item.sessionId === sessionId || item.sessionId == null)
        .sort((left, right) => (Number(left.seq) || 0) - (Number(right.seq) || 0))
    }

    function ensureMentions(state, items) {
      if (!state || state.phase !== 'plain' || (state.quotes?.length ?? 0) > 0) return undefined
      let text = typeof state.draft === 'string' ? state.draft : ''
      const references = Array.isArray(state.occurrences) ? [...state.occurrences] : []
      const known = new Set(references.map((occurrence) => occurrence.ref))
      let changed = false
      for (const item of items) {
        if (typeof item?.id !== 'string' || typeof item?.mention !== 'string' || item.mention === '') continue
        if (known.has(item.mention) || text.includes(item.mention)) continue
        if (text !== '' && !text.endsWith('\n')) text += '\n'
        references.push({
          source: 'reference',
          ref: item.mention,
          offset: text.length,
          length: item.mention.length,
          label: typeof item.label === 'string' && item.label !== '' ? item.label : item.mention,
          clipboardText: item.mention,
        })
        text += item.mention
        known.add(item.mention)
        changed = true
      }
      return changed ? { text, references } : undefined
    }

    function mergeCards(previous, items) {
      const map = new Map(previous.map((item) => [item.id, item]))
      for (const item of items) map.set(item.id, item)
      return [...map.values()]
    }

    const DETAIL_LABELS = {
      color: '文字颜色', backgroundColor: '背景颜色', opacity: '透明度', fontFamily: '字体',
      fontSize: '字号', fontWeight: '字重', borderColor: '边框颜色', borderRadius: '圆角',
      borderWidth: '边框宽度', width: '宽度', height: '高度', display: '显示', lineHeight: '行高',
      padding: '内边距', margin: '外边距',
    }

    function annotationDetailRows(item) {
      const rows = []
      if (item.page?.url) rows.push(['页面', `${item.page.title || ''}${item.page.title ? ' — ' : ''}${item.page.url}`])
      if (item.selector) rows.push(['元素', `${item.tag || ''} ${item.selector}`])
      if (item.createdAt) rows.push(['时间', new Date(item.createdAt).toLocaleString()])
      if (item.details && typeof item.details === 'object' && !Array.isArray(item.details)) {
        for (const [key, value] of Object.entries(item.details)) {
          if (value === undefined || value === null || value === '') continue
          rows.push([DETAIL_LABELS[key] || key, String(value)])
        }
      }
      return rows
    }

    function AnnotationCard({ item, history = false, readOnly = false, onSaved, onDeleted }) {
      const [editing, setEditing] = React.useState(false)
      const [detailsOpen, setDetailsOpen] = React.useState(false)
      const [comment, setComment] = React.useState(item.comment || '')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')

      React.useEffect(() => {
        if (!editing) setComment(item.comment || '')
      }, [item.comment, editing])

      React.useEffect(() => {
        if (readOnly) return undefined
        const open = (event) => {
          if (event?.detail?.label !== item.label) return
          setComment(item.comment || '')
          setEditing(true)
        }
        window.addEventListener('dshuf-edit-annotation', open)
        return () => window.removeEventListener('dshuf-edit-annotation', open)
      }, [item.label, item.comment, readOnly])

      const toggle = () => {
        if (busy) return
        if (readOnly) {
          setDetailsOpen((value) => !value)
          return
        }
        setError('')
        setEditing((value) => !value)
      }

      const save = async (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (busy) return
        setBusy(true)
        setError('')
        try {
          const updated = await updateAnnotation(item.id, comment.trim())
          onSaved?.(updated ?? { ...item, comment: comment.trim() })
          setEditing(false)
        } catch (cause) {
          setError(cause?.message || String(cause))
        } finally {
          setBusy(false)
        }
      }

      const remove = async (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (busy) return
        setBusy(true)
        setError('')
        try {
          await deleteAnnotation(item.id)
          onDeleted?.(item)
        } catch (cause) {
          setError(cause?.message || String(cause))
        } finally {
          setBusy(false)
        }
      }

      const onKeyDown = (event) => {
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          setEditing(false)
        } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          void save(event)
        }
      }

      return h(
        'span',
        {
          className: `dshuf-card${editing ? ' editing' : ''}${history ? ' dshuf-history' : ''}${readOnly ? ' dshuf-readonly' : ''}`,
          'data-annotation-id': item.id,
          onClick: (event) => {
            if (event.target?.closest?.('button, textarea')) return
            toggle()
          },
        },
        item.imageUrl
          ? h('img', { className: 'dshuf-thumb', src: item.imageUrl, alt: '' })
          : h('span', { className: 'dshuf-thumb dshuf-thumb-empty' }, '浏览器注释'),
        h(
          'span',
          { className: 'dshuf-card-body' },
          h(
            'span',
            { className: 'dshuf-card-head' },
            h('span', { className: 'dshuf-card-title' }, item.label || (Number.isFinite(Number(item.seq)) ? `网页注释 ${item.seq}` : '网页注释')),
            h('button', {
              type: 'button',
              className: 'dshuf-edit',
              onClick: (event) => { event.preventDefault(); event.stopPropagation(); toggle() },
            }, readOnly ? (detailsOpen ? '收起' : '详情') : (editing ? '收起' : '编辑')),
          ),
          !readOnly && editing
            ? h(
              'span',
              { className: 'dshuf-editbox' },
              h('textarea', {
                value: comment,
                placeholder: '添加评论…',
                onChange: (event) => setComment(event.target.value),
                onKeyDown,
                onClick: (event) => event.stopPropagation(),
              }),
              h(
                'span',
                { className: 'dshuf-edit-actions' },
                h('button', {
                  type: 'button',
                  className: 'danger',
                  disabled: busy,
                  onClick: remove,
                }, '删除'),
                h('button', {
                  type: 'button',
                  className: 'primary',
                  disabled: busy,
                  onClick: save,
                }, busy ? '保存中…' : '保存'),
              ),
            )
            : h('span', { className: 'dshuf-card-comment' }, item.comment || '（无评论）'),
          readOnly && detailsOpen
            ? h('span', { className: 'dshuf-history-details' }, annotationDetailRows(item).map(([key, value]) => h(
              'span',
              { className: 'dshuf-detail-row', key },
              h('span', { className: 'dshuf-detail-key' }, key),
              h('span', { className: 'dshuf-detail-value' }, value),
            )))
            : null,
          error ? h('span', { className: 'dshuf-card-error' }, error) : null,
        ),
      )
    }

    function AnnoReference({ node, raw }) {
      const id = node?.data?.id
      const label = node?.data?.label || raw
      const [item, setItem] = React.useState(null)
      const [deleted, setDeleted] = React.useState(false)
      const [missing, setMissing] = React.useState(false)
      React.useEffect(() => {
        if (typeof id !== 'string' || id === '') {
          setMissing(true)
          return undefined
        }
        let live = true
        void getItem(id).then((value) => {
          if (!live) return
          if (value) setItem(value)
          else setMissing(true)
        })
        return () => { live = false }
      }, [id])
      if (deleted) return h('span', { className: 'dshuf-chip dshuf-chip-deleted' }, `${label}（已删除）`)
      if (!item) return h('span', { className: 'dshuf-chip', title: missing ? '这条注释已不存在' : '' }, label)
      return h(AnnotationCard, {
        item,
        history: true,
        readOnly: true,
      })
    }

    function decodeAnnotationText(value) {
      return String(value || '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
    }

    function annotationFromBlock(raw, id) {
      const comment = decodeAnnotationText(/<user_comment>([\s\S]*?)<\/user_comment>/.exec(raw)?.[1] || '')
      let evidence = null
      const evidenceText = /<untrusted_page_evidence>([\s\S]*?)<\/untrusted_page_evidence>/.exec(raw)?.[1]
      if (evidenceText) {
        const start = evidenceText.indexOf('{')
        const end = evidenceText.lastIndexOf('}')
        if (start >= 0 && end > start) {
          try { evidence = JSON.parse(evidenceText.slice(start, end + 1)) } catch { /* keep the visible fallback card */ }
        }
      }
      const bounds = evidence?.bounds
      return {
        id: id || 'inline-annotation',
        label: '网页注释',
        comment,
        page: evidence?.url ? { url: evidence.url, title: evidence.title || '' } : undefined,
        selector: evidence?.selector || '',
        tag: evidence?.tagName || '',
        details: bounds && Number.isFinite(Number(bounds.width)) && Number.isFinite(Number(bounds.height))
          ? { width: `${Math.round(Number(bounds.width))}px`, height: `${Math.round(Number(bounds.height))}px` }
          : undefined,
      }
    }

    function AnnoBlock({ node, raw }) {
      const id = typeof node?.data?.id === 'string' ? node.data.id : ''
      const [item, setItem] = React.useState(null)
      React.useEffect(() => {
        if (id === '') return undefined
        let live = true
        void getItem(id).then((value) => {
          if (live && value) setItem(value)
        }).catch(() => {})
        return () => { live = false }
      }, [id])
      return h(AnnotationCard, {
        item: item || annotationFromBlock(raw, id),
        history: true,
        readOnly: true,
      })
    }

    function Dock({ sessionId, input, inputActions }) {
      const [cards, setCards] = React.useState([])
      const [portalHost, setPortalHost] = React.useState(null)
      const hostRef = React.useRef(null)
      const wrapRef = React.useRef(null)
      const seenDraft = React.useRef(false)
      const latest = React.useRef({ input, inputActions })
      React.useEffect(() => { latest.current = { input, inputActions } })
      React.useEffect(() => {
        seenDraft.current = false
        setCards([])
      }, [sessionId])

      React.useEffect(() => {
        const ensure = () => {
          if (hostRef.current?.isConnected) return
          const anchor = document.querySelector('[data-composer-overlay]')
          if (anchor) {
            hostRef.current = anchor
            setPortalHost(anchor)
          }
        }
        ensure()
        const timer = setInterval(ensure, 1000)
        return () => clearInterval(timer)
      }, [sessionId])

      React.useEffect(() => {
        if (!portalHost || !wrapRef.current) return undefined
        const card = portalHost.closest('[data-composer-card]')
        if (!card) return undefined
        const update = () => {
          const height = wrapRef.current?.offsetHeight || 0
          card.style.setProperty('--dshuf-inline-height', `${height}px`)
        }
        update()
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
        observer?.observe(wrapRef.current)
        return () => {
          observer?.disconnect()
          card.style.removeProperty('--dshuf-inline-height')
        }
      }, [portalHost, cards.length])

      React.useEffect(() => {
        if (typeof sessionId !== 'string' || sessionId === '') return undefined
        let cancelled = false
        const pull = async () => {
          if (document.visibilityState === 'hidden') return
          try {
            const [items, pending] = await Promise.all([getQueue(sessionId), getPending()])
            if (cancelled) return
            const known = new Set(pending.map((item) => item.id))
            const sessionPending = pendingForSession(pending, sessionId)
            let state = latest.current.input
            const orphans = (state?.occurrences || [])
              .map((occurrence) => ({ occurrence, id: mentionId(occurrence.ref) }))
              .filter(({ id }) => id && !known.has(id))
              .map(({ occurrence }) => occurrence.ref)
            if (orphans.length > 0) {
              const plan = removeMentions(state, orphans)
              if (plan) {
                try { latest.current.inputActions.setDraft(plan) } catch { /* keep the old draft */ }
                state = { ...state, draft: plan.text, occurrences: plan.references }
              }
            }
            const relabeled = relabelDraft(state, pending)
            if (relabeled) {
              try { latest.current.inputActions.setDraft(relabeled) } catch { /* keep the old draft */ }
              state = { ...state, draft: relabeled.text, occurrences: relabeled.references }
            }
            const ensured = ensureMentions(state, sessionPending)
            if (ensured) {
              try { latest.current.inputActions.setDraft(ensured) } catch { /* keep the old draft */ }
              state = { ...state, draft: ensured.text, occurrences: ensured.references }
            }
            setCards(sessionPending)
            if (items.length === 0) return
            const plan = composeDraft(state, items)
            if (!plan) return
            if (plan.text !== undefined) {
              latest.current.inputActions.setDraft({ text: plan.text, references: plan.references })
            }
            if (plan.ack.length) await acknowledge(plan.ack)
          } catch { /* retry on the next poll */ }
        }
        const announce = () => { void reportFocus(sessionId).catch(() => {}) }
        announce()
        void pull()
        const timer = setInterval(() => void pull(), POLL_MS)
        const onVisible = () => {
          if (document.visibilityState === 'hidden') return
          announce()
          void pull()
        }
        document.addEventListener('visibilitychange', onVisible)
        window.addEventListener('focus', onVisible)
        return () => {
          cancelled = true
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
          window.removeEventListener('focus', onVisible)
        }
      }, [sessionId])

      React.useEffect(() => {
        const text = typeof input?.draft === 'string' ? input.draft : ''
        if (text !== '') {
          seenDraft.current = true
        } else if (cards.length > 0 && seenDraft.current) {
          seenDraft.current = false
          setCards([])
        }
      }, [input?.draft, cards.length])

      const updateCard = (next) => {
        if (!next) return
        setCards((previous) => previous.map((item) => item.id === next.id ? { ...item, ...next } : item))
      }

      const removeCard = async (item) => {
        setCards((previous) => previous.filter((value) => value.id !== item.id))
        const base = latest.current.input
        const plan = removeMentions(base, [item.mention])
        const draftState = plan ? { ...base, draft: plan.text, occurrences: plan.references } : base
        try { latest.current.inputActions.setDraft(plan || { text: base.draft, references: base.occurrences }) } catch { /* leave the draft alone */ }
        try {
          const pending = await getPending()
          const sessionPending = pendingForSession(pending, sessionId)
          setCards(sessionPending)
          const relabeled = relabelDraft(draftState, pending)
          if (relabeled) latest.current.inputActions.setDraft(relabeled)
        } catch { /* host will reconcile on the next poll */ }
      }

      if (typeof sessionId !== 'string' || sessionId === '' || cards.length === 0) return null
      const list = h(
        'div',
        { className: 'dshuf-list' },
        cards.map((item) => h(AnnotationCard, {
          key: item.id,
          item,
          onSaved: updateCard,
          onDeleted: removeCard,
        })),
      )
      if (ReactDOM && typeof ReactDOM.createPortal === 'function' && portalHost) {
        return ReactDOM.createPortal(
          h('div', { className: 'dshuf-inline-wrap', ref: wrapRef }, list),
          portalHost,
        )
      }
      return h(
        'div',
        { className: 'dshuf-dock' },
        h('div', { className: 'dshuf-summary' }, `${cards.length} 条注释`),
        list,
      )
    }

    return {
      inject: ['slots', 'uiConversation'],
      composeDraft,
      removeMentions,
      relabelDraft,
      ensureMentions,
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.dshufChip = 'style'
          style.textContent = CSS
          document.head.appendChild(style)
          return () => style.remove()
        }, 'dsh-use-firefox: chip styles')

        ctx.effect(() => ctx.uiConversation.userText.register(annoRule), 'dsh-use-firefox: user text rule')
        ctx.effect(() => ctx.uiConversation.userText.register(annoBlockRule), 'dsh-use-firefox: annotation block rule')

        ctx.effect(() => {
          const onClick = (event) => {
            const host = event.target?.closest?.('[data-composer-chip="reference"]')
            if (!host) return
            const chip = host.matches?.('span[title^="网页注释 "]')
              ? host
              : host.querySelector?.('span[title^="网页注释 "]')
            if (!chip) return
            const label = chip.getAttribute('title')
            if (label) window.dispatchEvent(new CustomEvent('dshuf-edit-annotation', { detail: { label } }))
          }
          document.addEventListener('click', onClick, true)
          return () => document.removeEventListener('click', onClick, true)
        }, 'dsh-use-firefox: annotation chip click')

        ctx.slots.inject('conversation.user.text.node', function* () {
          yield ctx.slots.register({ name: 'conversation.user.text.node', key: 'dshuf-anno', priority: 100 }, AnnoReference)
          yield ctx.slots.register({ name: 'conversation.user.text.node', key: 'dshuf-anno-block', priority: 110 }, AnnoBlock)
        })

        ctx.slots.inject('conversation.input.dock', function* () {
          yield ctx.slots.register({ name: 'conversation.input.dock', id: 'dshuf-anno-dock', order: 90 }, Dock)
        })

        ctx.slots.inject('conversation.input.left', function* () {
          yield ctx.slots.register({ name: 'conversation.input.left', id: 'dshuf-mode-control', order: 20 }, ModeControl)
        })

        ctx.slots.inject('plugins.bundle.config', function* () {
          yield ctx.slots.register({ name: 'plugins.bundle.config', key: 'dsh-use-firefox' }, SettingsPage)
        })

        ctx.slots.inject('plugins.detail.actions', function* () {
          yield ctx.slots.register({ name: 'plugins.detail.actions', id: 'dshuf-settings-jump', order: 40 }, SettingsJump)
        })
      },
    }
  },
})