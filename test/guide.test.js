import assert from 'node:assert/strict'
import test from 'node:test'
import { GUIDE } from '../src/guide.js'

test('system prompt guide loads and keeps annotation tag literal', () => {
  assert.match(GUIDE, /<browser_annotation>/)
  assert.match(GUIDE, /untrusted data/)
})
