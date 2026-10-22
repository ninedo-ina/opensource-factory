import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildKeywordThemes,
  finalizeVectorResult,
  normalizeTag,
  normalizeThemeOptions,
  sanitizeRepoIds,
} from '../src/themes/helpers.ts';

function repo(id, language, stars = 10, extra = {}) {
  return {
    id,
    name: id.split('/').pop(),
    description: extra.description ?? '',
    summary: null,
    language,
    stars,
    ...extra,
  };
}

test('normalizeThemeOptions：默认值 / 夹取 / 非法值回落', () => {
  assert.deepEqual(normalizeThemeOptions(null), {
    minSimilarity: 0.55,
    minClusterSize: 2,
    maxClusters: 12,
  });
  assert.deepEqual(normalizeThemeOptions({ minSimilarity: 2, minClusterSize: 0, maxClusters: 999 }), {
    minSimilarity: 0.99,
    minClusterSize: 1,
    maxClusters: 50,
  });
  assert.deepEqual(
    normalizeThemeOptions({ minSimilarity: 'abc', minClusterSize: -3, maxClusters: 'x' }),
    { minSimilarity: 0.55, minClusterSize: 1, maxClusters: 12 }
  );
});

test('normalizeTag：大小写 / 空格 / 特殊字符', () => {
  assert.equal(normalizeTag(' Machine Learning '), 'machine-learning');
  assert.equal(normalizeTag('Vue_3'), 'vue-3');
  assert.equal(normalizeTag('***'), '');
  assert.equal(normalizeTag('C++'), 'c++');
});

test('sanitizeRepoIds：去空、去重、截断', () => {
  assert.deepEqual(sanitizeRepoIds(['a/b', ' a/b ', '', 42, 'c/d'], 2), ['a/b', 'c/d']);
  assert.deepEqual(sanitizeRepoIds('a/b'), []);
});

test('buildKeywordThemes：按语言分组并给出主题 / 统计', () => {
  const result = buildKeywordThemes(
    [
      repo('x/ts-one', 'TypeScript', 30, { description: 'React admin dashboard' }),
      repo('x/ts-two', 'typescript', 20, { description: 'React admin panel' }),
      repo('x/py-one', 'Python', 10),
      repo('x/solo', 'Rust', 5),
    ],
    { minSimilarity: 0.55, minClusterSize: 2, maxClusters: 12 },
    0
  );
  assert.equal(result.mode, 'keyword');
  assert.equal(result.themes.length, 1);
  assert.equal(result.themes[0].repoCount, 2);
  assert.deepEqual(result.themes[0].repos.map((item) => item.id), ['x/ts-one', 'x/ts-two']);
  assert.ok(result.themes[0].keywords.includes('react'));
  assert.equal(result.stats.totalRepos, 4);
  assert.equal(result.stats.clusteredRepos, 2);
  assert.equal(result.stats.coverage, 50);
  assert.deepEqual(
    result.unclustered.map((item) => [item.id, item.reason]),
    [
      ['x/py-one', 'singleton'],
      ['x/solo', 'singleton'],
    ]
  );
});

test('buildKeywordThemes：空仓库返回 empty 与全 0 统计', () => {
  const result = buildKeywordThemes([], { minSimilarity: 0.55, minClusterSize: 2, maxClusters: 12 });
  assert.equal(result.mode, 'empty');
  assert.deepEqual(result.themes, []);
  assert.deepEqual(result.stats, {
    totalRepos: 0,
    clusteredRepos: 0,
    themeCount: 0,
    coverage: 0,
    vectorized: 0,
    model: '',
    backend: '',
  });
});

test('buildKeywordThemes：超过 maxClusters 的组进入 overflow', () => {
  const result = buildKeywordThemes(
    [
      repo('x/a1', 'A'),
      repo('x/a2', 'A'),
      repo('x/b1', 'B'),
      repo('x/b2', 'B'),
    ],
    { minSimilarity: 0.55, minClusterSize: 2, maxClusters: 1 }
  );
  assert.equal(result.themes.length, 1);
  assert.equal(result.unclustered.filter((item) => item.reason === 'overflow').length, 2);
});

test('finalizeVectorResult：按主题重算覆盖率并补齐模型信息', () => {
  const themes = [
    {
      id: 'theme-1',
      name: 'AI / LLM',
      keywords: ['ai'],
      suggestedTags: ['ai'],
      repoCount: 3,
      cohesion: 0.8,
      repos: [],
    },
  ];
  const result = finalizeVectorResult(
    themes,
    [{ id: 'x/solo', name: 'solo', reason: 'singleton' }],
    5,
    4,
    'BAAI/bge-m3',
    'sentence-transformers',
    { minSimilarity: 0.55, minClusterSize: 2, maxClusters: 12 },
    '2026-10-22T00:00:00.000Z',
    12
  );
  assert.equal(result.mode, 'vector');
  assert.equal(result.stats.coverage, 60);
  assert.equal(result.stats.vectorized, 4);
  assert.equal(result.stats.model, 'BAAI/bge-m3');
  assert.equal(result.tookMs, 12);
});
