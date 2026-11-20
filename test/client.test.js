import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(join(import.meta.dirname, '..', 'client.js'), 'utf8')

function loadClient() {
  let loaded
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (value) => [value, () => {}],
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
  }
  const document = {
    createElement: () => ({ dataset: {}, style: {}, textContent: '', appendChild() {}, remove() {} }),
    head: { appendChild() {} },
    addEventListener() {},
    removeEventListener() {},
    visibilityState: 'visible',
  }
  const window = {
    location: { origin: 'http://127.0.0.1:1234' },
    __ModuleLoader__: { load: (registration) => { loaded = registration } },
    addEventListener() {},
    removeEventListener() {},
  }
  vm.runInNewContext(source, {
    window,
    document,
    React,
    console,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    setInterval: () => 0,
    clearInterval: () => {},
    encodeURIComponent,
    JSON,
    URL,
  })
  const module = loaded.factory((id) => (id === 'react' ? React : {}))
  return { id: loaded.id, module }
}

test('client module registers the annotation loader id and apply faces', () => {
  const { id, module } = loadClient()
  assert.equal(id, 'dsh-use-firefox')
  assert.deepEqual([...module.inject], ['slots', 'uiConversation'])

  let rule
  const registrations = []
  const ctx = {
    effect: (callback) => { callback(); return () => {} },
    uiConversation: { userText: { register: (value) => { rule = value; return () => {} } } },
    slots: {
      inject(key, callback) { for (const dispose of callback()) assert.equal(typeof dispose, 'function') },
      register(entry) { registrations.push(entry); return () => {} },
    },
  }
  module.apply(ctx)
  assert.equal(rule.id, 'dshuf-anno')
  assert.deepEqual(registrations.map((entry) => entry.name), [
    'conversation.user.text.node',
    'conversation.input.dock',
  ])

  const match = rule.match('hello @[网页注释 2](dsh-anno:anno-20261120123456-abcdef)', 0)
  assert.equal(match.id, 'dshuf-anno')
  assert.equal(match.start, 6)
  assert.equal(match.data.id, 'anno-20261120123456-abcdef')
  assert.equal(match.data.label, '网页注释 2')
})

test('composeDraft appends idempotent reference chips and acknowledges every item', () => {
  const { module } = loadClient()
  const item = {
    id: 'anno-1',
    label: '网页注释 1',
    mention: '@[网页注释 1](dsh-anno:anno-1)',
  }
  const first = module.composeDraft({ phase: 'plain', draft: '看一下', occurrences: [] }, [item])
  assert.equal(first.text, `看一下\n${item.mention}`)
  assert.deepEqual([...first.ack], ['anno-1'])
  assert.equal(first.references.length, 1)
  assert.deepEqual({ ...first.references[0] }, {
    source: 'reference',
    ref: item.mention,
    offset: 4,
    length: item.mention.length,
    label: '网页注释 1',
    clipboardText: item.mention,
  })

  const second = module.composeDraft({
    phase: 'plain',
    draft: first.text,
    occurrences: first.references.map((reference) => ({ ...reference, occurrenceId: 1 })),
  }, [item])
  assert.equal(second.text, undefined)
  assert.equal(second.references.length, 1)
  assert.deepEqual([...second.ack], ['anno-1'])

  assert.equal(module.composeDraft({ phase: 'sending', draft: '', occurrences: [] }, [item]), undefined)
})
test('removeMentions removes a chip and rebases the remaining references', () => {
  const { module } = loadClient()
  const one = '@[网页注释 1](dsh-anno:anno-1)'
  const two = '@[网页注释 2](dsh-anno:anno-2)'
  const state = {
    phase: 'plain',
    draft: `${one}\n${two}`,
    occurrences: [
      { occurrenceId: 1, source: 'reference', ref: one, offset: 0, length: one.length, label: '网页注释 1', clipboardText: one },
      { occurrenceId: 2, source: 'reference', ref: two, offset: one.length + 1, length: two.length, label: '网页注释 2', clipboardText: two },
    ],
  }
  const plan = module.removeMentions(state, [one])
  assert.equal(plan.text, two)
  assert.equal(plan.references.length, 1)
  assert.equal(plan.references[0].ref, two)
  assert.equal(plan.references[0].offset, 0)
  assert.equal(module.removeMentions(state, ['不存在']), undefined)
  assert.equal(module.removeMentions({ ...state, phase: 'sending' }, [one]), undefined)
})
