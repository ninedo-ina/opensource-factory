import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  clearToken,
  configPath,
  loadConfig,
  maskToken,
  normalizeApiUrl,
  saveConfig,
} from '../src/config.js';

function tempEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'of-cli-'));
  return { OF_CONFIG_DIR: dir, dir };
}

test('saveConfig / loadConfig 往返，令牌不丢失', () => {
  const env = tempEnv();
  const file = saveConfig({ apiUrl: 'https://api.example.com', token: 'ofp_test' }, env);
  assert.equal(file, configPath(env));
  const loaded = loadConfig(env);
  assert.equal(loaded.apiUrl, 'https://api.example.com');
  assert.equal(loaded.token, 'ofp_test');
  assert.equal(typeof loaded.updatedAt, 'string');

  if (process.platform !== 'win32') {
    const mode = fs.statSync(file).mode & 0o777;
    assert.equal(mode, 0o600);
  }
});

test('loadConfig 文件不存在或损坏时返回空对象', () => {
  const env = tempEnv();
  assert.deepEqual(loadConfig(env), {});
  fs.writeFileSync(configPath(env), '{not json');
  assert.deepEqual(loadConfig(env), {});
});

test('clearToken 保留 API 地址', () => {
  const env = tempEnv();
  saveConfig({ apiUrl: 'https://api.example.com', token: 'ofp_test' }, env);
  clearToken(env);
  const loaded = loadConfig(env);
  assert.equal(loaded.apiUrl, 'https://api.example.com');
  assert.equal(loaded.token, undefined);
});

test('maskToken 不暴露完整令牌', () => {
  assert.equal(maskToken(''), '');
  assert.equal(maskToken('short'), 'sh…');
  const masked = maskToken('ofp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(masked.startsWith('ofp_aa'), true);
  assert.equal(masked.includes('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), false);
});

test('normalizeApiUrl 去尾斜杠并补协议', () => {
  assert.equal(normalizeApiUrl('https://api.example.com/'), 'https://api.example.com');
  assert.equal(normalizeApiUrl('api.example.com'), 'https://api.example.com');
  assert.equal(normalizeApiUrl('http://localhost:8787/'), 'http://localhost:8787');
  assert.equal(normalizeApiUrl(''), '');
});
