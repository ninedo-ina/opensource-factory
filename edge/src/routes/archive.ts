/**
 * 全量导出与归档路由（M9-04）
 * GET /summary   归档数据集统计（登录态）
 * GET /manifest  仅返回归档 manifest（登录态）
 * GET /          生成并下载 `openfactory.archive.v1`（ZIP / JSON）
 *
 * 只读聚合：不新增表、不写 D1；所有 SQL 一律按 user_id 隔离。
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../types';
import { all, count, first } from '../db';
import {
  buildArchive,
  buildArchiveManifest,
  normalizeArchiveOptions,
  type ArchiveInput,
  type ArchiveScope,
} from '../archive/build';

type ArchiveContext = Context<{ Bindings: Env; Variables: Variables }>;
type Row = Record<string, unknown>;

interface DatasetDefinition {
  key: string;
  label: string;
  /** true 表示知识库范围也包含该数据集 */
  knowledge: boolean;
  load: (db: D1Database, userId: string) => Promise<unknown[]>;
  count: (db: D1Database, userId: string) => Promise<number>;
}

const TAG_ROWS_SQL = `
  SELECT t.id AS id, t.name AS name, rt.repo_id AS repo_id
    FROM tags t
    JOIN repo_tags rt ON rt.tag_id = t.id
    JOIN my_repositories r ON r.id = rt.repo_id
   WHERE r.user_id = ?
   ORDER BY t.name ASC, rt.repo_id ASC`;

const DATASETS: DatasetDefinition[] = [
  {
    key: 'profile',
    label: '账号资料',
    knowledge: true,
    load: async (db, userId) => {
      const row = await first<Row>(
        db,
        'SELECT id, login, name, email, avatar_url, created_at FROM users WHERE id = ?',
        [userId]
      );
      return row ? [row] : [];
    },
    count: (db, userId) => count(db, 'SELECT COUNT(*) AS n FROM users WHERE id = ?', [userId]),
  },
  {
    key: 'repositories',
    label: '收藏仓库',
    knowledge: true,
    load: (db, userId) =>
      all<Row>(
        db,
        `SELECT r.*,
                cat.name AS category_name,
                (SELECT GROUP_CONCAT(t.name, ',')
                   FROM repo_tags rt JOIN tags t ON t.id = rt.tag_id
                  WHERE rt.repo_id = r.id) AS tag_names
           FROM my_repositories r
           LEFT JOIN categories cat ON cat.id = r.category_id
          WHERE r.user_id = ?
          ORDER BY r.stars DESC, r.id ASC`,
        [userId]
      ),
    count: (db, userId) =>
      count(db, 'SELECT COUNT(*) AS n FROM my_repositories WHERE user_id = ?', [userId]),
  },
  {
    key: 'categories',
    label: '分类',
    knowledge: true,
    load: (db, userId) =>
      all<Row>(
        db,
        `SELECT c.id, c.name, c.parent_id, c.description, c.sort_order
           FROM categories c
          WHERE c.id IN (
                SELECT DISTINCT category_id FROM my_repositories
                 WHERE user_id = ? AND category_id IS NOT NULL)
          ORDER BY c.name ASC, c.id ASC`,
        [userId]
      ),
    count: (db, userId) =>
      count(
        db,
        `SELECT COUNT(*) AS n FROM categories c
          WHERE c.id IN (
                SELECT DISTINCT category_id FROM my_repositories
                 WHERE user_id = ? AND category_id IS NOT NULL)`,
        [userId]
      ),
  },
  {
    key: 'tags',
    label: '标签',
    knowledge: true,
    load: async (db, userId) => {
      const rows = await all<{ id: number; name: string; repo_id: string }>(db, TAG_ROWS_SQL, [
        userId,
      ]);
      const grouped = new Map<number, { id: number; name: string; repoIds: string[] }>();
      for (const row of rows) {
        const existing = grouped.get(row.id);
        if (existing) existing.repoIds.push(row.repo_id);
        else grouped.set(row.id, { id: row.id, name: row.name, repoIds: [row.repo_id] });
      }
      return [...grouped.values()];
    },
    count: (db, userId) =>
      count(
        db,
        `SELECT COUNT(DISTINCT t.id) AS n
           FROM tags t
           JOIN repo_tags rt ON rt.tag_id = t.id
           JOIN my_repositories r ON r.id = rt.repo_id
          WHERE r.user_id = ?`,
        [userId]
      ),
  },
  {
    key: 'recommendations',
    label: '智能推荐',
    knowledge: false,
    load: (db, userId) =>
      all<Row>(
        db,
        'SELECT * FROM recommendations WHERE user_id = ? ORDER BY created_at DESC, id ASC',
        [userId]
      ),
    count: (db, userId) =>
      count(db, 'SELECT COUNT(*) AS n FROM recommendations WHERE user_id = ?', [userId]),
  },
  {
    key: 'recommendation-feedback',
    label: '推荐反馈',
    knowledge: false,
    load: (db, userId) =>
      all<Row>(
        db,
        `SELECT * FROM recommendation_feedback
          WHERE user_id = ? ORDER BY created_at DESC, id ASC`,
        [userId]
      ),
    count: (db, userId) =>
      count(db, 'SELECT COUNT(*) AS n FROM recommendation_feedback WHERE user_id = ?', [userId]),
  },
  {
    key: 'notifications',
    label: '站内通知',
    knowledge: false,
    load: (db, userId) =>
      all<Row>(
        db,
        'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id ASC',
        [userId]
      ),
    count: (db, userId) =>
      count(db, 'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?', [userId]),
  },
  {
    key: 'push-preferences',
    label: '推送偏好',
    knowledge: false,
    load: (db, userId) =>
      all<Row>(db, 'SELECT * FROM push_preferences WHERE user_id = ?', [userId]),
    count: (db, userId) =>
      count(db, 'SELECT COUNT(*) AS n FROM push_preferences WHERE user_id = ?', [userId]),
  },
  {
    key: 'reports',
    label: '精选报告',
    knowledge: false,
    load: (db, userId) =>
      all<Row>(
        db,
        `SELECT * FROM curated_reports
          WHERE user_id = ? ORDER BY generated_at DESC, id ASC`,
        [userId]
      ),
    count: (db, userId) =>
      count(db, 'SELECT COUNT(*) AS n FROM curated_reports WHERE user_id = ?', [userId]),
  },
  {
    key: 'repo-updates',
    label: '更新提醒',
    knowledge: false,
    load: (db, userId) =>
      all<Row>(
        db,
        `SELECT * FROM repo_updates
          WHERE user_id = ? ORDER BY detected_at DESC, id ASC`,
        [userId]
      ),
    count: (db, userId) =>
      count(db, 'SELECT COUNT(*) AS n FROM repo_updates WHERE user_id = ?', [userId]),
  },
  {
    key: 'duplicate-dismissals',
    label: '重复检测忽略记录',
    knowledge: false,
    load: (db, userId) =>
      all<Row>(
        db,
        `SELECT * FROM duplicate_dismissals
          WHERE user_id = ? ORDER BY created_at DESC, id ASC`,
        [userId]
      ),
    count: (db, userId) =>
      count(db, 'SELECT COUNT(*) AS n FROM duplicate_dismissals WHERE user_id = ?', [userId]),
  },
];

function scopedDatasets(scope: ArchiveScope): DatasetDefinition[] {
  return scope === 'knowledge' ? DATASETS.filter((dataset) => dataset.knowledge) : DATASETS;
}

async function buildInput(c: ArchiveContext, scope: ArchiveScope, format: 'zip' | 'json') {
  const user = c.get('user');
  if (!user) return null;

  const generatedAt = new Date().toISOString();
  const datasets = [];
  for (const dataset of scopedDatasets(scope)) {
    datasets.push({
      key: dataset.key,
      label: dataset.label,
      records: await dataset.load(c.env.DB, user.id),
    });
  }

  const input: ArchiveInput = {
    generatedAt,
    scope,
    format,
    user: {
      id: user.id,
      login: user.login,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatar_url,
      createdAt: user.created_at,
    },
    datasets,
  };
  return input;
}

const archiveRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

archiveRoutes.get('/summary', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const datasets = [];
  for (const dataset of DATASETS) {
    datasets.push({
      key: dataset.key,
      label: dataset.label,
      knowledge: dataset.knowledge,
      records: await dataset.count(c.env.DB, user.id),
    });
  }
  const totalRecords = datasets.reduce((sum, dataset) => sum + dataset.records, 0);

  return c.json(
    {
      schema: 'openfactory.archive.v1',
      version: 1,
      generatedAt: new Date().toISOString(),
      datasets,
      totalRecords,
      // 按每条记录约 512 字节估算；精确字节以 manifest 为准。
      estimatedBytes: totalRecords * 512,
      scopes: [
        { key: 'full', label: '完整归档', datasets: DATASETS.length },
        { key: 'knowledge', label: '知识库归档', datasets: scopedDatasets('knowledge').length },
      ],
      formats: ['zip', 'json'],
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
});

archiveRoutes.get('/manifest', async (c) => {
  const options = normalizeArchiveOptions({
    scope: c.req.query('scope'),
    format: c.req.query('format'),
  });
  const input = await buildInput(c, options.scope, options.format);
  if (!input) return c.json({ error: 'unauthorized' }, 401);

  const manifest = await buildArchiveManifest(input);
  return c.json(manifest, { headers: { 'Cache-Control': 'no-store' } });
});

archiveRoutes.get('/', async (c) => {
  const options = normalizeArchiveOptions({
    scope: c.req.query('scope'),
    format: c.req.query('format'),
  });
  const input = await buildInput(c, options.scope, options.format);
  if (!input) return c.json({ error: 'unauthorized' }, 401);

  const bundle = await buildArchive(input);
  return new Response(bundle.body as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': bundle.contentType,
      'Content-Disposition': `attachment; filename="${bundle.fileName}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

export default archiveRoutes;
