import type { ArchiveFormat, ArchiveScope, ArchiveSummary } from './types'

export const SCOPE_OPTIONS: Array<{
  key: ArchiveScope
  label: string
  description: string
  bullets: string[]
}> = [
  {
    key: 'full',
    label: '完整归档',
    description: '账号资料、收藏、分类、标签、推荐、通知、报告与更新提醒。',
    bullets: ['适合长期备份', '可跨部署恢复', '不含令牌 / 会话'],
  },
  {
    key: 'knowledge',
    label: '知识库归档',
    description: '只导出账号资料、收藏仓库、分类与标签。',
    bullets: ['体积更小', '适合迁移知识库', '不含活动记录'],
  },
]

export const FORMAT_OPTIONS: Array<{
  key: ArchiveFormat
  label: string
  extension: string
  description: string
}> = [
  {
    key: 'zip',
    label: 'ZIP 归档包',
    extension: '.zip',
    description: 'manifest + data/*.json + README + sha256sum 校验文件',
  },
  {
    key: 'json',
    label: '单文件 JSON',
    extension: '.json',
    description: 'manifest、checksums 与 data 收在一个文件，便于程序处理',
  },
]

export function formatCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value >= 10000)
    return `${(value / 10000).toFixed(1).replace(/\.0$/, '')} 万`
  return value.toLocaleString('zh-CN')
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  const digits = unit === 0 ? 0 : size >= 10 ? 0 : 1
  return `${size.toFixed(digits)} ${units[unit]}`
}

export function scopeLabel(scope: ArchiveScope): string {
  return (
    SCOPE_OPTIONS.find((option) => option.key === scope)?.label ?? '完整归档'
  )
}

export function formatLabel(format: ArchiveFormat): string {
  return (
    FORMAT_OPTIONS.find((option) => option.key === format)?.label ??
    'ZIP 归档包'
  )
}

export function fallbackArchiveFileName(
  format: ArchiveFormat,
  generatedAt: string
): string {
  const date = generatedAt.slice(0, 10) || 'archive'
  return format === 'json'
    ? `openfactory-archive-${date}.json`
    : `openfactory-archive-${date}.zip`
}

/** 按范围过滤数据集；知识库范围只保留 knowledge=true 的数据集。 */
export function visibleDatasets(
  summary: ArchiveSummary,
  scope: ArchiveScope
): ArchiveSummary['datasets'] {
  if (scope === 'full') return summary.datasets
  return summary.datasets.filter((dataset) => dataset.knowledge)
}

/** 当前范围下的记录数（用于按钮文案与统计卡）。 */
export function scopedRecordCount(
  summary: ArchiveSummary,
  scope: ArchiveScope
): number {
  return visibleDatasets(summary, scope).reduce(
    (sum, dataset) => sum + dataset.records,
    0
  )
}
