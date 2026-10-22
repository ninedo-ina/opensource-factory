import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { run } from '../src/main.js';

const TOKEN = `ofp_${'c'.repeat(48)}`;

function recorder() {
  const lines = [];
  return { lines, out: (line) => lines.push(line) };
}

function fakeClient(overrides = {}) {
  const calls = [];
  return {
    calls,
    async get(path, query) {
      calls.push({ method: 'get', path, query });
      if (path === '/api/v1/me') {
        return { user: { login: 'tester', name: 'Tester' }, token: { hint: 'ofp_cccc…cccc', scopes: ['read', 'write'] } };
      }
      if (path === '/api/v1/repos') return { total: 0, items: [] };
      return { items: [] };
    },
    async post(path, body) {
      calls.push({ method: 'post', path, body });
      return { created: true, repo: { fullName: body.repo } };
    },
    async delete(path) {
      calls.push({ method: 'delete', path });
      return { removed: true };
    },
    ...overrides,
  };
}

const baseDeps = (client) => ({
  config: { apiUrl: 'https://api.example.com', token: 'ofp_x' },
  client,
});

test('无命令时输出帮助并返回 0', async () => {
  const { lines, out } = recorder();
  const code = await run([], { out });
  assert.equal(code, 0);
  assert.match(lines.join('\n'), /OpenFactory CLI/);
});

test('--version 输出版本号', async () => {
  const { lines, out } = recorder();
  const code = await run(['--version'], { out });
  assert.equal(code, 0);
  assert.match(lines[0], /^of \d+\.\d+\.\d+/);
});

test('未知命令返回 2', async () => {
  const { out } = recorder();
  const errors = [];
  const code = await run(['nope'], { out, err: (line) => errors.push(line) });
  assert.equal(code, 2);
  assert.match(errors.join('\n'), /未知命令/);
});

test('whoami 输出用户信息', async () => {
  const { lines, out } = recorder();
  const client = fakeClient();
  const code = await run(['whoami'], { ...baseDeps(client), out });
  assert.equal(code, 0);
  assert.match(lines.join('\n'), /tester/);
});

test('list --json 输出可解析 JSON', async () => {
  const { lines, out } = recorder();
  const client = fakeClient();
  const code = await run(['list', '--json', '--limit', '5'], { ...baseDeps(client), out });
  assert.equal(code, 0);
  const payload = JSON.parse(lines[0]);
  assert.equal(payload.total, 0);
  assert.deepEqual(client.calls[0].query, {
    q: '',
    language: '',
    category: '',
    tag: '',
    limit: 5,
    offset: 0,
  });
});

test('add 解析仓库并 POST', async () => {
  const { lines, out } = recorder();
  const client = fakeClient();
  const code = await run(['add', 'https://github.com/acme/demo', '--stars', '9'], {
    ...baseDeps(client),
    out,
  });
  assert.equal(code, 0);
  assert.equal(client.calls[0].body.repo, 'acme/demo');
  assert.equal(client.calls[0].body.stars, 9);
  assert.match(lines[0], /已收藏 acme\/demo/);
});

test('remove 未带 --yes 时拒绝执行', async () => {
  const { out } = recorder();
  const errors = [];
  const client = fakeClient();
  const code = await run(['remove', 'acme/demo'], {
    ...baseDeps(client),
    out,
    err: (line) => errors.push(line),
  });
  assert.equal(code, 2);
  assert.equal(client.calls.length, 0);
  assert.match(errors.join('\n'), /--yes/);
});

test('remove --yes 调用 DELETE', async () => {
  const { lines, out } = recorder();
  const client = fakeClient();
  const code = await run(['remove', 'acme/demo', '--yes'], { ...baseDeps(client), out });
  assert.equal(code, 0);
  assert.equal(client.calls[0].path, '/api/v1/repos/acme/demo');
  assert.match(lines[0], /已取消收藏/);
});

test('未登录且非 login/config 时返回 2', async () => {
  const errors = [];
  const code = await run(['list'], {
    config: {},
    env: {},
    out: () => {},
    err: (line) => errors.push(line),
  });
  assert.equal(code, 2);
  assert.match(errors.join('\n'), /尚未登录/);
});

test('login 校验令牌并写入配置文件，不打印明文', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'of-cli-login-'));
  const env = { OF_CONFIG_DIR: dir };
  const { lines, out } = recorder();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(
      JSON.stringify({
        user: { login: 'tester', name: 'Tester' },
        token: { hint: 'ofp_cccc…cccc', scopes: ['read', 'write'] },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const code = await run(['login', '--token', TOKEN, '--url', 'https://api.example.com'], {
    env,
    config: {},
    fetchImpl,
    out,
  });
  assert.equal(code, 0);
  assert.equal(calls[0].url, 'https://api.example.com/api/v1/me');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);

  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  assert.equal(saved.token, TOKEN);
  assert.equal(saved.apiUrl, 'https://api.example.com');
  assert.equal(lines.join('\n').includes(TOKEN), false);
});

test('API 401 返回 1 并提示重新登录', async () => {
  const { out } = recorder();
  const errors = [];
  const { ApiError } = await import('../src/client.js');
  const client = fakeClient({
    async get() {
      throw new ApiError('unauthorized', { status: 401 });
    },
  });
  const code = await run(['whoami'], { ...baseDeps(client), out, err: (line) => errors.push(line) });
  assert.equal(code, 1);
  assert.match(errors.join('\n'), /认证失败/);
});
