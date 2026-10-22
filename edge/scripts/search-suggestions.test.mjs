import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSuggestionItems,
  clampSuggestionLimit,
  escapeLikePattern,
  likeContains,
  normalizeSuggestionQuery,
  rankRepoSuggestions,
  rankTagSuggestions,
  repoLabel,
} from '../src/search/suggestions.ts';

const myRepo = {
  id: 'demo/tenant-admin',
  name: 'tenant-admin',
  owner: 'demo',
  description: '支持多租户的 NestJS 管理后台模板',
  language: 'TypeScript',
  stars: 356,
  html_url: 'https://github.com/demo/tenant-admin',
  source: 'my',
};

const trendingRepo = {
  id: 'nestjs/awesome-nestjs',
  name: 'awesome-nestjs',
  owner: 'nestjs',
  description: 'NestJS 生态资源合集',
  language: 'TypeScript',
  stars: 12800,
  stars_today: 42,
  html_url: 'https://github.com/nestjs/awesome-nestjs',
  source: 'trending',
};

test('normalizeSuggestionQuery：去空白、压缩空白、非字符串与超长截断', () => {
  assert.equal(normalizeSuggestionQuery('  多租户   NestJS  '), '多租户 NestJS');
  assert.equal(normalizeSuggestionQuery(undefined), '');
  assert.equal(normalizeSuggestionQuery(123), '');
  assert.equal(normalizeSuggestionQuery('x'.repeat(150)).length, 100);
});

test('clampSuggestionLimit：默认 8，范围 1~10', () => {
  assert.equal(clampSuggestionLimit(undefined), 8);
  assert.equal(clampSuggestionLimit('0'), 1);
  assert.equal(clampSuggestionLimit('5'), 5);
  assert.equal(clampSuggestionLimit('99'), 10);
  assert.equal(clampSuggestionLimit('abc'), 8);
});

test('escapeLikePattern：转义反斜杠与 LIKE 通配符', () => {
  assert.equal(escapeLikePattern('100%_a\\b'), '100\\%\\_a\\\\b');
  assert.equal(likeContains('a%b'), '%a\\%b%');
});

test('repoLabel：优先 owner/name，缺 owner 回退 id', () => {
  assert.equal(repoLabel(myRepo), 'demo/tenant-admin');
  assert.equal(repoLabel({ ...myRepo, owner: null }), 'demo/tenant-admin');
});

test('rankRepoSuggestions：同 id 去重且保留先出现的来源', () => {
  const items = rankRepoSuggestions('tenant', [
    myRepo,
    { ...myRepo, source: 'trending', stars: 99999 },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].source, 'my');
  assert.equal(items[0].value, 'demo/tenant-admin');
});

test('rankRepoSuggestions：前缀命中优先于包含命中，热度兜底', () => {
  const items = rankRepoSuggestions('nest', [
    trendingRepo,
    { ...myRepo, id: 'demo/awesome-nest', name: 'awesome-nest', stars: 1 },
  ]);
  assert.equal(items[0].value, 'nestjs/awesome-nestjs');
  assert.equal(items[1].value, 'demo/awesome-nest');
});

test('rankRepoSuggestions：limit 生效且空查询按热度排序', () => {
  const items = rankRepoSuggestions('', [myRepo, trendingRepo], 1);
  assert.equal(items.length, 1);
  assert.equal(items[0].source, 'trending');
});

test('rankTagSuggestions：前缀优先、按使用次数降序、去重', () => {
  const items = rankTagSuggestions('re', [
    { name: 'React', count: 3 },
    { name: 'Vue', count: 9 },
    { name: 'react', count: 1 },
    { name: 'Redux', count: 5 },
  ]);
  assert.deepEqual(
    items.map((item) => item.label),
    ['Redux', 'React']
  );
  assert.equal(items[0].description, '5 个仓库使用');
});

test('buildSuggestionItems：查询为空时标签优先，非空时仓库优先', () => {
  const hot = buildSuggestionItems('', [myRepo], [{ name: 'TypeScript', count: 2 }], 4);
  assert.equal(hot[0].type, 'tag');
  assert.equal(hot[1].type, 'repo');

  const keyword = buildSuggestionItems('tenant', [myRepo], [{ name: 'TypeScript', count: 2 }], 4);
  assert.equal(keyword[0].type, 'repo');
  assert.equal(keyword[0].value, 'demo/tenant-admin');
});

test('buildSuggestionItems：空查询标签很多时仍为仓库保留名额', () => {
  const tags = Array.from({ length: 10 }, (_, index) => ({
    name: `tag-${index}`,
    count: 10 - index,
  }));
  const items = buildSuggestionItems('', [myRepo], tags, 4);
  assert.equal(items.length, 3);
  assert.equal(items[0].type, 'tag');
  assert.ok(items.some((item) => item.type === 'repo'));
});

test('buildSuggestionItems：总数受 limit 限制且结果 id 唯一', () => {
  const items = buildSuggestionItems(
    '',
    [myRepo, trendingRepo],
    [
      { name: 'TypeScript', count: 3 },
      { name: 'React', count: 2 },
    ],
    2
  );
  assert.equal(items.length, 2);
  assert.equal(new Set(items.map((item) => item.id)).size, 2);
});
