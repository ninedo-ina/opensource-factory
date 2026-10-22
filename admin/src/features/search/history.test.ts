import { describe, expect, it } from 'vitest'
import {
  MAX_HISTORY_ITEMS,
  SEARCH_HISTORY_KEY,
  addSearchHistory,
  clearSearchHistory,
  loadSearchHistory,
  parseSearchHistory,
  removeSearchHistory,
  saveSearchHistory,
  type SearchHistoryEntry,
} from './history'

function entry(
  query: string,
  overrides: Partial<SearchHistoryEntry> = {}
): SearchHistoryEntry {
  return {
    query,
    engine: 'semantic',
    scope: 'all',
    at: 1_700_000_000_000,
    ...overrides,
  }
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
  }
}

describe('搜索历史解析', () => {
  it('解析合法条目并补齐默认字段', () => {
    const raw = JSON.stringify([
      { query: '  NestJS   模板 ', engine: 'fulltext', scope: 'my', at: 123 },
      { query: 'React', engine: 'unknown', scope: 'unknown' },
    ])
    expect(parseSearchHistory(raw)).toEqual([
      { query: 'NestJS 模板', engine: 'fulltext', scope: 'my', at: 123 },
      { query: 'React', engine: 'semantic', scope: 'all', at: 0 },
    ])
  })

  it('坏 JSON、非数组、非法条目静默丢弃', () => {
    expect(parseSearchHistory(null)).toEqual([])
    expect(parseSearchHistory('not-json')).toEqual([])
    expect(parseSearchHistory('{"query":"x"}')).toEqual([])
    expect(
      parseSearchHistory(
        JSON.stringify([null, 1, 'x', {}, { query: '   ' }, { query: 42 }])
      )
    ).toEqual([])
  })

  it('按查询忽略大小写去重并截断到上限', () => {
    const raw = JSON.stringify(
      Array.from({ length: MAX_HISTORY_ITEMS + 3 }, (_, index) => ({
        query: index === 1 ? 'react' : index === 2 ? 'REACT' : `query-${index}`,
        engine: 'semantic',
        scope: 'all',
        at: index,
      }))
    )
    const parsed = parseSearchHistory(raw)
    expect(parsed).toHaveLength(MAX_HISTORY_ITEMS)
    expect(parsed[0].query).toBe('query-0')
    expect(parsed[1].query).toBe('react')
    expect(parsed.some((item) => item.query === 'REACT')).toBe(false)
  })
})

describe('搜索历史增删', () => {
  it('新增放到最前，并忽略大小写去重', () => {
    const next = addSearchHistory(
      [entry('React'), entry('Vue')],
      entry('react', { engine: 'fulltext', scope: 'my', at: 2 })
    )
    expect(next.map((item) => item.query)).toEqual(['react', 'Vue'])
    expect(next[0]).toMatchObject({ engine: 'fulltext', scope: 'my', at: 2 })
  })

  it('新增截断到上限且空查询不写入', () => {
    const existing = Array.from({ length: MAX_HISTORY_ITEMS }, (_, index) =>
      entry(`q-${index}`)
    )
    const next = addSearchHistory(existing, entry('new'))
    expect(next).toHaveLength(MAX_HISTORY_ITEMS)
    expect(next[0].query).toBe('new')
    expect(next[next.length - 1]?.query).toBe('q-6')

    expect(addSearchHistory(existing, entry('   '))).toHaveLength(
      MAX_HISTORY_ITEMS
    )
  })

  it('删除指定查询时忽略大小写', () => {
    const next = removeSearchHistory([entry('React'), entry('Vue')], 'react')
    expect(next.map((item) => item.query)).toEqual(['Vue'])
    expect(removeSearchHistory(next, '  ')).toEqual(next)
  })
})

describe('搜索历史持久化', () => {
  it('保存后可读回，清空后返回空数组', () => {
    const storage = memoryStorage()
    saveSearchHistory([entry('NestJS')], storage)
    expect(storage.getItem(SEARCH_HISTORY_KEY)).toContain('NestJS')
    expect(loadSearchHistory(storage).map((item) => item.query)).toEqual([
      'NestJS',
    ])
    expect(clearSearchHistory(storage)).toEqual([])
    expect(storage.getItem(SEARCH_HISTORY_KEY)).toBeNull()
  })

  it('存储不可用或抛错时不影响调用方', () => {
    expect(loadSearchHistory(null)).toEqual([])
    expect(() => saveSearchHistory([entry('x')], null)).not.toThrow()
    expect(() => clearSearchHistory(null)).not.toThrow()

    const broken = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    }
    expect(loadSearchHistory(broken)).toEqual([])
    expect(() => saveSearchHistory([entry('x')], broken)).not.toThrow()
    expect(clearSearchHistory(broken)).toEqual([])
  })
})
