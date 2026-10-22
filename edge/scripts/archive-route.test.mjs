import assert from 'node:assert/strict';
import test from 'node:test';

import { Hono } from 'hono';
import archiveRoutes from '../src/routes/archive.ts';
import exportRoutes from '../src/routes/export.ts';

const USER = {
  id: 'u1',
  login: 'fntp',
  name: 'Fntp',
  email: 'fntp@example.com',
  avatar_url: null,
  created_at: '2026-10-01 08:00:00',
};

function fakeDb() {
  const rows = {
    users: [USER],
    my_repositories: [{ id: 'acme/alpha', stars: 12, user_id: 'u1' }],
    categories: [{ id: 'cat-1', name: 'AI/LLM' }],
    tags: [{ id: 1, name: 'llm', repo_id: 'acme/alpha' }],
    recommendations: [{ id: 'r1', user_id: 'u1' }],
    recommendation_feedback: [{ id: 'f1', user_id: 'u1' }],
    notifications: [{ id: 'n1', user_id: 'u1' }],
    push_preferences: [{ user_id: 'u1', enabled: 1 }],
    curated_reports: [{ id: 'rp1', user_id: 'u1' }],
    repo_updates: [{ id: 'up1', user_id: 'u1' }],
    duplicate_dismissals: [{ id: 'd1', user_id: 'u1' }],
  };

  function rowsFor(sql) {
    if (sql.includes('FROM recommendation_feedback')) return rows.recommendation_feedback;
    if (sql.includes('FROM recommendations')) return rows.recommendations;
    if (sql.includes('FROM notifications')) return rows.notifications;
    if (sql.includes('FROM push_preferences')) return rows.push_preferences;
    if (sql.includes('FROM curated_reports')) return rows.curated_reports;
    if (sql.includes('FROM repo_updates')) return rows.repo_updates;
    if (sql.includes('FROM duplicate_dismissals')) return rows.duplicate_dismissals;
    if (sql.includes('FROM categories c')) return rows.categories;
    if (sql.includes('FROM my_repositories')) return rows.my_repositories;
    if (sql.includes('repo_tags rt')) return rows.tags;
    if (sql.includes('FROM users')) return rows.users;
    return [];
  }

  return {
    prepare(sql) {
      return {
        bind() {
          return {
            async all() {
              return { results: rowsFor(sql) };
            },
            async first() {
              const result = rowsFor(sql);
              if (sql.includes('COUNT(')) return { n: result.length };
              return result[0] ?? null;
            },
          };
        },
      };
    },
  };
}

function appWithUser(user = USER) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/api/export/archive', archiveRoutes);
  return app;
}

const env = { DB: fakeDb() };

test('summary 返回数据集条数与范围说明', async () => {
  const res = await appWithUser().request('/api/export/archive/summary', {}, env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.schema, 'openfactory.archive.v1');
  assert.equal(body.totalRecords, 11);
  assert.equal(body.datasets.find((item) => item.key === 'repositories').records, 1);
  assert.equal(body.datasets.find((item) => item.key === 'recommendations').knowledge, false);
  assert.equal(body.scopes.length, 2);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});

test('manifest scope=knowledge 只包含四个知识库数据集', async () => {
  const res = await appWithUser().request(
    '/api/export/archive/manifest?scope=knowledge&format=json',
    {},
    env
  );
  assert.equal(res.status, 200);
  const manifest = await res.json();
  assert.equal(manifest.scope, 'knowledge');
  assert.equal(manifest.format, 'json');
  assert.deepEqual(
    manifest.datasets.map((item) => item.key),
    ['profile', 'repositories', 'categories', 'tags']
  );
  assert.ok(!manifest.datasets.some((item) => item.key === 'recommendations'));
});

test('下载接口返回 JSON 归档且包含活动数据', async () => {
  const res = await appWithUser().request(
    '/api/export/archive?scope=full&format=json',
    {},
    env
  );
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Content-Type'), /application\/json/);
  assert.match(res.headers.get('Content-Disposition'), /openfactory-archive-\d{4}-\d{2}-\d{2}\.json/);
  const body = await res.json();
  assert.equal(body.manifest.scope, 'full');
  assert.equal(body.data.recommendations[0].id, 'r1');
  assert.equal(body.data['repo-updates'][0].id, 'up1');
  assert.equal(body.data.repositories[0].id, 'acme/alpha');
});

test('archive 路由挂载在 /api/export 前缀下', async () => {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('user', USER);
    await next();
  });
  app.route('/api/export', exportRoutes);

  const res = await app.request('/api/export/archive/summary', {}, env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.schema, 'openfactory.archive.v1');
  assert.equal(body.datasets.length, 11);

  const download = await app.request('/api/export/archive?scope=full&format=json', {}, env);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('Content-Disposition'), /openfactory-archive-.*\.json/);
});

test('未登录返回 401', async () => {
  const res = await appWithUser(null).request('/api/export/archive/summary', {}, env);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, 'unauthorized');
});
