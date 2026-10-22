import type {
  ActivityLevel,
  ProfileType,
  TechProfileLanguage,
  TechProfileMonthPoint,
} from './api'

export interface LanguageBar {
  name: string
  repoCount: number
  starCount: number
  share: number
  isOther: boolean
}

/** 语言榜最多保留 limit 项，其余合并为「其他」 */
export function foldLanguages(
  languages: readonly TechProfileLanguage[],
  limit = 8
): LanguageBar[] {
  const safeLimit = Math.max(2, limit)
  const rows: LanguageBar[] = languages.map((item) => ({
    name: item.name,
    repoCount: item.repoCount,
    starCount: item.starCount,
    share: item.share,
    isOther: false,
  }))
  if (rows.length <= safeLimit) return rows

  const head = rows.slice(0, safeLimit - 1)
  const tail = rows.slice(safeLimit - 1)
  head.push({
    name: '其他',
    repoCount: tail.reduce((sum, item) => sum + item.repoCount, 0),
    starCount: tail.reduce((sum, item) => sum + item.starCount, 0),
    share:
      Math.round(tail.reduce((sum, item) => sum + item.share, 0) * 10) / 10,
    isOther: true,
  })
  return head
}

/** 百分比展示：整数不带小数，其余保留一位 */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0%'
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`
}

/** Star 等大数字的紧凑展示（中文万 / 亿） */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return new Intl.NumberFormat('zh-CN', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

/** 月份键 → 图表轴标签：2026-09 → 9月 */
export function formatMonthLabel(month: string): string {
  const parts = month.split('-')
  const monthNumber = Number(parts[1])
  if (!Number.isFinite(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    return month
  }
  return `${monthNumber}月`
}

/** 月份键 → 完整标签：2026-09 → 2026年9月 */
export function formatMonthFull(month: string): string {
  const parts = month.split('-')
  const year = Number(parts[0])
  const monthNumber = Number(parts[1])
  if (!Number.isFinite(year) || !Number.isFinite(monthNumber)) return month
  return `${year}年${monthNumber}月`
}

/** 月度新增收藏的最大值，用于图表定标（至少 1，避免除零） */
export function maxMonthAdded(
  months: readonly TechProfileMonthPoint[]
): number {
  return Math.max(1, ...months.map((item) => item.added))
}

/** 活跃度等级中文文案 */
export function activityLevelText(level: ActivityLevel): string {
  if (level === 'high') return '活跃'
  if (level === 'medium') return '平稳'
  return '偏低'
}

/** 活跃度等级徽标样式 */
export function activityLevelClass(level: ActivityLevel): string {
  if (level === 'high') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  }
  if (level === 'medium') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  }
  return 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
}

/** 画像类型一句话解释 */
export function profileTypeHint(type: ProfileType): string {
  switch (type) {
    case '多语言探索者':
      return '语言覆盖广、单一语言占比低，适合继续保持技术广度。'
    case '单栈深耕者':
      return '主力语言占比高，适合在纵深方向沉淀代表作。'
    case '全栈实践者':
      return '框架覆盖广、分布均衡，适合补齐端到端项目。'
    default:
      return '语言与框架分布相对均衡，可结合兴趣选择深耕方向。'
  }
}

/** 时间展示：2026-10-21T08:00:00Z → 2026-10-21 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

/** 时间展示到分钟 */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', { hour12: false })
}

/** 健康度文案 */
export function healthStatusText(status: string | null): string {
  if (status === 'active') return '活跃'
  if (status === 'attention') return '需关注'
  if (status === 'stale') return '沉寂'
  if (status === 'archived') return '已归档'
  return status || '—'
}
