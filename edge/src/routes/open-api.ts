/**
 * 开放 API（M8-05）
 *
 * 会话（Cookie）令牌管理：
 *   GET    /api/open/tokens        当前用户令牌列表（不含明文）
 *   POST   /api/open/tokens        创建令牌（明文仅返回一次）
 *   DELETE /api/open/tokens/:id    撤销令牌
 *
 * Bearer 个人令牌（Authorization: Bearer ofa_…）：
 *   GET  /api/open/v1/me                 令牌与用户信息
 *   GET  /api/open/v1/repos              收藏列表（搜索 / 分类 / 标签 / 语言 / 分页）
 *   GET  /api/open/v1/repos/:owner/:name 收藏详情
 *   POST /api/open/v1/repos              收藏仓库（需 write 作用域）
 *   GET  /api/open/v1/categories         分类与标签
 *   GET  /api/open/v1/recommendations    推荐列表
 *   GET  /api/open/v1/trending           公开热榜
 *   GET  /api/open/v1/search             收藏 / 热榜关键词检索
 *   GET  /api/open/v1/stats              收藏统计概览
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type {
  Env,
  OpenApiTokenRow,
  RecommendationRow,
  RepoRow,
  TrendingRow,
  TrendingSnapshotRow,
  UserRow,
  Variables,
} from '../types';
import { all, count, first, run } from '../db';
import { sha256Hex } from '../security/crypto';
import { consumeRateLimit, positiveInt } from '../security/rate-limit';
import { toRecommendation } from '../recommend/feedback';
import { toRepoItem } from './repos';
import { toTrendingRepo, toTrendingRepoFromSnapshot } from './trending';
import {
  expiresAtFromDays,
  generateOpenApiToken,
  generateOpenApiTokenId,
  hasScope,
  isOpenApiTokenFormat,
  normalizeBookmarkPayload,
  normalizeExpiryDays,
  normalizeRepoSort,
  normalizeScopes,
  normalizeTokenLabel,
  parseLimit,
  parseOffset,
  parseRepoFullName,
  scopesToString,
  toOpenApiTokenDto,
  tokenHint,
} from '../open-api/helpers';

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

const openApiTokens = new Hono<{ Bindings: Env; Variables: Variables }>();
const openApiV1 = new Hono<{ Bindings: Env; Variables: Variables }>();

const DEFAULT_TOKEN_LIMIT = 20;
const MAX_ACTIVE_TOKENS = 20;
const DEFAULT_OPEN_API_RATE = 120;

async function readJson(c: AppContext): Promise<unknown | null> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

/** LIKE 通配符转义，避免用户输入 % / _ 扩大匹配范围。 */
function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ── 会话：令牌管理 ─────────────────────────────────────────────

openApiTokens.get('/', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const rows = await all<OpenApiTokenRow>(
    c.env.DB,
    `SELECT * FROM open_api_tokens
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 100`,
    [user.id]
  );
  return c.json({ items: rows.map(toOpenApiTokenDto), maxActiveTokens: MAX_ACTIVE_TOKENS });
});

openApiTokens.post('/', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const body = await readJson(c);
  if (body !== null && (typeof body !== 'object' || Array.isArray(body))) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const input = (body ?? {}) as Record<string, unknown>;

  const active = await count(
    c.env.DB,
    'SELECT COUNT(*) AS n FROM open_api_tokens WHERE user_id = ? AND revoked_at IS NULL',
    [user.id]
  );
  if (active >= MAX_ACTIVE_TOKENS) {
    return c.json(
      {
        error: 'too_many_tokens',
        message: `每个用户最多保留 ${MAX_ACTIVE_TOKENS} 个有效令牌`,
      },
      400
    );
  }

  const scopes = normalizeScopes(input.scopes);
  const expiry = normalizeExpiryDays(input.expiresInDays);
  if (!expiry.ok) {
    return c.json({ error: expiry.error, message: 'expiresInDays 需为 0（永不过期）或 1~365 的整数' }, 400);
  }

  const token = generateOpenApiToken();
  const tokenHash = await sha256Hex(token);
  const createdAt = nowIso();
  const row: OpenApiTokenRow = {
    id: generateOpenApiTokenId(),
    user_id: user.id,
    label: normalizeTokenLabel(input.label),
    token_hash: tokenHash,
    hint: tokenHint(token),
    scopes: scopesToString(scopes),
    expires_at: expiresAtFromDays(expiry.days),
    created_at: createdAt,
    last_used_at: null,
    revoked_at: null,
  };

  await run(
    c.env.DB,
    `INSERT INTO open_api_tokens
       (id, user_id, label, token_hash, hint, scopes, expires_at, created_at, last_used_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    [
      row.id,
      row.user_id,
      row.label,
      row.token_hash,
      row.hint,
      row.scopes,
      row.expires_at,
      row.created_at,
    ]
  );

  // 明文令牌只在这里返回一次，服务端不保存。
  return c.json({ token, item: toOpenApiTokenDto(row) }, 201);
});

openApiTokens.delete('/:id', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const id = c.req.param('id');
  const result = await run(
    c.env.DB,
    `UPDATE open_api_tokens
        SET revoked_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    [id, user.id]
  );
  if ((result.meta.changes ?? 0) === 0) {
    return c.json({ error: 'not_found' }, 404);
  }
  return c.json({ ok: true });
});

// ── Bearer 鉴权中间件 ───────────────────────────────────────────

async function resolveBearer(c: AppContext): Promise<{ user: UserRow; token: OpenApiTokenRow } | null> {
  const header = (c.req.header('Authorization') ?? '').trim();
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  const raw = (match[1] ?? '').trim();
  if (!isOpenApiTokenFormat(raw)) return null;

  const hash = await sha256Hex(raw);
  const token = await first<OpenApiTokenRow>(
    c.env.DB,
    'SELECT * FROM open_api_tokens WHERE token_hash = ? AND revoked_at IS NULL',
    [hash]
  );
  if (!token) return null;
  if (token.expires_at && Date.parse(token.expires_at) <= Date.now()) return null;

  const user = await first<UserRow>(c.env.DB, 'SELECT * FROM users WHERE id = ?', [
    token.user_id,
  ]);
  if (!user) return null;
  return { user, token };
}

openApiV1.use('*', async (c, next) => {
  const auth = await resolveBearer(c);
  if (!auth) return c.json({ error: 'unauthorized' }, 401);

  if (!hasScope(auth.token.scopes, 'read')) {
    return c.json({ error: 'insufficient_scope', required: 'read' }, 403);
  }

  // 最近使用时间按分钟节流，避免每个请求都写 D1。
  await run(
    c.env.DB,
    `UPDATE open_api_tokens
        SET last_used_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND (last_used_at IS NULL OR last_used_at < datetime('now', '-1 minute'))`,
    [auth.token.id]
  );

  // 令牌维度固定窗口限流（默认 120 次/分钟）；D1 异常时 fail-open。
  const limit = positiveInt(c.env.OPEN_API_RATE_PER_MINUTE, DEFAULT_OPEN_API_RATE, 1, 100_000);
  try {
    const decision = await consumeRateLimit(
      c.env.DB,
      `openapi:${auth.token.id}`,
      limit,
      60,
      Date.now()
    );
    c.header('X-RateLimit-Limit', String(decision.limit));
    c.header('X-RateLimit-Remaining', String(decision.remaining));
    c.header('X-RateLimit-Reset', String(Math.floor(decision.resetAt / 1000)));
    if (!decision.allowed) {
      c.header('Retry-After', String(decision.retryAfterSeconds));
      return c.json(
        { error: 'rate_limited', retryAfterSeconds: decision.retryAfterSeconds },
        429
      );
    }
  } catch (err) {
    console.error('open api rate limiter unavailable:', err);
  }

  c.set('user', auth.user);
  c.set('openApiToken', auth.token);
  await next();
});

function requireWrite(c: AppContext): Response | null {
  const token = c.get('openApiToken');
  if (!hasScope(token?.scopes, 'write')) {
    return c.json({ error: 'insufficient_scope', required: 'write' }, 403);
  }
  return null;
}

// ── Bearer：账户与资产 ─────────────────────────────────────────

openApiV1.get('/me', (c) => {
  const user = c.get('user');
  const token = c.get('openApiToken');
  if (!user || !token) return c.json({ error: 'unauthorized' }, 401);
  return c.json({
    apiVersion: 'v1',
    user: {
      id: user.id,
      login: user.login,
      name: user.name,
      avatarUrl: user.avatar_url,
    },
    token: toOpenApiTokenDto(token),
  });
});

openApiV1.get('/repos', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const q = (c.req.query('q') ?? '').trim().slice(0, 200);
  const category = (c.req.query('category') ?? '').trim().slice(0, 100);
  const tag = (c.req.query('tag') ?? '').trim().slice(0, 100);
  const language = (c.req.query('language') ?? '').trim().slice(0, 40);
  const sort = normalizeRepoSort(c.req.query('sort'));
  const limit = parseLimit(c.req.query('limit'), 50, 200);
  const offset = parseOffset(c.req.query('offset'));

  const where: string[] = ['r.user_id = ?'];
  const params: Array<string | number | null> = [user.id];

  if (q) {
    const like = likePattern(q);
    where.push(
      "(r.name LIKE ? ESCAPE '\\' OR r.id LIKE ? ESCAPE '\\' OR r.description LIKE ? ESCAPE '\\' OR r.readme_summary LIKE ? ESCAPE '\\')"
    );
    params.push(like, like, like, like);
  }
  if (category) {
    where.push('r.category_id = ?');
    params.push(category);
  }
  if (tag) {
    where.push(
      'EXISTS (SELECT 1 FROM repo_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.repo_id = r.id AND t.name = ?)'
    );
    params.push(tag);
  }
  if (language) {
    where.push('LOWER(r.language) = ?');
    params.push(language.toLowerCase());
  }

  const whereSql = where.join(' AND ');
  const total = await count(
    c.env.DB,
    `SELECT COUNT(*) AS n FROM my_repositories r WHERE ${whereSql}`,
    params
  );

  const orderBy =
    sort === 'updated'
      ? 'COALESCE(r.updated_at, r.synced_at, r.created_at) DESC, r.stars DESC'
      : sort === 'name'
        ? 'r.name COLLATE NOCASE ASC, r.id ASC'
        : 'r.stars DESC, r.updated_at DESC';

  const rows = await all<RepoRow>(
    c.env.DB,
    `SELECT r.*,
            cat.name AS category_name,
            (SELECT GROUP_CONCAT(t.name, ',')
               FROM repo_tags rt JOIN tags t ON t.id = rt.tag_id
              WHERE rt.repo_id = r.id) AS tag_names
       FROM my_repositories r
       LEFT JOIN categories cat ON cat.id = r.category_id
      WHERE ${whereSql}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return c.json({
    items: rows.map(toRepoItem),
    total,
    limit,
    offset,
    hasMore: offset + rows.length < total,
  });
});

openApiV1.get('/repos/:owner/:name', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const owner = c.req.param('owner');
  const name = c.req.param('name');
  const parsed = parseRepoFullName(`${owner}/${name}`);
  if (!parsed) return c.json({ error: 'invalid_repo' }, 400);

  const row = await first<RepoRow>(
    c.env.DB,
    `SELECT r.*,
            cat.name AS category_name,
            (SELECT GROUP_CONCAT(t.name, ',')
               FROM repo_tags rt JOIN tags t ON t.id = rt.tag_id
              WHERE rt.repo_id = r.id) AS tag_names
       FROM my_repositories r
       LEFT JOIN categories cat ON cat.id = r.category_id
      WHERE r.id = ? AND r.user_id = ?`,
    [parsed.fullName, user.id]
  );
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json(toRepoItem(row));
});

openApiV1.post('/repos', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const denied = requireWrite(c);
  if (denied) return denied;

  const body = await readJson(c);
  const normalized = normalizeBookmarkPayload(body);
  if (!normalized.ok) {
    return c.json({ error: normalized.error, message: '仓库信息不合法' }, 400);
  }
  const repo = normalized.repo;

  const existing = await first<{ user_id: string | null }>(
    c.env.DB,
    'SELECT user_id FROM my_repositories WHERE id = ?',
    [repo.id]
  );
  if (existing?.user_id && existing.user_id !== user.id) {
    return c.json(
      {
        error: 'repo_owned_by_other_user',
        message: '该仓库已被其他用户收藏，当前实例不支持重复收藏同一仓库',
      },
      409
    );
  }

  await run(
    c.env.DB,
    `INSERT INTO my_repositories
       (id, platform, name, description, html_url, stars, language, user_id, owner, forks,
        created_at, updated_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       platform = excluded.platform,
       name = excluded.name,
       description = COALESCE(excluded.description, my_repositories.description),
       html_url = excluded.html_url,
       stars = excluded.stars,
       language = COALESCE(excluded.language, my_repositories.language),
       user_id = COALESCE(my_repositories.user_id, excluded.user_id),
       owner = excluded.owner,
       forks = excluded.forks,
       updated_at = CURRENT_TIMESTAMP,
       synced_at = CURRENT_TIMESTAMP`,
    [
      repo.id,
      repo.platform,
      repo.name,
      repo.description,
      repo.url,
      repo.stars,
      repo.language,
      user.id,
      repo.owner,
      repo.forks,
    ]
  );

  return c.json(
    {
      ok: true,
      created: !existing,
      repo: {
        id: repo.id,
        fullName: repo.fullName,
        platform: repo.platform,
        description: repo.description,
        language: repo.language,
        stars: repo.stars,
        forks: repo.forks,
        url: repo.url,
      },
    },
    existing ? 200 : 201
  );
});

openApiV1.get('/categories', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const categories = await all<{
    id: string;
    name: string;
    parent_id: string | null;
    description: string | null;
    sort_order: number | null;
    count: number;
  }>(
    c.env.DB,
    `SELECT c.*, COUNT(r.id) AS count
       FROM categories c
       LEFT JOIN my_repositories r ON r.category_id = c.id AND r.user_id = ?
      GROUP BY c.id
      ORDER BY c.sort_order ASC, c.name ASC`,
    [user.id]
  );

  const tags = await all<{ name: string; count: number }>(
    c.env.DB,
    `SELECT t.name AS name, COUNT(*) AS count
       FROM tags t
       JOIN repo_tags rt ON rt.tag_id = t.id
       JOIN my_repositories r ON r.id = rt.repo_id
      WHERE r.user_id = ?
      GROUP BY t.name
      ORDER BY count DESC, t.name ASC
      LIMIT 100`,
    [user.id]
  );

  return c.json({
    categories: categories.map((row) => ({
      id: row.id,
      name: row.name,
      parentId: row.parent_id ?? null,
      description: row.description ?? null,
      sortOrder: row.sort_order ?? 0,
      count: Number(row.count ?? 0),
    })),
    tags: tags.map((row) => ({ name: row.name, count: Number(row.count ?? 0) })),
  });
});

openApiV1.get('/recommendations', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const rawStatus = (c.req.query('status') ?? 'all').trim().toLowerCase();
  const allowed = ['new', 'saved', 'dismissed', 'pushed', 'all'];
  if (!allowed.includes(rawStatus)) {
    return c.json({ error: 'invalid_status' }, 400);
  }
  const limit = parseLimit(c.req.query('limit'), 50, 100);
  const offset = parseOffset(c.req.query('offset'));

  const where = ['(user_id = ? OR user_id IS NULL)'];
  const params: Array<string | number | null> = [user.id];
  if (rawStatus !== 'all') {
    where.push('status = ?');
    params.push(rawStatus);
  }
  const whereSql = where.join(' AND ');

  const total = await count(
    c.env.DB,
    `SELECT COUNT(*) AS n FROM recommendations WHERE ${whereSql}`,
    params
  );
  const rows = await all<RecommendationRow>(
    c.env.DB,
    `SELECT * FROM recommendations
      WHERE ${whereSql}
      ORDER BY COALESCE(NULLIF(rerank_score, 0), score) DESC, score DESC, created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return c.json({
    items: rows.map(toRecommendation),
    total,
    limit,
    offset,
    hasMore: offset + rows.length < total,
  });
});

openApiV1.get('/trending', async (c) => {
  const rawDate = (c.req.query('date') ?? '').trim();
  if (rawDate && !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    return c.json({ error: 'invalid_date', message: 'date 需为 YYYY-MM-DD' }, 400);
  }
  const language = (c.req.query('language') ?? '').trim().slice(0, 40);
  const limit = parseLimit(c.req.query('limit'), 20, 100);

  let snapshotDate = rawDate;
  if (!snapshotDate) {
    const latest = await first<{ d: string | null }>(
      c.env.DB,
      'SELECT MAX(snapshot_date) AS d FROM trending_snapshots'
    );
    snapshotDate = latest?.d ?? '';
  }

  if (snapshotDate) {
    const where = ['s.snapshot_date = ?'];
    const params: Array<string | number> = [snapshotDate];
    if (language) {
      where.push('LOWER(s.language) = ?');
      params.push(language.toLowerCase());
    }
    params.push(limit);
    const rows = await all<TrendingSnapshotRow>(
      c.env.DB,
      `SELECT s.*,
              r.license_spdx AS license_spdx,
              r.license_name AS license_name,
              r.license_source AS license_source,
              r.license_checked_at AS license_checked_at
         FROM trending_snapshots s
         LEFT JOIN trending_repositories r ON r.id = s.repo_id
        WHERE ${where.join(' AND ')}
        ORDER BY s.rank ASC, s.repo_id ASC
        LIMIT ?`,
      params
    );
    if (rows.length > 0) {
      return c.json({
        items: rows.map(toTrendingRepoFromSnapshot),
        snapshotDate,
        count: rows.length,
      });
    }
    if (rawDate || language) {
      return c.json({ items: [], snapshotDate, count: 0 });
    }
  }

  const where: string[] = [];
  const params: Array<string | number> = [];
  if (language) {
    where.push('LOWER(language) = ?');
    params.push(language.toLowerCase());
  }
  params.push(limit);
  const rows = await all<TrendingRow>(
    c.env.DB,
    `SELECT * FROM trending_repositories
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY stars_today DESC, stars DESC
      LIMIT ?`,
    params
  );
  return c.json({
    items: rows.map((row, index) => toTrendingRepo(row, index + 1)),
    snapshotDate: snapshotDate || null,
    count: rows.length,
  });
});

interface SearchItem {
  id: string;
  source: 'my' | 'trending';
  fullName: string;
  name: string;
  description: string | null;
  language: string | null;
  stars: number;
  starsToday: number;
  url: string;
  score: number;
}

function keywordScore(query: string, name: string, id: string, description: string | null): number {
  const q = query.toLowerCase();
  const lowerName = name.toLowerCase();
  const lowerId = id.toLowerCase();
  const lowerDesc = (description ?? '').toLowerCase();
  if (lowerName === q || lowerId === q) return 1;
  if (lowerName.startsWith(q) || lowerId.startsWith(q)) return 0.9;
  if (lowerName.includes(q) || lowerId.includes(q)) return 0.75;
  if (lowerDesc.includes(q)) return 0.5;
  return 0.3;
}

openApiV1.get('/search', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const q = (c.req.query('q') ?? '').trim();
  if (!q || q.length > 200) {
    return c.json({ error: 'invalid_query', message: 'q 需为 1~200 字符' }, 400);
  }
  const rawScope = (c.req.query('scope') ?? 'all').trim().toLowerCase();
  const scope = rawScope === 'my' || rawScope === 'trending' ? rawScope : 'all';
  const language = (c.req.query('language') ?? '').trim().slice(0, 40);
  const limit = parseLimit(c.req.query('limit'), 20, 50);
  const like = likePattern(q);
  const items: SearchItem[] = [];

  if (scope === 'my' || scope === 'all') {
    const where = [
      'r.user_id = ?',
      "(r.name LIKE ? ESCAPE '\\' OR r.id LIKE ? ESCAPE '\\' OR r.description LIKE ? ESCAPE '\\' OR r.readme_summary LIKE ? ESCAPE '\\')",
    ];
    const params: Array<string | number> = [user.id, like, like, like, like];
    if (language) {
      where.push('LOWER(r.language) = ?');
      params.push(language.toLowerCase());
    }
    params.push(limit * 4);
    const rows = await all<RepoRow>(
      c.env.DB,
      `SELECT r.* FROM my_repositories r
        WHERE ${where.join(' AND ')}
        ORDER BY r.stars DESC
        LIMIT ?`,
      params
    );
    for (const row of rows) {
      const owner = row.owner ?? row.id.split('/')[0] ?? '';
      const fullName = owner && row.name ? `${owner}/${row.name}` : row.id;
      items.push({
        id: row.id,
        source: 'my',
        fullName,
        name: row.name,
        description: row.description,
        language: row.language,
        stars: row.stars ?? 0,
        starsToday: 0,
        url: row.html_url,
        score: keywordScore(q, row.name, row.id, row.description),
      });
    }
  }

  if (scope === 'trending' || scope === 'all') {
    const where = [
      "(name LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR tech_stack LIKE ? ESCAPE '\\')",
    ];
    const params: Array<string | number> = [like, like, like, like];
    if (language) {
      where.push('LOWER(language) = ?');
      params.push(language.toLowerCase());
    }
    params.push(limit * 4);
    const rows = await all<TrendingRow>(
      c.env.DB,
      `SELECT * FROM trending_repositories
        WHERE ${where.join(' AND ')}
        ORDER BY stars_today DESC, stars DESC
        LIMIT ?`,
      params
    );
    for (const row of rows) {
      const owner = row.owner ?? row.id.split('/')[0] ?? '';
      items.push({
        id: row.id,
        source: 'trending',
        fullName: owner && row.name ? `${owner}/${row.name}` : row.id,
        name: row.name,
        description: row.description,
        language: row.language,
        stars: row.stars ?? 0,
        starsToday: row.stars_today ?? 0,
        url: row.html_url,
        score: keywordScore(q, row.name, row.id, row.description),
      });
    }
  }

  items.sort((a, b) => b.score - a.score || b.stars - a.stars);
  return c.json({
    query: q,
    scope,
    count: Math.min(items.length, limit),
    items: items.slice(0, limit),
  });
});

openApiV1.get('/stats', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const summary = await first<{ total: number; stars: number; withSummary: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(stars), 0) AS stars,
            SUM(CASE WHEN readme_summary IS NOT NULL AND readme_summary <> '' THEN 1 ELSE 0 END) AS withSummary
       FROM my_repositories
      WHERE user_id = ?`,
    [user.id]
  );

  const languages = await all<{ language: string; count: number }>(
    c.env.DB,
    `SELECT language, COUNT(*) AS count
       FROM my_repositories
      WHERE user_id = ? AND language IS NOT NULL AND language <> ''
      GROUP BY language
      ORDER BY count DESC, language ASC
      LIMIT 10`,
    [user.id]
  );
  const categories = await all<{ name: string; count: number }>(
    c.env.DB,
    `SELECT c.name AS name, COUNT(r.id) AS count
       FROM categories c
       JOIN my_repositories r ON r.category_id = c.id AND r.user_id = ?
      GROUP BY c.id
      ORDER BY count DESC, c.name ASC
      LIMIT 10`,
    [user.id]
  );
  const tags = await all<{ name: string; count: number }>(
    c.env.DB,
    `SELECT t.name AS name, COUNT(*) AS count
       FROM tags t
       JOIN repo_tags rt ON rt.tag_id = t.id
       JOIN my_repositories r ON r.id = rt.repo_id
      WHERE r.user_id = ?
      GROUP BY t.name
      ORDER BY count DESC, t.name ASC
      LIMIT 20`,
    [user.id]
  );

  const languageCount = await count(
    c.env.DB,
    `SELECT COUNT(DISTINCT language) AS n FROM my_repositories
      WHERE user_id = ? AND language IS NOT NULL AND language <> ''`,
    [user.id]
  );
  const categoryCount = await count(
    c.env.DB,
    'SELECT COUNT(DISTINCT category_id) AS n FROM my_repositories WHERE user_id = ? AND category_id IS NOT NULL',
    [user.id]
  );
  const tagCount = await count(
    c.env.DB,
    `SELECT COUNT(DISTINCT t.name) AS n
       FROM tags t JOIN repo_tags rt ON rt.tag_id = t.id
       JOIN my_repositories r ON r.id = rt.repo_id
      WHERE r.user_id = ?`,
    [user.id]
  );

  return c.json({
    totalRepos: Number(summary?.total ?? 0),
    totalStars: Number(summary?.stars ?? 0),
    withSummary: Number(summary?.withSummary ?? 0),
    languageCount,
    categoryCount,
    tagCount,
    languages: languages.map((row) => ({ language: row.language, count: Number(row.count ?? 0) })),
    categories: categories.map((row) => ({ name: row.name, count: Number(row.count ?? 0) })),
    tags: tags.map((row) => ({ name: row.name, count: Number(row.count ?? 0) })),
    generatedAt: nowIso(),
  });
});

export { openApiTokens, openApiV1 };
export default openApiTokens;
