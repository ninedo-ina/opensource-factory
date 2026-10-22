import { describe, expect, it } from 'vitest'
import type { TechProfileLanguage, TechProfileMonthPoint } from './api'
import {
  activityLevelClass,
  activityLevelText,
  foldLanguages,
  formatCompactNumber,
  formatDate,
  formatMonthFull,
  formatMonthLabel,
  formatPercent,
  healthStatusText,
  maxMonthAdded,
  profileTypeHint,
} from './utils'

function language(name: string, repoCount: number): TechProfileLanguage {
  return {
    name,
    repoCount,
    starCount: repoCount * 100,
    share: repoCount,
    avgStars: 100,
  }
}

function point(month: string, added: number): TechProfileMonthPoint {
  return { month, added, cumulative: added }
}

describe('foldLanguages', () => {
  it('keeps every language when the list fits', () => {
    const rows = foldLanguages(
      [language('TypeScript', 3), language('Go', 1)],
      8
    )
    expect(rows.map((row) => row.name)).toEqual(['TypeScript', 'Go'])
    expect(rows.every((row) => !row.isOther)).toBe(true)
  })

  it('folds the tail into 其他 and sums counts', () => {
    const rows = foldLanguages(
      [
        language('A', 10),
        language('B', 8),
        language('C', 6),
        language('D', 4),
        language('E', 2),
      ],
      4
    )
    expect(rows).toHaveLength(4)
    expect(rows[rows.length - 1]).toMatchObject({
      name: '其他',
      repoCount: 6,
      starCount: 600,
      isOther: true,
    })
  })
})

describe('format helpers', () => {
  it('formats percentages with at most one decimal', () => {
    expect(formatPercent(25)).toBe('25%')
    expect(formatPercent(33.3)).toBe('33.3%')
    expect(formatPercent(Number.NaN)).toBe('0%')
  })

  it('formats large numbers compactly in Chinese', () => {
    expect(formatCompactNumber(624900)).toContain('万')
    expect(formatCompactNumber(0)).toBe('0')
  })

  it('formats month labels for axis and full text', () => {
    expect(formatMonthLabel('2026-09')).toBe('9月')
    expect(formatMonthLabel('2026-01')).toBe('1月')
    expect(formatMonthLabel('bad')).toBe('bad')
    expect(formatMonthFull('2026-09')).toBe('2026年9月')
  })

  it('uses at least 1 as the chart scale', () => {
    expect(maxMonthAdded([point('2026-08', 0), point('2026-09', 3)])).toBe(3)
    expect(maxMonthAdded([point('2026-09', 0)])).toBe(1)
    expect(maxMonthAdded([])).toBe(1)
  })

  it('formats dates and invalid values', () => {
    expect(formatDate('2026-10-21T08:00:00Z')).toBe('2026/10/21')
    expect(formatDate(null)).toBe('—')
    expect(formatDate('bad')).toBe('—')
  })
})

describe('activity and profile copy', () => {
  it('maps activity levels to text and badge classes', () => {
    expect(activityLevelText('high')).toBe('活跃')
    expect(activityLevelText('medium')).toBe('平稳')
    expect(activityLevelText('low')).toBe('偏低')
    expect(activityLevelClass('high')).toContain('emerald')
    expect(activityLevelClass('medium')).toContain('amber')
    expect(activityLevelClass('low')).toContain('rose')
  })

  it('explains every profile type', () => {
    expect(profileTypeHint('多语言探索者')).toContain('广度')
    expect(profileTypeHint('单栈深耕者')).toContain('纵深')
    expect(profileTypeHint('全栈实践者')).toContain('端到端')
    expect(profileTypeHint('均衡开发者')).toContain('均衡')
  })

  it('maps health status to Chinese labels', () => {
    expect(healthStatusText('active')).toBe('活跃')
    expect(healthStatusText('attention')).toBe('需关注')
    expect(healthStatusText('stale')).toBe('沉寂')
    expect(healthStatusText('archived')).toBe('已归档')
    expect(healthStatusText(null)).toBe('—')
  })
})
