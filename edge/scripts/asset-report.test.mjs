import assert from 'node:assert/strict';
import test from 'node:test';

import { Hono } from 'hono';
import assetReportRoutes from '../src/routes/asset-report.ts';
import {
  buildAssetReport,
  normalizeMonths,
  parseAssetDate,
  starTrendDays,
} from '../src/asset-report/aggregate.ts';

const NOW = new Date('2026-10-22T10:00:00Z');

function repo(id, overrides = {}) {
  const [owner, name] = id.split('/');
  return {
    id,
    platform: 'github',
    name,
    owner,
    html_url: `https://github.com/${id}`,
    stars: 0,
    forks: 0,
    language: 'TypeScript',
    category_id: null,
    created_at: '2026-05-10 08:00:00',
    pushed_at: null,
    archived: 0,
    health_status: null,
    ...overrides,
  };
}

function snapshot(repoId, date, stars, extra = {}) {
  const [owner, name] = repoId.split('/');
  return {
    snapshot_date: date,
    repo_id: repoId,
    owner,
    name,
    html_url: `https://github.com/${repoId}`,
    description: '',
    language: 'TypeScript',
    stars,
    stars_today: 0,
    rank: 1,
    language_rank: 1,
    star_delta: 0,
    rank_delta: 0,
    appearances: 1,
    is_new: 0,
    trend: 'steady',
    ...extra,
  };
}

function sampleRepos() {
  return [
    repo('acme/one', {
      stars: 1000,
      forks: 100,
      language: 'typescript',
      category_id: 'c1',
      created_at: '2026-05-10 08:00:00',
    }),
    repo('acme/two', {
      stars: 500,
      forks: 20,
      language: 'TypeScript',
      category_id: 'c1',
      created_at: '2026-07-15 08:00:00',
    }),
    repo('acme/three', {
      platform: 'gitee',
      stars: 100,
      forks: 5,
      language: 'Python',
      category_id: 'c2',
      created_at: '2026-09-01 08:00:00',
    }),
    repo('acme/four', {
      stars: 50,
      language: null,
      category_id: null,
      created_at: '2026-10-20 08:00:00',
    }),
    repo('acme/five', {
      stars: 20,
      language: 'Go',
      category_id: null,
      created_at: '2025-12-01 08:00:00',
    }),
    repo('acme/six', {
      stars: 10,
      language: 'Rust',
      category_id: 'c2',
      created_at: null,
    }),
  ];
}

const CATEGORIES = [
  { id: 'c1', name: 'AI 应用' },
  { id: 'c2', name: '开发工具' },
];

test('normalizeMonths 只接受 6 / 12 / 24', () => {
  assert.equal(normalizeMonths(6), 6);
  assert.equal(normalizeMonths('24'), 24);
  assert.equal(normalizeMonths(9), 12);
  assert.equal(normalizeMonths(undefined), 12);
  assert.equal(normalizeMonths('abc'), 12);
  assert.equal(starTrendDays(6), 180);
  assert.equal(starTrendDays(24), 365);
});

test('parseAssetDate 兼容 SQLite 与 ISO 时间', () => {
  assert.equal(
    parseAssetDate('2026-10-22 08:00:00')?.toISOString(),
    '2026-10-22T08:00:00.000Z'
  );
  assert.equal(
    parseAssetDate('2026-10-22T08:00:00.000Z')?.toISOString(),
    '2026-10-22T08:00:00.000Z'
  );
  assert.equal(parseAssetDate(''), null);
  assert.equal(parseAssetDate(null), null);
  assert.equal(parseAssetDate('not-a-date'), null);
});

test('buildAssetReport 聚合收录量、分类分布、语言与平台', () => {
  const data = buildAssetReport(sampleRepos(), CATEGORIES, [], {
    months: 6,
    now: NOW,
  });

  assert.deepEqual(data.period, {
    months: 6,
    startDate: '2026-05-01',
    endDate: '2026-10-22',
  });
  assert.equal(data.summary.totalRepos, 6);
  assert.equal(data.summary.totalStars, 1680);
  assert.equal(data.summary.totalForks, 125);
  assert.equal(data.summary.avgStars, 280);
  assert.equal(data.summary.categoryCount, 2);
  assert.equal(data.summary.categorizedRepos, 4);
  assert.equal(data.summary.uncategorizedRepos, 2);
  assert.equal(data.summary.categoryCoverage, 66.7);
  assert.equal(data.summary.languageCount, 4);
  assert.equal(data.summary.withLanguage, 5);
  assert.equal(data.summary.platformCount, 2);
  assert.equal(data.summary.addedLast7d, 1);
  assert.equal(data.summary.addedLast30d, 1);
  assert.equal(data.summary.addedLast90d, 2);
  assert.equal(data.summary.addedLast365d, 5);
  assert.equal(data.summary.growthRate30d, 20);
  assert.deepEqual(data.summary.topCategory, {
    name: 'AI 应用',
    repoCount: 2,
    share: 33.3,
  });
  assert.equal(data.summary.topLanguage, 'TypeScript');
  assert.equal(data.summary.topPlatform, 'GitHub');

  assert.deepEqual(
    data.volume.months.map((month) => [month.month, month.added, month.cumulative]),
    [
      ['2026-05', 1, 2],
      ['2026-06', 0, 2],
      ['2026-07', 1, 3],
      ['2026-08', 0, 3],
      ['2026-09', 1, 4],
      ['2026-10', 1, 5],
    ]
  );
  assert.equal(data.volume.months[0].starsAdded, 1000);
  assert.equal(data.volume.months[0].cumulativeStars, 1020);
  assert.equal(data.volume.months[5].cumulativeStars, 1670);
  assert.equal(data.volume.unknownCreated, 1);
  assert.deepEqual(data.volume.peakMonth, { month: '2026-05', added: 1 });
  assert.deepEqual(data.volume.recent, {
    last7d: 1,
    last30d: 1,
    last90d: 2,
    last365d: 5,
  });

  const ai = data.categories.find((item) => item.name === 'AI 应用');
  assert.equal(ai.repoCount, 2);
  assert.equal(ai.starCount, 1500);
  assert.equal(ai.share, 33.3);
  assert.equal(ai.avgStars, 750);
  assert.equal(ai.topLanguage, 'TypeScript');

  const uncategorized = data.categories.find((item) => item.name === '未分类');
  assert.equal(uncategorized.id, null);
  assert.equal(uncategorized.repoCount, 2);
  assert.equal(uncategorized.starCount, 70);

  assert.deepEqual(data.volume.platforms[0], {
    platform: 'github',
    label: 'GitHub',
    repoCount: 5,
    share: 83.3,
  });
  assert.equal(data.languages[0].name, 'TypeScript');
  assert.equal(data.languages[0].repoCount, 2);
  assert.equal(data.languages[0].starCount, 1500);

  assert.equal(data.starTrend.available, false);
  assert.equal(data.starTrend.summary.coverage, 0);
  assert.ok(data.insights.some((item) => item.kind === 'uncategorized'));
  assert.ok(data.insights.some((item) => item.kind === 'coverage'));
});

test('buildAssetReport 复用 Star 快照聚合并计算覆盖率', () => {
  const snapshots = [
    snapshot('acme/one', '2026-10-20', 900, { star_delta: 0 }),
    snapshot('acme/one', '2026-10-21', 950, { star_delta: 50 }),
    snapshot('acme/one', '2026-10-22', 1000, { star_delta: 50 }),
    snapshot('acme/two', '2026-10-21', 450, { star_delta: 0 }),
    snapshot('acme/two', '2026-10-22', 500, { star_delta: 50 }),
  ];

  const data = buildAssetReport(sampleRepos(), CATEGORIES, snapshots, {
    months: 6,
    now: NOW,
  });

  assert.equal(data.starTrend.available, true);
  assert.equal(data.starTrend.summary.trackedRepos, 2);
  assert.equal(data.starTrend.summary.totalStars, 1680);
  assert.equal(data.starTrend.summary.starGain, 150);
  assert.equal(data.starTrend.summary.coverage, 33.3);
  assert.equal(data.starTrend.period.snapshotDays, 3);
  assert.equal(data.starTrend.series.length, 3);
  assert.equal(data.starTrend.topMovers.length, 2);
  assert.equal(data.starTrend.topMovers[0].repoId, 'acme/one');
  assert.equal(data.summary.starTrendCoverage, 33.3);
  assert.ok(data.insights.some((item) => item.title.includes('Star 历史覆盖')));
});

test('buildAssetReport 空数据返回稳定空结构', () => {
  const data = buildAssetReport([], [], [], { months: 12, now: NOW });

  assert.equal(data.summary.totalRepos, 0);
  assert.equal(data.summary.totalStars, 0);
  assert.equal(data.summary.categoryCoverage, 0);
  assert.equal(data.summary.topCategory, null);
  assert.equal(data.summary.topLanguage, null);
  assert.deepEqual(data.categories, []);
  assert.deepEqual(data.languages, []);
  assert.deepEqual(data.volume.platforms, []);
  assert.equal(data.volume.months.length, 12);
  assert.ok(data.volume.months.every((month) => month.added === 0));
  assert.equal(data.volume.peakMonth, null);
  assert.equal(data.starTrend.available, false);
  assert.deepEqual(data.insights.map((item) => item.kind), ['volume']);
});

function fakeDb({ repos = [], categories = [], snapshots = [] } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...params) {
          calls.push({ sql, params });
          return {
            async all() {
              if (sql.includes('FROM my_repositories')) return { results: repos };
              if (sql.includes('FROM categories')) return { results: categories };
              if (sql.includes('FROM trending_snapshots')) {
                const cutoff = params[0];
                const ids = new Set(params.slice(1));
                return {
                  results: snapshots.filter(
                    (row) => row.snapshot_date >= cutoff && ids.has(row.repo_id)
                  ),
                };
              }
              return { results: [] };
            },
            async first() {
              return null;
            },
            async run() {
              return { success: true };
            },
          };
        },
      };
    },
  };
}

function makeApp(db, user = { id: 'u1', login: 'tester' }) {
  const app = new Hono();
  app.use('/api/asset-report/*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/api/asset-report', assetReportRoutes);
  return app;
}

test('GET /api/asset-report：按用户聚合并支持 months 参数', async () => {
  const db = fakeDb({
    repos: sampleRepos(),
    categories: CATEGORIES,
    snapshots: [snapshot('acme/one', '2026-10-22', 1000, { star_delta: 50 })],
  });
  const app = makeApp(db);

  const res = await app.request('/api/asset-report?months=6', {}, { DB: db });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.summary.totalRepos, 6);
  assert.equal(body.period.months, 6);
  assert.equal(body.starTrend.available, true);

  const reposQuery = db.calls.find((call) => call.sql.includes('FROM my_repositories'));
  assert.ok(reposQuery);
  assert.deepEqual(reposQuery.params, ['u1']);
});

test('GET /api/asset-report：非法 months 回退 12，未登录返回 401', async () => {
  const db = fakeDb({ repos: sampleRepos(), categories: CATEGORIES });
  const app = makeApp(db);

  const res = await app.request('/api/asset-report?months=99', {}, { DB: db });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).period.months, 12);

  const anon = new Hono();
  anon.use('/api/asset-report/*', async (c, next) => {
    c.set('user', null);
    await next();
  });
  anon.route('/api/asset-report', assetReportRoutes);
  const unauthorized = await anon.request('/api/asset-report', {}, { DB: db });
  assert.equal(unauthorized.status, 401);
});
