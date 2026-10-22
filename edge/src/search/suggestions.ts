/**
 * 搜索建议纯函数（M6-10）
 *
 * 输入来自 D1 的三类行：我的仓库、热榜仓库、标签；输出统一的建议项。
 * 这里不访问数据库，便于 node:test 直接覆盖排序 / 去重 / 转义规则。
 */

export type SuggestionType = 'repo' | 'tag';
export type SuggestionSource = 'my' | 'trending';

export interface SuggestionItem {
  id: string;
  type: SuggestionType;
  label: string;
  value: string;
  description: string;
  source?: SuggestionSource;
  language?: string;
  stars?: number;
  url?: string;
}

export interface SuggestionResponse {
  query: string;
  count: number;
  tookMs: number;
  items: SuggestionItem[];
}

export interface RepoSuggestionRow {
  id: string;
  name: string;
  owner?: string | null;
  description?: string | null;
  language?: string | null;
  stars?: number | null;
  stars_today?: number | null;
  html_url: string;
  source: SuggestionSource;
}

export interface TagSuggestionRow {
  name: string;
  count?: number | null;
}

export const MAX_SUGGESTION_QUERY_LENGTH = 100;
export const DEFAULT_SUGGESTION_LIMIT = 8;
export const MAX_SUGGESTION_LIMIT = 10;

/** 归一化建议查询：去首尾空白、压缩空白、截断到 100 字。 */
export function normalizeSuggestionQuery(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.trim().replace(/\s+/g, ' ').slice(0, MAX_SUGGESTION_QUERY_LENGTH);
}

/** 建议条数夹取：默认 8，范围 1~10。 */
export function clampSuggestionLimit(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SUGGESTION_LIMIT;
  return Math.min(MAX_SUGGESTION_LIMIT, Math.max(1, Math.trunc(parsed)));
}

/** 转义 LIKE 通配符，配合 `ESCAPE '\'` 使用，避免用户输入 % / _ 扩大匹配。 */
export function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** 包含匹配的 LIKE 模式。 */
export function likeContains(query: string): string {
  return `%${escapeLikePattern(query)}%`;
}

/** 前缀匹配的 LIKE 模式。 */
export function likePrefix(query: string): string {
  return `${escapeLikePattern(query)}%`;
}

/** 仓库展示名：优先 owner/name，缺 owner 时回退 id。 */
export function repoLabel(row: RepoSuggestionRow): string {
  const owner = row.owner?.trim();
  return owner ? `${owner}/${row.name}` : row.id;
}

function matchRank(query: string, row: RepoSuggestionRow): number {
  const q = query.toLowerCase();
  if (!q) return 3;
  const id = row.id.toLowerCase();
  const name = row.name.toLowerCase();
  if (id === q || name === q) return 0;
  if (id.startsWith(q) || name.startsWith(q)) return 1;
  if (id.includes(q) || name.includes(q)) return 2;
  return 3;
}

function heat(row: RepoSuggestionRow): number {
  const stars = typeof row.stars === 'number' && Number.isFinite(row.stars) ? row.stars : 0;
  const today =
    typeof row.stars_today === 'number' && Number.isFinite(row.stars_today) ? row.stars_today : 0;
  return today * 10 + stars;
}

function sourceRank(source: SuggestionSource): number {
  return source === 'my' ? 0 : 1;
}

/** 仓库建议：先按 id 去重（保留先出现的来源，调用方先传 my），再按匹配度 / 来源 / 热度排序。 */
export function rankRepoSuggestions(
  query: string,
  rows: RepoSuggestionRow[],
  limit = DEFAULT_SUGGESTION_LIMIT
): SuggestionItem[] {
  const seen = new Set<string>();
  const deduped: RepoSuggestionRow[] = [];
  for (const row of rows) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    deduped.push(row);
  }
  const q = normalizeSuggestionQuery(query);
  deduped.sort((a, b) => {
    const rank = matchRank(q, a) - matchRank(q, b);
    if (rank !== 0) return rank;
    // 空查询是「热门推荐」，纯按热度排；有查询时同匹配度下优先用户自己的仓库。
    if (q) {
      const source = sourceRank(a.source) - sourceRank(b.source);
      if (source !== 0) return source;
    }
    const byHeat = heat(b) - heat(a);
    if (byHeat !== 0) return byHeat;
    return sourceRank(a.source) - sourceRank(b.source);
  });
  return deduped.slice(0, limit).map((row) => ({
    id: `${row.source}:${row.id}`,
    type: 'repo',
    label: repoLabel(row),
    value: repoLabel(row),
    description: row.description ?? '',
    source: row.source,
    language: row.language ?? '',
    stars: row.stars ?? 0,
    url: row.html_url,
  }));
}

/** 标签建议：前缀命中优先，其次使用次数降序。 */
export function rankTagSuggestions(
  query: string,
  rows: TagSuggestionRow[],
  limit = DEFAULT_SUGGESTION_LIMIT
): SuggestionItem[] {
  const q = normalizeSuggestionQuery(query).toLowerCase();
  const seen = new Set<string>();
  const deduped: TagSuggestionRow[] = [];
  for (const row of rows) {
    const name = row?.name?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ ...row, name });
  }
  const rank = (name: string): number => {
    if (!q) return 0;
    const value = name.toLowerCase();
    if (value === q) return 0;
    if (value.startsWith(q)) return 1;
    if (value.includes(q)) return 2;
    return 3;
  };
  const matched = q ? deduped.filter((row) => rank(row.name) < 3) : deduped;
  matched.sort((a, b) => {
    const diff = rank(a.name) - rank(b.name);
    if (diff !== 0) return diff;
    return (b.count ?? 0) - (a.count ?? 0);
  });
  return matched.slice(0, limit).map((row) => ({
    id: `tag:${row.name}`,
    type: 'tag',
    label: row.name,
    value: row.name,
    description:
      typeof row.count === 'number' && row.count > 0 ? `${row.count} 个仓库使用` : '标签',
  }));
}

/**
 * 合并仓库 / 标签建议：查询为空时热门标签优先，否则仓库优先；总数受 limit 限制。
 */
export function buildSuggestionItems(
  query: string,
  repos: RepoSuggestionRow[],
  tags: TagSuggestionRow[],
  limit = DEFAULT_SUGGESTION_LIMIT
): SuggestionItem[] {
  const bounded = clampSuggestionLimit(limit);
  const hasQuery = query.trim().length > 0;
  // 空查询是热门推荐：标签与仓库各占一半名额，避免标签过多时仓库一条都露不出来。
  const tagLimit = hasQuery ? bounded : Math.max(1, Math.ceil(bounded / 2));
  const repoLimit = hasQuery ? bounded : Math.max(1, Math.floor(bounded / 2));
  const repoItems = rankRepoSuggestions(query, repos, repoLimit);
  const tagItems = rankTagSuggestions(query, tags, tagLimit);
  const ordered = hasQuery ? [...repoItems, ...tagItems] : [...tagItems, ...repoItems];
  const seen = new Set<string>();
  const items: SuggestionItem[] = [];
  for (const item of ordered) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
    if (items.length >= bounded) break;
  }
  return items;
}
