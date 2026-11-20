import assert from 'node:assert/strict'
import test from 'node:test'
import { formatAnnotationText, formatSnapshot, formatTabs } from '../src/format.js'

test('formats a snapshot with refs, text, dialogs, and captcha', () => {
  const text = formatSnapshot({
    readyState: 'complete',
    scroll: { x: 0, y: 120, height: 2400, viewportWidth: 1200, viewportHeight: 800, container: { tag: 'div', id: 'content', scrollTop: 120, scrollHeight: 1200, clientHeight: 400 } },
    focused: { ref: 'e1', role: 'textbox', name: 'Search' },
    selection: 'selected words',
    elements: [
      { ref: 'e1', role: 'textbox', name: 'Search', value: 'hello', inViewport: true },
      { ref: 'e2', role: 'button', name: 'Submit', type: 'submit', sensitive: true, inViewport: false },
    ],
    interactiveTotal: 2,
    text: 'Hello page',
    textMax: 100,
    dialogs: [{ role: 'dialog', name: 'Cookie banner' }],
    captcha: { detected: true, clues: ['recaptcha iframe'] },
    frames: [{ src: 'https://example.com/frame', title: 'frame' }],
  }, { tabId: 7, title: 'Example', url: 'https://example.com/' })

  assert.match(text, /tab 7 · Example/)
  assert.match(text, /\[e1\] textbox "Search" value="hello"/)
  assert.match(text, /\[e2\] button "Submit" type=submit \[sensitive,offscreen\]/)
  assert.match(text, /scroll container: div#content 120\/1200/)
  assert.match(text, /CAPTCHA: 检测到/)
  assert.match(text, /DIALOGS:/)
  assert.match(text, /TEXT:\nHello page/)
})

test('formats tab list and empty group', () => {
  assert.match(formatTabs([{ tabId: 3, title: 'A', url: 'https://a/', active: true }]), /\* tab 3/)
  assert.match(formatTabs([]), /DSH/)
})

test('formats an annotation with a page, selector, and note', () => {
  const text = formatAnnotationText({
    kind: 'element',
    selector: '#submit',
    descriptor: { role: 'button', name: 'Send' },
    text: 'Send',
    note: '这里要改文案',
    page: { title: 'Form', url: 'https://example.com/form' },
    rect: { x: 10, y: 20, width: 100, height: 30 },
  }, 'anno-1')
  assert.match(text, /用户页面注释/)
  assert.match(text, /元素: #submit/)
  assert.match(text, /备注: 这里要改文案/)
  assert.match(text, /注释 id: anno-1/)
  assert.match(text, /不可信数据/)
})
