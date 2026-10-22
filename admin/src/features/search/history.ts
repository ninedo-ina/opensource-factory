/**
 * 搜索历史（M6-10）
 *
 * 历史只保存在本机 localStorage：查询文本 + 检索方式 + 范围 + 时间。
 * 不存搜索结果，避免把仓库内容落进浏览器缓存；最多保留 8 条，按归一化查询去重。
 */
import type { SearchEngine, SearchScope } from './utils'

export interface SearchHistoryEntry {
  query: string
  engine: SearchEngine
  scope: SearchScope
  at: number
}

export const SEARCH_HISTORY_KEY = 'of-search-history'
export const MAX_HISTORY_ITEMS = 8
export const MAX_HISTORY_QUERY_LENGTH = 200

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function normalizeHistoryQuery(input: unknown): string {
  if (typeof input !== 'string') return ''
  return input.trim().replace(/\s+/g, ' ').slice(0, MAX_HISTORY_QUERY_LENGTH)
}

function isEngine(value: unknown): value is SearchEngine {
  return value === 'semantic' || value === 'fulltext'
}

function isScope(value: unknown): value is SearchScope {
  return value === 'my' || value === 'trending' || value === 'all'
}

/** 解析 localStorage 原始值：坏 JSON / 非法条目静默丢弃，保持页面可用。 */
export function parseSearchHistory(raw: string | null): SearchHistoryEntry[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const entries: SearchHistoryEntry[] = []
    const seen = new Set<string>()
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      const query = normalizeHistoryQuery(record.query)
      if (!query) continue
      const key = query.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      entries.push({
        query,
        engine: isEngine(record.engine) ? record.engine : 'semantic',
        scope: isScope(record.scope) ? record.scope : 'all',
        at:
          typeof record.at === 'number' && Number.isFinite(record.at)
            ? record.at
            : 0,
      })
      if (entries.length >= MAX_HISTORY_ITEMS) break
    }
    return entries
  } catch {
    return []
  }
}

/** 写入一条历史：放到最前、按查询忽略大小写去重、截断到上限。 */
export function addSearchHistory(
  entries: SearchHistoryEntry[],
  entry: SearchHistoryEntry,
  max = MAX_HISTORY_ITEMS
): SearchHistoryEntry[] {
  const query = normalizeHistoryQuery(entry.query)
  if (!query) return entries.slice(0, max)
  const normalized: SearchHistoryEntry = {
    query,
    engine: isEngine(entry.engine) ? entry.engine : 'semantic',
    scope: isScope(entry.scope) ? entry.scope : 'all',
    at: Number.isFinite(entry.at) ? entry.at : Date.now(),
  }
  const rest = entries.filter(
    (item) => item.query.toLowerCase() !== query.toLowerCase()
  )
  return [normalized, ...rest].slice(0, max)
}

/** 删除指定查询（忽略大小写）。 */
export function removeSearchHistory(
  entries: SearchHistoryEntry[],
  query: string
): SearchHistoryEntry[] {
  const key = normalizeHistoryQuery(query).toLowerCase()
  if (!key) return entries
  return entries.filter((item) => item.query.toLowerCase() !== key)
}

function browserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** 读取历史；localStorage 不可用（隐私模式 / SSR）时返回空数组。 */
export function loadSearchHistory(
  storage: StorageLike | null = browserStorage()
): SearchHistoryEntry[] {
  if (!storage) return []
  try {
    return parseSearchHistory(storage.getItem(SEARCH_HISTORY_KEY))
  } catch {
    return []
  }
}

/** 保存历史；写入失败（配额 / 隐私模式）不影响检索。 */
export function saveSearchHistory(
  entries: SearchHistoryEntry[],
  storage: StorageLike | null = browserStorage()
): void {
  if (!storage) return
  try {
    storage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(entries))
  } catch {
    // 忽略写入失败：历史是增强能力，不能阻塞检索
  }
}

/** 清空历史。 */
export function clearSearchHistory(
  storage: StorageLike | null = browserStorage()
): SearchHistoryEntry[] {
  if (storage) {
    try {
      storage.removeItem(SEARCH_HISTORY_KEY)
    } catch {
      // 忽略删除失败
    }
  }
  return []
}
