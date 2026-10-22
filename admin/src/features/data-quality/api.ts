import { apiFetch } from '@/lib/api'
import type {
  QualityFixResponse,
  QualityIssue,
  QualityScanResponse,
  QualityView,
  StatusFilter,
  TypeFilter,
} from './utils'

export type {
  QualityFixResponse,
  QualityIssue,
  QualityIssueStatus,
  QualityIssueType,
  QualityScanInfo,
  QualityScanMode,
  QualityScanResponse,
  QualitySeverity,
  QualitySummary,
  QualityView,
  StatusFilter,
  TypeFilter,
} from './utils'

const MOCK_ISSUES: QualityIssue[] = [
  {
    id: 'dq_demo_001',
    repoId: 'demo/tenant-admin',
    repoName: 'demo/tenant-admin',
    repoUrl: 'https://github.com/demo/tenant-admin',
    type: 'broken_link',
    severity: 'critical',
    field: 'html_url',
    title: '仓库链接已失效',
    detail: 'https://github.com/demo/tenant-admin 返回 HTTP 404，仓库可能已删除或转为私有。',
    suggestion: '建议归档或移除该收藏；如需保留请手动更新链接。',
    status: 'open',
    detectedAt: '2026-10-22T09:30:00Z',
    resolvedAt: null,
  },
  {
    id: 'dq_demo_002',
    repoId: 'demo/saas_starter',
    repoName: 'demo/saas_starter',
    repoUrl: 'https://github.com/demo/saas_starter',
    type: 'duplicate',
    severity: 'warning',
    field: null,
    title: '疑似与 demo/saas-starter 重复',
    detail: '仓库名称相似度 93%；项目简介相似度 78%。',
    suggestion: '在「重复检测」页确认合并或忽略；本页不会自动删除仓库。',
    status: 'open',
    detectedAt: '2026-10-22T09:30:00Z',
    resolvedAt: null,
  },
  {
    id: 'dq_demo_003',
    repoId: 'demo/edge-cache',
    repoName: 'demo/edge-cache',
    repoUrl: 'https://github.com/demo/edge-cache',
    type: 'missing_metadata',
    severity: 'warning',
    field: 'description',
    title: '缺少项目简介',
    detail: '仓库简介与 README 摘要都为空，列表和推荐理由里无法展示项目定位。',
    suggestion: '点击「补全元数据」从 GitHub 拉取简介，或先用 README 摘要回填。',
    status: 'open',
    detectedAt: '2026-10-22T09:30:00Z',
    resolvedAt: null,
  },
  {
    id: 'dq_demo_004',
    repoId: 'demo/edge-cache',
    repoName: 'demo/edge-cache',
    repoUrl: 'https://github.com/demo/edge-cache',
    type: 'missing_metadata',
    severity: 'info',
    field: 'language',
    title: '缺少开发语言',
    detail: '语言为空，技术栈图谱与语言筛选无法归类这个仓库。',
    suggestion: '点击「补全元数据」从 GitHub 同步语言字段。',
    status: 'open',
    detectedAt: '2026-10-22T09:30:00Z',
    resolvedAt: null,
  },
  {
    id: 'dq_demo_005',
    repoId: 'demo/workers-cache',
    repoName: 'demo/workers-cache',
    repoUrl: 'https://github.com/demo/workers-cache',
    type: 'stale_metadata',
    severity: 'warning',
    field: 'synced_at',
    title: '元数据超过 90 天未更新',
    detail: '最近一次同步在 132 天前，Star / 简介 / 语言可能已经变化。',
    suggestion: '点击「补全元数据」重新拉取 GitHub 详情。',
    status: 'open',
    detectedAt: '2026-10-22T09:30:00Z',
    resolvedAt: null,
  },
  {
    id: 'dq_demo_006',
    repoId: 'demo/awesome-tool',
    repoName: 'demo/awesome-tool',
    repoUrl: 'https://github.com/demo/awesome-tool',
    type: 'missing_metadata',
    severity: 'info',
    field: 'category',
    title: '尚未分类',
    detail: '仓库没有归入任何分类，资产报表的分类分布会不完整。',
    suggestion: '在仓库详情或分类页手动归类（自动分类建议见「分类建议」页）。',
    status: 'ignored',
    detectedAt: '2026-10-20T08:00:00Z',
    resolvedAt: null,
  },
]

export const MOCK_DATA_QUALITY: QualityView = {
  summary: {
    score: 78,
    open: 5,
    critical: 1,
    warning: 3,
    info: 1,
    fixed: 4,
    ignored: 1,
    byType: {
      duplicate: 1,
      broken_link: 1,
      missing_metadata: 2,
      stale_metadata: 1,
    },
    lastScanAt: '2026-10-22T09:30:00Z',
    scanned: 128,
  },
  issues: MOCK_ISSUES,
  latestScan: {
    id: 'dq_demo_scan',
    mode: 'hybrid',
    scanned: 128,
    issueCount: 6,
    score: 78,
    createdAt: '2026-10-22T09:30:00Z',
  },
  history: [
    {
      id: 'dq_demo_scan',
      mode: 'hybrid',
      scanned: 128,
      issueCount: 6,
      score: 78,
      createdAt: '2026-10-22T09:30:00Z',
    },
    {
      id: 'dq_demo_scan_prev',
      mode: 'local',
      scanned: 120,
      issueCount: 9,
      score: 71,
      createdAt: '2026-10-15T09:00:00Z',
    },
  ],
}

export interface QualityQuery {
  status?: StatusFilter
  type?: TypeFilter
  limit?: number
}

/** 质量总览 + 问题台账；接口不可用时回退演示数据。 */
export async function fetchDataQuality(
  query: QualityQuery = {}
): Promise<QualityView> {
  const params = new URLSearchParams()
  if (query.status) params.set('status', query.status)
  if (query.type) params.set('type', query.type)
  if (query.limit) params.set('limit', String(query.limit))
  const suffix = params.toString() ? `?${params.toString()}` : ''
  try {
    return await apiFetch<QualityView>(`/api/data-quality${suffix}`)
  } catch {
    // eslint-disable-next-line no-console
    console.info('[opensource-factory] 数据质量接口不可用，使用演示数据')
    return MOCK_DATA_QUALITY
  }
}

/** 执行质量扫描；演示模式返回本地降级结果。 */
export async function scanDataQuality(input: {
  checkLinks?: boolean
  maxRepos?: number
} = {}): Promise<QualityScanResponse> {
  try {
    return await apiFetch<QualityScanResponse>('/api/data-quality/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        checkLinks: input.checkLinks !== false,
        ...(input.maxRepos === undefined ? {} : { maxRepos: input.maxRepos }),
      }),
    })
  } catch {
    // eslint-disable-next-line no-console
    console.info('[opensource-factory] 扫描接口不可用，使用演示数据')
    return {
      ...MOCK_DATA_QUALITY,
      scanId: 'dq_demo_scan_local',
      mode: 'local',
      scanned: MOCK_DATA_QUALITY.summary.scanned,
      linkCheck: 'skipped',
      checkedLinks: 0,
      tookMs: 12,
    }
  }
}

/** 补全元数据；接口不可用时按 README 摘要本地演示回填。 */
export async function fixDataQuality(input: {
  repoIds?: string[]
  fields?: string[]
}): Promise<QualityFixResponse> {
  try {
    return await apiFetch<QualityFixResponse>('/api/data-quality/fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(input.repoIds === undefined ? {} : { repoIds: input.repoIds }),
        ...(input.fields === undefined ? {} : { fields: input.fields }),
      }),
    })
  } catch {
    // eslint-disable-next-line no-console
    console.info('[opensource-factory] 补全接口不可用，演示模式本地生效')
    const requested = input.repoIds?.length ?? 1
    return {
      status: 'local',
      requested,
      updated: requested,
      skipped: 0,
      remaining: 0,
      items: (input.repoIds ?? ['demo/edge-cache']).map((repoId) => ({
        repoId,
        updatedFields: input.fields ?? ['description'],
        source: 'local' as const,
      })),
    }
  }
}

/** 批量忽略问题。 */
export async function ignoreQualityIssues(
  issueIds: string[]
): Promise<{ updated: number; status: 'ignored' }> {
  try {
    return await apiFetch<{ updated: number; status: 'ignored' }>(
      '/api/data-quality/issues/ignore',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueIds }),
      }
    )
  } catch {
    return { updated: issueIds.length, status: 'ignored' }
  }
}

/** 批量恢复问题。 */
export async function restoreQualityIssues(
  issueIds: string[]
): Promise<{ updated: number; status: 'open' }> {
  try {
    return await apiFetch<{ updated: number; status: 'open' }>(
      '/api/data-quality/issues/restore',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueIds }),
      }
    )
  } catch {
    return { updated: issueIds.length, status: 'open' }
  }
}
