import { describe, expect, it } from 'vitest'
import { demoSearchSuggestions } from './api'
import {
  engineLabel,
  formatScore,
  isQueryValid,
  modeLabel,
  normalizeQuery,
  scopeLabel,
  understandingLabels,
} from './utils'

describe('搜索工具函数', () => {
  it('归一化查询：去首尾空白并压缩连续空白', () => {
    expect(normalizeQuery('  多租户   NestJS  ')).toBe('多租户 NestJS')
    expect(normalizeQuery('a\n\tb')).toBe('a b')
  })

  it('校验查询长度 1~200', () => {
    expect(isQueryValid('   ')).toBe(false)
    expect(isQueryValid('x')).toBe(true)
    expect(isQueryValid('x'.repeat(200))).toBe(true)
    expect(isQueryValid('x'.repeat(201))).toBe(false)
  })

  it('匹配度格式化为百分比并夹取 0~1', () => {
    expect(formatScore(0.8734)).toBe('87%')
    expect(formatScore(-1)).toBe('0%')
    expect(formatScore(2)).toBe('100%')
    expect(formatScore(Number.NaN)).toBe('0%')
  })

  it('来源与模式标签', () => {
    expect(scopeLabel('my')).toBe('我的仓库')
    expect(scopeLabel('trending')).toBe('每日热榜')
    expect(scopeLabel('all')).toBe('全部来源')
    expect(modeLabel('vectorize')).toContain('Vectorize')
    expect(modeLabel('local')).toContain('本地')
    expect(modeLabel('keyword')).toContain('关键词')
    expect(modeLabel('fts')).toContain('全文')
    expect(modeLabel('like')).toContain('短词')
    expect(engineLabel('semantic')).toBe('语义检索')
    expect(engineLabel('fulltext')).toBe('全文检索')
  })

  it('查询理解标签：技术栈在前、概念在后并去重', () => {
    const understanding = {
      query: 'k8s 部署',
      rewritten: 'k8s 部署 Kubernetes deployment',
      expanded: true,
      techStack: ['Kubernetes'],
      concepts: ['部署', 'Kubernetes'],
      terms: ['Kubernetes', 'deployment'],
      keywordTerms: ['k8s 部署', 'Kubernetes'],
      maxTerms: 12,
    }
    expect(understandingLabels(understanding)).toEqual(['Kubernetes', '部署'])
    expect(understandingLabels({ ...understanding, expanded: false })).toEqual(
      []
    )
    expect(understandingLabels(undefined)).toEqual([])
  })
})

describe('演示搜索建议', () => {
  it('空查询时标签在前，并包含仓库与标签两类', () => {
    const items = demoSearchSuggestions('', 8)
    expect(items).toHaveLength(8)
    expect(items[0].type).toBe('tag')
    expect(items.some((item) => item.type === 'repo')).toBe(true)
    expect(items.some((item) => item.type === 'tag')).toBe(true)
  })

  it('按标签或简介做忽略大小写的包含匹配', () => {
    const byLabel = demoSearchSuggestions('typescript')
    expect(byLabel.some((item) => item.label === 'TypeScript')).toBe(true)

    const byDescription = demoSearchSuggestions('多租户')
    expect(byDescription.length).toBeGreaterThan(0)
    expect(byDescription.every((item) => item.type === 'repo')).toBe(true)
    expect(
      byDescription.every((item) => item.description.includes('多租户'))
    ).toBe(true)
  })

  it('条数限制夹取在 0~10，仓库建议字段完整', () => {
    expect(demoSearchSuggestions('', 0)).toEqual([])
    expect(demoSearchSuggestions('', 99)).toHaveLength(9)
    const repo = demoSearchSuggestions('', 10).find(
      (item) => item.type === 'repo'
    )
    expect(repo).toMatchObject({
      type: 'repo',
      value: repo?.label,
      source: 'trending',
      language: 'TypeScript',
    })
    expect(repo?.stars).toBeGreaterThan(0)
    expect(repo?.url).toContain('github.com')
  })
})
