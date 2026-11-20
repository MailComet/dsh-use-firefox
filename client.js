/* DSH Use Firefox — Web Client half.
 * Queues annotations into the composer as reference chips and shows the
 * annotation cards above the input. The annotation body is attached by the
 * host at agent/pre-step when the message is sent; sent messages render the
 * same cards inline and allow editing or deleting the stored annotation.
 */
window.__ModuleLoader__.load({
  id: 'dsh-use-firefox',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const QUEUE_PATH = '/ext/use-firefox/queue'
    const ACK_PATH = '/ext/use-firefox/queue/ack'
    const FOCUS_PATH = '/ext/use-firefox/focus'
    const ITEM_PATH = '/ext/use-firefox/item'
    const UPDATE_PATH = '/ext/use-firefox/update'
    const DELETE_PATH = '/ext/use-firefox/delete'
    const WIRE = /@\[((?:\\.|[^\\\]\n])*)\]\(dsh-anno:([A-Za-z0-9_-]+)\)/uy
    const POLL_MS = 2000

    const CSS = `
.dshuf-dock { display: flex; flex-direction: column; align-items: center; gap: 6px; margin: 0 0 8px; min-width: 0; }
.dshuf-summary { width: min(100%, var(--dsh-chat-content-width, 920px)); font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); padding: 0 2px; }
.dshuf-dock .dshuf-card { width: min(100%, var(--dsh-chat-content-width, 920px)); max-width: 100%; }
.dshuf-card { display: flex; gap: 8px; align-items: flex-start; min-width: 0; padding: 6px 8px; border: 1px solid var(--dsw-alias-border-secondary, #e5e7eb); border-radius: 10px; background: var(--dsw-alias-bg-elevated, #fff); cursor: pointer; box-sizing: border-box; }
.dshuf-card:hover { border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2563eb) 35%, var(--dsw-alias-border-secondary, #e5e7eb)); }
.dshuf-card.editing { align-items: stretch; background: var(--dsw-alias-bg-elevated, #fff); }
.dshuf-history { display: flex; width: 100%; max-width: none; margin-top: 7px; }
.dshuf-history .dshuf-thumb { width: 72px; height: 48px; }
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
.dshuf-chip-deleted { color: var(--dsw-alias-label-secondary, #6b7280); text-decoration: line-through; }
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

    function mergeCards(previous, items) {
      const map = new Map(previous.map((item) => [item.id, item]))
      for (const item of items) map.set(item.id, item)
      return [...map.values()]
    }

    function AnnotationCard({ item, history = false, onSaved, onDeleted }) {
      const [editing, setEditing] = React.useState(false)
      const [comment, setComment] = React.useState(item.comment || '')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')

      React.useEffect(() => {
        if (!editing) setComment(item.comment || '')
      }, [item.comment, editing])

      React.useEffect(() => {
        const open = (event) => {
          if (event?.detail?.label !== item.label) return
          setComment(item.comment || '')
          setEditing(true)
        }
        window.addEventListener('dshuf-edit-annotation', open)
        return () => window.removeEventListener('dshuf-edit-annotation', open)
      }, [item.label, item.comment])

      const toggle = () => {
        if (busy) return
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
          className: `dshuf-card${editing ? ' editing' : ''}${history ? ' dshuf-history' : ''}`,
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
            h('span', { className: 'dshuf-card-title' }, item.label || `网页注释 ${item.seq}`),
            h('button', {
              type: 'button',
              className: 'dshuf-edit',
              onClick: (event) => { event.preventDefault(); event.stopPropagation(); toggle() },
            }, editing ? '收起' : '编辑'),
          ),
          editing
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
        onSaved: setItem,
        onDeleted: () => setDeleted(true),
      })
    }

    function Dock({ sessionId, input, inputActions }) {
      const [cards, setCards] = React.useState([])
      const seenDraft = React.useRef(false)
      const latest = React.useRef({ input, inputActions })
      React.useEffect(() => { latest.current = { input, inputActions } })
      React.useEffect(() => {
        seenDraft.current = false
        setCards([])
      }, [sessionId])

      React.useEffect(() => {
        if (typeof sessionId !== 'string' || sessionId === '') return undefined
        let cancelled = false
        const pull = async () => {
          if (document.visibilityState === 'hidden') return
          try {
            const items = await getQueue(sessionId)
            if (cancelled || items.length === 0) return
            setCards((previous) => mergeCards(previous, items))
            const plan = composeDraft(latest.current.input, items)
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

      const removeCard = (item) => {
        setCards((previous) => previous.filter((value) => value.id !== item.id))
        const plan = removeMentions(latest.current.input, [item.mention])
        if (plan) {
          try { latest.current.inputActions.setDraft(plan) } catch { /* leave the draft alone */ }
        }
      }

      if (typeof sessionId !== 'string' || sessionId === '' || cards.length === 0) return null
      return h(
        'div',
        { className: 'dshuf-dock' },
        h('div', { className: 'dshuf-summary' }, `${cards.length} 条注释`),
        cards.map((item) => h(AnnotationCard, {
          key: item.id,
          item,
          onSaved: updateCard,
          onDeleted: removeCard,
        })),
      )
    }

    return {
      inject: ['slots', 'uiConversation'],
      composeDraft,
      removeMentions,
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.dshufChip = 'style'
          style.textContent = CSS
          document.head.appendChild(style)
          return () => style.remove()
        }, 'dsh-use-firefox: chip styles')

        ctx.effect(() => ctx.uiConversation.userText.register(annoRule), 'dsh-use-firefox: user text rule')

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
        })

        ctx.slots.inject('conversation.input.dock', function* () {
          yield ctx.slots.register({ name: 'conversation.input.dock', id: 'dshuf-anno-dock', order: 90 }, Dock)
        })
      },
    }
  },
})