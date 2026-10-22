import { apiFetch } from '@/lib/api'
import { fetchWithOffline } from '@/lib/offline-fetch'
import { queueOfflineMutation } from '@/lib/offline-mutations'
import { shouldQueueOffline } from '@/lib/offline-cache'

export type RecommendationStatus = 'new' | 'saved' | 'dismissed' | 'pushed'
export type RecommendationFilter = 'new' | 'saved' | 'dismissed' | 'all'

export interface Recommendation {
  id: string
  repoId: string
  owner: string
  name: string
  description: string
  language: string
  stars: number
  score: number
  reason: string
  basedOn: string[]
  url: string
  status: RecommendationStatus
  createdAt: string
}

export interface RecommendationStats {
  new: number
  saved: number
  dismissed: number
  pushed: number
  clicked: number
}

export interface RecommendationActionResult {
  ok: boolean
  status?: RecommendationStatus
  repoId?: string
  /** 离线排队：联网后自动同步 */
  queued?: boolean
}

export const MOCK_RECOMMENDATIONS: Recommendation[] = [
  {
    id: '1',
    repoId: 'huggingface/transformers',
    owner: 'huggingface',
    name: 'transformers',
    description: '最流行的预训练模型库，覆盖 NLP、视觉与多模态',
    language: 'Python',
    stars: 136000,
    score: 0.95,
    reason: '与你收藏的 langchain、ollama 同属 AI/LLM 领域，语义相似度极高',
    basedOn: ['AI/LLM', 'Python'],
    url: 'https://github.com/huggingface/transformers',
    status: 'new',
    createdAt: '2026-10-22 08:00:00',
  },
  {
    id: '2',
    repoId: 'modelcontextprotocol/servers',
    owner: 'modelcontextprotocol',
    name: 'servers',
    description: 'Model Context Protocol 官方服务器集合',
    language: 'TypeScript',
    stars: 42800,
    score: 0.92,
    reason: '与你关注的「AI 工具链」方向高度相关',
    basedOn: ['AI/LLM', '工具'],
    url: 'https://github.com/modelcontextprotocol/servers',
    status: 'new',
    createdAt: '2026-10-22 08:00:00',
  },
  {
    id: '3',
    repoId: 'astral-sh/ruff',
    owner: 'astral-sh',
    name: 'ruff',
    description: '极快的 Python linter 与格式化工具',
    language: 'Rust',
    stars: 35200,
    score: 0.88,
    reason: '你收藏了多个 Python 项目，ruff 是当前最流行的 Python 开发工具',
    basedOn: ['Python', '开发工具'],
    url: 'https://github.com/astral-sh/ruff',
    status: 'new',
    createdAt: '2026-10-22 08:00:00',
  },
]

const EMPTY_STATS: RecommendationStats = {
  new: 0,
  saved: 0,
  dismissed: 0,
  pushed: 0,
  clicked: 0,
}

/** 拉取推荐列表；演示模式（未配置 API 地址）下回退内置示例。 */
export async function fetchRecommendations(
  status: RecommendationFilter = 'new'
): Promise<Recommendation[]> {
  const fallback = MOCK_RECOMMENDATIONS.filter(
    (item) => status === 'all' || item.status === status
  )
  return fetchWithOffline<Recommendation[]>(
    `/api/recommendations?status=${encodeURIComponent(status)}&limit=50`,
    fallback
  )
}

/** 推荐统计（各状态数量 + 点击反馈数）。 */
export async function fetchRecommendationStats(): Promise<RecommendationStats> {
  return fetchWithOffline<RecommendationStats>('/api/recommendations/stats', {
    ...EMPTY_STATS,
    new: MOCK_RECOMMENDATIONS.length,
  })
}

/** 收藏推荐：同时写入「我的仓库」并落 saved 反馈。 */
export async function saveRecommendation(
  id: string
): Promise<RecommendationActionResult> {
  const path = `/api/recommendations/${encodeURIComponent(id)}/save`
  try {
    return await apiFetch<RecommendationActionResult>(path, { method: 'POST' })
  } catch (error) {
    if (shouldQueueOffline(error)) {
      const queued = await queueOfflineMutation(path, 'POST', {
        label: '收藏推荐',
      })
      if (queued) return { ok: true, status: 'saved', queued: true }
    }
    throw error
  }
}

/** 忽略推荐：可选原因会随 dismissed 反馈落库。 */
export async function dismissRecommendation(
  id: string,
  reason?: string
): Promise<RecommendationActionResult> {
  return apiFetch<RecommendationActionResult>(
    `/api/recommendations/${encodeURIComponent(id)}/dismiss`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reason ? { reason } : {}),
    }
  )
}

/** 记录「查看仓库」点击，用于反馈回流统计。 */
export async function trackRecommendationClick(
  id: string
): Promise<RecommendationActionResult> {
  return apiFetch<RecommendationActionResult>(
    `/api/recommendations/${encodeURIComponent(id)}/click`,
    { method: 'POST' }
  )
}
