/**
 * 主题聚类纯函数（M6-11）：参数归一化、标签规范化、本地兜底聚类与统计。
 *
 * 放在独立模块中，便于 node:test 直接覆盖，不依赖 Hono / D1 / VPS。
 */

export const MAX_THEME_REPOS = 500;
export const MAX_APPLY_REPOS = 200;
export const MAX_TAG_LENGTH = 40;

const DEFAULT_MIN_SIMILARITY = 0.55;
const DEFAULT_MIN_CLUSTER_SIZE = 2;
const DEFAULT_MAX_CLUSTERS = 12;

export interface ThemeThresholds {
  minSimilarity: number;
  minClusterSize: number;
  maxClusters: number;
}

export interface ThemeRepo {
  id: string;
  name: string;
  description: string;
  summary: string;
  language: string;
  stars: number;
  tags: string[];
}

export interface ThemeCluster {
  id: string;
  name: string;
  keywords: string[];
  suggestedTags: string[];
  repoCount: number;
  cohesion: number;
  repos: ThemeRepo[];
}

export type ThemeUnclusteredReason = 'no_vector' | 'singleton' | 'dim_mismatch' | 'overflow';

export interface ThemeUnclustered {
  id: string;
  name: string;
  reason: ThemeUnclusteredReason;
}

export interface ThemeStats {
  totalRepos: number;
  clusteredRepos: number;
  themeCount: number;
  coverage: number;
  vectorized: number;
  model: string;
  backend: string;
}

export interface ThemeClusterResult {
  mode: 'vector' | 'keyword' | 'empty';
  themes: ThemeCluster[];
  unclustered: ThemeUnclustered[];
  stats: ThemeStats;
  thresholds: ThemeThresholds;
  generatedAt: string;
  tookMs: number;
}

/** 参与聚类的仓库最小字段集（来自 D1 `my_repositories`）。 */
export interface ThemeRepoSource {
  id: string;
  name: string;
  description: string | null;
  summary: string | null;
  language: string | null;
  stars: number | null;
  tags?: string[];
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

/** 归一化聚类阈值，非法值回落到默认值。 */
export function normalizeThemeOptions(body: unknown): ThemeThresholds {
  const value = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  return {
    minSimilarity: Math.round(clampNumber(value.minSimilarity, 0, 0.99, DEFAULT_MIN_SIMILARITY) * 100) / 100,
    minClusterSize: clampInteger(value.minClusterSize, 1, 50, DEFAULT_MIN_CLUSTER_SIZE),
    maxClusters: clampInteger(value.maxClusters, 1, 50, DEFAULT_MAX_CLUSTERS),
  };
}

/** 标签规范化：小写、空格 / 下划线转 `-`、去控制字符，最长 40 字符。 */
export function normalizeTag(value: string): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^0-9a-z一-鿿+#.\-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.\-]+|[.\-]+$/g, '')
    .slice(0, MAX_TAG_LENGTH);
}

/** 清洗 repoIds：去空、去重、截断上限。 */
export function sanitizeRepoIds(value: unknown, limit = MAX_THEME_REPOS): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    if (result.length >= limit) break;
  }
  return result;
}

export function toThemeRepo(row: ThemeRepoSource): ThemeRepo {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    summary: row.summary ?? '',
    language: row.language ?? '',
    stars: row.stars ?? 0,
    tags: row.tags ?? [],
  };
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

const LATIN_RE = /[a-zA-Z][a-zA-Z0-9+#.-]{1,}/g;
const CJK_RE = /[一-鿿]+/g;
const STOPWORDS = new Set([
  'and',
  'app',
  'application',
  'awesome',
  'based',
  'built',
  'cli',
  'code',
  'collection',
  'demo',
  'docs',
  'documentation',
  'example',
  'framework',
  'github',
  'http',
  'https',
  'library',
  'list',
  'modern',
  'open',
  'platform',
  'project',
  'sdk',
  'simple',
  'source',
  'starter',
  'system',
  'template',
  'test',
  'tool',
  'tools',
  'ui',
  'using',
  'web',
  'www',
  '一个',
  '一款',
  '使用',
  '支持',
  '项目',
  '工具',
  '平台',
  '系统',
  '框架',
  '组件',
  '可以',
  '基于',
  '以及',
  '通过',
  '进行',
  '实现',
  '提供',
  '用于',
  '开源',
  '管理',
  '应用',
  '服务',
  '功能',
  '帮助',
  '快速',
  '简单',
  '高效',
]);

function tokenize(text: string): string[] {
  const value = (text ?? '').toLowerCase();
  const tokens: string[] = [];
  for (const match of value.matchAll(LATIN_RE)) {
    const token = match[0].replace(/^[.-]+|[.-]+$/g, '');
    if (token.length >= 2 && !STOPWORDS.has(token)) tokens.push(token);
  }
  for (const match of value.matchAll(CJK_RE)) {
    const sequence = match[0];
    if (sequence.length <= 2) {
      if (!STOPWORDS.has(sequence)) tokens.push(sequence);
      continue;
    }
    for (let index = 0; index < sequence.length - 1; index += 1) {
      const bigram = sequence.slice(index, index + 2);
      if (!STOPWORDS.has(bigram)) tokens.push(bigram);
    }
  }
  return tokens;
}

function topKeywords(repos: ThemeRepo[], limit = 5): string[] {
  const df = new Map<string, number>();
  for (const repo of repos) {
    const tokens = new Set(
      tokenize([repo.name, repo.description, repo.summary, repo.language].join(' '))
    );
    for (const token of tokens) df.set(token, (df.get(token) ?? 0) + 1);
  }
  return [...df.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([token]) => token);
}

function themeName(keywords: string[], language: string): string {
  if (keywords.length >= 2) return `${keywords[0] ?? ''} / ${keywords[1] ?? ''}`;
  if (keywords.length === 1) return keywords[0] ?? '';
  return language ? `${language} 项目` : '综合主题';
}

function statsFor(
  themes: ThemeCluster[],
  totalRepos: number,
  vectorized: number,
  model = '',
  backend = ''
): ThemeStats {
  const clusteredRepos = themes.reduce((sum, theme) => sum + theme.repoCount, 0);
  const coverage = totalRepos > 0 ? Math.round((clusteredRepos / totalRepos) * 1000) / 10 : 0;
  return {
    totalRepos,
    clusteredRepos,
    themeCount: themes.length,
    coverage,
    vectorized,
    model,
    backend,
  };
}

/**
 * VPS 不可用时的本地兜底：按主语言分组，语言相同的仓库形成一个主题。
 *
 * 这是保守规则（不猜测语义），保证页面在向量服务离线时仍有可用的整理入口；
 * 组内关键词只用于展示，标签仍由用户确认后写入。
 */
export function buildKeywordThemes(
  repos: ThemeRepoSource[],
  thresholds: ThemeThresholds,
  startedAt = Date.now()
): ThemeClusterResult {
  const groups = new Map<string, ThemeRepo[]>();
  for (const row of repos) {
    const repo = toThemeRepo(row);
    const language = repo.language.trim();
    const key = language ? language.toLowerCase() : '';
    const list = groups.get(key);
    if (list) list.push(repo);
    else groups.set(key, [repo]);
  }

  const sortedGroups = [...groups.entries()].sort((left, right) => {
    const sizeDiff = right[1].length - left[1].length;
    if (sizeDiff !== 0) return sizeDiff;
    return left[0].localeCompare(right[0]);
  });

  const themes: ThemeCluster[] = [];
  const unclustered: ThemeUnclustered[] = [];
  const overflow: Array<[string, ThemeRepo[]]> = [];

  for (const [key, members] of sortedGroups) {
    if (members.length < thresholds.minClusterSize) {
      unclustered.push(...members.map((repo) => ({ id: repo.id, name: repo.name, reason: 'singleton' as const })));
      continue;
    }
    if (themes.length >= thresholds.maxClusters) {
      overflow.push([key, members]);
      continue;
    }
    const sorted = [...members].sort((left, right) => right.stars - left.stars || left.id.localeCompare(right.id));
    const keywords = topKeywords(sorted);
    const language = sorted[0]?.language || key;
    const tag = normalizeTag(language);
    themes.push({
      id: `keyword-${fnv1a(key || 'other')}`,
      name: themeName(keywords, language),
      keywords,
      suggestedTags: tag ? [tag] : [],
      repoCount: sorted.length,
      cohesion: 0,
      repos: sorted,
    });
  }

  for (const [, members] of overflow) {
    unclustered.push(...members.map((repo) => ({ id: repo.id, name: repo.name, reason: 'overflow' as const })));
  }

  return {
    mode: repos.length === 0 ? 'empty' : 'keyword',
    themes,
    unclustered,
    stats: statsFor(themes, repos.length, 0),
    thresholds,
    generatedAt: new Date().toISOString(),
    tookMs: Date.now() - startedAt,
  };
}

/** 把 VPS 返回的统计补齐 model / backend，并按实际主题重算覆盖。 */
export function finalizeVectorResult(
  themes: ThemeCluster[],
  unclustered: ThemeUnclustered[],
  totalRepos: number,
  vectorized: number,
  model: string,
  backend: string,
  thresholds: ThemeThresholds,
  generatedAt: string,
  tookMs: number
): ThemeClusterResult {
  return {
    mode: totalRepos === 0 ? 'empty' : 'vector',
    themes,
    unclustered,
    stats: statsFor(themes, totalRepos, vectorized, model, backend),
    thresholds,
    generatedAt,
    tookMs,
  };
}
