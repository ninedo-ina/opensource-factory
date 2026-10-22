import assert from 'node:assert/strict';
import test from 'node:test';

import { parseRepoFullName, parseRepoReference, parseRepoUrl } from '../src/repo.js';

test('parseRepoFullName 接受 owner/repo 并去除 .git', () => {
  assert.deepEqual(parseRepoFullName('acme/demo'), {
    owner: 'acme',
    name: 'demo',
    fullName: 'acme/demo',
  });
  assert.equal(parseRepoFullName('acme/demo.git')?.fullName, 'acme/demo');
});

test('parseRepoFullName 拒绝非法与保留路径', () => {
  assert.equal(parseRepoFullName('just-one'), null);
  assert.equal(parseRepoFullName('a/b/c'), null);
  assert.equal(parseRepoFullName('settings/profile'), null);
  assert.equal(parseRepoFullName(''), null);
  assert.equal(parseRepoFullName(null), null);
});

test('parseRepoUrl 识别 GitHub / Gitee 并规范化 URL', () => {
  assert.deepEqual(parseRepoUrl('https://github.com/acme/demo/tree/main'), {
    platform: 'github',
    owner: 'acme',
    name: 'demo',
    fullName: 'acme/demo',
    url: 'https://github.com/acme/demo',
  });
  assert.equal(parseRepoUrl('https://gitee.com/acme/demo')?.platform, 'gitee');
  assert.equal(parseRepoUrl('https://example.com/acme/demo'), null);
  assert.equal(parseRepoUrl('not a url'), null);
});

test('parseRepoReference 默认 GitHub', () => {
  assert.equal(parseRepoReference('acme/demo')?.platform, 'github');
  assert.equal(parseRepoReference('acme/demo')?.url, 'https://github.com/acme/demo');
});
