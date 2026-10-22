import { apiFetch, DEMO_MODE } from '@/lib/api'
import type {
  SearchEngine,
  SearchMode,
  SearchScope,
  SearchUnderstanding,
} from './utils'

export interface SearchResultItem {
  id: string
  source: 'my' | 'trending'
  fullName: string
  name: string
  description: string
  language: string
  stars: number
  starsToday: number
  url: string
  score: number
  reason: string
  /** README 全文命中片段（M6-01） */
  snippet?: string
  matchedTerms?: string[]
}

export interface SearchResponse {
  query: string
  mode: SearchMode
  count: number
  tookMs: number
  backend: string
  model: string
  dim: number
  items: SearchResultItem[]
  understanding?: SearchUnderstanding
  terms?: string[]
}

export interface SearchRequest {
  query: string
  topK?: number
  scope?: SearchScope
  offset?: number
}

/** 搜索建议（M6-10）：仓库或标签。 */
export interface SearchSuggestionItem {
  id: string
  type: 'repo' | 'tag'
  label: string
  value: string
  description: string
  source?: 'my' | 'trending'
  language?: string
  stars?: number
  url?: string
}

export interface SearchSuggestionResponse {
  query: string
  count: number
  tookMs: number
  items: SearchSuggestionItem[]
}

export const MOCK_SEARCH_ITEMS: SearchResultItem[] = [
  {
    id: 'nestjs/awesome-nestjs',
    source: 'trending',
    fullName: 'nestjs/awesome-nestjs',
    name: 'awesome-nestjs',
    description: 'NestJS 生态资源与最佳实践合集',
    language: 'TypeScript',
    stars: 12800,
    starsToday: 42,
    url: 'https://github.com/nestjs/awesome-nestjs',
    score: 0.91,
    reason:
      '与查询语义相似度 91%。主要使用 TypeScript 开发；项目简介：NestJS 生态资源与最佳实践合集。',
    snippet:
      'README 全文命中：NestJS 生态资源与最佳实践合集，包含模块、守卫与拦截器示例。',
    matchedTerms: ['NestJS'],
  },
  {
    id: 'demo/tenant-admin',
    source: 'my',
    fullName: 'demo/tenant-admin',
    name: 'tenant-admin',
    description: '支持多租户的 NestJS 管理后台模板',
    language: 'TypeScript',
    stars: 356,
    starsToday: 0,
    url: 'https://github.com/demo/tenant-admin',
    score: 0.88,
    reason:
      '与查询语义相似度 88%。主要使用 TypeScript 开发；项目简介：支持多租户的 NestJS 管理后台模板。',
  },
  {
    id: 'demo/saas-starter',
    source: 'trending',
    fullName: 'demo/saas-starter',
    name: 'saas-starter',
    description: '多租户 SaaS 启动模板，内置计费与权限',
    language: 'TypeScript',
    stars: 2100,
    starsToday: 18,
    url: 'https://github.com/demo/saas-starter',
    score: 0.79,
    reason:
      '与查询语义相似度 79%。主要使用 TypeScript 开发；项目简介：多租户 SaaS 启动模板，内置计费与权限。',
  },
]

/** 调用边缘搜索接口（语义 / 全文）；失败时回退演示数据，保证页面可用。 */
export async function searchRepositories(
  input: SearchRequest,
  engine: SearchEngine = 'semantic'
): Promise<SearchResponse> {
  const path =
    engine === 'fulltext' ? '/api/search/fulltext' : '/api/search/semantic'
  try {
    return await apiFetch<SearchResponse>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: input.query,
        topK: input.topK ?? 10,
        scope: input.scope ?? 'all',
        ...(engine === 'fulltext' ? { offset: input.offset ?? 0 } : {}),
      }),
    })
  } catch {
    // eslint-disable-next-line no-console
    console.info(
      `[opensource-factory] ${engine === 'fulltext' ? '全文' : '语义'}搜索接口不可用，使用演示数据`
    )
    return {
      query: input.query,
      mode: engine === 'fulltext' ? 'like' : 'keyword',
      count: MOCK_SEARCH_ITEMS.length,
      tookMs: 0,
      backend: '',
      model: '',
      dim: 0,
      items: MOCK_SEARCH_ITEMS,
    }
  }
}

const DEMO_TAGS = ['TypeScript', 'React', 'NestJS', 'Python', 'AI', '数据库']

/** 演示 / 降级建议：复用演示搜索结果 + 固定标签，保证无后端时下拉仍可用。 */
export function demoSearchSuggestions(
  query: string,
  limit = 8
): SearchSuggestionItem[] {
  const q = query.trim().toLowerCase()
  const repos: SearchSuggestionItem[] = MOCK_SEARCH_ITEMS.map((item) => ({
    id: `${item.source}:${item.id}`,
    type: 'repo',
    label: item.fullName,
    value: item.fullName,
    description: item.description,
    source: item.source,
    language: item.language,
    stars: item.stars,
    url: item.url,
  }))
  const tags: SearchSuggestionItem[] = DEMO_TAGS.map((name) => ({
    id: `tag:${name}`,
    type: 'tag',
    label: name,
    value: name,
    description: '标签',
  }))
  const ordered = q ? [...repos, ...tags] : [...tags, ...repos]
  const matched = ordered.filter(
    (item) =>
      !q ||
      item.label.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q)
  )
  return matched.slice(0, Math.max(0, Math.min(10, limit)))
}

/**
 * 拉取搜索建议（M6-10）。
 * 请求被取消时抛出 AbortError，调用方据此忽略；其它失败回退演示建议。
 */
export async function fetchSearchSuggestions(
  query: string,
  limit = 8,
  signal?: AbortSignal
): Promise<SearchSuggestionItem[]> {
  if (DEMO_MODE) return demoSearchSuggestions(query, limit)
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
  })
  try {
    const response = await apiFetch<SearchSuggestionResponse>(
      `/api/search/suggestions?${params.toString()}`,
      { signal }
    )
    return response.items
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error
    }
    // eslint-disable-next-line no-console
    console.info('[opensource-factory] 搜索建议接口不可用，使用演示数据')
    return demoSearchSuggestions(query, limit)
  }
}
