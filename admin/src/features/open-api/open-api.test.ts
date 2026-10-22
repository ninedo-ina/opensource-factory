import { describe, expect, it } from 'vitest'
import { MOCK_OPEN_API_TOKENS, type OpenApiToken } from './api'
import {
  EXPIRY_OPTIONS,
  SCOPE_OPTIONS,
  daysUntilExpiry,
  expiryLabel,
  filterTokens,
  formatDate,
  formatDateTime,
  scopeLabel,
  scopesLabel,
  statusLabel,
  statusVariant,
  tokenStatus,
} from './utils'

const NOW = Date.parse('2026-10-22T00:00:00.000Z')

function token(overrides: Partial<OpenApiToken> = {}): OpenApiToken {
  return {
    id: 'oat_test',
    label: 'CLI',
    hint: 'ofa_…a1b2',
    scopes: ['read'],
    createdAt: '2026-10-01T08:00:00.000Z',
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    status: 'active',
    ...overrides,
  }
}

describe('open api labels', () => {
  it('maps scopes to Chinese labels', () => {
    expect(SCOPE_OPTIONS).toHaveLength(2)
    expect(EXPIRY_OPTIONS.map((item) => item.value)).toEqual(['30', '90', '180', '365', '0'])
    expect(scopeLabel('read')).toBe('只读')
    expect(scopeLabel('write')).toBe('读写')
    expect(scopesLabel(['read'])).toBe('只读')
    expect(scopesLabel(['read', 'write'])).toBe('读写')
    expect(scopesLabel([])).toBe('只读')
  })

  it('maps token status to label and badge variant', () => {
    expect(tokenStatus(token(), NOW)).toBe('active')
    expect(tokenStatus(token({ revokedAt: '2026-10-02 00:00:00' }), NOW)).toBe('revoked')
    expect(tokenStatus(token({ expiresAt: '2026-10-01T00:00:00.000Z' }), NOW)).toBe('expired')
    expect(statusLabel('active')).toBe('有效')
    expect(statusLabel('expired')).toBe('已过期')
    expect(statusLabel('revoked')).toBe('已撤销')
    expect(statusVariant('active')).toBe('default')
    expect(statusVariant('expired')).toBe('secondary')
    expect(statusVariant('revoked')).toBe('destructive')
  })
})

describe('open api formatting', () => {
  it('formats ISO and D1 timestamps consistently', () => {
    expect(formatDate('2026-10-01T08:00:00.000Z')).toBe('2026-10-01')
    expect(formatDate('2026-10-01 08:00:00')).toBe('2026-10-01')
    expect(formatDate(null)).toBe('—')
    expect(formatDateTime('2026-10-01T08:30:00.000Z')).toBe('2026-10-01 08:30')
    expect(formatDateTime('2026-10-01 08:30:00')).toBe('2026-10-01 08:30')
  })

  it('calculates expiry days and labels', () => {
    expect(daysUntilExpiry(null, NOW)).toBeNull()
    expect(daysUntilExpiry('2026-11-01T00:00:00.000Z', NOW)).toBe(10)
    expect(daysUntilExpiry('2026-10-21T00:00:00.000Z', NOW)).toBe(-1)
    expect(expiryLabel(token(), NOW)).toBe('永不过期')
    expect(expiryLabel(token({ expiresAt: '2026-10-22T12:00:00.000Z' }), NOW)).toBe('今天到期')
    expect(expiryLabel(token({ expiresAt: '2026-11-01T00:00:00.000Z' }), NOW)).toBe('10 天后过期')
    expect(expiryLabel(token({ expiresAt: '2026-10-01T00:00:00.000Z' }), NOW)).toBe('已过期')
    expect(expiryLabel(token({ revokedAt: '2026-10-02 00:00:00' }), NOW)).toBe('已撤销')
  })

  it('filters demo tokens by label or hint', () => {
    expect(filterTokens(MOCK_OPEN_API_TOKENS.items, '')).toHaveLength(2)
    expect(filterTokens(MOCK_OPEN_API_TOKENS.items, 'cli').map((item) => item.label)).toEqual([
      'CLI 工具',
    ])
    expect(filterTokens(MOCK_OPEN_API_TOKENS.items, '2c7d').map((item) => item.label)).toEqual([
      '自动化脚本',
    ])
    expect(filterTokens(MOCK_OPEN_API_TOKENS.items, '不存在')).toHaveLength(0)
  })
})
