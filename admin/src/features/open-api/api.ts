import { apiFetch, fetchWithFallback } from '@/lib/api'

export type OpenApiScope = 'read' | 'write'
export type OpenApiTokenStatus = 'active' | 'revoked'

export interface OpenApiToken {
  id: string
  label: string
  hint: string
  scopes: OpenApiScope[]
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
  status: OpenApiTokenStatus
}

export interface OpenApiTokenList {
  items: OpenApiToken[]
  maxActiveTokens: number
}

export interface CreateOpenApiTokenInput {
  label?: string
  scopes: OpenApiScope[]
  /** 0 表示永不过期；缺省 90 天 */
  expiresInDays?: number
}

export interface CreateOpenApiTokenResult {
  /** 明文令牌，仅创建时返回一次 */
  token: string
  item: OpenApiToken
}

export const MOCK_OPEN_API_TOKENS: OpenApiTokenList = {
  maxActiveTokens: 20,
  items: [
    {
      id: 'oat_demo000000000001',
      label: 'CLI 工具',
      hint: 'ofa_…9f3a',
      scopes: ['read'],
      createdAt: '2026-10-01T08:00:00.000Z',
      lastUsedAt: '2026-10-21T12:30:00.000Z',
      expiresAt: '2026-12-30T08:00:00.000Z',
      revokedAt: null,
      status: 'active',
    },
    {
      id: 'oat_demo000000000002',
      label: '自动化脚本',
      hint: 'ofa_…2c7d',
      scopes: ['read', 'write'],
      createdAt: '2026-09-12T03:20:00.000Z',
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
      status: 'active',
    },
  ],
}

export function fetchOpenApiTokens(): Promise<OpenApiTokenList> {
  return fetchWithFallback('/api/open/tokens', MOCK_OPEN_API_TOKENS)
}

export function createOpenApiToken(
  input: CreateOpenApiTokenInput
): Promise<CreateOpenApiTokenResult> {
  return apiFetch<CreateOpenApiTokenResult>('/api/open/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function revokeOpenApiToken(id: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/api/open/tokens/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}
