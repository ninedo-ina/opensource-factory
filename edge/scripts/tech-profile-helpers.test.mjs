import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTechProfile,
  monthKey,
  parseProfileDate,
  shiftMonth,
} from '../src/tech-profile/aggregate.ts';

const NOW = new Date('2026-10-22T10:00:00Z');

function repo(id, language, extra = {}) {
  return {
    id,
    name: id.split('/')[1] ?? id,
    language,
    stars: 0,
    forks: 0,
    description: '',
    readme_summary: '',
    created_at: null,
    pushed_at: null,
    health_status: null,
    category_id: null,
    category_name: null,
    archived: 0,
    html_url: `https://github.com/${id}`,
    ...extra,
  };
}

const SAMPLE_REPOS = [
  repo('u/react-admin', 'TypeScript', {
    stars: 1000,
    forks: 100,
    description: 'React 管理后台',
    created_at: '2026-10-10 08:00:00',
    pushed_at: '2026-10-20 08:00:00',
    category_name: '前端',
  }),
  repo('u/next-blog', 'TypeScript', {
    stars: 500,
    forks: 50,
    description: '使用 Next.js 与 Tailwind CSS 构建',
    created_at: '2026-09-15 08:00:00',
    pushed_at: '2026-09-30 08:00:00',
    category_name: '前端',
  }),
  repo('u/fastapi-service', 'Python', {
    stars: 300,
    forks: 30,
    description: 'FastAPI 与 PostgreSQL 服务',
    created_at: '2026-08-01 08:00:00',
    pushed_at: '2026-08-01 08:00:00',
    category_name: '后端',
  }),
  repo('u/django-site', 'Python', {
    stars: 200,
    forks: 20,
    created_at: '2026-05-01 08:00:00',
    pushed_at: '2026-03-01 08:00:00',
    category_name: '后端',
  }),
  repo('u/rust-cli', 'Rust', {
    stars: 100,
    forks: 10,
    description: 'Docker 部署的命令行工具',
    created_at: '2025-10-01 08:00:00',
    pushed_at: '2025-01-01 08:00:00',
  }),
  repo('u/legacy-go', 'Go', {
    stars: 50,
    forks: 5,
    created_at: '2025-06-01 08:00:00',
    pushed_at: null,
    archived: 1,
  }),
];

const SAMPLE_TAGS = [
  { repo_id: 'u/react-admin', name: 'React' },
  { repo_id: 'u/react-admin', name: '支付' },
  { repo_id: 'u/django-site', name: 'Django' },
];

test('parseProfileDate 兼容 D1 时间与 ISO，非法值返回 null', () => {
  assert.equal(
    parseProfileDate('2026-10-22 10:00:00')?.toISOString(),
    '2026-10-22T10:00:00.000Z'
  );
  assert.equal(
    parseProfileDate('2026-10-22T10:00:00Z')?.toISOString(),
    '2026-10-22T10:00:00.000Z'
  );
  assert.equal(parseProfileDate(''), null);
  assert.equal(parseProfileDate(null), null);
  assert.equal(parseProfileDate('not-a-date'), null);
});

test('monthKey / shiftMonth 跨年平移稳定', () => {
  assert.equal(monthKey(NOW), '2026-10');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
});

test('buildTechProfile 空收藏返回结构化空态', () => {
  const data = buildTechProfile([], [], { now: NOW });

  assert.equal(data.summary.totalRepos, 0);
  assert.equal(data.summary.totalStars, 0);
  assert.equal(data.summary.profileType, '均衡开发者');
  assert.equal(data.summary.activityScore, 0);
  assert.equal(data.summary.activityLevel, 'low');
  assert.equal(data.languages.length, 0);
  assert.equal(data.frameworks.length, 0);
  assert.equal(data.activity.months.length, 12);
  assert.ok(data.activity.months.every((item) => item.added === 0));
  assert.equal(data.insights[0].kind, 'empty');
  assert.equal(data.generatedAt, NOW.toISOString());
});

test('buildTechProfile 聚合语言 / 框架 / 分类与总览', () => {
  const data = buildTechProfile(SAMPLE_REPOS, SAMPLE_TAGS, { now: NOW });
  const { summary } = data;

  assert.equal(summary.totalRepos, 6);
  assert.equal(summary.totalStars, 2150);
  assert.equal(summary.totalForks, 215);
  assert.equal(summary.withLanguage, 6);
  assert.equal(summary.languageCount, 4);
  assert.equal(summary.topLanguage, 'TypeScript');
  assert.equal(summary.frameworkCount, 7);
  assert.equal(summary.withFramework, 5);
  assert.equal(summary.topFramework, 'React');
  assert.equal(summary.categoryCount, 2);
  assert.equal(summary.activeRepos, 3);
  assert.equal(summary.staleRepos, 2);
  assert.equal(summary.archivedRepos, 1);
  assert.equal(summary.activeRatio, 60);
  assert.equal(summary.activityScore, 58);
  assert.equal(summary.activityLevel, 'medium');
  assert.equal(summary.profileType, '全栈实践者');

  const typescript = data.languages.find((item) => item.name === 'TypeScript');
  assert.equal(typescript.repoCount, 2);
  assert.equal(typescript.starCount, 1500);
  assert.equal(typescript.share, 33.3);
  assert.equal(typescript.avgStars, 750);

  const react = data.frameworks.find((item) => item.name === 'React');
  assert.equal(react.category, '前端');
  assert.equal(react.repoCount, 1);
  assert.deepEqual(react.languages, ['TypeScript']);

  const backend = data.categories.find((item) => item.name === '后端');
  assert.equal(backend.repoCount, 2);
  assert.equal(backend.share, 33.3);
});

test('buildTechProfile 收藏趋势补零、累计与峰值 / 连续月', () => {
  const data = buildTechProfile(SAMPLE_REPOS, SAMPLE_TAGS, {
    now: NOW,
    months: 12,
  });
  const { activity } = data;

  assert.equal(activity.periodMonths, 12);
  assert.equal(activity.months.length, 12);
  assert.equal(activity.months[0].month, '2025-11');
  assert.equal(activity.months[0].cumulative, 2);
  assert.equal(activity.months.at(-1).month, '2026-10');
  assert.equal(activity.months.at(-1).added, 1);
  assert.equal(activity.months.at(-1).cumulative, 6);
  assert.equal(activity.peakMonth.added, 1);
  assert.equal(activity.streakMonths, 3);
  assert.deepEqual(activity.recent, {
    last7d: 0,
    last30d: 1,
    last90d: 3,
    last365d: 4,
  });
  assert.equal(activity.firstCollectedAt, '2025-06-01T08:00:00.000Z');
  assert.equal(activity.latestCollectedAt, '2026-10-10T08:00:00.000Z');
});

test('buildTechProfile 推送活跃度分桶覆盖全部仓库', () => {
  const data = buildTechProfile(SAMPLE_REPOS, SAMPLE_TAGS, { now: NOW });
  const buckets = new Map(
    data.activity.pushBuckets.map((item) => [item.key, item.repoCount])
  );

  assert.equal(buckets.get('7d'), 1);
  assert.equal(buckets.get('30d'), 1);
  assert.equal(buckets.get('90d'), 1);
  assert.equal(buckets.get('180d'), 0);
  assert.equal(buckets.get('365d'), 1);
  assert.equal(buckets.get('older'), 1);
  assert.equal(buckets.get('unknown'), 1);
  const total = data.activity.pushBuckets.reduce(
    (sum, item) => sum + item.repoCount,
    0
  );
  assert.equal(total, data.summary.totalRepos);
});

test('buildTechProfile 识别单栈深耕与多语言探索画像', () => {
  const singleStack = buildTechProfile(
    [
      repo('u/a', 'Python', { stars: 10 }),
      repo('u/b', 'Python', { stars: 9 }),
      repo('u/c', 'Python', { stars: 8 }),
      repo('u/d', 'Go', { stars: 7 }),
    ],
    [],
    { now: NOW }
  );
  assert.equal(singleStack.summary.profileType, '单栈深耕者');

  const multiLanguage = buildTechProfile(
    ['TypeScript', 'Python', 'Go', 'Rust', 'Java', 'Ruby'].map(
      (language, index) =>
        repo(`u/repo-${index}`, language, { stars: 100 - index })
    ),
    [],
    { now: NOW }
  );
  assert.equal(multiLanguage.summary.profileType, '多语言探索者');
});

test('buildTechProfile Top 仓库按 Star 稳定排序', () => {
  const data = buildTechProfile(SAMPLE_REPOS, SAMPLE_TAGS, {
    now: NOW,
    topRepos: 3,
  });

  assert.deepEqual(
    data.topRepos.map((item) => item.id),
    ['u/react-admin', 'u/next-blog', 'u/fastapi-service']
  );
  assert.equal(data.topRepos[0].url, 'https://github.com/u/react-admin');
  assert.equal(data.topRepos[0].language, 'TypeScript');
});

test('buildTechProfile 洞察包含语言 / 框架 / 活跃度 / 节奏 / 多样性', () => {
  const data = buildTechProfile(SAMPLE_REPOS, SAMPLE_TAGS, { now: NOW });
  const kinds = data.insights.map((item) => item.kind);

  assert.ok(kinds.includes('language'));
  assert.ok(kinds.includes('framework'));
  assert.ok(kinds.includes('activity'));
  assert.ok(kinds.includes('rhythm'));
  assert.ok(kinds.includes('diversity'));
  assert.ok(
    data.insights.some((item) => item.title.includes('TypeScript'))
  );
});
