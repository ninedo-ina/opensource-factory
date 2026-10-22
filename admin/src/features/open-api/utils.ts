import type { OpenApiScope, OpenApiToken, OpenApiTokenStatus } from './api'

export const SCOPE_OPTIONS: { value: OpenApiScope; label: string; desc: string }[] = [
  { value: 'read', label: '只读', desc: '读取收藏、分类、推荐、热榜与统计' },
  { value: 'write', label: '读写', desc: '在只读权限之上，允许通过 API 收藏仓库' },
]

export const EXPIRY_OPTIONS = [
  { value: '30', label: '30 天' },
  { value: '90', label: '90 天' },
  { value: '180', label: '180 天' },
  { value: '365', label: '365 天' },
  { value: '0', label: '永不过期' },
]

export function scopeLabel(scope: OpenApiScope): string {
  return scope === 'write' ? '读写' : '只读'
}

export function scopesLabel(scopes: OpenApiScope[]): string {
  if (!scopes.length) return '只读'
  return scopes.includes('write') ? '读写' : '只读'
}

/** 令牌状态：撤销优先，其次按过期时间判断。 */
export function tokenStatus(token: OpenApiToken, nowMs: number = Date.now()): OpenApiTokenStatus | 'expired' {
  if (token.revokedAt) return 'revoked'
  if (token.expiresAt && Date.parse(token.expiresAt) <= nowMs) return 'expired'
  return 'active'
}

export function statusLabel(status: OpenApiTokenStatus | 'expired'): string {
  if (status === 'revoked') return '已撤销'
  if (status === 'expired') return '已过期'
  return '有效'
}

export function statusVariant(status: OpenApiTokenStatus | 'expired'): 'default' | 'secondary' | 'destructive' {
  if (status === 'active') return 'default'
  if (status === 'expired') return 'secondary'
  return 'destructive'
}

/** 统一把 ISO / D1 时间转成 YYYY-MM-DD（D1 时间按 UTC 处理）。 */
export function formatDate(value: string | null | undefined): string {
  const parsed = parseDate(value)
  if (!parsed) return '—'
  return parsed.toISOString().slice(0, 10)
}

/** 统一把 ISO / D1 时间转成 YYYY-MM-DD HH:mm（UTC）。 */
export function formatDateTime(value: string | null | undefined): string {
  const parsed = parseDate(value)
  if (!parsed) return '—'
  return parsed.toISOString().slice(0, 16).replace('T', ' ')
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

/** 距过期天数；永不过期返回 null，已过期返回负数。 */
export function daysUntilExpiry(
  expiresAt: string | null | undefined,
  nowMs: number = Date.now()
): number | null {
  const parsed = parseDate(expiresAt)
  if (!parsed) return null
  return Math.floor((parsed.getTime() - nowMs) / (24 * 3600 * 1000))
}

export function expiryLabel(
  token: OpenApiToken,
  nowMs: number = Date.now()
): string {
  if (token.revokedAt) return '已撤销'
  const days = daysUntilExpiry(token.expiresAt, nowMs)
  if (days === null) return '永不过期'
  if (days < 0) return '已过期'
  if (days === 0) return '今天到期'
  return `${days} 天后过期`
}

/** 按备注 / 尾号过滤令牌（演示数据与列表搜索共用）。 */
export function filterTokens(tokens: OpenApiToken[], query: string): OpenApiToken[] {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return tokens
  return tokens.filter(
    (token) =>
      token.label.toLowerCase().includes(keyword) ||
      token.hint.toLowerCase().includes(keyword)
  )
}
