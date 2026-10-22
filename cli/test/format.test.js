import assert from 'node:assert/strict';
import test from 'node:test';

import {
  displayWidth,
  formatRecommendations,
  formatRepoDetail,
  formatRepoList,
  formatTrending,
  padEndWidth,
  renderTable,
  truncate,
} from '../src/format.js';

test('displayWidth 把中日韩字符按两列计算', () => {
  assert.equal(displayWidth('abc'), 3);
  assert.equal(displayWidth('中文'), 4);
  assert.equal(displayWidth('a中'), 3);
});

test('truncate 按显示宽度截断并加省略号', () => {
  assert.equal(truncate('abcdef', 10), 'abcdef');
  assert.equal(truncate('abcdef', 4), 'abc…');
  assert.equal(truncate('中文中文', 5), '中文…');
});

test('padEndWidth 补齐到目标宽度', () => {
  assert.equal(padEndWidth('ab', 4), 'ab  ');
  assert.equal(padEndWidth('中文', 4), '中文');
  assert.equal(padEndWidth('中文', 6), '中文  ');
});

test('renderTable 输出表头、分隔线与对齐内容', () => {
  const table = renderTable(
    [
      { title: '仓库', key: 'name' },
      { title: 'Star', key: 'stars', align: 'right' },
    ],
    [
      { name: 'a/b', stars: 12 },
      { name: 'c/d', stars: 3 },
    ]
  );
  const lines = table.split('\n');
  assert.equal(lines.length, 4);
  assert.match(lines[0], /仓库/);
  assert.match(lines[1], /─/);
  assert.equal(lines[2].endsWith('12'), true);
  assert.equal(lines[3].endsWith(' 3'), true);
});

test('formatRepoList 空列表给出引导', () => {
  assert.match(formatRepoList({ items: [], total: 0 }), /还没有收藏/);
});

test('formatRepoList / formatTrending / formatRecommendations 输出表格', () => {
  const repoList = formatRepoList({
    total: 1,
    items: [{ fullName: 'a/b', language: 'Go', stars: 1, category: null, description: null }],
  });
  assert.match(repoList, /共 1 个收藏/);
  assert.match(repoList, /a\/b/);

  const trending = formatTrending({
    date: '2026-10-22',
    items: [{ rank: 1, fullName: 'x/y', language: 'Rust', starsToday: 10, stars: 100 }],
  });
  assert.match(trending, /今日热榜（2026-10-22）/);

  const recommendations = formatRecommendations({
    status: 'new',
    items: [{ repoId: 'x/y', language: 'Rust', stars: 1, reason: '相似' }],
  });
  assert.match(recommendations, /推荐（new）/);
});

test('formatRepoDetail 展示关键字段', () => {
  const detail = formatRepoDetail({
    fullName: 'a/b',
    url: 'https://github.com/a/b',
    language: 'Go',
    stars: 10,
    forks: 2,
    category: '工具',
    tags: ['cli'],
    description: 'desc',
    summary: 'summary',
    updatedAt: '2026-10-22',
  });
  assert.match(detail, /a\/b/);
  assert.match(detail, /标签：cli/);
});
