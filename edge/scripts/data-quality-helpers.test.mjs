import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDuplicateIssues,
  buildIssueId,
  buildLinkIssues,
  checkAllMetadata,
  checkRepoMetadata,
  descriptionFromSummary,
  isFixableField,
  mergeIssueDrafts,
  normalizeIssueStatus,
  normalizeQualitySeverity,
  normalizeQualityType,
  scoreQuality,
  summarizeQuality,
} from '../src/data-quality/checks.ts';

function repo(overrides = {}) {
  return {
    repoId: 'acme/demo',
    name: 'demo',
    fullName: 'acme/demo',
    htmlUrl: 'https://github.com/acme/demo',
    platform: 'github',
    description: '一个演示项目',
    language: 'TypeScript',
    stars: 10,
    forks: 1,
    readmeSummary: '演示项目的 README 摘要。',
    categoryId: 'cat_dev',
    licenseSpdx: 'MIT',
    licenseName: 'MIT License',
    licenseCheckedAt: '2026-10-01T00:00:00Z',
    syncedAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

test('descriptionFromSummary 取第一句并限制长度', () => {
  assert.equal(descriptionFromSummary('第一句。第二句。'), '第一句。');
  assert.equal(descriptionFromSummary('  多个   空格\n换行  '), '多个 空格 换行');
  assert.equal(descriptionFromSummary(''), '');
  assert.equal(descriptionFromSummary('a'.repeat(500)).length, 300);
});

test('checkRepoMetadata 完整仓库无问题', () => {
  assert.deepEqual(checkRepoMetadata(repo(), Date.parse('2026-10-20T00:00:00Z')), []);
});

test('checkRepoMetadata 检出简介 / 语言 / License / 摘要 / 分类缺失', () => {
  const issues = checkRepoMetadata(
    repo({
      description: '',
      readmeSummary: '',
      language: '',
      licenseSpdx: '',
      licenseCheckedAt: '',
      categoryId: '',
    }),
    Date.parse('2026-10-20T00:00:00Z')
  );
  const keys = issues.map((issue) => issue.issueKey);
  assert.deepEqual(keys.sort(), [
    'missing_metadata:category',
    'missing_metadata:description',
    'missing_metadata:language',
    'missing_metadata:license',
    'missing_metadata:summary',
  ]);
  assert.equal(issues.find((issue) => issue.issueKey === 'missing_metadata:description').severity, 'warning');
});

test('checkRepoMetadata 超过 90 天标记陈旧', () => {
  const issues = checkRepoMetadata(
    repo({ syncedAt: '2026-01-01T00:00:00Z' }),
    Date.parse('2026-10-20T00:00:00Z')
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].type, 'stale_metadata');
  assert.equal(issues[0].severity, 'warning');
  assert.match(issues[0].detail, /292 天/);
});

test('checkAllMetadata 汇总全部仓库', () => {
  const issues = checkAllMetadata(
    [repo(), repo({ repoId: 'acme/two', name: 'two', language: '' })],
    Date.parse('2026-10-20T00:00:00Z')
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].repoId, 'acme/two');
});

test('buildDuplicateIssues 复用名称聚类，保留项不报', () => {
  const issues = buildDuplicateIssues([
    repo({ repoId: 'acme/tenant-admin', name: 'tenant-admin', stars: 10 }),
    repo({ repoId: 'acme/tenant_admin', name: 'tenant_admin', stars: 2 }),
  ]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].type, 'duplicate');
  assert.equal(issues[0].repoId, 'acme/tenant_admin');
  assert.match(issues[0].issueKey, /^duplicate:dup_/);
});

test('buildLinkIssues 404 为 critical，重定向为 warning，ok 不报', () => {
  const repos = [repo()];
  const broken = buildLinkIssues(repos, [
    { repoId: 'acme/demo', status: 'broken', httpStatus: 404 },
  ]);
  assert.equal(broken.length, 1);
  assert.equal(broken[0].severity, 'critical');
  assert.match(broken[0].detail, /HTTP 404/);

  const redirected = buildLinkIssues(repos, [
    { repoId: 'acme/demo', status: 'redirected', finalUrl: 'https://github.com/acme/new-name' },
  ]);
  assert.equal(redirected.length, 1);
  assert.equal(redirected[0].severity, 'warning');
  assert.match(redirected[0].detail, /new-name/);

  assert.deepEqual(
    buildLinkIssues(repos, [
      { repoId: 'acme/demo', status: 'ok' },
      { repoId: 'acme/missing', status: 'broken' },
    ]),
    []
  );
});

test('mergeIssueDrafts 按仓库 + issueKey 去重，后者覆盖', () => {
  const first = checkRepoMetadata(repo({ language: '' }), Date.parse('2026-10-20T00:00:00Z'));
  const second = first.map((issue) => ({ ...issue, title: '覆盖后的标题' }));
  const merged = mergeIssueDrafts(first, second);
  assert.equal(merged.length, first.length);
  assert.equal(merged[0].title, '覆盖后的标题');
});

test('scoreQuality / summarizeQuality 分级计分', () => {
  const issues = [
    { severity: 'critical', type: 'broken_link' },
    { severity: 'warning', type: 'duplicate' },
    { severity: 'warning', type: 'missing_metadata' },
    { severity: 'info', type: 'missing_metadata' },
  ];
  assert.equal(scoreQuality(issues), 100 - 8 - 4 - 4 - 1);
  const counts = summarizeQuality(issues);
  assert.equal(counts.total, 4);
  assert.equal(counts.critical, 1);
  assert.equal(counts.warning, 2);
  assert.equal(counts.info, 1);
  assert.equal(counts.byType.broken_link, 1);
  assert.equal(counts.byType.duplicate, 1);
  assert.equal(counts.byType.missing_metadata, 2);
});

test('scoreQuality 下限为 0', () => {
  const issues = Array.from({ length: 30 }, () => ({ severity: 'critical', type: 'broken_link' }));
  assert.equal(scoreQuality(issues), 0);
});

test('buildIssueId 稳定且区分用户 / 仓库 / 键', () => {
  const id = buildIssueId('u1', 'acme/demo', 'missing_metadata:language');
  assert.match(id, /^dq_[0-9a-f]{8}$/);
  assert.equal(id, buildIssueId('u1', 'acme/demo', 'missing_metadata:language'));
  assert.notEqual(id, buildIssueId('u2', 'acme/demo', 'missing_metadata:language'));
  assert.notEqual(id, buildIssueId('u1', 'acme/other', 'missing_metadata:language'));
});

test('normalize 系列对非法值回退', () => {
  assert.equal(normalizeQualityType('broken_link'), 'broken_link');
  assert.equal(normalizeQualityType('nope'), 'missing_metadata');
  assert.equal(normalizeQualitySeverity('critical'), 'critical');
  assert.equal(normalizeQualitySeverity('nope'), 'info');
  assert.equal(normalizeIssueStatus('ignored'), 'ignored');
  assert.equal(normalizeIssueStatus('nope'), 'open');
});

test('isFixableField 只允许可自动回填字段', () => {
  assert.equal(isFixableField('description'), true);
  assert.equal(isFixableField('language'), true);
  assert.equal(isFixableField('license'), true);
  assert.equal(isFixableField('html_url'), true);
  assert.equal(isFixableField('synced_at'), true);
  assert.equal(isFixableField('category'), false);
  assert.equal(isFixableField('summary'), false);
});
