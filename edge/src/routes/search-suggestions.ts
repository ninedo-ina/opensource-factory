/**
 * 搜索建议路由（M6-10）
 * GET /api/search/suggestions?q=&limit=
 *
 * 登录态；建议来自当前用户收藏库 + 全局热榜 + 标签。
 * `my` 查询一律带 user_id 过滤，避免跨用户泄漏。
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { all } from '../db';
import {
  buildSuggestionItems,
  clampSuggestionLimit,
  likeContains,
  normalizeSuggestionQuery,
  type RepoSuggestionRow,
  type SuggestionResponse,
  type TagSuggestionRow,
} from '../search/suggestions';

const searchSuggestions = new Hono<{ Bindings: Env; Variables: Variables }>();

const ROW_LIMIT = 30;

const MY_REPO_COLUMNS = 'id, name, owner, description, language, stars, html_url';
const TRENDING_REPO_COLUMNS =
  'id, name, owner, description, language, stars, stars_today, html_url';

function toMyRow(row: Omit<RepoSuggestionRow, 'source'>): RepoSuggestionRow {
  return { ...row, source: 'my' };
}

function toTrendingRow(row: Omit<RepoSuggestionRow, 'source'>): RepoSuggestionRow {
  return { ...row, source: 'trending' };
}

/** 关键词查询：我的仓库 / 热榜仓库 / 标签各取一批，交给纯函数排序去重。 */
async function querySuggestions(
  env: Env,
  userId: string,
  query: string
): Promise<{ repos: RepoSuggestionRow[]; tags: TagSuggestionRow[] }> {
  const pattern = likeContains(query);
  const [myRows, trendingRows, tagRows] = await Promise.all([
    all<Omit<RepoSuggestionRow, 'source'>>(
      env.DB,
      `SELECT ${MY_REPO_COLUMNS} FROM my_repositories
        WHERE user_id = ? AND (
          name LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'
        )
        ORDER BY stars DESC LIMIT ?`,
      [userId, pattern, pattern, pattern, ROW_LIMIT]
    ),
    all<Omit<RepoSuggestionRow, 'source'>>(
      env.DB,
      `SELECT ${TRENDING_REPO_COLUMNS} FROM trending_repositories
        WHERE (
          name LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\'
          OR description LIKE ? ESCAPE '\\' OR tech_stack LIKE ? ESCAPE '\\'
        )
        ORDER BY stars_today DESC LIMIT ?`,
      [pattern, pattern, pattern, pattern, ROW_LIMIT]
    ),
    all<TagSuggestionRow>(
      env.DB,
      `SELECT t.name AS name, COUNT(*) AS count
        FROM tags t
        JOIN repo_tags rt ON rt.tag_id = t.id
        JOIN my_repositories r ON r.id = rt.repo_id
        WHERE r.user_id = ? AND t.name LIKE ? ESCAPE '\\'
        GROUP BY t.id, t.name
        ORDER BY count DESC, t.name ASC
        LIMIT ?`,
      [userId, pattern, ROW_LIMIT]
    ),
  ]);
  return {
    repos: [...myRows.map(toMyRow), ...trendingRows.map(toTrendingRow)],
    tags: tagRows,
  };
}

/** 空查询：热门标签 + 当前用户高星仓库 + 今日热榜，作为默认建议。 */
async function queryHotSuggestions(
  env: Env,
  userId: string
): Promise<{ repos: RepoSuggestionRow[]; tags: TagSuggestionRow[] }> {
  const [myRows, trendingRows, tagRows] = await Promise.all([
    all<Omit<RepoSuggestionRow, 'source'>>(
      env.DB,
      `SELECT ${MY_REPO_COLUMNS} FROM my_repositories
        WHERE user_id = ? ORDER BY stars DESC LIMIT 6`,
      [userId]
    ),
    all<Omit<RepoSuggestionRow, 'source'>>(
      env.DB,
      `SELECT ${TRENDING_REPO_COLUMNS} FROM trending_repositories
        ORDER BY stars_today DESC LIMIT 6`
    ),
    all<TagSuggestionRow>(
      env.DB,
      `SELECT t.name AS name, COUNT(*) AS count
        FROM tags t
        JOIN repo_tags rt ON rt.tag_id = t.id
        JOIN my_repositories r ON r.id = rt.repo_id
        WHERE r.user_id = ?
        GROUP BY t.id, t.name
        ORDER BY count DESC, t.name ASC
        LIMIT 10`,
      [userId]
    ),
  ]);
  return {
    repos: [...myRows.map(toMyRow), ...trendingRows.map(toTrendingRow)],
    tags: tagRows,
  };
}

searchSuggestions.get('/', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const query = normalizeSuggestionQuery(c.req.query('q'));
  const limit = clampSuggestionLimit(c.req.query('limit'));
  const started = Date.now();

  const { repos, tags } = query
    ? await querySuggestions(c.env, user.id, query)
    : await queryHotSuggestions(c.env, user.id);
  const items = buildSuggestionItems(query, repos, tags, limit);

  return c.json({
    query,
    count: items.length,
    tookMs: Date.now() - started,
    items,
  } satisfies SuggestionResponse);
});

export default searchSuggestions;
