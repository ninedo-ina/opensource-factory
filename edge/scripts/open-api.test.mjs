import assert from 'node:assert/strict';
import test from 'node:test';

import { Hono } from 'hono';
import { openApiTokens, openApiV1 } from '../src/routes/open-api.ts';
import { sha256Hex } from '../src/security/crypto.ts';
import {
  expiresAtFromDays,
  generateOpenApiToken,
  hasScope,
  isOpenApiTokenFormat,
  normalizeBookmarkPayload,
  normalizeExpiryDays,
  normalizeScopes,
  parseRepoFullName,
  parseRepoUrl,
  tokenHint,
} from '../src/open-api/helpers.ts';

function fakeDb({
  tokens = [],
  users = [{ id: 'u1', login: 'tester', name: 'Tester', email: null, avatar_url: null }],
  repos = [],
  categories = [],
  tags = [],
  recommendations = [],
  trending = [],
  snapshots = [],
} = {}) {
  const calls = [];
  return {
    calls,
    tokens,
    repos,
    prepare(sql) {
      return {
        bind(...params) {
          calls.push({ sql, params });
          return {
            async all() {
              if (sql.includes('FROM open_api_tokens')) {
                return {
                  results: tokens.filter((row) => row.user_id === params[0]),
                };
              }
              if (sql.includes('FROM my_repositories')) {
                return { results: repos };
              }
              if (sql.includes('FROM categories')) return { results: categories };
              if (sql.includes('FROM tags')) return { results: tags };
              if (sql.includes('FROM recommendations')) return { results: recommendations };
              if (sql.includes('FROM trending_snapshots')) return { results: snapshots };
              if (sql.includes('FROM trending_repositories')) return { results: trending };
              return { results: [] };
            },
            async first() {
              if (sql.includes('SELECT COUNT(*) AS n FROM open_api_tokens')) {
                return { n: tokens.filter((row) => row.user_id === params[0] && !row.revoked_at).length };
              }
              if (sql.includes('FROM open_api_tokens')) {
                if (sql.includes('token_hash = ?')) {
                  return (
                    tokens.find((row) => row.token_hash === params[0] && !row.revoked_at) ?? null
                  );
                }
                return null;
              }
              if (sql.includes('FROM users')) {
                return users.find((row) => row.id === params[0]) ?? null;
              }
              if (sql.includes('rate_limit_counters')) return { count: 1 };
              if (sql.includes('SELECT COUNT(*) AS n FROM my_repositories')) {
                return { n: repos.length };
              }
              if (sql.includes('SELECT COUNT(*) AS n FROM recommendations')) {
                return { n: recommendations.length };
              }
              if (sql.includes('SELECT COUNT(*) AS total')) {
                return {
                  total: repos.length,
                  stars: repos.reduce((sum, row) => sum + (row.stars ?? 0), 0),
                  withSummary: 0,
                };
              }
              if (sql.includes('SELECT COUNT(DISTINCT')) return { n: 0 };
              if (sql.includes('MAX(snapshot_date)')) {
                return { d: snapshots[0]?.snapshot_date ?? null };
              }
              if (sql.includes('FROM my_repositories WHERE id = ?')) {
                return repos.find((row) => row.id === params[0]) ?? null;
              }
              return null;
            },
            async run() {
              if (sql.includes('INSERT INTO open_api_tokens')) {
                tokens.push({
                  id: params[0],
                  user_id: params[1],
                  label: params[2],
                  token_hash: params[3],
                  hint: params[4],
                  scopes: params[5],
                  expires_at: params[6],
                  created_at: params[7],
                  last_used_at: null,
                  revoked_at: null,
                });
              }
              if (sql.includes('UPDATE open_api_tokens') && sql.includes('revoked_at')) {
                const row = tokens.find((item) => item.id === params[0] && item.user_id === params[1]);
                if (row) row.revoked_at = '2026-10-22 00:00:00';
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

function makeTokenApp(db, user = { id: 'u1', login: 'tester' }) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/api/open/tokens', openApiTokens);
  return app;
}

function makeV1App(db) {
  const app = new Hono();
  app.route('/api/open/v1', openApiV1);
  return app;
}

function repoRow(overrides = {}) {
  return {
    id: 'acme/demo',
    platform: 'github',
    name: 'demo',
    description: '演示仓库',
    html_url: 'https://github.com/acme/demo',
    stars: 100,
    language: 'TypeScript',
    readme_summary: '演示摘要',
    category_id: 'c1',
    created_at: '2026-10-01 00:00:00',
    user_id: 'u1',
    owner: 'acme',
    forks: 10,
    updated_at: '2026-10-20 00:00:00',
    synced_at: '2026-10-20 00:00:00',
    license_spdx: null,
    license_name: null,
    license_source: null,
    license_checked_at: null,
    category_name: 'AI',
    tag_names: 'ai,typescript',
    ...overrides,
  };
}

function tokenRow(overrides = {}) {
  return {
    id: 'oat_0000000000000001',
    user_id: 'u1',
    label: 'CLI',
    token_hash: 'hash',
    hint: 'ofa_…a1b2',
    scopes: 'read',
    expires_at: null,
    created_at: '2026-10-01T00:00:00.000Z',
    last_used_at: null,
    revoked_at: null,
    ...overrides,
  };
}

// ── 纯函数 ─────────────────────────────────────────────────────

test('令牌格式 / 尾号 / 作用域 / 过期纯函数', () => {
  const token = generateOpenApiToken();
  assert.match(token, /^ofa_[0-9a-f]{64}$/);
  assert.equal(isOpenApiTokenFormat(token), true);
  assert.equal(isOpenApiTokenFormat('ofx_' + 'a'.repeat(64)), false);
  assert.equal(tokenHint(token), `ofa_…${token.slice(-4)}`);

  assert.deepEqual(normalizeScopes(undefined), ['read']);
  assert.deepEqual(normalizeScopes(['write']), ['read', 'write']);
  assert.deepEqual(normalizeScopes('read,write'), ['read', 'write']);
  assert.equal(hasScope('read', 'read'), true);
  assert.equal(hasScope('read', 'write'), false);
  assert.equal(hasScope('write', 'read'), true);

  assert.deepEqual(normalizeExpiryDays(undefined), { ok: true, days: 90 });
  assert.deepEqual(normalizeExpiryDays(0), { ok: true, days: null });
  assert.deepEqual(normalizeExpiryDays(365), { ok: true, days: 365 });
  assert.equal(normalizeExpiryDays(366).ok, false);
  assert.equal(normalizeExpiryDays('abc').ok, false);
  assert.equal(expiresAtFromDays(null), null);
  assert.match(expiresAtFromDays(1), /^\d{4}-\d{2}-\d{2}T/);
});

test('仓库参数解析：fullName / URL / 非法输入', () => {
  assert.deepEqual(parseRepoFullName('acme/demo'), {
    owner: 'acme',
    name: 'demo',
    fullName: 'acme/demo',
  });
  assert.equal(parseRepoFullName('topics/ai'), null);
  assert.equal(parseRepoFullName('acme'), null);

  const parsed = parseRepoUrl('https://github.com/acme/demo.git');
  assert.equal(parsed?.platform, 'github');
  assert.equal(parsed?.fullName, 'acme/demo');
  assert.equal(parseRepoUrl('https://example.com/acme/demo'), null);

  const normalized = normalizeBookmarkPayload({
    url: 'https://gitee.com/acme/demo',
    description: '  演示  ',
    stars: '1,200',
  });
  assert.equal(normalized.ok, true);
  if (normalized.ok) {
    assert.equal(normalized.repo.platform, 'gitee');
    assert.equal(normalized.repo.stars, 1200);
    assert.equal(normalized.repo.description, '演示');
  }
  assert.equal(normalizeBookmarkPayload({ fullName: 'bad' }).ok, false);
});

// ── 令牌管理（会话） ───────────────────────────────────────────

test('POST /api/open/tokens：创建令牌只返回一次明文，列表不泄露摘要', async () => {
  const db = fakeDb();
  const app = makeTokenApp(db);

  const res = await app.request(
    '/api/open/tokens',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'CLI 工具', scopes: ['write'], expiresInDays: 30 }),
    },
    { DB: db }
  );
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.match(body.token, /^ofa_[0-9a-f]{64}$/);
  assert.equal(body.item.label, 'CLI 工具');
  assert.deepEqual(body.item.scopes, ['read', 'write']);
  assert.equal(body.item.status, 'active');
  assert.equal(db.tokens.length, 1);
  assert.notEqual(db.tokens[0].token_hash, body.token);
  assert.equal(db.tokens[0].token_hash.length, 64);

  const list = await app.request('/api/open/tokens', {}, { DB: db });
  assert.equal(list.status, 200);
  const listBody = await list.json();
  assert.equal(listBody.items.length, 1);
  assert.equal(listBody.items[0].hint, body.item.hint);
  assert.equal(JSON.stringify(listBody).includes('token_hash'), false);
  assert.equal(JSON.stringify(listBody).includes(body.token), false);
});

test('POST /api/open/tokens：参数非法 / 超过上限返回 400', async () => {
  const db = fakeDb();
  const app = makeTokenApp(db);

  const invalid = await app.request(
    '/api/open/tokens',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresInDays: 999 }),
    },
    { DB: db }
  );
  assert.equal(invalid.status, 400);

  const full = fakeDb({ tokens: Array.from({ length: 20 }, (_, i) => tokenRow({ id: `oat_${i}` })) });
  const fullApp = makeTokenApp(full);
  const res = await fullApp.request(
    '/api/open/tokens',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    { DB: full }
  );
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'too_many_tokens');
});

test('DELETE /api/open/tokens/:id：撤销后列表状态变更', async () => {
  const db = fakeDb({ tokens: [tokenRow()] });
  const app = makeTokenApp(db);

  const res = await app.request('/api/open/tokens/oat_0000000000000001', { method: 'DELETE' }, { DB: db });
  assert.equal(res.status, 200);
  assert.ok(db.tokens[0].revoked_at);
});

test('未登录访问令牌管理返回 401', async () => {
  const db = fakeDb();
  const app = makeTokenApp(db, null);
  assert.equal((await app.request('/api/open/tokens', {}, { DB: db })).status, 401);
});

// ── Bearer 开放 API ────────────────────────────────────────────

async function bearerToken(scopes = 'read', overrides = {}) {
  const token = generateOpenApiToken();
  return { token, row: tokenRow({ token_hash: await sha256Hex(token), scopes, ...overrides }) };
}

test('Bearer 鉴权：无令牌 / 格式错误 / 过期 / 撤销均返回 401', async () => {
  const { token, row } = await bearerToken('read');
  const db = fakeDb({ tokens: [row] });
  const app = makeV1App(db);

  assert.equal((await app.request('/api/open/v1/me', {}, { DB: db })).status, 401);
  assert.equal(
    (await app.request('/api/open/v1/me', { headers: { Authorization: 'Bearer bad' } }, { DB: db }))
      .status,
    401
  );

  const expired = await bearerToken('read', { expires_at: '2020-01-01T00:00:00.000Z' });
  const expiredDb = fakeDb({ tokens: [expired.row] });
  assert.equal(
    (
      await makeV1App(expiredDb).request(
        '/api/open/v1/me',
        { headers: { Authorization: `Bearer ${expired.token}` } },
        { DB: expiredDb }
      )
    ).status,
    401
  );

  const revoked = await bearerToken('read', { revoked_at: '2026-01-01 00:00:00' });
  const revokedDb = fakeDb({ tokens: [revoked.row] });
  assert.equal(
    (
      await makeV1App(revokedDb).request(
        '/api/open/v1/me',
        { headers: { Authorization: `Bearer ${revoked.token}` } },
        { DB: revokedDb }
      )
    ).status,
    401
  );

  const ok = await app.request(
    '/api/open/v1/me',
    { headers: { Authorization: `Bearer ${token}` } },
    { DB: db }
  );
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.user.id, 'u1');
  assert.equal(body.token.hint, row.hint);
  assert.equal(ok.headers.get('x-ratelimit-limit'), '120');
});

test('作用域：read 令牌写收藏 403，write 令牌可幂等收藏', async () => {
  const read = await bearerToken('read');
  const readDb = fakeDb({ tokens: [read.row] });
  const readApp = makeV1App(readDb);
  const denied = await readApp.request(
    '/api/open/v1/repos',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${read.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: 'acme/demo' }),
    },
    { DB: readDb }
  );
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error, 'insufficient_scope');

  const write = await bearerToken('write');
  const writeDb = fakeDb({ tokens: [write.row] });
  const writeApp = makeV1App(writeDb);
  const created = await writeApp.request(
    '/api/open/v1/repos',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${write.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: 'acme/demo', stars: 10, language: 'Go' }),
    },
    { DB: writeDb }
  );
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(createdBody.created, true);
  assert.equal(createdBody.repo.fullName, 'acme/demo');

  writeDb.repos.push(repoRow());
  const again = await writeApp.request(
    '/api/open/v1/repos',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${write.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: 'acme/demo' }),
    },
    { DB: writeDb }
  );
  assert.equal(again.status, 200);
  assert.equal((await again.json()).created, false);
});

test('GET /api/open/v1/repos：按当前用户过滤并返回分页结构', async () => {
  const { token, row } = await bearerToken('read');
  const db = fakeDb({ tokens: [row], repos: [repoRow()] });
  const app = makeV1App(db);

  const res = await app.request(
    '/api/open/v1/repos?q=demo&limit=10&offset=0',
    { headers: { Authorization: `Bearer ${token}` } },
    { DB: db }
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].fullName, 'acme/demo');
  assert.equal(body.limit, 10);
  assert.equal(body.offset, 0);
  assert.equal(body.total, 1);
  assert.equal(body.hasMore, false);
  const listCall = db.calls.find((call) => call.sql.includes('FROM my_repositories r'));
  assert.equal(listCall.params[0], 'u1');
});

test('GET /api/open/v1/trending：默认取最新快照', async () => {
  const { token, row } = await bearerToken('read');
  const snapshot = {
    snapshot_date: '2026-10-21',
    repo_id: 'trend/one',
    platform: 'github',
    owner: 'trend',
    name: 'one',
    html_url: 'https://github.com/trend/one',
    description: '热榜一',
    language: 'Rust',
    tech_stack: 'rust',
    stars: 5000,
    stars_today: 500,
    rank: 1,
    language_rank: 1,
    star_delta: 100,
    rank_delta: 0,
    appearances: 3,
    is_new: 0,
    trend: 'up',
    trending_pages: null,
  };
  const db = fakeDb({ tokens: [row], snapshots: [snapshot] });
  const app = makeV1App(db);

  const res = await app.request(
    '/api/open/v1/trending?limit=5',
    { headers: { Authorization: `Bearer ${token}` } },
    { DB: db }
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.snapshotDate, '2026-10-21');
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].id, 'trend/one');
});
