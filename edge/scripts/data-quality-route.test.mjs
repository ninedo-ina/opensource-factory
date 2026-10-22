import assert from 'node:assert/strict';
import test from 'node:test';

import { Hono } from 'hono';
import dataQualityRoutes, { internalDataQuality } from '../src/routes/data-quality.ts';

function repoRow(overrides = {}) {
  return {
    id: 'acme/demo',
    platform: 'github',
    name: 'demo',
    description: '演示项目',
    html_url: 'https://github.com/acme/demo',
    stars: 10,
    language: 'TypeScript',
    readme_summary: '演示项目摘要。',
    category_id: 'cat_dev',
    created_at: '2026-01-01T00:00:00Z',
    user_id: 'u1',
    owner: 'acme',
    forks: 1,
    updated_at: '2026-10-01T00:00:00Z',
    synced_at: '2026-10-01T00:00:00Z',
    license_spdx: 'MIT',
    license_name: 'MIT License',
    license_source: 'github',
    license_checked_at: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

function issueRow(overrides = {}) {
  return {
    id: 'dq_seed0001',
    user_id: 'u1',
    scan_id: 'dq_scan0',
    repo_id: 'acme/demo',
    issue_key: 'missing_metadata:language',
    type: 'missing_metadata',
    severity: 'info',
    field: 'language',
    title: '缺少开发语言',
    detail: '语言为空',
    suggestion: '补全元数据',
    status: 'open',
    detected_at: '2026-10-01T00:00:00Z',
    resolved_at: null,
    ...overrides,
  };
}

function fakeDb({ myRows = [], issues = [], scans = [] } = {}) {
  const state = {
    myRows: myRows.map((row) => ({ ...row })),
    issues: issues.map((row) => ({ ...row })),
    scans: scans.map((row) => ({ ...row })),
  };
  const calls = [];
  const db = {
    state,
    calls,
    prepare(sql) {
      return {
        bind(...params) {
          calls.push({ sql, params });
          return {
            async all() {
              if (sql.includes('FROM data_quality_issues')) {
                return {
                  results: state.issues
                    .filter((row) => row.user_id === params[0])
                    .slice(0, Number(params[1] ?? 1000)),
                };
              }
              if (sql.includes('FROM data_quality_scans')) {
                return {
                  results: state.scans
                    .filter((row) => row.user_id === params[0])
                    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
                    .slice(0, Number(params[1] ?? 1)),
                };
              }
              if (sql.includes('FROM my_repositories')) {
                if (sql.includes('WHERE id = ? AND user_id = ?')) {
                  const row = state.myRows.find(
                    (item) => item.id === params[0] && item.user_id === params[1]
                  );
                  return { results: row ? [row] : [] };
                }
                if (!sql.includes('WHERE user_id = ?')) {
                  return { results: state.myRows.slice(0, Number(params[0] ?? 5000)) };
                }
                return {
                  results: state.myRows
                    .filter((row) => row.user_id === params[0])
                    .sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0))
                    .slice(0, Number(params[1] ?? 500)),
                };
              }
              return { results: [] };
            },
            async first() {
              if (sql.includes('FROM data_quality_scans')) {
                return (
                  state.scans
                    .filter((row) => row.user_id === params[0])
                    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] ??
                  null
                );
              }
              if (sql.includes('FROM my_repositories')) {
                return (
                  state.myRows.find(
                    (item) => item.id === params[0] && item.user_id === params[1]
                  ) ?? null
                );
              }
              return null;
            },
            async run() {
              if (sql.includes('INSERT INTO data_quality_scans')) {
                state.scans.push({
                  id: params[0],
                  user_id: params[1],
                  mode: params[2],
                  scanned: params[3],
                  issue_count: params[4],
                  critical_count: params[5],
                  warning_count: params[6],
                  info_count: params[7],
                  score: params[8],
                  duplicate_count: params[9],
                  broken_link_count: params[10],
                  metadata_count: params[11],
                  created_at: params[12],
                });
                return { meta: { changes: 1 } };
              }
              if (sql.includes('INSERT INTO data_quality_issues')) {
                const existing = state.issues.find(
                  (row) =>
                    row.user_id === params[1] &&
                    row.repo_id === params[3] &&
                    row.issue_key === params[4]
                );
                if (existing) {
                  Object.assign(existing, {
                    scan_id: params[2],
                    type: params[5],
                    severity: params[6],
                    field: params[7],
                    title: params[8],
                    detail: params[9],
                    suggestion: params[10],
                    status: existing.status === 'ignored' ? 'ignored' : 'open',
                    detected_at: params[11],
                    resolved_at: null,
                  });
                } else {
                  state.issues.push({
                    id: params[0],
                    user_id: params[1],
                    scan_id: params[2],
                    repo_id: params[3],
                    issue_key: params[4],
                    type: params[5],
                    severity: params[6],
                    field: params[7],
                    title: params[8],
                    detail: params[9],
                    suggestion: params[10],
                    status: 'open',
                    detected_at: params[11],
                    resolved_at: null,
                  });
                }
                return { meta: { changes: 1 } };
              }
              if (sql.includes("SET status = 'fixed'") && sql.includes('scan_id <>')) {
                let changes = 0;
                for (const row of state.issues) {
                  if (row.user_id === params[0] && row.status === 'open' && row.scan_id !== params[1]) {
                    row.status = 'fixed';
                    row.resolved_at = '2026-10-22T00:00:00Z';
                    changes += 1;
                  }
                }
                return { meta: { changes } };
              }
              if (sql.includes('UPDATE data_quality_issues') && sql.includes('field = ?')) {
                let changes = 0;
                for (const row of state.issues) {
                  if (
                    row.user_id === params[0] &&
                    row.repo_id === params[1] &&
                    row.status === 'open' &&
                    row.field === params[2]
                  ) {
                    row.status = 'fixed';
                    row.resolved_at = '2026-10-22T00:00:00Z';
                    changes += 1;
                  }
                }
                return { meta: { changes } };
              }
              if (sql.includes('UPDATE data_quality_issues') && sql.includes('id IN')) {
                const [status, , userId, ...ids] = params;
                let changes = 0;
                for (const row of state.issues) {
                  if (row.user_id === userId && ids.includes(row.id)) {
                    row.status = status;
                    row.resolved_at = status === 'fixed' ? '2026-10-22T00:00:00Z' : null;
                    changes += 1;
                  }
                }
                return { meta: { changes } };
              }
              if (sql.includes('UPDATE my_repositories')) {
                const row = state.myRows.find(
                  (item) => item.id === params[11] && item.user_id === params[12]
                );
                if (!row) return { meta: { changes: 0 } };
                row.description = params[0];
                row.language = params[1];
                row.stars = params[2];
                row.forks = params[3];
                row.html_url = params[4];
                row.updated_at = params[5];
                row.license_spdx = params[6];
                row.license_name = params[7];
                row.license_source = params[8];
                row.license_checked_at = params[9];
                if (params[10] === 1) row.synced_at = '2026-10-22T00:00:00Z';
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
  return db;
}

function makeApp(db, user = { id: 'u1', login: 'tester' }) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (user) c.set('user', user);
    await next();
  });
  app.route('/api/data-quality', dataQualityRoutes);
  app.route('/api/internal/data-quality', internalDataQuality);
  return app;
}

function env(db, extra = {}) {
  return { DB: db, ...extra };
}

test('GET /api/data-quality 未登录返回 401', async () => {
  const db = fakeDb();
  const res = await makeApp(db, null).request('/api/data-quality', {}, env(db));
  assert.equal(res.status, 401);
});

test('scan 本地模式：元数据 + 重复问题落库，重复扫描幂等', async () => {
  const db = fakeDb({
    myRows: [
      repoRow({ id: 'acme/tenant-admin', name: 'tenant-admin', stars: 10 }),
      repoRow({
        id: 'acme/tenant_admin',
        name: 'tenant_admin',
        stars: 2,
        language: '',
        license_spdx: '',
        license_checked_at: '',
        category_id: '',
      }),
    ],
  });
  const app = makeApp(db);
  const res = await app.request(
    '/api/data-quality/scan',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkLinks: false }),
    },
    env(db)
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.mode, 'local');
  assert.equal(body.linkCheck, 'skipped');
  assert.equal(body.scanned, 2);
  assert.ok(body.summary.open >= 4);
  assert.equal(db.state.scans.length, 1);
  assert.equal(db.state.issues.length, body.summary.open);
  assert.ok(db.state.issues.every((row) => row.id.startsWith('dq_')));

  const again = await app.request(
    '/api/data-quality/scan',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkLinks: false }),
    },
    env(db)
  );
  assert.equal(again.status, 200);
  assert.equal(db.state.scans.length, 2);
  assert.equal(db.state.issues.length, body.summary.open);
});

test('scan 配置 VPS 时调用 check-links 并合并 critical 失效链接', async () => {
  const db = fakeDb({ myRows: [repoRow()] });
  const originalFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), body: JSON.parse(init.body) };
    return new Response(
      JSON.stringify({
        results: [
          { repoId: 'acme/demo', status: 'broken', httpStatus: 404, finalUrl: null, error: null },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };
  try {
    const res = await makeApp(db).request(
      '/api/data-quality/scan',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkLinks: true }),
      },
      env(db, { VPS_NODE_URL: 'https://vps.example', INTERNAL_TOKEN: 'test-token' })
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.mode, 'hybrid');
    assert.equal(body.linkCheck, 'ok');
    assert.equal(captured.url, 'https://vps.example/api/data-quality/check-links');
    assert.equal(captured.body.items.length, 1);
    assert.equal(captured.body.items[0].repoId, 'acme/demo');
    assert.ok(body.issues.some((issue) => issue.type === 'broken_link' && issue.severity === 'critical'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ignore / restore 按用户批量更新，默认列表隐藏 ignored', async () => {
  const db = fakeDb({
    myRows: [repoRow()],
    issues: [issueRow()],
  });
  const app = makeApp(db);
  const ignore = await app.request(
    '/api/data-quality/issues/ignore',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueIds: ['dq_seed0001'] }),
    },
    env(db)
  );
  assert.equal(ignore.status, 200);
  assert.deepEqual(await ignore.json(), { updated: 1, status: 'ignored' });
  assert.equal(db.state.issues[0].status, 'ignored');

  const list = await app.request('/api/data-quality?status=open', {}, env(db));
  const listBody = await list.json();
  assert.equal(listBody.issues.length, 0);

  const restore = await app.request(
    '/api/data-quality/issues/restore',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueIds: ['dq_seed0001'] }),
    },
    env(db)
  );
  assert.equal(restore.status, 200);
  assert.equal(db.state.issues[0].status, 'open');
});

test('fix VPS 不可达时用 README 摘要回填简介并关闭问题', async () => {
  const db = fakeDb({
    myRows: [
      repoRow({
        description: null,
        readme_summary: '一句话简介。第二句不应进入简介。',
      }),
    ],
    issues: [
      issueRow({ field: 'description', issue_key: 'missing_metadata:description', severity: 'warning' }),
      issueRow({ id: 'dq_seed0002', field: 'language', issue_key: 'missing_metadata:language' }),
    ],
  });
  const res = await makeApp(db).request(
    '/api/data-quality/fix',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoIds: ['acme/demo'] }),
    },
    env(db)
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'local');
  assert.equal(body.updated, 1);
  assert.equal(db.state.myRows[0].description, '一句话简介。');
  assert.equal(db.state.issues.find((row) => row.field === 'description').status, 'fixed');
  assert.equal(db.state.issues.find((row) => row.field === 'language').status, 'open');
});

test('fix 调用 VPS metadata 并回写语言 / License / URL', async () => {
  const db = fakeDb({
    myRows: [repoRow({ description: '', language: null, license_spdx: null, license_checked_at: null })],
    issues: [issueRow()],
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        items: [
          {
            repoId: 'acme/demo',
            patch: {
              description: '来自 GitHub 的简介',
              language: 'Rust',
              html_url: 'https://github.com/acme/renamed',
              license_spdx: 'Apache-2.0',
              license_name: 'Apache License 2.0',
              license_source: 'github',
              stars: 99,
              forks: 7,
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  try {
    const res = await makeApp(db).request(
      '/api/data-quality/fix',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoIds: ['acme/demo'], fields: ['language'] }),
      },
      env(db, { VPS_NODE_URL: 'https://vps.example', INTERNAL_TOKEN: 'test-token' })
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'vps');
    assert.equal(db.state.myRows[0].language, 'Rust');
    assert.equal(db.state.myRows[0].license_spdx, 'Apache-2.0');
    assert.equal(db.state.myRows[0].stars, 99);
    assert.equal(db.state.myRows[0].html_url, 'https://github.com/acme/renamed');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('内部镜像接口校验令牌并返回仓库快照', async () => {
  const db = fakeDb({ myRows: [repoRow()] });
  const app = makeApp(db);
  const denied = await app.request(
    '/api/internal/data-quality/mirror',
    {},
    env(db, { INTERNAL_TOKEN: 'secret-token' })
  );
  assert.equal(denied.status, 401);

  const ok = await app.request(
    '/api/internal/data-quality/mirror',
    { headers: { 'X-Internal-Token': 'secret-token' } },
    env(db, { INTERNAL_TOKEN: 'secret-token' })
  );
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.count, 1);
  assert.equal(body.items[0].id, 'acme/demo');
});
