import type { AssetReportResponse } from './api'

export interface ChartPoint {
  x: number
  y: number
}

export interface BarLayout {
  x: number
  y: number
  width: number
  height: number
}

/** 千分位整数 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(
    Math.round(value)
  )
}

/** 大数字紧凑展示（中文万 / 亿） */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return new Intl.NumberFormat('zh-CN', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

/** 百分比展示：整数不带小数，其余保留一位 */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0%'
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`
}

/** 带符号整数：+1,234 / -56 */
export function formatSignedNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const formatted = formatNumber(Math.abs(value))
  if (value > 0) return `+${formatted}`
  if (value < 0) return `-${formatted}`
  return '0'
}

/** 增长率：+5.2% / -1.0% / 0% */
export function formatGrowthRate(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0%'
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
}

/** 2026-10 → 2026/10 */
export function monthLabel(value: string): string {
  return value.replace('-', '/')
}

/** 2026-10-22 → 10/22 */
export function dateLabel(value: string): string {
  const parts = value.split('-')
  if (parts.length !== 3) return value
  return `${Number(parts[1])}/${Number(parts[2])}`
}

/** 报表窗口只允许 6 / 12 / 24 个月 */
export function normalizeMonths(value: number): number {
  return [6, 12, 24].includes(value) ? value : 12
}

/** 把数值序列映射到 SVG 坐标；全等序列居中显示 */
export function buildPolylinePoints(
  values: readonly number[],
  width = 800,
  height = 240,
  padding = 16
): ChartPoint[] {
  if (values.length === 0) return []
  const safe = values.map((value) => (Number.isFinite(value) ? value : 0))
  const min = Math.min(...safe)
  const max = Math.max(...safe)
  const span = max - min
  const innerWidth = Math.max(1, width - padding * 2)
  const innerHeight = Math.max(1, height - padding * 2)
  const step = safe.length > 1 ? innerWidth / (safe.length - 1) : 0

  return safe.map((value, index) => ({
    x: padding + step * index,
    y:
      span === 0
        ? height / 2
        : height - padding - ((value - min) / span) * innerHeight,
  }))
}

export function buildLinePath(points: readonly ChartPoint[]): string {
  if (points.length === 0) return ''
  return points
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
    )
    .join(' ')
}

export function buildAreaPath(
  points: readonly ChartPoint[],
  height = 240,
  padding = 16
): string {
  if (points.length === 0) return ''
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) return ''
  const baseline = height - padding
  return `${buildLinePath(points)} L ${last.x.toFixed(2)} ${baseline} L ${first.x.toFixed(2)} ${baseline} Z`
}

/** 柱状图布局：按最大值归一，底部对齐 */
export function buildBarLayout(
  values: readonly number[],
  width = 800,
  height = 240,
  padding = { top: 16, right: 16, bottom: 28, left: 36 }
): BarLayout[] {
  if (values.length === 0) return []
  const max = Math.max(1, ...values.map((value) => (Number.isFinite(value) ? value : 0)))
  const innerWidth = Math.max(1, width - padding.left - padding.right)
  const innerHeight = Math.max(1, height - padding.top - padding.bottom)
  const slot = innerWidth / values.length
  const barWidth = Math.max(2, slot * 0.55)
  return values.map((value, index) => {
    const safe = Number.isFinite(value) ? Math.max(0, value) : 0
    const barHeight = (safe / max) * innerHeight
    return {
      x: padding.left + slot * index + (slot - barWidth) / 2,
      y: padding.top + innerHeight - barHeight,
      width: barWidth,
      height: barHeight,
    }
  })
}

function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** 生成资产报表 CSV（收录量 + 分类分布） */
export function buildAssetCsv(report: AssetReportResponse): string {
  const lines: string[] = []
  lines.push(`资产报表,${report.period.startDate} ~ ${report.period.endDate}`)
  lines.push('')
  lines.push('收录量')
  lines.push('月份,新增,累计,新增Star,累计Star')
  for (const month of report.volume.months) {
    lines.push(
      [
        csvCell(month.month),
        csvCell(month.added),
        csvCell(month.cumulative),
        csvCell(month.starsAdded),
        csvCell(month.cumulativeStars),
      ].join(',')
    )
  }
  lines.push('')
  lines.push('分类分布')
  lines.push('分类,仓库数,占比(%),Star,平均Star,主要语言')
  for (const category of report.categories) {
    lines.push(
      [
        csvCell(category.name),
        csvCell(category.repoCount),
        csvCell(category.share),
        csvCell(category.starCount),
        csvCell(category.avgStars),
        csvCell(category.topLanguage),
      ].join(',')
    )
  }
  return lines.join('\n')
}

/** 浏览器端下载文本文件 */
export function downloadTextFile(
  filename: string,
  content: string,
  mime = 'text/csv;charset=utf-8'
): void {
  const blob = new Blob([`\uFEFF${content}`], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
