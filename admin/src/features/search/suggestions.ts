/**
 * 搜索建议的前端纯函数（M6-10）
 * 负责把远端建议、本地历史组织成下拉分组，并提供键盘导航与高亮拆分。
 */
import type { SearchSuggestionItem } from './api'
import type { SearchHistoryEntry } from './history'
import {
  engineLabel,
  scopeLabel,
  type SearchEngine,
  type SearchScope,
} from './utils'

export type SuggestionOptionKind = 'history' | 'repo' | 'tag'

export interface SuggestionOption {
  key: string
  kind: SuggestionOptionKind
  label: string
  description: string
  value: string
  engine?: SearchEngine
  scope?: SearchScope
  source?: 'my' | 'trending'
}

export interface SuggestionGroup {
  key: 'history' | 'repo' | 'tag'
  title: string
  options: SuggestionOption[]
}

export interface HighlightPart {
  text: string
  match: boolean
}

function historyOption(entry: SearchHistoryEntry): SuggestionOption {
  return {
    key: `history:${entry.query.toLowerCase()}`,
    kind: 'history',
    label: entry.query,
    description: `${engineLabel(entry.engine)} · ${scopeLabel(entry.scope)}`,
    value: entry.query,
    engine: entry.engine,
    scope: entry.scope,
  }
}

function remoteOption(item: SearchSuggestionItem): SuggestionOption {
  return {
    key: `${item.type}:${item.id}`,
    kind: item.type,
    label: item.label,
    description: item.description,
    value: item.value,
    source: item.source,
  }
}

/**
 * 组织建议分组：输入为空时展示历史 + 远端热门；有输入时只展示远端建议。
 * 空分组会被过滤，避免出现只有标题的下拉。
 */
export function buildSuggestionGroups(
  remote: SearchSuggestionItem[],
  history: SearchHistoryEntry[],
  query: string
): SuggestionGroup[] {
  const normalized = query.trim()
  const groups: SuggestionGroup[] = []

  if (!normalized && history.length > 0) {
    groups.push({
      key: 'history',
      title: '最近搜索',
      options: history.map(historyOption),
    })
  }

  const repos = remote.filter((item) => item.type === 'repo').map(remoteOption)
  if (repos.length > 0) {
    groups.push({ key: 'repo', title: '仓库', options: repos })
  }

  const tags = remote.filter((item) => item.type === 'tag').map(remoteOption)
  if (tags.length > 0) {
    groups.push({ key: 'tag', title: '标签', options: tags })
  }

  return groups.filter((group) => group.options.length > 0)
}

/** 下拉分组扁平化：键盘上下移动时使用同一顺序。 */
export function flattenSuggestionGroups(
  groups: SuggestionGroup[]
): SuggestionOption[] {
  return groups.flatMap((group) => group.options)
}

/** 键盘索引循环：total 为 0 时返回 -1；从 -1 向下到 0、向上到末尾。 */
export function nextSuggestionIndex(
  current: number,
  delta: number,
  total: number
): number {
  if (total <= 0) return -1
  if (current < 0) return delta > 0 ? 0 : total - 1
  return (current + delta + total) % total
}

/** 把标签拆成「命中 / 未命中」片段，供 <mark> 高亮；忽略大小写，只高亮第一处。 */
export function splitHighlight(label: string, query: string): HighlightPart[] {
  const normalized = query.trim()
  if (!normalized) return [{ text: label, match: false }]
  const index = label.toLowerCase().indexOf(normalized.toLowerCase())
  if (index < 0) return [{ text: label, match: false }]
  const parts: HighlightPart[] = []
  if (index > 0) parts.push({ text: label.slice(0, index), match: false })
  parts.push({
    text: label.slice(index, index + normalized.length),
    match: true,
  })
  const rest = label.slice(index + normalized.length)
  if (rest) parts.push({ text: rest, match: false })
  return parts
}
