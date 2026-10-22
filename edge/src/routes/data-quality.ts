/**
 * 数据质量治理路由（M9-05 / REQ-202610-0982）。
 *
 * GET    /api/data-quality                     质量总览 + 问题台账（登录态）
 * POST   /api/data-quality/scan                扫描元数据 / 重复 / 失效链接（登录态）
 * POST   /api/data-quality/fix                 补全元数据（登录态）
 * POST   /api/data-quality/issues/ignore       批量忽略问题（登录态）
 * POST   /api/data-quality/issues/restore      批量恢复问题（登录态）
 *
 * GET    /api/internal/data-quality/mirror     D1 仓库镜像快照（内部令牌；M1-16 对账用）
 *
 * 链路：
 *   1. 扫描读取当前用户 D1 收藏，本地规则检查元数据与重复；
 *   2. 配置 VPS_NODE_URL 时调用 VPS 批量 HEAD 校验链接（最多 30 个）；
 *   3. 问题按 (user_id, repo_id, issue_key) upsert，未再检出的旧问题自动置 fixed；
 *   4. 补全元数据调用 VPS 拉取 GitHub 详情，VPS 不可达时仅用 README 摘要补简介。
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, RepoRow, Variables } from '../types';
import { all, first, run } from '../db';
import { checkOptionalInternalToken } from '../security/internal-token.ts';
import {
  buildDuplicateIssues,
  buildIssueId,
  buildLinkIssues,
  checkAllMetadata,
  descriptionFromSummary,
  isFixableField,
  MAX_LINK_CHECKS,
  mergeIssueDrafts,
  normalizeIssueStatus,
  normalizeQualitySeverity,
  normalizeQualityType,
  scoreQuality,
  summarizeQuality,
  type LinkCheckResult,
  type QualityIssueDraft,
  type QualityIssueStatus,
  type QualityIssueType,
  type QualityRepoInput,
  type QualitySeverity,
} from '../data-quality/checks';

const dataQuality = new Hono<{ Bindings: Env; Variables: Variables }>();
export const internalDataQuality = new Hono<{ Bindings: Env; Variables: Variables }>();

const MAX_REPOS = 500;
const MAX_ISSUES = 300;
const DEFAULT_LIMIT = 100;

interface DataQualityIssueRow {
  id: string;
  user_id: string;
  scan_id: string;
  repo_id: string;
  issue_key: string;
  type: QualityIssueType;
  severity: QualitySeverity;
  field: string | null;
  title: string;
  detail: string;
  suggestion: string;
  status: QualityIssueStatus;
  detected_at: string;
  resolved_at: string | null;
}

interface DataQualityScanRow {
  id: string;
  user_id: string;
  mode: 'local' | 'hybrid';
  scanned: number;
  issue_count: number;
  critical_count: number;
  warning_count: number;
  info_count: number;
  score: number;
  duplicate_count: number;
  broken_link_count: number;
  metadata_count: number;
  created_at: string;
}

interface QualityIssueDto {
  id: string;
  repoId: string;
  repoName: string;
  repoUrl: string;
  type: QualityIssueType;
  severity: QualitySeverity;
  field: string | null;
  title: string;
  detail: string;
  suggestion: string;
  status: QualityIssueStatus;
  detectedAt: string;
  resolvedAt: string | null;
}

interface ScanHistoryDto {
  id: string;
  mode: 'local' | 'hybrid';
  scanned: number;
  issueCount: number;
  score: number;
  createdAt: string;
}

interface VpsLinkPayload {
  results?: unknown;
  checked?: unknown;
}

interface VpsMetadataItem {
  repoId?: unknown;
  patch?: Record<string, unknown>;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(num)));
}

async function readBody(c: Context<{ Bindings: Env; Variables: Variables }>): Promise<Record<string, unknown>> {
  try {
    const parsed = await c.req.json();
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function rowToInput(row: RepoRow): QualityRepoInput {
  const owner = row.owner ?? row.id.split('/')[0] ?? '';
  const fullName = owner && row.name ? `${owner}/${row.name}` : row.id;
  return {
    repoId: row.id,
    name: row.name,
    fullName,
    htmlUrl: row.html_url,
    platform: row.platform ?? 'github',
    description: row.description ?? '',
    language: row.language ?? '',
    stars: row.stars ?? 0,
    forks: row.forks ?? 0,
    readmeSummary: row.readme_summary ?? '',
    categoryId: row.category_id ?? '',
    licenseSpdx: row.license_spdx ?? '',
    licenseName: row.license_name ?? '',
    licenseCheckedAt: row.license_checked_at ?? '',
    syncedAt: row.synced_at ?? '',
    updatedAt: row.updated_at ?? '',
  };
}

async function loadRepos(env: Env, userId: string, limit = MAX_REPOS): Promise<RepoRow[]> {
  return all<RepoRow>(
    env.DB,
    `SELECT * FROM my_repositories WHERE user_id = ? ORDER BY stars DESC, id ASC LIMIT ?`,
    [userId, limit]
  );
}

async function loadIssues(env: Env, userId: string, limit = 1000): Promise<DataQualityIssueRow[]> {
  return all<DataQualityIssueRow>(
    env.DB,
    `SELECT * FROM data_quality_issues
      WHERE user_id = ?
      ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
               detected_at DESC
      LIMIT ?`,
    [userId, limit]
  );
}

async function loadLatestScan(env: Env, userId: string): Promise<DataQualityScanRow | null> {
  return first<DataQualityScanRow>(
    env.DB,
    `SELECT * FROM data_quality_scans WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
}

async function loadHistory(env: Env, userId: string, limit = 10): Promise<ScanHistoryDto[]> {
  const rows = await all<DataQualityScanRow>(
    env.DB,
    `SELECT * FROM data_quality_scans WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, limit]
  );
  return rows.map((row) => ({
    id: row.id,
    mode: row.mode,
    scanned: row.scanned ?? 0,
    issueCount: row.issue_count ?? 0,
    score: row.score ?? 100,
    createdAt: row.created_at,
  }));
}

function issueDto(row: DataQualityIssueRow, repoMap: Map<string, RepoRow>): QualityIssueDto {
  const repo = repoMap.get(row.repo_id);
  const owner = repo?.owner ?? row.repo_id.split('/')[0] ?? '';
  const fullName = repo && owner && repo.name ? `${owner}/${repo.name}` : row.repo_id;
  return {
    id: row.id,
    repoId: row.repo_id,
    repoName: fullName,
    repoUrl: repo?.html_url ?? `https://github.com/${row.repo_id}`,
    type: normalizeQualityType(row.type),
    severity: normalizeQualitySeverity(row.severity),
    field: row.field,
    title: row.title,
    detail: row.detail,
    suggestion: row.suggestion,
    status: normalizeIssueStatus(row.status),
    detectedAt: row.detected_at,
    resolvedAt: row.resolved_at,
  };
}

async function buildView(
  env: Env,
  userId: string,
  filters: { type?: string; severity?: string; status?: string; limit?: number | string } = {}
) {
  const [rows, latestScan, history] = await Promise.all([
    loadIssues(env, userId),
    loadLatestScan(env, userId),
    loadHistory(env, userId),
  ]);
  const repos = await loadRepos(env, userId);
  const repoMap = new Map(repos.map((repo) => [repo.id, repo]));

  const openRows = rows.filter((row) => row.status === 'open');
  const openDrafts: QualityIssueDraft[] = openRows.map((row) => ({
    issueKey: row.issue_key,
    repoId: row.repo_id,
    type: normalizeQualityType(row.type),
    severity: normalizeQualitySeverity(row.severity),
    field: row.field ?? '',
    title: row.title,
    detail: row.detail,
    suggestion: row.suggestion,
  }));
  const counts = summarizeQuality(openDrafts);

  const typeFilter = normalizeQualityType(filters.type, 'missing_metadata');
  const severityFilter = normalizeQualitySeverity(filters.severity, 'info');
  const statusFilter = filters.status === 'all' ? 'all' : normalizeIssueStatus(filters.status ?? 'open');
  const limit = clampInt(filters.limit, 1, 500, DEFAULT_LIMIT);

  const filtered = rows.filter((row) => {
    if (statusFilter !== 'all' && row.status !== statusFilter) return false;
    if (filters.type && filters.type !== 'all' && row.type !== typeFilter) return false;
    if (filters.severity && filters.severity !== 'all' && row.severity !== severityFilter) return false;
    return true;
  });

  return {
    summary: {
      score: latestScan?.score ?? scoreQuality(openDrafts),
      open: openRows.length,
      critical: counts.critical,
      warning: counts.warning,
      info: counts.info,
      fixed: rows.filter((row) => row.status === 'fixed').length,
      ignored: rows.filter((row) => row.status === 'ignored').length,
      byType: counts.byType,
      lastScanAt: latestScan?.created_at ?? null,
      scanned: latestScan?.scanned ?? repos.length,
    },
    issues: filtered.slice(0, limit).map((row) => issueDto(row, repoMap)),
    latestScan: latestScan
      ? {
          id: latestScan.id,
          mode: latestScan.mode,
          scanned: latestScan.scanned,
          issueCount: latestScan.issue_count,
          score: latestScan.score,
          createdAt: latestScan.created_at,
        }
      : null,
    history,
  };
}

async function checkLinksViaVps(
  env: Env,
  repos: QualityRepoInput[]
): Promise<{ results: LinkCheckResult[]; mode: 'hybrid' } | null> {
  const base = env.VPS_NODE_URL?.trim();
  if (!base) return null;
  const items = repos.slice(0, MAX_LINK_CHECKS).map((repo) => ({
    repoId: repo.repoId,
    url: repo.htmlUrl,
    platform: repo.platform,
  }));
  if (items.length === 0) return { results: [], mode: 'hybrid' };
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/api/data-quality/check-links`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': env.INTERNAL_TOKEN ?? '',
      },
      body: JSON.stringify({ items }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as VpsLinkPayload;
    if (!Array.isArray(payload.results)) return null;
    const results: LinkCheckResult[] = [];
    for (const raw of payload.results) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const repoId = typeof item.repoId === 'string' ? item.repoId : '';
      const status = item.status;
      if (!repoId) continue;
      if (status !== 'ok' && status !== 'broken' && status !== 'redirected' && status !== 'unknown') {
        continue;
      }
      results.push({
        repoId,
        status,
        httpStatus: Number.isFinite(Number(item.httpStatus)) ? Number(item.httpStatus) : null,
        finalUrl: typeof item.finalUrl === 'string' ? item.finalUrl : null,
        error: typeof item.error === 'string' ? item.error : null,
      });
    }
    return { results, mode: 'hybrid' };
  } catch (err) {
    console.error('vps /api/data-quality/check-links failed:', err);
    return null;
  }
}

async function fetchMetadataPatches(
  env: Env,
  repoIds: string[]
): Promise<Map<string, Record<string, unknown>> | null> {
  const base = env.VPS_NODE_URL?.trim();
  if (!base || repoIds.length === 0) return null;
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/api/data-quality/metadata`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': env.INTERNAL_TOKEN ?? '',
      },
      body: JSON.stringify({ repoIds }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as { items?: unknown };
    if (!Array.isArray(payload.items)) return null;
    const map = new Map<string, Record<string, unknown>>();
    for (const raw of payload.items) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as VpsMetadataItem;
      const repoId = typeof item.repoId === 'string' ? item.repoId : '';
      if (repoId && item.patch && typeof item.patch === 'object') {
        map.set(repoId, item.patch);
      }
    }
    return map;
  } catch (err) {
    console.error('vps /api/data-quality/metadata failed:', err);
    return null;
  }
}

dataQuality.get('/', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const view = await buildView(c.env, user.id, {
    type: c.req.query('type'),
    severity: c.req.query('severity'),
    status: c.req.query('status'),
    limit: c.req.query('limit'),
  });
  return c.json(view);
});

dataQuality.post('/scan', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const started = Date.now();
  const body = await readBody(c);
  const maxRepos = clampInt(body.maxRepos, 1, MAX_REPOS, 200);
  const checkLinks = body.checkLinks !== false;

  const repoRows = await loadRepos(c.env, user.id, maxRepos);
  const repos = repoRows.map(rowToInput);
  const localIssues = [...checkAllMetadata(repos), ...buildDuplicateIssues(repos)];

  let linkIssues: QualityIssueDraft[] = [];
  let mode: 'local' | 'hybrid' = 'local';
  let linkCheck: 'ok' | 'skipped' | 'failed' = checkLinks ? 'failed' : 'skipped';
  if (checkLinks && repos.length > 0) {
    const payload = await checkLinksViaVps(c.env, repos);
    if (payload) {
      linkCheck = 'ok';
      mode = payload.mode;
      linkIssues = buildLinkIssues(repos, payload.results);
    }
  }

  const issues = mergeIssueDrafts(localIssues, linkIssues).slice(0, MAX_ISSUES);
  const counts = summarizeQuality(issues);
  const score = scoreQuality(issues);
  const scanId =
    typeof crypto.randomUUID === 'function'
      ? `dq_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
      : `dq_${Date.now().toString(36)}`;
  const createdAt = new Date().toISOString();

  await run(
    c.env.DB,
    `INSERT INTO data_quality_scans
       (id, user_id, mode, scanned, issue_count, critical_count, warning_count, info_count,
        score, duplicate_count, broken_link_count, metadata_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      scanId,
      user.id,
      mode,
      repos.length,
      counts.total,
      counts.critical,
      counts.warning,
      counts.info,
      score,
      counts.byType.duplicate,
      counts.byType.broken_link,
      counts.byType.missing_metadata + counts.byType.stale_metadata,
      createdAt,
    ]
  );

  for (const issue of issues) {
    await run(
      c.env.DB,
      `INSERT INTO data_quality_issues
         (id, user_id, scan_id, repo_id, issue_key, type, severity, field, title, detail,
          suggestion, status, detected_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, NULL)
       ON CONFLICT (user_id, repo_id, issue_key) DO UPDATE SET
         scan_id = excluded.scan_id,
         type = excluded.type,
         severity = excluded.severity,
         field = excluded.field,
         title = excluded.title,
         detail = excluded.detail,
         suggestion = excluded.suggestion,
         status = CASE
           WHEN data_quality_issues.status = 'ignored' THEN 'ignored'
           ELSE 'open'
         END,
         detected_at = excluded.detected_at,
         resolved_at = NULL`,
      [
        buildIssueId(user.id, issue.repoId, issue.issueKey),
        user.id,
        scanId,
        issue.repoId,
        issue.issueKey,
        issue.type,
        issue.severity,
        issue.field || null,
        issue.title,
        issue.detail,
        issue.suggestion,
        createdAt,
      ]
    );
  }

  // 本轮没有再检出的旧问题自动关闭；ignored / 已 fixed 的不动。
  await run(
    c.env.DB,
    `UPDATE data_quality_issues
        SET status = 'fixed', resolved_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND status = 'open' AND scan_id <> ?`,
    [user.id, scanId]
  );

  const view = await buildView(c.env, user.id, { status: 'open', limit: 200 });
  return c.json({
    ...view,
    scanId,
    mode,
    scanned: repos.length,
    linkCheck,
    checkedLinks: Math.min(repos.length, MAX_LINK_CHECKS),
    tookMs: Date.now() - started,
  });
});

interface MetadataPatch {
  description?: string;
  language?: string;
  stars?: number;
  forks?: number;
  html_url?: string;
  updated_at?: string;
  license_spdx?: string;
  license_name?: string;
  license_source?: string;
}

function readPatch(raw: Record<string, unknown>): MetadataPatch {
  const patch: MetadataPatch = {};
  if (typeof raw.description === 'string' && raw.description.trim()) patch.description = raw.description.trim();
  if (typeof raw.language === 'string' && raw.language.trim()) patch.language = raw.language.trim();
  if (typeof raw.html_url === 'string' && raw.html_url.trim()) patch.html_url = raw.html_url.trim();
  if (typeof raw.updated_at === 'string' && raw.updated_at.trim()) patch.updated_at = raw.updated_at.trim();
  if (typeof raw.license_spdx === 'string') patch.license_spdx = raw.license_spdx;
  if (typeof raw.license_name === 'string') patch.license_name = raw.license_name;
  if (typeof raw.license_source === 'string') patch.license_source = raw.license_source;
  if (Number.isFinite(Number(raw.stars))) patch.stars = Math.max(0, Math.trunc(Number(raw.stars)));
  if (Number.isFinite(Number(raw.forks))) patch.forks = Math.max(0, Math.trunc(Number(raw.forks)));
  return patch;
}

dataQuality.post('/fix', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const body = await readBody(c);
  const requestedIds = Array.isArray(body.repoIds)
    ? body.repoIds
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
        .slice(0, 100)
    : [];
  const requestedFields = Array.isArray(body.fields)
    ? body.fields
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
        .slice(0, 20)
    : [];

  const issues = await loadIssues(c.env, user.id);
  const candidates = issues.filter((row) => {
    if (row.status !== 'open') return false;
    if (row.type !== 'missing_metadata' && row.type !== 'stale_metadata' && row.type !== 'broken_link') return false;
    if (requestedIds.length > 0 && !requestedIds.includes(row.repo_id)) return false;
    if (requestedFields.length > 0 && row.field && !requestedFields.includes(row.field)) return false;
    return row.field ? isFixableField(row.field) : true;
  });
  const repoIds = [...new Set(candidates.map((row) => row.repo_id))].slice(0, 50);
  if (repoIds.length === 0) {
    return c.json({ status: 'noop', requested: 0, updated: 0, skipped: 0, remaining: 0, items: [] });
  }

  const vpsPatches = await fetchMetadataPatches(c.env, repoIds);
  const useVps = vpsPatches !== null;
  let updated = 0;
  let skipped = 0;
  const items: Array<{ repoId: string; updatedFields: string[]; source: 'vps' | 'local'; note?: string }> = [];

  for (const repoId of repoIds) {
    const row = await first<RepoRow>(
      c.env.DB,
      `SELECT * FROM my_repositories WHERE id = ? AND user_id = ?`,
      [repoId, user.id]
    );
    if (!row) {
      skipped += 1;
      continue;
    }
    const patch = readPatch(vpsPatches?.get(repoId) ?? {});
    const localDescription =
      !row.description && row.readme_summary ? descriptionFromSummary(row.readme_summary) : '';
    const nextDescription = (row.description ?? '').trim() || patch.description || localDescription;
    const nextLanguage = (row.language ?? '').trim() || patch.language || null;
    const nextStars = patch.stars ?? row.stars ?? 0;
    const nextForks = patch.forks ?? row.forks ?? 0;
    const nextUrl = patch.html_url || row.html_url;
    const nextUpdatedAt = patch.updated_at || row.updated_at;
    const nextLicenseSpdx = patch.license_spdx ?? row.license_spdx;
    const nextLicenseName = patch.license_name ?? row.license_name;
    const nextLicenseSource = patch.license_source ?? row.license_source;
    const licenseCheckedAt =
      patch.license_source !== undefined || patch.license_spdx !== undefined
        ? new Date().toISOString()
        : row.license_checked_at;

    const updatedFields: string[] = [];
    if (nextDescription && nextDescription !== (row.description ?? '')) updatedFields.push('description');
    if (nextLanguage && nextLanguage !== (row.language ?? '')) updatedFields.push('language');
    if (nextUrl !== row.html_url) updatedFields.push('html_url');
    if ((patch.license_source ?? '') !== '') updatedFields.push('license');
    if (useVps) updatedFields.push('synced_at');

    if (updatedFields.length === 0) {
      skipped += 1;
      items.push({ repoId, updatedFields: [], source: useVps ? 'vps' : 'local', note: '没有可回填的字段' });
      continue;
    }

    await run(
      c.env.DB,
      `UPDATE my_repositories
          SET description = ?, language = ?, stars = ?, forks = ?, html_url = ?,
              updated_at = ?, license_spdx = ?, license_name = ?, license_source = ?,
              license_checked_at = ?,
              synced_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE synced_at END
        WHERE id = ? AND user_id = ?`,
      [
        nextDescription || null,
        nextLanguage,
        nextStars,
        nextForks,
        nextUrl,
        nextUpdatedAt,
        nextLicenseSpdx,
        nextLicenseName,
        nextLicenseSource,
        licenseCheckedAt,
        useVps ? 1 : 0,
        repoId,
        user.id,
      ]
    );
    for (const field of updatedFields) {
      await run(
        c.env.DB,
        `UPDATE data_quality_issues
            SET status = 'fixed', resolved_at = CURRENT_TIMESTAMP
          WHERE user_id = ? AND repo_id = ? AND status = 'open' AND field = ?`,
        [user.id, repoId, field]
      );
    }
    updated += 1;
    items.push({ repoId, updatedFields, source: useVps ? 'vps' : 'local' });
  }

  return c.json({
    status: useVps ? 'vps' : 'local',
    requested: repoIds.length,
    updated,
    skipped,
    remaining: Math.max(0, repoIds.length - updated - skipped),
    items,
  });
});

async function updateIssueStatus(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  status: QualityIssueStatus
) {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const body = await readBody(c);
  const ids = Array.isArray(body.issueIds)
    ? body.issueIds
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
        .slice(0, 100)
    : [];
  if (ids.length === 0) return c.json({ error: 'invalid_issue_ids' }, 400);
  const placeholders = ids.map(() => '?').join(', ');
  const result = await run(
    c.env.DB,
    `UPDATE data_quality_issues
        SET status = ?, resolved_at = CASE WHEN ? = 'fixed' THEN CURRENT_TIMESTAMP ELSE NULL END
      WHERE user_id = ? AND id IN (${placeholders})`,
    [status, status, user.id, ...ids]
  );
  return c.json({ updated: result.meta.changes ?? 0, status });
}

dataQuality.post('/issues/ignore', async (c) => updateIssueStatus(c, 'ignored'));
dataQuality.post('/issues/restore', async (c) => updateIssueStatus(c, 'open'));

internalDataQuality.get('/mirror', async (c) => {
  const denied = await checkOptionalInternalToken(c);
  if (denied) return denied;
  const rows = await all<{
    id: string;
    name: string;
    platform: string;
    description: string | null;
    language: string | null;
    stars: number | null;
    html_url: string;
    updated_at: string | null;
    synced_at: string | null;
  }>(
    c.env.DB,
    `SELECT id, name, platform, description, language, stars, html_url, updated_at, synced_at
       FROM my_repositories ORDER BY id ASC LIMIT 5000`
  );
  return c.json({ generatedAt: new Date().toISOString(), count: rows.length, items: rows });
});

export default dataQuality;
