/**
 * 开放 API v1（M8-05 / M8-06）
 *
 * 鉴权：Authorization: Bearer ofp_…（个人令牌，scope: read / write）；
 * 也兼容浏览器会话，便于后台调试。
 *
 *   GET    /api/v1/me
 *   GET    /api/v1/repos?q=&language=&category=&tag=&limit=&offset=
 *   GET    /api/v1/repos/:owner/:name
 *   POST   /api/v1/repos            收藏仓库（幂等）
 *   DELETE /api/v1/repos/:owner/:name
 *   GET    /api/v1/search?q=&limit=
 *   GET    /api/v1/trending?language=&limit=
 *   GET    /api/v1/recommendations?status=&limit=
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, RecommendationRow, RepoRow, TrendingRow, TrendingSnapshotRow, Variables } from '../types';
import { all, count, first, run } from '../db';
import { requireApiScope } from '../api-tokens/auth';
import {
  normalizeCount,
  normalizeText,
  parseRepoReference,
  toApiTokenDto,
  type RepoReference,
} from '../api-tokens/helpers';
import { normalizeStatusFilter, toRecommendation } from '../recommend/feedback';

const v1 = new Hono<{ Bindings: Env; Variables: Variables }>();

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_OFFSET = 10_000;

interface ApiRepo {
  id: string;
  fullName: string;
  description: string | null;
  summary: string | null;
  language: string | null;
  stars: number;
  forks: number;
  category: string | null;
  tags: string[];
  url: string;
  updatedAt: string | null;
  createdAt: string | null;
}

interface ApiRepoFilters {
  q?: string;
  language?: string;
  category?: string;
  tag?: string;
}

function parseLimit(raw: string | undefined, fallback = DEFAULT_LIMIT): number {
  const num = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.min(num, MAX_LIMIT);
}

function parseOffset(raw: string | undefined): number {
  const num = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.min(num, MAX_OFFSET);
}

function toApiRepo(row: RepoRow): ApiRepo {
  const owner = row.owner ?? row.id.split('/')[0] ?? '';
  const fullName = owner && row.name ? `${owner}/${row.name}` : row.id;
  const tags = row.tag_names
    ? row.tag_names
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];
  return {
    id: row.id,
    fullName,
    description: row.description ?? null,
    summary: row.readme_summary ?? null,
    language: row.language ?? null,
    stars: row.stars ?? 0,
    forks: row.forks ?? 0,
    category: row.category_name ?? row.category_id ?? null,
    tags,
    url: row.html_url,
    updatedAt: row.updated_at ?? row.synced_at ?? row.created_at ?? null,
    createdAt: row.created_at ?? null,
  };
}

function buildRepoWhere(
  userId: string,
  filters: ApiRepoFilters
): { where: string[]; params: Array<string | number | null> } {
  const where = ['r.user_id = ?'];
  const params: Array<string | number | null> = [userId];

  const q = filters.q?.trim();
  if (q) {
    const like = `%${q}%`;
    where.push('(r.name LIKE ? OR r.id LIKE ? OR r.description LIKE ? OR r.readme_summary LIKE ?)');
    params.push(like, like, like, like);
  }
  const language = filters.language?.trim();
  if (language) {
    where.push('LOWER(r.language) = LOWER(?)');
    params.push(language);
  }
  const category = filters.category?.trim();
  if (category) {
    where.push('(r.category_id = ? OR LOWER(cat.name) = LOWER(?))');
    params.push(category, category);
  }
  const tag = filters.tag?.trim();
  if (tag) {
    where.push(
      `EXISTS (
         SELECT 1 FROM repo_tags rt JOIN tags t ON t.id = rt.tag_id
          WHERE rt.repo_id = r.id AND LOWER(t.name) = LOWER(?)
       )`
    );
    params.push(tag);
  }
  return { where, params };
}

const REPO_SELECT = `SELECT r.*,
       cat.name AS category_name,
       (SELECT GROUP_CONCAT(t.name, ',')
          FROM repo_tags rt JOIN tags t ON t.id = rt.tag_id
         WHERE rt.repo_id = r.id) AS tag_names
  FROM my_repositories r
  LEFT JOIN categories cat ON cat.id = r.category_id`;

async function findOwnedRepo(
  db: D1Database,
  userId: string,
  fullName: string
): Promise<RepoRow | null> {
  return first<RepoRow>(
    db,
    `${REPO_SELECT} WHERE r.id = ? AND r.user_id = ?`,
    [fullName, userId]
  );
}

async function upsertFavorite(
  c: AppContext,
  userId: string,
  repo: RepoReference,
  body: Record<string, unknown>
): Promise<{ created: boolean; conflict: boolean; repo: ApiRepo }> {
  const existing = await first<{ user_id: string | null }>(
    c.env.DB,
    'SELECT user_id FROM my_repositories WHERE id = ?',
    [repo.fullName]
  );
  if (existing?.user_id && existing.user_id !== userId) {
    return { created: false, conflict: true, repo: { ...emptyRepo(repo) } };
  }

  const description = normalizeText(body.description, 500);
  const language = normalizeText(body.language, 40);
  const stars = normalizeCount(body.stars);
  const forks = normalizeCount(body.forks);
  const now = new Date().toISOString();

  if (!existing) {
    await run(
      c.env.DB,
      `INSERT INTO my_repositories
         (id, platform, name, description, html_url, stars, language, readme_summary,
          category_id, user_id, owner, forks, created_at, updated_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)`,
      [
        repo.fullName,
        repo.platform,
        repo.name,
        description,
        repo.url,
        stars,
        language,
        userId,
        repo.owner,
        forks,
        now,
        now,
        now,
      ]
    );
  } else {
    await run(
      c.env.DB,
      `UPDATE my_repositories
          SET platform = ?,
              name = ?,
              description = COALESCE(?, description),
              html_url = ?,
              language = COALESCE(?, language),
              stars = CASE WHEN ? > 0 THEN ? ELSE stars END,
              forks = CASE WHEN ? > 0 THEN ? ELSE forks END,
              user_id = COALESCE(user_id, ?),
              owner = ?,
              updated_at = ?,
              synced_at = ?
        WHERE id = ?`,
      [
        repo.platform,
        repo.name,
        description,
        repo.url,
        language,
        stars,
        stars,
        forks,
        forks,
        userId,
        repo.owner,
        now,
        now,
        repo.fullName,
      ]
    );
  }

  const row = await findOwnedRepo(c.env.DB, userId, repo.fullName);
  return {
    created: !existing,
    conflict: false,
    repo: row ? toApiRepo(row) : emptyRepo(repo),
  };
}

function emptyRepo(repo: RepoReference): ApiRepo {
  return {
    id: repo.fullName,
    fullName: repo.fullName,
    description: null,
    summary: null,
    language: null,
    stars: 0,
    forks: 0,
    category: null,
    tags: [],
    url: repo.url,
    updatedAt: null,
    createdAt: null,
  };
}

async function readJson(c: AppContext): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// ── /me ─────────────────────────────────────────────────────────

v1.get('/me', (c) => {
  const denied = requireApiScope(c, 'read');
  if (denied) return denied;
  const user = c.get('user')!;
  const token = c.get('apiToken');
  return c.json({
    user: {
      id: user.id,
      login: user.login,
      name: user.name,
      avatarUrl: user.avatar_url,
    },
    token: token ? toApiTokenDto(token) : null,
  });
});

// ── 收藏列表 / 详情 / 收藏 / 取消 ───────────────────────────────

v1.get('/repos', async (c) => {
  const denied = requireApiScope(c, 'read');
  if (denied) return denied;
  const user = c.get('user')!;

  const filters: ApiRepoFilters = {
    q: c.req.query('q'),
    language: c.req.query('language'),
    category: c.req.query('category'),
    tag: c.req.query('tag'),
  };
  const limit = parseLimit(c.req.query('limit'));
  const offset = parseOffset(c.req.query('offset'));
  const { where, params } = buildRepoWhere(user.id, filters);

  const total = await count(
    c.env.DB,
    `SELECT COUNT(*) AS n
       FROM my_repositories r
       LEFT JOIN categories cat ON cat.id = r.category_id
      WHERE ${where.join(' AND ')}`,
    params
  );
  const rows = await all<RepoRow>(
    c.env.DB,
    `${REPO_SELECT}
      WHERE ${where.join(' AND ')}
      ORDER BY r.stars DESC, r.updated_at DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return c.json({
    total,
    limit,
    offset,
    items: rows.map(toApiRepo),
  });
});

v1.get('/repos/:owner/:name', async (c) => {
  const denied = requireApiScope(c, 'read');
  if (denied) return denied;
  const user = c.get('user')!;

  const parsed = parseRepoReference(`${c.req.param('owner')}/${c.req.param('name')}`);
  if (!parsed) return c.json({ error: 'invalid_repo' }, 400);
  const row = await findOwnedRepo(c.env.DB, user.id, parsed.fullName);
  if (!row) return c.json({ error: 'not_found', repoId: parsed.fullName }, 404);
  return c.json(toApiRepo(row));
});

v1.post('/repos', async (c) => {
  const denied = requireApiScope(c, 'write');
  if (denied) return denied;
  const user = c.get('user')!;

  const body = await readJson(c);
  if (body === null) return c.json({ error: 'invalid_body' }, 400);

  const parsed = parseRepoReference(body.repo ?? body.fullName ?? body.url ?? body.id);
  if (!parsed) return c.json({ error: 'invalid_repo' }, 400);

  const result = await upsertFavorite(c, user.id, parsed, body);
  if (result.conflict) {
    return c.json(
      {
        error: 'repo_owned_by_other_user',
        message: '该仓库已被其他用户收藏，当前实例不支持重复收藏同一仓库',
        repoId: parsed.fullName,
      },
      409
    );
  }
  return c.json(
    { created: result.created, repo: result.repo },
    result.created ? 201 : 200
  );
});

v1.delete('/repos/:owner/:name', async (c) => {
  const denied = requireApiScope(c, 'write');
  if (denied) return denied;
  const user = c.get('user')!;

  const parsed = parseRepoReference(`${c.req.param('owner')}/${c.req.param('name')}`);
  if (!parsed) return c.json({ error: 'invalid_repo' }, 400);

  const result = await run(
    c.env.DB,
    'DELETE FROM my_repositories WHERE id = ? AND user_id = ?',
    [parsed.fullName, user.id]
  );
  if ((result.meta.changes ?? 0) === 0) {
    return c.json({ error: 'not_found', repoId: parsed.fullName }, 404);
  }
  return c.json({ removed: true, repoId: parsed.fullName });
});

// ── 搜索 ────────────────────────────────────────────────────────

v1.get('/search', async (c) => {
  const denied = requireApiScope(c, 'read');
  if (denied) return denied;
  const user = c.get('user')!;

  const q = (c.req.query('q') ?? '').trim();
  if (!q) return c.json({ error: 'invalid_query', message: 'q 不能为空' }, 400);
  const limit = parseLimit(c.req.query('limit'), 20);
  const like = `%${q}%`;

  const rows = await all<RepoRow & { relevance?: number }>(
    c.env.DB,
    `SELECT r.*,
            cat.name AS category_name,
            (SELECT GROUP_CONCAT(t.name, ',')
               FROM repo_tags rt JOIN tags t ON t.id = rt.tag_id
              WHERE rt.repo_id = r.id) AS tag_names,
            CASE
              WHEN LOWER(r.name) = LOWER(?) THEN 0
              WHEN LOWER(r.name) LIKE LOWER(?) THEN 1
              WHEN LOWER(r.id) LIKE LOWER(?) THEN 2
              WHEN LOWER(r.description) LIKE LOWER(?) THEN 3
              ELSE 4
            END AS relevance
       FROM my_repositories r
       LEFT JOIN categories cat ON cat.id = r.category_id
      WHERE r.user_id = ?
        AND (r.name LIKE ? OR r.id LIKE ? OR r.description LIKE ? OR r.readme_summary LIKE ?)
      ORDER BY relevance ASC, r.stars DESC, r.updated_at DESC
      LIMIT ?`,
    [
      q,
      `${q}%`,
      `${q}%`,
      like,
      user.id,
      like,
      like,
      like,
      like,
      limit,
    ]
  );

  return c.json({
    query: q,
    count: rows.length,
    items: rows.map(toApiRepo),
  });
});

// ── 热榜 ────────────────────────────────────────────────────────

v1.get('/trending', async (c) => {
  const denied = requireApiScope(c, 'read');
  if (denied) return denied;

  const limit = parseLimit(c.req.query('limit'), 20);
  const language = (c.req.query('language') ?? '').trim();
  const latest = await first<{ d: string | null }>(
    c.env.DB,
    'SELECT MAX(snapshot_date) AS d FROM trending_snapshots'
  );

  if (latest?.d) {
    const where = ['snapshot_date = ?'];
    const params: Array<string | number | null> = [latest.d];
    if (language) {
      where.push('LOWER(language) = LOWER(?)');
      params.push(language);
    }
    params.push(limit);
    const rows = await all<TrendingSnapshotRow>(
      c.env.DB,
      `SELECT * FROM trending_snapshots
        WHERE ${where.join(' AND ')}
        ORDER BY rank ASC
        LIMIT ?`,
      params
    );
    return c.json({
      date: latest.d,
      items: rows.map((row) => ({
        id: row.repo_id,
        fullName: row.repo_id,
        description: row.description ?? null,
        language: row.language ?? null,
        stars: row.stars ?? 0,
        starsToday: row.stars_today ?? 0,
        url: row.html_url,
        rank: row.rank ?? 0,
        trend: row.is_new ? 'new' : (row.rank_delta ?? 0) > 0 ? 'up' : (row.rank_delta ?? 0) < 0 ? 'down' : 'same',
      })),
    });
  }

  const where = language ? 'WHERE LOWER(language) = LOWER(?)' : '';
  const params: Array<string | number | null> = language ? [language, limit] : [limit];
  const rows = await all<TrendingRow>(
    c.env.DB,
    `SELECT * FROM trending_repositories
      ${where}
      ORDER BY stars_today DESC, stars DESC
      LIMIT ?`,
    params
  );
  return c.json({
    date: null,
    items: rows.map((row) => ({
      id: row.id,
      fullName: row.id,
      description: row.description ?? null,
      language: row.language ?? null,
      stars: row.stars ?? 0,
      starsToday: row.stars_today ?? 0,
      url: row.html_url,
      rank: 0,
      trend: 'same',
    })),
  });
});

// ── 推荐 ────────────────────────────────────────────────────────

v1.get('/recommendations', async (c) => {
  const denied = requireApiScope(c, 'read');
  if (denied) return denied;
  const user = c.get('user')!;

  const limit = parseLimit(c.req.query('limit'), 20);
  const status = normalizeStatusFilter(c.req.query('status'));
  const where = ['(user_id = ? OR user_id IS NULL)'];
  const params: Array<string | number | null> = [user.id];
  if (status !== 'all') {
    where.push('status = ?');
    params.push(status);
  }
  params.push(limit);

  const rows = await all<RecommendationRow>(
    c.env.DB,
    `SELECT * FROM recommendations
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(NULLIF(rerank_score, 0), score) DESC, score DESC, created_at DESC
      LIMIT ?`,
    params
  );

  return c.json({
    status,
    items: rows.map(toRecommendation),
  });
});

export default v1;
