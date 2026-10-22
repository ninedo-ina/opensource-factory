import { describe, expect, it } from 'vitest'
import type { SearchSuggestionItem } from './api'
import type { SearchHistoryEntry } from './history'
import {
  buildSuggestionGroups,
  flattenSuggestionGroups,
  nextSuggestionIndex,
  splitHighlight,
} from './suggestions'

const repoItem: SearchSuggestionItem = {
  id: 'my:demo/tenant-admin',
  type: 'repo',
  label: 'demo/tenant-admin',
  value: 'demo/tenant-admin',
  description: '支持多租户的 NestJS 管理后台模板',
  source: 'my',
}

const tagItem: SearchSuggestionItem = {
  id: 'tag:TypeScript',
  type: 'tag',
  label: 'TypeScript',
  value: 'TypeScript',
  description: '3 个仓库使用',
}

const history: SearchHistoryEntry[] = [
  {
    query: 'NestJS 模板',
    engine: 'semantic',
    scope: 'all',
    at: 2,
  },
  {
    query: 'React',
    engine: 'fulltext',
    scope: 'my',
    at: 1,
  },
]

describe('搜索建议分组', () => {
  it('空查询时历史在前，仓库与标签分组依次排列', () => {
    const groups = buildSuggestionGroups([repoItem, tagItem], history, '')
    expect(groups.map((group) => group.key)).toEqual(['history', 'repo', 'tag'])
    expect(groups[0].options).toHaveLength(2)
    expect(groups[0].options[0]).toMatchObject({
      kind: 'history',
      value: 'NestJS 模板',
      engine: 'semantic',
      scope: 'all',
    })
    expect(groups[0].options[0].description).toContain('语义检索')
  })

  it('有输入时不再展示历史，空分组被过滤', () => {
    expect(
      buildSuggestionGroups([repoItem], history, 'tenant').map(
        (group) => group.key
      )
    ).toEqual(['repo'])
    expect(buildSuggestionGroups([], history, 'tenant')).toEqual([])
  })

  it('扁平化顺序与分组顺序一致', () => {
    const groups = buildSuggestionGroups([repoItem, tagItem], history, '')
    expect(
      flattenSuggestionGroups(groups).map((option) => option.kind)
    ).toEqual(['history', 'history', 'repo', 'tag'])
  })
})

describe('建议键盘导航', () => {
  it('无建议时返回 -1', () => {
    expect(nextSuggestionIndex(-1, 1, 0)).toBe(-1)
    expect(nextSuggestionIndex(0, -1, 0)).toBe(-1)
  })

  it('从无选中向下到首项、向上到末项', () => {
    expect(nextSuggestionIndex(-1, 1, 3)).toBe(0)
    expect(nextSuggestionIndex(-1, -1, 3)).toBe(2)
  })

  it('上下移动循环', () => {
    expect(nextSuggestionIndex(2, 1, 3)).toBe(0)
    expect(nextSuggestionIndex(0, -1, 3)).toBe(2)
    expect(nextSuggestionIndex(1, 1, 3)).toBe(2)
  })
})

describe('建议高亮拆分', () => {
  it('忽略大小写高亮第一处命中', () => {
    expect(splitHighlight('demo/Tenant-admin', 'tenant')).toEqual([
      { text: 'demo/', match: false },
      { text: 'Tenant', match: true },
      { text: '-admin', match: false },
    ])
  })

  it('空查询或无命中时整段不高亮', () => {
    expect(splitHighlight('React', '  ')).toEqual([
      { text: 'React', match: false },
    ])
    expect(splitHighlight('React', 'vue')).toEqual([
      { text: 'React', match: false },
    ])
  })

  it('命中位于开头 / 结尾时不多出空片段', () => {
    expect(splitHighlight('React', 're')).toEqual([
      { text: 'Re', match: true },
      { text: 'act', match: false },
    ])
    expect(splitHighlight('React', 'act')).toEqual([
      { text: 'Re', match: false },
      { text: 'act', match: true },
    ])
  })
})
