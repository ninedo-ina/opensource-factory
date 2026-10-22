/**
 * 数据质量治理纯函数（M9-05 / REQ-202610-0982）。
 *
 * 负责把 D1 中的收藏库行转换为「问题草案」：
 * - 元数据缺失 / 陈旧（简介、语言、License、摘要、分类）；
 * - 重复条目（复用 M6-03 的 detectNameDuplicates）；
 * - 失效 / 重定向链接（由 VPS 检测后回传，这里只做归一与合并）。
 *
 * 不访问 D1 / 网络，便于 node:test 直接覆盖。
 */
import {
  detectNameDuplicates,
  type DuplicateCluster,
  type DuplicateRepoInput,
} from '../duplicates/helpers';

export type QualityIssueType =
  | 'duplicate'
  | 'broken_link'
  | 'missing_metadata'
  | 'stale_metadata';
export type QualitySeverity = 'critical' | 'warning' | 'info';
export type QualityIssueStatus = 'open' | 'ignored' | 'fixed';

export interface QualityRepoInput {
  repoId: string;
  name: string;
  fullName: string;
  htmlUrl: string;
  platform: string;
  description: string;
  language: string;
  stars: number;
  forks: number;
  readmeSummary: string;
  categoryId: string;
  licenseSpdx: string;
  licenseName: string;
  licenseCheckedAt: string;
  syncedAt: string;
  updatedAt: string;
}

export interface QualityIssueDraft {
  issueKey: string;
  repoId: string;
  type: QualityIssueType;
  severity: QualitySeverity;
  field: string;
  title: string;
  detail: string;
  suggestion: string;
}

export interface LinkCheckResult {
  repoId: string;
  status: 'ok' | 'broken' | 'redirected' | 'unknown';
  httpStatus?: number | null;
  finalUrl?: string | null;
  error?: string | null;
}

export interface QualityCounts {
  total: number;
  critical: number;
  warning: number;
  info: number;
  byType: Record<QualityIssueType, number>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const STALE_AFTER_DAYS = 90;
export const MAX_LINK_CHECKS = 30;

const ISSUE_TYPES: QualityIssueType[] = [
  'duplicate',
  'broken_link',
  'missing_metadata',
  'stale_metadata',
];
const SEVERITIES: QualitySeverity[] = ['critical', 'warning', 'info'];
const STATUSES: QualityIssueStatus[] = ['open', 'ignored', 'fixed'];

export function normalizeQualityType(value: unknown, fallback: QualityIssueType = 'missing_metadata'): QualityIssueType {
  return typeof value === 'string' && (ISSUE_TYPES as string[]).includes(value)
    ? (value as QualityIssueType)
    : fallback;
}

export function normalizeQualitySeverity(value: unknown, fallback: QualitySeverity = 'info'): QualitySeverity {
  return typeof value === 'string' && (SEVERITIES as string[]).includes(value)
    ? (value as QualitySeverity)
    : fallback;
}

export function normalizeIssueStatus(value: unknown, fallback: QualityIssueStatus = 'open'): QualityIssueStatus {
  return typeof value === 'string' && (STATUSES as string[]).includes(value)
    ? (value as QualityIssueStatus)
    : fallback;
}

function text(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function parseTime(value: string | null | undefined): number | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = Date.parse(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstSentence(value: string, max = 300): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  const cut = normalized.split(/(?<=[。！？.!?])\s*/)[0] ?? normalized;
  return cut.slice(0, max);
}

/** 从 README 摘要生成可回填的简介（本地降级，不臆造内容）。 */
export function descriptionFromSummary(summary: string): string {
  return firstSentence(summary, 300);
}

/** 单个仓库的元数据问题。 */
export function checkRepoMetadata(
  repo: QualityRepoInput,
  now: number = Date.now()
): QualityIssueDraft[] {
  const issues: QualityIssueDraft[] = [];
  const description = text(repo.description);
  const summary = text(repo.readmeSummary);
  const base = { repoId: repo.repoId, type: 'missing_metadata' as const };

  if (!description && !summary) {
    issues.push({
      ...base,
      issueKey: 'missing_metadata:description',
      severity: 'warning',
      field: 'description',
      title: '缺少项目简介',
      detail: '仓库简介与 README 摘要都为空，列表和推荐理由里无法展示项目定位。',
      suggestion: '点击「补全元数据」从 GitHub 拉取简介，或先用 README 摘要回填。',
    });
  }
  if (!text(repo.language)) {
    issues.push({
      ...base,
      issueKey: 'missing_metadata:language',
      severity: 'info',
      field: 'language',
      title: '缺少开发语言',
      detail: '语言为空，技术栈图谱与语言筛选无法归类这个仓库。',
      suggestion: '点击「补全元数据」从 GitHub 同步语言字段。',
    });
  }
  if (!text(repo.licenseSpdx) && !text(repo.licenseCheckedAt)) {
    issues.push({
      ...base,
      issueKey: 'missing_metadata:license',
      severity: 'info',
      field: 'license',
      title: '尚未识别 License',
      detail: '该仓库还没有做过 License 识别，合规提示无法给出结论。',
      suggestion: '点击「补全元数据」从 GitHub 同步 License（无许可证也会记录为 none）。',
    });
  }
  if (!summary) {
    issues.push({
      ...base,
      issueKey: 'missing_metadata:summary',
      severity: 'info',
      field: 'summary',
      title: '缺少 README 摘要',
      detail: '没有中文摘要，搜索结果与推荐卡片只能展示原始简介。',
      suggestion: '在「仓库」页触发摘要生成；本页不会自动调用模型。',
    });
  }
  if (!text(repo.categoryId)) {
    issues.push({
      ...base,
      issueKey: 'missing_metadata:category',
      severity: 'info',
      field: 'category',
      title: '尚未分类',
      detail: '仓库没有归入任何分类，资产报表的分类分布会不完整。',
      suggestion: '在仓库详情或分类页手动归类（自动分类建议见「分类建议」页）。',
    });
  }

  const lastSync = parseTime(repo.syncedAt) ?? parseTime(repo.updatedAt);
  if (lastSync !== null && now - lastSync > STALE_AFTER_DAYS * DAY_MS) {
    const days = Math.floor((now - lastSync) / DAY_MS);
    issues.push({
      ...base,
      issueKey: 'stale_metadata:sync',
      type: 'stale_metadata',
      severity: 'warning',
      field: 'synced_at',
      title: '元数据超过 90 天未更新',
      detail: `最近一次同步在 ${days} 天前，Star / 简介 / 语言可能已经变化。`,
      suggestion: '点击「补全元数据」重新拉取 GitHub 详情。',
    });
  }
  return issues;
}

/** 全部仓库的元数据问题。 */
export function checkAllMetadata(
  repos: QualityRepoInput[],
  now: number = Date.now()
): QualityIssueDraft[] {
  return repos.flatMap((repo) => checkRepoMetadata(repo, now));
}

function repoLookup(repos: QualityRepoInput[]): Map<string, QualityRepoInput> {
  return new Map(repos.map((repo) => [repo.repoId, repo]));
}

function clusterCanonical(cluster: DuplicateCluster): string {
  return cluster.suggestion.keep.repoId;
}

/** 重复条目问题：每个「建议合并」成员一条，保留项不报。 */
export function buildDuplicateIssues(repos: QualityRepoInput[]): QualityIssueDraft[] {
  if (repos.length < 2) return [];
  const inputs: DuplicateRepoInput[] = repos.map((repo) => ({
    source: 'my',
    repoId: repo.repoId,
    platform: repo.platform,
    name: repo.name,
    description: repo.description,
    htmlUrl: repo.htmlUrl,
    stars: repo.stars,
    language: repo.language,
    readmeSummary: repo.readmeSummary,
    categoryId: repo.categoryId,
  }));
  const lookup = repoLookup(repos);
  const issues: QualityIssueDraft[] = [];
  for (const cluster of detectNameDuplicates(inputs)) {
    const keepId = clusterCanonical(cluster);
    const keep = lookup.get(keepId);
    if (!keep) continue;
    for (const member of cluster.members) {
      if (member.repoId === keepId) continue;
      const repo = lookup.get(member.repoId);
      if (!repo) continue;
      issues.push({
        issueKey: `duplicate:${cluster.id}:${member.repoId}`,
        repoId: member.repoId,
        type: 'duplicate',
        severity: 'warning',
        field: '',
        title: `疑似与 ${keep.fullName} 重复`,
        detail: cluster.reasons.join('；') || '仓库名称 / 地址高度相似。',
        suggestion: '在「重复检测」页确认合并或忽略；本页不会自动删除仓库。',
      });
    }
  }
  return issues;
}

/** 把 VPS 链接检测结果转换为问题草案。 */
export function buildLinkIssues(
  repos: QualityRepoInput[],
  results: LinkCheckResult[]
): QualityIssueDraft[] {
  const lookup = repoLookup(repos);
  const issues: QualityIssueDraft[] = [];
  for (const result of results) {
    const repo = lookup.get(result.repoId);
    if (!repo) continue;
    if (result.status === 'broken') {
      const code = result.httpStatus ? `HTTP ${result.httpStatus}` : result.error || '无法访问';
      issues.push({
        issueKey: 'broken_link:url',
        repoId: result.repoId,
        type: 'broken_link',
        severity: 'critical',
        field: 'html_url',
        title: '仓库链接已失效',
        detail: `${repo.htmlUrl} 返回 ${code}，仓库可能已删除、改名或转为私有。`,
        suggestion: '建议归档或移除该收藏；如需保留请手动更新链接。',
      });
    } else if (result.status === 'redirected') {
      const finalUrl = text(result.finalUrl);
      if (!finalUrl || finalUrl === repo.htmlUrl) continue;
      issues.push({
        issueKey: 'broken_link:redirect',
        repoId: result.repoId,
        type: 'broken_link',
        severity: 'warning',
        field: 'html_url',
        title: '仓库地址已重定向',
        detail: `旧地址跳转到 ${finalUrl}，通常是仓库改名或转移。`,
        suggestion: '点击「补全元数据」自动更新为最新地址。',
      });
    }
  }
  return issues;
}

/** 合并多批问题并按 issueKey 去重（后者覆盖前者）。 */
export function mergeIssueDrafts(...groups: QualityIssueDraft[][]): QualityIssueDraft[] {
  const merged = new Map<string, QualityIssueDraft>();
  for (const group of groups) {
    for (const issue of group) {
      merged.set(`${issue.repoId}:${issue.issueKey}`, issue);
    }
  }
  return [...merged.values()];
}

/** 质量分：100 - 8 × critical - 4 × warning - 1 × info，下限 0。 */
export function scoreQuality(issues: QualityIssueDraft[]): number {
  let score = 100;
  for (const issue of issues) {
    if (issue.severity === 'critical') score -= 8;
    else if (issue.severity === 'warning') score -= 4;
    else score -= 1;
  }
  return Math.max(0, score);
}

export function summarizeQuality(issues: QualityIssueDraft[]): QualityCounts {
  const counts: QualityCounts = {
    total: issues.length,
    critical: 0,
    warning: 0,
    info: 0,
    byType: { duplicate: 0, broken_link: 0, missing_metadata: 0, stale_metadata: 0 },
  };
  for (const issue of issues) {
    counts[issue.severity] += 1;
    counts.byType[issue.type] += 1;
  }
  return counts;
}

/** 稳定问题 id（同一用户 + 仓库 + 问题键始终一致）。 */
export function buildIssueId(userId: string, repoId: string, issueKey: string): string {
  const input = `${userId}|${repoId}|${issueKey}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `dq_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** 是否是可自动补全的元数据字段。 */
export function isFixableField(field: string): boolean {
  return ['description', 'language', 'license', 'html_url', 'synced_at'].includes(field);
}
