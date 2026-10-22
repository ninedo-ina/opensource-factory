/** 数据质量治理的前端 DTO 与纯函数（M9-05 / REQ-202610-0982）。 */

export type QualityIssueType =
  | 'duplicate'
  | 'broken_link'
  | 'missing_metadata'
  | 'stale_metadata'
export type QualitySeverity = 'critical' | 'warning' | 'info'
export type QualityIssueStatus = 'open' | 'ignored' | 'fixed'
export type QualityScanMode = 'local' | 'hybrid'

export interface QualityIssue {
  id: string
  repoId: string
  repoName: string
  repoUrl: string
  type: QualityIssueType
  severity: QualitySeverity
  field: string | null
  title: string
  detail: string
  suggestion: string
  status: QualityIssueStatus
  detectedAt: string
  resolvedAt: string | null
}

export interface QualitySummary {
  score: number
  open: number
  critical: number
  warning: number
  info: number
  fixed: number
  ignored: number
  byType: Record<QualityIssueType, number>
  lastScanAt: string | null
  scanned: number
}

export interface QualityScanInfo {
  id: string
  mode: QualityScanMode
  scanned: number
  issueCount: number
  score: number
  createdAt: string
}

export interface QualityView {
  summary: QualitySummary
  issues: QualityIssue[]
  latestScan: QualityScanInfo | null
  history: QualityScanInfo[]
}

export interface QualityScanResponse extends QualityView {
  scanId: string
  mode: QualityScanMode
  scanned: number
  linkCheck: 'ok' | 'skipped' | 'failed'
  checkedLinks: number
  tookMs: number
}

export interface QualityFixResponse {
  status: 'vps' | 'local' | 'noop'
  requested: number
  updated: number
  skipped: number
  remaining: number
  items: Array<{
    repoId: string
    updatedFields: string[]
    source: 'vps' | 'local'
    note?: string
  }>
}

export type StatusFilter = 'open' | 'ignored' | 'fixed' | 'all'
export type TypeFilter = QualityIssueType | 'all'

export function typeLabel(type: QualityIssueType): string {
  switch (type) {
    case 'duplicate':
      return '重复条目'
    case 'broken_link':
      return '失效链接'
    case 'missing_metadata':
      return '元数据缺失'
    case 'stale_metadata':
      return '元数据陈旧'
  }
}

export function severityLabel(severity: QualitySeverity): string {
  if (severity === 'critical') return '严重'
  if (severity === 'warning') return '警告'
  return '提示'
}

export function statusLabel(status: QualityIssueStatus): string {
  if (status === 'ignored') return '已忽略'
  if (status === 'fixed') return '已修复'
  return '待处理'
}

export function modeLabel(mode: QualityScanMode): string {
  return mode === 'hybrid' ? 'VPS + 本地' : '本地规则'
}

export function linkCheckLabel(value: QualityScanResponse['linkCheck']): string {
  if (value === 'ok') return '链接已检测'
  if (value === 'failed') return '链接检测降级'
  return '未检测链接'
}

/** 质量分档位：90+ 优秀 / 75+ 良好 / 60+ 需关注 / 其余较差。 */
export function scoreGrade(score: number): 'excellent' | 'good' | 'attention' | 'poor' {
  if (score >= 90) return 'excellent'
  if (score >= 75) return 'good'
  if (score >= 60) return 'attention'
  return 'poor'
}

export function scoreLabel(score: number): string {
  switch (scoreGrade(score)) {
    case 'excellent':
      return '优秀'
    case 'good':
      return '良好'
    case 'attention':
      return '需关注'
    default:
      return '较差'
  }
}

export function scoreTone(score: number): string {
  switch (scoreGrade(score)) {
    case 'excellent':
      return 'text-emerald-600 dark:text-emerald-400'
    case 'good':
      return 'text-sky-600 dark:text-sky-400'
    case 'attention':
      return 'text-amber-600 dark:text-amber-400'
    default:
      return 'text-destructive'
  }
}

export function fieldLabel(field: string | null): string {
  switch (field) {
    case 'description':
      return '项目简介'
    case 'language':
      return '开发语言'
    case 'license':
      return 'License'
    case 'summary':
      return 'README 摘要'
    case 'category':
      return '分类'
    case 'html_url':
      return '仓库地址'
    case 'synced_at':
      return '同步时间'
    default:
      return '元数据'
  }
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = Date.parse(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
  if (!Number.isFinite(parsed)) return value
  return new Date(parsed).toLocaleString('zh-CN', { hour12: false })
}

export function summaryText(summary: QualitySummary): string {
  return `待处理 ${summary.open} 个问题：严重 ${summary.critical} · 警告 ${summary.warning} · 提示 ${summary.info}`
}

/** 问题是否可以直接点「补全元数据」修复。 */
export function isFixable(issue: QualityIssue): boolean {
  if (issue.status !== 'open') return false
  if (!issue.field) return false
  return ['description', 'language', 'license', 'html_url', 'synced_at'].includes(issue.field)
}

/** 按状态 / 类型过滤问题（纯函数，页面与测试共用）。 */
export function filterIssues(
  issues: QualityIssue[],
  status: StatusFilter,
  type: TypeFilter
): QualityIssue[] {
  return issues.filter((issue) => {
    if (status !== 'all' && issue.status !== status) return false
    if (type !== 'all' && issue.type !== type) return false
    return true
  })
}

/** 问题分布总览：只保留数量大于 0 的类型。 */
export function issueTypeCounts(
  byType: Record<QualityIssueType, number>
): Array<{ type: QualityIssueType; count: number }> {
  return (Object.keys(byType) as QualityIssueType[])
    .map((type) => ({ type, count: byType[type] }))
    .filter((item) => item.count > 0)
}
