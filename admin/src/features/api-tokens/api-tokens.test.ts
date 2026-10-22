import { describe, expect, it } from 'vitest'
import type { ApiTokenItem } from './api'
import {
  buildCliLoginCommand,
  canCreateMore,
  formatDateTime,
  parseTimestamp,
  scopeLabel,
  scopesLabel,
  tokenStatus,
  tokenStatusLabel,
} from './utils'

function token(overrides: Partial<ApiTokenItem> = {}): ApiTokenItem {
  return {
    id: 'tok_1',
    label: 'CLI',
    hint: 'ofp_aaaa…bbbb',
    scopes: ['read', 'write'],
    createdAt: '2026-10-01T00:00:00.000Z',
    lastUsedAt: null,
    revokedAt: null,
    expiresAt: null,
    ...overrides,
  }
}

describe('scopeLabel / scopesLabel', () => {
  it('maps scopes to Chinese labels', () => {
    expect(scopeLabel('read')).toBe('读取')
    expect(scopeLabel('write')).toBe('写入')
    expect(scopesLabel(['read', 'write'])).toBe('读取 / 写入')
    expect(scopesLabel(['read'])).toBe('读取')
    expect(scopesLabel([])).toBe('—')
  })
})

describe('parseTimestamp / formatDateTime', () => {
  it('accepts ISO and SQLite timestamp formats', () => {
    expect(parseTimestamp('2026-10-22T10:00:00.000Z')?.toISOString()).toBe(
      '2026-10-22T10:00:00.000Z'
    )
    expect(parseTimestamp('2026-10-22 10:00:00')?.toISOString()).toBe(
      '2026-10-22T10:00:00.000Z'
    )
    expect(parseTimestamp(null)).toBeNull()
    expect(parseTimestamp('not-a-date')).toBeNull()
  })

  it('formats local time and falls back to dash', () => {
    const iso = new Date(2026, 9, 22, 10, 5).toISOString()
    expect(formatDateTime(iso)).toBe('2026-10-22 10:05')
    expect(formatDateTime(null)).toBe('—')
  })
})

describe('tokenStatus', () => {
  const now = new Date('2026-10-22T00:00:00.000Z')

  it('marks revoked and expired tokens', () => {
    expect(tokenStatus(token({ revokedAt: '2026-10-20T00:00:00Z' }), now)).toBe('revoked')
    expect(tokenStatus(token({ expiresAt: '2026-10-21T00:00:00Z' }), now)).toBe('expired')
    expect(tokenStatus(token({ expiresAt: '2026-12-01T00:00:00Z' }), now)).toBe('active')
    expect(tokenStatus(token(), now)).toBe('active')
  })

  it('labels each status', () => {
    expect(tokenStatusLabel('active')).toBe('有效')
    expect(tokenStatusLabel('revoked')).toBe('已撤销')
    expect(tokenStatusLabel('expired')).toBe('已过期')
  })
})

describe('canCreateMore', () => {
  it('counts only active tokens', () => {
    const active = token()
    const revoked = token({ id: 'tok_2', revokedAt: '2026-10-20T00:00:00Z' })
    expect(canCreateMore([active], 2)).toBe(true)
    expect(canCreateMore([active, token({ id: 'tok_3' })], 2)).toBe(false)
    expect(canCreateMore([active, revoked], 2)).toBe(true)
  })
})

describe('buildCliLoginCommand', () => {
  it('embeds the token once', () => {
    expect(buildCliLoginCommand('ofp_abc')).toBe('of login --token ofp_abc')
  })
})
