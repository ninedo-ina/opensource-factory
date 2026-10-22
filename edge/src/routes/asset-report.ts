/**
 * 资产报表路由（M9-02 / REQ-202610-0979）。
 *
 * GET /api/asset-report?months=6|12|24
 * - 登录态；只读聚合当前用户收藏，不新增表 / 迁移；
 * - 收录量与分类分布来自 `my_repositories` / `categories`；
 * - Star 趋势复用 M7-05 `trending_snapshots`（按 repo_id 分片查询，scope=my）；
 * - 聚合逻辑全部在 `src/asset-report/aggregate.ts` 纯函数中完成。
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { all } from '../db';
import type { StarSnapshotRow } from '../insights/star-trends';
import {
  buildAssetReport,
  normalizeMonths,
  starTrendDays,
  type AssetReportCategoryRow,
  type AssetReportRepoRow,
} from '../asset-report/aggregate';

const assetReport = new Hono<{ Bindings: Env; Variables: Variables }>();

const MY_CHUNK_SIZE = 50;
const SNAPSHOT_COLUMNS = `snapshot_date, repo_id, owner, name, html_url, description,
  language, stars, stars_today, rank, language_rank, star_delta, rank_delta,
  appearances, is_new, trend`;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function cutoffDate(days: number, now = new Date()): string {
  const start = new Date(now.getTime() - (days - 1) * 86400000);
  return start.toISOString().slice(0, 10);
}

async function loadSnapshots(
  db: D1Database,
  repoIds: readonly string[],
  cutoff: string
): Promise<StarSnapshotRow[]> {
  const rows: StarSnapshotRow[] = [];
  for (const ids of chunk(repoIds, MY_CHUNK_SIZE)) {
    if (ids.length === 0) continue;
    const placeholders = ids.map(() => '?').join(', ');
    rows.push(
      ...(await all<StarSnapshotRow>(
        db,
        `SELECT ${SNAPSHOT_COLUMNS}
           FROM trending_snapshots
          WHERE snapshot_date >= ?
            AND repo_id IN (${placeholders})
          ORDER BY snapshot_date ASC, repo_id ASC
          LIMIT 5000`,
        [cutoff, ...ids]
      ))
    );
  }
  return rows;
}

assetReport.get('/', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const months = normalizeMonths(c.req.query('months'));
  const days = starTrendDays(months);

  const repos = await all<AssetReportRepoRow>(
    c.env.DB,
    `SELECT id, platform, name, owner, html_url, stars, forks, language,
            category_id, created_at, pushed_at, archived, health_status
       FROM my_repositories
      WHERE user_id = ?
      ORDER BY created_at ASC, id ASC`,
    [user.id]
  );
  const categories = await all<AssetReportCategoryRow>(
    c.env.DB,
    'SELECT id, name FROM categories'
  );
  const snapshots = await loadSnapshots(
    c.env.DB,
    repos.map((repo) => repo.id),
    cutoffDate(days)
  );

  return c.json(
    buildAssetReport(repos, categories, snapshots, { months, now: new Date() })
  );
});

export default assetReport;
