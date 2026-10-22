/** 主题聚类页的纯函数辅助：排序、覆盖率、阈值与展示文案。 */
import type {
  ThemeCluster,
  ThemeMode,
  ThemeStats,
  ThemeUnclustered,
} from './api'

export const DEFAULT_MIN_SIMILARITY = 0.55
export const DEFAULT_MIN_CLUSTER_SIZE = 2
export const MIN_SIMILARITY_LIMIT = 0.3
export const MAX_SIMILARITY_LIMIT = 0.95

/** 主题排序：仓库多的在前，其次凝聚度、名称。 */
export function sortThemes(themes: ThemeCluster[]): ThemeCluster[] {
  return [...themes].sort((left, right) => {
    if (right.repoCount !== left.repoCount) return right.repoCount - left.repoCount
    if (right.cohesion !== left.cohesion) return right.cohesion - left.cohesion
    return left.name.localeCompare(right.name, 'zh-Hans-CN')
  })
}

/** 覆盖率展示：75 → 75%，77.8 → 77.8%。 */
export function formatCoverage(stats: ThemeStats): string {
  const value = Number.isFinite(stats.coverage) ? Math.max(0, stats.coverage) : 0
  return `${Math.round(value * 10) / 10}%`
}

/** 凝聚度展示：0.8412 → 84%。 */
export function formatCohesion(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`
}

/** 聚类模式文案。 */
export function modeLabel(mode: ThemeMode): string {
  if (mode === 'vector') return '向量聚类'
  if (mode === 'keyword') return '本地语言兜底'
  return '暂无仓库'
}

/** 未聚类原因文案。 */
export function unclusteredLabel(reason: ThemeUnclustered['reason']): string {
  if (reason === 'no_vector') return '尚未向量化'
  if (reason === 'dim_mismatch') return '向量维度不一致'
  if (reason === 'overflow') return '超出主题数上限'
  return '仓库太少，未成主题'
}

/** 相似度输入夹取到 0.30~0.95，保留两位小数。 */
export function clampSimilarity(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MIN_SIMILARITY
  return Math.round(
    Math.min(MAX_SIMILARITY_LIMIT, Math.max(MIN_SIMILARITY_LIMIT, value)) * 100
  ) / 100
}

/** 最小簇规模夹取到 1~20。 */
export function clampClusterSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MIN_CLUSTER_SIZE
  return Math.min(20, Math.max(1, Math.trunc(value)))
}

/** 汇总所有主题的建议标签（去重，保持首次出现顺序）。 */
export function collectSuggestedTags(themes: ThemeCluster[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const theme of sortThemes(themes)) {
    for (const tag of theme.suggestedTags) {
      const value = tag.trim()
      if (!value || seen.has(value)) continue
      seen.add(value)
      result.push(value)
    }
  }
  return result
}

/** 未聚类仓库按原因分组计数。 */
export function unclusteredSummary(
  items: ThemeUnclustered[]
): Array<{ reason: ThemeUnclustered['reason']; label: string; count: number }> {
  const counts = new Map<ThemeUnclustered['reason'], number>()
  for (const item of items) {
    counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, label: unclusteredLabel(reason), count }))
    .sort((left, right) => right.count - left.count)
}
