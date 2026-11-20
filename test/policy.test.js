import assert from 'node:assert/strict'
import test from 'node:test'
import { modeDecision, sensitivityOf } from '../src/policy.js'

test('full mode executes everything without approval', () => {
  const decision = modeDecision('full', { action: 'click', descriptor: { role: 'button', type: 'submit', name: 'Delete' } })
  assert.equal(decision.denied, false)
  assert.equal(decision.requiresApproval, false)
  assert.equal(decision.sensitive, true)
})

test('readonly mode denies mutating actions but allows reading and selecting', () => {
  assert.equal(modeDecision('readonly', { action: 'click' }).denied, true)
  assert.equal(modeDecision('readonly', { action: 'navigate' }).denied, true)
  assert.equal(modeDecision('readonly', { action: 'type' }).denied, true)
  assert.equal(modeDecision('readonly', { action: 'tabs.open' }).denied, true)
  assert.equal(modeDecision('readonly', { action: 'tabs.close' }).denied, true)
  assert.equal(modeDecision('readonly', { action: 'snapshot' }).denied, false)
  assert.equal(modeDecision('readonly', { action: 'screenshot' }).denied, false)
  assert.equal(modeDecision('readonly', { action: 'scroll' }).denied, false)
  assert.equal(modeDecision('readonly', { action: 'annotation' }).denied, false)
})

test('ask mode asks for every mutating action', () => {
  assert.equal(modeDecision('ask', { action: 'navigate' }).requiresApproval, true)
  assert.equal(modeDecision('ask', { action: 'tabs.close' }).requiresApproval, true)
  assert.equal(modeDecision('ask', { action: 'snapshot' }).requiresApproval, false)
})

test('auto mode only asks for sensitive actions', () => {
  assert.equal(modeDecision('auto', { action: 'click', descriptor: { role: 'link', name: 'Docs' } }).requiresApproval, false)
  assert.equal(modeDecision('auto', { action: 'click', descriptor: { role: 'button', name: 'Save' } }).requiresApproval, false)
  assert.equal(modeDecision('auto', { action: 'click', descriptor: { role: 'button', name: 'Submit order' } }).requiresApproval, true)
  assert.equal(modeDecision('auto', { action: 'click', descriptor: { role: 'button', type: 'submit', name: 'Continue' } }).requiresApproval, true)
  assert.equal(modeDecision('auto', { action: 'type', descriptor: { role: 'textbox', type: 'password' } }).requiresApproval, true)
  assert.equal(modeDecision('auto', { action: 'type', descriptor: { role: 'textbox', name: 'Email' } }).requiresApproval, false)
  assert.equal(modeDecision('auto', { action: 'press', text: 'Enter' }).requiresApproval, true)
  assert.equal(modeDecision('auto', { action: 'press', text: 'Tab' }).requiresApproval, false)
  assert.equal(modeDecision('auto', { action: 'navigate' }).requiresApproval, false)
})

test('sensitivity recognises Chinese and English action names', () => {
  assert.equal(sensitivityOf('click', { role: 'button', name: '发送' }).sensitive, true)
  assert.equal(sensitivityOf('click', { role: 'button', name: 'Delete account' }).sensitive, true)
  assert.equal(sensitivityOf('click', { role: 'link', name: 'Documentation' }).sensitive, false)
  assert.equal(sensitivityOf('type', { role: 'textbox', name: '验证码' }).sensitive, true)
  assert.equal(sensitivityOf('type', { role: 'textbox', name: 'CVV' }).sensitive, true)
})
