import { fetchWithFallback } from '@/lib/api'

export type ActivityLevel = 'high' | 'medium' | 'low'

export type ProfileType =
  '多语言探索者' | '单栈深耕者' | '全栈实践者' | '均衡开发者'

export type PushBucketKey =
  '7d' | '30d' | '90d' | '180d' | '365d' | 'older' | 'unknown'

export type TechProfileInsightKind =
  'language' | 'framework' | 'activity' | 'rhythm' | 'diversity' | 'empty'

export interface TechProfileSummary {
  totalRepos: number
  totalStars: number
  totalForks: number
  languageCount: number
  frameworkCount: number
  categoryCount: number
  withLanguage: number
  withFramework: number
  activeRepos: number
  staleRepos: number
  archivedRepos: number
  activeRatio: number
  activityScore: number
  activityLevel: ActivityLevel
  profileType: ProfileType
  topLanguage: string | null
  topFramework: string | null
}

export interface TechProfileLanguage {
  name: string
  repoCount: number
  starCount: number
  share: number
  avgStars: number
}

export interface TechProfileFramework {
  name: string
  category: string
  repoCount: number
  starCount: number
  share: number
  languages: string[]
}

export interface TechProfileCategory {
  name: string
  repoCount: number
  share: number
}

export interface TechProfileMonthPoint {
  month: string
  added: number
  cumulative: number
}

export interface TechProfilePushBucket {
  key: PushBucketKey
  label: string
  repoCount: number
  share: number
}

export interface TechProfileTopRepo {
  id: string
  name: string
  url: string
  language: string | null
  stars: number
  forks: number
  pushedAt: string | null
  healthStatus: string | null
}

export interface TechProfileInsight {
  kind: TechProfileInsightKind
  title: string
  description: string
}

export interface TechProfileResponse {
  summary: TechProfileSummary
  languages: TechProfileLanguage[]
  frameworks: TechProfileFramework[]
  categories: TechProfileCategory[]
  activity: {
    periodMonths: number
    months: TechProfileMonthPoint[]
    recent: {
      last7d: number
      last30d: number
      last90d: number
      last365d: number
    }
    pushBuckets: TechProfilePushBucket[]
    activeRatio: number
    peakMonth: { month: string; added: number } | null
    streakMonths: number
    firstCollectedAt: string | null
    latestCollectedAt: string | null
  }
  topRepos: TechProfileTopRepo[]
  insights: TechProfileInsight[]
  generatedAt: string
}

const MOCK_MONTHS: TechProfileMonthPoint[] = [
  { month: '2025-11', added: 1, cumulative: 1 },
  { month: '2025-12', added: 2, cumulative: 3 },
  { month: '2026-01', added: 1, cumulative: 4 },
  { month: '2026-02', added: 2, cumulative: 6 },
  { month: '2026-03', added: 3, cumulative: 9 },
  { month: '2026-04', added: 1, cumulative: 10 },
  { month: '2026-05', added: 2, cumulative: 12 },
  { month: '2026-06', added: 3, cumulative: 15 },
  { month: '2026-07', added: 2, cumulative: 17 },
  { month: '2026-08', added: 1, cumulative: 18 },
  { month: '2026-09', added: 3, cumulative: 21 },
  { month: '2026-10', added: 3, cumulative: 24 },
]

export const MOCK_TECH_PROFILE: TechProfileResponse = {
  summary: {
    totalRepos: 24,
    totalStars: 328400,
    totalForks: 41200,
    languageCount: 7,
    frameworkCount: 12,
    categoryCount: 5,
    withLanguage: 23,
    withFramework: 18,
    activeRepos: 15,
    staleRepos: 4,
    archivedRepos: 1,
    activeRatio: 68.2,
    activityScore: 74,
    activityLevel: 'high',
    profileType: '全栈实践者',
    topLanguage: 'TypeScript',
    topFramework: 'React',
  },
  languages: [
    {
      name: 'TypeScript',
      repoCount: 9,
      starCount: 182400,
      share: 37.5,
      avgStars: 20266.7,
    },
    {
      name: 'Python',
      repoCount: 6,
      starCount: 96500,
      share: 25,
      avgStars: 16083.3,
    },
    {
      name: 'Go',
      repoCount: 3,
      starCount: 28600,
      share: 12.5,
      avgStars: 9533.3,
    },
    {
      name: 'Rust',
      repoCount: 2,
      starCount: 12400,
      share: 8.3,
      avgStars: 6200,
    },
    {
      name: 'JavaScript',
      repoCount: 2,
      starCount: 5300,
      share: 8.3,
      avgStars: 2650,
    },
    {
      name: 'Shell',
      repoCount: 1,
      starCount: 2100,
      share: 4.2,
      avgStars: 2100,
    },
    { name: 'Java', repoCount: 1, starCount: 1100, share: 4.2, avgStars: 1100 },
  ],
  frameworks: [
    {
      name: 'React',
      category: '前端',
      repoCount: 6,
      starCount: 132000,
      share: 25,
      languages: ['TypeScript', 'JavaScript'],
    },
    {
      name: 'FastAPI',
      category: '后端',
      repoCount: 4,
      starCount: 88400,
      share: 16.7,
      languages: ['Python'],
    },
    {
      name: 'PostgreSQL',
      category: '数据库',
      repoCount: 4,
      starCount: 76200,
      share: 16.7,
      languages: ['Python', 'Go', 'TypeScript'],
    },
    {
      name: 'Docker',
      category: 'DevOps',
      repoCount: 4,
      starCount: 61300,
      share: 16.7,
      languages: ['Python', 'Go', 'Rust'],
    },
    {
      name: 'Next.js',
      category: '前端',
      repoCount: 3,
      starCount: 69400,
      share: 12.5,
      languages: ['TypeScript', 'JavaScript'],
    },
    {
      name: 'Tailwind CSS',
      category: '前端',
      repoCount: 3,
      starCount: 52600,
      share: 12.5,
      languages: ['TypeScript'],
    },
    {
      name: 'Redis',
      category: '数据库',
      repoCount: 2,
      starCount: 31800,
      share: 8.3,
      languages: ['Python', 'Go'],
    },
    {
      name: 'PyTorch',
      category: 'AI/数据',
      repoCount: 2,
      starCount: 27600,
      share: 8.3,
      languages: ['Python'],
    },
    {
      name: 'Vite',
      category: '工具链',
      repoCount: 2,
      starCount: 22100,
      share: 8.3,
      languages: ['TypeScript'],
    },
    {
      name: 'Kubernetes',
      category: 'DevOps',
      repoCount: 2,
      starCount: 19400,
      share: 8.3,
      languages: ['Go'],
    },
    {
      name: 'SQLAlchemy',
      category: '工具链',
      repoCount: 2,
      starCount: 14300,
      share: 8.3,
      languages: ['Python'],
    },
    {
      name: 'Playwright',
      category: '测试',
      repoCount: 1,
      starCount: 8600,
      share: 4.2,
      languages: ['TypeScript'],
    },
  ],
  categories: [
    { name: '前端', repoCount: 7, share: 29.2 },
    { name: '后端', repoCount: 6, share: 25 },
    { name: 'AI/数据', repoCount: 5, share: 20.8 },
    { name: 'DevOps', repoCount: 3, share: 12.5 },
    { name: '工具链', repoCount: 2, share: 8.3 },
    { name: '未分类', repoCount: 1, share: 4.2 },
  ],
  activity: {
    periodMonths: 12,
    months: MOCK_MONTHS,
    recent: { last7d: 1, last30d: 3, last90d: 7, last365d: 24 },
    pushBuckets: [
      { key: '7d', label: '7 天内', repoCount: 8, share: 33.3 },
      { key: '30d', label: '30 天内', repoCount: 5, share: 20.8 },
      { key: '90d', label: '90 天内', repoCount: 2, share: 8.3 },
      { key: '180d', label: '180 天内', repoCount: 2, share: 8.3 },
      { key: '365d', label: '一年内', repoCount: 3, share: 12.5 },
      { key: 'older', label: '一年以上', repoCount: 3, share: 12.5 },
      { key: 'unknown', label: '未知', repoCount: 1, share: 4.2 },
    ],
    activeRatio: 68.2,
    peakMonth: { month: '2026-09', added: 3 },
    streakMonths: 5,
    firstCollectedAt: '2025-11-05T08:00:00.000Z',
    latestCollectedAt: '2026-10-18T08:00:00.000Z',
  },
  topRepos: [
    {
      id: 'vercel/next.js',
      name: 'next.js',
      url: 'https://github.com/vercel/next.js',
      language: 'TypeScript',
      stars: 128000,
      forks: 27400,
      pushedAt: '2026-10-21T08:00:00.000Z',
      healthStatus: 'active',
    },
    {
      id: 'fastapi/fastapi',
      name: 'fastapi',
      url: 'https://github.com/fastapi/fastapi',
      language: 'Python',
      stars: 86000,
      forks: 7400,
      pushedAt: '2026-10-20T08:00:00.000Z',
      healthStatus: 'active',
    },
    {
      id: 'facebook/react',
      name: 'react',
      url: 'https://github.com/facebook/react',
      language: 'JavaScript',
      stars: 52000,
      forks: 9800,
      pushedAt: '2026-10-19T08:00:00.000Z',
      healthStatus: 'active',
    },
    {
      id: 'gin-gonic/gin',
      name: 'gin',
      url: 'https://github.com/gin-gonic/gin',
      language: 'Go',
      stars: 28600,
      forks: 3200,
      pushedAt: '2026-09-28T08:00:00.000Z',
      healthStatus: 'active',
    },
    {
      id: 'tokio-rs/tokio',
      name: 'tokio',
      url: 'https://github.com/tokio-rs/tokio',
      language: 'Rust',
      stars: 12400,
      forks: 1200,
      pushedAt: '2026-07-01T08:00:00.000Z',
      healthStatus: 'attention',
    },
  ],
  insights: [
    {
      kind: 'language',
      title: '主力语言：TypeScript',
      description:
        '9 个仓库（37.5%）使用 TypeScript，前三语言为 TypeScript 9 / Python 6 / Go 3。',
    },
    {
      kind: 'framework',
      title: '常用框架：React',
      description: '6 个仓库使用 React（前端），框架识别覆盖率 75%。',
    },
    {
      kind: 'activity',
      title: '收藏与维护节奏活跃',
      description:
        '近 90 天有推送的仓库占 68.2%，近 90 天新增收藏 7 个，活跃度分 74。',
    },
    {
      kind: 'rhythm',
      title: '收藏高峰：2026-09',
      description: '该月新增 3 个收藏，已连续 5 个月保持新增。',
    },
    {
      kind: 'diversity',
      title: '画像类型：全栈实践者',
      description: '共覆盖 7 种语言、12 个框架、5 个分类分组。',
    },
  ],
  generatedAt: '2026-10-22T10:00:00.000Z',
}

export function fetchTechProfile(months = 12): Promise<TechProfileResponse> {
  return fetchWithFallback<TechProfileResponse>(
    `/api/tech-profile?months=${months}`,
    MOCK_TECH_PROFILE
  )
}
