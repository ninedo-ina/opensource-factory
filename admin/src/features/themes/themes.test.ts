import { describe, expect, it } from 'vitest'
import { MOCK_THEME_RESPONSE, type ThemeCluster } from './api'
import {
  clampClusterSize,
  clampSimilarity,
  collectSuggestedTags,
  formatCohesion,
  formatCoverage,
  modeLabel,
  sortThemes,
  unclusteredLabel,
  unclusteredSummary,
} from './utils'

function theme(
  id: string,
  name: string,
  repoCount: number,
  cohesion: number,
  suggestedTags: string[] = []
): ThemeCluster {
  return {
    id,
    name,
    keywords: [],
    suggestedTags,
    repoCount,
    cohesion,
    repos: [],
  }
}

describe('主题聚类工具函数', () => {
  it('主题排序：仓库数 > 凝聚度 > 名称', () => {
    const sorted = sortThemes([
      theme('a', 'B', 2, 0.8),
      theme('b', 'A', 3, 0.6),
      theme('c', 'C', 2, 0.9),
      theme('d', 'D', 2, 0.9),
    ])
    expect(sorted.map((item) => item.id)).toEqual(['b', 'c', 'd', 'a'])
  })

  it('覆盖率与凝聚度格式化', () => {
    expect(
      formatCoverage({
        totalRepos: 9,
        clusteredRepos: 7,
        themeCount: 3,
        coverage: 77.8,
        vectorized: 8,
        model: '',
        backend: '',
      })
    ).toBe('77.8%')
    expect(formatCohesion(0.8412)).toBe('84%')
    expect(formatCohesion(Number.NaN)).toBe('—')
  })

  it('阈值输入夹取', () => {
    expect(clampSimilarity(2)).toBe(0.95)
    expect(clampSimilarity(0)).toBe(0.3)
    expect(clampSimilarity(Number.NaN)).toBe(0.55)
    expect(clampClusterSize(0)).toBe(1)
    expect(clampClusterSize(99)).toBe(20)
    expect(clampClusterSize(3.9)).toBe(3)
  })

  it('建议标签汇总去重并保持主题顺序', () => {
    const tags = collectSuggestedTags([
      theme('a', 'A', 1, 0.5, ['ai', 'llm']),
      theme('b', 'B', 2, 0.6, ['llm', 'agent']),
    ])
    expect(tags).toEqual(['llm', 'agent', 'ai'])
  })

  it('未聚类原因文案与分组统计', () => {
    expect(unclusteredLabel('no_vector')).toContain('向量')
    expect(unclusteredLabel('singleton')).toContain('太少')
    expect(
      unclusteredSummary([
        { id: 'a', name: 'a', reason: 'no_vector' },
        { id: 'b', name: 'b', reason: 'singleton' },
        { id: 'c', name: 'c', reason: 'no_vector' },
      ])
    ).toEqual([
      { reason: 'no_vector', label: '尚未向量化', count: 2 },
      { reason: 'singleton', label: '仓库太少，未成主题', count: 1 },
    ])
  })

  it('模式文案与演示数据自洽', () => {
    expect(modeLabel('vector')).toContain('向量')
    expect(modeLabel('keyword')).toContain('兜底')
    expect(modeLabel('empty')).toContain('暂无')
    expect(MOCK_THEME_RESPONSE.themes.length).toBe(
      MOCK_THEME_RESPONSE.stats.themeCount
    )
    expect(
      MOCK_THEME_RESPONSE.themes.reduce((sum, item) => sum + item.repoCount, 0)
    ).toBe(MOCK_THEME_RESPONSE.stats.clusteredRepos)
  })
})
