/**
 * 个人开放 API 令牌（M8-05 / M8-06）。
 *
 * 管理接口只接受浏览器会话 Cookie；明文令牌只在创建响应里返回一次。
 */
import { DEMO_MODE, apiFetch, fetchWithFallback } from '@/lib/api'

export type ApiTokenScope = 'read' | 'write'

export interface ApiTokenItem {
  id: string
  label: string
  hint: string
  scopes: ApiTokenScope[]
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
  expiresAt: string | null
}

export interface ApiTokenList {
  items: ApiTokenItem[]
}

export interface CreateApiTokenInput {
  label?: string
  scopes?: ApiTokenScope[]
}

export interface CreateApiTokenResult {
  token: string
  item: ApiTokenItem
}

const MOCK_TOKENS: ApiTokenItem[] = [
  {
    id: 'tok_demo_cli',
    label: '本地 CLI',
    hint: 'ofp_9f2a…7c1d',
    scopes: ['read', 'write'],
    createdAt: '2026-10-12T09:20:00.000Z',
    lastUsedAt: '2026-10-21T22:10:00.000Z',
    revokedAt: null,
    expiresAt: null,
  },
  {
    id: 'tok_demo_readonly',
    label: '只读报表脚本',
    hint: 'ofp_3b8e…0a44',
    scopes: ['read'],
    createdAt: '2026-09-30T02:00:00.000Z',
    lastUsedAt: null,
    revokedAt: null,
    expiresAt: null,
  },
]

function demoToken(): CreateApiTokenResult {
  const suffix = Math.random().toString(16).slice(2, 10).padEnd(8, '0')
  return {
    token: `ofp_demo${suffix}${'0'.repeat(32)}`,
    item: {
      id: `tok_demo_${suffix}`,
      label: '演示令牌',
      hint: `ofp_demo…${suffix.slice(-4)}`,
      scopes: ['read', 'write'],
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      revokedAt: null,
      expiresAt: null,
    },
  }
}

export async function fetchApiTokens(): Promise<ApiTokenList> {
  return fetchWithFallback<ApiTokenList>('/api/tokens', { items: MOCK_TOKENS })
}

export async function createApiToken(
  input: CreateApiTokenInput
): Promise<CreateApiTokenResult> {
  if (DEMO_MODE) return demoToken()
  return apiFetch<CreateApiTokenResult>('/api/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function revokeApiToken(id: string): Promise<{ ok: boolean }> {
  if (DEMO_MODE) return { ok: true }
  return apiFetch<{ ok: boolean }>(`/api/tokens/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}
