/**
 * 个人技术画像路由（M9-01）。
 *
 * GET /api/tech-profile?months=12
 * - 登录态；只读聚合当前用户的收藏库，不新增表 / 迁移；
 * - 数据来自 D1 `my_repositories`（语言 / Star / Fork / 入库时间 / 最近推送 / 健康度）、
 *   `categories`（分类名）与 `repo_tags` / `tags`（框架识别）；
 * - 聚合逻辑全部在 `src/tech-profile/aggregate.ts` 纯函数中完成。
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { all } from '../db';
import {
  buildTechProfile,
  type TechProfileRepoRow,
  type TechProfileTagRow,
} from '../tech-profile/aggregate';

const techProfile = new Hono<{ Bindings: Env; Variables: Variables }>();

function parseMonths(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) return 12;
  return Math.min(24, Math.max(1, parsed));
}

techProfile.get('/', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const months = parseMonths(c.req.query('months'));

  const repos = await all<TechProfileRepoRow>(
    c.env.DB,
    `SELECT r.id, r.name, r.language, r.stars, r.forks, r.description,
            r.readme_summary, r.created_at, r.pushed_at, r.health_status,
            r.category_id, r.archived, r.html_url,
            c.name AS category_name
       FROM my_repositories r
       LEFT JOIN categories c ON c.id = r.category_id
      WHERE r.user_id = ?
      ORDER BY r.stars DESC, r.id ASC`,
    [user.id]
  );

  const tags = await all<TechProfileTagRow>(
    c.env.DB,
    `SELECT rt.repo_id, t.name
       FROM repo_tags rt
       JOIN tags t ON t.id = rt.tag_id
       JOIN my_repositories r ON r.id = rt.repo_id
      WHERE r.user_id = ?`,
    [user.id]
  );

  return c.json(buildTechProfile(repos, tags, { months }));
});

export default techProfile;
