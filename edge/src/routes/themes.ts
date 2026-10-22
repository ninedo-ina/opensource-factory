/**
 * 主题聚类路由（M6-11）
 *
 * POST /api/themes/cluster  当前用户收藏库的主题聚类（VPS 向量聚类，失败时本地语言兜底）
 * POST /api/themes/apply    把建议标签写入当前用户选中的仓库（幂等）
 *
 * 权限：仓库范围一律以 D1 `my_repositories.user_id` 为准；VPS 只接收当前用户的 repoIds，
 * 返回结果还会再按用户仓库集合过滤一次，避免跨用户泄漏。
 */
import { Hono } from 'hono';
import type { Env, RepoRow, Variables } from '../types';
import { all, first, run } from '../db';
import {
  MAX_APPLY_REPOS,
  MAX_THEME_REPOS,
  buildKeywordThemes,
  finalizeVectorResult,
  normalizeTag,
  normalizeThemeOptions,
  sanitizeRepoIds,
  type ThemeCluster,
  type ThemeClusterResult,
  type ThemeRepo,
  type ThemeThresholds,
  type ThemeUnclustered,
  type ThemeUnclusteredReason,
} from '../themes/helpers';

const themes = new Hono<{ Bindings: Env; Variables: Variables }>();

const VPS_TIMEOUT_MS = 12_000;
const IN_CHUNK = 50;

interface ThemeRepoRow extends RepoRow {
  tag_names: string | null;
}

interface VpsThemeRepo {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  summary?: unknown;
  language?: unknown;
  stars?: unknown;
}

interface VpsTheme {
  id?: unknown;
  name?: unknown;
  keywords?: unknown;
  suggestedTags?: unknown;
  repoCount?: unknown;
  cohesion?: unknown;
  repos?: VpsThemeRepo[];
}

interface VpsThemeResponse {
  themes?: VpsTheme[];
  unclustered?: Array<{ id?: unknown; name?: unknown; reason?: unknown }>;
  stats?: { totalRepos?: unknown; vectorized?: unknown };
  thresholds?: Partial<ThemeThresholds>;
  model?: unknown;
  backend?: unknown;
  generatedAt?: unknown;
  tookMs?: unknown;
}

function splitTags(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

function chunks<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asStringList(value: unknown, limit = 10): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').slice(0, limit);
}

function reasonOf(value: unknown): ThemeUnclusteredReason {
  return value === 'no_vector' ||
    value === 'singleton' ||
    value === 'dim_mismatch' ||
    value === 'overflow'
    ? value
    : 'no_vector';
}

/** 当前用户仓库（带标签），按 Star 降序，最多 500 条。 */
async function loadUserRepos(env: Env, userId: string): Promise<ThemeRepoRow[]> {
  return all<ThemeRepoRow>(
    env.DB,
    `SELECT r.*,
            (SELECT GROUP_CONCAT(t.name, ',')
               FROM repo_tags rt JOIN tags t ON t.id = rt.tag_id
              WHERE rt.repo_id = r.id) AS tag_names
       FROM my_repositories r
      WHERE r.user_id = ?
      ORDER BY r.stars DESC, r.id ASC
      LIMIT ?`,
    [userId, MAX_THEME_REPOS]
  );
}

async function postVps(
  env: Env,
  repoIds: string[],
  thresholds: ThemeThresholds
): Promise<VpsThemeResponse | null> {
  const base = env.VPS_NODE_URL?.trim();
  if (!base) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VPS_TIMEOUT_MS);
  try {
    const response = await fetch(`${base.replace(/\/+$/, '')}/api/themes/cluster`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': env.INTERNAL_TOKEN ?? '',
      },
      body: JSON.stringify({ repoIds, ...thresholds }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as VpsThemeResponse;
  } catch (err) {
    console.error('vps /api/themes/cluster failed:', err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 过滤并水合 VPS 结果：只保留当前用户仓库，标签以 D1 为准。 */
function hydrateVectorResult(
  vps: VpsThemeResponse,
  rows: ThemeRepoRow[],
  thresholds: ThemeThresholds,
  startedAt: number
): ThemeClusterResult {
  const tagMap = new Map<string, string[]>();
  const nameMap = new Map<string, string>();
  for (const row of rows) {
    tagMap.set(row.id, splitTags(row.tag_names));
    nameMap.set(row.id, row.name);
  }

  const seen = new Set<string>();
  const resultThemes: ThemeCluster[] = [];
  for (const theme of vps.themes ?? []) {
    const repos: ThemeRepo[] = [];
    for (const repo of theme.repos ?? []) {
      const id = asString(repo.id);
      if (!id || !tagMap.has(id) || seen.has(id)) continue;
      seen.add(id);
      repos.push({
        id,
        name: asString(repo.name, nameMap.get(id) ?? id),
        description: asString(repo.description),
        summary: asString(repo.summary),
        language: asString(repo.language),
        stars: asNumber(repo.stars),
        tags: tagMap.get(id) ?? [],
      });
    }
    if (repos.length === 0) continue;
    repos.sort((left, right) => right.stars - left.stars || left.id.localeCompare(right.id));

    // 簇内所有仓库都已有的标签不再建议（避免重复应用无效果）
    const common = repos
      .slice(1)
      .reduce<Set<string>>(
        (shared, repo) => new Set([...shared].filter((tag) => repo.tags.includes(tag))),
        new Set(repos[0]?.tags ?? [])
      );
    const suggestedTags = [...new Set(asStringList(theme.suggestedTags, 10).map(normalizeTag))]
      .filter((tag) => tag && !common.has(tag))
      .slice(0, 3);

    resultThemes.push({
      id: asString(theme.id, `theme-${repos[0]?.id ?? 'unknown'}`),
      name: asString(theme.name, repos[0]?.name ?? '综合主题'),
      keywords: asStringList(theme.keywords, 8),
      suggestedTags,
      repoCount: repos.length,
      cohesion: Math.round(asNumber(theme.cohesion) * 1000) / 1000,
      repos,
    });
  }
  resultThemes.sort(
    (left, right) => right.repoCount - left.repoCount || left.name.localeCompare(right.name)
  );

  const unclustered: ThemeUnclustered[] = [];
  for (const item of vps.unclustered ?? []) {
    const id = asString(item.id);
    if (!id || !tagMap.has(id) || seen.has(id)) continue;
    seen.add(id);
    unclustered.push({
      id,
      name: asString(item.name, nameMap.get(id) ?? id),
      reason: reasonOf(item.reason),
    });
  }
  // VPS 镜像可能缺少部分收藏：未出现在结果中的仓库按 no_vector 处理
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    unclustered.push({ id: row.id, name: row.name, reason: 'no_vector' });
  }

  return finalizeVectorResult(
    resultThemes,
    unclustered,
    rows.length,
    Math.min(rows.length, Math.max(0, Math.trunc(asNumber(vps.stats?.vectorized)))),
    asString(vps.model),
    asString(vps.backend),
    thresholds,
    asString(vps.generatedAt, new Date().toISOString()),
    Math.max(0, Math.trunc(asNumber(vps.tookMs, Date.now() - startedAt)))
  );
}

themes.post('/cluster', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const thresholds = normalizeThemeOptions(body);
  const started = Date.now();

  const rows = await loadUserRepos(c.env, user.id);
  if (rows.length === 0) {
    return c.json(buildKeywordThemes([], thresholds, started) satisfies ThemeClusterResult);
  }

  const repoIds = rows.map((row) => row.id);
  const vps = await postVps(c.env, repoIds, thresholds);
  if (vps) {
    return c.json(hydrateVectorResult(vps, rows, thresholds, started) satisfies ThemeClusterResult);
  }

  // VPS 不可达：本地按语言兜底，页面不空白
  return c.json(
    buildKeywordThemes(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        summary: row.readme_summary,
        language: row.language,
        stars: row.stars,
        tags: splitTags(row.tag_names),
      })),
      thresholds,
      started
    ) satisfies ThemeClusterResult
  );
});

themes.post('/apply', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const tag = normalizeTag(typeof body?.tag === 'string' ? body.tag : '');
  if (!tag) {
    return c.json({ error: 'invalid_tag', message: 'tag 归一化后需为 1~40 个字符' }, 400);
  }
  const requested = sanitizeRepoIds(body?.repoIds, MAX_APPLY_REPOS);
  if (requested.length === 0) {
    return c.json({ error: 'invalid_repo_ids', message: 'repoIds 不能为空' }, 400);
  }

  // 只处理属于当前用户的仓库
  const owned = new Set<string>();
  for (const group of chunks(requested, IN_CHUNK)) {
    const found = await all<{ id: string }>(
      c.env.DB,
      `SELECT id FROM my_repositories WHERE user_id = ? AND id IN (${placeholders(group.length)})`,
      [user.id, ...group]
    );
    for (const row of found) owned.add(row.id);
  }

  if (owned.size > 0) {
    await run(c.env.DB, 'INSERT INTO tags (name, count) VALUES (?, 0) ON CONFLICT(name) DO NOTHING', [
      tag,
    ]);
  }
  const tagRow = await first<{ id: number }>(c.env.DB, 'SELECT id FROM tags WHERE name = ?', [tag]);

  let applied = 0;
  if (tagRow) {
    for (const repoId of owned) {
      const result = await run(
        c.env.DB,
        'INSERT INTO repo_tags (repo_id, tag_id) VALUES (?, ?) ON CONFLICT(repo_id, tag_id) DO NOTHING',
        [repoId, tagRow.id]
      );
      if ((result.meta.changes ?? 0) > 0) applied += 1;
    }
    // 标签计数按关联表实际行数重算，避免历史数据漂移
    await run(
      c.env.DB,
      'UPDATE tags SET count = (SELECT COUNT(*) FROM repo_tags WHERE tag_id = ?) WHERE id = ?',
      [tagRow.id, tagRow.id]
    );
  }

  return c.json({
    tag,
    applied,
    skipped: requested.length - applied,
    total: requested.length,
  });
});

export default themes;
