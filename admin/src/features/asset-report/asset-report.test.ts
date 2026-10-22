import { describe, expect, it } from 'vitest'
import { mockAssetReport } from './api'
import {
  buildAssetCsv,
  buildBarLayout,
  dateLabel,
  formatCompactNumber,
  formatGrowthRate,
  formatNumber,
  formatPercent,
  formatSignedNumber,
  monthLabel,
  normalizeMonths,
} from './utils'

describe('format helpers', () => {
  it('formats integers with thousands separators', () => {
    expect(formatNumber(1234)).toBe('1,234')
    expect(formatNumber(0)).toBe('0')
    expect(formatNumber(Number.NaN)).toBe('0')
  })

  it('formats signed numbers and growth rates', () => {
    expect(formatSignedNumber(1234)).toBe('+1,234')
    expect(formatSignedNumber(-56)).toBe('-56')
    expect(formatSignedNumber(0)).toBe('0')
    expect(formatGrowthRate(11.34)).toBe('+11.3%')
    expect(formatGrowthRate(-1)).toBe('-1.0%')
    expect(formatGrowthRate(0)).toBe('0%')
  })

  it('formats percentages and compact numbers', () => {
    expect(formatPercent(25)).toBe('25%')
    expect(formatPercent(33.3)).toBe('33.3%')
    expect(formatPercent(Number.NaN)).toBe('0%')
    expect(formatCompactNumber(286400)).toContain('万')
    expect(formatCompactNumber(Number.NaN)).toBe('0')
  })

  it('formats month and date labels', () => {
    expect(monthLabel('2026-10')).toBe('2026/10')
    expect(dateLabel('2026-10-22')).toBe('10/22')
    expect(dateLabel('bad')).toBe('bad')
  })

  it('only accepts 6 / 12 / 24 month windows', () => {
    expect(normalizeMonths(6)).toBe(6)
    expect(normalizeMonths(24)).toBe(24)
    expect(normalizeMonths(9)).toBe(12)
    expect(normalizeMonths(0)).toBe(12)
  })
})

describe('buildBarLayout', () => {
  it('lays bars out inside the padded box and scales by max', () => {
    const bars = buildBarLayout([1, 2], 100, 100, {
      top: 10,
      right: 10,
      bottom: 10,
      left: 10,
    })
    expect(bars).toHaveLength(2)
    const [first, second] = bars
    expect(first?.height).toBeCloseTo(40)
    expect(second?.height).toBeCloseTo(80)
    expect(second?.y).toBeCloseTo(10)
    expect(first?.y).toBeCloseTo(50)
    expect(first?.x).toBeGreaterThanOrEqual(10)
    expect(second?.x).toBeLessThanOrEqual(90)
  })

  it('returns an empty layout for an empty series', () => {
    expect(buildBarLayout([])).toEqual([])
  })

  it('clamps negative values to zero height', () => {
    const bars = buildBarLayout([-3, 5])
    expect(bars[0]?.height).toBe(0)
    expect(bars[1]?.height).toBeGreaterThan(0)
  })
})

describe('mockAssetReport', () => {
  it('builds the requested window with a stable ending total', () => {
    const six = mockAssetReport(6)
    expect(six.period.months).toBe(6)
    expect(six.volume.months).toHaveLength(6)
    expect(six.volume.months[six.volume.months.length - 1]?.cumulative).toBe(
      six.summary.totalRepos
    )

    const twelve = mockAssetReport(12)
    expect(twelve.volume.months).toHaveLength(12)
    expect(
      twelve.volume.months[twelve.volume.months.length - 1]?.cumulative
    ).toBe(128)
  })

  it('keeps category shares consistent with total repos', () => {
    const data = mockAssetReport(12)
    const repoSum = data.categories.reduce((sum, item) => sum + item.repoCount, 0)
    expect(repoSum).toBe(data.summary.totalRepos)
    const shareSum = data.categories.reduce((sum, item) => sum + item.share, 0)
    expect(shareSum).toBeCloseTo(100, 0)
  })

  it('sorts top movers by gain and exposes insights', () => {
    const data = mockAssetReport(12)
    const gains = data.starTrend.topMovers.map((item) => item.gain)
    expect(gains).toEqual([...gains].sort((a, b) => b - a))
    expect(data.insights.length).toBeGreaterThan(0)
    expect(data.starTrend.available).toBe(true)
  })
})

describe('buildAssetCsv', () => {
  it('exports volume and category sections with a header row', () => {
    const csv = buildAssetCsv(mockAssetReport(6))
    const lines = csv.split('\n')
    expect(lines[0]).toContain('资产报表')
    expect(csv).toContain('收录量')
    expect(csv).toContain('月份,新增,累计,新增Star,累计Star')
    expect(csv).toContain('分类分布')
    expect(csv).toContain('分类,仓库数,占比(%),Star,平均Star,主要语言')
    expect(csv).toContain('AI 应用')
    expect(csv).toContain('未分类')
    const monthRows = lines.filter((line) => /^\d{4}-\d{2},/.test(line))
    expect(monthRows).toHaveLength(6)
  })

  it('quotes cells containing commas', () => {
    const data = mockAssetReport(6)
    data.categories = [
      {
        id: null,
        name: '工具, 脚本',
        repoCount: 1,
        starCount: 10,
        share: 100,
        avgStars: 10,
        topLanguage: null,
      },
    ]
    const csv = buildAssetCsv(data)
    expect(csv).toContain('"工具, 脚本"')
  })
})
