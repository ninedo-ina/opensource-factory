import { apiFetch, DEMO_MODE } from '@/lib/api'

export type ThemeMode = 'vector' | 'keyword' | 'empty'

export interface ThemeThresholds {
  minSimilarity: number
  minClusterSize: number
  maxClusters: number
}

export interface ThemeRepo {
  id: string
  name: string
  description: string
  summary: string
  language: string
  stars: number
  tags: string[]
}

export interface ThemeCluster {
  id: string
  name: string
  keywords: string[]
  suggestedTags: string[]
  repoCount: number
  cohesion: number
  repos: ThemeRepo[]
}

export interface ThemeUnclustered {
  id: string
  name: string
  reason: 'no_vector' | 'singleton' | 'dim_mismatch' | 'overflow'
}

export interface ThemeStats {
  totalRepos: number
  clusteredRepos: number
  themeCount: number
  coverage: number
  vectorized: number
  model: string
  backend: string
}

export interface ThemeClusterResponse {
  mode: ThemeMode
  themes: ThemeCluster[]
  unclustered: ThemeUnclustered[]
  stats: ThemeStats
  thresholds: ThemeThresholds
  generatedAt: string
  tookMs: number
}

export interface ApplyThemeTagResult {
  tag: string
  applied: number
  skipped: number
  total: number
}

const DEFAULT_THRESHOLDS: ThemeThresholds = {
  minSimilarity: 0.55,
  minClusterSize: 2,
  maxClusters: 12,
}

function demoRepo(
  id: string,
  description: string,
  language: string,
  stars: number,
  tags: string[] = []
): ThemeRepo {
  return {
    id,
    name: id.split('/')[1] ?? id,
    description,
    summary: '',
    language,
    stars,
    tags,
  }
}

/** 演示模式 / 接口不可用时的主题数据，保证页面可预览。 */
export const MOCK_THEME_RESPONSE: ThemeClusterResponse = {
  mode: 'vector',
  generatedAt: '2026-10-22T09:30:00.000Z',
  tookMs: 86,
  thresholds: DEFAULT_THRESHOLDS,
  stats: {
    totalRepos: 9,
    clusteredRepos: 7,
    themeCount: 3,
    coverage: 77.8,
    vectorized: 8,
    model: 'BAAI/bge-m3',
    backend: 'sentence-transformers',
  },
  themes: [
    {
      id: 'theme-demo-llm',
      name: 'AI / LLM',
      keywords: ['ai', 'llm', 'agent', 'rag', '向量'],
      suggestedTags: ['ai', 'llm', 'agent'],
      repoCount: 3,
      cohesion: 0.84,
      repos: [
        demoRepo('demo/langchain-app', '基于 LangChain 的 LLM 应用脚手架', 'Python', 860, ['ai']),
        demoRepo('demo/rag-service', '检索增强生成（RAG）服务模板', 'TypeScript', 420),
        demoRepo('demo/agent-kit', '多智能体协作工具包', 'Python', 310),
      ],
    },
    {
      id: 'theme-demo-react-admin',
      name: 'React / Admin',
      keywords: ['react', 'admin', 'dashboard', 'saas'],
      suggestedTags: ['react', 'admin', 'dashboard'],
      repoCount: 2,
      cohesion: 0.79,
      repos: [
        demoRepo('demo/react-admin', 'React 19 管理后台模板', 'TypeScript', 520, ['react']),
        demoRepo('demo/saas-dashboard', 'SaaS 数据看板与权限管理', 'TypeScript', 280),
      ],
    },
    {
      id: 'theme-demo-devops',
      name: 'DevOps / CLI',
      keywords: ['devops', 'cli', 'docker', '部署'],
      suggestedTags: ['devops', 'cli'],
      repoCount: 2,
      cohesion: 0.72,
      repos: [
        demoRepo('demo/deploy-cli', '一键部署 Docker 应用的命令行工具', 'Go', 190),
        demoRepo('demo/infra-scripts', '常用运维与 CI 脚本合集', 'Shell', 120),
      ],
    },
  ],
  unclustered: [
    { id: 'demo/rust-parser', name: 'rust-parser', reason: 'singleton' },
    { id: 'demo/new-bookmark', name: 'new-bookmark', reason: 'no_vector' },
  ],
}

export interface ClusterThemeInput {
  minSimilarity?: number
  minClusterSize?: number
  maxClusters?: number
}

/** 触发主题聚类；接口不可用时回退演示数据。 */
export async function clusterThemes(
  input: ClusterThemeInput = {}
): Promise<ThemeClusterResponse> {
  try {
    return await apiFetch<ThemeClusterResponse>('/api/themes/cluster', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  } catch {
    // eslint-disable-next-line no-console
    console.info('[opensource-factory] 主题聚类接口不可用，使用演示数据')
    return {
      ...MOCK_THEME_RESPONSE,
      thresholds: { ...DEFAULT_THRESHOLDS, ...input },
      generatedAt: new Date().toISOString(),
    }
  }
}

/** 把建议标签应用到主题下的仓库；重复应用幂等。 */
export async function applyThemeTag(
  tag: string,
  repoIds: string[]
): Promise<ApplyThemeTagResult> {
  if (DEMO_MODE) {
    return { tag, applied: repoIds.length, skipped: 0, total: repoIds.length }
  }
  return apiFetch<ApplyThemeTagResult>('/api/themes/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag, repoIds }),
  })
}
