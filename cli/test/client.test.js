import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiClient, ApiError, buildQuery } from '../src/client.js';

function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const result = handler(url, init);
    return new Response(JSON.stringify(result.body ?? {}), {
      status: result.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { impl, calls };
}

test('buildQuery 跳过空值并编码', () => {
  assert.equal(buildQuery({ q: 'a b', limit: 10, offset: 0, empty: '', none: null }), '?q=a+b&limit=10&offset=0');
  assert.equal(buildQuery({}), '');
  assert.equal(buildQuery(undefined), '');
});

test('ApiClient 自动带 Bearer 与查询参数', async () => {
  const { impl, calls } = fakeFetch(() => ({ body: { ok: true } }));
  const client = new ApiClient({ baseUrl: 'https://api.example.com/', token: 'ofp_x', fetchImpl: impl });
  const data = await client.get('/api/v1/repos', { limit: 5, q: '' });
  assert.deepEqual(data, { ok: true });
  assert.equal(calls[0].url, 'https://api.example.com/api/v1/repos?limit=5');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer ofp_x');
});

test('ApiClient POST 序列化 JSON', async () => {
  const { impl, calls } = fakeFetch(() => ({ status: 201, body: { created: true } }));
  const client = new ApiClient({ baseUrl: 'https://api.example.com', token: 'ofp_x', fetchImpl: impl });
  const data = await client.post('/api/v1/repos', { repo: 'acme/demo' });
  assert.equal(data.created, true);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body, '{"repo":"acme/demo"}');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
});

test('非 2xx 抛 ApiError，携带状态与服务端 message', async () => {
  const { impl } = fakeFetch(() => ({
    status: 403,
    body: { error: 'insufficient_scope', message: '缺少 write 权限' },
  }));
  const client = new ApiClient({ baseUrl: 'https://api.example.com', token: 'ofp_x', fetchImpl: impl });
  await assert.rejects(
    () => client.post('/api/v1/repos', { repo: 'acme/demo' }),
    (error) => {
      assert.equal(error instanceof ApiError, true);
      assert.equal(error.status, 403);
      assert.equal(error.message, '缺少 write 权限');
      return true;
    }
  );
});

test('网络错误转换为 ApiError(status=0)', async () => {
  const client = new ApiClient({
    baseUrl: 'https://api.example.com',
    token: 'ofp_x',
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  await assert.rejects(
    () => client.get('/api/v1/me'),
    (error) => error instanceof ApiError && error.status === 0 && error.message.includes('ECONNREFUSED')
  );
});
