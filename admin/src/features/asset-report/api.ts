import { fetchWithFallback } from '@/lib/api'

export type AssetInsightKind =
  | 'volume'
  | 'growth'
  | 'category'
  | 'uncategorized'
  | 'star'
  | 'coverage'

export interface AssetVolumeMonth {
  month: string
  added: number
  cumulative: number
  starsAdded: number
  cumulativeStars: number
}

export interface AssetPlatformShare {
  platform: string
  label: string
  repoCount: number
  share: number
}

export interface AssetCategoryDistribution {
  id: string | null
  name: string
  repoCount: number
  starCount: number
  share: number
  avgStars: number
  topLanguage: string | null
}

export interface AssetLanguageDistribution {
  name: string
  repoCount: number
  starCount: number
  share: number
}

export interface AssetStarMover {
  repoId: string
  name: string
  owner: string
  url: string
  language: string | null
  stars: number
  gain: number
  growthRate: number
  appearances: number
  trend: 'new' | 'up' | 'down' | 'steady'
  sparkline: number[]
  firstDate: string
  lastDate: string
}

export interface AssetStarPoint {
  date: string
  trackedRepos: number
  totalStars: number
  starGain: number
  newRepos: number
}

export interface AssetReportResponse {
  period: {
    months: number
    startDate: string
    endDate: string
  }
  summary: {
    totalRepos: number
    totalStars: number
    totalForks: number
    avgStars: number
    categoryCount: number
    categorizedRepos: number
    uncategorizedRepos: number
    categoryCoverage: number
    languageCount: number
    withLanguage: number
    platformCount: number
    addedLast7d: number
    addedLast30d: number
    addedLast90d: number
    addedLast365d: number
    growthRate30d: number
    topCategory: { name: string; repoCount: number; share: number } | null
    topLanguage: string | null
    topPlatform: string | null
    starTrendCoverage: number
  }
  volume: {
    months: AssetVolumeMonth[]
    recent: {
      last7d: number
      last30d: number
      last90d: number
      last365d: number
    }
    peakMonth: { month: string; added: number } | null
    unknownCreated: number
    platforms: AssetPlatformShare[]
  }
  categories: AssetCategoryDistribution[]
  languages: AssetLanguageDistribution[]
  starTrend: {
    available: boolean
    period: {
      days: number
      startDate: string | null
      endDate: string | null
      snapshotDays: number
    }
    summary: {
      trackedRepos: number
      totalStars: number
      starGain: number
      coverage: number
    }
    series: AssetStarPoint[]
    topMovers: AssetStarMover[]
    languages: Array<{
      language: string
      repoCount: number
      starGain: number
      share: number
      topRepo: string | null
    }>
  }
  insights: Array<{
    kind: AssetInsightKind
    title: string
    description: string
  }>
  generatedAt: string
}

const MOCK_TOTAL_REPOS = 128
const MOCK_TOTAL_STARS = 286400
const BASE_ADDED = [3, 5, 4, 7, 6, 9, 8, 11, 10, 13, 12, 15]
const BASE_STARS = [800, 1200, 900, 1800, 1500, 2400, 2100, 3000, 2700, 3600, 3200, 4200]

function monthKey(offsetFromEnd: number): string {
  const date = new Date(Date.UTC(2026, 9 - offsetFromEnd, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function buildMockVolume(months: number): AssetVolumeMonth[] {
  let added: number[]
  let stars: number[]
  if (months <= 12) {
    added = BASE_ADDED.slice(12 - months)
    stars = BASE_STARS.slice(12 - months)
  } else {
    const extra = months - 12
    const extraAdded = Array.from({ length: extra }, (_, index) =>
      index < extra - 1 ? 2 : 1
    )
    added = [...extraAdded, ...BASE_ADDED]
    stars = [...extraAdded.map((value) => value * 200), ...BASE_STARS]
  }
  const opening = Math.max(0, MOCK_TOTAL_REPOS - added.reduce((sum, value) => sum + value, 0))
  const openingStars = Math.max(
    0,
    MOCK_TOTAL_STARS - stars.reduce((sum, value) => sum + value, 0)
  )
  let cumulative = opening
  let cumulativeStars = openingStars
  return added.map((value, index) => {
    cumulative += value
    cumulativeStars += stars[index] ?? 0
    return {
      month: monthKey(months - 1 - index),
      added: value,
      cumulative,
      starsAdded: stars[index] ?? 0,
      cumulativeStars,
    }
  })
}

const MOCK_CATEGORIES: AssetCategoryDistribution[] = [
  {
    id: 'c1',
    name: 'AI 应用',
    repoCount: 42,
    starCount: 128000,
    share: 32.8,
    avgStars: 3047.6,
    topLanguage: 'TypeScript',
  },
  {
    id: 'c2',
    name: '开发工具',
    repoCount: 28,
    starCount: 61200,
    share: 21.9,
    avgStars: 2185.7,
    topLanguage: 'TypeScript',
  },
  {
    id: 'c3',
    name: '数据与分析',
    repoCount: 18,
    starCount: 38400,
    share: 14.1,
    avgStars: 2133.3,
    topLanguage: 'Python',
  },
  {
    id: 'c4',
    name: '基础设施',
    repoCount: 14,
    starCount: 29800,
    share: 10.9,
    avgStars: 2128.6,
    topLanguage: 'Go',
  },
  {
    id: 'c5',
    name: '前端体验',
    repoCount: 9,
    starCount: 14600,
    share: 7,
    avgStars: 1622.2,
    topLanguage: 'TypeScript',
  },
  {
    id: 'c6',
    name: '学习资源',
    repoCount: 7,
    starCount: 8200,
    share: 5.5,
    avgStars: 1171.4,
    topLanguage: 'JavaScript',
  },
  {
    id: null,
    name: '未分类',
    repoCount: 10,
    starCount: 6200,
    share: 7.8,
    avgStars: 620,
    topLanguage: null,
  },
]

const MOCK_LANGUAGES: AssetLanguageDistribution[] = [
  { name: 'TypeScript', repoCount: 48, starCount: 156000, share: 37.5 },
  { name: 'Python', repoCount: 26, starCount: 54200, share: 20.3 },
  { name: 'Go', repoCount: 16, starCount: 31800, share: 12.5 },
  { name: 'Rust', repoCount: 10, starCount: 19600, share: 7.8 },
  { name: 'JavaScript', repoCount: 8, starCount: 12400, share: 6.3 },
  { name: 'Java', repoCount: 6, starCount: 6800, share: 4.7 },
  { name: 'C++', repoCount: 5, starCount: 3400, share: 3.9 },
  { name: 'Shell', repoCount: 4, starCount: 1500, share: 3.1 },
]

function buildMockStarSeries(days = 90): AssetStarPoint[] {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(Date.UTC(2026, 9, 22 - (days - 1 - index)))
    return {
      date: date.toISOString().slice(0, 10),
      trackedRepos: 56 + Math.round(index / 18),
      totalStars: 250000 + Math.round((36400 * index) / (days - 1)),
      starGain: 260 + (index % 9) * 18 + (index % 4) * 7,
      newRepos: index % 12 === 0 ? 2 : 0,
    }
  })
}

const MOCK_MOVERS: AssetStarMover[] = [
  {
    repoId: 'langchain-ai/langchain',
    name: 'langchain',
    owner: 'langchain-ai',
    url: 'https://github.com/langchain-ai/langchain',
    language: 'Python',
    stars: 98200,
    gain: 4820,
    growthRate: 5.2,
    appearances: 12,
    trend: 'up',
    sparkline: [93400, 94100, 94600, 95200, 95800, 96400, 97000, 97600, 98200],
    firstDate: '2026-07-25',
    lastDate: '2026-10-22',
  },
  {
    repoId: 'ollama/ollama',
    name: 'ollama',
    owner: 'ollama',
    url: 'https://github.com/ollama/ollama',
    language: 'Go',
    stars: 86400,
    gain: 3610,
    growthRate: 4.4,
    appearances: 10,
    trend: 'up',
    sparkline: [82800, 83300, 83900, 84400, 85000, 85500, 86000, 86400],
    firstDate: '2026-07-25',
    lastDate: '2026-10-22',
  },
  {
    repoId: 'microsoft/vscode',
    name: 'vscode',
    owner: 'microsoft',
    url: 'https://github.com/microsoft/vscode',
    language: 'TypeScript',
    stars: 172000,
    gain: 2140,
    growthRate: 1.3,
    appearances: 8,
    trend: 'steady',
    sparkline: [169900, 170300, 170800, 171200, 171600, 171900, 172000],
    firstDate: '2026-08-02',
    lastDate: '2026-10-22',
  },
]

export function mockAssetReport(months = 12): AssetReportResponse {
  const volumeMonths = buildMockVolume(months)
  const last = volumeMonths[volumeMonths.length - 1]
  const totalRepos = last?.cumulative ?? MOCK_TOTAL_REPOS
  return {
    period: {
      months,
      startDate: volumeMonths[0]?.month ? `${volumeMonths[0].month}-01` : '2025-11-01',
      endDate: '2026-10-22',
    },
    summary: {
      totalRepos,
      totalStars: last?.cumulativeStars ?? MOCK_TOTAL_STARS,
      totalForks: 42100,
      avgStars: totalRepos > 0 ? Math.round(((last?.cumulativeStars ?? MOCK_TOTAL_STARS) / totalRepos) * 10) / 10 : 0,
      categoryCount: 6,
      categorizedRepos: 118,
      uncategorizedRepos: 10,
      categoryCoverage: 92.2,
      languageCount: 8,
      withLanguage: 123,
      platformCount: 2,
      addedLast7d: 4,
      addedLast30d: 13,
      addedLast90d: 37,
      addedLast365d: 112,
      growthRate30d: 11.3,
      topCategory: { name: 'AI 应用', repoCount: 42, share: 32.8 },
      topLanguage: 'TypeScript',
      topPlatform: 'GitHub',
      starTrendCoverage: 46.9,
    },
    volume: {
      months: volumeMonths,
      recent: { last7d: 4, last30d: 13, last90d: 37, last365d: 112 },
      peakMonth: volumeMonths.reduce(
        (best, item) => (best === null || item.added > best.added ? item : best),
        null as AssetVolumeMonth | null
      ),
      unknownCreated: 0,
      platforms: [
        { platform: 'github', label: 'GitHub', repoCount: 116, share: 90.6 },
        { platform: 'gitee', label: 'Gitee', repoCount: 12, share: 9.4 },
      ],
    },
    categories: MOCK_CATEGORIES,
    languages: MOCK_LANGUAGES,
    starTrend: {
      available: true,
      period: {
        days: Math.min(365, Math.max(30, months * 30)),
        startDate: '2026-07-25',
        endDate: '2026-10-22',
        snapshotDays: 90,
      },
      summary: {
        trackedRepos: 60,
        totalStars: 286400,
        starGain: 36400,
        coverage: 46.9,
      },
      series: buildMockStarSeries(),
      topMovers: MOCK_MOVERS,
      languages: [
        { language: 'Python', repoCount: 18, starGain: 12800, share: 35.2, topRepo: 'langchain' },
        { language: 'TypeScript', repoCount: 16, starGain: 9600, share: 26.4, topRepo: 'vscode' },
        { language: 'Go', repoCount: 12, starGain: 7400, share: 20.3, topRepo: 'ollama' },
      ],
    },
    insights: [
      {
        kind: 'growth',
        title: '近 30 天新增 13 个仓库',
        description: '较 30 天前存量增长 11.3%，近 7 天新增 4 个。',
      },
      {
        kind: 'category',
        title: '分类分布较均衡',
        description: '最大分类「AI 应用」占 32.8%；前三大分类为 AI 应用 32.8%、开发工具 21.9%、数据与分析 14.1%。',
      },
      {
        kind: 'star',
        title: 'Star 集中在头部 13 个仓库',
        description: 'Top 10% 仓库贡献了 62.4% 的 Star，头部效应明显。',
      },
      {
        kind: 'uncategorized',
        title: '未分类仓库占 7.8%',
        description: '10 个仓库还没有分类，分类覆盖率 92.2%。',
      },
      {
        kind: 'coverage',
        title: 'Star 历史覆盖 46.9%',
        description: '有 60 个收藏仓库进入过热榜快照；未覆盖的仓库只计入当前 Star 存量。',
      },
    ],
    generatedAt: '2026-10-22T10:00:00.000Z',
  }
}

export function fetchAssetReport(months: number): Promise<AssetReportResponse> {
  return fetchWithFallback(
    `/api/asset-report?months=${encodeURIComponent(String(months))}`,
    mockAssetReport(months)
  )
}
