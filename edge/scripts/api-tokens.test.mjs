import assert from 'node:assert/strict';
import test from 'node:test';

import { Hono } from 'hono';
import {
  API_TOKEN_PREFIX,
  generateApiToken,
  generateApiTokenId,
  hasScope,
  isApiTokenFormat,
  normalizeScopes,
  normalizeTokenLabel,
  parseRepoReference,
  parseScopes,
  toApiTokenDto,
  tokenHint,
} from '../src/api-tokens/helpers.ts';
import { resolveApiTokenAuth } from '../src/api-tokens/auth.ts';
import v1Routes from '../src/routes/v1.ts';

const TOKEN = `${API_TOKEN_PREFIX}${'a'.repeat(48)}`;

function tokenRow(overrides = {}) {
  return {
    id: 'tok_test',
    user_id: 'u1',
    label: 'CLI 令牌',
    token_hash: 'hash',
    hint: 'ofp_aaaa…aaaa',
    scopes: 'read write',
    created_at: '2026-10-22T00:00:00.000Z',
    last_used_at: null,
    revoked_at: null,
    expires_at: null,
    ...overrides,
  };
}

function userRow() {
  return {
    id: 'u1',
    login: 'tester',
    name: 'Tester',
    avatar_url: 'https://example.com/a.png',
    email: null,
    created_at: null,
  };
}

function repoRow(overrides = {}) {
  return {
    id: 'acme/demo',
    platform: 'github',
    name: 'demo',
    description: '演示仓库',
    html_url: 'https://github.com/acme/demo',
    stars: 42,
    language: 'TypeScript',
    readme_summary: '摘要',
    category_id: 'cat-1',
    category_name: '工具',
    tag_names: 'cli,node',
    created_at: '2026-10-01T00:00:00.000Z',
    user_id: 'u1',
    owner: 'acme',
    forks: 3,
    updated_at: '2026-10-20T00:00:00.000Z',
    synced_at: null,
    ...overrides,
  };
}

/**
 * 极简 D1 假实现：按 SQL 片段返回预设数据。
 * - token：任何 token_hash 查询都返回给定令牌；
 * - 收藏：内存 rows + ownerOf 模拟唯一约束；
 * - 其余查询返回空集。
 */
function fakeDb({ token = tokenRow(), rows = [] } = {}) {
  const calls = [];
  const ownerOf = new Map(rows.map((row) => [row.id, row.user_id]));

  return {
    calls,
    prepare(sql) {
      return {
        bind(...params) {
          calls.push({ sql, params });
          return {
            async first() {
              if (sql.includes('FROM api_tokens') && sql.includes('token_hash')) return token;
              if (sql.includes('FROM users')) return userRow();
              if (sql.includes('SELECT user_id FROM my_repositories')) {
                return ownerOf.has(params[0]) ? { user_id: ownerOf.get(params[0]) } : null;
              }
              if (sql.includes('SELECT COUNT(*)')) return { n: rows.length };
              if (sql.includes('FROM my_repositories r')) {
                return rows.find((row) => row.id === params[0]) ?? null;
              }
              return null;
            },
            async all() {
              if (sql.includes('FROM my_repositories')) return { results: rows };
              return { results: [] };
            },
            async run() {
              if (sql.includes('INSERT INTO my_repositories')) {
                const row = repoRow({
                  id: params[0],
                  platform: params[1],
                  name: params[2],
                  description: params[3],
                  html_url: params[4],
                  stars: params[5],
                  language: params[6],
                  owner: params[8],
                  forks: params[9],
                  user_id: params[7],
                });
                rows.push(row);
                ownerOf.set(row.id, row.user_id);
              }
              if (sql.includes('DELETE FROM my_repositories')) {
                const index = rows.findIndex((row) => row.id === params[0]);
                if (index >= 0) rows.splice(index, 1);
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

function makeApp(db) {
  const app = new Hono();
  app.use('/api/v1/*', async (c, next) => {
    const auth = await resolveApiTokenAuth(c);
    c.set('user', auth?.user ?? null);
    c.set('apiToken', auth?.token ?? null);
    await next();
  });
  app.route('/api/v1', v1Routes);
  return app;
}

const authHeaders = (token = TOKEN) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

test('令牌格式：ofp_ + 48 位十六进制，hint 不泄露完整明文', () => {
  const token = generateApiToken();
  assert.match(token, /^ofp_[a-f0-9]{48}$/);
  assert.equal(isApiTokenFormat(token), true);
  assert.equal(isApiTokenFormat('ofp_short'), false);
  assert.equal(isApiTokenFormat(`ghp_${'a'.repeat(48)}`), false);
  const hint = tokenHint(token);
  assert.equal(hint.startsWith('ofp_'), true);
  assert.equal(hint.includes(token.slice(5, 45)), false);
  assert.match(generateApiTokenId(), /^tok_[a-f0-9]{16}$/);
});

test('scope 归一化：只接受 read / write，空值默认全量', () => {
  assert.deepEqual(normalizeScopes(undefined), ['read', 'write']);
  assert.deepEqual(normalizeScopes(['write', 'admin', 'read']), ['read', 'write']);
  assert.deepEqual(normalizeScopes('write'), ['write']);
  assert.deepEqual(parseScopes('read'), ['read']);
  assert.deepEqual(parseScopes('write read'), ['read', 'write']);
  assert.deepEqual(parseScopes('admin'), []);
  assert.equal(hasScope(['read'], 'write'), false);
});

test('令牌名称与 DTO：折叠空白、截断，且不输出 token_hash', () => {
  assert.equal(normalizeTokenLabel('  my   cli  '), 'my cli');
  assert.equal(normalizeTokenLabel(''), 'CLI 令牌');
  assert.equal(normalizeTokenLabel('x'.repeat(100)).length, 60);
  const dto = toApiTokenDto(tokenRow());
  assert.equal(dto.id, 'tok_test');
  assert.deepEqual(dto.scopes, ['read', 'write']);
  assert.equal('token_hash' in dto, false);
});

test('仓库引用解析：owner/repo 与 GitHub / Gitee URL', () => {
  assert.equal(parseRepoReference('acme/demo')?.fullName, 'acme/demo');
  assert.equal(parseRepoReference('https://github.com/acme/demo.git')?.platform, 'github');
  assert.equal(parseRepoReference('https://gitee.com/acme/demo')?.platform, 'gitee');
  assert.equal(parseRepoReference('https://example.com/acme/demo'), null);
  assert.equal(parseRepoReference('settings/profile'), null);
  assert.equal(parseRepoReference('just-one-part'), null);
});

test('无凭证访问 /api/v1/repos 返回 401', async () => {
  const db = fakeDb();
  const app = makeApp(db);
  const res = await app.request('/api/v1/repos', undefined, { DB: db });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: 'unauthorized' });
});

test('有效令牌可读取收藏列表，响应带分类与标签', async () => {
  const db = fakeDb({ rows: [repoRow()] });
  const app = makeApp(db);
  const res = await app.request('/api/v1/repos', { headers: authHeaders() }, { DB: db });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.total, 1);
  assert.equal(body.items[0].fullName, 'acme/demo');
  assert.equal(body.items[0].category, '工具');
  assert.deepEqual(body.items[0].tags, ['cli', 'node']);
});

test('只读令牌写收藏返回 403 insufficient_scope', async () => {
  const db = fakeDb({ token: tokenRow({ scopes: 'read' }) });
  const app = makeApp(db);
  const res = await app.request('/api/v1/repos', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ repo: 'acme/new-repo' }),
  }, { DB: db });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, 'insufficient_scope');
  assert.equal(body.required, 'write');
});

test('写令牌收藏仓库：首次 201，再次幂等 200', async () => {
  const db = fakeDb();
  const app = makeApp(db);

  const first = await app.request('/api/v1/repos', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ repo: 'https://github.com/acme/new-repo', stars: 7 }),
  }, { DB: db });
  assert.equal(first.status, 201);
  const firstBody = await first.json();
  assert.equal(firstBody.created, true);
  assert.equal(firstBody.repo.fullName, 'acme/new-repo');
  assert.equal(firstBody.repo.stars, 7);

  const second = await app.request('/api/v1/repos', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ repo: 'acme/new-repo' }),
  }, { DB: db });
  assert.equal(second.status, 200);
  assert.equal((await second.json()).created, false);
});

test('收藏已被其他用户占用时返回 409', async () => {
  const db = fakeDb({ rows: [repoRow({ id: 'acme/shared', user_id: 'other' })] });
  const app = makeApp(db);
  const res = await app.request('/api/v1/repos', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ repo: 'acme/shared' }),
  }, { DB: db });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'repo_owned_by_other_user');
});

test('非法仓库引用返回 400', async () => {
  const db = fakeDb();
  const app = makeApp(db);
  const res = await app.request('/api/v1/repos', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ repo: 'not-a-repo' }),
  }, { DB: db });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_repo');
});

test('/api/v1/me 返回用户信息与令牌 DTO', async () => {
  const db = fakeDb();
  const app = makeApp(db);
  const res = await app.request('/api/v1/me', { headers: authHeaders() }, { DB: db });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.user.login, 'tester');
  assert.equal(body.token.id, 'tok_test');
  assert.equal(body.token.token_hash, undefined);
});
