/* DSH Use Firefox — Web Client half.
 * Queues annotations into the composer as reference chips and shows the
 * thumbnail cards above the input. The annotation body is attached by the
 * host at agent/pre-step when the message is sent.
 */
window.__ModuleLoader__.load({
  id: 'dsh-use-firefox',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const QUEUE_PATH = '/ext/use-firefox/queue'
    const ACK_PATH = '/ext/use-firefox/queue/ack'
    const FOCUS_PATH = '/ext/use-firefox/focus'
    const WIRE = /@\[((?:\\.|[^\\\]\n])*)\]\(dsh-anno:([A-Za-z0-9_-]+)\)/uy
    const POLL_MS = 2000

    const CSS = `
.dshuf-dock { display: flex; flex-direction: column; gap: 6px; margin: 0 0 8px; min-width: 0; }
.dshuf-summary { font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); padding: 0 2px; }
.dshuf-card { display: flex; gap: 8px; align-items: center; min-width: 0; padding: 6px 8px; border: 1px solid var(--dsw-alias-border-secondary, #e5e7eb); border-radius: 10px; background: var(--dsw-alias-bg-elevated, #fff); }
.dshuf-thumb { width: 58px; height: 40px; flex: none; object-fit: cover; border-radius: 6px; border: 1px solid var(--dsw-alias-border-secondary, #e5e7eb); background: var(--dsw-alias-bg-secondary, #f8fafc); }
.dshuf-thumb-empty { display: flex; align-items: center; justify-content: center; font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dshuf-card-body { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.dshuf-card-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary, #111827); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshuf-card-comment { font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshuf-chip { display: inline; max-width: 100%; margin: 0 2px; color: var(--dsw-alias-state-business-primary, #2563eb); font-weight: 500; white-space: inherit; overflow-wrap: anywhere; }
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

    function AnnoReference({ node, raw }) {
      const label = node?.data?.label || raw
      return h('span', { className: 'dshuf-chip', 'data-ref-chip': 'anno' }, label)
    }

    async function getQueue(sessionId) {
      const url = `${window.location.origin}${QUEUE_PATH}?session=${encodeURIComponent(sessionId)}`
      const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' })
      if (!response.ok) return []
      const body = await response.json()
      return Array.isArray(body?.items) ? body.items : []
    }

    async function acknowledge(ids) {
      if (!ids.length) return
      await fetch(`${window.location.origin}${ACK_PATH}`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
    }

    async function reportFocus(sessionId) {
      await fetch(`${window.location.origin}${FOCUS_PATH}`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
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

    function mergeCards(previous, items) {
      const map = new Map(previous.map((item) => [item.id, item]))
      for (const item of items) map.set(item.id, item)
      return [...map.values()]
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

      if (typeof sessionId !== 'string' || sessionId === '' || cards.length === 0) return null
      return h(
        'div',
        { className: 'dshuf-dock' },
        h('div', { className: 'dshuf-summary' }, `${cards.length} 条批注`),
        cards.map((item) => h(
          'div',
          { className: 'dshuf-card', key: item.id },
          item.imageUrl
            ? h('img', { className: 'dshuf-thumb', src: item.imageUrl, alt: '' })
            : h('div', { className: 'dshuf-thumb dshuf-thumb-empty' }, '浏览器注释'),
          h(
            'div',
            { className: 'dshuf-card-body' },
            h('div', { className: 'dshuf-card-title' }, item.label || `网页注释 ${item.seq}`),
            h('div', { className: 'dshuf-card-comment' }, item.comment || '（无评论）'),
          ),
        )),
      )
    }

    return {
      inject: ['slots', 'uiConversation'],
      composeDraft,
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.dshufChip = 'style'
          style.textContent = CSS
          document.head.appendChild(style)
          return () => style.remove()
        }, 'dsh-use-firefox: chip styles')

        ctx.effect(() => ctx.uiConversation.userText.register(annoRule), 'dsh-use-firefox: user text rule')

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