export const MODES = ['full', 'auto', 'ask', 'readonly']

export const MODE_LABELS = {
  full: '完全访问',
  auto: '自动检查',
  ask: '全部询问',
  readonly: '只读取',
}

const MUTATING_ACTIONS = new Set([
  'tabs.open',
  'tabs.close',
  'navigate',
  'click',
  'type',
  'press',
])

const SENSITIVE_NAME = /(send|submit|confirm|pay|payment|purchase|buy|order|checkout|delete|remove|destroy|publish|post|transfer|withdraw|authorize|login|sign\s*in|register|unsubscribe|发送|提交|确认|支付|付款|购买|下单|结算|删除|移除|销毁|发布|发帖|转账|提现|授权|绑定|登录|注册|注销|退订)/i
const SENSITIVE_FIELD = /(password|passwd|pwd|otp|one[-_ ]?time|verification|captcha|token|secret|cvv|cvc|card[-_ ]?number|credit[-_ ]?card|安全码|验证码|密码|口令|信用卡|卡号)/i

export function normalizeMode(value, fallback = 'full') {
  return MODES.includes(value) ? value : fallback
}

export function isMutating(action) {
  return MUTATING_ACTIONS.has(action)
}

export function sensitivityOf(action, descriptor = {}, text = '') {
  if (!descriptor || typeof descriptor !== 'object') descriptor = {}
  const role = String(descriptor.role || '')
  const type = String(descriptor.type || '')
  const name = String(descriptor.name || '')
  const id = String(descriptor.id || '')
  const placeholder = String(descriptor.placeholder || '')
  const autocomplete = String(descriptor.autocomplete || '')
  const inForm = descriptor.inForm === true
  const sensitiveField = Boolean(descriptor.sensitive) || type === 'password' || SENSITIVE_FIELD.test(`${name} ${id} ${placeholder} ${autocomplete}`)

  if (action === 'click') {
    if (type === 'submit') return { sensitive: true, reason: 'submit button' }
    if (SENSITIVE_NAME.test(name)) return { sensitive: true, reason: 'sensitive action name' }
    if (inForm && role === 'button' && type === 'submit') return { sensitive: true, reason: 'form submit' }
    return { sensitive: false, reason: '' }
  }

  if (action === 'type') {
    if (sensitiveField) return { sensitive: true, reason: 'sensitive field' }
    return { sensitive: false, reason: '' }
  }

  if (action === 'press') {
    const key = String(text || '')
    if (key === 'Enter' || key === 'NumpadEnter') return { sensitive: true, reason: 'Enter may submit' }
    return { sensitive: false, reason: '' }
  }

  if (action === 'tabs.close') return { sensitive: false, reason: '' }
  if (action === 'navigate' || action === 'tabs.open') return { sensitive: false, reason: '' }
  return { sensitive: false, reason: '' }
}

/**
 * Decide what the user mode means for one browser action.
 * @param {string} mode
 * @param {{action: string, descriptor?: object, text?: string}} input
 */
export function modeDecision(mode, input) {
  const normalized = normalizeMode(mode)
  const action = input.action
  const mutating = isMutating(action)
  const sensitivity = sensitivityOf(action, input.descriptor, input.text)

  if (normalized === 'readonly') {
    return {
      mode: normalized,
      mutating,
      sensitive: sensitivity.sensitive,
      denied: mutating,
      requiresApproval: false,
      reason: mutating ? '只读取模式不允许改变页面的操作' : '',
    }
  }

  if (normalized === 'full') {
    return { mode: normalized, mutating, sensitive: sensitivity.sensitive, denied: false, requiresApproval: false, reason: '' }
  }

  if (normalized === 'ask') {
    return {
      mode: normalized,
      mutating,
      sensitive: sensitivity.sensitive,
      denied: false,
      requiresApproval: mutating,
      reason: mutating ? '全部询问模式' : '',
    }
  }

  return {
    mode: normalized,
    mutating,
    sensitive: sensitivity.sensitive,
    denied: false,
    requiresApproval: mutating && sensitivity.sensitive,
    reason: sensitivity.reason,
  }
}

export function descriptorSummary(descriptor = {}) {
  if (!descriptor || typeof descriptor !== 'object') return ''
  const role = descriptor.role || descriptor.tag || 'element'
  const name = descriptor.name || ''
  const type = descriptor.type ? ` type=${descriptor.type}` : ''
  return `${role}${name ? ` "${name}"` : ''}${type}`
}
