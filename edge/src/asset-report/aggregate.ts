/**
 * 资产报表聚合（M9-02 / REQ-202610-0979）。
 *
 * 输入：当前用户 D1 `my_repositories` 行、`categories` 行、`trending_snapshots` 行。
 * 输出：收录量、分类分布、语言 / 平台构成、Star 快照趋势与确定性洞察。
 *
 * 口径：
 * - 收录量按 `created_at` 的 UTC 自然月统计，窗口为「当前月向前 N 个月」；
 * - `cumulativeStars` 是「按收录月份的当前 Star 存量」，不是历史 Star 曲线；
 * - `starTrend` 只使用 `trending_snapshots` 中真实存在的快照，不补零、不伪造，
 *   并复用 M7-05 `buildStarTrends(scope=my)` 的聚合口径；
 * - 语言归一复用 M6-04 `normalizeLanguage`，保证与技术栈图谱一致；
 * - 全部为纯函数，不访问 D1 / 网络，便于单测。
 */
import { normalizeLanguage } from '../tech-stack/aggregate.ts';
import {
  buildStarTrends,
  type StarMover,
  type StarSnapshotRow,
  type StarTrendPoint,
} from '../insights/star-trends.ts';

export interface AssetReportRepoRow {
  id: string;
  platform: string | null;
  name: string;
  owner: string | null;
  html_url: string;
  stars: number | null;
  forks: number | null;
  language: string | null;
  category_id: string | null;
  created_at: string | null;
  pushed_at: string | null;
  archived: number | null;
  health_status: string | null;
}

export interface AssetReportCategoryRow {
  id: string;
  name: string;
}

export interface AssetVolumeMonth {
  month: string;
  added: number;
  cumulative: number;
  starsAdded: number;
  cumulativeStars: number;
}

export interface AssetPlatformShare {
  platform: string;
  label: string;
  repoCount: number;
  share: number;
}

export interface AssetCategoryDistribution {
  id: string | null;
  name: string;
  repoCount: number;
  starCount: number;
  share: number;
  avgStars: number;
  topLanguage: string | null;
}

export interface AssetLanguageDistribution {
  name: string;
  repoCount: number;
  starCount: number;
  share: number;
}

export interface AssetReportSummary {
  totalRepos: number;
  totalStars: number;
  totalForks: number;
  avgStars: number;
  categoryCount: number;
  categorizedRepos: number;
  uncategorizedRepos: number;
  categoryCoverage: number;
  languageCount: number;
  withLanguage: number;
  platformCount: number;
  addedLast7d: number;
  addedLast30d: number;
  addedLast90d: number;
  addedLast365d: number;
  growthRate30d: number;
  topCategory: { name: string; repoCount: number; share: number } | null;
  topLanguage: string | null;
  topPlatform: string | null;
  starTrendCoverage: number;
}

export type AssetInsightKind =
  | 'volume'
  | 'growth'
  | 'category'
  | 'uncategorized'
  | 'star'
  | 'coverage';

export interface AssetInsight {
  kind: AssetInsightKind;
  title: string;
  description: string;
}

export interface AssetStarTrend {
  available: boolean;
  period: {
    days: number;
    startDate: string | null;
    endDate: string | null;
    snapshotDays: number;
  };
  summary: {
    trackedRepos: number;
    totalStars: number;
    starGain: number;
    coverage: number;
  };
  series: StarTrendPoint[];
  topMovers: StarMover[];
  languages: Array<{
    language: string;
    repoCount: number;
    starGain: number;
    share: number;
    topRepo: string | null;
  }>;
}

export interface AssetReportResponse {
  period: {
    months: number;
    startDate: string;
    endDate: string;
  };
  summary: AssetReportSummary;
  volume: {
    months: AssetVolumeMonth[];
    recent: {
      last7d: number;
      last30d: number;
      last90d: number;
      last365d: number;
    };
    peakMonth: { month: string; added: number } | null;
    unknownCreated: number;
    platforms: AssetPlatformShare[];
  };
  categories: AssetCategoryDistribution[];
  languages: AssetLanguageDistribution[];
  starTrend: AssetStarTrend;
  insights: AssetInsight[];
  generatedAt: string;
}

export interface BuildAssetReportOptions {
  months?: number;
  now?: Date;
}

const ALLOWED_MONTHS = [6, 12, 24] as const;
const DAY_MS = 86400000;

/** 归一报表窗口：只接受 6 / 12 / 24，其余回退 12 */
export function normalizeMonths(raw: string | number | undefined | null): number {
  const parsed =
    typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  return (ALLOWED_MONTHS as readonly number[]).includes(parsed) ? parsed : 12;
}

/** Star 快照窗口天数：与报表窗口对齐，限制在 30–365 天 */
export function starTrendDays(months: number): number {
  return Math.min(365, Math.max(30, normalizeMonths(months) * 30));
}

function num(value: number | null | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`;
}

/** 解析 SQLite `YYYY-MM-DD HH:MM:SS` / ISO 时间；无时区按 UTC 处理 */
export function parseAssetDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const text = value.trim();
  if (!text) return null;
  let normalized = text;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(text)) {
    normalized = `${text.replace(' ', 'T')}${text.length === 16 ? ':00' : ''}Z`;
  }
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

interface MonthWindow {
  key: string;
  start: Date;
  end: Date;
}

function buildMonthWindow(months: number, now: Date): MonthWindow[] {
  const list: MonthWindow[] = [];
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1)
    );
    const end = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)
    );
    list.push({ key: monthKey(start), start, end });
  }
  return list;
}

function platformLabel(platform: string): string {
  const key = platform.trim().toLowerCase();
  if (key === 'github') return 'GitHub';
  if (key === 'gitee') return 'Gitee';
  return platform.trim() || '其他';
}

interface AssetVolumeResult {
  months: AssetVolumeMonth[];
  peakMonth: { month: string; added: number } | null;
  unknownCreated: number;
  recent: {
    last7d: number;
    last30d: number;
    last90d: number;
    last365d: number;
  };
}

function buildVolume(
  repos: readonly AssetReportRepoRow[],
  window: readonly MonthWindow[],
  now: Date
): AssetVolumeResult {
  const firstStart = window[0]?.start ?? now;
  const lastEnd = window[window.length - 1]?.end ?? now;
  const buckets = new Map<string, { added: number; starsAdded: number }>();
  for (const month of window) buckets.set(month.key, { added: 0, starsAdded: 0 });

  let opening = 0;
  let openingStars = 0;
  let unknownCreated = 0;
  let last7d = 0;
  let last30d = 0;
  let last90d = 0;
  let last365d = 0;

  for (const repo of repos) {
    const created = parseAssetDate(repo.created_at);
    if (!created) {
      unknownCreated += 1;
      continue;
    }
    const stars = num(repo.stars);
    const age = now.getTime() - created.getTime();
    if (age >= 0 && age <= 7 * DAY_MS) last7d += 1;
    if (age >= 0 && age <= 30 * DAY_MS) last30d += 1;
    if (age >= 0 && age <= 90 * DAY_MS) last90d += 1;
    if (age >= 0 && age <= 365 * DAY_MS) last365d += 1;

    if (created < firstStart) {
      opening += 1;
      openingStars += stars;
      continue;
    }
    let index = window.findIndex(
      (month) => created >= month.start && created < month.end
    );
    if (index < 0) {
      // created_at 晚于当前月（脏数据）时归入最后一个窗口月，保证累计口径闭合
      index = created >= lastEnd ? window.length - 1 : -1;
    }
    const month = index >= 0 ? window[index] : undefined;
    if (!month) {
      unknownCreated += 1;
      continue;
    }
    const bucket = buckets.get(month.key);
    if (bucket) {
      bucket.added += 1;
      bucket.starsAdded += stars;
    }
  }

  let cumulative = opening;
  let cumulativeStars = openingStars;
  const months: AssetVolumeMonth[] = window.map((month) => {
    const bucket = buckets.get(month.key) ?? { added: 0, starsAdded: 0 };
    cumulative += bucket.added;
    cumulativeStars += bucket.starsAdded;
    return {
      month: month.key,
      added: bucket.added,
      cumulative,
      starsAdded: bucket.starsAdded,
      cumulativeStars,
    };
  });

  let peakMonth: { month: string; added: number } | null = null;
  for (const month of months) {
    if (!peakMonth || month.added > peakMonth.added) {
      peakMonth = { month: month.month, added: month.added };
    }
  }
  if (peakMonth && peakMonth.added === 0) peakMonth = null;

  return {
    months,
    peakMonth,
    unknownCreated,
    recent: { last7d, last30d, last90d, last365d },
  };
}

function buildCategories(
  repos: readonly AssetReportRepoRow[],
  categories: readonly AssetReportCategoryRow[],
  totalRepos: number
): AssetCategoryDistribution[] {
  const names = new Map(categories.map((category) => [category.id, category.name]));
  const groups = new Map<
    string,
    {
      id: string | null;
      name: string;
      repoCount: number;
      starCount: number;
      languages: Map<string, number>;
    }
  >();

  for (const repo of repos) {
    const id = repo.category_id && names.has(repo.category_id) ? repo.category_id : null;
    const name = id ? (names.get(id) as string) : '未分类';
    const key = id ?? '__uncategorized__';
    const group = groups.get(key) ?? {
      id,
      name,
      repoCount: 0,
      starCount: 0,
      languages: new Map<string, number>(),
    };
    group.repoCount += 1;
    group.starCount += num(repo.stars);
    const language = normalizeLanguage(repo.language);
    if (language) group.languages.set(language, (group.languages.get(language) ?? 0) + 1);
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => {
      let topLanguage: string | null = null;
      let topCount = 0;
      for (const [language, count] of group.languages) {
        if (count > topCount || (count === topCount && topLanguage && language < topLanguage)) {
          topLanguage = language;
          topCount = count;
        }
      }
      return {
        id: group.id,
        name: group.name,
        repoCount: group.repoCount,
        starCount: group.starCount,
        share: totalRepos > 0 ? round1((group.repoCount / totalRepos) * 100) : 0,
        avgStars: group.repoCount > 0 ? round1(group.starCount / group.repoCount) : 0,
        topLanguage,
      };
    })
    .sort(
      (a, b) =>
        b.repoCount - a.repoCount ||
        b.starCount - a.starCount ||
        a.name.localeCompare(b.name, 'zh-CN')
    );
}

function buildLanguages(
  repos: readonly AssetReportRepoRow[],
  totalRepos: number
): AssetLanguageDistribution[] {
  const groups = new Map<string, { repoCount: number; starCount: number }>();
  for (const repo of repos) {
    const language = normalizeLanguage(repo.language);
    if (!language) continue;
    const group = groups.get(language) ?? { repoCount: 0, starCount: 0 };
    group.repoCount += 1;
    group.starCount += num(repo.stars);
    groups.set(language, group);
  }
  return [...groups.entries()]
    .map(([name, group]) => ({
      name,
      repoCount: group.repoCount,
      starCount: group.starCount,
      share: totalRepos > 0 ? round1((group.repoCount / totalRepos) * 100) : 0,
    }))
    .sort(
      (a, b) =>
        b.repoCount - a.repoCount ||
        b.starCount - a.starCount ||
        a.name.localeCompare(b.name)
    );
}

function buildPlatforms(
  repos: readonly AssetReportRepoRow[],
  totalRepos: number
): AssetPlatformShare[] {
  const groups = new Map<string, { label: string; repoCount: number }>();
  for (const repo of repos) {
    const raw = (repo.platform ?? '').trim().toLowerCase() || 'unknown';
    const group = groups.get(raw) ?? { label: platformLabel(raw), repoCount: 0 };
    group.repoCount += 1;
    groups.set(raw, group);
  }
  return [...groups.entries()]
    .map(([platform, group]) => ({
      platform,
      label: group.label,
      repoCount: group.repoCount,
      share: totalRepos > 0 ? round1((group.repoCount / totalRepos) * 100) : 0,
    }))
    .sort(
      (a, b) => b.repoCount - a.repoCount || a.platform.localeCompare(b.platform)
    );
}

function buildInsights(
  summary: AssetReportSummary,
  categories: readonly AssetCategoryDistribution[],
  repos: readonly AssetReportRepoRow[],
  starTrend: AssetStarTrend
): AssetInsight[] {
  const insights: AssetInsight[] = [];
  if (summary.totalRepos === 0) {
    insights.push({
      kind: 'volume',
      title: '还没有收录任何仓库',
      description: '同步 GitHub Star 或手动收藏后，这里会生成收录量、分类分布与 Star 趋势报表。',
    });
    return insights;
  }

  if (summary.addedLast30d > 0) {
    insights.push({
      kind: 'growth',
      title: `近 30 天新增 ${summary.addedLast30d} 个仓库`,
      description: `较 30 天前存量增长 ${summary.growthRate30d}%，近 7 天新增 ${summary.addedLast7d} 个。`,
    });
  } else {
    insights.push({
      kind: 'growth',
      title: '近 30 天暂无新增收录',
      description: '可以同步最新 Star 或从热榜 / 推荐中补充新的收藏。',
    });
  }

  const top = summary.topCategory;
  if (top) {
    if (top.share >= 50) {
      insights.push({
        kind: 'category',
        title: `分类集中在「${top.name}」`,
        description: `${top.repoCount} 个仓库（${top.share}%）落在该分类，资产结构偏集中，建议关注其他方向的覆盖。`,
      });
    } else {
      const topThree = categories
        .slice(0, 3)
        .map((item) => `${item.name} ${item.share}%`)
        .join('、');
      insights.push({
        kind: 'category',
        title: '分类分布较均衡',
        description: `最大分类「${top.name}」占 ${top.share}%；前三大分类为 ${topThree}。`,
      });
    }
  }

  if (summary.uncategorizedRepos > 0) {
    const share = round1((summary.uncategorizedRepos / summary.totalRepos) * 100);
    if (share >= 20) {
      insights.push({
        kind: 'uncategorized',
        title: `未分类仓库占 ${share}%`,
        description: `${summary.uncategorizedRepos} 个仓库还没有分类，分类覆盖率 ${summary.categoryCoverage}%，建议补充分类以提升报表可读性。`,
      });
    }
  }

  const sortedStars = repos.map((repo) => num(repo.stars)).sort((a, b) => b - a);
  if (summary.totalStars > 0 && summary.totalRepos >= 10) {
    const topCount = Math.max(1, Math.ceil(summary.totalRepos * 0.1));
    const topStars = sortedStars.slice(0, topCount).reduce((sum, value) => sum + value, 0);
    const share = round1((topStars / summary.totalStars) * 100);
    if (share >= 60) {
      insights.push({
        kind: 'star',
        title: `Star 集中在头部 ${topCount} 个仓库`,
        description: `Top ${Math.round((topCount / summary.totalRepos) * 100)}% 仓库贡献了 ${share}% 的 Star，头部效应明显。`,
      });
    }
  }

  if (starTrend.available) {
    insights.push({
      kind: 'coverage',
      title: `Star 历史覆盖 ${summary.starTrendCoverage}%`,
      description: `有 ${starTrend.summary.trackedRepos} 个收藏仓库进入过热榜快照；未覆盖的仓库只计入当前 Star 存量。`,
    });
  } else {
    insights.push({
      kind: 'coverage',
      title: '暂无 Star 历史快照',
      description: '收藏仓库进入每日热榜后，才会产生可回溯的 Star 趋势；当前仅展示收录量与当前 Star 存量。',
    });
  }

  return insights.slice(0, 5);
}

export function buildAssetReport(
  repos: readonly AssetReportRepoRow[],
  categories: readonly AssetReportCategoryRow[],
  snapshots: readonly StarSnapshotRow[],
  options: BuildAssetReportOptions = {}
): AssetReportResponse {
  const now = options.now ?? new Date();
  const months = normalizeMonths(options.months);
  const window = buildMonthWindow(months, now);
  const totalRepos = repos.length;
  const totalStars = repos.reduce((sum, repo) => sum + num(repo.stars), 0);
  const totalForks = repos.reduce((sum, repo) => sum + num(repo.forks), 0);

  const volume = buildVolume(repos, window, now);
  const categoryList = buildCategories(repos, categories, totalRepos);
  const languageList = buildLanguages(repos, totalRepos);
  const platformList = buildPlatforms(repos, totalRepos);

  const uncategorized = categoryList.find((item) => item.id === null);
  const categorizedRepos = totalRepos - (uncategorized?.repoCount ?? 0);
  const categoryCoverage =
    totalRepos > 0 ? round1((categorizedRepos / totalRepos) * 100) : 0;
  const withLanguage = languageList.reduce((sum, item) => sum + item.repoCount, 0);
  const topLanguage = languageList[0]?.name ?? null;
  const topPlatform = platformList[0]?.label ?? null;
  const topCategory = categoryList[0]
    ? {
        name: categoryList[0].name,
        repoCount: categoryList[0].repoCount,
        share: categoryList[0].share,
      }
    : null;

  const starDays = starTrendDays(months);
  const trend = buildStarTrends(snapshots, {
    days: starDays,
    scope: 'my',
    portfolio: repos.map((repo) => ({
      id: repo.id,
      name: repo.name,
      stars: repo.stars,
      language: repo.language,
    })),
    now,
  });
  const starTrend: AssetStarTrend = {
    available: trend.summary.trackedRepos > 0,
    period: trend.period,
    summary: {
      trackedRepos: trend.summary.trackedRepos,
      totalStars: trend.summary.totalStars,
      starGain: trend.summary.starGain,
      coverage: trend.summary.coverage ?? 0,
    },
    series: trend.series,
    topMovers: trend.topMovers.slice(0, 5),
    languages: trend.languages.slice(0, 5),
  };

  const summary: AssetReportSummary = {
    totalRepos,
    totalStars,
    totalForks,
    avgStars: totalRepos > 0 ? round1(totalStars / totalRepos) : 0,
    categoryCount: categoryList.filter((item) => item.id !== null).length,
    categorizedRepos,
    uncategorizedRepos: uncategorized?.repoCount ?? 0,
    categoryCoverage,
    languageCount: languageList.length,
    withLanguage,
    platformCount: platformList.length,
    addedLast7d: volume.recent.last7d,
    addedLast30d: volume.recent.last30d,
    addedLast90d: volume.recent.last90d,
    addedLast365d: volume.recent.last365d,
    growthRate30d:
      totalRepos > 0
        ? round1(
            (volume.recent.last30d /
              Math.max(1, totalRepos - volume.recent.last30d)) *
              100
          )
        : 0,
    topCategory,
    topLanguage,
    topPlatform,
    starTrendCoverage: starTrend.summary.coverage,
  };

  return {
    period: {
      months,
      startDate: window[0]?.start.toISOString().slice(0, 10) ?? now.toISOString().slice(0, 10),
      endDate: now.toISOString().slice(0, 10),
    },
    summary,
    volume: {
      months: volume.months,
      recent: volume.recent,
      peakMonth: volume.peakMonth,
      unknownCreated: volume.unknownCreated,
      platforms: platformList,
    },
    categories: categoryList,
    languages: languageList,
    starTrend,
    insights: buildInsights(summary, categoryList, repos, starTrend),
    generatedAt: now.toISOString(),
  };
}
