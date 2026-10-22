/**
 * 开放 API 令牌页面的纯展示逻辑，便于单测。
 */
import type { ApiTokenItem, ApiTokenScope } from './api'

export const MAX_ACTIVE_TOKENS = 20

const SCOPE_LABELS: Record<ApiTokenScope, string> = {
  read: '读取',
  write: '写入',
}

export function scopeLabel(scope: ApiTokenScope): string {
  return SCOPE_LABELS[scope] ?? scope
}

export function scopesLabel(scopes: ApiTokenScope[]): string {
  if (!scopes || scopes.length === 0) return '—'
  return scopes.map(scopeLabel).join(' / ')
}

/** SQLite CURRENT_TIMESTAMP 是 UTC 但无时区后缀，这里补成 ISO 再格式化。 */
export function parseTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDateTime(value: string | null | undefined): string {
  const date = parseTimestamp(value)
  if (!date) return '—'
  const pad = (num: number) => String(num).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export type TokenStatus = 'active' | 'revoked' | 'expired'

export function tokenStatus(
  item: Pick<ApiTokenItem, 'revokedAt' | 'expiresAt'>,
  now: Date = new Date()
): TokenStatus {
  if (item.revokedAt) return 'revoked'
  const expires = parseTimestamp(item.expiresAt)
  if (expires && expires.getTime() < now.getTime()) return 'expired'
  return 'active'
}

export function tokenStatusLabel(status: TokenStatus): string {
  if (status === 'revoked') return '已撤销'
  if (status === 'expired') return '已过期'
  return '有效'
}

/** 有效令牌数量是否还可以继续创建。 */
export function canCreateMore(
  items: ApiTokenItem[],
  max = MAX_ACTIVE_TOKENS
): boolean {
  return items.filter((item) => tokenStatus(item) === 'active').length < max
}

/** 生成给用户复制的 CLI 登录命令。 */
export function buildCliLoginCommand(token: string): string {
  return `of login --token ${token}`
}
